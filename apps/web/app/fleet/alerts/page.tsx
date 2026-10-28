"use client";

// Fleet alerts — every row here is a real Traccar event
// (GET /api/traccar/reports/events) for the selected vehicles and period.
// Traccar keeps no read flag, so acknowledgement lives in localStorage via
// lib/events.ts; clicking a row both marks it read and deep-links into the
// playback around the moment it happened.

import { Bell as PageIcon } from "lucide-react";
import * as React from "react";
import Link from "next/link";
import {
  Bell,
  CheckCheck,
  Gauge,
  Hexagon,
  Loader2,
  MapPin,
  MessageSquare,
  Navigation,
  Power,
  RefreshCw,
  ShieldAlert,
  Terminal,
  User,
  Wifi,
  WifiOff,
  Wrench,
  Zap,
  type LucideIcon,
} from "lucide-react";

import { KpiTile } from "@/components/dashboard/kpi-tile";
import { PageHeader } from "@/components/dashboard/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { useSession } from "@/lib/live-data";
import { useI18n } from "@/lib/i18n-provider";
import { formatAge, formatDateTime } from "@/lib/format";
import { presetRange, type Range } from "@/lib/reports";
import {
  fetchDevices,
  fetchEvents,
  fetchGeofenceNames,
  emptyRead,
  eventLabel,
  filterBySeverity,
  geofenceLabel,
  groupByDay,
  isRead,
  markAllRead,
  markRead,
  readState,
  severityCounts,
  severityOf,
  unreadCount,
  type ReadState,
  type Severity,
  type TraccarEventRow,
} from "@/lib/events";
import type { TraccarDevice } from "@carva/shared";

/** Sentinel for the "All vehicles" option — Traccar takes repeated deviceId. */
const ALL = "all";

/** Presets shared with Statistics and History; alerts never need a custom range. */
type AlertPeriod = "today" | "yesterday" | "week" | "month";

const PERIODS: [AlertPeriod, string][] = [
  ["today", "rep.today"],
  ["yesterday", "rep.yesterday"],
  ["week", "rep.last7"],
  ["month", "rep.last30"],
];

const SEVERITY_FILTERS: [Severity | "all", string][] = [
  ["all", "alerts.sev.all"],
  ["critical", "alerts.sev.critical"],
  ["warning", "alerts.sev.warning"],
  ["info", "alerts.sev.info"],
];

/** Playback window opened around an event, either side. */
const REPLAY_PAD_MS = 15 * 60 * 1000;

/** Ages are relative, so re-render them on a slow tick. */
const AGE_TICK_MS = 60_000;

/* --------------------------------- Styling -------------------------------- */

const SEVERITY_DOT: Record<Severity, string> = {
  critical: "bg-destructive",
  warning: "bg-amber-500",
  info: "bg-sky-500",
};

const SEVERITY_TEXT: Record<Severity, string> = {
  critical: "text-destructive",
  warning: "text-amber-600 dark:text-amber-400",
  info: "text-sky-600 dark:text-sky-400",
};

const SEVERITY_BADGE: Record<Severity, "destructive" | "warning" | "info"> = {
  critical: "destructive",
  warning: "warning",
  info: "info",
};

/** One icon per event family, so the feed is scannable without reading. */
const TYPE_ICONS: Record<string, LucideIcon> = {
  ignitionOn: Power,
  ignitionOff: Power,
  deviceMoving: Navigation,
  deviceStopped: MapPin,
  geofenceEnter: Hexagon,
  geofenceExit: Hexagon,
  deviceOnline: Wifi,
  deviceOffline: WifiOff,
  deviceUnknown: WifiOff,
  deviceInactive: WifiOff,
  deviceOverspeed: Gauge,
  alarm: ShieldAlert,
  powerCut: Zap,
  powerRestored: Zap,
  maintenance: Wrench,
  textMessage: MessageSquare,
  commandResult: Terminal,
  driverChanged: User,
};

function eventIcon(row: TraccarEventRow): LucideIcon {
  return TYPE_ICONS[row.type] ?? Bell;
}

/* -------------------------------- Helpers --------------------------------- */

/** Replay the ±15 minutes around an event; null when it has no fix to show. */
function replayHref(row: TraccarEventRow): string | null {
  const at = +new Date(row.eventTime);
  if (!Number.isFinite(at) || !row.positionId) return null;
  const qs = new URLSearchParams({
    device: String(row.deviceId),
    from: new Date(at - REPLAY_PAD_MS).toISOString(),
    to: new Date(at + REPLAY_PAD_MS).toISOString(),
  });
  return `/fleet/history?${qs}`;
}

