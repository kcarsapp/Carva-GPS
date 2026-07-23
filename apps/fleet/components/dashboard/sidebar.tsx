"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Bell,
  LayoutDashboard,
  Menu,
  Settings,
  Truck,
  Users,
  X,
} from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { unacknowledgedAlerts } from "@/mock/alerts";

const nav = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/dashboard/vehicles", label: "Vehicles", icon: Truck },
  { href: "/dashboard/drivers", label: "Drivers", icon: Users },
  { href: "/dashboard/alerts", label: "Alerts", icon: Bell },
  { href: "/dashboard/settings", label: "Settings", icon: Settings },
];

function NavLinks({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  return (
    <nav className="flex flex-col gap-1 px-3">
      {nav.map((item) => {
        const active =
          item.href === "/dashboard"
            ? pathname === "/dashboard"
            : pathname.startsWith(item.href);
        const Icon = item.icon;
        return (
          <Link
            key={item.href}
            href={item.href}
            onClick={onNavigate}
            className={cn(
              "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
              active
                ? "bg-primary text-primary-foreground shadow-sm"
                : "text-muted-foreground hover:bg-accent hover:text-foreground",
            )}
          >
            <Icon className="h-4 w-4" />
            {item.label}
            {item.label === "Alerts" && unacknowledgedAlerts.length > 0 && (
              <Badge
                variant={active ? "secondary" : "destructive"}
                className="ml-auto px-1.5 py-0"
              >
                {unacknowledgedAlerts.length}
              </Badge>
            )}
          </Link>
        );
      })}
    </nav>
  );
}

function Brand() {
  return (
    <Link href="/" className="flex items-center gap-2 px-5 py-5">
      <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
        <Truck className="h-4.5 w-4.5" />
      </span>
      <span className="text-lg font-bold tracking-tight">Carva Fleet</span>
    </Link>
  );
}

export function Sidebar() {
  const [open, setOpen] = React.useState(false);

  return (
    <>
      {/* Mobile top bar */}
      <div className="sticky top-0 z-30 flex items-center justify-between border-b bg-background/95 px-4 py-3 backdrop-blur md:hidden">
        <Brand />
        <Button
          variant="outline"
          size="icon"
          onClick={() => setOpen(true)}
          aria-label="Open navigation"
        >
          <Menu className="h-5 w-5" />
        </Button>
      </div>

      {/* Desktop sidebar */}
      <aside className="hidden w-64 shrink-0 border-r bg-card md:flex md:flex-col md:fixed md:inset-y-0">
        <Brand />
        <NavLinks />
        <div className="mt-auto p-4">
          <div className="rounded-lg border bg-muted/40 p-3 text-xs text-muted-foreground">
            <p className="font-medium text-foreground">Demo workspace</p>
            <p className="mt-1">Running on mock data — no backend required.</p>
          </div>
        </div>
      </aside>

      {/* Mobile drawer */}
      {open && (
        <div className="fixed inset-0 z-50 md:hidden">
          <div
            className="absolute inset-0 bg-black/50"
            onClick={() => setOpen(false)}
          />
          <div className="absolute inset-y-0 left-0 flex w-72 flex-col bg-card shadow-xl">
            <div className="flex items-center justify-between">
              <Brand />
              <Button
                variant="ghost"
                size="icon"
                className="mr-3"
                onClick={() => setOpen(false)}
                aria-label="Close navigation"
              >
                <X className="h-5 w-5" />
              </Button>
            </div>
            <NavLinks onNavigate={() => setOpen(false)} />
          </div>
        </div>
      )}
    </>
  );
}
