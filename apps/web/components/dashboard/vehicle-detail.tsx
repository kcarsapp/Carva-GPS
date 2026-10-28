"use client";

import * as React from "react";
import { Check, Copy, ExternalLink, MapPin, Navigation, Truck, X } from "lucide-react";

import { Card } from "@/components/ui/card";
import {
  SignalWarning,
  VehicleStatusBadge,
} from "@/components/dashboard/status-badge";
import { DeviceControls } from "@/components/dashboard/device-controls";
import { cn } from "@/lib/utils";
import { timeAgo } from "@/lib/status";
import { readTelemetry } from "@/lib/capabilities";
import { useI18n } from "@/lib/i18n-provider";
import { useAddress } from "@/lib/use-address";
import type { Vehicle } from "@/mock/types";

/** 8-point compass label from a heading in degrees. */
function cardinal(deg: number): string {
  const dirs = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
  return dirs[Math.round(((((deg % 360) + 360) % 360) / 45)) % 8];
}

/** Map a jt808-style RSSI (~0–31) to a signal tier key. */
function signalKey(rssi: number): "poor" | "fair" | "good" | "excellent" {
  if (rssi < 8) return "poor";
  if (rssi < 16) return "fair";
  if (rssi < 24) return "good";
  return "excellent";
}

type Tone = "good" | "bad" | undefined;
type Field = { label: string; value: string; tone?: Tone };

