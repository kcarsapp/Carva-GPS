"use client";

import { BarChart3 as PageIcon } from "lucide-react";
import * as React from "react";
import Link from "next/link";
import { Download, Loader2, Play } from "lucide-react";

import { PageHeader } from "@/components/dashboard/page-header";
import {
  DailyDistanceChart,
  ReportStatCards,
  ReportTable,
} from "@/components/dashboard/report-tables";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { useSession } from "@/lib/live-data";
import { useI18n } from "@/lib/i18n-provider";
import {
  REPORT_PATHS,
  buildCsv,
  dailyDistance,
  emptyReport,
  parseFleetLocal,
  presetRange,
  reportFileName,
  reportTable,
  statCards,
  toReportData,
  type DeviceLabel,
  type Period,
  type Range,
  type ReportData,
  type ReportKind,
} from "@/lib/reports";
import type { TraccarDevice, TraccarPosition } from "@carva/shared";
import { routeStats } from "@/lib/route-stats";

/**
 * Longest range whose distances are re-measured from the GPS route. A week of
 * one car is ~45k positions (~2 MB compressed) - fine; a month is ~200k and
 * too heavy to pull into a browser, so longer ranges keep Traccar's figures
 * and say so.
 */
const MEASURE_MAX_MS = 8 * 24 * 3600 * 1000;

/**
 * Replace Traccar's trip/summary distances with ones measured from the route.
 *
 * Traccar takes distance from a counter accumulated in ARRIVAL order; these
 * trackers upload buffered fixes late, so in time order it runs backwards and
 * trips come out as "-41.2 km" (see lib/route-stats.ts). Average speed is
 * derived from that distance, so it is recomputed too.
 */
