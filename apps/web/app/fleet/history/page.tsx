"use client";

import { History as PageIcon } from "lucide-react";
import * as React from "react";
import Link from "next/link";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import {
  Crosshair,
  Gauge,
  Maximize2,
  Minimize2,
  Pause,
  Play,
  Route,
  Satellite,
  Scan,
  SkipBack,
  SkipForward,
  Timer,
  type LucideIcon,
} from "lucide-react";

import { KpiTile } from "@/components/dashboard/kpi-tile";
import { PageHeader } from "@/components/dashboard/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { useSession } from "@/lib/live-data";
import { useI18n } from "@/lib/i18n-provider";
import { routeStats } from "@/lib/route-stats";
import {
  STREET_ATTRIBUTION,
  STREET_MAX_ZOOM,
  STREET_TILES,
  SATELLITE_TILES,
} from "@/lib/basemaps";
import {
  knotsToKmh,
  type TraccarDevice,
  type TraccarPosition,
} from "@carva/shared";


type Period = "today" | "yesterday" | "week" | "month" | "custom";
type Basemap = "streets" | "satellite";

/** All timestamps on this page are shown in fleet-local time. */
const TZ = "Asia/Baghdad";

/**
 * A row of GET /api/reports/stops. Traccar names the coordinates `lat`/`lon`
 * here (unlike positions), and a few builds spell them out — accept both.
 * Distances are metres, durations milliseconds.
 */
interface TraccarStop {
  deviceId: number;
  startTime: string;
  endTime: string;
  duration: number;
  address?: string;
  lat?: number;
  lon?: number;
  latitude?: number;
  longitude?: number;
}

/** A row of GET /api/reports/trips (metres / milliseconds / knots). */
interface TraccarTrip {
  deviceId: number;
  startTime: string;
  endTime: string;
  duration: number;
  distance: number;
  maxSpeed: number;
  averageSpeed: number;
  startAddress?: string;
  endAddress?: string;
}

