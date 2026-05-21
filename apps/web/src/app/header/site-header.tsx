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
  { label: "홈", href: "/" },
  { label: "섹터", href: "/sectors" },
];

export async function SiteHeader() {
  const user = await fetchMe();
  return (
    <header className="sticky top-0 z-20 border-b border-neutral-800 bg-neutral-950/85 backdrop-blur">
      <div className="mx-auto flex h-12 max-w-7xl items-center gap-4 px-6">
        <Link
          href="/"
          className="text-sm font-semibold tracking-tight text-neutral-50 hover:text-cyan-300"
        >
          Sector Simulator
        </Link>
        <span className="hidden text-[10px] uppercase tracking-wider text-neutral-600 sm:inline">
          Phase 2
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
