"use client";

import { Settings as PageIcon } from "lucide-react";
import * as React from "react";
import { Check, Loader2, Map as MapIcon, Monitor, Moon, Satellite, Sun } from "lucide-react";

import { PageHeader } from "@/components/dashboard/page-header";
import { ReportingRateCard } from "@/components/dashboard/reporting-rate-card";
import { AlertEmailsCard } from "@/components/dashboard/alert-emails-card";
import { NOTIFY_TEST_EVENT, SOUND_KEY, soundEnabled } from "@/components/dashboard/geofence-notifier";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { useSession } from "@/lib/live-data";
import { useTheme, type ThemePref } from "@/lib/theme-provider";
import { useI18n } from "@/lib/i18n-provider";
import { LOCALES, type Locale } from "@/lib/i18n";
import { ACCENTS, ACCENT_SWATCH } from "@/lib/accent";
import { markerClass, markerHtml } from "@/lib/car-icons";
import { CAR_ICONS, MAP_MODES, useAccent, useCarIcon, useMapMode } from "@/lib/preferences";

const BASEMAP_KEY = "carva-basemap";

export default function SettingsPage() {
  const { t } = useI18n();
  const session = useSession();

  return (
    <>
      <PageHeader
        eyebrow={t("fleet.nav.group.manage")}
        icon={PageIcon}
        title={t("fleet.nav.settings")}
        description={t("settings.desc")}
      />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <AppearanceCard />
        <LanguageCard />
        <MapCard />
        {session.authed && <NotificationsCard />}
        {session.authed && <ReportingRateCard />}
        {/* Account-wide: who gets warning emails is an administrator's call. */}
        {session.user?.role === "general_admin" && <AlertEmailsCard />}
        <AccountCard
          userId={session.user?.id ?? null}
          name={session.user?.name ?? ""}
          email={session.user?.email ?? ""}
          role={session.user?.role ?? null}
          authed={session.authed}
        />
      </div>
    </>
  );
}

/* ----------------------------- Notifications ----------------------------- */

function NotificationsCard() {
  const { t } = useI18n();
  const [sound, setSound] = React.useState(true);
  const [perm, setPerm] = React.useState<NotificationPermission | "unsupported">("default");

  React.useEffect(() => {
    setSound(soundEnabled());
    setPerm(typeof Notification === "undefined" ? "unsupported" : Notification.permission);
  }, []);

  function toggleSound() {
    const next = !sound;
    setSound(next);
    try {
      localStorage.setItem(SOUND_KEY, next ? "on" : "off");
    } catch {
      /* private window: the choice lasts until reload */
    }
  }

  async function enableDesktop() {
    if (typeof Notification === "undefined") return;
    try {
      setPerm(await Notification.requestPermission());
    } catch {
      setPerm(Notification.permission);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("ntf.title")}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-xs text-muted-foreground">{t("ntf.desc")}</p>

        <div className="flex items-center justify-between gap-3 rounded-xl border p-3">
          <span className="text-sm font-medium">{t("ntf.sound")}</span>
          <button
            type="button"
            role="switch"
            aria-checked={sound}
            onClick={toggleSound}
            className={cn(
              "relative h-6 w-10 shrink-0 rounded-full transition-colors",
              sound ? "bg-primary" : "bg-muted-foreground/30",
            )}
          >
            <span
              className={cn(
                "absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-[inset-inline-start]",
                sound ? "start-[1.125rem]" : "start-0.5",
              )}
            />
          </button>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border p-3">
          <span className="text-sm font-medium">{t("ntf.desktop")}</span>
          {perm === "granted" ? (
            <Badge variant="success">
              <Check className="h-3.5 w-3.5" /> {t("ntf.on")}
            </Badge>
          ) : perm === "default" ? (
            <Button size="sm" onClick={enableDesktop}>
              {t("ntf.enable")}
            </Button>
          ) : (
            <span className="text-xs text-muted-foreground">
              {t(perm === "denied" ? "ntf.blocked" : "ntf.unsupported")}
            </span>
          )}
        </div>

        <Button
          size="sm"
          variant="outline"
          onClick={() => window.dispatchEvent(new Event(NOTIFY_TEST_EVENT))}
        >
          {t("ntf.test")}
        </Button>
      </CardContent>
    </Card>
  );
}

