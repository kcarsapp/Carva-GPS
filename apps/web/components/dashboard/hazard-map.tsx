"use client";

import * as React from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";

import { cn } from "@/lib/utils";
import {
  STREET_ATTRIBUTION,
  STREET_MAX_ZOOM,
  STREET_TILES,
  SATELLITE_TILES,
} from "@/lib/basemaps";
import { useI18n } from "@/lib/i18n-provider";
import { HAZARD_COLORS, type Bbox, type HazardKind, type RoadHazard } from "@/lib/road-hazards";
import {
  ARROW_ICON_ID,
  BUMP_ICON_ID,
  cameraIconId,
  ensureHazardIcons,
  hazardIconUrl,
} from "@/lib/hazard-icons";

/** Below this zoom pins are plain dots; from it on, full icons. */
const ICON_ZOOM = 12.5;
const HAZARD_LAYERS = ["hazards-dots", "hazards-icons"];

/**
 * Speed cameras + bumps. Unlike the POI map (one DOM marker per pin), the
 * pins are GeoJSON layers: an OpenStreetMap import brings in well over a
 * thousand, which DOM markers cannot pan smoothly. Zoomed out they are dots;
 * zoomed in, camera badges (with their limit) and bump warning signs. Only
 * the pin being added or moved is a (draggable) DOM marker.
 */
