"use client";

import * as React from "react";
import Link from "next/link";
import { ArrowRight, Menu, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { CarvaWordmark } from "@/components/dashboard/carva-logo";
import { useLandingCopy } from "@/components/landing/copy";
import { LanguageSwitcher } from "@/lib/i18n-provider";
import { usePresence } from "@/lib/motion";
import { cn } from "@/lib/utils";

/**
 * Public site navbar: transparent over the hero, glass once the page scrolls.
 * The gold hairline along its bottom edge is a reading-progress bar (scaleX
 * from a passive scroll listener; transform only, so it costs no layout).
 */
export function Navbar() {
  const c = useLandingCopy();
  const [open, setOpen] = React.useState(false);
  const [scrolled, setScrolled] = React.useState(false);
  const barRef = React.useRef<HTMLSpanElement>(null);
  const scrolledRef = React.useRef(false);
  const sheet = usePresence(open, 180);

  React.useEffect(() => {
    let raf = 0;
    const update = () => {
      raf = 0;
      const max = document.documentElement.scrollHeight - window.innerHeight;
      const p = max > 0 ? window.scrollY / max : 0;
      if (barRef.current) barRef.current.style.transform = `scaleX(${p.toFixed(4)})`;
      // Touch React only when the state flips, not on every scroll frame.
      const next = window.scrollY > 24;
      if (next !== scrolledRef.current) {
        scrolledRef.current = next;
        setScrolled(next);
      }
    };
    const onScroll = () => {
      if (!raf) raf = requestAnimationFrame(update);
    };
    update();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      cancelAnimationFrame(raf);
    };
  }, []);

  const links = [
    { href: "/#features", label: c.nav.features },
    { href: "/#story", label: c.nav.story },
    { href: "/#demo", label: c.nav.demo },
    { href: "/#contact", label: c.nav.contact },
  ];

  return (
    <header
      className={cn(
        "ln-header fixed inset-x-0 top-0 z-50 transition-[background-color,border-color,backdrop-filter] duration-300",
        scrolled || open ? "ln-header-solid" : "border-transparent",
      )}
    >
      <div className="container flex h-16 items-center justify-between gap-4">
        <Link href="/" className="flex items-center gap-2" aria-label="Carva Fleet">
          <CarvaWordmark className="h-9 [&_img]:!opacity-100 [&_img]:!brightness-100" />
          <span className="rounded-md border border-[hsl(var(--gold))]/35 bg-[hsl(var(--gold))]/10 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-[0.14em] text-[hsl(var(--gold))]">
            Fleet
          </span>
        </Link>

        <nav className="hidden items-center gap-7 lg:flex" aria-label="Primary">
          {links.map((l) => (
            <Link key={l.href} href={l.href} className="ln-link text-sm font-medium text-[#f4efe6]/70 hover:text-[#f4efe6]">
              {l.label}
            </Link>
          ))}
        </nav>

        <div className="hidden items-center gap-2 lg:flex">
          <LanguageSwitcher className="h-9 rounded-lg border border-white/10 bg-white/[0.04] px-2 text-sm text-[#f4efe6] outline-none focus:border-[hsl(var(--gold))]" />
          <Link href="/login" className="press rounded-lg px-3 py-2 text-sm font-medium text-[#f4efe6]/80 hover:text-[#f4efe6]">
            {c.nav.signin}
          </Link>
          <Button size="sm" asChild className="h-9 px-4">
            <Link href="/fleet">{c.nav.demoCta}</Link>
          </Button>
        </div>

        <button
          type="button"
          className="press flex h-11 w-11 items-center justify-center rounded-xl border border-white/10 bg-white/[0.04] text-[#f4efe6] lg:hidden"
          onClick={() => setOpen((v) => !v)}
          aria-label={c.nav.menu}
          aria-expanded={open}
        >
          {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
        </button>
      </div>

      <span ref={barRef} className="ln-progress" aria-hidden />

      {sheet.mounted && (
        <div className={cn("border-t border-white/10 lg:hidden", sheet.leaving ? "fade-out" : "fade-in")}>
          <nav className="container flex flex-col gap-1 py-4" aria-label="Mobile">
            {links.map((l, i) => (
              <Link
                key={l.href}
                href={l.href}
                onClick={() => setOpen(false)}
                className="rise rounded-xl px-3 py-3 text-base font-medium text-[#f4efe6]/80 hover:bg-white/[0.05] hover:text-[#f4efe6]"
                style={{ animationDelay: `${i * 40}ms` }}
              >
                {l.label}
              </Link>
            ))}
            <div className="mt-3 flex items-center gap-2">
              <LanguageSwitcher className="h-11 flex-1 rounded-xl border border-white/10 bg-white/[0.04] px-3 text-sm text-[#f4efe6] outline-none" />
              <Link href="/login" onClick={() => setOpen(false)} className="press flex h-11 items-center rounded-xl border border-white/10 px-4 text-sm font-medium">
                {c.nav.signin}
              </Link>
            </div>
            <Button asChild className="mt-2 h-12 text-base">
              <Link href="/fleet" onClick={() => setOpen(false)}>
                {c.nav.demoCta}
                <ArrowRight className="rtl:rotate-180" />
              </Link>
            </Button>
          </nav>
        </div>
      )}
    </header>
  );
}
