"use client";

import * as React from "react";
import {
  knotsToKmh,
  motionState,
  batteryLevel,
  type TraccarDevice,
  type TraccarPosition,
} from "@carva/shared";

import type {
  Alert,
  FleetMetric,
  SignalIssue,
  Vehicle,
  VehicleStatus,
  VehicleTracker,
} from "@/mock/types";
import { demoAlerts, demoFleet } from "@/lib/demo-fleet";
import {
  openFleetSocket,
  type SocketHandle,
  type SocketState,
  type TraccarFrame,
} from "@/lib/live-socket";

export type CarvaRole = "general_admin" | "company" | "personal";

export interface SessionUser {
  id: number;
  name: string;
  email: string;
  administrator: boolean;
  readonly?: boolean;
  accountType?: string | null;
  role: CarvaRole;
}

/* --------------------------- Device clock skew --------------------------- */
//
// A tracker stamps every fix with its OWN clock, and that clock is often wrong.
// Device 7 on this fleet runs exactly 8 hours behind: the floor of
// `serverTime - fixTime` sits at 28800 s in every sample going back days, even
// while it is reporting once a minute. Treating that gap as staleness would
// brand a perfectly live tracker "out of date" forever.
//
// So the skew is measured rather than assumed: the SMALLEST gap ever seen from
// a device is, by definition, the part that is not upload lag. Anything above
// that floor is genuine. It only ratchets downwards, so a tracker first met
// mid-backlog corrects itself as soon as it sends one prompt report. Persisted
// next to the heading cache so a page reload does not have to relearn it.

const SKEW_KEY = "carva.clockSkew";
let skewCache: Record<string, number> | null = null;

function skews(): Record<string, number> {
  if (skewCache) return skewCache;
  if (typeof window === "undefined") return (skewCache = {});
  try {
    const raw = window.localStorage.getItem(SKEW_KEY);
    const parsed = raw ? (JSON.parse(raw) as unknown) : {};
    skewCache =
      parsed && typeof parsed === "object" ? (parsed as Record<string, number>) : {};
  } catch {
    skewCache = {};
  }
  return skewCache;
}

/** Fold one observed gap into the device's floor and return the current best. */
function clockSkew(deviceId: number, gap: number | null): number {
  const store = skews();
  const known = store[deviceId];
  if (gap == null || !Number.isFinite(gap)) return known ?? 0;
  if (known != null && known <= gap) return known;
  store[deviceId] = gap;
  try {
    window.localStorage.setItem(SKEW_KEY, JSON.stringify(store));
  } catch {
    /* private mode - the in-memory copy still serves this session */
  }
  return gap;
}

/* ----------------------------- Connectivity ------------------------------ */
//
// Traccar's `device.status` and `device.lastUpdate` describe the PACKET, not
// the FIX. That distinction is the whole problem: a tracker that loses its data
// connection buffers positions to flash and dumps the backlog later, and
// Traccar stamps each arriving packet with a fresh `lastUpdate`. So the roster
// read "Idle . just now" all day while the coordinates it was drawing had been
// recorded hours earlier, in a different part of the city.
//
// Three timestamps, three different questions:
//
//   device.lastUpdate    when did we last hear ANYTHING?  -> is it connected
//   position.serverTime  when did this fix reach us?      -> measured here
//   position.fixTime     when was this fix RECORDED?      -> how old is the dot
//
// `serverTime - fixTime` is the useful one: both are stamped on the way in, so
// a browser clock that disagrees cannot distort it. Minus the device's own
// clock skew (see above), what is left is how old the position already was when
// it landed - which is exactly what makes the marker untrustworthy, whether the
// cause was a buffered backlog or a receiver that stopped producing fixes.

/** Silence beyond this reads as "not reporting" - No Signal. */
const SILENT_MS = 15 * 60_000;
/** Silence beyond this (or Traccar giving up) reads as flat Offline. */
const OFFLINE_MS = 60 * 60_000;
/** A fix already this old on arrival cannot be trusted as "where the car is". */
const DELAYED_MS = 15 * 60_000;

function millis(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  return Number.isFinite(t) ? t : null;
}

interface Connectivity {
  status: VehicleStatus;
  issue: SignalIssue | null;
  /** ISO time the newest fix was recorded, corrected for the device's clock. */
  fixAt: string;
}

