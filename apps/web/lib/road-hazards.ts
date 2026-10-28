// Speed cameras and speed bumps — the road features the mailer checks every
// car's path against (infra/automation/road-hazards.js reads the same file).
//
// One server-wide list, not per account: a camera on Gulan Street is the same
// camera for every company. It lives on disk next to the alert settings,
// written by /api/road-hazards (administrators only) and re-read by the mailer
// whenever it changes.
//
// Two sources share the list:
//   - "osm":    imported from OpenStreetMap (highway=speed_camera,
//               traffic_calming=bump/hump/table/cushion). Re-importing an area
//               refreshes these, EXCEPT ones an admin edited (kept as edited)
//               or deleted (remembered in `removedOsmIds`, never re-added).
//   - "manual": pinned by an admin; an import never touches them.
//
// Plain module on purpose — the API route (server) and the page (client)
// both import from here.

export const HAZARD_KINDS = ["camera", "bump"] as const;
export type HazardKind = (typeof HAZARD_KINDS)[number];

export interface RoadHazard {
  id: string;
  kind: HazardKind;
  lat: number;
  lng: number;
  /** Cameras only: the limit it enforces. Empty = the Settings default. */
  limitKmh?: number | null;
  name?: string;
  source: "osm" | "manual";
  /** OpenStreetMap node id, for source "osm". */
  osmId?: number;
  /** An admin changed this OSM item; re-imports leave it alone. */
  edited?: boolean;
}

export interface RoadHazardFile {
  version: 1;
  items: RoadHazard[];
  /** OSM nodes an admin deleted, so an import does not bring them back. */
  removedOsmIds: number[];
  updatedAt?: string;
  updatedBy?: string;
}

export const MAX_HAZARDS = 20_000;
export const CAMERA_LIMIT_RANGE = [10, 200] as const;
/** Widest area one import may cover, in degrees per side (Overpass load). */
export const MAX_IMPORT_SPAN_DEG = 5;

export const HAZARD_COLORS: Record<HazardKind, string> = {
  camera: "#dc2626",
  bump: "#f59e0b",
};

export const EMPTY_HAZARD_FILE: RoadHazardFile = { version: 1, items: [], removedOsmIds: [] };

function finite(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

export function isHazardKind(v: unknown): v is HazardKind {
  return v === "camera" || v === "bump";
}

/** One hazard from untrusted input, or null. */
export function sanitizeHazard(raw: unknown): RoadHazard | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.id !== "string" || r.id.length === 0 || r.id.length > 64) return null;
  if (!isHazardKind(r.kind)) return null;
  if (!finite(r.lat) || !finite(r.lng) || Math.abs(r.lat) > 90 || Math.abs(r.lng) > 180) return null;
  const limit =
    r.kind === "camera" && finite(r.limitKmh)
      ? Math.min(CAMERA_LIMIT_RANGE[1], Math.max(CAMERA_LIMIT_RANGE[0], Math.round(r.limitKmh)))
      : null;
  const source = r.source === "osm" ? "osm" : "manual";
  return {
    id: r.id,
    kind: r.kind,
    lat: r.lat,
    lng: r.lng,
    limitKmh: limit,
    name: typeof r.name === "string" ? r.name.trim().slice(0, 120) : "",
    source,
    ...(source === "osm" && finite(r.osmId) ? { osmId: r.osmId } : {}),
    ...(r.edited === true ? { edited: true } : {}),
  };
}

/** Total: any input becomes a valid file (bad rows are dropped). */
export function sanitizeHazardFile(raw: unknown): RoadHazardFile {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const seen = new Set<string>();
  const items = (Array.isArray(r.items) ? r.items : [])
    .map(sanitizeHazard)
    .filter((h): h is RoadHazard => !!h && !seen.has(h.id) && !!seen.add(h.id))
    .slice(0, MAX_HAZARDS);
  const removedOsmIds = (Array.isArray(r.removedOsmIds) ? r.removedOsmIds : []).filter(finite);
  return {
    version: 1,
    items,
    removedOsmIds,
    updatedAt: typeof r.updatedAt === "string" ? r.updatedAt : undefined,
    updatedBy: typeof r.updatedBy === "string" ? r.updatedBy : undefined,
  };
}

/**
 * Apply an admin's edits on top of the CURRENT file (never a blind overwrite,
 * so two admins editing different pins do not undo each other).
 */
