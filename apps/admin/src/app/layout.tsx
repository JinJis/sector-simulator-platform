import "./globals.css";

import type { Metadata } from "next";
import { cookies } from "next/headers";
import Link from "next/link";
import type { ReactNode } from "react";

import {
  ADMIN_SESSION_COOKIE,
  verifySession,
} from "@/lib/admin-auth";

export const metadata: Metadata = {
  title: "Sector Simulator — Admin",
  description: "Admin console: register sectors, kick off ingest runs, approve agents.",
};

export default async function RootLayout({ children }: { children: ReactNode }) {
  // Header is rendered for both /login and the protected routes. We
  // peek at the cookie to decide whether to render the protected nav
  // + logout button — the actual gate lives in middleware.ts.
  const store = await cookies();
  const cookieValue = store.get(ADMIN_SESSION_COOKIE)?.value;
  const authedEmail = await verifySession(cookieValue);

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
            {authedEmail ? (
              <nav className="ml-auto flex flex-wrap items-baseline gap-3 text-xs text-neutral-400">
                <Link href="/" className="hover:text-neutral-100">
                  Dashboard
                </Link>
                <Link href="/visions" className="hover:text-neutral-100">
                  Visions
                </Link>
                <Link href="/data-pipeline" className="hover:text-neutral-100">
                  Data Pipeline
                </Link>
                <Link href="/users" className="hover:text-neutral-100">
                  Users
                </Link>
                <Link href="/audit" className="hover:text-neutral-100">
                  Audit
                </Link>
                <a
                  href="http://localhost:3000"
                  className="text-cyan-400 hover:text-cyan-300"
                  rel="noreferrer"
                >
                  User app ↗
                </a>
                <span className="ml-2 border-l border-neutral-800 pl-3 text-neutral-500">
                  {authedEmail}
                </span>
                <form action="/api/admin/auth/logout" method="post">
                  <button
                    type="submit"
                    className="rounded border border-neutral-700 px-2 py-0.5 text-[11px] text-neutral-300 hover:border-neutral-500 hover:text-neutral-100"
                  >
                    Logout
                  </button>
                </form>
              </nav>
            ) : (
              <span className="ml-auto text-[11px] text-neutral-600">
                signed out
              </span>
            )}
          </div>
        </header>
        {children}
      </body>
    </html>
  );
}