function deriveConnectivity(
  d: TraccarDevice,
  p: TraccarPosition | undefined,
  now: number,
): Connectivity {
  const rawFix = millis(p?.fixTime);
  const arrived = millis(p?.serverTime);
  // How far this device's clock runs behind the server's, learned over time.
  const skew = clockSkew(d.id, rawFix != null && arrived != null ? arrived - rawFix : null);
  // The fix's real time, on the server's clock, so it can be compared to now.
  const fix = rawFix != null ? rawFix + skew : null;
  const fixAt = fix != null ? new Date(fix).toISOString() : "";

  // Last contact = the last time the box said anything at all, whether or not
  // there was a usable position inside it.
  const contact = Math.max(
    millis(d.lastUpdate) ?? -Infinity,
    arrived ?? -Infinity,
    fix ?? -Infinity,
  );

  // Never said a word. Not "idle" - absent.
  if (!Number.isFinite(contact)) {
    return { status: "offline", issue: "never", fixAt };
  }

  const silence = now - contact;
  if (d.status === "offline" || silence > OFFLINE_MS) {
    return { status: "offline", issue: "silent", fixAt };
  }
  if (silence > SILENT_MS) return { status: "unknown", issue: "silent", fixAt };

  // Talking, but with no usable position behind it at all.
  if (fix == null || p?.valid === false) {
    return { status: "unknown", issue: "no_fix", fixAt };
  }

  // The newest position was ALREADY old when it arrived - the tracker either
  // buffered it while it had no connection, or stopped getting new fixes. The
  // car has had that long to be somewhere else.
  if (arrived != null && arrived - fix > DELAYED_MS) {
    return { status: "unknown", issue: "delayed", fixAt };
  }
  // Same verdict without a serverTime to lean on: nothing new in a long while.
  if (now - fix > SILENT_MS) {
    return { status: "unknown", issue: "delayed", fixAt };
  }

  // Traccar's own "unknown": heard from recently, but no live session.
  if (d.status !== "online") return { status: "unknown", issue: "silent", fixAt };

  return {
    status: motionState(d, p) === "moving" ? "in_transit" : "idle",
    issue: null,
    fixAt,
  };
}


/* --------------------------- Traccar -> Vehicle --------------------------- */

function num(v: unknown): number | undefined {
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}

/* ------------------------- Last known heading ---------------------------- */
//
// A parked tracker reports course 0 — not "north", but "no direction of
// travel". Showing "—" is honest yet useless: what an operator wants is which
// way the car was pointing when it stopped. So the last course reported while
// actually moving is remembered per device, and reused while it sits still.
// Persisted so it survives a page reload rather than resetting to "—".

const HEADING_KEY = "carva.lastHeading";
let headingCache: Record<string, number> | null = null;

function headings(): Record<string, number> {
  if (headingCache) return headingCache;
  if (typeof window === "undefined") return (headingCache = {});
  try {
    const raw = window.localStorage.getItem(HEADING_KEY);
    const parsed = raw ? (JSON.parse(raw) as unknown) : {};
    headingCache =
      parsed && typeof parsed === "object" ? (parsed as Record<string, number>) : {};
  } catch {
    headingCache = {};
  }
  return headingCache;
}

function rememberHeading(deviceId: number, course: number) {
  const store = headings();
  if (store[deviceId] === course) return;
  store[deviceId] = course;
  try {
    window.localStorage.setItem(HEADING_KEY, JSON.stringify(store));
  } catch {
    /* private mode — the in-memory copy still serves this session */
  }
}

/**
 * The heading to display, plus whether it is live.
 * Live while moving; otherwise the last course seen while moving.
 */
function resolveHeading(
  deviceId: number,
  position: TraccarPosition | undefined,
  moving: boolean,
): { heading: number; live: boolean } {
  const course = position?.course ?? 0;
  // Trust a course only when the vehicle was moving — a stationary 0 is noise.
  if (moving && Number.isFinite(course)) {
    rememberHeading(deviceId, course);
    return { heading: course, live: true };
  }
  const remembered = headings()[deviceId];
  if (typeof remembered === "number") return { heading: remembered, live: false };
  // Never seen it move: fall back to whatever the fix says, marked not-live.
  return { heading: course, live: false };
}

