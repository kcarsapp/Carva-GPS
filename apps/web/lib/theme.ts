// Theme constants shared by the server layout and the client provider.
//
// This MUST stay a plain module. When a server component imports a value from
// a "use client" file, Next hands it a client-reference placeholder, not the
// value - so `cookies().get(THEME_COOKIE)` in app/layout.tsx silently looked
// up the wrong name, the saved Day/Night choice was never read, and every
// reload fell back to the OS setting.

export type ThemePref = "light" | "dark" | "system";

export const THEME_COOKIE = "carva-theme";
