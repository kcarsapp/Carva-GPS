// Typed fetch helpers for the Devices page (no React).
//
// Every call goes through the same-origin Traccar proxy (/api/traccar/…), which
// replays the signed-in user's session. Each helper tolerates an empty or
// non-array body — Traccar answers `[]`, `204` or an HTML error page depending
// on the endpoint and the mood of the server, and the page must never crash on
// any of them.
//
// deriveHealth() is the single place that turns a device + its latest position
// into the health flags both the list and the panel show, so the two can never
// disagree about whether a tracker is "online", "stale" or "never reported".

import type { TraccarDevice, TraccarPosition } from "@carva/shared";
import type { TraccarGeofence } from "@/lib/geofence";
import type { TraccarEventRow } from "@/lib/events";
import { powerConnected, signalTier, type SignalTier } from "@/lib/format";

/* --------------------------------- Types --------------------------------- */

/**
 * The full Traccar device record. `PUT /devices/{id}` replaces the whole row,
 * so we keep every field we receive (including ones this app does not know
 * about) and send them back untouched.
 */
export interface DeviceRecord extends TraccarDevice {
  positionId?: number;
  contact?: string;
  disabled?: boolean;
  /** ISO timestamp or null; Traccar refuses logins from an expired device. */
  expirationTime?: string | null;
  calendarId?: number;
  [extra: string]: unknown;
}

/** Answer of GET /api/commands/engine?deviceId=N (our own route). */
export interface RelayInfo {
  protocol: string | null;
  /** Relay state read back from the tracker: true = fuel/power currently cut. */
  blocked: boolean | null;
  modes: string[];
}

/** A command Traccar has accepted but not yet delivered to the tracker. */
export interface QueuedCommand {
  id: number;
  deviceId: number;
  type: string;
  description?: string;
  textChannel?: boolean;
  attributes?: Record<string, unknown>;
}

export interface SendCommandResult {
  /** 200 = handed to the tracker now, 202 = parked until it reconnects. */
  status: "delivered" | "queued";
  httpStatus: number;
}

/** Category options offered in the Settings tab (Traccar stores free text). */
export const DEVICE_CATEGORY_OPTIONS = [
  "car",
  "truck",
  "bus",
  "motorcycle",
  "van",
  "other",
] as const;
export type DeviceCategoryOption = (typeof DEVICE_CATEGORY_OPTIONS)[number];

/** A GPS fix older than this is flagged as stale even if the device is online. */
export const STALE_FIX_MS = 3 * 60_000;

/** Device attribute keys where the "since" of a server counter reset is kept. */
export const ODOMETER_SINCE_KEY = "carvaOdometerSince";
export const HOURS_SINCE_KEY = "carvaHoursSince";

/* -------------------------------- Plumbing -------------------------------- */

const JSON_HEADERS = { Accept: "application/json", "Content-Type": "application/json" };

