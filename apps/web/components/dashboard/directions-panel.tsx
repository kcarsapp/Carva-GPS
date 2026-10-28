"use client";

import * as React from "react";
import {
  ArrowLeft,
  ArrowUp,
  ChevronDown,
  ChevronUp,
  CornerUpLeft,
  CornerUpRight,
  Flag,
  Loader2,
  Maximize,
  MoveUpLeft,
  MoveUpRight,
  Navigation,
  RotateCcw,
  RefreshCw,
  TrendingDown,
  TrendingUp,
  X,
} from "lucide-react";

import { cn } from "@/lib/utils";
import { formatDistance } from "@/lib/format";
import { useI18n } from "@/lib/i18n-provider";
import type { DirectionsResponse, DirectionsStep } from "@/app/api/directions/route";
import type { Vehicle } from "@/mock/types";

export type { DirectionsResponse, DirectionsStep };

/** [lat, lng] */
type Point = [number, number];

/**
 * Re-route once either end has moved this far from the last request. The
 * tracker reports every ~5 s while driving, so this fires on nearly every
 * fix of a moving car while ignoring GPS jitter of a parked one.
 */
const REROUTE_METRES = 25;
/** ...but never more often than this (OSRM's public server asks for <1 req/s). */
const MIN_REROUTE_MS = 4_000;
/** Throttled re-routes are retried on this tick. */
const CHECK_MS = 1_000;
/** Within this many metres of the car, you have reached it. */
const ARRIVED_METRES = 40;
/** Window used to tell whether the gap to the car is closing or growing. */
const TREND_WINDOW_MS = 60_000;
const TREND_MIN_MS = 15_000;

export function metresBetween(a: Point, b: Point): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b[0] - a[0]);
  const dLng = toRad(b[1] - a[1]);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a[0])) * Math.cos(toRad(b[0])) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/**
 * Driving route from `from` to `to`, kept live while either end moves - the
 * point is to drive to a car that may itself be driving. Requests go through
 * /api/directions. Also tracks how the road distance changes over time, which
 * tells the operator whether they are catching up with the car.
 */
export function useDirections(from: Point | null, to: Point | null, active: boolean) {
  const [route, setRoute] = React.useState<DirectionsResponse | null>(null);
  const [routeAt, setRouteAt] = React.useState<number | null>(null);
  const [error, setError] = React.useState<"noRoute" | "failed" | null>(null);
  const [loading, setLoading] = React.useState(false);
  /** Road-distance samples, newest last, for the closing-speed trend. */
  const [samples, setSamples] = React.useState<{ at: number; distance: number }[]>([]);
  const fromRef = React.useRef(from);
  fromRef.current = from;
  const toRef = React.useRef(to);
  toRef.current = to;
  const lastRef = React.useRef<{ from: Point; to: Point; at: number } | null>(null);
  const inFlightRef = React.useRef(false);

  const fetchRoute = React.useCallback(async (force = false) => {
    const a = fromRef.current;
    const b = toRef.current;
    if (!a || !b || inFlightRef.current) return;
    const last = lastRef.current;
    if (!force && last) {
      const moved =
        metresBetween(last.from, a) > REROUTE_METRES ||
        metresBetween(last.to, b) > REROUTE_METRES;
      if (!moved || Date.now() - last.at < MIN_REROUTE_MS) return;
    }
    inFlightRef.current = true;
    lastRef.current = { from: a, to: b, at: Date.now() };
    setLoading(true);
    try {
      const res = await fetch(
        `/api/directions?from=${a[0]},${a[1]}&to=${b[0]},${b[1]}`,
        { cache: "no-store" },
      );
      if (res.status === 404) {
        setError("noRoute");
        setRoute(null);
      } else if (!res.ok) {
        setError("failed");
      } else {
        const body = (await res.json()) as DirectionsResponse;
        const now = Date.now();
        setRoute(body);
        setRouteAt(now);
        setError(null);
        setSamples((prev) =>
          [...prev, { at: now, distance: body.distance }].filter(
            (s) => now - s.at <= TREND_WINDOW_MS,
          ),
        );
      }
    } catch {
      setError("failed");
    } finally {
      inFlightRef.current = false;
      setLoading(false);
    }
  }, []);

  // Reset whenever directions end, so the next session starts clean.
  React.useEffect(() => {
    if (active) return;
    lastRef.current = null;
    setRoute(null);
    setRouteAt(null);
    setError(null);
    setSamples([]);
  }, [active]);

  // React to every new fix of either end straight away...
  const fromKey = from ? `${from[0]},${from[1]}` : "";
  const toKey = to ? `${to[0]},${to[1]}` : "";
  React.useEffect(() => {
    if (!active || !fromKey || !toKey) return;
    void fetchRoute(!lastRef.current);
  }, [active, fromKey, toKey, fetchRoute]);

  // ...and retry the ones the throttle held back.
  React.useEffect(() => {
    if (!active) return;
    const id = setInterval(() => void fetchRoute(), CHECK_MS);
    return () => clearInterval(id);
  }, [active, fetchRoute]);

  // Closing speed in km/h: positive = the road gap is shrinking.
  let closingKmh: number | null = null;
  if (samples.length >= 2) {
    const first = samples[0];
    const last = samples[samples.length - 1];
    const dt = last.at - first.at;
    if (dt >= TREND_MIN_MS) {
      closingKmh = ((first.distance - last.distance) / (dt / 1000)) * 3.6;
    }
  }

  return { route, routeAt, error, loading, closingKmh, retry: () => void fetchRoute(true) };
}

