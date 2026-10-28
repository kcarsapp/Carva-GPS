// Car repair shops from OpenStreetMap, turned into "repair" geofences.
//
// A rental car parked at a garage usually means damage, so the fleet wants an
// alert the moment one enters any repair shop — and nobody wants to draw a
// hundred circles by hand. The Geofences page asks /api/repair-shops for the
// garages in the visible area, then creates a circle zone around each one
// with the ready-made "repair" rules (alert on enter, never cut the engine).
//
// Plain module: the route parses with it, the page builds geofences with it.

import { haversineMetres, parseArea, toWkt, type TraccarGeofence } from "@/lib/geofence";
import { presetRules, readRules, writeRules } from "@/lib/geofence-rules";

export type RepairKind = "repair" | "tyres" | "body";

export interface RepairShop {
  /** "node/123", "way/456" — stored on the zone so it is never added twice. */
  osmRef: string;
  name: string;
  kind: RepairKind;
  lat: number;
  lng: number;
}

/** Attribute that marks a geofence as created from this OSM feature. */
export const OSM_REF_KEY = "carvaOsm";
/** Widest area one search may cover, in degrees per side. */
export const MAX_SHOP_SPAN_DEG = 1.5;
export const MAX_SHOPS = 400;
export const REPAIR_RADII = [40, 60, 100] as const;
export const DEFAULT_REPAIR_RADIUS = 60;

export type ShopBbox = [west: number, south: number, east: number, north: number];

function finite(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

export function isValidShopBbox(b: unknown): b is ShopBbox {
  if (!Array.isArray(b) || b.length !== 4 || !b.every(finite)) return false;
  const [w, s, e, n] = b as number[];
  return w >= -180 && e <= 180 && s >= -90 && n <= 90 && w < e && s < n &&
    e - w <= MAX_SHOP_SPAN_DEG && n - s <= MAX_SHOP_SPAN_DEG;
}

/**
 * Garages, tyre shops and body shops. `nwr` + `out center` because many are
 * mapped as building outlines, not points.
 */
export function repairShopQuery([w, s, e, n]: ShopBbox): string {
  const box = `${s},${w},${n},${e}`;
  return (
    `[out:json][timeout:25];(` +
    `nwr["shop"="car_repair"](${box});` +
    `nwr["shop"="tyres"](${box});` +
    `nwr["craft"="car_painter"](${box});` +
    `nwr["shop"="car"]["service"~"repair"](${box});` +
    `);out center tags;`
  );
}

export function shopsFromOverpass(elements: unknown[]): RepairShop[] {
  const out: RepairShop[] = [];
  const seen = new Set<string>();
  for (const raw of elements) {
    const el = raw as Record<string, unknown>;
    const type = el?.type;
    if ((type !== "node" && type !== "way" && type !== "relation") || !finite(el.id)) continue;
    const center = (el.center ?? el) as Record<string, unknown>;
    if (!finite(center.lat) || !finite(center.lon)) continue;
    const ref = `${type}/${el.id}`;
    if (seen.has(ref)) continue;
    seen.add(ref);
    const tags = (el.tags && typeof el.tags === "object" ? el.tags : {}) as Record<string, string>;
    const kind: RepairKind =
      tags.shop === "tyres" ? "tyres" : tags.craft === "car_painter" ? "body" : "repair";
    out.push({
      osmRef: ref,
      name: (tags["name:en"] || tags.name || tags["name:ar"] || tags["name:ku"] || "").slice(0, 80),
      kind,
      lat: center.lat,
      lng: center.lon,
    });
  }
  return out.slice(0, MAX_SHOPS);
}

/**
 * Is this shop already covered — created from it before, or sitting inside
 * an existing repair zone the user drew by hand?
 */
export function coveredBy(shop: RepairShop, geofences: TraccarGeofence[]): TraccarGeofence | null {
  for (const g of geofences) {
    if (g.attributes?.[OSM_REF_KEY] === shop.osmRef) return g;
    if (readRules(g.attributes).category !== "repair") continue;
    const shape = parseArea(g.area);
    if (shape?.kind === "circle" &&
        haversineMetres(shape.center, [shop.lng, shop.lat]) <= shape.radius) {
      return g;
    }
  }
  return null;
}

/** The Traccar geofence body for one shop: a circle with the repair preset. */
export function repairGeofenceBody(shop: RepairShop, radius: number, fallbackName: string) {
  return {
    name: shop.name || fallbackName,
    description: `OpenStreetMap ${shop.osmRef}`,
    area: toWkt({ kind: "circle", center: [shop.lng, shop.lat], radius }),
    attributes: { ...writeRules(undefined, presetRules("repair")), [OSM_REF_KEY]: shop.osmRef },
  };
}
