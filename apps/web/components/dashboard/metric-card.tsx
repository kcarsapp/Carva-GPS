"use client";

import { ArrowDownRight, ArrowUpRight } from "lucide-react";

import { Card, CardContent } from "@/components/ui/card";
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
    <Card>
      <CardContent className="p-5">
        <p className="text-sm font-medium text-muted-foreground">
          {t(metric.label)}
        </p>
        <div className="mt-2 flex items-end justify-between gap-2">
          <span className="text-3xl font-bold tracking-tight">
            {metric.value}
          </span>
          {metric.delta !== 0 && (
            <span
              className={cn(
                "mb-1 inline-flex items-center gap-0.5 text-xs font-semibold",
                isGood
                  ? "text-emerald-600 dark:text-emerald-400"
                  : "text-red-500",
              )}
            >
              <Arrow className="h-3.5 w-3.5" />
              {Math.abs(metric.delta)}
              {metric.id === "alerts" ? "" : "%"}
            </span>
          )}
        </div>
        {metric.delta !== 0 && (
          <p className="mt-1 text-xs text-muted-foreground">vs. previous 7 days</p>
        )}
      </CardContent>
    </Card>
  );
}
