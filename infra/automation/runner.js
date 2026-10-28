#!/usr/bin/env node
"use strict";

/**
 * Carva Fleet — geofence automation runner.
 * =========================================
 *
 * A standalone Node service (no npm dependencies, global `fetch` only) that
 * polls Traccar for geofenceEnter / geofenceExit events and applies the rules
 * stored on each geofence's own `attributes.carvaRules` object:
 *
 *   - notify -> append a structured alert to an append-only JSONL log that the
 *     web app reads.
 *   - cut    -> send a JT/T 808 0x8500 "vehicle control" frame through Traccar's
 *     `custom` command, cutting the fuel/power relay.
 *
 * *** THIS PROCESS CAN IMMOBILISE A CAR. ***
 * Read the safety rails in the SAFETY section below before changing anything.
 * The fastest kill switch is:  CARVA_AUTOMATION_DISABLE=1  (forces dry-run), or
 * `systemctl stop carva-automation`.
 *
 * Design notes worth knowing before you edit:
 *  - Traccar report endpoints answer `Accept: * / *` with an XLSX binary, so every
 *    /api/reports/* call below sends `Accept: application/json` explicitly.
 *  - Traccar position `speed` is in KNOTS, not km/h. See knotsToKmh().
 *  - Traccar's native jt808 engineStop (0x8105 + vendor bytes 0xF0/0xF1) is
 *    silently ignored by the MV930G trackers in this fleet. Only the hand-built
 *    0x8500 frame works. Mirrored from apps/web/lib/jt808.ts.
 */

const fs = require("fs");
const fsp = require("fs/promises");
const path = require("path");
const os = require("os");

/* ========================================================================== *
 * SECTION 1 — Configuration
 * ========================================================================== */

/** Defaults for everything the operator does not set. */
const DEFAULTS = {
  // --- master switch -------------------------------------------------------
  /** Nothing is ever sent for real until this is explicitly turned on. */
  enabled: false,

  // --- Traccar -------------------------------------------------------------
  traccarUrl: "http://localhost:8082",
  email: "",
  password: "",

  // --- timing --------------------------------------------------------------
  /** How often to poll, in ms. */
  pollIntervalMs: 30000,
  /**
   * How far back to re-query on every poll, in ms. Traccar can persist an event
   * a moment after its eventTime, so we deliberately overlap the window and rely
   * on the seen-id set below to avoid double-firing.
   */
  lookbackOverlapMs: 120000,
  /** Per-request timeout, in ms. */
  requestTimeoutMs: 15000,

  // --- safety --------------------------------------------------------------
  /** Ignore a repeat of the same (device, fence, phase) within this window. */
  debounceMs: 5 * 60 * 1000,
  /** Hard ceiling on cut commands sent per rolling hour, across the whole fleet. */
  maxCutsPerHour: 6,
  /** Above this speed an "immediate" cut is downgraded to a safe (deferred) cut. */
  maxImmediateCutKmh: 5,
  /**
   * A geofence crossing older than this NEVER actuates the relay (the alert is
   * still raised, flagged `stale`). This is what stops a restart after downtime
   * from immobilising a car for a fence it crossed hours ago. An event is
   * normally seen within pollIntervalMs + lookbackOverlapMs (~2.5 min by
   * default), so 10 minutes is a wide margin.
   */
  maxCutEventAgeMs: 10 * 60 * 1000,
  /**
   * A position older than this counts as "speed unknown" for the immediate-cut
   * guard, so a tracker that stopped reporting while the car was moving cannot
   * present a stale `speed: 0` as proof the car is parked.
   */
  maxPositionAgeMs: 3 * 60 * 1000,
  /**
   * Hard floor on how far back a query window may reach. Without this a device
   * whose events endpoint fails persistently would pin the window open and grow
   * every query without bound. Stale events cannot cut (maxCutEventAgeMs), so a
   * wide window can only ever produce late alerts.
   */
  maxLookbackMs: 6 * 3600 * 1000,

  // --- files ---------------------------------------------------------------
  alertsPath: "/var/lib/carva/alerts.jsonl",
  statePath: "/var/lib/carva/automation-state.json",
  /**
   * Roll alerts.jsonl to alerts.jsonl.1 past this size. The audit log lives on
   * the same small VPS as Traccar; letting it grow forever risks filling the
   * disk, which would take the tracking server down with it. 0 disables.
   */
  alertsMaxBytes: 64 * 1024 * 1024,
};

/**
 * Environment overrides. Secrets should come from here (via the systemd
 * EnvironmentFile) rather than living in the config file on disk.
 */
const ENV_MAP = {
  CARVA_ENABLED: ["enabled", "bool"],
  CARVA_TRACCAR_URL: ["traccarUrl", "string"],
  CARVA_TRACCAR_EMAIL: ["email", "string"],
  CARVA_TRACCAR_PASSWORD: ["password", "string"],
  CARVA_POLL_INTERVAL_MS: ["pollIntervalMs", "int"],
  CARVA_LOOKBACK_OVERLAP_MS: ["lookbackOverlapMs", "int"],
  CARVA_REQUEST_TIMEOUT_MS: ["requestTimeoutMs", "int"],
  CARVA_DEBOUNCE_MS: ["debounceMs", "int"],
  CARVA_MAX_CUTS_PER_HOUR: ["maxCutsPerHour", "int"],
  CARVA_MAX_IMMEDIATE_CUT_KMH: ["maxImmediateCutKmh", "number"],
  CARVA_MAX_CUT_EVENT_AGE_MS: ["maxCutEventAgeMs", "int"],
  CARVA_MAX_POSITION_AGE_MS: ["maxPositionAgeMs", "int"],
  CARVA_MAX_LOOKBACK_MS: ["maxLookbackMs", "int"],
  CARVA_ALERTS_PATH: ["alertsPath", "string"],
  CARVA_STATE_PATH: ["statePath", "string"],
  CARVA_ALERTS_MAX_BYTES: ["alertsMaxBytes", "int"],
};

function parseEnvValue(raw, kind) {
  if (kind === "bool") return /^(1|true|yes|on)$/i.test(raw.trim());
  if (kind === "int") {
    const n = Number.parseInt(raw, 10);
    return Number.isFinite(n) ? n : undefined;
  }
  if (kind === "number") {
    const n = Number(raw);
    return Number.isFinite(n) ? n : undefined;
  }
  return raw;
}

/**
 * Load config.json (path from argv[2] or CARVA_AUTOMATION_CONFIG, else
 * ./config.json next to this file), then layer environment overrides on top.
 * A missing config file is not fatal — env-only operation is supported.
 */
