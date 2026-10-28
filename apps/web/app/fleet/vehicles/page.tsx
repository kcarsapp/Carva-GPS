"use client";

import * as React from "react";
import { Check, Loader2, Plus, Radio, Truck, Wifi, WifiOff, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { PageHeader } from "@/components/dashboard/page-header";
import { VehicleTable } from "@/components/dashboard/vehicle-table";
import { DevicePanel } from "@/components/dashboard/device-panel";
import { CarTrackersDialog } from "@/components/dashboard/car-trackers-dialog";
import { useLiveFleet } from "@/lib/live-data";
import { useI18n } from "@/lib/i18n-provider";
import {
  deriveHealth,
  getLatestPositions,
  listDevices,
  type DeviceRecord,
} from "@/lib/devices-api";
import type { TraccarPosition } from "@carva/shared";
import {
  DEVICE_CATEGORIES,
  TRACKER_PRESETS,
  normalizeUniqueId,
  presetFor,
  uniqueIdIssue,
} from "@/lib/devices";
import { drivers } from "@/mock/drivers";

/** Traccar driver record (via the proxy). */
interface TraccarDriver {
  id: number;
  name: string;
  uniqueId: string;
  attributes: Record<string, unknown>;
}

export default function VehiclesPage() {
  const { vehicles, authed } = useLiveFleet();
  const { t } = useI18n();
  const [dialogOpen, setDialogOpen] = React.useState(false);
  const [trackersOpen, setTrackersOpen] = React.useState(false);
  const [allDrivers, setAllDrivers] = React.useState<TraccarDriver[]>([]);
  // vehicleId -> drivers currently linked to that device in Traccar.
  const [assignments, setAssignments] = React.useState<
    Record<string, TraccarDriver[]>
  >({});
  const [assignFor, setAssignFor] = React.useState<string | null>(null);

  // The full device panel (readings, counters, controls, settings, SMS, links)
  // for whichever row is selected. Backed by the raw Traccar device record +
  // latest position, refreshed every 15 s while a panel is open.
  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  const [records, setRecords] = React.useState<DeviceRecord[]>([]);
  const [positions, setPositions] = React.useState<Map<number, TraccarPosition>>(
    () => new Map(),
  );

  const loadDevices = React.useCallback(async () => {
    const [devs, pos] = await Promise.all([listDevices(), getLatestPositions()]);
    setRecords(devs);
    setPositions(pos);
  }, []);

  React.useEffect(() => {
    if (!authed) return;
    void loadDevices();
    if (!selectedId) return;
    const timer = setInterval(() => void loadDevices(), 15_000);
    return () => clearInterval(timer);
  }, [authed, selectedId, loadDevices]);

  const selectedRecord =
    selectedId != null ? records.find((d) => String(d.id) === selectedId) ?? null : null;
  const selectedPosition = selectedRecord ? positions.get(selectedRecord.id) ?? null : null;

  // uniqueIds already registered — used for duplicate detection in the dialog.
  const existingIds = React.useMemo(
    () => new Set(vehicles.map((v) => v.plate.toLowerCase())),
    [vehicles],
  );

  const loadAssignments = React.useCallback(async () => {
    try {
      const dRes = await fetch("/api/traccar/drivers", { cache: "no-store" });
      if (!dRes.ok) return;
      setAllDrivers((await dRes.json()) as TraccarDriver[]);

      const devRes = await fetch("/api/traccar/devices", { cache: "no-store" });
      if (!devRes.ok) return;
      const devices = (await devRes.json()) as { id: number }[];
      const entries = await Promise.all(
        devices.map(async (d) => {
          const r = await fetch(`/api/traccar/drivers?deviceId=${d.id}`, {
            cache: "no-store",
          });
          const list = r.ok ? ((await r.json()) as TraccarDriver[]) : [];
          return [String(d.id), list] as const;
        }),
      );
      setAssignments(Object.fromEntries(entries));
    } catch {
      /* assignments are cosmetic — the table still renders without them */
    }
  }, []);

  React.useEffect(() => {
    if (authed) void loadAssignments();
  }, [authed, loadAssignments]);

  const assignedNames = React.useMemo(() => {
    if (!authed) return undefined;
    const map: Record<string, string[]> = {};
    for (const [vid, list] of Object.entries(assignments)) {
      map[vid] = list.map((d) => d.name);
    }
    return map;
  }, [authed, assignments]);

  const assignVehicle = vehicles.find((v) => v.id === assignFor);

  return (
    <>
      <PageHeader
        eyebrow={t("fleet.nav.group.monitor")}
        icon={Truck}
        title={t("fleet.nav.vehicles")}
        description={t("vehpage.desc")}
        action={
          <>
            <Badge variant={authed ? "success" : "muted"}>
              {authed ? (
                <>
                  <Wifi className="h-3.5 w-3.5" /> {t("dash.live")}
                </>
              ) : (
                <>
                  <WifiOff className="h-3.5 w-3.5" /> {t("fleet.badge.demo")}
                </>
              )}
            </Badge>
            {/* Account actions; the logged-out demo shows the fleet only. */}
            {authed && (
              <>
                <Button size="sm" variant="outline" onClick={() => setTrackersOpen(true)}>
                  <Radio className="h-4 w-4" />
                  {t("vehpage.multi")}
                </Button>
                <Button size="sm" onClick={() => setDialogOpen(true)}>
                  <Plus className="h-4 w-4" />
                  {t("vehpage.add")}
                </Button>
              </>
            )}
          </>
        }
      />
      <VehicleTable
        vehicles={vehicles}
        drivers={drivers}
        selectedId={selectedId}
        onSelect={authed ? (id) => setSelectedId((cur) => (cur === id ? null : id)) : undefined}
        assignedDrivers={assignedNames}
        onAssignDrivers={authed ? (id) => setAssignFor(id) : undefined}
      />

      {/* Everything about the selected tracker, in a portal dialog above the table. */}
      <Dialog
        open={selectedRecord != null}
        onOpenChange={(open) => !open && setSelectedId(null)}
      >
        <DialogContent className="max-w-3xl p-0">
          {selectedRecord && (
            <DevicePanel
              device={selectedRecord}
              position={selectedPosition}
              health={deriveHealth(selectedRecord, selectedPosition)}
              onDeviceUpdated={(rec) =>
                setRecords((all) => all.map((d) => (d.id === rec.id ? rec : d)))
              }
              onRefresh={loadDevices}
              onClose={() => setSelectedId(null)}
            />
          )}
        </DialogContent>
      </Dialog>

      <CarTrackersDialog
        open={trackersOpen}
        onOpenChange={setTrackersOpen}
        onSaved={() => void loadDevices()}
      />

      {dialogOpen && (
        <AddVehicleDialog
          authed={authed}
          existingIds={existingIds}
          onClose={() => setDialogOpen(false)}
        />
      )}

      {assignVehicle && (
        <AssignDriversDialog
          vehicleId={assignVehicle.id}
          vehicleName={assignVehicle.name}
          allDrivers={allDrivers}
          assigned={assignments[assignVehicle.id] ?? []}
          onClose={() => setAssignFor(null)}
          onSaved={() => {
            setAssignFor(null);
            void loadAssignments();
          }}
        />
      )}
    </>
  );
}

function AssignDriversDialog({
  vehicleId,
  vehicleName,
  allDrivers,
  assigned,
  onClose,
  onSaved,
}: {
  vehicleId: string;
  vehicleName: string;
  allDrivers: TraccarDriver[];
  assigned: TraccarDriver[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [checked, setChecked] = React.useState<Set<number>>(
    () => new Set(assigned.map((d) => d.id)),
  );
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  function toggle(id: number) {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function save() {
    setSaving(true);
    setError(null);
    const before = new Set(assigned.map((d) => d.id));
    const toAdd = [...checked].filter((id) => !before.has(id));
    const toRemove = [...before].filter((id) => !checked.has(id));
    try {
      for (const driverId of toAdd) {
        const r = await fetch("/api/traccar/permissions", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ deviceId: Number(vehicleId), driverId }),
        });
        if (!r.ok) throw new Error(`link failed (${r.status})`);
      }
      for (const driverId of toRemove) {
        const r = await fetch("/api/traccar/permissions", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ deviceId: Number(vehicleId), driverId }),
        });
        if (!r.ok) throw new Error(`unlink failed (${r.status})`);
      }
      onSaved();
    } catch {
      setError("Couldn't update driver assignments. Try again.");
      setSaving(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      role="dialog"
      aria-modal="true"
      aria-label={`Assign drivers to ${vehicleName}`}
      onClick={onClose}
    >
      <div
        className="w-full max-w-sm rounded-xl border bg-background p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-1 flex items-center justify-between">
          <h2 className="text-base font-semibold">Assign drivers</h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1 text-muted-foreground transition-colors hover:text-foreground"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <p className="mb-3 text-xs text-muted-foreground">
          {vehicleName} — pick any number of drivers.
        </p>

        {allDrivers.length === 0 ? (
          <p className="rounded-lg border bg-muted/40 px-3 py-4 text-center text-sm text-muted-foreground">
            No drivers yet — add one on the Drivers page first.
          </p>
        ) : (
          <div className="max-h-64 space-y-1 overflow-y-auto">
            {allDrivers.map((d) => (
              <label
                key={d.id}
                className="flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2 transition-colors hover:bg-accent/60"
              >
                <input
                  type="checkbox"
                  checked={checked.has(d.id)}
                  onChange={() => toggle(d.id)}
                  className="h-4 w-4 accent-primary"
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">
                    {d.name}
                  </span>
                  {typeof d.attributes?.phone === "string" && (
                    <span className="block truncate text-xs text-muted-foreground">
                      {d.attributes.phone}
                    </span>
                  )}
                </span>
              </label>
            ))}
          </div>
        )}

        {error && <p className="mt-2 text-sm text-red-500">{error}</p>}

        <div className="mt-4 flex justify-end gap-2">
          <Button type="button" variant="outline" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button size="sm" onClick={save} disabled={saving}>
            {saving && <Loader2 className="h-4 w-4 animate-spin" />}
            Save
          </Button>
        </div>
      </div>
    </div>
  );
}

