// Per-geofence automation rules ("what happens when a car enters/leaves here").
//
// WHERE THE RULES LIVE
// Traccar geofences already carry a free-form `attributes` object, and
// PUT /api/geofences/{id} round-trips it untouched. So a fence's rules are
// stored there under a single key — they travel with the fence, survive a
// Traccar backup/restore, and need no extra table anywhere.
//
//   { "carvaRules": { "version": 1, "category": "repair",
//                     "onEnter": { "notify": true, "cut": "none",
//                                  "severity": "critical" },
//                     "onExit":  { "notify": true, "cut": "none" } } }
//
// WHY "repair" IS ITS OWN CATEGORY
// A rental car arriving at a garage almost always means it has been in an
// accident. That is the one geofence event the owner wants to see before
// anything else, so a repair fence raises a critical alert by default while an
// ordinary zone raises an informational one.
//
// WHY EVERY CUT DEFAULTS TO "none"
// `cut` drives a physical relay in the customer's car (see ./jt808.ts). A rule
// that is missing, half-written, hand-edited in the Traccar admin UI, or
// produced by a future version of this app must NEVER be read as "immobilise
// the vehicle" — the failure mode of a wrong cut is a stranded renter on a
// highway, while the failure mode of a missing cut is only a late alert. So
// parsing is deliberately asymmetric: an unrecognised `cut` value collapses to
// "none", never to the previous value and never to a cut. Turning the relay off
// is always an explicit, deliberate choice a human made in the UI.
//
// This module is pure: no React, no fetch. The geofence editor and the
// server-side automation runner both import it so they can never disagree about
// what a fence means.

import type { VehicleControlMode } from "./jt808";

/** Geofence-attribute key holding the rules for that fence. */
export const CARVA_RULES_KEY = "carvaRules";

/** Schema version written by this build. Bump only on a breaking change. */
export const RULES_VERSION = 1 as const;

/* --------------------------------- Types --------------------------------- */

export type GeofenceCategory =
  | "zone"
  | "repair"
  | "region"
  | "customer"
  | "base"
  | "restricted";

/** Relay action: none, deferred-until-safe, or immediate. */
export type CutMode = "none" | "safe" | "now";

export type AlertSeverity = "info" | "warning" | "critical";

/** Which half of a fence crossing a rule applies to. */
export type RulePhase = "enter" | "exit";

/**
 * Which vehicles a fence watches. "all" = every car on the account, including
 * ones added later (the automation service links new cars on its own);
 * "selected" = only the cars linked by hand.
 */
export type FenceScope = "all" | "selected";

export interface RuleAction {
  /** Raise an alert in the app. */
  notify: boolean;
  /** Fuel/power relay action to send to the tracker. */
  cut: CutMode;
  /** Explicit severity; when unset the category default applies. */
  severity?: AlertSeverity;
  /** Free text shown on the alert. */
  note?: string;
}

export interface GeofenceRules {
  version: typeof RULES_VERSION;
  category: GeofenceCategory;
  scope: FenceScope;
  onEnter: RuleAction;
  onExit: RuleAction;
}

/** Minimal translator shape — matches `t` from lib/i18n-provider. */
export type Translate = (key: string) => string;

/* ------------------------------ Enumerations ------------------------------ */

/** Display order for category pickers. */
export const GEOFENCE_CATEGORIES: readonly GeofenceCategory[] = [
  "repair",
  "region",
  "zone",
  "customer",
  "base",
  "restricted",
] as const;

/** Display order for the cut selector — safest option first, always. */
export const CUT_MODES: readonly CutMode[] = ["none", "safe", "now"] as const;

export const ALERT_SEVERITIES: readonly AlertSeverity[] = [
  "info",
  "warning",
  "critical",
] as const;

/** Longest note we persist; keeps the attribute small and the alert readable. */
export const MAX_NOTE_LENGTH = 200;

export function isGeofenceCategory(v: unknown): v is GeofenceCategory {
  return (
    typeof v === "string" &&
    (GEOFENCE_CATEGORIES as readonly string[]).includes(v)
  );
}

