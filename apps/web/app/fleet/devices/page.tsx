"use client";

import { Radio as PageIcon } from "lucide-react";
import * as React from "react";
import Link from "next/link";
import { Loader2, RefreshCw, Search, Wifi, WifiOff } from "lucide-react";

import { PageHeader } from "@/components/dashboard/page-header";
import {
  CopyButton,
  DevicePanel,
  DeviceStatusPill,
} from "@/components/dashboard/device-panel";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { useSession } from "@/lib/live-data";
import { useI18n } from "@/lib/i18n-provider";
import {
  formatAge,
  formatEngineHours,
  formatOdometer,
  formatVoltage,
} from "@/lib/format";
import {
  deriveHealth,
  getLatestPositions,
  listDevices,
  type DeviceHealth,
  type DeviceRecord,
} from "@/lib/devices-api";
import type { TraccarPosition } from "@carva/shared";

/**
 * /fleet/devices — every GPS tracker the account can see, with its live
 * health at a glance, and a side panel (dialog on phones) that shows the full
 * record and lets the operator manage it.
 */

/** List refresh cadence while the page is open. */
const REFRESH_MS = 15_000;

/** Below this width the panel opens as a dialog instead of a side column. */
const DESKTOP_QUERY = "(min-width: 1024px)";

interface DeviceRow {
  device: DeviceRecord;
  position: TraccarPosition | null;
  health: DeviceHealth;
}