function haversineKm(
  aLat: number,
  aLng: number,
  bLat: number,
  bLng: number,
): number {
  const R = 6371;
  const dLat = ((bLat - aLat) * Math.PI) / 180;
  const dLng = ((bLng - aLng) * Math.PI) / 180;
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((aLat * Math.PI) / 180) *
      Math.cos((bLat * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

function num(v: unknown): number | undefined {
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}

/** Format a Date for a datetime-local input (local time, minute precision). */
function toLocalInput(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** "14:02" — used by the trip picker. */
function fmtClock(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-GB", {
    timeZone: TZ,
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** "16 Aug, 14:02" — used by the map popups. */
function fmtStamp(iso: string): string {
  return new Date(iso).toLocaleString("en-GB", {
    timeZone: TZ,
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** Milliseconds -> "2 h 14 min" in the active language. */
function fmtDuration(ms: number, t: (key: string) => string): string {
  const mins = Math.max(0, Math.round(ms / 60000));
  return mins >= 60
    ? `${Math.floor(mins / 60)} ${t("hist.hour")} ${mins % 60} ${t("hist.min")}`
    : `${mins} ${t("hist.min")}`;
}

/** Popups are built as HTML strings and Traccar addresses are untrusted text. */
function esc(s: string): string {
  return s.replace(
    /[&<>"]/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c] ?? c,
  );
}

// MapLibre popups keep their own white card, so their colours are set inline
// rather than with theme tokens — they float over tiles, not over app chrome.
const POPUP_CSS =
  "font:12px/1.5 system-ui,sans-serif;color:#0f172a;min-width:150px;";
const POPUP_DIM = "color:#475569";

/** GET a Traccar report through the proxy. Never throws — extras are optional. */
async function fetchReport<T>(name: string, qs: URLSearchParams): Promise<T[]> {
  try {
    const res = await fetch(`/api/traccar/reports/${name}?${qs}`, {
      cache: "no-store",
    });
    if (!res.ok) return [];
    const rows = (await res.json()) as T[];
    return Array.isArray(rows) ? rows : [];
  } catch {
    return [];
  }
}

/* ------------------------------ Playback ------------------------------- */

interface Segment {
  a: TraccarPosition;
  b: TraccarPosition;
  /** Start offset on the virtual timeline, in seconds. */
  start: number;
  /** Virtual duration in seconds (long stops are compressed). */
  dur: number;
  /** Real seconds the vehicle stood still here, when this hop is a stop. */
  stopSec?: number;
}

/** A gap of at least this many real seconds counts as the vehicle stopping. */
const STOP_GAP_SEC = 120;
/** How long a real stop is shown on the virtual timeline - a blink, not a wait. */
const STOP_BEAT_SEC = 0.6;
/** A short stand-still (traffic light, queue) is skipped faster still. */
const PAUSE_BEAT_SEC = 0.15;
/** Below this speed a fix counts as standing still. */
const STILL_KMH = 3;
/**
 * A fix this close to where the stand-still began is "the same place". Parked
 * receivers drift 5-30 m between fixes, so anything tighter would read that
 * drift as driving and replay a parked car shuffling on the spot.
 */
const STILL_RADIUS_KM = 0.04;

function standingStill(p: TraccarPosition): boolean {
  return p.attributes?.motion === false || knotsToKmh(p.speed) < STILL_KMH;
}

/**
 * Build a virtual playback timeline from fixes.
 *
 * Driving plays at a quarter of real time. Standing still is skipped: every
 * run of fixes where the car stays in the same place becomes ONE segment with
 * a short fixed beat, and the controls name the real duration instead.
 *
 * Stops used to be recognised only by a silence of 2+ minutes between fixes.
 * But these trackers keep reporting every few seconds while parked, so a
 * parked hour was ~600 tiny "driving" hops of ~1.5 s each - fifteen minutes of
 * watching a car that does not move. Now position and speed decide, not gaps.
 */
function buildTimeline(positions: TraccarPosition[]): {
  segments: Segment[];
  total: number;
  points: TraccarPosition[];
} {
  const pts = [...positions].sort(
    (a, b) => +new Date(a.fixTime) - +new Date(b.fixTime),
  );
  const segments: Segment[] = [];
  let acc = 0;
  const realSec = (a: TraccarPosition, b: TraccarPosition) =>
    (+new Date(b.fixTime) - +new Date(a.fixTime)) / 1000;

  const push = (a: TraccarPosition, b: TraccarPosition, dur: number, stopSec?: number) => {
    segments.push({ a, b, start: acc, dur, stopSec });
    acc += dur;
  };

  let i = 1;
  while (i < pts.length) {
    const prev = pts[i - 1];
    const cur = pts[i];
    const gap = realSec(prev, cur);
    const still =
      gap >= STOP_GAP_SEC ||
      (standingStill(cur) &&
        haversineKm(prev.latitude, prev.longitude, cur.latitude, cur.longitude) <
          STILL_RADIUS_KM);

    if (!still) {
      // Driving hops are compressed to a quarter of real time - these trackers
      // report every ~6-10 s, so true-length replay made a 13-minute trip take
      // 13 minutes.
      push(prev, cur, Math.min(Math.max(gap * 0.25, 0.15), 3));
      i++;
      continue;
    }

    // Swallow the whole stand-still: keep going while the car stays within
    // STILL_RADIUS_KM of where it stopped and is not moving.
    let j = i;
    while (
      j + 1 < pts.length &&
      (realSec(pts[j], pts[j + 1]) >= STOP_GAP_SEC ||
        (standingStill(pts[j + 1]) &&
          haversineKm(prev.latitude, prev.longitude, pts[j + 1].latitude, pts[j + 1].longitude) <
            STILL_RADIUS_KM))
    ) {
      j++;
    }
    const total = realSec(prev, pts[j]);
    if (total >= STOP_GAP_SEC) push(prev, pts[j], STOP_BEAT_SEC, total);
    else push(prev, pts[j], PAUSE_BEAT_SEC);
    i = j + 1;
  }
  return { segments, total: acc, points: pts };
}

function bearingDeg(aLat: number, aLng: number, bLat: number, bLng: number) {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const y = Math.sin(toRad(bLng - aLng)) * Math.cos(toRad(bLat));
  const x =
    Math.cos(toRad(aLat)) * Math.sin(toRad(bLat)) -
    Math.sin(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.cos(toRad(bLng - aLng));
  return (Math.atan2(y, x) * 180) / Math.PI;
}

const PLAYBACK_SPEEDS = [1, 2, 5, 10, 20, 50] as const;
/** The follow camera re-centres at most this often, in milliseconds. */
const FOLLOW_MS = 500;

/**
 * Speed -> colour, shared by the route line, the replay marker and the legend
 * so they always agree. Slate = crawling/stopped, then green -> amber -> red.
 */
const SPEED_STOPS: [number, string][] = [
  [0, "#94a3b8"],
  [10, "#22c55e"],
  [50, "#eab308"],
  [80, "#f97316"],
  [110, "#ef4444"],
  [140, "#991b1b"],
];
const SPEED_MAX = SPEED_STOPS[SPEED_STOPS.length - 1][0];

function speedColor(kmh: number): string {
  const v = Math.max(0, Math.min(kmh, SPEED_MAX));
  for (let i = 1; i < SPEED_STOPS.length; i++) {
    const [v1, c1] = SPEED_STOPS[i];
    if (v <= v1) {
      const [v0, c0] = SPEED_STOPS[i - 1];
      const f = v1 > v0 ? (v - v0) / (v1 - v0) : 0;
      const ch = (c: string, o: number) => parseInt(c.slice(o, o + 2), 16);
      const mix = (o: number) => Math.round(ch(c0, o) + (ch(c1, o) - ch(c0, o)) * f);
      return `rgb(${mix(1)},${mix(3)},${mix(5)})`;
    }
  }
  return SPEED_STOPS[SPEED_STOPS.length - 1][1];
}

/** The same ramp as a MapLibre expression on the segment's `kmh` property. */
const SPEED_EXPR = [
  "interpolate",
  ["linear"],
  ["get", "kmh"],
  ...SPEED_STOPS.flat(),
] as unknown as maplibregl.ExpressionSpecification;

/** Line width follows zoom so the route stays crisp far out and close in. */
const LINE_WIDTH = [
  "interpolate", ["linear"], ["zoom"], 8, 2.5, 13, 5, 17, 8,
] as unknown as maplibregl.ExpressionSpecification;
const CASING_WIDTH = [
  "interpolate", ["linear"], ["zoom"], 8, 5, 13, 8, 17, 11.5,
] as unknown as maplibregl.ExpressionSpecification;

/** A silence this long, over this distance, is a coverage gap - not driving. */
const GAP_SEC = 300;
const GAP_KM = 0.3;
/** A hop implying more than this is a GPS jump, not a vehicle. */
const MAX_PLAUSIBLE_KMH = 220;
/** Larger than any real segment index: "everything has been travelled". */
const ALL_DONE = Number.MAX_SAFE_INTEGER;

interface RouteData {
  /** One 2-point line per driven hop, tagged with its index `k` and speed. */
  seg: { type: "FeatureCollection"; features: unknown[] };
  /** Hops across a coverage gap, drawn dashed instead of as driving. */
  gap: { type: "FeatureCollection"; features: unknown[] };
  /** Driven kilometres up to each fix (parked jitter is not counted). */
  cumKm: number[];
  totalKm: number;
  indexOf: Map<TraccarPosition, number>;
}

function buildRouteData(pts: TraccarPosition[]): RouteData {
  const seg: unknown[] = [];
  const gap: unknown[] = [];
  const cumKm = [0];
  const indexOf = new Map<TraccarPosition, number>();
  pts.forEach((p, i) => indexOf.set(p, i));
  for (let k = 1; k < pts.length; k++) {
    const a = pts[k - 1];
    const b = pts[k];
    const dKm = haversineKm(a.latitude, a.longitude, b.latitude, b.longitude);
    const dt = (+new Date(b.fixTime) - +new Date(a.fixTime)) / 1000;
    const isGap = dt >= GAP_SEC && dKm >= GAP_KM;
    const plausible = dt > 0 && dKm / (dt / 3600) <= MAX_PLAUSIBLE_KMH;
    const still = standingStill(b) && dKm < STILL_RADIUS_KM;
    // Parked GPS drift is 5-30 m a fix; drawing or summing it would paint a
    // dense blob on the spot and inflate the distance.
    const counted = !isGap && plausible && !still;
    cumKm.push(cumKm[k - 1] + (counted ? dKm : 0));
    if (still && !isGap) continue;
    const feature = {
      type: "Feature",
      geometry: {
        type: "LineString",
        coordinates: [
          [a.longitude, a.latitude],
          [b.longitude, b.latitude],
        ],
      },
      properties: { k, kmh: Math.round(knotsToKmh(b.speed)) },
    };
    (isGap ? gap : seg).push(feature);
  }
  return {
    seg: { type: "FeatureCollection", features: seg },
    gap: { type: "FeatureCollection", features: gap },
    cumKm,
    totalKm: cumKm[cumKm.length - 1],
    indexOf,
  };
}

/**
 * Split the route at fix index `k`: travelled part bright, the rest dimmed.
 * A filter change repaints without re-uploading any geometry, which is what
 * keeps a 40,000-fix replay smooth.
 */
function setProgress(map: maplibregl.Map, k: number) {
  if (map.getLayer("route-done")) {
    map.setFilter("route-done", ["<=", ["get", "k"], k] as unknown as maplibregl.FilterSpecification);
  }
  if (map.getLayer("route-todo")) {
    map.setFilter("route-todo", [">", ["get", "k"], k] as unknown as maplibregl.FilterSpecification);
  }
}

/**
 * The direction chevron. The raster style has no `glyphs` endpoint so a text
 * symbol would render nothing; an image drawn here works with no font stack
 * and, as a symbol layer, thins out and thickens with zoom by itself.
 */
function ensureArrowImage(map: maplibregl.Map) {
  if (map.hasImage("carva-arrow")) return;
  const size = 48;
  const c = document.createElement("canvas");
  c.width = size;
  c.height = size;
  const g = c.getContext("2d");
  if (!g) return;
  // Points right: along a line, an icon's +x follows the direction of travel.
  g.beginPath();
  g.moveTo(10, 10);
  g.lineTo(38, 24);
  g.lineTo(10, 38);
  g.lineTo(18, 24);
  g.closePath();
  g.lineJoin = "round";
  g.lineWidth = 4;
  g.strokeStyle = "rgba(15,23,42,0.85)";
  g.stroke();
  g.fillStyle = "#ffffff";
  g.fill();
  map.addImage("carva-arrow", g.getImageData(0, 0, size, size), { pixelRatio: 2 });
}

/** The replay marker: speed-coloured dot with a heading wedge and a speed pill. */
function carMarkerElement(): {
  el: HTMLDivElement;
  dot: HTMLDivElement;
  head: HTMLDivElement;
  halo: HTMLDivElement;
  pill: HTMLDivElement;
} {
  const el = document.createElement("div");
  // No `position` here: MapLibre owns it (absolute + transform). Overriding it
  // makes the marker drift while zooming. Absolute children still anchor to it.
  el.style.cssText = "width:28px;height:28px;";
  const halo = document.createElement("div");
  halo.className = "rt-halo";
  const dot = document.createElement("div");
  dot.style.cssText =
    "position:absolute;inset:0;border-radius:50%;background:#2563eb;border:3px solid #fff;box-shadow:0 2px 8px rgba(0,0,0,.45);display:flex;align-items:center;justify-content:center;transition:background-color .25s;";
  const head = document.createElement("div");
  head.style.cssText =
    "width:0;height:0;border-left:5px solid transparent;border-right:5px solid transparent;border-bottom:10px solid #fff;transform-origin:50% 60%;";
  dot.appendChild(head);
  const pill = document.createElement("div");
  pill.style.cssText =
    "position:absolute;bottom:calc(100% + 8px);left:50%;transform:translateX(-50%);white-space:nowrap;padding:2px 8px;border-radius:9999px;background:rgba(15,23,42,.9);color:#fff;font:600 11px/1.5 system-ui,sans-serif;box-shadow:0 2px 6px rgba(0,0,0,.35);pointer-events:none;font-variant-numeric:tabular-nums;";
  el.append(halo, dot, pill);
  return { el, dot, head, halo, pill };
}

/** Round start / end badges, so the ends of the route are unmistakable. */
function endpointElement(kind: "start" | "end", label: string): HTMLDivElement {
  const el = document.createElement("div");
  el.setAttribute("aria-label", label);
  const bg = kind === "start" ? "#16a34a" : "#dc2626";
  el.style.cssText = `width:28px;height:28px;border-radius:9999px;background:${bg};border:3px solid #fff;box-shadow:0 2px 8px rgba(15,23,42,.5);display:grid;place-items:center;cursor:pointer;`;
  el.innerHTML =
    kind === "start"
      ? '<svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><path d="M3 1.5v9l7.5-4.5z" fill="#fff"/></svg>'
      : '<svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><rect x="2" y="2" width="8" height="8" rx="1.5" fill="#fff"/></svg>';
  return el;
}

/** Stops shorter than this get no parking pin on the map. */
const MIN_STOP_PIN_MS = 5 * 60_000;

/** "52m" / "1h 05m" - short enough to sit beside a map pin. */
function fmtShort(ms: number): string {
  const mins = Math.max(1, Math.round(ms / 60000));
  return mins >= 60 ? `${Math.floor(mins / 60)}h ${String(mins % 60).padStart(2, "0")}m` : `${mins}m`;
}

/** Amber "P" pin at every stop, labelled with how long the car stood there. */
function stopElement(label: string, durationMs?: number): HTMLDivElement {
  const el = document.createElement("div");
  const inner = document.createElement("div");
  inner.setAttribute("aria-label", label);
  // Fades out when the map is zoomed far out (see .rt-fade in fleet.css).
  inner.className = "rt-fade";
  inner.style.cssText =
    "width:22px;height:22px;border-radius:9999px;background:#f59e0b;border:2px solid #fff;box-shadow:0 1px 5px rgba(15,23,42,.45);display:grid;place-items:center;color:#fff;font:700 11px/1 system-ui,sans-serif;cursor:pointer;";
  inner.textContent = "P";
  el.appendChild(inner);
  if (durationMs && durationMs >= 60_000) {
    const pill = document.createElement("div");
    pill.className = "rt-label rt-fade";
    pill.textContent = fmtShort(durationMs);
    pill.style.cssText =
      "position:absolute;left:100%;top:50%;transform:translateY(-50%);margin-left:5px;white-space:nowrap;padding:1px 6px;border-radius:9999px;background:rgba(15,23,42,.88);color:#fde68a;font:600 10px/1.6 system-ui,sans-serif;pointer-events:none;";
    el.appendChild(pill);
  }
  return el;
}

function stopPopupHtml(s: TraccarStop, t: (key: string) => string): string {
  const rows = [
    `<div style="font-weight:600;margin-bottom:2px">${esc(t("hist.stop"))}</div>`,
    `<div>${esc(t("hist.parked").replace("{dur}", fmtDuration(num(s.duration) ?? 0, t)))}</div>`,
    `<div style="${POPUP_DIM}">${esc(t("hist.arrived"))} ${esc(fmtStamp(s.startTime))}</div>`,
  ];
  if (s.endTime) {
    rows.push(
      `<div style="${POPUP_DIM}">${esc(t("hist.departed"))} ${esc(fmtStamp(s.endTime))}</div>`,
    );
  }
  if (s.address) {
    rows.push(`<div style="margin-top:3px;${POPUP_DIM}">${esc(s.address)}</div>`);
  }
  return `<div style="${POPUP_CSS}">${rows.join("")}</div>`;
}

function stopLngLat(s: TraccarStop): [number, number] | null {
  const lat = num(s.lat) ?? num(s.latitude);
  const lng = num(s.lon) ?? num(s.longitude);
  return lat != null && lng != null ? [lng, lat] : null;
}

/** Anchor a popup on the fix itself rather than on the cursor. */
function featureLngLat(
  feature: maplibregl.MapGeoJSONFeature,
): [number, number] | null {
  if (feature.geometry.type !== "Point") return null;
  const [lng, lat] = feature.geometry.coordinates;
  return [lng, lat];
}

/** Route line + stops + direction arrows + animated playback on a maplibre map. */
function RouteMap({
  positions,
  stops,
  onPrevTrip,
  onNextTrip,
  hasPrevTrip = false,
  hasNextTrip = false,
}: {
  positions: TraccarPosition[];
  stops: TraccarStop[];
  /** Step to the previous/next detected trip. Omitted = jump to start/end. */
  onPrevTrip?: () => void;
  onNextTrip?: () => void;
  hasPrevTrip?: boolean;
  hasNextTrip?: boolean;
}) {
  const { t } = useI18n();
  // Map event handlers outlive a language switch, so they read `t` from a ref.
  const tRef = React.useRef(t);
  tRef.current = t;

  const containerRef = React.useRef<HTMLDivElement>(null);
  const mapRef = React.useRef<maplibregl.Map | null>(null);

  // Full screen covers the map AND the playback controls, so play, speed and
  // the scrubber stay usable. The panel is pinned over the page with CSS
  // first, then the browser's real fullscreen is requested on top to hide its
  // chrome where allowed. iPhone Safari has no element fullscreen at all, so
  // the CSS half alone is what makes it work there.
  const shellRef = React.useRef<HTMLDivElement>(null);
  const [fullscreen, setFullscreen] = React.useState(false);
  const toggleFullscreen = React.useCallback(() => {
    setFullscreen((on) => {
      if (on) {
        if (document.fullscreenElement) void document.exitFullscreen?.().catch(() => {});
      } else {
        void shellRef.current?.requestFullscreen?.().catch(() => {});
      }
      return !on;
    });
  }, []);
  React.useEffect(() => {
    // Esc (or the browser's own exit) leaves real fullscreen without telling
    // us - follow it so the CSS overlay does not stay stuck on screen.
    const onChange = () => {
      if (!document.fullscreenElement) setFullscreen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setFullscreen(false);
    };
    document.addEventListener("fullscreenchange", onChange);
    window.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("fullscreenchange", onChange);
      window.removeEventListener("keydown", onKey);
    };
  }, []);
  React.useEffect(() => {
    // The canvas only learns its new size when told.
    const id = requestAnimationFrame(() => mapRef.current?.resize());
    const late = window.setTimeout(() => mapRef.current?.resize(), 250);
    return () => {
      cancelAnimationFrame(id);
      window.clearTimeout(late);
    };
  }, [fullscreen]);
  const markersRef = React.useRef<maplibregl.Marker[]>([]);
  const stopMarkersRef = React.useRef<maplibregl.Marker[]>([]);
  const hoverPopupRef = React.useRef<maplibregl.Popup | null>(null);
  const pointPopupRef = React.useRef<maplibregl.Popup | null>(null);
  const [ready, setReady] = React.useState(false);

  // Basemap choice is shared with the live map (Settings writes the same key).
  const [basemap, setBasemapState] = React.useState<Basemap>("streets");
  React.useEffect(() => {
    const saved = localStorage.getItem("carva-basemap");
    if (saved === "satellite") setBasemapState(saved);
  }, []);
  const setBasemap = React.useCallback((next: Basemap) => {
    setBasemapState(next);
    localStorage.setItem("carva-basemap", next);
  }, []);

  // Playback state. The clock lives in a ref (updated per animation frame);
  // React state only carries the throttled UI mirror.
  const timeline = React.useMemo(() => buildTimeline(positions), [positions]);
  const route = React.useMemo(() => {
    const r = buildRouteData(timeline.points);
    // The summary card above the map uses routeStats(); scale the running
    // total to it so "x / y km" ends on the very same number.
    const refKm = routeStats(timeline.points).distanceM / 1000;
    if (r.totalKm > 0 && refKm > 0) {
      const k = refKm / r.totalKm;
      r.cumKm = r.cumKm.map((v) => v * k);
      r.totalKm = refKm;
    }
    return r;
  }, [timeline]);
  const clockRef = React.useRef(0);
  const rafRef = React.useRef<number | null>(null);
  const lastTsRef = React.useRef<number | null>(null);
  const lastUiRef = React.useRef(0);
  const lastFollowRef = React.useRef(0);
  const playMarkerRef = React.useRef<maplibregl.Marker | null>(null);
  const carRef = React.useRef<ReturnType<typeof carMarkerElement> | null>(null);
  const lastPillRef = React.useRef("");
  const lastDoneRef = React.useRef(ALL_DONE);
  const lastFilterRef = React.useRef(0);
  const [playing, setPlaying] = React.useState(false);
  const [speed, setSpeed] = React.useState<(typeof PLAYBACK_SPEEDS)[number]>(10);
  const speedRef = React.useRef(speed);
  speedRef.current = speed;
  // Follow camera keeps the playback marker centred; on by default.
  const [follow, setFollow] = React.useState(true);
  const followRef = React.useRef(follow);
  followRef.current = follow;
  const [ui, setUi] = React.useState<{
    progress: number;
    time: string;
    kmh: number;
    /** Real seconds parked, when the replay is sitting inside a stop. */
    stopSec: number | null;
    /** Driven kilometres so far. */
    distKm: number;
  }>({ progress: 0, time: "", kmh: 0, stopSec: null, distKm: 0 });

  /** Move the playback marker + traveled line to virtual time `sec`. */
  const renderAt = React.useCallback(
    (sec: number, forceUi = false) => {
      const map = mapRef.current;
      const { segments, total, points } = timeline;
      if (!map || segments.length === 0) return;

      const clamped = Math.max(0, Math.min(sec, total));
      // Find the active segment (linear scan is fine at this scale).
      let seg = segments[segments.length - 1];
      for (const s of segments) {
        if (clamped <= s.start + s.dur) {
          seg = s;
          break;
        }
      }
      const f = seg.dur > 0 ? Math.min(1, Math.max(0, (clamped - seg.start) / seg.dur)) : 1;
      const lat = seg.a.latitude + (seg.b.latitude - seg.a.latitude) * f;
      const lng = seg.a.longitude + (seg.b.longitude - seg.a.longitude) * f;

      const ai = route.indexOf.get(seg.a) ?? 0;
      const bi = route.indexOf.get(seg.b) ?? ai;
      const kmhNow = seg.stopSec != null ? 0 : knotsToKmh(seg.b.speed);

      // Replay marker: coloured by speed, pointing where the car is heading,
      // with the speed itself floating above it.
      if (!carRef.current) {
        const car = carMarkerElement();
        carRef.current = car;
        playMarkerRef.current = new maplibregl.Marker({ element: car.el })
          .setLngLat([lng, lat])
          .addTo(map);
      } else {
        playMarkerRef.current?.setLngLat([lng, lat]);
      }
      const car = carRef.current as NonNullable<typeof carRef.current>;
      const brg = bearingDeg(seg.a.latitude, seg.a.longitude, seg.b.latitude, seg.b.longitude);
      car.head.style.transform = `rotate(${brg}deg)`;
      const color = speedColor(kmhNow);
      car.dot.style.backgroundColor = color;
      car.halo.style.color = color;
      const pillText =
        seg.stopSec != null
          ? `P · ${fmtShort(seg.stopSec * 1000)}`
          : `${Math.round(kmhNow)} ${tRef.current("dash.kph")}`;
      if (pillText !== lastPillRef.current) {
        lastPillRef.current = pillText;
        car.pill.textContent = pillText;
      }

      const nowMs = performance.now();

      // Travelled part of the route stays bright, the rest dims. Throttled:
      // the filter only needs to move when the playhead crosses a fix.
      const doneK = f >= 1 ? bi : ai;
      if (doneK !== lastDoneRef.current && (forceUi || nowMs - lastFilterRef.current > 50)) {
        lastDoneRef.current = doneK;
        lastFilterRef.current = nowMs;
        setProgress(map, doneK);
      }

      // Follow camera. easeTo is throttled and eased linearly, so the chained
      // moves read as one continuous pan instead of a stutter per frame.
      if (followRef.current && (forceUi || nowMs - lastFollowRef.current > FOLLOW_MS)) {
        lastFollowRef.current = nowMs;
        map.easeTo({
          center: [lng, lat],
          duration: forceUi ? 0 : FOLLOW_MS,
          easing: (x) => x,
        });
      }

      // Throttled UI mirror (~5 fps is plenty for text).
      if (forceUi || nowMs - lastUiRef.current > 200) {
        lastUiRef.current = nowMs;
        const atTime = new Date(
          +new Date(seg.a.fixTime) +
            (+new Date(seg.b.fixTime) - +new Date(seg.a.fixTime)) * f,
        );
        setUi({
          progress: total > 0 ? clamped / total : 0,
          time: atTime.toLocaleString("en-GB", {
            timeZone: TZ,
            day: "2-digit",
            month: "short",
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit",
          }),
          kmh: Math.round(kmhNow),
          stopSec: seg.stopSec ?? null,
          distKm: route.cumKm[ai] + (route.cumKm[bi] - route.cumKm[ai]) * f,
        });
      }
    },
    [timeline, route],
  );

  const stop = React.useCallback(() => {
    if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    lastTsRef.current = null;
    setPlaying(false);
  }, []);

  const tick = React.useCallback(
    (ts: number) => {
      const dt = lastTsRef.current == null ? 0 : (ts - lastTsRef.current) / 1000;
      lastTsRef.current = ts;
      clockRef.current += dt * speedRef.current;
      if (clockRef.current >= timeline.total) {
        clockRef.current = timeline.total;
        renderAt(clockRef.current, true);
        stop();
        return;
      }
      renderAt(clockRef.current);
      rafRef.current = requestAnimationFrame(tick);
    },
    [timeline, renderAt, stop],
  );

  function togglePlay() {
    if (playing) {
      stop();
      return;
    }
    if (timeline.segments.length === 0) return;
    if (clockRef.current >= timeline.total) clockRef.current = 0; // replay
    setPlaying(true);
    rafRef.current = requestAnimationFrame(tick);
  }

  function scrub(e: React.ChangeEvent<HTMLInputElement>) {
    const frac = Number(e.target.value) / 1000;
    clockRef.current = frac * timeline.total;
    renderAt(clockRef.current, true);
  }

  /** Jump the playhead to a virtual second (start / end buttons). */
  function jumpTo(sec: number) {
    if (timeline.segments.length === 0) return;
    clockRef.current = Math.max(0, Math.min(sec, timeline.total));
    renderAt(clockRef.current, true);
    if (clockRef.current >= timeline.total) stop(); // nothing left to play
  }

  /** Zoom out to the whole route again (and stop chasing the marker). */
  function fitRoute() {
    const map = mapRef.current;
    if (!map || timeline.points.length === 0) return;
    const b = new maplibregl.LngLatBounds();
    timeline.points.forEach((p) => b.extend([p.longitude, p.latitude]));
    setFollow(false);
    followRef.current = false;
    map.fitBounds(b, { padding: 64, maxZoom: 16, duration: 700 });
  }

  function toggleFollow() {
    const next = !follow;
    setFollow(next);
    followRef.current = next;
    // Snap onto the marker straight away so the toggle feels immediate.
    if (next) renderAt(clockRef.current, true);
  }

  // Reset playback whenever the route changes.
  React.useEffect(() => {
    stop();
    clockRef.current = 0;
    lastFollowRef.current = 0;
    playMarkerRef.current?.remove();
    playMarkerRef.current = null;
    carRef.current = null;
    lastPillRef.current = "";
    hoverPopupRef.current?.remove();
    pointPopupRef.current?.remove();
    setUi({ progress: 0, time: "", kmh: 0, stopSec: null, distKm: 0 });
    // Before a replay starts the whole route reads as travelled (full colour).
    lastDoneRef.current = ALL_DONE;
    const map = mapRef.current;
    if (map) setProgress(map, ALL_DONE);
  }, [positions, stop]);

  // Cancel the animation on unmount.
  React.useEffect(() => () => stop(), [stop]);

  /** Popup body for one recorded fix: local time, speed and coordinates. */
  const pointPopupHtml = React.useCallback(
    (feature: maplibregl.MapGeoJSONFeature): string => {
      const tr = tRef.current;
      const p = feature.properties as {
        time?: string;
        kmh?: number;
        lat?: number;
        lng?: number;
      };
      return [
        `<div style="${POPUP_CSS}">`,
        `<div style="font-weight:600;margin-bottom:2px">${esc(String(p.time ?? ""))}</div>`,
        `<div>${esc(tr("hist.speed"))}: ${Math.round(Number(p.kmh) || 0)} ${esc(tr("dash.kph"))}</div>`,
        `<div style="${POPUP_DIM}">${esc(tr("hist.coords"))}: ${Number(p.lat).toFixed(5)}, ${Number(p.lng).toFixed(5)}</div>`,
        `</div>`,
      ].join("");
    },
    [],
  );

  const onPointHover = React.useCallback(
    (e: maplibregl.MapLayerMouseEvent) => {
      const map = mapRef.current;
      const feature = e.features?.[0];
      const at = feature ? featureLngLat(feature) : null;
      if (!map || !feature || !at) return;
      map.getCanvas().style.cursor = "pointer";
      if (!hoverPopupRef.current) {
        hoverPopupRef.current = new maplibregl.Popup({
          closeButton: false,
          closeOnClick: false,
          offset: 10,
        });
      }
      hoverPopupRef.current
        .setLngLat(at)
        .setHTML(pointPopupHtml(feature))
        .addTo(map);
    },
    [pointPopupHtml],
  );

  const onPointLeave = React.useCallback(() => {
    const map = mapRef.current;
    if (map) map.getCanvas().style.cursor = "";
    hoverPopupRef.current?.remove();
  }, []);

  const onPointClick = React.useCallback(
    (e: maplibregl.MapLayerMouseEvent) => {
      const map = mapRef.current;
      const feature = e.features?.[0];
      const at = feature ? featureLngLat(feature) : null;
      if (!map || !feature || !at) return;
      // closeOnClick would make the pin work on every other click only: the
      // popup registers its own map-level close handler behind this layer
      // handler, so the very click that re-pins it would then close it again.
      // `onMapClick` below does the dismissing instead.
      if (!pointPopupRef.current) {
        pointPopupRef.current = new maplibregl.Popup({
          offset: 10,
          closeOnClick: false,
        });
      }
      pointPopupRef.current
        .setLngLat(at)
        .setHTML(pointPopupHtml(feature))
        .addTo(map);
    },
    [pointPopupHtml],
  );

  /** Click-away dismissal for the pinned popup — anywhere but a route point. */
  const onMapClick = React.useCallback((e: maplibregl.MapMouseEvent) => {
    const map = mapRef.current;
    if (!map || !pointPopupRef.current) return;
    const hit = map.getLayer("route-points")
      ? map.queryRenderedFeatures(e.point, { layers: ["route-points"] })
      : [];
    if (hit.length === 0) pointPopupRef.current.remove();
  }, []);

  React.useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: {
        version: 8,
        sources: {
          carto: {
            type: "raster",
            tiles: STREET_TILES,
            tileSize: 256,
            maxzoom: STREET_MAX_ZOOM,
            attribution: STREET_ATTRIBUTION,
          },
        },
        layers: [{ id: "carto", type: "raster", source: "carto" }],
      },
      // Default view: Erbil, Iraq.
      center: [44.0092, 36.1911],
      zoom: 10,
    });
    map.addControl(
      new maplibregl.NavigationControl({ showCompass: false }),
      "bottom-right",
    );
    // Far out, pin labels would only crowd the route - hide them (see fleet.css).
    // Parking pins fade out gradually between zoom 11.5 and 10 (overview).
    const syncZoomClass = () => {
      const el = containerRef.current;
      if (!el) return;
      const z = map.getZoom();
      el.classList.toggle("rt-lowzoom", z < 12);
      el.classList.toggle("rt-farzoom", z < 10.3);
      el.style.setProperty("--rt-pin", String(Math.max(0, Math.min(1, (z - 10) / 1.5))));
    };
    map.on("zoom", syncZoomClass);
    map.on("load", () => {
      syncZoomClass();
      setReady(true);
    });
    mapRef.current = map;
    // The page gains/loses a scrollbar as stats load, which narrows this box
    // without any window resize event - the canvas must follow.
    const ro = new ResizeObserver(() => map.resize());
    ro.observe(containerRef.current);
    return () => {
      ro.disconnect();
      map.remove();
      mapRef.current = null;
    };
  }, []);

  // Swap basemap tiles (same source, so route layers survive the switch).
  // `ready` is a dependency because the style parses one frame after the map is
  // constructed: on mount `getSource` still returns undefined, so a satellite
  // choice restored from localStorage would silently keep the street tiles.
  React.useEffect(() => {
    const src = mapRef.current?.getSource("carto") as
      | maplibregl.RasterTileSource
      | undefined;
    src?.setTiles(basemap === "satellite" ? SATELLITE_TILES : STREET_TILES);
  }, [basemap, ready]);

  React.useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;

    const pts = timeline.points;
    const coords = pts.map((p) => [p.longitude, p.latitude] as [number, number]);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const line: any = {
      type: "Feature",
      geometry: { type: "LineString", coordinates: coords },
      properties: {},
    };
    // One point feature per fix, carrying what its popup shows.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const pointData: any = {
      type: "FeatureCollection",
      features: pts.map((p) => ({
        type: "Feature",
        geometry: { type: "Point", coordinates: [p.longitude, p.latitude] },
        properties: {
          time: fmtStamp(p.fixTime),
          kmh: Math.round(knotsToKmh(p.speed)),
          lat: p.latitude,
          lng: p.longitude,
        },
      })),
    };

    const src = map.getSource("route") as maplibregl.GeoJSONSource | undefined;
    if (src) {
      src.setData(line);
      (map.getSource("route-seg") as maplibregl.GeoJSONSource | undefined)?.setData(
        route.seg as never,
      );
      (map.getSource("route-gap") as maplibregl.GeoJSONSource | undefined)?.setData(
        route.gap as never,
      );
      (map.getSource("route-points") as maplibregl.GeoJSONSource | undefined)?.setData(
        pointData,
      );
    } else {
      ensureArrowImage(map);
      map.addSource("route", { type: "geojson", data: line });
      map.addSource("route-seg", { type: "geojson", data: route.seg as never });
      map.addSource("route-gap", { type: "geojson", data: route.gap as never });
      map.addSource("route-points", { type: "geojson", data: pointData });

      // A pale outline under everything lifts the route off any basemap.
      map.addLayer({
        id: "route-casing",
        type: "line",
        source: "route-seg",
        layout: { "line-cap": "round", "line-join": "round" },
        paint: { "line-color": "#ffffff", "line-opacity": 0.92, "line-width": CASING_WIDTH },
      });
      // Coverage gaps: where the tracker said nothing, shown dashed.
      map.addLayer({
        id: "route-gap",
        type: "line",
        source: "route-gap",
        layout: { "line-cap": "butt" },
        paint: {
          "line-color": "#64748b",
          "line-width": 2.5,
          "line-dasharray": [1.5, 1.5],
          "line-opacity": 0.9,
        },
      });
      // Not yet travelled: dimmed. Travelled: full colour. Same data, two filters.
      map.addLayer({
        id: "route-todo",
        type: "line",
        source: "route-seg",
        filter: [">", ["get", "k"], ALL_DONE] as unknown as maplibregl.FilterSpecification,
        layout: { "line-cap": "round", "line-join": "round" },
        paint: { "line-color": SPEED_EXPR, "line-width": LINE_WIDTH, "line-opacity": 0.3 },
      });
      map.addLayer({
        id: "route-done",
        type: "line",
        source: "route-seg",
        filter: ["<=", ["get", "k"], ALL_DONE] as unknown as maplibregl.FilterSpecification,
        layout: { "line-cap": "round", "line-join": "round" },
        paint: { "line-color": SPEED_EXPR, "line-width": LINE_WIDTH, "line-opacity": 1 },
      });
      // Direction chevrons: spacing adapts to zoom, so the road is never
      // buried in arrows far out nor left bare close in.
      map.addLayer({
        id: "route-arrows",
        type: "symbol",
        source: "route",
        layout: {
          "symbol-placement": "line",
          "symbol-spacing": ["interpolate", ["linear"], ["zoom"], 9, 160, 17, 90],
          "icon-image": "carva-arrow",
          "icon-size": ["interpolate", ["linear"], ["zoom"], 9, 0.4, 17, 0.7],
          "icon-rotation-alignment": "map",
          "icon-allow-overlap": true,
          "icon-ignore-placement": true,
        },
      });
      // Hover/click targets for the individual fixes - only close in, where
      // they are separable (and it keeps tens of thousands of dots off the map).
      map.addLayer({
        id: "route-points",
        type: "circle",
        source: "route-points",
        minzoom: 12.5,
        paint: {
          "circle-radius": ["interpolate", ["linear"], ["zoom"], 12.5, 2.5, 17, 5.5],
          "circle-color": SPEED_EXPR,
          "circle-opacity": 0.9,
          "circle-stroke-width": 1,
          "circle-stroke-color": "#ffffff",
        },
      });
      map.on("mousemove", "route-points", onPointHover);
      map.on("mouseleave", "route-points", onPointLeave);
      map.on("click", "route-points", onPointClick);
      // Registered after the layer handler so a click on a point pins its popup
      // first and this one then sees the hit and leaves it alone.
      map.on("click", onMapClick);
    }
    lastDoneRef.current = ALL_DONE;
    setProgress(map, ALL_DONE);

    markersRef.current.forEach((m) => m.remove());
    markersRef.current = [];
    if (pts.length > 0) {
      const tr = tRef.current;
      const ends: [("start" | "end"), TraccarPosition][] = [
        ["start", pts[0]],
        ["end", pts[pts.length - 1]],
      ];
      for (const [kind, p] of ends) {
        const popup = new maplibregl.Popup({ offset: 18 }).setHTML(
          `<div style="${POPUP_CSS}"><div style="font-weight:600;margin-bottom:2px">${esc(tr(kind === "start" ? "hist.start" : "hist.end"))}</div><div style="${POPUP_DIM}">${esc(fmtStamp(p.fixTime))}</div></div>`,
        );
        markersRef.current.push(
          new maplibregl.Marker({
            element: endpointElement(kind, tr(kind === "start" ? "hist.start" : "hist.end")),
          })
            .setLngLat([p.longitude, p.latitude])
            .setPopup(popup)
            .addTo(map),
        );
      }
      const b = new maplibregl.LngLatBounds();
      coords.forEach((c) => b.extend(c));
      map.fitBounds(b, { padding: 56, maxZoom: 16, duration: 0 });
    }
  }, [timeline, route, ready, onPointHover, onPointLeave, onPointClick, onMapClick]);

  // Stop markers with an arrival / duration popup.
  React.useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    stopMarkersRef.current.forEach((m) => m.remove());
    stopMarkersRef.current = [];
    for (const s of stops) {
      // A few minutes at a shop or in traffic is not worth a pin.
      if ((num(s.duration) ?? 0) < MIN_STOP_PIN_MS) continue;
      const at = stopLngLat(s);
      if (!at) continue;
      stopMarkersRef.current.push(
        new maplibregl.Marker({ element: stopElement(t("hist.stop"), num(s.duration)) })
          .setLngLat(at)
          .setPopup(
            new maplibregl.Popup({ offset: 16 }).setHTML(stopPopupHtml(s, t)),
          )
          .addTo(map),
      );
    }
  }, [stops, ready, t]);

  const hasRoute = timeline.segments.length > 0;

  return (
    <div
      ref={shellRef}
      className={cn(
        "overflow-hidden",
        fullscreen
          ? "fixed inset-0 z-[70] flex flex-col bg-background"
          : "rounded-xl border",
      )}
    >
      <div className={cn("relative", fullscreen && "min-h-0 flex-1")}>
        <div
          ref={containerRef}
          className={cn(
            "w-full bg-muted",
            fullscreen ? "h-full" : "h-[420px] sm:h-[480px]",
          )}
        />

        {/* Basemap switch, mirroring the live map's control. */}
        <div
          role="group"
          aria-label={t("hist.basemap")}
          className="absolute end-3 top-3 z-10 flex overflow-hidden rounded-lg border bg-background shadow-sm"
        >
          {(["streets", "satellite"] as Basemap[]).map((b) => (
            <button
              key={b}
              type="button"
              onClick={() => setBasemap(b)}
              className={cn(
                "px-3 py-1.5 text-xs font-medium transition-colors",
                basemap === b
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:bg-accent hover:text-foreground",
              )}
            >
              {t(`ctrl.${b}`)}
            </button>
          ))}
        </div>

        <button
          type="button"
          onClick={toggleFullscreen}
          title={t(fullscreen ? "hist.exitFullscreen" : "hist.fullscreen")}
          aria-label={t(fullscreen ? "hist.exitFullscreen" : "hist.fullscreen")}
          aria-pressed={fullscreen}
          className="absolute start-3 top-3 z-10 flex h-8 items-center gap-1.5 rounded-lg border bg-background px-2.5 text-xs font-medium text-foreground shadow-sm transition-colors hover:bg-accent"
        >
          {fullscreen ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
          <span className="hidden sm:inline">
            {t(fullscreen ? "hist.exitFullscreen" : "hist.fullscreen")}
          </span>
        </button>

        {hasRoute && (
          <button
            type="button"
            onClick={fitRoute}
            title={t("hist.fit")}
            aria-label={t("hist.fit")}
            className="absolute start-3 top-12 z-10 flex h-8 items-center gap-1.5 rounded-lg border bg-background px-2.5 text-xs font-medium text-foreground shadow-sm transition-colors hover:bg-accent"
          >
            <Scan className="h-4 w-4" />
            <span className="hidden sm:inline">{t("hist.fit")}</span>
          </button>
        )}

        {/* Live readout while the replay runs: the numbers the marker pill is
            too small to carry. */}
        {hasRoute && ui.time && (
          <div
            dir="ltr"
            className="pointer-events-none absolute inset-x-0 top-3 z-10 flex justify-center px-14 sm:px-0"
          >
            <div className="glass flex items-center gap-3 rounded-2xl px-4 py-2 text-xs shadow-sm sm:gap-5">
              <div className="flex items-baseline gap-1">
                <span
                  className="num text-2xl font-semibold leading-none tabular-nums"
                  style={{ color: speedColor(ui.kmh) }}
                >
                  {ui.kmh}
                </span>
                <span className="text-muted-foreground">{t("dash.kph")}</span>
              </div>
              <div className="h-6 w-px bg-border" />
              <div className="tabular-nums">
                <div className="font-medium text-foreground">
                  {ui.distKm.toFixed(1)}
                  <span className="text-muted-foreground"> / {route.totalKm.toFixed(1)} km</span>
                </div>
                <div className="text-[11px] text-muted-foreground">{t("hist.travelled")}</div>
              </div>
              <div className="hidden h-6 w-px bg-border sm:block" />
              <div className="hidden font-medium tabular-nums text-foreground sm:block">{ui.time}</div>
            </div>
          </div>
        )}

        {/* Speed legend - the colours on the route mean something. */}
        {hasRoute && (
          <div
            dir="ltr"
            className="pointer-events-none absolute bottom-7 start-3 z-10 rounded-xl border bg-background/90 px-3 py-2 shadow-sm backdrop-blur"
          >
            <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
              {t("hist.speedScale")} · {t("dash.kph")}
            </div>
            <div
              className="h-2 w-36 rounded-full"
              style={{
                background: `linear-gradient(to right, ${SPEED_STOPS.map(
                  ([v, c]) => `${c} ${(v / SPEED_MAX) * 100}%`,
                ).join(", ")})`,
              }}
            />
            <div className="mt-0.5 flex w-36 justify-between text-[10px] tabular-nums text-muted-foreground">
              <span>0</span>
              <span>50</span>
              <span>100</span>
              <span>{SPEED_MAX}+</span>
            </div>
          </div>
        )}
      </div>

      {hasRoute && (
        <div
          className={cn(
            "flex flex-col gap-2 border-t bg-card px-3 py-3 sm:px-4",
            fullscreen && "pb-[max(0.75rem,env(safe-area-inset-bottom))]",
          )}
        >
          {/* Transport controls stay left-to-right in every language, the way
              media players do. */}
          <div className="flex flex-wrap items-center gap-2">
            <div dir="ltr" className="flex items-center gap-1">
              <Button
                size="sm"
                variant="outline"
                className="h-8 w-8 p-0"
                onClick={() => (onPrevTrip ? onPrevTrip() : jumpTo(0))}
                disabled={onPrevTrip ? !hasPrevTrip : false}
                title={t(onPrevTrip ? "hist.prevTrip" : "hist.jumpStart")}
                aria-label={t(onPrevTrip ? "hist.prevTrip" : "hist.jumpStart")}
              >
                <SkipBack className="h-4 w-4" />
              </Button>
              <Button
                size="sm"
                onClick={togglePlay}
                className="h-8 min-w-[92px] gap-1.5"
              >
                {playing ? (
                  <Pause className="h-4 w-4" />
                ) : (
                  <Play className="h-4 w-4" />
                )}
                {playing ? t("hist.pause") : t("hist.play")}
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="h-8 w-8 p-0"
                onClick={() => (onNextTrip ? onNextTrip() : jumpTo(timeline.total))}
                disabled={onNextTrip ? !hasNextTrip : false}
                title={t(onNextTrip ? "hist.nextTrip" : "hist.jumpEnd")}
                aria-label={t(onNextTrip ? "hist.nextTrip" : "hist.jumpEnd")}
              >
                <SkipForward className="h-4 w-4" />
              </Button>
            </div>

            <input
              type="range"
              min={0}
              max={1000}
              value={Math.round(ui.progress * 1000)}
              onChange={scrub}
              aria-label={t("hist.playback")}
              className="h-2 min-w-[140px] flex-1 cursor-pointer accent-primary"
            />
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div
              role="group"
              aria-label={t("hist.rate")}
              className="flex items-center gap-1"
            >
              {PLAYBACK_SPEEDS.map((s) => (
                <Button
                  key={s}
                  size="sm"
                  variant={speed === s ? "default" : "outline"}
                  className="h-7 px-2 text-xs"
                  onClick={() => setSpeed(s)}
                >
                  {s}×
                </Button>
              ))}
            </div>

            <Button
              size="sm"
              variant={follow ? "default" : "outline"}
              className="h-7 gap-1.5 px-2 text-xs"
              onClick={toggleFollow}
              aria-pressed={follow}
              title={t("hist.followHint")}
            >
              <Crosshair className="h-4 w-4" />
              {t("hist.follow")}
            </Button>

            <div className="ms-auto min-w-[150px] text-end text-xs tabular-nums text-muted-foreground">
              {ui.time ? (
                <>
                  <span className="font-medium text-foreground">{ui.time}</span>
                  {" · "}
                  {ui.stopSec != null ? (
                    <span className="font-medium text-amber-600 dark:text-amber-400">
                      {t("hist.stopped")} {fmtDuration(ui.stopSec * 1000, t)}
                    </span>
                  ) : (
                    <>
                      {ui.kmh} {t("dash.kph")}
                    </>
                  )}
                </>
              ) : (
                t("hist.pressPlay")
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ------------------------------ Trip picker ----------------------------- */

/** Chips for the trips Traccar detected in the range; null = the whole range. */
function TripPicker({
  trips,
  positions,
  selected,
  onSelect,
}: {
  trips: TraccarTrip[];
  /** The loaded route; each chip's distance is measured from it. */
  positions: TraccarPosition[];
  selected: number | null;
  onSelect: (index: number | null) => void;
}) {
  const { t } = useI18n();
  // Traccar's own trip distance comes from a counter that runs backwards when
  // buffered fixes arrive late (chips read "-41.2 km"); measure the route.
  const distances = React.useMemo(
    () =>
      trips.map((trip) =>
        positions.length > 1
          ? routeStats(positions, { from: trip.startTime, to: trip.endTime }).distanceM
          : Math.max(0, num(trip.distance) ?? 0),
      ),
    [trips, positions],
  );
  return (
    <Card className="mb-4">
      <CardContent className="flex flex-col gap-2 p-4">
        <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
          <Route className="h-4 w-4" />
          {t("hist.trips")}
          <span className="tabular-nums">({trips.length})</span>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <Button
            size="sm"
            variant={selected == null ? "default" : "outline"}
            onClick={() => onSelect(null)}
          >
            {t("hist.allDay")}
          </Button>
          {trips.map((trip, i) => (
            <Button
              key={`${trip.startTime}-${i}`}
              size="sm"
              variant={selected === i ? "default" : "outline"}
              onClick={() => onSelect(i)}
              className="gap-2"
            >
              <span dir="ltr" className="tabular-nums">
                {fmtClock(trip.startTime)}–{fmtClock(trip.endTime)}
              </span>
              <span className="text-xs tabular-nums opacity-75">
                {((distances[i] ?? 0) / 1000).toFixed(1)} km
              </span>
            </Button>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

interface DeepLink {
  device: string;
  from: Date;
  to: Date;
  /** Auto-select the first trip in the window once it loads. */
  selectTrip: boolean;
}

/** Parse ?device=&from=&to=&trip= from the URL (client-only, called once). */
function readDeepLink(): DeepLink | null {
  if (typeof window === "undefined") return null;
  const params = new URLSearchParams(window.location.search);
  const device = params.get("device");
  const fromRaw = params.get("from");
  const toRaw = params.get("to");
  if (!device || !fromRaw || !toRaw) return null;
  const from = new Date(fromRaw);
  const to = new Date(toRaw);
  if (Number.isNaN(+from) || Number.isNaN(+to) || from >= to) return null;
  return { device, from, to, selectTrip: params.get("trip") === "1" };
}

/**
 * The page reads its range from the URL on first render (deep links from
 * Statistics). The server has no URL, so it rendered "Today" while the browser
 * rendered "Custom" — a hydration mismatch (React #418, eight per load) that
 * made React throw the server HTML away and render again. Rendering only after
 * mount means there is exactly one first render, and it sees the real URL.
 */
export default function TripHistoryRoute() {
  const [mounted, setMounted] = React.useState(false);
  React.useEffect(() => setMounted(true), []);
  return mounted ? <TripHistoryPage /> : null;
}

const LAST_VEHICLE_KEY = "carva-history-vehicle";

/** The vehicle picked last time, if this browser remembers one. */
function rememberedVehicle(): string | null {
  try {
    return localStorage.getItem(LAST_VEHICLE_KEY);
  } catch {
    return null;
  }
}

function rememberVehicle(id: string) {
  try {
    localStorage.setItem(LAST_VEHICLE_KEY, id);
  } catch {
    /* private window / blocked storage: just forget it */
  }
}

function TripHistoryPage() {
  const { t } = useI18n();
  const session = useSession();

  const [devices, setDevices] = React.useState<TraccarDevice[]>([]);
  // Deep link from the Statistics page: /fleet/history?device=7&from=<iso>&to=<iso>&trip=1
  // replays exactly one recorded trip. Read once, before state initialises, so
  // the vehicle and range are correct on the very first render.
  const deepLink = React.useRef(readDeepLink()).current;

  const [deviceId, setDeviceId] = React.useState<string>(deepLink?.device ?? "");
  const [period, setPeriod] = React.useState<Period>(deepLink ? "custom" : "today");
  const [customFrom, setCustomFrom] = React.useState(
    deepLink ? toLocalInput(deepLink.from) : "",
  );
  const [customTo, setCustomTo] = React.useState(
    deepLink ? toLocalInput(deepLink.to) : "",
  );
  const [positions, setPositions] = React.useState<TraccarPosition[]>([]);
  const [stops, setStops] = React.useState<TraccarStop[]>([]);
  const [trips, setTrips] = React.useState<TraccarTrip[]>([]);
  // Index into `trips`, or null for the whole range ("All day").
  const [tripIdx, setTripIdx] = React.useState<number | null>(null);
  const [loading, setLoading] = React.useState(false);
  // Stops and trips arrive long after the route (see load()), so they get
  // their own flag rather than holding the whole page in "Loading…".
  const [extrasLoading, setExtrasLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  // fixTime of the newest recorded position for the selected vehicle — used to
  // point the user at the data when the chosen period is empty.
  const [lastFix, setLastFix] = React.useState<string | null>(null);
  // Guards against an older range answering after a newer one.
  const reqRef = React.useRef(0);
  // Set while a deep link still wants its trip focused; consumed by the first
  // load() that settles, so it can never arm itself against a later range.
  const autoTripRef = React.useRef(deepLink?.selectTrip ?? false);
  // The vehicle the data on screen actually belongs to. Custom ranges wait for
  // Apply, but a vehicle change must never leave the previous car's route,
  // stats and trip chips on screen under the new car's name.
  const loadedDeviceRef = React.useRef<string | null>(null);

  // Load the device list once signed in.
  React.useEffect(() => {
    if (!session.authed) return;
    let alive = true;
    fetch("/api/traccar/devices", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : []))
      .then((d: TraccarDevice[]) => {
        if (!alive) return;
        setDevices(d);
        // A deep link already set the vehicle; otherwise reopen the one used
        // last time (if it still exists), else the first.
        const saved = rememberedVehicle();
        const newest = [...d].sort(
          (x, y) => (Date.parse(y.lastUpdate ?? "") || 0) - (Date.parse(x.lastUpdate ?? "") || 0),
        )[0];
        const pick =
          saved && d.some((x) => String(x.id) === saved)
            ? saved
            : newest?.lastUpdate
              ? String(newest.id)
              : null;
        if (d.length > 0) setDeviceId((prev) => prev || pick || String(d[0].id));
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [session.authed]);

  // Track the newest recorded fix for the selected vehicle.
  React.useEffect(() => {
    if (!deviceId) return;
    let alive = true;
    fetch("/api/traccar/positions", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : []))
      .then((all: TraccarPosition[]) => {
        if (!alive) return;
        const mine = all.find((p) => String(p.deviceId) === deviceId);
        setLastFix(mine?.fixTime ?? null);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [deviceId]);

  const load = React.useCallback(
    async (from: Date, to: Date) => {
      if (!deviceId) return;
      const req = ++reqRef.current;
      loadedDeviceRef.current = deviceId;
      setLoading(true);
      setExtrasLoading(true);
      setError(null);
      setTripIdx(null);
      // The previous range's pins and chips must not linger under the new one
      // while its own are still being computed.
      setStops([]);
      setTrips([]);
      const qs = new URLSearchParams({
        deviceId,
        from: from.toISOString(),
        to: to.toISOString(),
      });

      // Traccar's stops and trips reports are by far the slowest part: for a
      // week of a tracker reporting every few seconds, measured 2026-10-14 on
      // the VPS, the route took ~4 s, stops ~19 s and trips ~36 s. They only
      // decorate the replay (pins, trip chips), so they start now, in
      // parallel, and land whenever they land; the route never waits for them.
      // A failure there resolves to an empty list instead of blanking anything.
      void Promise.all([
        fetchReport<TraccarStop>("stops", qs),
        fetchReport<TraccarTrip>("trips", qs),
      ]).then(([stopRows, tripRows]) => {
        if (reqRef.current !== req) return; // superseded by a newer range
        setStops(stopRows);
        setTrips(tripRows);
        // Deep link asked us to focus the trip it linked to. Traccar's trip
        // detector often finds nothing in that exact window, so only select
        // when there is something to select.
        if (autoTripRef.current && tripRows.length > 0) setTripIdx(0);
        // Consumed whether or not any trip matched, so a fruitless deep link
        // never hijacks the next range the user picks.
        autoTripRef.current = false;
        setExtrasLoading(false);
      });

      try {
        const res = await fetch(`/api/traccar/positions?${qs}`, {
          cache: "no-store",
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const route = (await res.json()) as TraccarPosition[];
        if (reqRef.current !== req) return;
        setPositions(route);
      } catch (e) {
        if (reqRef.current !== req) return;
        setError(`${t("hist.loadErr")} ${(e as Error).message}`);
        setPositions([]);
      } finally {
        if (reqRef.current === req) setLoading(false);
      }
    },
    [deviceId, t],
  );

  // A deep-linked range is a custom period, so the preset effect below skips
  // it — load it explicitly, once, as soon as the session is ready.
  const deepLoadedRef = React.useRef(false);
  React.useEffect(() => {
    if (!deepLink || deepLoadedRef.current || !session.authed || !deviceId) return;
    deepLoadedRef.current = true;
    load(deepLink.from, deepLink.to);
  }, [deepLink, session.authed, deviceId, load]);

  // Preset periods load automatically; custom waits for Apply.
  React.useEffect(() => {
    if (!deviceId) return;
    if (period === "custom") {
      // …except when the vehicle changed under an already-loaded custom range:
      // re-run the same range for the new vehicle, or clear the old vehicle's
      // data when the range isn't usable yet (a deep link's own load is still
      // pending while loadedDeviceRef is null, so it is left alone).
      if (loadedDeviceRef.current == null || loadedDeviceRef.current === deviceId) return;
      const from = customFrom ? new Date(customFrom) : null;
      const to = customTo ? new Date(customTo) : null;
      if (from && to && !isNaN(+from) && !isNaN(+to) && from < to) {
        load(from, to);
      } else {
        loadedDeviceRef.current = deviceId;
        autoTripRef.current = false;
        reqRef.current++; // drop any in-flight answer for the previous vehicle
        setPositions([]);
        setStops([]);
        setTrips([]);
        setExtrasLoading(false);
        setTripIdx(null);
        setError(null);
        setLoading(false);
      }
      return;
    }
    const now = new Date();
    const dayStart = new Date(now);
    dayStart.setHours(0, 0, 0, 0);
    if (period === "today") {
      load(dayStart, now);
    } else if (period === "yesterday") {
      const yStart = new Date(dayStart);
      yStart.setDate(yStart.getDate() - 1);
      load(yStart, dayStart);
    } else {
      const start = new Date(dayStart);
      start.setDate(start.getDate() - (period === "week" ? 7 : 30));
      load(start, now);
    }
  }, [deviceId, period, load, customFrom, customTo]);

  /** Jump to the 24 h window around the vehicle's newest recorded fix. */
  function showLastActivity() {
    if (!lastFix) return;
    const end = new Date(+new Date(lastFix) + 60 * 60 * 1000);
    const start = new Date(+new Date(lastFix) - 24 * 60 * 60 * 1000);
    setPeriod("custom");
    setCustomFrom(toLocalInput(start));
    setCustomTo(toLocalInput(end));
    load(start, end);
  }

  function applyCustom(e: React.FormEvent) {
    e.preventDefault();
    const from = customFrom ? new Date(customFrom) : null;
    const to = customTo ? new Date(customTo) : null;
    if (!from || !to || isNaN(+from) || isNaN(+to) || from >= to) {
      setError(t("hist.badRange"));
      return;
    }
    load(from, to);
  }

  // Picking a trip narrows the replay (and its stats) to that trip's window.
  const trip = tripIdx != null ? (trips[tripIdx] ?? null) : null;
  const shown = React.useMemo(() => {
    if (!trip) return positions;
    const a = +new Date(trip.startTime);
    const b = +new Date(trip.endTime);
    return positions.filter((p) => {
      const ts = +new Date(p.fixTime);
      return ts >= a && ts <= b;
    });
  }, [positions, trip]);

  const stats = React.useMemo(() => {
    if (shown.length < 2) return null;
    // Measured from the route itself (lib/route-stats.ts). Traccar's distance
    // counter runs backwards when a tracker uploads buffered fixes late, which
    // made this card under-report a 263 km day as 107 km.
    const r = routeStats(shown);
    return {
      distance: `${(r.distanceM / 1000).toFixed(1)} km`,
      duration: fmtDuration(r.drivingMs, t),
      topSpeed: `${r.topSpeedKmh} ${t("dash.kph")}`,
      points: String(shown.length),
    };
  }, [shown, t]);

  if (!session.loading && !session.authed) {
    return (
      <>
        <PageHeader
        eyebrow={t("fleet.nav.group.analyze")}
        icon={PageIcon} title={t("hist.title")} description={t("hist.desc")} />
        <Card>
          <CardContent className="p-8 text-center text-sm text-muted-foreground">
            {t("hist.signin")}{" "}
            <Link href="/login" className="font-medium text-primary hover:underline">
              {t("nav.signin")}
            </Link>
          </CardContent>
        </Card>
      </>
    );
  }

  return (
    <>
      <PageHeader
        eyebrow={t("fleet.nav.group.analyze")}
        icon={PageIcon} title={t("hist.title")} description={t("hist.desc")} />

      {error && (
        <div className="mb-4 rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-2 text-sm text-destructive">
          {error}
        </div>
      )}

      {/* Controls */}
      <Card className="mb-4">
        <CardContent className="flex flex-col gap-3 p-4 lg:flex-row lg:items-center">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-muted-foreground">
              {t("hist.vehicle")}
            </span>
            <select
              value={deviceId}
              onChange={(e) => {
                setDeviceId(e.target.value);
                rememberVehicle(e.target.value);
              }}
              className="h-9 rounded-md border border-input bg-background px-3 text-sm outline-none focus:border-primary"
            >
              {devices.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
          </div>

          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-sm font-medium text-muted-foreground">
              {t("hist.period")}
            </span>
            {(
              [
                ["today", t("hist.today")],
                ["yesterday", t("hist.yesterday")],
                ["week", t("hist.last7")],
                ["month", t("hist.last30")],
                ["custom", t("hist.custom")],
              ] as [Period, string][]
            ).map(([value, label]) => (
              <Button
                key={value}
                size="sm"
                variant={period === value ? "default" : "outline"}
                onClick={() => setPeriod(value)}
              >
                {label}
              </Button>
            ))}
          </div>

          {period === "custom" && (
            <form
              onSubmit={applyCustom}
              className="flex flex-wrap items-center gap-2"
            >
              <label className="flex items-center gap-1.5 text-sm text-muted-foreground">
                {t("hist.from")}
                <Input
                  type="datetime-local"
                  value={customFrom}
                  onChange={(e) => setCustomFrom(e.target.value)}
                  className="h-9 w-auto"
                />
              </label>
              <label className="flex items-center gap-1.5 text-sm text-muted-foreground">
                {t("hist.to")}
                <Input
                  type="datetime-local"
                  value={customTo}
                  onChange={(e) => setCustomTo(e.target.value)}
                  className="h-9 w-auto"
                />
              </label>
              <Button size="sm" type="submit">
                {t("hist.apply")}
              </Button>
            </form>
          )}
        </CardContent>
      </Card>

      {trips.length > 0 ? (
        <TripPicker
          trips={trips}
          positions={positions}
          selected={tripIdx}
          onSelect={setTripIdx}
        />
      ) : (
        extrasLoading &&
        !loading &&
        positions.length > 0 && (
          <p className="mb-3 flex items-center gap-2 text-sm text-muted-foreground">
            <span className="h-3 w-3 animate-spin rounded-full border-2 border-current border-t-transparent" />
            {t("hist.loadingTrips")}
          </p>
        )
      )}

      {/* Stats */}
      {stats && (
        <div className="stagger mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
          {(
            [
              [t("hist.distance"), stats.distance, Route, true],
              [t("hist.duration"), stats.duration, Timer, false],
              [t("hist.topSpeed"), stats.topSpeed, Gauge, false],
              [t("hist.points"), stats.points, Satellite, false],
            ] as [string, string, LucideIcon, boolean][]
          ).map(([label, value, icon, accent]) => (
            <KpiTile key={label} label={label} value={value} icon={icon} accent={accent} />
          ))}
        </div>
      )}

      {loading && (
        <p className="mb-3 text-sm text-muted-foreground">{t("hist.loading")}</p>
      )}
      {!loading && positions.length === 0 && !error && (
        <div className="mb-4 flex flex-wrap items-center gap-3 rounded-lg border bg-card px-4 py-3">
          <p className="text-sm text-muted-foreground">
            {t("hist.none")}{" "}
            {lastFix &&
              t("hist.noneHint").replace(
                "{date}",
                new Date(lastFix).toLocaleString("en-GB", {
                  timeZone: TZ,
                  day: "2-digit",
                  month: "short",
                  year: "numeric",
                  hour: "2-digit",
                  minute: "2-digit",
                }),
              )}
          </p>
          {lastFix && (
            <Button size="sm" variant="outline" onClick={showLastActivity}>
              {t("hist.showLast")}
            </Button>
          )}
        </div>
      )}

      {/* Prev/Next step through the detected trips. "All day" (tripIdx null)
          counts as the position before the first trip, so Next enters trip 1. */}
      <RouteMap
        positions={shown}
        stops={stops}
        onPrevTrip={
          trips.length > 0
            ? () => setTripIdx((i) => (i == null || i <= 0 ? null : i - 1))
            : undefined
        }
        onNextTrip={
          trips.length > 0
            ? () =>
                setTripIdx((i) =>
                  i == null ? 0 : Math.min(i + 1, trips.length - 1),
                )
            : undefined
        }
        hasPrevTrip={tripIdx != null}
        hasNextTrip={trips.length > 0 && (tripIdx == null || tripIdx < trips.length - 1)}
      />
    </>
  );
}
