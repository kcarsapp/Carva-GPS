"use client";

import * as React from "react";
import { createPortal } from "react-dom";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import {
  Check,
  Layers,
  LocateFixed,
  Maximize2,
  Minimize2,
  Moon,
  Navigation,
  Scan,
} from "lucide-react";

import { markerClass, markerHtml } from "@/lib/car-icons";
import { MAP_MODES, useCarIcon, useMapMode } from "@/lib/preferences";
import { VehicleDetail } from "@/components/dashboard/vehicle-detail";
import { DirectionsPanel, useDirections } from "@/components/dashboard/directions-panel";
import { cn } from "@/lib/utils";
import {
  STREET_ATTRIBUTION,
  STREET_MAX_ZOOM,
  STREET_TILES,
  SATELLITE_TILES,
  LABEL_TILES,
} from "@/lib/basemaps";
import { useI18n } from "@/lib/i18n-provider";
import { usePresence, prefersReducedMotion } from "@/lib/motion";
import { useTheme } from "@/lib/theme-provider";
import type { Vehicle, VehicleStatus } from "@/mock/types";


// Google tiles come through our own proxy so the API key never reaches the
// browser. They only appear as options once /api/maptile/status confirms
// Google is actually serving us (key present, billing enabled).
const GOOGLE_ROAD_TILES = ["/api/maptile/roadmap/{z}/{x}/{y}"];
const GOOGLE_SAT_TILES = ["/api/maptile/satellite/{z}/{x}/{y}"];

type Basemap = "streets" | "satellite" | "hybrid" | "google" | "googleSat";
const FREE_BASEMAPS: readonly Basemap[] = ["streets", "satellite", "hybrid"];
const GOOGLE_BASEMAPS: readonly Basemap[] = ["google", "googleSat"];

function tilesFor(basemap: Basemap): string[] {
  switch (basemap) {
    case "google":
      return GOOGLE_ROAD_TILES;
    case "googleSat":
      return GOOGLE_SAT_TILES;
    case "satellite":
    case "hybrid":
      return SATELLITE_TILES;
    default:
      return STREET_TILES;
  }
}

/** Marker glide between fixes. */
const GLIDE_MS = 1000;
/** Further than this is a reconnect, not driving - jump, don't glide. */
const GLIDE_MAX_METRES = 3000;

const STATUS_COLOR: Record<VehicleStatus, string> = {
  in_transit: "#10b981",
  idle: "#f59e0b",
  maintenance: "#ef4444",
  unknown: "#38bdf8",
  offline: "#94a3b8",
};

