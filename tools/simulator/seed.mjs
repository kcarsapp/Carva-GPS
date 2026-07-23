#!/usr/bin/env node
// Carva GPS — fleet + history seeder (virtual test data).
//
// Creates a handful of demo vehicles in the local Traccar server and feeds each
// one a back-dated trip via the OsmAnd protocol (port 5055), so both the live
// map and the History → replay tab have realistic data to show — no real
// trackers needed.
//
// How it works:
//   1. Logs in to the Traccar REST API as the super-admin and ensures each
//      demo device exists (idempotent — matched by uniqueId).
//   2. For each vehicle, generates a smooth route and POSTs positions to the
//      OsmAnd endpoint with timestamps spread across the last few hours, ending
//      "now". Because Traccar stores every reported position, this builds real
//      trip history that `reports/route` (the History tab) reads back.
//
// Usage:
//   node tools/simulator/seed.mjs
//
// Env overrides:
//   TRACCAR_URL    default http://localhost:8082   (REST API, for device CRUD)
//   OSMAND_URL     default http://localhost:5055   (position ingestion)
//   ADMIN_EMAIL    default admin@carva.local
//   ADMIN_PASSWORD default CarvaAdmin2026!
//   TRIP_MINUTES   default 45      (length of each seeded trip)
//   STEP_SECONDS   default 20      (gap between reported points)

const TRACCAR_URL = (process.env.TRACCAR_URL || 'http://localhost:8082').replace(/\/$/, '');
const OSMAND_URL = (process.env.OSMAND_URL || 'http://localhost:5055').replace(/\/$/, '');
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'admin@carva.local';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'CarvaAdmin2026!';
const TRIP_MINUTES = Number(process.env.TRIP_MINUTES || 45);
const STEP_SECONDS = Number(process.env.STEP_SECONDS || 20);

// --- Demo fleet. Each route is a list of [lat, lon] waypoints around Dubai. ---
// `end` controls how the trip finishes, so the live map shows varied states:
//   'moving'  — still driving at the last point
//   'idle'    — parked, engine running (speed 0, ignition on)
//   'stopped' — parked, engine off  (speed 0, ignition off)
const FLEET = [
  {
    name: 'Acme Van 1',
    uniqueId: 'acme-van-001',
    category: 'truck',
    speedKmh: 46,
    end: 'moving',
    route: [
      [25.2048, 55.2708], [25.2110, 55.2790], [25.2190, 55.2850],
      [25.2280, 55.2900], [25.2360, 55.2960], [25.2300, 55.3050],
      [25.2210, 55.3010], [25.2120, 55.2940],
    ],
  },
  {
    name: 'Carva Sedan 2',
    uniqueId: 'carva-sedan-002',
    category: 'car',
    speedKmh: 58,
    end: 'idle',
    route: [
      [25.1972, 55.2744], [25.1930, 55.2810], [25.1880, 55.2890],
      [25.1850, 55.2980], [25.1900, 55.3060], [25.1990, 55.3040],
      [25.2050, 55.2950],
    ],
  },
  {
    name: 'Delivery Bike 3',
    uniqueId: 'carva-bike-003',
    category: 'motorcycle',
    speedKmh: 32,
    end: 'stopped',
    route: [
      [25.2310, 55.2560], [25.2360, 55.2620], [25.2420, 55.2660],
      [25.2470, 55.2720], [25.2430, 55.2800], [25.2370, 55.2760],
    ],
  },
  {
    name: 'School Bus 4',
    uniqueId: 'carva-bus-004',
    category: 'bus',
    speedKmh: 38,
    end: 'stopped',
    route: [
      [25.2680, 55.3110], [25.2740, 55.3180], [25.2800, 55.3250],
      [25.2760, 55.3340], [25.2690, 55.3320], [25.2630, 55.3240],
      [25.2660, 55.3150],
    ],
  },
  {
    name: 'Logistics Truck 5',
    uniqueId: 'carva-truck-005',
    category: 'truck',
    speedKmh: 50,
    end: 'moving',
    route: [
      [25.1480, 55.2240], [25.1560, 55.2300], [25.1640, 55.2380],
      [25.1720, 55.2470], [25.1800, 55.2560], [25.1880, 55.2660],
      [25.1960, 55.2740],
    ],
  },
];

// --- geo helpers ---
const toRad = (d) => (d * Math.PI) / 180;
const toDeg = (r) => (r * 180) / Math.PI;
const R = 6371000;

