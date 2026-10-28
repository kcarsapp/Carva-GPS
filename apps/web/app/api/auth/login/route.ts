import { NextRequest, NextResponse } from 'next/server';
import type { TraccarUser } from '@carva/shared';
import {
  SESSION_COOKIE,
  TRACCAR_COOKIE,
  accountTypeOf,
  deriveRole,
  parseJsessionId,
  sessionCookieOptions,
  socketCookieOptions,
  traccarBase,
} from '@/lib/auth';

export const dynamic = 'force-dynamic';

// POST { email, password } -> logs in against Traccar's /api/session.
// On success we stash the upstream JSESSIONID in our own httpOnly cookie and
// return the (sanitised) Traccar user. Credentials are never stored.
export async function POST(req: NextRequest) {
  let email = '';
  let password = '';
  try {
    const body = await req.json();
    email = String(body.email ?? '');
    password = String(body.password ?? '');
  } catch {
    return NextResponse.json({ error: 'invalid_body' }, { status: 400 });
  }
  if (!email || !password) {
    return NextResponse.json({ error: 'missing_credentials' }, { status: 400 });
  }

  let upstream: Response;
  try {
    upstream = await fetch(`${traccarBase()}/api/session`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
      },
      body: new URLSearchParams({ email, password }),
      cache: 'no-store',
    });
  } catch (e) {
    return NextResponse.json(
      { error: 'traccar_unreachable', message: (e as Error).message },
      { status: 502 },
    );
  }

  if (!upstream.ok) {
    return NextResponse.json({ error: 'invalid_credentials' }, { status: 401 });
  }

  const jsessionid = parseJsessionId(upstream.headers.get('set-cookie'));
  if (!jsessionid) {
    return NextResponse.json({ error: 'no_session_cookie' }, { status: 502 });
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
  res.cookies.set(SESSION_COOKIE, jsessionid, sessionCookieOptions());
  // Same secret under Traccar's own cookie name, scoped to the socket path, so
  // the browser can authenticate the live-push handshake nginx serves there.
  res.cookies.set(TRACCAR_COOKIE, jsessionid, socketCookieOptions());
  return res;
}