/* ------------------------------ Appearance ------------------------------- */

function AppearanceCard() {
  const { theme, setTheme } = useTheme();

  const options: { value: ThemePref; label: string; icon: React.ReactNode; hint: string }[] = [
    { value: "light", label: "Day", icon: <Sun className="h-4 w-4" />, hint: "Always light" },
    { value: "dark", label: "Night", icon: <Moon className="h-4 w-4" />, hint: "Always dark" },
    { value: "system", label: "Auto", icon: <Monitor className="h-4 w-4" />, hint: "Follow this device" },
  ];

  return (
    <Card>
      <CardHeader>
        <CardTitle>Appearance</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-3 gap-2">
          {options.map((o) => (
            <button
              key={o.value}
              type="button"
              onClick={() => setTheme(o.value)}
              className={cn(
                "flex flex-col items-center gap-1.5 rounded-xl border p-4 text-sm font-medium transition-colors",
                theme === o.value
                  ? "border-primary bg-primary/10 text-primary"
                  : "text-muted-foreground hover:bg-accent hover:text-foreground",
              )}
              aria-pressed={theme === o.value}
            >
              {o.icon}
              {o.label}
              <span className="text-[11px] font-normal text-muted-foreground">
                {o.hint}
              </span>
            </button>
          ))}
        </div>
        <p className="mt-3 text-xs text-muted-foreground">
          Saved on this browser and applied across the whole dashboard.
        </p>
        <AccentPicker />
      </CardContent>
    </Card>
  );
}

/* ------------------------------- Language -------------------------------- */

function LanguageCard() {
  const { locale, setLocale } = useI18n();
  const entries = Object.entries(LOCALES) as [
    Locale,
    (typeof LOCALES)[Locale],
  ][];

  return (
    <Card>
      <CardHeader>
        <CardTitle>Language</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-3 gap-2">
          {entries.map(([code, def]) => (
            <button
              key={code}
              type="button"
              onClick={() => setLocale(code)}
              className={cn(
                "flex items-center justify-center gap-1.5 rounded-xl border p-4 text-sm font-medium transition-colors",
                locale === code
                  ? "border-primary bg-primary/10 text-primary"
                  : "text-muted-foreground hover:bg-accent hover:text-foreground",
              )}
              aria-pressed={locale === code}
            >
              {def.label}
            </button>
          ))}
        </div>
        <p className="mt-3 text-xs text-muted-foreground">
          Arabic and Kurdish switch the layout to right-to-left automatically.
        </p>
      </CardContent>
    </Card>
  );
}

/* ---------------------------------- Map ----------------------------------- */

function MapCard() {
  const [basemap, setBasemap] = React.useState<"streets" | "satellite">("streets");

  React.useEffect(() => {
    const saved = localStorage.getItem(BASEMAP_KEY);
    if (saved === "satellite" || saved === "streets") setBasemap(saved);
  }, []);

  function choose(next: "streets" | "satellite") {
    setBasemap(next);
    localStorage.setItem(BASEMAP_KEY, next);
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Map</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="mb-2 text-sm font-medium">Default map style</p>
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => choose("streets")}
            className={cn(
              "flex items-center justify-center gap-2 rounded-xl border p-4 text-sm font-medium transition-colors",
              basemap === "streets"
                ? "border-primary bg-primary/10 text-primary"
                : "text-muted-foreground hover:bg-accent hover:text-foreground",
            )}
            aria-pressed={basemap === "streets"}
          >
            <MapIcon className="h-4 w-4" /> Streets
          </button>
          <button
            type="button"
            onClick={() => choose("satellite")}
            className={cn(
              "flex items-center justify-center gap-2 rounded-xl border p-4 text-sm font-medium transition-colors",
              basemap === "satellite"
                ? "border-primary bg-primary/10 text-primary"
                : "text-muted-foreground hover:bg-accent hover:text-foreground",
            )}
            aria-pressed={basemap === "satellite"}
          >
            <Satellite className="h-4 w-4" /> Satellite
          </button>
        </div>
        <p className="mt-3 text-xs text-muted-foreground">
          The dashboard map opens with this style. You can still switch live on
          the map itself.
        </p>
        <MapLookPicker />
        <CarIconPicker />
      </CardContent>
    </Card>
  );
}

