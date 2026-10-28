"use client";

import * as React from "react";
import {
  AlertTriangle,
  Camera,
  Check,
  Gauge,
  Hexagon,
  Loader2,
  Mail,
  Plus,
  Power,
  Send,
  ShieldAlert,
  Waves,
  WifiOff,
  X,
  type LucideIcon,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { useI18n } from "@/lib/i18n-provider";
import {
  ALERT_TYPES,
  BUMPS_PER_DAY_RANGE,
  BUMP_SPEED_RANGE,
  CAMERA_DEFAULT_LIMIT_RANGE,
  MAX_RECIPIENTS,
  OFFLINE_RANGE,
  SPEED_LIMIT_RANGE,
  isEmail,
  type AlertSettings,
  type AlertType,
  type MailerStatus,
} from "@/lib/alert-settings";

/**
 * Settings → Email alerts (administrators only). Edits the settings file the
 * carva-mailer service re-reads every 30 s, so changes apply without a
 * restart. "Send test email" is answered by the mailer itself; this card polls
 * its status file until the answer arrives.
 */

const TYPE_ICON: Record<AlertType, LucideIcon> = {
  geofence: Hexagon,
  engineCut: Power,
  alarm: ShieldAlert,
  powerCut: AlertTriangle,
  offline: WifiOff,
  overspeed: Gauge,
  speedCamera: Camera,
  roadBumps: Waves,
};

/** A small number field with a unit suffix, for the threshold settings. */
function NumberField({
  label,
  unit,
  range,
  value,
  onChange,
}: {
  label: string;
  unit: string;
  range: readonly [number, number];
  value: number;
  onChange: (v: number) => void;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-muted-foreground">{label}</span>
      <span className="relative block">
        <Input
          type="number"
          inputMode="numeric"
          min={range[0]}
          max={range[1]}
          value={value}
          onChange={(e) => onChange(Number(e.target.value))}
          className="h-10 pe-14"
        />
        <span className="pointer-events-none absolute end-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">
          {unit}
        </span>
      </span>
    </label>
  );
}

function fmt(iso?: string | null) {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(+d)
    ? "—"
    : d.toLocaleString([], { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
}

export function AlertEmailsCard() {
  const { t } = useI18n();
  const [saved, setSaved] = React.useState<AlertSettings | null>(null);
  const [draft, setDraft] = React.useState<AlertSettings | null>(null);
  const [status, setStatus] = React.useState<MailerStatus | null>(null);
  const [loadError, setLoadError] = React.useState<string | null>(null);
  const [newEmail, setNewEmail] = React.useState("");
  const [emailError, setEmailError] = React.useState<string | null>(null);
  const [saving, setSaving] = React.useState(false);
  const [saveMsg, setSaveMsg] = React.useState<"ok" | "error" | null>(null);
  const [testing, setTesting] = React.useState(false);

  const load = React.useCallback(async () => {
    try {
      const res = await fetch("/api/alert-settings", { cache: "no-store" });
      if (!res.ok) throw new Error(String(res.status));
      const body = (await res.json()) as { settings: AlertSettings; status: MailerStatus | null };
      setSaved(body.settings);
      setDraft((d) => d ?? body.settings);
      setStatus(body.status);
      setLoadError(null);
      return body;
    } catch (e) {
      setLoadError((e as Error).message);
      return null;
    }
  }, []);

  React.useEffect(() => {
    void load();
  }, [load]);

  // While a test is pending, watch the mailer's answer (it polls every 30 s).
  const pendingTest =
    !!saved?.testRequestedAt && status?.lastTest?.requestedAt !== saved.testRequestedAt;
  React.useEffect(() => {
    if (!pendingTest) return;
    const id = setInterval(() => void load(), 4000);
    return () => clearInterval(id);
  }, [pendingTest, load]);

  const dirty = !!draft && !!saved && JSON.stringify(strip(draft)) !== JSON.stringify(strip(saved));

  function addEmail() {
    const e = newEmail.trim().toLowerCase();
    if (!draft) return;
    if (!isEmail(e)) return setEmailError(t("mail.err.invalid"));
    if (draft.recipients.includes(e)) return setEmailError(t("mail.err.dup"));
    if (draft.recipients.length >= MAX_RECIPIENTS) return setEmailError(t("mail.err.max"));
    setDraft({ ...draft, recipients: [...draft.recipients, e] });
    setNewEmail("");
    setEmailError(null);
  }

  async function save() {
    if (!draft) return;
    setSaving(true);
    setSaveMsg(null);
    try {
      const res = await fetch("/api/alert-settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(draft),
      });
      if (!res.ok) throw new Error(String(res.status));
      const body = (await res.json()) as { settings: AlertSettings };
      setSaved(body.settings);
      setDraft(body.settings);
      setSaveMsg("ok");
    } catch {
      setSaveMsg("error");
    } finally {
      setSaving(false);
    }
  }

  async function sendTest() {
    setTesting(true);
    try {
      const res = await fetch("/api/alert-settings", { method: "POST" });
      if (res.ok) {
        const body = (await res.json()) as { settings: AlertSettings };
        setSaved(body.settings);
      }
    } finally {
      setTesting(false);
    }
  }

  return (
    <Card className="lg:col-span-2">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2">
          <Mail className="h-4 w-4 text-[hsl(var(--gold))]" />
          {t("mail.title")}
        </CardTitle>
        <p className="text-xs text-muted-foreground">{t("mail.desc")}</p>
      </CardHeader>
      <CardContent>
        {loadError && !draft ? (
          <p role="alert" className="rounded-xl border border-destructive/30 bg-destructive/[0.06] p-3 text-sm text-destructive">
            {t("mail.err.load")}
          </p>
        ) : !draft ? (
          <div className="space-y-3">
            <Skeleton className="h-10 w-full rounded-lg" />
            <Skeleton className="h-24 w-full rounded-xl" />
          </div>
        ) : (
          <div className="grid gap-6 lg:grid-cols-2">
            {/* Recipients */}
            <section className="space-y-3">
              <h3 className="text-sm font-semibold">{t("mail.recipients")}</h3>
              {draft.recipients.length === 0 ? (
                <p className="rounded-xl border border-dashed p-3 text-xs text-muted-foreground">
                  {t("mail.noRecipients")}
                </p>
              ) : (
                <ul className="stagger space-y-2">
                  {draft.recipients.map((r) => (
                    <li key={r} className="flex items-center gap-2 rounded-xl border bg-card px-3 py-2">
                      <Mail className="h-4 w-4 shrink-0 text-muted-foreground" />
                      <span className="min-w-0 flex-1 truncate text-sm" dir="ltr">
                        {r}
                      </span>
                      <button
                        type="button"
                        onClick={() =>
                          setDraft({ ...draft, recipients: draft.recipients.filter((x) => x !== r) })
                        }
                        aria-label={`${t("mail.remove")} ${r}`}
                        title={t("mail.remove")}
                        className="press flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                      >
                        <X className="h-4 w-4" />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              <form
                className="flex gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  addEmail();
                }}
              >
                <Input
                  type="email"
                  dir="ltr"
                  value={newEmail}
                  onChange={(e) => {
                    setNewEmail(e.target.value);
                    setEmailError(null);
                  }}
                  placeholder="name@example.com"
                  aria-label={t("mail.add")}
                  aria-invalid={!!emailError}
                  className="h-10"
                />
                <Button type="submit" variant="outline" className="h-10 shrink-0">
                  <Plus />
                  {t("mail.add")}
                </Button>
              </form>
              {emailError && <p className="text-xs text-destructive">{emailError}</p>}

              <div className="grid grid-cols-2 gap-3 pt-1">
                <label className="block">
                  <span className="mb-1 block text-xs font-medium text-muted-foreground">
                    {t("mail.speedLimit")}
                  </span>
                  <span className="relative block">
                    <Input
                      type="number"
                      inputMode="numeric"
                      min={SPEED_LIMIT_RANGE[0]}
                      max={SPEED_LIMIT_RANGE[1]}
                      value={draft.speedLimitKmh}
                      onChange={(e) => setDraft({ ...draft, speedLimitKmh: Number(e.target.value) })}
                      className="h-10 pe-14"
                    />
                    <span className="pointer-events-none absolute end-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">
                      km/h
                    </span>
                  </span>
                </label>
                <label className="block">
                  <span className="mb-1 block text-xs font-medium text-muted-foreground">
                    {t("mail.offlineAfter")}
                  </span>
                  <span className="relative block">
                    <Input
                      type="number"
                      inputMode="numeric"
                      min={OFFLINE_RANGE[0]}
                      max={OFFLINE_RANGE[1]}
                      value={draft.offlineAfterMin}
                      onChange={(e) => setDraft({ ...draft, offlineAfterMin: Number(e.target.value) })}
                      className="h-10 pe-14"
                    />
                    <span className="pointer-events-none absolute end-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">
                      min
                    </span>
                  </span>
                </label>
              </div>

              <div className="space-y-2 border-t pt-3">
                <h4 className="text-xs font-semibold">{t("mail.road")}</h4>
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                  <NumberField
                    label={t("mail.cameraLimit")}
                    unit="km/h"
                    range={CAMERA_DEFAULT_LIMIT_RANGE}
                    value={draft.cameraLimitKmh}
                    onChange={(v) => setDraft({ ...draft, cameraLimitKmh: v })}
                  />
                  <NumberField
                    label={t("mail.bumpSpeed")}
                    unit="km/h"
                    range={BUMP_SPEED_RANGE}
                    value={draft.bumpMaxKmh}
                    onChange={(v) => setDraft({ ...draft, bumpMaxKmh: v })}
                  />
                  <NumberField
                    label={t("mail.bumpsPerDay")}
                    unit={t("mail.perDay")}
                    range={BUMPS_PER_DAY_RANGE}
                    value={draft.bumpsPerDay}
                    onChange={(v) => setDraft({ ...draft, bumpsPerDay: v })}
                  />
                </div>
                <p className="text-xs text-muted-foreground">{t("mail.roadHint")}</p>
              </div>
            </section>

            {/* Which warnings */}
            <section className="space-y-3">
              <h3 className="text-sm font-semibold">{t("mail.which")}</h3>
              <ul className="space-y-2">
                {ALERT_TYPES.map((k) => {
                  const Icon = TYPE_ICON[k];
                  const on = draft.types[k];
                  return (
                    <li key={k}>
                      <button
                        type="button"
                        role="switch"
                        aria-checked={on}
                        onClick={() => setDraft({ ...draft, types: { ...draft.types, [k]: !on } })}
                        className={cn(
                          "press flex w-full items-center gap-3 rounded-xl border p-3 text-start",
                          on ? "border-primary/35 bg-primary/[0.06]" : "hover:bg-accent",
                        )}
                      >
                        <span
                          className={cn(
                            "flex h-9 w-9 shrink-0 items-center justify-center rounded-lg",
                            on ? "bg-primary/15 text-[hsl(var(--gold))]" : "bg-muted text-muted-foreground",
                          )}
                        >
                          <Icon className="h-4 w-4" />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block text-sm font-medium">{t(`mail.type.${k}`)}</span>
                          <span className="block text-xs text-muted-foreground">
                            {t(`mail.type.${k}.hint`)}
                          </span>
                        </span>
                        <span
                          aria-hidden
                          className={cn(
                            "relative h-6 w-10 shrink-0 rounded-full transition-colors duration-200",
                            on ? "bg-primary" : "bg-muted-foreground/30",
                          )}
                        >
                          <span
                            className={cn(
                              "absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-[inset-inline-start] duration-200 ease-out",
                              on ? "start-[1.125rem]" : "start-0.5",
                            )}
                          />
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </section>

            {/* Actions + what the mailer last did */}
            <div className="flex flex-col gap-3 border-t pt-4 lg:col-span-2 lg:flex-row lg:items-center">
              <div className="flex flex-wrap gap-2">
                <Button onClick={save} disabled={!dirty || saving}>
                  {saving ? <Loader2 className="animate-spin" /> : <Check />}
                  {t("mail.save")}
                </Button>
                <Button
                  variant="outline"
                  onClick={sendTest}
                  disabled={testing || pendingTest || dirty || saved?.recipients.length === 0}
                  title={dirty ? t("mail.saveFirst") : undefined}
                >
                  {testing || pendingTest ? <Loader2 className="animate-spin" /> : <Send />}
                  {pendingTest ? t("mail.testing") : t("mail.test")}
                </Button>
              </div>
              <div className="min-w-0 flex-1 space-y-0.5 text-xs text-muted-foreground lg:text-end" aria-live="polite">
                {saveMsg === "ok" && !dirty && (
                  <p className="text-emerald-600 dark:text-emerald-400">{t("mail.saved")}</p>
                )}
                {saveMsg === "error" && <p className="text-destructive">{t("mail.err.save")}</p>}
                {dirty && <p>{t("mail.unsaved")}</p>}
                {status?.lastTest && !pendingTest && (
                  <p className={status.lastTest.ok ? "text-emerald-600 dark:text-emerald-400" : "text-destructive"}>
                    {status.lastTest.ok
                      ? t("mail.testOk").replace("{time}", fmt(status.lastTest.at))
                      : `${t("mail.testFail")} ${status.lastTest.error ?? ""}`}
                  </p>
                )}
                <p>
                  {t("mail.lastSent")}{" "}
                  {status?.lastSent ? (
                    <span dir="auto">
                      {fmt(status.lastSent.at)} · {status.lastSent.subject}
                    </span>
                  ) : (
                    "—"
                  )}
                </p>
                {status?.lastError && (
                  <p className="text-destructive">
                    {t("mail.lastError")} {fmt(status.lastError.at)} · {status.lastError.message}
                  </p>
                )}
              </div>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/** Compare only what the form edits. */
function strip(s: AlertSettings) {
  return {
    recipients: s.recipients,
    types: s.types,
    speedLimitKmh: s.speedLimitKmh,
    offlineAfterMin: s.offlineAfterMin,
    cameraLimitKmh: s.cameraLimitKmh,
    bumpMaxKmh: s.bumpMaxKmh,
    bumpsPerDay: s.bumpsPerDay,
  };
}
