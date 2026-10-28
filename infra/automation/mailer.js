#!/usr/bin/env node
"use strict";

/*
 * Carva alert mailer — emails the warnings that matter.
 *
 * A separate process from runner.js ON PURPOSE: runner.js can cut a car's fuel,
 * and nothing about email (a slow SMTP server, a bad password, a crash here)
 * may ever touch that path. This service only READS:
 *
 *   1. /var/lib/carva/alerts.jsonl  — runner.js's append-only log. `kind:"alert"`
 *      lines are geofence rule notifications (repair shop, restricted zone...)
 *      with category + severity; `kind:"action"` lines are engine-cut attempts.
 *   2. Traccar positions since the last check, per device — read directly, not
 *      via Traccar events, because on this install Traccar has recorded one
 *      alarm and zero offline events in its whole history. From the positions:
 *        - alarms the tracker reports (attributes.alarm: sos, powerCut, ...)
 *        - external power lost / restored (attributes.power voltage)
 *        - overspeed (speed above the device's speedLimit or the default)
 *   3. Traccar devices — a tracker that was reporting and goes silent.
 *
 * Mail goes out through `curl smtps://` with a root-only netrc file, so no
 * dependency is needed and the password never appears in argv or logs.
 *
 * Safety: nothing from before the first start is ever mailed; every warning has
 * a per-(device, kind) cooldown and there is a global hourly cap; failed sends
 * are queued in the state file and retried, so a mail outage loses nothing.
 *
 * Env (systemd EnvironmentFile): CARVA_TRACCAR_EMAIL / CARVA_TRACCAR_PASSWORD
 * (shared with runner.js), MAIL_FROM, MAIL_TO (comma-separated), SMTP_HOST,
 * SMTP_PORT, SMTP_NETRC (default /etc/carva/mail.netrc). CARVA_MAILER_DRYRUN=1
 * logs the emails instead of sending them.
 */

const fs = require("fs");
const fsp = require("fs/promises");
const { spawn } = require("child_process");

/* ------------------------------- config ---------------------------------- */

const DEFAULTS = {
  traccarUrl: "http://localhost:8082",
  alertsPath: "/var/lib/carva/alerts.jsonl",
  statePath: "/var/lib/carva/mailer-state.json",
  /** Edited from the website (Settings → Email alerts); re-read every poll. */
  settingsPath: "/var/lib/carva/alert-settings.json",
  /** What we last did, for the website to show. */
  statusPath: "/var/lib/carva/mailer-status.json",
  pollIntervalMs: 30_000,
  /** Used when a device has no `speedLimit` attribute (Traccar stores knots). */
  speedLimitKmh: 120,
  /** A tracker silent this long, after reporting recently, is "offline". */
  offlineAfterMin: 20,
  /** Only trackers heard from within this window can go "offline" (never-
      reporting test units would otherwise mail forever). */
  recentlyActiveHours: 24,
  /** External power: below `lost` after being at/above `ok` = power cut. */
  powerLostVolts: 5,
  powerOkVolts: 9,
  cooldownMin: 10,
  maxEmailsPerHour: 30,
  /** Positions window cap per poll, so a long outage can't fetch days. */
  maxLookbackMin: 120,
  dashboardUrl: "https://gps.carvarent.com",
  timeZone: "Asia/Baghdad",
};

function loadConfig() {
  const file = process.argv[2];
  let fromFile = {};
  if (file) {
    try {
      fromFile = JSON.parse(fs.readFileSync(file, "utf8"));
    } catch (e) {
      log("warn", "config_unreadable", { file, error: e.message });
    }
  }
  const env = process.env;
  return {
    ...DEFAULTS,
    ...fromFile,
    email: env.CARVA_TRACCAR_EMAIL || fromFile.email || "",
    password: env.CARVA_TRACCAR_PASSWORD || fromFile.password || "",
    mailFrom: env.MAIL_FROM || "",
    mailTo: (env.MAIL_TO || "").split(",").map((s) => s.trim()).filter(Boolean),
    /** Seeds the website settings file on first run; the file wins after. */
    envMailTo: (env.MAIL_TO || "").split(",").map((s) => s.trim()).filter(Boolean),
    smtpHost: env.SMTP_HOST || "",
    smtpPort: Number(env.SMTP_PORT || 465),
    smtpNetrc: env.SMTP_NETRC || "/etc/carva/mail.netrc",
    dryRun: env.CARVA_MAILER_DRYRUN === "1",
  };
}