export function isCutMode(v: unknown): v is CutMode {
  return typeof v === "string" && (CUT_MODES as readonly string[]).includes(v);
}

export function isAlertSeverity(v: unknown): v is AlertSeverity {
  return (
    typeof v === "string" && (ALERT_SEVERITIES as readonly string[]).includes(v)
  );
}

/* ------------------------------- Defaults -------------------------------- */

/**
 * The baseline action: tell someone, touch nothing. Every unknown, missing or
 * malformed rule resolves to this.
 */
const DEFAULT_ACTION: RuleAction = { notify: true, cut: "none" };

export const DEFAULT_CATEGORY: GeofenceCategory = "zone";

/**
 * Severity a category implies when the rule does not state one.
 *
 * - repair/enter is critical: the car is at a garage, i.e. probably crashed.
 * - restricted/enter is a warning: the car went somewhere it should not be.
 * - base/exit is a warning: the car left the yard, which matters at night.
 * - region/exit is critical: the car left the area it is allowed to drive in.
 * Everything else is informational.
 */
const CATEGORY_SEVERITY: Record<
  GeofenceCategory,
  Record<RulePhase, AlertSeverity>
> = {
  zone: { enter: "info", exit: "info" },
  repair: { enter: "critical", exit: "info" },
  region: { enter: "info", exit: "critical" },
  customer: { enter: "info", exit: "info" },
  base: { enter: "info", exit: "warning" },
  restricted: { enter: "warning", exit: "info" },
};

/** Severity floor implied by a relay action — cutting a car is never "info". */
const CUT_SEVERITY: Record<CutMode, AlertSeverity | null> = {
  none: null,
  safe: "warning",
  now: "critical",
};

const SEVERITY_RANK: Record<AlertSeverity, number> = {
  info: 0,
  warning: 1,
  critical: 2,
};

/** The rules a fence has when its attributes carry no `carvaRules` at all. */
export function defaultRules(): GeofenceRules {
  return {
    version: RULES_VERSION,
    category: DEFAULT_CATEGORY,
    scope: "selected",
    onEnter: { ...DEFAULT_ACTION },
    onExit: { ...DEFAULT_ACTION },
  };
}

/**
 * Starting rules for a newly picked category. Notification stays on, both cuts
 * stay "none", and only the severity moves — a repair fence enters at
 * "critical" so an accident alert is loud from the moment the fence is drawn.
 */
export function defaultRulesFor(category: GeofenceCategory): GeofenceRules {
  const safeCategory = isGeofenceCategory(category)
    ? category
    : DEFAULT_CATEGORY;
  const severity = CATEGORY_SEVERITY[safeCategory];
  return {
    version: RULES_VERSION,
    category: safeCategory,
    scope: "selected",
    onEnter: { ...DEFAULT_ACTION, severity: severity.enter },
    onExit: { ...DEFAULT_ACTION, severity: severity.exit },
  };
}

/**
 * The two zones a rental fleet actually draws, ready to use:
 * - repair: any car entering raises a critical alert; leaving is silent.
 * - region: any car LEAVING raises a critical alert; entering is silent.
 * Both watch every car. Neither cuts fuel - that stays an explicit choice.
 */
export function presetRules(kind: "repair" | "region"): GeofenceRules {
  const base = defaultRulesFor(kind);
  if (kind === "repair") {
    return {
      ...base,
      scope: "all",
      onEnter: { notify: true, cut: "none", severity: "critical" },
      onExit: { notify: false, cut: "none" },
    };
  }
  return {
    ...base,
    scope: "all",
    onEnter: { notify: false, cut: "none" },
    onExit: { notify: true, cut: "none", severity: "critical" },
  };
}

/** The phase that matters for a category - what its main rule is about. */
export function primaryPhase(category: GeofenceCategory): RulePhase {
  return category === "region" || category === "base" ? "exit" : "enter";
}

/* -------------------------------- Reading -------------------------------- */

function asRecord(v: unknown): Record<string, unknown> | null {
  return typeof v === "object" && v !== null && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : null;
}

/**
 * Traccar stores attributes as JSON, but a value hand-typed in the Traccar
 * admin UI arrives as a string. Accept both rather than losing the rules.
 */
