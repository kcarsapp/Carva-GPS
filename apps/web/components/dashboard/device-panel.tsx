"use client";

import * as React from "react";
import Link from "next/link";
import {
  AlertTriangle,
  Check,
  Copy,
  ExternalLink,
  Loader2,
  MessageSquare,
  RefreshCw,
  Save,
  X,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Tooltip } from "@/components/ui/tooltip";
import { DeviceControls } from "@/components/dashboard/device-controls";
import { cn } from "@/lib/utils";
import { useI18n } from "@/lib/i18n-provider";
import { readTelemetry } from "@/lib/capabilities";
import { eventLabel, type TraccarEventRow } from "@/lib/events";
import { CARVA_RULES_KEY, readRules } from "@/lib/geofence-rules";
import type { TraccarGeofence } from "@/lib/geofence";
import {
  cardinal,
  formatAge,
  formatDateTime,
  formatDateTimeLong,
  formatDistance,
  formatEngineHours,
  formatOdometer,
  formatSpeed,
  formatVoltage,
} from "@/lib/format";
import {
  clearTripOdometer,
  getTripBaseline,
  resetTripOdometer,
  tripMetres,
  type TripBaseline,
} from "@/lib/trip-odometer";
import {
  DEVICE_CATEGORY_OPTIONS,
  HOURS_SINCE_KEY,
  MV930G_SMS_COMMANDS,
  ODOMETER_SINCE_KEY,
  SMS_GROUPS,
  getLinkedGeofences,
  getQueuedCommands,
  getRecentEvents,
  isMoving,
  resetAccumulators,
  smsHref,
  updateDevice,
  type DeviceHealth,
  type DeviceRecord,
  type QueuedCommand,
} from "@/lib/devices-api";
import type { TraccarPosition } from "@carva/shared";

/**
 * Everything about one GPS tracker, in tabs: live readings, resettable
 * counters, remote controls, the editable Traccar record, the SMS command
 * reference and the geofences / events linked to it.
 *
 * The parent owns the data (device, latest position, derived health) and
 * refreshes it on its own timer; this panel only fetches the tab-local extras
 * (queued commands, geofences, events) and performs the writes.
 */

export type DevicePanelTab =
  | "overview"
  | "counters"
  | "controls"
  | "settings"
  | "sms"
  | "links";

const TABS: DevicePanelTab[] = ["overview", "counters", "controls", "settings", "sms", "links"];

export interface DevicePanelProps {
  device: DeviceRecord;
  position: TraccarPosition | null;
  health: DeviceHealth;
  /** Called after a successful PUT so the list shows the new record at once. */
  onDeviceUpdated: (record: DeviceRecord) => void;
  /** Re-poll devices + positions (after a server counter reset). */
  onRefresh: () => Promise<void> | void;
  onClose?: () => void;
  className?: string;
}

/* ------------------------------- Utilities -------------------------------- */

type Translate = (key: string) => string;

/** "now" / "4m ago" in the active language. */
function ageText(iso: string | undefined | null, t: Translate, now = Date.now()): string {
  const age = formatAge(iso, now);
  if (age === "—") return age;
  if (age === "now") return t("dev.age.now");
  return t("dev.age.ago").replace("{age}", age);
}

function useCopy(): [string | null, (text: string, key: string) => void] {
  const [copied, setCopied] = React.useState<string | null>(null);
  const timer = React.useRef<number | undefined>(undefined);
  const copy = React.useCallback((text: string, key: string) => {
    if (typeof navigator === "undefined" || !navigator.clipboard) return;
    navigator.clipboard
      .writeText(text)
      .then(() => {
        setCopied(key);
        window.clearTimeout(timer.current);
        timer.current = window.setTimeout(() => setCopied(null), 1500);
      })
      .catch(() => {});
  }, []);
  React.useEffect(() => () => window.clearTimeout(timer.current), []);
  return [copied, copy];
}

/** Small icon button that copies `text` and flashes a check mark. */
export function CopyButton({
  text,
  copied,
  onCopy,
  label,
  className,
}: {
  text: string;
  copied: boolean;
  onCopy: (text: string) => void;
  label: string;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onCopy(text);
      }}
      aria-label={label}
      title={label}
      className={cn(
        "inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground",
        className,
      )}
    >
      {copied ? (
        <Check className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
      ) : (
        <Copy className="h-3.5 w-3.5" />
      )}
    </button>
  );
}

/** Online / offline / no-signal / never-reported pill shared with the list. */
export function DeviceStatusPill({ health }: { health: DeviceHealth }) {
  const { t } = useI18n();
  if (health.neverReported) {
    return (
      <Badge variant="muted">
        <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground/60" />
        {t("dev.status.never")}
      </Badge>
    );
  }
  if (health.online) {
    return (
      <Badge variant="success">
        <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
        {t("dev.status.online")}
      </Badge>
    );
  }
  if (health.status === "unknown") {
    return (
      <Badge variant="warning">
        <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
        {t("dev.status.unknown")}
      </Badge>
    );
  }
  return (
    <Badge variant="destructive">
      <span className="h-1.5 w-1.5 rounded-full bg-destructive" />
      {t("dev.status.offline")}
    </Badge>
  );
}

