"use client";

import React, {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
  useMemo,
} from "react";

export type ThemePreference = "light" | "dark" | "system";
export type ResolvedTheme = "light" | "dark";

interface ThemeContextValue {
  theme: ThemePreference;
  resolvedTheme: ResolvedTheme;
  setTheme: (theme: ThemePreference) => void;
  mounted: boolean;
}

const STORAGE_KEY = "mathpractice-theme";

const ThemeContext = createContext<ThemeContextValue>({
  theme: "system",
  resolvedTheme: "light",
  setTheme: () => {},
  mounted: false,
});

function getSystemTheme(): ResolvedTheme {
  if (typeof window === "undefined") return "light";
  return window.matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
}

function applyThemeToRoot(preference: ThemePreference): ResolvedTheme {
  const resolved: ResolvedTheme =
    preference === "system" ? getSystemTheme() : preference;

  if (typeof document !== "undefined") {
    const root = document.documentElement;
    root.classList.remove("light", "dark");
    root.classList.add(resolved);
    root.style.colorScheme = resolved;
    root.setAttribute("data-theme", resolved);
    root.setAttribute("data-theme-preference", preference);
  }

  return resolved;
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = useState<ThemePreference>("system");
  const [resolvedTheme, setResolvedTheme] = useState<ResolvedTheme>("light");
  const [mounted, setMounted] = useState(false);

  // Initialize from localStorage on client mount
  useEffect(() => {
    let initialPref: ThemePreference = "system";
    try {
      const saved = window.localStorage.getItem(STORAGE_KEY);
      if (saved === "light" || saved === "dark" || saved === "system") {
        initialPref = saved;
      }
    } catch {
      // Ignore storage access errors in restricted environments
    }

    const applied = applyThemeToRoot(initialPref);
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setThemeState(initialPref);
    setResolvedTheme(applied);
    setMounted(true);
  }, []);

  // Listen for OS theme changes and cross-tab localStorage updates
  useEffect(() => {
    const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");

    const handleMediaChange = () => {
      if (theme === "system") {
        const applied = applyThemeToRoot("system");
        setResolvedTheme(applied);
      }
    };

    const handleStorageChange = (event: StorageEvent) => {
      if (event.key === STORAGE_KEY) {
        const nextVal = event.newValue;
        if (nextVal === "light" || nextVal === "dark" || nextVal === "system") {
          setThemeState(nextVal);
          setResolvedTheme(applyThemeToRoot(nextVal));
        }
      }
    };

    mediaQuery.addEventListener("change", handleMediaChange);
    window.addEventListener("storage", handleStorageChange);

    return () => {
      mediaQuery.removeEventListener("change", handleMediaChange);
      window.removeEventListener("storage", handleStorageChange);
    };
  }, [theme]);

  const setTheme = useCallback((nextTheme: ThemePreference) => {
    setThemeState(nextTheme);
    try {
      window.localStorage.setItem(STORAGE_KEY, nextTheme);
    } catch {
      // Ignore storage errors
    }
    const applied = applyThemeToRoot(nextTheme);
    setResolvedTheme(applied);
  }, []);

  const value = useMemo(
    () => ({
      theme,
      resolvedTheme,
      setTheme,
      mounted,
    }),
    [theme, resolvedTheme, setTheme, mounted]
  );

  return (
    <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
  );
}

export function useTheme() {
  return useContext(ThemeContext);
}

// Inline script injected into <head> to prevent Flash of Unstyled/Wrong Theme (FOUC)
export const THEME_INIT_SCRIPT = `
(function() {
  try {
    var storageKey = 'mathpractice-theme';
    var saved = localStorage.getItem(storageKey);
    var preference = (saved === 'light' || saved === 'dark' || saved === 'system') ? saved : 'system';
    var systemDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    var resolved = preference === 'system' ? (systemDark ? 'dark' : 'light') : preference;
    var root = document.documentElement;
    root.classList.remove('light', 'dark');
    root.classList.add(resolved);
    root.style.colorScheme = resolved;
    root.setAttribute('data-theme', resolved);
    root.setAttribute('data-theme-preference', preference);
  } catch (e) {}
})();
`;

