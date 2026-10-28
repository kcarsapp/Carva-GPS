"use client";

// GSAP for the landing page only (the dashboard never imports this, so it
// pays nothing). All plugins used here have been free since GSAP 3.13.
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { DrawSVGPlugin } from "gsap/DrawSVGPlugin";
import { MotionPathPlugin } from "gsap/MotionPathPlugin";
import { SplitText } from "gsap/SplitText";

const PHONE = "(max-width: 1023.98px)";

if (typeof window !== "undefined") {
  gsap.registerPlugin(ScrollTrigger, DrawSVGPlugin, MotionPathPlugin, SplitText);
  // Motion tokens shared with app/fleet.css: decelerate in, accelerate out.
  gsap.defaults({ ease: "power3.out", duration: 0.8 });
  // Phones resize the viewport as the address bar shows/hides; re-measuring
  // every trigger mid-scroll is a classic source of stutter.
  ScrollTrigger.config({ ignoreMobileResize: true });
  // Phones: everything plays 1.6x faster. Durations tuned on a large screen
  // read as "the animation arrives late" on a small one.
  gsap.matchMedia().add(PHONE, () => {
    gsap.globalTimeline.timeScale(1.6);
    return () => gsap.globalTimeline.timeScale(1);
  });
}

/**
 * Where a scroll entrance starts. Desktop: `pct` down the viewport (lets the
 * eye arrive first). Phones: the moment the element appears - on a short
 * screen a deep trigger means content is still hidden when you reach it.
 */
export function enter(pct: number): string {
  const phone = typeof window !== "undefined" && window.matchMedia(PHONE).matches;
  return phone ? "top 98%" : `top ${pct}%`;
}

/**
 * Breakpoints/conditions every scene branches on. `reduce` users get the
 * final state of every scene immediately (all content visible, no motion).
 */
export const MQ = {
  desktop: "(min-width: 1024px) and (prefers-reduced-motion: no-preference)",
  mobile: "(max-width: 1023.98px) and (prefers-reduced-motion: no-preference)",
  reduce: "(prefers-reduced-motion: reduce)",
} as const;

export { gsap, ScrollTrigger, DrawSVGPlugin, MotionPathPlugin, SplitText };
