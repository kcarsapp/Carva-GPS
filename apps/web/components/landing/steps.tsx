"use client";

import * as React from "react";
import { Cpu, MonitorSmartphone, PlugZap } from "lucide-react";

import { useLandingCopy } from "@/components/landing/copy";
import { enter, gsap, MQ } from "@/components/landing/gsap";

const ICONS = [PlugZap, Cpu, MonitorSmartphone];

/**
 * Three steps joined by a gold circuit line. The line draws with the scroll
 * (scrubbed), and each step's node lights up as the line reaches it.
 * Horizontal on desktop, vertical on phones.
 */
export function LandingSteps() {
  const c = useLandingCopy();
  const root = React.useRef<HTMLElement>(null);

  React.useLayoutEffect(() => {
    const el = root.current;
    if (!el) return;
    const q = gsap.utils.selector(el);
    const mm = gsap.matchMedia();
    mm.add(`${MQ.desktop}, ${MQ.mobile}`, () => {
      gsap.from(q(".lsx-head > *"), {
        y: 24,
        autoAlpha: 0,
        stagger: 0.1,
        duration: 1,
        ease: "expo.out",
        scrollTrigger: { trigger: el, start: enter(78) },
      });
      const steps = q(".lsx-step");
      const tl = gsap.timeline({
        scrollTrigger: {
          trigger: q(".lsx-track")[0],
          start: enter(75),
          end: "bottom 55%",
          scrub: 0.3,
          // A step is lit once the line has reached it - both directions.
          onUpdate: (self) => steps.forEach((st, i) => st.classList.toggle("is-lit", self.progress >= i / 2.6 + 0.06)),
        },
        defaults: { ease: "none" },
      });
      tl.fromTo(q(".lsx-line"), { drawSVG: "0% 0%" }, { drawSVG: "0% 100%", duration: 1 }, 0);
      steps.forEach((step, i) => {
        const at = i / 2.6;
        tl.fromTo(step.querySelector(".lsx-node"), { scale: 0.6, autoAlpha: 0.3 }, { scale: 1, autoAlpha: 1, duration: 0.12, ease: "back.out(2)" }, at)
          .fromTo(step.querySelector(".lsx-body"), { y: 24, autoAlpha: 0 }, { y: 0, autoAlpha: 1, duration: 0.18 }, at + 0.02);
      });
    });
    mm.add(MQ.reduce, () => {
      q(".lsx-step").forEach((s) => s.classList.add("is-lit"));
    });
    return () => mm.revert();
  }, []);

  return (
    <section id="how" ref={root} className="lsx-section relative py-28" aria-labelledby="lsx-title">
      <div className="lsx-head container text-center">
        <p className="eyebrow !text-[hsl(var(--gold))]">{c.steps.eyebrow}</p>
        <h2 id="lsx-title" className="font-display mx-auto mt-3 max-w-2xl text-[clamp(2rem,4.2vw,3.2rem)] font-semibold leading-tight tracking-tight">
          {c.steps.title}
        </h2>
      </div>

      <div className="lsx-track container relative mt-16">
        {/* desktop: horizontal circuit line */}
        <svg className="pointer-events-none absolute inset-x-0 top-7 hidden h-8 w-full lg:block rtl:-scale-x-100" viewBox="0 0 1000 32" preserveAspectRatio="none" aria-hidden>
          <path d="M60 16 H300 l20 -12 H660 l20 12 H940" fill="none" stroke="#2a2621" strokeWidth="2" vectorEffect="non-scaling-stroke" />
          <path className="lsx-line" d="M60 16 H300 l20 -12 H660 l20 12 H940" fill="none" stroke="#d1b06b" strokeWidth="2.5" />
        </svg>
        {/* phones: vertical line */}
        <svg className="pointer-events-none absolute bottom-10 start-[2.6rem] top-10 w-2 lg:hidden" viewBox="0 0 2 100" preserveAspectRatio="none" aria-hidden>
          <path d="M1 0 V100" stroke="#2a2621" strokeWidth="2" vectorEffect="non-scaling-stroke" />
          <path className="lsx-line" d="M1 0 V100" stroke="#d1b06b" strokeWidth="2.5" />
        </svg>

        <ol className="relative grid gap-10 lg:grid-cols-3 lg:gap-8">
          {c.steps.items.map((s, i) => {
            const Icon = ICONS[i];
            return (
              <li key={s.t} className="lsx-step flex gap-5 lg:flex-col lg:items-center lg:text-center">
                <span className="lsx-node relative z-10 flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl">
                  <Icon className="h-6 w-6" />
                  <span className="lsx-num num">{i + 1}</span>
                </span>
                <div className="lsx-body pt-1 lg:pt-4">
                  <h3 className="font-display text-xl font-semibold">{s.t}</h3>
                  <p className="mt-2 max-w-xs text-[15px] leading-relaxed text-[#f4efe6]/75">{s.d}</p>
                </div>
              </li>
            );
          })}
        </ol>
      </div>
    </section>
  );
}
