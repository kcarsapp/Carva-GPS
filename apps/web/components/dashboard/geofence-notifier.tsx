"use client";

import * as React from "react";
import Link from "next/link";
import {
  Ban,
  Fuel,
  Hexagon,
  Map as MapIcon,
  Play,
  User,
  Warehouse,
  Wrench,
  X,
} from "lucide-react";

import { useI18n } from "@/lib/i18n-provider";
import { cn } from "@/lib/utils";
import { fetchDevices, fetchEvents, type TraccarEventRow } from "@/lib/events";
import {
  CATEGORY_META,
  actionFor,
  effectiveSeverity,
  readRules,
  type AlertSeverity,
  type GeofenceCategory,
  type GeofenceRules,
  type RulePhase,
} from "@/lib/geofence-rules";
import type { TraccarGeofence } from "@/lib/geofence";
import type { TraccarDevice } from "@carva/shared";

/**
 * Pops a card the moment a car crosses a geofence - on every dashboard page,
 * whichever one is open. Each fence's own rules decide whether a crossing is
 * announced (the same `notify` flag the server automation reads), so a repair
 * shop speaks up when a car ENTERS and an allowed area when a car LEAVES.
 *
 * Polls Traccar's event report rather than holding its own socket: the live
 * socket belongs to the map pages, and a 20-second poll over a 15-minute window
 * is cheap and survives a missed tick. Ids already announced are remembered in
 * localStorage, so a reload - or a second tab - never repeats a card.
 */

const POLL_MS = 20_000;
/** How far back each poll looks; wide enough to bridge a sleeping laptop. */
const WINDOW_MS = 15 * 60_000;
const DEVICES_TTL_MS = 5 * 60_000;
const FENCES_TTL_MS = 2 * 60_000;
/** Non-critical cards close themselves; critical ones wait for a human. */
const AUTO_CLOSE_MS = 20_000;
const SEEN_KEY = "carva.geo.notified";
const SEEN_CAP = 500;

export const SOUND_KEY = "carva.notify.sound";
/** Settings fires this to preview a card, the sound and the desktop popup. */
export const NOTIFY_TEST_EVENT = "carva:notify-test";

const ICONS: Record<GeofenceCategory, React.ComponentType<{ className?: string }>> = {
  zone: Hexagon,
  repair: Wrench,
  region: MapIcon,
  customer: User,
  base: Warehouse,
  restricted: Ban,
};

interface Toast {
  key: string;
  category: GeofenceCategory;
  severity: AlertSeverity;
  title: string;
  zone: string;
  at: string;
  cut: "none" | "safe" | "now";
  deviceId: number | null;
}

function readSeen(): Set<number> | null {
  try {
    const raw = localStorage.getItem(SEEN_KEY);
    if (raw == null) return null;
    const list = JSON.parse(raw) as unknown;
    return new Set(Array.isArray(list) ? list.filter((n) => typeof n === "number") : []);
  } catch {
    return new Set();
  }
}

function writeSeen(seen: Set<number>) {
  try {
    localStorage.setItem(SEEN_KEY, JSON.stringify([...seen].slice(-SEEN_CAP)));
  } catch {
    /* storage blocked: worst case a card repeats after a reload */
  }
}

export function soundEnabled(): boolean {
  try {
    return localStorage.getItem(SOUND_KEY) !== "off";
  } catch {
    return true;
  }
}

/** A short two- or three-note chime, synthesised so there is no file to host. */
function chime(severity: AlertSeverity) {
  if (!soundEnabled()) return;
  try {
    const Ctx =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    const notes = severity === "critical" ? [880, 1175, 1568] : [784, 1047];
    notes.forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = freq;
      const t0 = ctx.currentTime + i * 0.16;
      gain.gain.setValueAtTime(0.0001, t0);
      gain.gain.exponentialRampToValueAtTime(0.25, t0 + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.32);
      osc.connect(gain).connect(ctx.destination);
      osc.start(t0);
      osc.stop(t0 + 0.34);
    });
    window.setTimeout(() => void ctx.close().catch(() => {}), 1500);
  } catch {
    /* audio blocked until the user interacts with the page - the card still shows */
  }
}

/** System notification, for when the dashboard tab is in the background. */
function desktopNotify(title: string, body: string, tag: string) {
  try {
    if (typeof Notification === "undefined" || Notification.permission !== "granted") return;
    if (!document.hidden) return; // the in-page card is already in front of them
    new Notification(title, { body, tag, icon: "/icon.png" });
  } catch {
    /* some mobile browsers only allow notifications from a service worker */
  }
}

