import type { TraccarPosition } from "@carva/shared";

// Distance, driving time and top speed, measured from the GPS route itself.
//
// Why not Traccar's numbers: its reports take distance from a running counter
// (`totalDistance`, or the tracker's own odometer) that is accumulated in the
// order positions ARRIVE. These trackers buffer fixes while out of coverage
// and upload them late, interleaved with live ones - so in time order the
// counter runs backwards. Measured on 2026-10-14 for one car: the counter said
// 106.8 km for the day and produced trips of -41.2 km and -43.3 km, while the
// route itself was 262.8 km over 4.97 h of driving (53 km/h average - a car
// doing highway runs, which is what it is). The route is the ground truth.
//
// The one shared implementation, so History, trip chips and the vehicle
// profile can never disagree about how far a car went.

const KNOT_KMH = 1.852;
/** Below this the car is standing still; GPS jitter must not count as travel. */
const MOVING_KMH = 3;
/** A hop implying more than this is a bad fix, not a very fast car. */
const IMPOSSIBLE_KMH = 220;
/** A gap longer than this between fixes is a stop, not driving time. */
const DRIVE_GAP_MS = 5 * 60_000;

export interface RouteStats {
  /** Metres travelled along the route. */
  distanceM: number;
  /** Milliseconds spent actually moving. */
  drivingMs: number;
  /** Fastest reported speed while moving, km/h (bad fixes excluded). */
  topSpeedKmh: number;
  /** Fixes considered. */
  points: number;
}

function haversineM(a: TraccarPosition, b: TraccarPosition): number {
  const R = 6_371_000;
  const rad = Math.PI / 180;
  const dLat = (b.latitude - a.latitude) * rad;
  const dLng = (b.longitude - a.longitude) * rad;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(a.latitude * rad) * Math.cos(b.latitude * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

const time = (p: TraccarPosition) => +new Date(p.fixTime);

/**
 * Stats for a set of fixes. Order does not matter (they are sorted by fix
 * time here), and an optional [from, to] window keeps only fixes inside it -
 * which is how one trip's distance is taken from a whole day's positions.
 */
export function routeStats(
  positions: TraccarPosition[],
  window?: { from: string | number | Date; to: string | number | Date },
): RouteStats {
  let pts = positions;
  if (window) {
    const lo = +new Date(window.from);
    const hi = +new Date(window.to);
    pts = pts.filter((p) => {
      const t = time(p);
      return t >= lo && t <= hi;
    });
  }
  pts = [...pts].sort((a, b) => time(a) - time(b));

  let distanceM = 0;
  let drivingMs = 0;
  let topSpeedKmh = 0;

  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1];
    const b = pts[i];
    const dt = time(b) - time(a);
    if (!(dt > 0)) continue;
    const moving = a.speed * KNOT_KMH >= MOVING_KMH || b.speed * KNOT_KMH >= MOVING_KMH;
    if (!moving) continue;
    const d = haversineM(a, b);
    if ((d / dt) * 3600 > IMPOSSIBLE_KMH) continue; // a teleport, not a drive
    distanceM += d;
    if (dt < DRIVE_GAP_MS) drivingMs += dt;
    topSpeedKmh = Math.max(topSpeedKmh, b.speed * KNOT_KMH);
  }

  return { distanceM, drivingMs, topSpeedKmh: Math.round(topSpeedKmh), points: pts.length };
}

/** Start of today in the fleet's time zone (Erbil), as an ISO string. */
export function startOfFleetDay(now = new Date(), timeZone = "Asia/Baghdad"): string {
  // The offset of `timeZone` at `now`, via Intl - no date library needed.
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  const offsetMs = asUtc - Math.floor(now.getTime() / 1000) * 1000;
  const midnightLocalAsUtc = Date.UTC(get("year"), get("month") - 1, get("day"));
  return new Date(midnightLocalAsUtc - offsetMs).toISOString();
}

/* --------------------------------- Trips --------------------------------- */
//
// Trips found in the route itself, with the same "standing still" rule as
// playback (History) uses. Traccar's own trips report is both slow on this
// fleet (~36 s for a week of one car) and wrong (its distances come from the
// backwards-running counter above); this needs only the positions, which the
// caller usually has already.

/** Standing still for this long ends a trip (a red light does not). */
const TRIP_BREAK_MS = 5 * 60_000;
/** Same spot = within this radius of where the car stopped. */
const STILL_RADIUS_M = 40;
/** Shorter than this is GPS wander or repositioning, not a trip. */
const MIN_TRIP_M = 300;

export interface DetectedTrip {
  startTime: string;
  endTime: string;
  distanceM: number;
  durationMs: number;
  maxSpeedKmh: number;
}

export function detectTrips(positions: TraccarPosition[]): DetectedTrip[] {
  const pts = [...positions].sort((a, b) => time(a) - time(b));
  const trips: DetectedTrip[] = [];
  let start = -1; // index where the current trip began
  let stillSince = -1; // index where the car last came to rest, during a trip

  const close = (endIdx: number) => {
    if (start < 0 || endIdx <= start) return;
    const slice = pts.slice(start, endIdx + 1);
    const s = routeStats(slice);
    if (s.distanceM >= MIN_TRIP_M) {
      trips.push({
        startTime: pts[start].fixTime,
        endTime: pts[endIdx].fixTime,
        distanceM: s.distanceM,
        durationMs: time(pts[endIdx]) - time(pts[start]),
        maxSpeedKmh: s.topSpeedKmh,
      });
    }
    start = -1;
    stillSince = -1;
  };

  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    const moving = p.speed * KNOT_KMH >= MOVING_KMH;
    const prev = i > 0 ? pts[i - 1] : null;
    const gap = prev ? time(p) - time(prev) : 0;
    // Silence is ambiguous: parked with the tracker asleep, or driving through
    // a coverage hole. Where the car reappears decides it. Measured on this
    // fleet: 73 minutes without a fix, then the car 52 km down the highway -
    // that was one drive, and Traccar counted it as one trip too.
    const droveThroughGap =
      prev != null &&
      gap >= TRIP_BREAK_MS &&
      haversineM(prev, p) > STILL_RADIUS_M &&
      (haversineM(prev, p) / gap) * 3600 <= IMPOSSIBLE_KMH;

    if (start < 0) {
      if (moving || droveThroughGap) start = prev && (gap < TRIP_BREAK_MS || droveThroughGap) ? i - 1 : i;
      continue;
    }
    // A long silence inside a trip: either it carried on through it, or the
    // trip ended where the data stopped.
    if (gap >= TRIP_BREAK_MS) {
      if (droveThroughGap) {
        stillSince = -1;
        continue;
      }
      close(i - 1);
      if (moving) start = i;
      continue;
    }
    if (moving) {
      // Moving again - but only if it actually left the spot it rested at.
      if (stillSince >= 0 && haversineM(pts[stillSince], p) > STILL_RADIUS_M) stillSince = -1;
      continue;
    }
    if (stillSince < 0) stillSince = i;
    else if (time(p) - time(pts[stillSince]) >= TRIP_BREAK_MS) close(stillSince);
  }
  if (start >= 0) close(stillSince >= 0 ? stillSince : pts.length - 1);
  return trips;
}
