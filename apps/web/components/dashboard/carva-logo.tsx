import { Car } from "lucide-react";

import { cn } from "@/lib/utils";

// The Carva wordmark, monochrome: white on dark surfaces and the same artwork
// pressed to charcoal (brightness(0)) on light ones. In the black-and-gold
// identity the logo stays neutral and gold is kept for interaction; the old
// crimson PNG (public/brand/carva-logo.png) is left in place for the
// marketing site. Plain <img>: a small static PNG gains nothing from
// next/image, and this keeps it out of the image-optimiser cache.

export function CarvaWordmark({ className }: { className?: string }) {
  return (
    <span className={cn("relative inline-flex items-center", className)}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/brand/carva-logo-white.png"
        alt="Carva"
        width={640}
        height={151}
        className="h-[72%] w-auto select-none opacity-90 brightness-0 dark:opacity-100 dark:brightness-100"
        draggable={false}
      />
    </span>
  );
}

/** Square mark for tight spaces (collapsed rail, favicon-sized slots). */
export function CarvaMark({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "brand-fill flex items-center justify-center rounded-xl shadow-[0_6px_16px_-6px_hsl(var(--primary)/0.6)]",
        className,
      )}
      aria-label="Carva"
    >
      <Car className="h-[55%] w-[55%]" strokeWidth={2.2} />
    </span>
  );
}
