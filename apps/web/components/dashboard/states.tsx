"use client";

import type { LucideIcon } from "lucide-react";
import { AlertTriangle, Inbox, RefreshCw } from "lucide-react";
import type { ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

// One vocabulary for "nothing here", "something broke" and "still loading",
// so every page answers those three moments the same way instead of each
// inventing its own grey sentence.

/** Nothing to show yet - says why, and offers the next step when there is one. */
export function EmptyState({
  icon: Icon = Inbox,
  title,
  body,
  action,
  className,
}: {
  icon?: LucideIcon;
  title: string;
  body?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "rise flex flex-col items-center justify-center rounded-2xl border border-dashed bg-card/60 px-6 py-12 text-center",
        className,
      )}
    >
      <span className="mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10 text-primary ring-1 ring-primary/15">
        <Icon className="h-6 w-6" />
      </span>
      <p className="text-[15px] font-semibold">{title}</p>
      {body && (
        <p className="mt-1.5 max-w-md text-sm leading-relaxed text-muted-foreground">{body}</p>
      )}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

/** Something failed - plain words, and a retry when the caller can offer one. */
export function ErrorState({
  title,
  body,
  onRetry,
  retryLabel,
  className,
}: {
  title: string;
  body?: ReactNode;
  onRetry?: () => void;
  retryLabel?: string;
  className?: string;
}) {
  return (
    <div
      role="alert"
      className={cn(
        "rise flex items-start gap-3 rounded-2xl border border-destructive/25 bg-destructive/[0.06] p-4",
        className,
      )}
    >
      <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-destructive" />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-destructive">{title}</p>
        {body && <p className="mt-0.5 text-sm text-muted-foreground">{body}</p>}
      </div>
      {onRetry && (
        <Button size="sm" variant="outline" onClick={onRetry} className="shrink-0">
          <RefreshCw />
          {retryLabel ?? "Retry"}
        </Button>
      )}
    </div>
  );
}

/** Placeholder rows shaped like the content that is coming. */
export function ListSkeleton({ rows = 4, className }: { rows?: number; className?: string }) {
  return (
    <div className={cn("space-y-2.5", className)} aria-busy="true" aria-live="polite">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="flex items-center gap-3 rounded-xl border bg-card p-3.5">
          <Skeleton className="h-10 w-10 rounded-xl" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-3.5 w-2/5" />
            <Skeleton className="h-3 w-3/5" />
          </div>
          <Skeleton className="h-6 w-16 rounded-full" />
        </div>
      ))}
    </div>
  );
}
