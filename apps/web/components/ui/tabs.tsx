"use client";

import * as React from "react";

import { cn } from "@/lib/utils";

/**
 * Minimal tabs primitive (no Radix dependency).
 *
 * Works controlled (`value` + `onValueChange`) or uncontrolled (`defaultValue`),
 * with roving arrow-key navigation that follows the writing direction so it
 * behaves correctly in Arabic / Kurdish.
 */

interface TabsCtx {
  value: string;
  setValue: (v: string) => void;
  baseId: string;
}

const Ctx = React.createContext<TabsCtx | null>(null);

function useTabs(component: string): TabsCtx {
  const ctx = React.useContext(Ctx);
  if (!ctx) throw new Error(`<${component}> must be used inside <Tabs>`);
  return ctx;
}

export function Tabs({
  value,
  defaultValue,
  onValueChange,
  className,
  children,
}: {
  value?: string;
  defaultValue?: string;
  onValueChange?: (value: string) => void;
  className?: string;
  children: React.ReactNode;
}) {
  const [uncontrolled, setUncontrolled] = React.useState(defaultValue ?? "");
  const baseId = React.useId();
  const current = value ?? uncontrolled;

  const setValue = React.useCallback(
    (v: string) => {
      if (value === undefined) setUncontrolled(v);
      onValueChange?.(v);
    },
    [value, onValueChange],
  );

  const ctx = React.useMemo<TabsCtx>(
    () => ({ value: current, setValue, baseId }),
    [current, setValue, baseId],
  );

  return (
    <Ctx.Provider value={ctx}>
      <div className={className}>{children}</div>
    </Ctx.Provider>
  );
}

export function TabsList({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  const ref = React.useRef<HTMLDivElement>(null);

  function onKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key)) return;
    const list = ref.current;
    if (!list) return;
    const tabs = Array.from(
      list.querySelectorAll<HTMLButtonElement>('[role="tab"]:not([disabled])'),
    );
    if (tabs.length === 0) return;

    const rtl = getComputedStyle(list).direction === "rtl";
    const active = tabs.findIndex((el) => el === document.activeElement);
    let next = active;
    if (e.key === "Home") next = 0;
    else if (e.key === "End") next = tabs.length - 1;
    else {
      const forward = rtl ? e.key === "ArrowLeft" : e.key === "ArrowRight";
      next = active < 0 ? 0 : (active + (forward ? 1 : -1) + tabs.length) % tabs.length;
    }
    e.preventDefault();
    tabs[next]?.focus();
    tabs[next]?.click();
  }

  return (
    <div
      ref={ref}
      role="tablist"
      onKeyDown={onKeyDown}
      className={cn(
        "inline-flex items-center gap-1 rounded-xl border bg-muted/60 p-1 text-muted-foreground",
        className,
      )}
    >
      {children}
    </div>
  );
}

export function TabsTrigger({
  value,
  className,
  disabled,
  children,
}: {
  value: string;
  className?: string;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  const { value: active, setValue, baseId } = useTabs("TabsTrigger");
  const selected = active === value;
  return (
    <button
      type="button"
      role="tab"
      id={`${baseId}-tab-${value}`}
      aria-controls={`${baseId}-panel-${value}`}
      aria-selected={selected}
      tabIndex={selected ? 0 : -1}
      disabled={disabled}
      onClick={() => setValue(value)}
      className={cn(
        "press inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-md px-3 py-1.5 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 [&_svg]:size-4 [&_svg]:shrink-0",
        selected
          ? "bg-card text-foreground shadow-[var(--shadow-card)] ring-1 ring-primary/25 [&_svg]:text-primary"
          : "hover:bg-background/60 hover:text-foreground",
        className,
      )}
    >
      {children}
    </button>
  );
}

export function TabsContent({
  value,
  className,
  children,
}: {
  value: string;
  className?: string;
  children: React.ReactNode;
}) {
  const { value: active, baseId } = useTabs("TabsContent");
  if (active !== value) return null;
  return (
    <div
      role="tabpanel"
      id={`${baseId}-panel-${value}`}
      aria-labelledby={`${baseId}-tab-${value}`}
      className={cn("focus-visible:outline-none", className)}
    >
      {children}
    </div>
  );
}
