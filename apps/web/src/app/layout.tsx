import "./globals.css";

import type { Metadata } from "next";
import { Suspense, type ReactNode } from "react";

import { OnboardingModal } from "./header/onboarding-modal";
import { PageTour } from "./header/page-tour";
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
        <div id="main">{children}</div>
        {/* OnboardingModal is client-side; it self-detects first-visit. */}
        <Suspense fallback={null}>
          <OnboardingModal />
        </Suspense>
        {/* PageTour adds a floating "📍 이 페이지 둘러보기" button on
            every primary page that has tour content. Self-renders nothing
            on routes without content (login / signup / admin). */}
        <Suspense fallback={null}>
          <PageTour />
        </Suspense>
      </body>
    </html>
  );
}
