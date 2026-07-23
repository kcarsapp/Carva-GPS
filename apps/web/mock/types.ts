/**
 * Central domain types for the Carva Fleet MVP.
 * Everything that renders in the dashboard or marketing demo is typed here.
 */

export type VehicleStatus =
  | "in_transit"
  | "idle"
  | "maintenance"
  | "offline";

export type FuelType = "diesel" | "petrol" | "electric" | "hybrid";

export type AlertSeverity = "critical" | "warning" | "info";

export type AlertType =
  | "speeding"
  | "harsh_braking"
  | "geofence"
  | "low_fuel"
  | "maintenance_due"
  | "battery_low"
  | "engine_fault";

export type DriverStatus = "on_duty" | "off_duty" | "driving" | "resting";

export interface Coordinates {
  /** 0–100 grid coordinate (percentage based, hardware-free). */
  x: number;
  y: number;
}

export interface Driver {
  id: string;
  name: string;
  avatarInitials: string;
  phone: string;
  status: DriverStatus;
  /** 0–100 composite safety score. */
  safetyScore: number;
  assignedVehicleId: string | null;
  licenseClass: string;
  hoursThisWeek: number;
}

export interface Vehicle {
  id: string;
  /** Human-friendly unit name, e.g. "Truck 014". */
  name: string;
  plate: string;
  model: string;
  status: VehicleStatus;
  fuelType: FuelType;
  /** Battery (EV/hybrid) or fuel level as a 0–100 percentage. */
  energyLevel: number;
  /** Current speed in km/h. */
  speedKmh: number;
  odometerKm: number;
  driverId: string | null;
  location: string;
  position: Coordinates;
  /** Heading in degrees, used by the live demo widget. */
  heading: number;
  lastUpdated: string;

  /* ---- Live (real Traccar) fields. Optional so mock data stays valid. ---- */
  /** Real-world latitude / longitude for the map. */
  lat?: number;
  lng?: number;
  /** Device connectivity (online vs offline). */
  online?: boolean;
  /** Ignition state, if the tracker reports it. */
  ignition?: boolean;
  /** GSM / signal strength, if reported. */
  gsm?: number;
  /** Numeric Traccar device id (for the commands API); real devices only. */
  deviceId?: number;
  /** Raw latest-position attributes (OBD, power, signal, …) for telemetry. */
  attributes?: Record<string, unknown>;
  /** Raw device attributes — Carva capability overrides live here. */
  deviceAttributes?: Record<string, unknown>;
}

export interface Alert {
  id: string;
  vehicleId: string;
  type: AlertType;
  severity: AlertSeverity;
  title: string;
  description: string;
  timestamp: string;
  acknowledged: boolean;
}

export interface FleetMetric {
  id: string;
  label: string;
  value: string;
  /** Percentage change vs previous period. */
  delta: number;
  /** Whether a positive delta is good (e.g. uptime) or bad (e.g. fuel cost). */
  positiveIsGood: boolean;
}

export interface PricingTier {
  id: string;
  name: string;
  description: string;
  monthly: number;
  annual: number;
  highlighted: boolean;
  cta: string;
  features: string[];
}
