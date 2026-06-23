// Core domain types shared across web, mobile, and api.

/** The kind of account / tenant. Drives UI, features, and permissions. */
export type AccountType =
  | 'personal'
  | 'car_rental'
  | 'school_bus'
  | 'logistics';

/** Role of a user within a tenant. */
export type UserRole =
  | 'owner'      // full control of the tenant
  | 'admin'      // manage devices, users, settings
  | 'manager'    // dispatch / operations
  | 'driver'     // assigned to a device, limited view
  | 'viewer';    // read-only (e.g. parent, renter)

export interface Tenant {
  id: string;
  name: string;
  accountType: AccountType;
  createdAt: string;
}

export interface User {
  id: string;
  tenantId: string;
  email: string;
  name: string;
  role: UserRole;
  /** Traccar user id this maps to, if any. */
  traccarUserId?: number;
}

/** A tracked device (vehicle, asset, tag). Mirrors Traccar's device + our metadata. */
export interface Device {
  id: string;
  traccarId: number;
  tenantId: string;
  name: string;
  uniqueId: string;        // IMEI / device identifier
  category?: DeviceCategory;
  status: 'online' | 'offline' | 'unknown';
  lastUpdate?: string;
  groupId?: string;
}

export type DeviceCategory =
  | 'car'
  | 'truck'
  | 'bus'
  | 'motorcycle'
  | 'scooter'
  | 'person'
  | 'pet'
  | 'asset'
  | 'tag';

/** A live or historical position. Mirrors Traccar position payload. */
export interface Position {
  id: number;
  deviceId: number;
  deviceTime: string;
  fixTime: string;
  latitude: number;
  longitude: number;
  altitude: number;
  speed: number;       // knots (Traccar convention)
  course: number;      // heading degrees
  address?: string;
  accuracy?: number;
  attributes: Record<string, unknown>; // ignition, battery, etc.
}

export interface Geofence {
  id: string;
  tenantId: string;
  name: string;
  area: string;        // WKT, as Traccar uses
  type: 'enter' | 'exit' | 'both';
}

export type AlertType =
  | 'geofence_enter'
  | 'geofence_exit'
  | 'overspeed'
  | 'ignition_on'
  | 'ignition_off'
  | 'sos'
  | 'low_battery'
  | 'device_offline';

export interface Alert {
  id: string;
  deviceId: string;
  type: AlertType;
  time: string;
  read: boolean;
  message: string;
}

/** Helper: knots -> km/h for display. */
export const knotsToKmh = (knots: number): number => Math.round(knots * 1.852);
