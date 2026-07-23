import { NextRequest, NextResponse } from 'next/server';
import type { TraccarUser } from '@carva/shared';
import {
  SESSION_COOKIE,
  adminCredentials,
  deriveRole,
  parseJsessionId,
  sessionCookieOptions,
  traccarBase,
} from '@/lib/auth';

export const dynamic = 'force-dynamic';

type AccountType = 'company' | 'personal';

// POST { name, email, password, accountType, companyName? }
// Creates a real Traccar user (using server-side admin credentials) with an
// `accountType` attribute, then logs the new user straight in. Traccar enforces
// per-user device isolation, so each account only ever sees its own vehicles.
export async function POST(req: NextRequest) {
  let name = '';
  let email = '';
  let password = '';
  let accountType: AccountType = 'personal';
  let companyName = '';
  try {
    const body = await req.json();
    name = String(body.name ?? '').trim();
    email = String(body.email ?? '').trim();
    password = String(body.password ?? '');
    accountType = body.accountType === 'company' ? 'company' : 'personal';
    companyName = String(body.companyName ?? '').trim();
  } catch {
    return NextResponse.json({ error: 'invalid_body' }, { status: 400 });
  }

  if (!name || !email || !password) {
    return NextResponse.json({ error: 'missing_fields' }, { status: 400 });
  }
  if (password.length < 6) {
    return NextResponse.json({ error: 'weak_password' }, { status: 400 });
  }
  if (accountType === 'company' && !companyName) {
    return NextResponse.json({ error: 'missing_company' }, { status: 400 });
  }

  const admin = adminCredentials();
  if (!admin) {
    return NextResponse.json({ error: 'signup_unavailable' }, { status: 503 });
  }

  const base = traccarBase();
  const adminAuth =
    'Basic ' + Buffer.from(`${admin.email}:${admin.password}`).toString('base64');

  // 1) Create the Traccar user as admin.
  let createRes: Response;
  try {
    createRes = await fetch(`${base}/api/users`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        Authorization: adminAuth,
      },
      body: JSON.stringify({
        name,
        email,
        password,
        attributes: {
          accountType,
          ...(accountType === 'company' && companyName ? { companyName } : {}),
        },
      }),
      cache: 'no-store',
    });
  } catch (e) {
    return NextResponse.json(
      { error: 'traccar_unreachable', message: (e as Error).message },
      { status: 502 },
    );
  }

  if (!createRes.ok) {
    // Traccar returns 400 with a message when the email already exists.
    const text = await createRes.text().catch(() => '');
    const exists = /exist|duplicate|unique/i.test(text);
    return NextResponse.json(
      { error: exists ? 'email_taken' : 'create_failed', message: text.slice(0, 300) },
      { status: exists ? 409 : 502 },
    );
  }

  // 2) Log the new user in to establish their own session.
  let sessRes: Response;
  try {
    sessRes = await fetch(`${base}/api/session`, {
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

  if (!sessRes.ok) {
    // Account was created but auto-login failed — let them sign in manually.
    return NextResponse.json({ ok: true, autoLogin: false }, { status: 201 });
  }

  const jsessionid = parseJsessionId(sessRes.headers.get('set-cookie'));
  const user = (await sessRes.json()) as TraccarUser & {
    attributes?: Record<string, unknown>;
  };

  const res = NextResponse.json({
    id: user.id,
    name: user.name,
    email: user.email,
    administrator: user.administrator,
    accountType,
    role: deriveRole({ administrator: user.administrator, attributes: { accountType } }),
  });
  if (jsessionid) {
    res.cookies.set(SESSION_COOKIE, jsessionid, sessionCookieOptions());
  }
  return res;
}
