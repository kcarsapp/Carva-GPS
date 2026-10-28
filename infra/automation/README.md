# Carva Fleet — geofence automation

A standalone Node service that turns each geofence's own rules into real actions:
raise an alert, and/or cut the vehicle's fuel/power relay.

> **This service can immobilise a car.**
> It ships **disabled**. Read [Turning it off in a hurry](#turning-it-off-in-a-hurry) before you enable it.

---

## What it does

Every `pollIntervalMs` (default 30 s) it:

1. Authenticates to Traccar (`POST /api/session`, form-encoded) and keeps the `JSESSIONID` cookie,
   re-authenticating automatically on a 401.
2. Fetches `/api/geofences` and `/api/devices`.
3. Fetches `/api/reports/events` for every device since the stored watermark
   (always with `Accept: application/json` — Traccar answers `*/*` on report endpoints with an XLSX
   binary).
4. For each `geofenceEnter` / `geofenceExit` event, reads that fence's rules and applies them.
5. Logs every action to stdout (the systemd journal) **and** to an append-only JSONL audit log.

Any other event type (`ignitionOn`, `deviceOverspeed`, …) is watermarked and ignored.

### The rule schema

Rules live in the Traccar geofence's own `attributes` object under the key `carvaRules`, so they
travel with the fence and need no extra database:

```jsonc
{
  "version": 1,
  "category": "zone" | "repair" | "customer" | "base" | "restricted",
  "onEnter": {
    "notify": true,                       // raise an alert in the app
    "cut": "none" | "safe" | "now",       // fuel/power relay action
    "severity": "info" | "warning" | "critical",  // optional; defaults by category
    "note": "free text shown on the alert"        // optional
  },
  "onExit": { "...same shape..." }
}
```

**Defaults when `carvaRules` is absent or malformed:** category `zone`, and both
`onEnter` / `onExit` become `{notify: true, cut: "none"}`.

Default severities match `CATEGORY_SEVERITY` in `apps/web/lib/geofence-rules.ts` exactly:
`repair`/enter is `critical` (a car arriving at a garage usually means it has been in an accident),
`restricted`/enter and `base`/exit are `warning`, everything else is `info`. On top of that a cut
raises the floor — `cut: "safe"` is at least `warning` and `cut: "now"` is at least `critical` — so a
fence that immobilises a car can never be filed as a quiet `info` line. An explicit `severity` in the
rule always wins.

`cut` is **never** defaulted to anything but `"none"`. An unrecognised value, a boolean, a null, a
string that will not parse — all become `"none"`. `readRules()` in `runner.js` is a plain-JS mirror of
`apps/web/lib/geofence-rules.ts`; **if you change one, change both.**

### The two outputs

**`notify`** appends a line to the JSONL alert log (`alertsPath`, default `/var/lib/carva/alerts.jsonl`)
that the web app reads:

```json
{"ts":"…","eventId":902,"type":"geofenceEnter","deviceId":7,"deviceName":"Bmw 2020 MIC",
 "geofenceId":11,"geofenceName":"Restricted Border Zone","category":"restricted",
 "severity":"critical","note":"Left permitted area",
 "kind":"alert","loggedAt":"…","plannedCut":"now","dryRun":false}
```

The first ten fields are the contract with the web app. `kind`, `loggedAt`, `plannedCut` and `dryRun`
are additive — readers should ignore keys they do not know.

The same file also receives `kind:"action"` records (what was sent to the relay, and why) and
`kind:"error"` records. Filter on `kind` when rendering the alert feed.

**`cut`** sends a JT/T 808 **0x8500 "vehicle control"** frame as a Traccar `custom` command:

```
POST /api/commands/send  {"deviceId":7,"type":"custom","attributes":{"data":"<hex frame>"}}
```

Body byte `0x01` = cut immediately, `0x02` = cut safely (the tracker itself defers the cut until the
vehicle is stopped or under 20 km/h). Traccar's *native* jt808 `engineStop` (0x8105 + vendor bytes
0xF0/0xF1) is silently ignored by the MV930G trackers in this fleet, which is why the frame is built
by hand — mirrored byte-for-byte from `apps/web/lib/jt808.ts` and verified on the wire.

Only `jt808` / `huabao` devices are actuated. Any other protocol is **refused and logged**, never
guessed at.

---

## Safety rails

