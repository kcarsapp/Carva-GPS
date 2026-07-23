"use client";

import * as React from "react";
import {
  knotsToKmh,
  motionState,
  batteryLevel,
  type MotionState,
  type TraccarDevice,
  type TraccarPosition,
} from "@carva/shared";

import type { Alert, FleetMetric, Vehicle, VehicleStatus } from "@/mock/types";
import { vehicles as demoVehicles } from "@/mock/vehicles";
import { alerts as demoAlerts } from "@/mock/alerts";

export type CarvaRole = "general_admin" | "company" | "personal";

export interface SessionUser {
  id: number;
  name: string;
  email: string;
  administrator: boolean;
  readonly?: boolean;
  accountType?: string | null;
  role: CarvaRole;
}

const POLL_MS = 5000;

/* --------------------------- Traccar -> Vehicle --------------------------- */

function statusFromMotion(m: MotionState): VehicleStatus {
  if (m === "moving") return "in_transit";
  if (m === "offline" || m === "unknown") return "offline";
  return "idle"; // idle (engine on) or stopped (parked)
}

function num(v: unknown): number | undefined {
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}

function toVehicle(d: TraccarDevice, p?: TraccarPosition): Vehicle {
  const motion = motionState(d, p);
  const attrs = p?.attributes ?? {};
  const battery = batteryLevel(p);
  const odoMeters = num(attrs.odometer) ?? num(attrs.totalDistance);
  const gsm = num(attrs.rssi) ?? num(attrs.gsm);

  return {
    id: String(d.id),
    name: d.name,
    plate: d.uniqueId,
    model: d.category
      ? d.category.charAt(0).toUpperCase() + d.category.slice(1)
      : "Tracker",
    status: statusFromMotion(motion),
    // Trackers report a device battery; show it on the battery gauge.
    fuelType: battery != null ? "electric" : "diesel",
    energyLevel: battery ?? 0,
    speedKmh: p ? knotsToKmh(p.speed) : 0,
    odometerKm: odoMeters != null ? Math.round(odoMeters / 1000) : 0,
    driverId: null,
    location:
      p?.address ||
      (p ? `${p.latitude.toFixed(4)}, ${p.longitude.toFixed(4)}` : "—"),
    position: { x: 0, y: 0 },
    heading: p?.course ?? 0,
    lastUpdated: d.lastUpdate || p?.fixTime || new Date().toISOString(),
    lat: p?.latitude,
    lng: p?.longitude,
    online: d.status === "online",
    ignition: typeof attrs.ignition === "boolean" ? attrs.ignition : undefined,
    gsm,
    deviceId: d.id,
    attributes: p?.attributes,
    deviceAttributes: d.attributes,
  };
}

/** Pick the freshest position per device. */
function latestByDevice(positions: TraccarPosition[]): Map<number, TraccarPosition> {
  const map = new Map<number, TraccarPosition>();
  for (const p of positions) {
    const prev = map.get(p.deviceId);
    if (!prev || new Date(p.fixTime) > new Date(prev.fixTime)) {
      map.set(p.deviceId, p);
    }
  }
  return map;
}

/* -------------------------------- Hooks ---------------------------------- */

export interface SessionState {
  loading: boolean;
  authed: boolean;
  user: SessionUser | null;
}

export function useSession(): SessionState {
  const [state, setState] = React.useState<SessionState>({
    loading: true,
    authed: false,
    user: null,
  });

  React.useEffect(() => {
    let alive = true;
    fetch("/api/auth/session", { cache: "no-store" })
      .then(async (r) => {
        if (!alive) return;
        if (r.ok) {
          const user = (await r.json()) as SessionUser;
          setState({ loading: false, authed: true, user });
        } else {
          setState({ loading: false, authed: false, user: null });
        }
      })
      .catch(() => {
        if (alive) setState({ loading: false, authed: false, user: null });
      });
    return () => {
      alive = false;
    };
  }, []);

  return state;
}

export interface LiveFleetState {
  vehicles: Vehicle[];
  authed: boolean;
  loading: boolean;
  user: SessionUser | null;
  error: string | null;
  lastUpdated: number | null;
}

/**
 * Live fleet data. Logged in -> polls the Traccar proxy and maps devices to
 * vehicles. Logged out -> serves the demo dataset so the marketing demo works.
 */
