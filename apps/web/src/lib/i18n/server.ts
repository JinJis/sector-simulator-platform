/**
 * Server-side translator. Server components read the locale cookie
 * once per request and call this to get translated strings without
 * pulling in the client provider.
 */

import { cookies } from "next/headers";

import { LOCALE_COOKIE, parseLocale, type Locale } from "../preferences";
import { translate } from "./dict";

export async function getLocale(): Promise<Locale> {
  const store = await cookies();
  return parseLocale(store.get(LOCALE_COOKIE)?.value);
}

export async function getT(): Promise<(key: string) => string> {
  const locale = await getLocale();
  return (key: string) => translate(key, locale);
}