function loadConfig() {
  const configPath =
    process.argv[2] ||
    process.env.CARVA_AUTOMATION_CONFIG ||
    path.join(__dirname, "config.json");

  let fileConfig = {};
  let configSource = "none";
  try {
    fileConfig = JSON.parse(fs.readFileSync(configPath, "utf8"));
    if (fileConfig === null || typeof fileConfig !== "object" || Array.isArray(fileConfig)) {
      throw new Error("config root must be a JSON object");
    }
    configSource = configPath;
  } catch (e) {
    if (e && e.code === "ENOENT") {
      configSource = `${configPath} (absent — using defaults + env)`;
    } else {
      // A malformed config is fatal: guessing at safety limits is not acceptable.
      console.error(`[carva] FATAL: cannot read config ${configPath}: ${e.message}`);
      process.exit(2);
    }
  }

  const cfg = { ...DEFAULTS, ...fileConfig };

  for (const [envName, [key, kind]] of Object.entries(ENV_MAP)) {
    const raw = process.env[envName];
    if (raw === undefined || raw === "") continue;
    const parsed = parseEnvValue(raw, kind);
    if (parsed !== undefined) cfg[key] = parsed;
  }

  // --- normalise & clamp, so a typo cannot disable a safety rail ------------
  cfg.traccarUrl = String(cfg.traccarUrl || DEFAULTS.traccarUrl).replace(/\/+$/, "");
  cfg.enabled = cfg.enabled === true;
  cfg.pollIntervalMs = clampInt(cfg.pollIntervalMs, 5000, 3600000, DEFAULTS.pollIntervalMs);
  cfg.lookbackOverlapMs = clampInt(cfg.lookbackOverlapMs, 0, 3600000, DEFAULTS.lookbackOverlapMs);
  cfg.requestTimeoutMs = clampInt(cfg.requestTimeoutMs, 1000, 120000, DEFAULTS.requestTimeoutMs);
  // Debounce has no upper bound worth enforcing, but it may never be disabled.
  cfg.debounceMs = clampInt(cfg.debounceMs, 1000, 24 * 3600 * 1000, DEFAULTS.debounceMs);
  // 0 is a legitimate value: "never cut automatically".
  cfg.maxCutsPerHour = clampInt(cfg.maxCutsPerHour, 0, 1000, DEFAULTS.maxCutsPerHour);
  cfg.maxImmediateCutKmh = clampNumber(cfg.maxImmediateCutKmh, 0, 200, DEFAULTS.maxImmediateCutKmh);
  // The stale-event guard may be widened but never switched off: 60s is the
  // floor, 24h the ceiling. A cut for a day-old crossing is never legitimate.
  cfg.maxCutEventAgeMs = clampInt(cfg.maxCutEventAgeMs, 60000, 24 * 3600 * 1000, DEFAULTS.maxCutEventAgeMs);
  cfg.maxPositionAgeMs = clampInt(cfg.maxPositionAgeMs, 30000, 24 * 3600 * 1000, DEFAULTS.maxPositionAgeMs);
  cfg.maxLookbackMs = clampInt(cfg.maxLookbackMs, 60000, 7 * 24 * 3600 * 1000, DEFAULTS.maxLookbackMs);
  cfg.alertsPath = String(cfg.alertsPath || DEFAULTS.alertsPath);
  cfg.statePath = String(cfg.statePath || DEFAULTS.statePath);
  // Exactly 0 disables rotation; anything else is clamped to a sane file size.
  const rotateBytes = clampInt(cfg.alertsMaxBytes, 0, 8 * 1024 * 1024 * 1024, DEFAULTS.alertsMaxBytes);
  cfg.alertsMaxBytes = rotateBytes === 0 ? 0 : Math.max(rotateBytes, 1024 * 1024);
  cfg.configSource = configSource;

  return cfg;
}

