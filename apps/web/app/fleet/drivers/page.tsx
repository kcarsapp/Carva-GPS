"use client";

import { Users as PageIcon } from "lucide-react";
import * as React from "react";
import { Loader2, Phone, Plus, Trash2, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/dashboard/page-header";
import { useI18n } from "@/lib/i18n-provider";
import { DriverStatusBadge } from "@/components/dashboard/status-badge";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { useSession } from "@/lib/live-data";
import { drivers as demoDrivers } from "@/mock/drivers";
import { vehicles as demoVehicles } from "@/mock/vehicles";
import type { DriverStatus } from "@/mock/types";

/** Traccar driver record (via /api/traccar/drivers). */
interface TraccarDriver {
  id: number;
  name: string;
  uniqueId: string;
  attributes: Record<string, unknown>;
}

/** Unified row the cards render — live or demo. */
interface DriverRow {
  key: string;
  traccarId?: number;
  name: string;
  avatarInitials: string;
  phone?: string;
  licenseClass?: string;
  status?: DriverStatus;
  safetyScore?: number;
  hoursThisWeek?: number;
  vehicleName?: string;
}

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("");
}

function fromTraccar(d: TraccarDriver): DriverRow {
  const attrs = d.attributes ?? {};
  return {
    key: `t-${d.id}`,
    traccarId: d.id,
    name: d.name,
    avatarInitials: initials(d.name),
    phone: typeof attrs.phone === "string" ? attrs.phone : undefined,
    licenseClass:
      typeof attrs.licenseClass === "string" ? attrs.licenseClass : undefined,
  };
}

function safetyColor(score: number) {
  if (score >= 90) return "text-emerald-600 dark:text-emerald-400";
  if (score >= 80) return "text-amber-600 dark:text-amber-400";
  return "text-red-500";
}

