"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  BarChart3,
  Bell,
  ChevronsLeft,
  ChevronsRight,
  Hexagon,
  History,
  LogOut,
  Map as MapIcon,
  MapPin,
  MoreHorizontal,
  Settings,
  ShieldCheck,
  Truck,
  Users,
  X,
  type LucideIcon,
} from "lucide-react";

import { cn } from "@/lib/utils";
import { CarvaMark, CarvaWordmark } from "@/components/dashboard/carva-logo";
import { useSession, type CarvaRole, type SessionState } from "@/lib/live-data";
import { useUnreadAlertCount } from "@/lib/events";
import { GeofenceNotifier } from "@/components/dashboard/geofence-notifier";
import { ThemeToggle } from "@/lib/theme-provider";
import { LanguageSwitcher, useI18n } from "@/lib/i18n-provider";
import { DUR, usePresence } from "@/lib/motion";

/* ------------------------------ Navigation ------------------------------- */
//
// Ten flat links read as a junk drawer, so they are grouped by what the
// operator is doing: watching the fleet now, looking back at what happened,
// drawing on the map, and administering the account.

const ALL: CarvaRole[] = ["general_admin", "company", "personal"];
const STAFF: CarvaRole[] = ["general_admin", "company"];
const ADMIN: CarvaRole[] = ["general_admin"];

interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  roles: CarvaRole[];
}

interface NavGroup {
  label: string;
  items: NavItem[];
}

export const NAV_GROUPS: NavGroup[] = [
  {
    label: "fleet.nav.group.monitor",
    items: [
      { href: "/fleet", label: "fleet.nav.dashboard", icon: MapIcon, roles: ALL },
      { href: "/fleet/vehicles", label: "fleet.nav.vehicles", icon: Truck, roles: ALL },
      { href: "/fleet/alerts", label: "fleet.nav.alerts", icon: Bell, roles: STAFF },
    ],
  },
  {
    label: "fleet.nav.group.analyze",
    items: [
      { href: "/fleet/history", label: "fleet.nav.history", icon: History, roles: ALL },
      { href: "/fleet/reports", label: "fleet.nav.reports", icon: BarChart3, roles: ALL },
    ],
  },
  {
    label: "fleet.nav.group.map",
    items: [
      { href: "/fleet/geofences", label: "fleet.nav.geofences", icon: Hexagon, roles: ALL },
      { href: "/fleet/poi", label: "fleet.nav.poi", icon: MapPin, roles: ALL },
    ],
  },
  {
    label: "fleet.nav.group.manage",
    items: [
      { href: "/fleet/drivers", label: "fleet.nav.drivers", icon: Users, roles: STAFF },
      { href: "/fleet/users", label: "fleet.nav.users", icon: ShieldCheck, roles: ADMIN },
      { href: "/fleet/settings", label: "fleet.nav.settings", icon: Settings, roles: ALL },
    ],
  },
];

/**
 * Logged-out demo: only the pages that work on the simulated fleet. Every
 * other page needs a real account, and linking to it would show a visitor a
 * sign-in wall in the middle of a demo.
 */
const DEMO_HREFS = new Set(["/fleet", "/fleet/vehicles"]);

/** Flat list, for anything that just needs every link. */
export const NAV: NavItem[] = NAV_GROUPS.flatMap((g) => g.items);

function isActive(pathname: string, href: string) {
  return href === "/fleet" ? pathname === "/fleet" : pathname.startsWith(href);
}

/* ----------------------------- Collapse state ---------------------------- */
//
// Collapsed, the sidebar is an icon rail and the map gets ~180px back. The
// width is published as a CSS variable on <html> so the layout can pad its
// content to match without the two components sharing React state.

const COLLAPSE_KEY = "carva-sidebar-collapsed";
const WIDE = "16rem";
const RAIL = "4.5rem";

function useCollapsed(): [boolean, () => void] {
  const [collapsed, setCollapsed] = React.useState(false);

  React.useEffect(() => {
    try {
      setCollapsed(localStorage.getItem(COLLAPSE_KEY) === "1");
    } catch {
      /* storage blocked - stay expanded */
    }
  }, []);

  React.useEffect(() => {
    document.documentElement.style.setProperty(
      "--carva-sidebar",
      collapsed ? RAIL : WIDE,
    );
  }, [collapsed]);

  const toggle = React.useCallback(() => {
    setCollapsed((c) => {
      try {
        localStorage.setItem(COLLAPSE_KEY, c ? "0" : "1");
      } catch {
        /* the toggle still works for this visit */
      }
      return !c;
    });
  }, []);

  return [collapsed, toggle];
}

/* -------------------------------- Pieces --------------------------------- */

