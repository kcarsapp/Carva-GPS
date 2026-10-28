"use client";

import * as React from "react";
import { Mail, Navigation, OctagonX, Power } from "lucide-react";

import { cn } from "@/lib/utils";
import { NightCity, YOU_START } from "@/components/landing/night-city";
import { SpeedGauge, gaugeState } from "@/components/landing/gauge";
import { useLandingCopy } from "@/components/landing/copy";
import { enter, gsap, MQ, ScrollTrigger } from "@/components/landing/gsap";

/**
 * "One drive, four moments" - the pinned scroll story.
 *
 * Desktop: the stage pins for ~4 screens and scrolling scrubs one timeline
 * (no snapping - the scene follows the scroll exactly):
 *   01 the car leaves the lot · 02 crosses into a restricted zone (the zone
 *   flares red, an alert email lands on a phone) · 03 a safe engine cut (the
 *   speed needle falls, the car stops) · 04 "you" appear and directions draw
 *   to the car. A rail tracks progress.
 * Phones: no pinning - the same timeline plays as a short loop while the
 *   stage is on screen, and the four chapters are listed underneath.
 * Reduced motion: the final frame, still, with every chapter readable.
 */


export function LandingStory() {
  const c = useLandingCopy();
  const s = c.story;
  const root = React.useRef<HTMLElement>(null);

  React.useLayoutEffect(() => {
    const el = root.current;
    if (!el) return;
    const q = gsap.utils.selector(el);
    const mm = gsap.matchMedia();

    const build = (tl: gsap.core.Timeline, chaptersInTimeline: boolean) => {
      const drive = q(".nc-drive")[0] as unknown as SVGPathElement;
      const glow = q(".nc-drive-glow")[0];
      const car = q(".nc-car")[0];
      const zone = q(".nc-zone-shape")[0];
      const needle = q(".lg-needle")[0];
      const fills = q(".lg-fill, .lg-fill-halo");
      const speedText = q(".lg-speed")[0];
      const along = (start: number, end: number) => ({
        path: drive,
        align: drive,
        alignOrigin: [0.5, 0.5] as [number, number],
        autoRotate: true,
        start,
        end,
      });
      const gauge = { kmh: 0 };
      const showSpeed = () => {
        // Attributes, not CSS transforms: the SVG stays crisp and the arc
        // fill and needle move in exactly the same frame.
        const g = gaugeState(gauge.kmh);
        needle?.setAttribute("transform", `rotate(${g.rotation.toFixed(2)} 100 100)`);
        fills.forEach((f) => f.setAttribute("stroke-dashoffset", g.dashoffset.toFixed(2)));
        if (speedText) speedText.textContent = String(Math.round(gauge.kmh));
      };

      // Initial frame.
      gsap.set([drive, glow], { drawSVG: "0% 0%" });
      gsap.set(car, { motionPath: along(0, 0) });
      gsap.set(q(".nc-zone"), { autoAlpha: 0 });
      gsap.set(q(".nc-you, .nc-tocar"), { autoAlpha: 0 });
      const youFrom = `${YOU_START * 100}%`;
      gsap.set(q(".nc-tocar"), { drawSVG: `${youFrom} ${youFrom}` });
      gsap.set(q(".ls-phone"), { xPercent: 130, rotateY: -28, autoAlpha: 0 });
      gsap.set(q(".ls-gauge"), { y: 40, autoAlpha: 0 });
      gsap.set(q(".ls-routecard"), { y: 30, autoAlpha: 0 });
      gsap.set(q(".ls-gauge-done"), { autoAlpha: 0 });
      gsap.set(q(".ls-rail-fill"), { scaleX: 0, transformOrigin: "0% 50%" });
      showSpeed();
      if (chaptersInTimeline) {
        gsap.set(q(".ls-chapter"), { autoAlpha: 0, y: 40 });
        gsap.set(q(".ls-chapter")[0], { autoAlpha: 1, y: 0 });
      }

      const chapterIn = (i: number, at: number) => {
        if (!chaptersInTimeline) return;
        tl.to(q(".ls-chapter")[i], { autoAlpha: 1, y: 0, duration: 0.35, ease: "power3.out" }, at);
        tl.fromTo(q(`.ls-chapter:nth-child(${i + 1}) .ls-k`), { scale: 0.6 }, { scale: 1, duration: 0.35, ease: "back.out(2.4)" }, at);
      };
      const chapterOut = (i: number, at: number) => {
        if (!chaptersInTimeline) return;
        tl.to(q(".ls-chapter")[i], { autoAlpha: 0, y: -40, duration: 0.3, ease: "power2.in" }, at);
      };
      const rail = (i: number, at: number, dur: number) =>
        tl.to(q(".ls-rail-fill")[i], { scaleX: 1, duration: dur, ease: "none" }, at);

      // 01 - leaves the lot
      tl.addLabel("c0", 0)
        .fromTo(q(".nc-base-ring"), { scale: 1 }, { scale: 1.18, transformOrigin: "50% 50%", duration: 0.3, yoyo: true, repeat: 1, ease: "sine.inOut" }, 0)
        .to([drive, glow], { drawSVG: "0% 34%", duration: 0.85, ease: "power1.inOut" }, 0.1)
        .to(car, { motionPath: along(0, 0.34), duration: 0.85, ease: "power1.inOut" }, 0.1)
        .to(gauge, { kmh: 48, duration: 0.85, ease: "power2.out", onUpdate: showSpeed }, 0.1);
      rail(0, 0, 0.95);
      chapterOut(0, 0.95);

      // 02 - crosses a line
      chapterIn(1, 1.0);
      tl.to(q(".nc-zone"), { autoAlpha: 1, duration: 0.2 }, 1.0)
        .fromTo(zone, { drawSVG: "0% 0%", fillOpacity: 0 }, { drawSVG: "0% 100%", fillOpacity: 0.12, duration: 0.4, ease: "power2.inOut" }, 1.0)
        .to([drive, glow], { drawSVG: "0% 62%", duration: 0.6, ease: "none" }, 1.1)
        .to(car, { motionPath: along(0.34, 0.62), duration: 0.6, ease: "none" }, 1.1)
        // breach: the zone flares red the moment the car is inside
        .to(zone, { fill: "#ef4444", stroke: "#ef4444", fillOpacity: 0.22, duration: 0.15 }, 1.5)
        .fromTo(q(".nc-zone"), { scale: 1 }, { scale: 1.06, transformOrigin: "50% 50%", duration: 0.12, yoyo: true, repeat: 3 }, 1.5)
        .to(q(".nc-car-halo"), { fill: "#ef4444", fillOpacity: 0.3, duration: 0.15 }, 1.5)
        .to(q(".ls-phone"), { xPercent: 0, rotateY: 0, autoAlpha: 1, duration: 0.4, ease: "expo.out" }, 1.55)
        .fromTo(q(".ls-mail"), { y: -24, autoAlpha: 0 }, { y: 0, autoAlpha: 1, duration: 0.3, ease: "back.out(1.8)" }, 1.75);
      rail(1, 1.0, 0.95);
      chapterOut(1, 1.95);

      // 03 - safe engine cut
      chapterIn(2, 2.0);
      tl.to(q(".ls-phone"), { xPercent: 130, rotateY: -20, autoAlpha: 0, duration: 0.3, ease: "power2.in" }, 2.0)
        .to(q(".ls-gauge"), { y: 0, autoAlpha: 1, duration: 0.35, ease: "expo.out" }, 2.05)
        .to(car, { motionPath: along(0.62, 1), duration: 0.65, ease: "power3.out" }, 2.25)
        .to([drive, glow], { drawSVG: "0% 100%", duration: 0.65, ease: "power3.out" }, 2.25)
        .to(gauge, { kmh: 0, duration: 0.65, ease: "power3.out", onUpdate: showSpeed }, 2.25)
        .to(q(".ls-gauge-wait"), { autoAlpha: 0, duration: 0.12 }, 2.82)
        .to(q(".ls-gauge-done"), { autoAlpha: 1, duration: 0.15 }, 2.85)
        .to(q(".nc-car-halo"), { fill: "#d1b06b", fillOpacity: 0.18, duration: 0.2 }, 2.85);
      rail(2, 2.0, 0.95);
      chapterOut(2, 2.95);

      // 04 - go and get it
      chapterIn(3, 3.0);
      tl.to(q(".ls-gauge"), { y: 30, autoAlpha: 0, duration: 0.3, ease: "power2.in" }, 3.0)
        .to(q(".nc-you"), { autoAlpha: 1, duration: 0.2 }, 3.05)
        .fromTo(q(".nc-you"), { scale: 0, transformOrigin: "50% 50%" }, { scale: 1, duration: 0.35, ease: "back.out(2.2)" }, 3.05)
        .to(q(".nc-tocar"), { autoAlpha: 1, duration: 0.1 }, 3.15)
        .to(q(".nc-tocar"), { drawSVG: `${youFrom} 100%`, duration: 0.55, ease: "power2.inOut" }, 3.15)
        .to(q(".ls-routecard"), { y: 0, autoAlpha: 1, duration: 0.35, ease: "expo.out" }, 3.55);
      // (No camera zoom here: scaling the big masked 3D map every frame
      // pushed the car off-screen and cost a full re-raster per frame.)
      rail(3, 3.0, 1);
      tl.addLabel("c3", 4);
    };

    // Desktop: pin + scrub.
    mm.add(MQ.desktop, () => {
      const tl = gsap.timeline({
        scrollTrigger: {
          trigger: q(".ls-pin")[0],
          start: "top top",
          end: () => `+=${window.innerHeight * 4}`,
          pin: true,
          anticipatePin: 1,
          // Light smoothing: enough to hide wheel steps, not enough to trail.
          scrub: 0.35,
          // No snapping: the story follows the scroll exactly. Snapping a
          // four-screen pinned scene pulled the page out from under people.
          invalidateOnRefresh: true,
        },
        defaults: { ease: "none" },
      });
      build(tl, true);
      gsap.from(q(".ls-head > *"), {
        y: 30,
        autoAlpha: 0,
        stagger: 0.1,
        duration: 1,
        scrollTrigger: { trigger: q(".ls-head")[0], start: enter(80) },
      });
    });

    // Phones: loop while visible; chapters are a normal list below.
    mm.add(MQ.mobile, () => {
      const tl = gsap.timeline({ repeat: -1, repeatDelay: 1.6, paused: true, defaults: { ease: "none" } });
      build(tl, false);
      tl.timeScale(0.42);
      ScrollTrigger.create({
        trigger: q(".ls-pin")[0],
        start: enter(85),
        end: "bottom 15%",
        onToggle: (self) => (self.isActive ? tl.play() : tl.pause()),
      });
      gsap.utils.toArray<HTMLElement>(q(".ls-mchapter")).forEach((card) =>
        gsap.from(card, { y: 30, autoAlpha: 0, duration: 0.8, scrollTrigger: { trigger: card, start: enter(88) } }),
      );
    });

    // Reduced motion: the end of the story, still, with the chapters as the
    // plain list (the desktop stack would otherwise overlap).
    mm.add(MQ.reduce, () => {
      el.classList.add("ls-static");
      const tl = gsap.timeline({ paused: true });
      build(tl, false);
      tl.progress(1);
      gsap.set(q(".ls-phone"), { xPercent: 0, rotateY: 0, autoAlpha: 1 });
      return () => el.classList.remove("ls-static");
    });

    return () => mm.revert();
  }, []);

  return (
    <section id="story" ref={root} className="ls-story relative" aria-labelledby="ls-title">
      <div className="ls-head container pb-12 pt-28 text-center">
        <p className="eyebrow !text-[hsl(var(--gold))]">{s.eyebrow}</p>
        <h2 id="ls-title" className="font-display mx-auto mt-3 max-w-3xl text-[clamp(2rem,4.2vw,3.4rem)] font-semibold leading-tight tracking-tight">
          {s.title}
        </h2>
      </div>

      <div className="ls-pin relative h-[78svh] overflow-hidden lg:h-[100svh]">
        <div className="ls-stage pointer-events-none absolute inset-0" aria-hidden>
          {/* outer: scaled by GSAP; inner: the fixed CSS 3D tilt */}
          <div className="ls-plane">
            <div className="ls-tilt">
            <NightCity
              layers={{ drive: true, car: true, base: true, zone: true, you: true }}
              labels={{ base: s.zone.base, zone: s.zone.restricted, you: s.route.you }}
            />
            </div>
          </div>
        </div>
        <div className="ls-veil pointer-events-none absolute inset-0" aria-hidden />

        {/* 02: the alert email landing on a phone */}
        <div className="ls-phone absolute end-[4%] top-[12%] z-20 w-[min(46vw,15rem)] lg:end-[6%] lg:top-[18%] lg:w-[17rem]" aria-hidden>
          <div className="ls-phone-body">
            <div className="ls-phone-notch" />
            <div className="ls-phone-time num">9:41</div>
            <div className="ls-mail">
              <span className="ls-mail-icon"><Mail className="h-4 w-4" /></span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate text-[11px] font-semibold text-[#f4efe6]">{s.email.from}</span>
                  <span className="shrink-0 text-[10px] text-[#f4efe6]/50">{s.email.time}</span>
                </div>
                <p className="mt-0.5 text-[12px] font-semibold leading-snug text-[#fca5a5]">{s.email.subject}</p>
              </div>
            </div>
          </div>
        </div>

        {/* 03: speed dial during the safe cut */}
        <div className="ls-gauge glass glass-sheen absolute bottom-[8%] end-[4%] z-20 w-[13.5rem] rounded-2xl p-4 lg:bottom-[12%] lg:end-[8%] lg:w-[16rem]" aria-hidden>
          <div className="flex items-center gap-2 text-xs font-semibold text-[hsl(var(--gold))]">
            <Power className="h-3.5 w-3.5" />
            {s.gauge.cut}
          </div>
          <div className="mt-2">
            <SpeedGauge uid="lsg" />
          </div>
          <div className="relative mt-2 h-5 text-center text-[11px]">
            <span className="ls-gauge-wait absolute inset-0 text-[#f4efe6]/60">{s.gauge.waiting}</span>
            <span className="ls-gauge-done absolute inset-0 inline-flex items-center justify-center gap-1 font-semibold text-emerald-400">
              <OctagonX className="h-3.5 w-3.5" />
              {s.gauge.done}
            </span>
          </div>
        </div>

        {/* 04: the directions card */}
        <div className="ls-routecard glass glass-sheen absolute bottom-[8%] start-1/2 z-20 w-[15rem] -translate-x-1/2 overflow-hidden rounded-2xl rtl:translate-x-1/2 lg:bottom-[10%] lg:start-auto lg:end-[8%] lg:translate-x-0 lg:rtl:translate-x-0" aria-hidden>
          <div className="flex items-center gap-3 bg-blue-600 px-4 py-3 text-white">
            <Navigation className="h-5 w-5" />
            <div>
              <p className="text-sm font-semibold">{s.route.to}</p>
              <p className="num text-xs opacity-85">{s.route.eta} · {s.route.dist}</p>
            </div>
          </div>
        </div>

        {/* Chapter text: stacked and swapped on desktop. */}
        <ol className="ls-chapters relative z-10 hidden lg:absolute lg:start-[6%] lg:top-1/2 lg:block lg:w-[25rem] lg:-translate-y-1/2">
          {s.chapters.map((ch) => (
            <li key={ch.k} className="ls-chapter lg:absolute lg:inset-x-0 lg:top-0 lg:-translate-y-1/2">
              <span className="ls-k num">{ch.k}</span>
              <h3 className="font-display mt-4 text-[2rem] font-semibold leading-tight tracking-tight">{ch.title}</h3>
              <p className="mt-3 text-[17px] leading-relaxed text-[#f4efe6]/80">{ch.body}</p>
            </li>
          ))}
        </ol>

        {/* Progress rail */}
        <div className="ls-rail absolute bottom-8 start-[6%] z-10 hidden w-[25rem] grid-cols-4 gap-2 lg:grid" aria-hidden>
          {s.chapters.map((ch) => (
            <span key={ch.k} className="ls-rail-seg">
              <span className="ls-rail-fill" />
            </span>
          ))}
        </div>

        <p className="absolute start-4 top-4 z-10 rounded-full border border-white/10 bg-black/40 px-2.5 py-1 text-[10px] uppercase tracking-wider text-[#f4efe6]/50 lg:start-auto lg:end-6 lg:top-6">
          {s.illustration}
        </p>
      </div>

      {/* Phones: the chapters as a list under the looping scene. */}
      <ol className="ls-mlist container grid gap-4 py-10 sm:grid-cols-2 lg:hidden">
        {s.chapters.map((ch) => (
          <li key={ch.k} className={cn("ls-mchapter rounded-2xl border border-white/10 bg-white/[0.03] p-5")}>
            <span className="ls-k num">{ch.k}</span>
            <h3 className="font-display mt-3 text-xl font-semibold">{ch.title}</h3>
            <p className="mt-2 text-[15px] leading-relaxed text-[#f4efe6]/80">{ch.body}</p>
          </li>
        ))}
      </ol>
    </section>
  );
}
