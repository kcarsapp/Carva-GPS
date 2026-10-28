// Map tile sources, shared by every map in the app (live map, history,
// geofences, places) so a provider change is one edit, not four.
//
// All of these work without an API key. That is the requirement, not a
// preference: CARTO's "free" Voyager tiles, which this app used until
// 2026-10, started answering every request with an "API KEY REQUIRED"
// watermark image — HTTP 200, so nothing errored, the map just silently
// filled with watermarks. If streets ever look wrong again, fetch one tile
// URL by hand before suspecting the map code.

/**
 * OpenStreetMap's standard tiles. Free with attribution for modest use like a
 * fleet dashboard (https://operations.osmfoundation.org/policies/tiles/), and
 * unlike the alternatives it labels streets and districts in Erbil in both
 * Latin and Arabic script. The browser sends the Referer the policy asks for.
 */
export const STREET_TILES = ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"];
export const STREET_ATTRIBUTION = "© OpenStreetMap contributors";
/** OSM serves up to z19; beyond that MapLibre overzooms the z19 tile. */
export const STREET_MAX_ZOOM = 19;

/** Esri World Imagery — keyless satellite. Note the {y}/{x} order. */
export const SATELLITE_TILES = [
  "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
];
export const SATELLITE_ATTRIBUTION = "© Esri, Maxar, Earthstar Geographics";

/** Esri place names and borders, drawn over the imagery for "Hybrid". */
export const LABEL_TILES = [
  "https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}",
];