function initials(name: string) {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? "")
    .join("");
}

async function signOut() {
  try {
    await fetch("/api/auth/logout", { method: "POST" });
  } catch {
    /* drop cookie best-effort */
  }
  window.location.href = "/login";
}

function Brand({ compact = false }: { compact?: boolean }) {
  // Links to the dashboard home, NOT the marketing homepage — landing on the
  // public site (with its "Sign in" navbar) reads as being logged out.
  return (
    <Link
      href="/fleet"
      aria-label="Carva GPS"
      className={cn("flex items-center gap-2", compact ? "justify-center" : "px-1")}
    >
      {compact ? (
        <CarvaMark className="h-10 w-10" />
      ) : (
        <>
          <CarvaWordmark className="h-9" />
          <span className="rounded-md border border-primary/25 bg-primary/[0.08] px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-[0.12em] text-primary">
            GPS
          </span>
        </>
      )}
    </Link>
  );
}

function NavLink({
  item,
  active,
  compact,
  badge,
  onNavigate,
}: {
  item: NavItem;
  active: boolean;
  compact: boolean;
  badge?: number;
  onNavigate?: () => void;
}) {
  const { t } = useI18n();
  const Icon = item.icon;
  const label = t(item.label);
  return (
    <Link
      href={item.href}
      onClick={onNavigate}
      title={compact ? label : undefined}
      aria-current={active ? "page" : undefined}
      className={cn(
        "press group relative flex items-center rounded-lg text-sm font-medium",
        compact ? "h-10 justify-center" : "gap-3 px-3 py-2",
        active
          ? "bg-primary/[0.11] text-foreground"
          : "text-muted-foreground hover:bg-accent hover:text-foreground",
      )}
    >
      {/* Active marker on the leading edge - flips correctly in RTL. Grows in
          from the centre so moving between pages reads as the marker moving. */}
      <span
        aria-hidden
        className={cn(
          "absolute inset-y-1.5 start-0 w-[3px] rounded-full bg-primary shadow-[0_0_10px_hsl(var(--primary)/0.55)] transition-transform duration-300 ease-out",
          active ? "scale-y-100" : "scale-y-0",
        )}
      />
      <Icon
        className={cn(
          "h-[18px] w-[18px] shrink-0 transition-[color,transform] duration-200 group-hover:scale-105",
          active ? "text-[hsl(var(--gold))]" : "",
        )}
      />
      {!compact && <span className="truncate">{label}</span>}
      {badge != null && badge > 0 &&
        (compact ? (
          <span className="absolute end-1.5 top-1.5 h-2 w-2 rounded-full bg-destructive ring-2 ring-card" />
        ) : (
          <span className="ms-auto rounded-full bg-destructive px-1.5 text-[11px] font-semibold leading-5 text-destructive-foreground">
            {badge > 99 ? "99+" : badge}
          </span>
        ))}
    </Link>
  );
}

function NavGroups({
  role,
  unread,
  compact,
  onNavigate,
  demo = false,
}: {
  role: CarvaRole;
  /** Logged-out demo: show only DEMO_HREFS. */
  demo?: boolean;
  /** Live count of unread critical/warning alerts, from the parent's poller. */
  unread: number;
  compact: boolean;
  onNavigate?: () => void;
}) {
  const pathname = usePathname();
  const { t } = useI18n();
  return (
    <nav className="flex flex-col gap-4">
      {NAV_GROUPS.map((group) => {
        const items = group.items.filter(
          (i) => i.roles.includes(role) && (!demo || DEMO_HREFS.has(i.href)),
        );
        if (items.length === 0) return null;
        return (
          <div key={group.label}>
            {compact ? (
              <div className="mx-auto mb-1.5 h-px w-6 bg-border" />
            ) : (
              <p className="mb-1 px-3 text-[10.5px] font-semibold uppercase tracking-[0.08em] text-muted-foreground/70">
                {t(group.label)}
              </p>
            )}
            <div className="flex flex-col gap-0.5">
              {items.map((item) => (
                <NavLink
                  key={item.href}
                  item={item}
                  active={isActive(pathname, item.href)}
                  compact={compact}
                  badge={item.href === "/fleet/alerts" ? unread : undefined}
                  onNavigate={onNavigate}
                />
              ))}
            </div>
          </div>
        );
      })}
    </nav>
  );
}

function Preferences({ compact }: { compact: boolean }) {
  const toggleClass =
    "flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border bg-background text-muted-foreground transition-colors hover:bg-accent hover:text-foreground";
  if (compact) {
    return (
      <div className="flex justify-center">
        <ThemeToggle className={toggleClass} />
      </div>
    );
  }
  return (
    <div className="flex items-center gap-2">
      <LanguageSwitcher className="h-9 min-w-0 flex-1 rounded-lg border bg-background px-2.5 text-sm text-foreground outline-none focus:border-primary" />
      <ThemeToggle className={toggleClass} />
    </div>
  );
}

