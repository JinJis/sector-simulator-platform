"use client";

import { useT } from "@/lib/i18n/provider";
import { themeForVision } from "../../../../visions/_components/domain-theme";

export interface SectorChoice {
  slug: string;
  name: string;
}

export function StepSector({
  choices,
  value,
  onChange,
}: {
  choices: SectorChoice[];
  value: string;
  onChange: (slug: string) => void;
}) {
  const t = useT();
  return (
    <div className="space-y-4">
      <header>
        <h2 className="text-lg font-semibold text-neutral-100">
          {t("proposal.sector.heading")}
        </h2>
        <p className="mt-1 text-[12px] text-neutral-500">
          {t("proposal.sector.subheading")}
        </p>
      </header>
      {choices.length === 0 ? (
        <p className="rounded border border-dashed border-neutral-800 bg-neutral-950/40 p-6 text-center text-[12px] text-neutral-500">
          {t("proposal.sector.empty")}
        </p>
      ) : (
        <div className="grid gap-2 sm:grid-cols-2">
          {choices.map((c) => {
            const theme = themeForVision(null, c.slug);
            const active = value === c.slug;
            return (
              <button
                key={c.slug}
                type="button"
                onClick={() => onChange(c.slug)}
                className={`flex items-center gap-3 rounded-xl border p-3 text-left transition ${
                  active
                    ? `${theme.border} bg-neutral-900 shadow-lg ${theme.glow}`
                    : "border-neutral-800 bg-neutral-900/40 hover:border-neutral-600"
                }`}
              >
                <div
                  className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border ${theme.border} text-xl`}
                >
                  {theme.emoji}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-neutral-100">
                    {c.name}
                  </p>
                  <p className="truncate font-mono text-[10px] text-neutral-500">
                    {c.slug}
                  </p>
                </div>
                {active && (
                  <span className="shrink-0 text-cyan-400">✓</span>
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
