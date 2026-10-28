// Email-alert settings, shared by the Settings card, the /api/alert-settings
// route and (by contract, it is plain JSON on disk) the carva-mailer service in
// infra/automation/mailer.js. The file lives on the server next to the mailer's
// state: the website writes it, the mailer re-reads it every poll.
//
// Plain module on purpose - the API route (server) and the card (client) both
// import from here.

export const ALERT_TYPES = [
  "geofence",
  "engineCut",
  "alarm",
  "powerCut",
  "offline",
  "overspeed",
  "speedCamera",
  "roadBumps",
] as const;

export type AlertType = (typeof ALERT_TYPES)[number];

export interface AlertSettings {
  version: 1;
  /** Who receives the emails. Empty = emails are off. */
  recipients: string[];
  /** Which warnings are emailed. */
  types: Record<AlertType, boolean>;
  /** Default overspeed limit (a car's own Traccar speedLimit still wins). */
  speedLimitKmh: number;
  /** Minutes of silence before "tracker stopped reporting". */
  offlineAfterMin: number;
  /** Limit a speed camera enforces when it has none of its own. */
  cameraLimitKmh: number;
  /** Crossing a bump faster than this counts as a hit. */
  bumpMaxKmh: number;
  /** Hits in one day that raise a bump alert. */
  bumpsPerDay: number;
  /** Set by "Send test email"; the mailer answers in its status file. */
  testRequestedAt?: string | null;
  updatedAt?: string;
  updatedBy?: string;
}

/** Written by the mailer; read-only for the website. */
export interface MailerStatus {
  lastPollAt?: string;
  lastSent?: { at: string; subject: string } | null;
  lastError?: { at: string; message: string } | null;
  lastTest?: { requestedAt: string; at: string; ok: boolean; error?: string } | null;
  recipients?: string[];
}

export const MAX_RECIPIENTS = 10;
export const SPEED_LIMIT_RANGE = [30, 250] as const;
export const OFFLINE_RANGE = [5, 1440] as const;
// Ranges must match loadSettings() in infra/automation/mailer.js.
export const CAMERA_DEFAULT_LIMIT_RANGE = [20, 200] as const;
export const BUMP_SPEED_RANGE = [5, 80] as const;
export const BUMPS_PER_DAY_RANGE = [1, 50] as const;

export const DEFAULT_ALERT_SETTINGS: AlertSettings = {
  version: 1,
  recipients: [],
  types: {
    geofence: true,
    engineCut: true,
    alarm: true,
    powerCut: true,
    offline: true,
    overspeed: true,
    speedCamera: true,
    roadBumps: true,
  },
  speedLimitKmh: 120,
  offlineAfterMin: 20,
  cameraLimitKmh: 80,
  bumpMaxKmh: 25,
  bumpsPerDay: 3,
  testRequestedAt: null,
};

// Deliberately simple: one @, a dot in the domain, no spaces. The mail server
// is the real judge; this only stops typos like "name@gmail".
const EMAIL = /^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]{2,}$/;

export function isEmail(s: string): boolean {
  return EMAIL.test(s.trim());
}

function clampInt(v: unknown, [min, max]: readonly [number, number], fallback: number) {
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n)));
}

/** Total: any input becomes valid settings (bad parts fall back to defaults). */
export function sanitizeAlertSettings(raw: unknown): AlertSettings {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const seen = new Set<string>();
  const recipients = (Array.isArray(r.recipients) ? r.recipients : [])
    .filter((e): e is string => typeof e === "string")
    .map((e) => e.trim().toLowerCase())
    .filter((e) => isEmail(e) && !seen.has(e) && seen.add(e))
    .slice(0, MAX_RECIPIENTS);
  const rawTypes = (r.types && typeof r.types === "object" ? r.types : {}) as Record<string, unknown>;
  const types = Object.fromEntries(
    ALERT_TYPES.map((k) => [
      k,
      typeof rawTypes[k] === "boolean" ? (rawTypes[k] as boolean) : DEFAULT_ALERT_SETTINGS.types[k],
    ]),
  ) as Record<AlertType, boolean>;
  return {
    version: 1,
    recipients,
    types,
    speedLimitKmh: clampInt(r.speedLimitKmh, SPEED_LIMIT_RANGE, DEFAULT_ALERT_SETTINGS.speedLimitKmh),
    offlineAfterMin: clampInt(r.offlineAfterMin, OFFLINE_RANGE, DEFAULT_ALERT_SETTINGS.offlineAfterMin),
    cameraLimitKmh: clampInt(r.cameraLimitKmh, CAMERA_DEFAULT_LIMIT_RANGE, DEFAULT_ALERT_SETTINGS.cameraLimitKmh),
    bumpMaxKmh: clampInt(r.bumpMaxKmh, BUMP_SPEED_RANGE, DEFAULT_ALERT_SETTINGS.bumpMaxKmh),
    bumpsPerDay: clampInt(r.bumpsPerDay, BUMPS_PER_DAY_RANGE, DEFAULT_ALERT_SETTINGS.bumpsPerDay),
    testRequestedAt: typeof r.testRequestedAt === "string" ? r.testRequestedAt : null,
    updatedAt: typeof r.updatedAt === "string" ? r.updatedAt : undefined,
    updatedBy: typeof r.updatedBy === "string" ? r.updatedBy : undefined,
  };
}
