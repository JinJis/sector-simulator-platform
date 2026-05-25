/**
 * Shared preference primitives (theme + locale).
 *
 * Persistence layers, in priority order at read time:
 *   1. cookie  — set by the client when the user picks a value in
 *      /settings; mirrored to the DB on save. The cookie is the
 *      fast path so SSR doesn't have to hit Postgres on every page.
 *   2. User.theme / User.locale — the DB-resident persistent value.
 *      Updated via auth.updateProfile; sync'd into the cookie at the
 *      same time.
 *   3. defaults: theme="system", locale="ko"
 *
 * The `system` theme expands to dark/light via `prefers-color-scheme`
 * at render time (in the inline boot script).
 */

import type { CookieListItem } from "next/dist/compiled/@edge-runtime/cookies";

export type Theme = "dark" | "light" | "system";
export type Locale = "ko" | "en";

export const THEME_COOKIE = "tssp_theme";
export const LOCALE_COOKIE = "tssp_locale";

export const DEFAULT_THEME: Theme = "system";
export const DEFAULT_LOCALE: Locale = "ko";

export function parseTheme(raw: string | undefined | null): Theme {
  if (raw === "dark" || raw === "light" || raw === "system") return raw;
  return DEFAULT_THEME;
}

export function parseLocale(raw: string | undefined | null): Locale {
  if (raw === "ko" || raw === "en") return raw;
  return DEFAULT_LOCALE;
}

/** Resolve a cookie value out of a list (Next's RequestCookies). */
export function cookieValue(
  cookies: CookieListItem[] | undefined,
  name: string,
): string | null {
  if (!cookies) return null;
  for (const c of cookies) if (c.name === name) return c.value ?? null;
  return null;
}

/** Resolved cookie strings — convenience for layout SSR. */
export interface BootPrefs {
  theme: Theme;
  locale: Locale;
}

/**
 * Inline-script source. We must apply the resolved theme class to
 * `<html>` BEFORE React hydrates, otherwise the page paints in the
 * default (dark) theme and flashes when the client preference takes
 * over. Returned as a raw string so the layout server-component can
 * embed it via dangerouslySetInnerHTML.
 */
export function bootThemeScript(boot: BootPrefs): string {
  // Inline JS — kept minimal. Reads the cookie + system pref, applies
  // the right class. Wrapped in IIFE so it doesn't leak names.
  return `(function(){try{
    var t=${JSON.stringify(boot.theme)};
    if(t==='system'){
      var m=window.matchMedia('(prefers-color-scheme: light)');
      t=m && m.matches?'light':'dark';
    }
    var root=document.documentElement;
    root.classList.remove('dark','light');
    root.classList.add(t);
  }catch(e){}})();`;
}
