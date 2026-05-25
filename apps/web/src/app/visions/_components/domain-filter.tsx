"use client";

import { useRouter, useSearchParams } from "next/navigation";

import { ALL_DOMAIN_THEMES, type DomainTheme } from "./domain-theme";

interface Props {
  activeDomain: string | null;
  /** Counts (by domain key) so empty domains can be hidden. */
  countsByDomain: Record<string, number>;
  totalCount: number;
}

/**
 * Pill row at the top of /visions. "All" chip + one chip per domain
 * that has at least one vision. Selecting writes `?domain=<key>` so
 * the server-side filter picks it up on the next render.
 */
export function DomainFilter({ activeDomain, countsByDomain, totalCount }: Props) {
  const router = useRouter();
  const searchParams = useSearchParams();

  function pick(domainKey: string | null) {
    const params = new URLSearchParams(searchParams.toString());
    if (domainKey === null) params.delete("domain");
    else params.set("domain", domainKey);
    const qs = params.toString();
    router.push(qs ? `/visions?${qs}` : "/visions");
  }

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <FilterChip
        active={activeDomain === null}
        label="All"
        emoji="✨"
        count={totalCount}
        onClick={() => pick(null)}
      />
      {Object.entries(ALL_DOMAIN_THEMES)
        .filter(([key]) => key !== "other")
        .map(([key, theme]) => {
          const count = countsByDomain[key] ?? 0;
          if (count === 0) return null;
          return (
            <FilterChip
              key={key}
              active={activeDomain === key}
              label={theme.label}
              emoji={theme.emoji}
              count={count}
              theme={theme}
              onClick={() => pick(key)}
            />
          );
        })}
    </div>
  );
}

function FilterChip({
  active,
  label,
  emoji,
  count,
  theme,
  onClick,
}: {
  active: boolean;
  label: string;
  emoji: string;
  count: number;
  theme?: DomainTheme;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[12px] transition ${
        active
          ? theme
            ? `${theme.border} ${theme.accent} bg-neutral-900`
            : "border-cyan-700 bg-cyan-900/40 text-cyan-100"
          : "border-neutral-800 bg-neutral-950 text-neutral-400 hover:border-neutral-700 hover:text-neutral-200"
      }`}
    >
      <span>{emoji}</span>
      <span className="font-medium">{label}</span>
      <span
        className={`rounded px-1 py-0.5 font-mono text-[10px] ${
          active ? "bg-neutral-800 text-neutral-200" : "text-neutral-600"
        }`}
      >
        {count}
      </span>
    </button>
  );
}
