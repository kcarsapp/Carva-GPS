"use client";

import * as React from "react";
import Link from "next/link";
import type { TraccarPosition } from "@carva/shared";
import {
  Activity,
  BarChart3,
  Bell,
  Car,
  ChevronDown,
  Clock,
  Compass,
  ExternalLink,
  Fuel,
  Gauge,
  History,
  KeyRound,
  MapPin,
  Navigation,
  Play,
  Plug,
  Radio,
  Route,
  Settings2,
  Signal,
  Wifi,
} from "lucide-react";

import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { SignalWarning, VehicleStatusBadge } from "@/components/dashboard/status-badge";
import { DeviceControls } from "@/components/dashboard/device-controls";
import { EmptyState } from "@/components/dashboard/states";
import { cn } from "@/lib/utils";
import { readTelemetry } from "@/lib/capabilities";
import { useI18n } from "@/lib/i18n-provider";
import { useAddress } from "@/lib/use-address";
import { timeAgo } from "@/lib/status";
import {
  detectTrips,
  routeStats,
  startOfFleetDay,
  type DetectedTrip,
  type RouteStats,
} from "@/lib/route-stats";
import {
  cardinal,
  formatAge,
  formatDateTime,
  formatDuration,
  formatEngineHours,
  formatOdometer,
  formatSpeed,
  formatVoltage,
  powerConnected,
  signalTier,
} from "@/lib/format";
import { eventLabel, severityOf, type TraccarEventRow } from "@/lib/events";
import type { Vehicle, VehicleStatus } from "@/mock/types";

/**
 * The vehicle profile: everything about one car, in the order an operator
 * asks about it.
 *
 *   1. Is it OK, and how fresh is this?   header: status + live age
 *   2. What is it doing right now?        speed, ignition, power, signal
 *   3. Where is it?                       street address, map link
 *   4. What has it done today?            distance, driving time, top speed
 *   5. Can I trust the tracker?           connectivity
 *   6. Everything else                    technical details, collapsed
 *
 * Every number shown is real tracker data. Anything the tracker does not
 * report (fuel, on these units) is left out rather than shown as 0.
 */

/** Last 7 days, as ISO strings — the window's reporting span. */
function weekRange(): { from: string; to: string } {
  const to = new Date();
  const from = new Date(to.getTime() - 7 * 24 * 3600 * 1000);
  return { from: from.toISOString(), to: to.toISOString() };
}

/** Re-render on an interval so "12 s ago" keeps counting between reports. */
function useNow(ms: number): number {
  const [now, setNow] = React.useState(() => Date.now());
  React.useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), ms);
    return () => window.clearInterval(id);
  }, [ms]);
  return now;
}

const STATUS_RING: Record<VehicleStatus, string> = {
  in_transit: "text-emerald-500 ring-emerald-500/30 bg-emerald-500/10",
  idle: "text-amber-500 ring-amber-500/30 bg-amber-500/10",
  maintenance: "text-red-500 ring-red-500/30 bg-red-500/10",
  unknown: "text-sky-500 ring-sky-500/30 bg-sky-500/10",
  offline: "text-muted-foreground ring-border bg-muted",
};

type Tone = "good" | "warn" | "bad" | undefined;
const TONE_TEXT: Record<Exclude<Tone, undefined>, string> = {
  good: "text-emerald-600 dark:text-emerald-400",
  warn: "text-amber-600 dark:text-amber-400",
  bad: "text-red-600 dark:text-red-400",
};

/** One headline reading: icon, label, the number, and a line of context. */
function Tile({
  icon: Icon,
  label,
  value,
  sub,
  tone,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
  sub?: string;
  tone?: Tone;
}) {
  return (
    <div className="rounded-xl border bg-card p-3">
      <div className="flex items-center gap-1.5 text-muted-foreground">
        <Icon className="h-3.5 w-3.5" />
        <span className="text-[11px] font-medium">{label}</span>
      </div>
      <p className={cn("num mt-1.5 text-lg font-semibold leading-none", tone && TONE_TEXT[tone])}>
        {value}
      </p>
      {sub && <p className="mt-1 truncate text-[11px] text-muted-foreground">{sub}</p>}
    </div>
  );
}

/** Label / value line inside a section card. */
function Line({ label, value, tone }: { label: string; value: React.ReactNode; tone?: Tone }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1.5">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className={cn("num text-end text-sm font-medium", tone && TONE_TEXT[tone])}>{value}</span>
    </div>
  );
}

