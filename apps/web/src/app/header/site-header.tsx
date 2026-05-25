/**
 * Global site header. Server component — fetches the current user via
 * `auth.me` + the locale cookie so the strings + the user menu both
 * paint correctly on first byte.
 */

import Link from "next/link";

import { getT } from "@/lib/i18n/server";
import { fetchMe } from "@/lib/sim-client";

import { UserMenu } from "./user-menu";

export async function SiteHeader() {
  const [user, t] = await Promise.all([fetchMe(), getT()]);
  const nav: { label: string; href: string }[] = [
    { label: t("nav.visions"), href: "/visions" },
    { label: t("nav.community"), href: "/community" },
  ];
  return (
    <header className="sticky top-0 z-20 border-b border-neutral-800 bg-neutral-950/85 backdrop-blur">
      <a
        href="#main"
        className="sr-only fixed left-2 top-2 z-50 rounded bg-cyan-700 px-3 py-2 text-xs font-semibold text-cyan-50 focus:not-sr-only focus:outline-none focus:ring-2 focus:ring-cyan-400"
      >
        {t("header.skipToContent")}
      </a>
      <div className="mx-auto flex h-12 max-w-[100rem] items-center gap-4 px-8">
        <Link
          href="/"
          className="text-sm font-semibold tracking-tight text-neutral-50 hover:text-cyan-300"
        >
          {t("header.brand")}
        </Link>
        <nav className="hidden gap-3 text-xs text-neutral-400 md:flex">
          {nav.map((item) => (
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
