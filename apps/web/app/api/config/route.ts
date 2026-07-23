import { NextRequest, NextResponse } from 'next/server';
import { SESSION_COOKIE, traccarBase } from '@/lib/auth';

// Deployment facts the admin UI needs client-side. Deliberately NOT under
// /api/traccar/ — that path is a catch-all proxy straight to the Traccar API.

export const dynamic = 'force-dynamic';

export function GET(req: NextRequest) {
  if (!req.cookies.get(SESSION_COOKIE)?.value) {
    return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  }
  // Trackers report to the Traccar host itself (on a protocol port, not the
  // web port) — hand the hostname to the SMS-setup card as a default.
  let trackerHost = '';
  try {
    trackerHost = new URL(traccarBase()).hostname;
  } catch {
    /* unset/invalid TRACCAR_URL — the field just starts empty */
  }
  return NextResponse.json({ trackerHost });
}