function toVehicle(d: TraccarDevice, p?: TraccarPosition): Vehicle {
  const signal = deriveConnectivity(d, p, Date.now());
  const attrs = p?.attributes ?? {};
  const battery = batteryLevel(p);
  // Prefer the tracker's own odometer only when it is actually counting. The
  // MV930G ships with its odometer feature OFF and reports a literal 0, which
  // `??` treated as a real reading — so the panel showed "0 km" while Traccar
  // had already accumulated hundreds of km in totalDistance.
  const rawOdo = num(attrs.odometer);
  const odoMeters =
    rawOdo != null && rawOdo > 0 ? rawOdo : num(attrs.totalDistance);
  const gsm = num(attrs.rssi) ?? num(attrs.gsm);
  const moving = (p?.speed ?? 0) > 0 || attrs.motion === true;
  const course = resolveHeading(d.id, p, moving);

  return {
    id: String(d.id),
    name: d.name,
    plate: d.uniqueId,
    model: d.category
      ? d.category.charAt(0).toUpperCase() + d.category.slice(1)
      : "Tracker",
    status: signal.status,
    // Trackers report a device battery; show it on the battery gauge.
    fuelType: battery != null ? "electric" : "diesel",
    energyLevel: battery ?? 0,
    speedKmh: p ? knotsToKmh(p.speed) : 0,
    odometerKm: odoMeters != null ? Math.round(odoMeters / 1000) : 0,
    driverId: null,
    location:
      p?.address ||
      (p ? `${p.latitude.toFixed(4)}, ${p.longitude.toFixed(4)}` : "—"),
    position: { x: 0, y: 0 },
    // A GPS course only means something while the vehicle is moving; parked,
    // the tracker reports 0, which is not "north" — it is "no direction". So
    // show the last course seen while moving, flagged as not-live.
    heading: course.heading,
    headingValid: course.live,
    // Empty when the tracker has never reported. Falling back to `now` used to
    // make a device that has never once connected read "Offline · just now".
    lastUpdated: d.lastUpdate || p?.fixTime || "",
    // The fix's own time, corrected for a wrong device clock - this is what
    // tells the roster how old the marker on the map really is.
    lastFixAt: signal.fixAt,
    signalIssue: signal.issue,
    lat: p?.latitude,
    lng: p?.longitude,
    online: d.status === "online",
    // ACC / ignition line: most protocols decode to `ignition`; some report it
    // as `acc`. Accept either so the ACC indicator lights up across trackers.
    ignition:
      typeof attrs.ignition === "boolean"
        ? attrs.ignition
        : typeof attrs.acc === "boolean"
          ? attrs.acc
          : undefined,
    charge: typeof attrs.charge === "boolean" ? attrs.charge : undefined,
    gsm,
    deviceId: d.id,
    attributes: p?.attributes,
    deviceAttributes: d.attributes,
  };
}

/** Pick the freshest position per device. */
function latestByDevice(positions: TraccarPosition[]): Map<number, TraccarPosition> {
  const map = new Map<number, TraccarPosition>();
  for (const p of positions) {
    const prev = map.get(p.deviceId);
    if (!prev || new Date(p.fixTime) > new Date(prev.fixTime)) {
      map.set(p.deviceId, p);
    }
  }
  return map;
}

/* -------------------------------- Hooks ---------------------------------- */

export interface SessionState {
  loading: boolean;
  authed: boolean;
  user: SessionUser | null;
}

export function useSession(): SessionState {
  const [state, setState] = React.useState<SessionState>({
    loading: true,
    authed: false,
    user: null,
  });

  React.useEffect(() => {
    let alive = true;
    fetch("/api/auth/session", { cache: "no-store" })
      .then(async (r) => {
        if (!alive) return;
        if (r.ok) {
          const user = (await r.json()) as SessionUser;
          setState({ loading: false, authed: true, user });
        } else {
          setState({ loading: false, authed: false, user: null });
        }
      })
      .catch(() => {
        if (alive) setState({ loading: false, authed: false, user: null });
      });
    return () => {
      alive = false;
    };
  }, []);

  return state;
}

/** A Traccar group. Here it models one CAR that several trackers are fitted to. */
export interface TraccarGroup {
  id: number;
  name: string;
  groupId?: number;
  attributes?: Record<string, unknown>;
}

