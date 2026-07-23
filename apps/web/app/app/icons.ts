// Vehicle category icons — Material-style silhouettes as inline SVG strings,
// usable both in raw-DOM map markers and in React (via dangerouslySetInnerHTML).
// Icons fill with `currentColor`, so colour is controlled entirely by CSS.

export type VehicleKind = 'car' | 'truck' | 'bus' | 'motorcycle' | 'default';

// Traccar device categories (and common synonyms) -> our icon set.
const ALIASES: Record<string, VehicleKind> = {
  car: 'car', sedan: 'car', suv: 'car', taxi: 'car', offroad: 'car',
  van: 'truck', truck: 'truck', pickup: 'truck', trailer: 'truck', tractor: 'truck',
  bus: 'bus', minibus: 'bus',
  motorcycle: 'motorcycle', scooter: 'motorcycle', bicycle: 'motorcycle', moped: 'motorcycle',
  // explicitly non-vehicle assets get the location pin
  person: 'default', pet: 'default', animal: 'default', asset: 'default', tag: 'default', boat: 'default', ship: 'default',
};

/** Map a Traccar category to an icon kind. Missing category defaults to a car. */
export function vehicleKind(category?: string | null): VehicleKind {
  if (!category) return 'car';
  return ALIASES[category.toLowerCase()] ?? 'car';
}

const PATHS: Record<VehicleKind, string> = {
  car: 'M18.92 6.01C18.72 5.42 18.16 5 17.5 5h-11c-.66 0-1.21.42-1.42 1.01L3 12v8c0 .55.45 1 1 1h1c.55 0 1-.45 1-1v-1h12v1c0 .55.45 1 1 1h1c.55 0 1-.45 1-1v-8l-2.08-5.99zM6.5 16c-.83 0-1.5-.67-1.5-1.5S5.67 13 6.5 13s1.5.67 1.5 1.5S7.33 16 6.5 16zm11 0c-.83 0-1.5-.67-1.5-1.5s.67-1.5 1.5-1.5 1.5.67 1.5 1.5-.67 1.5-1.5 1.5zM5 11l1.5-4.5h11L19 11H5z',
  truck: 'M20 8h-3V4H3c-1.1 0-2 .9-2 2v11h2c0 1.66 1.34 3 3 3s3-1.34 3-3h6c0 1.66 1.34 3 3 3s3-1.34 3-3h2v-5l-3-4zM6 18.5c-.83 0-1.5-.67-1.5-1.5s.67-1.5 1.5-1.5 1.5.67 1.5 1.5-.67 1.5-1.5 1.5zm13.5-9l1.96 2.5H17V9.5h2.5zM18 18.5c-.83 0-1.5-.67-1.5-1.5s.67-1.5 1.5-1.5 1.5.67 1.5 1.5-.67 1.5-1.5 1.5z',
  bus: 'M4 16c0 .88.39 1.67 1 2.22V20c0 .55.45 1 1 1h1c.55 0 1-.45 1-1v-1h8v1c0 .55.45 1 1 1h1c.55 0 1-.45 1-1v-1.78c.61-.55 1-1.34 1-2.22V6c0-3.5-3.58-4-8-4s-8 .5-8 4v10zm3.5 1c-.83 0-1.5-.67-1.5-1.5S6.67 14 7.5 14s1.5.67 1.5 1.5S8.33 17 7.5 17zm9 0c-.83 0-1.5-.67-1.5-1.5s.67-1.5 1.5-1.5 1.5.67 1.5 1.5-.67 1.5-1.5 1.5zm1.5-6H6V6h12v5z',
  motorcycle: 'M19.44 9.03L15.41 5H11v2h3.59l2 2H5c-2.8 0-5 2.2-5 5s2.2 5 5 5c2.46 0 4.45-1.69 4.9-4h1.65l2.77-2.77c-.21.54-.32 1.14-.32 1.77 0 2.8 2.2 5 5 5s5-2.2 5-5c0-2.79-2.21-4.97-4.56-4.97zM7.82 15C7.4 16.15 6.28 17 5 17c-1.63 0-3-1.37-3-3s1.37-3 3-3c1.28 0 2.4.85 2.82 2H5v2h2.82zM19 17c-1.63 0-3-1.37-3-3s1.37-3 3-3 3 1.37 3 3-1.37 3-3 3z',
  default: 'M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z',
};

/** Inline SVG markup for a category's icon (fills with currentColor). */
export function vehicleSvg(category?: string | null): string {
  return `<svg viewBox="0 0 24 24" fill="currentColor" width="100%" height="100%" aria-hidden="true"><path d="${PATHS[vehicleKind(category)]}"/></svg>`;
}

export const VEHICLE_KINDS = Object.keys(PATHS) as VehicleKind[];

/** Raster (white glyph) for a kind, to register as a MapLibre GL icon image. */
export function vehicleIconImageData(kind: VehicleKind, px = 64): ImageData {
  const canvas = document.createElement('canvas');
  canvas.width = px;
  canvas.height = px;
  const ctx = canvas.getContext('2d')!;
  ctx.scale(px / 24, px / 24); // SVG paths use a 24x24 viewBox
  ctx.fillStyle = '#ffffff';
  ctx.fill(new Path2D(PATHS[kind]));
  return ctx.getImageData(0, 0, px, px);
}