| # | Rail | Setting |
|---|------|---------|
| a | **Master switch.** Nothing is sent unless `enabled` is exactly `true`. `CARVA_AUTOMATION_DISABLE=1` forces dry-run regardless. Dry-run logs the exact frame it *would* have sent. | `enabled`, env |
| b | A rule whose `cut` is `none` — or any rule that fails to parse — can never send a command. | hard-coded |
| c | **Debounce** per `(deviceId, geofenceId, enter/exit)`, so GPS jitter on a boundary cannot machine-gun the relay. Cannot be set below 1 s. | `debounceMs` (5 min) |
| d | **Fleet-wide rolling-hour rate limit** on cut commands. Beyond it, refuse and log loudly. Set to `0` to allow alerts but never cut. | `maxCutsPerHour` (6) |
| e | **Speed guard.** Before an *immediate* cut, the device's latest position is fetched; above the threshold the cut is **downgraded to safe** and the downgrade is logged prominently. Unknown speed also downgrades — a car is never assumed to be stopped. | `maxImmediateCutKmh` (5) |
| f | **No automatic resume, ever.** The frame builder cannot even encode `0x00`. Restoring fuel is always a human decision, done from the web app. | hard-coded |
| g | Every auth/network/parse failure is caught and logged; the loop continues and the watermark is never advanced past events that were never fetched. A `200` whose body is empty or not a JSON list counts as a **failure**, not as "no events" — otherwise an unread window looks identical to an empty one and the watermark walks straight past it. A bad `/api/geofences` aborts the whole poll before any event is consumed. | hard-coded |
| h | No secrets in the repo. Credentials come from the config file or the environment; `config.example.json` holds placeholders only. | — |
| i | **Stale-crossing guard.** A crossing older than the threshold can never actuate the relay. The alert is still raised, flagged `"stale": true`. Without this, restarting after downtime replays every event since the watermark and immobilises cars for fences they left hours ago. An age that cannot be trusted counts as stale: an unparsable `eventTime`, **and one stamped in the future** beyond 60 s of skew. That second case matters because `eventTime` comes from the tracker's own clock — a device whose RTC is days fast uploads its buffered crossings on reconnect stamped ahead of now, and a plain `now - eventTime` goes large and *negative*, sliding under the threshold and cutting a car for a crossing that really happened days ago. | `maxCutEventAgeMs` (10 min) |
| j | **Stale-fix guard.** The speed used by rail (e) must come from a recent GPS fix. An older fix is treated as "speed unknown" and downgrades, so a tracker that dropped off the network at speed cannot present its last reported `0` as proof the car is parked. | `maxPositionAgeMs` (3 min) |

Rails (i) and (j) both answer the same question — *is what I know about this car still true?* The relay
acts on the car as it is **now**, not as it was when the event fired.

Traccar reports speed in **knots**; the service converts (`× 1.852`) before comparing against
`maxImmediateCutKmh`.

### First run and restarts

On the **first ever run** (no state file), the service records the current watermark and acts on
nothing — it will never replay history. After that, state is persisted to `statePath` after **every**
event, so a restart mid-batch cannot re-fire a command that already went out.

Three separate things are persisted, on purpose, at different moments:

- **`seenEventIds`** (a bounded set) is written after each event. This is the real duplicate
  suppression, and it is id-exact.
- **The coarse watermark** (`lastEventId` / `lastEventTime`) is committed only once the *whole* batch
  has been handled. It cannot be advanced per event, because events are processed in `eventTime`
  order while ids are assigned on insert — a tracker uploading buffered positions after a reconnect
  produces a *later* time with a *lower* id. Committing id 900 before reaching id 880 would let a
  restart reject 880 as "older than the watermark" and drop it silently.
- **The debounce claim and the cut budget** are flushed to disk *before* the relay command is
  POSTed, and after the alert is written. A crash in the POST window then finds the claim already on
  disk and does not re-send; a crash before it replays the alert (harmless) rather than losing it.

Deleting the state file re-arms from *now*; it does not replay.

**After downtime**, a restart *does* re-query every event since the stored watermark — that is how
alerts missed during the outage still reach you. Those crossings are replayed as **alerts only**:
anything older than `maxCutEventAgeMs` is refused for cutting (`CUT_REFUSED_EVENT_TOO_OLD`) and the
alert carries `"stale": true`. The relay is never actuated for a fence the car crossed hours ago.

**If a device's events request fails**, the watermark is *held* (`watermark_held_incomplete_poll`)
rather than advanced, so that device's unread events are still inside the next poll's window.
Duplicate suppression during the hold comes from the seen-id set, not the watermark, so nothing is
re-fired.

---

## Install

On the VPS, as root:

```bash
# 1. Code
mkdir -p /opt/carva/automation
# copy runner.js, config.example.json, README.md from infra/automation/ into /opt/carva/automation/
install -m 0644 carva-automation.service /etc/systemd/system/carva-automation.service

# 2. Config — starts DISABLED on purpose
cp /opt/carva/automation/config.example.json /opt/carva/automation/config.json
chmod 600 /opt/carva/automation/config.json
$EDITOR /opt/carva/automation/config.json     # set traccarUrl; leave "enabled": false for now

# 3. Credentials (kept out of the repo and out of `ps`)
mkdir -p /etc/carva
cat > /etc/carva/automation.env <<'EOF'
CARVA_TRACCAR_EMAIL=admin@example.com
CARVA_TRACCAR_PASSWORD=REPLACE_ME
EOF
chmod 600 /etc/carva/automation.env

# 4. State + audit log directory (systemd's StateDirectory= also creates this)
mkdir -p /var/lib/carva && chmod 750 /var/lib/carva

# 5. Start it — still in dry-run because enabled is false
systemctl daemon-reload
systemctl enable --now carva-automation
journalctl -u carva-automation -f
```