export function FleetMap({
  vehicles,
  selectedId,
  calloutId = null,
  onSelect,
  onMarkerSelect,
  onClose,
  className,
  controlsClassName,
  detailClassName,
  directionsClassName,
  canControl = false,
  showDetail = true,
  anchorDetail = false,
  allowDirections = true,
}: {
  vehicles: Vehicle[];
  selectedId: string | null;
  /** Vehicle whose anchored callout is shown. Kept separate from selectedId so
      picking a row in the roster does not also pop a card over the map. */
  calloutId?: string | null;
  onSelect: (id: string) => void;
  /** Fired only when a marker itself is clicked. Falls back to onSelect. */
  onMarkerSelect?: (id: string) => void;
  onClose?: () => void;
  className?: string;
  /** Enable live device controls (kill switch, commands) in the detail card. */
  canControl?: boolean;
  /** Render the floating detail card for the selection (default true). The
      fleet overview turns this off — details expand inline in the roster. */
  showDetail?: boolean;
  /** Pin the detail card to the selected marker instead of a fixed corner. */
  anchorDetail?: boolean;
  /** Position of the basemap/fullscreen controls (default: top-end corner). */
  controlsClassName?: string;
  /** Position of the selected-vehicle card (default: bottom-start corner). */
  detailClassName?: string;
  /** Position of the directions panel (default: bottom-end, above zoom). */
  directionsClassName?: string;
  /** In-map directions need an account (/api/directions); off in the demo. */
  allowDirections?: boolean;
}) {
  const { t } = useI18n();
  const selected = vehicles.find((v) => v.id === selectedId) ?? null;
  const callout = calloutId ? (vehicles.find((v) => v.id === calloutId) ?? null) : null;
  const rootRef = React.useRef<HTMLDivElement>(null);
  // The anchored callout lives INSIDE a MapLibre marker, so the library moves
  // it in the same frame as the car icon. Repositioning it from React after
  // each "move" event lagged a frame behind and slid around while panning.
  const [calloutEl, setCalloutEl] = React.useState<HTMLDivElement | null>(null);
  const containerRef = React.useRef<HTMLDivElement>(null);
  const mapRef = React.useRef<maplibregl.Map | null>(null);
  const markersRef = React.useRef<Map<string, maplibregl.Marker>>(new Map());
  const iconStyleRef = React.useRef<string | null>(null);
  const fittedRef = React.useRef(false);
  const closeRef = React.useRef(onClose);
  closeRef.current = onClose;
  const markerSelectRef = React.useRef<(id: string) => void>(() => {});
  markerSelectRef.current = onMarkerSelect ?? onSelect;
  const vehiclesRef = React.useRef(vehicles);
  vehiclesRef.current = vehicles;

  // Default style comes from Settings (localStorage); lazy init avoids an
  // SSR/client mismatch flash.
  const [basemap, setBasemapState] = React.useState<Basemap>("streets");
  React.useEffect(() => {
    const saved = localStorage.getItem("carva-basemap");
    if (saved && saved !== "streets") setBasemapState(saved as Basemap);
  }, []);
  const setBasemap = React.useCallback(
    (next: Basemap) => {
      setBasemapState(next);
      localStorage.setItem("carva-basemap", next);
    },
    [],
  );
  // Google basemaps are offered only when the server can actually mint a tile
  // session — otherwise the buttons would hand the user a blank grey map.
  const [googleOk, setGoogleOk] = React.useState(false);
  React.useEffect(() => {
    let alive = true;
    fetch("/api/maptile/status", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : { available: false }))
      .then((d: { available?: boolean }) => {
        if (!alive) return;
        const ok = d.available === true;
        setGoogleOk(ok);
        // A Google layer picked while Google worked stays saved in this
        // browser. If Google has since stopped serving (key revoked, billing
        // off), that saved choice would load a broken map on every visit, so
        // fall back to the free layer that looks closest.
        if (!ok) {
          setBasemapState((b) =>
            b === "google" ? "streets" : b === "googleSat" ? "satellite" : b,
          );
        }
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);
  const basemaps = React.useMemo(
    () => (googleOk ? [...FREE_BASEMAPS, ...GOOGLE_BASEMAPS] : FREE_BASEMAPS),
    [googleOk],
  );

  const [error, setError] = React.useState<string | null>(null);
  const [fullscreen, setFullscreen] = React.useState(false);

  // Follow camera: keeps the selected car centred as live fixes arrive.
  // Dragging the map hands control back to the user.
  const [follow, setFollow] = React.useState(false);

  // "My location": the browser's own position as a blue dot.
  const [locating, setLocating] = React.useState(false);
  const [locError, setLocError] = React.useState<string | null>(null);
  const [myPos, setMyPos] = React.useState<[number, number] | null>(null);
  const [routeToId, setRouteToId] = React.useState<string | null>(null);
  // While routing: camera keeps me and the car in view. A manual pan or zoom
  // turns it off, like follow mode.
  const [chase, setChase] = React.useState(true);
  // Directions panel minimised to the next turn. Starts that way on phones,
  // where the full turn list covered most of the route.
  const [dirCollapsed, setDirCollapsed] = React.useState(false);
  const watchIdRef = React.useRef<number | null>(null);
  const meMarkerRef = React.useRef<maplibregl.Marker | null>(null);

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
              maxzoom: STREET_MAX_ZOOM,
              attribution: STREET_ATTRIBUTION,
            },
            // Transparent labels, drawn over imagery in hybrid mode. Declared
            // up front so switching basemap never has to rebuild the style.
            labels: {
              type: "raster",
              tiles: LABEL_TILES,
              tileSize: 256,
              attribution: "© Esri",
            },
          },
          layers: [
            { id: "carto", type: "raster", source: "carto" },
            {
              id: "labels",
              type: "raster",
              source: "labels",
              layout: { visibility: "none" },
            },
          ],
        },
        // We render attribution ourselves — the built-in control keeps crediting
        // whichever source is declared, which mislabels Esri imagery as OpenStreetMap
        // once the basemap swaps.
        attributionControl: false,
        // Default view: Erbil, Iraq (Carva's home region).
        center: [44.0092, 36.1911],
        zoom: 11,
        // North stays up (there is no compass control), so a car's direction
        // pointer reads as a true compass heading.
        dragRotate: false,
        pitchWithRotate: false,
      });
      map.touchZoomRotate.disableRotation();
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

    // A click on open map dismisses the selection. Marker buttons call
    // stopPropagation, so picking a car still selects it instead of closing.
    map.on("click", () => closeRef.current?.());
    // dragstart fires only for a user drag, never for our own easeTo.
    map.on("dragstart", () => {
      setFollow(false);
      setChase(false);
    });
    // zoomstart also fires for our own fitBounds; only a user gesture carries
    // an originalEvent.
    map.on("zoomstart", (e) => {
      if ((e as { originalEvent?: Event }).originalEvent) setChase(false);
    });
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
    const map = mapRef.current;
    const src = map?.getSource("carto") as maplibregl.RasterTileSource | undefined;
    src?.setTiles(tilesFor(basemap));
    // Labels ride on top of imagery only; plain streets already has them.
    if (map?.getLayer("labels")) {
      map.setLayoutProperty(
        "labels",
        "visibility",
        basemap === "hybrid" ? "visible" : "none",
      );
    }
  }, [basemap]);

  // Night map: the OSM street tiles re-toned on the GPU (inverted, hue
  // restored, desaturated). Its own setting, independent of the UI theme
  // (Settings / Layers menu): "auto" follows the theme, or force day/night -
  // e.g. a dark interface over a day map. Imagery is never inverted.
  const { resolved: theme } = useTheme();
  const [mapMode, setMapMode] = useMapMode();
  const [carIcon] = useCarIcon();
  const nightWanted = mapMode === "night" || (mapMode === "auto" && theme === "dark");
  const night = nightWanted && (basemap === "streets" || basemap === "google");
  React.useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const apply = () => {
      if (!map.getLayer("carto")) return;
      map.setPaintProperty("carto", "raster-brightness-min", night ? 0.86 : 0);
      map.setPaintProperty("carto", "raster-brightness-max", night ? 0.07 : 1);
      map.setPaintProperty("carto", "raster-hue-rotate", night ? 180 : 0);
      map.setPaintProperty("carto", "raster-saturation", night ? -0.7 : 0);
      map.setPaintProperty("carto", "raster-contrast", night ? 0.08 : 0);
    };
    if (map.isStyleLoaded()) apply();
    else map.once("load", apply);
  }, [night]);

  // Marker glide: between two reported fixes a marker travels over ~1 s
  // instead of teleporting. It only ever moves along the straight line
  // between REAL positions and lands exactly on the new one - nothing is
  // extrapolated. Big jumps (a tracker reconnecting far away), hidden tabs and
  // reduced-motion users get the plain jump.
  const glidesRef = React.useRef<Map<string, number>>(new Map());
  const calloutIdRef = React.useRef<string | null>(null);
  calloutIdRef.current = calloutId;
  const glideMarker = (id: string, marker: maplibregl.Marker, to: [number, number]) => {
    const from = marker.getLngLat();
    const target = new maplibregl.LngLat(to[0], to[1]);
    const place = (ll: maplibregl.LngLatLike) => {
      marker.setLngLat(ll);
      // The anchored card rides with its car, frame for frame.
      if (calloutIdRef.current === id) calloutMarkerRef.current?.setLngLat(ll);
    };
    const running = glidesRef.current.get(id);
    if (running) cancelAnimationFrame(running);
    glidesRef.current.delete(id);
    const dist = from.distanceTo(target);
    if (dist < 0.5) return;
    if (dist > GLIDE_MAX_METRES || prefersReducedMotion() || document.hidden) {
      place(target);
      return;
    }
    const start = performance.now();
    const step = (now: number) => {
      const p = Math.min(1, (now - start) / GLIDE_MS);
      const e = 1 - Math.pow(1 - p, 3);
      place([from.lng + (target.lng - from.lng) * e, from.lat + (target.lat - from.lat) * e]);
      if (p < 1) glidesRef.current.set(id, requestAnimationFrame(step));
      else glidesRef.current.delete(id);
    };
    glidesRef.current.set(id, requestAnimationFrame(step));
  };
  React.useEffect(() => {
    const glides = glidesRef.current;
    return () => {
      glides.forEach((raf) => cancelAnimationFrame(raf));
      glides.clear();
    };
  }, []);

  /** Frames every vehicle that has a position. */
  const fitAll = React.useCallback(() => {
    const map = mapRef.current;
    if (!map) return;
    const pts = vehiclesRef.current.filter((v) => v.lat != null && v.lng != null);
    if (pts.length === 0) return;
    setFollow(false);
    if (pts.length === 1) {
      map.flyTo({ center: [pts[0].lng!, pts[0].lat!], zoom: 14, duration: 800 });
      return;
    }
    const b = new maplibregl.LngLatBounds();
    pts.forEach((v) => b.extend([v.lng!, v.lat!]));
    map.fitBounds(b, { padding: 90, maxZoom: 15, duration: 800 });
  }, []);

  // Layers popover (basemap + night map). Closes on outside press / Escape.
  const [layersOpen, setLayersOpen] = React.useState(false);
  const layers = usePresence(layersOpen, 140);
  const layersRef = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => {
    if (!layersOpen) return;
    const onDown = (e: PointerEvent) => {
      if (!layersRef.current?.contains(e.target as Node)) setLayersOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setLayersOpen(false);
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [layersOpen]);

  // Sync markers with the vehicle list.
  React.useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    // Vehicle icon style changed in Settings: rebuild every marker.
    if (iconStyleRef.current !== carIcon) {
      iconStyleRef.current = carIcon;
      markersRef.current.forEach((m) => m.remove());
      markersRef.current.clear();
    }

    const seen = new Set<string>();
    for (const v of vehicles) {
      if (v.lat == null || v.lng == null) continue;
      seen.add(v.id);

      let marker = markersRef.current.get(v.id);
      if (!marker) {
        // Outer element: MapLibre owns its `transform` for positioning — never
        // write transform here or the marker drifts when panning/zooming.
        const el = document.createElement("div");
        // Inner element: our visual (fleet.css `.vm`, lib/car-icons): the
        // chosen vehicle style, painted in the status colour; its
        // [data-heading] part turns to the GPS course (0deg = north).
        const inner = document.createElement("button");
        inner.type = "button";
        inner.className = markerClass(carIcon);
        inner.setAttribute("aria-label", v.name);
        inner.innerHTML = markerHtml(carIcon);
        // Via a ref: the listener is attached once when the marker is created,
        // so reading the prop directly would freeze the first render's callback.
        inner.addEventListener("click", (e) => {
          e.stopPropagation();
          markerSelectRef.current(v.id);
        });
        el.appendChild(inner);
        marker = new maplibregl.Marker({ element: el })
          .setLngLat([v.lng, v.lat])
          .addTo(map);
        markersRef.current.set(v.id, marker);
      } else {
        glideMarker(v.id, marker, [v.lng, v.lat]);
      }

      const outer = marker.getElement();
      const inner = outer.firstElementChild as HTMLElement | null;
      const selected = v.id === selectedId;
      outer.style.zIndex = selected ? "3" : "1";
      if (inner) {
        const color = STATUS_COLOR[v.status] ?? STATUS_COLOR.offline;
        inner.style.setProperty("--vm-color", color);
        inner.dataset.selected = String(selected);
        inner.classList.toggle("vm-offline", v.status === "offline");
        const pointer = inner.querySelector<HTMLElement>("[data-heading]");
        if (pointer) {
          // headingValid is false when parked: the heading is then the last
          // course seen while driving, so it is shown faded, not hidden.
          // Turn the short way: 350deg -> 10deg is +20, not a -340 spin.
          const target = Number.isFinite(v.heading) ? v.heading : 0;
          const prev = Number(pointer.dataset.angle ?? target);
          const angle = prev + ((((target - prev) % 360) + 540) % 360) - 180;
          pointer.dataset.angle = String(angle);
          pointer.style.transform = `rotate(${angle}deg)`;
          if (carIcon === "classic") {
            // Classic notch fades when parked (last course, not a live one).
            pointer.style.opacity = v.headingValid ? "1" : "0.45";
            pointer.querySelector("[data-heading-tip]")?.setAttribute("fill", color);
          }
        }
      }
    }

    // Drop markers for vehicles that disappeared.
    for (const [id, marker] of markersRef.current) {
      if (!seen.has(id)) {
        const raf = glidesRef.current.get(id);
        if (raf) cancelAnimationFrame(raf);
        glidesRef.current.delete(id);
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
  }, [vehicles, selectedId, onSelect, carIcon]);

  // Fly to the selected vehicle (reads latest positions via ref).
  React.useEffect(() => {
    const map = mapRef.current;
    if (!map || !selectedId) return;
    const v = vehiclesRef.current.find((x) => x.id === selectedId);
    if (v?.lat != null && v.lng != null) {
      // A card anchored to the marker hangs ABOVE it; centring the car would
      // push the top of a tall card under the toolbar. Land the car lower so
      // the whole card fits on screen.
      const anchored = anchorDetail && calloutIdRef.current === selectedId;
      const h = map.getContainer().clientHeight;
      map.flyTo({
        center: [v.lng, v.lat],
        zoom: Math.max(map.getZoom(), 13),
        offset: anchored ? [0, Math.round(h * 0.28)] : [0, 0],
        duration: 800,
      });
    }
    // anchorDetail is a fixed prop per page.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId]);

  // Follow the selected car. Each new fix re-centres the map; deselecting
  // the car ends follow mode.
  const followLat = selected?.lat;
  const followLng = selected?.lng;
  React.useEffect(() => {
    if (!selectedId) setFollow(false);
  }, [selectedId]);
  React.useEffect(() => {
    const map = mapRef.current;
    if (!map || !follow || followLat == null || followLng == null) return;
    map.easeTo({
      center: [followLng, followLat],
      zoom: Math.max(map.getZoom(), 15),
      duration: 800,
    });
  }, [follow, followLat, followLng]);

  const stopLocating = React.useCallback(() => {
    if (watchIdRef.current != null) {
      navigator.geolocation.clearWatch(watchIdRef.current);
      watchIdRef.current = null;
    }
    meMarkerRef.current?.remove();
    meMarkerRef.current = null;
    setMyPos(null);
    setLocating(false);
  }, []);
  React.useEffect(() => stopLocating, [stopLocating]);

  /** Starts the location watch; `fly` centres the map on the first fix. */
  const startLocating = React.useCallback((fly: boolean) => {
    if (watchIdRef.current != null) return true;
    if (!("geolocation" in navigator)) {
      setLocError(t("map.locUnavailable"));
      return false;
    }
    setLocError(null);
    setLocating(true);
    let first = fly;
    watchIdRef.current = navigator.geolocation.watchPosition(
      (pos) => {
        const map = mapRef.current;
        if (!map) return;
        setMyPos([pos.coords.latitude, pos.coords.longitude]);
        const lngLat: [number, number] = [pos.coords.longitude, pos.coords.latitude];
        if (!meMarkerRef.current) {
          const el = document.createElement("div");
          el.style.cssText = "position:relative;width:18px;height:18px;pointer-events:none;";
          el.innerHTML =
            '<span class="absolute inset-0 animate-ping rounded-full bg-sky-400 opacity-60"></span>' +
            '<span style="position:absolute;inset:0;border-radius:9999px;background:#0ea5e9;border:3px solid #fff;box-shadow:0 1px 4px rgba(15,23,42,.45)"></span>';
          meMarkerRef.current = new maplibregl.Marker({ element: el })
            .setLngLat(lngLat)
            .addTo(map);
        } else {
          meMarkerRef.current.setLngLat(lngLat);
        }
        if (first) {
          first = false;
          map.flyTo({ center: lngLat, zoom: Math.max(map.getZoom(), 15), duration: 800 });
        }
      },
      (err) => {
        stopLocating();
        setLocError(
          err.code === err.PERMISSION_DENIED
            ? t("map.locDenied")
            : t("map.locUnavailable"),
        );
      },
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 20000 },
    );
    return true;
  }, [stopLocating, t]);

  const toggleMyLocation = React.useCallback(() => {
    if (watchIdRef.current != null) {
      stopLocating();
      return;
    }
    // Showing yourself and following a car would fight over the camera.
    setFollow(false);
    startLocating(true);
  }, [startLocating, stopLocating]);

  // In-map directions from my location to a car. The route is re-fetched as
  // either end moves, so it also works for driving after a moving car.
  const routeCar = routeToId ? (vehicles.find((v) => v.id === routeToId) ?? null) : null;
  const routeTarget = React.useMemo<[number, number] | null>(
    () =>
      routeCar?.lat != null && routeCar.lng != null ? [routeCar.lat, routeCar.lng] : null,
    [routeCar?.lat, routeCar?.lng],
  );
  const directions = useDirections(myPos, routeTarget, !!routeToId);
  const startDirections = React.useCallback(
    (id: string) => {
      if (!startLocating(false)) return;
      setRouteToId(id);
      setFollow(false);
      setChase(true);
      setDirCollapsed(window.matchMedia("(max-width: 640px)").matches);
      lastChaseRef.current = 0;
      closeRef.current?.();
    },
    [startLocating],
  );
  const endDirections = React.useCallback(() => setRouteToId(null), []);
  // Losing location (switched off, denied) ends directions too.
  React.useEffect(() => {
    if (!locating) setRouteToId(null);
  }, [locating]);

  // Draw the route under the car markers (markers are DOM, above canvas).
  // Between re-routes both ends keep moving, so dashed "gap" lines join the
  // last route to where I and the car are NOW - the line never looks stuck
  // behind a moving car.
  React.useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const coords = routeToId ? directions.route?.coordinates : undefined;
    const features: GeoJSON.Feature<GeoJSON.LineString>[] = [];
    if (coords && coords.length > 1) {
      features.push({
        type: "Feature",
        properties: { kind: "route" },
        geometry: { type: "LineString", coordinates: coords },
      });
      const gap = (a: [number, number] | null, b: number[]) =>
        a &&
        features.push({
          type: "Feature",
          properties: { kind: "gap" },
          // a is [lat, lng]; GeoJSON wants [lng, lat].
          geometry: { type: "LineString", coordinates: [[a[1], a[0]], b] },
        });
      gap(myPos, coords[0]);
      gap(routeTarget, coords[coords.length - 1]);
    }
    const draw = () => {
      const data: GeoJSON.FeatureCollection = { type: "FeatureCollection", features };
      const src = map.getSource("directions") as maplibregl.GeoJSONSource | undefined;
      if (src) {
        src.setData(data);
        return;
      }
      map.addSource("directions", { type: "geojson", data });
      const isRoute: maplibregl.FilterSpecification = ["==", ["get", "kind"], "route"];
      map.addLayer({
        id: "directions-casing",
        type: "line",
        source: "directions",
        filter: isRoute,
        layout: { "line-cap": "round", "line-join": "round" },
        paint: { "line-color": "#ffffff", "line-width": 9, "line-opacity": 0.9 },
      });
      map.addLayer({
        id: "directions-line",
        type: "line",
        source: "directions",
        filter: isRoute,
        layout: { "line-cap": "round", "line-join": "round" },
        paint: { "line-color": "#2563eb", "line-width": 5 },
      });
      map.addLayer({
        id: "directions-gap",
        type: "line",
        source: "directions",
        filter: ["==", ["get", "kind"], "gap"],
        layout: { "line-cap": "round" },
        paint: { "line-color": "#2563eb", "line-width": 3, "line-dasharray": [1, 1.5] },
      });
    };
    if (map.isStyleLoaded()) draw();
    else map.once("load", draw);
  }, [routeToId, directions.route, myPos, routeTarget]);

  // Chase camera: keep me and the car both on screen as we both move.
  // Throttled so a 1 Hz phone GPS does not keep the map permanently animating.
  const lastChaseRef = React.useRef(0);
  React.useEffect(() => {
    const map = mapRef.current;
    if (!map || !routeToId || !chase || !myPos || !routeTarget) return;
    const now = Date.now();
    if (now - lastChaseRef.current < 2000) return;
    lastChaseRef.current = now;
    const b = new maplibregl.LngLatBounds();
    b.extend([myPos[1], myPos[0]]);
    b.extend([routeTarget[1], routeTarget[0]]);
    // Frame inside the free part of the map: the toolbar covers the top and
    // the directions panel the end side (left in Arabic/Kurdish), on screens
    // wide enough for it to sit beside the map instead of over it.
    const el = map.getContainer();
    const rtl = getComputedStyle(el).direction === "rtl";
    // Panel (20rem) + the control column beside it (~4.25rem) on wide maps.
    const panelSide = el.clientWidth >= 720 ? 410 : 60;
    map.fitBounds(b, {
      padding: {
        top: 150,
        // On narrow maps the panel sits at the bottom: leave room for it,
        // far less when it is minimised to the next-turn bar.
        bottom: el.clientWidth >= 720 ? 70 : dirCollapsed ? 150 : 300,
        left: rtl ? panelSide : 80,
        right: rtl ? 80 : panelSide,
      },
      maxZoom: 17,
      duration: 700,
    });
  }, [routeToId, chase, myPos, routeTarget, dirCollapsed]);

  React.useEffect(() => {
    if (!locError) return;
    const id = setTimeout(() => setLocError(null), 6000);
    return () => clearTimeout(id);
  }, [locError]);

  // Anchored callout: a marker whose element hosts the card (via a portal).
  const calloutLat = callout?.lat;
  const calloutLng = callout?.lng;
  const calloutMarkerRef = React.useRef<maplibregl.Marker | null>(null);
  const hasCallout = anchorDetail && !!callout && calloutLat != null && calloutLng != null;
  React.useEffect(() => {
    const map = mapRef.current;
    if (!map || !hasCallout) return;
    const el = document.createElement("div");
    el.style.zIndex = "10";
    // Inside the card, drags, scrolls and double-clicks belong to the card -
    // they must not pan or zoom the map underneath it.
    for (const type of ["mousedown", "touchstart", "wheel", "dblclick", "pointerdown"]) {
      el.addEventListener(type, (e) => e.stopPropagation());
    }
    const marker = new maplibregl.Marker({ element: el, anchor: "bottom", offset: [0, -16] })
      .setLngLat([calloutLng as number, calloutLat as number])
      .addTo(map);
    calloutMarkerRef.current = marker;
    setCalloutEl(el);
    return () => {
      marker.remove();
      calloutMarkerRef.current = null;
      setCalloutEl(null);
    };
    // Recreated only when the callout opens/closes or switches vehicle; live
    // position updates are applied below without rebuilding the card.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasCallout, callout?.id]);
  React.useEffect(() => {
    // While its car is gliding, the glide moves the card frame by frame;
    // jumping it to the new fix here would leave it ahead of the car.
    if (calloutId && glidesRef.current.has(calloutId)) return;
    if (calloutLat != null && calloutLng != null) {
      calloutMarkerRef.current?.setLngLat([calloutLng, calloutLat]);
    }
  }, [calloutId, calloutLat, calloutLng]);

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

      {/* Map controls: one vertical column of glass buttons on the trailing
          edge at every width (Apple-Maps style). A single column can't
          collide with the roster on a phone the way a horizontal row did. */}
      <div
        className={cn(
          "slide-from-end absolute z-10 flex flex-col items-end gap-2",
          controlsClassName ?? "end-3 top-3",
        )}
      >
        <div ref={layersRef} className="relative">
          <button
            type="button"
            onClick={() => setLayersOpen((o) => !o)}
            aria-expanded={layersOpen}
            aria-haspopup="menu"
            aria-label={t("map.layers")}
            title={t("map.layers")}
            className="map-ctl press glass"
          >
            <Layers className="h-[18px] w-[18px]" />
          </button>
          {layers.mounted && (
            <div
              role="menu"
              aria-label={t("map.layers")}
              className={cn(
                "glass glass-strong absolute end-0 top-full z-20 mt-2 w-52 rounded-xl p-1.5 ltr:origin-top-right rtl:origin-top-left",
                layers.leaving ? "pop-out" : "pop",
              )}
            >
              <p className="eyebrow px-2.5 pb-1 pt-1.5">{t("map.layers")}</p>
              {basemaps.map((b) => (
                <button
                  key={b}
                  type="button"
                  role="menuitemradio"
                  aria-checked={basemap === b}
                  onClick={() => {
                    setBasemap(b);
                    setLayersOpen(false);
                  }}
                  className={cn(
                    "press flex w-full items-center justify-between gap-2 rounded-lg px-2.5 py-2 text-sm",
                    basemap === b
                      ? "bg-primary/15 font-semibold text-foreground"
                      : "text-muted-foreground hover:bg-accent hover:text-foreground",
                  )}
                >
                  {t(`ctrl.${b}`)}
                  {basemap === b && <Check className="h-4 w-4 text-[hsl(var(--gold))]" />}
                </button>
              ))}
              {/* Map look, independent of the interface theme. */}
              <div className="mx-2 my-1.5 h-px bg-border" />
              <p className="eyebrow flex items-center gap-1.5 px-2.5 pb-1.5 pt-1">
                <Moon className="h-3.5 w-3.5" />
                {t("map.look")}
              </p>
              <div role="radiogroup" aria-label={t("map.look")} className="mx-1.5 mb-1 grid grid-cols-3 gap-1 rounded-lg bg-muted/60 p-1">
                {MAP_MODES.map((m) => (
                  <button
                    key={m}
                    type="button"
                    role="radio"
                    aria-checked={mapMode === m}
                    onClick={() => setMapMode(m)}
                    className={cn(
                      "press rounded-md px-1 py-1.5 text-xs font-medium",
                      mapMode === m ? "bg-card text-foreground shadow-sm ring-1 ring-primary/30" : "text-muted-foreground hover:text-foreground",
                    )}
                  >
                    {t(`map.look.${m}`)}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
        <button
          type="button"
          onClick={() => setFollow((f) => !f)}
          disabled={!selected || selected.lat == null}
          aria-pressed={follow}
          aria-label={t("map.follow")}
          title={selected ? t("map.followHint") : t("map.followNeedsCar")}
          className="map-ctl press glass disabled:cursor-not-allowed disabled:text-muted-foreground/60"
        >
          <Navigation className="h-[18px] w-[18px]" />
        </button>
        <button
          type="button"
          onClick={toggleMyLocation}
          aria-pressed={locating}
          aria-label={t("map.myLocation")}
          title={t("map.myLocation")}
          className="map-ctl press glass"
        >
          <LocateFixed className="h-[18px] w-[18px]" />
        </button>
        <button
          type="button"
          onClick={fitAll}
          aria-label={t("map.fitAll")}
          title={t("map.fitAll")}
          className="map-ctl press glass"
        >
          <Scan className="h-[18px] w-[18px]" />
        </button>
        <button
          type="button"
          onClick={toggleFullscreen}
          aria-label={fullscreen ? t("map.exitFullscreen") : t("map.fullscreen")}
          title={fullscreen ? t("map.exitFullscreen") : t("map.fullscreen")}
          className="map-ctl press glass"
        >
          {fullscreen ? (
            <Minimize2 className="h-[18px] w-[18px]" />
          ) : (
            <Maximize2 className="h-[18px] w-[18px]" />
          )}
        </button>
      </div>

      {/* Anchored callout: ONLY when a map marker was clicked. Selecting a row
          in the roster highlights the marker but must not pop a card here too. */}
      {anchorDetail
        ? callout &&
          calloutEl &&
          showDetail !== false &&
          createPortal(
            // Rendered into the callout marker: it is glued to the car icon by
            // MapLibre itself, through every pan and zoom.
            <div className="relative pb-3">
              <VehicleDetail
                vehicle={callout}
                onClose={() => onClose?.()}
                canControl={canControl}
                onDirections={allowDirections ? () => startDirections(callout.id) : undefined}
                compact
              />
              {/* Pointer aimed at the car icon. */}
              <span className="absolute bottom-1 start-1/2 h-3 w-3 -translate-x-1/2 rotate-45 border-b border-e bg-card shadow-xl" />
            </div>,
            calloutEl,
          )
        : selected &&
          showDetail !== false && (
            // Fixed-corner card, used by views that don't anchor to the marker.
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
                onDirections={allowDirections ? () => startDirections(selected.id) : undefined}
              />
            </div>
          )}

      {/* Attribution for whatever is actually on screen. The built-in control
          credited the street map even while showing Esri imagery, which is wrong. */}
      <div className="pointer-events-auto absolute bottom-0 start-0 z-10 max-w-full truncate bg-background/70 px-1.5 py-0.5 text-[10px] text-muted-foreground backdrop-blur-sm">
        {basemap === "google" || basemap === "googleSat" ? (
          <>© Google</>
        ) : basemap === "streets" ? (
          <>
            ©{" "}
            <a
              href="https://www.openstreetmap.org/copyright"
              target="_blank"
              rel="noopener noreferrer"
              className="hover:underline"
            >
              OpenStreetMap
            </a>{" "}
            contributors
          </>
        ) : (
          <>© Esri, Maxar, Earthstar Geographics</>
        )}{" "}
        |{" "}
        <a
          href="https://maplibre.org/"
          target="_blank"
          rel="noopener noreferrer"
          className="hover:underline"
        >
          MapLibre
        </a>
      </div>

      {routeToId && (
        <DirectionsPanel
          car={routeCar}
          origin={myPos}
          route={directions.route}
          routeAt={directions.routeAt}
          error={directions.error}
          loading={directions.loading}
          closingKmh={directions.closingKmh}
          chase={chase}
          onToggleChase={() => {
            lastChaseRef.current = 0;
            setChase((c) => !c);
          }}
          collapsed={dirCollapsed}
          onToggleCollapsed={() => {
            lastChaseRef.current = 0; // re-frame for the new panel size
            setDirCollapsed((c) => !c);
          }}
          onRetry={directions.retry}
          onClose={endDirections}
          className={cn(
            "slide-from-end",
            directionsClassName ?? "bottom-3 end-3 md:bottom-6 md:end-[4.25rem]",
          )}
        />
      )}

      {locError && (
        <div className="absolute bottom-10 left-1/2 z-30 max-w-[calc(100%-2rem)] -translate-x-1/2 rounded-lg border bg-background px-3 py-2 text-xs text-foreground shadow-lg">
          {locError}
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
