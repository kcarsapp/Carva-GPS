"use client";

/**
 * Dashboard-style speed gauge for the story's "safe engine cut" chapter.
 *
 * A 240° dial: a smooth gradient arc that FILLS with the speed (one
 * dash-offset, no dashed stroke - that read as jagged pixels), fine ticks
 * every 5 km/h with numbers every 10, and a tapered needle on a hub.
 * Geometric-precision rendering keeps every curve anti-aliased.
 *
 * The scene drives it by class: `.lg-needle` (rotate about the hub),
 * `.lg-fill` (stroke-dashoffset) and `.lg-speed` (the readout) - see
 * gaugeState() for the numbers.
 */

export const GAUGE_MAX = 60; // km/h at the end of the dial
const CX = 100;
const CY = 100;
const R = 78;
const START = 150; // degrees: 0 km/h, lower-left
const SWEEP = 240; // degrees: to lower-right
const ARC_LEN = (R * SWEEP * Math.PI) / 180;

const rad = (deg: number) => (deg * Math.PI) / 180;
const point = (deg: number, r = R) => [CX + r * Math.cos(rad(deg)), CY + r * Math.sin(rad(deg))] as const;

const [sx, sy] = point(START);
const [ex, ey] = point(START + SWEEP);
const ARC = `M${sx.toFixed(2)} ${sy.toFixed(2)} A${R} ${R} 0 1 1 ${ex.toFixed(2)} ${ey.toFixed(2)}`;

/** Needle rotation (deg, drawn pointing at +x) and fill offset for a speed. */
export function gaugeState(kmh: number) {
  const f = Math.max(0, Math.min(1, kmh / GAUGE_MAX));
  return { rotation: START + f * SWEEP, dashoffset: ARC_LEN * (1 - f) };
}

const TICKS = Array.from({ length: GAUGE_MAX / 5 + 1 }, (_, i) => {
  const kmh = i * 5;
  const deg = START + (kmh / GAUGE_MAX) * SWEEP;
  const major = kmh % 10 === 0;
  const [x1, y1] = point(deg, R - 12);
  const [x2, y2] = point(deg, R - (major ? 22 : 17));
  const [lx, ly] = point(deg, R - 33);
  return { kmh, major, x1, y1, x2, y2, lx, ly };
});

export function SpeedGauge({ uid }: { uid: string }) {
  const init = gaugeState(0);
  return (
    <svg viewBox="0 0 200 168" className="w-full" shapeRendering="geometricPrecision" aria-hidden>
      <defs>
        <linearGradient id={`${uid}-fill`} x1="0" y1="1" x2="1" y2="1">
          <stop offset="0" stopColor="#10b981" />
          <stop offset="0.55" stopColor="#d1b06b" />
          <stop offset="1" stopColor="#ef4444" />
        </linearGradient>
        <radialGradient id={`${uid}-face`} cx="50%" cy="45%" r="60%">
          <stop offset="0" stopColor="#1f1b16" />
          <stop offset="1" stopColor="#0f0d0b" />
        </radialGradient>
        <linearGradient id={`${uid}-needle`} x1="0" x2="1">
          <stop offset="0" stopColor="#f4efe6" stopOpacity="0.5" />
          <stop offset="1" stopColor="#ffffff" />
        </linearGradient>
      </defs>

      {/* face */}
      <circle cx={CX} cy={CY} r={R + 10} fill={`url(#${uid}-face)`} stroke="#2c2721" strokeWidth="1" />
      {/* track + soft halo + live fill */}
      <path d={ARC} fill="none" stroke="#25211c" strokeWidth="9" strokeLinecap="round" />
      <path
        d={ARC}
        className="lg-fill-halo"
        fill="none"
        stroke={`url(#${uid}-fill)`}
        strokeOpacity="0.18"
        strokeWidth="18"
        strokeLinecap="round"
        strokeDasharray={ARC_LEN}
        strokeDashoffset={init.dashoffset}
      />
      <path
        d={ARC}
        className="lg-fill"
        fill="none"
        stroke={`url(#${uid}-fill)`}
        strokeWidth="9"
        strokeLinecap="round"
        strokeDasharray={ARC_LEN}
        strokeDashoffset={init.dashoffset}
      />

      {/* ticks + numbers */}
      {TICKS.map((t) => (
        <g key={t.kmh}>
          <line
            x1={t.x1}
            y1={t.y1}
            x2={t.x2}
            y2={t.y2}
            stroke={t.major ? "#f4efe6" : "#f4efe6"}
            strokeOpacity={t.major ? 0.7 : 0.3}
            strokeWidth={t.major ? 1.8 : 1.1}
            strokeLinecap="round"
          />
          {t.major && (
            <text
              x={t.lx}
              y={t.ly}
              textAnchor="middle"
              dominantBaseline="central"
              fontSize="9"
              fontWeight="600"
              fill="#f4efe6"
              fillOpacity="0.55"
            >
              {t.kmh}
            </text>
          )}
        </g>
      ))}

      {/* needle: drawn along +x, rotated about the hub */}
      <g className="lg-needle" transform={`rotate(${init.rotation} ${CX} ${CY})`}>
        <path d={`M${CX - 12} ${CY - 2.6} L${CX + R - 16} ${CY - 0.8} L${CX + R - 16} ${CY + 0.8} L${CX - 12} ${CY + 2.6} Z`} fill={`url(#${uid}-needle)`} />
      </g>
      <circle cx={CX} cy={CY} r="9" fill="#12100e" stroke="#d1b06b" strokeWidth="2" />
      <circle cx={CX} cy={CY} r="3" fill="#d1b06b" />

      {/* readout */}
      <text x={CX} y={CY + 42} textAnchor="middle" className="lg-speed" fontSize="26" fontWeight="600" fill="#f4efe6">
        0
      </text>
      <text x={CX} y={CY + 56} textAnchor="middle" fontSize="8.5" letterSpacing="1.5" fill="#f4efe6" fillOpacity="0.5">
        KM/H
      </text>
    </svg>
  );
}