function log(level, msg, data) {
  // One JSON line per message, straight into the journal.
  console.log(JSON.stringify({ t: new Date().toISOString(), level, msg, ...(data || {}) }));
}

/* ---------------------------- Traccar client ----------------------------- */

class Traccar {
  constructor(cfg) {
    this.cfg = cfg;
    this.cookie = null;
  }
  async login() {
    const body = new URLSearchParams({ email: this.cfg.email, password: this.cfg.password });
    const res = await fetch(`${this.cfg.traccarUrl}/api/session`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) throw new Error(`traccar login ${res.status}`);
    const m = /JSESSIONID=([^;]+)/.exec(res.headers.get("set-cookie") || "");
    if (!m) throw new Error("traccar login returned no JSESSIONID cookie");
    this.cookie = `JSESSIONID=${m[1]}`;
  }
  async get(path) {
    if (!this.cookie) await this.login();
    // Accept MUST be concrete: Traccar answers */* on report endpoints with XLSX.
    const opts = () => ({
      headers: { Accept: "application/json", Cookie: this.cookie },
      signal: AbortSignal.timeout(20_000),
    });
    let res = await fetch(`${this.cfg.traccarUrl}${path}`, opts());
    if (res.status === 401) {
      this.cookie = null;
      await this.login();
      res = await fetch(`${this.cfg.traccarUrl}${path}`, opts());
    }
    if (!res.ok) throw new Error(`GET ${path} -> ${res.status}`);
    return res.json();
  }
}

/* -------------------------------- state ---------------------------------- */

function freshState() {
  return {
    initialized: false,
    /** First start; positions recorded before it are never mailed. */
    startedAtMs: 0,
    alertsOffset: 0,
    /** deviceId -> ISO fixTime of the newest position already examined. */
    lastPosTime: {},
    /** deviceId -> recent position ids (dedupe across the overlap window). */
    seenPos: {},
    /** deviceId -> "ok" | "lost" (external power). */
    power: {},
    /** deviceId -> true while we consider it offline. */
    offline: {},
    /** cooldown key -> ms of last email. */
    sentAt: {},
    hour: { start: 0, count: 0 },
    /** The last test request already answered (settings.testRequestedAt). */
    lastTestRequestedAt: null,
    /** Mirrored to statusPath for the website's Settings card. */
    status: {},
    /** Emails not yet delivered, retried every poll. */
    queue: [],
  };
}

async function loadState(path) {
  try {
    return { ...freshState(), ...JSON.parse(await fsp.readFile(path, "utf8")) };
  } catch {
    return freshState();
  }
}

async function saveState(path, state) {
  const tmp = `${path}.tmp`;
  await fsp.writeFile(tmp, JSON.stringify(state));
  await fsp.rename(tmp, path);
}

/* ------------------------------ formatting ------------------------------- */

const CATEGORY_LABEL = {
  repair: "Repair shop",
  restricted: "Restricted zone",
  customer: "Customer",
  base: "Base",
  zone: "Zone",
};

const SEVERITY_COLOR = { critical: "#dc2626", warning: "#d97706", info: "#2563eb" };

const ALARM_LABEL = {
  powerCut: "Power cut (tracker unplugged)",
  powerOff: "Tracker powered off",
  lowBattery: "Tracker battery low",
  sos: "SOS button pressed",
  vibration: "Vibration / shock detected",
  tampering: "Tampering detected",
  movement: "Unauthorised movement",
  overspeed: "Overspeed",
  removing: "Tracker removed",
  accident: "Accident detected",
  door: "Door opened",
  gpsAntennaCut: "GPS antenna cut",
  jamming: "Signal jamming",
};

function fmtTime(iso, cfg) {
  const d = iso ? new Date(iso) : new Date();
  if (Number.isNaN(+d)) return String(iso || "");
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: cfg.timeZone,
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(d) + " (Baghdad)";
}

function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}

/**
 * One mail = { key, severity, vehicle, deviceId, headline, rows: [[label, value]],
 *              lat?, lng?, at? }. Rendered to text + HTML here.
 */
