"use client";

/**
 * Stock-vs-stock comparison page — M24b.
 *
 * URL: `/sectors/[slug]/compare-stocks?a=TICKER&b=TICKER`
 *
 * Reads two tickers from query params, resolves both via
 * `equity.getByTicker`, fetches each one's history + financials +
 * impact breakdown in parallel, and renders them side-by-side. The
 * goal is to make "which of these two should I prefer?" answerable
 * in one glance — the cards mirror each other top to bottom.
 *
 * If only `a` is provided, the page renders a picker so the user
 * can choose the second stock without leaving.
 */

import { useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";

import {
  fetchEquities,
  fetchEquityByTicker,
  fetchEquityFinancials,
  fetchEquityHistory,
  fetchEquityImpactBreakdown,
  type DriverContribution,
  type Equity,
  type EquityFinancialQuarter,
  type EquityHistoryBar,
  type EquityImpactBreakdownRow,
} from "@/lib/sim-client";

import { useSector } from "../sector-context";

const PROJECTION_SCALE = 0.3;
const PROJECTION_THRESHOLD = 1;

interface SideData {
  equity: Equity;
  history: EquityHistoryBar[];
  financials: EquityFinancialQuarter[];
  breakdown: EquityImpactBreakdownRow | null;
}

export default function StockCompareePage() {
  const { meta, driverValues } = useSector();
  const params = useSearchParams();
  const a = params?.get("a")?.trim() ?? "";
  const b = params?.get("b")?.trim() ?? "";

  const [sideA, setSideA] = useState<SideData | null>(null);
  const [sideB, setSideB] = useState<SideData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pickerOptions, setPickerOptions] = useState<Equity[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    setSideA(null);
    setSideB(null);
    if (!a) {
      // Both missing → load picker options so the user can choose A first.
      void fetchEquities(meta.slug).then((r) => {
        if (!cancelled) setPickerOptions(r);
      });
      return;
    }
    Promise.all([
      a ? loadSide(meta.slug, a, driverValues) : Promise.resolve(null),
      b ? loadSide(meta.slug, b, driverValues) : Promise.resolve(null),
    ])
      .then(([sa, sb]) => {
        if (cancelled) return;
        setSideA(sa);
        setSideB(sb);
        if (!sb) {
          // A loaded but B not — show the picker for B only.
          void fetchEquities(meta.slug).then((r) => {
            if (!cancelled) setPickerOptions(r);
          });
        }
      })
      .catch((e) => {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : "compare load failed");
      });
    return () => {
      cancelled = true;
    };
  }, [meta.slug, a, b, driverValues]);

  if (error) {
    return (
      <div className="rounded border border-rose-900/60 bg-rose-950/40 p-6 text-sm text-rose-300">
        비교 데이터를 불러오지 못했습니다: {error}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <header>
        <h1 className="text-2xl font-semibold text-neutral-50">종목 비교</h1>
        <p className="mt-1 max-w-3xl text-sm text-neutral-400">
          두 종목을 나란히 놓고 현재 가격 · 30일 예상 변동 · 가장 영향력 있는
          요인 · 분기 실적을 한 화면에서 비교합니다.
        </p>
      </header>

      {(!sideA || !sideB) && (
        <PickerRow
          sectorSlug={meta.slug}
          options={pickerOptions}
          a={a || null}
          b={b || null}
          sideA={sideA}
        />
      )}

      {sideA && sideB && (
        <div className="grid gap-5 lg:grid-cols-2">
          <SideCard side={sideA} otherTicker={sideB.equity.ticker} sectorSlug={meta.slug} role="a" />
          <SideCard side={sideB} otherTicker={sideA.equity.ticker} sectorSlug={meta.slug} role="b" />
        </div>
      )}

      {sideA && sideB && (
        <DiffSummary a={sideA} b={sideB} />
      )}
    </div>
  );
}

async function loadSide(
  sectorSlug: string,
  ticker: string,
  driverValues: Record<string, number>,
): Promise<SideData | null> {
  try {
    const equity = await fetchEquityByTicker({ sectorSlug, ticker });
    const [history, financials, breakdownResp] = await Promise.all([
      fetchEquityHistory(equity.id, 90).catch(() => [] as EquityHistoryBar[]),
      fetchEquityFinancials(equity.id, 8).catch(() => [] as EquityFinancialQuarter[]),
      fetchEquityImpactBreakdown(sectorSlug, driverValues).catch(() => null),
    ]);
    const breakdown =
      breakdownResp?.equities.find((e) => e.equity_id === equity.id) ?? null;
    return { equity, history, financials, breakdown };
  } catch {
    return null;
  }
}

