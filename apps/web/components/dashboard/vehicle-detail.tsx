import { Truck, X } from "lucide-react";

import { Card } from "@/components/ui/card";
import { VehicleStatusBadge } from "@/components/dashboard/status-badge";
import { DeviceControls } from "@/components/dashboard/device-controls";
import { cn } from "@/lib/utils";
import { timeAgo } from "@/lib/status";
import { readTelemetry } from "@/lib/capabilities";
import { useI18n } from "@/lib/i18n-provider";
import type { Vehicle } from "@/mock/types";

export function VehicleDetail({
  vehicle,
  onClose,
  canControl = false,
}: {
  vehicle: Vehicle;
  onClose: () => void;
  /** Show live device controls (kill switch, commands). Real logged-in devices only. */
  canControl?: boolean;
}) {
  const { t } = useI18n();
  const ignition =
    vehicle.ignition == null ? null : vehicle.ignition ? "ON" : "OFF";

  const sensors: { label: string; value: string; tone?: "on" | "off" }[] = [
    { label: t("detail.speed"), value: `${vehicle.speedKmh} km/h` },
    {
      label: t("detail.ignition"),
      value: ignition ? t(`detail.${ignition === "ON" ? "on" : "off"}`) : "—",
      tone: ignition === "ON" ? "on" : ignition === "OFF" ? "off" : undefined,
    },
    { label: t("detail.battery"), value: vehicle.energyLevel ? `${vehicle.energyLevel}%` : "—" },
    { label: t("detail.gsm"), value: vehicle.gsm != null ? String(vehicle.gsm) : "—" },
    { label: t("detail.heading"), value: `${vehicle.heading}°` },
    { label: t("detail.odometer"), value: `${vehicle.odometerKm.toLocaleString()} km` },
  ];

  const telemetry = readTelemetry(vehicle.attributes);
  const extraMetrics = [...telemetry.obd, ...telemetry.power];
  const showControls = canControl && vehicle.deviceId != null;

  return (
    <Card className="relative flex max-h-[70vh] w-[300px] max-w-[calc(100vw-2rem)] flex-col overflow-hidden shadow-xl">
      <div className="flex items-center gap-2 border-b p-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
          <Truck className="h-5 w-5" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold">{vehicle.name}</p>
          <p className="text-xs text-muted-foreground">
            {t("detail.lastSeen")} {timeAgo(vehicle.lastUpdated)}
          </p>
        </div>
        <VehicleStatusBadge status={vehicle.status} />
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="grid grid-cols-2 gap-px bg-border">
          {sensors.map((s) => (
            <div key={s.label} className="bg-card p-3">
              <p className="text-[11px] text-muted-foreground">{s.label}</p>
              <p
                className={cn(
                  "mt-0.5 text-sm font-semibold tabular-nums",
                  s.tone === "on" && "text-emerald-600",
                  s.tone === "off" && "text-red-500",
                )}
              >
                {s.value}
              </p>
            </div>
          ))}
        </div>

        {extraMetrics.length > 0 && (
          <div className="border-t p-3">
            <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              {t("detail.telemetry")}
            </p>
            <div className="grid grid-cols-2 gap-x-4 gap-y-1.5">
              {extraMetrics.map((m) => (
                <div key={m.key} className="flex items-baseline justify-between gap-2">
                  <span className="text-[11px] text-muted-foreground">{m.label}</span>
                  <span className="text-sm font-semibold tabular-nums">{m.value}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="border-t p-3">
          <p className="text-[11px] text-muted-foreground">{t("detail.location")}</p>
          <p className="mt-0.5 text-sm leading-snug">{vehicle.location}</p>
          {vehicle.lat != null && vehicle.lng != null && (
            <p className="mt-1 text-xs tabular-nums text-muted-foreground">
              {vehicle.lat.toFixed(4)}, {vehicle.lng.toFixed(4)}
            </p>
          )}
        </div>

        {showControls && (
          <DeviceControls
            deviceId={vehicle.deviceId!}
            deviceName={vehicle.name}
            telemetry={telemetry}
            deviceAttributes={vehicle.deviceAttributes}
          />
        )}
      </div>
    </Card>
  );
}