function distanceM([lat1, lon1], [lat2, lon2]) {
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

function bearing([lat1, lon1], [lat2, lon2]) {
  const y = Math.sin(toRad(lon2 - lon1)) * Math.cos(toRad(lat2));
  const x =
    Math.cos(toRad(lat1)) * Math.sin(toRad(lat2)) -
    Math.sin(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.cos(toRad(lon2 - lon1));
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

function interpolate([lat1, lon1], [lat2, lon2], t) {
  return [lat1 + (lat2 - lat1) * t, lon1 + (lon2 - lon1) * t];
}

// Walk the polyline at a roughly constant speed, emitting a point every step.
// Returns [{ lat, lon, speedKmh, course }] in chronological order.
function buildTrack(route, speedKmh, points) {
  const stepM = ((speedKmh * 1000) / 3600) * STEP_SECONDS; // metres per step
  const out = [];
  let seg = 0;
  let progressM = 0;
  for (let i = 0; i < points; i++) {
    const a = route[seg];
    const b = route[(seg + 1) % route.length];
    const segLen = Math.max(distanceM(a, b), 1);
    const t = Math.min(progressM / segLen, 1);
    const [lat, lon] = interpolate(a, b, t);
    // Gentle speed variation so the trip looks human, never below a crawl.
    const wobble = 0.75 + 0.25 * Math.sin(i / 3) + (Math.random() - 0.5) * 0.1;
    out.push({ lat, lon, speedKmh: Math.max(8, speedKmh * wobble), course: bearing(a, b) });
    progressM += stepM;
    if (progressM >= segLen) {
      progressM -= segLen;
      seg = (seg + 1) % route.length;
    }
  }
  return out;
}

async function login() {
  const res = await fetch(`${TRACCAR_URL}/api/session`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `email=${encodeURIComponent(ADMIN_EMAIL)}&password=${encodeURIComponent(ADMIN_PASSWORD)}`,
  });
  if (!res.ok) throw new Error(`login failed: HTTP ${res.status} — check ADMIN_EMAIL/PASSWORD`);
  const cookie = res.headers.get('set-cookie');
  const jsid = cookie?.match(/JSESSIONID=([^;]+)/)?.[1];
  if (!jsid) throw new Error('login succeeded but no JSESSIONID returned');
  return `JSESSIONID=${jsid}`;
}

async function ensureDevice(cookie, v) {
  const list = await fetch(`${TRACCAR_URL}/api/devices`, { headers: { Cookie: cookie } }).then((r) =>
    r.json(),
  );
  const found = list.find((d) => d.uniqueId === v.uniqueId);
  if (found) return found;
  const res = await fetch(`${TRACCAR_URL}/api/devices`, {
    method: 'POST',
    headers: { Cookie: cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: v.name, uniqueId: v.uniqueId, category: v.category }),
  });
  if (!res.ok) throw new Error(`create ${v.name} failed: HTTP ${res.status} ${await res.text()}`);
  return res.json();
}

// Report one position to the OsmAnd endpoint. Unknown params (ignition) are
// stored verbatim as position attributes by Traccar; `batt` becomes batteryLevel.
async function report(uniqueId, { lat, lon, speedKmh, course }, tsSec, extra) {
  const params = new URLSearchParams({
    id: uniqueId,
    lat: lat.toFixed(6),
    lon: lon.toFixed(6),
    speed: (speedKmh / 1.852).toFixed(2), // OsmAnd expects knots
    bearing: course.toFixed(1),
    timestamp: String(tsSec),
    altitude: '8',
    hdop: '0.9',
    ...extra,
  });
  const res = await fetch(`${OSMAND_URL}/?${params.toString()}`, { method: 'POST' });
  if (!res.ok && res.status !== 200) throw new Error(`OsmAnd HTTP ${res.status}`);
}

async function seedVehicle(cookie, v) {
  await ensureDevice(cookie, v);

  const points = Math.max(2, Math.round((TRIP_MINUTES * 60) / STEP_SECONDS));
  const track = buildTrack(v.route, v.speedKmh, points);

  // Spread fixes across the last TRIP_MINUTES, ending ~now.
  const nowSec = Math.floor(Date.now() / 1000);
  const startSec = nowSec - (points - 1) * STEP_SECONDS;
  const battStart = 70 + Math.floor(Math.random() * 25);

  for (let i = 0; i < track.length; i++) {
    const tsSec = startSec + i * STEP_SECONDS;
    const last = i === track.length - 1;
    let p = track[i];
    let ignition = 'true';

    if (last) {
      // Shape the final point so live state varies across the fleet.
      if (v.end === 'idle') { p = { ...p, speedKmh: 0, course: p.course }; ignition = 'true'; }
      else if (v.end === 'stopped') { p = { ...p, speedKmh: 0, course: p.course }; ignition = 'false'; }
    }
    const batt = Math.max(20, battStart - Math.floor((i / track.length) * 18));
    await report(v.uniqueId, p, tsSec, {
      ignition,
      batt: String(batt),
      motion: p.speedKmh > 3 ? 'true' : 'false',
      rssi: String(18 + Math.floor(Math.random() * 12)),
    });
    process.stdout.write(`\r  ${v.name}: ${i + 1}/${track.length} fixes   `);
  }
  process.stdout.write(`\r  ${v.name}: ${track.length} fixes over ${TRIP_MINUTES} min — ${v.end}\n`);
}

async function main() {
  console.log(`Carva seeder → REST ${TRACCAR_URL} · OsmAnd ${OSMAND_URL}`);
  const cookie = await login();
  console.log(`Signed in as ${ADMIN_EMAIL}. Seeding ${FLEET.length} vehicles…\n`);
  for (const v of FLEET) {
    await seedVehicle(cookie, v);
  }
  console.log('\nDone. Open /app — switch to the History tab to replay any vehicle.');
}

main().catch((e) => {
  console.error(`\nSeed failed: ${e.message}`);
  process.exit(1);
});
