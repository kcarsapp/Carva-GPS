"use client";

import { ArrowDownRight, ArrowUpRight } from "lucide-react";

import { KpiTile } from "@/components/dashboard/kpi-tile";
import { cn } from "@/lib/utils";
import { useI18n } from "@/lib/i18n-provider";
import type { FleetMetric } from "@/mock/types";

export function MetricCard({ metric }: { metric: FleetMetric }) {
  // Labels may be i18n keys (live metrics) or plain strings (mock data —
  // translate() passes unknown keys through unchanged).
  const { t } = useI18n();
  const isUp = metric.delta >= 0;
  // "Good" if the direction matches what we want for this metric.
  const isGood = isUp === metric.positiveIsGood;
  const Arrow = isUp ? ArrowUpRight : ArrowDownRight;

  return (
    <KpiTile
      label={t(metric.label)}
      value={metric.value}
      footnote={
        metric.delta !== 0 ? (
          <span
            className={cn(
              "inline-flex items-center gap-0.5 font-semibold",
              isGood ? "text-emerald-600 dark:text-emerald-400" : "text-red-500",
            )}
          >
            <Arrow className="h-3.5 w-3.5" />
            {Math.abs(metric.delta)}
            {metric.id === "alerts" ? "" : "%"}
            <span className="ms-1 font-normal text-muted-foreground">vs. previous 7 days</span>
          </span>
        ) : undefined
      }
    />
  );
}
