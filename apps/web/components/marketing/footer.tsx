"use client";

import Link from "next/link";
import { Mail, MessageCircle } from "lucide-react";

import { CarvaWordmark } from "@/components/dashboard/carva-logo";
import { useLandingCopy } from "@/components/landing/copy";
import { CONTACT, whatsappHref } from "@/components/landing/contact";

/** Public site footer. Every link goes somewhere real. */
export function Footer() {
  const c = useLandingCopy();
  const wa = whatsappHref();
  const columns = [
    {
      title: c.footer.product,
      links: [
        { label: c.nav.features, href: "/#features" },
        { label: c.nav.story, href: "/#story" },
        { label: c.nav.demo, href: "/#demo" },
      ],
    },
    {
      title: c.footer.account,
      links: [
        { label: c.nav.demoCta, href: "/fleet" },
        { label: c.nav.signin, href: "/login" },
      ],
    },
  ];

  return (
    <footer className="relative border-t border-white/10 bg-[#080706]">
      <div className="container grid gap-10 py-14 sm:grid-cols-2 lg:grid-cols-[1.6fr_1fr_1fr_1.2fr]">
        <div>
          <Link href="/" className="inline-flex items-center gap-2" aria-label="Carva Fleet">
            <CarvaWordmark className="h-9 [&_img]:!opacity-100 [&_img]:!brightness-100" />
            <span className="rounded-md border border-[hsl(var(--gold))]/35 bg-[hsl(var(--gold))]/10 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-[0.14em] text-[hsl(var(--gold))]">
              Fleet
            </span>
          </Link>
          <p className="mt-4 max-w-xs text-sm text-[#f4efe6]/55">{c.footer.tagline}</p>
        </div>
        {columns.map((col) => (
          <div key={col.title}>
            <h3 className="eyebrow">{col.title}</h3>
            <ul className="mt-4 space-y-2.5">
              {col.links.map((l) => (
                <li key={l.href}>
                  <Link href={l.href} className="text-sm text-[#f4efe6]/65 transition-colors hover:text-[#f4efe6]">
                    {l.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ))}
        <div>
          <h3 className="eyebrow">{c.footer.contact}</h3>
          <ul className="mt-4 space-y-2.5 text-sm">
            <li>
              <a href={`mailto:${CONTACT.email}`} className="inline-flex items-center gap-2 text-[#f4efe6]/65 hover:text-[#f4efe6]" dir="ltr">
                <Mail className="h-4 w-4 text-[hsl(var(--gold))]" />
                {CONTACT.email}
              </a>
            </li>
            {wa && (
              <li>
                <a href={wa} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2 text-[#f4efe6]/65 hover:text-[#f4efe6]">
                  <MessageCircle className="h-4 w-4 text-[#25d366]" />
                  WhatsApp
                </a>
              </li>
            )}
          </ul>
        </div>
      </div>
      <div className="border-t border-white/5">
        <p className="container py-5 text-xs text-[#f4efe6]/40">
          © {new Date().getFullYear()} Carva. {c.footer.rights}
        </p>
      </div>
    </footer>
  );
}