export default function DriversPage() {
  const { t } = useI18n();
  const session = useSession();
  const [live, setLive] = React.useState<DriverRow[] | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = React.useState(false);

  const authed = session.authed;

  const load = React.useCallback(async () => {
    try {
      const res = await fetch("/api/traccar/drivers", { cache: "no-store" });
      if (!res.ok) throw new Error(`drivers request failed (${res.status})`);
      const list = (await res.json()) as TraccarDriver[];

      // Which vehicles is each driver linked to? (device→driver permissions)
      const byDriver = new Map<number, string[]>();
      try {
        const devRes = await fetch("/api/traccar/devices", { cache: "no-store" });
        if (devRes.ok) {
          const devices = (await devRes.json()) as { id: number; name: string }[];
          await Promise.all(
            devices.map(async (dev) => {
              const r = await fetch(`/api/traccar/drivers?deviceId=${dev.id}`, {
                cache: "no-store",
              });
              if (!r.ok) return;
              for (const drv of (await r.json()) as TraccarDriver[]) {
                const arr = byDriver.get(drv.id) ?? [];
                arr.push(dev.name);
                byDriver.set(drv.id, arr);
              }
            }),
          );
        }
      } catch {
        /* vehicle links are cosmetic — the roster still renders */
      }

      setLive(
        list.map((d) => ({
          ...fromTraccar(d),
          vehicleName: byDriver.get(d.id)?.join(", "),
        })),
      );
      setError(null);
    } catch {
      setError("Couldn't load drivers from the GPS server.");
    }
  }, []);

  React.useEffect(() => {
    if (session.loading || !authed) return;
    void load();
  }, [session.loading, authed, load]);

  const demoRows: DriverRow[] = demoDrivers.map((d) => ({
    key: d.id,
    name: d.name,
    avatarInitials: d.avatarInitials,
    phone: d.phone,
    licenseClass: d.licenseClass,
    status: d.status,
    safetyScore: d.safetyScore,
    hoursThisWeek: d.hoursThisWeek,
    vehicleName:
      demoVehicles.find((v) => v.driverId === d.id)?.name ?? "Unassigned",
  }));

  const rows = authed ? live ?? [] : demoRows;
  const loading = session.loading || (authed && live === null && !error);

  async function removeDriver(row: DriverRow) {
    if (row.traccarId == null) return;
    if (!window.confirm(`Remove driver "${row.name}"?`)) return;
    const res = await fetch(`/api/traccar/drivers/${row.traccarId}`, {
      method: "DELETE",
    });
    if (res.ok) void load();
  }

  return (
    <>
      <PageHeader
        eyebrow={t("fleet.nav.group.manage")}
        icon={PageIcon}
        title={t("fleet.nav.drivers")}
        description={t("drivers.desc")}
        action={
          <Button size="sm" onClick={() => setDialogOpen(true)}>
            <Plus className="h-4 w-4" />
            Add driver
          </Button>
        }
      />

      {error && (
        <p className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-600 dark:border-red-900 dark:bg-red-950 dark:text-red-400">
          {error}
        </p>
      )}

      {loading ? (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading drivers…
        </p>
      ) : rows.length === 0 ? (
        <Card>
          <CardContent className="p-8 text-center text-sm text-muted-foreground">
            No drivers yet. Use <span className="font-medium">Add driver</span>{" "}
            to create the first one.
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {rows.map((d) => (
            <Card key={d.key}>
              <CardContent className="p-5">
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-3">
                    <span className="flex h-11 w-11 items-center justify-center rounded-full bg-primary/10 text-sm font-semibold text-primary">
                      {d.avatarInitials}
                    </span>
                    <div>
                      <p className="font-semibold leading-tight">{d.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {d.licenseClass ?? "—"}
                      </p>
                    </div>
                  </div>
                  {d.status ? (
                    <DriverStatusBadge status={d.status} />
                  ) : (
                    d.traccarId != null && (
                      <button
                        type="button"
                        onClick={() => void removeDriver(d)}
                        className="rounded p-1 text-muted-foreground transition-colors hover:text-red-500"
                        aria-label={`Remove ${d.name}`}
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    )
                  )}
                </div>

                {/* Safety score and hours exist only in the demo dataset - Traccar
                    has no driver-behaviour data - so real drivers skip the block
                    rather than showing two permanent dashes. */}
                {(d.safetyScore != null || d.hoursThisWeek != null) && (
                <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
                  <div>
                    <p className="text-xs text-muted-foreground">Safety score</p>
                    <p
                      className={cn(
                        "text-lg font-bold",
                        d.safetyScore != null
                          ? safetyColor(d.safetyScore)
                          : "text-muted-foreground",
                      )}
                    >
                      {d.safetyScore ?? "—"}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Hours / week</p>
                    <p className="text-lg font-bold tabular-nums">
                      {d.hoursThisWeek ?? "—"}
                    </p>
                  </div>
                </div>
                )}

                <div className="mt-4 space-y-1.5 border-t pt-3 text-xs text-muted-foreground">
                  <p>
                    Vehicle:{" "}
                    <span className="font-medium text-foreground">
                      {d.vehicleName ?? "—"}
                    </span>
                  </p>
                  <p className="flex items-center gap-1.5">
                    <Phone className="h-3.5 w-3.5" />
                    {d.phone ?? "—"}
                  </p>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {dialogOpen && (
        <AddDriverDialog
          authed={authed}
          onClose={() => setDialogOpen(false)}
          onAdded={() => {
            setDialogOpen(false);
            void load();
          }}
        />
      )}
    </>
  );
}

function AddDriverDialog({
  authed,
  onClose,
  onAdded,
}: {
  authed: boolean;
  onClose: () => void;
  onAdded: () => void;
}) {
  const [name, setName] = React.useState("");
  const [phone, setPhone] = React.useState("");
  const [licenseClass, setLicenseClass] = React.useState("");
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) {
      setError("Name is required.");
      return;
    }
    if (!authed) {
      setError("Sign in to add drivers — the demo roster is read-only.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      // uniqueId is Traccar's required stable key; derive it from the name.
      const uniqueId = `${name.trim().toLowerCase().replace(/\s+/g, "-")}-${Date.now().toString(36)}`;
      const res = await fetch("/api/traccar/drivers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          uniqueId,
          attributes: {
            ...(phone.trim() ? { phone: phone.trim() } : {}),
            ...(licenseClass.trim() ? { licenseClass: licenseClass.trim() } : {}),
          },
        }),
      });
      if (!res.ok) throw new Error(`save failed (${res.status})`);
      onAdded();
    } catch {
      setError("Couldn't save the driver. Check your connection and try again.");
      setSaving(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Add driver"
      onClick={onClose}
    >
      <div
        className="w-full max-w-sm rounded-xl border bg-background p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-base font-semibold">Add driver</h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1 text-muted-foreground transition-colors hover:text-foreground"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <form onSubmit={submit} className="space-y-3">
          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">
              Full name *
            </label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Ali Hassan"
              autoFocus
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">
              Phone
            </label>
            <Input
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="+964 750 000 0000"
              inputMode="tel"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">
              License class
            </label>
            <Input
              value={licenseClass}
              onChange={(e) => setLicenseClass(e.target.value)}
              placeholder="e.g. Class B"
            />
          </div>

          {error && <p className="text-sm text-red-500">{error}</p>}

          <div className="flex justify-end gap-2 pt-1">
            <Button type="button" variant="outline" size="sm" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" size="sm" disabled={saving}>
              {saving && <Loader2 className="h-4 w-4 animate-spin" />}
              Save driver
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
