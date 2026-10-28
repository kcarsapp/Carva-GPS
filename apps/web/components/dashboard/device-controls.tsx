"use client";

import * as React from "react";
import {
  Loader2,
  MapPin,
  Power,
  PowerOff,
  RotateCcw,
  ShieldAlert,
  ShieldCheck,
  ShieldOff,
  TriangleAlert,
} from "lucide-react";

import { cn } from "@/lib/utils";
import { Dialog, DialogContent } from "@/components/ui/dialog";
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

// Extra commands (beyond the kill switch) we surface, each with a friendly label
// and icon. Anything not listed here is intentionally hidden: `custom` needs a
// raw frame this panel can't compose, `positionPeriodic` takes a parameter and
// lives on the Settings page (reporting-rate-card.tsx), and `video*` don't apply to plain GPS trackers —
// rendering them as raw buttons only misleads (the button would "send" a
// command that does nothing useful).
type ExtraCommand = {
  type: string;
  labelKey: string;
  Icon: React.ComponentType<{ className?: string }>;
};
/** The two ways to cut the fuel/power circuit. */
type CutMode = "cut" | "cutSafe";

interface RelayInfo {
  protocol: string | null;
  /** Relay state read back from the tracker: true = circuit currently cut. */
  blocked: boolean | null;
  modes: string[];
}

