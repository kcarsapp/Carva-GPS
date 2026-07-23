// Display helpers for device status, motion, and timing — shared by web + mobile.

import { knotsToKmh, type Position } from './types';
import type { TraccarDevice, TraccarPosition } from './traccar';

/** Refined movement state, derived from connectivity + the latest position. */
export type MotionState = 'moving' | 'idle' | 'stopped' | 'offline' | 'unknown';

interface DeviceLike {
  status: string; // 'online' | 'offline' | 'unknown'
}

/** km/h above which we treat a vehicle as actually moving (filters GPS jitter). */
const MOVING_KMH = 3;

export function motionState(
  device: DeviceLike,
  position?: Position | TraccarPosition | null,
): MotionState {
  if (device.status === 'offline') return 'offline';
  if (device.status !== 'online' || !position) return 'unknown';

  const attrs = position.attributes ?? {};
  const moving = attrs.motion === true || knotsToKmh(position.speed) > MOVING_KMH;
  if (moving) return 'moving';
  // Stationary but engine on = idling; otherwise parked/stopped.
  if (attrs.ignition === true) return 'idle';
  return 'stopped';
}

export const MOTION_LABELS: Record<MotionState, string> = {
  moving: 'Moving',
  idle: 'Idling',
  stopped: 'Stopped',
  offline: 'Offline',
  unknown: 'No fix',
};

/** Human "x min ago" from an ISO timestamp. Returns '' for missing input. */
export function relativeTime(iso?: string | null, now: number = Date.now()): string {
  if (!iso) return '';
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '';
  const sec = Math.max(0, Math.round((now - then) / 1000));
  if (sec < 45) return 'just now';
  const min = Math.round(sec / 60);
  if (min < 60) return `${min} min ago`;
  const hrs = Math.round(min / 60);
  if (hrs < 24) return `${hrs} hr${hrs === 1 ? '' : 's'} ago`;
  const days = Math.round(hrs / 24);
  return `${days} day${days === 1 ? '' : 's'} ago`;
}

/** Battery percent from common Traccar attribute keys, or undefined. */
export function batteryLevel(
  position?: Position | TraccarPosition | null,
): number | undefined {
  const v = position?.attributes?.batteryLevel ?? position?.attributes?.battery;
  return typeof v === 'number' ? Math.round(v) : undefined;
}

export function isOnline(device: DeviceLike & { status: TraccarDevice['status'] }): boolean {
  return device.status === 'online';
}
