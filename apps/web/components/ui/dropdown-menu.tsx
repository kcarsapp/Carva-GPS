"use client";

import * as React from "react";

import { cn } from "@/lib/utils";

/**
 * Minimal dropdown menu (no Radix dependency). The content is absolutely
 * positioned inside a relative wrapper, so it needs no popper library; it
 * closes on outside click, Escape, or item selection.
 */

interface MenuCtx {
  open: boolean;
  setOpen: (v: boolean) => void;
}

const Ctx = React.createContext<MenuCtx | null>(null);

function useMenu(component: string): MenuCtx {
  const ctx = React.useContext(Ctx);
  if (!ctx) throw new Error(`<${component}> must be used inside <DropdownMenu>`);
  return ctx;
}

export function DropdownMenu({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  const [open, setOpen] = React.useState(false);
  const rootRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (!open) return;
    function onPointerDown(e: MouseEvent | TouchEvent) {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("touchstart", onPointerDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("touchstart", onPointerDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const ctx = React.useMemo<MenuCtx>(() => ({ open, setOpen }), [open]);

  return (
    <Ctx.Provider value={ctx}>
      <div ref={rootRef} className={cn("relative inline-block", className)}>
        {children}
      </div>
    </Ctx.Provider>
  );
}

export function DropdownMenuTrigger({
  className,
  children,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  const { open, setOpen } = useMenu("DropdownMenuTrigger");
  return (
    <button
      type="button"
      aria-haspopup="menu"
      aria-expanded={open}
      onClick={() => setOpen(!open)}
      className={className}
      {...props}
    >
      {children}
    </button>
  );
}

export function DropdownMenuContent({
  align = "end",
  className,
  children,
}: {
  /** Which edge of the trigger the menu lines up with (writing-direction aware). */
  align?: "start" | "end";
  className?: string;
  children: React.ReactNode;
}) {
  const { open } = useMenu("DropdownMenuContent");
  if (!open) return null;
  return (
    <div
      role="menu"
      className={cn(
        "pop absolute top-full z-50 mt-1 min-w-[11rem] overflow-hidden rounded-xl border bg-card p-1 text-card-foreground shadow-[var(--shadow-raised)]",
        // Grows out of the corner it is attached to (mirrored in RTL).
        align === "end"
          ? "end-0 ltr:origin-top-right rtl:origin-top-left"
          : "start-0 ltr:origin-top-left rtl:origin-top-right",
        className,
      )}
    >
      {children}
    </div>
  );
}

export function DropdownMenuItem({
  className,
  onSelect,
  disabled,
  children,
}: {
  className?: string;
  onSelect?: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  const { setOpen } = useMenu("DropdownMenuItem");
  return (
    <button
      type="button"
      role="menuitem"
      disabled={disabled}
      onClick={() => {
        onSelect?.();
        setOpen(false);
      }}
      className={cn(
        "flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-start text-sm transition-colors hover:bg-accent hover:text-accent-foreground disabled:pointer-events-none disabled:opacity-50 [&_svg]:size-4 [&_svg]:shrink-0",
        className,
      )}
    >
      {children}
    </button>
  );
}

export function DropdownMenuLabel({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        "px-2.5 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground",
        className,
      )}
    >
      {children}
    </div>
  );
}

export function DropdownMenuSeparator({ className }: { className?: string }) {
  return <div className={cn("my-1 h-px bg-border", className)} />;
}
