"use client";

import * as React from "react";
import { Gauge, Languages, MailWarning, Radio } from "lucide-react";

import { useLandingCopy } from "@/components/landing/copy";
import { enter, gsap, MQ } from "@/components/landing/gsap";

/**
 * A HUD strip of hard facts under the hero. Every figure is true of the
 * product today: ~5 s position updates while driving (measured on the fleet's
 * tracker), the engine-cut safety limit of 5 km/h (the automation runner's
 * downgrade threshold), the six email warning types, three languages.
 * Figures count up once when the strip arrives; a light scan crosses it.
 */
const ICONS = [Radio, Gauge, MailWarning, Languages];

export function LandingStats() {
  const c = useLandingCopy();
  const root = React.useRef<HTMLElement>(null);

  React.useLayoutEffect(() => {
    const el = root.current;
    if (!el) return;
    const q = gsap.utils.selector(el);
    const mm = gsap.matchMedia();
    mm.add(`${MQ.desktop}, ${MQ.mobile}`, () => {
      const tl = gsap.timeline({ scrollTrigger: { trigger: el, start: enter(85) } });
      tl.from(q(".lst-cell"), { y: 24, autoAlpha: 0, duration: 0.8, stagger: 0.08, ease: "expo.out" })
        .fromTo(q(".lst-scan"), { xPercent: -100 }, { xPercent: 400, duration: 1.4, ease: "power2.inOut" }, 0.1);
      q(".lst-num").forEach((n) => {
        const target = Number(n.dataset.value);
        const obj = { v: 0 };
        tl.to(obj, { v: target, duration: 1, ease: "power2.out", onUpdate: () => (n.textContent = String(Math.round(obj.v))) }, 0.15);
      });
    });
    return () => mm.revert();
  }, []);

  return (
    <section ref={root} className="lst relative" aria-label={c.stats.label}>
      <div className="container">
        <div className="lst-grid relative overflow-hidden rounded-2xl">
          <span className="lst-scan" aria-hidden />
          <ul className="grid grid-cols-2 lg:grid-cols-4">
          {c.stats.items.map((it, i) => {
            const Icon = ICONS[i];
            return (
              <li key={it.label} className="lst-cell relative p-5 sm:p-6">
                <span className="lst-corner" aria-hidden />
                <Icon className="h-4 w-4 text-[hsl(var(--gold))]" />
                <p className="font-display num mt-3 text-[clamp(1.9rem,3.4vw,2.6rem)] font-semibold leading-none tracking-tight">
                  {it.prefix && <span className="me-1 text-[0.6em] text-[#f4efe6]/80">{it.prefix}</span>}
                  <span className="lst-num" data-value={it.value}>
                    {it.value}
                  </span>
                  <span className="ms-1 text-[0.45em] font-medium text-[hsl(var(--gold))]">{it.unit}</span>
                </p>
                <p className="mt-2 text-sm leading-snug text-[#f4efe6]/75">{it.label}</p>
              </li>
            );
          })}
          </ul>
        </div>
      </div>
    </section>
  );
}