function unwrapRules(raw: unknown): Record<string, unknown> | null {
  if (typeof raw === "string") {
    const text = raw.trim();
    if (!text) return null;
    try {
      return asRecord(JSON.parse(text));
    } catch {
      return null;
    }
  }
  return asRecord(raw);
}

function readNote(raw: unknown): string | undefined {
  if (typeof raw !== "string") return undefined;
  const note = raw.trim().slice(0, MAX_NOTE_LENGTH);
  return note.length > 0 ? note : undefined;
}

function readAction(raw: unknown, fallback: RuleAction): RuleAction {
  const source = asRecord(raw);
  if (!source) return { ...fallback };

  const action: RuleAction = {
    notify: typeof source.notify === "boolean" ? source.notify : fallback.notify,
    // Deliberately NOT `fallback.cut`: an unrecognised relay value must always
    // collapse to "none". See the header note on conservative cut defaults.
    cut: isCutMode(source.cut) ? source.cut : "none",
  };

  if (isAlertSeverity(source.severity)) action.severity = source.severity;
  const note = readNote(source.note);
  if (note !== undefined) action.note = note;

  return action;
}

/**
 * Read a geofence's rules out of its `attributes`. Total function: any input —
 * undefined, a string, a number, a half-written object from an older build —
 * yields a valid GeofenceRules, with every unknown enum clamped back to the
 * safe default.
 */
export function readRules(attributes: unknown): GeofenceRules {
  const attrs = asRecord(attributes);
  const raw = attrs ? unwrapRules(attrs[CARVA_RULES_KEY]) : null;
  if (!raw) return defaultRules();

  const category = isGeofenceCategory(raw.category)
    ? raw.category
    : DEFAULT_CATEGORY;

  return {
    // Version is normalised, not trusted: a newer file read by an older build
    // still resolves to rules this build understands.
    version: RULES_VERSION,
    category,
    // Only an explicit "all" widens a fence to the whole fleet.
    scope: raw.scope === "all" ? "all" : "selected",
    onEnter: readAction(raw.onEnter, DEFAULT_ACTION),
    onExit: readAction(raw.onExit, DEFAULT_ACTION),
  };
}

/** Re-read rules through the same clamps that protect stored data. */
export function normalizeRules(rules: GeofenceRules | unknown): GeofenceRules {
  return readRules({ [CARVA_RULES_KEY]: rules });
}

/** The action that applies to one half of a crossing. */
export function actionFor(rules: GeofenceRules, phase: RulePhase): RuleAction {
  return phase === "exit" ? rules.onExit : rules.onEnter;
}

/* -------------------------------- Writing -------------------------------- */

function actionIsDefault(
  action: RuleAction,
  category: GeofenceCategory,
  phase: RulePhase,
): boolean {
  if (action.notify !== DEFAULT_ACTION.notify) return false;
  if (action.cut !== DEFAULT_ACTION.cut) return false;
  if (action.note !== undefined) return false;
  // An explicit severity that merely restates the category default is not a
  // customisation, so it should not force the key to be persisted.
  return (
    action.severity === undefined ||
    action.severity === CATEGORY_SEVERITY[category][phase]
  );
}

/** True when a fence carries no meaning beyond "plain zone, alert on both". */
export function isDefaultRules(rules: GeofenceRules): boolean {
  const r = normalizeRules(rules);
  return (
    r.category === DEFAULT_CATEGORY &&
    r.scope === "selected" &&
    actionIsDefault(r.onEnter, r.category, "enter") &&
    actionIsDefault(r.onExit, r.category, "exit")
  );
}

/** Drop undefined members so the stored attribute stays small and diffable. */
function serializeAction(action: RuleAction): Record<string, unknown> {
  const out: Record<string, unknown> = {
    notify: action.notify,
    cut: action.cut,
  };
  if (action.severity !== undefined) out.severity = action.severity;
  if (action.note !== undefined) out.note = action.note;
  return out;
}