function render(mail, cfg) {
  const sev = (mail.severity || "warning").toLowerCase();
  const subject = `[Carva GPS] ${sev.toUpperCase()} · ${mail.vehicle}: ${mail.headline}`;
  const rows = [
    ["Vehicle", mail.vehicle],
    ...mail.rows,
    ["When", fmtTime(mail.at, cfg)],
  ];
  const mapUrl =
    mail.lat != null && mail.lng != null
      ? `https://www.google.com/maps/search/?api=1&query=${mail.lat},${mail.lng}`
      : null;
  if (mapUrl) rows.push(["Location", `${Number(mail.lat).toFixed(5)}, ${Number(mail.lng).toFixed(5)}`]);
  const liveUrl = `${cfg.dashboardUrl}/fleet${mail.deviceId != null ? `?device=${mail.deviceId}` : ""}`;

  const text =
    `${mail.headline}\n\n` +
    rows.map(([k, v]) => `${k}: ${v}`).join("\n") +
    (mapUrl ? `\nMap: ${mapUrl}` : "") +
    `\nLive map: ${liveUrl}\n\n— Carva GPS (gps.carvarent.com)\n`;

  const color = SEVERITY_COLOR[sev] || SEVERITY_COLOR.warning;
  const html = `<!doctype html><html><body style="margin:0;background:#f4f1ea;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#1c1917">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f1ea;padding:24px 12px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:14px;overflow:hidden;border:1px solid #e7e2d8">
<tr><td style="background:#0b0a09;padding:16px 22px;color:#f4efe6;font-size:15px;font-weight:700;letter-spacing:.04em">CARVA <span style="color:#d1b06b">GPS</span></td></tr>
<tr><td style="height:4px;background:${color}"></td></tr>
<tr><td style="padding:22px">
<div style="display:inline-block;font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:${color}">${esc(sev)}</div>
<h1 style="margin:6px 0 16px;font-size:20px;line-height:1.3">${esc(mail.vehicle)}: ${esc(mail.headline)}</h1>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="font-size:14px;border-collapse:collapse">
${rows.map(([k, v]) => `<tr><td style="padding:7px 0;color:#78716c;width:120px;vertical-align:top;border-top:1px solid #f0ece4">${esc(k)}</td><td style="padding:7px 0;border-top:1px solid #f0ece4;font-weight:600" dir="auto">${esc(v)}</td></tr>`).join("\n")}
</table>
<p style="margin:22px 0 0">
<a href="${esc(liveUrl)}" style="display:inline-block;background:#b8913f;color:#0b0a09;text-decoration:none;font-weight:700;padding:10px 18px;border-radius:9px">Open live map</a>
${mapUrl ? `&nbsp;<a href="${esc(mapUrl)}" style="display:inline-block;color:#1c1917;text-decoration:none;font-weight:600;padding:10px 14px;border:1px solid #e7e2d8;border-radius:9px">View location</a>` : ""}
</p>
</td></tr>
<tr><td style="padding:14px 22px;background:#faf8f4;color:#a8a29e;font-size:12px">Sent automatically by your Carva GPS server. Warnings repeat at most every ${cfg.cooldownMin} minutes per vehicle.</td></tr>
</table></td></tr></table></body></html>`;

  return { subject, text, html };
}

/**
 * RFC 2047 so Arabic/Kurdish names survive in the subject line. Split into
 * encoded-words of at most 45 bytes (≤ 72 chars each, under the 75 limit),
 * never cutting a multi-byte character, folded onto continuation lines.
 */
function encodeHeader(s) {
  if (/^[\x20-\x7e]*$/.test(s)) return s;
  const words = [];
  let chunk = "";
  for (const ch of s) {
    if (Buffer.byteLength(chunk + ch, "utf8") > 45) {
      words.push(chunk);
      chunk = "";
    }
    chunk += ch;
  }
  if (chunk) words.push(chunk);
  return words
    .map((w) => `=?UTF-8?B?${Buffer.from(w, "utf8").toString("base64")}?=`)
    .join("\r\n ");
}

function b64lines(s) {
  return Buffer.from(s, "utf8").toString("base64").replace(/(.{76})/g, "$1\r\n");
}

