"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS: { href: string; label: string; matches: (p: string) => boolean }[] = [
  {
    href: "/data-pipeline",
    label: "Live",
    matches: (p) =>
      p === "/data-pipeline" || p === "/data-pipeline/",
  },
  {
    href: "/data-pipeline/health",
    label: "Health",
    matches: (p) => p.startsWith("/data-pipeline/health"),
  },
  {
    href: "/data-pipeline/schedule",
    label: "Schedule",
    matches: (p) => p.startsWith("/data-pipeline/schedule"),
  },
  {
    href: "/data-pipeline/proposals",
    label: "Proposals",
    matches: (p) => p.startsWith("/data-pipeline/proposals"),
  },
  {
    href: "/data-pipeline/agent-runs",
    label: "Agent runs",
    matches: (p) => p.startsWith("/data-pipeline/agent-runs"),
  },
  {
    href: "/data-pipeline/queue",
    label: "Queue",
    matches: (p) => p.startsWith("/data-pipeline/queue"),
  },
];

export function DataPipelineTabs() {
  const path = usePathname();
  return (
    <nav className="flex flex-wrap gap-1 border-b border-neutral-800 text-[11px]">
      {TABS.map((t) => {
        const active = t.matches(path);
        return (
          <Link
            key={t.href}
            href={t.href}
            className={
              active
                ? "rounded-t border-b-2 border-cyan-500 px-3 py-1.5 font-medium text-cyan-200"
                : "rounded-t border-b-2 border-transparent px-3 py-1.5 text-neutral-400 hover:text-neutral-100"
            }
          >
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}
