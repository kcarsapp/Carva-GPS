"use client";

import * as React from "react";
import { Plus, Wifi, WifiOff } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/dashboard/page-header";
import { VehicleTable } from "@/components/dashboard/vehicle-table";
import { useLiveFleet } from "@/lib/live-data";
import { drivers } from "@/mock/drivers";

export default function VehiclesPage() {
  const { vehicles, authed } = useLiveFleet();

  return (
    <>
      <PageHeader
        title="Vehicles"
        description="Every unit in your fleet, searchable and filterable by status."
        action={
          <div className="flex items-center gap-2">
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
            <Button size="sm">
              <Plus className="h-4 w-4" />
              Add vehicle
            </Button>
          </div>
        }
      />
      <VehicleTable vehicles={vehicles} drivers={drivers} />
    </>
  );
}