function Account({ session, compact }: { session: SessionState; compact: boolean }) {
  const { loading, authed, user } = session;
  const { t } = useI18n();
  const [busy, setBusy] = React.useState(false);

  if (loading) return null;

  if (!authed || !user) {
    return compact ? null : (
      <div className="rounded-lg border bg-muted/40 p-3 text-xs text-muted-foreground">
        {/* A demo never asks for sign-in; questions go to the team. */}
        <p className="font-medium text-foreground">{t("fleet.demo.title")}</p>
        <p className="mt-1">{t("fleet.demo.body")}</p>
        <a
          href="mailto:contact@carvarent.com"
          className="mt-2 inline-block font-medium text-[hsl(var(--gold))] hover:underline"
        >
          {t("fleet.demo.contact")}
        </a>
      </div>
    );
  }

  const out = (
    <button
      type="button"
      onClick={() => {
        setBusy(true);
        void signOut();
      }}
      disabled={busy}
      title={t("fleet.signout")}
      aria-label={t("fleet.signout")}
      className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive disabled:opacity-50"
    >
      <LogOut className="h-4 w-4" />
    </button>
  );

  const avatar = (
    <span
      title={compact ? `${user.name} · ${t(`fleet.role.${user.role}`)}` : undefined}
      className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary"
    >
      {initials(user.name)}
    </span>
  );

  if (compact) {
    return (
      <div className="flex flex-col items-center gap-1.5">
        {avatar}
        {out}
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2.5 rounded-xl border bg-background/60 p-2">
      {avatar}
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium leading-tight">{user.name}</p>
        <p className="truncate text-[11px] text-muted-foreground">
          {t(`fleet.role.${user.role}`)}
        </p>
      </div>
      {out}
    </div>
  );
}

/* --------------------------- Mobile bottom bar --------------------------- */
//
// On a phone the map is the product, and a hamburger hides everything behind
// two taps. The four destinations people actually switch between sit at the
// thumb; everything else is one tap away under "More".

function BottomBar({
  role,
  unread,
  onMore,
  demo = false,
}: {
  role: CarvaRole;
  unread: number;
  onMore: () => void;
  demo?: boolean;
}) {
  const pathname = usePathname();
  const { t } = useI18n();
  // Personal accounts have no alerts page; give that slot to Places.
  const hrefs =
    role === "personal"
      ? ["/fleet", "/fleet/vehicles", "/fleet/history", "/fleet/poi"]
      : ["/fleet", "/fleet/vehicles", "/fleet/history", "/fleet/alerts"];
  const items = hrefs
    .filter((h) => !demo || DEMO_HREFS.has(h))
    .map((h) => NAV.find((n) => n.href === h))
    .filter((n): n is NavItem => n != null);
  const moreActive = !items.some((i) => isActive(pathname, i.href));

  const cell =
    "relative flex flex-1 flex-col items-center justify-center gap-0.5 text-[10.5px] font-medium transition-colors";

  return (
    <nav className="fixed inset-x-0 bottom-0 z-40 flex h-16 border-t bg-card/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden">
      {items.map((item) => {
        const active = isActive(pathname, item.href);
        const Icon = item.icon;
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={cn(cell, active ? "text-primary" : "text-muted-foreground")}
          >
            {active && (
              <span className="absolute inset-x-5 top-0 h-[3px] rounded-b-full bg-primary" />
            )}
            <span className="relative">
              <Icon className="h-5 w-5" />
              {item.href === "/fleet/alerts" && unread > 0 && (
                <span className="absolute -end-2 -top-1.5 min-w-4 rounded-full bg-destructive px-1 text-center text-[9.5px] font-bold leading-4 text-destructive-foreground">
                  {unread > 99 ? "99+" : unread}
                </span>
              )}
            </span>
            <span className="max-w-full truncate px-1">{t(item.label)}</span>
          </Link>
        );
      })}
      <button
        type="button"
        onClick={onMore}
        className={cn(cell, moreActive ? "text-primary" : "text-muted-foreground")}
      >
        <MoreHorizontal className="h-5 w-5" />
        <span>{t("fleet.nav.more")}</span>
      </button>
    </nav>
  );
}

/* --------------------------------- Shell --------------------------------- */

