"use client";

import * as React from "react";

import { cn } from "@/lib/utils";
import {
  CITY_STREETS,
  CITY_VIEWBOX,
  DRIVE_PATH,
  DRIVE_START,
  TO_CAR_PATH,
  YOU_POINT,
} from "@/components/landing/city-data";

/**
 * The "night drive" artwork: real Erbil roads (city-data.ts) as a dark,
 * glowing map. Purely presentational - scenes animate it by class name
 * (nc-street, nc-drive, nc-car, ...) through a gsap selector scoped to their
 * own container, so two copies on one page never collide.
 *
 * Performance shape (this is what keeps scrolling smooth): two stacked SVGs.
 *  - STATIC layer: grid, ~84 road paths, city lights, vignette. Promoted to
 *    its own compositor layer and never changed after the intro, so it is
 *    rasterised once - not on every scroll frame.
 *  - LIVE layer: only what moves (rental lot, zone, drive, directions, "you",
 *    car). Repainting it per frame is cheap.
 * No SVG filters (a blur on the growing route re-ran every frame) and no
 * endless CSS loops (a flickering light repainted the whole city forever).
 */

/** Deterministic "city lights": points sampled along the streets. */
function useCityLights(root: React.RefObject<HTMLDivElement>, every = 110) {
  const [lights, setLights] = React.useState<{ x: number; y: number; d: number }[]>([]);
  React.useEffect(() => {
    const el = root.current;
    if (!el) return;
    const out: { x: number; y: number; d: number }[] = [];
    let i = 0;
    el.querySelectorAll<SVGPathElement>(".nc-street").forEach((p) => {
      const len = p.getTotalLength();
      for (let s = every / 2; s < len; s += every) {
        const pt = p.getPointAtLength(s);
        // stagger by a cheap hash so the city "switches on" unevenly
        out.push({ x: pt.x, y: pt.y, d: ((i++ * 7919) % 100) / 100 });
      }
    });
    setLights(out);
  }, [root, every]);
  return lights;
}

/** Fraction along TO_CAR_PATH where "you" stand (see story.tsx). */
export const YOU_START = 0.38;

