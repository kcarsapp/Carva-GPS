import type { ReactNode } from "react";

import { Navbar } from "@/components/marketing/navbar";
import { Footer } from "@/components/marketing/footer";

/**
 * Public marketing shell. The `.app-fleet` wrapper scopes the Tailwind/Shadcn
 * theme + reset (see app/fleet.css) so it never leaks into the existing pages.
 */
export default function MarketingLayout({ children }: { children: ReactNode }) {
  return (
    <div className="app-fleet flex min-h-screen flex-col bg-background text-foreground">
      <Navbar />
      <main className="flex-1">{children}</main>
      <Footer />
    </div>
  );
}
