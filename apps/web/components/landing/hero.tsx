"use client";

import * as React from "react";
import Link from "next/link";
import { ArrowRight, Compass, Gauge, MapPin, Radio } from "lucide-react";

import { Button } from "@/components/ui/button";
import { NightCity } from "@/components/landing/night-city";
import { useLandingCopy } from "@/components/landing/copy";
import { gsap, MQ, SplitText } from "@/components/landing/gsap";

/**
 * Hero: a 3D-tilted night map of Erbil. On load the city "switches on"
 * (roads draw out from the centre, lights blink on, the plane tilts into
 * place) while the headline rises line by line. Scrolling then flattens and
 * zooms the plane, extends the gold drive and moves the car along it, with a
 * live-looking speed readout - the first beat of the story below.
 */
export function LandingHero() {
  const c = useLandingCopy();
  const root = React.useRef<HTMLElement>(null);
  const speedRef = React.useRef<HTMLSpanElement>(null);
  const headingRef = React.useRef<HTMLSpanElement>(null);

  React.useLayoutEffect(() => {
    const el = root.current;
    if (!el) return;
    const q = gsap.utils.selector(el);
    const mm = gsap.matchMedia();

    mm.add({ motion: `${MQ.desktop}, ${MQ.mobile}`, desktop: MQ.desktop, reduce: MQ.reduce }, (ctx) => {
      const { desktop, reduce } = ctx.conditions as { desktop: boolean; reduce: boolean };
      const drive = q(".nc-drive")[0] as unknown as SVGPathElement;
      const glow = q(".nc-drive-glow")[0];
      const car = q(".nc-car")[0];
      // Readout follows the car: speed from the tween, heading from the
      // rotation MotionPath gives it (SVG 0deg = east -> compass +90).
      const setSpeed = (kmh: number) => {
        if (speedRef.current) speedRef.current.textContent = String(Math.round(kmh));
        if (headingRef.current) {
          const deg = (((Number(gsap.getProperty(car, "rotation")) || 0) + 90) % 360 + 360) % 360;
          const dir = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"][Math.round(deg / 45) % 8];
          headingRef.current.textContent = `${dir} ${Math.round(deg)}°`;
        }
      };

      if (reduce) {
        // Final state, no motion: drive drawn to the hero's end, car parked on it.
        gsap.set(q(".lh-plane"), { autoAlpha: 1, rotateX: 40, rotateZ: -6 });
        gsap.set(car, { autoAlpha: 1 });
        gsap.set([drive, glow], { drawSVG: "0% 55%" });
        gsap.set(car, { motionPath: { path: drive, align: drive, alignOrigin: [0.5, 0.5], autoRotate: true, start: 0.55, end: 0.55 } });
        setSpeed(48);
        return;
      }

      // ---- intro (time-based, plays once on load) ----
      // Hide the drive and car from the very first frame; the intro reveals
      // them at 1.1 s and must not show the whole route before that.
      gsap.set([drive, glow], { drawSVG: "0% 0%" });
      gsap.set(car, { autoAlpha: 0 });
      const split = SplitText.create(q(".lh-title")[0], { type: "lines", mask: "lines", linesClass: "lh-line" });
      const intro = gsap.timeline({ defaults: { ease: "expo.out" } });
      intro
        .fromTo(
          q(".lh-plane"),
          { rotateX: 74, rotateZ: -16, yPercent: 14, scale: 0.86, autoAlpha: 0 },
          { rotateX: desktop ? 54 : 48, rotateZ: -9, yPercent: 0, scale: 1, autoAlpha: 1, duration: 2.2 },
          0,
        )
        // Draw only the thin road cores; the wide casings just fade in -
        // half the paths to re-render during the intro.
        .from(q(".nc-street"), { drawSVG: "50% 50%", duration: 1.8, stagger: { each: 0.02, from: "center" }, ease: "power2.inOut" }, 0.15)
        .from(q(".nc-street-casing"), { opacity: 0, duration: 1.4, ease: "power1.out" }, 0.4)
        .from(q(".nc-base"), { scale: 0, transformOrigin: "50% 50%", duration: 0.9, ease: "back.out(2)" }, 0.9)
        .fromTo([drive, glow], { drawSVG: "0% 0%" }, { drawSVG: "0% 12%", duration: 1.4, ease: "power2.inOut" }, 1.1)
        .fromTo(
          car,
          { autoAlpha: 0 },
          {
            autoAlpha: 1,
            duration: 1.4,
            ease: "power2.inOut",
            motionPath: { path: drive, align: drive, alignOrigin: [0.5, 0.5], autoRotate: true, start: 0, end: 0.12 },
            onUpdate(this: gsap.core.Tween) {
              setSpeed(this.progress() * 22);
            },
          },
          1.1,
        )
        .from(q(".lh-eyebrow"), { y: 16, autoAlpha: 0, duration: 0.9 }, 0.35)
        .from(split.lines, { yPercent: 115, duration: 1.2, stagger: 0.11 }, 0.45)
        .from(q(".lh-sub"), { y: 20, autoAlpha: 0, duration: 1 }, 0.9)
        .from(q(".lh-cta > *"), { y: 18, autoAlpha: 0, duration: 0.9, stagger: 0.08 }, 1.05)
        .from(q(".lh-hud"), { y: 30, autoAlpha: 0, scale: 0.96, duration: 1.1 }, 1.3)
        .from(q(".lh-hud-row"), { x: 14, autoAlpha: 0, stagger: 0.08, duration: 0.7 }, 1.5)
        .from(q(".lh-scroll"), { autoAlpha: 0, duration: 0.8 }, 2);

      // ---- scroll: the drive continues as the hero leaves ----
      const scroll = gsap.timeline({
        // Light smoothing only: 0.8s made the scene trail the scroll (felt laggy).
        scrollTrigger: { trigger: el, start: "top top", end: "bottom top", scrub: 0.25 },
        defaults: { ease: "none" },
      });
      scroll
        .to(q(".lh-plane"), { rotateX: desktop ? 30 : 34, rotateZ: -3, scale: desktop ? 1.25 : 1.15, yPercent: -6 }, 0)
        .to([drive, glow], { drawSVG: "0% 55%" }, 0)
        .to(
          car,
          {
            motionPath: { path: drive, align: drive, alignOrigin: [0.5, 0.5], autoRotate: true, start: 0.12, end: 0.55 },
            onUpdate(this: gsap.core.Tween) {
              setSpeed(22 + this.progress() * 26);
            },
          },
          0,
        )
        .to(q(".lh-copy"), { yPercent: desktop ? -18 : -8, autoAlpha: 0.15 }, 0)
        .to(q(".lh-hud"), { yPercent: -30, autoAlpha: 0 }, 0.35)
        .to(q(".lh-scroll"), { autoAlpha: 0 }, 0);

      return () => split.revert();
    });

    return () => mm.revert();
  }, []);

  return (
    <section ref={root} className="lh-hero relative isolate overflow-hidden" aria-labelledby="lh-title">
      {/* The 3D map plane */}
      <div className="lh-stage pointer-events-none absolute inset-0" aria-hidden>
        <div className="lh-plane">
          <NightCity layers={{ drive: true, car: true, base: true }} labels={{ base: c.hero.hudZoneValue }} />
        </div>
      </div>
      <div className="lh-veil pointer-events-none absolute inset-0" aria-hidden />

      <div className="container relative z-10 flex min-h-[100svh] items-center pb-24 pt-28">
        <div className="lh-copy max-w-[40rem]">
          <p className="lh-eyebrow eyebrow !text-[hsl(var(--gold))]">{c.hero.eyebrow}</p>
          <h1 id="lh-title" className="lh-title font-display mt-4 text-[clamp(2.6rem,6.4vw,5.2rem)] font-semibold leading-[1.02] tracking-tight">
            <span className="block">{c.hero.title1}</span>
            <span className="block">{c.hero.title2}</span>
            <span className="lh-gold block">{c.hero.title3}</span>
          </h1>
          <p className="lh-sub mt-6 max-w-[34rem] text-[17px] leading-relaxed text-[#f4efe6]/80 sm:text-lg">
            {c.hero.sub}
          </p>
          <div className="lh-cta mt-9 flex flex-wrap items-center gap-3">
            <Button asChild size="lg" className="h-12 px-6 text-base">
              <Link href="/fleet">
                {c.hero.ctaDemo}
                <ArrowRight className="rtl:rotate-180" />
              </Link>
            </Button>
            <a href="#story" className="lh-ghost press inline-flex h-12 items-center gap-2 rounded-lg px-5 text-base font-medium">
              <Radio className="h-4 w-4 text-[hsl(var(--gold))]" />
              {c.hero.ctaWatch}
            </a>
          </div>
        </div>
      </div>

      {/* Dashboard-style readout for the car on the map (illustration). */}
      <aside className="lh-hud glass glass-sheen absolute bottom-10 end-6 z-10 hidden w-64 rounded-2xl p-4 lg:block" aria-hidden>
        <div className="mb-3 flex items-center justify-between">
          <span className="eyebrow">Rental 12</span>
          <span className="rounded-full border border-white/10 px-2 py-0.5 text-[10px] uppercase tracking-wider text-[#f4efe6]/50">
            {c.hero.demoTag}
          </span>
        </div>
        <div className="lh-hud-row flex items-center justify-between py-1.5">
          <span className="flex items-center gap-2 text-xs text-[#f4efe6]/60"><Gauge className="h-3.5 w-3.5" />{c.hero.hudSpeed}</span>
          <span className="num font-display text-lg font-semibold text-[hsl(var(--gold))]"><span ref={speedRef}>0</span> <span className="text-xs text-[#f4efe6]/50">km/h</span></span>
        </div>
        <div className="lh-hud-row flex items-center justify-between py-1.5">
          <span className="flex items-center gap-2 text-xs text-[#f4efe6]/60"><Radio className="h-3.5 w-3.5" />{c.hero.hudUpdated}</span>
          <span className="text-sm font-medium">{c.hero.hudUpdatedValue}</span>
        </div>
        <div className="lh-hud-row flex items-center justify-between py-1.5">
          <span className="flex items-center gap-2 text-xs text-[#f4efe6]/60"><Compass className="h-3.5 w-3.5" />{c.hero.hudHeading}</span>
          <span ref={headingRef} className="num text-sm font-medium" dir="ltr">—</span>
        </div>
        <div className="lh-hud-row flex items-center justify-between py-1.5">
          <span className="flex items-center gap-2 text-xs text-[#f4efe6]/60"><MapPin className="h-3.5 w-3.5" />{c.hero.hudZone}</span>
          <span className="text-sm font-medium">{c.hero.hudZoneValue}</span>
        </div>
      </aside>

      <a href="#story" className="lh-scroll absolute bottom-6 left-1/2 z-10 hidden -translate-x-1/2 flex-col items-center gap-2 text-[11px] uppercase tracking-[0.2em] text-[#f4efe6]/45 sm:flex">
        <span className="lh-mouse" aria-hidden />
        {c.hero.scroll}
      </a>
    </section>
  );
}
