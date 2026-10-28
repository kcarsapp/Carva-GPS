import type { ReactNode } from "react";

import { Navbar } from "@/components/marketing/navbar";
import { Footer } from "@/components/marketing/footer";

/**
 * Public marketing shell. The `.app-fleet` wrapper scopes the Tailwind/Shadcn
 * theme + reset (see app/fleet.css) so it never leaks into the existing pages.
 * The outer `.dark` pins the public site to the night palette whatever the
 * visitor's dashboard theme is: the homepage is a night drive, and the dark
 * tokens are what its gold and glass are tuned for.
 */
export default function MarketingLayout({ children }: { children: ReactNode }) {
  return (
    <div className="dark">
      {/* brand-locked: the public site stays Carva gold whatever accent a
          signed-in user picked for their dashboard. */}
      <div className="app-fleet brand-locked flex min-h-screen flex-col bg-[#0b0a09] text-[#f4efe6]">
        <Navbar />
        {/* Room for the fixed navbar; the homepage pulls its hero back under it. */}
        <main className="flex-1 pt-16">{children}</main>
        <Footer />
      </div>
    </div>
  );
}
