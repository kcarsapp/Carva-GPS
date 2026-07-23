import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import {
  alertSeverityDisplay,
  driverStatusDisplay,
  vehicleStatusDisplay,
} from "@/lib/status";
import type { AlertSeverity, DriverStatus, VehicleStatus } from "@/mock/types";

export function VehicleStatusBadge({ status }: { status: VehicleStatus }) {
  const d = vehicleStatusDisplay[status];
  return (
    <Badge variant={d.variant}>
      <span className={cn("h-1.5 w-1.5 rounded-full", d.dot)} />
      {d.label}
    </Badge>
  );
}

export function DriverStatusBadge({ status }: { status: DriverStatus }) {
  const d = driverStatusDisplay[status];
  return (
    <Badge variant={d.variant}>
      <span className={cn("h-1.5 w-1.5 rounded-full", d.dot)} />
      {d.label}
    </Badge>
  );
}

export function AlertSeverityBadge({ severity }: { severity: AlertSeverity }) {
  const d = alertSeverityDisplay[severity];
  return (
    <Badge variant={d.variant}>
      <span className={cn("h-1.5 w-1.5 rounded-full", d.dot)} />
      {d.label}
    </Badge>
  );
}
