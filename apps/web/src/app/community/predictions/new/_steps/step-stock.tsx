"use client";

import { useEffect, useMemo, useState } from "react";

import { useT } from "@/lib/i18n/provider";
import { themeForVision } from "../../../../visions/_components/domain-theme";

import type { EquityChoice } from "./types";

export interface SectorChoice {
  slug: string;
  name: string;
}

/**
 * Combined sector + stock picker. Sector chips at the top filter the
 * equity list below. Selecting a stock advances the wizard.
 */
export function StepStock({
  sectorChoices,
  sectorSlug,
  equityChoices,
  equityId,
  onPickSector,
  onPickEquity,
}: {
  sectorChoices: SectorChoice[];
  sectorSlug: string;
  equityChoices: EquityChoice[];
  equityId: string;
  onPickSector: (slug: string) => void;
  onPickEquity: (id: string) => void;
}) {
  const t = useT();
  const [filter, setFilter] = useState("");
  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return equityChoices;
    return equityChoices.filter(
      (e) =>
        e.ticker.toLowerCase().includes(q) ||
        e.company_name.toLowerCase().includes(q) ||
        e.exchange.toLowerCase().includes(q),
    );
  }, [filter, equityChoices]);

  // When sector changes, clear filter to avoid surprise empty lists.
  useEffect(() => {
    setFilter("");
  }, [sectorSlug]);

  return (
    <div className="space-y-5">
      <header>
        <h2 className="text-lg font-semibold text-neutral-100">
          {t("prediction.stock.heading")}
        </h2>
        <p className="mt-1 text-[12px] text-neutral-500">
          {t("prediction.stock.subheading")}
        </p>
      </header>

      <section>
        <p className="mb-2 text-[10px] uppercase tracking-wider text-neutral-500">
          {t("prediction.stock.sectorLabel")}
        </p>
        <div className="flex flex-wrap gap-2">
          {sectorChoices.map((s) => {
            const theme = themeForVision(null, s.slug);
            const active = sectorSlug === s.slug;
            return (
              <button
                key={s.slug}
                type="button"
                onClick={() => onPickSector(s.slug)}
                className={`flex items-center gap-2 rounded-full border px-3 py-1.5 text-[12px] transition ${
                  active
                    ? `${theme.border} bg-neutral-900 text-neutral-100 ${theme.glow}`
                    : "border-neutral-800 bg-neutral-950 text-neutral-400 hover:border-neutral-600"
                }`}
              >
                <span>{theme.emoji}</span>
                <span className="font-medium">{s.name}</span>
              </button>
            );
          })}
        </div>
      </section>

      <section>
        <div className="mb-2 flex items-baseline justify-between">
          <p className="text-[10px] uppercase tracking-wider text-neutral-500">
            {t("prediction.stock.equityLabel")} — {equityChoices.length}
          </p>
          <input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder={t("prediction.stock.filter")}
            className="rounded border border-neutral-800 bg-neutral-950 px-2 py-1 text-[11px] text-neutral-100 focus:border-cyan-700 focus:outline-none"
          />
        </div>
        {equityChoices.length === 0 ? (
          <p className="rounded-lg border border-dashed border-neutral-800 bg-neutral-950/40 p-6 text-center text-[12px] text-neutral-500">
            {t("prediction.stock.empty")}
          </p>
        ) : (
          <div className="grid max-h-[420px] gap-2 overflow-y-auto pr-1 sm:grid-cols-2">
            {filtered.map((e) => {
              const active = equityId === e.id;
              return (
                <button
                  key={e.id}
                  type="button"
                  onClick={() => onPickEquity(e.id)}
                  className={`flex items-center justify-between gap-3 rounded-lg border p-3 text-left transition ${
                    active
                      ? "border-cyan-600 bg-cyan-900/30 shadow-lg shadow-cyan-900/30"
                      : "border-neutral-800 bg-neutral-900/40 hover:border-neutral-600"
                  }`}
                >
                  <div className="min-w-0 flex-1">
                    <p className="flex items-baseline gap-2">
                      <span className="truncate text-sm font-medium text-neutral-100">
                        {e.company_name}
                      </span>
                    </p>
                    <p className="font-mono text-[10px] text-neutral-500">
                      {e.ticker} · {e.exchange}
                    </p>
                  </div>
                  <div className="shrink-0 text-right">
                    <p className="font-mono text-sm font-semibold tabular-nums text-cyan-300">
                      {e.last_close_local != null
                        ? e.last_close_local.toFixed(2)
                        : "—"}
                    </p>
                    <p className="text-[9px] uppercase tracking-wider text-neutral-600">
                      last
                    </p>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
