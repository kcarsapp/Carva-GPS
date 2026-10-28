// WKT ⇄ GeoJSON helpers for Traccar geofences.
//
// *** Axis order: Traccar stores a geofence `area` as WKT in "LAT LON" order —
// the opposite of GeoJSON's [lng, lat]. Every conversion below flips it
// explicitly, in both directions. Formats verified against the live server:
//
//   CIRCLE (36.2387 44.7847, 150)
//   POLYGON ((36.2387 44.7847, 36.2401 44.7902, …, 36.2387 44.7847))
//
// MapLibre cannot fill a true circle, so circles are rendered as a 64-point
// polygon approximation with the longitude step corrected by cos(latitude).

import type { Feature, Polygon } from "geojson";

/** A point in GeoJSON order: [longitude, latitude]. */
export type LngLat = [number, number];

/** A geographic box: [west, south, east, north]. */
export type Bounds = [number, number, number, number];

export interface CircleShape {
  kind: "circle";
  center: LngLat;
  /** Radius in metres. */
  radius: number;
}

export interface PolygonShape {
  kind: "polygon";
  /** Outer ring, kept open — the closing vertex is added when rendering/serializing. */
  ring: LngLat[];
}

export type GeofenceShape = CircleShape | PolygonShape;

/** A geofence record as returned by GET /api/traccar/geofences. */
export interface TraccarGeofence {
  id: number;
  name: string;
  description?: string;
  /** WKT in "LAT LON" order — read it with parseArea(). */
  area: string;
  calendarId?: number;
  attributes?: Record<string, unknown>;
}

/** A parsed geofence ready to draw on the map. */
export interface GeofenceZone {
  id: number;
  name: string;
  shape: GeofenceShape;
  /** Accent for this zone on the map (its category colour). */
  color?: string;
}

/** WGS-84 equatorial radius, in metres. */
const EARTH_RADIUS_M = 6378137;

/** Vertices used to approximate a circle as a polygon. */
export const CIRCLE_STEPS = 64;

export const MIN_RADIUS_M = 20;
/** Hard validity bound — the radius slider uses a much smaller range. */
export const MAX_RADIUS_M = 100000;
export const DEFAULT_RADIUS_M = 200;

const CIRCLE_RE = /^CIRCLE\s*\(\s*([^,]+?)\s*,\s*([^)]+?)\s*\)$/i;
const POLYGON_RE = /^POLYGON\s*\(\s*\(([^)]*)\)\s*\)$/i;

/* ------------------------------- Parsing -------------------------------- */

/** One WKT vertex, "lat lon", returned in GeoJSON order. */
function parseVertex(text: string): LngLat | null {
  const parts = text.trim().split(/\s+/);
  if (parts.length !== 2) return null;
  const lat = Number(parts[0]);
  const lng = Number(parts[1]);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
  return [lng, lat];
}

function samePoint(a: LngLat, b: LngLat): boolean {
  return Math.abs(a[0] - b[0]) < 1e-9 && Math.abs(a[1] - b[1]) < 1e-9;
}

/**
 * Read a Traccar `area` string. Returns null for anything we can't draw
 * (an unsupported geometry such as LINESTRING, or malformed coordinates).
 */
export function parseArea(area: string | null | undefined): GeofenceShape | null {
  if (!area) return null;
  const text = area.trim();

  const circle = CIRCLE_RE.exec(text);
  if (circle) {
    const center = parseVertex(circle[1]);
    const radius = Number(circle[2]);
    if (!center || !Number.isFinite(radius) || radius <= 0) return null;
    return { kind: "circle", center, radius };
  }

  const polygon = POLYGON_RE.exec(text);
  if (polygon) {
    const ring: LngLat[] = [];
    for (const part of polygon[1].split(",")) {
      const vertex = parseVertex(part);
      if (!vertex) return null;
      ring.push(vertex);
    }
    // WKT repeats the first vertex to close the ring; we keep rings open.
    if (ring.length > 1 && samePoint(ring[0], ring[ring.length - 1])) ring.pop();
    if (ring.length < 3) return null;
    return { kind: "polygon", ring };
  }

  return null;
}

/* ----------------------------- Serializing ------------------------------ */

/** Trim float noise without forcing trailing zeros (36.238700 → "36.2387"). */
function fmt(value: number, decimals = 6): string {
  return String(Number(value.toFixed(decimals)));
}

