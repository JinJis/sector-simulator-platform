"use client";

/**
 * LocaleProvider — context + cookie sync for ko / en.
 *
 * Reads initial value from a cookie (set by /settings). The layout
 * server component reads the same cookie to render the right
 * strings on first paint (no flash). Changing the locale writes the
 * cookie + router.refresh() so server-rendered text re-renders.
 */

import { useRouter } from "next/navigation";
import {
  createContext,
  useCallback,
  useContext,
  useState,
  type ReactNode,
} from "react";

import {
  DEFAULT_LOCALE,
  LOCALE_COOKIE,
  parseLocale,
} from "../preferences";
import { translate, type Locale } from "./dict";

interface Ctx {
  locale: Locale;
  setLocale: (l: Locale) => void;
  t: (key: string) => string;
}

const LocaleContext = createContext<Ctx | null>(null);

export function useLocale(): Ctx {
  const ctx = useContext(LocaleContext);
  if (!ctx) {
    return {
      locale: DEFAULT_LOCALE,
      setLocale: () => undefined,
      t: (k) => translate(k, DEFAULT_LOCALE),
    };
  }
  return ctx;
}

export function useT(): (key: string) => string {
  return useLocale().t;
}

function writeCookie(value: Locale) {
  if (typeof document === "undefined") return;
  document.cookie = `${LOCALE_COOKIE}=${value}; path=/; max-age=31536000; SameSite=Lax`;
}

export function LocaleProvider({
  initialLocale,
  children,
}: {
  initialLocale: Locale;
  children: ReactNode;
}) {
  const router = useRouter();
  const [locale, setLocaleState] = useState<Locale>(initialLocale);

  const setLocale = useCallback(
    (next: Locale) => {
      const parsed = parseLocale(next);
      setLocaleState(parsed);
      writeCookie(parsed);
      // Server components consume the cookie for their initial t()
      // calls, so re-fetch the page to update their output.
      router.refresh();
    },
    [router],
  );

  const t = useCallback(
    (key: string) => translate(key, locale),
    [locale],
  );

  return (
    <LocaleContext.Provider value={{ locale, setLocale, t }}>
      {children}
    </LocaleContext.Provider>
  );
}