type Tone = "good" | "bad" | "warn" | "muted";

function toneClass(tone?: Tone): string {
  switch (tone) {
    case "good":
      return "text-emerald-600 dark:text-emerald-400";
    case "bad":
      return "text-red-600 dark:text-red-400";
    case "warn":
      return "text-amber-600 dark:text-amber-400";
    case "muted":
      return "text-muted-foreground";
    default:
      return "text-foreground";
  }
}

function Row({
  label,
  value,
  tone,
  note,
  action,
}: {
  label: string;
  value: React.ReactNode;
  tone?: Tone;
  note?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-3 border-b py-2 last:border-0">
      <div className="shrink-0 text-xs text-muted-foreground">{label}</div>
      <div className="flex min-w-0 flex-col items-end text-end">
        <div className={cn("flex items-center gap-1 text-sm font-medium", toneClass(tone))}>
          <div className="min-w-0 break-words">{value}</div>
          {action}
        </div>
        {note && <div className="text-[11px] text-muted-foreground">{note}</div>}
      </div>
    </div>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <p className="mb-1 mt-4 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground first:mt-0">
      {children}
    </p>
  );
}

function Notice({
  tone = "muted",
  children,
}: {
  tone?: "muted" | "warn" | "bad" | "good";
  children: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        "rounded-lg border px-3 py-2 text-xs",
        tone === "warn" && "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300",
        tone === "bad" && "border-destructive/30 bg-destructive/10 text-destructive",
        tone === "good" &&
          "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
        tone === "muted" && "bg-muted/40 text-muted-foreground",
      )}
    >
      {children}
    </div>
  );
}

/** Wraps a disabled control with the reason it is disabled. */
function DisabledReason({
  disabled,
  reason,
  block,
  children,
}: {
  disabled: boolean;
  reason: string;
  /** Stretch to the full width (for block content rather than a button). */
  block?: boolean;
  children: React.ReactNode;
}) {
  if (!disabled) return <>{children}</>;
  const tip = (
    <Tooltip content={reason}>
      {/* Disabled controls swallow pointer events in some browsers, so the
          wrapper takes the hover and owns the tooltip. */}
      <span className={cn("inline-flex [&>*]:pointer-events-none", block && "w-full")} tabIndex={0}>
        {children}
      </span>
    </Tooltip>
  );
  // The tooltip anchor is an inline-flex span; stretch it for block content.
  return block ? <div className="[&>span]:flex [&>span]:w-full">{tip}</div> : tip;
}

/* --------------------------------- Panel ---------------------------------- */

export function DevicePanel({
  device,
  position,
  health,
  onDeviceUpdated,
  onRefresh,
  onClose,
  className,
}: DevicePanelProps) {
  const { t } = useI18n();
  const [tab, setTab] = React.useState<DevicePanelTab>("overview");
  const [copied, copy] = useCopy();

  // A new device starts back on Overview — the previous device's Settings
  // draft or SMS list must not carry over.
  React.useEffect(() => {
    setTab("overview");
  }, [device.id]);

  return (
    <div className={cn("flex h-full min-h-0 flex-col", className)}>
      {/* Header */}
      <div className="flex items-start justify-between gap-3 border-b p-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="truncate text-base font-semibold">{device.name}</h2>
            <DeviceStatusPill health={health} />
            {device.disabled && <Badge variant="warning">{t("dev.disabledBadge")}</Badge>}
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
            <span>{device.model || t("dev.unknownModel")}</span>
            <span aria-hidden>·</span>
            <span className="inline-flex items-center gap-1 font-mono" dir="ltr">
              {device.uniqueId}
              <CopyButton
                text={device.uniqueId}
                copied={copied === "uid"}
                onCopy={(v) => copy(v, "uid")}
                label={t("dev.copy")}
              />
            </span>
            {position?.protocol && (
              <>
                <span aria-hidden>·</span>
                <span className="font-mono">{String(position.protocol)}</span>
              </>
            )}
          </div>
        </div>
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            aria-label={t("dev.close")}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>

      {health.neverReported && (
        <div className="px-4 pt-3">
          <Notice tone="warn">{t("dev.neverBody")}</Notice>
        </div>
      )}

      <Tabs
        value={tab}
        onValueChange={(v) => setTab(v as DevicePanelTab)}
        className="flex min-h-0 flex-1 flex-col"
      >
        <div className="px-4 pt-3">
          <TabsList className="flex h-auto w-full flex-wrap justify-start">
            {TABS.map((value) => (
              <TabsTrigger key={value} value={value} className="px-2.5 py-1 text-xs">
                {t(`dev.tab.${value}`)}
              </TabsTrigger>
            ))}
          </TabsList>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          <TabsContent value="overview">
            <OverviewTab device={device} position={position} health={health} />
          </TabsContent>
          <TabsContent value="counters">
            <CountersTab
              key={device.id}
              device={device}
              health={health}
              onDeviceUpdated={onDeviceUpdated}
              onRefresh={onRefresh}
            />
          </TabsContent>
          <TabsContent value="controls">
            <ControlsTab key={device.id} device={device} position={position} health={health} />
          </TabsContent>
          <TabsContent value="settings">
            <SettingsTab key={device.id} device={device} onDeviceUpdated={onDeviceUpdated} />
          </TabsContent>
          <TabsContent value="sms">
            <SmsTab device={device} />
          </TabsContent>
          <TabsContent value="links">
            <LinksTab key={device.id} deviceId={device.id} />
          </TabsContent>
        </div>
      </Tabs>
    </div>
  );
}

