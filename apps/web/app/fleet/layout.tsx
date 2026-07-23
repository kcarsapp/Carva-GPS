import type { ReactNode } from "react";

import { Sidebar } from "@/components/dashboard/sidebar";

/**
 * Fleet dashboard shell (demo, mock data). `.app-fleet` scopes the
 * Tailwind/Shadcn theme so the existing /app live dashboard is unaffected.
 */
export default function FleetDashboardLayout({
  children,
}: {
  children: ReactNode;
}) {
  return (
    <div className="app-fleet min-h-screen bg-muted/30 text-foreground">
      <Sidebar />
      <div className="md:ps-64">
        <main className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
          {children}
        </main>
      </div>
    </div>
  );
}
