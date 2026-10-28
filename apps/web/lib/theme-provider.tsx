"use client";

import * as React from "react";

// Day/night theme for the Tailwind (.app-fleet) sections. The choice is kept
// in a cookie so the server can stamp <html class="dark"> on the next load
// (no flash), and applied live to document.documentElement here.

import { THEME_COOKIE, type ThemePref } from "@/lib/theme";

export { THEME_COOKIE, type ThemePref };

interface ThemeCtx {
  theme: ThemePref;
  /** What's actually on screen after resolving "system". */
  resolved: "light" | "dark";
  setTheme: (t: ThemePref) => void;
}

const Ctx = React.createContext<ThemeCtx | null>(null);

function systemDark(): boolean {
  return (
    typeof window !== "undefined" &&
    window.matchMedia("(prefers-color-scheme: dark)").matches
  );
}

function apply(pref: ThemePref) {
  const dark = pref === "dark" || (pref === "system" && systemDark());
  document.documentElement.classList.toggle("dark", dark);
  return dark ? "dark" : "light";
}

export function ThemeProvider({
  initialTheme = "system",
  children,
}: {
  initialTheme?: ThemePref;
  children: React.ReactNode;
}) {
  const [theme, setThemeState] = React.useState<ThemePref>(initialTheme);
  const [resolved, setResolved] = React.useState<"light" | "dark">("light");

  // Apply on mount + react to OS changes while in "system".
  React.useEffect(() => {
    setResolved(apply(theme));
    if (theme !== "system") return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => setResolved(apply("system"));
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [theme]);

  const setTheme = React.useCallback((next: ThemePref) => {
    document.cookie = `${THEME_COOKIE}=${next}; path=/; max-age=31536000; samesite=lax`;
    setThemeState(next);
    setResolved(apply(next));
  }, []);

  const value = React.useMemo(
    () => ({ theme, resolved, setTheme }),
    [theme, resolved, setTheme],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useTheme(): ThemeCtx {
  const ctx = React.useContext(Ctx);
  if (!ctx) throw new Error("useTheme must be used within <ThemeProvider>");
  return ctx;
}

/** Small sun/moon button that flips between day and night. */
export function ThemeToggle({ className }: { className?: string }) {
  const { resolved, setTheme } = useTheme();
  const dark = resolved === "dark";
  return (
    <button
      type="button"
      onClick={() => setTheme(dark ? "light" : "dark")}
      aria-label={dark ? "Switch to day mode" : "Switch to night mode"}
      title={dark ? "Day mode" : "Night mode"}
      className={className}
    >
      {/* Inline SVGs keep this file dependency-free. */}
      {dark ? (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
          <circle cx="12" cy="12" r="4" />
          <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41" />
        </svg>
      ) : (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
          <path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z" />
        </svg>
      )}
    </button>
  );
}
