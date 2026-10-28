"use client";

import * as React from "react";
import Link from "next/link";
import {
  Bell,
  Car,
  ChevronDown,
  ChevronsLeft,
  ChevronsRight,
  ArrowDownUp,
  Maximize2,
  LogOut,
  RefreshCw,
  Search,
  Wifi,
  WifiOff,
  X,
} from "lucide-react";

import {
  AlertSeverityBadge,
  SignalWarning,
  VehicleStatusBadge,
} from "@/components/dashboard/status-badge";
import { DeviceControls } from "@/components/dashboard/device-controls";
import { VehicleWindow } from "@/components/dashboard/vehicle-window";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { timeAgo } from "@/lib/status";
import { cardinal, formatVoltage } from "@/lib/format";
import { readTelemetry } from "@/lib/capabilities";
import { ThemeToggle } from "@/lib/theme-provider";
import { LanguageSwitcher, useI18n } from "@/lib/i18n-provider";
import type { FleetTransport, SessionUser } from "@/lib/live-data";
import type { Alert, FleetMetric, Vehicle, VehicleStatus } from "@/mock/types";

/* Floating "windows" that sit on top of the full-viewport fleet map.
   All of them share one glass surface so the map stays the hero. */

// The design system's liquid glass (app/fleet.css): translucent, top-lit,
// with a soft reflection - and opaque where backdrop-filter is unsupported.
const glass = "rounded-2xl glass glass-sheen";

/** Car avatar tint per status - the colour IS the state, readable at a glance. */
const STATUS_AVATAR: Record<VehicleStatus, string> = {
  in_transit: "bg-emerald-500/10 text-emerald-600 ring-emerald-500/25 dark:text-emerald-400",
  idle: "bg-amber-500/10 text-amber-600 ring-amber-500/25 dark:text-amber-400",
  maintenance: "bg-red-500/10 text-red-600 ring-red-500/25 dark:text-red-400",
  unknown: "bg-sky-500/10 text-sky-600 ring-sky-500/25 dark:text-sky-400",
  offline: "bg-muted text-muted-foreground ring-border",
};