/* --------------------------------- Pieces --------------------------------- */

function StatCard({
  label,
  value,
  tone,
  icon,
  accent,
}: {
  label: string;
  value: string;
  tone?: string;
  icon?: LucideIcon;
  accent?: boolean;
}) {
  return <KpiTile label={label} value={value} tone={tone} icon={icon} accent={accent} />;
}

function EventItem({
  row,
  vehicle,
  geofence,
  unread,
  now,
  onOpen,
  t,
}: {
  row: TraccarEventRow;
  vehicle: string;
  geofence: string | null;
  unread: boolean;
  now: number;
  onOpen: () => void;
  t: (key: string) => string;
}) {
  const severity = severityOf(row);
  const Icon = eventIcon(row);
  const href = replayHref(row);
  // formatAge yields "now", "4m"/"3h"/"2d", or "—" for an unreadable stamp —
  // only the middle form takes the translated "ago".
  const age = formatAge(row.eventTime, now);
  const relative =
    age === "now" ? t("alerts.now") : age === "—" ? age : `${age} ${t("alerts.ago")}`;

  const content = (
    <>
      <span
        aria-hidden
        className={cn("mt-2 h-2 w-2 shrink-0 rounded-full", SEVERITY_DOT[severity])}
      />
      <span
        className={cn(
          "flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-muted",
          SEVERITY_TEXT[severity],
        )}
      >
        <Icon className="h-4 w-4" />
      </span>

      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-center gap-2">
          <span className={cn("text-sm", unread ? "font-semibold" : "font-medium")}>
            {eventLabel(row, t)}
          </span>
          {unread && (
            <Badge variant={SEVERITY_BADGE[severity]} className="px-1.5 py-0 text-[10px]">
              {t("alerts.new")}
            </Badge>
          )}
        </span>
        <span className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
          <span className="font-medium text-foreground/80">{vehicle}</span>
          {geofence && (
            <>
              <span aria-hidden>·</span>
              <span className="inline-flex items-center gap-1">
                <Hexagon className="h-3 w-3" />
                {geofence}
              </span>
            </>
          )}
        </span>
      </span>

      <span className="flex shrink-0 flex-col items-end gap-0.5 text-xs">
        <span className="tabular-nums text-muted-foreground">
          {formatDateTime(row.eventTime)}
        </span>
        <span className="tabular-nums text-muted-foreground/80">{relative}</span>
      </span>
    </>
  );

  // Unread rows carry a gold leading edge: "new", not "danger" - severity
  // already has its own dot and icon colour.
  const className = cn(
    "press flex w-full items-start gap-3 rounded-xl border bg-card p-3 text-start hover:border-primary/30 hover:bg-accent",
    unread && "border-s-[3px] border-s-primary/80",
  );

  return href ? (
    <Link href={href} onClick={onOpen} className={className} title={t("rep.replay")}>
      {content}
    </Link>
  ) : (
    <button type="button" onClick={onOpen} className={className}>
      {content}
    </button>
  );
}

/* ---------------------------------- Page ---------------------------------- */

