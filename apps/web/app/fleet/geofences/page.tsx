"use client";

import { Hexagon as PageIcon } from "lucide-react";
import * as React from "react";
import Link from "next/link";
import {
  Ban,
  Bell,
  Check,
  ChevronDown,
  Fuel,
  Hexagon,
  Loader2,
  Map as MapIcon,
  Pencil,
  Plus,
  SlidersHorizontal,
  Trash2,
  TriangleAlert,
  Truck,
  Undo2,
  User,
  Warehouse,
  Wrench,
  X,
} from "lucide-react";

import { PageHeader } from "@/components/dashboard/page-header";
import {
  GeofenceEditor,
  type DrawMode,
} from "@/components/dashboard/geofence-editor";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useSession } from "@/lib/live-data";
import { useI18n } from "@/lib/i18n-provider";
import { cn } from "@/lib/utils";
import {
  DEFAULT_RADIUS_M,
  MAX_RADIUS_M,
  MIN_RADIUS_M,
  clampRadius,
  isDrawable,
  parseArea,
  toWkt,
  type GeofenceShape,
  type GeofenceZone,
  type TraccarGeofence,
} from "@/lib/geofence";
import {
  CATEGORY_META,
  CUT_LABEL_KEY,
  CUT_MODES,
  GEOFENCE_CATEGORIES,
  PHASE_LABEL_KEY,
  actionFor,
  defaultRules,
  defaultRulesFor,
  describeAction,
  presetRules,
  primaryPhase,
  readRules,
  writeRules,
  type CutMode,
  type FenceScope,
  type GeofenceCategory,
  type GeofenceRules,
  type RuleAction,
  type RulePhase,
} from "@/lib/geofence-rules";
import type { TraccarDevice } from "@carva/shared";

const CATEGORY_ICON: Record<GeofenceCategory, React.ComponentType<{ className?: string }>> = {
  zone: Hexagon,
  repair: Wrench,
  region: MapIcon,
  customer: User,
  base: Warehouse,
  restricted: Ban,
};

/** Upper end of the radius slider — the numeric field still accepts more. */
const RADIUS_SLIDER_MAX = 10000;

/** The form behind the map: `id` is null while drawing a brand-new zone. */
interface DraftForm {
  id: number | null;
  name: string;
  description: string;
  /** What this zone should DO on entry/exit (stored in the fence's attributes). */
  rules: GeofenceRules;
}