/** Interface colour: the dashboard's brand accent (gold by default). */
function AccentPicker() {
  const { t } = useI18n();
  const [accent, setAccent] = useAccent();
  return (
    <div className="mt-5 border-t pt-4">
      <p className="text-sm font-medium">{t("set.accent")}</p>
      <div role="radiogroup" aria-label={t("set.accent")} className="mt-3 grid grid-cols-3 gap-2 sm:grid-cols-6">
        {ACCENTS.map((a) => (
          <button
            key={a}
            type="button"
            role="radio"
            aria-checked={accent === a}
            onClick={() => setAccent(a)}
            className={cn(
              "press flex flex-col items-center gap-1.5 rounded-xl border p-2.5 text-[11px] font-medium",
              accent === a ? "border-primary bg-primary/10 text-foreground" : "text-muted-foreground hover:bg-accent",
            )}
          >
            <span
              className="relative grid h-7 w-7 place-items-center rounded-full"
              style={{
                background: `radial-gradient(circle at 35% 30%, #ffffff66, transparent 55%), ${ACCENT_SWATCH[a]}`,
                boxShadow: accent === a ? `0 0 0 2px hsl(var(--card)), 0 0 0 4px ${ACCENT_SWATCH[a]}` : undefined,
              }}
            >
              {accent === a && <Check className="h-3.5 w-3.5 text-black/70" />}
            </span>
            {t(`accent.${a}`)}
          </button>
        ))}
      </div>
      <p className="mt-2 text-xs text-muted-foreground">{t("set.accent.hint")}</p>
    </div>
  );
}

/** The map's day/night look, independent of the interface theme. */
function MapLookPicker() {
  const { t } = useI18n();
  const [mode, setMode] = useMapMode();
  const icons = {
    auto: <Monitor className="h-4 w-4" />,
    day: <Sun className="h-4 w-4" />,
    night: <Moon className="h-4 w-4" />,
  };
  return (
    <div className="mt-5 border-t pt-4">
      <p className="text-sm font-medium">{t("map.look")}</p>
      <div role="radiogroup" aria-label={t("map.look")} className="mt-3 grid grid-cols-3 gap-2">
        {MAP_MODES.map((m) => (
          <button
            key={m}
            type="button"
            role="radio"
            aria-checked={mode === m}
            onClick={() => setMode(m)}
            className={cn(
              "press flex items-center justify-center gap-2 rounded-xl border p-3 text-sm font-medium",
              mode === m ? "border-primary bg-primary/10 text-primary" : "text-muted-foreground hover:bg-accent hover:text-foreground",
            )}
          >
            {icons[m]}
            {t(`map.look.${m}`)}
          </button>
        ))}
      </div>
      <p className="mt-2 text-xs text-muted-foreground">{t("set.mapLook.hint")}</p>
    </div>
  );
}

