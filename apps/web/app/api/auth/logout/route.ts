import { NextRequest, NextResponse } from 'next/server';
import {
  SESSION_COOKIE,
  SOCKET_PATH,
  TRACCAR_COOKIE,
  traccarBase,
  traccarCookieHeader,
} from '@/lib/auth';

export const dynamic = 'force-dynamic';

// POST -> ends the Traccar session (best-effort) and clears our cookie.
export async function POST(req: NextRequest) {
  const jsessionid = req.cookies.get(SESSION_COOKIE)?.value;
  if (jsessionid) {
    try {
      await fetch(`${traccarBase()}/api/session`, {
        method: 'DELETE',
        headers: { Cookie: traccarCookieHeader(jsessionid) },
        cache: 'no-store',
      });
    } catch {
      // Best-effort: even if Traccar is unreachable, drop our cookie below.
    }
  }
  const res = NextResponse.json({ ok: true });
  res.cookies.delete(SESSION_COOKIE);
  // A cookie is only cleared by matching its path, so the socket cookie has to
  // be deleted on the path it was set on, not the default '/'.
  res.cookies.set(TRACCAR_COOKIE, '', { path: SOCKET_PATH, maxAge: 0 });
  return res;
}