export default function GeofencesPage() {
  const { t } = useI18n();
  const session = useSession();

  const [geofences, setGeofences] = React.useState<TraccarGeofence[]>([]);
  const [devices, setDevices] = React.useState<TraccarDevice[]>([]);
  // geofenceId -> deviceIds currently linked to it in Traccar.
  const [links, setLinks] = React.useState<Record<number, number[]>>({});
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  const [selectedId, setSelectedId] = React.useState<number | null>(null);
  const [form, setForm] = React.useState<DraftForm | null>(null);
  const [mode, setMode] = React.useState<DrawMode>("none");
  const [draft, setDraft] = React.useState<GeofenceShape | null>(null);
  const [pendingRadius, setPendingRadius] = React.useState(DEFAULT_RADIUS_M);
  const [radiusText, setRadiusText] = React.useState(String(DEFAULT_RADIUS_M));
  const [saving, setSaving] = React.useState(false);
  const [formError, setFormError] = React.useState<string | null>(null);

  const [deleteTarget, setDeleteTarget] = React.useState<TraccarGeofence | null>(
    null,
  );
  const [linkTarget, setLinkTarget] = React.useState<TraccarGeofence | null>(
    null,
  );
  /** The "what kind of zone?" chooser shown before drawing a new one. */
  const [picking, setPicking] = React.useState(false);

  /* ------------------------------ Loading ------------------------------- */

  const loadGeofences = React.useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/traccar/geofences", { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setGeofences((await res.json()) as TraccarGeofence[]);
      setError(null);
    } catch (e) {
      setError(`${t("geo.loadErr")} ${(e as Error).message}`);
    } finally {
      setLoading(false);
    }
  }, [t]);

  /**
   * Traccar has no "which devices use this geofence" endpoint, so ask per
   * device (GET /geofences?deviceId=…) and invert the answer.
   */
  const loadLinks = React.useCallback(async () => {
    try {
      const res = await fetch("/api/traccar/devices", { cache: "no-store" });
      if (!res.ok) return;
      const list = (await res.json()) as TraccarDevice[];
      setDevices(list);

      const byGeofence: Record<number, number[]> = {};
      await Promise.all(
        list.map(async (device) => {
          const r = await fetch(`/api/traccar/geofences?deviceId=${device.id}`, {
            cache: "no-store",
          });
          if (!r.ok) return;
          for (const g of (await r.json()) as TraccarGeofence[]) {
            const existing = byGeofence[g.id];
            if (existing) existing.push(device.id);
            else byGeofence[g.id] = [device.id];
          }
        }),
      );
      setLinks(byGeofence);
    } catch {
      /* links are supplementary — the list still renders without them */
    }
  }, []);

  React.useEffect(() => {
    if (!session.authed) return;
    void loadGeofences();
    void loadLinks();
  }, [session.authed, loadGeofences, loadLinks]);

  /* ------------------------------- Derived ------------------------------ */

  const parsed = React.useMemo(
    () => geofences.map((g) => ({ geofence: g, shape: parseArea(g.area) })),
    [geofences],
  );

  const zones = React.useMemo<GeofenceZone[]>(() => {
    const out: GeofenceZone[] = [];
    for (const { geofence, shape } of parsed) {
      if (shape) {
        out.push({
          id: geofence.id,
          name: geofence.name,
          shape,
          color: CATEGORY_META[readRules(geofence.attributes).category].hex,
        });
      }
    }
    return out;
  }, [parsed]);

  const counts = React.useMemo(() => {
    const c: Partial<Record<GeofenceCategory, number>> = {};
    for (const g of geofences) {
      const cat = readRules(g.attributes).category;
      c[cat] = (c[cat] ?? 0) + 1;
    }
    return c;
  }, [geofences]);

  const deviceName = React.useCallback(
    (id: number) => devices.find((d) => d.id === id)?.name ?? `#${id}`,
    [devices],
  );

  const radius = draft?.kind === "circle" ? draft.radius : pendingRadius;

  // Keep the numeric field in step with the slider and the map's radius handle.
  React.useEffect(() => {
    setRadiusText(String(radius));
  }, [radius]);

  /* ------------------------------ Drawing ------------------------------- */

  const applyRadius = React.useCallback(
    (metres: number) => {
      const next = clampRadius(metres);
      setPendingRadius(next);
      setDraft((prev) =>
        prev?.kind === "circle" ? { ...prev, radius: next } : prev,
      );
    },
    [],
  );

  function startNew(rules: GeofenceRules = defaultRules()) {
    setPicking(false);
    setForm({ id: null, name: "", description: "", rules });
    setFormError(null);
    setDraft(null);
    setMode("circle");
    setPendingRadius(DEFAULT_RADIUS_M);
    setSelectedId(null);
  }

  function startEdit(geofence: TraccarGeofence, shape: GeofenceShape) {
    setForm({
      id: geofence.id,
      name: geofence.name,
      description: geofence.description ?? "",
      // Rules ride along inside the fence's own attributes.
      rules: readRules(geofence.attributes),
    });
    setFormError(null);
    setDraft(shape);
    setMode("none");
    if (shape.kind === "circle") setPendingRadius(shape.radius);
    setSelectedId(geofence.id);
  }

  function closeForm() {
    setForm(null);
    setDraft(null);
    setMode("none");
    setFormError(null);
  }

  /** Switch tool — a different geometry means starting the shape over. */
  function switchMode(next: Exclude<DrawMode, "none">) {
    setMode(next);
    setDraft((prev) => (prev?.kind === next ? prev : null));
  }

  function undoVertex() {
    setDraft((prev) =>
      prev?.kind === "polygon" ? { ...prev, ring: prev.ring.slice(0, -1) } : prev,
    );
  }

  /* ------------------------------- Saving ------------------------------- */

  async function save() {
    if (!form) return;
    const name = form.name.trim();
    if (!name) {
      setFormError(t("geo.nameRequired"));
      return;
    }
    if (!draft) {
      setFormError(t("geo.needShape"));
      return;
    }
    if (!isDrawable(draft)) {
      setFormError(t("geo.needPolygon"));
      return;
    }

    setSaving(true);
    setFormError(null);
    try {
      const area = toWkt(draft);
      const existing =
        form.id != null ? geofences.find((g) => g.id === form.id) : undefined;

      const res = await fetch(
        form.id != null
          ? `/api/traccar/geofences/${form.id}`
          : "/api/traccar/geofences",
        {
          method: form.id != null ? "PUT" : "POST",
          headers: { "Content-Type": "application/json" },
          // Traccar's PUT replaces the whole record — keep the fields we don't edit.
          body: JSON.stringify({
            ...(existing ?? {}),
            name,
            description: form.description.trim(),
            area,
            attributes: writeRules(existing?.attributes, form.rules),
          }),
        },
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      // The save already succeeded — don't fail on an unexpected empty body.
      const saved = (await res
        .json()
        .catch(() => null)) as TraccarGeofence | null;
      const savedId = saved?.id ?? form.id;
      if (form.rules.scope === "all" && savedId != null) {
        const already = new Set(links[savedId] ?? []);
        for (const device of devices) {
          if (already.has(device.id)) continue;
          await fetch("/api/traccar/permissions", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ deviceId: device.id, geofenceId: savedId }),
          }).catch(() => null);
        }
        void loadLinks();
      }
      closeForm();
      setSelectedId(saved?.id ?? form.id);
      await loadGeofences();
    } catch (e) {
      setFormError(`${t("geo.saveErr")} ${(e as Error).message}`);
    } finally {
      setSaving(false);
    }
  }

  async function remove(geofence: TraccarGeofence) {
    setDeleteTarget(null);
    try {
      const res = await fetch(`/api/traccar/geofences/${geofence.id}`, {
        method: "DELETE",
      });
      // Traccar answers 204 No Content on success.
      if (!res.ok && res.status !== 204) throw new Error(`HTTP ${res.status}`);
      if (selectedId === geofence.id) setSelectedId(null);
      if (form?.id === geofence.id) closeForm();
      await loadGeofences();
      await loadLinks();
    } catch (e) {
      setError(`${t("geo.deleteErr")} ${(e as Error).message}`);
    }
  }

  /* ------------------------------- Render ------------------------------- */

  if (!session.loading && !session.authed) {
    return (
      <>
        <PageHeader
        eyebrow={t("fleet.nav.group.map")}
        icon={PageIcon} title={t("geo.title")} description={t("geo.desc")} />
        <Card>
          <CardContent className="p-8 text-center text-sm text-muted-foreground">
            {t("geo.signin")}{" "}
            <Link
              href="/login"
              className="font-medium text-primary hover:underline"
            >
              {t("nav.signin")}
            </Link>
          </CardContent>
        </Card>
      </>
    );
  }

  const polygonPoints = draft?.kind === "polygon" ? draft.ring.length : 0;

  return (
    <>
      <PageHeader
        eyebrow={t("fleet.nav.group.map")}
        icon={PageIcon}
        title={t("geo.title")}
        description={t("geo.desc")}
        action={
          <Button size="sm" onClick={() => setPicking(true)} disabled={form !== null}>
            <Plus className="h-4 w-4" />
            {t("geo.new")}
          </Button>
        }
      />

      {error && (
        <div className="mb-4 rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-2 text-sm text-destructive">
          {error}
        </div>
      )}

      {geofences.length > 0 && !form && (
        <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {(["repair", "region"] as GeofenceCategory[]).map((cat) => {
            const meta = CATEGORY_META[cat];
            const Icon = CATEGORY_ICON[cat];
            return (
              <div key={cat} className="surface flex items-center gap-3 rounded-2xl border p-3">
                <span
                  className="grid h-9 w-9 place-items-center rounded-xl text-white"
                  style={{ background: meta.hex }}
                >
                  <Icon className="h-4 w-4" />
                </span>
                <div>
                  <p className="num text-lg font-semibold leading-none">{counts[cat] ?? 0}</p>
                  <p className="mt-1 text-xs text-muted-foreground">{t(meta.labelKey)}</p>
                </div>
              </div>
            );
          })}
          <div className="surface flex items-center gap-3 rounded-2xl border p-3">
            <span className="grid h-9 w-9 place-items-center rounded-xl bg-muted text-muted-foreground">
              <Hexagon className="h-4 w-4" />
            </span>
            <div>
              <p className="num text-lg font-semibold leading-none">
                {geofences.length - (counts.repair ?? 0) - (counts.region ?? 0)}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">{t("geo.stat.other")}</p>
            </div>
          </div>
          <div className="surface flex items-center gap-3 rounded-2xl border p-3">
            <span className="grid h-9 w-9 place-items-center rounded-xl bg-muted text-muted-foreground">
              <Truck className="h-4 w-4" />
            </span>
            <div>
              <p className="num text-lg font-semibold leading-none">{devices.length}</p>
              <p className="mt-1 text-xs text-muted-foreground">{t("geo.stat.watched")}</p>
            </div>
          </div>
        </div>
      )}

      {form && (
        <Card className="mb-4">
          <CardContent className="space-y-3 p-4">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold">
                {form.id != null ? t("geo.editTitle") : t("geo.newTitle")}
              </h2>
              <button
                type="button"
                onClick={closeForm}
                className="rounded p-1 text-muted-foreground transition-colors hover:text-foreground"
                aria-label={t("geo.cancel")}
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className="mb-1 block text-xs font-medium text-muted-foreground">
                  {t("geo.name")}
                </label>
                <Input
                  value={form.name}
                  onChange={(e) =>
                    setForm({ ...form, name: e.target.value })
                  }
                  placeholder={t("geo.namePh")}
                  autoFocus
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-muted-foreground">
                  {t("geo.description")}
                </label>
                <Input
                  value={form.description}
                  onChange={(e) =>
                    setForm({ ...form, description: e.target.value })
                  }
                  placeholder={t("geo.descPh")}
                />
              </div>
            </div>

            <ZoneBehaviour
              rules={form.rules}
              vehicles={devices.length}
              onChange={(rules) => setForm({ ...form, rules })}
            />

            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs font-medium text-muted-foreground">
                {t("geo.shape")}
              </span>
              {(
                [
                  ["circle", t("geo.circle")],
                  ["polygon", t("geo.polygon")],
                ] as [Exclude<DrawMode, "none">, string][]
              ).map(([value, label]) => (
                <Button
                  key={value}
                  size="sm"
                  variant={
                    mode === value || (mode === "none" && draft?.kind === value)
                      ? "default"
                      : "outline"
                  }
                  onClick={() => switchMode(value)}
                >
                  {label}
                </Button>
              ))}
            </div>

            {(mode === "circle" || draft?.kind === "circle") && (
              <div className="flex flex-wrap items-center gap-3">
                <span className="text-xs font-medium text-muted-foreground">
                  {t("geo.radius")}
                </span>
                <input
                  type="range"
                  min={MIN_RADIUS_M}
                  // A pre-existing zone can be wider than the slider's range —
                  // stretch it rather than silently shrinking the zone.
                  max={Math.max(RADIUS_SLIDER_MAX, radius)}
                  step={10}
                  value={radius}
                  onChange={(e) => applyRadius(Number(e.target.value))}
                  aria-label={t("geo.radius")}
                  className="h-2 min-w-[160px] flex-1 cursor-pointer accent-primary"
                />
                <div className="flex items-center gap-1.5">
                  <Input
                    type="number"
                    inputMode="numeric"
                    min={MIN_RADIUS_M}
                    max={MAX_RADIUS_M}
                    value={radiusText}
                    onChange={(e) => {
                      setRadiusText(e.target.value);
                      const n = Number(e.target.value);
                      if (n >= MIN_RADIUS_M && n <= MAX_RADIUS_M) applyRadius(n);
                    }}
                    onBlur={() => applyRadius(Number(radiusText))}
                    className="h-9 w-24 tabular-nums"
                  />
                  <span className="text-xs text-muted-foreground">
                    {t("geo.metres")}
                  </span>
                </div>
              </div>
            )}

            {(mode === "polygon" || draft?.kind === "polygon") && (
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs tabular-nums text-muted-foreground">
                  {t("geo.vertices").replace("{n}", String(polygonPoints))}
                </span>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={undoVertex}
                  disabled={polygonPoints === 0}
                >
                  <Undo2 className="h-4 w-4" />
                  {t("geo.undo")}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setMode("none")}
                  disabled={mode !== "polygon" || polygonPoints < 3}
                >
                  <Check className="h-4 w-4" />
                  {t("geo.finish")}
                </Button>
              </div>
            )}

            <p className="text-xs text-muted-foreground">
              {mode === "circle"
                ? t("geo.hint.circle")
                : mode === "polygon"
                  ? t("geo.hint.polygon")
                  : t("geo.hint.done")}
            </p>

            {formError && <p className="text-sm text-destructive">{formError}</p>}

            <div className="flex justify-end gap-2">
              <Button variant="outline" size="sm" onClick={closeForm}>
                {t("geo.cancel")}
              </Button>
              <Button size="sm" onClick={save} disabled={saving}>
                {saving && <Loader2 className="h-4 w-4 animate-spin" />}
                {saving ? t("geo.saving") : t("geo.save")}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      <GeofenceEditor
        zones={zones}
        selectedId={selectedId}
        onSelect={setSelectedId}
        mode={mode}
        draft={draft}
        onDraftChange={setDraft}
        onFinishPolygon={() => setMode("none")}
        defaultRadius={pendingRadius}
        className="mb-4 h-[420px] sm:h-[480px]"
      />

      {loading && (
        <p className="mb-3 text-sm text-muted-foreground">{t("geo.loading")}</p>
      )}

      {!loading && geofences.length === 0 ? (
        <Card>
          <CardContent className="p-8 text-center">
            <p className="text-sm font-semibold">{t("geo.empty.title")}</p>
            <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
              {t("geo.empty.body")}
            </p>
            {!form && (
              <Button size="sm" className="mt-4" onClick={() => setPicking(true)}>
                <Plus className="h-4 w-4" />
                {t("geo.empty.cta")}
              </Button>
            )}
          </CardContent>
        </Card>
      ) : (
        geofences.length > 0 && (
          <Card>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("geo.col.name")}</TableHead>
                  <TableHead className="hidden md:table-cell">
                    {t("geo.col.type")}
                  </TableHead>
                  <TableHead className="hidden lg:table-cell">
                    {t("geo.col.rules")}
                  </TableHead>
                  <TableHead className="hidden xl:table-cell">
                    {t("geo.col.size")}
                  </TableHead>
                  <TableHead>{t("geo.col.vehicles")}</TableHead>
                  <TableHead className="text-end">
                    {t("geo.col.actions")}
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {parsed.map(({ geofence, shape }) => {
                  const linked = links[geofence.id] ?? [];
                  const rules = readRules(geofence.attributes);
                  const meta = CATEGORY_META[rules.category];
                  const Icon = CATEGORY_ICON[rules.category];
                  return (
                    <TableRow
                      key={geofence.id}
                      onClick={() => setSelectedId(geofence.id)}
                      className={cn(
                        "cursor-pointer",
                        selectedId === geofence.id && "bg-muted/60",
                      )}
                    >
                      <TableCell>
                        <div className="flex items-center gap-3">
                          <span
                            className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-white"
                            style={{ background: meta.hex }}
                          >
                            <Icon className="h-4 w-4" />
                          </span>
                          <div className="min-w-0">
                            <span className="block font-medium">{geofence.name}</span>
                            {geofence.description && (
                              <span className="block max-w-[240px] truncate text-xs text-muted-foreground">
                                {geofence.description}
                              </span>
                            )}
                          </div>
                        </div>
                      </TableCell>
                      <TableCell className="hidden md:table-cell">
                        <span
                          className={cn(
                            "inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 text-xs font-medium",
                            meta.accent.soft,
                            meta.accent.text,
                          )}
                        >
                          {t(meta.labelKey)}
                        </span>
                      </TableCell>
                      <TableCell className="hidden lg:table-cell">
                        <RuleSummary rules={rules} />
                      </TableCell>
                      <TableCell className="hidden tabular-nums text-muted-foreground xl:table-cell">
                        {shape
                          ? shape.kind === "circle"
                            ? `${Math.round(shape.radius)} ${t("geo.metres")}`
                            : t("geo.vertices").replace(
                                "{n}",
                                String(shape.ring.length),
                              )
                          : "—"}
                      </TableCell>
                      <TableCell>
                        {rules.scope === "all" ? (
                          <Badge variant="secondary" className="gap-1">
                            <Truck className="h-3 w-3" />
                            {t("geo.scope.all")}
                          </Badge>
                        ) : linked.length === 0 ? (
                          <span className="text-xs text-muted-foreground">
                            {t("geo.none")}
                          </span>
                        ) : (
                          <div className="flex flex-wrap items-center gap-1">
                            {linked.slice(0, 3).map((id) => (
                              <Badge key={id} variant="secondary">
                                {deviceName(id)}
                              </Badge>
                            ))}
                            {linked.length > 3 && (
                              <span className="text-xs tabular-nums text-muted-foreground">
                                +{linked.length - 3}
                              </span>
                            )}
                          </div>
                        )}
                      </TableCell>
                      <TableCell onClick={(e) => e.stopPropagation()}>
                        <div className="flex items-center justify-end gap-1">
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => setLinkTarget(geofence)}
                            title={t("geo.link")}
                          >
                            <Truck className="h-4 w-4" />
                            <span className="hidden lg:inline">
                              {t("geo.link")}
                            </span>
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            disabled={!shape}
                            onClick={() => shape && startEdit(geofence, shape)}
                            title={t("geo.edit")}
                          >
                            <Pencil className="h-4 w-4" />
                            <span className="hidden lg:inline">
                              {t("geo.edit")}
                            </span>
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => setDeleteTarget(geofence)}
                            title={t("geo.delete")}
                            className="text-destructive hover:text-destructive"
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </Card>
        )
      )}

      {picking && (
        <ZoneTypePicker onPick={startNew} onClose={() => setPicking(false)} />
      )}

      {deleteTarget && (
        <ConfirmDeleteDialog
          geofence={deleteTarget}
          onCancel={() => setDeleteTarget(null)}
          onConfirm={() => void remove(deleteTarget)}
        />
      )}

      {linkTarget && (
        <LinkVehiclesDialog
          geofence={linkTarget}
          devices={devices}
          linked={links[linkTarget.id] ?? []}
          onClose={() => setLinkTarget(null)}
          onSaved={() => {
            setLinkTarget(null);
            void loadLinks();
          }}
        />
      )}
    </>
  );
}

/* ------------------------------- Dialogs -------------------------------- */

/** "Enters: Alert" / "Leaves: Alert + cut fuel safely" - one line per phase. */
function RuleSummary({ rules }: { rules: GeofenceRules }) {
  const { t } = useI18n();
  const phases: RulePhase[] = ["enter", "exit"];
  return (
    <div className="space-y-0.5 text-xs">
      {phases.map((phase) => {
        const action = actionFor(rules, phase);
        const silent = !action.notify && action.cut === "none";
        return (
          <p key={phase} className={cn(silent && "text-muted-foreground/60")}>
            <span className="text-muted-foreground">
              {t(phase === "enter" ? "geo.when.enter" : "geo.when.exit")}:
            </span>{" "}
            <span className={cn(action.cut !== "none" && "font-medium text-amber-600 dark:text-amber-400")}>
              {describeAction(action, t)}
            </span>
          </p>
        );
      })}
    </div>
  );
}

/**
 * Before drawing: what is this zone FOR? The two zones a rental fleet actually
 * needs come ready-made; anything else starts from a blank zone.
 */
function ZoneTypePicker({
  onPick,
  onClose,
}: {
  onPick: (rules: GeofenceRules) => void;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const options: {
    key: string;
    category: GeofenceCategory;
    title: string;
    body: string;
    rules: () => GeofenceRules;
  }[] = [
    {
      key: "repair",
      category: "repair",
      title: t("geo.cat.repair"),
      body: t("geo.pick.repair.body"),
      rules: () => presetRules("repair"),
    },
    {
      key: "region",
      category: "region",
      title: t("geo.cat.region"),
      body: t("geo.pick.region.body"),
      rules: () => presetRules("region"),
    },
    {
      key: "custom",
      category: "zone",
      title: t("geo.pick.custom"),
      body: t("geo.pick.custom.body"),
      rules: () => defaultRules(),
    },
  ];
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      role="dialog"
      aria-modal="true"
      aria-label={t("geo.pick.title")}
      onClick={onClose}
    >
      <div
        className="rise w-full max-w-lg rounded-2xl border bg-background p-5 shadow-[var(--shadow-raised)]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-base font-semibold">{t("geo.pick.title")}</h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1 text-muted-foreground transition-colors hover:text-foreground"
            aria-label={t("geo.close")}
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="space-y-2">
          {options.map((o) => {
            const meta = CATEGORY_META[o.category];
            const Icon = CATEGORY_ICON[o.category];
            return (
              <button
                key={o.key}
                type="button"
                onClick={() => onPick(o.rules())}
                className="lift flex w-full items-start gap-3 rounded-xl border bg-card p-3.5 text-start transition-colors hover:border-primary/50"
              >
                <span
                  className="grid h-10 w-10 shrink-0 place-items-center rounded-xl text-white"
                  style={{ background: o.key === "custom" ? "#64748b" : meta.hex }}
                >
                  <Icon className="h-5 w-5" />
                </span>
                <span className="min-w-0">
                  <span className="block text-sm font-semibold">{o.title}</span>
                  <span className="mt-0.5 block text-xs text-muted-foreground">{o.body}</span>
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/**
 * What a zone DOES, in plain words: its type, which cars it watches, and its
 * main rule (enter for a repair shop, leave for an allowed area) as two simple
 * switches. The full per-phase rules sit under "Advanced".
 */
function ZoneBehaviour({
  rules,
  vehicles,
  onChange,
}: {
  rules: GeofenceRules;
  vehicles: number;
  onChange: (rules: GeofenceRules) => void;
}) {
  const { t } = useI18n();
  const phase = primaryPhase(rules.category);
  const key = phase === "enter" ? "onEnter" : "onExit";
  const main = actionFor(rules, phase);

  function setMain(patch: Partial<RuleAction>) {
    onChange({ ...rules, [key]: { ...rules[key], ...patch } });
  }

  function pickCategory(category: GeofenceCategory) {
    const next =
      category === "repair" || category === "region"
        ? presetRules(category)
        : defaultRulesFor(category);
    // Changing the type must not quietly change which cars it watches.
    onChange({ ...next, scope: rules.scope });
  }

  const scopes: { value: FenceScope; label: string; hint: string }[] = [
    { value: "all", label: t("geo.scope.all"), hint: t("geo.scope.allHint") },
    { value: "selected", label: t("geo.scope.selected"), hint: t("geo.scope.selectedHint") },
  ];

  return (
    <div className="space-y-3 rounded-xl border bg-muted/30 p-3">
      {/* Type */}
      <div>
        <p className="eyebrow mb-2">{t("geo.col.type")}</p>
        <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
          {GEOFENCE_CATEGORIES.map((category) => {
            const meta = CATEGORY_META[category];
            const Icon = CATEGORY_ICON[category];
            const active = rules.category === category;
            return (
              <button
                key={category}
                type="button"
                onClick={() => pickCategory(category)}
                title={t(meta.descKey)}
                aria-pressed={active}
                className={cn(
                  "flex items-center gap-2 rounded-lg border px-2.5 py-2 text-start text-xs font-medium transition-colors",
                  active
                    ? "border-primary bg-primary/10 text-foreground"
                    : "bg-background text-muted-foreground hover:bg-accent hover:text-foreground",
                )}
              >
                <span
                  className="grid h-6 w-6 shrink-0 place-items-center rounded-md text-white"
                  style={{ background: meta.hex }}
                >
                  <Icon className="h-3.5 w-3.5" />
                </span>
                <span className="truncate">{t(meta.labelKey)}</span>
              </button>
            );
          })}
        </div>
        <p className="mt-1.5 text-[11px] text-muted-foreground">
          {t(CATEGORY_META[rules.category].descKey)}
        </p>
      </div>

      {/* Which cars */}
      <div>
        <p className="eyebrow mb-2">{t("geo.scope")}</p>
        <div className="grid gap-1.5 sm:grid-cols-2">
          {scopes.map((s) => (
            <button
              key={s.value}
              type="button"
              onClick={() => onChange({ ...rules, scope: s.value })}
              aria-pressed={rules.scope === s.value}
              className={cn(
                "rounded-lg border px-3 py-2 text-start transition-colors",
                rules.scope === s.value
                  ? "border-primary bg-primary/10"
                  : "bg-background hover:bg-accent",
              )}
            >
              <span className="flex items-center gap-1.5 text-xs font-semibold">
                {s.value === "all" && <Truck className="h-3.5 w-3.5" />}
                {s.label}
                {s.value === "all" && (
                  <span className="num font-normal text-muted-foreground">({vehicles})</span>
                )}
              </span>
              <span className="mt-0.5 block text-[11px] text-muted-foreground">{s.hint}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Main rule as two switches */}
      <div className="rounded-lg border bg-card p-3">
        <p className="mb-2 text-xs font-semibold">
          {t(phase === "enter" ? "geo.main.enter" : "geo.main.exit")}
        </p>
        <label className="flex cursor-pointer items-center justify-between gap-3 py-1">
          <span className="flex items-center gap-2 text-sm">
            <Bell className="h-4 w-4 text-primary" />
            {t("geo.main.notify")}
          </span>
          <Switch checked={main.notify} onChange={(v) => setMain({ notify: v })} />
        </label>
        <label className="flex cursor-pointer items-center justify-between gap-3 py-1">
          <span className="flex items-center gap-2 text-sm">
            <Fuel className="h-4 w-4 text-amber-500" />
            {t("geo.main.cut")}
          </span>
          <Switch
            checked={main.cut !== "none"}
            onChange={(v) => setMain({ cut: v ? "safe" : "none" })}
          />
        </label>
        {main.cut !== "none" && (
          <p className="mt-1.5 flex items-start gap-1.5 rounded-md bg-amber-500/10 px-2 py-1.5 text-[11px] text-amber-700 dark:text-amber-300">
            <TriangleAlert className="mt-px h-3.5 w-3.5 shrink-0" />
            {t("geo.main.cutHint")}
          </p>
        )}
      </div>

      <details className="group rounded-lg border bg-card">
        <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2 text-xs font-medium text-muted-foreground">
          <SlidersHorizontal className="h-3.5 w-3.5" />
          {t("geo.advanced")}
          <ChevronDown className="ms-auto h-3.5 w-3.5 transition-transform group-open:rotate-180" />
        </summary>
        <div className="border-t p-3">
          <PhaseRules rules={rules} onChange={onChange} />
        </div>
      </details>
    </div>
  );
}

function Switch({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={cn(
        "relative h-6 w-10 shrink-0 rounded-full transition-colors",
        checked ? "bg-primary" : "bg-muted-foreground/30",
      )}
    >
      <span
        className={cn(
          "absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-[inset-inline-start]",
          checked ? "start-[1.125rem]" : "start-0.5",
        )}
      />
    </button>
  );
}

/**
 * Every action for both halves of a crossing. The cut options are deliberately
 * understated: cutting fuel is never a default, and "immediate" carries an
 * explicit warning because the automation downgrades it to a safe cut
 * whenever the vehicle is actually moving.
 */
function PhaseRules({
  rules,
  onChange,
}: {
  rules: GeofenceRules;
  onChange: (rules: GeofenceRules) => void;
}) {
  const { t } = useI18n();

  function setPhase(phase: RulePhase, patch: Partial<RuleAction>) {
    const key = phase === "enter" ? "onEnter" : "onExit";
    onChange({ ...rules, [key]: { ...rules[key], ...patch } });
  }

  const phases: RulePhase[] = ["enter", "exit"];

  return (
    <div>
      <div className="grid gap-3 sm:grid-cols-2">
        {phases.map((phase) => {
          const action = actionFor(rules, phase);
          return (
            <div key={phase} className="rounded-lg border bg-background p-2.5">
              <p className="mb-2 text-xs font-semibold">{t(PHASE_LABEL_KEY[phase])}</p>

              <label className="flex cursor-pointer items-center gap-2 text-xs">
                <input
                  type="checkbox"
                  checked={action.notify}
                  onChange={(e) => setPhase(phase, { notify: e.target.checked })}
                  className="h-3.5 w-3.5 accent-primary"
                />
                {t("geo.rule.notify")}
              </label>

              <div className="mt-2">
                <label className="mb-1 block text-[11px] text-muted-foreground">
                  {t("geo.rule.cut")}
                </label>
                <Select
                  value={action.cut}
                  onChange={(e) =>
                    setPhase(phase, { cut: e.target.value as CutMode })
                  }
                >
                  {CUT_MODES.map((cut) => (
                    <option key={cut} value={cut}>
                      {t(CUT_LABEL_KEY[cut])}
                    </option>
                  ))}
                </Select>
              </div>

              {action.cut === "now" && (
                <p className="mt-1.5 flex items-start gap-1 text-[11px] text-amber-600 dark:text-amber-400">
                  <TriangleAlert className="mt-px h-3 w-3 shrink-0" />
                  {t("geo.rule.cutNowWarn")}
                </p>
              )}
              {action.cut === "safe" && (
                <p className="mt-1.5 text-[11px] text-muted-foreground">
                  {t("geo.rule.cutSafeHint")}
                </p>
              )}
            </div>
          );
        })}
      </div>

      <p className="mt-2 text-[11px] text-muted-foreground">
        {t("geo.rule.engineHint")}
      </p>
    </div>
  );
}

function ConfirmDeleteDialog({
  geofence,
  onCancel,
  onConfirm,
}: {
  geofence: TraccarGeofence;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const { t } = useI18n();
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      role="dialog"
      aria-modal="true"
      aria-label={t("geo.confirmDelete")}
      onClick={onCancel}
    >
      <div
        className="w-full max-w-sm rounded-xl border bg-background p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-base font-semibold">{t("geo.confirmDelete")}</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          {t("geo.confirmDeleteBody").replace("{name}", geofence.name)}
        </p>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="outline" size="sm" onClick={onCancel}>
            {t("geo.cancel")}
          </Button>
          <Button variant="destructive" size="sm" onClick={onConfirm}>
            <Trash2 className="h-4 w-4" />
            {t("geo.delete")}
          </Button>
        </div>
      </div>
    </div>
  );
}

/**
 * Link/unlink vehicles. Traccar only fires enter/exit events for devices that
 * hold a permission on the geofence, so this is what makes alerts work.
 */
function LinkVehiclesDialog({
  geofence,
  devices,
  linked,
  onClose,
  onSaved,
}: {
  geofence: TraccarGeofence;
  devices: TraccarDevice[];
  linked: number[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const { t } = useI18n();
  const [checked, setChecked] = React.useState<Set<number>>(
    () => new Set(linked),
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
    const before = new Set(linked);
    const toAdd = [...checked].filter((id) => !before.has(id));
    const toRemove = [...before].filter((id) => !checked.has(id));
    try {
      for (const deviceId of toAdd) {
        const r = await fetch("/api/traccar/permissions", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ deviceId, geofenceId: geofence.id }),
        });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
      }
      for (const deviceId of toRemove) {
        const r = await fetch("/api/traccar/permissions", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ deviceId, geofenceId: geofence.id }),
        });
        if (!r.ok && r.status !== 204) throw new Error(`HTTP ${r.status}`);
      }
      onSaved();
    } catch (e) {
      setError(`${t("geo.linkErr")} ${(e as Error).message}`);
      setSaving(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      role="dialog"
      aria-modal="true"
      aria-label={t("geo.linkTitle")}
      onClick={onClose}
    >
      <div
        className="w-full max-w-sm rounded-xl border bg-background p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-1 flex items-center justify-between">
          <h2 className="text-base font-semibold">{t("geo.linkTitle")}</h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1 text-muted-foreground transition-colors hover:text-foreground"
            aria-label={t("geo.close")}
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <p className="mb-3 text-xs text-muted-foreground">
          {geofence.name} — {t("geo.linkBody")}
        </p>

        {devices.length === 0 ? (
          <p className="rounded-lg border bg-muted/40 px-3 py-4 text-center text-sm text-muted-foreground">
            {t("geo.noDevices")}
          </p>
        ) : (
          <div className="max-h-64 space-y-1 overflow-y-auto">
            {devices.map((device) => (
              <label
                key={device.id}
                className="flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2 transition-colors hover:bg-accent/60"
              >
                <input
                  type="checkbox"
                  checked={checked.has(device.id)}
                  onChange={() => toggle(device.id)}
                  className="h-4 w-4 accent-primary"
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">
                    {device.name}
                  </span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {device.uniqueId}
                  </span>
                </span>
              </label>
            ))}
          </div>
        )}

        {error && <p className="mt-2 text-sm text-destructive">{error}</p>}

        <div className="mt-4 flex justify-end gap-2">
          <Button variant="outline" size="sm" onClick={onClose}>
            {t("geo.cancel")}
          </Button>
          <Button size="sm" onClick={save} disabled={saving}>
            {saving && <Loader2 className="h-4 w-4 animate-spin" />}
            {t("geo.save")}
          </Button>
        </div>
      </div>
    </div>
  );
}
