import "./globals.css";

import type { Metadata } from "next";
import { cookies } from "next/headers";
import { Suspense, type ReactNode } from "react";

import { LocaleProvider } from "@/lib/i18n/provider";
import {
  LOCALE_COOKIE,
  THEME_COOKIE,
  bootThemeScript,
  parseLocale,
  parseTheme,
} from "@/lib/preferences";
import { ThemeProvider } from "@/lib/theme-provider";

import { OnboardingModal } from "./header/onboarding-modal";
import { PageTour } from "./header/page-tour";
import { SiteHeader } from "./header/site-header";

export const metadata: Metadata = {
  title: "Vision Feasibility Monitor",
  description:
    "Track the feasibility of bold technology visions through capability scores driven by live signals (arXiv, patents, news, filings).",
};

export default async function RootLayout({
  children,
}: {
  children: ReactNode;
}) {
  const cookieStore = await cookies();
  const theme = parseTheme(cookieStore.get(THEME_COOKIE)?.value);
  const locale = parseLocale(cookieStore.get(LOCALE_COOKIE)?.value);
  return (
    <html lang={locale} suppressHydrationWarning>
      <head>
        {/* Apply theme class BEFORE hydration to avoid FOUC. */}
        <script
          // eslint-disable-next-line react/no-danger
          dangerouslySetInnerHTML={{
            __html: bootThemeScript({ theme, locale }),
          }}
        />
      </head>
      <body>
        <ThemeProvider initialTheme={theme}>
          <LocaleProvider initialLocale={locale}>
            {/* The header reads `auth.me` per request; fall back to a thin
                shell while it streams so the page paints fast. */}
            <Suspense
              fallback={<header className="h-12 border-b border-neutral-800" />}
            >
              <SiteHeader />
            </Suspense>
            <div id="main">{children}</div>
            <Suspense fallback={null}>
              <OnboardingModal />
            </Suspense>
            <Suspense fallback={null}>
              <PageTour />
            </Suspense>
          </LocaleProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