function mime(cfg, { subject, text, html }) {
  const boundary = `carva-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  const domain = (cfg.mailFrom.split("@")[1] || "localhost").trim();
  return [
    `From: ${encodeHeader("Carva GPS Alerts")} <${cfg.mailFrom}>`,
    `To: ${cfg.mailTo.join(", ")}`,
    `Subject: ${encodeHeader(subject)}`,
    `Date: ${new Date().toUTCString()}`,
    `Message-ID: <${boundary}@${domain}>`,
    "MIME-Version: 1.0",
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    "",
    `--${boundary}`,
    "Content-Type: text/plain; charset=UTF-8",
    "Content-Transfer-Encoding: base64",
    "",
    b64lines(text),
    `--${boundary}`,
    "Content-Type: text/html; charset=UTF-8",
    "Content-Transfer-Encoding: base64",
    "",
    b64lines(html),
    `--${boundary}--`,
    "",
  ].join("\r\n");
}

function sendViaCurl(cfg, message) {
  return new Promise((resolve, reject) => {
    const args = [
      "-sS",
      "--ssl-reqd",
      "--max-time", "45",
      "--url", `smtps://${cfg.smtpHost}:${cfg.smtpPort}`,
      "--netrc-file", cfg.smtpNetrc,
      "--mail-from", cfg.mailFrom,
      ...cfg.mailTo.flatMap((to) => ["--mail-rcpt", to]),
      "--upload-file", "-",
    ];
    const child = spawn("curl", args, { stdio: ["pipe", "ignore", "pipe"] });
    let err = "";
    child.stderr.on("data", (d) => (err += d));
    child.on("error", reject);
    child.on("close", (code) =>
      code === 0 ? resolve() : reject(new Error(`curl exit ${code}: ${err.trim().slice(0, 300)}`)),
    );
    child.stdin.end(message);
  });
}

/* ------------------------------- the work -------------------------------- */

/**
 * Which Settings switch governs a mail, from its key. Must match ALERT_TYPES
 * in apps/web/lib/alert-settings.ts.
 */
function typeOfKey(key) {
  if (key.includes(":geofence:")) return "geofence";
  if (key.includes(":cut:")) return "engineCut";
  if (/:(offline|online)$/.test(key)) return "offline";
  if (/:alarm:(powerCut|powerOff)$/.test(key) || key.includes(":power-")) return "powerCut";
  if (key.includes(":alarm:")) return "alarm";
  if (key.endsWith(":overspeed")) return "overspeed";
  return "alarm";
}

/** Queue a mail unless its type is switched off or its key is cooling down. */
function enqueue(state, cfg, mail) {
  const type = typeOfKey(mail.key);
  if (cfg.types && cfg.types[type] === false) {
    log("info", "type_disabled", { key: mail.key, type });
    return;
  }
  const now = Date.now();
  const last = state.sentAt[mail.key] || 0;
  if (now - last < cfg.cooldownMin * 60_000) {
    log("info", "cooldown_skip", { key: mail.key });
    return;
  }
  state.sentAt[mail.key] = now;
  state.queue.push(mail);
  if (state.queue.length > 100) state.queue.splice(0, state.queue.length - 100);
}

async function flushQueue(state, cfg) {
  const now = Date.now();
  if (now - state.hour.start > 3_600_000) state.hour = { start: now, count: 0 };
  if (cfg.mailTo.length === 0 && state.queue.length) {
    // Emails switched off (no recipients). Drop rather than hoard: adding an
    // address later must not unleash a backlog of stale warnings.
    log("info", "no_recipients_dropping", { dropped: state.queue.length });
    state.queue = [];
    return;
  }
  while (state.queue.length) {
    if (state.hour.count >= cfg.maxEmailsPerHour) {
      log("warn", "hourly_cap_reached", { queued: state.queue.length });
      return;
    }
    const mail = state.queue[0];
    const rendered = render(mail, cfg);
    if (cfg.dryRun) {
      log("info", "DRY_RUN_email", { subject: rendered.subject });
    } else {
      try {
        await sendViaCurl(cfg, mime(cfg, rendered));
        log("info", "email_sent", { subject: rendered.subject });
        state.status.lastSent = { at: new Date().toISOString(), subject: rendered.subject };
      } catch (e) {
        log("error", "email_failed", { subject: rendered.subject, error: e.message });
        state.status.lastError = { at: new Date().toISOString(), message: e.message.slice(0, 200) };
        return; // keep it queued; next poll retries
      }
    }
    state.queue.shift();
    state.hour.count += 1;
  }
}

