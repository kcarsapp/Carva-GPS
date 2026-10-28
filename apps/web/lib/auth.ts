// Auth helpers shared by the auth API routes, the Traccar proxy, and middleware.
//
// We don't have the Carva (NestJS) backend yet, so authentication is delegated
// to Traccar's own session API: the user logs in with their Traccar credentials,
// and we hold the resulting JSESSIONID server-side in an httpOnly cookie. Every
// proxied request replays that cookie, so each user only ever sees their own
// devices — no shared admin credentials reach the browser.

/** Name of our httpOnly cookie that stores the upstream Traccar JSESSIONID. */
export const SESSION_COOKIE = 'carva_session';

/** Base URL of the Traccar server (trailing slash stripped). */
export function traccarBase(): string {
  return (process.env.TRACCAR_URL ?? 'https://demo.traccar.org').replace(/\/$/, '');
}

/** Build the upstream Cookie header that authenticates as the given session. */
export function traccarCookieHeader(jsessionid: string): string {
  return `JSESSIONID=${jsessionid}`;
}

/** Extract the JSESSIONID value from an upstream Set-Cookie header, if present. */
export function parseJsessionId(setCookie: string | null): string | null {
  if (!setCookie) return null;
  const match = setCookie.match(/JSESSIONID=([^;]+)/);
  return match ? match[1] : null;
}

/* ------------------------------ Roles ----------------------------------- */

/** The three Carva account roles. */
export type CarvaRole = 'general_admin' | 'company' | 'personal';

export interface TraccarUserLike {
  administrator?: boolean;
  attributes?: Record<string, unknown> | null;
}

/** Derive the Carva role from a Traccar user (admin flag + accountType attr). */
export function deriveRole(user: TraccarUserLike): CarvaRole {
  if (user.administrator) return 'general_admin';
  return accountTypeOf(user) === 'personal' ? 'personal' : 'company';
}

/** The raw accountType attribute ('company' | 'personal'), if set. */
export function accountTypeOf(user: TraccarUserLike): string | null {
  const t = user.attributes?.accountType;
  return typeof t === 'string' ? t : null;
}

/** Admin credentials used server-side to create users during signup. */
export function adminCredentials(): { email: string; password: string } | null {
  const email = process.env.TRACCAR_ADMIN_EMAIL;
  const password = process.env.TRACCAR_ADMIN_PASSWORD;
  if (!email || !password) return null;
  return { email, password };
}

/** Options for our session cookie. Secure only in production (so http://localhost works). */
export function sessionCookieOptions() {
  return {
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    // Mirror Traccar's default session lifetime loosely; refreshed on each login.
    maxAge: 60 * 60 * 24 * 7, // 7 days
  };
}

/* ---------------------------- Socket session ----------------------------- */
//
// Live push needs a cookie the browser can send on a WebSocket handshake.
//
// `new WebSocket(url)` accepts no headers, and a Next route handler cannot
// proxy an HTTP upgrade, so the socket is served straight from nginx to
// Traccar's /api/socket. That means the handshake has to carry Traccar's OWN
// cookie name — our `carva_session` means nothing upstream.
//
// It is the same secret we already hold, exposed as narrowly as possible:
// scoped to the socket path so it rides on no other request, httpOnly so no
// script can read it, and SameSite=Lax so a cross-site page cannot open an
// authenticated stream (a WS handshake is not a top-level navigation, so Lax
// withholds the cookie).

/** The cookie name Traccar itself looks for on the socket handshake. */
export const TRACCAR_COOKIE = 'JSESSIONID';

/** The only path that ever needs the upstream cookie. */
export const SOCKET_PATH = '/traccar-socket';

/** Options for the upstream-named cookie that authenticates the live socket. */
export function socketCookieOptions() {
  return {
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: process.env.NODE_ENV === 'production',
    path: SOCKET_PATH,
    maxAge: 60 * 60 * 24 * 7, // matches the session cookie
  };
}
