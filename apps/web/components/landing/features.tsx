"use client";

import * as React from "react";
import {
  BarChart3,
  BatteryCharging,
  Hexagon,
  History,
  Languages,
  Mail,
  Map as MapIcon,
  Navigation,
  Power,
  type LucideIcon,
} from "lucide-react";

import { useLandingCopy } from "@/components/landing/copy";
import { enter, gsap, MQ, ScrollTrigger, SplitText } from "@/components/landing/gsap";

const ICONS: LucideIcon[] = [MapIcon, Navigation, Hexagon, Power, Mail, History, BarChart3, BatteryCharging, Languages];

/**
 * Nine real features as glass cards. They rise in a tilted 3D cascade with a
 * light-scan sweep as they land; on hover-capable screens each card leans
 * toward the pointer and a gold spotlight follows it.
 */
export function LandingFeatures() {
  const c = useLandingCopy();
  const root = React.useRef<HTMLElement>(null);

  React.useLayoutEffect(() => {
    const el = root.current;
    if (!el) return;
    const q = gsap.utils.selector(el);
    const mm = gsap.matchMedia();

    mm.add(`${MQ.desktop}, ${MQ.mobile}`, () => {
      const split = SplitText.create(q(".lf-title")[0], { type: "words", mask: "words" });
      gsap.from(split.words, {
        yPercent: 110,
        stagger: 0.05,
        duration: 1,
        ease: "expo.out",
        scrollTrigger: { trigger: q(".lf-head")[0], start: enter(80) },
      });
      gsap.from(q(".lf-eyebrow"), { y: 16, autoAlpha: 0, duration: 0.8, scrollTrigger: { trigger: q(".lf-head")[0], start: enter(80) } });

      gsap.set(q(".lf-card"), { transformPerspective: 900 });
      const cards = gsap.utils.toArray<HTMLElement>(q(".lf-card"));
      gsap.set(cards, { y: 70, rotateX: -16, autoAlpha: 0 });
      landInRows(cards);
      return () => split.revert();
    });

    // Pointer tilt + spotlight: real hover devices only.
    mm.add(`${MQ.desktop} and (hover: hover)`, () => {
      const cleanups: (() => void)[] = [];
      gsap.utils.toArray<HTMLElement>(q(".lf-card")).forEach((card) => {
        const rx = gsap.quickTo(card, "rotateX", { duration: 0.5, ease: "power3.out" });
        const ry = gsap.quickTo(card, "rotateY", { duration: 0.5, ease: "power3.out" });
        const move = (e: PointerEvent) => {
          const r = card.getBoundingClientRect();
          const px = (e.clientX - r.left) / r.width;
          const py = (e.clientY - r.top) / r.height;
          ry((px - 0.5) * 10);
          rx((0.5 - py) * 8);
          card.style.setProperty("--mx", `${(px * 100).toFixed(1)}%`);
          card.style.setProperty("--my", `${(py * 100).toFixed(1)}%`);
        };
        const enter = () => gsap.set(card, { transformPerspective: 900 });
        const leave = () => {
          rx(0);
          ry(0);
        };
        card.addEventListener("pointerenter", enter);
        card.addEventListener("pointermove", move);
        card.addEventListener("pointerleave", leave);
        cleanups.push(() => {
          card.removeEventListener("pointerenter", enter);
          card.removeEventListener("pointermove", move);
          card.removeEventListener("pointerleave", leave);
        });
      });
      return () => cleanups.forEach((f) => f());
    });

    return () => mm.revert();
  }, []);

  return (
    <section id="features" ref={root} className="lf-section relative py-28" aria-labelledby="lf-title">
      <div className="lf-head container text-center">
        <p className="lf-eyebrow eyebrow !text-[hsl(var(--gold))]">{c.features.eyebrow}</p>
        <h2 id="lf-title" className="lf-title font-display mx-auto mt-3 max-w-3xl text-[clamp(2rem,4.2vw,3.4rem)] font-semibold leading-tight tracking-tight">
          {c.features.title}
        </h2>
      </div>
      <ul className="container mt-16 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {c.features.items.map((f, i) => {
          const Icon = ICONS[i] ?? MapIcon;
          return (
            <li key={f.t} className="lf-card group relative overflow-hidden rounded-2xl p-6">
              <span className="lf-scan" aria-hidden />
              <span className="lf-spot" aria-hidden />
              <span className="lf-icon relative flex h-12 w-12 items-center justify-center rounded-xl">
                <Icon className="h-5 w-5" />
              </span>
              <h3 className="font-display relative mt-5 text-lg font-semibold">{f.t}</h3>
              <p className="relative mt-2 text-[15px] leading-relaxed text-[#f4efe6]/75">{f.d}</p>
              <span className="lf-index num absolute end-5 top-5 text-xs text-[#f4efe6]/25">0{i + 1}</span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/** Cards land in rows as they enter, each with a one-off light scan. */
function landInRows(cards: HTMLElement[]) {
  ScrollTrigger.batch(cards, {
    start: enter(88),
    once: true,
    onEnter: (batch) => {
      gsap.to(batch, {
        y: 0,
        rotateX: 0,
        autoAlpha: 1,
        duration: 1.1,
        ease: "expo.out",
        stagger: 0.09,
        // Landed: drop the 3D transform so each card stops being its own
        // GPU layer (left on, it rendered with seams on some phones).
        onComplete: () => gsap.set(batch, { clearProps: "transform" }),
      });
      batch.forEach((card, i) =>
        gsap.fromTo(
          card.querySelector(".lf-scan"),
          { xPercent: -120, autoAlpha: 1 },
          { xPercent: 220, autoAlpha: 0, duration: 1.2, delay: 0.15 + i * 0.09, ease: "power2.inOut" },
        ),
      );
    },
  });
}
