import { NextRequest, NextResponse } from 'next/server';
import { SESSION_COOKIE } from '@/lib/auth';

// Gate the app dashboard and the Traccar proxy behind a session cookie.
// Pages redirect to /login; API calls get a clean 401 so the client can react.
export function middleware(req: NextRequest) {
  const hasSession = Boolean(req.cookies.get(SESSION_COOKIE)?.value);
  if (hasSession) return NextResponse.next();

  const { pathname } = req.nextUrl;

  if (pathname.startsWith('/api/')) {
    return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  }

  const url = req.nextUrl.clone();
  url.pathname = '/login';
  url.searchParams.set('next', pathname);
  return NextResponse.redirect(url);
}

export const config = {
  // Only guard the dashboard, the Traccar data proxy and the third-party
  // proxies (directions, geocode and map tiles spend a provider's quota — the
  // tiles a paid Google key). Auth routes and the public landing page stay open.
  matcher: [
    '/app/:path*',
    '/api/traccar/:path*',
    '/api/directions',
    '/api/geocode',
    '/api/maptile/:path*',
    '/api/alert-settings',
  ],
};
