export type VehicleState = 'moving' | 'idling' | 'stopped' | 'offline' | 'unknown';

export interface Device {
  id: number;
  name: string;
  uniqueId: string;
  status: 'online' | 'offline' | 'unknown';
  lastUpdate?: string;
  category?: string;
  positionId?: number;
}

export interface Position {
  id: number;
  deviceId: number;
  valid?: boolean;
  serverTime?: string;
  deviceTime: string;
  fixTime: string;
  latitude: number;
  longitude: number;
  speed: number;
  course: number;
  address?: string;
  attributes: Record<string, unknown>;
}

export interface Vehicle {
  device: Device;
  position?: Position;
  state: VehicleState;
  speedKmh: number;
  battery?: number;
  ignition?: boolean;
  power?: number;
}

export interface SessionUser {
  id: number;
  name: string;
  email: string;
  readonly?: boolean;
  role: 'general_admin' | 'company' | 'personal';
}

export interface FleetAlert {
  id: string;
  kind: 'offline' | 'speed' | 'battery' | 'attention';
  title: string;
  detail: string;
  time: string;
  vehicle: Vehicle;
}
