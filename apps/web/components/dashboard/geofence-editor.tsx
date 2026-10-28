"use client";

import * as React from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";

import { cn } from "@/lib/utils";
import {
  STREET_ATTRIBUTION,
  STREET_MAX_ZOOM,
  STREET_TILES,
} from "@/lib/basemaps";
import { useI18n } from "@/lib/i18n-provider";
import {
  boundsOfShapes,
  clampRadius,
  haversineMetres,
  isDrawable,
  offsetEast,
  shapeBounds,
  shapeCentroid,
  shapeToFeature,
  type GeofenceShape,
  type GeofenceZone,
  type LngLat,
} from "@/lib/geofence";


/** Which drawing tool the map is in. "none" = pan/select only. */
export type DrawMode = "none" | "circle" | "polygon";

/** Click within this many pixels of the first vertex to close a polygon. */
const CLOSE_PX = 14;

const SAVED_COLOR = "#2563eb";
const SELECTED_COLOR = "#f59e0b";
const DRAFT_COLOR = "#10b981";

/** Which handle the pointer is currently dragging, if any. */
type DragTarget = "center" | "radius" | null;

function emptyCollection() {
  return { type: "FeatureCollection" as const, features: [] };
}

/** A round drag handle for the circle centre / radius. */
function handleElement(cursor: string): HTMLDivElement {
  const el = document.createElement("div");
  el.style.cssText = `width:16px;height:16px;border-radius:50%;background:#fff;border:3px solid ${DRAFT_COLOR};box-shadow:0 1px 4px rgba(0,0,0,.35);cursor:${cursor};`;
  return el;
}

