import { Download, Plus } from "lucide-react";

import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/dashboard/page-header";
import { MetricCard } from "@/components/dashboard/metric-card";
import { VehicleTable } from "@/components/dashboard/vehicle-table";
import { AlertSeverityBadge } from "@/components/dashboard/status-badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { timeAgo } from "@/lib/status";
import { fleetMetrics } from "@/mock/metrics";
import { vehicles } from "@/mock/vehicles";
import { drivers } from "@/mock/drivers";
import { alerts } from "@/mock/alerts";

export default function DashboardOverviewPage() {
  const recentAlerts = alerts.slice(0, 4);

  return (
    <>
      <PageHeader
        title="Fleet Overview"
        description="Live operational snapshot across your entire fleet."
        action={
          <div className="flex gap-2">
            <Button variant="outline" size="sm">
              <Download className="h-4 w-4" />
              Export
            </Button>
            <Button size="sm">
              <Plus className="h-4 w-4" />
              Add vehicle
            </Button>
          </div>
        }
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {fleetMetrics.map((m) => (
          <MetricCard key={m.id} metric={m} />
        ))}
      </div>

      <div className="mt-6 grid grid-cols-1 gap-6 xl:grid-cols-3">
        <div className="xl:col-span-2">
          <h2 className="mb-3 text-lg font-semibold">Vehicles</h2>
          <VehicleTable vehicles={vehicles} drivers={drivers} />
        </div>

        <div>
          <h2 className="mb-3 text-lg font-semibold">Recent alerts</h2>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Last 24 hours
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {recentAlerts.map((a) => (
                <div
                  key={a.id}
                  className="flex flex-col gap-1 rounded-lg border p-3"
                >
                  <div className="flex items-center justify-between gap-2">
                    <AlertSeverityBadge severity={a.severity} />
                    <span className="text-xs text-muted-foreground">
                      {timeAgo(a.timestamp)}
                    </span>
                  </div>
                  <p className="text-sm font-medium leading-snug">{a.title}</p>
                  <p className="text-xs text-muted-foreground">
                    {a.description}
                  </p>
                </div>
              ))}
            </CardContent>
          </Card>
        </div>
      </div>
    </>
  );
}