const STATUS_DOT: Record<VehicleStatus, string> = {
  in_transit: "bg-emerald-500",
  idle: "bg-amber-500",
  maintenance: "bg-red-500",
  unknown: "bg-sky-400",
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
  metrics,
  alertCount,
  onToggleAlerts,
  alertsOpen,
  transport = "live",
}: {
  authed: boolean;
  user: SessionUser | null;
  /** Live fleet totals, shown inline where the duplicate nav used to be. */
  metrics: FleetMetric[];
  alertCount: number;
  onToggleAlerts: () => void;
  alertsOpen: boolean;
  /** How the data is arriving, so the badge can say so honestly. */
  transport?: FleetTransport;
}) {
  const { t } = useI18n();
  const [busy, setBusy] = React.useState(false);

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
        "fade-in absolute inset-x-3 top-3 z-30 flex items-center gap-2 px-2.5 py-2",
        glass,
      )}
    >
      {/* Navigation lives in the sidebar on every route, so this bar carries
          live fleet totals instead of a second copy of the menu. On a phone
          they scroll sideways and fade out at the edge rather than being
          cut mid-word. */}
      <div className="stagger flex min-w-0 flex-1 items-center gap-1.5 overflow-x-auto [mask-image:linear-gradient(to_right,#000_85%,transparent)] [scrollbar-width:none] md:[mask-image:none] rtl:[mask-image:linear-gradient(to_left,#000_85%,transparent)] rtl:md:[mask-image:none]">
        {metrics.filter((m) => m.value !== "—" && m.value !== "").map((metric, i) => (
          <div
            key={metric.id}
            className={cn(
              "flex shrink-0 items-baseline gap-1.5 rounded-lg border bg-background/60 px-2.5 py-1",
              // The headline figure (active vehicles) wears the gold.
              i === 0 && "border-primary/30 bg-primary/10",
            )}
          >
            <span
              className={cn(
                "num text-sm font-semibold leading-none",
                i === 0 && "text-[hsl(var(--gold))]",
              )}
            >
              {metric.value}
            </span>
            <span className="whitespace-nowrap text-[11px] text-muted-foreground">
              {t(metric.label)}
            </span>
          </div>
        ))}
      </div>

      {/* Push, poll or demo - an operator deciding whether to trust a marker
          needs to know which. "Live" means Traccar is streaming it the instant
          it lands; "Polling" means the socket is down and the map can be up to
          five seconds behind. */}
      <Badge
        variant={!authed ? "muted" : transport === "live" ? "success" : "warning"}
        className="shrink-0"
        title={transport === "polling" ? t("fleet.badge.polling.hint") : undefined}
      >
        {!authed ? (
          <>
            <WifiOff className="h-3.5 w-3.5" /> {t("fleet.badge.demo")}
          </>
        ) : transport === "live" ? (
          <>
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-current opacity-75" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-current" />
            </span>
            {t("dash.live")}
          </>
        ) : transport === "connecting" ? (
          <>
            <Wifi className="h-3.5 w-3.5 animate-pulse" />{" "}
            {t("fleet.badge.connecting")}
          </>
        ) : (
          <>
            <RefreshCw className="h-3.5 w-3.5" /> {t("fleet.badge.polling")}
          </>
        )}
      </Badge>

      <button
        type="button"
        onClick={onToggleAlerts}
        aria-label={t("fleet.recentAlerts")}
        aria-expanded={alertsOpen}
        title={t("fleet.recentAlerts")}
        className={cn(
          "press relative flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border",
          alertsOpen
            ? "border-primary bg-primary text-primary-foreground"
            : "bg-background/70 text-muted-foreground hover:bg-accent hover:text-foreground",
        )}
      >
        <Bell className="h-4 w-4" />
        {alertCount > 0 && (
          <span className="absolute -end-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-bold text-destructive-foreground">
            {alertCount}
          </span>
        )}
      </button>

      {/* Theme, language and account also live in the phone's top bar and
          "More" sheet, so on small screens they step aside for the figures. */}
      <ThemeToggle className="press hidden h-9 w-9 shrink-0 items-center justify-center rounded-lg border bg-background/70 text-muted-foreground hover:bg-accent hover:text-foreground md:flex" />

      <LanguageSwitcher className="hidden h-9 shrink-0 rounded-lg border bg-background/70 px-2 text-xs text-foreground outline-none focus:border-primary lg:block" />

      {authed && user ? (
        <div className="hidden shrink-0 items-center gap-1.5 md:flex">
          <span
            title={`${user.name} · ${t(`fleet.role.${user.role}`)}`}
            className="flex h-9 w-9 items-center justify-center rounded-full bg-primary/15 text-xs font-semibold text-[hsl(var(--gold))] ring-1 ring-primary/30"
          >
            {initials(user.name)}
          </span>
          <button
            type="button"
            onClick={signOut}
            disabled={busy}
            aria-label={t("fleet.signout")}
            title={t("fleet.signout")}
            className="press flex h-9 w-9 items-center justify-center rounded-lg border bg-background/70 text-muted-foreground hover:bg-destructive/10 hover:text-destructive disabled:opacity-50"
          >
            <LogOut className="h-4 w-4" />
          </button>
        </div>
      ) : null /* the logged-out demo shows its Demo badge only - no sign-in, no offer */}
    </header>
  );
}

/* ----------------------------- Roster window ----------------------------- */

/** How the roster is ordered. "status" surfaces the vehicles you can act on. */
type SortKey = "status" | "name" | "speed" | "updated" | "battery";
const SORT_KEYS: readonly SortKey[] = [
  "status",
  "name",
  "speed",
  "updated",
  "battery",
];

