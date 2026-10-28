"use client";

import { SatelliteDish, TriangleAlert } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import {
  alertSeverityDisplay,
  driverStatusDisplay,
  timeAgo,
  vehicleStatusDisplay,
} from "@/lib/status";
import { useI18n } from "@/lib/i18n-provider";
import type {
  AlertSeverity,
  DriverStatus,
  Vehicle,
  VehicleStatus,
} from "@/mock/types";

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

/**
 * Says out loud why a vehicle is not reporting.
 *
 * Without this the UI only ever showed the last state it managed to read, so a
 * tracker that had gone off the air — or one still on GPRS with a dead GPS
 * receiver — looked exactly like a car parked in a driveway. Renders nothing
 * for a healthy vehicle, so callers can drop it in unconditionally.
 */
export function SignalWarning({ vehicle }: { vehicle: Vehicle }) {
  const { t } = useI18n();
  const issue = vehicle.signalIssue;
  if (!issue) return null;

  // "silent" asks how long since we heard anything, so it counts from the last
  // packet. "delayed" is about how old the marker on the map is, so it counts
  // from when the fix was recorded. "never" and "no_fix" quote no age at all.
  const age = timeAgo(
    issue === "silent" ? vehicle.lastUpdated : vehicle.lastFixAt,
  );
  const message = t(`fleet.signal.${issue}`).replace("{age}", age);

  return (
    <p
      className={cn(
        "flex items-start gap-1.5 px-4 py-2 text-[11px] font-medium",
        issue === "no_fix" || issue === "delayed"
          ? "bg-sky-500/10 text-sky-700 dark:text-sky-300"
          : "bg-amber-500/10 text-amber-700 dark:text-amber-300",
      )}
    >
      {issue === "no_fix" || issue === "delayed" ? (
        <SatelliteDish className="mt-px h-3.5 w-3.5 shrink-0" />
      ) : (
        <TriangleAlert className="mt-px h-3.5 w-3.5 shrink-0" />
      )}
      <span className="min-w-0">{message}</span>
    </p>
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