function SectionCard({
  icon: Icon,
  title,
  aside,
  children,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  aside?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-xl border bg-card p-3.5">
      <div className="mb-1 flex items-center gap-2">
        <Icon className="h-4 w-4 text-muted-foreground" />
        <h3 className="text-sm font-semibold">{title}</h3>
        {aside && <div className="ms-auto">{aside}</div>}
      </div>
      {children}
    </section>
  );
}

const actionClass =
  "inline-flex items-center gap-1.5 rounded-lg border bg-card px-3 py-2 text-xs font-medium text-foreground shadow-sm transition-colors hover:border-foreground/20 hover:bg-accent";

export function VehicleWindow({
  vehicle,
  open,
  onOpenChange,
  canControl = false,
}: {
  vehicle: Vehicle | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  canControl?: boolean;
}) {
  const { t } = useI18n();
  const now = useNow(5000);
  const [tab, setTab] = React.useState("overview");
  // Trips are found in the week's route (lib/route-stats.ts): Traccar's trips
  // report takes ~36 s for a week here and its distances can be negative.
  const [trips, setTrips] = React.useState<DetectedTrip[] | null>(null);
  const [events, setEvents] = React.useState<TraccarEventRow[] | null>(null);
  const [today, setToday] = React.useState<RouteStats | null | "error">(null);

  const deviceId = vehicle?.deviceId ?? null;
  const { address, loading: geoLoading } = useAddress(vehicle?.id, vehicle?.lat, vehicle?.lng);

  // A different car is a different profile: back to the top, nothing stale.
  React.useEffect(() => {
    setTab("overview");
    setTrips(null);
    setEvents(null);
    setToday(null);
  }, [vehicle?.id]);

  // Today's numbers, measured from the GPS route (see lib/route-stats.ts) -
  // Traccar's summary reads a counter that runs backwards on this fleet.
  React.useEffect(() => {
    if (!open || deviceId == null || today !== null) return;
    let alive = true;
    const qs = new URLSearchParams({
      deviceId: String(deviceId),
      from: startOfFleetDay(),
      to: new Date().toISOString(),
    });
    fetch(`/api/traccar/positions?${qs}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((rows: unknown) => {
        if (alive) setToday(routeStats(Array.isArray(rows) ? (rows as TraccarPosition[]) : []));
      })
      .catch(() => alive && setToday("error"));
    return () => {
      alive = false;
    };
  }, [open, deviceId, today]);

  // Trips and alerts load lazily, only for the tab being looked at.
  React.useEffect(() => {
    if (!open || deviceId == null) return;
    if (tab !== "trips" && tab !== "alerts") return;
    if (tab === "trips" && trips !== null) return;
    if (tab === "alerts" && events !== null) return;

    let alive = true;
    const { from, to } = weekRange();
    const q = `deviceId=${deviceId}&from=${from}&to=${to}`;
    const get = (path: string) =>
      fetch(`/api/traccar/${path}?${q}`, { cache: "no-store" })
        .then((r) => (r.ok ? r.json() : []))
        .then((rows: unknown) => (Array.isArray(rows) ? rows : []))
        .catch(() => []);

    if (tab === "trips") {
      get("positions").then((rows) => alive && setTrips(detectTrips(rows as TraccarPosition[])));
    } else {
      get("reports/events").then(
        (rows) => alive && setEvents((rows as TraccarEventRow[]).slice().reverse()),
      );
    }
    return () => {
      alive = false;
    };
  }, [open, deviceId, tab, trips, events]);


  if (!vehicle) return null;

  const a = (vehicle.attributes ?? {}) as Record<string, unknown>;
  const num = (k: string) =>
    typeof a[k] === "number" && Number.isFinite(a[k] as number) ? (a[k] as number) : undefined;
  const bool = (k: string) => (typeof a[k] === "boolean" ? (a[k] as boolean) : undefined);

  const power = num("power");
  const rssi = num("rssi") ?? vehicle.gsm;
  const sats = num("sat");
  const fuel = num("fuel") ?? num("fuelLevel");
  const tier = signalTier(rssi);
  const blocked = bool("blocked");
  const hasFix = vehicle.lat != null && vehicle.lng != null;
  const moving = vehicle.status === "in_transit";
  const connected = powerConnected(power);

  const fixAt = vehicle.lastFixAt || vehicle.lastUpdated;
  const fixAgeMs = fixAt ? now - +new Date(fixAt) : Infinity;
  const fresh = fixAgeMs < 2 * 60_000;
  const tracker = vehicle.trackers?.find((tr) => tr.primary) ?? vehicle.trackers?.[0];
  const trackers = vehicle.trackers ?? [];
  const telemetry = readTelemetry(vehicle.attributes);
  const todayRange = { from: startOfFleetDay(), to: new Date(now).toISOString() };
  const mapsUrl = hasFix
    ? `https://www.google.com/maps?q=${vehicle.lat!.toFixed(6)},${vehicle.lng!.toFixed(6)}`
    : null;
  const tierTone: Tone = tier === "poor" ? "bad" : tier === "fair" ? "warn" : tier ? "good" : undefined;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[92dvh] max-w-2xl flex-col overflow-hidden p-0">
        {/* ------------------------------ Header ------------------------------ */}
        <div className="relative shrink-0 border-b p-4">
          {/* A whisper of the brand behind the header - the car is the subject. */}
          <div className="pointer-events-none absolute inset-0 bg-gradient-to-br from-primary/[0.07] via-transparent to-transparent" />
          <div className="relative flex items-start gap-3">
            <span
              className={cn(
                "flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl ring-1",
                STATUS_RING[vehicle.status],
              )}
            >
              <Car className="h-6 w-6" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-lg font-bold leading-tight tracking-tight">{vehicle.name}</p>
              <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
                <span className="font-mono">{vehicle.plate}</span>
                {tracker?.model && <span>· {tracker.model}</span>}
              </p>
              <p className="mt-1.5 flex items-center gap-1.5 text-xs">
                <span className="relative flex h-2 w-2">
                  {fresh && (
                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-500 opacity-60" />
                  )}
                  <span
                    className={cn(
                      "relative inline-flex h-2 w-2 rounded-full",
                      fresh ? "bg-emerald-500" : "bg-muted-foreground/50",
                    )}
                  />
                </span>
                <span className="num text-muted-foreground">
                  {fixAt
                    ? t("veh.updated").replace("{age}", timeAgo(fixAt))
                    : t("fleet.neverReported")}
                </span>
              </p>
            </div>
            <VehicleStatusBadge status={vehicle.status} />
          </div>
        </div>

        <SignalWarning vehicle={vehicle} />

        <Tabs value={tab} onValueChange={setTab} className="min-h-0 flex-1 overflow-y-auto p-4">
          <TabsList className="mb-4 w-full justify-start overflow-x-auto">
            <TabsTrigger value="overview">
              <Activity /> {t("veh.tab.overview")}
            </TabsTrigger>
            {canControl && deviceId != null && (
              <TabsTrigger value="controls">
                <Settings2 /> {t("veh.tab.controls")}
              </TabsTrigger>
            )}
            <TabsTrigger value="trips">
              <Route /> {t("veh.tab.trips")}
            </TabsTrigger>
            <TabsTrigger value="alerts">
              <Bell /> {t("veh.tab.alerts")}
            </TabsTrigger>
            {/* Only worth a tab when the car actually carries more than one box. */}
            {trackers.length > 1 && (
              <TabsTrigger value="trackers">
                <Radio /> {t("veh.tab.trackers")}
                <span className="ms-1 rounded-full bg-muted px-1.5 text-[10px] tabular-nums">
                  {trackers.length}
                </span>
              </TabsTrigger>
            )}
          </TabsList>

          {/* ---------------------------- Overview ---------------------------- */}
          <TabsContent value="overview" className="rise space-y-3">
            {/* What it is doing right now. */}
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <Tile
                icon={Gauge}
                label={t("detail.speed")}
                value={hasFix ? `${vehicle.speedKmh} km/h` : "—"}
                sub={
                  hasFix
                    ? `${t(moving ? "veh.moving" : "veh.parked")} · ${cardinal(vehicle.heading)}`
                    : t("veh.noFix")
                }
                tone={moving ? "good" : undefined}
              />
              <Tile
                icon={KeyRound}
                label={t("detail.ignition")}
                value={vehicle.ignition == null ? "—" : t(vehicle.ignition ? "detail.on" : "detail.off")}
                sub={blocked ? t("veh.engineCut") : undefined}
                tone={blocked ? "bad" : vehicle.ignition ? "good" : undefined}
              />
              <Tile
                icon={Plug}
                label={t("detail.power")}
                value={formatVoltage(power)}
                sub={
                  connected == null
                    ? undefined
                    : t(connected ? "detail.connected" : "detail.disconnected") +
                      (vehicle.charge ? ` · ${t("detail.charging")}` : "")
                }
                tone={connected == null ? undefined : connected ? "good" : "bad"}
              />
              <Tile
                icon={Signal}
                label={t("detail.signal")}
                value={tier ? t(`detail.sig.${tier}`) : "—"}
                sub={sats != null ? `${sats} ${t("detail.satellites").toLowerCase()}` : undefined}
                tone={tierTone}
              />
            </div>

            {/* Fuel only when the tracker actually reports it - never a fake 0%. */}
            {fuel != null && (
              <Tile icon={Fuel} label={t("veh.fuel")} value={`${Math.round(fuel)}%`} />
            )}

            {/* Where it is. */}
            <SectionCard
              icon={MapPin}
              title={
                vehicle.signalIssue && vehicle.signalIssue !== "never"
                  ? t("detail.lastKnownLocation")
                  : t("detail.location")
              }
              aside={
                mapsUrl && (
                  <a
                    href={mapsUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
                  >
                    {t("veh.openMaps")}
                    <ExternalLink className="h-3 w-3" />
                  </a>
                )
              }
            >
              {hasFix ? (
                <>
                  <p className="text-sm leading-snug">
                    {address ?? (geoLoading ? t("detail.geocoding") : vehicle.location)}
                  </p>
                  <p className="num mt-1 font-mono text-[11px] text-muted-foreground">
                    {vehicle.lat!.toFixed(5)}, {vehicle.lng!.toFixed(5)}
                    {vehicle.lastFixAt && ` · ${formatDateTime(vehicle.lastFixAt)}`}
                  </p>
                </>
              ) : (
                <p className="text-sm text-muted-foreground">{t("veh.noFix")}</p>
              )}
            </SectionCard>

            {/* What it has done today. */}
            {deviceId != null && (
              <SectionCard
                icon={Route}
                title={t("veh.today")}
                aside={<span className="text-[10px] text-muted-foreground">{t("veh.today.note")}</span>}
              >
                {today === null ? (
                  <div className="grid grid-cols-3 gap-3 py-1.5">
                    {[0, 1, 2].map((i) => (
                      <Skeleton key={i} className="h-10" />
                    ))}
                  </div>
                ) : today === "error" ? (
                  <p className="py-1.5 text-sm text-muted-foreground">{t("veh.todayError")}</p>
                ) : (
                  <div className="grid grid-cols-3 gap-3 py-1.5">
                    {(
                      [
                        [t("veh.distance"), `${(today.distanceM / 1000).toFixed(1)} km`],
                        [t("veh.driving"), formatDuration(today.drivingMs)],
                        [t("veh.topSpeed"), today.topSpeedKmh ? `${today.topSpeedKmh} km/h` : "—"],
                      ] as const
                    ).map(([label, value]) => (
                      <div key={label}>
                        <p className="text-[11px] text-muted-foreground">{label}</p>
                        <p className="num text-base font-semibold">{value}</p>
                      </div>
                    ))}
                  </div>
                )}
              </SectionCard>
            )}

            {/* Can the tracker be trusted right now? */}
            <SectionCard icon={Wifi} title={t("veh.connectivity")}>
              <div className="divide-y">
                <Line
                  label={t("veh.lastContact")}
                  value={vehicle.lastUpdated ? timeAgo(vehicle.lastUpdated) : "—"}
                />
                <Line
                  label={t("veh.lastFix")}
                  value={vehicle.lastFixAt ? timeAgo(vehicle.lastFixAt) : "—"}
                  tone={vehicle.signalIssue === "delayed" ? "warn" : undefined}
                />
                <Line
                  label={t("detail.signal")}
                  value={tier ? `${t(`detail.sig.${tier}`)}${rssi != null ? ` (${rssi})` : ""}` : "—"}
                  tone={tierTone}
                />
                {tracker && (
                  <Line
                    label={t("veh.device")}
                    value={<span className="font-mono text-xs">{tracker.uniqueId}</span>}
                  />
                )}
              </div>
            </SectionCard>

            {/* Everything else, one tap away. */}
            <details className="group rounded-xl border bg-card">
              <summary className="flex cursor-pointer list-none items-center gap-2 p-3.5 text-sm font-semibold [&::-webkit-details-marker]:hidden">
                <Compass className="h-4 w-4 text-muted-foreground" />
                {t("veh.technical")}
                <ChevronDown className="ms-auto h-4 w-4 text-muted-foreground transition-transform duration-200 group-open:rotate-180" />
              </summary>
              <div className="divide-y border-t px-3.5 pb-2">
                <Line
                  label={t("detail.direction")}
                  value={
                    hasFix
                      ? `${cardinal(vehicle.heading)} · ${Math.round(vehicle.heading)}°` +
                        (vehicle.headingValid ? "" : ` (${t("detail.lastKnown")})`)
                      : "—"
                  }
                />
                <Line
                  label={t("detail.relay")}
                  value={blocked == null ? "—" : t(blocked ? "detail.on" : "detail.off")}
                  tone={blocked ? "bad" : undefined}
                />
                <Line
                  label={t("detail.charging")}
                  value={vehicle.charge == null ? "—" : t(vehicle.charge ? "detail.on" : "detail.off")}
                />
                <Line label={t("detail.satellites")} value={sats != null ? String(sats) : "—"} />
                <Line label={t("detail.mileage")} value={formatOdometer(num("totalDistance"))} />
                <Line label={t("detail.engineHours")} value={formatEngineHours(num("hours"))} />
                {tracker?.model && <Line label={t("veh.model")} value={tracker.model} />}
              </div>
            </details>

            {/* Jump straight into the other tools, already scoped to this car. */}
            <div className="flex flex-wrap gap-2 pt-1">
              {deviceId != null && (
                <Link
                  href={`/fleet/history?device=${deviceId}&from=${encodeURIComponent(todayRange.from)}&to=${encodeURIComponent(todayRange.to)}`}
                  className={cn(actionClass, "border-primary/30 text-primary")}
                >
                  <Play className="h-3.5 w-3.5" />
                  {t("veh.replayToday")}
                </Link>
              )}
              <Link href={`/fleet/history?device=${deviceId ?? ""}`} className={actionClass}>
                <History className="h-3.5 w-3.5" />
                {t("veh.openHistory")}
              </Link>
              <Link href="/fleet/reports" className={actionClass}>
                <BarChart3 className="h-3.5 w-3.5" />
                {t("veh.openReports")}
              </Link>
            </div>
          </TabsContent>

          {/* ---------------------------- Controls ---------------------------- */}
          {canControl && deviceId != null && (
            <TabsContent value="controls" className="rise">
              <div className="overflow-hidden rounded-xl border">
                <DeviceControls
                  deviceId={deviceId}
                  deviceName={vehicle.name}
                  telemetry={telemetry}
                  deviceAttributes={vehicle.deviceAttributes}
                />
              </div>
            </TabsContent>
          )}

          {/* ----------------------------- Trips ------------------------------ */}
          <TabsContent value="trips" className="rise">
            {trips === null ? (
              <div className="space-y-2">
                {[0, 1, 2].map((i) => (
                  <Skeleton key={i} className="h-14 w-full rounded-xl" />
                ))}
              </div>
            ) : trips.length === 0 ? (
              <EmptyState icon={Route} title={t("veh.noTrips")} className="py-8" />
            ) : (
              <ul className="space-y-2">
                {trips
                  .map((trip, i) => ({ trip, i }))
                  .reverse()
                  .map(({ trip, i }) => (
                    <li
                      key={`${trip.startTime}-${i}`}
                      className="flex items-center gap-3 rounded-xl border bg-card p-3"
                    >
                      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
                        <Navigation className="h-4 w-4" />
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">{formatDateTime(trip.startTime)}</p>
                        <p className="num text-[11px] text-muted-foreground">
                          {(trip.distanceM / 1000).toFixed(1)} km · {formatDuration(trip.durationMs)} ·{" "}
                          {t("veh.max")} {trip.maxSpeedKmh} km/h
                        </p>
                      </div>
                      <Link
                        href={`/fleet/history?device=${deviceId}&from=${encodeURIComponent(
                          trip.startTime,
                        )}&to=${encodeURIComponent(trip.endTime)}&trip=1`}
                        className={cn(actionClass, "shrink-0 px-2.5 py-1.5")}
                      >
                        <Play className="h-3 w-3" />
                        {t("rep.replay")}
                      </Link>
                    </li>
                  ))}
              </ul>
            )}
          </TabsContent>

          {/* ----------------------------- Alerts ----------------------------- */}
          <TabsContent value="alerts" className="rise">
            {events === null ? (
              <div className="space-y-2">
                {[0, 1, 2].map((i) => (
                  <Skeleton key={i} className="h-11 w-full rounded-xl" />
                ))}
              </div>
            ) : events.length === 0 ? (
              <EmptyState icon={Bell} title={t("veh.noAlerts")} className="py-8" />
            ) : (
              <ul className="space-y-1.5">
                {events.slice(0, 60).map((row) => {
                  const sev = severityOf(row);
                  return (
                    <li key={row.id} className="flex items-center gap-2.5 rounded-xl border bg-card p-2.5">
                      <span
                        className={cn(
                          "h-2 w-2 shrink-0 rounded-full",
                          sev === "critical" ? "bg-red-500" : sev === "warning" ? "bg-amber-500" : "bg-sky-500",
                        )}
                      />
                      <span className="min-w-0 flex-1 truncate text-sm">{eventLabel(row, t)}</span>
                      <span className="num shrink-0 text-[11px] text-muted-foreground">
                        {formatDateTime(row.eventTime)}
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
            <div className="mt-3">
              <Link href="/fleet/alerts" className="text-xs font-medium text-primary hover:underline">
                {t("veh.allAlerts")}
              </Link>
            </div>
          </TabsContent>

          {/* ---------------------------- Trackers ---------------------------- */}
          <TabsContent value="trackers" className="rise">
            <p className="mb-3 text-xs text-muted-foreground">{t("veh.trackersIntro")}</p>
            <ul className="space-y-2">
              {trackers.map((tr) => {
                const ta = (tr.attributes ?? {}) as Record<string, unknown>;
                const volts = typeof ta.power === "number" ? ta.power : undefined;
                const trRssi = typeof ta.rssi === "number" ? ta.rssi : undefined;
                const trTier = signalTier(trRssi);
                const cut = ta.blocked === true;
                return (
                  <li
                    key={tr.deviceId}
                    className={cn("rounded-xl border bg-card p-3", tr.primary && "border-primary/40 bg-primary/5")}
                  >
                    <div className="flex items-center gap-2">
                      <span
                        className={cn(
                          "h-2 w-2 shrink-0 rounded-full",
                          tr.online ? "bg-emerald-500" : "bg-muted-foreground/50",
                        )}
                      />
                      <span className="min-w-0 flex-1 truncate text-sm font-semibold">{tr.name}</span>
                      {tr.primary && (
                        <Badge variant="secondary" className="text-[10px]">
                          {t("veh.trackerPrimary")}
                        </Badge>
                      )}
                      {cut && (
                        <Badge variant="destructive" className="text-[10px]">
                          {t("dev.relayCut")}
                        </Badge>
                      )}
                    </div>
                    <p className="mt-0.5 truncate font-mono text-[11px] text-muted-foreground">
                      {tr.uniqueId}
                      {tr.model ? ` · ${tr.model}` : ""}
                    </p>
                    <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 sm:grid-cols-4">
                      {(
                        [
                          [t("dev.row.lastFix"), tr.lastUpdated ? formatAge(tr.lastUpdated, now) : t("dev.status.never")],
                          [t("detail.speed"), `${tr.speedKmh} km/h`],
                          [t("detail.signal"), trTier ? t(`detail.sig.${trTier}`) : "—"],
                          [t("detail.voltage"), formatVoltage(volts)],
                        ] as const
                      ).map(([label, value]) => (
                        <div key={label}>
                          <p className="text-[10px] text-muted-foreground">{label}</p>
                          <p className="num text-xs font-semibold">{value}</p>
                        </div>
                      ))}
                    </div>
                  </li>
                );
              })}
            </ul>
            <p className="mt-3 text-[11px] text-muted-foreground">{t("veh.trackersManage")}</p>
          </TabsContent>
        </Tabs>

        <div className="flex shrink-0 items-center justify-between gap-2 border-t bg-muted/40 px-4 py-3">
          <span className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <Clock className="h-3.5 w-3.5" />
            {t("veh.range7d")}
          </span>
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            className="rounded-lg border bg-card px-3 py-1.5 text-xs font-medium hover:bg-accent"
          >
            {t("veh.close")}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