/** Compact sensor/location details that expand inline under a roster row. */
function InlineDetail({
  vehicle,
  canControl,
}: {
  vehicle: Vehicle;
  canControl: boolean;
}) {
  const { t } = useI18n();
  const ignition =
    vehicle.ignition == null ? null : vehicle.ignition ? "ON" : "OFF";

  const attrs = (vehicle.attributes ?? {}) as Record<string, unknown>;
  // A compass direction only while moving; parked GPS reports 0, not north.
  const power = typeof attrs.power === "number" ? attrs.power : undefined;
  // Live while moving; otherwise the last direction it was travelling, so a
  // parked car still tells you which way it is facing.
  const direction = `${cardinal(vehicle.heading)} · ${Math.round(vehicle.heading)}°`;

  const sensors: { label: string; value: string; tone?: "on" | "off" }[] = [
    { label: t("detail.speed"), value: `${vehicle.speedKmh} km/h` },
    {
      label: t("detail.ignition"),
      value: ignition ? t(`detail.${ignition === "ON" ? "on" : "off"}`) : "—",
      tone: ignition === "ON" ? "on" : ignition === "OFF" ? "off" : undefined,
    },
    // Charging moved to the vehicle window (it belongs with power/voltage);
    // the supply voltage is the reading that actually matters here.
    { label: t("detail.voltage"), value: formatVoltage(power) },
    {
      label: t("detail.gsm"),
      value: vehicle.gsm != null ? String(vehicle.gsm) : "—",
    },
    { label: t("detail.direction"), value: direction },
  ];

  const telemetry = readTelemetry(vehicle.attributes);
  const showControls = canControl && vehicle.deviceId != null;

  return (
    <div className="border-t bg-background/50">
      <SignalWarning vehicle={vehicle} />

      <div className="flex items-center justify-between gap-2 px-4 pt-2.5">
        <VehicleStatusBadge status={vehicle.status} />
        <span className="text-[11px] text-muted-foreground">
          {vehicle.lastUpdated ? `${t("detail.lastSeen")} ${timeAgo(vehicle.lastUpdated)}` : t("fleet.neverReported")}
        </span>
      </div>

      <div className="grid grid-cols-3 gap-x-3 gap-y-2 px-4 py-2.5">
        {sensors.map((s) => (
          <div key={s.label}>
            <p className="text-[10px] text-muted-foreground">{s.label}</p>
            <p
              className={cn(
                "text-xs font-semibold tabular-nums",
                s.tone === "on" && "text-emerald-600",
                s.tone === "off" && "text-red-500",
              )}
            >
              {s.value}
            </p>
          </div>
        ))}
      </div>

      <div className="px-4 pb-2.5">
        <p className="text-[10px] text-muted-foreground">
          {vehicle.signalIssue && vehicle.signalIssue !== "never"
            ? t("detail.lastKnownLocation")
            : t("detail.location")}
        </p>
        <p className="text-xs leading-snug">{vehicle.location}</p>
        {vehicle.lat != null && vehicle.lng != null && (
          <p className="mt-0.5 text-[11px] tabular-nums text-muted-foreground">
            {vehicle.lat.toFixed(4)}, {vehicle.lng.toFixed(4)}
          </p>
        )}
      </div>

      {showControls && (
        <DeviceControls
          deviceId={vehicle.deviceId!}
          deviceName={vehicle.name}
          telemetry={telemetry}
          deviceAttributes={vehicle.deviceAttributes}
        />
      )}
    </div>
  );
}

