import { Battery, Fuel } from "lucide-react";

import { cn } from "@/lib/utils";
import { energyColor } from "@/lib/status";
import type { FuelType } from "@/mock/types";

export function EnergyBar({
  level,
  fuelType,
}: {
  level: number;
  fuelType: FuelType;
}) {
  const Icon = fuelType === "electric" ? Battery : Fuel;
  return (
    <div className="flex items-center gap-2">
      <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
      <div className="h-2 w-16 overflow-hidden rounded-full bg-muted">
        <div
          className={cn("h-full rounded-full", energyColor(level))}
          style={{ width: `${level}%` }}
        />
      </div>
      <span className="w-9 text-xs font-medium tabular-nums text-muted-foreground">
        {level}%
      </span>
    </div>
  );
}