/** New complete lines of runner.js's alert log since last time. */
async function readNewAlerts(state, cfg) {
  let st;
  try {
    st = await fsp.stat(cfg.alertsPath);
  } catch {
    return [];
  }
  if (st.size < state.alertsOffset) state.alertsOffset = 0; // rotated / truncated
  if (st.size === state.alertsOffset) return [];
  const fh = await fsp.open(cfg.alertsPath, "r");
  try {
    const len = st.size - state.alertsOffset;
    const buf = Buffer.alloc(len);
    await fh.read(buf, 0, len, state.alertsOffset);
    const text = buf.toString("utf8");
    const lastNl = text.lastIndexOf("\n");
    if (lastNl < 0) return []; // a line still being written
    state.alertsOffset += Buffer.byteLength(text.slice(0, lastNl + 1), "utf8");
    return text
      .slice(0, lastNl)
      .split("\n")
      .map((l) => {
        try {
          return JSON.parse(l);
        } catch {
          return null;
        }
      })
      .filter(Boolean);
  } finally {
    await fh.close();
  }
}

async function positionOfEvent(traccar, eventId) {
  try {
    const ev = await traccar.get(`/api/events/${eventId}`);
    if (!ev?.positionId) return null;
    const list = await traccar.get(`/api/positions?id=${ev.positionId}`);
    const p = Array.isArray(list) ? list[0] : null;
    return p ? { lat: p.latitude, lng: p.longitude } : null;
  } catch {
    return null;
  }
}

async function handleAlertLog(state, cfg, traccar, names) {
  for (const a of await readNewAlerts(state, cfg)) {
    if (a.kind === "alert" && /^geofence(Enter|Exit)$/.test(a.type)) {
      const entered = a.type === "geofenceEnter";
      const cat = CATEGORY_LABEL[a.category] || a.category || "Zone";
      const pos = a.eventId ? await positionOfEvent(traccar, a.eventId) : null;
      enqueue(state, cfg, {
        key: `${a.deviceId}:geofence:${a.geofenceId}:${a.type}`,
        severity: a.severity || "warning",
        vehicle: a.deviceName || names.get(a.deviceId) || `Device ${a.deviceId}`,
        deviceId: a.deviceId,
        headline: `${entered ? "entered" : "left"} ${a.geofenceName} (${cat})`,
        rows: [
          ["Zone", `${a.geofenceName} — ${cat}`],
          ["Event", entered ? "Entered the zone" : "Left the zone"],
          ...(a.note ? [["Note", a.note]] : []),
          ...(a.plannedCut && a.plannedCut !== "none"
            ? [["Engine cut", `Rule asks for "${a.plannedCut}" cut${a.dryRun ? " (dry run)" : ""}`]]
            : []),
          ...(a.stale ? [["Delay", "This crossing was reported late by the tracker"]] : []),
        ],
        at: a.ts,
        ...(pos || {}),
      });
    } else if (a.kind === "action" && a.outcome) {
      const outcomeText = {
        sent: "Engine cut command SENT to the tracker",
        dry_run: "Engine cut would have been sent (dry run)",
        refused: `Engine cut refused by safety rules${a.reason ? ` (${a.reason})` : ""}`,
        failed: `Engine cut FAILED${a.error ? `: ${a.error}` : ""}`,
      }[a.outcome] || `Engine cut: ${a.outcome}`;
      enqueue(state, cfg, {
        key: `${a.deviceId}:cut:${a.eventId}`,
        severity: a.outcome === "sent" || a.outcome === "failed" ? "critical" : "warning",
        vehicle: names.get(a.deviceId) || `Device ${a.deviceId}`,
        deviceId: a.deviceId,
        headline: outcomeText,
        rows: [
          ["Action", outcomeText],
          ...(a.mode ? [["Mode", a.downgraded ? `${a.mode} (downgraded for safety)` : a.mode]] : []),
          ...(a.speedKmh != null ? [["Speed then", `${a.speedKmh} km/h`]] : []),
          ...(a.category ? [["Zone type", CATEGORY_LABEL[a.category] || a.category]] : []),
        ],
        at: a.ts,
      });
    }
  }
}

function alarmsOf(p) {
  const raw = p.attributes?.alarm;
  return typeof raw === "string" && raw ? raw.split(",").map((s) => s.trim()).filter(Boolean) : [];
}

