import { NextRequest, NextResponse } from "next/server";

// Google Map Tiles proxy.
//
// Why proxy instead of putting the key in the map URL: the key would then be
// visible in every browser's network tab. Google's own advice for a key used
// from a server is an IP restriction, which a browser request can't satisfy —
// so the browser asks US for tiles and we fetch them with the key held here.
//
// Google requires a *session token* before serving 2D tiles. Tokens are cheap
// but not free to mint, so one per map type is cached until shortly before it
// expires. Tiles themselves are cached by the browser and by any CDN in front.

export const dynamic = "force-dynamic";

type MapType = "roadmap" | "satellite" | "terrain";

const MAP_TYPES: MapType[] = ["roadmap", "satellite", "terrain"];

interface Session {
  token: string;
  /** Epoch ms when Google stops accepting it. */
  expiresAt: number;
}

const sessions = new Map<MapType, Session>();
/** Renew this long before expiry so a tile request never races the deadline. */
const RENEW_MARGIN_MS = 5 * 60 * 1000;

function apiKey(): string | null {
  return process.env.GOOGLE_MAPS_KEY?.trim() || null;
}

/** Mint (or reuse) a session token for one map type. */
async function sessionFor(type: MapType, key: string): Promise<Session> {
  const cached = sessions.get(type);
  if (cached && cached.expiresAt - RENEW_MARGIN_MS > Date.now()) return cached;

  const res = await fetch(
    `https://tile.googleapis.com/v1/createSession?key=${encodeURIComponent(key)}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        mapType: type,
        language: "en-US",
        region: "IQ",
        // Roads and labels on satellite — the "hybrid" look people expect.
        ...(type === "satellite" ? { layerTypes: ["layerRoadmap"] } : {}),
      }),
      cache: "no-store",
    },
  );

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`createSession ${res.status}: ${detail.slice(0, 200)}`);
  }

  const body = (await res.json()) as { session: string; expiry?: string };
  // `expiry` is unix seconds as a string; fall back to a conservative hour.
  const expirySec = Number(body.expiry);
  const expiresAt = Number.isFinite(expirySec)
    ? expirySec * 1000
    : Date.now() + 60 * 60 * 1000;

  const session: Session = { token: body.session, expiresAt };
  sessions.set(type, session);
  return session;
}

export async function GET(
  req: NextRequest,
  { params }: { params: { seg: string[] } },
) {
  const key = apiKey();
  if (!key) {
    return NextResponse.json({ error: "google_maps_key_missing" }, { status: 503 });
  }

  const [type, z, x, y] = params.seg ?? [];

  // /api/maptile/status — does Google actually serve us tiles right now?
  // The map calls this once and only offers the Google basemaps if it says yes.
  if (type === "status") {
    try {
      await sessionFor("roadmap", key);
      return NextResponse.json({ available: true });
    } catch (e) {
      return NextResponse.json({
        available: false,
        reason: (e as Error).message,
      });
    }
  }

  if (!MAP_TYPES.includes(type as MapType)) {
    return NextResponse.json({ error: "bad_map_type" }, { status: 400 });
  }
  if (![z, x, y].every((v) => /^\d+$/.test(v ?? ""))) {
    return NextResponse.json({ error: "bad_tile_coords" }, { status: 400 });
  }

  try {
    const session = await sessionFor(type as MapType, key);
    const url =
      `https://tile.googleapis.com/v1/2dtiles/${z}/${x}/${y}` +
      `?session=${encodeURIComponent(session.token)}&key=${encodeURIComponent(key)}`;

    const upstream = await fetch(url, { cache: "no-store" });
    if (!upstream.ok) {
      // A stale token reads as 401/403 — drop it so the next request re-mints.
      if (upstream.status === 401 || upstream.status === 403) {
        sessions.delete(type as MapType);
      }
      return NextResponse.json(
        { error: "tile_failed", status: upstream.status },
        { status: upstream.status },
      );
    }

    const bytes = await upstream.arrayBuffer();
    return new NextResponse(bytes, {
      status: 200,
      headers: {
        "Content-Type": upstream.headers.get("content-type") ?? "image/png",
        // Google permits caching tiles; this keeps repeat panning off the quota.
        "Cache-Control": "public, max-age=604800, immutable",
      },
    });
  } catch (e) {
    return NextResponse.json(
      { error: "tile_error", message: (e as Error).message },
      { status: 502 },
    );
  }
}