/** Summarise one device as a tracker entry on its car. */
function toTracker(
  device: TraccarDevice,
  position: TraccarPosition | undefined,
  primary: boolean,
): VehicleTracker {
  return {
    deviceId: device.id,
    name: device.name,
    uniqueId: device.uniqueId,
    model: device.model ?? null,
    online: device.status === "online",
    lastUpdated: device.lastUpdate || position?.fixTime || "",
    hasFix: position != null,
    speedKmh: position ? knotsToKmh(position.speed) : 0,
    attributes: position?.attributes,
    primary,
  };
}

/** Newest fix wins; a device with no position sorts last. */
function fixTimeOf(position: TraccarPosition | undefined): number {
  const t = position ? +new Date(position.fixTime) : NaN;
  return Number.isFinite(t) ? t : -Infinity;
}

/**
 * Fold devices into vehicles.
 *
 * A device with no group is its own vehicle, exactly as before. Devices that
 * share a Traccar group are ONE car with several trackers: the car takes the
 * group's name, its live readings come from whichever tracker reported most
 * recently, and every unit is listed in `trackers` so the UI can show each
 * one's health and target commands at a specific box.
 */
export function groupIntoVehicles(
  devices: TraccarDevice[],
  groups: TraccarGroup[],
  byDevice: Map<number, TraccarPosition>,
): Vehicle[] {
  const groupById = new Map(groups.map((g) => [g.id, g]));
  const inGroup = new Map<number, TraccarDevice[]>();
  const loose: TraccarDevice[] = [];

  for (const device of devices) {
    const gid = device.groupId ?? 0;
    if (gid > 0 && groupById.has(gid)) {
      const list = inGroup.get(gid) ?? [];
      list.push(device);
      inGroup.set(gid, list);
    } else {
      loose.push(device);
    }
  }

  const vehicles: Vehicle[] = loose.map((d) => {
    const v = toVehicle(d, byDevice.get(d.id));
    return { ...v, trackers: [toTracker(d, byDevice.get(d.id), true)] };
  });

  for (const [gid, members] of inGroup) {
    const group = groupById.get(gid)!;
    // A single-member group is still a car — it just has room for a second box.
    const ranked = [...members].sort(
      (a, b) => fixTimeOf(byDevice.get(b.id)) - fixTimeOf(byDevice.get(a.id)),
    );
    const primary = ranked[0];
    const base = toVehicle(primary, byDevice.get(primary.id));
    const plate =
      typeof group.attributes?.plate === "string" && group.attributes.plate
        ? (group.attributes.plate as string)
        : base.plate;

    vehicles.push({
      ...base,
      // Keep the primary device's id so deep links, commands and history all
      // continue to address a real tracker.
      name: group.name || base.name,
      plate,
      groupId: gid,
      trackers: ranked.map((d) =>
        toTracker(d, byDevice.get(d.id), d.id === primary.id),
      ),
    });
  }

  return vehicles;
}

/* ------------------------------ Live store ------------------------------- */
//
// One fleet, one connection, however many components are watching.
//
// `useLiveFleet` is mounted by more than one route, and React 18 strict mode
// mounts each of them twice. A socket opened inside the hook would therefore
// mean duplicate streams, duplicate roster fetches, and a teardown on every
// navigation. So the transport lives here, module-level and reference-counted,
// and the hooks are thin subscribers to its snapshot.
//
// Two transports, one code path. The socket is the fast lane: Traccar pushes a
// frame the moment a fix lands, which is what makes the map move in real time
// instead of up to five seconds late. REST is still the source of the ROSTER -
// a frame only describes devices that just changed, so it can never tell us a
// car was added, removed or regrouped. Hence a periodic reconcile: every five
// seconds while we are reduced to polling, every minute while the socket is
// healthy.

/** Fast reconcile - the socket is down and this is the only source of data. */
const POLL_MS = 5000;
/** Slow reconcile - the socket is live; this only catches roster changes. */
const RECONCILE_MS = 60_000;
/**
 * Grace period before a fleet with no subscribers is torn down. Route changes
 * and strict-mode remounts both drop the count to zero for a tick; without
 * this the socket would be rebuilt and the roster refetched on every one.
 */
const IDLE_TEARDOWN_MS = 2000;

/** Where the live data is coming from right now. */
export type FleetTransport = "connecting" | "live" | "polling" | "demo";