/** Serialize a shape to Traccar WKT — note the "LAT LON" order. */
export function toWkt(shape: GeofenceShape): string {
  if (shape.kind === "circle") {
    const [lng, lat] = shape.center;
    return `CIRCLE (${fmt(lat)} ${fmt(lng)}, ${fmt(shape.radius, 2)})`;
  }
  const vertices = closeRing(shape.ring)
    .map(([lng, lat]) => `${fmt(lat)} ${fmt(lng)}`)
    .join(", ");
  return `POLYGON ((${vertices}))`;
}

/* ------------------------------- Geometry ------------------------------- */

/** Repeat the first vertex at the end, as WKT and GeoJSON both require. */
export function closeRing(ring: LngLat[]): LngLat[] {
  if (ring.length === 0) return [];
  const last = ring[ring.length - 1];
  return samePoint(ring[0], last) ? [...ring] : [...ring, ring[0]];
}

/** Great-circle distance between two points, in metres. */
export function haversineMetres(a: LngLat, b: LngLat): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b[1] - a[1]);
  const dLng = toRad(b[0] - a[0]);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a[1])) * Math.cos(toRad(b[1])) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** The point `metres` due east of `center` — where the radius handle sits. */
export function offsetEast(center: LngLat, metres: number): LngLat {
  const [lng, lat] = center;
  const degLat = (metres / EARTH_RADIUS_M) * (180 / Math.PI);
  // A degree of longitude shrinks towards the poles; guard the division.
  const cosLat = Math.max(Math.cos((lat * Math.PI) / 180), 1e-6);
  return [lng + degLat / cosLat, lat];
}

/**
 * Approximate a circle as a closed polygon ring. Latitude steps are constant;
 * longitude steps are divided by cos(latitude) so the shape stays round.
 */
export function circleToRing(
  center: LngLat,
  radius: number,
  steps = CIRCLE_STEPS,
): LngLat[] {
  const [lng, lat] = center;
  const degLat = (radius / EARTH_RADIUS_M) * (180 / Math.PI);
  const cosLat = Math.max(Math.cos((lat * Math.PI) / 180), 1e-6);
  const degLng = degLat / cosLat;

  const ring: LngLat[] = [];
  for (let i = 0; i < steps; i++) {
    const angle = (i / steps) * 2 * Math.PI;
    ring.push([lng + degLng * Math.cos(angle), lat + degLat * Math.sin(angle)]);
  }
  ring.push(ring[0]);
  return ring;
}

/** The closed outer ring a shape draws as. */
export function shapeRing(shape: GeofenceShape): LngLat[] {
  return shape.kind === "circle"
    ? circleToRing(shape.center, shape.radius)
    : closeRing(shape.ring);
}

/** A GeoJSON polygon feature for MapLibre, with optional layer properties. */
export function shapeToFeature(
  shape: GeofenceShape,
  properties: Record<string, unknown> = {},
): Feature<Polygon> {
  return {
    type: "Feature",
    geometry: { type: "Polygon", coordinates: [shapeRing(shape)] },
    properties,
  };
}

/** Where to anchor a shape's name label. */
export function shapeCentroid(shape: GeofenceShape): LngLat {
  if (shape.kind === "circle") return shape.center;
  let lng = 0;
  let lat = 0;
  for (const [x, y] of shape.ring) {
    lng += x;
    lat += y;
  }
  return [lng / shape.ring.length, lat / shape.ring.length];
}

export function shapeBounds(shape: GeofenceShape): Bounds | null {
  return boundsOfShapes([shape]);
}

export function boundsOfShapes(shapes: GeofenceShape[]): Bounds | null {
  let west = Infinity;
  let south = Infinity;
  let east = -Infinity;
  let north = -Infinity;

  for (const shape of shapes) {
    for (const [lng, lat] of shapeRing(shape)) {
      if (lng < west) west = lng;
      if (lng > east) east = lng;
      if (lat < south) south = lat;
      if (lat > north) north = lat;
    }
  }

  return Number.isFinite(west) ? [west, south, east, north] : null;
}

/* ------------------------------ Validation ------------------------------ */

export function clampRadius(metres: number): number {
  if (!Number.isFinite(metres)) return DEFAULT_RADIUS_M;
  return Math.min(MAX_RADIUS_M, Math.max(MIN_RADIUS_M, Math.round(metres)));
}

/** True when the shape has enough geometry to save and to render. */
export function isDrawable(shape: GeofenceShape | null): shape is GeofenceShape {
  if (!shape) return false;
  return shape.kind === "circle" ? shape.radius > 0 : shape.ring.length >= 3;
}
