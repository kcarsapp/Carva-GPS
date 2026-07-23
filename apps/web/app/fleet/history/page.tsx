"use client";

import * as React from "react";
import Link from "next/link";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";

import { PageHeader } from "@/components/dashboard/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useSession } from "@/lib/live-data";
import { useI18n } from "@/lib/i18n-provider";
import {
  knotsToKmh,
  type TraccarDevice,
  type TraccarPosition,
} from "@carva/shared";

// Same CARTO Voyager tiles as the live map.
const STREET_TILES = [
  "https://a.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}@2x.png",
  "https://b.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}@2x.png",
  "https://c.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}@2x.png",
];

type Period = "today" | "yesterday" | "week" | "month" | "custom";

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

/** Route line + start/end markers on a small maplibre map. */
function RouteMap({ positions }: { positions: TraccarPosition[] }) {
  const containerRef = React.useRef<HTMLDivElement>(null);
  const mapRef = React.useRef<maplibregl.Map | null>(null);
  const markersRef = React.useRef<maplibregl.Marker[]>([]);
  const [ready, setReady] = React.useState(false);

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
            attribution: "© OpenStreetMap contributors © CARTO",
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
    map.on("load", () => setReady(true));
    mapRef.current = map;
    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, []);

  React.useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;

    const coords = positions.map(
      (p) => [p.longitude, p.latitude] as [number, number],
    );
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const data: any = {
      type: "Feature",
      geometry: { type: "LineString", coordinates: coords },
      properties: {},
    };
    const src = map.getSource("route") as maplibregl.GeoJSONSource | undefined;
    if (src) {
      src.setData(data);
    } else {
      map.addSource("route", { type: "geojson", data });
      map.addLayer({
        id: "route-line",
        type: "line",
        source: "route",
        layout: { "line-cap": "round", "line-join": "round" },
        paint: { "line-color": "#3b82f6", "line-width": 3 },
      });
    }

    markersRef.current.forEach((m) => m.remove());
    markersRef.current = [];
    if (coords.length > 0) {
      markersRef.current.push(
        new maplibregl.Marker({ color: "#10b981" })
          .setLngLat(coords[0])
          .addTo(map),
        new maplibregl.Marker({ color: "#ef4444" })
          .setLngLat(coords[coords.length - 1])
          .addTo(map),
      );
      const b = new maplibregl.LngLatBounds();
      coords.forEach((c) => b.extend(c));
      map.fitBounds(b, { padding: 48, maxZoom: 15, duration: 0 });
    }
  }, [positions, ready]);

  return (
    <div
      ref={containerRef}
      className="h-[420px] w-full overflow-hidden rounded-xl border bg-muted sm:h-[480px]"
    />
  );
}

export default function TripHistoryPage() {
  const { t } = useI18n();
  const session = useSession();

  const [devices, setDevices] = React.useState<TraccarDevice[]>([]);
  const [deviceId, setDeviceId] = React.useState<string>("");
  const [period, setPeriod] = React.useState<Period>("today");
  const [customFrom, setCustomFrom] = React.useState("");
  const [customTo, setCustomTo] = React.useState("");
  const [positions, setPositions] = React.useState<TraccarPosition[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  // fixTime of the newest recorded position for the selected vehicle — used to
  // point the user at the data when the chosen period is empty.
  const [lastFix, setLastFix] = React.useState<string | null>(null);

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
      setLoading(true);
      setError(null);
      try {
        const qs = new URLSearchParams({
          deviceId,
          from: from.toISOString(),
          to: to.toISOString(),
        });
        const res = await fetch(`/api/traccar/positions?${qs}`, {
          cache: "no-store",
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        setPositions((await res.json()) as TraccarPosition[]);
      } catch (e) {
        setError(`${t("hist.loadErr")} ${(e as Error).message}`);
        setPositions([]);
      } finally {
        setLoading(false);
      }
    },
    [deviceId, t],
  );

  // Preset periods load automatically; custom waits for Apply.
  React.useEffect(() => {
    if (!deviceId || period === "custom") return;
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
  }, [deviceId, period, load]);

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

  const stats = React.useMemo(() => {
    if (positions.length < 2) return null;
    const first = positions[0];
    const last = positions[positions.length - 1];

    // Prefer Traccar's cumulative odometer; fall back to summed haversine.
    const d0 = num(first.attributes?.totalDistance);
    const d1 = num(last.attributes?.totalDistance);
    let distanceKm: number;
    if (d0 != null && d1 != null && d1 >= d0) {
      distanceKm = (d1 - d0) / 1000;
    } else {
      distanceKm = 0;
      for (let i = 1; i < positions.length; i++) {
        distanceKm += haversineKm(
          positions[i - 1].latitude,
          positions[i - 1].longitude,
          positions[i].latitude,
          positions[i].longitude,
        );
      }
    }

    const ms = +new Date(last.fixTime) - +new Date(first.fixTime);
    const mins = Math.max(0, Math.round(ms / 60000));
    const duration =
      mins >= 60
        ? `${Math.floor(mins / 60)} ${t("hist.hour")} ${mins % 60} ${t("hist.min")}`
        : `${mins} ${t("hist.min")}`;

    const topSpeed = Math.round(
      knotsToKmh(Math.max(...positions.map((p) => p.speed))),
    );

    return {
      distance: `${distanceKm.toFixed(1)} km`,
      duration,
      topSpeed: `${topSpeed} ${t("dash.kph")}`,
      points: String(positions.length),
    };
  }, [positions, t]);

  if (!session.loading && !session.authed) {
    return (
      <>
        <PageHeader title={t("hist.title")} description={t("hist.desc")} />
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
      <PageHeader title={t("hist.title")} description={t("hist.desc")} />

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
              onChange={(e) => setDeviceId(e.target.value)}
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

      {/* Stats */}
      {stats && (
        <div className="mb-4 grid grid-cols-2 gap-4 lg:grid-cols-4">
          {(
            [
              [t("hist.distance"), stats.distance],
              [t("hist.duration"), stats.duration],
              [t("hist.topSpeed"), stats.topSpeed],
              [t("hist.points"), stats.points],
            ] as [string, string][]
          ).map(([label, value]) => (
            <Card key={label}>
              <CardContent className="p-4">
                <p className="text-sm font-medium text-muted-foreground">
                  {label}
                </p>
                <p className="mt-1 text-2xl font-bold tracking-tight">
                  {value}
                </p>
              </CardContent>
            </Card>
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
                  timeZone: "Asia/Baghdad",
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

      <RouteMap positions={positions} />
    </>
  );
}
