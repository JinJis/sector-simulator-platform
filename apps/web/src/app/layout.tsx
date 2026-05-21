import "./globals.css";

import type { Metadata } from "next";
import { Suspense, type ReactNode } from "react";

import { OnboardingModal } from "./header/onboarding-modal";
import { SiteHeader } from "./header/site-header";

export const metadata: Metadata = {
  title: "Sector Simulator",
  description:
    "Turn industries into simulatable causal graphs and validate the future with live market data.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="ko">
      <body>
        {/* The header reads `auth.me` per request; fall back to a thin
            shell while it streams so the page paints fast. */}
        <Suspense fallback={<header className="h-12 border-b border-neutral-800" />}>
          <SiteHeader />
        </Suspense>
        {children}
        {/* OnboardingModal is client-side; it self-detects first-visit. */}
        <Suspense fallback={null}>
          <OnboardingModal />
        </Suspense>
      </body>
    </html>
  );
}
