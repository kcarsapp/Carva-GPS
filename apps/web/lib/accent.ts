// Interface accent colours. Plain module (no "use client"): the root layout
// reads the cookie on the server and stamps <html data-accent>, so the first
// paint is already in the chosen colour. The palettes live in app/fleet.css.

export const ACCENT_COOKIE = "carva-accent";

export type Accent = "gold" | "platinum" | "sapphire" | "emerald" | "crimson" | "violet";
export const ACCENTS: readonly Accent[] = ["gold", "platinum", "sapphire", "emerald", "crimson", "violet"];

/** Swatch colours for the Settings picker (the dark-theme primary). */
export const ACCENT_SWATCH: Record<Accent, string> = {
  gold: "#d1b06b",
  platinum: "#c4c9d4",
  sapphire: "#5b8def",
  emerald: "#34c79a",
  crimson: "#e23b44",
  violet: "#a78bfa",
};

export function isAccent(v: string | undefined | null): v is Accent {
  return !!v && (ACCENTS as readonly string[]).includes(v);
}
