// Speed-camera and speed-bump alerts, as written by the mailer
// (infra/automation/mailer.js, handleRoadSegment) and served by
// /api/road-alerts. Plain module: the route sanitises with it, and the Alerts
// page turns the records into rows of its normal event feed.

import type { TraccarEventRow } from "@/lib/events";
import type { Translate } from "@/lib/reports";

export type RoadAlertKind = "speedCamera" | "roadBumps";

export interface RoadAlertRecord {
  /** Stable: Traccar position id × 8 + n. Positive here, negated in the feed. */
  id: number;
  kind: RoadAlertKind;
  ts: string;
  deviceId: number;
  positionId?: number;
  lat: number;
  lng: number;
  /** Lowest speed seen around the hazard (the conservative estimate). */
  speedKmh: number;
  hazardId: string;
  hazardName?: string;
  /** speedCamera: the limit it enforces. */
  limitKmh?: number;
  /** roadBumps: fast crossings so far that day, and the speed that counts. */
  count?: number;
  thresholdKmh?: number;
  fastestKmh?: number;
}

function finite(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

export function sanitizeRoadAlert(raw: unknown): RoadAlertRecord | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (r.kind !== "speedCamera" && r.kind !== "roadBumps") return null;
  if (!finite(r.id) || !finite(r.deviceId) || typeof r.ts !== "string") return null;
  if (!finite(r.lat) || !finite(r.lng) || !finite(r.speedKmh)) return null;
  return {
    id: r.id,
    kind: r.kind,
    ts: r.ts,
    deviceId: r.deviceId,
    positionId: finite(r.positionId) ? r.positionId : undefined,
    lat: r.lat,
    lng: r.lng,
    speedKmh: r.speedKmh,
    hazardId: typeof r.hazardId === "string" ? r.hazardId : "",
    hazardName: typeof r.hazardName === "string" ? r.hazardName : undefined,
    limitKmh: finite(r.limitKmh) ? r.limitKmh : undefined,
    count: finite(r.count) ? r.count : undefined,
    thresholdKmh: finite(r.thresholdKmh) ? r.thresholdKmh : undefined,
    fastestKmh: finite(r.fastestKmh) ? r.fastestKmh : undefined,
  };
}

/**
 * A record as a row of the Alerts feed. The id is negated so it can never
 * collide with a Traccar event id in the page's read-state store.
 */
export function roadAlertToRow(rec: RoadAlertRecord): TraccarEventRow {
  return {
    id: -rec.id,
    type: rec.kind,
    eventTime: rec.ts,
    deviceId: rec.deviceId,
    positionId: rec.positionId,
    attributes: { ...rec, roadAlert: true },
  };
}

export function isRoadAlertRow(row: TraccarEventRow): boolean {
  return row.attributes?.roadAlert === true;
}

/** Feed rows for these vehicles and window. Throws on a non-2xx answer. */
export async function fetchRoadAlertRows(options: {
  deviceIds: Array<number | string>;
  from: Date | string;
  to: Date | string;
  signal?: AbortSignal;
}): Promise<TraccarEventRow[]> {
  const ids = options.deviceIds.map(String).filter((id) => id.length > 0);
  if (ids.length === 0) return [];
  const qs = new URLSearchParams();
  ids.forEach((id) => qs.append("deviceId", id));
  qs.set("from", typeof options.from === "string" ? options.from : options.from.toISOString());
  qs.set("to", typeof options.to === "string" ? options.to : options.to.toISOString());
  const res = await fetch(`/api/road-alerts?${qs}`, { cache: "no-store", signal: options.signal });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const body = (await res.json().catch(() => null)) as { alerts?: unknown[] } | null;
  return (body?.alerts ?? [])
    .map(sanitizeRoadAlert)
    .filter((r): r is RoadAlertRecord => !!r)
    .map(roadAlertToRow);
}

/** The one-line detail under a road alert: "84 km/h · limit 60 · Gulan St". */
export function roadAlertDetail(row: TraccarEventRow, t: Translate): string | null {
  if (!isRoadAlertRow(row)) return null;
  const a = row.attributes as unknown as RoadAlertRecord;
  const place = a.hazardName ? ` · ${a.hazardName}` : "";
  if (a.kind === "speedCamera") {
    return `${Math.round(a.speedKmh)} km/h · ${t("road.limit")} ${a.limitKmh ?? "—"} km/h${place}`;
  }
  return t("road.bumpsDetail")
    .replace("{count}", String(a.count ?? "—"))
    .replace("{kmh}", String(a.thresholdKmh ?? "—"))
    .replace("{fastest}", String(a.fastestKmh ?? Math.round(a.speedKmh)));
}