const ID_ISSUE_TEXT: Record<string, string> = {
  "admin.id.err.format": "The ID must be 6–25 letters or digits.",
  "admin.id.err.luhn":
    "That looks like a mistyped IMEI — one digit is off (checksum fails).",
  "admin.id.err.dup": "A device with this ID is already registered.",
  "admin.id.warn.notImei":
    "Not a 15-digit IMEI — that's fine for models that report a different ID.",
};

function AddVehicleDialog({
  authed,
  existingIds,
  onClose,
}: {
  authed: boolean;
  existingIds: Set<string>;
  onClose: () => void;
}) {
  const [name, setName] = React.useState("");
  const [uniqueId, setUniqueId] = React.useState("");
  const [model, setModel] = React.useState("");
  const [phone, setPhone] = React.useState("");
  const [category, setCategory] = React.useState("car");
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [created, setCreated] = React.useState(false);
  const [trackerHost, setTrackerHost] = React.useState("");

  // The host trackers should report to (for the SMS hint after saving).
  React.useEffect(() => {
    fetch("/api/config", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((c: { trackerHost?: string } | null) => {
        if (c?.trackerHost) setTrackerHost(c.trackerHost);
      })
      .catch(() => {});
  }, []);

  const idIssue = uniqueId.trim()
    ? uniqueIdIssue(uniqueId, existingIds)
    : null;
  const preset = presetFor(model);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || !uniqueId.trim()) {
      setError("Name and IMEI / device ID are both required.");
      return;
    }
    if (idIssue?.level === "error") {
      setError(ID_ISSUE_TEXT[idIssue.key]);
      return;
    }
    if (!authed) {
      setError("Sign in to add vehicles — the demo fleet is read-only.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/traccar/devices", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          uniqueId: normalizeUniqueId(uniqueId),
          category,
          ...(phone.trim() ? { phone: phone.trim() } : {}),
          ...(model.trim() ? { model: model.trim() } : {}),
        }),
      });
      if (res.status === 400) {
        throw new Error("Traccar rejected it — is this ID already registered?");
      }
      if (!res.ok) throw new Error(`save failed (${res.status})`);
      setCreated(true);
    } catch (err) {
      setError(
        err instanceof Error && err.message.startsWith("Traccar")
          ? err.message
          : "Couldn't save the vehicle. Check your connection and try again.",
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Add vehicle"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-xl border bg-background p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-base font-semibold">Add vehicle</h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1 text-muted-foreground transition-colors hover:text-foreground"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {created ? (
          <div className="space-y-4">
            <p className="flex items-center gap-2 text-sm font-medium text-emerald-600 dark:text-emerald-400">
              <Check className="h-4 w-4" /> {name.trim()} is registered.
            </p>
            <div className="rounded-lg border bg-muted/40 p-3 text-xs leading-relaxed text-muted-foreground">
              <p className="mb-1 font-semibold text-foreground">
                Now point the tracker at this server:
              </p>
              {preset ? (
                <>
                  <p>
                    {preset.model} reports on port{" "}
                    <span className="font-mono font-semibold text-foreground">
                      {preset.port}
                    </span>{" "}
                    ({preset.protocol}). Typical SMS setup:
                  </p>
                  <p className="mt-1.5 rounded bg-background px-2 py-1.5 font-mono text-foreground">
                    adminip123456 {trackerHost || "<server>"} {preset.port}
                  </p>
                </>
              ) : (
                <p>
                  Server address:{" "}
                  <span className="font-mono font-semibold text-foreground">
                    {trackerHost || "your server"}
                  </span>
                  , on the port for the tracker's protocol. Check the model's
                  manual for its SMS command.
                </p>
              )}
              <p className="mt-2">
                If it stays offline after connecting, the device may report an
                ID slightly different from the sticker (e.g. extra leading
                zeros) — edit the identifier to match.
              </p>
            </div>
            <div className="flex justify-end">
              <Button size="sm" onClick={onClose}>
                Done
              </Button>
            </div>
          </div>
        ) : (
          <form onSubmit={submit} className="space-y-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-muted-foreground">
                Vehicle name *
              </label>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Truck 014"
                autoFocus
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-muted-foreground">
                IMEI / device ID *
              </label>
              <Input
                value={uniqueId}
                onChange={(e) => setUniqueId(e.target.value)}
                placeholder="15-digit IMEI from the tracker's sticker"
                inputMode="numeric"
              />
              {idIssue && (
                <p
                  className={
                    idIssue.level === "error"
                      ? "mt-1 text-xs text-red-500"
                      : "mt-1 text-xs text-amber-600 dark:text-amber-400"
                  }
                >
                  {ID_ISSUE_TEXT[idIssue.key]}
                </p>
              )}
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1 block text-xs font-medium text-muted-foreground">
                  Tracker model
                </label>
                <select
                  value={model}
                  onChange={(e) => setModel(e.target.value)}
                  className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus:border-primary"
                >
                  <option value="">Other / not sure</option>
                  {TRACKER_PRESETS.map((p) => (
                    <option key={p.model} value={p.model}>
                      {p.model}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-muted-foreground">
                  Category
                </label>
                <select
                  value={category}
                  onChange={(e) => setCategory(e.target.value)}
                  className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus:border-primary"
                >
                  {DEVICE_CATEGORIES.map((c) => (
                    <option key={c} value={c}>
                      {c.charAt(0).toUpperCase() + c.slice(1)}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-muted-foreground">
                Tracker SIM phone (optional)
              </label>
              <Input
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="+964 750 000 0000"
                inputMode="tel"
              />
            </div>

            {preset && (
              <p className="rounded-lg border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
                {preset.model} reports on port{" "}
                <span className="font-mono font-medium text-foreground">
                  {preset.port}
                </span>{" "}
                ({preset.protocol}) — you'll get the SMS setup line after
                saving.
              </p>
            )}

            {error && <p className="text-sm text-red-500">{error}</p>}

            <div className="flex justify-end gap-2 pt-1">
              <Button type="button" variant="outline" size="sm" onClick={onClose}>
                Cancel
              </Button>
              <Button type="submit" size="sm" disabled={saving}>
                {saving && <Loader2 className="h-4 w-4 animate-spin" />}
                Save vehicle
              </Button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
