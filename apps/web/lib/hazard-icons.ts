// Map icons for speed cameras and speed bumps, drawn on a canvas so each
// camera can carry its own speed-limit roundel ("60", "80"...) without a
// glyph server. Original artwork in a friendly, chunky road-app style.
//
// Browser-only (uses <canvas>).

import type maplibregl from "maplibre-gl";

/** Logical size in CSS pixels; drawn at 2× for sharp edges. */
const SIZE = 44;
const RATIO = 2;

function canvas() {
  const c = document.createElement("canvas");
  c.width = SIZE * RATIO;
  c.height = SIZE * RATIO;
  const ctx = c.getContext("2d")!;
  ctx.scale(RATIO, RATIO);
  return { c, ctx };
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/** Red badge with a white camera, and the limit in a road-sign roundel. */
function drawCamera(limit: number | null): HTMLCanvasElement {
  const { c, ctx } = canvas();
  const cx = 20;
  const cy = 20;

  // Badge with a soft drop shadow and a white rim.
  ctx.save();
  ctx.shadowColor = "rgba(15,23,42,.35)";
  ctx.shadowBlur = 4;
  ctx.shadowOffsetY = 1.5;
  ctx.beginPath();
  ctx.arc(cx, cy, 16, 0, Math.PI * 2);
  ctx.fillStyle = "#ffffff";
  ctx.fill();
  ctx.restore();
  const grad = ctx.createLinearGradient(0, 6, 0, 34);
  grad.addColorStop(0, "#f87171");
  grad.addColorStop(1, "#dc2626");
  ctx.beginPath();
  ctx.arc(cx, cy, 13.5, 0, Math.PI * 2);
  ctx.fillStyle = grad;
  ctx.fill();

  // Camera: body, viewfinder bump, lens with a glint.
  ctx.fillStyle = "#ffffff";
  roundRect(ctx, cx - 8.5, cy - 4.5, 17, 11.5, 3);
  ctx.fill();
  roundRect(ctx, cx - 4, cy - 7.5, 8, 4, 1.5);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(cx, cy + 1.2, 4.2, 0, Math.PI * 2);
  ctx.fillStyle = "#991b1b";
  ctx.fill();
  ctx.beginPath();
  ctx.arc(cx, cy + 1.2, 2.2, 0, Math.PI * 2);
  ctx.fillStyle = "#1f2937";
  ctx.fill();
  ctx.beginPath();
  ctx.arc(cx - 1, cy + 0.2, 0.9, 0, Math.PI * 2);
  ctx.fillStyle = "#ffffff";
  ctx.fill();
  // Flash dot.
  ctx.beginPath();
  ctx.arc(cx + 5.6, cy - 1.8, 1.1, 0, Math.PI * 2);
  ctx.fillStyle = "#fca5a5";
  ctx.fill();

  if (limit != null) {
    // Speed-limit roundel: white disc, red ring, bold number.
    const rx = 33;
    const ry = 33;
    ctx.save();
    ctx.shadowColor = "rgba(15,23,42,.3)";
    ctx.shadowBlur = 2;
    ctx.beginPath();
    ctx.arc(rx, ry, 10, 0, Math.PI * 2);
    ctx.fillStyle = "#ffffff";
    ctx.fill();
    ctx.restore();
    ctx.beginPath();
    ctx.arc(rx, ry, 8.4, 0, Math.PI * 2);
    ctx.lineWidth = 2.6;
    ctx.strokeStyle = "#dc2626";
    ctx.stroke();
    const text = String(Math.round(limit));
    ctx.fillStyle = "#111827";
    ctx.font = `800 ${text.length > 2 ? 7 : 8.5}px system-ui, -apple-system, "Segoe UI", sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(text, rx, ry + 0.5);
  }
  return c;
}

/** Amber diamond warning sign with a bump on the road. */
function drawBump(): HTMLCanvasElement {
  const { c, ctx } = canvas();
  const cx = 22;
  const cy = 22;
  const diamond = (r: number) => {
    ctx.beginPath();
    ctx.moveTo(cx, cy - r);
    ctx.lineTo(cx + r, cy);
    ctx.lineTo(cx, cy + r);
    ctx.lineTo(cx - r, cy);
    ctx.closePath();
  };
  ctx.lineJoin = "round";

  ctx.save();
  ctx.shadowColor = "rgba(15,23,42,.35)";
  ctx.shadowBlur = 4;
  ctx.shadowOffsetY = 1.5;
  diamond(18);
  ctx.fillStyle = "#ffffff";
  ctx.fill();
  ctx.lineWidth = 3;
  ctx.strokeStyle = "#ffffff";
  ctx.stroke();
  ctx.restore();

  const grad = ctx.createLinearGradient(0, 6, 0, 38);
  grad.addColorStop(0, "#fcd34d");
  grad.addColorStop(1, "#f59e0b");
  diamond(15);
  ctx.fillStyle = grad;
  ctx.fill();
  ctx.lineWidth = 1.6;
  ctx.strokeStyle = "#1f2937";
  ctx.stroke();

  // Road with a hump in the middle.
  ctx.beginPath();
  ctx.moveTo(cx - 9, cy + 4);
  ctx.lineTo(cx - 4.5, cy + 4);
  ctx.bezierCurveTo(cx - 3, cy - 3.5, cx + 3, cy - 3.5, cx + 4.5, cy + 4);
  ctx.lineTo(cx + 9, cy + 4);
  ctx.lineWidth = 2.6;
  ctx.lineCap = "round";
  ctx.strokeStyle = "#1f2937";
  ctx.stroke();
  // Motion ticks above the bump.
  ctx.lineWidth = 1.4;
  for (const dx of [-3.2, 0, 3.2]) {
    ctx.beginPath();
    ctx.moveTo(cx + dx, cy - 6.5);
    ctx.lineTo(cx + dx, cy - 4.8);
    ctx.stroke();
  }
  return c;
}

export function cameraIconId(limit: number | null | undefined): string {
  return limit != null ? `hz-cam-${Math.round(limit)}` : "hz-cam";
}
export const BUMP_ICON_ID = "hz-bump";

function addCanvas(map: maplibregl.Map, id: string, c: HTMLCanvasElement) {
  if (map.hasImage(id)) return;
  const data = c.getContext("2d")!.getImageData(0, 0, c.width, c.height);
  map.addImage(id, { width: c.width, height: c.height, data: new Uint8Array(data.data.buffer) }, { pixelRatio: RATIO });
}

/** Register every icon these hazards need (one per distinct camera limit). */
export function ensureHazardIcons(map: maplibregl.Map, limits: Iterable<number | null | undefined>) {
  addCanvas(map, BUMP_ICON_ID, drawBump());
  const seen = new Set<string>();
  for (const l of limits) {
    const id = cameraIconId(l);
    if (seen.has(id)) continue;
    seen.add(id);
    addCanvas(map, id, drawCamera(l ?? null));
  }
}

/** A data URL of an icon, for legends and lists outside the map. */
export function hazardIconUrl(kind: "camera" | "bump", limit: number | null = null): string {
  return (kind === "camera" ? drawCamera(limit) : drawBump()).toDataURL();
}
