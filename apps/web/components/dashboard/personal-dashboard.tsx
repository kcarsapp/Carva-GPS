"use client";

import * as React from "react";
import { MapPin, Wifi, WifiOff } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { PageHeader } from "@/components/dashboard/page-header";
import { FleetMap } from "@/components/dashboard/fleet-map";
import { VehicleStatusBadge } from "@/components/dashboard/status-badge";
import { EnergyBar } from "@/components/dashboard/energy-bar";
import { cn } from "@/lib/utils";
import { timeAgo } from "@/lib/status";
import type { Vehicle } from "@/mock/types";

export function PersonalDashboard({
  vehicles,
  authed,
  error,
}: {
  vehicles: Vehicle[];
  authed: boolean;
  error: string | null;
}) {
  const [selectedId, setSelectedId] = React.useState<string | null>(null);

  return (
    <>
      <PageHeader
        title="My Vehicle"
        description="Your personal tracker — live location and status."
        action={
          <Badge variant={authed ? "success" : "muted"}>
            {authed ? (
              <>
                <Wifi className="h-3.5 w-3.5" /> Live
              </>
            ) : (
              <>
                <WifiOff className="h-3.5 w-3.5" /> Demo
              </>
            )}
          </Badge>
        }
      />

      {error && (
        <div className="mb-4 rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-2 text-sm text-destructive">
          {error}
        </div>
      )}

      <FleetMap
        vehicles={vehicles}
        selectedId={selectedId}
        onSelect={setSelectedId}
        onClose={() => setSelectedId(null)}
        className="h-[360px] sm:h-[480px]"
        canControl={authed}
      />

      {vehicles.length === 0 ? (
        <Card className="mt-6">
          <CardContent className="flex flex-col items-center gap-2 py-12 text-center">
            <span className="flex h-12 w-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
              <MapPin className="h-6 w-6" />
            </span>
            <p className="font-medium">No vehicle linked yet</p>
            <p className="max-w-sm text-sm text-muted-foreground">
              Once a GPS tracker is added to your account it will appear here
              automatically.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {vehicles.map((v) => (
            <button
              key={v.id}
              type="button"
              onClick={() => setSelectedId(v.id)}
              className={cn(
                "rounded-xl border bg-card p-4 text-start transition-colors hover:border-primary",
                selectedId === v.id && "border-primary ring-1 ring-primary",
              )}
            >
              <div className="flex items-center justify-between gap-2">
                <p className="font-semibold">{v.name}</p>
                <VehicleStatusBadge status={v.status} />
              </div>
              <p className="mt-0.5 text-xs text-muted-foreground">{v.plate}</p>

              <div className="mt-3">
                <EnergyBar level={v.energyLevel} fuelType={v.fuelType} />
              </div>

              <div className="mt-3 flex items-center gap-1.5 text-xs text-muted-foreground">
                <MapPin className="h-3.5 w-3.5 shrink-0" />
                <span className="truncate">{v.location}</span>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                {v.speedKmh > 0 ? `${v.speedKmh} km/h · ` : ""}
                {v.lastUpdated
                  ? `updated ${timeAgo(v.lastUpdated)}`
                  : "never reported"}
              </p>
            </button>
          ))}
        </div>
      )}
    </>
  );
}
