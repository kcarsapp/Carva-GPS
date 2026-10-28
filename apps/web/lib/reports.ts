// Formatting + aggregation helpers for the fleet Statistics page.
//
// Everything here is pure: rows in, display strings out. Traccar units are
// METRES for distance, KNOTS for speed and MILLISECONDS for durations, so all
// conversion happens in one place instead of inside the table markup.

import { knotsToKmh, type TraccarEvent } from "@carva/shared";

/** The translator from useI18n(), passed in so these helpers stay pure. */
export type Translate = (key: string) => string;

/** All timestamps render in fleet-local time. */
const BAGHDAD = "Asia/Baghdad";
/** Iraq dropped DST in 2008, so Baghdad is a fixed +03:00 all year round. */
const BAGHDAD_OFFSET = "+03:00";
const DAY_MS = 24 * 60 * 60 * 1000;
/** Above this span the per-day chart stops padding empty days. */
const MAX_CHART_DAYS = 62;

/* ------------------------------- Fleet time ------------------------------- */

const DAY_FORMAT = new Intl.DateTimeFormat("en-CA", {
  timeZone: BAGHDAD,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** ISO timestamp -> "YYYY-MM-DD" in fleet-local time. */
function dayKey(iso?: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(+d) ? null : DAY_FORMAT.format(d);
}

/** The instant midnight began in Baghdad on a "YYYY-MM-DD" day key. */
function baghdadDayStart(day: string): Date {
  return new Date(`${day}T00:00:00.000${BAGHDAD_OFFSET}`);
}

/**
 * A `<input type="datetime-local">` value read as Baghdad wall-clock time
 * rather than the browser's, so a custom range covers the hours the tables
 * actually print. Returns null for anything unparseable.
 */
export function parseFleetLocal(value: string): Date | null {
  // "YYYY-MM-DDTHH:MM", plus the seconds some browsers append at finer steps.
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?$/.exec(
    value.trim(),
  );
  if (!m) return null;
  const d = new Date(
    `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6] ?? "00"}.000${BAGHDAD_OFFSET}`,
  );
  return Number.isNaN(+d) ? null : d;
}

/* ------------------------------- Report rows ------------------------------ */

/** GET /api/traccar/reports/summary */
export interface SummaryRow {
  deviceId: number;
  deviceName?: string;
  /** Metres. */
  distance: number;
  /** Knots. */
  averageSpeed: number;
  /** Knots — legitimately 0 for a vehicle that never moved. */
  maxSpeed: number;
  /** Litres. */
  spentFuel: number;
  /** Metres. */
  startOdometer: number;
  /** Metres. */
  endOdometer: number;
  startTime: string;
  endTime: string;
  /** Milliseconds. */
  engineHours: number;
}

/** GET /api/traccar/reports/trips */
export interface TripRow {
  deviceId?: number;
  deviceName?: string;
  startTime: string;
  endTime: string;
  /** Metres. */
  distance: number;
  /** Knots. */
  averageSpeed: number;
  /** Knots. */
  maxSpeed: number;
  startLat: number;
  startLon: number;
  endLat: number;
  endLon: number;
  startAddress?: string | null;
  endAddress?: string | null;
  /** Milliseconds. */
  duration: number;
  driverName?: string | null;
}

/** GET /api/traccar/reports/stops */
export interface StopRow {
  deviceId?: number;
  deviceName?: string;
  startTime: string;
  endTime: string;
  /** Milliseconds. */
  duration: number;
  /**
   * Traccar names stop coordinates `lat`/`lon` here (unlike positions), and a
   * few builds spell them out — accept both, as the history page does.
   */
  lat?: number;
  lon?: number;
  latitude?: number;
  longitude?: number;
  address?: string | null;
  /** Milliseconds of engine time burnt while stopped. */
  engineHours: number;
}

/** GET /api/traccar/reports/events */
export type EventRow = TraccarEvent;

export type ReportKind = "summary" | "trips" | "stops" | "events";

/** Rows tagged with the report they came from. */
export type ReportData =
  | { kind: "summary"; rows: SummaryRow[] }
  | { kind: "trips"; rows: TripRow[] }
  | { kind: "stops"; rows: StopRow[] }
  | { kind: "events"; rows: EventRow[] };

/** Traccar path for each view, appended to /api/traccar/. */
export const REPORT_PATHS: Record<ReportKind, string> = {
  summary: "reports/summary",
  trips: "reports/trips",
  stops: "reports/stops",
  events: "reports/events",
};

/** Tag a raw payload with the view it was fetched for. */
export function toReportData(kind: ReportKind, rows: unknown[]): ReportData {
  switch (kind) {
    case "summary":
      return { kind, rows: rows as SummaryRow[] };
    case "trips":
      return { kind, rows: rows as TripRow[] };
    case "stops":
      return { kind, rows: rows as StopRow[] };
    case "events":
      return { kind, rows: rows as EventRow[] };
  }
}

export function emptyReport(kind: ReportKind): ReportData {
  return toReportData(kind, []);
}

/* --------------------------------- Periods -------------------------------- */

export type Period = "today" | "yesterday" | "week" | "month" | "custom";

export interface Range {
  from: Date;
  to: Date;
}

/**
 * Resolve a preset to an absolute range. Day boundaries are Baghdad midnights,
 * not the browser's — every timestamp on this page is printed in Baghdad, so a
 * window cut on the viewer's local day would return rows dated outside the
 * period they were asked for. Baghdad has no DST, so plain day arithmetic on
 * the epoch is exact.
 */
export function presetRange(
  period: Exclude<Period, "custom">,
  now: Date = new Date(),
): Range {
  const dayStart = baghdadDayStart(DAY_FORMAT.format(now));

  if (period === "today") return { from: dayStart, to: now };
  if (period === "yesterday") {
    return { from: new Date(+dayStart - DAY_MS), to: dayStart };
  }
  const from = new Date(+dayStart - (period === "week" ? 7 : 30) * DAY_MS);
  return { from, to: now };
}

/* -------------------------------- Formatting ------------------------------ */

function finite(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

/** "16 Aug, 14:32" in Asia/Baghdad, or an em dash for missing input. */
export function formatDateTime(iso?: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(+d)) return "—";
  return d.toLocaleString("en-GB", {
    timeZone: BAGHDAD,
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** Metres -> "12.3 km". */
export function formatKm(meters: unknown, t: Translate): string {
  const m = finite(meters);
  return m == null ? "—" : `${(m / 1000).toFixed(1)} ${t("rep.unit.km")}`;
}

/** Knots -> "84 km/h". 0 is a real reading, not a gap. */
export function formatSpeed(knots: unknown, t: Translate): string {
  const kn = finite(knots);
  return kn == null ? "—" : `${knotsToKmh(kn)} ${t("rep.unit.kmh")}`;
}

/** Milliseconds -> "2h 14m". */
export function formatDuration(ms: unknown, t: Translate): string {
  const value = finite(ms);
  if (value == null || value < 0) return "—";
  const minutes = Math.round(value / 60000);
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return hours > 0
    ? `${hours}${t("rep.unit.h")} ${rest}${t("rep.unit.m")}`
    : `${rest}${t("rep.unit.m")}`;
}

/** Litres -> "8.4 L". Trackers without a fuel sensor report 0. */
export function formatLitres(litres: unknown, t: Translate): string {
  const l = finite(litres);
  return l == null ? "—" : `${l.toFixed(1)} ${t("rep.unit.l")}`;
}

/** Reverse-geocoded address, falling back to the raw fix. */
export function formatPlace(
  address: string | null | undefined,
  lat: unknown,
  lon: unknown,
): string {
  if (address) return address;
  const a = finite(lat);
  const b = finite(lon);
  return a != null && b != null ? `${a.toFixed(4)}, ${b.toFixed(4)}` : "—";
}

/* ------------------------------- Event types ------------------------------ */

/** Event types we have wording for; anything else shows Traccar's raw type. */
const KNOWN_EVENT_TYPES = new Set([
  "ignitionOn",
  "ignitionOff",
  "deviceOnline",
  "deviceOffline",
  "deviceMoving",
  "deviceStopped",
  "geofenceEnter",
  "geofenceExit",
  "alarm",
  "deviceOverspeed",
]);

export function eventTypeLabel(type: string, t: Translate): string {
  return KNOWN_EVENT_TYPES.has(type) ? t(`evt.${type}`) : type;
}

/** The interesting bits of an event's attribute bag, as one line. */
function eventDetails(row: EventRow, t: Translate): string {
  const attrs = row.attributes ?? {};
  const parts: string[] = [];
  if (typeof attrs.alarm === "string") parts.push(attrs.alarm);
  if (finite(attrs.speed) != null) parts.push(formatSpeed(attrs.speed, t));
  if (finite(attrs.speedLimit) != null) {
    parts.push(`${t("rep.limit")} ${formatSpeed(attrs.speedLimit, t)}`);
  }
  if (row.geofenceId) parts.push(`${t("rep.geofence")} #${row.geofenceId}`);
  return parts.length > 0 ? parts.join(" · ") : "—";
}

/* --------------------------------- Columns -------------------------------- */

export interface ReportColumn<T> {
  /** Stable identifier, also the React key. */
  key: string;
  /** Translated header text. */
  header: string;
  /** Formatted cell text. */
  cell: (row: T) => string;
  /** Classes applied to both the header and the body cell. */
  className?: string;
}

/** Resolves a display name for a row's device (rows may omit deviceName). */
export type DeviceLabel = (deviceId?: number, deviceName?: string) => string;

const NUM = "tabular-nums";
/** Secondary columns, dropped on narrow screens but kept in the CSV. */
const WIDE = "hidden xl:table-cell";

export function summaryColumns(
  t: Translate,
  deviceLabel: DeviceLabel,
): ReportColumn<SummaryRow>[] {
  return [
    {
      key: "vehicle",
      header: t("rep.col.vehicle"),
      cell: (r) => deviceLabel(r.deviceId, r.deviceName),
      className: "font-medium",
    },
    {
      key: "distance",
      header: t("rep.col.distance"),
      cell: (r) => formatKm(r.distance, t),
      className: NUM,
    },
    {
      key: "avgSpeed",
      header: t("rep.col.avgSpeed"),
      cell: (r) => formatSpeed(r.averageSpeed, t),
      className: NUM,
    },
    {
      key: "maxSpeed",
      header: t("rep.col.maxSpeed"),
      cell: (r) => formatSpeed(r.maxSpeed, t),
      className: NUM,
    },
    {
      key: "engineHours",
      header: t("rep.col.engineHours"),
      cell: (r) => formatDuration(r.engineHours, t),
      className: NUM,
    },
    {
      key: "odometer",
      header: t("rep.col.odometer"),
      cell: (r) => formatKm(r.endOdometer, t),
      className: `${WIDE} ${NUM}`,
    },
    {
      key: "fuel",
      header: t("rep.col.fuel"),
      cell: (r) => formatLitres(r.spentFuel, t),
      className: `${WIDE} ${NUM}`,
    },
  ];
}

export function tripColumns(
  t: Translate,
  deviceLabel: DeviceLabel,
): ReportColumn<TripRow>[] {
  return [
    {
      key: "vehicle",
      header: t("rep.col.vehicle"),
      cell: (r) => deviceLabel(r.deviceId, r.deviceName),
      className: "font-medium",
    },
    {
      key: "start",
      header: t("rep.col.start"),
      cell: (r) => formatDateTime(r.startTime),
      className: NUM,
    },
    {
      key: "end",
      header: t("rep.col.end"),
      cell: (r) => formatDateTime(r.endTime),
      className: NUM,
    },
    {
      key: "duration",
      header: t("rep.col.duration"),
      cell: (r) => formatDuration(r.duration, t),
      className: NUM,
    },
    {
      key: "distance",
      header: t("rep.col.distance"),
      cell: (r) => formatKm(r.distance, t),
      className: NUM,
    },
    {
      key: "maxSpeed",
      header: t("rep.col.maxSpeed"),
      cell: (r) => formatSpeed(r.maxSpeed, t),
      className: NUM,
    },
    {
      key: "from",
      header: t("rep.col.from"),
      cell: (r) => formatPlace(r.startAddress, r.startLat, r.startLon),
      className: `${WIDE} max-w-[220px] truncate`,
    },
    {
      key: "to",
      header: t("rep.col.to"),
      cell: (r) => formatPlace(r.endAddress, r.endLat, r.endLon),
      className: `${WIDE} max-w-[220px] truncate`,
    },
    {
      key: "driver",
      header: t("rep.col.driver"),
      cell: (r) => r.driverName || "—",
      className: WIDE,
    },
  ];
}

export function stopColumns(
  t: Translate,
  deviceLabel: DeviceLabel,
): ReportColumn<StopRow>[] {
  return [
    {
      key: "vehicle",
      header: t("rep.col.vehicle"),
      cell: (r) => deviceLabel(r.deviceId, r.deviceName),
      className: "font-medium",
    },
    {
      key: "start",
      header: t("rep.col.start"),
      cell: (r) => formatDateTime(r.startTime),
      className: NUM,
    },
    {
      key: "end",
      header: t("rep.col.end"),
      cell: (r) => formatDateTime(r.endTime),
      className: NUM,
    },
    {
      key: "duration",
      header: t("rep.col.duration"),
      cell: (r) => formatDuration(r.duration, t),
      className: NUM,
    },
    {
      key: "location",
      header: t("rep.col.location"),
      cell: (r) =>
        formatPlace(r.address, r.lat ?? r.latitude, r.lon ?? r.longitude),
      className: "max-w-[260px] truncate",
    },
    {
      key: "engineHours",
      header: t("rep.col.engineHours"),
      cell: (r) => formatDuration(r.engineHours, t),
      className: `${WIDE} ${NUM}`,
    },
  ];
}

export function eventColumns(
  t: Translate,
  deviceLabel: DeviceLabel,
): ReportColumn<EventRow>[] {
  return [
    {
      key: "time",
      header: t("rep.col.time"),
      cell: (r) => formatDateTime(r.eventTime),
      className: NUM,
    },
    {
      key: "vehicle",
      header: t("rep.col.vehicle"),
      cell: (r) => deviceLabel(r.deviceId),
      className: "font-medium",
    },
    {
      key: "event",
      header: t("rep.col.event"),
      cell: (r) => eventTypeLabel(r.type, t),
    },
    {
      key: "details",
      header: t("rep.col.details"),
      cell: (r) => eventDetails(r, t),
      className: "max-w-[260px] truncate text-muted-foreground",
    },
  ];
}

/** Headers + formatted rows for whichever report is loaded. */
export function reportTable(
  data: ReportData,
  t: Translate,
  deviceLabel: DeviceLabel,
): ReportTableData {
  switch (data.kind) {
    case "summary":
      return toTableData(summaryColumns(t, deviceLabel), data.rows);
    case "trips":
      return toTableData(tripColumns(t, deviceLabel), data.rows);
    case "stops":
      return toTableData(stopColumns(t, deviceLabel), data.rows);
    case "events":
      return toTableData(eventColumns(t, deviceLabel), data.rows);
  }
}

/* ------------------------------- Table + CSV ------------------------------ */

/**
 * A rendered table: headers plus pre-formatted cells. Flattening here keeps the
 * table component free of row generics and lets the CSV export re-use exactly
 * what the user sees.
 */
export interface ReportTableData {
  headers: string[];
  rows: string[][];
  /** Per-column classes, aligned with `headers`. */
  classNames: (string | undefined)[];
}

export function toTableData<T>(
  columns: ReportColumn<T>[],
  rows: T[],
): ReportTableData {
  return {
    headers: columns.map((c) => c.header),
    classNames: columns.map((c) => c.className),
    rows: rows.map((row) => columns.map((c) => c.cell(row))),
  };
}

/** RFC 4180 CSV of the table exactly as rendered. */
export function buildCsv(table: ReportTableData): string {
  const cell = (value: string) =>
    /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
  return [table.headers, ...table.rows]
    .map((row) => row.map(cell).join(","))
    .join("\r\n");
}

export function reportFileName(kind: ReportKind, range: Range | null): string {
  const stamp = range
    ? `${dayKey(range.from.toISOString()) ?? ""}_${dayKey(range.to.toISOString()) ?? ""}`
    : "";
  return `carva-${kind}${stamp ? `-${stamp}` : ""}.csv`;
}

/* ---------------------------------- Stats --------------------------------- */

export interface StatCard {
  label: string;
  value: string;
}

/** Raw totals for the loaded report; null means "this view can't tell". */
export interface ReportStats {
  /** Metres. */
  distance: number | null;
  /** Milliseconds spent driving. */
  drivingTime: number | null;
  /** Knots. */
  maxSpeed: number | null;
  trips: number | null;
  stops: number | null;
  /** Milliseconds. */
  engineHours: number | null;
  events: number | null;
}

const EMPTY_STATS: ReportStats = {
  distance: null,
  drivingTime: null,
  maxSpeed: null,
  trips: null,
  stops: null,
  engineHours: null,
  events: null,
};

function sum<T>(rows: T[], pick: (row: T) => unknown): number {
  return rows.reduce<number>((acc, row) => acc + (finite(pick(row)) ?? 0), 0);
}

function max<T>(rows: T[], pick: (row: T) => unknown): number | null {
  let best: number | null = null;
  for (const row of rows) {
    const v = finite(pick(row));
    if (v != null && (best == null || v > best)) best = v;
  }
  return best;
}

export function computeStats(data: ReportData): ReportStats {
  if (data.rows.length === 0) return EMPTY_STATS;

  switch (data.kind) {
    case "summary":
      return {
        ...EMPTY_STATS,
        distance: sum(data.rows, (r) => r.distance),
        maxSpeed: max(data.rows, (r) => r.maxSpeed),
        engineHours: sum(data.rows, (r) => r.engineHours),
      };
    case "trips":
      return {
        ...EMPTY_STATS,
        distance: sum(data.rows, (r) => r.distance),
        drivingTime: sum(data.rows, (r) => r.duration),
        maxSpeed: max(data.rows, (r) => r.maxSpeed),
        trips: data.rows.length,
      };
    case "stops":
      return {
        ...EMPTY_STATS,
        stops: data.rows.length,
        engineHours: sum(data.rows, (r) => r.engineHours),
      };
    case "events":
      return { ...EMPTY_STATS, events: data.rows.length };
  }
}

/** Stat cards for the loaded report — metrics it can't fill are left out. */
export function statCards(data: ReportData, t: Translate): StatCard[] {
  const stats = computeStats(data);
  const cards: StatCard[] = [];

  if (stats.distance != null) {
    cards.push({
      label: t("rep.stat.distance"),
      value: formatKm(stats.distance, t),
    });
  }
  if (stats.drivingTime != null) {
    cards.push({
      label: t("rep.stat.driving"),
      value: formatDuration(stats.drivingTime, t),
    });
  }
  if (stats.maxSpeed != null) {
    cards.push({
      label: t("rep.stat.maxSpeed"),
      value: formatSpeed(stats.maxSpeed, t),
    });
  }
  if (stats.trips != null) {
    cards.push({ label: t("rep.stat.trips"), value: String(stats.trips) });
  }
  if (stats.stops != null) {
    cards.push({ label: t("rep.stat.stops"), value: String(stats.stops) });
  }
  if (stats.engineHours != null) {
    cards.push({
      label: t("rep.stat.engineHours"),
      value: formatDuration(stats.engineHours, t),
    });
  }
  if (stats.events != null) {
    cards.push({ label: t("rep.stat.events"), value: String(stats.events) });
  }
  return cards;
}

/* ------------------------------ Per-day chart ----------------------------- */

export interface DayBucket {
  /** Day key in Asia/Baghdad, e.g. "2026-08-16". */
  day: string;
  /** Day of month — the compact axis label. */
  label: string;
  km: number;
}

/** Every day between two keys inclusive, so idle days keep their slot. */
function daySpan(first: string, last: string): string[] {
  const start = Date.parse(`${first}T00:00:00Z`);
  const end = Date.parse(`${last}T00:00:00Z`);
  if (Number.isNaN(start) || Number.isNaN(end)) return [first];
  const days = Math.round((end - start) / DAY_MS) + 1;
  if (days > MAX_CHART_DAYS) return [];
  return Array.from({ length: days }, (_, i) =>
    new Date(start + i * DAY_MS).toISOString().slice(0, 10),
  );
}

/** Kilometres driven per day, derived from trips. */
export function dailyDistance(trips: TripRow[]): DayBucket[] {
  const totals = new Map<string, number>();
  for (const trip of trips) {
    const day = dayKey(trip.startTime);
    if (!day) continue;
    totals.set(day, (totals.get(day) ?? 0) + (finite(trip.distance) ?? 0) / 1000);
  }
  if (totals.size === 0) return [];

  const seen = [...totals.keys()].sort();
  const days = daySpan(seen[0], seen[seen.length - 1]);
  return (days.length > 0 ? days : seen).map((day) => ({
    day,
    label: String(Number(day.slice(8, 10))),
    km: totals.get(day) ?? 0,
  }));
}