async function handleDevices(state, cfg, traccar, devices) {
  const now = Date.now();
  for (const d of devices) {
    const id = String(d.id);
    const name = d.name || `Device ${d.id}`;

    // ---- offline / back online (from the device's own last-heard time) ----
    const lastMs = d.lastUpdate ? +new Date(d.lastUpdate) : NaN;
    if (Number.isFinite(lastMs)) {
      const ageMin = (now - lastMs) / 60_000;
      const wasOffline = !!state.offline[id];
      if (!wasOffline && ageMin > cfg.offlineAfterMin && ageMin < cfg.recentlyActiveHours * 60) {
        state.offline[id] = true;
        enqueue(state, cfg, {
          key: `${id}:offline`,
          severity: "warning",
          vehicle: name,
          deviceId: d.id,
          headline: `tracker stopped reporting (${Math.round(ageMin)} min)`,
          rows: [["Last heard", fmtTime(d.lastUpdate, cfg)], ["Status", "No data from the tracker"]],
          at: new Date().toISOString(),
        });
      } else if (wasOffline && ageMin <= cfg.offlineAfterMin) {
        state.offline[id] = false;
        enqueue(state, cfg, {
          key: `${id}:online`,
          severity: "info",
          vehicle: name,
          deviceId: d.id,
          headline: "tracker is reporting again",
          rows: [["Status", "Back online"]],
          at: d.lastUpdate,
        });
      }
    }

    // ---- positions since last check: alarms, power, overspeed ----
    const since = state.lastPosTime[id]
      ? Math.max(+new Date(state.lastPosTime[id]) - 120_000, now - cfg.maxLookbackMin * 60_000)
      : now - 60_000;
    let positions;
    try {
      positions = await traccar.get(
        `/api/positions?deviceId=${d.id}&from=${new Date(since).toISOString()}&to=${new Date(now).toISOString()}`,
      );
    } catch (e) {
      log("warn", "positions_failed", { deviceId: d.id, error: e.message });
      continue;
    }
    if (!Array.isArray(positions) || positions.length === 0) continue;
    positions.sort((a, b) => +new Date(a.fixTime) - +new Date(b.fixTime));

    const seen = new Set(state.seenPos[id] || []);
    const limitKmh =
      typeof d.attributes?.speedLimit === "number" && d.attributes.speedLimit > 0
        ? d.attributes.speedLimit * 1.852
        : cfg.speedLimitKmh;
    let fastest = null;

    for (const p of positions) {
      if (seen.has(p.id)) continue;
      seen.add(p.id);
      if (!state.lastPosTime[id] || +new Date(p.fixTime) > +new Date(state.lastPosTime[id])) {
        state.lastPosTime[id] = p.fixTime;
      }
      // The overlap window can reach back before the very first start.
      if (+new Date(p.fixTime) < (state.startedAtMs || 0)) continue;

      for (const alarm of alarmsOf(p)) {
        enqueue(state, cfg, {
          key: `${id}:alarm:${alarm}`,
          severity: ["sos", "powerCut", "removing", "tampering", "accident", "gpsAntennaCut", "jamming"].includes(alarm)
            ? "critical"
            : "warning",
          vehicle: name,
          deviceId: d.id,
          headline: ALARM_LABEL[alarm] || `Alarm: ${alarm}`,
          rows: [["Alarm", ALARM_LABEL[alarm] || alarm]],
          at: p.fixTime,
          lat: p.latitude,
          lng: p.longitude,
        });
      }

      const volts = typeof p.attributes?.power === "number" ? p.attributes.power : null;
      if (volts != null) {
        const prev = state.power[id];
        if (volts >= cfg.powerOkVolts) {
          if (prev === "lost") {
            enqueue(state, cfg, {
              key: `${id}:power-restored`,
              severity: "info",
              vehicle: name,
              deviceId: d.id,
              headline: `external power restored (${volts.toFixed(1)} V)`,
              rows: [["Power", `${volts.toFixed(1)} V`]],
              at: p.fixTime,
              lat: p.latitude,
              lng: p.longitude,
            });
          }
          state.power[id] = "ok";
        } else if (volts < cfg.powerLostVolts && prev === "ok") {
          state.power[id] = "lost";
          enqueue(state, cfg, {
            key: `${id}:power-lost`,
            severity: "critical",
            vehicle: name,
            deviceId: d.id,
            headline: `external power LOST (${volts.toFixed(1)} V) — tracker may be unplugged`,
            rows: [
              ["Power", `${volts.toFixed(1)} V (was normal)`],
              ["Meaning", "The tracker lost the car's battery supply: unplugged, wire cut, or battery disconnected."],
            ],
            at: p.fixTime,
            lat: p.latitude,
            lng: p.longitude,
          });
        }
      }

      const kmh = (p.speed || 0) * 1.852;
      if (kmh > limitKmh && (!fastest || kmh > fastest.kmh)) fastest = { kmh, p };
    }

    if (fastest) {
      enqueue(state, cfg, {
        key: `${id}:overspeed`,
        severity: "warning",
        vehicle: name,
        deviceId: d.id,
        headline: `overspeed ${Math.round(fastest.kmh)} km/h (limit ${Math.round(limitKmh)})`,
        rows: [
          ["Speed", `${Math.round(fastest.kmh)} km/h`],
          ["Limit", `${Math.round(limitKmh)} km/h`],
        ],
        at: fastest.p.fixTime,
        lat: fastest.p.latitude,
        lng: fastest.p.longitude,
      });
    }

    state.seenPos[id] = [...seen].slice(-500);
  }
}

