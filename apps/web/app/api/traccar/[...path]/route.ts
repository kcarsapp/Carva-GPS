import { NextRequest, NextResponse } from 'next/server';
import { SESSION_COOKIE, traccarBase, traccarCookieHeader } from '@/lib/auth';

// Server-side proxy to the Traccar REST API.
// Replays the logged-in user's Traccar session (held in our httpOnly cookie)
// so credentials never reach the browser and each user only sees their own
// devices. Read-only GET passthrough for now.

export const dynamic = 'force-dynamic'; // always fresh (live data)

export async function GET(
  req: NextRequest,
  { params }: { params: { path: string[] } },
) {
  const jsessionid = req.cookies.get(SESSION_COOKIE)?.value;
  if (!jsessionid) {
    return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  }

  const path = params.path.join('/');
  const search = req.nextUrl.search; // forward query string (e.g. ?deviceId=&from=&to=)
  const target = `${traccarBase()}/api/${path}${search}`;

  try {
    const res = await fetch(target, {
      headers: { Cookie: traccarCookieHeader(jsessionid), Accept: 'application/json' },
      cache: 'no-store',
    });
    const text = await res.text();
    return new NextResponse(text, {
      status: res.status,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (e) {
    return NextResponse.json(
      { error: 'traccar_proxy_failed', message: (e as Error).message },
      { status: 502 },
    );
  }
}
