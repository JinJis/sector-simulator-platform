/**
 * Global site header. Server component — fetches the current user via
 * `auth.me` once per request so the user menu hydrates with the right
 * identity on first paint (no flash of "Sign in" while the client
 * fetches it).
 */

import Link from "next/link";

import { fetchMe } from "@/lib/sim-client";

import { UserMenu } from "./user-menu";

const PRIMARY_NAV: { label: string; href: string }[] = [
  { label: "Visions", href: "/visions" },
  { label: "Community", href: "/community" },
];

export async function SiteHeader() {
  const user = await fetchMe();
  return (
    <header className="sticky top-0 z-20 border-b border-neutral-800 bg-neutral-950/85 backdrop-blur">
      {/* Skip-to-content link — invisible until focused. */}
      <a
        href="#main"
        className="sr-only fixed left-2 top-2 z-50 rounded bg-cyan-700 px-3 py-2 text-xs font-semibold text-cyan-50 focus:not-sr-only focus:outline-none focus:ring-2 focus:ring-cyan-400"
      >
        본문으로 건너뛰기
      </a>
      <div className="mx-auto flex h-12 max-w-7xl items-center gap-4 px-6">
        <Link
          href="/"
          className="text-sm font-semibold tracking-tight text-neutral-50 hover:text-cyan-300"
        >
          Vision Feasibility Monitor
        </Link>
        <span className="hidden text-[10px] uppercase tracking-wider text-neutral-600 sm:inline">
          Phase 3
        </span>
        <nav className="hidden gap-3 text-xs text-neutral-400 md:flex">
          {PRIMARY_NAV.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="rounded px-2 py-1 transition hover:bg-neutral-900 hover:text-neutral-100"
            >
              {item.label}
            </Link>
          ))}
        </nav>
        <div className="ml-auto flex items-center gap-3">
          <a
            href="https://github.com/JinJis/sector-simulator-platform"
            target="_blank"
            rel="noreferrer noopener"
            className="hidden text-[11px] text-neutral-500 hover:text-neutral-200 lg:inline"
          >
            GitHub ↗
          </a>
          <UserMenu user={user} />
        </div>
      </div>
    </header>
  );
}