export function HazardMap({
  hazards,
  selectedId,
  onSelect,
  placing,
  draft,
  draftKind,
  onPlace,
  onView,
  focusKey = 0,
  className,
}: {
  hazards: RoadHazard[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  /** Click-to-place armed — the next map click drops the pin. */
  placing: boolean;
  draft: { lat: number; lng: number } | null;
  draftKind: HazardKind;
  onPlace: (lat: number, lng: number) => void;
  /** The visible area, reported after every move (used by the OSM import). */
  onView: (bbox: Bbox) => void;
  /** Bump to re-run the fly-to for the current selection. */
  focusKey?: number;
  className?: string;
}) {
  const { t } = useI18n();
  const containerRef = React.useRef<HTMLDivElement>(null);
  const mapRef = React.useRef<maplibregl.Map | null>(null);
  const draftMarkerRef = React.useRef<maplibregl.Marker | null>(null);
  const [ready, setReady] = React.useState(false);

  // Live values for handlers bound once on the map instance.
  const hazardsRef = React.useRef(hazards);
  hazardsRef.current = hazards;
  const placingRef = React.useRef(placing);
  placingRef.current = placing;
  const onPlaceRef = React.useRef(onPlace);
  onPlaceRef.current = onPlace;
  const onSelectRef = React.useRef(onSelect);
  onSelectRef.current = onSelect;
  const onViewRef = React.useRef(onView);
  onViewRef.current = onView;

  const [basemap, setBasemapState] = React.useState<"streets" | "satellite">("streets");
  React.useEffect(() => {
    if (localStorage.getItem("carva-basemap") === "satellite") setBasemapState("satellite");
  }, []);
  const setBasemap = React.useCallback((next: "streets" | "satellite") => {
    setBasemapState(next);
    localStorage.setItem("carva-basemap", next);
  }, []);

  // Init the map once.
  React.useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: {
        version: 8,
        sources: {
          carto: {
            type: "raster",
            tiles: STREET_TILES,
            tileSize: 256,
            maxzoom: STREET_MAX_ZOOM,
            attribution: `${STREET_ATTRIBUTION} · speed cameras & bumps © OpenStreetMap contributors (ODbL)`,
          },
          hazards: { type: "geojson", data: { type: "FeatureCollection", features: [] } },
        },
        layers: [
          { id: "carto", type: "raster", source: "carto" },
          {
            id: "hazards-dots",
            type: "circle",
            source: "hazards",
            maxzoom: ICON_ZOOM,
            paint: {
              "circle-color": ["get", "color"],
              "circle-radius": [
                "interpolate", ["linear"], ["zoom"],
                8, ["case", ["get", "selected"], 6, 2.5],
                ICON_ZOOM, ["case", ["get", "selected"], 9, 5.5],
              ],
              "circle-stroke-color": ["case", ["get", "selected"], "#4f46e5", "#ffffff"],
              "circle-stroke-width": ["case", ["get", "selected"], 3, 1.5],
            },
          },
          {
            // Selection ring under the icon.
            id: "hazards-halo",
            type: "circle",
            source: "hazards",
            minzoom: ICON_ZOOM,
            filter: ["==", ["get", "selected"], true],
            paint: {
              "circle-color": "rgba(79,70,229,.22)",
              "circle-radius": 24,
              "circle-stroke-color": "#4f46e5",
              "circle-stroke-width": 2.5,
            },
          },
          {
            // One-sided hazards: an arrow just ahead, pointing the way the
            // traffic it applies to is driving.
            id: "hazards-arrows",
            type: "symbol",
            source: "hazards",
            minzoom: ICON_ZOOM,
            filter: ["has", "bearing"],
            layout: {
              "icon-image": ARROW_ICON_ID,
              "icon-rotate": ["get", "bearing"],
              "icon-rotation-alignment": "map",
              "icon-offset": [0, -34],
              "icon-size": ["interpolate", ["linear"], ["zoom"], ICON_ZOOM, 0.45, 16, 0.65],
              "icon-allow-overlap": true,
              "icon-ignore-placement": true,
            },
          },
          {
            id: "hazards-icons",
            type: "symbol",
            source: "hazards",
            minzoom: ICON_ZOOM,
            layout: {
              "icon-image": ["get", "icon"],
              "icon-size": ["interpolate", ["linear"], ["zoom"], ICON_ZOOM, 0.7, 16, 1],
              "icon-allow-overlap": true,
              "icon-ignore-placement": true,
              // Selected one drawn last, on top of its neighbours.
              "symbol-sort-key": ["case", ["get", "selected"], 1, 0],
            },
          },
        ],
      },
      // Default view: Erbil, Iraq (Carva's home region).
      center: [44.0092, 36.1911],
      zoom: 12,
    });
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "bottom-right");

    map.on("click", (e) => {
      if (placingRef.current) {
        onPlaceRef.current(e.lngLat.lat, e.lngLat.lng);
        return;
      }
      // A forgiving hit box: small pins are hard to tap on a phone.
      const pad = 8;
      const hit = map.queryRenderedFeatures(
        [[e.point.x - pad, e.point.y - pad], [e.point.x + pad, e.point.y + pad]],
        { layers: HAZARD_LAYERS },
      )[0];
      onSelectRef.current(hit ? String(hit.properties?.id) : null);
    });
    for (const layer of HAZARD_LAYERS) {
      map.on("mouseenter", layer, () => {
        if (!placingRef.current) map.getCanvas().style.cursor = "pointer";
      });
      map.on("mouseleave", layer, () => {
        if (!placingRef.current) map.getCanvas().style.cursor = "";
      });
    }
    const reportView = () => {
      const b = map.getBounds();
      onViewRef.current([b.getWest(), b.getSouth(), b.getEast(), b.getNorth()]);
    };
    map.on("moveend", reportView);
    mapRef.current = map;

    const resize = () => map.resize();
    map.once("load", () => {
      resize();
      reportView();
      setReady(true);
    });
    const ro = new ResizeObserver(resize);
    ro.observe(containerRef.current);

    return () => {
      ro.disconnect();
      map.remove();
      mapRef.current = null;
      draftMarkerRef.current = null;
      setReady(false);
    };
  }, []);

  React.useEffect(() => {
    const src = mapRef.current?.getSource("carto") as maplibregl.RasterTileSource | undefined;
    src?.setTiles(basemap === "satellite" ? SATELLITE_TILES : STREET_TILES);
  }, [basemap, ready]);

  React.useEffect(() => {
    const canvas = mapRef.current?.getCanvas();
    if (canvas) canvas.style.cursor = placing ? "crosshair" : "";
  }, [placing]);

  // Pins as one GeoJSON update — cheap even for thousands.
  React.useEffect(() => {
    const map = mapRef.current;
    const src = map?.getSource("hazards") as maplibregl.GeoJSONSource | undefined;
    if (!map || !src) return;
    // One camera image per distinct limit, registered before it is referenced.
    ensureHazardIcons(map, hazards.filter((h) => h.kind === "camera").map((h) => h.limitKmh));
    src.setData({
      type: "FeatureCollection",
      features: hazards.map((h) => ({
        type: "Feature",
        geometry: { type: "Point", coordinates: [h.lng, h.lat] },
        properties: {
          id: h.id,
          color: HAZARD_COLORS[h.kind],
          icon: h.kind === "camera" ? cameraIconId(h.limitKmh) : BUMP_ICON_ID,
          selected: h.id === selectedId,
          // Absent (not null) for two-way hazards, so ["has", "bearing"] works.
          ...(h.bearing != null ? { bearing: h.bearing } : {}),
        },
      })),
    });
  }, [hazards, selectedId, ready]);

  // Legend icons: drawn on a canvas, so only after mount (never on the server).
  const [legend, setLegend] = React.useState<Record<HazardKind, string> | null>(null);
  React.useEffect(() => {
    setLegend({ camera: hazardIconUrl("camera"), bump: hazardIconUrl("bump") });
  }, []);

  // The pin being added or moved: draggable, so the spot can be nudged.
  React.useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (!draft) {
      draftMarkerRef.current?.remove();
      draftMarkerRef.current = null;
      return;
    }
    if (!draftMarkerRef.current) {
      const el = document.createElement("div");
      el.style.cssText =
        "width:22px;height:22px;border-radius:9999px;border:3px solid #fff;cursor:grab;box-shadow:0 0 0 6px rgba(79,70,229,.25),0 2px 6px rgba(15,23,42,.35);";
      const marker = new maplibregl.Marker({ element: el, draggable: true })
        .setLngLat([draft.lng, draft.lat])
        .addTo(map);
      marker.on("dragend", () => {
        const { lat, lng } = marker.getLngLat();
        onPlaceRef.current(lat, lng);
      });
      draftMarkerRef.current = marker;
    } else {
      draftMarkerRef.current.setLngLat([draft.lng, draft.lat]);
    }
    draftMarkerRef.current.getElement().style.background = HAZARD_COLORS[draftKind];
  }, [draft, draftKind]);

  // Fly to the selection.
  React.useEffect(() => {
    const map = mapRef.current;
    if (!map || !selectedId) return;
    const h = hazardsRef.current.find((x) => x.id === selectedId);
    if (!h) return;
    map.flyTo({ center: [h.lng, h.lat], zoom: Math.max(map.getZoom(), 16), duration: 800 });
  }, [selectedId, focusKey]);

  return (
    <div className={cn("relative w-full overflow-hidden rounded-xl border bg-muted", className)}>
      <div ref={containerRef} className="absolute inset-0 h-full w-full" />

      <div className="absolute end-3 top-3 z-10 flex overflow-hidden rounded-lg border bg-background shadow-sm">
        {(["streets", "satellite"] as const).map((b) => (
          <button
            key={b}
            type="button"
            onClick={() => setBasemap(b)}
            className={cn(
              "px-3 py-1.5 text-xs font-medium transition-colors",
              basemap === b
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:bg-accent hover:text-foreground",
            )}
          >
            {t(`ctrl.${b}`)}
          </button>
        ))}
      </div>

      <div className="absolute bottom-3 start-3 z-10 flex gap-3 rounded-lg border bg-background/95 px-3 py-1.5 text-xs shadow-sm">
        {(["camera", "bump"] as const).map((k) => (
          <span key={k} className="inline-flex items-center gap-1.5">
            {legend ? (
              // eslint-disable-next-line @next/next/no-img-element -- a canvas data URL, nothing to optimise
              <img src={legend[k]} alt="" className="h-5 w-5" />
            ) : (
              <span className="h-2.5 w-2.5 rounded-full" style={{ background: HAZARD_COLORS[k] }} />
            )}
            {t(`road.kind.${k}`)}
          </span>
        ))}
      </div>

      {(placing || draft) && (
        <div className="absolute start-3 top-3 z-10 rounded-lg border bg-background/95 px-3 py-1.5 text-xs font-medium shadow-sm">
          {placing ? t("poi.placeHint") : t("poi.dragHint")}
        </div>
      )}
    </div>
  );
}