export function useLiveFleet(): LiveFleetState {
  const session = useSession();
  const [vehicles, setVehicles] = React.useState<Vehicle[]>([]);
  const [error, setError] = React.useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = React.useState<number | null>(null);

  React.useEffect(() => {
    if (session.loading) return;

    if (!session.authed) {
      setVehicles(demoVehicles);
      setLastUpdated(Date.now());
      return;
    }

    let alive = true;
    async function poll() {
      try {
        const [dRes, pRes] = await Promise.all([
          fetch("/api/traccar/devices", { cache: "no-store" }),
          fetch("/api/traccar/positions", { cache: "no-store" }),
        ]);
        if (!dRes.ok || !pRes.ok) throw new Error("traccar request failed");
        const devices = (await dRes.json()) as TraccarDevice[];
        const positions = (await pRes.json()) as TraccarPosition[];
        const byDevice = latestByDevice(positions);
        const mapped = devices.map((d) => toVehicle(d, byDevice.get(d.id)));
        if (!alive) return;
        setVehicles(mapped);
        setError(null);
        setLastUpdated(Date.now());
      } catch {
        if (alive) setError("Couldn't reach the GPS server. Retrying…");
      }
    }

    poll();
    const timer = setInterval(poll, POLL_MS);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [session.loading, session.authed]);

  return {
    vehicles,
    authed: session.authed,
    loading: session.loading,
    user: session.user,
    error,
    lastUpdated,
  };
}

/* --------------------------- Derived dashboard --------------------------- */

export function computeLiveMetrics(vehicles: Vehicle[]): FleetMetric[] {
  const total = vehicles.length;
  const online = vehicles.filter((v) => v.status !== "offline").length;
  const moving = vehicles.filter((v) => v.status === "in_transit").length;
  const offline = vehicles.filter((v) => v.status === "offline").length;
  const energies = vehicles.map((v) => v.energyLevel).filter((n) => n > 0);
  const avg = energies.length
    ? Math.round(energies.reduce((a, b) => a + b, 0) / energies.length)
    : 0;

  // Labels are i18n keys — MetricCard translates them (plain strings pass through).
  return [
    {
      id: "active",
      label: "fleet.metric.active",
      value: `${online} / ${total}`,
      delta: 0,
      positiveIsGood: true,
    },
    {
      id: "moving",
      label: "fleet.metric.moving",
      value: String(moving),
      delta: 0,
      positiveIsGood: true,
    },
    {
      id: "battery",
      label: "fleet.metric.battery",
      value: avg ? `${avg}%` : "—",
      delta: 0,
      positiveIsGood: true,
    },
    {
      id: "offline",
      label: "fleet.metric.offline",
      value: String(offline),
      delta: 0,
      positiveIsGood: false,
    },
  ];
}

/** Demo alerts when logged out; lightweight derived alerts when live. */
export function overviewAlerts(
  vehicles: Vehicle[],
  authed: boolean,
  t: (key: string) => string = (k) => k,
): Alert[] {
  if (!authed) return demoAlerts;

  const out: Alert[] = [];
  for (const v of vehicles) {
    if (v.status === "offline") {
      out.push({
        id: `live-off-${v.id}`,
        vehicleId: v.id,
        type: "battery_low",
        severity: "critical",
        title: t("fleet.alert.offline.t").replace("{name}", v.name),
        description: t("fleet.alert.offline.d"),
        timestamp: v.lastUpdated,
        acknowledged: false,
      });
    } else if (v.energyLevel > 0 && v.energyLevel <= 20) {
      out.push({
        id: `live-bat-${v.id}`,
        vehicleId: v.id,
        type: "battery_low",
        severity: "warning",
        title: t("fleet.alert.battery.t").replace("{name}", v.name),
        description: t("fleet.alert.battery.d").replace(
          "{pct}",
          String(v.energyLevel),
        ),
        timestamp: v.lastUpdated,
        acknowledged: false,
      });
    } else if (v.speedKmh > 100) {
      out.push({
        id: `live-spd-${v.id}`,
        vehicleId: v.id,
        type: "speeding",
        severity: "warning",
        title: t("fleet.alert.speed.t").replace("{name}", v.name),
        description: t("fleet.alert.speed.d").replace(
          "{kmh}",
          String(v.speedKmh),
        ),
        timestamp: v.lastUpdated,
        acknowledged: false,
      });
    }
  }
  return out;
}
