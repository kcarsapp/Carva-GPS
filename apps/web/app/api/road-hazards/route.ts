import { NextRequest, NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";

import { requireAdmin } from "@/lib/require-admin";
import {
  EMPTY_HAZARD_FILE,
  applyHazardEdits,
  hazardsFromOverpass,
  isValidBbox,
  mergeOsmImport,
  overpassQuery,
  sanitizeHazard,
  sanitizeHazardFile,
  type RoadHazard,
  type RoadHazardFile,
} from "@/lib/road-hazards";

// Speed cameras + bumps (see lib/road-hazards.ts).
//
//   GET  -> { file }                    anyone signed in (middleware)
//   PUT  -> { upsert: [], remove: [] }  admins: edit pins, merged server-side
//   POST -> { bbox: [w,s,e,n] }         admins: import that area from OSM
//
// The mailer (infra/automation/mailer.js) re-reads the file when it changes,
// so an edit takes effect on its next poll without a restart.

export const dynamic = "force-dynamic";

const HAZARDS_PATH =
  process.env.CARVA_ROAD_HAZARDS ??
  path.join(
    path.dirname(process.env.CARVA_ALERT_SETTINGS ?? "/var/lib/carva/alert-settings.json"),
    "road-hazards.json",
  );
const OVERPASS_URL = process.env.OVERPASS_URL ?? "https://overpass-api.de/api/interpreter";

async function current(): Promise<RoadHazardFile> {
  try {
    return sanitizeHazardFile(JSON.parse(await fs.readFile(HAZARDS_PATH, "utf8")));
  } catch {
    return EMPTY_HAZARD_FILE;
  }
}

/** Atomic write: the mailer never reads half a file. */
async function write(file: RoadHazardFile, by: string): Promise<RoadHazardFile> {
  const next = { ...file, updatedAt: new Date().toISOString(), updatedBy: by };
  await fs.mkdir(path.dirname(HAZARDS_PATH), { recursive: true });
  const tmp = `${HAZARDS_PATH}.${process.pid}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(next));
  await fs.rename(tmp, HAZARDS_PATH);
  return next;
}

async function readBody(req: NextRequest): Promise<Record<string, unknown> | null> {
  try {
    const body: unknown = await req.json();
    return body && typeof body === "object" ? (body as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

export async function GET() {
  return NextResponse.json({ file: await current() });
}

export async function PUT(req: NextRequest) {
  const admin = await requireAdmin(req);
  if (admin instanceof NextResponse) return admin;
  const body = await readBody(req);
  if (!body) return NextResponse.json({ error: "invalid_json" }, { status: 400 });

  const upsert = (Array.isArray(body.upsert) ? body.upsert : [])
    .map(sanitizeHazard)
    .filter((h): h is RoadHazard => !!h)
    .slice(0, 500);
  const remove = (Array.isArray(body.remove) ? body.remove : [])
    .filter((id): id is string => typeof id === "string")
    .slice(0, 500);
  try {
    const file = await write(applyHazardEdits(await current(), upsert, remove), admin.email);
    return NextResponse.json({ file });
  } catch (e) {
    return NextResponse.json({ error: "write_failed", message: (e as Error).message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const admin = await requireAdmin(req);
  if (admin instanceof NextResponse) return admin;
  const body = await readBody(req);
  if (!body || !isValidBbox(body.bbox)) {
    return NextResponse.json({ error: "invalid_bbox" }, { status: 400 });
  }
  const bbox = body.bbox;

  let pulled: RoadHazard[];
  try {
    const res = await fetch(OVERPASS_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "User-Agent": "CarvaFleet/1.0 (https://gps.carvarent.com; fleet@carvarent.com)",
        Accept: "application/json",
      },
      body: new URLSearchParams({ data: overpassQuery(bbox) }),
      cache: "no-store",
      signal: AbortSignal.timeout(100_000),
    });
    if (!res.ok) {
      return NextResponse.json({ error: `overpass_${res.status}` }, { status: 502 });
    }
    const data = (await res.json()) as { elements?: unknown };
    pulled = hazardsFromOverpass(data.elements);
  } catch (e) {
    return NextResponse.json({ error: "overpass_failed", message: (e as Error).message }, { status: 502 });
  }

  try {
    const merged = mergeOsmImport(await current(), bbox, pulled);
    const file = await write(merged.file, admin.email);
    return NextResponse.json({
      file,
      imported: { found: pulled.length, added: merged.added, updated: merged.updated, dropped: merged.dropped },
    });
  } catch (e) {
    return NextResponse.json({ error: "write_failed", message: (e as Error).message }, { status: 500 });
  }
}
