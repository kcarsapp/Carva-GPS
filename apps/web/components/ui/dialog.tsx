"use client";

import * as React from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";

import { cn } from "@/lib/utils";
import { DUR, usePresence } from "@/lib/motion";

/**
 * Minimal modal dialog (no Radix dependency): portal + backdrop, Escape to
 * close, body scroll lock, initial focus into the panel and focus restored to
 * whatever was focused before it opened.
 */

export function Dialog({
  open,
  onOpenChange,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: React.ReactNode;
}) {
  const [mounted, setMounted] = React.useState(false);
  const panelRef = React.useRef<HTMLDivElement>(null);
  const restoreRef = React.useRef<HTMLElement | null>(null);
  // Kept on screen for its short exit animation after `open` turns false.
  // Focus/scroll handling below still follows `open`, so closing is instant
  // for keyboard and assistive tech - only the pixels linger.
  const presence = usePresence(open, DUR.fast);

  React.useEffect(() => setMounted(true), []);

  React.useEffect(() => {
    if (!open) return;

    restoreRef.current = document.activeElement as HTMLElement | null;
    const { overflow } = document.body.style;
    document.body.style.overflow = "hidden";

    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onOpenChange(false);
    }
    document.addEventListener("keydown", onKey);

    // Focus the first focusable element in the panel (or the panel itself).
    const focusTimer = window.setTimeout(() => {
      const panel = panelRef.current;
      if (!panel) return;
      const target = panel.querySelector<HTMLElement>(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
      );
      (target ?? panel).focus();
    }, 0);

    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = overflow;
      window.clearTimeout(focusTimer);
      restoreRef.current?.focus?.();
    };
  }, [open, onOpenChange]);

  if (!mounted || !presence.mounted) return null;

  return createPortal(
    // `app-fleet` is REQUIRED here: the theme tokens (--card, --border, …) are
    // scoped to that class in fleet.css, and this portal mounts on document.body
    // outside it. Without it every surface renders transparent and borderless.
    // That class ALSO paints `background-color: hsl(var(--background))`, which
    // over a full-viewport overlay hides the page completely — so the utility
    // below cancels it and lets the scrim and blur actually show the map.
    <div className="app-fleet !bg-transparent fixed inset-0 z-[100] flex items-center justify-center p-4">
      {/* Light scrim + a real blur: at 50% black over the dark theme the map
          behind just read as solid black, losing the sense of place. */}
      <div
        className={cn(
          "absolute inset-0 bg-black/30 backdrop-blur-md",
          presence.leaving ? "fade-out" : "fade-in",
        )}
        onClick={() => onOpenChange(false)}
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-hidden={presence.leaving || undefined}
        tabIndex={-1}
        // Width belongs to DialogContent (max-w-lg unless it asks for more);
        // capping it here too silently clamped wider dialogs to 32rem.
        className={cn(
          "relative z-10 flex w-full justify-center focus:outline-none",
          presence.leaving ? "pop-out pointer-events-none" : "pop",
        )}
      >
        {children}
      </div>
    </div>,
    document.body,
  );
}

export function DialogContent({
  className,
  onClose,
  children,
}: {
  className?: string;
  /** Renders a close button in the corner when provided. */
  onClose?: () => void;
  children: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        "relative max-h-[85vh] w-full max-w-lg overflow-y-auto rounded-2xl border bg-card p-5 text-card-foreground shadow-[var(--shadow-raised)]",
        className,
      )}
    >
      {onClose && (
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="absolute end-3 top-3 flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          <X className="h-4 w-4" />
        </button>
      )}
      {children}
    </div>
  );
}

export function DialogHeader({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  return <div className={cn("mb-4 pe-8", className)}>{children}</div>;
}

export function DialogTitle({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <h2 className={cn("text-base font-semibold tracking-tight", className)}>
      {children}
    </h2>
  );
}

export function DialogDescription({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <p className={cn("mt-1 text-sm text-muted-foreground", className)}>{children}</p>
  );
}

export function DialogFooter({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={cn("mt-5 flex flex-wrap items-center justify-end gap-2", className)}>
      {children}
    </div>
  );
}
