"use client";

import * as React from "react";
import { Truck, Wifi } from "lucide-react";

import { cn } from "@/lib/utils";
import { vehicleStatusDisplay } from "@/lib/status";
import type { VehicleStatus } from "@/mock/types";

interface DemoTruck {
  id: string;
  label: string;
  status: Extract<VehicleStatus, "in_transit" | "idle" | "maintenance">;
  x: number;
  y: number;
  /** velocity per tick, only used when in transit */
  vx: number;
  vy: number;
}

const INITIAL: DemoTruck[] = [
  { id: "t1", label: "Truck 014", status: "in_transit", x: 20, y: 30, vx: 1.6, vy: 1.1 },
  { id: "t2", label: "Van 027", status: "in_transit", x: 70, y: 60, vx: -1.2, vy: -1.5 },
  { id: "t3", label: "Truck 021", status: "maintenance", x: 45, y: 78, vx: 0, vy: 0 },
];

const MIN = 8;
const MAX = 92;

function step(t: DemoTruck): DemoTruck {
  if (t.status !== "in_transit") return t;
  let { x, y, vx, vy } = t;
  x += vx;
  y += vy;
  if (x <= MIN || x >= MAX) vx = -vx;
  if (y <= MIN || y >= MAX) vy = -vy;
  x = Math.min(MAX, Math.max(MIN, x));
  y = Math.min(MAX, Math.max(MIN, y));
  return { ...t, x, y, vx, vy };
}

export function LiveDemo() {
  const [trucks, setTrucks] = React.useState<DemoTruck[]>(INITIAL);

  React.useEffect(() => {
    const id = setInterval(() => {
      setTrucks((prev) => prev.map(step));
    }, 700);
    return () => clearInterval(id);
  }, []);

  return (
    <div className="overflow-hidden rounded-2xl border bg-card shadow-sm">
      <div className="flex items-center justify-between border-b px-4 py-3">
        <div className="flex items-center gap-2">
          <span className="relative flex h-2.5 w-2.5">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
            <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-emerald-500" />
          </span>
          <span className="text-sm font-semibold">Live fleet map</span>
        </div>
        <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Wifi className="h-3.5 w-3.5" />
          Streaming · 3 units
        </span>
      </div>

      <div className="relative aspect-[4/3] w-full bg-grid bg-muted/20 sm:aspect-[16/10]">
        {/* faux roads */}
        <div className="pointer-events-none absolute inset-0">
          <div className="absolute left-0 right-0 top-1/3 h-px bg-border" />
          <div className="absolute left-0 right-0 top-2/3 h-px bg-border" />
          <div className="absolute bottom-0 left-1/3 top-0 w-px bg-border" />
          <div className="absolute bottom-0 left-2/3 top-0 w-px bg-border" />
        </div>

        {trucks.map((t) => {
          const d = vehicleStatusDisplay[t.status];
          return (
            <div
              key={t.id}
              className="absolute -translate-x-1/2 -translate-y-1/2 transition-all duration-700 ease-linear"
              style={{ left: `${t.x}%`, top: `${t.y}%` }}
            >
              <div className="relative flex flex-col items-center">
                {t.status === "in_transit" && (
                  <span
                    className={cn(
                      "absolute h-7 w-7 rounded-full",
                      d.dot,
                      "animate-pulse-ring opacity-60",
                    )}
                  />
                )}
                <span
                  className={cn(
                    "relative flex h-7 w-7 items-center justify-center rounded-full text-white shadow-md ring-2 ring-background",
                    d.dot,
                  )}
                >
                  <Truck className="h-3.5 w-3.5" />
                </span>
                <span className="mt-1 whitespace-nowrap rounded-md bg-background/90 px-1.5 py-0.5 text-[10px] font-medium shadow-sm ring-1 ring-border">
                  {t.label}
                </span>
              </div>
            </div>
          );
        })}
      </div>

      {/* legend / status list */}
      <div className="grid grid-cols-3 divide-x border-t text-center">
        {trucks.map((t) => {
          const d = vehicleStatusDisplay[t.status];
          return (
            <div key={t.id} className="px-2 py-3">
              <p className="text-xs font-medium">{t.label}</p>
              <p
                className={cn(
                  "mt-1 inline-flex items-center gap-1 text-[11px] font-semibold",
                  t.status === "in_transit" && "text-emerald-600",
                  t.status === "idle" && "text-amber-600",
                  t.status === "maintenance" && "text-red-500",
                )}
              >
                <span className={cn("h-1.5 w-1.5 rounded-full", d.dot)} />
                {t.status === "maintenance" ? "Maintenance Required" : d.label}
              </p>
            </div>
          );
        })}
      </div>
    </div>
  );
}
