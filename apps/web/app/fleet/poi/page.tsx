"use client";

import { MapPin as PageIcon } from "lucide-react";
import * as React from "react";
import Link from "next/link";
import {
  AlertTriangle,
  Building2,
  Fuel,
  Loader2,
  MapPin,
  ParkingCircle,
  Pencil,
  Plus,
  Search,
  Trash2,
  User,
  Wrench,
  type LucideIcon,
} from "lucide-react";

import { PageHeader } from "@/components/dashboard/page-header";
import { PoiMap } from "@/components/dashboard/poi-map";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useSession } from "@/lib/live-data";
import { useI18n } from "@/lib/i18n-provider";
import { cn } from "@/lib/utils";
import {
  createPoi,
  formatLatLng,
  isPoiCategory,
  loadPois,
  poiCategoryKey,
  poiColor,
  POI_CATEGORIES,
  savePois,
  searchPois,
  type Poi,
  type PoiCategory,
} from "@/lib/pois";

const CATEGORY_ICONS: Record<PoiCategory, LucideIcon> = {
  office: Building2,
  customer: User,
  fuel: Fuel,
  service: Wrench,
  parking: ParkingCircle,
  other: MapPin,
};

/** Stored categories are free-form strings; anything unknown reads as "other". */
function asCategory(value: string): PoiCategory {
  return isPoiCategory(value) ? value : "other";
}

/** The pin being added or edited. `id` is set only when editing. */
interface PoiDraft {
  id?: string;
  name: string;
  category: PoiCategory;
  notes: string;
  lat: number;
  lng: number;
}

const TEXTAREA_CLASS =
  "flex w-full rounded-lg border border-input bg-background px-3 py-2 text-sm shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

/* -------------------------------- Form ---------------------------------- */

function PoiForm({
  draft,
  saving,
  error,
  onChange,
  onSubmit,
  onCancel,
}: {
  draft: PoiDraft;
  saving: boolean;
  error: string | null;
  onChange: (patch: Partial<PoiDraft>) => void;
  onSubmit: () => void;
  onCancel: () => void;
}) {
  const { t } = useI18n();

  return (
    <Card>
      <CardContent className="p-4">
        <p className="mb-3 text-sm font-semibold">
          {draft.id ? t("poi.editTitle") : t("poi.newTitle")}
        </p>

        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            onSubmit();
          }}
        >
          <label className="block space-y-1.5">
            <span className="text-xs font-medium text-muted-foreground">
              {t("poi.name")}
            </span>
            <Input
              autoFocus
              value={draft.name}
              onChange={(e) => onChange({ name: e.target.value })}
              placeholder={t("poi.namePlaceholder")}
              className="h-9"
            />
          </label>

          <div className="space-y-1.5">
            <span className="text-xs font-medium text-muted-foreground">
              {t("poi.category")}
            </span>
            <div className="grid grid-cols-3 gap-1.5">
              {POI_CATEGORIES.map((c) => {
                const Icon = CATEGORY_ICONS[c];
                const active = draft.category === c;
                return (
                  <button
                    key={c}
                    type="button"
                    onClick={() => onChange({ category: c })}
                    className={cn(
                      "flex flex-col items-center gap-1 rounded-lg border px-1 py-2 text-[11px] font-medium transition-colors",
                      active
                        ? "border-transparent text-white"
                        : "border-input bg-background text-muted-foreground hover:bg-accent hover:text-foreground",
                    )}
                    style={active ? { background: poiColor(c) } : undefined}
                  >
                    <Icon className="h-4 w-4" />
                    <span className="truncate">{t(poiCategoryKey(c))}</span>
                  </button>
                );
              })}
            </div>
          </div>

          <label className="block space-y-1.5">
            <span className="text-xs font-medium text-muted-foreground">
              {t("poi.notes")}
            </span>
            <textarea
              rows={2}
              value={draft.notes}
              onChange={(e) => onChange({ notes: e.target.value })}
              placeholder={t("poi.notesPlaceholder")}
              className={TEXTAREA_CLASS}
            />
          </label>

          <p className="text-xs text-muted-foreground">
            {t("poi.coords")}{" "}
            <span className="tabular-nums">
              {formatLatLng(draft.lat, draft.lng)}
            </span>
          </p>

          {error && <p className="text-xs text-destructive">{error}</p>}

          <div className="flex items-center gap-2">
            <Button size="sm" type="submit" disabled={saving}>
              {saving && <Loader2 className="h-4 w-4 animate-spin" />}
              {saving ? t("poi.saving") : t("poi.save")}
            </Button>
            <Button
              size="sm"
              type="button"
              variant="outline"
              onClick={onCancel}
              disabled={saving}
            >
              {t("poi.cancel")}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

