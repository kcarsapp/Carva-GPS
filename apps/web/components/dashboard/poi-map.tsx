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
import { poiColor, type Poi } from "@/lib/pois";


const DOT_CSS =
  "width:26px;height:26px;border-radius:9999px;border:3px solid #fff;box-shadow:0 2px 6px rgba(15,23,42,.35);cursor:pointer;padding:0;transition:transform .15s ease;";
const LABEL_CSS =
  "position:absolute;top:30px;left:50%;transform:translateX(-50%);max-width:150px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;padding:1px 6px;border-radius:6px;background:rgba(255,255,255,.92);color:#0f172a;font-size:11px;font-weight:600;line-height:1.5;box-shadow:0 1px 3px rgba(15,23,42,.3);pointer-events:none;";

/**
 * POI map: every saved place as a coloured marker with its name, plus
 * click-to-place for new pins. The draft pin is draggable so the exact spot
 * can be nudged after the first click.
 */
export function PoiMap({
  pois,
  selectedId,
  onSelect,
  placing,
  draft,
  draftColor,
  onPlace,
  focusKey = 0,
  className,
}: {
  pois: Poi[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  /** Click-to-place armed — the next map click drops the pin. */
  placing: boolean;
  /** Coordinates of the pin being added or edited. */
  draft: { lat: number; lng: number } | null;
  /** Marker colour of the draft pin (follows the chosen category). */
  draftColor?: string;
  onPlace: (lat: number, lng: number) => void;
  /** Bump to re-run the fly-to for the current selection. */
  focusKey?: number;
  className?: string;
}) {
  const { t } = useI18n();
  const containerRef = React.useRef<HTMLDivElement>(null);
  const mapRef = React.useRef<maplibregl.Map | null>(null);
  const markersRef = React.useRef<Map<string, maplibregl.Marker>>(new Map());
  const draftMarkerRef = React.useRef<maplibregl.Marker | null>(null);
  const fittedRef = React.useRef(false);
  // Flipped once the style has parsed — before that `getSource` returns nothing.
  const [ready, setReady] = React.useState(false);

  // Live values for handlers bound once on the map instance.
  const poisRef = React.useRef(pois);
  poisRef.current = pois;
  const placingRef = React.useRef(placing);
  placingRef.current = placing;
  const onPlaceRef = React.useRef(onPlace);
  onPlaceRef.current = onPlace;
  const onSelectRef = React.useRef(onSelect);
  onSelectRef.current = onSelect;

  const [basemap, setBasemapState] = React.useState<"streets" | "satellite">(
    "streets",
  );
  React.useEffect(() => {
    const saved = localStorage.getItem("carva-basemap");
    if (saved === "satellite") setBasemapState(saved);
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
            attribution: STREET_ATTRIBUTION,
          },
        },
        layers: [{ id: "carto", type: "raster", source: "carto" }],
      },
      // Default view: Erbil, Iraq (Carva's home region).
      center: [44.0092, 36.1911],
      zoom: 11,
    });
    map.addControl(
      new maplibregl.NavigationControl({ showCompass: false }),
      "bottom-right",
    );
    map.on("click", (e) => {
      if (!placingRef.current) return;
      onPlaceRef.current(e.lngLat.lat, e.lngLat.lng);
    });
    mapRef.current = map;

    // The container's height often settles a tick after init, leaving a
    // zero-size canvas — re-measure now and on every resize.
    const resize = () => map.resize();
    map.once("load", () => {
      resize();
      setReady(true);
    });
    const ro = new ResizeObserver(resize);
    ro.observe(containerRef.current);

    return () => {
      ro.disconnect();
      map.remove();
      mapRef.current = null;
      markersRef.current.clear();
      draftMarkerRef.current = null;
      fittedRef.current = false;
      setReady(false);
    };
  }, []);

  // Swap basemap tiles. `ready` is a dependency because the style parses a frame
  // after the map is constructed: on mount `getSource` still returns undefined,
  // so a satellite choice restored from localStorage would silently keep the
  // street tiles — and re-clicking the already-active button can't fix it,
  // because setting the same state value makes React bail out of the re-render.
  React.useEffect(() => {
    const src = mapRef.current?.getSource("carto") as
      | maplibregl.RasterTileSource
      | undefined;
    src?.setTiles(basemap === "satellite" ? SATELLITE_TILES : STREET_TILES);
  }, [basemap, ready]);

  // Crosshair while the user is placing a pin.
  React.useEffect(() => {
    const canvas = mapRef.current?.getCanvas();
    if (canvas) canvas.style.cursor = placing ? "crosshair" : "";
  }, [placing]);

  // Sync markers with the POI list.
  React.useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const seen = new Set<string>();
    for (const poi of pois) {
      seen.add(poi.id);

      let marker = markersRef.current.get(poi.id);
      if (!marker) {
        // MapLibre owns the outer element's `transform` — style the children.
        const el = document.createElement("div");
        el.style.cssText = "width:26px;height:26px;";
        const dot = document.createElement("button");
        dot.type = "button";
        dot.style.cssText = DOT_CSS;
        dot.addEventListener("click", (e) => {
          e.stopPropagation();
          onSelectRef.current(poi.id);
        });
        const label = document.createElement("span");
        label.style.cssText = LABEL_CSS;
        el.appendChild(dot);
        el.appendChild(label);
        marker = new maplibregl.Marker({ element: el })
          .setLngLat([poi.lng, poi.lat])
          .addTo(map);
        markersRef.current.set(poi.id, marker);
      } else {
        marker.setLngLat([poi.lng, poi.lat]);
      }

      const el = marker.getElement();
      const dot = el.firstElementChild as HTMLElement | null;
      const label = el.lastElementChild as HTMLElement | null;
      const isSelected = poi.id === selectedId;
      el.style.zIndex = isSelected ? "3" : "1";
      if (dot) {
        dot.setAttribute("aria-label", poi.name);
        dot.style.background = poiColor(poi.category);
        dot.style.transform = isSelected ? "scale(1.25)" : "scale(1)";
        dot.style.outline = isSelected
          ? "3px solid rgba(79,70,229,.45)"
          : "none";
        dot.style.outlineOffset = "2px";
      }
      if (label) label.textContent = poi.name;
    }

    // Drop markers for POIs that were deleted.
    for (const [id, marker] of markersRef.current) {
      if (!seen.has(id)) {
        marker.remove();
        markersRef.current.delete(id);
      }
    }

    // Frame everything the first time a list arrives.
    if (!fittedRef.current && pois.length > 0) {
      if (pois.length === 1) {
        map.jumpTo({ center: [pois[0].lng, pois[0].lat], zoom: 14 });
      } else {
        const b = new maplibregl.LngLatBounds();
        pois.forEach((p) => b.extend([p.lng, p.lat]));
        map.fitBounds(b, { padding: 64, maxZoom: 14, duration: 0 });
      }
      fittedRef.current = true;
    }
  }, [pois, selectedId]);

  // The pin being created or edited: draggable, so the spot can be nudged.
  React.useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    if (!draft) {
      draftMarkerRef.current?.remove();
      draftMarkerRef.current = null;
      return;
    }

    const existing = draftMarkerRef.current;
    if (existing) {
      existing.setLngLat([draft.lng, draft.lat]);
    } else {
      const el = document.createElement("div");
      el.style.cssText = "width:26px;height:26px;";
      const dot = document.createElement("div");
      dot.style.cssText = `${DOT_CSS}cursor:grab;box-shadow:0 0 0 6px rgba(79,70,229,.25),0 2px 6px rgba(15,23,42,.35);`;
      el.appendChild(dot);
      const created = new maplibregl.Marker({ element: el, draggable: true })
        .setLngLat([draft.lng, draft.lat])
        .addTo(map);
      created.on("dragend", () => {
        const { lat, lng } = created.getLngLat();
        onPlaceRef.current(lat, lng);
      });
      draftMarkerRef.current = created;
    }

    const dot = draftMarkerRef.current?.getElement()
      .firstElementChild as HTMLElement | null;
    if (dot) dot.style.background = draftColor ?? poiColor("other");
  }, [draft, draftColor]);

  // Fly to the selection (reads the latest list via ref).
  React.useEffect(() => {
    const map = mapRef.current;
    if (!map || !selectedId) return;
    const poi = poisRef.current.find((p) => p.id === selectedId);
    if (!poi) return;
    map.flyTo({
      center: [poi.lng, poi.lat],
      zoom: Math.max(map.getZoom(), 15),
      duration: 800,
    });
  }, [selectedId, focusKey]);

  return (
    <div
      className={cn(
        "relative w-full overflow-hidden rounded-xl border bg-muted",
        className,
      )}
    >
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

      {placing && (
        <div className="absolute start-3 top-3 z-10 rounded-lg border bg-background/95 px-3 py-1.5 text-xs font-medium shadow-sm">
          {t("poi.placeHint")}
        </div>
      )}
      {!placing && draft && (
        <div className="absolute start-3 top-3 z-10 rounded-lg border bg-background/95 px-3 py-1.5 text-xs text-muted-foreground shadow-sm">
          {t("poi.dragHint")}
        </div>
      )}
    </div>
  );
}
