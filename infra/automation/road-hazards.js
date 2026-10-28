"use strict";

/*
 * Speed cameras and speed bumps: which ones a car drove past, and how fast.
 *
 * Pure functions, no I/O beyond reading the hazards file — mailer.js owns the
 * polling, state, alert log and email. The hazards file is written by the
 * website (Fleet → Cameras & bumps, apps/web/lib/road-hazards.ts):
 *
 *   { "version": 1, "items": [{ "id", "kind": "camera"|"bump", "lat", "lng",
 *     "limitKmh"?, "name"? }, ...] }
 *
 * WHY SEGMENTS, NOT POINTS. A tracker reports every 10-30 s, so a car at
 * 40 km/h moves 110-330 m between fixes and almost never reports while it is
 * ON a bump. We test the straight line between consecutive fixes instead, and
 * a hazard within `radiusM` of that line counts as passed.
 *
 * WHY THE SLOWEST SPEED. Between two fixes we do not know how fast the car was
 * at the exact spot — a driver can be at 50 km/h on both sides and still brake
 * to 10 for the bump. So the speed we judge is the LOWEST of: the speed
 * reported at each end, and the average over the segment. A car is only called
 * fast if it was fast everywhere we can see. That misses some real hits, but a
 * false "your driver hit a bump at 50" is worse than a missed one. Segments
 * longer than `maxGapSec` are skipped entirely: too much is unknown.
 */

const fs = require("fs");

const KINDS = new Set(["camera", "bump"]);
const KNOTS_TO_KMH = 1.852;
/** Grid cell for the spatial index, in degrees (~1.1 km of latitude). */
const CELL_DEG = 0.01;
const M_PER_DEG_LAT = 110_540;
const M_PER_DEG_LNG_EQ = 111_320;

/* ------------------------------- loading -------------------------------- */

function finite(v) {
  return typeof v === "number" && Number.isFinite(v);
}

/** Keep only well-formed hazards; a bad row is dropped, never guessed at. */
function sanitizeItems(raw) {
  const list = raw && Array.isArray(raw.items) ? raw.items : [];
  const out = [];
  for (const h of list) {
    if (!h || typeof h !== "object" || h.deleted) continue;
    if (typeof h.id !== "string" || !KINDS.has(h.kind)) continue;
    if (!finite(h.lat) || !finite(h.lng) || Math.abs(h.lat) > 90 || Math.abs(h.lng) > 180) continue;
    out.push({
      id: h.id,
      kind: h.kind,
      lat: h.lat,
      lng: h.lng,
      limitKmh: finite(h.limitKmh) && h.limitKmh > 0 ? h.limitKmh : null,
      name: typeof h.name === "string" ? h.name.slice(0, 120) : "",
    });
  }
  return out;
}

function cellKey(lat, lng) {
  return `${Math.floor(lat / CELL_DEG)}:${Math.floor(lng / CELL_DEG)}`;
}

function buildIndex(items) {
  const cells = new Map();
  for (const h of items) {
    const k = cellKey(h.lat, h.lng);
    if (!cells.has(k)) cells.set(k, []);
    cells.get(k).push(h);
  }
  return {
    cells,
    size: items.length,
    cameras: items.filter((h) => h.kind === "camera").length,
    bumps: items.filter((h) => h.kind === "bump").length,
  };
}

/**
 * Re-reads the hazards file only when its mtime changes. Returns the previous
 * index when the file is unreadable (a half-deployed edit must not blank out
 * every camera), and an empty index when it simply does not exist yet.
 */
function createHazardLoader(file, log) {
  let mtimeMs = -1;
  let index = buildIndex([]);
  return function load() {
    let st;
    try {
      st = fs.statSync(file);
    } catch (e) {
      if (e.code === "ENOENT") {
        if (mtimeMs !== 0) index = buildIndex([]);
        mtimeMs = 0;
        return index;
      }
      log("warn", "road_hazards_unreadable", { error: e.message });
      return index;
    }
    if (st.mtimeMs === mtimeMs) return index;
    try {
      index = buildIndex(sanitizeItems(JSON.parse(fs.readFileSync(file, "utf8"))));
      mtimeMs = st.mtimeMs;
      log("info", "road_hazards_loaded", { cameras: index.cameras, bumps: index.bumps });
    } catch (e) {
      log("warn", "road_hazards_unreadable", { error: e.message });
    }
    return index;
  };
}

/* ------------------------------- geometry ------------------------------- */

