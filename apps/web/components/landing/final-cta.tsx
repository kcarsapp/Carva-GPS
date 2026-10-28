"use client";

import * as React from "react";
import Link from "next/link";
import { ArrowRight, Mail, MessageCircle } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useLandingCopy } from "@/components/landing/copy";
import { CONTACT, whatsappHref } from "@/components/landing/contact";
import { enter, gsap, MQ } from "@/components/landing/gsap";

/**
 * The end of the drive: a route line falls into a glowing gold pin, then the
 * call to action rises and the primary button lights up once.
 */
export function LandingCta() {
  const c = useLandingCopy();
  const root = React.useRef<HTMLElement>(null);
  const wa = whatsappHref("Hello Carva — I'd like to try GPS tracking for my rental cars.");

  React.useLayoutEffect(() => {
    const el = root.current;
    if (!el) return;
    const q = gsap.utils.selector(el);
    const mm = gsap.matchMedia();
    mm.add(`${MQ.desktop}, ${MQ.mobile}`, () => {
      const tl = gsap.timeline({ scrollTrigger: { trigger: el, start: enter(70) } });
      tl.fromTo(q(".lc-route"), { drawSVG: "0% 0%" }, { drawSVG: "0% 100%", duration: 1.1, ease: "power2.inOut" })
        .fromTo(q(".lc-pin"), { scale: 0, y: -20, autoAlpha: 0 }, { scale: 1, y: 0, autoAlpha: 1, duration: 0.8, ease: "back.out(2.2)" }, "-=0.25")
        .fromTo(q(".lc-ring"), { scale: 0.4, autoAlpha: 0.9 }, { scale: 2.6, autoAlpha: 0, duration: 1.4, ease: "expo.out", stagger: 0.25 }, "<0.1")
        .from(q(".lc-copy > *"), { y: 26, autoAlpha: 0, stagger: 0.09, duration: 0.9, ease: "expo.out" }, "<0.1")
        .fromTo(q(".lc-primary"), { boxShadow: "0 0 0 0 rgba(209,176,107,0.7)" }, { boxShadow: "0 0 0 18px rgba(209,176,107,0)", duration: 1.2, ease: "power2.out" }, ">-0.2");
    });
    return () => mm.revert();
  }, []);

  return (
    <section id="contact" ref={root} className="lc-section relative overflow-hidden py-28" aria-labelledby="lc-title">
      <div className="lc-glow pointer-events-none absolute inset-0" aria-hidden />
      <div className="container relative flex flex-col items-center text-center">
        <svg className="h-24 w-6" viewBox="0 0 6 96" aria-hidden>
          <path className="lc-route" d="M3 0 V96" stroke="#d1b06b" strokeWidth="3" strokeLinecap="round" strokeDasharray="0" />
        </svg>
        <div className="relative -mt-1" aria-hidden>
          <span className="lc-ring absolute inset-0 rounded-full border border-[#d1b06b]" />
          <span className="lc-ring absolute inset-0 rounded-full border border-[#d1b06b]" />
          <span className="lc-pin relative flex h-16 w-16 items-center justify-center rounded-full">
            <span className="h-4 w-4 rounded-full bg-[#0b0a09]" />
          </span>
        </div>

        <div className="lc-copy mt-10 max-w-2xl">
          <h2 id="lc-title" className="font-display text-[clamp(2.1rem,4.6vw,3.6rem)] font-semibold leading-tight tracking-tight">
            {c.cta.title}
          </h2>
          <p className="mx-auto mt-4 max-w-lg text-[17px] leading-relaxed text-[#f4efe6]/80">{c.cta.body}</p>
          <div className="mt-9 flex flex-wrap items-center justify-center gap-3">
            {/* Contact first; the live demo second. (No trial offer.) */}
            <Button asChild size="lg" className="lc-primary h-12 px-6 text-base">
              <a href={`mailto:${CONTACT.email}`}>
                <Mail />
                {c.cta.email}
              </a>
            </Button>
            {wa && (
              <a
                href={wa}
                target="_blank"
                rel="noopener noreferrer"
                className="press inline-flex h-12 items-center gap-2 rounded-lg bg-[#25d366] px-5 text-base font-semibold text-[#06260f]"
              >
                <MessageCircle className="h-5 w-5" />
                {c.cta.whatsapp}
              </a>
            )}
            <Link
              href="/fleet"
              className="lh-ghost press inline-flex h-12 items-center gap-2 rounded-lg px-5 text-base font-medium"
            >
              {c.cta.demo}
              <ArrowRight className="h-4 w-4 text-[hsl(var(--gold))] rtl:rotate-180" />
            </Link>
          </div>
          <p className="mt-6 text-sm text-[#f4efe6]/55">
            <a href={`mailto:${CONTACT.email}`} className="hover:text-[#f4efe6]" dir="ltr">
              {CONTACT.email}
            </a>
            <span className="mx-2">·</span>
            <Link href="/login" className="hover:text-[#f4efe6]">
              {c.cta.signin}
            </Link>
          </p>
        </div>
      </div>
    </section>
  );
}
