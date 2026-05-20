"use client";

import { useRouter } from "next/navigation";

import type { SimMetadata } from "@/lib/sim-client";

interface Props {
  sims: SimMetadata[];
  currentSlug: string;
}

/**
 * Sector switcher rendered above the workspace. Single source of truth for
 * which sim is loaded: the `?sector=<slug>` query param. Click a chip →
 * router.push updates the URL → server-side page.tsx refetches metadata.
 *
 * Falls back to a dropdown if more than 6 sectors are registered, so the
 * pill row doesn't overflow on mobile.
 */
export function SectorPicker({ sims, currentSlug }: Props) {
  const router = useRouter();
  const useDropdown = sims.length > 6;

  function go(slug: string) {
    if (slug === currentSlug) return;
    router.push(`/?sector=${encodeURIComponent(slug)}`);
  }

  if (useDropdown) {
    return (
      <div className="mb-4 flex items-center gap-2">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-neutral-500">
          Sector
        </span>
        <select
          value={currentSlug}
          onChange={(e) => go(e.target.value)}
          className="rounded-md border border-neutral-800 bg-neutral-900 px-3 py-1.5 text-sm font-medium text-neutral-100 focus:border-cyan-700 focus:outline-none"
        >
          {sims.map((s) => (
            <option key={s.slug} value={s.slug}>
              {s.name}
            </option>
          ))}
        </select>
      </div>
    );
  }

  return (
    <div className="mb-4">
      <div className="mb-1.5 flex items-center gap-2">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-neutral-500">
          Sectors
        </span>
        <span className="text-[10px] text-neutral-700">
          {sims.length} registered
        </span>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {sims.map((s) => {
          const active = s.slug === currentSlug;
          return (
            <button
              key={s.slug}
              onClick={() => go(s.slug)}
              className={`group flex flex-col items-start rounded-md border px-3 py-1.5 text-left transition ${
                active
                  ? "border-cyan-700 bg-cyan-950/40 shadow-sm shadow-cyan-500/10"
                  : "border-neutral-800 bg-neutral-900/40 hover:border-neutral-700 hover:bg-neutral-900/70"
              }`}
            >
              <span
                className={`text-xs font-semibold ${
                  active ? "text-cyan-200" : "text-neutral-200 group-hover:text-neutral-50"
                }`}
              >
                {s.name}
              </span>
              <span
                className={`text-[10px] ${active ? "text-cyan-500" : "text-neutral-600"}`}
              >
                {s.slug}
                {s.horizon_years ? ` · ${s.horizon_years}yr` : ""}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
