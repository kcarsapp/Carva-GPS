import { NextRequest, NextResponse } from 'next/server';
import { SESSION_COOKIE, traccarBase, traccarCookieHeader } from '@/lib/auth';

// Server-side proxy to the Traccar REST API.
// Replays the logged-in user's Traccar session (held in our httpOnly cookie)
// so credentials never reach the browser and each user only sees what their
// role allows. Write methods are forwarded too — Traccar enforces authorization
// server-side (e.g. only administrators can create users/devices/permissions).

export const dynamic = 'force-dynamic'; // always fresh (live data)

async function proxy(
  req: NextRequest,
  path: string[],
  method: 'GET' | 'POST' | 'PUT' | 'DELETE',
) {
  const jsessionid = req.cookies.get(SESSION_COOKIE)?.value;
  if (!jsessionid) {
    return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  }

  const target = `${traccarBase()}/api/${path.join('/')}${req.nextUrl.search}`;
  const headers: Record<string, string> = {
    Cookie: traccarCookieHeader(jsessionid),
    Accept: 'application/json',
  };

  let body: string | undefined;
  if (method === 'POST' || method === 'PUT' || method === 'DELETE') {
    // DELETE included: Traccar's DELETE /api/permissions expects a JSON body.
    body = (await req.text()) || undefined;
    if (body) {
      headers['Content-Type'] = req.headers.get('content-type') ?? 'application/json';
    }
  }

  try {
    const res = await fetch(target, { method, headers, body, cache: 'no-store' });
    // 204/205/304 must have a null body, or the Response constructor throws.
    if (res.status === 204 || res.status === 205 || res.status === 304) {
      return new NextResponse(null, { status: res.status });
    }
    const text = await res.text();
    return new NextResponse(text, {
      status: res.status,
      headers: { 'Content-Type': res.headers.get('content-type') ?? 'application/json' },
    });
  } catch (e) {
    return NextResponse.json(
      { error: 'traccar_proxy_failed', message: (e as Error).message },
      { status: 502 },
    );
  }
}

type Ctx = { params: { path: string[] } };

export const GET = (req: NextRequest, { params }: Ctx) => proxy(req, params.path, 'GET');
export const POST = (req: NextRequest, { params }: Ctx) => proxy(req, params.path, 'POST');
export const PUT = (req: NextRequest, { params }: Ctx) => proxy(req, params.path, 'PUT');
export const DELETE = (req: NextRequest, { params }: Ctx) => proxy(req, params.path, 'DELETE');
