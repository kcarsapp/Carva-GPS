"use client";

// Speed cameras + bumps: the road features every car's path is checked
// against (lib/road-hazards.ts, infra/automation/road-hazards.js). Everyone
// signed in can look; only administrators change the list, because it is one
// list for the whole server.

import * as React from "react";
import Link from "next/link";
import {
  Camera,
  CloudDownload,
  Loader2,
  Plus,
  Save,
  Trash2,
  Waves,
  X,
} from "lucide-react";

import { HazardMap } from "@/components/dashboard/hazard-map";
import { KpiTile } from "@/components/dashboard/kpi-tile";
import { PageHeader } from "@/components/dashboard/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { useI18n } from "@/lib/i18n-provider";
import { useSession } from "@/lib/live-data";
import {
  CAMERA_LIMIT_RANGE,
  MAX_IMPORT_SPAN_DEG,
  isValidBbox,
  type Bbox,
  type HazardKind,
  type RoadHazard,
  type RoadHazardFile,
} from "@/lib/road-hazards";

interface Draft {
  /** Existing id when editing; null for a new pin. */
  id: string | null;
  kind: HazardKind;
  lat: number;
  lng: number;
  name: string;
  /** Text, so the field can be empty (= Settings default). */
  limit: string;
}

type Notice = { tone: "ok" | "error"; text: string } | null;