async function request(path: string, init: RequestInit = {}): Promise<Response> {
  const res = await fetch(path, {
    cache: "no-store",
    ...init,
    headers: { ...JSON_HEADERS, ...(init.headers ?? {}) },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(text.trim() || `HTTP ${res.status}`);
  }
  return res;
}

/** Parse a JSON body, returning `fallback` for 204 / empty / non-JSON bodies. */
async function readJson<T>(res: Response, fallback: T): Promise<T> {
  if (res.status === 204) return fallback;
  const text = await res.text().catch(() => "");
  if (!text.trim()) return fallback;
  try {
    return JSON.parse(text) as T;
  } catch {
    return fallback;
  }
}

function asArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

export function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

export function bool(v: unknown): boolean | null {
  return typeof v === "boolean" ? v : null;
}

/* ------------------------------- Endpoints -------------------------------- */

export async function listDevices(): Promise<DeviceRecord[]> {
  const res = await request("/api/traccar/devices");
  return asArray<DeviceRecord>(await readJson<unknown>(res, []));
}

/** Freshest position per device (by fixTime). */
function latestByDevice(positions: TraccarPosition[]): Map<number, TraccarPosition> {
  const map = new Map<number, TraccarPosition>();
  for (const p of positions) {
    if (!p || typeof p.deviceId !== "number") continue;
    const prev = map.get(p.deviceId);
    if (!prev || +new Date(p.fixTime) > +new Date(prev.fixTime)) map.set(p.deviceId, p);
  }
  return map;
}

/** Latest position of one device, or null when it has never reported. */
export async function getLatestPosition(deviceId: number): Promise<TraccarPosition | null> {
  const res = await request(`/api/traccar/positions?deviceId=${deviceId}`);
  const rows = asArray<TraccarPosition>(await readJson<unknown>(res, []));
  return latestByDevice(rows).get(deviceId) ?? null;
}

/** Latest position of every device the user can see, in one round-trip. */
export async function getLatestPositions(): Promise<Map<number, TraccarPosition>> {
  const res = await request("/api/traccar/positions");
  return latestByDevice(asArray<TraccarPosition>(await readJson<unknown>(res, [])));
}

/** PUT the full record back; Traccar returns the stored row. */
export async function updateDevice(record: DeviceRecord): Promise<DeviceRecord> {
  const res = await request(`/api/traccar/devices/${record.id}`, {
    method: "PUT",
    body: JSON.stringify(record),
  });
  const saved = await readJson<DeviceRecord | null>(res, null);
  return saved && typeof saved === "object" ? saved : record;
}

export interface AccumulatorValues {
  /** Metres. */
  totalDistance?: number;
  /** Milliseconds of engine runtime. */
  hours?: number;
}

/**
 * Reset or seed Traccar's accumulated odometer / engine hours for a device.
 *
 * Traccar's DeviceAccumulators body defaults BOTH fields to 0, so a request that
 * only names one of them silently zeroes the other. Callers therefore pass the
 * value they want changed in `next` and the device's current readings in
 * `current`; whatever `next` omits is carried over unchanged.
 */
export async function resetAccumulators(
  deviceId: number,
  next: AccumulatorValues,
  current: AccumulatorValues = {},
): Promise<void> {
  const body = {
    deviceId,
    totalDistance: Math.max(0, Math.round(next.totalDistance ?? current.totalDistance ?? 0)),
    hours: Math.max(0, Math.round(next.hours ?? current.hours ?? 0)),
  };
  await request(`/api/traccar/devices/${deviceId}/accumulators`, {
    method: "PUT",
    body: JSON.stringify(body),
  });
}

/** Relay capability + current state from our own engine route; null on error. */
export async function getRelayInfo(deviceId: number): Promise<RelayInfo | null> {
  try {
    const res = await request(`/api/commands/engine?deviceId=${deviceId}`);
    const info = await readJson<Partial<RelayInfo> | null>(res, null);
    if (!info || typeof info !== "object") return null;
    return {
      protocol: typeof info.protocol === "string" ? info.protocol : null,
      blocked: bool(info.blocked),
      modes: asArray<string>(info.modes),
    };
  } catch {
    return null;
  }
}

/** Commands Traccar is holding for the tracker (it is offline or asleep). */
export async function getQueuedCommands(deviceId: number): Promise<QueuedCommand[]> {
  const res = await request(`/api/traccar/commands/send?deviceId=${deviceId}`);
  return asArray<QueuedCommand>(await readJson<unknown>(res, [])).filter(
    (c) => c && typeof c === "object" && typeof c.type === "string",
  );
}

export async function getLinkedGeofences(deviceId: number): Promise<TraccarGeofence[]> {
  const res = await request(`/api/traccar/geofences?deviceId=${deviceId}`);
  return asArray<TraccarGeofence>(await readJson<unknown>(res, [])).filter(
    (g) => g && typeof g === "object" && typeof g.id === "number",
  );
}

/** Events for the last `hours` hours, newest first. */
export async function getRecentEvents(deviceId: number, hours: number): Promise<TraccarEventRow[]> {
  const to = new Date();
  const from = new Date(to.getTime() - Math.max(1, hours) * 3_600_000);
  const qs = new URLSearchParams({
    deviceId: String(deviceId),
    from: from.toISOString(),
    to: to.toISOString(),
  });
  const res = await request(`/api/traccar/reports/events?${qs}`);
  const rows = asArray<TraccarEventRow>(await readJson<unknown>(res, [])).filter(
    (e) => e && typeof e === "object" && typeof e.type === "string",
  );
  return rows.sort((a, b) => +new Date(b.eventTime) - +new Date(a.eventTime) || b.id - a.id);
}

/** POST a Traccar command; resolves with delivered/queued, rejects on failure. */
export async function sendCommand(
  deviceId: number,
  type: string,
  attributes?: Record<string, unknown>,
): Promise<SendCommandResult> {
  const res = await request("/api/traccar/commands/send", {
    method: "POST",
    body: JSON.stringify({ deviceId, type, ...(attributes ? { attributes } : {}) }),
  });
  return { status: res.status === 202 ? "queued" : "delivered", httpStatus: res.status };
}

/* --------------------------------- Health --------------------------------- */

export interface DeviceHealth {
  /** Traccar's own connectivity verdict. */
  online: boolean;
  /** Traccar's raw status string: online | offline | unknown. */
  status: string;
  /** No position ever stored — the tracker has never once connected. */
  neverReported: boolean;
  /** Milliseconds since the last GPS fix, or null without one. */
  lastFixAge: number | null;
  /** valid && at least 4 satellites; null when the tracker reports neither. */
  gpsFix: boolean | null;
  satellites: number | null;
  signal: SignalTier | null;
  rssi: number | null;
  /** External supply voltage. */
  voltage: number | null;
  powerConnected: boolean | null;
  /** true = fuel/power relay currently cut (from the tracker's own report). */
  relayCut: boolean | null;
  /** Fix older than STALE_FIX_MS. */
  staleFix: boolean;
  /** Traccar-accumulated metres. */
  totalDistance: number | null;
  /** Traccar-accumulated engine milliseconds. */
  engineHours: number | null;
  /** The tracker's own odometer counter (0 = feature switched off on MV930G). */
  trackerOdometer: number | null;
  ignition: boolean | null;
  motion: boolean | null;
  charging: boolean | null;
}

export function deriveHealth(
  device: Pick<DeviceRecord, "status" | "lastUpdate" | "positionId">,
  position: TraccarPosition | null | undefined,
  now: number = Date.now(),
): DeviceHealth {
  const attrs: Record<string, unknown> = position?.attributes ?? {};
  const neverReported = !position && !device.lastUpdate && !device.positionId;

  const fixTime = position ? +new Date(position.fixTime) : NaN;
  const lastFixAge = Number.isFinite(fixTime) ? Math.max(0, now - fixTime) : null;

  const sat = num(attrs.sat) ?? num(attrs.satellites);
  const valid = position ? bool((position as { valid?: unknown }).valid) : null;
  const gpsFix =
    !position ? null : valid === null && sat === null ? null : valid !== false && (sat ?? 4) >= 4;

  const rssi = num(attrs.rssi) ?? num(attrs.gsm);
  const voltage = num(attrs.power) ?? num(attrs.externalPower);
  const rawOdo = num(attrs.odometer);

  return {
    online: device.status === "online",
    status: device.status,
    neverReported,
    lastFixAge,
    gpsFix,
    satellites: sat,
    signal: signalTier(rssi),
    rssi,
    voltage,
    powerConnected: powerConnected(voltage),
    relayCut: bool(attrs.blocked),
    staleFix: lastFixAge != null && lastFixAge > STALE_FIX_MS,
    totalDistance: num(attrs.totalDistance),
    engineHours: num(attrs.hours),
    trackerOdometer: rawOdo,
    ignition: bool(attrs.ignition) ?? bool(attrs.acc),
    motion: bool(attrs.motion),
    charging: bool(attrs.charge),
  };
}

/** True while the vehicle is actually moving — the only time a GPS course means anything. */
export function isMoving(position: TraccarPosition | null | undefined): boolean {
  if (!position) return false;
  return (num(position.speed) ?? 0) > 0 || bool(position.attributes?.motion) === true;
}

/* ------------------------------ SMS reference ------------------------------ */

export type SmsGroup = "inquiry" | "relay" | "alarms" | "reporting" | "network" | "danger";

export interface SmsCommand {
  /** i18n suffix: dev.sms.cmd.<key> holds the description. */
  key: string;
  /** Literal text to send; may contain <placeholders> the operator edits. */
  command: string;
  group: SmsGroup;
  dangerous?: boolean;
}

export const SMS_GROUPS: readonly SmsGroup[] = [
  "inquiry",
  "relay",
  "alarms",
  "reporting",
  "network",
  "danger",
] as const;

/** MV930G (MiCODUS, jt808) SMS command set. Default device password 888888. */
export const MV930G_SMS_COMMANDS: SmsCommand[] = [
  { key: "status", command: "STATUS#", group: "inquiry" },
  { key: "param", command: "PARAM#", group: "inquiry" },
  { key: "where", command: "WHERE#", group: "inquiry" },
  { key: "url", command: "URL#", group: "inquiry" },
  { key: "version", command: "VERSION#", group: "inquiry" },
  { key: "relayResume", command: "RELAY,0#", group: "relay", dangerous: true },
  { key: "relayCut", command: "RELAY,1#", group: "relay", dangerous: true },
  { key: "relayCutSafe", command: "RELAY,2#", group: "relay", dangerous: true },
  { key: "center", command: "CENTER,888888,A,<your number>#", group: "relay" },
  { key: "sos", command: "SOS,A,<your number>#", group: "alarms" },
  { key: "speed", command: "SPEED,ON,100,1#", group: "alarms" },
  { key: "accalm", command: "ACCALM,ON,2,1#", group: "alarms" },
  { key: "pwralm", command: "PWRALM,ON,1#", group: "alarms" },
  { key: "lvalm", command: "LVALM,ON,11.5,1#", group: "alarms" },
  { key: "senalm", command: "SENALM,ON,1#", group: "alarms" },
  { key: "shift", command: "SHIFT,ON,300,1#", group: "alarms" },
  { key: "arm", command: "ARM#", group: "alarms" },
  { key: "disarm", command: "DISARM#", group: "alarms" },
  { key: "level", command: "LEVEL,5#", group: "alarms" },
  { key: "timer", command: "TIMER,10,180#", group: "reporting" },
  { key: "hbt", command: "HBT,3#", group: "reporting" },
  { key: "mileage", command: "MILEAGE,ON,<km>#", group: "reporting" },
  { key: "gmt", command: "GMT,E,3#", group: "reporting" },
  { key: "apn", command: "APN,<apn>#", group: "network" },
  { key: "server", command: "SERVER,0,<ip>,<port>#", group: "network" },
  { key: "restart", command: "RESTART#", group: "danger", dangerous: true },
  { key: "factory", command: "FACTORY#", group: "danger", dangerous: true },
];

/** `sms:` deep link that opens the phone's messaging app with the body filled in. */
export function smsHref(phone: string | undefined | null, body: string): string | null {
  const to = (phone ?? "").replace(/[\s\-().]/g, "");
  if (!to) return null;
  return `sms:${to}?body=${encodeURIComponent(body)}`;
}
