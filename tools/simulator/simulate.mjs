#!/usr/bin/env node
// Carva GPS — movement simulator.
// Feeds the Traccar demo server with live positions via the OsmAnd protocol
// (plain HTTP on port 5055), so the live map shows a marker actually moving.
//
// Usage:
//   node tools/simulator/simulate.mjs
//
// Env overrides:
//   OSMAND_URL   default http://demo.traccar.org:5055
//   DEVICE_ID    default carva-demo-001   (must match a device's uniqueId in Traccar)
//   INTERVAL_MS  default 2000
//   SPEED_KMH    default 40

const OSMAND_URL = process.env.OSMAND_URL || 'http://demo.traccar.org:5055';
const DEVICE_ID = process.env.DEVICE_ID || 'carva-demo-001';
const INTERVAL_MS = Number(process.env.INTERVAL_MS || 2000);
const SPEED_KMH = Number(process.env.SPEED_KMH || 40);

// A loop route through Dubai (Sheikh Zayed Rd / Downtown area).
const ROUTE = [
  [25.2048, 55.2708],
  [25.2110, 55.2790],
  [25.2190, 55.2850],
  [25.2280, 55.2900],
  [25.2360, 55.2960],
  [25.2300, 55.3050],
  [25.2210, 55.3010],
  [25.2120, 55.2940],
  [25.2060, 55.2820],
];

// --- geo helpers ---
const toRad = (d) => (d * Math.PI) / 180;
const toDeg = (r) => (r * 180) / Math.PI;
const R = 6371000; // earth radius (m)

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

async function send(lat, lon, speedKnots, course) {
  const ts = Math.floor(Date.now() / 1000);
  const url = `${OSMAND_URL}/?id=${encodeURIComponent(DEVICE_ID)}&lat=${lat.toFixed(6)}&lon=${lon.toFixed(
    6,
  )}&speed=${speedKnots.toFixed(2)}&bearing=${course.toFixed(1)}&timestamp=${ts}`;
  try {
    const res = await fetch(url, { method: 'POST' });
    process.stdout.write(
      `\r→ ${lat.toFixed(5)}, ${lon.toFixed(5)}  ${(speedKnots * 1.852).toFixed(0)} km/h  hdg ${course.toFixed(
        0,
      )}°  [${res.status}]   `,
    );
  } catch (e) {
    process.stdout.write(`\r! send failed: ${e.message}   `);
  }
}

async function main() {
  console.log(`Carva simulator → ${OSMAND_URL}  device=${DEVICE_ID}  ${SPEED_KMH} km/h`);
  const speedMs = (SPEED_KMH * 1000) / 3600; // metres per second
  const stepM = speedMs * (INTERVAL_MS / 1000); // metres per tick
  const speedKnots = SPEED_KMH / 1.852;

  let seg = 0;
  let progressM = 0;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const a = ROUTE[seg];
    const b = ROUTE[(seg + 1) % ROUTE.length];
    const segLen = distanceM(a, b);
    const t = Math.min(progressM / segLen, 1);
    const [lat, lon] = interpolate(a, b, t);
    const course = bearing(a, b);

    await send(lat, lon, speedKnots, course);

    progressM += stepM;
    if (progressM >= segLen) {
      progressM = 0;
      seg = (seg + 1) % ROUTE.length;
    }
    await new Promise((r) => setTimeout(r, INTERVAL_MS));
  }
}

main();
