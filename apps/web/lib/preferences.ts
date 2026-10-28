"use client";

import * as React from "react";

import { ACCENT_COOKIE, ACCENTS, type Accent } from "@/lib/accent";

// Per-browser display preferences (Settings page + the live map's Layers
// menu). Each is stored in localStorage and broadcast with a window event, so
// every open map/panel updates the moment it changes - no reload.
//
//  - carIcon: how vehicles are drawn on the live map.
//  - mapMode: the map's own day/night look, independent of the UI theme
//             ("auto" follows the theme; a dark UI can have a day map).
//  - accent:  the interface colour. Also mirrored to a cookie so the server
//             renders <html data-accent> and the first paint has no flash.

export type CarIcon = "sedan" | "suv" | "arrow" | "classic";
export const CAR_ICONS: readonly CarIcon[] = ["sedan", "suv", "arrow", "classic"];

export type MapMode = "auto" | "day" | "night";
export const MAP_MODES: readonly MapMode[] = ["auto", "day", "night"];

const KEYS = {
  carIcon: "carva-car-icon",
  mapMode: "carva-map-mode",
  accent: "carva-accent",
} as const;

const EVENT = "carva-prefs";

function read<T extends string>(key: string, allowed: readonly T[], fallback: T): T {
  try {
    const v = localStorage.getItem(key);
    return v && (allowed as readonly string[]).includes(v) ? (v as T) : fallback;
  } catch {
    return fallback;
  }
}

function write(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* private mode: applies for this visit */
  }
  window.dispatchEvent(new CustomEvent(EVENT, { detail: { key, value } }));
}

/** Old "night map" on/off switch (pre-mapMode): "0" meant day. */
function legacyMapMode(): MapMode {
  try {
    return localStorage.getItem("carva-map-night") === "0" ? "day" : "auto";
  } catch {
    return "auto";
  }
}

/**
 * `initial` renders on the server AND the first client render (no hydration
 * mismatch); the saved value is read after mount via `load`.
 */
function usePref<T extends string>(key: string, allowed: readonly T[], initial: T, load: () => T) {
  const [value, setValue] = React.useState<T>(initial);
  React.useEffect(() => {
    setValue(load());
    const on = (e: Event) => {
      const d = (e as CustomEvent<{ key: string; value: string }>).detail;
      if (d?.key === key && (allowed as readonly string[]).includes(d.value)) setValue(d.value as T);
    };
    const onStorage = (e: StorageEvent) => e.key === key && setValue(load());
    window.addEventListener(EVENT, on);
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener(EVENT, on);
      window.removeEventListener("storage", onStorage);
    };
    // allowed/load are module-level at every call site
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  const set = React.useCallback((v: T) => {
    setValue(v);
    write(key, v);
  }, [key]);
  return [value, set] as const;
}

export function useCarIcon() {
  return usePref<CarIcon>(KEYS.carIcon, CAR_ICONS, "sedan", () => read(KEYS.carIcon, CAR_ICONS, "sedan"));
}

export function useMapMode() {
  return usePref<MapMode>(KEYS.mapMode, MAP_MODES, "auto", () => read(KEYS.mapMode, MAP_MODES, legacyMapMode()));
}

export function useAccent() {
  // The cookie (stamped on <html> by the server) is the source of truth.
  const [accent, setStored] = usePref<Accent>(KEYS.accent, ACCENTS, "gold", () => {
    const a = document.documentElement.dataset.accent;
    return (ACCENTS as readonly string[]).includes(a ?? "") ? (a as Accent) : "gold";
  });
  const set = React.useCallback(
    (a: Accent) => {
      document.documentElement.dataset.accent = a;
      document.cookie = `${ACCENT_COOKIE}=${a}; path=/; max-age=31536000; samesite=lax`;
      setStored(a);
    },
    [setStored],
  );
  return [accent, set] as const;
}
