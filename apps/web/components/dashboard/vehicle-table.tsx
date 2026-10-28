"use client";

import * as React from "react";
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  Car,
  ChevronLeft,
  ChevronRight,
  KeyRound,
  Search,
  UserPlus,
} from "lucide-react";

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { timeAgo, vehicleStatusDisplay } from "@/lib/status";
import { formatVoltage, powerConnected } from "@/lib/format";
import { VehicleStatusBadge } from "@/components/dashboard/status-badge";
import { EmptyState } from "@/components/dashboard/states";
import { useI18n } from "@/lib/i18n-provider";
import type { Driver, Vehicle, VehicleStatus } from "@/mock/types";

/**
 * The fleet register. A real table on desktop - sortable, paged, scannable -
 * and a stack of cards on phones, where a seven-column table would only ever
 * be scrolled sideways.
 *
 * Columns are things the trackers actually report. The old "Energy" column
 * drew a fuel bar from a level these units never send, so every car read 0%;
 * it is now Power (supply voltage + ignition), which they do send.
 */

const FILTERS: (VehicleStatus | "all")[] = ["all", "in_transit", "idle", "unknown", "offline", "maintenance"];

type SortKey = "name" | "status" | "speed" | "power" | "updated";
type SortDir = "asc" | "desc";

const PAGE_SIZE = 25;

/** Operator priority: what is moving first, what is dark last. */
const STATUS_RANK: Record<VehicleStatus, number> = {
  in_transit: 0,
  idle: 1,
  unknown: 2,
  maintenance: 3,
  offline: 4,
};

const STATUS_AVATAR: Record<VehicleStatus, string> = {
  in_transit: "bg-emerald-500/10 text-emerald-600 ring-emerald-500/25 dark:text-emerald-400",
  idle: "bg-amber-500/10 text-amber-600 ring-amber-500/25 dark:text-amber-400",
  maintenance: "bg-red-500/10 text-red-600 ring-red-500/25 dark:text-red-400",
  unknown: "bg-sky-500/10 text-sky-600 ring-sky-500/25 dark:text-sky-400",
  offline: "bg-muted text-muted-foreground ring-border",
};

function volts(v: Vehicle): number | undefined {
  const p = (v.attributes as Record<string, unknown> | undefined)?.power;
  return typeof p === "number" && Number.isFinite(p) ? p : undefined;
}

function updatedAt(v: Vehicle): number {
  const t = +new Date(v.lastFixAt || v.lastUpdated);
  return Number.isFinite(t) ? t : 0;
}

function VehicleAvatar({ status }: { status: VehicleStatus }) {
  return (
    <span className={cn("flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ring-1", STATUS_AVATAR[status])}>
      <Car className="h-[18px] w-[18px]" />
    </span>
  );
}

/** Supply voltage, coloured by whether the car's power is connected, plus ignition. */
function PowerCell({ v }: { v: Vehicle }) {
  const { t } = useI18n();
  const value = volts(v);
  const on = powerConnected(value);
  return (
    <span className="inline-flex items-center gap-2">
      <span
        className={cn(
          "num font-medium",
          on === true && "text-emerald-600 dark:text-emerald-400",
          on === false && "text-red-600 dark:text-red-400",
        )}
      >
        {formatVoltage(value)}
      </span>
      {v.ignition != null && (
        <span
          title={`${t("detail.ignition")}: ${t(v.ignition ? "detail.on" : "detail.off")}`}
          className={cn(
            "inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-semibold",
            v.ignition ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300" : "bg-muted text-muted-foreground",
          )}
        >
          <KeyRound className="h-3 w-3" />
          {t(v.ignition ? "detail.on" : "detail.off")}
        </span>
      )}
    </span>
  );
}

