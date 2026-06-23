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