const EXTRA_COMMANDS: ExtraCommand[] = [
  { type: "positionSingle", labelKey: "ctl.locate", Icon: MapPin },
  { type: "alarmArm", labelKey: "ctl.arm", Icon: ShieldCheck },
  { type: "alarmDisarm", labelKey: "ctl.disarm", Icon: ShieldOff },
  { type: "rebootDevice", labelKey: "ctl.reboot", Icon: RotateCcw },
];

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
  /** Which cut the user is being asked to confirm, if any. */
  const [confirmMode, setConfirmMode] = React.useState<CutMode | null>(null);
  /** Relay actions this device supports, from /api/commands/engine. */
  const [relay, setRelay] = React.useState<RelayInfo | null>(null);
  /** The vehicle currently on screen, so a late reply can't report on another. */
  const activeDeviceRef = React.useRef(deviceId);

  React.useEffect(() => {
    activeDeviceRef.current = deviceId;
    let alive = true;
    setTypes(null);
    setLoadErr(false);
    // This panel is reused across vehicle selections, so the previous vehicle's
    // result banner (and any pending confirmation) must not carry over.
    setSent(null);
    setBusy(null);
    setConfirmMode(null);
    fetch(`/api/traccar/commands/types?deviceId=${deviceId}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d: TraccarCommandType[]) => alive && setTypes(d))
      .catch(() => alive && setLoadErr(true));
    return () => {
      alive = false;
    };
  }, [deviceId]);

  // Which relay modes the tracker understands. Only the jt808 devices can defer
  // a cut until the vehicle is stopped, so the safe option is offered per device
  // rather than assumed.
  React.useEffect(() => {
    let alive = true;
    setRelay(null);
    fetch(`/api/commands/engine?deviceId=${deviceId}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d: RelayInfo) => alive && setRelay(d))
      .catch(() => {});
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

  // Extra commands beyond the kill switch that this device actually supports,
  // limited to the curated, parameter-free set above.
  const extras = EXTRA_COMMANDS.filter((c) => supported.has(c.type));

  /**
   * Send a command. The kill switch goes through /api/commands/engine, which
   * picks the dialect the device actually understands — jt808 trackers ignore
   * Traccar's native engineStop/engineResume (0x8105) and need a raw 0x8500
   * "vehicle control" frame. Everything else uses Traccar's encoder directly.
   */
  /** Relay actions go to our own endpoint; everything else to Traccar's. */
  async function sendRelay(mode: "resume" | CutMode) {
    const forDevice = deviceId;
    // A reply that lands after the operator moved on must not paint its banner
    // under another vehicle's kill switch.
    const report = (s: Sent) => {
      if (activeDeviceRef.current === forDevice) setSent(s);
    };
    setBusy(mode);
    setSent(null);
    try {
      const res = await fetch("/api/commands/engine", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ deviceId, mode }),
      });
      // Our own route always answers 200 and reports Traccar's 202 in the body,
      // so the queued state has to be read from the JSON — a command Traccar
      // merely queued must never be shown as delivered.
      const text = await res.text().catch(() => "");
      if (res.ok) {
        let queued = false;
        try {
          queued = (JSON.parse(text) as { queued?: boolean }).queued === true;
        } catch {
          /* non-JSON body: treat as delivered, same as before */
        }
        report({
          ok: true,
          msgKey: queued
            ? "ctl.queued"
            : mode === "cutSafe"
              ? "ctl.safeQueued"
              : "ctl.sentOk",
        });
      } else {
        report({ ok: false, msgKey: "ctl.sentErr", detail: text || `HTTP ${res.status}` });
      }
    } catch (e) {
      report({ ok: false, msgKey: "ctl.sentErr", detail: (e as Error).message });
    } finally {
      setBusy(null);
      setConfirmMode(null);
    }
  }

  async function send(
    type: string,
    attributes?: Record<string, unknown>,
    /** Distinguishes the spinner when one type is sent at several settings. */
    busyKey = type,
  ) {
    const forDevice = deviceId;
    const report = (s: Sent) => {
      if (activeDeviceRef.current === forDevice) setSent(s);
    };
    setBusy(busyKey);
    setSent(null);
    try {
      const res = await fetch("/api/traccar/commands/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ deviceId, type, ...(attributes ? { attributes } : {}) }),
      });
      if (res.ok) {
        // 200 = delivered, 202 = queued until the device next connects.
        report({ ok: true, msgKey: res.status === 202 ? "ctl.queued" : "ctl.sentOk" });
      } else {
        const text = await res.text().catch(() => "");
        report({ ok: false, msgKey: "ctl.sentErr", detail: text || `HTTP ${res.status}` });
      }
    } catch (e) {
      report({ ok: false, msgKey: "ctl.sentErr", detail: (e as Error).message });
    } finally {
      setBusy(null);
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
  // Deferred cuts exist only on the raw jt808 path; never imply one otherwise.
  const offersSafeCut = relay?.modes?.includes("cutSafe") ?? false;
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
        <div className="space-y-2">
          {/* Current relay state, read back from the tracker's own reports —
              the only proof a cut actually landed. */}
          {relay?.blocked != null && (
            <p
              className={cn(
                "text-[11px] font-medium",
                relay.blocked ? "text-red-500" : "text-muted-foreground",
              )}
            >
              {t(relay.blocked ? "ctl.stateCut" : "ctl.stateFlowing")}
            </p>
          )}

          <div className="flex flex-wrap gap-2">
            {/* Safe cut is offered first: it waits for the vehicle to stop. */}
            {offersSafeCut && (
              <button
                type="button"
                disabled={busy !== null}
                onClick={() => setConfirmMode("cutSafe")}
                title={t("ctl.cutSafeHint")}
                className="inline-flex items-center gap-1.5 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-1.5 text-sm font-semibold text-amber-600 transition-colors hover:bg-amber-500/20 disabled:opacity-50 dark:text-amber-400"
              >
                {busy === "cutSafe" ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <ShieldAlert className="h-4 w-4" />
                )}
                {t("ctl.cutSafe")}
              </button>
            )}

            <button
              type="button"
              disabled={busy !== null}
              onClick={() => setConfirmMode("cut")}
              className="inline-flex items-center gap-1.5 rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-1.5 text-sm font-semibold text-red-600 transition-colors hover:bg-red-500/20 disabled:opacity-50 dark:text-red-400"
            >
              {busy === "cut" ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <PowerOff className="h-4 w-4" />
              )}
              {t("ctl.cutNow")}
            </button>

            <button
              type="button"
              disabled={busy !== null}
              onClick={() => sendRelay("resume")}
              className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-3 py-1.5 text-sm font-semibold text-emerald-600 transition-colors hover:bg-emerald-500/20 disabled:opacity-50 dark:text-emerald-400"
            >
              {busy === "resume" ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Power className="h-4 w-4" />
              )}
              {t("ctl.resume")}
            </button>
          </div>

          {offersSafeCut && (
            <p className="text-[11px] text-muted-foreground">{t("ctl.cutSafeHint")}</p>
          )}
        </div>
      )}

      {extras.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-2">
          {extras.map(({ type: tp, labelKey, Icon }) => (
            <button
              key={tp}
              type="button"
              disabled={busy !== null}
              onClick={() => send(tp)}
              className="inline-flex items-center gap-1.5 rounded-lg border bg-background px-2.5 py-1 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-50"
            >
              {busy === tp ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Icon className="h-3.5 w-3.5" />
              )}
              {t(labelKey)}
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

      {/* Rendered through a portal: the panel this sits in scrolls and clips,
          so an in-flow overlay could end up invisible and the confirmation
          would never be reachable. */}
      <Dialog
        open={confirmMode !== null}
        onOpenChange={(open) => !open && setConfirmMode(null)}
      >
        <DialogContent className="max-w-sm">
          <div
            className={cn(
              "flex items-center gap-2",
              confirmMode === "cutSafe"
                ? "text-amber-600 dark:text-amber-400"
                : "text-red-600 dark:text-red-400",
            )}
          >
            <TriangleAlert className="h-5 w-5 shrink-0" />
            <span className="text-sm font-bold">
              {t(confirmMode === "cutSafe" ? "ctl.confirmSafeTitle" : "ctl.confirmTitle")}
            </span>
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            {t(
              confirmMode === "cutSafe" ? "ctl.confirmSafeBody" : "ctl.confirmBody",
            ).replace("{name}", deviceName)}
          </p>
          <div className="mt-4 flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setConfirmMode(null)}
              className="rounded-lg border px-3 py-1.5 text-xs font-medium hover:bg-accent"
            >
              {t("ctl.cancel")}
            </button>
            <button
              type="button"
              disabled={busy !== null}
              onClick={() => confirmMode && sendRelay(confirmMode)}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-bold text-white disabled:opacity-50",
                confirmMode === "cutSafe"
                  ? "bg-amber-600 hover:bg-amber-700"
                  : "bg-red-600 hover:bg-red-700",
              )}
            >
              {busy === confirmMode && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              {t(confirmMode === "cutSafe" ? "ctl.cutSafe" : "ctl.confirmCut")}
            </button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