/* -------------------------------- Overview -------------------------------- */

function OverviewTab({
  device,
  position,
  health,
}: {
  device: DeviceRecord;
  position: TraccarPosition | null;
  health: DeviceHealth;
}) {
  const { t } = useI18n();
  const [copied, copy] = useCopy();
  const attrs: Record<string, unknown> = position?.attributes ?? {};
  const onOff = (b: boolean | null) => (b == null ? "—" : t(b ? "dev.on" : "dev.off"));
  const moving = isMoving(position);
  const coords =
    position && Number.isFinite(position.latitude) && Number.isFinite(position.longitude)
      ? `${position.latitude.toFixed(6)}, ${position.longitude.toFixed(6)}`
      : null;
  const accuracy = typeof position?.accuracy === "number" ? position.accuracy : null;
  const altitude = typeof position?.altitude === "number" ? position.altitude : null;
  const valid = position ? (position as { valid?: unknown }).valid : undefined;
  const address = typeof position?.address === "string" ? position.address : "";

  const gpsValue = !position
    ? "—"
    : valid === true
      ? t("dev.gps.valid")
      : valid === false
        ? t("dev.gps.invalid")
        : "—";

  return (
    <div>
      <SectionTitle>{t("dev.sec.status")}</SectionTitle>
      <Row label={t("dev.row.status")} value={<DeviceStatusPill health={health} />} />
      <Row
        label={t("dev.row.lastFix")}
        value={position ? formatDateTimeLong(position.fixTime) : "—"}
        note={
          position
            ? `${ageText(position.fixTime, t)}${health.staleFix ? ` · ${t("dev.stale")}` : ""}`
            : undefined
        }
        tone={health.staleFix ? "warn" : undefined}
      />
      <Row
        label={t("dev.row.lastUpdate")}
        value={device.lastUpdate ? formatDateTimeLong(device.lastUpdate) : "—"}
        note={device.lastUpdate ? ageText(device.lastUpdate, t) : undefined}
      />
      <Row
        label={t("dev.row.received")}
        value={position ? formatDateTimeLong(String((position as { serverTime?: unknown }).serverTime ?? "")) : "—"}
      />
      <Row label={t("dev.row.protocol")} value={position?.protocol ? String(position.protocol) : "—"} />

      <SectionTitle>{t("dev.sec.gps")}</SectionTitle>
      <Row
        label={t("dev.row.gps")}
        value={gpsValue}
        tone={valid === true ? "good" : valid === false ? "bad" : undefined}
      />
      <Row
        label={t("dev.row.satellites")}
        value={health.satellites != null ? String(health.satellites) : "—"}
        tone={health.satellites != null && health.satellites < 4 ? "warn" : undefined}
      />
      <Row label={t("dev.row.accuracy")} value={accuracy != null ? `${Math.round(accuracy)} m` : "—"} />
      <Row label={t("dev.row.altitude")} value={altitude != null ? `${Math.round(altitude)} m` : "—"} />
      <Row
        label={t("dev.row.coords")}
        value={coords ? <span className="font-mono" dir="ltr">{coords}</span> : "—"}
        action={
          coords ? (
            <CopyButton
              text={coords}
              copied={copied === "coords"}
              onCopy={(v) => copy(v, "coords")}
              label={t("dev.copy")}
            />
          ) : undefined
        }
      />
      <Row label={t("dev.row.address")} value={address || "—"} />
      <Row label={t("dev.row.speed")} value={position ? formatSpeed(position.speed) : "—"} />
      <Row
        label={t("dev.row.direction")}
        // A parked tracker reports course 0, which is "no direction", not north.
        value={
          moving && position
            ? `${cardinal(position.course)} · ${Math.round(position.course)}°`
            : "—"
        }
        note={position && !moving ? t("dev.directionParked") : undefined}
      />

      <SectionTitle>{t("dev.sec.vehicle")}</SectionTitle>
      <Row
        label={t("dev.row.ignition")}
        value={onOff(health.ignition)}
        tone={health.ignition ? "good" : undefined}
      />
      <Row
        label={t("dev.row.motion")}
        value={health.motion == null ? "—" : t(health.motion ? "dev.moving" : "dev.parked")}
        tone={health.motion ? "good" : undefined}
      />
      <Row
        label={t("dev.row.power")}
        value={
          health.powerConnected == null
            ? "—"
            : `${t(health.powerConnected ? "dev.powerOn" : "dev.powerOff")} · ${formatVoltage(health.voltage)}`
        }
        tone={health.powerConnected == null ? undefined : health.powerConnected ? "good" : "bad"}
      />
      <Row
        label={t("dev.row.charging")}
        value={onOff(health.charging)}
        tone={health.charging ? "good" : undefined}
      />
      <Row
        label={t("dev.row.relay")}
        value={
          health.relayCut == null ? "—" : t(health.relayCut ? "dev.relayCut" : "dev.relayFlowing")
        }
        tone={health.relayCut == null ? undefined : health.relayCut ? "bad" : "good"}
      />
      <Row
        label={t("dev.row.signal")}
        value={
          health.signal
            ? `${t(`detail.sig.${health.signal}`)}${health.rssi != null ? ` (${health.rssi})` : ""}`
            : "—"
        }
        tone={health.signal === "poor" ? "bad" : health.signal === "fair" ? "warn" : undefined}
      />

      <SectionTitle>{t("dev.sec.counters")}</SectionTitle>
      <Row label={t("dev.row.lifetime")} value={formatOdometer(health.totalDistance)} />
      <Row label={t("dev.row.engineHours")} value={formatEngineHours(health.engineHours)} />
      <Row
        label={t("dev.row.trackerOdo")}
        value={formatOdometer(health.trackerOdometer)}
        note={health.trackerOdometer === 0 ? t("dev.trackerOdoOff") : undefined}
        tone={health.trackerOdometer === 0 ? "muted" : undefined}
      />
      {typeof attrs.distance === "number" && (
        <Row label={t("dev.row.lastLeg")} value={formatDistance(attrs.distance)} />
      )}
    </div>
  );
}