/**
 * Where on segment a→b the point h comes closest, as t in [0, 1], and how far
 * away it is in metres. Local equirectangular projection: at these distances
 * (a few hundred metres) the error is far below GPS noise.
 */
function closestOnSegment(a, b, h) {
  const lat0 = (a.lat + b.lat) / 2;
  const kx = M_PER_DEG_LNG_EQ * Math.cos((lat0 * Math.PI) / 180);
  const bx = (b.lng - a.lng) * kx;
  const by = (b.lat - a.lat) * M_PER_DEG_LAT;
  const hx = (h.lng - a.lng) * kx;
  const hy = (h.lat - a.lat) * M_PER_DEG_LAT;
  const len2 = bx * bx + by * by;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, (hx * bx + hy * by) / len2));
  const dx = hx - t * bx;
  const dy = hy - t * by;
  return { t, distM: Math.sqrt(dx * dx + dy * dy), lengthM: Math.sqrt(len2) };
}

/** Hazards in every grid cell the segment's padded bounding box touches. */
function candidates(index, a, b, padM) {
  const padLat = padM / M_PER_DEG_LAT;
  const padLng = padM / (M_PER_DEG_LNG_EQ * Math.max(0.1, Math.cos((a.lat * Math.PI) / 180)));
  const r0 = Math.floor((Math.min(a.lat, b.lat) - padLat) / CELL_DEG);
  const r1 = Math.floor((Math.max(a.lat, b.lat) + padLat) / CELL_DEG);
  const c0 = Math.floor((Math.min(a.lng, b.lng) - padLng) / CELL_DEG);
  const c1 = Math.floor((Math.max(a.lng, b.lng) + padLng) / CELL_DEG);
  // A teleporting fix (bad GPS) would otherwise scan thousands of cells.
  if ((r1 - r0 + 1) * (c1 - c0 + 1) > 400) return [];
  const out = [];
  for (let r = r0; r <= r1; r++) {
    for (let c = c0; c <= c1; c++) {
      const list = index.cells.get(`${r}:${c}`);
      if (list) out.push(...list);
    }
  }
  return out;
}

/* ------------------------------- detection ------------------------------ */

/** A Traccar position reduced to what the detector needs, or null if unusable. */
function toFix(p) {
  if (!p || p.valid === false) return null;
  const at = +new Date(p.fixTime);
  if (!finite(p.latitude) || !finite(p.longitude) || !Number.isFinite(at)) return null;
  return {
    id: p.id,
    at,
    lat: p.latitude,
    lng: p.longitude,
    kmh: finite(p.speed) ? p.speed * KNOTS_TO_KMH : null,
  };
}

/**
 * Every hazard the car passed between fixes a and b (both from toFix), with
 * the conservative speed estimate described at the top of this file.
 *
 * opts: { cameraRadiusM, bumpRadiusM, maxGapSec }
 * returns [{ hazard, at, speedKmh, positionId, distM }]
 */
function crossingsBetween(index, a, b, opts) {
  if (!a || !b || index.size === 0) return [];
  const dtSec = (b.at - a.at) / 1000;
  if (!(dtSec > 0) || dtSec > opts.maxGapSec) return [];
  if (a.kmh == null || b.kmh == null) return [];

  const pad = Math.max(opts.cameraRadiusM, opts.bumpRadiusM);
  const out = [];
  for (const h of candidates(index, a, b, pad)) {
    const { t, distM, lengthM } = closestOnSegment(a, b, h);
    const radius = h.kind === "camera" ? opts.cameraRadiusM : opts.bumpRadiusM;
    if (distM > radius) continue;
    const avgKmh = (lengthM / dtSec) * 3.6;
    out.push({
      hazard: h,
      at: new Date(a.at + t * (b.at - a.at)).toISOString(),
      speedKmh: Math.min(a.kmh, b.kmh, avgKmh),
      // The fix closer to the hazard, so "replay" opens on the right moment.
      positionId: t < 0.5 ? a.id : b.id,
      distM,
    });
  }
  return out;
}

/** The speed a camera enforces: its own limit, else the fleet default. */
function cameraLimitKmh(hazard, defaultKmh) {
  return hazard.limitKmh ?? defaultKmh;
}

/** "YYYY-MM-DD" in the fleet's time zone, for the per-day bump count. */
function localDay(iso, timeZone) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(iso));
}

module.exports = {
  sanitizeItems,
  buildIndex,
  createHazardLoader,
  closestOnSegment,
  toFix,
  crossingsBetween,
  cameraLimitKmh,
  localDay,
};
