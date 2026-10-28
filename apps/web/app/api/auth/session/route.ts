import { NextRequest, NextResponse } from 'next/server';
import type { TraccarUser } from '@carva/shared';
import {
  SESSION_COOKIE,
  TRACCAR_COOKIE,
  accountTypeOf,
  deriveRole,
  socketCookieOptions,
  traccarBase,
  traccarCookieHeader,
} from '@/lib/auth';

export const dynamic = 'force-dynamic';

// GET -> returns the currently logged-in Traccar user, or 401.
// Validates the stored session by hitting Traccar's GET /api/session.
export async function GET(req: NextRequest) {
  const jsessionid = req.cookies.get(SESSION_COOKIE)?.value;
  if (!jsessionid) {
    return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  }

  try {
    const upstream = await fetch(`${traccarBase()}/api/session`, {
      headers: { Cookie: traccarCookieHeader(jsessionid), Accept: 'application/json' },
      cache: 'no-store',
    });
    if (!upstream.ok) {
      return NextResponse.json({ error: 'session_expired' }, { status: 401 });
    }
    const user = (await upstream.json()) as TraccarUser & {
      attributes?: Record<string, unknown>;
    };
    const res = NextResponse.json({
      id: user.id,
      name: user.name,
      email: user.email,
      administrator: user.administrator,
      readonly: user.readonly,
      accountType: accountTypeOf(user),
      role: deriveRole(user),
    });
    // Every page load validates the session here, which makes this the one
    // place that can hand an ALREADY logged-in browser its socket cookie —
    // otherwise live push would only start after the next sign-in. Traccar has
    // just confirmed the id is good, so re-issuing it costs nothing.
    res.cookies.set(TRACCAR_COOKIE, jsessionid, socketCookieOptions());
    return res;
  } catch (e) {
    return NextResponse.json(
      { error: 'traccar_unreachable', message: (e as Error).message },
      { status: 502 },
    );
  }
}