/** Each vehicle's route for the span, keyed by device id. */
async function fetchRoutes(
  ids: string[],
  span: { from: Date; to: Date },
): Promise<Map<number, TraccarPosition[]>> {
  const routes = new Map<number, TraccarPosition[]>();
  await Promise.all(
    ids.map(async (id) => {
      const qs = new URLSearchParams({ deviceId: id, from: span.from.toISOString(), to: span.to.toISOString() });
      const res = await fetch(`/api/traccar/positions?${qs}`, { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const list = (await res.json()) as unknown;
      routes.set(Number(id), Array.isArray(list) ? (list as TraccarPosition[]) : []);
    }),
  );
  return routes;
}

function measureDistances(
  kind: ReportKind,
  rows: unknown[],
  routes: Map<number, TraccarPosition[]>,
  span: { from: Date; to: Date },
): unknown[] {
  return rows.map((raw) => {
    const row = raw as Record<string, unknown>;
    const route = routes.get(Number(row.deviceId));
    if (!route || route.length < 2) return row;
    const window =
      kind === "trips" && typeof row.startTime === "string" && typeof row.endTime === "string"
        ? { from: row.startTime, to: row.endTime }
        : { from: span.from, to: span.to };
    const r = routeStats(route, window);
    const durationMs =
      kind === "trips" && typeof row.duration === "number" ? row.duration : r.drivingMs;
    // knots = metres per hour / 1852
    const averageSpeed = durationMs > 0 ? r.distanceM / (durationMs / 3_600_000) / 1852 : 0;
    return { ...row, distance: r.distanceM, averageSpeed };
  });
}

/** Sentinel for the "All vehicles" option — Traccar takes repeated deviceId. */
const ALL = "all";

const TABS: [ReportKind, string][] = [
  ["summary", "rep.tab.summary"],
  ["trips", "rep.tab.trips"],
  ["stops", "rep.tab.stops"],
  ["events", "rep.tab.events"],
];

const PERIODS: [Period, string][] = [
  ["today", "rep.today"],
  ["yesterday", "rep.yesterday"],
  ["week", "rep.last7"],
  ["month", "rep.last30"],
  ["custom", "rep.custom"],
];

/** UTF-8 byte-order mark — without it Excel mangles Arabic/Kurdish headers. */
const BOM = String.fromCharCode(0xfeff);

/** Build the CSV in the browser and hand it to the download manager. */
function downloadCsv(fileName: string, csv: string) {
  const blob = new Blob([BOM, csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

export default function ReportsPage() {
  const { t } = useI18n();
  const session = useSession();

  const [devices, setDevices] = React.useState<TraccarDevice[]>([]);
  const [deviceId, setDeviceId] = React.useState<string>("");
  const [kind, setKind] = React.useState<ReportKind>("summary");
  // Whether distances on screen were measured from the route (short ranges)
  // or are Traccar's counter (long ranges) - the page says which.
  const [measured, setMeasured] = React.useState(true);
  const [period, setPeriod] = React.useState<Period>("today");
  const [customFrom, setCustomFrom] = React.useState("");
  const [customTo, setCustomTo] = React.useState("");
  const [range, setRange] = React.useState<Range | null>(null);
  const [data, setData] = React.useState<ReportData>(() =>
    emptyReport("summary"),
  );
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  // Keeps a slow response from overwriting a newer one.
  const requestRef = React.useRef(0);

  // Load the device list once signed in.
  React.useEffect(() => {
    if (!session.authed) return;
    let alive = true;
    fetch("/api/traccar/devices", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : []))
      .then((d: TraccarDevice[]) => {
        if (!alive) return;
        setDevices(d);
        if (d.length > 0) setDeviceId((prev) => prev || String(d[0].id));
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [session.authed]);

  // Trips and stops omit the device name when a single vehicle was requested.
  const deviceLabel = React.useCallback<DeviceLabel>(
    (id, name) => {
      if (name) return name;
      const device = devices.find((d) => d.id === id);
      return device?.name ?? "—";
    },
    [devices],
  );

  const load = React.useCallback(
    async (span: Range) => {
      const ids =
        deviceId === ALL
          ? devices.map((d) => String(d.id))
          : deviceId
            ? [deviceId]
            : [];
      if (ids.length === 0) return;

      const qs = new URLSearchParams();
      ids.forEach((id) => qs.append("deviceId", id));
      qs.set("from", span.from.toISOString());
      qs.set("to", span.to.toISOString());

      const request = ++requestRef.current;
      setLoading(true);
      setError(null);
      const measurable =
        (kind === "trips" || kind === "summary") && +span.to - +span.from <= MEASURE_MAX_MS;
      // Started now, alongside the report - not after it - so measuring adds
      // nothing to the wait (Traccar's trips report is the slow part).
      const routesP = measurable ? fetchRoutes(ids, span).catch(() => null) : null;
      try {
        const res = await fetch(`/api/traccar/${REPORT_PATHS[kind]}?${qs}`, {
          cache: "no-store",
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const payload = await res.json();
        if (request !== requestRef.current) return;
        let rows: unknown[] = Array.isArray(payload) ? payload : [];
        const routes = routesP ? await routesP : null;
        if (request !== requestRef.current) return;
        // No routes (failed download) keeps Traccar's figures rather than
        // failing the whole report.
        if (routes) rows = measureDistances(kind, rows, routes, span);
        setMeasured(routes != null || (kind !== "trips" && kind !== "summary"));
        setData(toReportData(kind, rows));
      } catch (e) {
        if (request !== requestRef.current) return;
        setError(`${t("rep.loadErr")} ${(e as Error).message}`);
        setData(emptyReport(kind));
      } finally {
        if (request === requestRef.current) setLoading(false);
      }
    },
    [deviceId, devices, kind, t],
  );

  // Preset periods resolve to an absolute range; custom waits for Apply.
  React.useEffect(() => {
    if (period === "custom") return;
    setRange(presetRange(period));
  }, [period]);

  // Drop the previous view's rows so they never render under new headers.
  React.useEffect(() => {
    setData(emptyReport(kind));
  }, [kind]);

  // Any change of range, vehicle or view refetches.
  React.useEffect(() => {
    if (!session.authed || !range) return;
    void load(range);
  }, [session.authed, range, load]);

  function applyCustom(e: React.FormEvent) {
    e.preventDefault();
    // The pickers are read as Baghdad wall-clock, matching every timestamp the
    // tables print — otherwise the window drifts by the viewer's UTC offset.
    const from = parseFleetLocal(customFrom);
    const to = parseFleetLocal(customTo);
    if (!from || !to || from >= to) {
      setError(t("rep.badRange"));
      return;
    }
    setError(null);
    setRange({ from, to });
  }

  const table = React.useMemo(
    () => reportTable(data, t, deviceLabel),
    [data, t, deviceLabel],
  );
  const cards = React.useMemo(() => statCards(data, t), [data, t]);
  const buckets = React.useMemo(
    () => (data.kind === "trips" ? dailyDistance(data.rows) : []),
    [data],
  );

  function exportCsv() {
    if (table.rows.length === 0) return;
    downloadCsv(reportFileName(data.kind, range), buildCsv(table));
  }

  if (!session.loading && !session.authed) {
    return (
      <>
        <PageHeader
        eyebrow={t("fleet.nav.group.analyze")}
        icon={PageIcon} title={t("rep.title")} description={t("rep.desc")} />
        <Card>
          <CardContent className="p-8 text-center text-sm text-muted-foreground">
            {t("rep.signin")}{" "}
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
        eyebrow={t("fleet.nav.group.analyze")}
        icon={PageIcon}
        title={t("rep.title")}
        description={t("rep.desc")}
        action={
          <Button
            size="sm"
            variant="outline"
            onClick={exportCsv}
            disabled={table.rows.length === 0}
          >
            <Download className="h-4 w-4" />
            {t("rep.export")}
          </Button>
        }
      />

      {error && (
        <div className="mb-4 rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-2 text-sm text-destructive">
          {error}
        </div>
      )}

      {!measured && (data.kind === "trips" || data.kind === "summary") && (
        <div className="mb-4 rounded-xl border border-amber-500/30 bg-amber-500/[0.07] px-4 py-2.5 text-sm text-amber-800 dark:text-amber-300">
          {t("rep.longRangeNote")}
        </div>
      )}

      {/* Report views */}
      <div className="mb-4 inline-flex flex-wrap rounded-lg border bg-card p-1">
        {TABS.map(([value, label]) => (
          <button
            key={value}
            type="button"
            aria-pressed={kind === value}
            onClick={() => setKind(value)}
            className={cn(
              "rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
              kind === value
                ? "bg-primary text-primary-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {t(label)}
          </button>
        ))}
      </div>

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

          {period === "custom" && (
            <form
              onSubmit={applyCustom}
              className="flex flex-wrap items-center gap-2"
            >
              <label className="flex items-center gap-1.5 text-sm text-muted-foreground">
                {t("rep.from")}
                <Input
                  type="datetime-local"
                  value={customFrom}
                  onChange={(e) => setCustomFrom(e.target.value)}
                  className="h-9 w-auto"
                />
              </label>
              <label className="flex items-center gap-1.5 text-sm text-muted-foreground">
                {t("rep.to")}
                <Input
                  type="datetime-local"
                  value={customTo}
                  onChange={(e) => setCustomTo(e.target.value)}
                  className="h-9 w-auto"
                />
              </label>
              <Button size="sm" type="submit">
                {t("rep.apply")}
              </Button>
              {/* The pickers are fleet time, not the viewer's — say so. */}
              <span className="text-xs text-muted-foreground">
                {t("rep.tzHint")}
              </span>
            </form>
          )}
        </CardContent>
      </Card>

      {session.authed && devices.length === 0 && (
        <p className="mb-4 text-sm text-muted-foreground">
          {t("rep.noVehicles")}
        </p>
      )}

      <ReportStatCards cards={cards} />

      <DailyDistanceChart
        title={t("rep.chart.daily")}
        unit={t("rep.unit.km")}
        buckets={buckets}
      />

      {loading ? (
        <Card>
          <CardContent className="flex items-center justify-center gap-2 p-10 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            {t("rep.loading")}
          </CardContent>
        </Card>
      ) : (
        <ReportTable
          data={table}
          empty={t(`rep.empty.${data.kind}`)}
          // Trips get a per-row replay that deep-links into the playback with
          // exactly that trip's window preselected.
          actionHeader={data.kind === "trips" ? t("rep.replay") : undefined}
          renderAction={
            data.kind === "trips"
              ? (i) => {
                  const trip = data.rows[i];
                  const device =
                    trip?.deviceId ?? (deviceId !== ALL ? Number(deviceId) : NaN);
                  if (!trip || !Number.isFinite(device)) return null;
                  const qs = new URLSearchParams({
                    device: String(device),
                    from: trip.startTime,
                    to: trip.endTime,
                    trip: "1",
                  });
                  // Deliberately a plain <a>, not next/link: the playback page
                  // reads its deep link from window.location.search during the
                  // first render, and a client-side navigation only rewrites
                  // the URL in the commit that follows — so a soft push would
                  // land on the default vehicle and period instead of this
                  // trip. A full navigation has the query string in place
                  // before anything renders.
                  return (
                    <a
                      href={`/fleet/history?${qs}`}
                      className="inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                    >
                      <Play className="h-3.5 w-3.5" />
                      {t("rep.replay")}
                    </a>
                  );
                }
              : undefined
          }
        />
      )}
    </>
  );
}