function SortHead({
  label,
  k,
  sort,
  dir,
  onSort,
  className,
}: {
  label: string;
  k: SortKey;
  sort: SortKey;
  dir: SortDir;
  onSort: (k: SortKey) => void;
  className?: string;
}) {
  const active = sort === k;
  const Icon = !active ? ArrowUpDown : dir === "asc" ? ArrowUp : ArrowDown;
  return (
    <TableHead className={className} aria-sort={active ? (dir === "asc" ? "ascending" : "descending") : "none"}>
      <button
        type="button"
        onClick={() => onSort(k)}
        className={cn(
          "-mx-1.5 inline-flex items-center gap-1 rounded-md px-1.5 py-1 uppercase transition-colors hover:text-foreground",
          active && "text-foreground",
        )}
      >
        {label}
        <Icon className={cn("h-3 w-3", !active && "opacity-40")} />
      </button>
    </TableHead>
  );
}

export function VehicleTable({
  vehicles,
  drivers,
  selectedId,
  onSelect,
  assignedDrivers,
  onAssignDrivers,
}: {
  vehicles: Vehicle[];
  drivers: Driver[];
  selectedId?: string | null;
  onSelect?: (id: string) => void;
  /** Live driver names per vehicle id (Traccar assignments). Overrides mock lookup. */
  assignedDrivers?: Record<string, string[]>;
  /** When set, the driver cell shows a manage button that calls back with the vehicle id. */
  onAssignDrivers?: (vehicleId: string) => void;
}) {
  const { t } = useI18n();
  const [query, setQuery] = React.useState("");
  const [status, setStatus] = React.useState<VehicleStatus | "all">("all");
  const [sort, setSort] = React.useState<SortKey>("status");
  const [dir, setDir] = React.useState<SortDir>("asc");
  const [page, setPage] = React.useState(0);

  const driverName = React.useCallback(
    (v: Vehicle) => {
      if (assignedDrivers) {
        const names = assignedDrivers[v.id] ?? [];
        return names.length > 0 ? names.join(", ") : t("fleet.unassigned");
      }
      return v.driverId ? drivers.find((d) => d.id === v.driverId)?.name ?? "—" : t("fleet.unassigned");
    },
    [assignedDrivers, drivers, t],
  );

  const counts = React.useMemo(() => {
    const c: Record<string, number> = { all: vehicles.length };
    for (const v of vehicles) c[v.status] = (c[v.status] ?? 0) + 1;
    return c;
  }, [vehicles]);

  const rows = React.useMemo(() => {
    const q = query.trim().toLowerCase();
    const matched = vehicles.filter((v) => {
      if (status !== "all" && v.status !== status) return false;
      if (!q) return true;
      return (
        v.name.toLowerCase().includes(q) ||
        v.plate.toLowerCase().includes(q) ||
        v.model.toLowerCase().includes(q) ||
        driverName(v).toLowerCase().includes(q)
      );
    });
    const byName = (a: Vehicle, b: Vehicle) => a.name.localeCompare(b.name, undefined, { numeric: true });
    const cmp: Record<SortKey, (a: Vehicle, b: Vehicle) => number> = {
      name: byName,
      status: (a, b) => STATUS_RANK[a.status] - STATUS_RANK[b.status],
      speed: (a, b) => a.speedKmh - b.speedKmh,
      power: (a, b) => (volts(a) ?? -1) - (volts(b) ?? -1),
      updated: (a, b) => updatedAt(a) - updatedAt(b),
    };
    const sign = dir === "asc" ? 1 : -1;
    return matched.sort((a, b) => sign * cmp[sort](a, b) || byName(a, b));
  }, [vehicles, query, status, sort, dir, driverName]);

  // A new search or filter always starts on the first page.
  React.useEffect(() => setPage(0), [query, status, sort, dir]);

  const pages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const current = Math.min(page, pages - 1);
  const shown = rows.slice(current * PAGE_SIZE, current * PAGE_SIZE + PAGE_SIZE);

  const onSort = (k: SortKey) => {
    if (k === sort) setDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSort(k);
      // Numbers read best biggest-first; names and status in their natural order.
      setDir(k === "speed" || k === "power" || k === "updated" ? "desc" : "asc");
    }
  };

  const assignButton = (v: Vehicle) =>
    onAssignDrivers && (
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onAssignDrivers(v.id);
        }}
        className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        aria-label={`${t("fleet.assignDrivers")} — ${v.name}`}
        title={t("fleet.assignDrivers")}
      >
        <UserPlus className="h-3.5 w-3.5" />
      </button>
    );

  const age = (v: Vehicle) => timeAgo(v.lastFixAt || v.lastUpdated) || t("fleet.neverReported");

  return (
    <div className="surface overflow-hidden rounded-2xl">
      {/* Toolbar */}
      <div className="flex flex-col gap-3 border-b p-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="relative w-full lg:max-w-xs">
          <Search className="absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("fleet.search")}
            aria-label={t("fleet.search")}
            className="ps-9"
          />
        </div>
        <div role="group" aria-label={t("fleet.col.status")} className="flex flex-wrap gap-1.5">
          {FILTERS.filter((f) => f === "all" || counts[f]).map((f) => {
            const active = status === f;
            return (
              <button
                key={f}
                type="button"
                onClick={() => setStatus(f)}
                aria-pressed={active}
                className={cn(
                  "inline-flex h-8 items-center gap-1.5 rounded-lg border px-2.5 text-xs font-medium transition-colors",
                  active
                    ? "border-primary/40 bg-primary/10 text-primary"
                    : "bg-card text-muted-foreground hover:border-foreground/20 hover:text-foreground",
                )}
              >
                {f !== "all" && <span className={cn("h-1.5 w-1.5 rounded-full", vehicleStatusDisplay[f].dot)} />}
                {t(f === "all" ? "fleet.filter.all" : `fleet.status.${f}`)}
                <span className="num rounded bg-foreground/[0.06] px-1 text-[10px]">{counts[f] ?? 0}</span>
              </button>
            );
          })}
        </div>
      </div>

      {rows.length === 0 ? (
        <div className="p-4">
          <EmptyState icon={Search} title={t("fleet.noMatch")} className="border-0 bg-transparent" />
        </div>
      ) : (
        <>
          {/* Desktop: the table */}
          <div className="hidden md:block">
            <Table>
              <TableHeader>
                <TableRow>
                  <SortHead label={t("fleet.col.vehicle")} k="name" sort={sort} dir={dir} onSort={onSort} />
                  <SortHead label={t("fleet.col.status")} k="status" sort={sort} dir={dir} onSort={onSort} />
                  <SortHead label={t("fleet.col.speed")} k="speed" sort={sort} dir={dir} onSort={onSort} />
                  <SortHead label={t("fleet.col.power")} k="power" sort={sort} dir={dir} onSort={onSort} />
                  <TableHead className="hidden xl:table-cell">{t("fleet.col.driver")}</TableHead>
                  <SortHead label={t("fleet.col.updated")} k="updated" sort={sort} dir={dir} onSort={onSort} className="text-end" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {shown.map((v) => (
                  <TableRow
                    key={v.id}
                    onClick={onSelect ? () => onSelect(v.id) : undefined}
                    onKeyDown={
                      onSelect
                        ? (e) => {
                            if (e.key === "Enter" || e.key === " ") {
                              e.preventDefault();
                              onSelect(v.id);
                            }
                          }
                        : undefined
                    }
                    tabIndex={onSelect ? 0 : undefined}
                    data-state={selectedId === v.id ? "selected" : undefined}
                    className={cn(onSelect && "cursor-pointer focus-visible:bg-accent/60 focus-visible:outline-none")}
                  >
                    <TableCell>
                      <div className="flex items-center gap-3">
                        <VehicleAvatar status={v.status} />
                        <div className="min-w-0">
                          <div className="truncate font-semibold">{v.name}</div>
                          <div className="truncate font-mono text-[11px] text-muted-foreground">
                            {v.plate}
                            {v.model ? <span className="font-sans"> · {v.model}</span> : null}
                          </div>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell>
                      <VehicleStatusBadge status={v.status} />
                    </TableCell>
                    <TableCell className="num whitespace-nowrap">
                      {v.status === "in_transit" ? (
                        <span className="font-semibold">
                          {v.speedKmh} <span className="text-xs font-normal text-muted-foreground">km/h</span>
                        </span>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell className="whitespace-nowrap">
                      <PowerCell v={v} />
                    </TableCell>
                    <TableCell className="hidden whitespace-nowrap xl:table-cell">
                      <span className="inline-flex items-center gap-1">
                        <span className="max-w-[180px] truncate">{driverName(v)}</span>
                        {assignButton(v)}
                      </span>
                    </TableCell>
                    <TableCell className="num whitespace-nowrap text-end text-muted-foreground">{age(v)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          {/* Phones: cards */}
          <ul className="divide-y md:hidden">
            {shown.map((v) => (
              <li key={v.id}>
                <div
                  role={onSelect ? "button" : undefined}
                  tabIndex={onSelect ? 0 : undefined}
                  onClick={onSelect ? () => onSelect(v.id) : undefined}
                  onKeyDown={
                    onSelect
                      ? (e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            onSelect(v.id);
                          }
                        }
                      : undefined
                  }
                  className={cn(
                    "flex flex-col gap-2.5 p-4 transition-colors",
                    onSelect && "cursor-pointer active:bg-accent/60",
                    selectedId === v.id && "bg-primary/[0.06]",
                  )}
                >
                  <div className="flex items-center gap-3">
                    <VehicleAvatar status={v.status} />
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-semibold">{v.name}</div>
                      <div className="truncate font-mono text-[11px] text-muted-foreground">{v.plate}</div>
                    </div>
                    <VehicleStatusBadge status={v.status} />
                  </div>
                  <div className="grid grid-cols-3 gap-2 text-xs">
                    <div>
                      <p className="text-[10px] text-muted-foreground">{t("fleet.col.speed")}</p>
                      <p className="num font-semibold">{v.status === "in_transit" ? `${v.speedKmh} km/h` : "—"}</p>
                    </div>
                    <div>
                      <p className="text-[10px] text-muted-foreground">{t("fleet.col.power")}</p>
                      <PowerCell v={v} />
                    </div>
                    <div className="text-end">
                      <p className="text-[10px] text-muted-foreground">{t("fleet.col.updated")}</p>
                      <p className="num font-medium text-muted-foreground">{age(v)}</p>
                    </div>
                  </div>
                  <div className="flex items-center justify-between text-xs text-muted-foreground">
                    <span className="truncate">{driverName(v)}</span>
                    {assignButton(v)}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </>
      )}

      {/* Footer: count + pager */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-t px-4 py-3 text-xs text-muted-foreground">
        <span className="num">
          {rows.length === 0
            ? t("fleet.showing").replace("{n}", "0").replace("{m}", String(vehicles.length))
            : t("fleet.range")
                .replace("{a}", String(current * PAGE_SIZE + 1))
                .replace("{b}", String(current * PAGE_SIZE + shown.length))
                .replace("{n}", String(rows.length))}
        </span>
        {pages > 1 && (
          <div className="flex items-center gap-1">
            <Button
              size="sm"
              variant="outline"
              className="h-8 w-8 p-0"
              disabled={current === 0}
              onClick={() => setPage(current - 1)}
              aria-label={t("fleet.prevPage")}
            >
              <ChevronLeft className="rtl:rotate-180" />
            </Button>
            <span className="num px-2">
              {current + 1} / {pages}
            </span>
            <Button
              size="sm"
              variant="outline"
              className="h-8 w-8 p-0"
              disabled={current >= pages - 1}
              onClick={() => setPage(current + 1)}
              aria-label={t("fleet.nextPage")}
            >
              <ChevronRight className="rtl:rotate-180" />
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