/** Re-renders every second so "x s ago" labels stay honest. */
function useNow(ms = 1000) {
  const [now, setNow] = React.useState(() => Date.now());
  React.useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(id);
  }, [ms]);
  return now;
}

/* ------------------------------ instructions ----------------------------- */

type T = (key: string) => string;

function modifierAction(modifier: string | undefined, t: T): string {
  switch (modifier) {
    case "left":
      return t("dir.m.left");
    case "right":
      return t("dir.m.right");
    case "slight left":
      return t("dir.m.slightLeft");
    case "slight right":
      return t("dir.m.slightRight");
    case "sharp left":
      return t("dir.m.sharpLeft");
    case "sharp right":
      return t("dir.m.sharpRight");
    case "uturn":
      return t("dir.m.uturn");
    default:
      return t("dir.m.straight");
  }
}

/** Human instruction for one OSRM step, in the UI language. */
export function stepText(step: DirectionsStep, t: T, carName: string): string {
  const road = step.name.trim();
  const onto = (action: string) =>
    road ? t("dir.onto").replace("{action}", action).replace("{road}", road) : action;

  switch (step.type) {
    case "depart":
      return road ? t("dir.depart").replace("{road}", road) : t("dir.departPlain");
    case "arrive":
      return t("dir.arrive").replace("{name}", carName);
    case "roundabout":
    case "rotary":
    case "roundabout turn":
      return step.exit
        ? onto(t("dir.roundabout").replace("{n}", String(step.exit)))
        : onto(t("dir.roundaboutPlain"));
    case "exit roundabout":
    case "exit rotary":
      return onto(t("dir.exitRoundabout"));
    case "new name":
    case "continue":
    case "notification":
      return onto(
        step.modifier && step.modifier !== "straight"
          ? modifierAction(step.modifier, t)
          : t("dir.m.straight"),
      );
    default:
      // turn, fork, merge, on/off ramp, end of road
      return onto(modifierAction(step.modifier, t));
  }
}

function StepIcon({ step, className = "h-4 w-4" }: { step: DirectionsStep; className?: string }) {
  if (step.type === "arrive") return <Flag className={className} />;
  if (step.type === "depart") return <Navigation className={className} />;
  if (step.type.includes("roundabout") || step.type.includes("rotary"))
    return <RotateCcw className={className} />;
  switch (step.modifier) {
    case "left":
    case "sharp left":
      return <CornerUpLeft className={className} />;
    case "right":
    case "sharp right":
      return <CornerUpRight className={className} />;
    case "slight left":
      return <MoveUpLeft className={className} />;
    case "slight right":
      return <MoveUpRight className={className} />;
    case "uturn":
      return <ArrowLeft className={className} />;
    default:
      return <ArrowUp className={className} />;
  }
}

/** Seconds → "18 min" / "1 h 05 min". */
function formatEta(seconds: number, t: T): string {
  const mins = Math.max(1, Math.round(seconds / 60));
  if (mins < 60) return t("dir.min").replace("{m}", String(mins));
  const h = Math.floor(mins / 60);
  return t("dir.hmin")
    .replace("{h}", String(h))
    .replace("{m}", String(mins % 60).padStart(2, "0"));
}

/* --------------------------------- panel --------------------------------- */