Requires **Node 18+** (uses global `fetch`); the VPS runs Node 22. **Zero npm dependencies** — there
is nothing to `npm install`.

### Going live

Watch the journal in dry-run for at least a full day of normal driving. You are looking for
`DRY_RUN_would_send_cut` lines that you would **not** have wanted, and for `debounced` lines proving
the boundary jitter is being absorbed. Only then:

```bash
sed -i 's/"enabled": false/"enabled": true/' /opt/carva/automation/config.json
systemctl restart carva-automation
```

The journal will print `LIVE_MODE_THIS_SERVICE_CAN_IMMOBILISE_VEHICLES` on startup.

### Test it without touching a car

Set `maxCutsPerHour: 0`. Alerts still flow; every cut is refused and logged. This is a good permanent
setting if the owner only wants notifications for now.

---

## Turning it off in a hurry

Fastest first:

```bash
# 1. Stop it dead (nothing further is sent, alerts stop too)
systemctl stop carva-automation

# 2. Or keep it running and watching, but neuter every action:
systemctl set-environment CARVA_AUTOMATION_DISABLE=1   # not persistent
#   ...persistent version: add CARVA_AUTOMATION_DISABLE=1 to /etc/carva/automation.env
systemctl restart carva-automation

# 3. Or stop only the cutting, keep the alerts:
#    set "maxCutsPerHour": 0 in config.json, then restart

# 4. Stop it coming back after a reboot
systemctl disable --now carva-automation
```

**None of these restore fuel to a car that has already been cut.** Do that from the web app's device
controls (resume), which is deliberately the only place a resume can be issued.

---

## Configuration reference

Every key can be overridden by an environment variable, which wins over the config file.

| Config key | Env var | Default |
|---|---|---|
| `enabled` | `CARVA_ENABLED` | `false` |
| `traccarUrl` | `CARVA_TRACCAR_URL` | `http://localhost:8082` |
| `email` | `CARVA_TRACCAR_EMAIL` | — (required) |
| `password` | `CARVA_TRACCAR_PASSWORD` | — (required) |
| `pollIntervalMs` | `CARVA_POLL_INTERVAL_MS` | `30000` (min 5000) |
| `lookbackOverlapMs` | `CARVA_LOOKBACK_OVERLAP_MS` | `120000` |
| `requestTimeoutMs` | `CARVA_REQUEST_TIMEOUT_MS` | `15000` |
| `debounceMs` | `CARVA_DEBOUNCE_MS` | `300000` (min 1000) |
| `maxCutsPerHour` | `CARVA_MAX_CUTS_PER_HOUR` | `6` |
| `maxImmediateCutKmh` | `CARVA_MAX_IMMEDIATE_CUT_KMH` | `5` |
| `maxCutEventAgeMs` | `CARVA_MAX_CUT_EVENT_AGE_MS` | `600000` (min 60000) |
| `maxPositionAgeMs` | `CARVA_MAX_POSITION_AGE_MS` | `180000` (min 30000) |
| `maxLookbackMs` | `CARVA_MAX_LOOKBACK_MS` | `21600000` (6 h) |
| `alertsPath` | `CARVA_ALERTS_PATH` | `/var/lib/carva/alerts.jsonl` |
| `alertsMaxBytes` | `CARVA_ALERTS_MAX_BYTES` | `67108864` (64 MiB; `0` disables) |
| `statePath` | `CARVA_STATE_PATH` | `/var/lib/carva/automation-state.json` |
| — | `CARVA_AUTOMATION_DISABLE` | unset; `1` forces dry-run |
| — | `CARVA_AUTOMATION_CONFIG` | config path (also `argv[2]`) |

Out-of-range values are clamped rather than accepted, so a typo cannot disable a safety rail.

---

## Operating notes

**Log rotation.** The service rolls `alerts.jsonl` to `alerts.jsonl.1` once it passes
`alertsMaxBytes` (64 MiB), keeping one previous generation. That is built in so a full disk cannot
take Traccar down with it. If you want more history than two generations, set `alertsMaxBytes` to `0`
and hand the file to logrotate instead, using `copytruncate` (the service appends, it does not hold
an offset):

```
/var/lib/carva/alerts.jsonl {
    weekly
    rotate 12
    compress
    copytruncate
    missingok
}
```

**Grep recipes.**

```bash
journalctl -u carva-automation | grep CUT_COMMAND_SENT          # everything actuated
journalctl -u carva-automation | grep DOWNGRADED                # speed guard firing
journalctl -u carva-automation | grep RATE_LIMIT                # budget exhausted
grep '"kind":"action"' /var/lib/carva/alerts.jsonl | tail -20   # audit trail
```

**Devices that have never reported** contribute no events and are refused any cut
(`reason: "unsupported_protocol"`, because there is no position to read a protocol from). Four of the
five trackers in this fleet are in that state; this is expected, not a fault.
