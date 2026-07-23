// Per-device feature model for the fleet UI.
//
// Traccar already decodes ~200 GPS protocols, so "which features does this
// tracker have" is answered from two live Traccar sources, with an optional
// admin override on top:
//
//   1. GET /api/commands/types?deviceId=X  → the commands this device's
//      protocol supports (engineStop/engineResume ⇒ a kill switch, etc.)
//   2. the latest position.attributes       → OBD / ACC / power telemetry it
//      actually reports.
//   3. device.attributes.carvaCaps          → admin force on/off, wins when set.

import type { TraccarCommandType } from "@carva/shared";

/** Device-attribute key holding the admin capability overrides. */
export const CARVA_CAPS = "carvaCaps";

export type CapKey = "killSwitch" | "obd" | "acc";
/** null = "auto" (defer to detection); true/false = admin override. */
export type CapOverrides = Partial<Record<CapKey, boolean | null>>;

export interface Capability {
  value: boolean;
  /** Where `value` came from — drives the "auto/forced" hint in the UI. */
  source: "auto" | "override";
}

export type Capabilities = Record<CapKey, Capability>;

/** Traccar command types that mean "this device can cut/restore the engine". */
export const KILL_CUT_TYPES = ["engineStop"];
export const KILL_RESUME_TYPES = ["engineResume"];

/* ------------------------------- Telemetry ------------------------------- */

export interface TelemetryMetric {
  key: string;
  label: string;
  value: string;
}

interface MetricSpec {
  keys: string[]; // attribute aliases, first match wins
  label: string;
  fmt: (v: number) => string;
}

const round = (v: number) => String(Math.round(v));

/** OBD / engine metrics that Chinese OBD dongles commonly report. */
const OBD_SPECS: MetricSpec[] = [
  { keys: ["rpm", "obdRpm", "engineRpm"], label: "RPM", fmt: round },
  { keys: ["obdSpeed"], label: "OBD speed", fmt: (v) => `${round(v)} km/h` },
  { keys: ["fuel", "fuelLevel"], label: "Fuel", fmt: (v) => `${round(v)}%` },
  {
    keys: ["fuelConsumption"],
    label: "Fuel use",
    fmt: (v) => `${v.toFixed(1)} L/h`,
  },
  {
    keys: ["engineLoad", "obdEngineLoad"],
    label: "Engine load",
    fmt: (v) => `${round(v)}%`,
  },
  {
    keys: ["coolantTemp", "engineTemp"],
    label: "Coolant",
    fmt: (v) => `${round(v)}°C`,
  },
  { keys: ["throttle"], label: "Throttle", fmt: (v) => `${round(v)}%` },
  { keys: ["dtcs", "dtcCount"], label: "Fault codes", fmt: round },
];

/** Power / signal metrics (most trackers, not just OBD). */
const POWER_SPECS: MetricSpec[] = [
  { keys: ["power", "externalPower"], label: "Vehicle voltage", fmt: (v) => `${v.toFixed(1)} V` },
  { keys: ["battery"], label: "Backup voltage", fmt: (v) => `${v.toFixed(1)} V` },
  { keys: ["hdop"], label: "HDOP", fmt: (v) => v.toFixed(1) },
  { keys: ["sat", "satellites"], label: "Satellites", fmt: round },
];

function collect(attrs: Record<string, unknown>, specs: MetricSpec[]): TelemetryMetric[] {
  const out: TelemetryMetric[] = [];
  for (const spec of specs) {
    for (const k of spec.keys) {
      const raw = attrs[k];
      if (typeof raw === "number" && Number.isFinite(raw)) {
        out.push({ key: spec.keys[0], label: spec.label, value: spec.fmt(raw) });
        break;
      }
    }
  }
  return out;
}

export interface Telemetry {
  obd: TelemetryMetric[];
  power: TelemetryMetric[];
  /** Ignition / ACC line state, if the device reports it. */
  acc: boolean | null;
}

export function readTelemetry(attrs: Record<string, unknown> | undefined): Telemetry {
  const a = attrs ?? {};
  const accRaw = a.ignition ?? a.acc;
  return {
    obd: collect(a, OBD_SPECS),
    power: collect(a, POWER_SPECS),
    acc: typeof accRaw === "boolean" ? accRaw : null,
  };
}

/* ----------------------------- Capabilities ------------------------------ */

function overridesOf(deviceAttributes: Record<string, unknown> | undefined): CapOverrides {
  const raw = deviceAttributes?.[CARVA_CAPS];
  return raw && typeof raw === "object" ? (raw as CapOverrides) : {};
}

function resolve(auto: boolean, override: boolean | null | undefined): Capability {
  if (override === true || override === false) {
    return { value: override, source: "override" };
  }
  return { value: auto, source: "auto" };
}

export function resolveCapabilities(input: {
  commandTypes?: TraccarCommandType[] | null;
  telemetry: Telemetry;
  deviceAttributes?: Record<string, unknown>;
}): Capabilities {
  const types = new Set((input.commandTypes ?? []).map((c) => c.type));
  const ov = overridesOf(input.deviceAttributes);
  const autoKill = KILL_CUT_TYPES.some((t) => types.has(t));
  const autoObd = input.telemetry.obd.length > 0;
  const autoAcc = input.telemetry.acc !== null;
  return {
    killSwitch: resolve(autoKill, ov.killSwitch),
    obd: resolve(autoObd, ov.obd),
    acc: resolve(autoAcc, ov.acc),
  };
}

/** Merge new overrides onto a device's existing attributes for a Traccar PUT. */
export function withCapOverride(
  deviceAttributes: Record<string, unknown> | undefined,
  key: CapKey,
  value: boolean | null,
): Record<string, unknown> {
  const attrs = { ...(deviceAttributes ?? {}) };
  const caps: CapOverrides = { ...overridesOf(attrs) };
  if (value === null) delete caps[key];
  else caps[key] = value;
  if (Object.keys(caps).length === 0) delete attrs[CARVA_CAPS];
  else attrs[CARVA_CAPS] = caps;
  return attrs;
}