/* -------------------------------- Row ----------------------------------- */

function PoiRow({
  poi,
  selected,
  confirming,
  saving,
  onFocus,
  onEdit,
  onAskDelete,
  onCancelDelete,
  onDelete,
}: {
  poi: Poi;
  selected: boolean;
  confirming: boolean;
  saving: boolean;
  onFocus: () => void;
  onEdit: () => void;
  onAskDelete: () => void;
  onCancelDelete: () => void;
  onDelete: () => void;
}) {
  const { t } = useI18n();
  const Icon = CATEGORY_ICONS[asCategory(poi.category)];

  return (
    <li className={cn(selected && "bg-accent/50")}>
      <div className="flex items-start gap-2 px-4 py-3">
        <button
          type="button"
          onClick={onFocus}
          className="flex min-w-0 flex-1 items-start gap-3 text-start"
        >
          <span
            className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-white"
            style={{ background: poiColor(poi.category) }}
          >
            <Icon className="h-4 w-4" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-medium">
              {poi.name}
            </span>
            <span className="block truncate text-xs text-muted-foreground">
              {t(poiCategoryKey(poi.category))} ·{" "}
              <span className="tabular-nums">
                {formatLatLng(poi.lat, poi.lng)}
              </span>
            </span>
            {poi.notes && (
              <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                {poi.notes}
              </span>
            )}
          </span>
        </button>

        <div className="flex shrink-0 items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={onEdit}
            aria-label={t("poi.edit")}
            title={t("poi.edit")}
          >
            <Pencil className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 text-destructive hover:text-destructive"
            onClick={onAskDelete}
            aria-label={t("poi.delete")}
            title={t("poi.delete")}
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {confirming && (
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-destructive/20 bg-destructive/5 px-4 py-2">
          <span className="text-xs text-destructive">
            {t("poi.deleteConfirm")}
          </span>
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              className="h-8"
              onClick={onCancelDelete}
              disabled={saving}
            >
              {t("poi.keep")}
            </Button>
            <Button
              size="sm"
              variant="destructive"
              className="h-8"
              onClick={onDelete}
              disabled={saving}
            >
              {t("poi.deleteYes")}
            </Button>
          </div>
        </div>
      )}
    </li>
  );
}

/* -------------------------------- Page ---------------------------------- */