function clampInt(value, min, max, fallback) {
  const n = typeof value === "number" ? Math.round(value) : Number.parseInt(value, 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function clampNumber(value, min, max, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

/* ========================================================================== *
 * SECTION 2 — Geofence rule schema
 *
 * Re-implementation of apps/web/lib/geofence-rules.ts in plain JS. The two MUST
 * stay in lockstep: the web UI writes these objects, this service acts on them.
 * ========================================================================== */

const CATEGORIES = ["zone", "repair", "region", "customer", "base", "restricted"];
const CUT_MODES = ["none", "safe", "now"];
const SEVERITIES = ["info", "warning", "critical"];

/** The key inside the Traccar geofence's `attributes` object. */
const RULES_KEY = "carvaRules";

/** Longest note we keep, mirroring MAX_NOTE_LENGTH in geofence-rules.ts. */
const MAX_NOTE_LENGTH = 200;

/**
 * Default severity per (category, phase). MUST match CATEGORY_SEVERITY in
 * apps/web/lib/geofence-rules.ts — the web app writes these fences and shows
 * these alerts, so a disagreement means the same crossing is labelled two
 * different things in two places.
 *
 * - repair/enter is critical: the car is at a garage, i.e. probably crashed.
 * - restricted/enter is a warning: the car went somewhere it should not be.
 * - base/exit is a warning: the car left the yard, which matters at night.
 * - region/exit is critical: the car left the area it is allowed to drive in.
 */
const CATEGORY_SEVERITY = {
  zone: { enter: "info", exit: "info" },
  repair: { enter: "critical", exit: "info" },
  region: { enter: "info", exit: "critical" },
  customer: { enter: "info", exit: "info" },
  base: { enter: "info", exit: "warning" },
  restricted: { enter: "warning", exit: "info" },
};

/**
 * Severity floor implied by a relay action — cutting a car is never "info".
 * Mirrors CUT_SEVERITY in geofence-rules.ts.
 */
const CUT_SEVERITY = { none: null, safe: "warning", now: "critical" };

const SEVERITY_RANK = { info: 0, warning: 1, critical: 2 };

function defaultSeverity(category, phase) {
  const row = CATEGORY_SEVERITY[category] || CATEGORY_SEVERITY.zone;
  return row[phase] || "info";
}

function maxSeverity(a, b) {
  return SEVERITY_RANK[a] >= SEVERITY_RANK[b] ? a : b;
}

/**
 * The severity an alert actually carries. An explicit severity on the action
 * wins (a human chose it); otherwise the category default applies, raised to at
 * least the level the relay action implies, so a fence that immobilises a car
 * can never be filed as a quiet "info" line. Mirrors effectiveSeverity() in
 * geofence-rules.ts.
 */
function effectiveSeverity(rules, phase) {
  const action = phase === "exit" ? rules.onExit : rules.onEnter;
  if (action.explicitSeverity) return action.severity;
  const base = defaultSeverity(rules.category, phase);
  const implied = CUT_SEVERITY[action.cut];
  return implied ? maxSeverity(base, implied) : base;
}

/**
 * The safe fallback action. Note `cut: "none"` — a rule we could not parse must
 * NEVER be able to immobilise a car.
 */
function defaultAction(category, phase) {
  return {
    notify: true,
    cut: "none",
    severity: defaultSeverity(category, phase),
    /** False means "severity came from a default", so the cut floor may raise it. */
    explicitSeverity: false,
    note: "",
  };
}

function isPlainObject(v) {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

/**
 * Coerce one RuleAction. Anything unrecognised falls back to the safe default
 * for that field; in particular an unknown `cut` value becomes "none".
 */
function readAction(raw, category, phase) {
  const fallback = defaultAction(category, phase);
  if (!isPlainObject(raw)) return fallback;

  const notify = typeof raw.notify === "boolean" ? raw.notify : fallback.notify;

  // *** The single most safety-critical line in this file. ***
  // Only the three exact string literals count; everything else is "none".
  const cut = CUT_MODES.includes(raw.cut) ? raw.cut : "none";

  const explicitSeverity = SEVERITIES.includes(raw.severity);
  const severity = explicitSeverity ? raw.severity : fallback.severity;
  // Trimmed and capped exactly like geofence-rules.ts, so a pasted essay in the
  // Traccar attribute editor cannot bloat every line of the audit log.
  const note = typeof raw.note === "string" ? raw.note.trim().slice(0, MAX_NOTE_LENGTH) : "";

  return { notify, cut, severity, explicitSeverity, note };
}

/**
 * Read a geofence's rules out of its Traccar `attributes` object.
 *
 * Defaults when attributes.carvaRules is absent or malformed:
 *   category "zone", onEnter {notify:true, cut:"none"}, onExit {notify:true, cut:"none"}.
 *
 * @param {object|undefined|null} attributes  the geofence's `attributes`
 * @returns {{version:1, category:string, onEnter:object, onExit:object, malformed:boolean}}
 */
function readRules(attributes) {
  let raw = isPlainObject(attributes) ? attributes[RULES_KEY] : undefined;
  let malformed = false;

  // Traccar's attribute editor can turn a nested object into a JSON string;
  // accept that shape too rather than silently falling back to defaults.
  if (typeof raw === "string") {
    try {
      raw = JSON.parse(raw);
    } catch {
      malformed = true;
      raw = undefined;
    }
  }

  if (raw !== undefined && !isPlainObject(raw)) {
    malformed = true;
    raw = undefined;
  }

  const source = isPlainObject(raw) ? raw : {};
  const category = CATEGORIES.includes(source.category) ? source.category : "zone";

  // Only a category that is PRESENT and unrecognised is malformed. An absent
  // one is just an older/partial rule taking the documented default.
  if (source.category !== undefined && !CATEGORIES.includes(source.category)) malformed = true;

  const rules = {
    version: 1,
    category,
    // "all" = this fence watches every car; see syncFleetFences().
    scope: source.scope === "all" ? "all" : "selected",
    onEnter: readAction(source.onEnter, category, "enter"),
    onExit: readAction(source.onExit, category, "exit"),
    /** Informational only — used to log loudly, never to change behaviour. */
    malformed,
  };

  // Resolve each action's final severity once, here, so every consumer below
  // reads the same value the web app would show for this fence.
  rules.onEnter.severity = effectiveSeverity(rules, "enter");
  rules.onExit.severity = effectiveSeverity(rules, "exit");
  return rules;
}

/* ========================================================================== *
 * SECTION 3 — JT/T 808 0x8500 frame builder
 *
 * Byte-for-byte mirror of apps/web/lib/jt808.ts. Verified on the wire:
 *   uniqueId 019210015362, serial 0x0001, body 0x00 -> 7e85000001019210015362000100367e
 * ========================================================================== */

const MSG_VEHICLE_CONTROL = 0x8500;
const FLAG = 0x7e;
const ESCAPE = 0x7d;

/** 0x7e -> 0x7d 0x02, 0x7d -> 0x7d 0x01, applied between the delimiters. */
function escapePayload(bytes) {
  const out = [];
  for (const b of bytes) {
    if (b === FLAG) out.push(ESCAPE, 0x02);
    else if (b === ESCAPE) out.push(ESCAPE, 0x01);
    else out.push(b);
  }
  return out;
}

/** XOR of every byte from the message id through the body. */
function checksum(bytes) {
  return bytes.reduce((acc, b) => acc ^ b, 0) & 0xff;
}

/** "019210015362" -> [0x01,0x92,0x10,0x01,0x53,0x62]; null if not addressable. */
function bcdTerminalId(uniqueId) {
  const digits = String(uniqueId == null ? "" : uniqueId).trim();
  if (!/^\d{1,12}$/.test(digits)) return null;
  const padded = digits.padStart(12, "0");
  const bytes = [];
  for (let i = 0; i < 12; i += 2) {
    const tens = padded.charCodeAt(i) - 48;
    const ones = padded.charCodeAt(i + 1) - 48;
    bytes.push((tens << 4) | ones);
  }
  return bytes;
}

/**
 * The 0x8500 body byte. Note there is deliberately NO "resume" path anywhere in
 * this service: restoring fuel is always a human decision (safety rule f).
 */
const VEHICLE_CONTROL = {
  cut: 0x01, // cut immediately
  cutSafe: 0x02, // tracker defers the cut until the vehicle is stopped / <20 km/h
};

/** Build the complete escaped frame as a lowercase hex string, or null. */
function buildVehicleControlFrame(uniqueId, mode, serial) {
  const terminal = bcdTerminalId(uniqueId);
  if (!terminal) return null;
  // Own-property lookup only. A plain `VEHICLE_CONTROL[mode]` also resolves
  // inherited members, so a mode of "constructor" or "toString" returned a
  // function instead of undefined and this built a frame with a stringified
  // function in the body rather than refusing. Verified before the fix:
  // buildVehicleControlFrame(id, "constructor") produced
  // "7e8500...function Object() { [native code] }367e".
  const bodyByte = Object.prototype.hasOwnProperty.call(VEHICLE_CONTROL, mode)
    ? VEHICLE_CONTROL[mode]
    : undefined;
  if (typeof bodyByte !== "number") return null;

  const body = [bodyByte];
  const properties = body.length & 0x03ff; // no encryption, no packeting
  const seq = (serial || 1) & 0xffff;

  const header = [
    (MSG_VEHICLE_CONTROL >> 8) & 0xff,
    MSG_VEHICLE_CONTROL & 0xff,
    (properties >> 8) & 0xff,
    properties & 0xff,
    ...terminal,
    (seq >> 8) & 0xff,
    seq & 0xff,
  ];

  const payload = [...header, ...body];
  const framed = [...payload, checksum(payload)];
  return [FLAG, ...escapePayload(framed), FLAG]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** Protocols that need the hand-built frame instead of Traccar's own encoder. */
function needsRawVehicleControl(protocol) {
  if (!protocol) return false;
  const p = String(protocol).toLowerCase();
  return p === "jt808" || p === "huabao";
}

/** Traccar reports speed in knots everywhere in its API. */
function knotsToKmh(knots) {
  return knots * 1.852;
}

/**
 * Tolerance for an event stamped slightly ahead of our clock. Matches the
 * forward buffer on the query window below.
 */
const MAX_EVENT_CLOCK_SKEW_MS = 60000;

/**
 * Age of a crossing in ms, as the stale-cut guard (rail i) must see it.
 *
 * Returns Infinity — i.e. "old enough that the relay must not fire" — whenever
 * the age cannot be trusted:
 *   - eventTime missing or unparsable, and
 *   - eventTime stamped in the FUTURE beyond the skew tolerance.
 *
 * The future case is the dangerous one and is why this is not a plain
 * subtraction. `eventTime` on a geofence event comes from the POSITION, i.e.
 * from the tracker's own clock. A tracker whose RTC is set days ahead — which
 * happens after a battery pull, and this fleet already has trackers with bad
 * clocks — uploads its buffered crossings on reconnect stamped in the future.
 * A signed `now - eventTime` is then large and NEGATIVE, sails under the
 * `> maxCutEventAgeMs` comparison, and the relay fires for a crossing that
 * really happened days ago, immobilising a car that is on the road right now.
 * Verified: an event stamped +3 days produced eventAgeMs -259198806 and a live
 * immediate cut. Unknown age must fail closed, exactly like unknown speed.
 */
function cutGuardAgeMs(eventTime, now) {
  const stamped = Date.parse(eventTime || "");
  if (!Number.isFinite(stamped)) return Infinity;
  const age = now - stamped;
  if (age < -MAX_EVENT_CLOCK_SKEW_MS) return Infinity;
  return Math.max(0, age);
}

/* ========================================================================== *
 * SECTION 4 — Logging (stdout/journal) and the append-only JSONL audit log
 * ========================================================================== */

let CONFIG = null; // set in main(); used by the audit writer

/** Human-readable line for the systemd journal. */
function log(level, message, fields) {
  const stamp = new Date().toISOString();
  let line = `[carva] ${stamp} ${level.toUpperCase()} ${message}`;
  if (fields && Object.keys(fields).length > 0) {
    line += ` ${JSON.stringify(fields)}`;
  }
  if (level === "error" || level === "warn") console.error(line);
  else console.log(line);
}

/**
 * Append one record to the JSONL audit log. Best-effort: a failure here is
 * logged to the journal but never propagates, so a full disk cannot stop the
 * loop or block a safety decision.
 */
async function audit(record) {
  const line = `${JSON.stringify(record)}\n`;
  try {
    await fsp.mkdir(path.dirname(CONFIG.alertsPath), { recursive: true });
    await rotateAlertsIfNeeded(line.length);
    await fsp.appendFile(CONFIG.alertsPath, line, "utf8");
  } catch (e) {
    log("error", "audit_write_failed", { path: CONFIG.alertsPath, error: e.message });
  }
}

/**
 * Keep alerts.jsonl bounded by rolling it to `.1` (one generation, previous one
 * discarded).
 *
 * This service shares a small VPS with Traccar itself, so an audit log that
 * grows without limit does not merely lose alerts when the disk fills — it
 * takes the tracking server down with it. Self-contained on purpose: the README
 * suggests a logrotate stanza, but nothing installs it, and a safety-critical
 * service should not depend on an operator remembering.
 */
async function rotateAlertsIfNeeded(incomingBytes) {
  if (!CONFIG.alertsMaxBytes) return;
  let size = 0;
  try {
    size = (await fsp.stat(CONFIG.alertsPath)).size;
  } catch (e) {
    if (e && e.code === "ENOENT") return; // nothing to roll yet
    throw e;
  }
  if (size + incomingBytes <= CONFIG.alertsMaxBytes) return;
  const rolled = `${CONFIG.alertsPath}.1`;
  await fsp.rm(rolled, { force: true });
  await fsp.rename(CONFIG.alertsPath, rolled);
  log("warn", "alerts_log_rotated", { path: CONFIG.alertsPath, bytes: size, rolledTo: rolled });
}

/* ========================================================================== *
 * SECTION 5 — Persistent state (watermark, debounce, rate limit)
 * ========================================================================== */

function emptyState() {
  return {
    /** Set once the first ever poll has established a starting point. */
    initialised: false,
    /** Highest event id we have processed. */
    lastEventId: 0,
    /** eventTime of the newest processed event, ISO 8601. */
    lastEventTime: null,
    /** Recently processed event ids, newest last — guards the overlap window. */
    seenEventIds: [],
    /** "deviceId:geofenceId:phase" -> epoch ms of the last time we acted. */
    debounce: {},
    /** Epoch ms of every cut command actually sent, for the rolling rate limit. */
    cutTimestamps: [],
  };
}

/** How many recent event ids to remember. Comfortably larger than any overlap. */
const SEEN_IDS_MAX = 2000;

async function loadState(statePath) {
  try {
    const parsed = JSON.parse(await fsp.readFile(statePath, "utf8"));
    const state = { ...emptyState(), ...parsed };
    // Re-validate every field: a hand-edited or truncated state file must not
    // be able to unlock actions we would otherwise suppress.
    state.initialised = state.initialised === true;
    state.lastEventId = Number.isFinite(state.lastEventId) ? state.lastEventId : 0;
    // A watermark in the FUTURE (clock jump, a tracker with a bad RTC, a
    // hand-edited file) would put every query window ahead of real time and
    // silently drop every event until the wall clock caught up. The watermark
    // only ever moves forward at runtime, so it cannot heal itself — clamp it
    // to "now" here, on the way in.
    const parsedTime =
      typeof state.lastEventTime === "string" ? Date.parse(state.lastEventTime) : NaN;
    if (!Number.isFinite(parsedTime)) {
      state.lastEventTime = null;
    } else if (parsedTime > Date.now()) {
      log("warn", "state_watermark_in_future_clamped", {
        stored: state.lastEventTime,
        clampedTo: new Date().toISOString(),
      });
      state.lastEventTime = new Date().toISOString();
    }
    state.seenEventIds = Array.isArray(state.seenEventIds)
      ? state.seenEventIds.filter((n) => Number.isFinite(n)).slice(-SEEN_IDS_MAX)
      : [];
    state.debounce = isPlainObject(state.debounce) ? state.debounce : {};
    state.cutTimestamps = Array.isArray(state.cutTimestamps)
      ? state.cutTimestamps.filter((n) => Number.isFinite(n))
      : [];
    return state;
  } catch (e) {
    if (e && e.code === "ENOENT") {
      log("info", "state_file_absent_first_run", { path: statePath });
      return emptyState();
    }
    // A corrupt state file is dangerous in the other direction too: starting
    // from scratch means the next poll re-arms the watermark WITHOUT acting on
    // history (see the `initialised` guard), which is the safe outcome.
    log("error", "state_file_unreadable_restarting_clean", {
      path: statePath,
      error: e.message,
    });
    return emptyState();
  }
}

/** Write atomically (tmp + rename) so a crash mid-write cannot corrupt state. */
async function saveState(statePath, state) {
  const tmp = `${statePath}.tmp`;
  try {
    await fsp.mkdir(path.dirname(statePath), { recursive: true });
    await fsp.writeFile(tmp, JSON.stringify(state, null, 2), "utf8");
    await fsp.rename(tmp, statePath);
  } catch (e) {
    // Losing the watermark means the next restart re-arms rather than replays,
    // so this is loud but not fatal.
    log("error", "state_write_failed", { path: statePath, error: e.message });
  }
}

/* ========================================================================== *
 * SECTION 6 — Traccar client (cookie session, auto re-auth on 401)
 * ========================================================================== */

class Traccar {
  constructor(cfg) {
    this.cfg = cfg;
    this.cookie = null;
    /** In-flight login, so concurrent callers share one /api/session round-trip. */
    this.loginPromise = null;
  }

  /** Single-flight wrapper: parallel requests must not each open a session. */
  async ensureSession() {
    if (this.cookie) return;
    if (!this.loginPromise) {
      this.loginPromise = this.login().finally(() => {
        this.loginPromise = null;
      });
    }
    await this.loginPromise;
  }

  /** POST /api/session with form fields; keep the JSESSIONID cookie. */
  async login() {
    const body = new URLSearchParams({
      email: this.cfg.email,
      password: this.cfg.password,
    });
    const { res, text } = await this.rawFetch("/api/session", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
      },
      body,
    });
    if (!res.ok) {
      // `text` is Traccar's response, never our request body — the password
      // cannot reach the journal through here.
      throw new Error(`traccar login failed: ${res.status} ${text.slice(0, 200)}`);
    }
    const setCookie = res.headers.getSetCookie
      ? res.headers.getSetCookie()
      : [res.headers.get("set-cookie")].filter(Boolean);
    const jsession = setCookie
      .map((c) => /JSESSIONID=([^;]+)/.exec(c))
      .find(Boolean);
    if (!jsession) throw new Error("traccar login returned no JSESSIONID cookie");
    this.cookie = `JSESSIONID=${jsession[1]}`;
    log("info", "traccar_session_established", { url: this.cfg.traccarUrl });
  }

  /**
   * fetch with an absolute URL and a hard timeout that covers the RESPONSE BODY
   * as well as the headers.
   *
   * This must stay one timer spanning both steps. `fetch` resolves as soon as
   * the headers arrive, so a timer cleared at that point leaves the body read
   * unbounded: a half-open socket or a wedged Traccar then hangs the poll loop
   * forever, with the process still "running" as far as systemd is concerned —
   * no restart, no alerts, no cuts, and nothing in the journal saying so.
   * Every caller needs the full body anyway, so it is read here.
   *
   * @returns {{res: Response, text: string}}
   */
  async rawFetch(pathname, init) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.cfg.requestTimeoutMs);
    try {
      const res = await fetch(`${this.cfg.traccarUrl}${pathname}`, {
        ...init,
        signal: controller.signal,
      });
      let text;
      try {
        text = await res.text();
      } catch (e) {
        // An abort mid-body lands here; surface it as a timeout, not as an
        // empty (and therefore silently "successful") response.
        throw new Error(
          `${pathname} -> response body read failed after ${this.cfg.requestTimeoutMs}ms: ${e.message}`,
        );
      }
      return { res, text };
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Authenticated JSON request. Re-authenticates once on 401 and retries, so a
   * server restart or session expiry does not need a service restart.
   *
   * `Accept: application/json` is always sent — Traccar answers report
   * endpoints with an XLSX binary otherwise.
   */
  async json(pathname, init = {}, retry = true) {
    await this.ensureSession();

    const headers = {
      Accept: "application/json",
      Cookie: this.cookie,
      ...(init.headers || {}),
    };
    const { res, text } = await this.rawFetch(pathname, { ...init, headers });

    if (res.status === 401 && retry) {
      log("warn", "traccar_session_expired_reauthenticating", { path: pathname });
      this.cookie = null;
      return this.json(pathname, init, false);
    }
    if (!res.ok) {
      const err = new Error(`${pathname} -> ${res.status} ${text.slice(0, 300)}`);
      err.status = res.status;
      throw err;
    }

    if (!text) return null;
    try {
      return JSON.parse(text);
    } catch {
      // Almost always means Accept negotiation failed and we got a spreadsheet.
      throw new Error(`${pathname} -> non-JSON response (${text.length} bytes)`);
    }
  }

  getGeofences() {
    return this.json("/api/geofences");
  }

  getDevices() {
    return this.json("/api/devices");
  }

  /** Latest known position for one device (array, possibly empty). */
  getLatestPosition(deviceId) {
    return this.json(`/api/positions?deviceId=${encodeURIComponent(deviceId)}`);
  }

  /** Events for one device in a window. Accept: application/json is mandatory. */
  getEvents(deviceId, fromIso, toIso) {
    const qs = new URLSearchParams({
      deviceId: String(deviceId),
      from: fromIso,
      to: toIso,
    });
    return this.json(`/api/reports/events?${qs.toString()}`);
  }

  /** POST /api/commands/send — the only write this service ever performs. */
  async sendCommand(payload) {
    await this.ensureSession();
    const { res, text } = await this.rawFetch("/api/commands/send", {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        Cookie: this.cookie,
      },
      body: JSON.stringify(payload),
    });
    if (res.status === 401) {
      // Deliberately NOT retried automatically: a cut command must be sent at
      // most once per decision. Re-auth now so the next poll succeeds.
      this.cookie = null;
      throw new Error("commands/send unauthorised (session refreshed, not retried)");
    }
    if (!res.ok) {
      throw new Error(`commands/send -> ${res.status} ${text.slice(0, 300)}`);
    }
    // 200 = delivered now, 202 = queued until the tracker reconnects.
    return { status: res.status, queued: res.status === 202 };
  }
}

/* ========================================================================== *
 * SECTION 7 — Safety rails
 * ========================================================================== */

/**
 * Is this a real run or a dry run?
 *
 * Two independent switches, both of which must permit action:
 *   1. config.enabled must be exactly true (defaults to false).
 *   2. CARVA_AUTOMATION_DISABLE=1 in the environment forces dry-run regardless.
 */
function isDryRun(cfg) {
  if (/^(1|true|yes|on)$/i.test(String(process.env.CARVA_AUTOMATION_DISABLE || ""))) {
    return { dryRun: true, reason: "env CARVA_AUTOMATION_DISABLE" };
  }
  if (cfg.enabled !== true) {
    return { dryRun: true, reason: "config.enabled is not true" };
  }
  return { dryRun: false, reason: null };
}

function debounceKey(deviceId, geofenceId, phase) {
  return `${deviceId}:${geofenceId}:${phase}`;
}

/**
 * Rolling-hour rate limiter over cut commands, fleet-wide. Only commands we
 * actually sent are counted; dry runs and refusals are not.
 */
function cutBudgetRemaining(state, cfg, now) {
  const cutoff = now - 3600000;
  state.cutTimestamps = state.cutTimestamps.filter((t) => t > cutoff);
  return cfg.maxCutsPerHour - state.cutTimestamps.length;
}

/** Drop debounce entries far older than the window so state cannot grow forever. */
function pruneDebounce(state, cfg, now) {
  const cutoff = now - Math.max(cfg.debounceMs * 4, 3600000);
  for (const [key, ts] of Object.entries(state.debounce)) {
    if (!Number.isFinite(ts) || ts < cutoff) delete state.debounce[key];
  }
}

/* ========================================================================== *
 * SECTION 8 — Acting on one event
 * ========================================================================== */

/**
 * Resolve everything we need to know about a device before touching its relay:
 * its uniqueId, the protocol its last position arrived on, and its current
 * speed in km/h.
 *
 * Returns speedKmh: null when unknown. Unknown speed is treated as "possibly
 * moving" by the caller — we never assume a car is stopped.
 */
async function describeDevice(traccar, device, cfg) {
  let protocol = null;
  let speedKmh = null;
  let blocked = null;
  let positionAgeMs = null;
  let staleFix = false;
  /** Set when we could not ASK; distinct from "asked, device has no position". */
  let positionError = null;
  try {
    const positions = await traccar.getLatestPosition(device.id);
    const p = Array.isArray(positions) ? positions[0] : null;
    if (p) {
      protocol = p.protocol || null;
      if (isPlainObject(p.attributes) && typeof p.attributes.blocked === "boolean") {
        blocked = p.attributes.blocked;
      }

      // How old is this fix? A tracker that dropped off the network while the
      // car was moving keeps reporting its LAST speed forever, so a stale
      // `speed: 0` is indistinguishable from a genuinely parked car unless we
      // check the age. Prefer fixTime (when the GPS saw it) over deviceTime.
      const stamp = Date.parse(p.fixTime || p.deviceTime || p.serverTime || "");
      positionAgeMs = Number.isFinite(stamp) ? Math.max(0, Date.now() - stamp) : null;
      staleFix = positionAgeMs === null || positionAgeMs > cfg.maxPositionAgeMs;

      // Speed is only trusted from a fresh fix. Anything else stays null, which
      // the caller reads as "cannot prove the car is stopped".
      if (!staleFix && Number.isFinite(p.speed)) speedKmh = knotsToKmh(p.speed);
    }
  } catch (e) {
    positionError = e.message;
    log("warn", "position_lookup_failed", { deviceId: device.id, error: e.message });
  }
  return { protocol, speedKmh, blocked, positionAgeMs, staleFix, positionError };
}

/**
 * Perform the `cut` half of a rule. Returns a result object that is logged and
 * audited by the caller; it never throws.
 */
async function performCut(ctx, event, device, fence, rules, action, phase, guardAgeMs) {
  const { traccar, cfg, state, dryRunInfo } = ctx;
  const now = Date.now();

  // --- (b) never act on a "none" rule --------------------------------------
  if (action.cut === "none") return null;

  const base = {
    requested: action.cut,
    deviceId: device.id,
    deviceName: device.name,
    uniqueId: device.uniqueId,
    geofenceId: fence.id,
    geofenceName: fence.name,
    phase,
  };

  // --- (i) NEVER actuate on a stale crossing -------------------------------
  // The relay acts on the car as it is NOW, not as it was when the fence was
  // crossed. Restarting after downtime re-queries every event since the stored
  // watermark, so without this guard a service that was stopped for three hours
  // would come back up and immobilise a car for a fence it left long ago — with
  // the customer mid-journey.
  //
  // The age is recomputed here rather than trusted from the caller: this is the
  // last gate in front of the relay, and it must fail closed on its own. An
  // unparsable OR future-stamped eventTime counts as stale (see cutGuardAgeMs).
  const ageMs = Math.min(
    Number.isFinite(guardAgeMs) && guardAgeMs >= 0 ? guardAgeMs : Infinity,
    cutGuardAgeMs(event.eventTime, now),
  );
  if (ageMs > cfg.maxCutEventAgeMs) {
    log("error", "CUT_REFUSED_EVENT_TOO_OLD", {
      ...base,
      eventId: event.id,
      eventTime: event.eventTime || null,
      eventAgeMs: Number.isFinite(ageMs) ? Math.round(ageMs) : "unknown",
      maxCutEventAgeMs: cfg.maxCutEventAgeMs,
    });
    return {
      ...base,
      outcome: "refused",
      reason: "event_too_old",
      eventAgeMs: Number.isFinite(ageMs) ? Math.round(ageMs) : null,
    };
  }

  // --- device capability ---------------------------------------------------
  const info = await describeDevice(traccar, device, cfg);

  // A positions request that FAILED tells us nothing about the car — not its
  // protocol and not its speed. Refusing it as "unsupported_protocol" made a
  // transient network blip look identical in the audit log to a device that has
  // no relay at all, hiding the fact that a rule silently did not fire.
  if (info.positionError) {
    return {
      ...base,
      outcome: "refused",
      reason: "position_lookup_failed",
      error: info.positionError,
    };
  }

  if (!needsRawVehicleControl(info.protocol)) {
    // Every tracker in this fleet is jt808/MV930G. Anything else has an
    // unverified relay path, and guessing is not acceptable for a kill switch.
    return {
      ...base,
      outcome: "refused",
      reason: "unsupported_protocol",
      protocol: info.protocol,
    };
  }

  // --- (e) speed guard: never immobilise a moving vehicle ------------------
  let mode = action.cut === "now" ? "cut" : "cutSafe";
  let downgraded = false;
  if (action.cut === "now") {
    // Unknown speed counts as "too fast" — we cannot prove the car is stopped.
    // `speedKmh` is already null when the fix is too old to trust (see
    // describeDevice), so a tracker that went offline at speed cannot present
    // its last reported 0 as evidence the car is parked.
    const tooFast = info.speedKmh === null || info.speedKmh > cfg.maxImmediateCutKmh;
    if (tooFast) {
      mode = "cutSafe";
      downgraded = true;
      log("warn", "IMMEDIATE_CUT_DOWNGRADED_TO_SAFE", {
        ...base,
        reason: info.staleFix ? "position_too_old" : info.speedKmh === null ? "speed_unknown" : "moving",
        speedKmh: info.speedKmh === null ? "unknown" : Math.round(info.speedKmh),
        positionAgeMs: info.positionAgeMs === null ? "unknown" : Math.round(info.positionAgeMs),
        thresholdKmh: cfg.maxImmediateCutKmh,
      });
    }
  }

  const frame = buildVehicleControlFrame(device.uniqueId, mode, now & 0xffff);
  if (!frame) {
    return {
      ...base,
      outcome: "refused",
      reason: "unaddressable_unique_id",
      protocol: info.protocol,
    };
  }

  const detail = {
    ...base,
    mode,
    downgraded,
    frame,
    protocol: info.protocol,
    speedKmh: info.speedKmh === null ? null : Math.round(info.speedKmh),
    positionAgeMs: info.positionAgeMs === null ? null : Math.round(info.positionAgeMs),
    staleFix: info.staleFix,
    eventAgeMs: Math.round(ageMs),
    alreadyBlocked: info.blocked,
  };

  // --- (a) dry run: say exactly what would have happened, send nothing -----
  if (dryRunInfo.dryRun) {
    log("info", "DRY_RUN_would_send_cut", { ...detail, reason: dryRunInfo.reason });
    return { ...detail, outcome: "dry_run", reason: dryRunInfo.reason };
  }

  // --- (d) fleet-wide rolling-hour budget ----------------------------------
  const remaining = cutBudgetRemaining(state, cfg, now);
  if (remaining <= 0) {
    log("error", "CUT_RATE_LIMIT_EXCEEDED_REFUSING", {
      ...detail,
      maxCutsPerHour: cfg.maxCutsPerHour,
      sentLastHour: state.cutTimestamps.length,
    });
    return { ...detail, outcome: "refused", reason: "rate_limit" };
  }

  // --- send ----------------------------------------------------------------
  // Record the spend BEFORE the request, and FLUSH IT TO DISK before the
  // request. If the POST times out we cannot know whether Traccar queued it, so
  // it must count against the budget either way — and if the process dies
  // during the POST, the budget must still remember on restart that a command
  // may already be in flight. An in-memory-only spend was invisible to the next
  // process and let a crash-restart cycle exceed maxCutsPerHour.
  state.cutTimestamps.push(now);
  await saveState(cfg.statePath, state);
  try {
    const res = await traccar.sendCommand({
      deviceId: device.id,
      type: "custom",
      attributes: { data: frame },
    });
    log("warn", "CUT_COMMAND_SENT", { ...detail, httpStatus: res.status, queued: res.queued });
    return { ...detail, outcome: "sent", queued: res.queued, httpStatus: res.status };
  } catch (e) {
    log("error", "cut_command_failed", { ...detail, error: e.message });
    return { ...detail, outcome: "failed", error: e.message };
  }
}

/**
 * Handle one geofenceEnter / geofenceExit event end to end.
 * Never throws — every failure becomes a logged + audited record.
 */
async function handleEvent(ctx, event, devicesById, fencesById) {
  const { cfg, state, dryRunInfo } = ctx;
  const now = Date.now();
  const phase = event.type === "geofenceEnter" ? "enter" : "exit";

  const device = devicesById.get(event.deviceId);
  const fence = fencesById.get(event.geofenceId);

  if (!fence) {
    // The fence was deleted between the event and this poll, or the event has
    // no geofenceId. Nothing to apply; record it so the gap is visible.
    log("warn", "event_fence_unknown", {
      eventId: event.id,
      deviceId: event.deviceId,
      geofenceId: event.geofenceId,
    });
    return;
  }

  const rules = readRules(fence.attributes);
  if (rules.malformed) {
    log("warn", "geofence_rules_malformed_using_safe_defaults", {
      geofenceId: fence.id,
      geofenceName: fence.name,
    });
  }

  const action = phase === "enter" ? rules.onEnter : rules.onExit;

  // Nothing to do at all — skip before spending a debounce slot.
  if (!action.notify && action.cut === "none") return;

  // How long ago did this crossing actually happen?
  //
  // Two different numbers on purpose:
  //  - `reportedAgeMs` is the raw signed difference, recorded on the alert so a
  //    tracker with a skewed clock is visible to an operator (it can be negative).
  //  - `guardAgeMs` is what the relay is allowed to act on: unparsable and
  //    future-stamped times both collapse to Infinity, i.e. "never cut".
  const eventMs = Date.parse(event.eventTime || "");
  const reportedAgeMs = Number.isFinite(eventMs) ? now - eventMs : null;
  const guardAgeMs = cutGuardAgeMs(event.eventTime, now);
  const staleForCut = guardAgeMs > cfg.maxCutEventAgeMs;

  // --- (c) debounce per (device, fence, phase) -----------------------------
  const key = debounceKey(event.deviceId, fence.id, phase);
  const last = state.debounce[key];
  if (Number.isFinite(last) && now - last < cfg.debounceMs) {
    log("info", "debounced", {
      eventId: event.id,
      key,
      sinceMs: now - last,
      debounceMs: cfg.debounceMs,
    });
    return;
  }
  state.debounce[key] = now;

  const deviceName = device ? device.name : `device ${event.deviceId}`;

  // --- notify --------------------------------------------------------------
  // The alert record shape is the contract with the web app. Extra keys are
  // additive; the ten below must always be present.
  if (action.notify) {
    const alert = {
      ts: event.eventTime || new Date(now).toISOString(),
      eventId: event.id,
      type: event.type,
      deviceId: event.deviceId,
      deviceName,
      geofenceId: fence.id,
      geofenceName: fence.name,
      category: rules.category,
      severity: action.severity,
      note: action.note || "",
      // --- additive metadata ---
      kind: "alert",
      loggedAt: new Date(now).toISOString(),
      plannedCut: action.cut,
      dryRun: dryRunInfo.dryRun,
      // A crossing old enough that the relay was suppressed. The alert is still
      // raised — a late notification is useful, a late immobilisation is not.
      eventAgeMs: reportedAgeMs === null ? null : Math.round(reportedAgeMs),
      stale: staleForCut,
    };
    await audit(alert);
    log(action.severity === "critical" ? "warn" : "info", "alert", {
      eventId: event.id,
      device: deviceName,
      fence: fence.name,
      category: rules.category,
      severity: action.severity,
      phase,
      stale: staleForCut,
    });
  }

  // --- cut -----------------------------------------------------------------
  if (action.cut !== "none") {
    // Make the debounce claim DURABLE before the relay command goes out.
    //
    // It used to live in memory until the end-of-event save, so a crash between
    // the claim and the POST (systemd restart, OOM kill, the withDeadline exit)
    // left no trace on disk: the next poll re-fetched the same event, found no
    // debounce entry and no seen-id, and sent the relay command a SECOND time.
    // Persisting the decision before the side effect is what makes "a crash
    // mid-batch cannot re-fire a command" actually true.
    //
    // This sits AFTER the notify block on purpose. Everything before the flush
    // is replayed after a crash, so the alert lands on the safe side of that
    // line — a duplicate alert is harmless, a lost accident alert is not, and a
    // repeated fuel cut is worse than both.
    await saveState(cfg.statePath, state);

    if (!device) {
      log("error", "cut_refused_unknown_device", {
        eventId: event.id,
        deviceId: event.deviceId,
      });
      await audit({
        kind: "action",
        ts: new Date(now).toISOString(),
        eventId: event.id,
        outcome: "refused",
        reason: "unknown_device",
        deviceId: event.deviceId,
        geofenceId: fence.id,
      });
      return;
    }

    let result;
    try {
      result = await performCut(ctx, event, device, fence, rules, action, phase, guardAgeMs);
    } catch (e) {
      // performCut is written not to throw; this is belt and braces (rule g).
      result = { outcome: "failed", error: e.message, deviceId: device.id };
      log("error", "cut_unexpected_exception", { eventId: event.id, error: e.message });
    }

    if (result) {
      await audit({
        kind: "action",
        ts: new Date(now).toISOString(),
        eventId: event.id,
        type: event.type,
        category: rules.category,
        severity: action.severity,
        ...result,
      });
    }
  }
}

/* ========================================================================== *
 * SECTION 9 — The poll loop
 * ========================================================================== */

/** Only these two event types carry geofence rules. */
const GEOFENCE_EVENTS = new Set(["geofenceEnter", "geofenceExit"]);

/**
 * Move the time watermark to `candidateMs`, but only ever forwards and never
 * into the future.
 *
 * Monotonic because a watermark that slides backwards silently widens every
 * later query window. Capped at `now` because Traccar's clock is not ours: one
 * event stamped in the future (skew, or a tracker with a bad RTC) would
 * otherwise park the watermark ahead of real time, and every genuine event
 * until the wall clock caught up would fall outside the window and be lost.
 */
function advanceEventTime(state, candidateMs, now) {
  if (!Number.isFinite(candidateMs)) return;
  const capped = Math.min(candidateMs, now);
  const prev = state.lastEventTime ? Date.parse(state.lastEventTime) : 0;
  const prevMs = Number.isFinite(prev) ? prev : 0;
  if (capped > prevMs) state.lastEventTime = new Date(capped).toISOString();
}

async function pollOnce(ctx) {
  const { traccar, cfg, state } = ctx;
  const now = Date.now();

  pruneDebounce(state, cfg, now);
  cutBudgetRemaining(state, cfg, now); // side effect: prunes expired timestamps

  // --- fetch the world -----------------------------------------------------
  const [geofences, devices] = await Promise.all([
    traccar.getGeofences(),
    traccar.getDevices(),
  ]);

  // A geofence list we did not actually receive must fail the whole poll, not
  // degrade quietly. Coercing a non-array to [] left every crossing resolving to
  // `event_fence_unknown` — and those events were still marked seen and
  // watermarked, so the crossings were consumed and lost for good. Verified:
  // an empty 200 body from /api/geofences swallowed a geofenceEnter with a
  // single warn line and no alert, ever. Throwing here means pollOnce aborts
  // before the event loop, so nothing is consumed and the next poll retries.
  if (!Array.isArray(geofences)) {
    throw new Error(
      `/api/geofences did not return an array (got ${geofences === null ? "null" : typeof geofences}) — holding watermark`,
    );
  }

  const fencesById = new Map();
  for (const f of geofences) {
    if (f && Number.isFinite(f.id)) fencesById.set(f.id, f);
  }
  const devicesById = new Map();
  for (const d of Array.isArray(devices) ? devices : []) {
    if (d && Number.isFinite(d.id)) devicesById.set(d.id, d);
  }

  if (devicesById.size === 0) {
    log("warn", "no_devices_returned");
    return;
  }

  // --- window --------------------------------------------------------------
  // Query from the watermark minus a deliberate overlap; the seen-id set below
  // is what actually prevents double-firing.
  const toIso = new Date(now + 60000).toISOString(); // small forward buffer for clock skew
  const rawFromMs = state.lastEventTime
    ? Date.parse(state.lastEventTime) - cfg.lookbackOverlapMs
    : now - cfg.lookbackOverlapMs;
  // Floor the window. A watermark far in the past — after downtime, a clock
  // jump, or a device whose events endpoint has been failing for hours — would
  // otherwise make every poll re-query an ever-growing span. Nothing that falls
  // outside this can cut (maxCutEventAgeMs), so the floor only ever costs late
  // alerts, never safety.
  // Also never let `from` run past `now`: an empty window that can only ever
  // return nothing would stall the service silently.
  const floorMs = now - cfg.maxLookbackMs;
  const fromMs = Math.min(Math.max(rawFromMs, floorMs), now);
  if (rawFromMs < floorMs) {
    log("warn", "lookback_window_clamped", {
      requestedFrom: new Date(rawFromMs).toISOString(),
      clampedFrom: new Date(fromMs).toISOString(),
      maxLookbackMs: cfg.maxLookbackMs,
    });
  }
  const fromIso = new Date(fromMs).toISOString();

  const seen = new Set(state.seenEventIds);

  // --- collect events per device ------------------------------------------
  // Devices are polled sequentially and independently: a device whose fetch
  // fails simply contributes nothing this round, and the watermark is not
  // advanced past anything we never saw (rule g).
  const fresh = [];
  let fetchFailures = 0;

  for (const device of devicesById.values()) {
    let events;
    try {
      events = await traccar.getEvents(device.id, fromIso, toIso);
    } catch (e) {
      fetchFailures += 1;
      log("warn", "events_fetch_failed", { deviceId: device.id, error: e.message });
      continue;
    }
    // A 200 whose body is empty or not a list is NOT an empty result — it is a
    // window we never read. Treating it as "no events" left fetchFailures at 0,
    // so the poll counted as complete and the watermark advanced straight past
    // that device's unread crossings, losing them silently. Count it as a
    // failure so the watermark is held and the window is re-queried.
    if (!Array.isArray(events)) {
      fetchFailures += 1;
      log("warn", "events_response_not_a_list", {
        deviceId: device.id,
        got: events === null ? "null" : typeof events,
      });
      continue;
    }

    for (const ev of events) {
      if (!ev || !Number.isFinite(ev.id)) continue;
      if (seen.has(ev.id)) continue;
      if (ev.id <= state.lastEventId) {
        // Older than the watermark and not in the (bounded) seen set: it was
        // processed in a previous life of this service. Do not replay it.
        continue;
      }
      fresh.push(ev);
    }
  }

  // Deduplicate (Traccar can return the same event for overlapping queries) and
  // process in chronological order so debounce behaves sensibly.
  const unique = new Map();
  for (const ev of fresh) unique.set(ev.id, ev);
  const ordered = [...unique.values()].sort((a, b) => {
    const ta = Date.parse(a.eventTime || 0) || 0;
    const tb = Date.parse(b.eventTime || 0) || 0;
    return ta === tb ? a.id - b.id : ta - tb;
  });

  // --- first ever run: arm the watermark, act on nothing -------------------
  if (!state.initialised) {
    state.initialised = true;
    for (const ev of ordered) {
      state.lastEventId = Math.max(state.lastEventId, ev.id);
      state.seenEventIds.push(ev.id);
    }
    state.lastEventTime = new Date(now).toISOString();
    state.seenEventIds = state.seenEventIds.slice(-SEEN_IDS_MAX);
    log("info", "first_run_watermark_armed_no_actions_taken", {
      lastEventId: state.lastEventId,
      skipped: ordered.length,
    });
    await saveState(cfg.statePath, state);
    return;
  }

  if (ordered.length === 0) {
    if (fetchFailures === 0) {
      // Nothing new; nudge the time watermark forward so the query window does
      // not creep backwards forever. Monotonic on purpose — the old code
      // assigned `now - lookbackOverlapMs` unconditionally, which moved the
      // watermark BACKWARDS whenever the last real event was newer than that,
      // silently widening every later window. Event ids are untouched.
      advanceEventTime(state, now - cfg.lookbackOverlapMs, now);
      await saveState(cfg.statePath, state);
    }
    return;
  }

  // A poll where some device's events could not be fetched has NOT covered its
  // window. Advancing the watermark now would move the next window past that
  // device's unread events and lose them for good, so both watermarks are held
  // until a clean poll. Nothing is replayed meanwhile: every processed id still
  // goes into seenEventIds, which is what actually suppresses duplicates.
  const pollComplete = fetchFailures === 0;
  if (!pollComplete) {
    log("warn", "watermark_held_incomplete_poll", {
      fetchFailures,
      devices: devicesById.size,
    });
  }

  log("info", "processing_events", { count: ordered.length, fetchFailures });

  // --- act -----------------------------------------------------------------
  // The coarse watermarks are accumulated here and committed only after the
  // WHOLE batch is done (see below). Advancing them per event stranded any
  // event whose id was lower than one already processed — which happens
  // routinely, because `ordered` is sorted by eventTime while ids are assigned
  // on insert, so a tracker uploading buffered positions after a reconnect
  // produces a later eventTime with a lower id. Processing id 900 first wrote
  // lastEventId=900 to disk; a restart before id 880 was reached then rejected
  // 880 as "older than the watermark" and dropped it with no log line at all.
  // Verified: state after a mid-batch kill was {lastEventId:900, seen:[900]} and
  // event 880 never produced an alert on restart.
  let batchMaxId = state.lastEventId;
  let batchMaxTime = -Infinity;

  for (const ev of ordered) {
    try {
      if (GEOFENCE_EVENTS.has(ev.type)) {
        await handleEvent(ctx, ev, devicesById, fencesById);
      }
    } catch (e) {
      // Rule g: one bad event must never stop the loop.
      log("error", "event_handling_failed", { eventId: ev.id, error: e.message });
      await audit({
        kind: "error",
        ts: new Date().toISOString(),
        eventId: ev.id,
        error: e.message,
      });
    } finally {
      // Mark processed even on failure. Retrying a cut command on the next poll
      // is more dangerous than dropping one alert, and the failure is audited.
      // This always happens — it is the real duplicate suppression, and unlike
      // the coarse watermarks it is per-event and id-exact, so committing it
      // immediately can never strand a sibling event.
      state.seenEventIds.push(ev.id);
      batchMaxId = Math.max(batchMaxId, ev.id);
      const evMs = Date.parse(ev.eventTime || "");
      if (Number.isFinite(evMs)) batchMaxTime = Math.max(batchMaxTime, evMs);

      // Persist after every event so a crash cannot replay actions already taken.
      state.seenEventIds = state.seenEventIds.slice(-SEEN_IDS_MAX);
      await saveState(cfg.statePath, state);
    }
  }

  // The coarse watermarks move only after every event in the batch has been
  // handled, and only on a poll that saw every device. Until then seenEventIds
  // carries duplicate suppression on its own, so holding them costs nothing but
  // a slightly wider next window — while advancing them early costs events.
  if (pollComplete) {
    state.lastEventId = Math.max(state.lastEventId, batchMaxId);
    advanceEventTime(state, batchMaxTime, now);
    await saveState(cfg.statePath, state);
  }
}

/* ========================================================================== *
 * SECTION 10 — Entry point
 * ========================================================================== */

let stopping = false;

/* ========================================================================== *
 * Fleet-wide fences
 *
 * Traccar only reports a crossing for a car that is LINKED to the fence. A
 * fence marked scope "all" (e.g. every repair shop) must therefore be linked to
 * every car - including cars added after the fence was drawn. This keeps those
 * links complete. It only ever ADDS links, never removes one, and it runs apart
 * from the event loop so a failure here can never touch alerts or cuts.
 * ========================================================================== */

const FLEET_SYNC_MS = 5 * 60 * 1000;
let lastFleetSync = 0;

async function syncFleetFences(ctx) {
  const now = Date.now();
  if (now - lastFleetSync < FLEET_SYNC_MS) return;
  lastFleetSync = now;

  const [geofences, devices] = await Promise.all([
    ctx.traccar.getGeofences(),
    ctx.traccar.getDevices(),
  ]);
  if (!Array.isArray(geofences) || !Array.isArray(devices)) return;
  const fleetWide = geofences.filter(
    (f) => f && Number.isFinite(f.id) && readRules(f.attributes).scope === "all",
  );
  if (fleetWide.length === 0) return;

  for (const d of devices) {
    if (!d || !Number.isFinite(d.id)) continue;
    const linked = await ctx.traccar.json(`/api/geofences?deviceId=${encodeURIComponent(d.id)}`);
    const have = new Set((Array.isArray(linked) ? linked : []).map((g) => g && g.id));
    for (const f of fleetWide) {
      if (have.has(f.id)) continue;
      await ctx.traccar.json("/api/permissions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ deviceId: d.id, geofenceId: f.id }),
      });
      log("info", "fleet_fence_linked", {
        deviceId: d.id,
        deviceName: d.name,
        geofenceId: f.id,
        geofenceName: f.name,
      });
    }
  }
}

async function main() {
  const cfg = loadConfig();
  CONFIG = cfg;

  const dryRunInfo = isDryRun(cfg);

  log("info", "starting", {
    node: process.version,
    host: os.hostname(),
    config: cfg.configSource,
    traccarUrl: cfg.traccarUrl,
    pollIntervalMs: cfg.pollIntervalMs,
    debounceMs: cfg.debounceMs,
    maxCutsPerHour: cfg.maxCutsPerHour,
    maxImmediateCutKmh: cfg.maxImmediateCutKmh,
    alertsPath: cfg.alertsPath,
    statePath: cfg.statePath,
  });

  if (dryRunInfo.dryRun) {
    log("warn", "DRY_RUN_MODE_NO_COMMANDS_WILL_BE_SENT", { reason: dryRunInfo.reason });
  } else {
    log("warn", "LIVE_MODE_THIS_SERVICE_CAN_IMMOBILISE_VEHICLES", {});
  }

  if (!cfg.email || !cfg.password) {
    log("error", "FATAL_missing_traccar_credentials", {
      hint: "set CARVA_TRACCAR_EMAIL / CARVA_TRACCAR_PASSWORD or config.json email/password",
    });
    process.exit(2);
  }

  const state = await loadState(cfg.statePath);
  const traccar = new Traccar(cfg);
  const ctx = { cfg, state, traccar, dryRunInfo };

  // Graceful shutdown: finish the in-flight poll, flush state, exit clean.
  const shutdown = (signal) => {
    if (stopping) return;
    stopping = true;
    log("info", "shutdown_requested", { signal });
    saveState(cfg.statePath, state).finally(() => process.exit(0));
  };
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));

  // A rejection we failed to catch must be loud but must not kill the loop.
  process.on("unhandledRejection", (reason) => {
    log("error", "unhandled_rejection", { error: String(reason) });
  });

  // Poll with setTimeout chaining rather than setInterval, so a slow poll can
  // never overlap itself and fire duplicate commands.
  /* eslint-disable no-await-in-loop */
  while (!stopping) {
    const started = Date.now();
    try {
      // Belt and braces on top of the per-request timeout: if a poll somehow
      // still fails to finish, die so systemd restarts us. A safety service
      // that is hung looks identical to one that is idle, and state is
      // persisted per event, so restarting mid-batch replays nothing.
      await withDeadline(pollOnce(ctx), pollDeadlineMs(cfg), "poll");
    } catch (e) {
      // Rule g: auth/network/parse failures are logged and retried next tick.
      log("error", "poll_failed", { error: e.message });
      await audit({ kind: "error", ts: new Date().toISOString(), error: e.message });
      // A 401 that survived the retry means the session is bad; force re-login.
      if (/401|unauthor/i.test(e.message)) traccar.cookie = null;
    }
    try {
      await withDeadline(syncFleetFences(ctx), pollDeadlineMs(cfg), "fleet_sync");
    } catch (e) {
      log("warn", "fleet_sync_failed", { error: e.message });
    }
    const elapsed = Date.now() - started;
    const wait = Math.max(1000, cfg.pollIntervalMs - elapsed);
    await sleep(wait);
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Generous ceiling for one poll: every device needs an events request and
 * possibly a positions request, plus a command, each bounded by
 * requestTimeoutMs. Ten minutes past that is plenty for a fleet of any size we
 * care about, and still catches a genuine wedge.
 */
function pollDeadlineMs(cfg) {
  return Math.max(cfg.pollIntervalMs * 4, cfg.requestTimeoutMs * 20, 600000);
}

/**
 * Exit the process if `promise` has not settled within `ms`.
 *
 * Deliberately fatal rather than a rejection we recover from: there is no way
 * to cancel the in-flight poll, so simply carrying on would let the next poll
 * run concurrently with the stuck one — two loops deciding about the same relay
 * at the same time, which is exactly what the setTimeout chaining exists to
 * prevent. systemd's Restart=always brings us back with clean state.
 */
function withDeadline(promise, ms, label) {
  let timer;
  const deadline = new Promise(() => {
    timer = setTimeout(() => {
      log("error", "deadline_exceeded_exiting", { label, ms });
      process.exit(1);
    }, ms);
  });
  return Promise.race([promise, deadline]).finally(() => clearTimeout(timer));
}

// An uncaught exception leaves us in an unknown state; die and let systemd
// restart us cleanly rather than continuing with half-applied logic.
process.on("uncaughtException", (e) => {
  log("error", "uncaught_exception_exiting", { error: e && e.stack ? e.stack : String(e) });
  process.exit(1);
});

if (require.main === module) {
  main().catch((e) => {
    log("error", "fatal", { error: e && e.stack ? e.stack : String(e) });
    process.exit(1);
  });
}

// Exported for testing / reuse.
module.exports = {
  readRules,
  buildVehicleControlFrame,
  bcdTerminalId,
  needsRawVehicleControl,
  knotsToKmh,
  defaultAction,
  CATEGORIES,
  CUT_MODES,
  SEVERITIES,
  RULES_KEY,
};
