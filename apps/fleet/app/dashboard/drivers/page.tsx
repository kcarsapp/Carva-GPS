import { Phone, Plus } from "lucide-react";

import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/dashboard/page-header";
import { DriverStatusBadge } from "@/components/dashboard/status-badge";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { drivers, getDriverById } from "@/mock/drivers";
import { vehicles } from "@/mock/vehicles";

function safetyColor(score: number) {
  if (score >= 90) return "text-emerald-600 dark:text-emerald-400";
  if (score >= 80) return "text-amber-600 dark:text-amber-400";
  return "text-red-500";
}

export default function DriversPage() {
  const vehicleName = (driverId: string) =>
    vehicles.find((v) => v.driverId === driverId)?.name ?? "Unassigned";

  return (
    <>
      <PageHeader
        title="Drivers"
        description="Driver roster with live duty status and safety scores."
        action={
          <Button size="sm">
            <Plus className="h-4 w-4" />
            Add driver
          </Button>
        }
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {drivers.map((d) => (
          <Card key={d.id}>
            <CardContent className="p-5">
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-3">
                  <span className="flex h-11 w-11 items-center justify-center rounded-full bg-primary/10 text-sm font-semibold text-primary">
                    {d.avatarInitials}
                  </span>
                  <div>
                    <p className="font-semibold leading-tight">{d.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {d.licenseClass}
                    </p>
                  </div>
                </div>
                <DriverStatusBadge status={d.status} />
              </div>

              <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
                <div>
                  <p className="text-xs text-muted-foreground">Safety score</p>
                  <p className={cn("text-lg font-bold", safetyColor(d.safetyScore))}>
                    {d.safetyScore}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Hours / week</p>
                  <p className="text-lg font-bold tabular-nums">
                    {d.hoursThisWeek}
                  </p>
                </div>
              </div>

              <div className="mt-4 space-y-1.5 border-t pt-3 text-xs text-muted-foreground">
                <p>
                  Vehicle:{" "}
                  <span className="font-medium text-foreground">
                    {getDriverById(d.id) ? vehicleName(d.id) : "—"}
                  </span>
                </p>
                <p className="flex items-center gap-1.5">
                  <Phone className="h-3.5 w-3.5" />
                  {d.phone}
                </p>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </>
  );
}