function PickerRow({
  sectorSlug,
  options,
  a,
  b,
  sideA,
}: {
  sectorSlug: string;
  options: Equity[] | null;
  a: string | null;
  b: string | null;
  sideA: SideData | null;
}) {
  // Empty state pre-A: pick *any* stock as A.
  if (!a) {
    return (
      <section className="rounded-lg border border-neutral-800 bg-neutral-900/30 p-5">
        <h2 className="mb-2 text-sm font-medium text-neutral-200">
          첫 번째 종목을 고르세요
        </h2>
        <p className="mb-3 text-xs text-neutral-500">
          비교는 한 섹터 내에서만 가능합니다.
        </p>
        <TickerGrid sectorSlug={sectorSlug} options={options} side="a" />
      </section>
    );
  }
  // A loaded, B missing.
  return (
    <section className="rounded-lg border border-neutral-800 bg-neutral-900/30 p-5">
      <h2 className="mb-2 text-sm font-medium text-neutral-200">
        <span className="font-mono text-cyan-300">{sideA?.equity.ticker}</span> 와
        비교할 종목을 고르세요
      </h2>
      <TickerGrid
        sectorSlug={sectorSlug}
        options={options}
        side="b"
        currentA={a}
      />
    </section>
  );
}

function TickerGrid({
  sectorSlug,
  options,
  side,
  currentA,
}: {
  sectorSlug: string;
  options: Equity[] | null;
  side: "a" | "b";
  currentA?: string;
}) {
  if (!options) {
    return <p className="text-xs text-neutral-500">불러오는 중…</p>;
  }
  return (
    <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
      {options
        .filter((eq) => eq.ticker !== currentA)
        .map((eq) => {
          const url =
            side === "a"
              ? `/sectors/${sectorSlug}/compare-stocks?a=${encodeURIComponent(eq.ticker)}`
              : `/sectors/${sectorSlug}/compare-stocks?a=${encodeURIComponent(currentA!)}&b=${encodeURIComponent(eq.ticker)}`;
          return (
            <li key={eq.id}>
              <Link
                href={url}
                className="block rounded border border-neutral-800 bg-neutral-950 px-2 py-1.5 text-xs hover:border-cyan-700 hover:bg-neutral-900"
              >
                <div className="flex items-center gap-1">
                  <span aria-hidden>
                    {eq.iso_country === "KR" ? "🇰🇷" : "🇺🇸"}
                  </span>
                  <span className="font-mono font-semibold text-neutral-200">
                    {eq.ticker}
                  </span>
                </div>
                <div className="truncate text-[10px] text-neutral-500">
                  {eq.company_name_local ?? eq.company_name}
                </div>
              </Link>
            </li>
          );
        })}
    </ul>
  );
}

