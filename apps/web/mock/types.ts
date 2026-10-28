/**
 * Central domain types for the Carva Fleet MVP.
 * Everything that renders in the dashboard or marketing demo is typed here.
 */

export type VehicleStatus =
  | "in_transit"
  | "idle"
  | "maintenance"
  /** Connected recently but no fresh data (Traccar's "unknown"). */
  | "unknown"
  | "offline";

/**
 * Why a vehicle's position cannot be trusted. `null` means it is healthy.
 *
 * These all used to look identical on the roster, which only ever showed the
 * last state it could read - which is how a car that had been driven all day
 * still read "Idle . 1m ago":
 *
 *   never   - the tracker has never reported at all.
 *   silent  - nothing has arrived from it for a long time.
 *   delayed - it IS uploading, but replaying a backlog it recorded while it had
 *             no data connection, so its newest fix is hours behind now.
 *   no_fix  - it is uploading live, but with no usable GPS position behind it.
 */
export type SignalIssue = "never" | "silent" | "delayed" | "no_fix";

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

/** One GPS unit fitted to a vehicle. Several of these can share a car. */
export interface VehicleTracker {
  deviceId: number;
  name: string;
  /** The tracker's unique id / IMEI. */
  uniqueId: string;
  model?: string | null;
  online: boolean;
  /** Empty when this tracker has never reported. */
  lastUpdated: string;
  /** Whether this tracker currently has a position at all. */
  hasFix: boolean;
  speedKmh: number;
  /** Latest position attributes (power, rssi, blocked, …) for this unit. */
  attributes?: Record<string, unknown>;
  /** The unit whose readings represent the car right now. */
  primary: boolean;
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
  /**
   * ISO time the newest position was actually RECORDED - the only timestamp
   * that says how old the dot on the map is. Deliberately separate from
   * `lastUpdated`, the time the packet ARRIVED: a tracker draining a backlog it
   * buffered while it had no data connection keeps `lastUpdated` at "just now"
   * while shipping fixes from hours ago.
   */
  lastFixAt?: string;
  /** Why this vehicle is not reporting normally; null/undefined when healthy. */
  signalIssue?: SignalIssue | null;
  /**
   * Whether `heading` is a live direction of travel. False when parked: a GPS
   * course is meaningless at rest and trackers report 0, which is NOT north.
   */
  headingValid?: boolean;
  /**
   * Every tracker fitted to this car. A car with one GPS has a single entry;
   * a car with a hidden backup unit has several. The vehicle's own live
   * fields come from whichever tracker is `primary` (the freshest fix).
   */
  trackers?: VehicleTracker[];
  /** Traccar group id when several trackers are grouped into one car. */
  groupId?: number;
  /** Ignition state, if the tracker reports it. */
  ignition?: boolean;
  /** Battery charging state, if the tracker reports it. */
  charge?: boolean;
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
