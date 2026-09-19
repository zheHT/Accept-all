"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

export type ThemeChoice = "light" | "dark";

export const THEME_STORAGE_KEY = "shipverify-theme";

interface ThemeContextValue {
  /** The applied theme. */
  theme: ThemeChoice;
  /**
   * False until the stored choice has been read on the client. Theme-dependent
   * markup must wait for this, otherwise the server HTML (which cannot know the
   * choice) and the first client render disagree and React keeps the stale
   * server attributes.
   */
  mounted: boolean;
  setTheme: (theme: ThemeChoice) => void;
  toggle: () => void;
}

const ThemeContext = createContext<ThemeContextValue>({
  theme: "light",
  mounted: false,
  setTheme: () => {},
  toggle: () => {},
});

export function useTheme() {
  return useContext(ThemeContext);
}

function apply(theme: ThemeChoice): void {
  document.documentElement.classList.toggle("dark", theme === "dark");
}

/**
 * Applies the theme by toggling `.dark` on <html>; every colour is a CSS
 * variable, so nothing else has to know which theme is active. The choice is
 * saved per device.
 */
export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = useState<ThemeChoice>("light");
  const [mounted, setMounted] = useState(false);

  // Pick up whatever the pre-paint script already applied.
  useEffect(() => {
    const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
    const initial: ThemeChoice = stored === "dark" ? "dark" : "light";
    setThemeState(initial);
    setMounted(true);
    apply(initial);
  }, []);

  const setTheme = useCallback((next: ThemeChoice) => {
    setThemeState(next);
    window.localStorage.setItem(THEME_STORAGE_KEY, next);
    apply(next);
  }, []);

  const toggle = useCallback(() => {
    setTheme(theme === "dark" ? "light" : "dark");
  }, [theme, setTheme]);

  const value = useMemo(
    () => ({ theme, mounted, setTheme, toggle }),
    [theme, mounted, setTheme, toggle],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

/**
 * Runs before first paint so a dark session never flashes white. A `?theme=dark`
 * or `?theme=light` parameter sets the stored preference, which makes a theme
 * shareable by link.
 */
export const THEME_INIT_SCRIPT = `(function(){try{var k="${THEME_STORAGE_KEY}";var p=new URLSearchParams(location.search).get("theme");if(p==="dark"||p==="light"){localStorage.setItem(k,p);}document.documentElement.classList.toggle("dark",localStorage.getItem(k)==="dark");}catch(e){}})();`;