export function RosterWindow({
  vehicles,
  selectedId,
  onSelect,
  canControl = false,
}: {
  vehicles: Vehicle[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  /** Show live device controls inside the expanded row (logged-in only). */
  canControl?: boolean;
}) {
  const { t } = useI18n();
  // Collapsed by default on every screen: the map is the point, and the
  // vehicle's own details now live in the callout pinned to its icon.
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState("");
  const [sort, setSort] = React.useState<SortKey>("status");
  /** The vehicle whose full window is open, if any. */
  const [windowId, setWindowId] = React.useState<string | null>(null);
  const itemRefs = React.useRef<Map<string, HTMLLIElement>>(new Map());

  // Selecting a vehicle scrolls its row into view, but does NOT force the panel
  // open — picking a car on the map should not cover the map with the list.
  React.useEffect(() => {
    if (!selectedId || !open) return;
    const timer = setTimeout(() => {
      itemRefs.current
        .get(selectedId)
        ?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }, 320);
    return () => clearTimeout(timer);
  }, [selectedId, open]);

  // Keep the detail content mounted while its row animates shut, so the
  // collapse is as smooth as the expand.
  const [renderId, setRenderId] = React.useState<string | null>(null);
  React.useEffect(() => {
    if (selectedId) {
      setRenderId(selectedId);
      return;
    }
    const timer = setTimeout(() => setRenderId(null), 320);
    return () => clearTimeout(timer);
  }, [selectedId]);

  const filtered = React.useMemo(() => {
    const q = query.trim().toLowerCase();
    const matched = !q
      ? vehicles.slice()
      : vehicles.filter(
          (v) =>
            v.name.toLowerCase().includes(q) ||
            v.plate.toLowerCase().includes(q) ||
            v.location.toLowerCase().includes(q),
        );

    // "Status" puts the vehicles you can act on first: moving, then idle, then
    // whatever is offline — which is what an operator scans for.
    const rank: Record<VehicleStatus, number> = {
      in_transit: 0,
      idle: 1,
      unknown: 2,
      maintenance: 3,
      offline: 4,
    };
    const byName = (a: Vehicle, b: Vehicle) =>
      a.name.localeCompare(b.name, undefined, { numeric: true });

    switch (sort) {
      case "name":
        return matched.sort(byName);
      case "speed":
        return matched.sort((a, b) => b.speedKmh - a.speedKmh || byName(a, b));
      case "updated":
        return matched.sort(
          (a, b) =>
            +new Date(b.lastUpdated) - +new Date(a.lastUpdated) || byName(a, b),
        );
      case "battery":
        return matched.sort(
          (a, b) => (b.energyLevel ?? 0) - (a.energyLevel ?? 0) || byName(a, b),
        );
      default:
        return matched.sort(
          (a, b) => rank[a.status] - rank[b.status] || byName(a, b),
        );
    }
  }, [vehicles, query, sort]);

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-expanded={false}
        className={cn(
          "press slide-from-start absolute start-3 top-[4.75rem] z-20 flex h-10 items-center gap-2 px-3 text-sm font-semibold",
          glass,
        )}
      >
        <ChevronsRight className="h-4 w-4 rtl:hidden" />
        <ChevronsLeft className="hidden h-4 w-4 rtl:block" />
        {t("fleet.vehicles")}
        <span className="num rounded-full bg-primary/15 px-2 py-0.5 text-xs font-bold text-[hsl(var(--gold))]">
          {vehicles.length}
        </span>
      </button>
    );
  }

  return (
    <section
      className={cn(
        "slide-from-start absolute start-3 top-[4.75rem] z-20 flex max-h-[calc(100%-5.5rem)] w-[19rem] max-w-[calc(100%-5.25rem)] flex-col overflow-hidden",
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


      <div className="space-y-2 border-b p-3">
        <div className="relative">
          <Search className="absolute start-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("dash.search")}
            className="w-full rounded-lg border bg-background py-1.5 pe-3 ps-8 text-sm outline-none placeholder:text-muted-foreground focus:border-primary"
          />
        </div>
        <div className="flex items-center gap-2">
          <ArrowDownUp className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          <select
            value={sort}
            onChange={(e) => setSort(e.target.value as SortKey)}
            aria-label={t("fleet.sortBy")}
            className="h-8 min-w-0 flex-1 rounded-lg border bg-background px-2 text-xs text-foreground outline-none focus:border-primary"
          >
            {SORT_KEYS.map((key) => (
              <option key={key} value={key}>
                {t(`fleet.sort.${key}`)}
              </option>
            ))}
          </select>
        </div>
      </div>

      <ul className="stagger min-h-0 flex-1 divide-y overflow-y-auto">
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
          // Once the position is the untrustworthy part, quoting the packet's
          // age is worse than useless: a tracker draining a day-old backlog
          // arrives "just now" every minute. Show when the fix was RECORDED.
          const stale = v.signalIssue === "delayed";
          const fixAge = timeAgo(v.lastFixAt);
          const ageText =
            stale && fixAge
              ? t("fleet.recordedAge").replace("{age}", fixAge)
              : v.lastUpdated
                ? timeAgo(v.lastUpdated)
                : t("fleet.neverReported");
          return (
            <li
              key={v.id}
              ref={(el) => {
                if (el) itemRefs.current.set(v.id, el);
                else itemRefs.current.delete(v.id);
              }}
            >
              <button
                type="button"
                onClick={() => onSelect(v.id)}
                aria-expanded={selected}
                className={cn(
                  "group relative flex w-full items-center gap-3 px-3.5 py-2.5 text-start transition-colors duration-200",
                  selected ? "bg-primary/[0.08]" : "hover:bg-accent/60",
                )}
              >
                {/* Selection marker grows in from the leading edge. */}
                <span
                  className={cn(
                    "absolute inset-y-2 start-0 w-[3px] origin-center rounded-full bg-primary transition-transform duration-200 ease-out",
                    selected ? "scale-y-100" : "scale-y-0",
                  )}
                />
                <span
                  className={cn(
                    "relative flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ring-1 transition-transform duration-200 group-hover:scale-[1.04]",
                    STATUS_AVATAR[v.status],
                  )}
                  title={t(`fleet.status.${v.status}`)}
                >
                  <Car className="h-[18px] w-[18px]" />
                  <span
                    className={cn(
                      "absolute -bottom-0.5 -end-0.5 h-2.5 w-2.5 rounded-full ring-2 ring-card",
                      STATUS_DOT[v.status],
                    )}
                  />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold">
                    {v.name}
                  </span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {v.status === "in_transit" ? ageText : `${stateText} · ${ageText}`}
                  </span>
                </span>
                {v.status === "in_transit" && (
                  <span className="num shrink-0 rounded-lg bg-emerald-500/10 px-2 py-0.5 text-xs font-semibold text-emerald-700 dark:text-emerald-300">
                    {v.speedKmh}
                    <span className="ms-0.5 text-[10px] font-medium opacity-75">{t("dash.kph")}</span>
                  </span>
                )}
                {v.energyLevel > 0 && (
                  <span className="shrink-0 text-xs font-medium text-muted-foreground">
                    {v.energyLevel}%
                  </span>
                )}
                {/* Opens the full window: readings, controls, trips, alerts.
                    A span (not a button) — this sits inside the row button. */}
                <span
                  role="button"
                  tabIndex={0}
                  title={t("veh.openWindow")}
                  aria-label={t("veh.openWindow")}
                  onClick={(e) => {
                    e.stopPropagation();
                    setWindowId(v.id);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      e.stopPropagation();
                      setWindowId(v.id);
                    }
                  }}
                  className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                >
                  <Maximize2 className="h-3.5 w-3.5" />
                </span>
                <ChevronDown
                  className={cn(
                    "h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-300",
                    selected && "rotate-180",
                  )}
                />
              </button>

              {/* Accordion: grid-rows 0fr→1fr animates height smoothly without
                  measuring content; motion-reduce users get an instant swap. */}
              <div
                className={cn(
                  "grid transition-[grid-template-rows,opacity] duration-300 ease-out motion-reduce:transition-none",
                  selected
                    ? "grid-rows-[1fr] opacity-100"
                    : "grid-rows-[0fr] opacity-0",
                )}
                aria-hidden={!selected}
              >
                <div className="min-h-0 overflow-hidden">
                  {(selected || v.id === renderId) && (
                    <InlineDetail vehicle={v} canControl={canControl} />
                  )}
                </div>
              </div>
            </li>
          );
        })}
      </ul>

      {/* Everything-you-can-do window for one vehicle, in a portal above the map. */}
      <VehicleWindow
        vehicle={vehicles.find((v) => v.id === windowId) ?? null}
        open={windowId !== null}
        onOpenChange={(next) => !next && setWindowId(null)}
        canControl={canControl}
      />
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
    // Drops from the bell; on wider screens it sits beside the map-control
    // column instead of on top of it.
    <section
      className={cn(
        "pop absolute end-3 top-[4.75rem] z-30 flex max-h-[min(26rem,calc(100%-6rem))] w-[19rem] max-w-[calc(100%-1.5rem)] flex-col overflow-hidden ltr:origin-top-right rtl:origin-top-left md:end-[4.25rem]",
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
      <div className="stagger min-h-0 flex-1 space-y-2 overflow-y-auto p-3">
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
