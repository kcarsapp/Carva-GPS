import type {
  AlertSeverity,
  DriverStatus,
  VehicleStatus,
} from "@/mock/types";
import type { BadgeProps } from "@/components/ui/badge";

type BadgeVariant = NonNullable<BadgeProps["variant"]>;

interface StatusDisplay {
  label: string;
  variant: BadgeVariant;
  /** Tailwind text/background color token for dots and map markers. */
  dot: string;
}

export const vehicleStatusDisplay: Record<VehicleStatus, StatusDisplay> = {
  in_transit: { label: "In Transit", variant: "success", dot: "bg-emerald-500" },
  idle: { label: "Idle", variant: "warning", dot: "bg-amber-500" },
  maintenance: {
    label: "Maintenance",
    variant: "destructive",
    dot: "bg-red-500",
  },
  unknown: { label: "No Signal", variant: "info", dot: "bg-sky-400" },
  offline: { label: "Offline", variant: "muted", dot: "bg-slate-400" },
};

export const driverStatusDisplay: Record<DriverStatus, StatusDisplay> = {
  driving: { label: "Driving", variant: "success", dot: "bg-emerald-500" },
  on_duty: { label: "On Duty", variant: "info", dot: "bg-sky-500" },
  resting: { label: "Resting", variant: "warning", dot: "bg-amber-500" },
  off_duty: { label: "Off Duty", variant: "muted", dot: "bg-slate-400" },
};

export const alertSeverityDisplay: Record<AlertSeverity, StatusDisplay> = {
  critical: { label: "Critical", variant: "destructive", dot: "bg-red-500" },
  warning: { label: "Warning", variant: "warning", dot: "bg-amber-500" },
  info: { label: "Info", variant: "info", dot: "bg-sky-500" },
};

/** Color for an energy/fuel bar based on remaining percentage. */
export function energyColor(level: number): string {
  if (level <= 25) return "bg-red-500";
  if (level <= 50) return "bg-amber-500";
  return "bg-emerald-500";
}

export function timeAgo(iso: string | null | undefined): string {
  // No timestamp at all — the caller decides how to word "never reported".
  if (!iso) return "";
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return "";
  const now = Date.now();
  const mins = Math.max(0, Math.round((now - then) / 60000));
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ${mins % 60}m ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}