export function VehicleDetail({
  vehicle,
  onClose,
  canControl = false,
  compact = false,
  onDirections,
}: {
  vehicle: Vehicle;
  onClose: () => void;
  /** Show live device controls (kill switch, commands). Real logged-in devices only. */
  canControl?: boolean;
  /** Narrow, shorter variant used for the callout pinned to a map marker. */
  compact?: boolean;
  /** Draw directions to this car on the hosting map. Hidden when absent. */
  onDirections?: () => void;
}) {
  const { t } = useI18n();

  // Raw latest-position attributes (already fetched for telemetry).
  const a = (vehicle.attributes ?? {}) as Record<string, unknown>;
  const numA = (k: string) =>
    typeof a[k] === "number" && Number.isFinite(a[k] as number) ? (a[k] as number) : undefined;
  const boolA = (k: string) => (typeof a[k] === "boolean" ? (a[k] as boolean) : undefined);

  const power = numA("power");
  const rssi = numA("rssi") ?? vehicle.gsm;
  const sat = numA("sat") ?? numA("satellites");
  const hoursMs = numA("hours");
  const totalM = numA("totalDistance");
  const blocked = boolA("blocked"); // relay engaged = engine cut
  const motion = boolA("motion");
  const acc = vehicle.ignition;
  const charge = vehicle.charge;

  const onOff = (b: boolean | undefined) => (b == null ? "—" : t(b ? "detail.on" : "detail.off"));

  // A device that has never reported has no position at all: speed, heading and
  // "last fix" are synthesised zeros / `new Date()` upstream, which reads like a
  // healthy parked vehicle. Show "—" instead of inventing a fix.
  const hasFix = vehicle.lat != null && vehicle.lng != null;

  // ---- Status parameters (MiCODUS "Status Parameters") ----
  const statusFields: Field[] = [
    { label: t("detail.ignition"), value: onOff(acc), tone: acc ? "good" : undefined },
    { label: t("detail.relay"), value: onOff(blocked), tone: blocked ? "bad" : undefined },
    { label: t("detail.charging"), value: onOff(charge), tone: charge ? "good" : undefined },
    {
      label: t("detail.power"),
      value: power == null ? "—" : t(power >= 6 ? "detail.connected" : "detail.disconnected"),
      tone: power == null ? undefined : power >= 6 ? "good" : "bad",
    },
    {
      label: t("detail.motion"),
      value: motion == null ? "—" : t(motion ? "detail.moving" : "detail.parked"),
      tone: motion ? "good" : undefined,
    },
    {
      label: t("detail.direction"),
      // A GPS course is only a real direction while moving; a parked tracker
      // reports 0, which would misread as "North".
      value: hasFix
        ? `${cardinal(vehicle.heading)} · ${Math.round(vehicle.heading)}°` +
          (vehicle.headingValid ? "" : ` (${t("detail.lastKnown")})`)
        : "—",
    },
  ];

  // ---- Signal & position ----
  const positionFields: Field[] = [
    { label: t("detail.speed"), value: hasFix ? `${vehicle.speedKmh} km/h` : "—" },
    {
      label: t("detail.signal"),
      value: rssi == null ? "—" : `${t(`detail.sig.${signalKey(rssi)}`)} (${rssi})`,
    },
    { label: t("detail.satellites"), value: sat != null ? String(sat) : "—" },
    {
      label: t("detail.lastFix"),
      // The fix's own time, not `lastUpdated`: a tracker heartbeating with a
      // dead receiver kept `lastUpdated` fresh and made an hours-old position
      // read as "1m ago".
      value: hasFix
        ? timeAgo(vehicle.lastFixAt || vehicle.lastUpdated) || "—"
        : "—",
      tone:
        vehicle.signalIssue === "no_fix" || vehicle.signalIssue === "delayed"
          ? "bad"
          : undefined,
    },
  ];

  // ---- Trip & power ----
  const tripFields: Field[] = [
    {
      label: t("detail.mileage"),
      value:
        totalM != null
          ? `${Math.round(totalM / 1000).toLocaleString()} km`
          : `${vehicle.odometerKm.toLocaleString()} km`,
    },
    {
      label: t("detail.engineHours"),
      value: hoursMs != null ? `${Math.round(hoursMs / 3_600_000).toLocaleString()} h` : "—",
    },
    { label: t("detail.voltage"), value: power != null ? `${power.toFixed(1)} V` : "—" },
    { label: t("detail.battery"), value: vehicle.energyLevel ? `${vehicle.energyLevel}%` : "—" },
  ];

  const telemetry = readTelemetry(vehicle.attributes);
  const obdMetrics = telemetry.obd; // power/voltage now shown explicitly above
  const showControls = canControl && vehicle.deviceId != null;

  // ---- On-demand reverse geocoding ----
  // The fleet poll rebuilds `vehicle` every 5 s, so a moving car's raw lat/lng
  // change on every render. Key the lookup to a ~110 m grid cell instead: the
  // server cache (4 dp) then actually hits, and Nominatim sees one request per
  // block travelled rather than one every poll.
  const { address, loading: geoLoading } = useAddress(vehicle.id, vehicle.lat, vehicle.lng);

  const coords =
    vehicle.lat != null && vehicle.lng != null
      ? `${vehicle.lat.toFixed(5)}, ${vehicle.lng.toFixed(5)}`
      : null;

  const [copied, setCopied] = React.useState(false);
  const copyCoords = () => {
    if (!coords) return;
    navigator.clipboard?.writeText(coords).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };

  return (
    <Card
      className={cn(
        "relative flex flex-col overflow-hidden shadow-xl max-w-[calc(100vw-2rem)]",
        compact ? "max-h-[58vh] w-[272px]" : "max-h-[80vh] w-[330px]",
      )}
    >
      {/* Header */}
      <div className="flex items-center gap-2 border-b p-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <Truck className="h-5 w-5" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold">{vehicle.name}</p>
          <p className="truncate font-mono text-[11px] text-muted-foreground">{vehicle.plate}</p>
        </div>
        <VehicleStatusBadge status={vehicle.status} />
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <SignalWarning vehicle={vehicle} />

        {/* Address */}
        <div className="flex items-start gap-2 border-b p-3">
          <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
          <div className="min-w-0 flex-1">
            <p className="text-sm leading-snug">
              {address ?? (geoLoading ? t("detail.geocoding") : vehicle.location)}
            </p>
            {coords && (
              <button
                type="button"
                onClick={copyCoords}
                className="mt-1 inline-flex items-center gap-1 font-mono text-[11px] text-muted-foreground hover:text-foreground"
                title={coords}
              >
                {copied ? (
                  <Check className="h-3 w-3 text-emerald-500" />
                ) : (
                  <Copy className="h-3 w-3" />
                )}
                {copied ? t("detail.copied") : coords}
              </button>
            )}
            {/* Hands the exact fix to Google Maps for directions / street view —
                what an operator actually wants Google for. */}
            {coords && (
              <a
                href={`https://www.google.com/maps/search/?api=1&query=${vehicle.lat},${vehicle.lng}`}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-1.5 inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              >
                <ExternalLink className="h-3 w-3" />
                {t("detail.openGoogle")}
              </a>
            )}
            {/* Turn-by-turn to the car: on our own map first, or handed to a
                phone navigation app. No origin is passed to the apps, so each
                starts from the phone's own location. */}
            {coords && (
              <div className="mt-1.5 flex flex-wrap items-center gap-1">
                <span className="inline-flex items-center gap-1 text-[11px] font-medium text-muted-foreground">
                  <Navigation className="h-3 w-3" />
                  {t("detail.directions")}
                </span>
                {onDirections && (
                  <button
                    type="button"
                    onClick={onDirections}
                    className="brand-fill press inline-flex items-center rounded-md px-2 py-0.5 text-[11px] font-semibold shadow-[var(--shadow-gold)] hover:brightness-[1.07]"
                  >
                    {t("dir.onMap")}
                  </button>
                )}
                {directionLinks(vehicle.lat!, vehicle.lng!).map((l) => (
                  <a
                    key={l.label}
                    href={l.href}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center rounded-md border px-2 py-0.5 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                  >
                    {l.label}
                  </a>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Status parameters */}
        <Section title={t("detail.sec.status")}>
          <div className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border bg-border">
            {statusFields.map((s) => (
              <div key={s.label} className="bg-card p-2">
                <p className="truncate text-[10px] text-muted-foreground">{s.label}</p>
                <p className={cn("mt-0.5 text-xs font-semibold tabular-nums", toneClass(s.tone))}>
                  {s.value}
                </p>
              </div>
            ))}
          </div>
        </Section>

        {/* Signal & position */}
        <Section title={t("detail.sec.position")}>
          <Rows rows={positionFields} />
        </Section>

        {/* Trip & power */}
        <Section title={t("detail.sec.trip")}>
          <Rows rows={tripFields} />
        </Section>

        {/* OBD telemetry, when the device reports it */}
        {obdMetrics.length > 0 && (
          <Section title={t("detail.telemetry")}>
            <Rows rows={obdMetrics.map((m) => ({ label: m.label, value: m.value }))} />
          </Section>
        )}

        {showControls && (
          <DeviceControls
            deviceId={vehicle.deviceId!}
            deviceName={vehicle.name}
            telemetry={telemetry}
            deviceAttributes={vehicle.deviceAttributes}
          />
        )}
      </div>
    </Card>
  );
}

/** Driving directions to a point in each navigation app (brand names stay untranslated). */
function directionLinks(lat: number, lng: number) {
  const ll = `${lat},${lng}`;
  return [
    {
      label: "Google Maps",
      href: `https://www.google.com/maps/dir/?api=1&destination=${ll}&travelmode=driving`,
    },
    { label: "Waze", href: `https://waze.com/ul?ll=${ll}&navigate=yes` },
    { label: "Apple Maps", href: `https://maps.apple.com/?daddr=${ll}&dirflg=d` },
  ];
}

function toneClass(tone: Tone) {
  return cn(
    tone === "good" && "text-emerald-600 dark:text-emerald-400",
    tone === "bad" && "text-red-500",
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="border-b p-3">
      <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
        {title}
      </p>
      {children}
    </div>
  );
}

function Rows({ rows }: { rows: Field[] }) {
  return (
    <div className="grid grid-cols-2 gap-x-4 gap-y-1.5">
      {rows.map((r) => (
        <div key={r.label} className="flex items-baseline justify-between gap-2">
          <span className="text-[11px] text-muted-foreground">{r.label}</span>
          <span className={cn("text-sm font-semibold tabular-nums", toneClass(r.tone))}>
            {r.value}
          </span>
        </div>
      ))}
    </div>
  );
}
