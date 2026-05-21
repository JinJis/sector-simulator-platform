"use client";

/**
 * Client component for the sector narrative page. Subscribes to the
 * shared sector state (driver values from sliders) and recomputes the
 * per-equity upside / downside on every change.
 *
 * Read shape:
 *   - meta + defaults + driverValues  ← from `useSector()`
 *   - equities + impact breakdown     ← fetched once on mount, then
 *                                       re-runs impact on every slider
 *                                       move (via `fetchEquityImpactBreakdown`
 *                                       debounced effect).
 */

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import {
  fetchEquities,
  fetchEquityImpactBreakdown,
  type DriverContribution,
  type Equity,
  type EquityImpactBreakdownRow,
} from "@/lib/sim-client";

import { useSector } from "../sector-context";

import {
  FALLBACK_THESIS_SUMMARY,
  SECTOR_THESES,
  type SectorThesis,
  type ThesisBullet,
} from "./thesis-content";

// 30d projection: same scale as M5 (`apps/web/.../equities-table.tsx`)
// — keep the home grid + narrative grid + sparklines all visually
// consistent.
const PROJECTION_SCALE = 0.3;
const PROJECTION_THRESHOLD = 1;

export function NarrativeView() {
  const { meta, defaults, driverValues } = useSector();
  const thesis: SectorThesis | undefined = SECTOR_THESES[meta.slug];

  const [equities, setEquities] = useState<Equity[] | null>(null);
  const [breakdown, setBreakdown] = useState<EquityImpactBreakdownRow[]>([]);
  const [error, setError] = useState<string | null>(null);

  // Initial equity list — once per sector.
  useEffect(() => {
    let cancelled = false;
    setEquities(null);
    setBreakdown([]);
    setError(null);
    void fetchEquities(meta.slug)
      .then((r) => {
        if (!cancelled) setEquities(r);
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      cancelled = true;
    };
  }, [meta.slug]);

  // Impact breakdown — re-fetched on driver changes. Slider drags
  // debounce naturally through React's batching; for now we accept
  // one network call per slider commit (no rAF throttle yet).
  useEffect(() => {
    let cancelled = false;
    void fetchEquityImpactBreakdown(meta.slug, driverValues)
      .then((r) => {
        if (!cancelled) setBreakdown(r.equities);
      })
      .catch(() => {
        // Graph might not be seeded yet — silent fallback to empty.
        if (!cancelled) setBreakdown([]);
      });
    return () => {
      cancelled = true;
    };
  }, [meta.slug, driverValues]);

  return (
    <div className="flex flex-col gap-8">
      <ThesisCard meta={meta} thesis={thesis} />

      <DriversBlockers
        thesis={thesis}
        defaults={defaults}
        driverValues={driverValues}
      />

      {error ? (
        <div className="rounded border border-red-900/60 bg-red-950/40 p-4 text-sm text-red-300">
          Equity 데이터 로드 실패: {error}
        </div>
      ) : !equities ? (
        <div className="rounded border border-neutral-800 bg-neutral-900/40 p-6 text-sm text-neutral-500">
          종목 정보를 불러오는 중…
        </div>
      ) : equities.length === 0 ? (
        <div className="rounded border border-neutral-800 bg-neutral-900/40 p-6 text-sm text-neutral-500">
          이 섹터에 등록된 종목이 없습니다.
        </div>
      ) : (
        <PerEquityGrid
          equities={equities}
          breakdown={breakdown}
          flagshipTickers={thesis?.flagshipTickers ?? []}
        />
      )}
    </div>
  );
}

function ThesisCard({
  meta,
  thesis,
}: {
  meta: ReturnType<typeof useSector>["meta"];
  thesis: SectorThesis | undefined;
}) {
  return (
    <section className="rounded-lg border border-cyan-900/40 bg-gradient-to-br from-cyan-950/30 via-neutral-950 to-neutral-950 p-6">
      <div className="mb-2 flex items-baseline gap-3">
        <h2 className="text-base font-semibold text-cyan-300">
          Growth thesis
        </h2>
        {thesis && (
          <span className="rounded-full border border-cyan-900/60 bg-cyan-950/60 px-2 py-0.5 text-[10px] uppercase tracking-wider text-cyan-300">
            {thesis.horizon}
          </span>
        )}
      </div>
      <p className="text-sm leading-relaxed text-neutral-200">
        {thesis?.summary ?? FALLBACK_THESIS_SUMMARY}
      </p>
      {!thesis && (
        <p className="mt-3 text-xs text-neutral-500">
          섹터 슬러그: <code>{meta.slug}</code>
        </p>
      )}
    </section>
  );
}

function DriversBlockers({
  thesis,
  defaults,
  driverValues,
}: {
  thesis: SectorThesis | undefined;
  defaults: Record<string, number>;
  driverValues: Record<string, number>;
}) {
  if (!thesis) return null;
  return (
    <section className="grid gap-4 md:grid-cols-2">
      <BulletColumn
        title="Key drivers"
        tone="up"
        bullets={thesis.drivers}
        defaults={defaults}
        driverValues={driverValues}
      />
      <BulletColumn
        title="Key blockers"
        tone="down"
        bullets={thesis.blockers}
        defaults={defaults}
        driverValues={driverValues}
      />
    </section>
  );
}

function BulletColumn({
  title,
  tone,
  bullets,
  defaults,
  driverValues,
}: {
  title: string;
  tone: "up" | "down";
  bullets: ThesisBullet[];
  defaults: Record<string, number>;
  driverValues: Record<string, number>;
}) {
  const accent =
    tone === "up"
      ? "border-emerald-900/40 bg-emerald-950/20 text-emerald-300"
      : "border-rose-900/40 bg-rose-950/20 text-rose-300";
  return (
    <div className="rounded-lg border border-neutral-800 bg-neutral-900/40 p-5">
      <div
        className={`mb-3 inline-block rounded border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${accent}`}
      >
        {title}
      </div>
      <ul className="flex flex-col gap-3">
        {bullets.map((b, i) => (
          <li key={i}>
            <div className="text-sm font-medium text-neutral-100">{b.title}</div>
            <div className="mt-0.5 text-xs leading-relaxed text-neutral-400">
              {b.detail}
            </div>
            {b.driverRefs && b.driverRefs.length > 0 && (
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {b.driverRefs.map((d) => {
                  const def = defaults[d];
                  const cur = driverValues[d];
                  if (def === undefined || cur === undefined) return null;
                  const delta = def !== 0 ? ((cur - def) / Math.abs(def)) * 100 : 0;
                  const positive = delta >= 0;
                  return (
                    <span
                      key={d}
                      className="inline-flex items-center gap-1 rounded border border-neutral-800 bg-neutral-950 px-1.5 py-0.5 font-mono text-[10px] text-neutral-400"
                      title={`${d} · default ${def} · current ${cur}`}
                    >
                      <span className="text-neutral-500">{d}</span>
                      <span
                        className={
                          Math.abs(delta) < 0.05
                            ? "text-neutral-600"
                            : positive
                              ? "text-emerald-400"
                              : "text-rose-400"
                        }
                      >
                        {positive ? "+" : ""}
                        {delta.toFixed(1)}%
                      </span>
                    </span>
                  );
                })}
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

interface ProjRow {
  equity: Equity;
  score: number;
  projectedPct: number;
  target: number | null;
  topContribs: DriverContribution[];
}

function PerEquityGrid({
  equities,
  breakdown,
  flagshipTickers,
}: {
  equities: Equity[];
  breakdown: EquityImpactBreakdownRow[];
  flagshipTickers: string[];
}) {
  const rows = useMemo(() => buildRows(equities, breakdown), [equities, breakdown]);
  const flagSet = useMemo(() => new Set(flagshipTickers), [flagshipTickers]);

  return (
    <section>
      <div className="mb-3 flex items-baseline gap-3">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-neutral-300">
          Per-equity upside / downside
        </h2>
        <span className="text-[11px] text-neutral-600">
          30d projection · impact score × 0.3
        </span>
      </div>
      <div className="overflow-hidden rounded-lg border border-neutral-800 bg-neutral-900/40">
        <table className="w-full text-sm">
          <thead className="bg-neutral-900/60 text-[10px] uppercase tracking-wider text-neutral-500">
            <tr>
              <th className="px-3 py-2 text-left font-medium">Ticker</th>
              <th className="px-3 py-2 text-right font-medium">Current</th>
              <th className="px-3 py-2 text-right font-medium">30d target</th>
              <th className="px-3 py-2 text-right font-medium">Δ%</th>
              <th className="px-3 py-2 text-left font-medium">
                Top contributing drivers
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-800">
            {rows.map((row) => (
              <EquityRow
                key={row.equity.id}
                row={row}
                flagship={flagSet.has(row.equity.ticker)}
              />
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-[10px] text-neutral-600">
        target = last_close × (1 + score × 0.3 / 100). 클릭하여 종목별 상세 분해를 봅니다.
      </p>
    </section>
  );
}

function buildRows(
  equities: Equity[],
  breakdown: EquityImpactBreakdownRow[],
): ProjRow[] {
  const byId = new Map(breakdown.map((b) => [b.equity_id, b]));
  const rows: ProjRow[] = equities.map((eq) => {
    const b = byId.get(eq.id);
    const score = b?.score ?? 0;
    const projectedPct =
      Math.abs(score) < PROJECTION_THRESHOLD ? 0 : score * PROJECTION_SCALE;
    const last = eq.last_close_local;
    const target = last !== null && last !== undefined
      ? last * (1 + projectedPct / 100)
      : null;
    return {
      equity: eq,
      score,
      projectedPct,
      target,
      topContribs: (b?.contributions ?? []).slice(0, 3),
    };
  });
  // Sort by |projectedPct| desc so the "interesting" equities sit at the top.
  rows.sort((a, b) => Math.abs(b.projectedPct) - Math.abs(a.projectedPct));
  return rows;
}

function EquityRow({ row, flagship }: { row: ProjRow; flagship: boolean }) {
  const { equity, score, projectedPct, target, topContribs } = row;
  const positive = projectedPct >= 0;
  const colorClass =
    Math.abs(projectedPct) < PROJECTION_THRESHOLD * PROJECTION_SCALE
      ? "text-neutral-500"
      : positive
        ? "text-emerald-400"
        : "text-rose-400";
  const flag = equity.iso_country === "KR" ? "🇰🇷" : "🇺🇸";

  return (
    <tr className="transition hover:bg-neutral-900">
      <td className="px-3 py-2">
        <Link
          href={`/sectors/${equity.sector_slug}/equities/${encodeURIComponent(equity.ticker)}`}
          className="group flex items-center gap-2 text-neutral-100 hover:text-cyan-300"
        >
          <span aria-hidden>{flag}</span>
          <span className="font-medium">{equity.ticker}</span>
          {flagship && (
            <span
              className="rounded border border-amber-900/60 bg-amber-950/40 px-1 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-amber-300"
              title="Flagship pick — 섹터 thesis의 가장 선명한 표현"
            >
              ★
            </span>
          )}
          <span className="hidden text-[11px] text-neutral-500 sm:inline">
            {equity.company_name_local ?? equity.company_name}
          </span>
        </Link>
      </td>
      <td className="px-3 py-2 text-right font-mono text-xs text-neutral-300">
        {equity.last_close_local !== null && equity.last_close_local !== undefined
          ? `${fmtPrice(equity.last_close_local)} ${equity.currency ?? ""}`
          : "—"}
      </td>
      <td className="px-3 py-2 text-right font-mono text-xs text-neutral-300">
        {target !== null ? fmtPrice(target) : "—"}
      </td>
      <td className={`px-3 py-2 text-right font-mono text-xs ${colorClass}`}>
        {Math.abs(projectedPct) < PROJECTION_THRESHOLD * PROJECTION_SCALE
          ? "—"
          : `${positive ? "+" : ""}${projectedPct.toFixed(1)}%`}
        <span className="ml-1 text-[10px] text-neutral-600">
          score {score.toFixed(0)}
        </span>
      </td>
      <td className="px-3 py-2">
        <div className="flex flex-wrap gap-1.5">
          {topContribs.length === 0 ? (
            <span className="text-[10px] text-neutral-600">—</span>
          ) : (
            topContribs.map((c) => (
              <span
                key={c.driver}
                className="inline-flex items-center gap-1 rounded border border-neutral-800 bg-neutral-950 px-1.5 py-0.5 font-mono text-[10px]"
                title={`${c.driver} · w=${c.weight.toFixed(2)} · Δ ${(c.delta_pct * 100).toFixed(1)}% · contribution ${c.contribution.toFixed(2)}`}
              >
                <span className="text-neutral-500">{shortDriver(c.driver)}</span>
                <span
                  className={
                    c.contribution >= 0 ? "text-emerald-400" : "text-rose-400"
                  }
                >
                  {c.contribution >= 0 ? "+" : ""}
                  {c.contribution.toFixed(2)}
                </span>
              </span>
            ))
          )}
        </div>
      </td>
    </tr>
  );
}

function fmtPrice(n: number): string {
  if (Math.abs(n) >= 10_000) return n.toLocaleString("en-US", { maximumFractionDigits: 0 });
  if (Math.abs(n) >= 100) return n.toLocaleString("en-US", { maximumFractionDigits: 1 });
  return n.toLocaleString("en-US", { maximumFractionDigits: 2 });
}

function shortDriver(name: string): string {
  if (name.length <= 22) return name;
  return name.slice(0, 20) + "…";
}
