import type { Device, Position, Vehicle, VehicleState } from './types';

export const knotsToKmh = (knots: number) => Math.round(knots * 1.852);

export function vehicleState(device: Device, position?: Position): VehicleState {
  if (device.status === 'offline') return 'offline';
  if (!position || position.valid === false || device.status !== 'online') return 'unknown';
  if (position.attributes.motion === true || knotsToKmh(position.speed) > 3) return 'moving';
  return position.attributes.ignition === true || position.attributes.acc === true ? 'idling' : 'stopped';
}

export function toVehicle(device: Device, position?: Position): Vehicle {
  const rawBattery = position?.attributes.batteryLevel ?? position?.attributes.battery;
  const rawPower = position?.attributes.power;
  const rawIgnition = position?.attributes.ignition ?? position?.attributes.acc;
  return {
    device,
    position,
    state: vehicleState(device, position),
    speedKmh: position ? knotsToKmh(position.speed) : 0,
    battery: typeof rawBattery === 'number' ? Math.round(rawBattery) : undefined,
    power: typeof rawPower === 'number' ? rawPower : undefined,
    ignition: typeof rawIgnition === 'boolean' ? rawIgnition : undefined,
  };
}

export function timeAgo(iso?: string) {
  if (!iso) return 'No signal yet';
  const seconds = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (seconds < 60) return 'now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}

export function stateLabel(state: VehicleState) {
  return ({ moving: 'In motion', idling: 'Engine on', stopped: 'Parked', offline: 'Offline', unknown: 'No GPS fix' })[state];
}
