"use client";

// Real Traccar events for the Alerts page (and the sidebar badge).
//
// Everything the Alerts surface shows comes from GET /api/traccar/reports/events
// — there is no separate "alerts" table in Traccar, and no per-user read flag.
// This module owns three things so the page stays presentational:
//
//   1. fetching  — repeated `deviceId` params, a mandatory from/to window;
//   2. meaning   — severity classification + translated labels for a raw type;
//   3. read state — acknowledged event ids kept in localStorage, capped so the
//      list cannot grow without bound.
//
// Timestamps are never re-derived here: the fleet-local time zone and all
// display formatting come from lib/format.ts.

import * as React from "react";

import { FLEET_TIME_ZONE } from "@/lib/format";
import type { Translate } from "@/lib/reports";
import type { TraccarGeofence } from "@/lib/geofence";
import type { TraccarDevice } from "@carva/shared";

/* --------------------------------- Types ---------------------------------- */

/**
 * A row of GET /api/traccar/reports/events, exactly as this server returns it:
 * { id, type, eventTime, deviceId, positionId, geofenceId, maintenanceId,
 *   attributes }. `geofenceId`/`maintenanceId` are 0 (not absent) when unused.
 */
export interface TraccarEventRow {
  id: number;
  type: string;
  /** ISO 8601 with offset, e.g. "2026-08-14T22:21:31.000+00:00". */
  eventTime: string;
  deviceId: number;
  positionId?: number;
  geofenceId?: number;
  maintenanceId?: number;
  attributes?: Record<string, unknown>;
}

export type Severity = "critical" | "warning" | "info";

/** Display order: worst first. */
export const SEVERITIES: readonly Severity[] = ["critical", "warning", "info"];

/** Severities that deserve a sidebar badge — ignition noise stays out. */
export const ACTIONABLE: readonly Severity[] = ["critical", "warning"];

/* -------------------------------- Fetching -------------------------------- */

export const EVENTS_PATH = "/api/traccar/reports/events";

export interface FetchEventsOptions {
  /** One or more Traccar device ids; empty means "nothing to ask for". */
  deviceIds: Array<number | string>;
  from: Date | string;
  to: Date | string;
  signal?: AbortSignal;
}

function iso(value: Date | string): string {
  return typeof value === "string" ? value : value.toISOString();
}

function isEventRow(value: unknown): value is TraccarEventRow {
  if (typeof value !== "object" || value === null) return false;
  const row = value as Partial<TraccarEventRow>;
  return (
    typeof row.id === "number" &&
    typeof row.type === "string" &&
    typeof row.eventTime === "string" &&
    typeof row.deviceId === "number"
  );
}

/** Newest first; ids break ties for events sharing a second. */
function byNewest(a: TraccarEventRow, b: TraccarEventRow): number {
  const delta = +new Date(b.eventTime) - +new Date(a.eventTime);
  return delta !== 0 ? delta : b.id - a.id;
}

/**
 * Events for one or many vehicles in a window. Traccar accepts the `deviceId`
 * parameter repeated, so a single request covers the whole fleet.
 *
 * Throws on a non-2xx response (the page surfaces it); a body that isn't an
 * array — Traccar occasionally answers with an error object — yields [].
 */
