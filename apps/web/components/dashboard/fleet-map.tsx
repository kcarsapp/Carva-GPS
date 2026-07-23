"use client";

import * as React from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { Maximize2, Minimize2 } from "lucide-react";

import { vehicleSvg } from "@/app/app/icons";
import { VehicleDetail } from "@/components/dashboard/vehicle-detail";
import { cn } from "@/lib/utils";
import { useI18n } from "@/lib/i18n-provider";
import type { Vehicle, VehicleStatus } from "@/mock/types";

// CARTO Voyager (no API key) for streets; Esri World Imagery for satellite.
const STREET_TILES = [
  "https://a.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}@2x.png",
  "https://b.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}@2x.png",
  "https://c.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}@2x.png",
];
const SATELLITE_TILES = [
  "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
];

const STATUS_COLOR: Record<VehicleStatus, string> = {
  in_transit: "#10b981",
  idle: "#f59e0b",
  maintenance: "#ef4444",
  offline: "#94a3b8",
};

export function FleetMap({
  vehicles,
  selectedId,
  onSelect,
  onClose,
  className,
  controlsClassName,
  detailClassName,
  canControl = false,
}: {
  vehicles: Vehicle[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onClose?: () => void;
  className?: string;
  /** Enable live device controls (kill switch, commands) in the detail card. */
  canControl?: boolean;
  /** Position of the basemap/fullscreen controls (default: top-end corner). */
  controlsClassName?: string;
  /** Position of the selected-vehicle card (default: bottom-start corner). */
  detailClassName?: string;
}) {
  const { t } = useI18n();
  const selected = vehicles.find((v) => v.id === selectedId) ?? null;
  const rootRef = React.useRef<HTMLDivElement>(null);
  const containerRef = React.useRef<HTMLDivElement>(null);
  const mapRef = React.useRef<maplibregl.Map | null>(null);
  const markersRef = React.useRef<Map<string, maplibregl.Marker>>(new Map());
  const fittedRef = React.useRef(false);
  const vehiclesRef = React.useRef(vehicles);
  vehiclesRef.current = vehicles;

  const [basemap, setBasemap] = React.useState<"streets" | "satellite">(
    "streets",
  );
  const [error, setError] = React.useState<string | null>(null);
  const [fullscreen, setFullscreen] = React.useState(false);

  const toggleFullscreen = React.useCallback(() => {
    if (document.fullscreenElement) {
      document.exitFullscreen?.();
    } else {
      rootRef.current?.requestFullscreen?.();
    }
  }, []);

  // Track fullscreen state; the ResizeObserver already re-fits the canvas.
  React.useEffect(() => {
    const onChange = () =>
      setFullscreen(document.fullscreenElement === rootRef.current);
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  // Init the map once.
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
              attribution: "© OpenStreetMap contributors © CARTO",
            },
          },
          layers: [{ id: "carto", type: "raster", source: "carto" }],
        },
        // Default view: Erbil, Iraq (Carva's home region).
        center: [44.0092, 36.1911],
        zoom: 11,
      });
    } catch (e) {
      setError(
        (e as Error)?.message ??
          "Map failed to initialize (WebGL may be unavailable).",
      );
      return;
    }

    map.addControl(
      new maplibregl.NavigationControl({ showCompass: false }),
      "bottom-right",
    );
    map.on("error", (e) => {
      // Surface tile / style errors instead of failing silently.
      // eslint-disable-next-line no-console
      console.error("[FleetMap]", e.error);
    });

    mapRef.current = map;

    // The container's final height often lands a tick after init (CSS settling),
    // leaving a 0-size canvas. Force a re-measure now and whenever it resizes.
    const resize = () => map.resize();
    map.once("load", resize);
    requestAnimationFrame(resize);
    const t = setTimeout(resize, 300);
    const ro = new ResizeObserver(resize);
    ro.observe(containerRef.current);

    return () => {
      clearTimeout(t);
      ro.disconnect();
      map.remove();
      mapRef.current = null;
    };
  }, []);

  // Swap basemap tiles.
  React.useEffect(() => {
    const src = mapRef.current?.getSource("carto") as
      | maplibregl.RasterTileSource
      | undefined;
    src?.setTiles(basemap === "satellite" ? SATELLITE_TILES : STREET_TILES);
  }, [basemap]);

  // Sync markers with the vehicle list.
  React.useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const seen = new Set<string>();
    for (const v of vehicles) {
      if (v.lat == null || v.lng == null) continue;
      seen.add(v.id);

      let marker = markersRef.current.get(v.id);
      if (!marker) {
        // Outer element: MapLibre owns its `transform` for positioning — never
        // write transform here or the marker drifts when panning/zooming.
        const el = document.createElement("div");
        // Inner element: our visual; scale/outline live here, not on the outer.
        const inner = document.createElement("button");
        inner.type = "button";
        inner.setAttribute("aria-label", v.name);
        inner.style.cssText =
          "width:32px;height:32px;border-radius:9999px;display:grid;place-items:center;color:#fff;border:2px solid #fff;box-shadow:0 2px 6px rgba(15,23,42,.35);cursor:pointer;transition:transform .15s ease;";
        inner.innerHTML = `<span style="width:17px;height:17px;display:block">${vehicleSvg(null)}</span>`;
        inner.addEventListener("click", (e) => {
          e.stopPropagation();
          onSelect(v.id);
        });
        el.appendChild(inner);
        marker = new maplibregl.Marker({ element: el })
          .setLngLat([v.lng, v.lat])
          .addTo(map);
        markersRef.current.set(v.id, marker);
      } else {
        marker.setLngLat([v.lng, v.lat]);
      }

      const outer = marker.getElement();
      const inner = outer.firstElementChild as HTMLElement | null;
      const selected = v.id === selectedId;
      outer.style.zIndex = selected ? "3" : "1";
      if (inner) {
        inner.style.background = STATUS_COLOR[v.status] ?? STATUS_COLOR.offline;
        inner.style.transform = selected ? "scale(1.25)" : "scale(1)";
        inner.style.outline = selected
          ? "3px solid rgba(79,70,229,.45)"
          : "none";
        inner.style.outlineOffset = "2px";
      }
    }

    // Drop markers for vehicles that disappeared.
    for (const [id, marker] of markersRef.current) {
      if (!seen.has(id)) {
        marker.remove();
        markersRef.current.delete(id);
      }
    }

    // Fit to all vehicles on first load.
    if (!fittedRef.current) {
      const pts = vehicles.filter((v) => v.lat != null && v.lng != null);
      if (pts.length === 1) {
        map.jumpTo({ center: [pts[0].lng!, pts[0].lat!], zoom: 13 });
        fittedRef.current = true;
      } else if (pts.length > 1) {
        const b = new maplibregl.LngLatBounds();
        pts.forEach((v) => b.extend([v.lng!, v.lat!]));
        map.fitBounds(b, { padding: 64, maxZoom: 12, duration: 0 });
        fittedRef.current = true;
      }
    }
  }, [vehicles, selectedId, onSelect]);

  // Fly to the selected vehicle (reads latest positions via ref).
  React.useEffect(() => {
    const map = mapRef.current;
    if (!map || !selectedId) return;
    const v = vehiclesRef.current.find((x) => x.id === selectedId);
    if (v?.lat != null && v.lng != null) {
      map.flyTo({
        center: [v.lng, v.lat],
        zoom: Math.max(map.getZoom(), 13),
        duration: 800,
      });
    }
  }, [selectedId]);

  return (
    <div
      ref={rootRef}
      className={cn(
        "relative w-full overflow-hidden rounded-xl border bg-muted",
        className,
      )}
      // Inline style wins over the external `className` height in fullscreen.
      style={fullscreen ? { height: "100vh", borderRadius: 0 } : undefined}
    >
      <div ref={containerRef} className="absolute inset-0 h-full w-full" />

      <div
        className={cn(
          "absolute z-10 flex items-center gap-2",
          controlsClassName ?? "end-3 top-3",
        )}
      >
        <div className="flex overflow-hidden rounded-lg border bg-background shadow-sm">
          {(["streets", "satellite"] as const).map((b) => (
            <button
              key={b}
              type="button"
              onClick={() => setBasemap(b)}
              className={cn(
                "px-3 py-1.5 text-xs font-medium capitalize transition-colors",
                basemap === b
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:bg-accent hover:text-foreground",
              )}
            >
              {t(`ctrl.${b}`)}
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={toggleFullscreen}
          aria-label={fullscreen ? "Exit fullscreen" : "Fullscreen map"}
          title={fullscreen ? "Exit fullscreen" : "Fullscreen"}
          className="flex h-8 w-8 items-center justify-center rounded-lg border bg-background text-muted-foreground shadow-sm transition-colors hover:bg-accent hover:text-foreground"
        >
          {fullscreen ? (
            <Minimize2 className="h-4 w-4" />
          ) : (
            <Maximize2 className="h-4 w-4" />
          )}
        </button>
      </div>

      {selected && (
        <div
          className={cn(
            "absolute z-20 max-w-[calc(100%-1.5rem)]",
            detailClassName ?? "bottom-3 start-3",
          )}
        >
          <VehicleDetail
            vehicle={selected}
            onClose={() => onClose?.()}
            canControl={canControl}
          />
        </div>
      )}

      {error && (
        <div className="absolute inset-0 z-30 grid place-items-center bg-background/90 p-6 text-center">
          <div>
            <p className="text-sm font-semibold text-destructive">
              Map couldn&apos;t load
            </p>
            <p className="mt-1 text-xs text-muted-foreground">{error}</p>
          </div>
        </div>
      )}
    </div>
  );
}