export function Sidebar() {
  const [drawer, setDrawer] = React.useState(false);
  const [collapsed, toggleCollapsed] = useCollapsed();
  const session = useSession();
  const { t } = useI18n();
  // Logged-out demo visitors get the full (company) navigation.
  const role: CarvaRole = session.user?.role ?? "company";
  const demo = !session.loading && !session.authed;
  // Polled once here, not per menu - the menu renders in three places
  // (sidebar, drawer, bottom bar), which would start three pollers.
  const unread = useUnreadAlertCount({ enabled: session.authed });
  const pathname = usePathname();

  // Close the drawer on navigation, including browser back/forward.
  React.useEffect(() => setDrawer(false), [pathname]);
  // Stays mounted through its slide-down, then unmounts.
  const sheet = usePresence(drawer, DUR.base);
  React.useEffect(() => {
    if (!drawer) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setDrawer(false);
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [drawer]);

  return (
    <>
      {/* Zone crossings pop up here on every page (one poller, like the badge). */}
      <GeofenceNotifier enabled={session.authed} />

      {/* Mobile top bar */}
      <div className="sticky top-0 z-30 flex h-[57px] items-center justify-between border-b bg-background/95 px-4 backdrop-blur md:hidden">
        <Brand />
        <ThemeToggle className="flex h-9 w-9 items-center justify-center rounded-lg border bg-background text-muted-foreground" />
      </div>

      {/* Desktop sidebar */}
      <aside
        className="hidden border-e bg-card/80 backdrop-blur-xl transition-[width] duration-200 md:fixed md:inset-y-0 md:start-0 md:z-30 md:flex md:flex-col"
        style={{ width: collapsed ? RAIL : WIDE }}
      >
        <div className={cn("flex items-center py-4", collapsed ? "justify-center px-2" : "px-4")}>
          <Brand compact={collapsed} />
        </div>

        <div className={cn("min-h-0 flex-1 overflow-y-auto pb-4", collapsed ? "px-2" : "px-3")}>
          <NavGroups role={role} unread={unread} compact={collapsed} demo={demo} />
        </div>

        <div className={cn("space-y-3 border-t py-3", collapsed ? "px-2" : "px-3")}>
          <Preferences compact={collapsed} />
          <Account session={session} compact={collapsed} />
          <button
            type="button"
            onClick={toggleCollapsed}
            title={collapsed ? t("fleet.nav.expand") : t("fleet.nav.collapse")}
            aria-label={collapsed ? t("fleet.nav.expand") : t("fleet.nav.collapse")}
            className={cn(
              "flex h-8 w-full items-center gap-2 rounded-lg text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground",
              collapsed ? "justify-center" : "px-3",
            )}
          >
            {/* Chevrons point "inwards" to collapse; rtl:rotate keeps that true in Arabic/Kurdish. */}
            {collapsed ? (
              <ChevronsRight className="h-4 w-4 rtl:rotate-180" />
            ) : (
              <>
                <ChevronsLeft className="h-4 w-4 rtl:rotate-180" />
                {t("fleet.nav.collapse")}
              </>
            )}
          </button>
        </div>
      </aside>

      {/* Mobile bottom bar + "More" sheet */}
      <BottomBar role={role} unread={unread} onMore={() => setDrawer(true)} demo={demo} />

      {sheet.mounted && (
        <div
          className="fixed inset-0 z-50 md:hidden"
          role="dialog"
          aria-modal="true"
          aria-label={t("fleet.nav.more")}
        >
          <div
            className={cn(
              "absolute inset-0 bg-black/55 backdrop-blur-[2px]",
              sheet.leaving ? "fade-out" : "fade-in",
            )}
            onClick={() => setDrawer(false)}
          />
          <div
            className={cn(
              "absolute inset-x-0 bottom-0 flex max-h-[85dvh] flex-col rounded-t-3xl border-t bg-card pb-[env(safe-area-inset-bottom)] shadow-2xl",
              sheet.leaving ? "sheet-out" : "sheet-in",
            )}
          >
            <div className="flex items-center justify-between px-4 pb-2 pt-3">
              <span className="mx-auto h-1 w-10 rounded-full bg-border" />
            </div>
            <div className="flex items-center justify-between px-4 pb-3">
              <Brand />
              <button
                type="button"
                onClick={() => setDrawer(false)}
                aria-label={t("fleet.nav.close")}
                className="flex h-9 w-9 items-center justify-center rounded-lg text-muted-foreground hover:bg-accent"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-3">
              <NavGroups role={role} unread={unread} compact={false} demo={demo} />
            </div>
            <div className="space-y-3 border-t px-3 py-3">
              <Preferences compact={false} />
              <Account session={session} compact={false} />
            </div>
          </div>
        </div>
      )}
    </>
  );
}