function newId() {
  return `m-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

export default function RoadHazardsPage() {
  const { t } = useI18n();
  const session = useSession();
  const isAdmin = session.user?.role === "general_admin";

  const [file, setFile] = React.useState<RoadHazardFile | null>(null);
  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  const [placing, setPlacing] = React.useState(false);
  // Which kind the next click creates, while `placing` is armed.
  const [pendingKind, setPendingKind] = React.useState<HazardKind>("camera");
  const [draft, setDraft] = React.useState<Draft | null>(null);
  const [view, setView] = React.useState<Bbox | null>(null);
  const [busy, setBusy] = React.useState<"save" | "delete" | "import" | null>(null);
  const [notice, setNotice] = React.useState<Notice>(null);

  React.useEffect(() => {
    if (!session.authed) return;
    void fetch("/api/road-hazards", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((body: { file: RoadHazardFile }) => setFile(body.file))
      .catch(() => setNotice({ tone: "error", text: t("road.err.load") }));
  }, [session.authed, t]);

  const hazards = file?.items ?? [];
  const counts = React.useMemo(() => {
    let cameras = 0;
    let osm = 0;
    for (const h of hazards) {
      if (h.kind === "camera") cameras += 1;
      if (h.source === "osm") osm += 1;
    }
    return { cameras, bumps: hazards.length - cameras, osm, manual: hazards.length - osm };
  }, [hazards]);
  const selected = hazards.find((h) => h.id === selectedId) ?? null;

  function startAdd(kind: HazardKind) {
    setSelectedId(null);
    setDraft(null);
    setPlacing(true);
    setNotice(null);
    setPendingKind(kind);
  }

  function onPlace(lat: number, lng: number) {
    if (placing) {
      setPlacing(false);
      setDraft({ id: null, kind: pendingKind, lat, lng, name: "", limit: "" });
    } else if (draft) {
      setDraft({ ...draft, lat, lng });
    }
  }

  function startEdit(h: RoadHazard) {
    setPlacing(false);
    setDraft({
      id: h.id,
      kind: h.kind,
      lat: h.lat,
      lng: h.lng,
      name: h.name ?? "",
      limit: h.limitKmh != null ? String(h.limitKmh) : "",
    });
  }

  function cancel() {
    setPlacing(false);
    setDraft(null);
  }

  async function send(method: "PUT" | "POST", body: unknown) {
    const res = await fetch("/api/road-hazards", {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const json = (await res.json().catch(() => ({}))) as {
      file?: RoadHazardFile;
      imported?: { found: number; added: number; updated: number; dropped: number };
      error?: string;
    };
    if (!res.ok || !json.file) throw new Error(json.error ?? String(res.status));
    setFile(json.file);
    return json;
  }

  async function save() {
    if (!draft) return;
    const limit = draft.limit.trim() === "" ? null : Number(draft.limit);
    if (limit != null && !(limit >= CAMERA_LIMIT_RANGE[0] && limit <= CAMERA_LIMIT_RANGE[1])) {
      setNotice({ tone: "error", text: t("road.err.limit") });
      return;
    }
    const id = draft.id ?? newId();
    setBusy("save");
    try {
      await send("PUT", {
        upsert: [
          {
            id,
            kind: draft.kind,
            lat: draft.lat,
            lng: draft.lng,
            name: draft.name,
            limitKmh: draft.kind === "camera" ? limit : null,
          },
        ],
        remove: [],
      });
      setDraft(null);
      setSelectedId(id);
      setNotice({ tone: "ok", text: t("road.saved") });
    } catch (e) {
      setNotice({ tone: "error", text: `${t("road.err.save")} ${(e as Error).message}` });
    } finally {
      setBusy(null);
    }
  }

  async function remove(id: string) {
    setBusy("delete");
    try {
      await send("PUT", { upsert: [], remove: [id] });
      setSelectedId(null);
      setDraft(null);
      setNotice({ tone: "ok", text: t("road.deleted") });
    } catch (e) {
      setNotice({ tone: "error", text: `${t("road.err.save")} ${(e as Error).message}` });
    } finally {
      setBusy(null);
    }
  }

  async function importArea() {
    if (!view || !isValidBbox(view)) {
      setNotice({ tone: "error", text: t("road.err.area").replace("{deg}", String(MAX_IMPORT_SPAN_DEG)) });
      return;
    }
    setBusy("import");
    setNotice(null);
    try {
      const { imported } = await send("POST", { bbox: view });
      setNotice({
        tone: "ok",
        text: t("road.imported")
          .replace("{found}", String(imported?.found ?? 0))
          .replace("{added}", String(imported?.added ?? 0)),
      });
    } catch (e) {
      setNotice({ tone: "error", text: `${t("road.err.import")} ${(e as Error).message}` });
    } finally {
      setBusy(null);
    }
  }

  const header = (
    <PageHeader
      eyebrow={t("fleet.nav.group.map")}
      icon={Camera}
      title={t("road.title")}
      description={t("road.desc")}
      action={
        isAdmin && session.authed ? (
          <>
            <Button variant="outline" onClick={() => startAdd("camera")} disabled={busy !== null}>
              <Plus />
              {t("road.addCamera")}
            </Button>
            <Button variant="outline" onClick={() => startAdd("bump")} disabled={busy !== null}>
              <Plus />
              {t("road.addBump")}
            </Button>
            <Button onClick={importArea} disabled={busy !== null}>
              {busy === "import" ? <Loader2 className="animate-spin" /> : <CloudDownload />}
              {t("road.import")}
            </Button>
          </>
        ) : undefined
      }
    />
  );

  if (!session.loading && !session.authed) {
    return (
      <>
        {header}
        <Card>
          <CardContent className="p-8 text-center text-sm text-muted-foreground">
            {t("road.signin")}{" "}
            <Link href="/login" className="font-medium text-primary hover:underline">
              {t("nav.signin")}
            </Link>
          </CardContent>
        </Card>
      </>
    );
  }

  return (
    <>
      {header}

      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiTile label={t("road.kpi.cameras")} value={String(counts.cameras)} icon={Camera} />
        <KpiTile label={t("road.kpi.bumps")} value={String(counts.bumps)} icon={Waves} />
        <KpiTile label={t("road.kpi.osm")} value={String(counts.osm)} />
        <KpiTile label={t("road.kpi.manual")} value={String(counts.manual)} />
      </div>

      {notice && (
        <p
          role={notice.tone === "error" ? "alert" : "status"}
          className={cn(
            "mb-4 rounded-xl border p-3 text-sm",
            notice.tone === "error"
              ? "border-destructive/30 bg-destructive/[0.06] text-destructive"
              : "border-emerald-500/30 bg-emerald-500/[0.06] text-emerald-700 dark:text-emerald-400",
          )}
        >
          {notice.text}
        </p>
      )}

      <div className="grid gap-4 lg:grid-cols-5">
        <div className="lg:col-span-3">
          <HazardMap
            hazards={hazards}
            selectedId={draft?.id ?? selectedId}
            onSelect={(id) => {
              if (draft) return;
              setSelectedId(id);
            }}
            placing={placing}
            draft={draft ? { lat: draft.lat, lng: draft.lng } : null}
            draftKind={draft?.kind ?? pendingKind}
            onPlace={onPlace}
            onView={setView}
            className="h-[420px] sm:h-[560px]"
          />
        </div>

        <Card className="lg:col-span-2">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">
              {draft
                ? draft.id
                  ? t("road.edit")
                  : t(draft.kind === "camera" ? "road.addCamera" : "road.addBump")
                : selected
                  ? t(`road.kind.${selected.kind}`)
                  : t("road.howTitle")}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {draft ? (
              <DraftForm
                draft={draft}
                onChange={setDraft}
                onSave={save}
                onCancel={cancel}
                saving={busy === "save"}
                t={t}
              />
            ) : selected ? (
              <div className="space-y-3 text-sm">
                <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5">
                  <dt className="text-muted-foreground">{t("road.name")}</dt>
                  <dd dir="auto">{selected.name || "—"}</dd>
                  {selected.kind === "camera" && (
                    <>
                      <dt className="text-muted-foreground">{t("road.limit")}</dt>
                      <dd>
                        {selected.limitKmh != null
                          ? `${selected.limitKmh} km/h`
                          : t("road.limitDefault")}
                      </dd>
                    </>
                  )}
                  <dt className="text-muted-foreground">{t("road.source")}</dt>
                  <dd>
                    {selected.source === "osm"
                      ? `OpenStreetMap${selected.edited ? ` (${t("road.edited")})` : ""}`
                      : t("road.manual")}
                  </dd>
                  <dt className="text-muted-foreground">{t("road.location")}</dt>
                  <dd className="tabular-nums" dir="ltr">
                    {selected.lat.toFixed(5)}, {selected.lng.toFixed(5)}
                  </dd>
                </dl>
                {isAdmin && (
                  <div className="flex flex-wrap gap-2 pt-1">
                    <Button variant="outline" onClick={() => startEdit(selected)} disabled={busy !== null}>
                      {t("road.edit")}
                    </Button>
                    <Button
                      variant="outline"
                      onClick={() => void remove(selected.id)}
                      disabled={busy !== null}
                      className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                    >
                      {busy === "delete" ? <Loader2 className="animate-spin" /> : <Trash2 />}
                      {t("road.delete")}
                    </Button>
                    <Button variant="ghost" onClick={() => setSelectedId(null)}>
                      <X />
                      {t("road.close")}
                    </Button>
                  </div>
                )}
              </div>
            ) : (
              <div className="space-y-2 text-sm text-muted-foreground">
                <p>{t("road.how1")}</p>
                <p>{t("road.how2")}</p>
                {isAdmin && <p>{t("road.how3")}</p>}
                <p className="text-xs">{t("road.osmCredit")}</p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </>
  );
}

function DraftForm({
  draft,
  onChange,
  onSave,
  onCancel,
  saving,
  t,
}: {
  draft: Draft;
  onChange: (d: Draft) => void;
  onSave: () => void;
  onCancel: () => void;
  saving: boolean;
  t: (key: string) => string;
}) {
  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        onSave();
      }}
    >
      <div className="flex overflow-hidden rounded-lg border">
        {(["camera", "bump"] as const).map((k) => (
          <button
            key={k}
            type="button"
            onClick={() => onChange({ ...draft, kind: k })}
            className={cn(
              "flex-1 px-3 py-2 text-sm font-medium transition-colors",
              draft.kind === k ? "bg-primary text-primary-foreground" : "hover:bg-accent",
            )}
          >
            {t(`road.kind.${k}`)}
          </button>
        ))}
      </div>
      <label className="block">
        <span className="mb-1 block text-xs font-medium text-muted-foreground">{t("road.name")}</span>
        <Input
          value={draft.name}
          maxLength={120}
          dir="auto"
          onChange={(e) => onChange({ ...draft, name: e.target.value })}
          placeholder={t("road.namePlaceholder")}
          className="h-10"
        />
      </label>
      {draft.kind === "camera" && (
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-muted-foreground">{t("road.limit")}</span>
          <span className="relative block">
            <Input
              type="number"
              inputMode="numeric"
              min={CAMERA_LIMIT_RANGE[0]}
              max={CAMERA_LIMIT_RANGE[1]}
              value={draft.limit}
              onChange={(e) => onChange({ ...draft, limit: e.target.value })}
              placeholder={t("road.limitDefault")}
              className="h-10 pe-14"
            />
            <span className="pointer-events-none absolute end-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">
              km/h
            </span>
          </span>
        </label>
      )}
      <p className="text-xs text-muted-foreground">{t("poi.dragHint")}</p>
      <div className="flex gap-2">
        <Button type="submit" disabled={saving}>
          {saving ? <Loader2 className="animate-spin" /> : <Save />}
          {t("road.save")}
        </Button>
        <Button type="button" variant="ghost" onClick={onCancel}>
          {t("road.cancel")}
        </Button>
      </div>
    </form>
  );
}