function SideCard({
  side,
  otherTicker,
  sectorSlug,
  role,
}: {
  side: SideData;
  otherTicker: string;
  sectorSlug: string;
  role: "a" | "b";
}) {
  const equity = side.equity;
  const score = side.breakdown?.score ?? 0;
  const projectedPct =
    Math.abs(score) < PROJECTION_THRESHOLD ? 0 : score * PROJECTION_SCALE;
  const positive = projectedPct >= 0;
  const flag = equity.iso_country === "KR" ? "🇰🇷" : "🇺🇸";
  const last = equity.last_close_local;
  const target = last !== null && last !== undefined ? last * (1 + projectedPct / 100) : null;
  const lastFinancial = side.financials[0];
  const ret90 = computeReturn(side.history);

  return (
    <section className="rounded-lg border border-neutral-800 bg-neutral-900/40 p-5">
      <header className="mb-3 flex items-baseline justify-between gap-2">
        <div className="flex flex-wrap items-baseline gap-2">
          <span className="rounded border border-cyan-900/60 bg-cyan-950/40 px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-cyan-300">
            {role.toUpperCase()}
          </span>
          <span aria-hidden>{flag}</span>
          <h2 className="font-mono text-lg font-semibold text-neutral-50">
            {equity.ticker}
          </h2>
          <span className="text-xs text-neutral-400">
            {equity.company_name_local ?? equity.company_name}
          </span>
        </div>
        <Link
          href={`/sectors/${sectorSlug}/compare-stocks?a=${encodeURIComponent(role === "a" ? otherTicker : equity.ticker)}`}
          className="text-[10px] text-neutral-500 hover:text-cyan-400"
          title="이 종목 자리에 다른 종목 선택"
        >
          변경
        </Link>
      </header>

      <div className="grid grid-cols-2 gap-2">
        <Stat
          label="현재 가격"
          value={
            last !== null && last !== undefined
              ? `${fmtPrice(last)} ${equity.currency ?? ""}`
              : "—"
          }
        />
        <Stat
          label="30일 예상"
          value={
            Math.abs(projectedPct) < PROJECTION_THRESHOLD * PROJECTION_SCALE
              ? "—"
              : `${positive ? "+" : ""}${projectedPct.toFixed(1)}%`
          }
          tone={positive ? "up" : "down"}
          sub={target !== null ? `→ ${fmtPrice(target)} ${equity.currency ?? ""}` : undefined}
        />
        <Stat
          label="90일 변동"
          value={
            ret90 === null
              ? "—"
              : `${ret90 >= 0 ? "+" : ""}${ret90.toFixed(1)}%`
          }
          tone={
            ret90 === null ? "muted" : ret90 >= 0 ? "up" : "down"
          }
        />
        <Stat
          label="섹터 노출"
          value={`${equity.sector_exposure_pct.toFixed(0)}%`}
          sub={
            equity.market_cap_usd
              ? `시총 ≈ $${fmtCompactUsd(equity.market_cap_usd)}`
              : undefined
          }
        />
      </div>

      <div className="mt-4">
        <h3 className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-neutral-500">
          가장 큰 영향을 주는 요인
        </h3>
        {side.breakdown && side.breakdown.contributions.length > 0 ? (
          <ul className="flex flex-col gap-1">
            {side.breakdown.contributions.slice(0, 3).map((c) => (
              <li
                key={c.driver}
                className="flex items-start gap-2 rounded border border-neutral-800 bg-neutral-950/60 px-2 py-1.5 text-xs"
              >
                <span aria-hidden>{c.contribution >= 0 ? "🟢" : "🔴"}</span>
                <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-neutral-400">
                  {c.driver}
                </span>
                <span
                  className={
                    c.contribution >= 0
                      ? "shrink-0 font-semibold tabular-nums text-emerald-400"
                      : "shrink-0 font-semibold tabular-nums text-rose-400"
                  }
                >
                  {c.contribution >= 0 ? "+" : ""}
                  {c.contribution.toFixed(2)}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-[11px] text-neutral-500">
            연결된 요인이 없거나 그래프 미적재.
          </p>
        )}
      </div>

      {lastFinancial && (
        <div className="mt-4">
          <h3 className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-neutral-500">
            최신 분기 ({String(lastFinancial.fiscal_year).slice(2)}Q{lastFinancial.fiscal_quarter})
          </h3>
          <div className="grid grid-cols-2 gap-2 text-xs">
            <FinStat label="매출" value={lastFinancial.revenue_usd} />
            <FinStat
              label="총이익률"
              value={
                lastFinancial.revenue_usd && lastFinancial.gross_profit_usd
                  ? (lastFinancial.gross_profit_usd / lastFinancial.revenue_usd) * 100
                  : null
              }
              suffix="%"
              precision={1}
            />
            <FinStat label="EBITDA" value={lastFinancial.ebitda_usd} />
            <FinStat label="Capex" value={lastFinancial.capex_usd} />
          </div>
        </div>
      )}

      <Link
        href={`/sectors/${sectorSlug}/equities/${encodeURIComponent(equity.ticker)}`}
        className="mt-4 inline-block text-[11px] text-cyan-400 hover:text-cyan-300"
      >
        {equity.ticker} 상세 보기 →
      </Link>
    </section>
  );
}

function DiffSummary({ a, b }: { a: SideData; b: SideData }) {
  const lastA = a.financials[0];
  const lastB = b.financials[0];
  const revA = lastA?.revenue_usd ?? null;
  const revB = lastB?.revenue_usd ?? null;
  const margin = (fin: EquityFinancialQuarter | undefined) =>
    fin?.revenue_usd && fin.gross_profit_usd
      ? (fin.gross_profit_usd / fin.revenue_usd) * 100
      : null;
  const ret90A = computeReturn(a.history);
  const ret90B = computeReturn(b.history);
  const scoreA = a.breakdown?.score ?? 0;
  const scoreB = b.breakdown?.score ?? 0;

  return (
    <section className="rounded-lg border border-neutral-800 bg-neutral-900/30 p-5">
      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-neutral-300">
        한눈에 비교
      </h2>
      <table className="w-full text-sm">
        <thead className="text-[10px] uppercase tracking-wider text-neutral-500">
          <tr>
            <th className="px-2 py-1 text-left font-medium">지표</th>
            <th className="px-2 py-1 text-right font-medium font-mono">
              {a.equity.ticker}
            </th>
            <th className="px-2 py-1 text-right font-medium font-mono">
              {b.equity.ticker}
            </th>
            <th className="px-2 py-1 text-right font-medium">우위</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-neutral-800 text-neutral-200">
          <DiffRow
            label="30일 예상 변동"
            a={scoreA * PROJECTION_SCALE}
            b={scoreB * PROJECTION_SCALE}
            higherIsBetter
            suffix="%"
            precision={1}
          />
          <DiffRow
            label="90일 변동"
            a={ret90A}
            b={ret90B}
            higherIsBetter
            suffix="%"
            precision={1}
          />
          <DiffRow
            label="매출 (최신 분기, USD)"
            a={revA}
            b={revB}
            higherIsBetter
            isCurrency
          />
          <DiffRow
            label="총이익률"
            a={margin(lastA)}
            b={margin(lastB)}
            higherIsBetter
            suffix="%"
            precision={1}
          />
          <DiffRow
            label="EBITDA"
            a={lastA?.ebitda_usd ?? null}
            b={lastB?.ebitda_usd ?? null}
            higherIsBetter
            isCurrency
          />
          <DiffRow
            label="Capex (낮을수록 효율)"
            a={lastA?.capex_usd ?? null}
            b={lastB?.capex_usd ?? null}
            higherIsBetter={false}
            isCurrency
          />
        </tbody>
      </table>
    </section>
  );
}

function DiffRow({
  label,
  a,
  b,
  higherIsBetter,
  suffix = "",
  precision = 0,
  isCurrency,
}: {
  label: string;
  a: number | null;
  b: number | null;
  higherIsBetter: boolean;
  suffix?: string;
  precision?: number;
  isCurrency?: boolean;
}) {
  const fmt = (n: number | null) => {
    if (n === null || n === undefined) return "—";
    if (isCurrency) return "$" + fmtCompactUsd(n);
    return n.toFixed(precision) + suffix;
  };
  let winner: "a" | "b" | "tie" | "n/a" = "n/a";
  if (a !== null && b !== null) {
    if (Math.abs(a - b) < 0.0001) winner = "tie";
    else winner = (a > b) === higherIsBetter ? "a" : "b";
  }
  const cellTone = (side: "a" | "b") =>
    winner === side ? "font-semibold text-emerald-400" : "text-neutral-300";
  return (
    <tr>
      <td className="px-2 py-1.5 text-xs text-neutral-400">{label}</td>
      <td className={`px-2 py-1.5 text-right font-mono text-xs ${cellTone("a")}`}>
        {fmt(a)}
      </td>
      <td className={`px-2 py-1.5 text-right font-mono text-xs ${cellTone("b")}`}>
        {fmt(b)}
      </td>
      <td className="px-2 py-1.5 text-right text-[11px] text-neutral-500">
        {winner === "tie"
          ? "동률"
          : winner === "n/a"
            ? "—"
            : (winner === "a" ? "← A" : "B →")}
      </td>
    </tr>
  );
}

function Stat({
  label,
  value,
  sub,
  tone = "muted",
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: "up" | "down" | "muted";
}) {
  const cls =
    tone === "up"
      ? "text-emerald-400"
      : tone === "down"
        ? "text-rose-400"
        : "text-neutral-100";
  return (
    <div className="rounded border border-neutral-800 bg-neutral-950/60 px-2 py-1.5">
      <div className="text-[10px] uppercase tracking-wider text-neutral-500">
        {label}
      </div>
      <div className={`mt-0.5 text-sm font-semibold tabular-nums ${cls}`}>
        {value}
      </div>
      {sub && <div className="mt-0.5 text-[10px] text-neutral-600">{sub}</div>}
    </div>
  );
}

function FinStat({
  label,
  value,
  suffix = "",
  precision = 0,
}: {
  label: string;
  value: number | null | undefined;
  suffix?: string;
  precision?: number;
}) {
  let display: string;
  if (value === null || value === undefined) display = "—";
  else if (suffix) display = value.toFixed(precision) + suffix;
  else display = "$" + fmtCompactUsd(value);
  return (
    <div className="rounded border border-neutral-800 bg-neutral-950/60 px-2 py-1.5">
      <div className="text-[10px] uppercase tracking-wider text-neutral-500">
        {label}
      </div>
      <div className="mt-0.5 text-xs font-semibold tabular-nums text-neutral-200">
        {display}
      </div>
    </div>
  );
}

function computeReturn(bars: EquityHistoryBar[]): number | null {
  if (bars.length < 2) return null;
  const first = bars[0]!.close_local;
  const last = bars[bars.length - 1]!.close_local;
  if (!first || !last) return null;
  return ((last - first) / first) * 100;
}

function fmtPrice(n: number): string {
  if (Math.abs(n) >= 10_000)
    return n.toLocaleString("en-US", { maximumFractionDigits: 0 });
  return n.toLocaleString("en-US", { maximumFractionDigits: 2 });
}

function fmtCompactUsd(n: number): string {
  if (n >= 1e12) return `${(n / 1e12).toFixed(2)}T`;
  if (n >= 1e9) return `${(n / 1e9).toFixed(1)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(0)}M`;
  return n.toFixed(0);
}
