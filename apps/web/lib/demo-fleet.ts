// The logged-out demo fleet: six SIMULATED rental cars in Erbil, so the demo
// dashboard (/fleet without an account) is alive instead of a sign-in wall.
//
// Three cars drive real Erbil streets (DEMO_LOOPS, generated from OSM road
// geometry - the same loops as the homepage demo map), two are parked, one is
// offline. Positions are a pure function of the clock: every visitor sees
// believable motion, and nothing is fetched or stored.

import { DEMO_LOOPS } from "@/components/landing/city-data";
import type { Alert, Vehicle } from "@/mock/types";

/* ------------------------------ track maths ------------------------------ */

export type Track = { pts: [number, number][]; cum: number[]; total: number };

function metres(a: [number, number], b: [number, number]) {
  const kx = 111320 * Math.cos((a[1] * Math.PI) / 180);
  return Math.hypot((b[0] - a[0]) * kx, (b[1] - a[1]) * 110574);
}

export function buildTrack(pts: [number, number][]): Track {
  const cum = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + metres(pts[i - 1], pts[i]));
  return { pts, cum, total: cum[cum.length - 1] };
}

/** Position ([lng, lat]) + compass bearing at `d` metres along a looping track. */
export function trackAt(t: Track, d: number): { ll: [number, number]; bearing: number } {
  const x = ((d % t.total) + t.total) % t.total;
  let i = 1;
  while (i < t.cum.length - 1 && t.cum[i] < x) i++;
  const a = t.pts[i - 1];
  const b = t.pts[i];
  const f = (x - t.cum[i - 1]) / Math.max(1e-6, t.cum[i] - t.cum[i - 1]);
  const ll: [number, number] = [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f];
  const kx = Math.cos((a[1] * Math.PI) / 180);
  const bearing = ((Math.atan2((b[0] - a[0]) * kx, b[1] - a[1]) * 180) / Math.PI + 360) % 360;
  return { ll, bearing };
}

/* -------------------------------- the fleet ------------------------------ */

/** A touch faster than real time so the motion reads on screen. */
const SPEEDUP = 1.8;

type DemoCar = {
  id: string;
  name: string;
  model: string;
  plate: string;
  odometerKm: number;
} & (
  | { kind: "moving"; loop: number; kmh: number; offset: number }
  | { kind: "parked"; at: [number, number]; heading: number; engineOn: boolean }
  | { kind: "offline"; at: [number, number]; heading: number; silentMin: number }
);

const CARS: DemoCar[] = [
  { id: "demo-1", name: "Rental 01", model: "Toyota Corolla", plate: "22 A 41837", odometerKm: 48_210, kind: "moving", loop: 0, kmh: 46, offset: 0 },
  { id: "demo-2", name: "Rental 02", model: "Kia Sportage", plate: "22 B 10564", odometerKm: 31_905, kind: "moving", loop: 1, kmh: 52, offset: 900 },
  { id: "demo-3", name: "Rental 03", model: "Hyundai Elantra", plate: "22 A 77420", odometerKm: 62_118, kind: "moving", loop: 2, kmh: 38, offset: 1800 },
  { id: "demo-4", name: "Rental 04", model: "Toyota Land Cruiser", plate: "22 C 30219", odometerKm: 19_640, kind: "parked", at: [44.0118, 36.1898], heading: 74, engineOn: true },
  { id: "demo-5", name: "Rental 05", model: "Nissan Sunny", plate: "22 B 55301", odometerKm: 87_002, kind: "parked", at: [44.0228, 36.2021], heading: 210, engineOn: false },
  { id: "demo-6", name: "Rental 06", model: "Chevrolet Malibu", plate: "22 A 90046", odometerKm: 54_377, kind: "offline", at: [43.9902, 36.1765], heading: 330, silentMin: 185 },
];

let tracks: Track[] | null = null;
const getTracks = () => (tracks ??= DEMO_LOOPS.map(buildTrack));

/** The demo fleet as it stands at `now` (ms). */
export function demoFleet(now: number = Date.now()): Vehicle[] {
  const iso = new Date(now).toISOString();
  return CARS.map((c): Vehicle => {
    const base = {
      id: c.id,
      name: c.name,
      plate: c.plate,
      model: c.model,
      fuelType: "petrol" as const,
      energyLevel: 0,
      odometerKm: c.odometerKm,
      driverId: null,
      position: { x: 0, y: 0 },
      gsm: 4,
    };
    if (c.kind === "moving") {
      const t = getTracks()[c.loop];
      const d = c.offset + (now / 1000) * (c.kmh / 3.6) * SPEEDUP;
      const { ll, bearing } = trackAt(t, d);
      // a little life in the speed readout, deterministic per second
      const kmh = Math.round(c.kmh + 6 * Math.sin(now / 7000 + c.offset));
      return {
        ...base,
        status: "in_transit",
        speedKmh: kmh,
        heading: bearing,
        headingValid: true,
        lat: ll[1],
        lng: ll[0],
        location: `${ll[1].toFixed(4)}, ${ll[0].toFixed(4)}`,
        lastUpdated: iso,
        lastFixAt: iso,
        online: true,
        ignition: true,
        attributes: { ignition: true, motion: true, power: 13.9, sat: 14, rssi: 4, blocked: false },
      };
    }
    if (c.kind === "parked") {
      return {
        ...base,
        status: "idle",
        speedKmh: 0,
        heading: c.heading,
        headingValid: false,
        lat: c.at[1],
        lng: c.at[0],
        location: `${c.at[1].toFixed(4)}, ${c.at[0].toFixed(4)}`,
        lastUpdated: iso,
        lastFixAt: iso,
        online: true,
        ignition: c.engineOn,
        attributes: { ignition: c.engineOn, motion: false, power: c.engineOn ? 13.8 : 12.5, sat: 12, rssi: 4, blocked: false },
      };
    }
    const last = new Date(now - c.silentMin * 60_000).toISOString();
    return {
      ...base,
      status: "offline",
      speedKmh: 0,
      heading: c.heading,
      headingValid: false,
      lat: c.at[1],
      lng: c.at[0],
      location: `${c.at[1].toFixed(4)}, ${c.at[0].toFixed(4)}`,
      lastUpdated: last,
      lastFixAt: last,
      online: false,
      ignition: false,
      signalIssue: "silent",
      attributes: { ignition: false, motion: false, power: 12.2, sat: 0, rssi: 0, blocked: false },
    };
  });
}

/** Sample alerts that match the demo cars (relative to now). */
export function demoAlerts(now: number = Date.now()): Alert[] {
  const ago = (min: number) => new Date(now - min * 60_000).toISOString();
  return [
    {
      id: "demo-alt-1",
      vehicleId: "demo-2",
      type: "geofence",
      severity: "critical",
      title: "Rental 02 entered a restricted zone",
      description: "Zone rule: notify. An email warning was sent.",
      timestamp: ago(4),
      acknowledged: false,
    },
    {
      id: "demo-alt-2",
      vehicleId: "demo-6",
      type: "battery_low",
      severity: "warning",
      title: "Rental 06 stopped reporting",
      description: "No data from the tracker for 3 hours.",
      timestamp: ago(185),
      acknowledged: false,
    },
    {
      id: "demo-alt-3",
      vehicleId: "demo-1",
      type: "speeding",
      severity: "warning",
      title: "Rental 01 over the speed limit",
      description: "127 km/h on the Erbil–Mosul road (limit 120).",
      timestamp: ago(52),
      acknowledged: true,
    },
  ];
}
