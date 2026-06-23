import { NextRequest, NextResponse } from 'next/server';
import { SESSION_COOKIE, traccarBase, traccarCookieHeader } from '@/lib/auth';

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
  return res;
}
