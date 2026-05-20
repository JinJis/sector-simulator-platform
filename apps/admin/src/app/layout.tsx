import "./globals.css";

import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: "Sector Simulator — Admin",
  description: "Admin console: register sectors, kick off ingest runs, approve agents.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="ko">
      <body>
        <header className="border-b border-neutral-800 bg-neutral-950/80 px-6 py-3 backdrop-blur">
          <div className="mx-auto flex max-w-6xl items-baseline gap-4">
            <Link
              href="/"
              className="text-sm font-semibold text-rose-300 hover:text-rose-200"
            >
              Admin Console
            </Link>
            <span className="text-[11px] uppercase tracking-wider text-neutral-600">
              Phase 2 skeleton
            </span>
            <nav className="ml-auto flex gap-3 text-xs text-neutral-400">
              <Link href="/" className="hover:text-neutral-100">
                Sectors
              </Link>
              <Link href="/scenarios" className="hover:text-neutral-100">
                Scenarios
              </Link>
              <a
                href="http://localhost:3000"
                className="text-cyan-400 hover:text-cyan-300"
                rel="noreferrer"
              >
                User app ↗
              </a>
            </nav>
          </div>
        </header>
        {children}
      </body>
    </html>
  );
}
