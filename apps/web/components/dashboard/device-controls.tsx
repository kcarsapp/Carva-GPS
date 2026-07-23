"use client";

import * as React from "react";
import { Loader2, Power, PowerOff, TriangleAlert } from "lucide-react";

import { cn } from "@/lib/utils";
import { useI18n } from "@/lib/i18n-provider";
import {
  KILL_CUT_TYPES,
  KILL_RESUME_TYPES,
  resolveCapabilities,
  type Telemetry,
} from "@/lib/capabilities";
import type { TraccarCommandType } from "@carva/shared";

/**
 * Live device control: the kill switch (engine/fuel cut & resume) plus any
 * other command the device's protocol supports, driven by Traccar's
 * per-device command-types endpoint. Rendered only for real, logged-in
 * devices (the parent gates on `canControl`).
 */

type Sent = { ok: boolean; msgKey: string; detail?: string } | null;

// Friendly labels for the command types we know; anything else shows raw.
const KNOWN_LABEL: Record<string, string> = {
  engineStop: "ctl.cut",
  engineResume: "ctl.resume",
  positionSingle: "ctl.locate",
  rebootDevice: "ctl.reboot",
};

export function DeviceControls({
  deviceId,
  deviceName,
  telemetry,
  deviceAttributes,
}: {
  deviceId: number;
  deviceName: string;
  telemetry: Telemetry;
  deviceAttributes?: Record<string, unknown>;
}) {
  const { t } = useI18n();
  const [types, setTypes] = React.useState<TraccarCommandType[] | null>(null);
  const [loadErr, setLoadErr] = React.useState(false);
  const [busy, setBusy] = React.useState<string | null>(null);
  const [sent, setSent] = React.useState<Sent>(null);
  const [confirmCut, setConfirmCut] = React.useState(false);

  React.useEffect(() => {
    let alive = true;
    setTypes(null);
    setLoadErr(false);
    fetch(`/api/traccar/commands/types?deviceId=${deviceId}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d: TraccarCommandType[]) => alive && setTypes(d))
      .catch(() => alive && setLoadErr(true));
    return () => {
      alive = false;
    };
  }, [deviceId]);

  const caps = resolveCapabilities({ commandTypes: types, telemetry, deviceAttributes });
  const supported = new Set((types ?? []).map((c) => c.type));
  // When Traccar lists the type we use it; when an admin force-enables the kill
  // switch on a protocol Traccar under-reports, fall back to the canonical types.
  const cutType = caps.killSwitch.value
    ? (KILL_CUT_TYPES.find((x) => supported.has(x)) ?? KILL_CUT_TYPES[0])
    : undefined;
  const resumeType = caps.killSwitch.value
    ? (KILL_RESUME_TYPES.find((x) => supported.has(x)) ?? KILL_RESUME_TYPES[0])
    : undefined;

  // Extra commands beyond the kill switch (locate, reboot, …) the device offers.
  const extras = (types ?? [])
    .map((c) => c.type)
    .filter((tp) => !KILL_CUT_TYPES.includes(tp) && !KILL_RESUME_TYPES.includes(tp));

  async function send(type: string) {
    setBusy(type);
    setSent(null);
    try {
      const res = await fetch("/api/traccar/commands/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ deviceId, type }),
      });
      if (res.ok) {
        // 200 = delivered, 202 = queued until the device next connects.
        setSent({ ok: true, msgKey: res.status === 202 ? "ctl.queued" : "ctl.sentOk" });
      } else {
        const text = await res.text().catch(() => "");
        setSent({ ok: false, msgKey: "ctl.sentErr", detail: text || `HTTP ${res.status}` });
      }
    } catch (e) {
      setSent({ ok: false, msgKey: "ctl.sentErr", detail: (e as Error).message });
    } finally {
      setBusy(null);
      setConfirmCut(false);
    }
  }

  if (loadErr) {
    return (
      <div className="border-t p-3 text-xs text-muted-foreground">
        {t("ctl.unavailable")}
      </div>
    );
  }
  if (!types) {
    return (
      <div className="flex items-center gap-2 border-t p-3 text-xs text-muted-foreground">
        <Loader2 className="h-3.5 w-3.5 animate-spin" /> {t("ctl.loading")}
      </div>
    );
  }

  const hasKill = caps.killSwitch.value && (cutType || resumeType);
  if (!hasKill && extras.length === 0) {
    return (
      <div className="border-t p-3 text-xs text-muted-foreground">
        {t("ctl.none")}
      </div>
    );
  }

  return (
    <div className="border-t p-3">
      <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
        {t("ctl.title")}
      </p>

      {hasKill && (
        <div className="flex flex-wrap gap-2">
          {cutType && (
            <button
              type="button"
              disabled={busy !== null}
              onClick={() => setConfirmCut(true)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-1.5 text-sm font-semibold text-red-600 transition-colors hover:bg-red-500/20 disabled:opacity-50 dark:text-red-400"
            >
              <PowerOff className="h-4 w-4" />
              {t("ctl.cut")}
            </button>
          )}
          {resumeType && (
            <button
              type="button"
              disabled={busy !== null}
              onClick={() => send(resumeType)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-3 py-1.5 text-sm font-semibold text-emerald-600 transition-colors hover:bg-emerald-500/20 disabled:opacity-50 dark:text-emerald-400"
            >
              {busy === resumeType ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Power className="h-4 w-4" />
              )}
              {t("ctl.resume")}
            </button>
          )}
        </div>
      )}

      {extras.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-2">
          {extras.map((tp) => (
            <button
              key={tp}
              type="button"
              disabled={busy !== null}
              onClick={() => send(tp)}
              className="inline-flex items-center gap-1.5 rounded-lg border bg-background px-2.5 py-1 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-50"
            >
              {busy === tp && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              {KNOWN_LABEL[tp] ? t(KNOWN_LABEL[tp]) : tp}
            </button>
          ))}
        </div>
      )}

      {caps.killSwitch.source === "override" && hasKill && (
        <p className="mt-2 text-[11px] text-muted-foreground">{t("ctl.forced")}</p>
      )}

      {sent && (
        <p
          className={cn(
            "mt-2 text-xs font-medium",
            sent.ok ? "text-emerald-600 dark:text-emerald-400" : "text-red-500",
          )}
        >
          {t(sent.msgKey)}
          {sent.detail ? ` — ${sent.detail}` : ""}
        </p>
      )}

      {confirmCut && cutType && (
        <div className="absolute inset-0 z-30 flex items-center justify-center rounded-xl bg-background/80 p-4 backdrop-blur-sm">
          <div className="w-full max-w-[16rem] rounded-xl border bg-card p-4 shadow-xl">
            <div className="flex items-center gap-2 text-red-600 dark:text-red-400">
              <TriangleAlert className="h-5 w-5" />
              <span className="text-sm font-bold">{t("ctl.confirmTitle")}</span>
            </div>
            <p className="mt-2 text-xs text-muted-foreground">
              {t("ctl.confirmBody").replace("{name}", deviceName)}
            </p>
            <div className="mt-3 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setConfirmCut(false)}
                className="rounded-lg border px-3 py-1.5 text-xs font-medium hover:bg-accent"
              >
                {t("ctl.cancel")}
              </button>
              <button
                type="button"
                disabled={busy !== null}
                onClick={() => send(cutType)}
                className="inline-flex items-center gap-1.5 rounded-lg bg-red-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-red-700 disabled:opacity-50"
              >
                {busy === cutType && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                {t("ctl.confirmCut")}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
