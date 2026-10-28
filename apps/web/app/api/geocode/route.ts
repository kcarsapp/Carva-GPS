import { NextRequest, NextResponse } from "next/server";

// On-demand reverse geocoding via OpenStreetMap Nominatim.
//
// Called only when a vehicle detail panel opens (one lookup per view, not per
// incoming position), so volume stays well within Nominatim's usage policy.
// Results are cached in-memory per ~11 m grid cell for a day. Server-side so we
// send a proper identifying User-Agent and never expose the browser to OSM.

export const dynamic = "force-dynamic";

const cache = new Map<string, { address: string; at: number }>();
const TTL = 1000 * 60 * 60 * 24; // 24h
const MAX_ENTRIES = 2000;

export async function GET(req: NextRequest) {
  const lat = req.nextUrl.searchParams.get("lat");
  const lon = req.nextUrl.searchParams.get("lon");
  if (!lat || !lon || !Number.isFinite(+lat) || !Number.isFinite(+lon)) {
    return NextResponse.json({ error: "lat/lon required" }, { status: 400 });
  }

  const key = `${(+lat).toFixed(4)},${(+lon).toFixed(4)}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL) {
    return NextResponse.json({ address: hit.address, cached: true });
  }

  try {
    const url =
      `https://nominatim.openstreetmap.org/reverse?format=jsonv2` +
      `&lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lon)}&zoom=18&addressdetails=0`;
    const res = await fetch(url, {
      headers: {
        "User-Agent": "CarvaFleet/1.0 (https://gps.carvarent.com; fleet@carvarent.com)",
        "Accept-Language": "en",
      },
      cache: "no-store",
    });
    if (!res.ok) {
      return NextResponse.json({ error: `geocode_${res.status}` }, { status: 502 });
    }
    const data = (await res.json()) as { display_name?: string };
    const address = data.display_name ?? "";
    if (address) {
      // Map iterates in insertion order, so the first key is the oldest entry.
      if (cache.size >= MAX_ENTRIES) cache.delete(cache.keys().next().value!);
      cache.set(key, { address, at: Date.now() });
    }
    return NextResponse.json({ address });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}
