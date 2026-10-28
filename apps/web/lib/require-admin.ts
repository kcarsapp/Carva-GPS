import { NextRequest, NextResponse } from "next/server";

import { SESSION_COOKIE, deriveRole, traccarBase, traccarCookieHeader } from "@/lib/auth";

// Server-only guard shared by the routes that change server-wide files
// (email-alert settings, speed cameras and bumps). The cookie alone proves
// nothing — Traccar is asked who it belongs to on every call.

export type Admin = { email: string };

/** The logged-in Traccar user, if they are an administrator. */
export async function requireAdmin(req: NextRequest): Promise<Admin | NextResponse> {
  const jsessionid = req.cookies.get(SESSION_COOKIE)?.value;
  if (!jsessionid) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  try {
    const res = await fetch(`${traccarBase()}/api/session`, {
      headers: { Cookie: traccarCookieHeader(jsessionid), Accept: "application/json" },
      cache: "no-store",
    });
    if (!res.ok) return NextResponse.json({ error: "session_expired" }, { status: 401 });
    const user = (await res.json()) as {
      email?: string;
      administrator?: boolean;
      attributes?: Record<string, unknown>;
    };
    if (deriveRole(user) !== "general_admin") {
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }
    return { email: user.email ?? "" };
  } catch (e) {
    return NextResponse.json(
      { error: "traccar_unreachable", message: (e as Error).message },
      { status: 502 },
    );
  }
}
