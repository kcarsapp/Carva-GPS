"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Bell,
  ChevronsLeft,
  ChevronsRight,
  LogOut,
  Search,
  Truck,
  Wifi,
  WifiOff,
  X,
} from "lucide-react";

import { NAV } from "@/components/dashboard/sidebar";
import { AlertSeverityBadge } from "@/components/dashboard/status-badge";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { timeAgo } from "@/lib/status";
import { LanguageSwitcher, useI18n } from "@/lib/i18n-provider";
import type { CarvaRole, SessionUser } from "@/lib/live-data";
import type { Alert, FleetMetric, Vehicle, VehicleStatus } from "@/mock/types";

/* Floating "windows" that sit on top of the full-viewport fleet map.
   All of them share one glass surface so the map stays the hero. */

const glass =
  "rounded-2xl border bg-background/85 shadow-xl backdrop-blur-md";

const STATUS_DOT: Record<VehicleStatus, string> = {
  in_transit: "bg-emerald-500",
  idle: "bg-amber-500",
  maintenance: "bg-red-500",
  offline: "bg-slate-400",
};

function initials(name: string) {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? "")
    .join("");
}

/* ------------------------------ Command bar ------------------------------ */

export function CommandBar({
  authed,
  user,
  alertCount,
  onToggleAlerts,
  alertsOpen,
}: {
  authed: boolean;
  user: SessionUser | null;
  alertCount: number;
  onToggleAlerts: () => void;
  alertsOpen: boolean;
}) {
  const pathname = usePathname();
  const { t } = useI18n();
  const [busy, setBusy] = React.useState(false);
  const role: CarvaRole = user?.role ?? "company";

  async function signOut() {
    setBusy(true);
    try {
      await fetch("/api/auth/logout", { method: "POST" });
    } catch {
      /* drop cookie best-effort */
    }
    window.location.href = "/login";
  }

  return (
    <header
      className={cn(
        "absolute inset-x-3 top-3 z-30 flex items-center gap-2 px-3 py-2",
        glass,
      )}
    >
      <Link href="/" className="flex shrink-0 items-center gap-2">
        <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
          <Truck className="h-[18px] w-[18px]" />
        </span>
        <span className="hidden text-base font-bold tracking-tight lg:block">
          Carva Fleet
        </span>
      </Link>

      <span className="mx-1 hidden h-6 w-px shrink-0 bg-border sm:block" />

      <nav className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto">
        {NAV.filter((item) => item.roles.includes(role)).map((item) => {
          const active =
            item.href === "/fleet"
              ? pathname === "/fleet"
              : pathname.startsWith(item.href);
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              title={t(item.label)}
              className={cn(
                "flex shrink-0 items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-sm font-medium transition-colors",
                active
                  ? "bg-primary text-primary-foreground shadow-sm"
                  : "text-muted-foreground hover:bg-accent hover:text-foreground",
              )}
            >
              <Icon className="h-4 w-4" />
              <span className="hidden md:block">{t(item.label)}</span>
            </Link>
          );
        })}
      </nav>

      <Badge variant={authed ? "success" : "muted"} className="shrink-0">
        {authed ? (
          <>
            <Wifi className="h-3.5 w-3.5" /> {t("dash.live")}
          </>
        ) : (
          <>
            <WifiOff className="h-3.5 w-3.5" /> {t("fleet.badge.demo")}
          </>
        )}
      </Badge>

      <button
        type="button"
        onClick={onToggleAlerts}
        aria-label={t("fleet.recentAlerts")}
        title={t("fleet.recentAlerts")}
        className={cn(
          "relative flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border transition-colors",
          alertsOpen
            ? "bg-primary text-primary-foreground"
            : "bg-background text-muted-foreground hover:bg-accent hover:text-foreground",
        )}
      >
        <Bell className="h-4 w-4" />
        {alertCount > 0 && (
          <span className="absolute -end-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-bold text-destructive-foreground">
            {alertCount}
          </span>
        )}
      </button>

      <LanguageSwitcher className="hidden h-8 shrink-0 rounded-lg border bg-background px-2 text-xs text-foreground outline-none focus:border-primary sm:block" />

      {authed && user ? (
        <div className="flex shrink-0 items-center gap-1.5">
          <span
            title={`${user.name} · ${t(`fleet.role.${user.role}`)}`}
            className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary"
          >
            {initials(user.name)}
          </span>
          <button
            type="button"
            onClick={signOut}
            disabled={busy}
            aria-label={t("fleet.signout")}
            title={t("fleet.signout")}
            className="flex h-8 w-8 items-center justify-center rounded-lg border bg-background text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-50"
          >
            <LogOut className="h-4 w-4" />
          </button>
        </div>
      ) : (
        <Link
          href="/login"
          className="shrink-0 rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground shadow-sm"
        >
          {t("nav.signin")}
        </Link>
      )}
    </header>
  );
}

/* ----------------------------- Roster window ----------------------------- */

function StatTile({ metric }: { metric: FleetMetric }) {
  const { t } = useI18n();
  return (
    <div className="rounded-xl border bg-background/60 px-3 py-2">
      <p className="truncate text-[11px] font-medium text-muted-foreground">
        {t(metric.label)}
      </p>
      <p className="mt-0.5 text-xl font-semibold tracking-tight">
        {metric.value}
      </p>
    </div>
  );
}