export function DirectionsPanel({
  car,
  origin,
  route,
  routeAt,
  error,
  loading,
  closingKmh,
  chase,
  onToggleChase,
  collapsed,
  onToggleCollapsed,
  onRetry,
  onClose,
  className,
}: {
  car: Vehicle | null;
  /** My location [lat, lng]; null until the browser has a fix. */
  origin: Point | null;
  route: DirectionsResponse | null;
  routeAt: number | null;
  error: "noRoute" | "failed" | null;
  loading: boolean;
  closingKmh: number | null;
  /** Camera keeps both me and the car in view. */
  chase: boolean;
  onToggleChase: () => void;
  /** Minimised: only the next turn plus time/distance, so the map stays
      visible - the default on phones, where the full list hid the route. */
  collapsed: boolean;
  onToggleCollapsed: () => void;
  onRetry: () => void;
  onClose: () => void;
  className?: string;
}) {
  const { t } = useI18n();
  const now = useNow();
  const carName = car?.name ?? "";
  const steps = route?.steps ?? [];
  const arrived = !!route && route.distance <= ARRIVED_METRES;
  // The route is re-fetched from my position, so steps[0] is "depart" right
  // here and steps[1] is the next thing to do.
  const next = steps.find((s, i) => i > 0) ?? null;
  const toNext =
    next && origin ? metresBetween(origin, [next.location[1], next.location[0]]) : null;
  const arrivalTime = route
    ? new Date(now + route.duration * 1000).toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
      })
    : null;
  const carMoving = !!car && (car.speedKmh > 2 || car.headingValid === true);
  // Age of the car's own fix (not packet arrival), so a buffered backlog
  // can't pass for a live position.
  const carFixIso = car?.lastFixAt ?? car?.lastUpdated;
  const carFixSec = carFixIso ? Math.max(0, Math.round((now - +new Date(carFixIso)) / 1000)) : null;

  return (
    <section
      className={cn(
        "absolute z-30 flex max-h-[min(32rem,calc(100%-9rem))] w-[20rem] max-w-[calc(100%-1.5rem)] flex-col overflow-hidden rounded-xl border bg-background/95 shadow-xl backdrop-blur-md",
        className,
      )}
      aria-label={t("dir.title")}
    >
      {/* Header: target + controls */}
      <div className="flex items-center gap-2 border-b px-3 py-2">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-blue-600 text-white">
          <Navigation className="h-4 w-4" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold">
            {t("dir.to").replace("{name}", carName)}
          </p>
          {car && (
            <p className="flex items-center gap-1.5 truncate text-[11px] text-muted-foreground">
              <span
                className={cn(
                  "inline-block h-1.5 w-1.5 shrink-0 rounded-full",
                  carMoving ? "bg-emerald-500" : "bg-amber-500",
                )}
              />
              {carMoving
                ? t("dir.carMoving").replace("{speed}", String(Math.round(car.speedKmh)))
                : t("dir.carParked")}
              {carFixSec != null && Number.isFinite(carFixSec) && (
                <>
                  {" · "}
                  {carFixSec < 120
                    ? t("dir.fixSec").replace("{s}", String(carFixSec))
                    : t("dir.fixMin").replace("{m}", String(Math.round(carFixSec / 60)))}
                </>
              )}
            </p>
          )}
        </div>
        {loading && <Loader2 className="h-4 w-4 shrink-0 animate-spin text-muted-foreground" />}
        <button
          type="button"
          onClick={onToggleChase}
          aria-pressed={chase}
          aria-label={t("dir.chase")}
          title={t("dir.chaseHint")}
          className={cn(
            "press flex h-9 w-9 shrink-0 items-center justify-center rounded-lg",
            chase
              ? "bg-blue-600 text-white"
              : "text-muted-foreground hover:bg-accent hover:text-foreground",
          )}
        >
          <Maximize className="h-4 w-4" />
        </button>
        <button
          type="button"
          onClick={onToggleCollapsed}
          aria-expanded={!collapsed}
          aria-label={collapsed ? t("dir.expand") : t("dir.minimize")}
          title={collapsed ? t("dir.expand") : t("dir.minimize")}
          className="press flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          {collapsed ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
        </button>
        <button
          type="button"
          onClick={onClose}
          aria-label={t("dir.close")}
          title={t("dir.close")}
          className="press flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {!origin ? (
        <p className="flex items-center gap-2 px-3 py-4 text-xs text-muted-foreground">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          {t("dir.needLocation")}
        </p>
      ) : error && !route ? (
        <div className="space-y-2 px-3 py-4 text-xs">
          <p className="text-destructive">
            {error === "noRoute" ? t("dir.noRoute") : t("dir.failed")}
          </p>
          <button
            type="button"
            onClick={onRetry}
            className="inline-flex items-center gap-1 rounded-md border px-2 py-1 font-medium text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <RefreshCw className="h-3 w-3" />
            {t("dir.retry")}
          </button>
        </div>
      ) : !route ? (
        <p className="flex items-center gap-2 px-3 py-4 text-xs text-muted-foreground">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          {t("dir.loading")}
        </p>
      ) : arrived ? (
        <div className="flex items-center gap-3 px-3 py-4">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-emerald-500 text-white">
            <Flag className="h-5 w-5" />
          </span>
          <p className="text-sm font-semibold">{t("dir.reached").replace("{name}", carName)}</p>
        </div>
      ) : (
        <>
          {/* Next manoeuvre, big: this is what a driver glances at. */}
          {/* Minimised, the banner also carries time/distance and expands
              the panel when tapped. */}
          {next && (
            <div
              className={cn(
                "flex items-center gap-3 bg-blue-600 px-3 py-2.5 text-white",
                collapsed && "cursor-pointer",
              )}
              onClick={collapsed ? onToggleCollapsed : undefined}
            >
              <StepIcon step={next} className="h-7 w-7 shrink-0" />
              <div className="min-w-0 flex-1">
                {toNext != null && (
                  <p className="text-lg font-bold leading-tight tabular-nums">
                    {formatDistance(toNext)}
                  </p>
                )}
                <p className="truncate text-xs font-medium opacity-90">
                  {stepText(next, t, carName)}
                </p>
              </div>
              {collapsed && (
                <div className="shrink-0 text-end">
                  <p className="text-sm font-bold leading-tight tabular-nums">
                    {formatEta(route.duration, t)}
                  </p>
                  <p className="text-[11px] tabular-nums opacity-85">
                    {formatDistance(route.distance)}
                  </p>
                </div>
              )}
            </div>
          )}

          {!collapsed && (
          <>
          {/* Trip summary + catch-up trend */}
          <div className="space-y-1 border-b px-3 py-2">
            <div className="flex items-baseline gap-2">
              <span className="text-base font-bold tabular-nums text-blue-600 dark:text-blue-400">
                {formatEta(route.duration, t)}
              </span>
              <span className="text-sm font-medium tabular-nums text-muted-foreground">
                {formatDistance(route.distance)}
              </span>
              {arrivalTime && (
                <span className="ms-auto text-[11px] text-muted-foreground">
                  {t("dir.arriveAt").replace("{time}", arrivalTime)}
                </span>
              )}
            </div>
            <div className="flex items-center gap-2 text-[11px]">
              {closingKmh != null && Math.abs(closingKmh) >= 1 ? (
                closingKmh > 0 ? (
                  <span className="inline-flex items-center gap-1 font-medium text-emerald-600 dark:text-emerald-400">
                    <TrendingDown className="h-3.5 w-3.5" />
                    {t("dir.closing").replace("{speed}", String(Math.round(closingKmh)))}
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 font-medium text-red-500">
                    <TrendingUp className="h-3.5 w-3.5" />
                    {t("dir.pullingAway").replace("{speed}", String(Math.round(-closingKmh)))}
                  </span>
                )
              ) : (
                <span className="text-muted-foreground">
                  {carMoving ? t("dir.trendWait") : t("dir.steady")}
                </span>
              )}
              {routeAt && (
                <span className="ms-auto text-muted-foreground">
                  {t("dir.updated").replace(
                    "{age}",
                    String(Math.max(0, Math.round((now - routeAt) / 1000))),
                  )}
                </span>
              )}
            </div>
          </div>

          <ol className="min-h-0 flex-1 divide-y overflow-y-auto">
            {steps.slice(1).map((s, i) => (
              <li key={i} className="flex items-center gap-2.5 px-3 py-2">
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-muted text-foreground">
                  <StepIcon step={s} />
                </span>
                <span className="min-w-0 flex-1 text-xs leading-snug">
                  {stepText(s, t, carName)}
                </span>
                {s.distance > 0 && s.type !== "arrive" && (
                  <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">
                    {formatDistance(s.distance)}
                  </span>
                )}
              </li>
            ))}
          </ol>
          </>
          )}
        </>
      )}
      {!collapsed && (
        <p className="border-t px-3 py-1 text-[10px] text-muted-foreground">{t("dir.credit")}</p>
      )}
    </section>
  );
}
