// Which direction of travel a speed camera or bump applies to, read from the
// OpenStreetMap road it sits on.
//
// On a divided road (a median between the two directions) OSM maps each side
// as its own one-way road. A bump on the northbound side is a node of the
// northbound way only, so the way's direction IS the bump's direction. On an
// ordinary two-way street the bump spans both lanes: no direction (null).
//
// The rules, in order:
//   1. The hazard is a node of exactly one road → that road decides.
//      (A node shared by several roads is a junction: ambiguous → null.)
//   2. Otherwise (cameras are often mapped beside the road) the nearest road
//      within SNAP_M decides — but only if it is clearly nearer than any
//      other road, so a camera between two carriageways stays null.
//   3. That road decides like this: a `direction=forward|backward` tag on the
//      hazard itself points along/against the way; else a one-way road gives
//      its direction of travel; else null (both ways).
//
// Plain module, pure functions — used by the OSM import and unit-tested.

export interface OsmWay {
  id: number;
  /** Node ids in drawing order. */
  nodes: number[];
  /** Coordinates of `nodes`, same order. */
  geometry: { lat: number; lon: number }[];
  tags: Record<string, string>;
}

/** Roads a car drives on. Footways, tracks etc. never decide a direction. */
export const ROAD_HIGHWAYS =
  "^(motorway|trunk|primary|secondary|tertiary)(_link)?$|^(unclassified|residential|living_street|service|road)$";
const ROAD_RE = new RegExp(ROAD_HIGHWAYS);

/** A camera beside the road snaps to a road at most this far away. */
export const SNAP_M = 25;
/** ...and only if the runner-up road is at least this much further away. */
const CLEAR_MARGIN_M = 6;

export function isRoad(tags: Record<string, string>): boolean {
  return ROAD_RE.test(tags.highway ?? "");
}

/** 1 = one-way along the drawing order, -1 = against it, 0 = two-way. */
export function onewayOf(tags: Record<string, string>): 1 | -1 | 0 {
  const v = (tags.oneway ?? "").toLowerCase();
  if (v === "yes" || v === "true" || v === "1") return 1;
  if (v === "-1" || v === "reverse") return -1;
  if (v === "no" || v === "false" || v === "0") return 0;
  // Implied one-way: roundabouts and motorways.
  if (tags.junction === "roundabout" || tags.junction === "circular") return 1;
  if (tags.highway === "motorway" || tags.highway === "motorway_link") return 1;
  return 0;
}

/** Initial compass bearing from a to b, degrees in [0, 360). */
export function bearingDeg(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const toRad = Math.PI / 180;
  const φ1 = a.lat * toRad;
  const φ2 = b.lat * toRad;
  const Δλ = (b.lon - a.lon) * toRad;
  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

/** Closest segment of a way to a point: its index and distance in metres. */
export function nearestSegment(way: OsmWay, lat: number, lon: number): { index: number; distM: number } {
  const kx = 111_320 * Math.cos((lat * Math.PI) / 180);
  const ky = 110_540;
  let best = { index: -1, distM: Infinity };
  for (let i = 0; i + 1 < way.geometry.length; i++) {
    const a = way.geometry[i];
    const b = way.geometry[i + 1];
    const ax = (a.lon - lon) * kx, ay = (a.lat - lat) * ky;
    const bx = (b.lon - lon) * kx, by = (b.lat - lat) * ky;
    const dx = bx - ax, dy = by - ay;
    const len2 = dx * dx + dy * dy;
    const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, -(ax * dx + ay * dy) / len2));
    const px = ax + t * dx, py = ay + t * dy;
    const d = Math.sqrt(px * px + py * py);
    if (d < best.distM) best = { index: i, distM: d };
  }
  return best;
}

/** The way that decides this hazard's direction, or null when ambiguous. */
export function decidingWay(
  hazard: { id: number; lat: number; lon: number },
  ways: OsmWay[],
): OsmWay | null {
  const roads = ways.filter((w) => isRoad(w.tags) && w.geometry.length >= 2);
  const containing = roads.filter((w) => w.nodes.includes(hazard.id));
  if (containing.length === 1) return containing[0];
  if (containing.length > 1) return null; // junction

  const near = roads
    .map((w) => ({ w, d: nearestSegment(w, hazard.lat, hazard.lon).distM }))
    .filter((x) => x.d <= SNAP_M)
    .sort((a, b) => a.d - b.d);
  if (near.length === 0) return null;
  if (near.length > 1 && near[1].d - near[0].d < CLEAR_MARGIN_M) return null;
  return near[0].w;
}

/**
 * The bearing of travel this hazard applies to, or null for both directions.
 * `hazardTags` are the hazard node's own tags (for direction=forward/backward).
 */
export function hazardBearing(
  hazard: { id: number; lat: number; lon: number },
  hazardTags: Record<string, string>,
  way: OsmWay | null,
): number | null {
  if (!way) return null;
  const dirTag = (hazardTags.direction ?? "").toLowerCase();
  const sense: 1 | -1 | 0 =
    dirTag === "forward" ? 1 : dirTag === "backward" ? -1 : onewayOf(way.tags);
  if (sense === 0) return null;

  // Direction of the way at the hazard: the segment containing/closest to it.
  const at = way.nodes.indexOf(hazard.id);
  const g = way.geometry;
  let i: number;
  if (at >= 0) i = Math.min(at, g.length - 2);
  else i = Math.max(0, nearestSegment(way, hazard.lat, hazard.lon).index);
  const along = bearingDeg(g[i], g[i + 1]);
  return sense === 1 ? along : (along + 180) % 360;
}

/** Smallest angle between two bearings, 0-180. */
export function angleBetween(a: number, b: number): number {
  const d = Math.abs(((a - b) % 360) + 360) % 360;
  return d > 180 ? 360 - d : d;
}