export async function fetchEvents(
  options: FetchEventsOptions,
): Promise<TraccarEventRow[]> {
  const ids = options.deviceIds.map(String).filter((id) => id.length > 0);
  if (ids.length === 0) return [];

  const qs = new URLSearchParams();
  ids.forEach((id) => qs.append("deviceId", id));
  qs.set("from", iso(options.from));
  qs.set("to", iso(options.to));

  const res = await fetch(`${EVENTS_PATH}?${qs}`, {
    cache: "no-store",
    signal: options.signal,
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);

  const body: unknown = await res.json().catch(() => null);
  if (!Array.isArray(body)) return [];
  return body.filter(isEventRow).sort(byNewest);
}

/** The account's vehicles. Tolerant: a failure just means "no vehicles yet". */
export async function fetchDevices(
  signal?: AbortSignal,
): Promise<TraccarDevice[]> {
  try {
    const res = await fetch("/api/traccar/devices", {
      cache: "no-store",
      signal,
    });
    if (!res.ok) return [];
    const body: unknown = await res.json();
    return Array.isArray(body) ? (body as TraccarDevice[]) : [];
  } catch {
    return [];
  }
}

/**
 * geofenceId -> name, so a geofence event can name the zone it crossed.
 * Tolerant for the same reason: a missing name degrades to "#id" in the UI.
 */
export async function fetchGeofenceNames(
  signal?: AbortSignal,
): Promise<Map<number, string>> {
  const names = new Map<number, string>();
  try {
    const res = await fetch("/api/traccar/geofences", {
      cache: "no-store",
      signal,
    });
    if (!res.ok) return names;
    const body: unknown = await res.json();
    if (!Array.isArray(body)) return names;
    for (const zone of body as TraccarGeofence[]) {
      if (zone && typeof zone.id === "number" && typeof zone.name === "string") {
        names.set(zone.id, zone.name);
      }
    }
  } catch {
    /* keep whatever we managed to read */
  }
  return names;
}

/* ------------------------------- Severity --------------------------------- */

/** Severity per Traccar event type; anything unlisted is informational. */
const TYPE_SEVERITY: Record<string, Severity> = {
  // critical — someone must look now
  deviceOverspeed: "critical",
  powerCut: "critical",
  // warning — worth reviewing
  geofenceEnter: "warning",
  geofenceExit: "warning",
  deviceOffline: "warning",
  deviceUnknown: "warning",
  deviceInactive: "warning",
  lowBattery: "warning",
  maintenance: "warning",
  deviceFuelDrop: "warning",
  // info — normal operating chatter
  ignitionOn: "info",
  ignitionOff: "info",
  deviceMoving: "info",
  deviceStopped: "info",
  deviceOnline: "info",
  powerRestored: "info",
  deviceFuelIncrease: "info",
  commandResult: "info",
  textMessage: "info",
  driverChanged: "info",
  queuedCommandSent: "info",
};

/** `attributes.alarm` values that mean the vehicle is in trouble. */
const CRITICAL_ALARMS = new Set([
  "sos",
  "tow",
  "powerCut",
  "vibration",
  "shock",
  "accident",
  "crash",
  "jamming",
  "tampering",
  "removing",
  "fuelLeak",
  "overspeed",
  "fallDown",
]);

/** Alarms that are notable but not emergencies. */
const WARNING_ALARMS = new Set([
  "lowBattery",
  "lowPower",
  "powerOff",
  "powerRestored",
  "hardAcceleration",
  "hardBraking",
  "hardCornering",
  "fault",
  "temperature",
  "movement",
  "idle",
  "parking",
  "geofence",
  "geofenceEnter",
  "geofenceExit",
  "maintenance",
]);

/** The specific alarm carried by an `alarm` event, if it named one. */
export function alarmKind(
  attributes?: Record<string, unknown> | null,
): string | null {
  const alarm = attributes?.alarm;
  return typeof alarm === "string" && alarm.length > 0 ? alarm : null;
}

/**
 * How loudly an event should be shown. `alarm` events defer to their specific
 * `attributes.alarm`; an alarm we don't recognise is treated as critical
 * rather than quietly buried.
 */
export function classify(
  type: string,
  attributes?: Record<string, unknown> | null,
): Severity {
  if (type === "alarm") {
    const alarm = alarmKind(attributes);
    if (!alarm) return "critical";
    if (CRITICAL_ALARMS.has(alarm)) return "critical";
    if (WARNING_ALARMS.has(alarm)) return "warning";
    // An alarm we have no rule for is still an alarm — never bury it in "info".
    return "critical";
  }
  return TYPE_SEVERITY[type] ?? "info";
}

/** classify() for a whole row. */
export function severityOf(row: TraccarEventRow): Severity {
  return classify(row.type, row.attributes);
}

export interface SeverityCounts {
  total: number;
  critical: number;
  warning: number;
  info: number;
}

/** Totals per severity for the stat cards and the filter chips. */
export function severityCounts(rows: TraccarEventRow[]): SeverityCounts {
  const counts: SeverityCounts = {
    total: rows.length,
    critical: 0,
    warning: 0,
    info: 0,
  };
  for (const row of rows) counts[severityOf(row)] += 1;
  return counts;
}

/** Keep only the rows matching a severity (or everything for `null`). */
export function filterBySeverity(
  rows: TraccarEventRow[],
  severity: Severity | null,
): TraccarEventRow[] {
  return severity ? rows.filter((row) => severityOf(row) === severity) : rows;
}

/* --------------------------------- Labels --------------------------------- */

/** Event types lib/i18n.ts has wording for, under `evt.*`. */
const KNOWN_TYPES = new Set([
  "deviceOnline",
  "deviceOffline",
  "deviceMoving",
  "deviceStopped",
  "deviceOverspeed",
  "deviceFuelDrop",
  "deviceFuelIncrease",
  "deviceUnknown",
  "deviceInactive",
  "ignitionOn",
  "ignitionOff",
  "geofenceEnter",
  "geofenceExit",
  "alarm",
  "commandResult",
  "maintenance",
  "textMessage",
  "driverChanged",
  "powerCut",
  "powerRestored",
]);

/** Alarm kinds with wording under `alarm.*`. */
const KNOWN_ALARMS = new Set([
  "sos",
  "tow",
  "powerCut",
  "powerRestored",
  "vibration",
  "shock",
  "lowBattery",
  "lowPower",
  "overspeed",
  "movement",
  "accident",
  "jamming",
  "tampering",
  "removing",
  "fuelLeak",
  "temperature",
  "fault",
  "hardAcceleration",
  "hardBraking",
  "hardCornering",
  "geofence",
  "idle",
]);

/**
 * The human name of an event in the active language.
 *
 * `alarm` rows prefer the specific alarm ("SOS", "Tow") over the generic word;
 * an alarm we have no wording for is shown as "Alarm: <raw>", and an unknown
 * event type falls back to Traccar's raw type so nothing renders blank.
 */
export function eventLabel(row: TraccarEventRow, t: Translate): string {
  if (row.type === "alarm") {
    const alarm = alarmKind(row.attributes);
    if (alarm) {
      return KNOWN_ALARMS.has(alarm)
        ? t(`alarm.${alarm}`)
        : `${t("evt.alarm")}: ${alarm}`;
    }
    return t("evt.alarm");
  }
  return KNOWN_TYPES.has(row.type) ? t(`evt.${row.type}`) : row.type;
}

/** Zone name for a geofence event, or "#id" when the zone was deleted. */
export function geofenceLabel(
  row: TraccarEventRow,
  names: Map<number, string>,
): string | null {
  if (!row.geofenceId) return null;
  return names.get(row.geofenceId) ?? `#${row.geofenceId}`;
}

/* ------------------------------ Day grouping ------------------------------ */

/** Stable "YYYY-MM-DD" bucket key in fleet-local time. */
const DAY_KEY = new Intl.DateTimeFormat("en-CA", {
  timeZone: FLEET_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** "Sat, 15 Aug 2026" — the day heading. */
const DAY_LABEL = new Intl.DateTimeFormat("en-GB", {
  timeZone: FLEET_TIME_ZONE,
  weekday: "short",
  day: "2-digit",
  month: "short",
  year: "numeric",
});

const DAY_MS = 24 * 60 * 60 * 1000;

/** ISO timestamp -> fleet-local day key, or null when unparseable. */
export function dayKey(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(+d) ? null : DAY_KEY.format(d);
}

export interface EventDay {
  /** Fleet-local "YYYY-MM-DD". */
  key: string;
  /** "Today" / "Yesterday" / "Sat, 15 Aug 2026". */
  label: string;
  rows: TraccarEventRow[];
}

/**
 * Rows bucketed by calendar day in Asia/Baghdad, newest day first and newest
 * row first inside each day. Today and yesterday get relative headings.
 */
export function groupByDay(
  rows: TraccarEventRow[],
  t: Translate,
  now: Date = new Date(),
): EventDay[] {
  const today = DAY_KEY.format(now);
  const yesterday = DAY_KEY.format(new Date(+now - DAY_MS));

  const buckets = new Map<string, TraccarEventRow[]>();
  for (const row of rows) {
    const key = dayKey(row.eventTime);
    if (!key) continue;
    const bucket = buckets.get(key);
    if (bucket) bucket.push(row);
    else buckets.set(key, [row]);
  }

  return [...buckets.entries()]
    .sort((a, b) => (a[0] < b[0] ? 1 : a[0] > b[0] ? -1 : 0))
    .map(([key, dayRows]) => {
      const sorted = [...dayRows].sort(byNewest);
      const label =
        key === today
          ? t("rep.today")
          : key === yesterday
            ? t("rep.yesterday")
            : DAY_LABEL.format(new Date(sorted[0].eventTime));
      return { key, label, rows: sorted };
    });
}

/* ------------------------------- Read state ------------------------------- */
//
// Traccar has no per-user "read" flag on events, so acknowledgement lives in
// the browser. Ids are monotonic, so keeping the highest N keeps the newest N
// and the key can never grow without bound.

export const READ_STORAGE_KEY = "carva.alerts.read";

/** Individually remembered ids; anything older collapses into `floor`. */
export const READ_CAP = 2000;

/** Fired on window after markRead/markAllRead so the sidebar badge re-reads. */
export const ALERTS_READ_EVENT = "carva:alerts-read";

/**
 * Acknowledged events.
 *
 * Ids are kept individually up to READ_CAP. Traccar ids are monotonic, so
 * whatever the cap pushes off the end is strictly older than the newest
 * READ_CAP acknowledgements and is remembered as a single `floor` watermark
 * instead. Storing only the capped list would silently drop those
 * acknowledgements: a period holding more events than the cap would keep its
 * oldest rows flagged "New" forever and leave "Mark all read" enabled but
 * inert, because every click would re-drop the same ids.
 */
export interface ReadState {
  /** Every id at or below this counts as acknowledged. 0 = no watermark yet. */
  floor: number;
  /** Ids acknowledged above the watermark. */
  ids: Set<number>;
}

/** A fresh, empty acknowledgement set — safe as React initial state. */
export function emptyRead(): ReadState {
  return { floor: 0, ids: new Set() };
}

/** Has this event been acknowledged? */
export function isRead(state: ReadState, id: number): boolean {
  return id <= state.floor || state.ids.has(id);
}

function toIdSet(values: unknown[]): Set<number> {
  return new Set(
    values.filter(
      (id): id is number => typeof id === "number" && Number.isFinite(id),
    ),
  );
}

/** Acknowledged events. Always empty on the server. */
export function readState(): ReadState {
  if (typeof window === "undefined") return emptyRead();
  try {
    const raw = window.localStorage.getItem(READ_STORAGE_KEY);
    if (!raw) return emptyRead();
    const parsed: unknown = JSON.parse(raw);
    // The first release stored a bare array; keep those acknowledgements.
    if (Array.isArray(parsed)) return { floor: 0, ids: toIdSet(parsed) };
    if (parsed !== null && typeof parsed === "object") {
      const stored = parsed as { floor?: unknown; ids?: unknown };
      return {
        floor:
          typeof stored.floor === "number" && Number.isFinite(stored.floor)
            ? stored.floor
            : 0,
        ids: toIdSet(Array.isArray(stored.ids) ? stored.ids : []),
      };
    }
    return emptyRead();
  } catch {
    // Corrupt or unavailable storage must never break the page.
    return emptyRead();
  }
}

/** Persist, collapsing anything past the cap into the watermark. */
function persist(state: ReadState): ReadState {
  let floor = state.floor;
  let ids = [...state.ids].filter((id) => id > floor).sort((a, b) => b - a);
  if (ids.length > READ_CAP) {
    // The highest id being dropped becomes the new watermark, so the
    // acknowledgements below it survive as a single number.
    floor = Math.max(floor, ids[READ_CAP]);
    ids = ids.slice(0, READ_CAP);
  }

  const next: ReadState = { floor, ids: new Set(ids) };
  if (typeof window === "undefined") return next;
  try {
    window.localStorage.setItem(
      READ_STORAGE_KEY,
      JSON.stringify({ floor, ids }),
    );
  } catch {
    /* private mode / quota — acknowledgement is best-effort */
  }
  window.dispatchEvent(new Event(ALERTS_READ_EVENT));
  return next;
}

/** Acknowledge specific events. Returns the new state for React. */
export function markRead(ids: Iterable<number>): ReadState {
  const current = readState();
  const next = new Set(current.ids);
  for (const id of ids) {
    if (Number.isFinite(id)) next.add(id);
  }
  return persist({ floor: current.floor, ids: next });
}

/**
 * Acknowledge every row of the loaded period — including any hidden by an
 * active severity filter, which is what the "Unread" stat and the button's
 * disabled state are both counted over.
 */
export function markAllRead(rows: TraccarEventRow[]): ReadState {
  return markRead(rows.map((row) => row.id));
}

/** Forget all acknowledgements (used by tests and the settings reset). */
export function clearRead(): ReadState {
  return persist(emptyRead());
}

/** How many of these rows have not been acknowledged yet. */
export function unreadCount(
  rows: TraccarEventRow[],
  read: ReadState = readState(),
): number {
  let count = 0;
  for (const row of rows) if (!isRead(read, row.id)) count += 1;
  return count;
}

/* ---------------------------- Sidebar badge hook --------------------------- */

export interface UnreadBadgeOptions {
  /** Skip polling entirely (e.g. while signed out). Default true. */
  enabled?: boolean;
  /** How far back the badge looks. Default 24 hours. */
  windowHours?: number;
  /** Refresh interval. Default 60 s. */
  pollMs?: number;
  /** Which severities count. Default critical + warning. */
  severities?: readonly Severity[];
}

const BADGE_WINDOW_HOURS = 24;
const BADGE_POLL_MS = 60_000;

/**
 * Live unread count for the sidebar badge: unacknowledged critical/warning
 * events across the whole fleet in the last 24 hours.
 *
 * Polls quietly, fails closed (0 rather than a stale number) and updates the
 * instant the Alerts page marks something read — in this tab via
 * ALERTS_READ_EVENT, in other tabs via the storage event.
 */
export function useUnreadAlertCount(options: UnreadBadgeOptions = {}): number {
  const {
    enabled = true,
    windowHours = BADGE_WINDOW_HOURS,
    pollMs = BADGE_POLL_MS,
  } = options;
  const severityKey = (options.severities ?? ACTIONABLE).join(",");

  const [rows, setRows] = React.useState<TraccarEventRow[]>([]);
  const [read, setRead] = React.useState<ReadState>(emptyRead);

  // Acknowledgements: hydrate on mount, then follow both event channels.
  React.useEffect(() => {
    const sync = () => setRead(readState());
    sync();
    window.addEventListener(ALERTS_READ_EVENT, sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener(ALERTS_READ_EVENT, sync);
      window.removeEventListener("storage", sync);
    };
  }, []);

  React.useEffect(() => {
    if (!enabled) {
      setRows([]);
      return;
    }
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const controller = new AbortController();

    async function tick() {
      try {
        const devices = await fetchDevices(controller.signal);
        const to = new Date();
        const from = new Date(+to - windowHours * 60 * 60 * 1000);
        const fetched = await fetchEvents({
          deviceIds: devices.map((d) => d.id),
          from,
          to,
          signal: controller.signal,
        });
        if (alive) setRows(fetched);
      } catch {
        // Signed out, offline or aborted — show nothing rather than a stale badge.
        if (alive) setRows([]);
      } finally {
        if (alive) timer = setTimeout(tick, pollMs);
      }
    }

    void tick();
    return () => {
      alive = false;
      controller.abort();
      if (timer) clearTimeout(timer);
    };
  }, [enabled, windowHours, pollMs]);

  return React.useMemo(() => {
    const wanted = new Set(severityKey.split(",") as Severity[]);
    return unreadCount(
      rows.filter((row) => wanted.has(severityOf(row))),
      read,
    );
  }, [rows, read, severityKey]);
}