export function RosterWindow({
  vehicles,
  metrics,
  selectedId,
  onSelect,
}: {
  vehicles: Vehicle[];
  metrics: FleetMetric[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  const { t } = useI18n();
  const [open, setOpen] = React.useState(true);
  const [query, setQuery] = React.useState("");

  // Phones start collapsed so the map is what you see first.
  React.useEffect(() => {
    if (window.innerWidth < 768) setOpen(false);
  }, []);

  const filtered = React.useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return vehicles;
    return vehicles.filter(
      (v) =>
        v.name.toLowerCase().includes(q) ||
        v.plate.toLowerCase().includes(q) ||
        v.location.toLowerCase().includes(q),
    );
  }, [vehicles, query]);

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={cn(
          "absolute start-3 top-[4.75rem] z-20 flex items-center gap-2 px-3 py-2 text-sm font-semibold",
          glass,
        )}
      >
        <ChevronsRight className="h-4 w-4 rtl:hidden" />
        <ChevronsLeft className="hidden h-4 w-4 rtl:block" />
        {t("fleet.vehicles")}
        <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs font-bold text-primary">
          {vehicles.length}
        </span>
      </button>
    );
  }

  return (
    <section
      className={cn(
        "absolute start-3 top-[4.75rem] z-20 flex max-h-[calc(100dvh-5.5rem)] w-[19rem] max-w-[calc(100vw-1.5rem)] flex-col overflow-hidden",
        glass,
      )}
    >
      <div className="flex items-center justify-between gap-2 border-b px-4 py-3">
        <div>
          <h1 className="text-sm font-bold tracking-tight">
            {t("fleet.overview.title")}
          </h1>
        </div>
        <button
          type="button"
          onClick={() => setOpen(false)}
          aria-label="Collapse panel"
          className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          <ChevronsLeft className="h-4 w-4 rtl:hidden" />
          <ChevronsRight className="hidden h-4 w-4 rtl:block" />
        </button>
      </div>

      <div className="grid grid-cols-2 gap-2 border-b p-3">
        {metrics.map((m) => (
          <StatTile key={m.id} metric={m} />
        ))}
      </div>

      <div className="border-b p-3">
        <div className="relative">
          <Search className="absolute start-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("dash.search")}
            className="w-full rounded-lg border bg-background py-1.5 pe-3 ps-8 text-sm outline-none placeholder:text-muted-foreground focus:border-primary"
          />
        </div>
      </div>

      <ul className="min-h-0 flex-1 divide-y overflow-y-auto">
        {filtered.length === 0 && (
          <li className="p-4 text-center text-sm text-muted-foreground">
            {t("fleet.noMatch")}
          </li>
        )}
        {filtered.map((v) => {
          const selected = v.id === selectedId;
          const stateText =
            v.status === "in_transit"
              ? `${v.speedKmh} ${t("dash.kph")}`
              : t(`fleet.status.${v.status}`);
          return (
            <li key={v.id}>
              <button
                type="button"
                onClick={() => onSelect(v.id)}
                className={cn(
                  "flex w-full items-center gap-3 px-4 py-2.5 text-start transition-colors",
                  selected ? "bg-primary/10" : "hover:bg-accent/60",
                )}
              >
                <span
                  className={cn(
                    "h-2.5 w-2.5 shrink-0 rounded-full",
                    STATUS_DOT[v.status],
                  )}
                  title={t(`fleet.status.${v.status}`)}
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold">
                    {v.name}
                  </span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {stateText} · {timeAgo(v.lastUpdated)}
                  </span>
                </span>
                {v.energyLevel > 0 && (
                  <span className="shrink-0 text-xs font-medium text-muted-foreground">
                    {v.energyLevel}%
                  </span>
                )}
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/* ----------------------------- Alerts window ----------------------------- */

export function AlertsPanel({
  alerts,
  authed,
  onClose,
}: {
  alerts: Alert[];
  authed: boolean;
  onClose: () => void;
}) {
  const { t } = useI18n();
  return (
    <section
      className={cn(
        "absolute end-3 top-[7.5rem] z-30 flex max-h-[min(26rem,calc(100vh-9rem))] w-[19rem] max-w-[calc(100vw-1.5rem)] flex-col overflow-hidden",
        glass,
      )}
    >
      <div className="flex items-center justify-between gap-2 border-b px-4 py-3">
        <div>
          <h2 className="text-sm font-bold tracking-tight">
            {t("fleet.recentAlerts")}
          </h2>
          <p className="text-[11px] text-muted-foreground">
            {authed ? t("dash.live") : t("fleet.last24")}
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-3">
        {alerts.length === 0 && (
          <p className="py-6 text-center text-sm text-muted-foreground">
            {t("fleet.noAlerts")}
          </p>
        )}
        {alerts.slice(0, 8).map((a) => (
          <div key={a.id} className="rounded-xl border bg-background/60 p-3">
            <div className="flex items-center justify-between gap-2">
              <AlertSeverityBadge severity={a.severity} />
              <span className="text-xs text-muted-foreground">
                {timeAgo(a.timestamp)}
              </span>
            </div>
            <p className="mt-1 text-sm font-medium leading-snug">{a.title}</p>
            <p className="text-xs text-muted-foreground">{a.description}</p>
          </div>
        ))}
      </div>
    </section>
  );
}
