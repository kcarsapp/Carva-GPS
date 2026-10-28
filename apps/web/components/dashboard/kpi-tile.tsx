"use client";

import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

import { cn } from "@/lib/utils";
import { CountUp } from "@/lib/motion";

/**
 * The one KPI tile used across the dashboard: a quiet label, a large figure
 * that counts up the first time real data lands (never on later live
 * updates), and an optional icon and footnote. The gold hairline on top is
 * the only decoration, and only `accent` tiles get it - so it still means
 * "look here" when it appears.
 */
export function KpiTile({
  label,
  value,
  icon: Icon,
  tone,
  accent = false,
  footnote,
  className,
}: {
  label: string;
  /** Display string, e.g. "24.6 km" or "1 / 4". "—" renders as-is. */
  value: string;
  icon?: LucideIcon;
  /** Text colour class for the figure (semantic status colours only). */
  tone?: string;
  accent?: boolean;
  footnote?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "relative overflow-hidden rounded-2xl border bg-card p-4 shadow-[var(--shadow-card)]",
        className,
      )}
    >
      {accent && (
        <span className="absolute inset-x-4 top-0 h-px bg-gradient-to-r from-transparent via-primary/70 to-transparent" />
      )}
      <div className="flex items-center justify-between gap-2">
        <p className="eyebrow truncate">{label}</p>
        {Icon && <Icon className="h-4 w-4 shrink-0 text-muted-foreground/70" />}
      </div>
      <p
        className={cn(
          "font-display num mt-1.5 text-[26px] font-semibold leading-none tracking-tight",
          tone,
        )}
      >
        <CountUp value={value} />
      </p>
      {footnote && <p className="mt-1.5 text-xs text-muted-foreground">{footnote}</p>}
    </div>
  );
}