export default function AlertsPage() {
  const { t } = useI18n();
  const session = useSession();

  const [devices, setDevices] = React.useState<TraccarDevice[]>([]);
  // The feed can't be fetched before the vehicle list settles — without this
  // the first pass would run with an empty id list and flash "no events".
  const [devicesLoaded, setDevicesLoaded] = React.useState(false);
  const [deviceId, setDeviceId] = React.useState<string>(ALL);
  // A quiet fleet can easily have nothing today, so open on a week of history.
  const [period, setPeriod] = React.useState<AlertPeriod>("week");
  const [severity, setSeverity] = React.useState<Severity | "all">("all");
  const [range, setRange] = React.useState<Range | null>(null);
  const [rows, setRows] = React.useState<TraccarEventRow[]>([]);
  const [geofences, setGeofences] = React.useState<Map<number, string>>(
    () => new Map(),
  );
  const [read, setRead] = React.useState<ReadState>(emptyRead);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [reloadKey, setReloadKey] = React.useState(0);
  const [now, setNow] = React.useState(() => Date.now());
  // Keeps a slow response from overwriting a newer one.
  const requestRef = React.useRef(0);

  // Acknowledgements live in the browser; read them after hydration.
  React.useEffect(() => {
    setRead(readState());
  }, []);

  // Relative ages stay honest without refetching.
  React.useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), AGE_TICK_MS);
    return () => clearInterval(timer);
  }, []);

  // Vehicles + geofence names, once signed in.
  React.useEffect(() => {
    if (!session.authed) return;
    const controller = new AbortController();
    let alive = true;
    void fetchDevices(controller.signal).then((list) => {
      if (!alive) return;
      setDevices(list);
      setDevicesLoaded(true);
    });
    void fetchGeofenceNames(controller.signal).then((names) => {
      if (alive) setGeofences(names);
    });
    return () => {
      alive = false;
      controller.abort();
    };
  }, [session.authed]);

  // Presets resolve to an absolute range the moment they're picked — and again
  // on Refresh. "Today" and the rolling windows pin `to` to the instant they
  // were resolved, so re-running the stored range would replay the window the
  // page opened with and never surface an event that has just fired.
  React.useEffect(() => {
    setRange(presetRange(period));
  }, [period, reloadKey]);

  const load = React.useCallback(
    async (span: Range) => {
      const ids =
        deviceId === ALL ? devices.map((d) => d.id) : [Number(deviceId)];
      if (ids.length === 0) {
        setRows([]);
        setError(null);
        setLoading(false);
        return;
      }

      const request = ++requestRef.current;
      setLoading(true);
      setError(null);
      try {
        const fetched = await fetchEvents({
          deviceIds: ids,
          from: span.from,
          to: span.to,
        });
        if (request !== requestRef.current) return;
        setRows(fetched);
      } catch (e) {
        if (request !== requestRef.current) return;
        setError(`${t("alerts.loadErr")} ${(e as Error).message}`);
        setRows([]);
      } finally {
        if (request === requestRef.current) setLoading(false);
      }
    },
    [deviceId, devices, t],
  );

  React.useEffect(() => {
    if (!session.authed || !devicesLoaded || !range) return;
    void load(range);
  }, [session.authed, devicesLoaded, range, load]);

  const deviceName = React.useCallback(
    (id: number) => devices.find((d) => d.id === id)?.name ?? `#${id}`,
    [devices],
  );

  const counts = React.useMemo(() => severityCounts(rows), [rows]);
  const unread = React.useMemo(() => unreadCount(rows, read), [rows, read]);
  const visible = React.useMemo(
    () => filterBySeverity(rows, severity === "all" ? null : severity),
    [rows, severity],
  );
  const days = React.useMemo(() => groupByDay(visible, t), [visible, t]);
  // An empty feed means two very different things: the fleet was quiet, or the
  // severity chip is hiding everything it did report.
  const hiddenByFilter = visible.length === 0 && rows.length > 0;

  function openEvent(id: number) {
    if (isRead(read, id)) return;
    setRead(markRead([id]));
  }

  function acknowledgeAll() {
    if (rows.length === 0) return;
    setRead(markAllRead(rows));
  }

  if (!session.loading && !session.authed) {
    return (
      <>
        <PageHeader
        eyebrow={t("fleet.nav.group.monitor")}
        icon={PageIcon} title={t("alerts.title")} description={t("alerts.desc")} />
        <Card>
          <CardContent className="p-8 text-center text-sm text-muted-foreground">
            {t("alerts.signin")}{" "}
            <Link
              href="/login"
              className="font-medium text-primary hover:underline"
            >
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
        eyebrow={t("fleet.nav.group.monitor")}
        icon={PageIcon}
        title={t("alerts.title")}
        description={t("alerts.desc")}
        action={
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() => setReloadKey((n) => n + 1)}
              disabled={loading}
            >
              <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />
              {t("events.refresh")}
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={acknowledgeAll}
              disabled={unread === 0}
            >
              <CheckCheck className="h-4 w-4" />
              {t("alerts.markAll")}
            </Button>
          </div>
        }
      />

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
              {t("rep.vehicle")}
            </span>
            <select
              value={deviceId}
              onChange={(e) => setDeviceId(e.target.value)}
              className="h-9 rounded-md border border-input bg-background px-3 text-sm outline-none focus:border-primary"
            >
              <option value={ALL}>{t("rep.allVehicles")}</option>
              {devices.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
          </div>

          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-sm font-medium text-muted-foreground">
              {t("rep.period")}
            </span>
            {PERIODS.map(([value, label]) => (
              <Button
                key={value}
                size="sm"
                variant={period === value ? "default" : "outline"}
                onClick={() => setPeriod(value)}
              >
                {t(label)}
              </Button>
            ))}
          </div>
        </CardContent>
      </Card>

      {session.authed && devices.length === 0 && (
        <p className="mb-4 text-sm text-muted-foreground">{t("rep.noVehicles")}</p>
      )}

      {/* Severity chips */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <span className="text-sm font-medium text-muted-foreground">
          {t("alerts.severity")}
        </span>
        {SEVERITY_FILTERS.map(([value, label]) => {
          const count =
            value === "all"
              ? counts.total
              : value === "critical"
                ? counts.critical
                : value === "warning"
                  ? counts.warning
                  : counts.info;
          const active = severity === value;
          return (
            <button
              key={value}
              type="button"
              aria-pressed={active}
              onClick={() => setSeverity(value)}
              className={cn(
                "inline-flex items-center gap-2 rounded-full border px-3 py-1 text-sm font-medium transition-colors",
                active
                  ? "border-primary bg-primary text-primary-foreground shadow-sm"
                  : "bg-card text-muted-foreground hover:bg-accent hover:text-foreground",
              )}
            >
              {value !== "all" && (
                <span
                  aria-hidden
                  className={cn(
                    "h-2 w-2 rounded-full",
                    active ? "bg-primary-foreground" : SEVERITY_DOT[value],
                  )}
                />
              )}
              {t(label)}
              <span className="tabular-nums opacity-70">{count}</span>
            </button>
          );
        })}
      </div>

      {/* Stats */}
      {/* Two columns on phones: four full-width tiles pushed the feed - the
          thing people came for - below the fold. */}
      <div className="stagger mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label={t("alerts.stat.total")} value={String(counts.total)} icon={Bell} />
        <StatCard
          label={t("alerts.sev.critical")}
          value={String(counts.critical)}
          tone={counts.critical > 0 ? SEVERITY_TEXT.critical : undefined}
          icon={ShieldAlert}
        />
        <StatCard
          label={t("alerts.sev.warning")}
          value={String(counts.warning)}
          tone={counts.warning > 0 ? SEVERITY_TEXT.warning : undefined}
          icon={Gauge}
        />
        <StatCard
          label={t("alerts.stat.unread")}
          value={String(unread)}
          tone={unread > 0 ? "text-[hsl(var(--gold))]" : undefined}
          icon={MessageSquare}
          accent={unread > 0}
        />
      </div>

      {/* Feed */}
      {loading ? (
        <div className="space-y-3">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            {t("alerts.loading")}
          </div>
          {[0, 1, 2, 3, 4].map((i) => (
            <div
              key={i}
              className="flex items-center gap-3 rounded-lg border bg-card p-3"
            >
              <Skeleton className="h-9 w-9 rounded-lg" />
              <div className="flex-1 space-y-2">
                <Skeleton className="h-4 w-40" />
                <Skeleton className="h-3 w-24" />
              </div>
              <Skeleton className="h-4 w-20" />
            </div>
          ))}
        </div>
      ) : days.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-2 p-10 text-center">
            <span className="flex h-11 w-11 items-center justify-center rounded-full bg-muted text-muted-foreground">
              <Bell className="h-5 w-5" />
            </span>
            <p className="text-sm font-medium">
              {t(hiddenByFilter ? "alerts.emptyFilter" : "alerts.empty")}
            </p>
            <p className="max-w-md text-sm text-muted-foreground">
              {t(hiddenByFilter ? "alerts.emptyFilterHint" : "alerts.emptyHint")}
            </p>
            {hiddenByFilter && (
              <Button
                size="sm"
                variant="outline"
                className="mt-1"
                onClick={() => setSeverity("all")}
              >
                {t("alerts.sev.all")}
              </Button>
            )}
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-6">
          {days.map((day) => (
            <section key={day.key}>
              <h2 className="sticky top-0 z-10 -mx-1 mb-2 bg-background/95 px-1 py-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground backdrop-blur">
                {day.label}
                <span className="ms-2 font-normal tabular-nums opacity-70">
                  {day.rows.length}
                </span>
              </h2>
              <div className="stagger space-y-2">
                {day.rows.map((row) => (
                  <EventItem
                    key={row.id}
                    row={row}
                    vehicle={deviceName(row.deviceId)}
                    geofence={geofenceLabel(row, geofences)}
                    unread={!isRead(read, row.id)}
                    now={now}
                    onOpen={() => openEvent(row.id)}
                    t={t}
                  />
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </>
  );
}
