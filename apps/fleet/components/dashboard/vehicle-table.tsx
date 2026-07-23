"use client";

import * as React from "react";
import { Search } from "lucide-react";

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
import { vehicleStatusDisplay } from "@/lib/status";
import { VehicleStatusBadge } from "@/components/dashboard/status-badge";
import { EnergyBar } from "@/components/dashboard/energy-bar";
import type { Driver, Vehicle, VehicleStatus } from "@/mock/types";

const FILTERS: { value: VehicleStatus | "all"; label: string }[] = [
  { value: "all", label: "All" },
  { value: "in_transit", label: "In Transit" },
  { value: "idle", label: "Idle" },
  { value: "maintenance", label: "Maintenance" },
  { value: "offline", label: "Offline" },
];

export function VehicleTable({
  vehicles,
  drivers,
}: {
  vehicles: Vehicle[];
  drivers: Driver[];
}) {
  const [query, setQuery] = React.useState("");
  const [status, setStatus] = React.useState<VehicleStatus | "all">("all");

  const driverName = React.useCallback(
    (id: string | null) =>
      id ? drivers.find((d) => d.id === id)?.name ?? "—" : "Unassigned",
    [drivers],
  );

  const filtered = React.useMemo(() => {
    const q = query.trim().toLowerCase();
    return vehicles.filter((v) => {
      const matchesStatus = status === "all" || v.status === status;
      const matchesQuery =
        q === "" ||
        v.name.toLowerCase().includes(q) ||
        v.plate.toLowerCase().includes(q) ||
        v.model.toLowerCase().includes(q) ||
        driverName(v.driverId).toLowerCase().includes(q);
      return matchesStatus && matchesQuery;
    });
  }, [vehicles, query, status, driverName]);

  return (
    <div className="rounded-xl border bg-card">
      <div className="flex flex-col gap-3 border-b p-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative w-full sm:max-w-xs">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search unit, plate, driver…"
            className="pl-9"
          />
        </div>
        <div className="flex flex-wrap gap-1.5">
          {FILTERS.map((f) => (
            <Button
              key={f.value}
              size="sm"
              variant={status === f.value ? "default" : "outline"}
              onClick={() => setStatus(f.value)}
            >
              {f.value !== "all" && (
                <span
                  className={cn(
                    "h-1.5 w-1.5 rounded-full",
                    vehicleStatusDisplay[f.value as VehicleStatus].dot,
                  )}
                />
              )}
              {f.label}
            </Button>
          ))}
        </div>
      </div>

      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead>Vehicle</TableHead>
            <TableHead>Driver</TableHead>
            <TableHead>Energy</TableHead>
            <TableHead>Speed</TableHead>
            <TableHead className="hidden lg:table-cell">Location</TableHead>
            <TableHead>Status</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {filtered.map((v) => (
            <TableRow key={v.id}>
              <TableCell>
                <div className="font-medium">{v.name}</div>
                <div className="text-xs text-muted-foreground">
                  {v.plate} · {v.model}
                </div>
              </TableCell>
              <TableCell className="whitespace-nowrap">
                {driverName(v.driverId)}
              </TableCell>
              <TableCell>
                <EnergyBar level={v.energyLevel} fuelType={v.fuelType} />
              </TableCell>
              <TableCell className="tabular-nums">
                {v.speedKmh > 0 ? `${v.speedKmh} km/h` : "—"}
              </TableCell>
              <TableCell className="hidden max-w-[220px] truncate text-muted-foreground lg:table-cell">
                {v.location}
              </TableCell>
              <TableCell>
                <VehicleStatusBadge status={v.status} />
              </TableCell>
            </TableRow>
          ))}
          {filtered.length === 0 && (
            <TableRow className="hover:bg-transparent">
              <TableCell
                colSpan={6}
                className="py-10 text-center text-sm text-muted-foreground"
              >
                No vehicles match your filters.
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>

      <div className="border-t px-4 py-3 text-xs text-muted-foreground">
        Showing {filtered.length} of {vehicles.length} vehicles
      </div>
    </div>
  );
}
