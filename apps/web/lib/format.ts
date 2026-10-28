// Shared display formatters for live tracker data.
//
// Traccar's raw units are knots (speed), metres (distance) and milliseconds
// (durations/engine hours). Every surface that shows telemetry — the vehicle
// inspector, device rows, reports — must format them identically, so the rules
// live here rather than being re-derived per component.

/** The fleet operates in Iraq; timestamps are shown in Baghdad local time. */
export const FLEET_TIME_ZONE = "Asia/Baghdad";

/* ------------------------------- distance -------------------------------- */

/** Metres → "12.4 km" (or "840 m" below a kilometre). */
export function formatDistance(metres: number | undefined | null): string {
  if (metres == null || !Number.isFinite(metres)) return "—";
  if (Math.abs(metres) < 1000) return `${Math.round(metres)} m`;
  const km = metres / 1000;
  return `${km >= 100 ? Math.round(km).toLocaleString() : km.toFixed(1)} km`;
}

/** Metres → whole kilometres, for odometer-style readouts. */
export function formatOdometer(metres: number | undefined | null): string {
  if (metres == null || !Number.isFinite(metres)) return "—";
  return `${Math.round(metres / 1000).toLocaleString()} km`;
}

/* --------------------------------- speed --------------------------------- */

/** Knots (Traccar's unit) → "84 km/h". */
export function formatSpeed(knots: number | undefined | null): string {
  if (knots == null || !Number.isFinite(knots)) return "—";
  return `${Math.round(knots * 1.852)} km/h`;
}

/* ------------------------------- durations ------------------------------- */

/** Milliseconds → "2h 14m" / "45m" / "38s". */
export function formatDuration(ms: number | undefined | null): string {
  if (ms == null || !Number.isFinite(ms) || ms < 0) return "—";
  const totalMinutes = Math.floor(ms / 60000);
  if (totalMinutes < 1) return `${Math.floor(ms / 1000)}s`;
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours === 0) return `${minutes}m`;
  if (hours < 24) return `${hours}h ${minutes}m`;
  return `${Math.floor(hours / 24)}d ${hours % 24}h`;
}

/** Milliseconds of engine runtime → "506 h". */
export function formatEngineHours(ms: number | undefined | null): string {
  if (ms == null || !Number.isFinite(ms)) return "—";
  return `${Math.round(ms / 3_600_000).toLocaleString()} h`;
}

/* ------------------------------- timestamps ------------------------------ */

/** ISO string → "15 Aug, 22:16" in fleet-local time. */
export function formatDateTime(iso: string | undefined | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(+d)) return "—";
  return d.toLocaleString("en-GB", {
    timeZone: FLEET_TIME_ZONE,
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** ISO string → "15 Aug 2026, 22:16:53" in fleet-local time. */
export function formatDateTimeLong(iso: string | undefined | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(+d)) return "—";
  return d.toLocaleString("en-GB", {
    timeZone: FLEET_TIME_ZONE,
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

/**
 * Compact age of a timestamp: "now", "4m", "3h", "2d".
 * Returned bare (no "ago") so callers can compose their own translated phrase.
 */
export function formatAge(iso: string | undefined | null, now = Date.now()): string {
  if (!iso) return "—";
  const then = +new Date(iso);
  if (Number.isNaN(then)) return "—";
  const seconds = Math.max(0, Math.round((now - then) / 1000));
  if (seconds < 60) return "now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

/* -------------------------------- sensors -------------------------------- */

export type SignalTier = "poor" | "fair" | "good" | "excellent";

/** jt808/gt06 RSSI (roughly 0–31) → a qualitative tier, as MiCODUS shows. */
export function signalTier(rssi: number | undefined | null): SignalTier | null {
  if (rssi == null || !Number.isFinite(rssi)) return null;
  if (rssi < 8) return "poor";
  if (rssi < 16) return "fair";
  if (rssi < 24) return "good";
  return "excellent";
}

const COMPASS = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"] as const;

/** Heading in degrees → 8-point compass abbreviation. */
export function cardinal(deg: number | undefined | null): string {
  if (deg == null || !Number.isFinite(deg)) return "—";
  const normalized = ((deg % 360) + 360) % 360;
  return COMPASS[Math.round(normalized / 45) % 8];
}

/** Volts → "13.2 V". */
export function formatVoltage(v: number | undefined | null): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return `${v.toFixed(1)} V`;
}

/**
 * External power is considered connected when the tracker reports a plausible
 * vehicle-supply voltage; below that it is running on its internal battery.
 */
export function powerConnected(volts: number | undefined | null): boolean | null {
  if (volts == null || !Number.isFinite(volts)) return null;
  return volts >= 6;
}
