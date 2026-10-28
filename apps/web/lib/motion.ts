"use client";

import * as React from "react";

// Motion helpers shared by the fleet UI. Timings mirror the CSS tokens in
// app/fleet.css (--dur-*, --ease-*) so JS-driven and CSS-driven motion agree.

export const DUR = { fast: 140, base: 220, slow: 340, spring: 480 } as const;

/** Live `prefers-reduced-motion`. False on the server and before mount. */
export function useReducedMotion(): boolean {
  const [reduced, setReduced] = React.useState(false);
  React.useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReduced(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);
  return reduced;
}

/** One-shot check for imperative code (map animation loops etc). */
export function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

/**
 * Keeps an element mounted long enough to play its exit animation.
 * Returns whether to render, and whether it is currently leaving - use the
 * latter to swap the enter class for the exit class.
 */
export function usePresence(open: boolean, exitMs: number = DUR.base) {
  const [mounted, setMounted] = React.useState(open);
  const [leaving, setLeaving] = React.useState(false);
  React.useEffect(() => {
    if (open) {
      setMounted(true);
      setLeaving(false);
      return;
    }
    if (!mounted) return;
    setLeaving(true);
    const id = setTimeout(() => {
      setMounted(false);
      setLeaving(false);
    }, prefersReducedMotion() ? 0 : exitMs);
    return () => clearTimeout(id);
    // `mounted` is read, not tracked: re-running on it would cancel the exit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, exitMs]);
  return { mounted, leaving };
}

const NUMBER = /-?\d+(?:\.\d+)?/g;

/**
 * Counts every number inside a display string up from zero the FIRST time it
 * shows a real value ("429", "24.6 km", "1 / 4"), keeping decimals and the
 * surrounding text. Later changes are shown instantly: live figures must
 * never be tweened, or the screen would show values that never existed.
 */
export function useCountUp(display: string, duration = 700): string {
  const reduced = useReducedMotion();
  const [shown, setShown] = React.useState(display);
  const playedRef = React.useRef(false);

  React.useEffect(() => {
    const hasNumber = /\d/.test(display);
    // "1,234" is a thousands separator in one locale and a decimal comma in
    // another; rather than guess (and flash a wrong value), skip the effect.
    const ambiguous = /\d,\d/.test(display);
    if (playedRef.current || reduced || !hasNumber || ambiguous) {
      if (hasNumber) playedRef.current = true;
      setShown(display);
      return;
    }
    playedRef.current = true;
    const targets = display.match(NUMBER) ?? [];
    const start = performance.now();
    let raf = 0;
    const frame = (now: number) => {
      const p = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - p, 3); // ease-out cubic
      let i = 0;
      setShown(
        display.replace(NUMBER, () => {
          const raw = targets[i++] ?? "0";
          const decimals = (raw.split(".")[1] ?? "").length;
          const value = parseFloat(raw) * eased;
          return value.toFixed(decimals);
        }),
      );
      if (p < 1) raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [display, duration, reduced]);

  return shown;
}

/** Drop-in text node for a counted-up KPI value. */
export function CountUp({ value, duration }: { value: string; duration?: number }) {
  return React.createElement(React.Fragment, null, useCountUp(value, duration));
}
