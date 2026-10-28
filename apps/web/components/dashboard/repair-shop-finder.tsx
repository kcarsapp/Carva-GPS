"use client";

import * as React from "react";
import { CheckCircle2, Loader2, Wrench, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useI18n } from "@/lib/i18n-provider";
import type { TraccarGeofence } from "@/lib/geofence";
import {
  DEFAULT_REPAIR_RADIUS,
  MAX_SHOP_SPAN_DEG,
  REPAIR_RADII,
  coveredBy,
  isValidShopBbox,
  repairGeofenceBody,
  type RepairShop,
  type ShopBbox,
} from "@/lib/repair-shops";
import type { TraccarDevice } from "@carva/shared";

type Phase = "loading" | "list" | "creating" | "done" | "error" | "zoom";

/**
 * "Find repair shops": every garage OpenStreetMap knows in the visible area,
 * ticked by default, turned into Repair shop zones in one click. Each zone is
 * created as the signed-in user through the Traccar proxy and linked to every
 * vehicle — Traccar only raises enter events for linked devices.
 */
export function RepairShopFinder({
  bounds,
  geofences,
  devices,
  onClose,
  onCreated,
}: {
  bounds: ShopBbox | null;
  geofences: TraccarGeofence[];
  devices: TraccarDevice[];
  onClose: () => void;
  /** After at least one zone was created (the page reloads its list). */
  onCreated: () => void;
}) {
  const { t } = useI18n();
  const [phase, setPhase] = React.useState<Phase>("loading");
  const [shops, setShops] = React.useState<RepairShop[]>([]);
  const [selected, setSelected] = React.useState<Set<string>>(new Set());
  const [radius, setRadius] = React.useState<number>(DEFAULT_REPAIR_RADIUS);
  const [progress, setProgress] = React.useState({ done: 0, total: 0 });
  const [error, setError] = React.useState<string | null>(null);

  // Which shops already have a zone — computed against the list as it was
  // when the dialog opened, so creating zones here does not grey rows out.
  const covered = React.useMemo(() => {
    const m = new Map<string, string>();
    for (const s of shops) {
      const g = coveredBy(s, geofences);
      if (g) m.set(s.osmRef, g.name);
    }
    return m;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentionally frozen at open
  }, [shops]);

  React.useEffect(() => {
    if (!bounds || !isValidShopBbox(bounds)) {
      setPhase("zoom");
      return;
    }
    const controller = new AbortController();
    fetch(`/api/repair-shops?bbox=${bounds.map((n) => n.toFixed(5)).join(",")}`, {
      cache: "no-store",
      signal: controller.signal,
    })
      .then(async (r) => {
        const body = (await r.json().catch(() => ({}))) as { shops?: RepairShop[]; error?: string };
        if (!r.ok || !body.shops) throw new Error(body.error ?? String(r.status));
        setShops(body.shops);
        setPhase("list");
      })
      .catch((e: Error) => {
        if (e.name === "AbortError") return;
        setError(`${t("geo.shops.err")} ${e.message}`);
        setPhase("error");
      });
    return () => controller.abort();
  }, [bounds, t]);

  // Tick every shop that is not already covered.
  React.useEffect(() => {
    setSelected(new Set(shops.filter((s) => !covered.has(s.osmRef)).map((s) => s.osmRef)));
  }, [shops, covered]);

  const available = shops.filter((s) => !covered.has(s.osmRef));

  function toggle(ref: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(ref)) next.delete(ref);
      else next.add(ref);
      return next;
    });
  }

  async function create() {
    const chosen = shops.filter((s) => selected.has(s.osmRef));
    setPhase("creating");
    setProgress({ done: 0, total: chosen.length });
    setError(null);
    let done = 0;
    try {
      for (const shop of chosen) {
        const res = await fetch("/api/traccar/geofences", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(repairGeofenceBody(shop, radius, t("geo.shops.unnamed"))),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const saved = (await res.json()) as TraccarGeofence;
        // Watch every car: link the new zone to each vehicle.
        for (const device of devices) {
          await fetch("/api/traccar/permissions", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ deviceId: device.id, geofenceId: saved.id }),
          }).catch(() => null);
        }
        done += 1;
        setProgress({ done, total: chosen.length });
      }
      setPhase("done");
    } catch (e) {
      setError(
        `${t("geo.shops.createErr")
          .replace("{done}", String(done))
          .replace("{n}", String(chosen.length))} ${(e as Error).message}`,
      );
      setPhase("list");
    } finally {
      if (done > 0) onCreated();
    }
  }

  const busy = phase === "creating";

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      role="dialog"
      aria-modal="true"
      aria-label={t("geo.shops.title")}
      onClick={busy ? undefined : onClose}
    >
      <div
        className="flex max-h-[90vh] w-full max-w-lg flex-col rounded-xl border bg-background p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-1 flex items-center justify-between gap-3">
          <h2 className="flex items-center gap-2 text-base font-semibold">
            <Wrench className="h-4 w-4 text-[hsl(var(--gold))]" />
            {t("geo.shops.title")}
          </h2>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="rounded p-1 text-muted-foreground transition-colors hover:text-foreground disabled:opacity-40"
            aria-label={t("geo.close")}
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <p className="mb-3 text-xs text-muted-foreground">{t("geo.shops.body")}</p>

        {phase === "loading" && (
          <p className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            {t("geo.shops.loading")}
          </p>
        )}

        {phase === "zoom" && (
          <p className="rounded-lg border bg-muted/40 px-3 py-4 text-sm">
            {t("geo.shops.zoomIn").replace("{deg}", String(MAX_SHOP_SPAN_DEG))}
          </p>
        )}

        {phase === "done" && (
          <p className="flex items-start gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/[0.06] px-3 py-4 text-sm text-emerald-700 dark:text-emerald-400">
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
            {t("geo.shops.done").replace("{n}", String(progress.done))}
          </p>
        )}

        {(phase === "list" || phase === "creating") && (
          shops.length === 0 ? (
            <p className="rounded-lg border bg-muted/40 px-3 py-4 text-sm text-muted-foreground">
              {t("geo.shops.none")}
            </p>
          ) : (
            <>
              <div className="mb-2 flex items-center justify-between text-xs">
                <span className="text-muted-foreground">
                  {t("geo.shops.found")
                    .replace("{n}", String(shops.length))
                    .replace("{new}", String(available.length))}
                </span>
                <span className="flex gap-3">
                  <button
                    type="button"
                    disabled={busy}
                    className="font-medium text-primary hover:underline"
                    onClick={() => setSelected(new Set(available.map((s) => s.osmRef)))}
                  >
                    {t("geo.shops.all")}
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    className="font-medium text-primary hover:underline"
                    onClick={() => setSelected(new Set())}
                  >
                    {t("geo.shops.noneSel")}
                  </button>
                </span>
              </div>
              <ul className="min-h-0 flex-1 space-y-1 overflow-y-auto rounded-lg border p-1">
                {shops.map((shop) => {
                  const zone = covered.get(shop.osmRef);
                  return (
                    <li key={shop.osmRef}>
                      <label
                        className={cn(
                          "flex items-center gap-3 rounded-lg px-3 py-2 transition-colors",
                          zone ? "opacity-60" : "cursor-pointer hover:bg-accent/60",
                        )}
                      >
                        <input
                          type="checkbox"
                          checked={!zone && selected.has(shop.osmRef)}
                          disabled={!!zone || busy}
                          onChange={() => toggle(shop.osmRef)}
                          className="h-4 w-4 accent-primary"
                        />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-medium" dir="auto">
                            {shop.name || t("geo.shops.unnamed")}
                          </span>
                          <span className="block truncate text-xs text-muted-foreground">
                            {t(`geo.shops.kind.${shop.kind}`)}
                            {zone ? ` · ${t("geo.shops.already")}: ${zone}` : ""}
                          </span>
                        </span>
                      </label>
                    </li>
                  );
                })}
              </ul>

              <div className="mt-3 flex items-center gap-2 text-sm">
                <span className="text-xs font-medium text-muted-foreground">{t("geo.shops.radius")}</span>
                <div className="flex overflow-hidden rounded-lg border">
                  {REPAIR_RADII.map((r) => (
                    <button
                      key={r}
                      type="button"
                      disabled={busy}
                      onClick={() => setRadius(r)}
                      className={cn(
                        "px-3 py-1.5 text-xs font-medium transition-colors",
                        radius === r ? "bg-primary text-primary-foreground" : "hover:bg-accent",
                      )}
                    >
                      {r} m
                    </button>
                  ))}
                </div>
              </div>
              <p className="mt-2 text-xs text-muted-foreground">{t("geo.shops.missing")}</p>
            </>
          )
        )}

        {error && <p className="mt-2 text-sm text-destructive">{error}</p>}

        <div className="mt-4 flex justify-end gap-2">
          <Button variant="outline" size="sm" onClick={onClose} disabled={busy}>
            {phase === "done" ? t("geo.close") : t("geo.cancel")}
          </Button>
          {(phase === "list" || phase === "creating") && shops.length > 0 && (
            <Button size="sm" onClick={create} disabled={busy || selected.size === 0}>
              {busy && <Loader2 className="h-4 w-4 animate-spin" />}
              {busy
                ? t("geo.shops.creating")
                    .replace("{done}", String(progress.done))
                    .replace("{n}", String(progress.total))
                : t("geo.shops.create").replace("{n}", String(selected.size))}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