export interface FleetSnapshot {
  vehicles: Vehicle[];
  error: string | null;
  lastUpdated: number | null;
  transport: FleetTransport;
}

/** Raw upstream state, kept so a frame can be merged without a full refetch. */
interface RawFleet {
  devices: Map<number, TraccarDevice>;
  positions: Map<number, TraccarPosition>;
  groups: TraccarGroup[];
}

const EMPTY: FleetSnapshot = {
  vehicles: [],
  error: null,
  lastUpdated: null,
  transport: "connecting",
};

type Listener = (snapshot: FleetSnapshot) => void;

let snapshot: FleetSnapshot = EMPTY;
const listeners = new Set<Listener>();
let raw: RawFleet | null = null;
let socket: SocketHandle | null = null;
let timer: ReturnType<typeof setInterval> | null = null;
let teardown: ReturnType<typeof setTimeout> | null = null;
let timerMode: "poll" | "reconcile" | null = null;
let running = false;
/** Guards against a refetch that resolves after the fleet was torn down. */
let generation = 0;

function publish(patch: Partial<FleetSnapshot>) {
  snapshot = { ...snapshot, ...patch };
  for (const listener of listeners) listener(snapshot);
}

/** Rebuild the vehicle list from raw state and hand it to subscribers. */
function derive() {
  if (!raw) return;
  publish({
    vehicles: groupIntoVehicles(
      [...raw.devices.values()],
      raw.groups,
      raw.positions,
    ),
    error: null,
    lastUpdated: Date.now(),
  });
}

/**
 * Fold one pushed frame into raw state.
 *
 * Device entries are MERGED, not replaced: a frame announcing a status change
 * carries only what changed, and overwriting the roster entry with it would
 * drop the name, group and model the map is drawing from.
 */
function applyFrame(frame: TraccarFrame) {
  if (!raw || !running) return;
  let changed = false;

  for (const device of frame.devices ?? []) {
    if (!device || typeof device.id !== "number") continue;
    const known = raw.devices.get(device.id);
    raw.devices.set(device.id, known ? { ...known, ...device } : device);
    changed = true;
  }

  for (const position of frame.positions ?? []) {
    if (!position || typeof position.deviceId !== "number") continue;
    // Newest FIX wins, exactly as the REST path does. A tracker dumping a
    // buffered backlog replays old fixes at speed; letting one of those
    // overwrite a current position would throw the marker back across town.
    if (fixTimeOf(position) <= fixTimeOf(raw.positions.get(position.deviceId))) {
      continue;
    }
    raw.positions.set(position.deviceId, position);
    changed = true;
  }

  if (changed) derive();
}

/**
 * Replace raw state from a REST read.
 *
 * The roster is authoritative - that is the whole point of reconciling - but
 * positions are merged on newest-fix-wins, because a request that was already
 * in flight when a frame arrived would otherwise regress the marker.
 */
function ingest(
  devices: TraccarDevice[],
  positions: TraccarPosition[],
  groups: TraccarGroup[],
) {
  const roster = new Map(devices.map((d) => [d.id, d]));
  const fetched = latestByDevice(positions);
  const merged = new Map<number, TraccarPosition>();

  for (const id of roster.keys()) {
    const fresh = fetched.get(id);
    const held = raw?.positions.get(id);
    const best = fixTimeOf(fresh) >= fixTimeOf(held) ? fresh : held;
    if (best) merged.set(id, best);
  }

  raw = { devices: roster, positions: merged, groups };
  derive();
}

/** When the most recent REST read started, to avoid reading twice at once. */
let lastRefreshAt = 0;

async function refresh() {
  const mine = generation;
  lastRefreshAt = Date.now();
  try {
    const [dRes, pRes, gRes] = await Promise.all([
      fetch("/api/traccar/devices", { cache: "no-store" }),
      fetch("/api/traccar/positions", { cache: "no-store" }),
      // Groups are how one car carries several trackers. A failure here is
      // not fatal: without them every device is simply its own vehicle.
      fetch("/api/traccar/groups", { cache: "no-store" }).catch(() => null),
    ]);
    if (!dRes.ok || !pRes.ok) throw new Error("traccar request failed");
    const devices = (await dRes.json()) as TraccarDevice[];
    const positions = (await pRes.json()) as TraccarPosition[];
    const groups = gRes && gRes.ok ? ((await gRes.json()) as TraccarGroup[]) : [];
    if (mine !== generation) return;
    ingest(devices, positions, groups);
  } catch {
    if (mine === generation) {
      publish({ error: "Couldn’t reach the GPS server. Retrying…" });
    }
  }
}

