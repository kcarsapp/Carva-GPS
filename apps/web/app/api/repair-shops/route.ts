import { NextRequest, NextResponse } from "next/server";

import { queryOverpass } from "@/lib/overpass";
import { isValidShopBbox, repairShopQuery, shopsFromOverpass } from "@/lib/repair-shops";

// Car repair shops in an area, from OpenStreetMap (see lib/repair-shops.ts).
//
//   GET ?bbox=west,south,east,north  ->  { shops: RepairShop[] }
//
// Read-only and signed-in only (middleware); the geofences themselves are
// created by the page through the normal Traccar proxy, as the user.

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const bbox = (req.nextUrl.searchParams.get("bbox") ?? "").split(",").map(Number);
  if (!isValidShopBbox(bbox)) {
    return NextResponse.json({ error: "invalid_bbox" }, { status: 400 });
  }
  try {
    const shops = shopsFromOverpass(await queryOverpass(repairShopQuery(bbox)));
    return NextResponse.json({ shops });
  } catch (e) {
    return NextResponse.json({ error: "overpass_failed", message: (e as Error).message }, { status: 502 });
  }
}
