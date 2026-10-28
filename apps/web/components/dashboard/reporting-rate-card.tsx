"use client";

import * as React from "react";
import { Gauge, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useI18n } from "@/lib/i18n-provider";
import { cn } from "@/lib/utils";
import type { TraccarCommandType, TraccarDevice } from "@carva/shared";

/**
 * How often a tracker reports decides its mobile-data bill. Traccar's
 * `positionPeriodic` carries a `frequency` in seconds, which the jt808 encoder
 * turns into a terminal-parameter frame. Fast while following a car, slow the
 * rest of the time - a fleet on a small data bundle lives or dies on this.
 */
const REPORT_INTERVALS = [10, 30, 60, 300, 600] as const;

// Bytes on the wire per report incl. IP/TCP overhead and the server ack. Measured
// on this fleet: ~3,771 reports/day = 12-36 MB/month, so 200 B is the middle of
// the observed range and deliberately not precise.
const BYTES_PER_REPORT = 200;
const ALL = "all";

function monthlyData(seconds: number): string {
  const mb = (((30 * 86_400) / seconds) * BYTES_PER_REPORT) / 1_000_000;
  return mb >= 10 ? `${Math.round(mb)} MB` : `${mb.toFixed(1)} MB`;
}

function intervalLabel(seconds: number): string {
  return seconds < 60 ? `${seconds}s` : `${seconds / 60}m`;
}

type Result = { ok: boolean; text: string } | null;

export function ReportingRateCard() {
  const { t } = useI18n();
  const [devices, setDevices] = React.useState<TraccarDevice[]>([]);
  const [target, setTarget] = React.useState<string>(ALL);
  const [busy, setBusy] = React.useState<number | null>(null);
  const [result, setResult] = React.useState<Result>(null);

  React.useEffect(() => {
    let alive = true;
    fetch("/api/traccar/devices", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : []))
      .then((d: TraccarDevice[]) => alive && setDevices(Array.isArray(d) ? d : []))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  async function apply(secs: number) {
    const targets = target === ALL ? devices : devices.filter((d) => String(d.id) === target);
    if (targets.length === 0) return;
    setBusy(secs);
    setResult(null);
    let sent = 0;
    let unsupported = 0;
    let failed = 0;
    // One tracker at a time: each is a separate command over Traccar.
    for (const d of targets) {
      try {
        const tr = await fetch(`/api/traccar/commands/types?deviceId=${d.id}`, { cache: "no-store" });
        const types = tr.ok ? ((await tr.json()) as TraccarCommandType[]) : [];
        if (!types.some((c) => c.type === "positionPeriodic")) {
          unsupported++;
          continue;
        }
        const res = await fetch("/api/traccar/commands/send", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ deviceId: d.id, type: "positionPeriodic", attributes: { frequency: secs } }),
        });
        if (res.ok) sent++;
        else failed++;
      } catch {
        failed++;
      }
    }
    const parts = [
      t("ctl.rateDone").replace("{n}", String(sent)).replace("{m}", String(targets.length)),
    ];
    if (unsupported) parts.push(t("ctl.rateSkipped").replace("{k}", String(unsupported)));
    setResult({ ok: failed === 0 && sent > 0, text: parts.join(" · ") });
    setBusy(null);
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Gauge className="h-4 w-4 text-primary" /> {t("ctl.rate")}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <label className="block space-y-1.5 text-xs font-medium text-muted-foreground">
          {t("ctl.rateVehicle")}
          <select
            value={target}
            onChange={(e) => {
              setTarget(e.target.value);
              setResult(null);
            }}
            className="flex h-10 w-full rounded-xl border bg-background px-3 text-sm text-foreground"
          >
            <option value={ALL}>{t("ctl.rateAll")}</option>
            {devices.map((d) => (
              <option key={d.id} value={String(d.id)}>
                {d.name}
              </option>
            ))}
          </select>
        </label>

        <div className="flex flex-wrap gap-2">
          {REPORT_INTERVALS.map((secs) => (
            <Button
              key={secs}
              type="button"
              size="sm"
              variant="outline"
              disabled={busy !== null || devices.length === 0}
              onClick={() => apply(secs)}
              title={t("ctl.rateEst").replace("{data}", monthlyData(secs))}
              className="gap-1.5"
            >
              {busy === secs && <Loader2 className="h-3 w-3 animate-spin" />}
              <span className="tabular-nums">{intervalLabel(secs)}</span>
              <span className="text-[10px] opacity-70 tabular-nums">{monthlyData(secs)}</span>
            </Button>
          ))}
        </div>

        {result && (
          <p
            role="status"
            className={cn(
              "text-xs font-medium",
              result.ok ? "text-emerald-600 dark:text-emerald-400" : "text-red-500",
            )}
          >
            {result.text}
          </p>
        )}
        <p className="text-xs text-muted-foreground">{t("ctl.rateHint")}</p>
      </CardContent>
    </Card>
  );
}
