"use client";

import * as React from "react";

import { cn } from "@/lib/utils";

/**
 * Lightweight tooltip: wraps its child in an inline-flex anchor and reveals a
 * bubble on hover or keyboard focus. No popper library — the bubble is
 * absolutely positioned relative to the anchor.
 */
export function Tooltip({
  content,
  side = "top",
  className,
  children,
}: {
  content: React.ReactNode;
  side?: "top" | "bottom";
  className?: string;
  children: React.ReactNode;
}) {
  const [open, setOpen] = React.useState(false);

  return (
    <span
      className="relative inline-flex"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onFocus={() => setOpen(true)}
      onBlur={() => setOpen(false)}
    >
      {children}
      {open && content ? (
        <span
          role="tooltip"
          className={cn(
            // Fade only: the centring uses transform, which a pop would override.
            "fade-in pointer-events-none absolute left-1/2 z-50 -translate-x-1/2 whitespace-nowrap rounded-md border bg-popover px-2 py-1 text-xs font-medium text-popover-foreground shadow-md",
            side === "top" ? "bottom-full mb-1.5" : "top-full mt-1.5",
            className,
          )}
        >
          {content}
        </span>
      ) : null}
    </span>
  );
}