export function NightCity({
  className,
  layers = {},
  labels = {},
}: {
  className?: string;
  /** Translated map labels. */
  labels?: { base?: string; zone?: string; you?: string };
  /** Optional layers; streets + lights are always drawn. */
  layers?: {
    drive?: boolean;
    car?: boolean;
    base?: boolean;
    zone?: boolean;
    you?: boolean;
  };
}) {
  const uid = React.useId().replace(/:/g, "");
  const root = React.useRef<HTMLDivElement>(null);
  const lights = useCityLights(root);
  const zoneRef = React.useRef<SVGGElement>(null);
  const youRef = React.useRef<SVGGElement>(null);

  // The restricted zone sits on the drive, ~56% of the way along, so the car
  // really crosses into it.
  React.useLayoutEffect(() => {
    const g = zoneRef.current;
    const path = root.current?.querySelector<SVGPathElement>(".nc-drive");
    if (!g || !path) return;
    const pt = path.getPointAtLength(path.getTotalLength() * 0.56);
    g.setAttribute("transform", `translate(${pt.x.toFixed(1)} ${pt.y.toFixed(1)})`);
  }, []);

  // "You" start part-way along the real directions route (YOU_START), so
  // you and the car both sit inside the frame rather than at its edge.
  React.useLayoutEffect(() => {
    const g = youRef.current;
    const path = root.current?.querySelector<SVGPathElement>(".nc-tocar");
    if (!g || !path) return;
    const pt = path.getPointAtLength(path.getTotalLength() * YOU_START);
    g.setAttribute("transform", `translate(${pt.x.toFixed(1)} ${pt.y.toFixed(1)})`);
  }, []);

  return (
    <div ref={root} className={cn("night-city relative h-full w-full", className)} aria-hidden>
      {/* ---------------- STATIC: drawn once ---------------- */}
      <svg viewBox={CITY_VIEWBOX} className="nc-layer nc-static" preserveAspectRatio="xMidYMid slice">
        <defs>
          <radialGradient id={`${uid}-vignette`} cx="50%" cy="50%" r="70%">
            <stop offset="50%" stopColor="#0b0a09" stopOpacity="0" />
            <stop offset="100%" stopColor="#0b0a09" stopOpacity="1" />
          </radialGradient>
          <pattern id={`${uid}-grid`} width="40" height="40" patternUnits="userSpaceOnUse">
            <path d="M40 0H0V40" fill="none" stroke="#f4efe6" strokeOpacity="0.035" />
          </pattern>
        </defs>
        <rect width="1200" height="800" fill="#0b0a09" />
        <rect width="1200" height="800" fill={`url(#${uid}-grid)`} />

        {/* Roads: wide dark casing + thin warm core, like a night satellite. */}
        <g className="nc-streets" fill="none" strokeLinecap="round" strokeLinejoin="round">
          {CITY_STREETS.map((d, i) => (
            <path key={`c${i}`} d={d} className="nc-street-casing" stroke="#1d1a16" strokeWidth={9} />
          ))}
          {CITY_STREETS.map((d, i) => (
            <path key={`s${i}`} d={d} className="nc-street" stroke="#4a4237" strokeWidth={2.2} />
          ))}
        </g>

        {/* City lights: switch on once (CSS), then stay still. */}
        <g className="nc-lights">
          {lights.map((l, i) => (
            <circle
              key={i}
              cx={l.x}
              cy={l.y}
              r={i % 5 === 0 ? 2.4 : 1.5}
              className="nc-light"
              style={{ animationDelay: `${(l.d * 2).toFixed(2)}s` }}
            />
          ))}
        </g>

        {/* Edge fade, replacing a CSS mask on the 3D plane (masks re-ran
            every frame). */}
        <rect width="1200" height="800" fill={`url(#${uid}-vignette)`} />
      </svg>

      {/* ---------------- LIVE: only what moves ---------------- */}
      <svg viewBox={CITY_VIEWBOX} className="nc-layer nc-live" preserveAspectRatio="xMidYMid slice">
        <defs>
          <linearGradient id={`${uid}-drive`} x1="0" x2="1" y1="1" y2="0">
            <stop offset="0%" stopColor="#8a6a1f" />
            <stop offset="60%" stopColor="#d1b06b" />
            <stop offset="100%" stopColor="#f3dfae" />
          </linearGradient>
        </defs>

        {layers.base && (
          <g className="nc-base" transform={`translate(${DRIVE_START[0]} ${DRIVE_START[1]})`}>
            <circle r="54" className="nc-base-fill" />
            <circle r="54" className="nc-base-ring" />
            <text y="-66" textAnchor="middle" className="nc-label nc-base-label">{labels.base}</text>
          </g>
        )}

        {layers.zone && (
          <g ref={zoneRef} className="nc-zone">
            <polygon className="nc-zone-shape" points="0,-78 68,-39 68,39 0,78 -68,39 -68,-39" />
            <text y="-92" textAnchor="middle" className="nc-label nc-zone-label">{labels.zone}</text>
          </g>
        )}

        {/* The drive itself. Always present (the zone measures it), shown only
            when the layer is on. The glow is a wide faint stroke - no blur. */}
        <g style={layers.drive ? undefined : { display: "none" }}>
          <path
            d={DRIVE_PATH}
            className="nc-drive-glow"
            fill="none"
            stroke="#d1b06b"
            strokeOpacity="0.16"
            strokeWidth="18"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <path
            d={DRIVE_PATH}
            className="nc-drive"
            fill="none"
            stroke={`url(#${uid}-drive)`}
            strokeWidth="5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </g>

        {layers.you && (
          <>
            <path
              d={TO_CAR_PATH}
              className="nc-tocar"
              fill="none"
              stroke="#3b82f6"
              strokeWidth="5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <g ref={youRef} className="nc-you" transform={`translate(${YOU_POINT[0]} ${YOU_POINT[1]})`}>
              <circle r="22" className="nc-you-ripple" />
              <circle r="9" fill="#0ea5e9" stroke="#fff" strokeWidth="3.5" />
              <text y="40" textAnchor="middle" className="nc-label nc-you-label">{labels.you}</text>
            </g>
          </>
        )}

        {layers.car && (
          // Drawn pointing along +x so MotionPath autoRotate faces it forward.
          <g className="nc-car">
            <circle r="30" className="nc-car-halo" />
            <g className="nc-car-body">
              <rect x="-17" y="-9.5" width="34" height="19" rx="7" fill="#12100e" stroke="#d1b06b" strokeWidth="2.5" />
              <rect x="2" y="-7" width="9" height="14" rx="3" fill="#d1b06b" fillOpacity="0.9" />
              <rect x="-13" y="-6.5" width="7" height="13" rx="2.5" fill="#d1b06b" fillOpacity="0.45" />
              <circle cx="16" cy="-6" r="2" fill="#fff6dc" />
              <circle cx="16" cy="6" r="2" fill="#fff6dc" />
            </g>
          </g>
        )}
      </svg>
    </div>
  );
}