/**
 * Merge rules into a geofence's existing attributes for a Traccar PUT.
 *
 * Other keys are preserved — Traccar's own `speedLimit`, `polylineDistance`,
 * anything an admin added — because PUT /api/geofences/{id} replaces the whole
 * record and would otherwise erase them. All-default rules drop the key
 * entirely rather than writing noise onto every fence.
 */
export function writeRules(
  attributes: unknown,
  rules: GeofenceRules,
): Record<string, unknown> {
  const attrs = { ...(asRecord(attributes) ?? {}) };
  const normalized = normalizeRules(rules);

  if (isDefaultRules(normalized)) {
    delete attrs[CARVA_RULES_KEY];
    return attrs;
  }

  attrs[CARVA_RULES_KEY] = {
    version: RULES_VERSION,
    category: normalized.category,
    ...(normalized.scope === "all" ? { scope: "all" } : {}),
    onEnter: serializeAction(normalized.onEnter),
    onExit: serializeAction(normalized.onExit),
  };
  return attrs;
}

/** Value equality, for the editor's "unsaved changes" check. */
export function rulesEqual(a: GeofenceRules, b: GeofenceRules): boolean {
  const x = normalizeRules(a);
  const y = normalizeRules(b);
  const sameAction = (p: RuleAction, q: RuleAction) =>
    p.notify === q.notify &&
    p.cut === q.cut &&
    p.severity === q.severity &&
    p.note === q.note;
  return (
    x.category === y.category &&
    x.scope === y.scope &&
    sameAction(x.onEnter, y.onEnter) &&
    sameAction(x.onExit, y.onExit)
  );
}

/* ------------------------------- Severity -------------------------------- */

function maxSeverity(a: AlertSeverity, b: AlertSeverity): AlertSeverity {
  return SEVERITY_RANK[a] >= SEVERITY_RANK[b] ? a : b;
}

/**
 * Severity of the alert this crossing should raise.
 *
 * An explicit severity on the action always wins — it is what a human chose.
 * Otherwise the category default applies, raised to at least the level implied
 * by the relay action, so a fence that immobilises a car can never be filed as
 * a quiet "info" line in the alert list.
 */
export function effectiveSeverity(
  rules: GeofenceRules,
  phase: RulePhase,
): AlertSeverity {
  const action = actionFor(rules, phase);
  if (action.severity) return action.severity;
  const base = CATEGORY_SEVERITY[rules.category][phase];
  const implied = CUT_SEVERITY[action.cut];
  return implied ? maxSeverity(base, implied) : base;
}

/** True when this crossing does anything at all (used to skip silent fences). */
export function actionIsSilent(action: RuleAction): boolean {
  return !action.notify && action.cut === "none";
}

/* --------------------------- Relay translation --------------------------- */

/**
 * Map a rule's `cut` onto the jt808 vehicle-control mode the tracker accepts.
 * Returns null for "none" so callers can treat "no command" as an explicit
 * case instead of accidentally sending `resume` and un-cutting a car that a
 * human immobilised on purpose.
 */
export function vehicleControlFor(cut: CutMode): VehicleControlMode | null {
  if (cut === "safe") return "cutSafe";
  if (cut === "now") return "cut";
  return null;
}

/* -------------------------------- Display -------------------------------- */

export interface CategoryMeta {
  /** i18n key for the category name. */
  labelKey: string;
  /** i18n key for the one-line explanation shown in the picker. */
  descKey: string;
  /** lucide-react icon NAME; the UI maps it to a component. */
  icon: string;
  /** The same accent as a hex colour, for the map (zones, labels, toasts). */
  hex: string;
  /**
   * Accent classes, written out in full. Tailwind scans source for literal
   * class strings, so these must never be assembled from a colour fragment
   * (`bg-${c}-500` would be purged out of the production build).
   */
  accent: { dot: string; text: string; soft: string };
}

