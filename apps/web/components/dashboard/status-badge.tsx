"use client";

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import {
  alertSeverityDisplay,
  driverStatusDisplay,
  vehicleStatusDisplay,
} from "@/lib/status";
import { useI18n } from "@/lib/i18n-provider";
import type { AlertSeverity, DriverStatus, VehicleStatus } from "@/mock/types";

export function VehicleStatusBadge({ status }: { status: VehicleStatus }) {
  const { t } = useI18n();
  const d = vehicleStatusDisplay[status];
  return (
    <Badge variant={d.variant}>
      <span className={cn("h-1.5 w-1.5 rounded-full", d.dot)} />
      {t(`fleet.status.${status}`)}
    </Badge>
  );
}

export function DriverStatusBadge({ status }: { status: DriverStatus }) {
  const { t } = useI18n();
  const d = driverStatusDisplay[status];
  return (
    <Badge variant={d.variant}>
      <span className={cn("h-1.5 w-1.5 rounded-full", d.dot)} />
      {t(`fleet.driver.${status}`)}
    </Badge>
  );
}

export function AlertSeverityBadge({ severity }: { severity: AlertSeverity }) {
  const { t } = useI18n();
  const d = alertSeverityDisplay[severity];
  return (
    <Badge variant={d.variant}>
      <span className={cn("h-1.5 w-1.5 rounded-full", d.dot)} />
      {t(`fleet.sev.${severity}`)}
    </Badge>
  );
}
