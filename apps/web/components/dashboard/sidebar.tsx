"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Bell,
  History,
  LayoutDashboard,
  LogOut,
  Menu,
  Settings,
  ShieldCheck,
  Truck,
  Users,
  X,
} from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useSession, type CarvaRole, type SessionState } from "@/lib/live-data";
import { unacknowledgedAlerts } from "@/mock/alerts";
import { LanguageSwitcher, useI18n } from "@/lib/i18n-provider";

const ALL: CarvaRole[] = ["general_admin", "company", "personal"];

/** Fleet navigation, shared with the map dashboard's floating command bar. */
export const NAV = [
  { href: "/fleet", label: "fleet.nav.dashboard", icon: LayoutDashboard, roles: ALL },
  { href: "/fleet/vehicles", label: "fleet.nav.vehicles", icon: Truck, roles: ALL },
  { href: "/fleet/history", label: "fleet.nav.history", icon: History, roles: ALL },
  {
    href: "/fleet/drivers",
    label: "fleet.nav.drivers",
    icon: Users,
    roles: ["general_admin", "company"] as CarvaRole[],
  },
  {
    href: "/fleet/alerts",
    label: "fleet.nav.alerts",
    icon: Bell,
    roles: ["general_admin", "company"] as CarvaRole[],
  },
  {
    href: "/fleet/users",
    label: "fleet.nav.users",
    icon: ShieldCheck,
    roles: ["general_admin"] as CarvaRole[],
  },
  { href: "/fleet/settings", label: "fleet.nav.settings", icon: Settings, roles: ALL },
];

function NavLinks({
  role,
  onNavigate,
}: {
  role: CarvaRole;
  onNavigate?: () => void;
}) {
  const pathname = usePathname();
  const { t } = useI18n();
  return (
    <nav className="flex flex-col gap-1 px-3">
      {NAV.filter((item) => item.roles.includes(role)).map((item) => {
        const active =
          item.href === "/fleet"
            ? pathname === "/fleet"
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
            {t(item.label)}
            {item.href === "/fleet/alerts" && unacknowledgedAlerts.length > 0 && (
              <Badge
                variant={active ? "secondary" : "destructive"}
                className="ms-auto px-1.5 py-0"
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
        <Truck className="h-[18px] w-[18px]" />
      </span>
      <span className="text-lg font-bold tracking-tight">Carva Fleet</span>
    </Link>
  );
}

// Role labels come from i18n: `fleet.role.${role}`.

function initials(name: string) {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? "")
    .join("");
}

function SessionFooter({ session }: { session: SessionState }) {
  const { loading, authed, user } = session;
  const { t } = useI18n();
  const [busy, setBusy] = React.useState(false);

  async function signOut() {
    setBusy(true);
    try {
      await fetch("/api/auth/logout", { method: "POST" });
    } catch {
      /* drop cookie best-effort */
    }
    window.location.href = "/login";
  }

  if (loading) return null;

  if (!authed || !user) {
    return (
      <div className="rounded-lg border bg-muted/40 p-3 text-xs text-muted-foreground">
        <p className="font-medium text-foreground">{t('fleet.demo.title')}</p>
        <p className="mt-1">{t('fleet.demo.body')}</p>
        <Link
          href="/login"
          className="mt-2 inline-block font-medium text-primary hover:underline"
        >
          {t('fleet.demo.signin')}
        </Link>
      </div>
    );
  }

  return (
    <div className="rounded-lg border p-3">
      <div className="flex items-center gap-2">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary">
          {initials(user.name)}
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">{user.name}</p>
          <p className="truncate text-xs text-muted-foreground">{user.email}</p>
        </div>
      </div>
      <div className="mt-2">
        <Badge variant="secondary" className="text-[10px]">
          {t(`fleet.role.${user.role}`)}
        </Badge>
      </div>
      <Button
        onClick={signOut}
        disabled={busy}
        variant="outline"
        size="sm"
        className="mt-3 w-full"
      >
        <LogOut className="h-4 w-4" />
        {t('fleet.signout')}
      </Button>
    </div>
  );
}

export function Sidebar() {
  const [open, setOpen] = React.useState(false);
  const session = useSession();
  // Logged-out demo visitors get the full (company) navigation.
  const role: CarvaRole = session.user?.role ?? "company";

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
      <aside className="hidden w-64 shrink-0 border-e bg-card md:flex md:flex-col md:fixed md:inset-y-0 md:start-0">
        <Brand />
        <NavLinks role={role} />
        <div className="mt-auto p-4">
          <LanguageSwitcher className="mb-3 w-full rounded-lg border bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-primary" />
          <SessionFooter session={session} />
        </div>
      </aside>

      {/* Mobile drawer */}
      {open && (
        <div className="fixed inset-0 z-50 md:hidden">
          <div
            className="absolute inset-0 bg-black/50"
            onClick={() => setOpen(false)}
          />
          <div className="absolute inset-y-0 start-0 flex w-72 flex-col bg-card shadow-xl">
            <div className="flex items-center justify-between">
              <Brand />
              <Button
                variant="ghost"
                size="icon"
                className="me-3"
                onClick={() => setOpen(false)}
                aria-label="Close navigation"
              >
                <X className="h-5 w-5" />
              </Button>
            </div>
            <NavLinks role={role} onNavigate={() => setOpen(false)} />
            <div className="mt-auto p-4">
              <LanguageSwitcher className="mb-3 w-full rounded-lg border bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-primary" />
              <SessionFooter session={session} />
            </div>
          </div>
        </div>
      )}
    </>
  );
}