/** Run the reconcile loop at the cadence the current transport calls for. */
function setTimerMode(mode: "poll" | "reconcile") {
  if (timerMode === mode && timer != null) return;
  if (timer != null) clearInterval(timer);
  timerMode = mode;
  timer = setInterval(refresh, mode === "poll" ? POLL_MS : RECONCILE_MS);
}

function onSocketState(state: SocketState) {
  if (!running) return;

  if (state === "open") {
    publish({ transport: "live", error: null });
    setTimerMode("reconcile");
    // Reconcile once now, in case a device was added or regrouped between the
    // roster read and the stream coming up — but not if a read is already on
    // its way, which is the normal case when the handshake is quick.
    if (Date.now() - lastRefreshAt > 2000) void refresh();
    return;
  }

  // Anything else means the stream cannot be relied on, so the 5s poll carries
  // the page. Retries republish the same state several times over a minute, so
  // only announce an actual change.
  const transport: FleetTransport = state === "connecting" ? "connecting" : "polling";
  if (snapshot.transport !== transport) publish({ transport });
  setTimerMode("poll");
}

function start() {
  if (running) return;
  running = true;
  generation += 1;
  snapshot = EMPTY;
  raw = null;

  void refresh(); // first paint should not wait on a handshake
  setTimerMode("poll");
  socket = openFleetSocket({ onFrame: applyFrame, onState: onSocketState });
}

function stop() {
  running = false;
  generation += 1;
  socket?.close();
  socket = null;
  if (timer != null) clearInterval(timer);
  timer = null;
  timerMode = null;
  raw = null;
  snapshot = EMPTY;
}

/**
 * Watch the live fleet. Returns an unsubscribe function; the transport starts
 * with the first subscriber and stops shortly after the last one leaves.
 */
export function subscribeFleet(listener: Listener): () => void {
  if (teardown != null) {
    clearTimeout(teardown);
    teardown = null;
  }
  listeners.add(listener);
  if (!running) start();
  listener(snapshot);

  return () => {
    listeners.delete(listener);
    if (listeners.size > 0 || teardown != null) return;
    teardown = setTimeout(() => {
      teardown = null;
      if (listeners.size === 0) stop();
    }, IDLE_TEARDOWN_MS);
  };
}

export interface LiveFleetState extends FleetSnapshot {
  authed: boolean;
  loading: boolean;
  user: SessionUser | null;
}

/**
 * Live fleet data. Logged in -> real-time push from Traccar, with a polling
 * fallback. Logged out -> the demo dataset, so the marketing demo works.
 */
const DEMO_TICK_MS = 2000;

export function useLiveFleet(): LiveFleetState {
  const session = useSession();
  const [state, setState] = React.useState<FleetSnapshot>(EMPTY);

  React.useEffect(() => {
    if (session.loading) return;
    if (!session.authed) {
      // Logged out: a live SIMULATED rental fleet in Erbil (lib/demo-fleet),
      // ticking every 2 s like real trackers - no account needed.
      const tick = () =>
        setState({ vehicles: demoFleet(), error: null, lastUpdated: Date.now(), transport: "demo" });
      tick();
      const id = setInterval(tick, DEMO_TICK_MS);
      return () => clearInterval(id);
    }
    return subscribeFleet(setState);
  }, [session.loading, session.authed]);

  return {
    ...state,
    authed: session.authed,
    loading: session.loading,
    user: session.user,
  };
}

/* --------------------------- Derived dashboard --------------------------- */

