import { CheckCircle2 } from "lucide-react";

import { PageHeader } from "@/components/dashboard/page-header";
import { AlertSeverityBadge } from "@/components/dashboard/status-badge";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { timeAgo } from "@/lib/status";
import { alerts } from "@/mock/alerts";
import { getVehicleById } from "@/mock/vehicles";

export default function AlertsPage() {
  return (
    <>
      <PageHeader
        title="Alerts"
        description="Safety, maintenance, and telematics events across the fleet."
      />

      <div className="space-y-3">
        {alerts.map((a) => {
          const vehicle = getVehicleById(a.vehicleId);
          return (
            <Card key={a.id}>
              <CardContent className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex items-start gap-3">
                  <AlertSeverityBadge severity={a.severity} />
                  <div>
                    <p className="font-medium leading-snug">{a.title}</p>
                    <p className="mt-0.5 text-sm text-muted-foreground">
                      {a.description}
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {vehicle?.name ?? a.vehicleId} · {timeAgo(a.timestamp)}
                    </p>
                  </div>
                </div>
                <div className="shrink-0 pl-9 sm:pl-0">
                  {a.acknowledged ? (
                    <Badge variant="muted">
                      <CheckCircle2 className="h-3.5 w-3.5" />
                      Acknowledged
                    </Badge>
                  ) : (
                    <Badge variant="warning">Needs review</Badge>
                  )}
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </>
  );
}
