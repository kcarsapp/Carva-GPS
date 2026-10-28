"use client";

import * as React from "react";

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import type { DayBucket, ReportTableData, StatCard } from "@/lib/reports";

/** Totals for the loaded report. Renders nothing when the view has none. */
export function ReportStatCards({ cards }: { cards: StatCard[] }) {
  if (cards.length === 0) return null;
  return (
    <div className="mb-4 grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-6">
      {cards.map((card) => (
        <Card key={card.label}>
          <CardContent className="p-4">
            <p className="text-sm font-medium text-muted-foreground">
              {card.label}
            </p>
            <p className="mt-1 text-xl font-bold tracking-tight tabular-nums">
              {card.value}
            </p>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

/**
 * Kilometres per day as plain CSS bars — no chart library on the payroll.
 * One series, so the heading names it and the peak is direct-labelled instead
 * of drawing a y-axis; every bar carries its exact figure on hover.
 */
export function DailyDistanceChart({
  title,
  unit,
  buckets,
}: {
  title: string;
  unit: string;
  buckets: DayBucket[];
}) {
  const peak = buckets.reduce((acc, b) => Math.max(acc, b.km), 0);
  // A single day is the stat card's job, and a flat zero range says nothing.
  if (buckets.length < 2 || peak <= 0) return null;

  // Thin the axis labels out once the bars get narrow.
  const labelStep = Math.ceil(buckets.length / 16);

  return (
    <Card className="mb-4">
      <CardContent className="p-4">
        <div className="flex items-baseline justify-between gap-3">
          <p className="text-sm font-medium">{title}</p>
          <p className="text-xs tabular-nums text-muted-foreground">
            {peak.toFixed(1)} {unit}
          </p>
        </div>

        <div
          role="img"
          aria-label={title}
          className="mt-3 flex h-32 items-end gap-[2px] border-b"
        >
          {buckets.map((bucket) => (
            <div
              key={bucket.day}
              title={`${bucket.day} · ${bucket.km.toFixed(1)} ${unit}`}
              className="group flex h-full flex-1 items-end"
            >
              <div
                className={cn(
                  "w-full rounded-t-[4px] transition-colors",
                  bucket.km > 0
                    ? "bg-primary/80 group-hover:bg-primary"
                    : "bg-border",
                )}
                style={{
                  height:
                    bucket.km > 0
                      ? `${Math.max((bucket.km / peak) * 100, 2)}%`
                      : "2px",
                }}
              />
            </div>
          ))}
        </div>

        <div className="mt-1 flex gap-[2px]">
          {buckets.map((bucket, i) => (
            <span
              key={bucket.day}
              className="flex-1 text-center text-[10px] tabular-nums text-muted-foreground"
            >
              {i % labelStep === 0 ? bucket.label : ""}
            </span>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

/**
 * Renders any report's pre-formatted rows, plus an optional trailing action
 * column (used by the trips view to offer a per-trip replay).
 */
export function ReportTable({
  data,
  empty,
  actionHeader,
  renderAction,
}: {
  data: ReportTableData;
  empty: string;
  /** Header for the action column; the column only renders when both are set. */
  actionHeader?: string;
  renderAction?: (rowIndex: number) => React.ReactNode;
}) {
  const withAction = Boolean(actionHeader && renderAction);
  const columnCount = data.headers.length + (withAction ? 1 : 0);

  return (
    <div className="overflow-x-auto rounded-xl border bg-card">
      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            {data.headers.map((header, i) => (
              <TableHead
                key={`${header}-${i}`}
                // text-start over the kit's text-left so headers flip in RTL.
                className={cn("text-start", data.classNames[i])}
              >
                {header}
              </TableHead>
            ))}
            {withAction && (
              <TableHead className="text-end">{actionHeader}</TableHead>
            )}
          </TableRow>
        </TableHeader>
        <TableBody>
          {data.rows.map((row, r) => (
            <TableRow key={r}>
              {row.map((cell, c) => (
                <TableCell
                  key={c}
                  className={cn("whitespace-nowrap", data.classNames[c])}
                >
                  {cell}
                </TableCell>
              ))}
              {withAction && (
                <TableCell className="whitespace-nowrap text-end">
                  {renderAction?.(r)}
                </TableCell>
              )}
            </TableRow>
          ))}
          {data.rows.length === 0 && (
            <TableRow className="hover:bg-transparent">
              <TableCell
                colSpan={Math.max(columnCount, 1)}
                className="py-10 text-center text-sm text-muted-foreground"
              >
                {empty}
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </div>
  );
}
