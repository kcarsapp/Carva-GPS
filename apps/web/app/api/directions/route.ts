import { NextRequest, NextResponse } from "next/server";

// Driving directions via the public OSRM router (OpenStreetMap road data).
//
// Called when an operator asks for directions to a car on the live map, and
// again only when either end has moved noticeably, so volume stays tiny.
// Server-side so the browser never talks to OSRM and the provider can be
// swapped (self-hosted OSRM/Valhalla) without touching the client. Results are
// cached briefly per ~11 m pair of points.

export const dynamic = "force-dynamic";

const OSRM = "https://router.project-osrm.org/route/v1/driving";
const cache = new Map<string, { body: DirectionsResponse; at: number }>();
const TTL = 1000 * 60; // 1 min — the car may be moving
const MAX_ENTRIES = 500;

export type DirectionsStep = {
  /** OSRM maneuver type: depart, turn, roundabout, arrive, ... */
  type: string;
  /** left, right, slight left, sharp right, straight, uturn ... */
  modifier?: string;
  /** Road being entered, "" when unnamed. */
  name: string;
  /** Metres covered by this step. */
  distance: number;
  /** Roundabout exit number, when the step is a roundabout. */
  exit?: number;
  /** [lng, lat] where the manoeuvre happens. */
  location: [number, number];
};

export type DirectionsResponse = {
  /** Metres. */
  distance: number;
  /** Seconds. */
  duration: number;
  /** Route line as [lng, lat] pairs. */
  coordinates: [number, number][];
  steps: DirectionsStep[];
};

function parsePoint(raw: string | null): [number, number] | null {
  if (!raw) return null;
  const [lat, lng] = raw.split(",").map(Number);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  return [lat, lng];
}

type OsrmRoute = {
  distance: number;
  duration: number;
  geometry: { coordinates: [number, number][] };
  legs: {
    steps: {
      name?: string;
      distance: number;
      maneuver: { type: string; modifier?: string; exit?: number; location: [number, number] };
    }[];
  }[];
};

export async function GET(req: NextRequest) {
  const from = parsePoint(req.nextUrl.searchParams.get("from"));
  const to = parsePoint(req.nextUrl.searchParams.get("to"));
  if (!from || !to) {
    return NextResponse.json({ error: "from/to required as lat,lng" }, { status: 400 });
  }

  const key = [...from, ...to].map((n) => n.toFixed(4)).join(",");
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL) return NextResponse.json(hit.body);

  try {
    // OSRM wants lng,lat order.
    const url =
      `${OSRM}/${from[1]},${from[0]};${to[1]},${to[0]}` +
      `?overview=full&geometries=geojson&steps=true`;
    const res = await fetch(url, {
      headers: { "User-Agent": "CarvaFleet/1.0 (https://gps.carvarent.com; fleet@carvarent.com)" },
      cache: "no-store",
      signal: AbortSignal.timeout(12_000),
    });
    if (!res.ok) {
      return NextResponse.json({ error: `route_${res.status}` }, { status: 502 });
    }
    const data = (await res.json()) as { code?: string; routes?: OsrmRoute[] };
    const route = data.routes?.[0];
    if (data.code !== "Ok" || !route) {
      return NextResponse.json({ error: "no_route" }, { status: 404 });
    }

    const body: DirectionsResponse = {
      distance: route.distance,
      duration: route.duration,
      coordinates: route.geometry.coordinates,
      steps: route.legs.flatMap((leg) =>
        leg.steps.map((s) => ({
          type: s.maneuver.type,
          modifier: s.maneuver.modifier,
          name: s.name ?? "",
          distance: s.distance,
          exit: s.maneuver.exit,
          location: s.maneuver.location,
        })),
      ),
    };
    if (cache.size >= MAX_ENTRIES) cache.clear();
    cache.set(key, { body, at: Date.now() });
    return NextResponse.json(body);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}