function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = React.useState(false);
  React.useEffect(() => {
    const mq = window.matchMedia(query);
    const update = () => setMatches(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, [query]);
  return matches;
}

/** Online first, then quiet, then offline, then never-reported; names break ties. */
function rank(h: DeviceHealth): number {
  if (h.neverReported) return 3;
  if (h.online) return 0;
  if (h.status === "unknown") return 1;
  return 2;
}

function matches(d: DeviceRecord, q: string): boolean {
  if (!q) return true;
  const hay = [d.name, d.uniqueId, d.model, d.phone, d.contact, d.category]
    .filter((v): v is string => typeof v === "string" && v.length > 0)
    .join(" ")
    .toLowerCase();
  return hay.includes(q);
}

export default function DevicesPage() {
  const { t } = useI18n();
  const session = useSession();
  const desktop = useMediaQuery(DESKTOP_QUERY);

  const [devices, setDevices] = React.useState<DeviceRecord[] | null>(null);
  const [positions, setPositions] = React.useState<Map<number, TraccarPosition>>(
    () => new Map(),
  );
  const [error, setError] = React.useState<string | null>(null);
  const [refreshing, setRefreshing] = React.useState(false);
  const [refreshedAt, setRefreshedAt] = React.useState<number | null>(null);
  const [query, setQuery] = React.useState("");
  const [selectedId, setSelectedId] = React.useState<number | null>(null);
  // Re-derives ages every refresh so "4m ago" does not freeze between polls.
  const [now, setNow] = React.useState(() => Date.now());

  const load = React.useCallback(async () => {
    setRefreshing(true);
    try {
      const [d, p] = await Promise.all([listDevices(), getLatestPositions()]);
      setDevices(d);
      setPositions(p);
      setError(null);
      setRefreshedAt(Date.now());
    } catch (e) {
      setError(`${t("dev.loadErr")} ${(e as Error).message}`);
      // Keep whatever list we already had; only a first load leaves it null.
      setDevices((prev) => prev ?? []);
    } finally {
      // Ages advance even when the poll failed, so a stale list reads as stale.
      setNow(Date.now());
      setRefreshing(false);
    }
  }, [t]);

  // Poll while signed in and the page is open. A hidden tab skips the fetch
  // but keeps the timer, so it catches up on the next tick after focus.
  React.useEffect(() => {
    if (!session.authed) return;
    let alive = true;
    const run = () => {
      if (!alive) return;
      if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
      void load();
    };
    run();
    const timer = window.setInterval(run, REFRESH_MS);
    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, [session.authed, load]);

  const rows = React.useMemo<DeviceRow[]>(() => {
    const q = query.trim().toLowerCase();
    return (devices ?? [])
      .filter((d) => matches(d, q))
      .map((d) => {
        const position = positions.get(d.id) ?? null;
        return { device: d, position, health: deriveHealth(d, position, now) };
      })
      .sort((a, b) => rank(a.health) - rank(b.health) || a.device.name.localeCompare(b.device.name));
  }, [devices, positions, query, now]);

  const selected = React.useMemo(() => {
    if (selectedId == null || !devices) return null;
    const d = devices.find((x) => x.id === selectedId);
    if (!d) return null;
    const position = positions.get(d.id) ?? null;
    return { device: d, position, health: deriveHealth(d, position, now) };
  }, [selectedId, devices, positions, now]);

  const onDeviceUpdated = React.useCallback((record: DeviceRecord) => {
    setDevices((prev) =>
      prev ? prev.map((d) => (d.id === record.id ? { ...d, ...record } : d)) : prev,
    );
  }, []);

  const counts = React.useMemo(() => {
    const all = (devices ?? []).map((d) => deriveHealth(d, positions.get(d.id) ?? null, now));
    return {
      total: all.length,
      online: all.filter((h) => h.online).length,
      never: all.filter((h) => h.neverReported).length,
    };
  }, [devices, positions, now]);

  if (!session.loading && !session.authed) {
    return (
      <>
        <PageHeader
        eyebrow={t("fleet.nav.group.manage")}
        icon={PageIcon} title={t("dev.title")} description={t("dev.desc")} />
        <Card>
          <CardContent className="p-8 text-center text-sm text-muted-foreground">
            {t("dev.signin")}{" "}
            <Link href="/login" className="font-medium text-primary hover:underline">
              {t("nav.signin")}
            </Link>
          </CardContent>
        </Card>
      </>
    );
  }

  const loading = session.loading || devices === null;
  const panelOpen = selected !== null;

  const panel = selected && (
    <DevicePanel
      device={selected.device}
      position={selected.position}
      health={selected.health}
      onDeviceUpdated={onDeviceUpdated}
      onRefresh={load}
      onClose={() => setSelectedId(null)}
    />
  );

  return (
    <>
      <PageHeader
        eyebrow={t("fleet.nav.group.manage")}
        icon={PageIcon}
        title={t("dev.title")}
        description={t("dev.desc")}
        action={
          <div className="flex items-center gap-2">
            {refreshedAt && (
              <span className="text-xs text-muted-foreground">
                {t("dev.updated")} {formatAge(new Date(refreshedAt).toISOString(), now)}
              </span>
            )}
            <Button size="sm" variant="outline" onClick={() => void load()} disabled={refreshing}>
              {refreshing ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <RefreshCw className="h-4 w-4" />
              )}
              {t("dev.refresh")}
            </Button>
          </div>
        }
      />

      {error && (
        <div className="mb-4 rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-2 text-sm text-destructive">
          {error}
        </div>
      )}

      {/* Toolbar */}
      <Card className="mb-4">
        <CardContent className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
          <label className="relative block w-full sm:max-w-xs">
            <Search className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t("dev.searchPh")}
              aria-label={t("dev.search")}
              className="h-9 ps-9"
            />
          </label>
          {!loading && (
            <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <Badge variant="success">
                <Wifi className="h-3 w-3" />
                {counts.online} {t("dev.status.online")}
              </Badge>
              <Badge variant="muted">
                <WifiOff className="h-3 w-3" />
                {counts.total - counts.online - counts.never} {t("dev.status.offline")}
              </Badge>
              {counts.never > 0 && (
                <Badge variant="muted">
                  {counts.never} {t("dev.status.never")}
                </Badge>
              )}
              <span>
                {t("dev.count").replace("{n}", String(counts.total))}
              </span>
            </div>
          )}
        </CardContent>
      </Card>

      <div
        className={cn(
          "flex flex-col gap-4",
          panelOpen && "lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(400px,440px)] lg:items-start xl:grid-cols-[minmax(0,1fr)_480px]",
        )}
      >
        {/* Device list */}
        <div className="min-w-0">
          {loading ? (
            <div className="grid gap-3 md:grid-cols-2">
              {Array.from({ length: 4 }).map((_, i) => (
                <Card key={i}>
                  <CardContent className="space-y-3 p-4">
                    <div className="flex items-center justify-between">
                      <Skeleton className="h-5 w-32" />
                      <Skeleton className="h-5 w-16 rounded-full" />
                    </div>
                    <Skeleton className="h-3 w-48" />
                    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                      {Array.from({ length: 8 }).map((_, j) => (
                        <Skeleton key={j} className="h-9 w-full" />
                      ))}
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          ) : rows.length === 0 ? (
            <Card>
              <CardContent className="p-8 text-center text-sm text-muted-foreground">
                {devices && devices.length === 0 ? t("dev.empty") : t("dev.noMatch")}
              </CardContent>
            </Card>
          ) : (
            <div className={cn("grid gap-3", panelOpen ? "xl:grid-cols-2" : "md:grid-cols-2")}>
              {rows.map((row) => (
                <DeviceCard
                  key={row.device.id}
                  row={row}
                  selected={row.device.id === selectedId}
                  onSelect={() => setSelectedId(row.device.id)}
                />
              ))}
            </div>
          )}
        </div>

        {/* Desktop: side panel. Phones: dialog. */}
        {panelOpen && desktop && (
          <Card className="lg:sticky lg:top-6 lg:h-[calc(100dvh-3rem)] lg:overflow-hidden">
            {panel}
          </Card>
        )}
      </div>

      <Dialog open={panelOpen && !desktop} onOpenChange={(open) => !open && setSelectedId(null)}>
        <DialogContent className="max-h-[90vh] p-0">{panel}</DialogContent>
      </Dialog>
    </>
  );
}

/* ------------------------------- Device card ------------------------------- */

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: React.ReactNode;
  tone?: "good" | "bad" | "warn" | "muted";
}) {
  return (
    <div className="min-w-0 rounded-md bg-muted/40 px-2 py-1.5">
      <div className="truncate text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      <div
        className={cn(
          "truncate text-sm font-medium tabular-nums",
          tone === "good" && "text-emerald-600 dark:text-emerald-400",
          tone === "bad" && "text-red-600 dark:text-red-400",
          tone === "warn" && "text-amber-600 dark:text-amber-400",
          tone === "muted" && "text-muted-foreground",
        )}
      >
        {value}
      </div>
    </div>
  );
}

function DeviceCard({
  row,
  selected,
  onSelect,
}: {
  row: DeviceRow;
  selected: boolean;
  onSelect: () => void;
}) {
  const { t } = useI18n();
  const { device, position, health } = row;
  const [copied, setCopied] = React.useState(false);
  const timer = React.useRef<number | undefined>(undefined);
  React.useEffect(() => () => window.clearTimeout(timer.current), []);

  function copyUid(text: string) {
    navigator.clipboard
      ?.writeText(text)
      .then(() => {
        setCopied(true);
        window.clearTimeout(timer.current);
        timer.current = window.setTimeout(() => setCopied(false), 1500);
      })
      .catch(() => {});
  }

  const lastFix = position
    ? (() => {
        const age = formatAge(position.fixTime);
        return age === "now" ? t("dev.age.now") : t("dev.age.ago").replace("{age}", age);
      })()
    : t("dev.status.never");

  const gps =
    health.gpsFix == null
      ? "—"
      : `${t(health.gpsFix ? "dev.gps.fix" : "dev.gps.noFix")}${
          health.satellites != null ? ` · ${health.satellites} ${t("dev.sats")}` : ""
        }`;

  const signal = health.signal
    ? `${t(`detail.sig.${health.signal}`)}${health.rssi != null ? ` (${health.rssi})` : ""}`
    : "—";

  const power =
    health.powerConnected == null
      ? "—"
      : `${formatVoltage(health.voltage)} · ${t(health.powerConnected ? "dev.powerOn" : "dev.powerOff")}`;

  const relay =
    health.relayCut == null ? "—" : t(health.relayCut ? "dev.relayCut" : "dev.relayFlowing");

  return (
    <Card
      role="button"
      tabIndex={0}
      aria-pressed={selected}
      onClick={onSelect}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onSelect();
        }
      }}
      className={cn(
        "cursor-pointer transition-colors hover:bg-accent/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        selected && "ring-2 ring-primary",
        device.disabled && "opacity-70",
      )}
    >
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="truncate text-sm font-semibold">{device.name}</span>
              {device.disabled && (
                <Badge variant="warning" className="px-1.5 py-0 text-[10px]">
                  {t("dev.disabledBadge")}
                </Badge>
              )}
            </div>
            <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
              <span>{device.model || t("dev.unknownModel")}</span>
              <span aria-hidden>·</span>
              <span className="inline-flex items-center gap-0.5 font-mono" dir="ltr">
                {device.uniqueId}
                <CopyButton
                  text={device.uniqueId}
                  copied={copied}
                  onCopy={copyUid}
                  label={t("dev.copy")}
                  className="h-5 w-5"
                />
              </span>
            </div>
          </div>
          <DeviceStatusPill health={health} />
        </div>

        <div className="mt-3 grid grid-cols-2 gap-1.5 sm:grid-cols-4">
          <Stat
            label={t("dev.col.lastFix")}
            value={lastFix}
            tone={health.neverReported ? "muted" : health.staleFix ? "warn" : undefined}
          />
          <Stat
            label={t("dev.col.gps")}
            value={gps}
            tone={health.gpsFix == null ? undefined : health.gpsFix ? "good" : "warn"}
          />
          <Stat
            label={t("dev.col.signal")}
            value={signal}
            tone={health.signal === "poor" ? "bad" : health.signal === "fair" ? "warn" : undefined}
          />
          <Stat
            label={t("dev.col.power")}
            value={power}
            tone={
              health.powerConnected == null ? undefined : health.powerConnected ? "good" : "bad"
            }
          />
          <Stat
            label={t("dev.col.relay")}
            value={relay}
            tone={health.relayCut == null ? undefined : health.relayCut ? "bad" : "good"}
          />
          <Stat label={t("dev.col.odometer")} value={formatOdometer(health.totalDistance)} />
          <Stat label={t("dev.col.hours")} value={formatEngineHours(health.engineHours)} />
          <Stat
            label={t("dev.col.ignition")}
            value={health.ignition == null ? "—" : t(health.ignition ? "dev.on" : "dev.off")}
            tone={health.ignition ? "good" : undefined}
          />
        </div>
      </CardContent>
    </Card>
  );
}