function fmtTime(iso: string): string {
  return new Date(iso).toLocaleString("en-GB", {
    timeZone: "Asia/Baghdad",
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** History deep link: half an hour either side of the crossing. */
function replayHref(deviceId: number, at: string): string {
  const t = +new Date(at);
  const qs = new URLSearchParams({
    device: String(deviceId),
    from: new Date(t - 30 * 60_000).toISOString(),
    to: new Date(t + 30 * 60_000).toISOString(),
  });
  return `/fleet/history?${qs}`;
}

export function GeofenceNotifier({ enabled }: { enabled: boolean }) {
  const { t } = useI18n();
  const tRef = React.useRef(t);
  tRef.current = t;
  const [toasts, setToasts] = React.useState<Toast[]>([]);

  const dismiss = React.useCallback((key: string) => {
    setToasts((list) => list.filter((x) => x.key !== key));
  }, []);

  const show = React.useCallback(
    (toast: Toast) => {
      setToasts((list) => [toast, ...list.filter((x) => x.key !== toast.key)].slice(0, 4));
      if (toast.severity !== "critical") {
        window.setTimeout(() => dismiss(toast.key), AUTO_CLOSE_MS);
      }
    },
    [dismiss],
  );

  // Preview from Settings.
  React.useEffect(() => {
    const onTest = () => {
      const tr = tRef.current;
      const toast: Toast = {
        key: `test-${Date.now()}`,
        category: "repair",
        severity: "critical",
        title: tr("ntf.enter").replace("{car}", "BMW 330i").replace("{zone}", tr("geo.cat.repair")),
        zone: tr("ntf.testBody"),
        at: new Date().toISOString(),
        cut: "none",
        deviceId: null,
      };
      show(toast);
      chime("critical");
      try {
        if (typeof Notification !== "undefined" && Notification.permission === "granted") {
          new Notification(toast.title, { body: toast.zone, tag: toast.key, icon: "/icon.png" });
        }
      } catch {
        /* see desktopNotify */
      }
    };
    window.addEventListener(NOTIFY_TEST_EVENT, onTest);
    return () => window.removeEventListener(NOTIFY_TEST_EVENT, onTest);
  }, [show]);

  React.useEffect(() => {
    if (!enabled) return;
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const controller = new AbortController();
    let devices: TraccarDevice[] = [];
    let devicesAt = 0;
    let fences = new Map<number, { name: string; rules: GeofenceRules }>();
    let fencesAt = 0;

    async function tick() {
      try {
        const now = Date.now();
        if (now - devicesAt > DEVICES_TTL_MS || devices.length === 0) {
          devices = await fetchDevices(controller.signal);
          devicesAt = now;
        }
        if (now - fencesAt > FENCES_TTL_MS) {
          const res = await fetch("/api/traccar/geofences", {
            cache: "no-store",
            signal: controller.signal,
          });
          if (res.ok) {
            const list = (await res.json()) as TraccarGeofence[];
            fences = new Map(
              (Array.isArray(list) ? list : []).map((g) => [
                g.id,
                { name: g.name, rules: readRules(g.attributes) },
              ]),
            );
            fencesAt = now;
          }
        }
        if (devices.length === 0 || fences.size === 0) return;

        const rows = (
          await fetchEvents({
            deviceIds: devices.map((d) => d.id),
            from: new Date(now - WINDOW_MS),
            to: new Date(now + 60_000),
            signal: controller.signal,
          })
        ).filter((r) => r.type === "geofenceEnter" || r.type === "geofenceExit");
        if (!alive) return;

        let seen = readSeen();
        // First run on this browser: everything already there is old news.
        if (seen == null) {
          writeSeen(new Set(rows.map((r) => r.id)));
          return;
        }
        const fresh = rows.filter((r) => !seen!.has(r.id)).reverse(); // oldest first
        if (fresh.length === 0) return;
        seen = new Set([...seen, ...fresh.map((r) => r.id)]);
        writeSeen(seen);

        let loudest: AlertSeverity | null = null;
        for (const row of fresh) {
          const toast = toToast(row, devices, fences, tRef.current);
          if (!toast) continue;
          show(toast);
          desktopNotify(toast.title, `${toast.zone} · ${fmtTime(toast.at)}`, toast.key);
          if (!loudest || toast.severity === "critical") loudest = toast.severity;
        }
        if (loudest) chime(loudest);
      } catch {
        /* offline, signed out or aborted - try again next tick */
      } finally {
        if (alive) timer = setTimeout(tick, POLL_MS);
      }
    }

    void tick();
    return () => {
      alive = false;
      controller.abort();
      if (timer) clearTimeout(timer);
    };
  }, [enabled, show]);

  if (toasts.length === 0) return null;

  return (
    <div
      aria-live="assertive"
      className="pointer-events-none fixed inset-x-3 bottom-[calc(64px+env(safe-area-inset-bottom)+12px)] z-[80] flex flex-col items-end gap-2 sm:inset-x-auto sm:end-4 md:bottom-4"
    >
      {toasts.map((toast) => (
        <ToastCard key={toast.key} toast={toast} onClose={() => dismiss(toast.key)} />
      ))}
    </div>
  );
}

function toToast(
  row: TraccarEventRow,
  devices: TraccarDevice[],
  fences: Map<number, { name: string; rules: GeofenceRules }>,
  t: (key: string) => string,
): Toast | null {
  const fence = row.geofenceId ? fences.get(row.geofenceId) : undefined;
  if (!fence) return null;
  const phase: RulePhase = row.type === "geofenceExit" ? "exit" : "enter";
  const action = actionFor(fence.rules, phase);
  if (!action.notify && action.cut === "none") return null;
  const car = devices.find((d) => d.id === row.deviceId)?.name ?? `#${row.deviceId}`;
  return {
    key: `ev-${row.id}`,
    category: fence.rules.category,
    severity: effectiveSeverity(fence.rules, phase),
    title: t(phase === "enter" ? "ntf.enter" : "ntf.exit")
      .replace("{car}", car)
      .replace("{zone}", fence.name),
    zone: t(CATEGORY_META[fence.rules.category].labelKey),
    at: row.eventTime,
    cut: action.cut,
    deviceId: row.deviceId,
  };
}

function ToastCard({ toast, onClose }: { toast: Toast; onClose: () => void }) {
  const { t } = useI18n();
  const meta = CATEGORY_META[toast.category];
  const Icon = ICONS[toast.category];
  return (
    <div
      role="alert"
      className="glass-strong rise pointer-events-auto relative w-full overflow-hidden rounded-2xl border shadow-[var(--shadow-raised)] sm:w-[360px]"
    >
      <span className="absolute inset-y-0 start-0 w-1" style={{ background: meta.hex }} />
      <div className="flex gap-3 p-3.5 ps-4">
        <span
          className="grid h-10 w-10 shrink-0 place-items-center rounded-xl text-white shadow-sm"
          style={{ background: meta.hex }}
        >
          <Icon className="h-5 w-5" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-start gap-2">
            <p className="min-w-0 flex-1 text-sm font-semibold leading-snug">{toast.title}</p>
            <button
              type="button"
              onClick={onClose}
              aria-label={t("ntf.dismiss")}
              className="-me-1 -mt-1 rounded-lg p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
          <p className="mt-0.5 text-xs text-muted-foreground">
            <span className={cn("font-medium", meta.accent.text)}>{toast.zone}</span>
            {" · "}
            <span className="tabular-nums">{fmtTime(toast.at)}</span>
          </p>
          {toast.cut !== "none" && (
            <p className="mt-1.5 inline-flex items-center gap-1 rounded-md bg-amber-500/15 px-1.5 py-0.5 text-[11px] font-medium text-amber-700 dark:text-amber-300">
              <Fuel className="h-3 w-3" />
              {t(toast.cut === "now" ? "ntf.cutNow" : "ntf.cut")}
            </p>
          )}
          <div className="mt-2 flex flex-wrap gap-1.5">
            {toast.deviceId != null && (
              <Link
                href={replayHref(toast.deviceId, toast.at)}
                onClick={onClose}
                className="inline-flex items-center gap-1 rounded-lg border bg-background px-2 py-1 text-xs font-medium transition-colors hover:bg-accent"
              >
                <Play className="h-3 w-3" />
                {t("ntf.replay")}
              </Link>
            )}
            <Link
              href="/fleet/alerts"
              onClick={onClose}
              className="inline-flex items-center rounded-lg border bg-background px-2 py-1 text-xs font-medium transition-colors hover:bg-accent"
            >
              {t("ntf.alerts")}
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