export function applyHazardEdits(
  file: RoadHazardFile,
  upsert: RoadHazard[],
  remove: string[],
): RoadHazardFile {
  const byId = new Map(file.items.map((h) => [h.id, h]));
  const removed = new Set(file.removedOsmIds);
  for (const id of remove) {
    const gone = byId.get(id);
    if (gone?.source === "osm" && gone.osmId != null) removed.add(gone.osmId);
    byId.delete(id);
  }
  for (const h of upsert) {
    const prev = byId.get(h.id);
    // Source and OSM id come from what is stored, never from the client.
    const next: RoadHazard = prev
      ? { ...h, source: prev.source, osmId: prev.osmId, edited: prev.source === "osm" ? true : undefined }
      : { ...h, source: "manual", osmId: undefined, edited: undefined };
    byId.set(h.id, next);
  }
  return { ...file, items: [...byId.values()].slice(0, MAX_HAZARDS), removedOsmIds: [...removed] };
}

export type Bbox = [west: number, south: number, east: number, north: number];

export function isValidBbox(b: unknown): b is Bbox {
  if (!Array.isArray(b) || b.length !== 4 || !b.every(finite)) return false;
  const [w, s, e, n] = b as number[];
  return w >= -180 && e <= 180 && s >= -90 && n <= 90 && w < e && s < n &&
    e - w <= MAX_IMPORT_SPAN_DEG && n - s <= MAX_IMPORT_SPAN_DEG;
}

function inBbox(h: { lat: number; lng: number }, [w, s, e, n]: Bbox) {
  return h.lng >= w && h.lng <= e && h.lat >= s && h.lat <= n;
}

/**
 * Merge a fresh OSM pull for `bbox` into the file. Inside the box, untouched
 * OSM items are replaced by the pull (so ones removed upstream disappear);
 * edited, deleted and manual items are left exactly as the admin made them.
 */
export function mergeOsmImport(
  file: RoadHazardFile,
  bbox: Bbox,
  pulled: RoadHazard[],
): { file: RoadHazardFile; added: number; updated: number; dropped: number } {
  const removed = new Set(file.removedOsmIds);
  const keptOsmIds = new Set<number>();
  const kept: RoadHazard[] = [];
  let dropped = 0;
  for (const h of file.items) {
    const replaceable = h.source === "osm" && !h.edited && inBbox(h, bbox);
    if (replaceable) {
      dropped += 1;
      continue;
    }
    kept.push(h);
    if (h.osmId != null) keptOsmIds.add(h.osmId);
  }
  const before = new Set(file.items.filter((h) => h.osmId != null).map((h) => h.osmId));
  let added = 0;
  let updated = 0;
  for (const h of pulled) {
    if (h.osmId == null || removed.has(h.osmId) || keptOsmIds.has(h.osmId)) continue;
    if (before.has(h.osmId)) {
      updated += 1;
      dropped -= 1;
    } else {
      added += 1;
    }
    kept.push(h);
  }
  return {
    file: { ...file, items: kept.slice(0, MAX_HAZARDS) },
    added,
    updated,
    dropped: Math.max(0, dropped),
  };
}

/** "60", "60 km/h", "40 mph" → km/h, or null. */
export function parseMaxspeed(raw: unknown): number | null {
  if (typeof raw !== "string") return null;
  const m = /^\s*(\d{1,3})\s*(mph)?/i.exec(raw);
  if (!m) return null;
  const v = Number(m[1]) * (m[2] ? 1.609 : 1);
  return v > 0 ? Math.round(v) : null;
}

const BUMP_VALUES = new Set(["bump", "hump", "table", "cushion", "yes"]);

/** Overpass QL for every camera and bump node in a box. */
export function overpassQuery([w, s, e, n]: Bbox): string {
  const box = `${s},${w},${n},${e}`;
  return (
    `[out:json][timeout:90];(` +
    `node["highway"="speed_camera"](${box});` +
    `node["traffic_calming"~"^(bump|hump|table|cushion|yes)$"](${box});` +
    `);out body;`
  );
}

/** Overpass `elements` → hazards (source "osm"). Unknown shapes are skipped. */
export function hazardsFromOverpass(elements: unknown): RoadHazard[] {
  if (!Array.isArray(elements)) return [];
  const out: RoadHazard[] = [];
  for (const el of elements as Record<string, unknown>[]) {
    if (el?.type !== "node" || !finite(el.id) || !finite(el.lat) || !finite(el.lon)) continue;
    const tags = (el.tags && typeof el.tags === "object" ? el.tags : {}) as Record<string, string>;
    const kind: HazardKind | null =
      tags.highway === "speed_camera"
        ? "camera"
        : BUMP_VALUES.has(tags.traffic_calming)
          ? "bump"
          : null;
    if (!kind) continue;
    out.push({
      id: `osm-${el.id}`,
      kind,
      lat: el.lat,
      lng: el.lon,
      limitKmh: kind === "camera" ? parseMaxspeed(tags.maxspeed) : null,
      name: (tags["name:en"] || tags.name || "").slice(0, 120),
      source: "osm",
      osmId: el.id,
    });
  }
  return out;
}