export function GeofenceEditor({
  zones,
  selectedId,
  onSelect,
  mode,
  draft,
  onDraftChange,
  onFinishPolygon,
  defaultRadius,
  onView,
  className,
}: {
  /** Saved geofences, already parsed into drawable shapes. */
  zones: GeofenceZone[];
  selectedId: number | null;
  onSelect: (id: number) => void;
  mode: DrawMode;
  /** The in-progress shape — owned by the page so the form can edit it too. */
  draft: GeofenceShape | null;
  onDraftChange: (draft: GeofenceShape) => void;
  /** Called when the user closes a polygon by clicking its first vertex. */
  onFinishPolygon: () => void;
  /** Radius given to a circle the moment its centre is placed, in metres. */
  defaultRadius: number;
  /** The visible area [west, south, east, north], after every move. */
  onView?: (bounds: [number, number, number, number]) => void;
  className?: string;
}) {
  const { t } = useI18n();
  const containerRef = React.useRef<HTMLDivElement>(null);
  const mapRef = React.useRef<maplibregl.Map | null>(null);
  const [ready, setReady] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  // Map event handlers are registered once, so everything they read lives in
  // refs that follow the latest render.
  const modeRef = React.useRef(mode);
  modeRef.current = mode;
  const draftRef = React.useRef(draft);
  draftRef.current = draft;
  const defaultRadiusRef = React.useRef(defaultRadius);
  defaultRadiusRef.current = defaultRadius;
  const onDraftChangeRef = React.useRef(onDraftChange);
  onDraftChangeRef.current = onDraftChange;
  const onFinishRef = React.useRef(onFinishPolygon);
  onFinishRef.current = onFinishPolygon;
  const onSelectRef = React.useRef(onSelect);
  onSelectRef.current = onSelect;
  const onViewRef = React.useRef(onView);
  onViewRef.current = onView;

  const centerHandleRef = React.useRef<maplibregl.Marker | null>(null);
  const radiusHandleRef = React.useRef<maplibregl.Marker | null>(null);
  const labelsRef = React.useRef<maplibregl.Marker[]>([]);
  const draggingRef = React.useRef<DragTarget>(null);
  const fittedRef = React.useRef(false);

  /* ------------------------------ Map init ------------------------------ */

  React.useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    let map: maplibregl.Map;
    try {
      map = new maplibregl.Map({
        container: containerRef.current,
        style: {
          version: 8,
          sources: {
            carto: {
              type: "raster",
              tiles: STREET_TILES,
              tileSize: 256,
              maxzoom: STREET_MAX_ZOOM,
              attribution: STREET_ATTRIBUTION,
            },
          },
          layers: [{ id: "carto", type: "raster", source: "carto" }],
        },
        // Default view: Erbil, Iraq.
        center: [44.0092, 36.1911],
        zoom: 11,
      });
    } catch (e) {
      setError((e as Error)?.message ?? "WebGL unavailable");
      return;
    }

    map.addControl(
      new maplibregl.NavigationControl({ showCompass: false }),
      "bottom-right",
    );

    const reportView = () => {
      const b = map.getBounds();
      onViewRef.current?.([b.getWest(), b.getSouth(), b.getEast(), b.getNorth()]);
    };
    map.on("moveend", reportView);

    map.on("load", () => {
      reportView();
      // Saved zones underneath, the draft on top of them.
      map.addSource("zones", { type: "geojson", data: emptyCollection() });
      map.addLayer({
        id: "zones-fill",
        type: "fill",
        source: "zones",
        paint: {
          "fill-color": [
            "case",
            ["get", "selected"],
            SELECTED_COLOR,
            ["coalesce", ["get", "color"], SAVED_COLOR],
          ],
          "fill-opacity": ["case", ["get", "selected"], 0.3, 0.14],
        },
      });
      map.addLayer({
        id: "zones-line",
        type: "line",
        source: "zones",
        paint: {
          "line-color": [
            "case",
            ["get", "selected"],
            SELECTED_COLOR,
            ["coalesce", ["get", "color"], SAVED_COLOR],
          ],
          "line-width": ["case", ["get", "selected"], 3, 2],
        },
      });

      map.addSource("draft", { type: "geojson", data: emptyCollection() });
      map.addLayer({
        id: "draft-fill",
        type: "fill",
        source: "draft",
        paint: { "fill-color": DRAFT_COLOR, "fill-opacity": 0.22 },
      });
      map.addLayer({
        id: "draft-line",
        type: "line",
        source: "draft",
        paint: {
          "line-color": DRAFT_COLOR,
          "line-width": 2.5,
          "line-dasharray": [2, 1],
        },
      });

      map.addSource("draft-points", {
        type: "geojson",
        data: emptyCollection(),
      });
      map.addLayer({
        id: "draft-vertices",
        type: "circle",
        source: "draft-points",
        paint: {
          "circle-radius": 5,
          "circle-color": "#ffffff",
          "circle-stroke-color": DRAFT_COLOR,
          "circle-stroke-width": 2,
        },
      });

      setReady(true);
    });

    // Selecting a saved zone — only while no drawing tool is active.
    map.on("click", "zones-fill", (e) => {
      if (modeRef.current !== "none") return;
      const id = e.features?.[0]?.properties?.id;
      if (typeof id === "number") onSelectRef.current(id);
      else if (typeof id === "string") onSelectRef.current(Number(id));
    });
    map.on("mouseenter", "zones-fill", () => {
      if (modeRef.current === "none") map.getCanvas().style.cursor = "pointer";
    });
    map.on("mouseleave", "zones-fill", () => {
      if (modeRef.current === "none") map.getCanvas().style.cursor = "";
    });

    // Drawing.
    map.on("click", (e) => {
      const active = modeRef.current;
      if (active === "none") return;
      const point: LngLat = [e.lngLat.lng, e.lngLat.lat];
      const current = draftRef.current;

      if (active === "circle") {
        onDraftChangeRef.current({
          kind: "circle",
          center: point,
          radius:
            current?.kind === "circle"
              ? current.radius
              : defaultRadiusRef.current,
        });
        return;
      }

      const ring = current?.kind === "polygon" ? current.ring : [];
      // Clicking the first vertex closes the ring.
      if (ring.length >= 3) {
        const first = map.project(ring[0]);
        if (Math.hypot(first.x - e.point.x, first.y - e.point.y) <= CLOSE_PX) {
          onFinishRef.current();
          return;
        }
      }
      onDraftChangeRef.current({ kind: "polygon", ring: [...ring, point] });
    });

    mapRef.current = map;

    // The container's final height can land a tick after init, leaving a
    // zero-size canvas — re-measure now and on every resize.
    const resize = () => map.resize();
    map.once("load", resize);
    const ro = new ResizeObserver(resize);
    ro.observe(containerRef.current);

    return () => {
      ro.disconnect();
      map.remove();
      mapRef.current = null;
      centerHandleRef.current = null;
      radiusHandleRef.current = null;
      labelsRef.current = [];
      setReady(false);
    };
  }, []);

  /* ------------------------------- Cursor ------------------------------- */

  React.useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    map.getCanvas().style.cursor = mode === "none" ? "" : "crosshair";
  }, [mode, ready]);

  /* ---------------------------- Saved zones ----------------------------- */

  const zonesData = React.useMemo(
    () => ({
      type: "FeatureCollection" as const,
      features: zones.map((z) =>
        shapeToFeature(z.shape, {
          id: z.id,
          selected: z.id === selectedId,
          ...(z.color ? { color: z.color } : {}),
        }),
      ),
    }),
    [zones, selectedId],
  );

  React.useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    const src = map.getSource("zones") as maplibregl.GeoJSONSource | undefined;
    src?.setData(zonesData);
  }, [zonesData, ready]);

  // Name labels ride as HTML markers — the raster style ships no glyphs, so a
  // symbol layer with text would fail to render.
  React.useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;

    for (const marker of labelsRef.current) marker.remove();
    labelsRef.current = zones.map((zone) => {
      const el = document.createElement("button");
      el.type = "button";
      el.textContent = zone.name;
      const selected = zone.id === selectedId;
      el.style.cssText = `max-width:160px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;padding:2px 8px;border-radius:9999px;font:600 11px/1.6 system-ui,sans-serif;color:#fff;cursor:pointer;border:1px solid rgba(255,255,255,.7);box-shadow:0 1px 4px rgba(15,23,42,.35);background:${selected ? SELECTED_COLOR : (zone.color ?? SAVED_COLOR)};`;
      el.addEventListener("click", (event) => {
        event.stopPropagation();
        onSelectRef.current(zone.id);
      });
      return new maplibregl.Marker({ element: el })
        .setLngLat(shapeCentroid(zone.shape))
        .addTo(map);
    });
  }, [zones, selectedId, ready]);

  /* ------------------------------- Draft -------------------------------- */

  const draftData = React.useMemo(
    () => ({
      type: "FeatureCollection" as const,
      features: isDrawable(draft) ? [shapeToFeature(draft)] : [],
    }),
    [draft],
  );

  const vertexData = React.useMemo(() => {
    const points: LngLat[] =
      draft?.kind === "polygon"
        ? draft.ring
        : draft?.kind === "circle"
          ? [draft.center]
          : [];
    return {
      type: "FeatureCollection" as const,
      features: points.map((coordinates) => ({
        type: "Feature" as const,
        geometry: { type: "Point" as const, coordinates },
        properties: {},
      })),
    };
  }, [draft]);

  React.useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    (map.getSource("draft") as maplibregl.GeoJSONSource | undefined)?.setData(
      draftData,
    );
    (
      map.getSource("draft-points") as maplibregl.GeoJSONSource | undefined
    )?.setData(vertexData);
  }, [draftData, vertexData, ready]);

  // Circle drafts get two draggable handles: the centre, and a radius grip due
  // east of it. The form's slider stays in sync because both write `draft`.
  React.useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;

    if (draft?.kind !== "circle") {
      centerHandleRef.current?.remove();
      centerHandleRef.current = null;
      radiusHandleRef.current?.remove();
      radiusHandleRef.current = null;
      return;
    }

    if (!centerHandleRef.current) {
      const marker = new maplibregl.Marker({
        element: handleElement("move"),
        draggable: true,
      })
        .setLngLat(draft.center)
        .addTo(map);
      marker.on("dragstart", () => {
        draggingRef.current = "center";
      });
      marker.on("drag", () => {
        const current = draftRef.current;
        if (current?.kind !== "circle") return;
        const { lng, lat } = marker.getLngLat();
        onDraftChangeRef.current({ ...current, center: [lng, lat] });
      });
      marker.on("dragend", () => {
        draggingRef.current = null;
      });
      centerHandleRef.current = marker;
    } else if (draggingRef.current !== "center") {
      centerHandleRef.current.setLngLat(draft.center);
    }

    const grip = offsetEast(draft.center, draft.radius);
    if (!radiusHandleRef.current) {
      const marker = new maplibregl.Marker({
        element: handleElement("ew-resize"),
        draggable: true,
      })
        .setLngLat(grip)
        .addTo(map);
      marker.on("dragstart", () => {
        draggingRef.current = "radius";
      });
      marker.on("drag", () => {
        const current = draftRef.current;
        if (current?.kind !== "circle") return;
        const { lng, lat } = marker.getLngLat();
        onDraftChangeRef.current({
          ...current,
          radius: clampRadius(haversineMetres(current.center, [lng, lat])),
        });
      });
      marker.on("dragend", () => {
        draggingRef.current = null;
        // Snap the grip back onto the circle after a clamped drag.
        const current = draftRef.current;
        if (current?.kind === "circle") {
          marker.setLngLat(offsetEast(current.center, current.radius));
        }
      });
      radiusHandleRef.current = marker;
    } else if (draggingRef.current !== "radius") {
      radiusHandleRef.current.setLngLat(grip);
    }
  }, [draft, ready]);

  /* ------------------------------- Framing ------------------------------ */

  // Frame every zone once, when the first load arrives.
  React.useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready || fittedRef.current || zones.length === 0) return;
    const bounds = boundsOfShapes(zones.map((z) => z.shape));
    if (!bounds) return;
    fittedRef.current = true;
    map.fitBounds(bounds, { padding: 64, maxZoom: 15, duration: 0 });
  }, [zones, ready]);

  // Frame the selection when it changes (an explicit user action).
  React.useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready || selectedId == null) return;
    const zone = zones.find((z) => z.id === selectedId);
    if (!zone) return;
    const bounds = shapeBounds(zone.shape);
    if (bounds) map.fitBounds(bounds, { padding: 96, maxZoom: 16 });
    // `zones` is intentionally out of the deps: only a new selection re-frames.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId, ready]);

  return (
    <div
      className={cn(
        "relative w-full overflow-hidden rounded-xl border bg-muted",
        className,
      )}
    >
      <div ref={containerRef} className="absolute inset-0 h-full w-full" />

      {error && (
        <div className="absolute inset-0 z-30 grid place-items-center bg-background/90 p-6 text-center">
          <div>
            <p className="text-sm font-semibold text-destructive">
              {t("geo.mapErr")}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">{error}</p>
          </div>
        </div>
      )}
    </div>
  );
}
