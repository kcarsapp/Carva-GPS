"use client";

import type { ReactNode } from "react";
import { usePathname } from "next/navigation";

/**
 * Re-mounts on every /fleet/* navigation, giving each page a short fade with
 * a few pixels of rise (fleet.css `.page-fade`, motion tokens), so route
 * changes read as intentional rather than an abrupt swap. Content is never
 * held back: the page renders at once and only its opacity/transform move.
 *
 * The live map fades without the rise: its page is an `absolute inset-0`
 * canvas, and any transform on this (0px-tall) wrapper would become that
 * canvas's containing block and collapse the map while it ran.
 */
export default function FleetTemplate({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  return <div className={pathname === "/fleet" ? "page-fade-flat" : "page-fade"}>{children}</div>;
}