/* -------------------------------- Counters -------------------------------- */

type PendingReset =
  | { kind: "distance"; metres: number }
  | { kind: "hours"; ms: number };

function CountersTab({
  device,
  health,
  onDeviceUpdated,
  onRefresh,
}: {
  device: DeviceRecord;
  health: DeviceHealth;
  onDeviceUpdated: (record: DeviceRecord) => void;
  onRefresh: () => Promise<void> | void;
}) {
  const { t } = useI18n();
  const [kmInput, setKmInput] = React.useState("");
  const [hoursInput, setHoursInput] = React.useState("");
  const [pending, setPending] = React.useState<PendingReset | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [msg, setMsg] = React.useState<{ ok: boolean; text: string } | null>(null);

  // Local trip counter (this browser only).
  const tripKey = String(device.id);
  const [baseline, setBaseline] = React.useState<TripBaseline | null>(null);
  React.useEffect(() => {
    setBaseline(getTripBaseline(tripKey));
  }, [tripKey]);

  const total = health.totalDistance;
  const disabled = health.neverReported || total == null;
  const reason = health.neverReported ? t("dev.disabledNever") : t("dev.disabledNoTotals");

  const attrs = (device.attributes ?? {}) as Record<string, unknown>;
  const odoSince = typeof attrs[ODOMETER_SINCE_KEY] === "string" ? (attrs[ODOMETER_SINCE_KEY] as string) : null;
  const hoursSince = typeof attrs[HOURS_SINCE_KEY] === "string" ? (attrs[HOURS_SINCE_KEY] as string) : null;

  function askDistance(metres: number) {
    setMsg(null);
    setPending({ kind: "distance", metres });
  }
  function askHours(ms: number) {
    setMsg(null);
    setPending({ kind: "hours", ms });
  }
  function submitKm() {
    const km = Number(kmInput.replace(",", "."));
    if (!Number.isFinite(km) || km < 0) {
      setMsg({ ok: false, text: t("dev.counters.badNumber") });
      return;
    }
    askDistance(km * 1000);
  }
  function submitHours() {
    const h = Number(hoursInput.replace(",", "."));
    if (!Number.isFinite(h) || h < 0) {
      setMsg({ ok: false, text: t("dev.counters.badNumber") });
      return;
    }
    askHours(h * 3_600_000);
  }

  async function confirm() {
    if (!pending) return;
    setBusy(true);
    setMsg(null);
    const current = { totalDistance: total ?? 0, hours: health.engineHours ?? 0 };
    try {
      if (pending.kind === "distance") {
        await resetAccumulators(device.id, { totalDistance: pending.metres }, current);
      } else {
        await resetAccumulators(device.id, { hours: pending.ms }, current);
      }
      // Remember when the counter was re-based, on the device record itself so
      // every operator sees the same "since". Best effort: the reset above has
      // already happened even if this second write fails.
      const sinceKey = pending.kind === "distance" ? ODOMETER_SINCE_KEY : HOURS_SINCE_KEY;
      try {
        const saved = await updateDevice({
          ...device,
          attributes: { ...(device.attributes ?? {}), [sinceKey]: new Date().toISOString() },
        });
        onDeviceUpdated(saved);
      } catch {
        /* the "since" note is cosmetic */
      }
      setMsg({ ok: true, text: t("dev.counters.done") });
      setKmInput("");
      setHoursInput("");
      setPending(null);
      await onRefresh();
    } catch (e) {
      setMsg({ ok: false, text: `${t("dev.counters.err")} ${(e as Error).message}` });
    } finally {
      setBusy(false);
    }
  }

  const trip = total != null ? tripMetres(total, baseline) : null;

  return (
    <div className="space-y-4">
      <Notice tone="warn">{t("dev.counters.serverNote")}</Notice>

      {msg && <Notice tone={msg.ok ? "good" : "bad"}>{msg.text}</Notice>}

      {/* Server odometer */}
      <div className="rounded-lg border p-3">
        <div className="flex items-baseline justify-between gap-2">
          <p className="text-sm font-semibold">{t("dev.counters.odometer")}</p>
          <p className="text-lg font-bold tabular-nums">{formatOdometer(total)}</p>
        </div>
        <p className="text-[11px] text-muted-foreground">
          {t("dev.counters.serverScope")}
          {odoSince ? ` · ${t("dev.since")} ${formatDateTime(odoSince)}` : ""}
        </p>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <DisabledReason disabled={disabled} reason={reason}>
            <Button size="sm" variant="outline" disabled={disabled || busy} onClick={() => askDistance(0)}>
              {t("dev.counters.resetZero")}
            </Button>
          </DisabledReason>
          <form
            className="flex items-center gap-1.5"
            onSubmit={(e) => {
              e.preventDefault();
              submitKm();
            }}
          >
            <Input
              type="number"
              inputMode="decimal"
              min={0}
              step="0.1"
              value={kmInput}
              onChange={(e) => setKmInput(e.target.value)}
              disabled={disabled || busy}
              placeholder={t("dev.counters.kmPh")}
              className="h-9 w-28"
            />
            <DisabledReason disabled={disabled} reason={reason}>
              <Button size="sm" type="submit" disabled={disabled || busy || !kmInput}>
                {t("dev.counters.setTo")}
              </Button>
            </DisabledReason>
          </form>
        </div>
      </div>

      {/* Server engine hours */}
      <div className="rounded-lg border p-3">
        <div className="flex items-baseline justify-between gap-2">
          <p className="text-sm font-semibold">{t("dev.counters.hours")}</p>
          <p className="text-lg font-bold tabular-nums">{formatEngineHours(health.engineHours)}</p>
        </div>
        <p className="text-[11px] text-muted-foreground">
          {t("dev.counters.serverScope")}
          {hoursSince ? ` · ${t("dev.since")} ${formatDateTime(hoursSince)}` : ""}
        </p>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <DisabledReason disabled={disabled} reason={reason}>
            <Button size="sm" variant="outline" disabled={disabled || busy} onClick={() => askHours(0)}>
              {t("dev.counters.resetZero")}
            </Button>
          </DisabledReason>
          <form
            className="flex items-center gap-1.5"
            onSubmit={(e) => {
              e.preventDefault();
              submitHours();
            }}
          >
            <Input
              type="number"
              inputMode="decimal"
              min={0}
              step="0.1"
              value={hoursInput}
              onChange={(e) => setHoursInput(e.target.value)}
              disabled={disabled || busy}
              placeholder={t("dev.counters.hoursPh")}
              className="h-9 w-28"
            />
            <DisabledReason disabled={disabled} reason={reason}>
              <Button size="sm" type="submit" disabled={disabled || busy || !hoursInput}>
                {t("dev.counters.setTo")}
              </Button>
            </DisabledReason>
          </form>
        </div>
      </div>

      {/* Local trip counter */}
      <div className="rounded-lg border border-dashed p-3">
        <div className="flex items-baseline justify-between gap-2">
          <p className="text-sm font-semibold">{t("dev.counters.trip")}</p>
          <p className="text-lg font-bold tabular-nums">
            {baseline && trip != null ? formatDistance(trip) : "—"}
          </p>
        </div>
        <p className="text-[11px] text-muted-foreground">
          {t("dev.counters.localScope")}
          {baseline ? ` · ${t("dev.since")} ${formatDateTime(baseline.since)}` : ` · ${t("dev.counters.tripNotSet")}`}
        </p>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <DisabledReason disabled={disabled} reason={reason}>
            <Button
              size="sm"
              variant="outline"
              disabled={disabled}
              onClick={() => total != null && setBaseline(resetTripOdometer(tripKey, total))}
            >
              {t("dev.counters.tripReset")}
            </Button>
          </DisabledReason>
          {baseline && (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                clearTripOdometer(tripKey);
                setBaseline(null);
              }}
            >
              {t("dev.counters.tripClear")}
            </Button>
          )}
        </div>
      </div>

      <Dialog open={pending !== null} onOpenChange={(open) => !open && !busy && setPending(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-amber-600 dark:text-amber-400">
              <AlertTriangle className="h-5 w-5 shrink-0" />
              {t(pending?.kind === "hours" ? "dev.counters.confirmHoursTitle" : "dev.counters.confirmOdoTitle")}
            </DialogTitle>
            <DialogDescription>
              {t("dev.counters.confirmBody")
                .replace("{name}", device.name)
                .replace(
                  "{value}",
                  pending?.kind === "hours"
                    ? formatEngineHours(pending.ms)
                    : formatOdometer(pending?.metres ?? 0),
                )}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" size="sm" disabled={busy} onClick={() => setPending(null)}>
              {t("dev.cancel")}
            </Button>
            <Button size="sm" disabled={busy} onClick={confirm}>
              {busy && <Loader2 className="h-4 w-4 animate-spin" />}
              {t("dev.counters.confirm")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/* -------------------------------- Controls -------------------------------- */

function ControlsTab({
  device,
  position,
  health,
}: {
  device: DeviceRecord;
  position: TraccarPosition | null;
  health: DeviceHealth;
}) {
  const { t } = useI18n();
  const [queued, setQueued] = React.useState<QueuedCommand[] | null>(null);
  const [queuedErr, setQueuedErr] = React.useState(false);
  const [tick, setTick] = React.useState(0);

  React.useEffect(() => {
    let alive = true;
    setQueuedErr(false);
    getQueuedCommands(device.id)
      .then((rows) => alive && setQueued(rows))
      .catch(() => {
        if (!alive) return;
        setQueued([]);
        setQueuedErr(true);
      });
    return () => {
      alive = false;
    };
  }, [device.id, tick]);

  const telemetry = React.useMemo(() => readTelemetry(position?.attributes), [position]);

  return (
    <div className="space-y-4">
      {health.neverReported ? (
        <DisabledReason disabled block reason={t("dev.disabledNever")}>
          <div className="w-full rounded-lg border p-3 text-xs text-muted-foreground opacity-70">
            {t("dev.controls.neverBody")}
          </div>
        </DisabledReason>
      ) : (
        <div className="overflow-hidden rounded-lg border [&>div]:border-t-0">
          <DeviceControls
            deviceId={device.id}
            deviceName={device.name}
            telemetry={telemetry}
            deviceAttributes={device.attributes}
          />
        </div>
      )}

      <div>
        <div className="mb-1 flex items-center justify-between">
          <SectionTitle>{t("dev.controls.queued")}</SectionTitle>
          <button
            type="button"
            onClick={() => setTick((n) => n + 1)}
            className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground"
          >
            <RefreshCw className="h-3 w-3" />
            {t("dev.refresh")}
          </button>
        </div>
        <p className="mb-2 text-[11px] text-muted-foreground">{t("dev.controls.queuedNote")}</p>
        {queued === null ? (
          <div className="space-y-2">
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-3/4" />
          </div>
        ) : queuedErr ? (
          <Notice tone="bad">{t("dev.controls.queuedErr")}</Notice>
        ) : queued.length === 0 ? (
          <Notice>{t("dev.controls.queuedNone")}</Notice>
        ) : (
          <ul className="divide-y rounded-lg border">
            {queued.map((c) => (
              <li key={c.id} className="flex items-center justify-between gap-2 px-3 py-2 text-sm">
                <span className="font-mono text-xs">{c.type}</span>
                <span className="truncate text-xs text-muted-foreground">
                  {c.description || (c.attributes?.data ? String(c.attributes.data) : "")}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

/* -------------------------------- Settings -------------------------------- */

/** ISO timestamp → the yyyy-mm-dd a date input wants; "" when unset/invalid. */
function isoToDateInput(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isNaN(+d) ? "" : d.toISOString().slice(0, 10);
}

function SettingsTab({
  device,
  onDeviceUpdated,
}: {
  device: DeviceRecord;
  onDeviceUpdated: (record: DeviceRecord) => void;
}) {
  const { t } = useI18n();
  const [name, setName] = React.useState(device.name ?? "");
  const [model, setModel] = React.useState(device.model ?? "");
  const [phone, setPhone] = React.useState(device.phone ?? "");
  const [contact, setContact] = React.useState(device.contact ?? "");
  const [category, setCategory] = React.useState(device.category ?? "");
  const [disabled, setDisabled] = React.useState(Boolean(device.disabled));
  const [expiration, setExpiration] = React.useState(isoToDateInput(device.expirationTime));
  const [saving, setSaving] = React.useState(false);
  const [msg, setMsg] = React.useState<{ ok: boolean; text: string } | null>(null);

  const knownCategory =
    !category || (DEVICE_CATEGORY_OPTIONS as readonly string[]).includes(category);

  const dirty =
    name !== (device.name ?? "") ||
    model !== (device.model ?? "") ||
    phone !== (device.phone ?? "") ||
    contact !== (device.contact ?? "") ||
    category !== (device.category ?? "") ||
    disabled !== Boolean(device.disabled) ||
    expiration !== isoToDateInput(device.expirationTime);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) {
      setMsg({ ok: false, text: t("dev.settings.nameRequired") });
      return;
    }
    setSaving(true);
    setMsg(null);
    try {
      const saved = await updateDevice({
        ...device,
        name: name.trim(),
        model: model.trim() || undefined,
        phone: phone.trim() || undefined,
        contact: contact.trim() || undefined,
        category: category || undefined,
        disabled,
        expirationTime: expiration ? `${expiration}T00:00:00.000Z` : null,
      });
      onDeviceUpdated(saved);
      setMsg({ ok: true, text: t("dev.settings.saved") });
    } catch (err) {
      setMsg({ ok: false, text: `${t("dev.settings.saveErr")} ${(err as Error).message}` });
    } finally {
      setSaving(false);
    }
  }

  const field = "space-y-1";
  const label = "text-xs font-medium text-muted-foreground";

  return (
    <form onSubmit={save} className="space-y-4">
      {msg && <Notice tone={msg.ok ? "good" : "bad"}>{msg.text}</Notice>}

      <div className="grid gap-3 sm:grid-cols-2">
        <div className={field}>
          <label className={label} htmlFor={`dev-name-${device.id}`}>
            {t("dev.settings.name")}
          </label>
          <Input
            id={`dev-name-${device.id}`}
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="h-9"
            required
          />
        </div>
        <div className={field}>
          <label className={label} htmlFor={`dev-model-${device.id}`}>
            {t("dev.settings.model")}
          </label>
          <Input
            id={`dev-model-${device.id}`}
            value={model}
            onChange={(e) => setModel(e.target.value)}
            placeholder="MV930G"
            className="h-9"
          />
        </div>
        <div className={field}>
          <label className={label} htmlFor={`dev-phone-${device.id}`}>
            {t("dev.settings.phone")}
          </label>
          <div className="flex items-center gap-1.5">
            <Input
              id={`dev-phone-${device.id}`}
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="+964…"
              inputMode="tel"
              dir="ltr"
              className="h-9"
            />
            {device.phone && (
              <a
                href={`tel:${device.phone.replace(/[\s\-().]/g, "")}`}
                className="inline-flex h-9 shrink-0 items-center rounded-md border px-2 text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
              >
                {t("dev.settings.call")}
              </a>
            )}
          </div>
          <p className="text-[11px] text-muted-foreground">{t("dev.settings.phoneHint")}</p>
        </div>
        <div className={field}>
          <label className={label} htmlFor={`dev-contact-${device.id}`}>
            {t("dev.settings.contact")}
          </label>
          <Input
            id={`dev-contact-${device.id}`}
            value={contact}
            onChange={(e) => setContact(e.target.value)}
            className="h-9"
          />
        </div>
        <div className={field}>
          <label className={label} htmlFor={`dev-cat-${device.id}`}>
            {t("dev.settings.category")}
          </label>
          <Select
            id={`dev-cat-${device.id}`}
            value={category}
            onChange={(e) => setCategory(e.target.value)}
          >
            <option value="">{t("dev.settings.catNone")}</option>
            {DEVICE_CATEGORY_OPTIONS.map((c) => (
              <option key={c} value={c}>
                {t(`dev.cat.${c}`)}
              </option>
            ))}
            {!knownCategory && <option value={category}>{category}</option>}
          </Select>
        </div>
        <div className={field}>
          <label className={label} htmlFor={`dev-exp-${device.id}`}>
            {t("dev.settings.expiration")}
          </label>
          <Input
            id={`dev-exp-${device.id}`}
            type="date"
            value={expiration}
            onChange={(e) => setExpiration(e.target.value)}
            className="h-9"
          />
          <p className="text-[11px] text-muted-foreground">{t("dev.settings.expirationHint")}</p>
        </div>
      </div>

      <div className="flex items-center justify-between gap-3 rounded-lg border p-3">
        <div>
          <p className="text-sm font-medium">{t("dev.settings.disabled")}</p>
          <p className="text-[11px] text-muted-foreground">{t("dev.settings.disabledHint")}</p>
        </div>
        <Switch
          checked={disabled}
          onCheckedChange={setDisabled}
          aria-label={t("dev.settings.disabled")}
        />
      </div>

      <div className="flex items-center justify-end gap-2">
        <Button type="submit" size="sm" disabled={saving || !dirty}>
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          {t("dev.settings.save")}
        </Button>
      </div>

      <div>
        <SectionTitle>{t("dev.settings.readonly")}</SectionTitle>
        <Row label={t("dev.settings.id")} value={<span className="font-mono">{device.id}</span>} />
        <Row
          label={t("dev.settings.uniqueId")}
          value={<span className="font-mono" dir="ltr">{device.uniqueId}</span>}
        />
        <Row
          label={t("dev.settings.groupId")}
          value={device.groupId ? <span className="font-mono">{device.groupId}</span> : "—"}
        />
        <Row
          label={t("dev.settings.positionId")}
          value={device.positionId ? <span className="font-mono">{device.positionId}</span> : "—"}
        />
        <Row
          label={t("dev.row.lastUpdate")}
          value={device.lastUpdate ? formatDateTimeLong(device.lastUpdate) : t("dev.status.never")}
        />
      </div>
    </form>
  );
}

/* ---------------------------------- SMS ----------------------------------- */

function SmsTab({ device }: { device: DeviceRecord }) {
  const { t } = useI18n();
  const [copied, copy] = useCopy();
  const phone = device.phone?.trim() || "";

  return (
    <div className="space-y-4">
      <Notice>
        {t("dev.sms.intro")}
        {phone ? (
          <>
            {" "}
            <span className="font-mono" dir="ltr">
              {phone}
            </span>
          </>
        ) : (
          <> {t("dev.sms.noPhone")}</>
        )}
      </Notice>

      {SMS_GROUPS.map((group) => {
        const items = MV930G_SMS_COMMANDS.filter((c) => c.group === group);
        if (items.length === 0) return null;
        return (
          <div key={group}>
            <SectionTitle>{t(`dev.sms.group.${group}`)}</SectionTitle>
            {group === "relay" && (
              <p className="mb-2 text-[11px] text-muted-foreground">{t("dev.sms.relayNote")}</p>
            )}
            <ul className="divide-y rounded-lg border">
              {items.map((c) => {
                const href = smsHref(phone, c.command);
                return (
                  <li key={c.key} className="flex items-start justify-between gap-2 px-3 py-2">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs" dir="ltr">
                          {c.command}
                        </code>
                        {c.dangerous && (
                          <Badge variant="destructive" className="px-1.5 py-0 text-[10px]">
                            {t("dev.sms.danger")}
                          </Badge>
                        )}
                      </div>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {t(`dev.sms.cmd.${c.key}`)}
                      </p>
                      {c.dangerous && (
                        <p className="mt-0.5 text-[11px] text-red-600 dark:text-red-400">
                          {t(`dev.sms.warn.${c.group === "danger" ? c.key : "relay"}`)}
                        </p>
                      )}
                    </div>
                    <div className="flex shrink-0 items-center gap-0.5">
                      <CopyButton
                        text={c.command}
                        copied={copied === c.key}
                        onCopy={(v) => copy(v, c.key)}
                        label={t("dev.copy")}
                      />
                      {href ? (
                        <a
                          href={href}
                          aria-label={t("dev.sms.send")}
                          title={t("dev.sms.send")}
                          className="inline-flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                        >
                          <MessageSquare className="h-3.5 w-3.5" />
                        </a>
                      ) : (
                        <Tooltip content={t("dev.sms.noPhoneShort")}>
                          <span
                            tabIndex={0}
                            className="inline-flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground/40"
                          >
                            <MessageSquare className="h-3.5 w-3.5" />
                          </span>
                        </Tooltip>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>
        );
      })}

      <p className="text-[11px] text-muted-foreground">{t("dev.sms.password")}</p>
    </div>
  );
}

/* --------------------------------- Links ---------------------------------- */

const EVENT_HOURS = 24;

function LinksTab({ deviceId }: { deviceId: number }) {
  const { t } = useI18n();
  const [fences, setFences] = React.useState<TraccarGeofence[] | null>(null);
  const [fencesErr, setFencesErr] = React.useState(false);
  const [events, setEvents] = React.useState<TraccarEventRow[] | null>(null);
  const [eventsErr, setEventsErr] = React.useState(false);

  React.useEffect(() => {
    let alive = true;
    getLinkedGeofences(deviceId)
      .then((rows) => alive && setFences(rows))
      .catch(() => {
        if (!alive) return;
        setFences([]);
        setFencesErr(true);
      });
    getRecentEvents(deviceId, EVENT_HOURS)
      .then((rows) => alive && setEvents(rows.slice(0, 50)))
      .catch(() => {
        if (!alive) return;
        setEvents([]);
        setEventsErr(true);
      });
    return () => {
      alive = false;
    };
  }, [deviceId]);

  const fenceNames = React.useMemo(
    () => new Map((fences ?? []).map((f) => [f.id, f.name] as const)),
    [fences],
  );

  return (
    <div className="space-y-5">
      <div>
        <div className="flex items-center justify-between">
          <SectionTitle>{t("dev.links.geofences")}</SectionTitle>
          <Link
            href="/fleet/geofences"
            className="inline-flex items-center gap-1 text-[11px] font-medium text-primary hover:underline"
          >
            {t("dev.links.openGeofences")}
            <ExternalLink className="h-3 w-3" />
          </Link>
        </div>
        {fences === null ? (
          <div className="space-y-2">
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-2/3" />
          </div>
        ) : fencesErr ? (
          <Notice tone="bad">{t("dev.links.geofencesErr")}</Notice>
        ) : fences.length === 0 ? (
          <Notice>{t("dev.links.noGeofences")}</Notice>
        ) : (
          <ul className="divide-y rounded-lg border">
            {fences.map((f) => {
              const hasRules =
                f.attributes != null && typeof f.attributes === "object" && CARVA_RULES_KEY in f.attributes;
              const category = hasRules ? readRules(f.attributes).category : null;
              return (
                <li key={f.id} className="flex items-center justify-between gap-2 px-3 py-2 text-sm">
                  <span className="truncate font-medium">{f.name}</span>
                  {category && (
                    <Badge variant="muted" className="shrink-0">
                      {t(`geo.cat.${category}`)}
                    </Badge>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <div>
        <div className="flex items-center justify-between">
          <SectionTitle>{t("dev.links.events")}</SectionTitle>
          <Link
            href="/fleet/alerts"
            className="inline-flex items-center gap-1 text-[11px] font-medium text-primary hover:underline"
          >
            {t("dev.links.openAlerts")}
            <ExternalLink className="h-3 w-3" />
          </Link>
        </div>
        {events === null ? (
          <div className="space-y-2">
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-5/6" />
            <Skeleton className="h-8 w-2/3" />
          </div>
        ) : eventsErr ? (
          <Notice tone="bad">{t("dev.links.eventsErr")}</Notice>
        ) : events.length === 0 ? (
          <Notice>{t("dev.links.noEvents")}</Notice>
        ) : (
          <ul className="divide-y rounded-lg border">
            {events.map((e) => {
              const fence = e.geofenceId ? fenceNames.get(e.geofenceId) : undefined;
              return (
                <li key={e.id} className="flex items-center justify-between gap-2 px-3 py-2 text-sm">
                  <span className="min-w-0 truncate">
                    {eventLabel(e, t)}
                    {fence ? <span className="text-muted-foreground"> · {fence}</span> : null}
                  </span>
                  <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                    {formatDateTime(e.eventTime)}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
