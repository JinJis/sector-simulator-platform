"use client";

/**
 * ThemeProvider — context + cookie + DOM sync for {dark|light|system}.
 *
 * Reads initial value from a cookie at mount time. The layout server
 * component also reads the cookie + sets the right `<html class>`
 * before hydration (see bootThemeScript) so there's no flash.
 *
 * `setTheme()` writes the cookie + flips the class. The settings form
 * additionally pushes the choice to User.theme via auth.updateProfile
 * for cross-device persistence.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";

import { DEFAULT_THEME, THEME_COOKIE, parseTheme, type Theme } from "./preferences";

interface Ctx {
  theme: Theme;
  resolvedTheme: "dark" | "light";
  setTheme: (t: Theme) => void;
}

const ThemeContext = createContext<Ctx | null>(null);

export function useTheme(): Ctx {
  const ctx = useContext(ThemeContext);
  if (!ctx) {
    // Provider hasn't mounted yet (SSR boundary). Return a no-op so
    // hooks called too early don't crash.
    return {
      theme: DEFAULT_THEME,
      resolvedTheme: "dark",
      setTheme: () => undefined,
    };
  }
  return ctx;
}

function applyToDom(t: Theme): "dark" | "light" {
  let resolved: "dark" | "light" = t === "light" ? "light" : "dark";
  if (t === "system") {
    if (
      typeof window !== "undefined" &&
      window.matchMedia &&
      window.matchMedia("(prefers-color-scheme: light)").matches
    ) {
      resolved = "light";
    } else {
      resolved = "dark";
    }
  }
  if (typeof document !== "undefined") {
    const html = document.documentElement;
    html.classList.remove("dark", "light");
    html.classList.add(resolved);
  }
  return resolved;
}

function readCookie(): Theme {
  if (typeof document === "undefined") return DEFAULT_THEME;
  const match = document.cookie.match(new RegExp(`(?:^|; )${THEME_COOKIE}=([^;]+)`));
  return parseTheme(match?.[1]);
}

function writeCookie(value: Theme) {
  if (typeof document === "undefined") return;
  // 1 year persistence; SameSite=Lax + no Secure (cookie is non-sensitive).
  document.cookie = `${THEME_COOKIE}=${value}; path=/; max-age=31536000; SameSite=Lax`;
}

export function ThemeProvider({
  initialTheme,
  children,
}: {
  initialTheme: Theme;
  children: ReactNode;
}) {
  const [theme, setThemeState] = useState<Theme>(initialTheme);
  const [resolvedTheme, setResolvedTheme] = useState<"dark" | "light">(() =>
    initialTheme === "light" ? "light" : "dark",
  );

  // On mount, sync from cookie + apply. Also subscribe to system-pref
  // changes when theme=system so the page tracks the OS toggle.
  useEffect(() => {
    const cookieValue = readCookie();
    setThemeState(cookieValue);
    setResolvedTheme(applyToDom(cookieValue));

    if (cookieValue !== "system") return;
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mq = window.matchMedia("(prefers-color-scheme: light)");
    const onChange = () => setResolvedTheme(applyToDom("system"));
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  const setTheme = useCallback((next: Theme) => {
    setThemeState(next);
    writeCookie(next);
    setResolvedTheme(applyToDom(next));
  }, []);

  return (
    <ThemeContext.Provider value={{ theme, resolvedTheme, setTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}