export const CATEGORY_META: Record<GeofenceCategory, CategoryMeta> = {
  zone: {
    labelKey: "geo.cat.zone",
    descKey: "geo.cat.zone.desc",
    icon: "Hexagon",
    hex: "#0ea5e9",
    accent: {
      dot: "bg-sky-500",
      text: "text-sky-500",
      soft: "bg-sky-500/10",
    },
  },
  repair: {
    labelKey: "geo.cat.repair",
    descKey: "geo.cat.repair.desc",
    icon: "Wrench",
    hex: "#ef4444",
    accent: {
      dot: "bg-red-500",
      text: "text-red-500",
      soft: "bg-red-500/10",
    },
  },
  region: {
    labelKey: "geo.cat.region",
    descKey: "geo.cat.region.desc",
    icon: "Map",
    hex: "#14b8a6",
    accent: {
      dot: "bg-teal-500",
      text: "text-teal-500",
      soft: "bg-teal-500/10",
    },
  },
  customer: {
    labelKey: "geo.cat.customer",
    descKey: "geo.cat.customer.desc",
    icon: "User",
    hex: "#8b5cf6",
    accent: {
      dot: "bg-violet-500",
      text: "text-violet-500",
      soft: "bg-violet-500/10",
    },
  },
  base: {
    labelKey: "geo.cat.base",
    descKey: "geo.cat.base.desc",
    icon: "Warehouse",
    hex: "#10b981",
    accent: {
      dot: "bg-emerald-500",
      text: "text-emerald-500",
      soft: "bg-emerald-500/10",
    },
  },
  restricted: {
    labelKey: "geo.cat.restricted",
    descKey: "geo.cat.restricted.desc",
    icon: "Ban",
    hex: "#f59e0b",
    accent: {
      dot: "bg-amber-500",
      text: "text-amber-500",
      soft: "bg-amber-500/10",
    },
  },
};

export const SEVERITY_META: Record<
  AlertSeverity,
  { labelKey: string; dot: string; text: string }
> = {
  info: { labelKey: "geo.sev.info", dot: "bg-sky-500", text: "text-sky-500" },
  warning: {
    labelKey: "geo.sev.warning",
    dot: "bg-amber-500",
    text: "text-amber-500",
  },
  critical: {
    labelKey: "geo.sev.critical",
    dot: "bg-red-500",
    text: "text-red-500",
  },
};

export const PHASE_LABEL_KEY: Record<RulePhase, string> = {
  enter: "geo.rule.onEnter",
  exit: "geo.rule.onExit",
};

export const CUT_LABEL_KEY: Record<CutMode, string> = {
  none: "geo.cut.none",
  safe: "geo.cut.safe",
  now: "geo.cut.now",
};

/**
 * Summaries are whole phrases, one key per notify/cut combination, rather than
 * an "Alert" + "+" + "cut fuel" concatenation: Arabic and Kurdish do not join
 * those fragments in the same order, and both are RTL.
 */
const ACTION_SUMMARY_KEY: Record<"off" | "on", Record<CutMode, string>> = {
  off: {
    none: "geo.act.nothing",
    safe: "geo.act.cutSafe",
    now: "geo.act.cutNow",
  },
  on: {
    none: "geo.act.alert",
    safe: "geo.act.alertCutSafe",
    now: "geo.act.alertCutNow",
  },
};

/** English fallbacks, so the automation runner can log without an i18n dict. */
const ACTION_SUMMARY_EN: Record<string, string> = {
  "geo.act.nothing": "Do nothing",
  "geo.act.cutSafe": "Cut fuel safely",
  "geo.act.cutNow": "Cut fuel immediately",
  "geo.act.alert": "Alert only",
  "geo.act.alertCutSafe": "Alert + cut fuel safely",
  "geo.act.alertCutNow": "Alert + cut fuel immediately",
};

/** The i18n key summarising an action, for callers that translate themselves. */
export function actionSummaryKey(action: RuleAction): string {
  const cut = isCutMode(action.cut) ? action.cut : "none";
  return ACTION_SUMMARY_KEY[action.notify ? "on" : "off"][cut];
}

/**
 * Short human summary of one rule action — "Alert + cut fuel safely".
 * `t` is optional so server-side code can produce the English phrase.
 */
export function describeAction(action: RuleAction, t?: Translate): string {
  const key = actionSummaryKey(action);
  return t ? t(key) : ACTION_SUMMARY_EN[key];
}
