"use client";

import * as React from "react";

// Street address for a vehicle's position, via our own /api/geocode proxy
// (Nominatim behind a 24 h server cache - Traccar's geocoder is off on the VPS).
//
// Shared by every surface that names a place, so two panels open on the same
// car never fire two lookups or disagree on the street.

/**
 * The coordinates of a live car change on every report, so the lookup is
 * keyed to a ~110 m grid cell (3 decimal places). The server cache (4 dp)
 * then actually hits, and Nominatim sees one request per block travelled
 * rather than one every few seconds.
 */
export function useAddress(
  key: string | null | undefined,
  lat: number | null | undefined,
  lng: number | null | undefined,
): { address: string | null; loading: boolean } {
  const [address, setAddress] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(false);
  const gLat = lat != null && Number.isFinite(lat) ? lat.toFixed(3) : null;
  const gLng = lng != null && Number.isFinite(lng) ? lng.toFixed(3) : null;
  const keyRef = React.useRef(key);

  React.useEffect(() => {
    // Only blank the line when switching to a DIFFERENT vehicle; refreshing the
    // same one keeps the last street visible instead of flickering "Locating…".
    if (keyRef.current !== key) {
      keyRef.current = key;
      setAddress(null);
    }
    if (gLat == null || gLng == null) {
      setLoading(false); // never leave "Locating…" up for a car with no fix
      return;
    }
    let alive = true;
    const ctrl = new AbortController();
    setLoading(true);
    fetch(`/api/geocode?lat=${gLat}&lon=${gLng}`, { cache: "no-store", signal: ctrl.signal })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d: { address?: string }) => alive && setAddress(d.address || null))
      .catch(() => {})
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
      ctrl.abort();
    };
  }, [key, gLat, gLng]);

  return { address, loading };
}
