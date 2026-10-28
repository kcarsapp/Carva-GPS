import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from './api';
import { toVehicle } from './format';
import type { FleetAlert, Vehicle } from './types';

const REFRESH_MS = 5_000;

export function useFleet(enabled: boolean) {
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);

  const refresh = useCallback(async (manual = false) => {
    if (!enabled) return;
    if (manual) setRefreshing(true);
    try {
      const [devices, positions] = await Promise.all([api.devices(), api.positions()]);
      const byDevice = new Map<number, typeof positions[number]>();
      for (const position of positions) {
        const previous = byDevice.get(position.deviceId);
        if (!previous || new Date(position.fixTime) > new Date(previous.fixTime)) byDevice.set(position.deviceId, position);
      }
      setVehicles(devices.map((device) => toVehicle(device, byDevice.get(device.id))).sort((a, b) => {
        const rank = { moving: 0, idling: 1, stopped: 2, unknown: 3, offline: 4 };
        return rank[a.state] - rank[b.state] || a.device.name.localeCompare(b.device.name);
      }));
      setUpdatedAt(Date.now());
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not reach the GPS service');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [enabled]);

  useEffect(() => {
    if (!enabled) return;
    refresh();
    const timer = setInterval(refresh, REFRESH_MS);
    return () => clearInterval(timer);
  }, [enabled, refresh]);

  const alerts = useMemo<FleetAlert[]>(() => {
    const next: FleetAlert[] = [];
    for (const vehicle of vehicles) {
      if (vehicle.state === 'offline') next.push({ id: `offline-${vehicle.device.id}`, kind: 'offline', title: `${vehicle.device.name} is offline`, detail: 'The tracker is not reporting to Carva.', time: vehicle.device.lastUpdate || '', vehicle });
      else if (vehicle.speedKmh > 100) next.push({ id: `speed-${vehicle.device.id}`, kind: 'speed', title: `${vehicle.device.name} is speeding`, detail: `Current speed is ${vehicle.speedKmh} km/h.`, time: vehicle.position?.fixTime || '', vehicle });
      else if (vehicle.battery !== undefined && vehicle.battery <= 20) next.push({ id: `battery-${vehicle.device.id}`, kind: 'battery', title: `${vehicle.device.name} needs power`, detail: `Tracker battery is at ${vehicle.battery}%.`, time: vehicle.position?.fixTime || '', vehicle });
      else if (vehicle.state === 'unknown') next.push({ id: `attention-${vehicle.device.id}`, kind: 'attention', title: `${vehicle.device.name} needs attention`, detail: 'The device is reachable but has no fresh location fix.', time: vehicle.device.lastUpdate || '', vehicle });
    }
    return next;
  }, [vehicles]);

  return { vehicles, alerts, loading, refreshing, error, updatedAt, refresh };
}