export default function PoiPage() {
  const { t } = useI18n();
  const session = useSession();

  const [pois, setPois] = React.useState<Poi[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  // True when the account list could not be read: what is on screen may be a
  // partial list, so the "no places yet" empty state would be a lie.
  const [loadFailed, setLoadFailed] = React.useState(false);
  // True when the list only lives in this browser (the account write failed).
  const [deviceOnly, setDeviceOnly] = React.useState(false);
  // Set when a save had to merge with a newer change from the same account.
  const [notice, setNotice] = React.useState<string | null>(null);

  const [query, setQuery] = React.useState("");
  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  // Bumped on every list click so re-selecting the same pin flies again.
  const [focusKey, setFocusKey] = React.useState(0);
  const [placing, setPlacing] = React.useState(false);
  const [draft, setDraft] = React.useState<PoiDraft | null>(null);
  const [formError, setFormError] = React.useState<string | null>(null);
  const [confirmId, setConfirmId] = React.useState<string | null>(null);

  // Load once signed in.
  React.useEffect(() => {
    if (!session.authed) return;
    let alive = true;
    loadPois()
      .then((res) => {
        if (!alive) return;
        setPois(res.pois);
        // loadPois resolves even when the account copy was unreachable — the
        // failure only shows up as `error`, so read it or the screen claims the
        // account genuinely has no places.
        const failed = Boolean(res.error);
        setLoadFailed(failed);
        setError(failed ? t("poi.loadErr") : null);
        setDeviceOnly(!failed && res.storage === "local");
        setLoading(false);
      })
      .catch(() => {
        if (!alive) return;
        setLoadFailed(true);
        setError(t("poi.loadErr"));
        setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [session.authed, t]);

  const visible = React.useMemo(
    () =>
      searchPois(pois, query)
        .slice()
        .sort((a, b) => a.name.localeCompare(b.name)),
    [pois, query],
  );

  /**
   * Write the whole list through. The screen only adopts the new list once it
   * is stored somewhere, so it never shows a place that survived nothing.
   * `pois` goes along as the list this change started from, so savePois can
   * merge instead of overwriting whatever the account has moved on to.
   */
  const persist = React.useCallback(
    async (next: Poi[]) => {
      setSaving(true);
      const res = await savePois(next, pois);
      setSaving(false);
      if (!res.ok) {
        setError(t("poi.saveErr"));
        return false;
      }
      // Adopt what actually landed — the account may have held places this tab
      // never saw, and savePois merged them in rather than deleting them.
      setPois(res.pois);
      setError(null);
      setLoadFailed(false);
      setDeviceOnly(res.storage === "local");
      setNotice(res.conflict ? t("poi.merged") : null);
      return true;
    },
    [pois, t],
  );

  function startAdd() {
    setPlacing(true);
    setDraft(null);
    setFormError(null);
    setConfirmId(null);
  }

  function cancelDraft() {
    setPlacing(false);
    setDraft(null);
    setFormError(null);
  }

  /** Map click while placing, and every drag of the draft pin. */
  function handlePlace(lat: number, lng: number) {
    setPlacing(false);
    setDraft((prev) =>
      prev
        ? { ...prev, lat, lng }
        : { name: "", category: "other", notes: "", lat, lng },
    );
  }

  function focusPoi(poi: Poi) {
    setSelectedId(poi.id);
    setFocusKey((k) => k + 1);
  }

  function startEdit(poi: Poi) {
    setPlacing(false);
    setConfirmId(null);
    setFormError(null);
    setDraft({
      id: poi.id,
      name: poi.name,
      category: asCategory(poi.category),
      notes: poi.notes ?? "",
      lat: poi.lat,
      lng: poi.lng,
    });
    focusPoi(poi);
  }

  async function submitDraft() {
    if (!draft) return;
    if (!draft.name.trim()) {
      setFormError(t("poi.nameRequired"));
      return;
    }
    setFormError(null);

    let next: Poi[];
    let id: string;
    if (draft.id) {
      id = draft.id;
      next = pois.map((p) =>
        p.id === draft.id
          ? {
              ...p,
              name: draft.name.trim(),
              category: draft.category,
              notes: draft.notes.trim() || undefined,
              lat: draft.lat,
              lng: draft.lng,
            }
          : p,
      );
    } else {
      const poi = createPoi({
        name: draft.name,
        category: draft.category,
        notes: draft.notes,
        lat: draft.lat,
        lng: draft.lng,
      });
      id = poi.id;
      next = [...pois, poi];
    }

    if (await persist(next)) {
      setSelectedId(id);
      setDraft(null);
    }
  }

  async function deletePoi(id: string) {
    setConfirmId(null);
    if (!(await persist(pois.filter((p) => p.id !== id)))) return;
    if (selectedId === id) setSelectedId(null);
    if (draft?.id === id) setDraft(null);
  }

  if (!session.loading && !session.authed) {
    return (
      <>
        <PageHeader
        eyebrow={t("fleet.nav.group.map")}
        icon={PageIcon} title={t("poi.title")} description={t("poi.desc")} />
        <Card>
          <CardContent className="p-8 text-center text-sm text-muted-foreground">
            {t("poi.signin")}{" "}
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

  const busy = placing || draft !== null;

  return (
    <>
      <PageHeader
        eyebrow={t("fleet.nav.group.map")}
        icon={PageIcon}
        title={t("poi.title")}
        description={t("poi.desc")}
        action={
          busy ? (
            <Button variant="outline" onClick={cancelDraft}>
              {t("poi.cancel")}
            </Button>
          ) : (
            <Button onClick={startAdd}>
              <Plus className="h-4 w-4" />
              {t("poi.add")}
            </Button>
          )
        }
      />

      {error && (
        <div className="mb-4 rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-2 text-sm text-destructive">
          {error}
        </div>
      )}
      {deviceOnly && (
        <div className="mb-4 rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-2 text-sm text-amber-700 dark:text-amber-400">
          {t("poi.localOnly")}
        </div>
      )}
      {notice && (
        <div className="mb-4 rounded-lg border bg-muted px-4 py-2 text-sm text-muted-foreground">
          {notice}
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-5">
        <div className="lg:col-span-3">
          <PoiMap
            pois={pois}
            selectedId={selectedId}
            onSelect={setSelectedId}
            placing={placing}
            draft={draft ? { lat: draft.lat, lng: draft.lng } : null}
            draftColor={draft ? poiColor(draft.category) : undefined}
            onPlace={handlePlace}
            focusKey={focusKey}
            className="h-[420px] sm:h-[560px]"
          />
        </div>

        <div className="space-y-4 lg:col-span-2">
          {placing && !draft && (
            <Card>
              <CardContent className="p-4 text-sm text-muted-foreground">
                {t("poi.placeHint")}
              </CardContent>
            </Card>
          )}

          {draft && (
            <PoiForm
              draft={draft}
              saving={saving}
              error={formError}
              onChange={(patch) =>
                setDraft((prev) => (prev ? { ...prev, ...patch } : prev))
              }
              onSubmit={submitDraft}
              onCancel={cancelDraft}
            />
          )}

          {loading ? (
            <Card>
              <CardContent className="p-8 text-center text-sm text-muted-foreground">
                {t("poi.loading")}
              </CardContent>
            </Card>
          ) : loadFailed && pois.length === 0 ? (
            // The account list never arrived, so "no places yet" would read as
            // "your places were deleted". Say what actually happened instead.
            <Card>
              <CardContent className="flex flex-col items-center gap-2 p-8 text-center">
                <AlertTriangle className="h-8 w-8 text-destructive" />
                <p className="text-sm text-muted-foreground">
                  {t("poi.loadErr")}
                </p>
              </CardContent>
            </Card>
          ) : pois.length === 0 ? (
            <Card>
              <CardContent className="flex flex-col items-center gap-2 p-8 text-center">
                <MapPin className="h-8 w-8 text-muted-foreground" />
                <p className="font-medium">{t("poi.none")}</p>
                <p className="text-sm text-muted-foreground">
                  {t("poi.noneHint")}
                </p>
                {!busy && (
                  <Button size="sm" className="mt-2" onClick={startAdd}>
                    <Plus className="h-4 w-4" />
                    {t("poi.addFirst")}
                  </Button>
                )}
              </CardContent>
            </Card>
          ) : (
            <Card className="overflow-hidden">
              <div className="border-b p-3">
                <div className="relative">
                  <Search className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder={t("poi.search")}
                    className="h-9 ps-9"
                  />
                </div>
              </div>

              <ul className="max-h-[420px] divide-y overflow-y-auto sm:max-h-[460px]">
                {visible.map((poi) => (
                  <PoiRow
                    key={poi.id}
                    poi={poi}
                    selected={poi.id === selectedId}
                    confirming={confirmId === poi.id}
                    saving={saving}
                    onFocus={() => focusPoi(poi)}
                    onEdit={() => startEdit(poi)}
                    onAskDelete={() => setConfirmId(poi.id)}
                    onCancelDelete={() => setConfirmId(null)}
                    onDelete={() => deletePoi(poi.id)}
                  />
                ))}
                {visible.length === 0 && (
                  <li className="p-6 text-center text-sm text-muted-foreground">
                    {t("poi.noMatch")}
                  </li>
                )}
              </ul>

              <div className="border-t px-4 py-2.5 text-xs tabular-nums text-muted-foreground">
                {t("poi.count").replace(
                  "{n}",
                  query
                    ? `${visible.length}/${pois.length}`
                    : String(pois.length),
                )}
              </div>
            </Card>
          )}
        </div>
      </div>
    </>
  );
}
