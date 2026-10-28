"use client";

import * as React from "react";
import { Loader2, Radio } from "lucide-react";

import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { useI18n } from "@/lib/i18n-provider";
import type { TraccarDevice } from "@carva/shared";

/**
 * Fit several GPS units to one car.
 *
 * A "car" here is a Traccar GROUP and the trackers on it are the devices whose
 * groupId points at it. That keeps the relationship in Traccar itself — it
 * survives restarts, shows up in Traccar's own UI, and needs no extra storage.
 *
 * Traccar's `PUT /devices/{id}` replaces the whole record, so each assignment
 * sends the device back unchanged except for groupId.
 */

interface TraccarGroupRecord {
  id: number;
  name: string;
  groupId?: number;
  attributes?: Record<string, unknown>;
}

export function CarTrackersDialog({
  open,
  onOpenChange,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Re-poll the fleet so the merged car appears at once. */
  onSaved: () => void;
}) {
  const { t } = useI18n();
  const [devices, setDevices] = React.useState<TraccarDevice[] | null>(null);
  const [groups, setGroups] = React.useState<TraccarGroupRecord[]>([]);
  const [carName, setCarName] = React.useState("");
  /** Existing group to add to, or "new" to create one. */
  const [target, setTarget] = React.useState<string>("new");
  const [picked, setPicked] = React.useState<Set<number>>(new Set());
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!open) return;
    let alive = true;
    setError(null);
    setPicked(new Set());
    setCarName("");
    setTarget("new");
    Promise.all([
      fetch("/api/traccar/devices", { cache: "no-store" }).then((r) =>
        r.ok ? r.json() : [],
      ),
      fetch("/api/traccar/groups", { cache: "no-store" }).then((r) =>
        r.ok ? r.json() : [],
      ),
    ])
      .then(([d, g]) => {
        if (!alive) return;
        setDevices(Array.isArray(d) ? (d as TraccarDevice[]) : []);
        setGroups(Array.isArray(g) ? (g as TraccarGroupRecord[]) : []);
      })
      .catch(() => alive && setDevices([]));
    return () => {
      alive = false;
    };
  }, [open]);

  function toggle(id: number) {
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function save() {
    if (picked.size === 0) {
      setError(t("car.pickOne"));
      return;
    }
    const name = carName.trim();
    if (target === "new" && !name) {
      setError(t("car.nameRequired"));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      // 1. The car itself.
      let groupId: number;
      if (target === "new") {
        const res = await fetch("/api/traccar/groups", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name, attributes: {} }),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        groupId = ((await res.json()) as TraccarGroupRecord).id;
      } else {
        groupId = Number(target);
      }

      // 2. Point each chosen tracker at it — full record back, groupId changed.
      const all = devices ?? [];
      for (const id of picked) {
        const record = all.find((d) => d.id === id);
        if (!record) continue;
        const res = await fetch(`/api/traccar/devices/${id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...record, groupId }),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
      }

      onSaved();
      onOpenChange(false);
    } catch (e) {
      setError(`${t("car.saveErr")} ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  /** Detach a tracker from its car; it becomes its own vehicle again. */
  async function detach(device: TraccarDevice) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/traccar/devices/${device.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...device, groupId: 0 }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setDevices((prev) =>
        (prev ?? []).map((d) => (d.id === device.id ? { ...d, groupId: 0 } : d)),
      );
      onSaved();
    } catch (e) {
      setError(`${t("car.saveErr")} ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  const groupName = (id: number) => groups.find((g) => g.id === id)?.name ?? "";
  const loose = (devices ?? []).filter((d) => !d.groupId);
  const attached = (devices ?? []).filter((d) => d.groupId);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg" onClose={() => onOpenChange(false)}>
        <div className="mb-1 flex items-center gap-2">
          <Radio className="h-4 w-4 text-primary" />
          <h2 className="text-base font-semibold">{t("car.title")}</h2>
        </div>
        <p className="mb-4 text-xs text-muted-foreground">{t("car.intro")}</p>

        {devices === null ? (
          <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> {t("car.loading")}
          </div>
        ) : (
          <>
            {/* Which car */}
            <label className="mb-1 block text-xs font-medium text-muted-foreground">
              {t("car.target")}
            </label>
            <select
              value={target}
              onChange={(e) => setTarget(e.target.value)}
              className="mb-3 h-9 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus:border-primary"
            >
              <option value="new">{t("car.newCar")}</option>
              {groups.map((g) => (
                <option key={g.id} value={String(g.id)}>
                  {g.name}
                </option>
              ))}
            </select>

            {target === "new" && (
              <div className="mb-3">
                <label className="mb-1 block text-xs font-medium text-muted-foreground">
                  {t("car.name")}
                </label>
                <Input
                  value={carName}
                  onChange={(e) => setCarName(e.target.value)}
                  placeholder={t("car.namePh")}
                />
              </div>
            )}

            {/* Trackers not yet on a car */}
            <p className="mb-1 text-xs font-medium text-muted-foreground">
              {t("car.pickTrackers")}
            </p>
            {loose.length === 0 ? (
              <p className="mb-3 rounded-lg border bg-muted/30 p-3 text-xs text-muted-foreground">
                {t("car.noneLoose")}
              </p>
            ) : (
              <ul className="mb-3 max-h-48 space-y-1 overflow-y-auto">
                {loose.map((d) => (
                  <li key={d.id}>
                    <label
                      className={cn(
                        "flex cursor-pointer items-center gap-2 rounded-lg border p-2 text-sm transition-colors",
                        picked.has(d.id) ? "border-primary bg-primary/5" : "hover:bg-accent",
                      )}
                    >
                      <input
                        type="checkbox"
                        checked={picked.has(d.id)}
                        onChange={() => toggle(d.id)}
                        className="h-3.5 w-3.5 accent-primary"
                      />
                      <span className="min-w-0 flex-1 truncate">{d.name}</span>
                      <span className="shrink-0 font-mono text-[11px] text-muted-foreground">
                        {d.uniqueId}
                      </span>
                    </label>
                  </li>
                ))}
              </ul>
            )}

            {/* Already grouped */}
            {attached.length > 0 && (
              <>
                <p className="mb-1 text-xs font-medium text-muted-foreground">
                  {t("car.alreadyOn")}
                </p>
                <ul className="mb-3 max-h-40 space-y-1 overflow-y-auto">
                  {attached.map((d) => (
                    <li
                      key={d.id}
                      className="flex items-center gap-2 rounded-lg border p-2 text-sm"
                    >
                      <span className="min-w-0 flex-1 truncate">
                        {d.name}
                        <span className="ms-1 text-[11px] text-muted-foreground">
                          → {groupName(d.groupId as number)}
                        </span>
                      </span>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => detach(d)}
                        className="shrink-0 rounded-md border px-2 py-0.5 text-[11px] font-medium text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-50"
                      >
                        {t("car.detach")}
                      </button>
                    </li>
                  ))}
                </ul>
              </>
            )}

            {error && <p className="mb-2 text-xs text-destructive">{error}</p>}

            <div className="flex justify-end gap-2">
              <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
                {t("ctl.cancel")}
              </Button>
              <Button size="sm" onClick={save} disabled={busy || picked.size === 0}>
                {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                {t("car.save")}
              </Button>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
