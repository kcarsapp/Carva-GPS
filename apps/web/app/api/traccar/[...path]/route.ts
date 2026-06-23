import { NextRequest, NextResponse } from 'next/server';

// Server-side proxy to the Traccar REST API.
// Attaches HTTP Basic auth from env so credentials never reach the browser,
// and sidesteps CORS. Read-only GET passthrough for now.

export const dynamic = 'force-dynamic'; // always fresh (live data)

function auth(): string {
  const email = process.env.TRACCAR_EMAIL ?? '';
  const password = process.env.TRACCAR_PASSWORD ?? '';
  return 'Basic ' + Buffer.from(`${email}:${password}`).toString('base64');
}

export async function GET(
  req: NextRequest,
  { params }: { params: { path: string[] } },
) {
  const base = (process.env.TRACCAR_URL ?? 'https://demo.traccar.org').replace(/\/$/, '');
  const path = params.path.join('/');
  const search = req.nextUrl.search; // forward query string (e.g. ?deviceId=&from=&to=)
  const target = `${base}/api/${path}${search}`;

  try {
    const res = await fetch(target, {
      headers: { Authorization: auth(), Accept: 'application/json' },
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
