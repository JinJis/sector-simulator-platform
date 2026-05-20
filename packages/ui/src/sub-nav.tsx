"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

export interface SubNavItem {
  label: ReactNode;
  href: string;
  /** Optional secondary caption, e.g. a count or short hint. */
  caption?: ReactNode;
}

export interface SubNavProps {
  items: SubNavItem[];
  /**
   * Optional explicit override for which item is active. Defaults to
   * matching the longest `href` prefix that the current pathname starts
   * with — that handles nested children (`/sectors/x/manual` highlights
   * `/sectors/x/manual` even when other items have shorter prefixes).
   */
  activeHref?: string;
  className?: string;
}

/**
 * Horizontal pill row for navigation between sibling pages under a hub
 * (e.g. the sector hub's live/manual/graph/sources/equities tabs once
 * those become real routes). Auto-highlights the active item.
 *
 * Client component because it reads the current pathname. Renders fine
 * inside RSC parents — Next handles the boundary.
 */
export function SubNav({ items, activeHref, className }: SubNavProps) {
  const pathname = usePathname();
  const active = activeHref ?? matchActive(items, pathname);

  return (
    <nav
      aria-label="Section navigation"
      className={
        "flex flex-wrap items-stretch gap-1 rounded-lg border border-neutral-800 bg-neutral-900/40 p-1 " +
        (className ?? "")
      }
    >
      {items.map((item) => {
        const isActive = item.href === active;
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={isActive ? "page" : undefined}
            className={`min-w-[120px] flex-1 rounded-md px-3 py-2 text-left transition ${
              isActive
                ? "bg-neutral-800 shadow-inner ring-1 ring-cyan-500/30"
                : "hover:bg-neutral-800/50"
            }`}
          >
            <div
              className={`text-sm font-semibold ${
                isActive ? "text-cyan-300" : "text-neutral-200"
              }`}
            >
              {item.label}
            </div>
            {item.caption && (
              <div className="text-[11px] text-neutral-500">{item.caption}</div>
            )}
          </Link>
        );
      })}
    </nav>
  );
}

/**
 * Pick the item whose `href` is the longest prefix of `pathname`. Ties
 * resolve to the first declared. Returns the active `href` or `null`.
 */
function matchActive(items: SubNavItem[], pathname: string | null): string | null {
  if (!pathname) return null;
  let best: SubNavItem | null = null;
  for (const item of items) {
    if (pathname === item.href || pathname.startsWith(item.href + "/")) {
      if (!best || item.href.length > best.href.length) best = item;
    }
  }
  return best ? best.href : null;
}