/** First start: remember "now" everywhere so nothing historical is mailed. */
async function initialize(state, cfg, traccar) {
  try {
    state.alertsOffset = (await fsp.stat(cfg.alertsPath)).size;
  } catch {
    state.alertsOffset = 0;
  }
  const devices = await traccar.get("/api/devices");
  const positions = await traccar.get("/api/positions");
  const latest = new Map(positions.map((p) => [String(p.deviceId), p]));
  const now = Date.now();
  for (const d of devices) {
    const id = String(d.id);
    state.lastPosTime[id] = new Date(now).toISOString();
    const v = latest.get(id)?.attributes?.power;
    if (typeof v === "number") state.power[id] = v >= cfg.powerOkVolts ? "ok" : v < cfg.powerLostVolts ? "lost" : undefined;
    const last = d.lastUpdate ? +new Date(d.lastUpdate) : NaN;
    state.offline[id] = Number.isFinite(last) && (now - last) / 60_000 > cfg.offlineAfterMin;
  }
  state.startedAtMs = now;
  state.initialized = true;
  log("info", "initialized", { devices: devices.length, alertsOffset: state.alertsOffset });
}

/* -------------------------- website settings ----------------------------- */

const ALERT_TYPES = ["geofence", "engineCut", "alarm", "powerCut", "offline", "overspeed"];
// Same rules as apps/web/lib/alert-settings.ts (sanitizeAlertSettings).
const EMAIL_RE = /^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]{2,}$/;

function clampInt(v, min, max, fallback) {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.round(n))) : fallback;
}

async function writeAtomic(file, text) {
  const tmp = `${file}.${process.pid}.tmp`;
  await fsp.writeFile(tmp, text);
  await fsp.rename(tmp, file);
}

/**
 * The settings the website edits. Seeded once from MAIL_TO if the file does
 * not exist yet; null (keep the last applied settings) if it is unreadable.
 */
async function loadSettings(cfg) {
  let raw;
  try {
    raw = JSON.parse(await fsp.readFile(cfg.settingsPath, "utf8"));
  } catch (e) {
    if (e.code !== "ENOENT") {
      log("warn", "settings_unreadable", { error: e.message });
      return null;
    }
    raw = {
      version: 1,
      recipients: cfg.envMailTo,
      types: Object.fromEntries(ALERT_TYPES.map((t) => [t, true])),
      speedLimitKmh: DEFAULTS.speedLimitKmh,
      offlineAfterMin: DEFAULTS.offlineAfterMin,
      testRequestedAt: null,
      updatedAt: new Date().toISOString(),
      updatedBy: "mailer (seeded from MAIL_TO)",
    };
    await writeAtomic(cfg.settingsPath, JSON.stringify(raw, null, 2));
    log("info", "settings_seeded", { recipients: raw.recipients });
  }
  const seen = new Set();
  const recipients = (Array.isArray(raw.recipients) ? raw.recipients : [])
    .filter((e) => typeof e === "string")
    .map((e) => e.trim().toLowerCase())
    .filter((e) => EMAIL_RE.test(e) && !seen.has(e) && seen.add(e))
    .slice(0, 10);
  const rawTypes = raw.types && typeof raw.types === "object" ? raw.types : {};
  return {
    recipients,
    types: Object.fromEntries(
      ALERT_TYPES.map((t) => [t, typeof rawTypes[t] === "boolean" ? rawTypes[t] : true]),
    ),
    speedLimitKmh: clampInt(raw.speedLimitKmh, 30, 250, DEFAULTS.speedLimitKmh),
    offlineAfterMin: clampInt(raw.offlineAfterMin, 5, 1440, DEFAULTS.offlineAfterMin),
    testRequestedAt: typeof raw.testRequestedAt === "string" ? raw.testRequestedAt : null,
  };
}