/** How vehicles are drawn on the live map, with a live preview of each. */
function CarIconPicker() {
  const { t } = useI18n();
  const [icon, setIcon] = useCarIcon();
  return (
    <div className="mt-5 border-t pt-4">
      <p className="text-sm font-medium">{t("set.carIcon")}</p>
      <div role="radiogroup" aria-label={t("set.carIcon")} className="mt-3 grid grid-cols-4 gap-2">
        {CAR_ICONS.map((c) => (
          <button
            key={c}
            type="button"
            role="radio"
            aria-checked={icon === c}
            onClick={() => setIcon(c)}
            className={cn(
              "press flex flex-col items-center gap-2 rounded-xl border p-3 text-xs font-medium",
              icon === c ? "border-primary bg-primary/10 text-foreground" : "text-muted-foreground hover:bg-accent hover:text-foreground",
            )}
          >
            <span className="grid h-16 w-full place-items-center rounded-lg bg-[#16140f]">
              <span
                className={cn(markerClass(c), "pointer-events-none")}
                style={{ ["--vm-color" as string]: "#10b981" }}
                dangerouslySetInnerHTML={{ __html: markerHtml(c) }}
              />
            </span>
            {t(`car.${c}`)}
          </button>
        ))}
      </div>
      <p className="mt-2 text-xs text-muted-foreground">{t("set.carIcon.hint")}</p>
    </div>
  );
}

/* -------------------------------- Account -------------------------------- */

function AccountCard({
  userId,
  name,
  email,
  role,
  authed,
}: {
  userId: number | null;
  name: string;
  email: string;
  role: string | null;
  authed: boolean;
}) {
  const [pw1, setPw1] = React.useState("");
  const [pw2, setPw2] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [msg, setMsg] = React.useState<{ ok: boolean; text: string } | null>(null);

  async function changePassword(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);
    if (pw1.length < 8) {
      setMsg({ ok: false, text: "Password must be at least 8 characters." });
      return;
    }
    if (pw1 !== pw2) {
      setMsg({ ok: false, text: "The two passwords don't match." });
      return;
    }
    if (!authed || userId == null) {
      setMsg({ ok: false, text: "Sign in to change your password." });
      return;
    }
    setBusy(true);
    try {
      // Fetch the full account object, then save it back with the new password.
      const sRes = await fetch("/api/traccar/session", { cache: "no-store" });
      if (!sRes.ok) throw new Error("session");
      const me = await sRes.json();
      const pRes = await fetch(`/api/traccar/users/${userId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...me, password: pw1 }),
      });
      if (!pRes.ok) throw new Error(`save (${pRes.status})`);
      setPw1("");
      setPw2("");
      setMsg({ ok: true, text: "Password updated. Use it on your next sign-in." });
    } catch {
      setMsg({ ok: false, text: "Couldn't update the password. Try again." });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Account</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {authed ? (
          <div className="space-y-1 text-sm">
            <p className="font-medium">{name}</p>
            <p className="text-muted-foreground">{email}</p>
            {role && (
              <Badge variant="secondary" className="mt-1 text-[10px]">
                {role.replace("_", " ")}
              </Badge>
            )}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            You're viewing the demo — sign in to manage your account.
          </p>
        )}

        <form onSubmit={changePassword} className="space-y-3 border-t pt-4">
          <p className="text-sm font-medium">Change password</p>
          <Input
            type="password"
            value={pw1}
            onChange={(e) => setPw1(e.target.value)}
            placeholder="New password (min. 8 characters)"
            autoComplete="new-password"
          />
          <Input
            type="password"
            value={pw2}
            onChange={(e) => setPw2(e.target.value)}
            placeholder="Repeat new password"
            autoComplete="new-password"
          />
          {msg && (
            <p
              className={cn(
                "flex items-center gap-1.5 text-sm",
                msg.ok ? "text-emerald-600 dark:text-emerald-400" : "text-red-500",
              )}
            >
              {msg.ok && <Check className="h-4 w-4" />}
              {msg.text}
            </p>
          )}
          <div className="flex justify-end">
            <Button type="submit" size="sm" disabled={busy || !authed}>
              {busy && <Loader2 className="h-4 w-4 animate-spin" />}
              Update password
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
