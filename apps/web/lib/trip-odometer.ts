// Resettable "trip" odometer, per vehicle.
//
// The tracker's own odometer counter is off on these units, so the total we
// show is Traccar's accumulated `totalDistance`. That number only ever grows;
// a rental business wants to zero a counter when a car goes out and read it
// when it comes back. We do that without touching Traccar: remember the total
// at the moment of reset, and show (current total − baseline).
//
// Baselines live in localStorage keyed by device id, so they survive reloads
// on this browser. They are deliberately NOT stored on the server — a reset is
// an operator's local bookmark, not fleet data.

const KEY = "carva.tripOdometer";

export interface TripBaseline {
  /** Metres of totalDistance at the moment of reset. */
  baseMetres: number;
  /** ISO timestamp of the reset, shown as "since …". */
  since: string;
}

type Store = Record<string, TripBaseline>;

function read(): Store {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(KEY);
    const parsed = raw ? (JSON.parse(raw) as unknown) : {};
    return parsed && typeof parsed === "object" ? (parsed as Store) : {};
  } catch {
    return {};
  }
}

function write(store: Store) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(KEY, JSON.stringify(store));
  } catch {
    /* quota / private mode — the reset just won't persist */
  }
}

/** The baseline for a vehicle, or null if its trip counter was never reset. */
export function getTripBaseline(vehicleId: string): TripBaseline | null {
  const b = read()[vehicleId];
  return b && Number.isFinite(b.baseMetres) ? b : null;
}

/** Zero the trip counter at the vehicle's current total. */
export function resetTripOdometer(vehicleId: string, currentMetres: number): TripBaseline {
  const store = read();
  const baseline: TripBaseline = {
    baseMetres: Math.max(0, currentMetres),
    since: new Date().toISOString(),
  };
  store[vehicleId] = baseline;
  write(store);
  return baseline;
}

/** Remove the baseline so the display returns to the lifetime total. */
export function clearTripOdometer(vehicleId: string) {
  const store = read();
  delete store[vehicleId];
  write(store);
}

/**
 * Metres travelled since the reset. Clamped at 0 so a tracker whose total was
 * re-based (e.g. Traccar recount) cannot show a negative trip.
 */
export function tripMetres(currentMetres: number, baseline: TripBaseline | null): number {
  if (!baseline) return currentMetres;
  return Math.max(0, currentMetres - baseline.baseMetres);
}
