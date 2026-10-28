"use client";

import type { ReactNode } from "react";
import { usePathname } from "next/navigation";

import { Sidebar } from "@/components/dashboard/sidebar";

/**
 * The single shell for every /fleet route.
 *
 * The sidebar is ALWAYS mounted and never covered, so navigation stays in the
 * same place on every page instead of switching between a vertical rail and a
 * floating horizontal bar depending on where you are.
 *
 * Two content modes:
 *  - "canvas"   — the live map owns the whole frame: no padding, no max width,
 *                 exactly viewport height so the map never causes page scroll.
 *  - "document" — everything else: centred, padded, comfortable reading width.
 */

/** Routes whose content is a full-bleed canvas rather than a document. */
const CANVAS_ROUTES = new Set(["/fleet"]);

export default function FleetDashboardLayout({
  children,
}: {
  children: ReactNode;
}) {
  const pathname = usePathname();
  const canvas = CANVAS_ROUTES.has(pathname);

  return (
    // Opaque: globals.css paints a dark radial gradient on <body>, which a
    // translucent surface would let through and muddy the light theme.
    <div className="app-fleet min-h-screen bg-background text-foreground">
      <Sidebar />
      {/* The sidebar publishes its current width (wide or icon rail) as
          --carva-sidebar; 16rem is the expanded default before it mounts. */}
      <div className="transition-[padding] duration-200 md:ps-[var(--carva-sidebar,16rem)]">
        {canvas ? (
          // Full-bleed. On phones the 57px top bar sits above this and the
          // 64px tab bar below it (plus the home-indicator inset), so the map
          // gets exactly what is left rather than sliding under either.
          <main className="relative h-[calc(100dvh-57px-64px-env(safe-area-inset-bottom))] w-full overflow-hidden md:h-dvh">
            {children}
          </main>
        ) : (
          // Bottom padding on phones keeps the last row clear of the tab bar.
          <main className="mx-auto w-full max-w-7xl px-4 pb-24 pt-6 sm:px-6 md:pb-6 lg:px-8">
            {children}
          </main>
        )}
      </div>
    </div>
  );
}
