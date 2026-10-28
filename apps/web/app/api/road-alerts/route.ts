import { NextRequest, NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";

import { SESSION_COOKIE, traccarBase, traccarCookieHeader } from "@/lib/auth";
import { sanitizeRoadAlert, type RoadAlertRecord } from "@/lib/road-alerts";

// Speed-camera and speed-bump alerts for the Alerts page.
//
//   GET ?deviceId=1&deviceId=2&from=ISO&to=ISO -> { alerts: RoadAlertRecord[] }
//
// The mailer writes them (infra/automation/mailer.js → road-alerts.jsonl); this
// route only reads. Tenancy comes from Traccar: the caller's own session lists
// the devices they may see, and nothing for any other device is returned.

export const dynamic = "force-dynamic";

const ALERTS_PATH =
  process.env.CARVA_ROAD_ALERTS ??
  path.join(
    path.dirname(process.env.CARVA_ALERT_SETTINGS ?? "/var/lib/carva/alert-settings.json"),
    "road-alerts.jsonl",
  );
const MAX_RESULTS = 2000;

async function readLines(file: string): Promise<string[]> {
  try {
    return (await fs.readFile(file, "utf8")).split("\n");
  } catch {
    return [];
  }
}

export async function GET(req: NextRequest) {
  const jsessionid = req.cookies.get(SESSION_COOKIE)?.value;
  if (!jsessionid) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const params = req.nextUrl.searchParams;
  const from = +new Date(params.get("from") ?? "");
  const to = +new Date(params.get("to") ?? "");
  if (!Number.isFinite(from) || !Number.isFinite(to) || from > to) {
    return NextResponse.json({ error: "from/to required" }, { status: 400 });
  }

  // Which devices this user may see, according to Traccar itself.
  let allowed: Set<number>;
  try {
    const res = await fetch(`${traccarBase()}/api/devices`, {
      headers: { Cookie: traccarCookieHeader(jsessionid), Accept: "application/json" },
      cache: "no-store",
    });
    if (res.status === 401) return NextResponse.json({ error: "session_expired" }, { status: 401 });
    if (!res.ok) return NextResponse.json({ error: `devices_${res.status}` }, { status: 502 });
    const devices = (await res.json()) as { id: number }[];
    allowed = new Set(Array.isArray(devices) ? devices.map((d) => d.id) : []);
  } catch (e) {
    return NextResponse.json({ error: "traccar_unreachable", message: (e as Error).message }, { status: 502 });
  }

  const requested = params.getAll("deviceId").map(Number).filter(Number.isFinite);
  const wanted = requested.length ? requested.filter((id) => allowed.has(id)) : [...allowed];
  const deviceSet = new Set(wanted);
  if (deviceSet.size === 0) return NextResponse.json({ alerts: [] });

  const lines = [...(await readLines(`${ALERTS_PATH}.1`)), ...(await readLines(ALERTS_PATH))];
  const byId = new Map<number, RoadAlertRecord>();
  for (const line of lines) {
    if (!line) continue;
    let rec: RoadAlertRecord | null;
    try {
      rec = sanitizeRoadAlert(JSON.parse(line));
    } catch {
      continue;
    }
    if (!rec || !deviceSet.has(rec.deviceId)) continue;
    const at = +new Date(rec.ts);
    if (at < from || at > to) continue;
    // A restart can re-read the same fixes; ids are stable, so keep one.
    byId.set(rec.id, rec);
  }
  const alerts = [...byId.values()]
    .sort((a, b) => +new Date(b.ts) - +new Date(a.ts))
    .slice(0, MAX_RESULTS);
  return NextResponse.json({ alerts });
}