export function computeLiveMetrics(vehicles: Vehicle[]): FleetMetric[] {
  const total = vehicles.length;
  const online = vehicles.filter(
    (v) => v.status === "in_transit" || v.status === "idle",
  ).length;
  const moving = vehicles.filter((v) => v.status === "in_transit").length;
  const offline = vehicles.filter((v) => v.status === "offline").length;
  const energies = vehicles.map((v) => v.energyLevel).filter((n) => n > 0);
  const avg = energies.length
    ? Math.round(energies.reduce((a, b) => a + b, 0) / energies.length)
    : 0;

  // External supply voltage, straight off the trackers. `power` is the vehicle
  // battery reading; anything at or above 6 V means the unit is wired in and
  // charging rather than running down its own backup cell.
  const volts = vehicles
    .map((v) => {
      const raw = (v.attributes as Record<string, unknown> | undefined)?.power;
      return typeof raw === "number" && Number.isFinite(raw) ? raw : null;
    })
    .filter((n): n is number => n != null);
  const wired = volts.filter((n) => n >= 6).length;
  const avgVolts = volts.length
    ? volts.reduce((a, b) => a + b, 0) / volts.length
    : null;

  // Labels are i18n keys — MetricCard translates them (plain strings pass through).
  return [
    {
      id: "active",
      label: "fleet.metric.active",
      value: `${online} / ${total}`,
      delta: 0,
      positiveIsGood: true,
    },
    {
      id: "moving",
      label: "fleet.metric.moving",
      value: String(moving),
      delta: 0,
      positiveIsGood: true,
    },
    {
      id: "battery",
      label: "fleet.metric.battery",
      value: avg ? `${avg}%` : "—",
      delta: 0,
      positiveIsGood: true,
    },
    {
      id: "offline",
      label: "fleet.metric.offline",
      value: String(offline),
      delta: 0,
      positiveIsGood: false,
    },
    // Added alongside the originals: these trackers report vehicle supply
    // voltage rather than a battery percentage, so this is the reading that
    // actually tells you whether a unit is still wired in.
    {
      id: "power",
      label: "fleet.metric.power",
      value: volts.length ? `${wired} / ${volts.length}` : "—",
      delta: 0,
      positiveIsGood: true,
    },
    {
      id: "voltage",
      label: "fleet.metric.voltage",
      value: avgVolts != null ? `${avgVolts.toFixed(1)} V` : "—",
      delta: 0,
      positiveIsGood: true,
    },
  ];
}

/** Demo alerts when logged out; lightweight derived alerts when live. */
export function overviewAlerts(
  vehicles: Vehicle[],
  authed: boolean,
  t: (key: string) => string = (k) => k,
): Alert[] {
  if (!authed) return demoAlerts();

  const out: Alert[] = [];
  for (const v of vehicles) {
    if (v.status === "offline") {
      out.push({
        id: `live-off-${v.id}`,
        vehicleId: v.id,
        type: "battery_low",
        severity: "critical",
        title: t("fleet.alert.offline.t").replace("{name}", v.name),
        description: t("fleet.alert.offline.d"),
        timestamp: v.lastUpdated,
        acknowledged: false,
      });
    } else if (v.signalIssue === "delayed" || v.signalIssue === "no_fix") {
      // Reachable but not to be trusted: worth flagging on its own, because
      // the map still shows a plausible-looking marker at a place the vehicle
      // may have left hours ago.
      const kind = v.signalIssue === "delayed" ? "delayed" : "nofix";
      out.push({
        id: `live-${kind}-${v.id}`,
        vehicleId: v.id,
        type: "battery_low",
        severity: "warning",
        title: t(`fleet.alert.${kind}.t`).replace("{name}", v.name),
        description: t(`fleet.alert.${kind}.d`),
        timestamp: v.lastFixAt || v.lastUpdated,
        acknowledged: false,
      });
    } else if (v.energyLevel > 0 && v.energyLevel <= 20) {
      out.push({
        id: `live-bat-${v.id}`,
        vehicleId: v.id,
        type: "battery_low",
        severity: "warning",
        title: t("fleet.alert.battery.t").replace("{name}", v.name),
        description: t("fleet.alert.battery.d").replace(
          "{pct}",
          String(v.energyLevel),
        ),
        timestamp: v.lastUpdated,
        acknowledged: false,
      });
    } else if (v.speedKmh > 100) {
      out.push({
        id: `live-spd-${v.id}`,
        vehicleId: v.id,
        type: "speeding",
        severity: "warning",
        title: t("fleet.alert.speed.t").replace("{name}", v.name),
        description: t("fleet.alert.speed.d").replace(
          "{kmh}",
          String(v.speedKmh),
        ),
        timestamp: v.lastUpdated,
        acknowledged: false,
      });
    }
  }
  return out;
}
