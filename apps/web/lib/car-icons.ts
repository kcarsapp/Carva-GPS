// Live-map vehicle markers (Settings -> Map -> Vehicle icon).
//
// Top-down vehicles drawn pointing NORTH so a single CSS rotate(heading)
// turns them to the real course. Painted in the status colour via the
// `--vm-color` custom property (set per marker by fleet-map), so a car's body
// tells you its state at a glance, the way fleet trackers usually do.
//
// Plain strings, not React: MapLibre markers are raw DOM elements.

import { vehicleSvg } from "@/app/app/icons";
import type { CarIcon } from "@/lib/preferences";

const BODY = 'style="fill:var(--vm-color)" stroke="rgba(0,0,0,.5)" stroke-width="1.2"';
const GLASS = 'fill="#0c1424" fill-opacity=".9"';

// Side-to-side shading: dark flanks, a soft highlight down the roof line.
const SHADE = `<defs><linearGradient id="vcShade" x1="0" x2="1">
<stop offset="0" stop-color="#000" stop-opacity=".38"/><stop offset=".32" stop-color="#fff" stop-opacity=".22"/>
<stop offset=".6" stop-color="#fff" stop-opacity=".04"/><stop offset="1" stop-color="#000" stop-opacity=".38"/></linearGradient></defs>`;

const SEDAN_PATH = "M8 15C8 6.5 13 2 20 2s12 4.5 12 13l1 51c0 8-5 12-13 12S7 74 7 66Z";
const SEDAN = `<svg viewBox="0 0 40 80" width="100%" height="100%" shape-rendering="geometricPrecision" aria-hidden="true">${SHADE}
<path d="M7.2 27.5 3.5 29.6v2.6l4.1-.8Z" ${BODY}/><path d="M32.8 27.5l3.7 2.1v2.6l-4.1-.8Z" ${BODY}/>
<path d="${SEDAN_PATH}" ${BODY}/><path d="${SEDAN_PATH}" fill="url(#vcShade)"/>
<path d="M10.6 25.5Q20 19.6 29.4 25.5L28 35.5Q20 32.8 12 35.5Z" ${GLASS}/>
<rect x="12.2" y="37" width="15.6" height="19" rx="3.5" fill="#fff" fill-opacity=".12"/>
<path d="M12 58Q20 60.6 28 58l1.4 7.4Q20 69.4 10.6 65.4Z" ${GLASS}/>
<path d="M10.4 6.2Q12.4 4.2 15.6 3.8l-1 3.6Z" fill="#fff8d8"/><path d="M29.6 6.2Q27.6 4.2 24.4 3.8l1 3.6Z" fill="#fff8d8"/>
<rect x="9" y="74.2" width="6.4" height="2.2" rx="1.1" fill="#ef4444"/><rect x="24.6" y="74.2" width="6.4" height="2.2" rx="1.1" fill="#ef4444"/>
</svg>`;

const SUV_PATH = "M7 9c0-4 3-7 7-7h12c4 0 7 3 7 7v61c0 4.5-3 8-7 8H14c-4 0-7-3.5-7-8Z";
const SUV = `<svg viewBox="0 0 40 80" width="100%" height="100%" shape-rendering="geometricPrecision" aria-hidden="true">${SHADE}
<path d="M6.4 25 2.6 27v2.8l4-.6Z" ${BODY}/><path d="M33.6 25l3.8 2v2.8l-4-.6Z" ${BODY}/>
<path d="${SUV_PATH}" ${BODY}/><path d="${SUV_PATH}" fill="url(#vcShade)"/>
<path d="M10 22.5Q20 18.6 30 22.5L28.8 32H11.2Z" ${GLASS}/>
<rect x="11.2" y="33.5" width="17.6" height="27" rx="2.5" fill="#fff" fill-opacity=".1"/>
<path d="M12 35v24M28 35v24" stroke="#000" stroke-opacity=".45" stroke-width="1.6" stroke-linecap="round"/>
<path d="M11.4 62.5h17.2l1 9H10.4Z" ${GLASS}/>
<rect x="9" y="3.6" width="6" height="2.6" rx="1.2" fill="#fff8d8"/><rect x="25" y="3.6" width="6" height="2.6" rx="1.2" fill="#fff8d8"/>
<rect x="8.6" y="74.4" width="5.6" height="2.4" rx="1.1" fill="#ef4444"/><rect x="25.8" y="74.4" width="5.6" height="2.4" rx="1.1" fill="#ef4444"/>
</svg>`;

const ARROW = `<svg viewBox="0 0 40 40" width="100%" height="100%" shape-rendering="geometricPrecision" aria-hidden="true">
<circle cx="20" cy="20" r="17" fill="#0f1115" stroke="#fff" stroke-width="2.4"/>
<path d="M20 7.5 29.5 30 20 25 10.5 30Z" style="fill:var(--vm-color)" stroke="#fff" stroke-width="1.6" stroke-linejoin="round"/>
</svg>`;

/** Inner HTML of a marker button for the chosen style. */
export function markerHtml(style: CarIcon): string {
  if (style === "classic") {
    // The original badge: status-ringed disc + a heading notch on a ring.
    return (
      `<span data-heading style="position:absolute;inset:-9px;pointer-events:none;transition:transform .4s ease,opacity .2s ease">` +
      `<svg viewBox="0 0 52 52" width="100%" height="100%" aria-hidden="true"><path data-heading-tip d="M26 1 L32 10 L20 10 Z" stroke="#12100e" stroke-width="1.5" stroke-linejoin="round"/></svg></span>` +
      `<span style="width:17px;height:17px;display:block">${vehicleSvg(null)}</span>`
    );
  }
  const svg = style === "suv" ? SUV : style === "arrow" ? ARROW : SEDAN;
  return `<span class="vm-halo" aria-hidden="true"></span><span data-heading class="vm-body">${svg}</span>`;
}

/** Marker button class list for the chosen style. */
export function markerClass(style: CarIcon): string {
  return style === "classic" ? "vm" : `vm vm-car vm-style-${style}`;
}

/** Small preview for the Settings picker (status colour: moving). */
export function previewHtml(style: CarIcon): string {
  return markerHtml(style);
}