function applySettings(cfg, s) {
  cfg.mailTo = s.recipients;
  cfg.types = s.types;
  cfg.speedLimitKmh = s.speedLimitKmh;
  cfg.offlineAfterMin = s.offlineAfterMin;
}

/** "Send test email" from the website: answered once per request. */
async function handleTestRequest(state, cfg, s) {
  if (!s.testRequestedAt || s.testRequestedAt === state.lastTestRequestedAt) return;
  state.lastTestRequestedAt = s.testRequestedAt;
  const result = { requestedAt: s.testRequestedAt, at: new Date().toISOString(), ok: false };
  const on = ALERT_TYPES.filter((t) => cfg.types?.[t] !== false);
  if (cfg.mailTo.length === 0) {
    result.error = "no recipients";
  } else if (cfg.dryRun) {
    result.error = "mailer is in dry-run mode";
  } else {
    const rendered = render(
      {
        severity: "info",
        vehicle: "Carva GPS",
        headline: "test email — warning emails are working",
        rows: [
          ["Recipients", cfg.mailTo.join(", ")],
          ["Emailed warnings", on.join(", ") || "none"],
          ["Speed limit", `${cfg.speedLimitKmh} km/h`],
          ["Offline after", `${cfg.offlineAfterMin} min`],
        ],
        at: result.at,
      },
      cfg,
    );
    try {
      await sendViaCurl(cfg, mime(cfg, rendered));
      result.ok = true;
      log("info", "test_email_sent", { to: cfg.mailTo });
    } catch (e) {
      result.error = e.message.slice(0, 200);
      log("error", "test_email_failed", { error: e.message });
    }
  }
  state.status.lastTest = result;
}

async function main() {
  const cfg = loadConfig();
  const problems = [];
  if (!cfg.email || !cfg.password) problems.push("CARVA_TRACCAR_EMAIL / CARVA_TRACCAR_PASSWORD");
  // Recipients may come from the settings file instead of MAIL_TO.
  if (!cfg.mailFrom) problems.push("MAIL_FROM");
  if (!cfg.smtpHost) problems.push("SMTP_HOST");
  if (problems.length) {
    log("error", "missing_config", { missing: problems });
    process.exit(2);
  }
  log("info", "starting", {
    to: cfg.mailTo,
    dryRun: cfg.dryRun,
    speedLimitKmh: cfg.speedLimitKmh,
    offlineAfterMin: cfg.offlineAfterMin,
  });

  const traccar = new Traccar(cfg);
  const state = await loadState(cfg.statePath);
  let stopping = false;
  for (const sig of ["SIGTERM", "SIGINT"]) process.on(sig, () => (stopping = true));

  while (!stopping) {
    try {
      if (!state.initialized) await initialize(state, cfg, traccar);
      const settings = await loadSettings(cfg);
      if (settings) applySettings(cfg, settings);
      const devices = await traccar.get("/api/devices");
      const names = new Map(devices.map((d) => [d.id, d.name]));
      await handleAlertLog(state, cfg, traccar, names);
      await handleDevices(state, cfg, traccar, devices);
      // Persist decisions BEFORE sending, so a crash mid-send re-sends at most
      // (a duplicate email is harmless; a lost warning is not).
      await saveState(cfg.statePath, state);
      await flushQueue(state, cfg);
      if (settings) await handleTestRequest(state, cfg, settings);
      await saveState(cfg.statePath, state);
      await writeAtomic(
        cfg.statusPath,
        JSON.stringify({ ...state.status, lastPollAt: new Date().toISOString(), recipients: cfg.mailTo }),
      );
    } catch (e) {
      log("error", "poll_failed", { error: e.message });
      if (/401|login/i.test(e.message)) traccar.cookie = null;
    }
    const until = Date.now() + cfg.pollIntervalMs;
    while (!stopping && Date.now() < until) await new Promise((r) => setTimeout(r, 1000));
  }
  log("info", "stopped");
}

if (require.main === module) {
  main();
}

module.exports = { render, mime, encodeHeader, alarmsOf, handleDevices, handleAlertLog, freshState, enqueue, loadSettings, applySettings, handleTestRequest, typeOfKey };
