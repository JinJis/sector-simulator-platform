"use client";

/**
 * Per-equity narrative detail. Combines the M17 impact decomposition
 * with the M3 sparkline (+ M5 projection) and M10 mock-financials.
 *
 * Subscribes to the sector context for driverValues so dragging a
 * slider on Manual immediately re-ranks the contribution table and
 * shifts the projected target on this page.
 */

import { Sparkline } from "@platform/ui";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import {
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

import { PageIntent } from "../../../../page-intent";
import { SECTOR_PAGE_INTENTS } from "../../../../page-intents";
import { useSector } from "../../sector-context";

const PROJECTION_SCALE = 0.3;
const PROJECTION_DAYS = 30;
const PROJECTION_THRESHOLD = 1;

interface Props {
  ticker: string;
}

export function EquityDetail({ ticker }: Props) {
  const { meta, driverValues } = useSector();

  const [equity, setEquity] = useState<Equity | null>(null);
  const [history, setHistory] = useState<EquityHistoryBar[] | null>(null);
  const [breakdown, setBreakdown] = useState<EquityImpactBreakdownRow | null>(null);
  const [financials, setFinancials] = useState<EquityFinancialQuarter[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Resolve ticker → equity row. Refetch on slug/ticker change.
  useEffect(() => {
    let cancelled = false;
    setEquity(null);
    setHistory(null);
    setFinancials(null);
    setError(null);
    void fetchEquityByTicker({ sectorSlug: meta.slug, ticker })
      .then((e) => {
        if (cancelled) return;
        setEquity(e);
        // Now fan out to history + financials in parallel.
        void Promise.all([
          fetchEquityHistory(e.id, 90).catch(() => [] as EquityHistoryBar[]),
          fetchEquityFinancials(e.id, 8).catch(() => [] as EquityFinancialQuarter[]),
        ]).then(([hist, fin]) => {
          if (cancelled) return;
          setHistory(hist);
          setFinancials(fin);
        });
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
    };
  }, [meta.slug, ticker]);

  // Impact breakdown — re-fetches on driver slider changes.
  useEffect(() => {
    if (!equity) return;
    let cancelled = false;
    void fetchEquityImpactBreakdown(meta.slug, driverValues)
      .then((r) => {
        if (cancelled) return;
        const row = r.equities.find((e) => e.equity_id === equity.id);
        setBreakdown(row ?? null);
      })
      .catch(() => {
        if (!cancelled) setBreakdown(null);
      });
    return () => {
      cancelled = true;
    };
  }, [meta.slug, driverValues, equity]);

  if (error) {
    return (
      <div className="rounded border border-red-900/60 bg-red-950/40 p-6 text-sm text-red-300">
        종목 정보를 불러올 수 없습니다 ({ticker}): {error}
      </div>
    );
  }

  if (!equity) {
    return (
      <div className="rounded border border-neutral-800 bg-neutral-900/40 p-6 text-sm text-neutral-500">
        불러오는 중…
      </div>
    );
  }

  const score = breakdown?.score ?? 0;
  const projectedPct =
    Math.abs(score) < PROJECTION_THRESHOLD ? 0 : score * PROJECTION_SCALE;
  const lastClose = equity.last_close_local;
  const target =
    lastClose !== null && lastClose !== undefined
      ? lastClose * (1 + projectedPct / 100)
      : null;

  return (
    <div className="flex flex-col gap-6">
      <PageIntent intent={SECTOR_PAGE_INTENTS.equityDetail!} defaultOpen={false} />

      <BackLink slug={meta.slug} />

      <Header
        equity={equity}
        projectedPct={projectedPct}
        score={score}
        target={target}
      />

      <PriceChart
        history={history}
        equity={equity}
        projectedPct={projectedPct}
      />

      <WhyThisNumber
        breakdown={breakdown}
        sectorName={meta.name}
      />

      <FinancialsBlock financials={financials} />

      <Citations equity={equity} />
    </div>
  );
}

function BackLink({ slug }: { slug: string }) {
  return (
    <Link
      href={`/sectors/${slug}/equities`}
      className="inline-flex w-fit items-center gap-1 text-xs text-neutral-500 hover:text-cyan-400"
    >
      ← Equities 목록으로
    </Link>
  );
}

function Header({
  equity,
  projectedPct,
  score,
  target,
}: {
  equity: Equity;
  projectedPct: number;
  score: number;
  target: number | null;
}) {
  const positive = projectedPct >= 0;
  const colorClass =
    Math.abs(projectedPct) < PROJECTION_THRESHOLD * PROJECTION_SCALE
      ? "text-neutral-500"
      : positive
        ? "text-emerald-400"
        : "text-rose-400";
  const flag = equity.iso_country === "KR" ? "🇰🇷" : "🇺🇸";

  return (
    <section className="rounded-lg border border-neutral-800 bg-neutral-900/40 p-5">
      <div className="flex flex-wrap items-baseline gap-3">
        <span aria-hidden className="text-2xl">
          {flag}
        </span>
        <h1 className="text-2xl font-semibold text-neutral-50">{equity.ticker}</h1>
        <span className="text-sm text-neutral-400">
          {equity.company_name_local ?? equity.company_name}
        </span>
        <span className="rounded-full border border-neutral-800 bg-neutral-950 px-2 py-0.5 text-[10px] uppercase tracking-wider text-neutral-500">
          {equity.exchange}
        </span>
      </div>

      {equity.rationale && (
        <p className="mt-3 max-w-3xl text-sm leading-relaxed text-neutral-400">
          {equity.rationale}
        </p>
      )}

      <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat
          label="Current"
          value={
            equity.last_close_local !== null && equity.last_close_local !== undefined
              ? `${fmtPrice(equity.last_close_local)} ${equity.currency ?? ""}`
              : "—"
          }
          sub={
            equity.last_close_usd !== null && equity.last_close_usd !== undefined
              ? `≈ $${fmtPrice(equity.last_close_usd)}`
              : undefined
          }
        />
        <Stat
          label="30d target"
          value={target !== null ? fmtPrice(target) : "—"}
          tone={positive ? "up" : "down"}
        />
        <Stat
          label="Implied Δ"
          value={
            Math.abs(projectedPct) < PROJECTION_THRESHOLD * PROJECTION_SCALE
              ? "—"
              : `${positive ? "+" : ""}${projectedPct.toFixed(1)}%`
          }
          sub={`score ${score.toFixed(0)}`}
          tone={positive ? "up" : "down"}
          big
          highlightClass={colorClass}
        />
        <Stat
          label="Sector exposure"
          value={`${equity.sector_exposure_pct.toFixed(0)}%`}
          sub={`mkt cap ≈ $${equity.market_cap_usd !== null && equity.market_cap_usd !== undefined ? fmtCompactUsd(equity.market_cap_usd) : "—"}`}
        />
      </div>
    </section>
  );
}

function Stat({
  label,
  value,
  sub,
  tone,
  big,
  highlightClass,
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: "up" | "down";
  big?: boolean;
  highlightClass?: string;
}) {
  const cls =
    highlightClass ??
    (tone === "up"
      ? "text-emerald-400"
      : tone === "down"
        ? "text-rose-400"
        : "text-neutral-100");
  return (
    <div className="rounded border border-neutral-800 bg-neutral-950/60 px-3 py-2">
      <div className="text-[10px] uppercase tracking-wider text-neutral-500">
        {label}
      </div>
      <div className={`mt-1 ${big ? "text-lg" : "text-sm"} font-semibold tabular-nums ${cls}`}>
        {value}
      </div>
      {sub && <div className="mt-0.5 text-[10px] text-neutral-600">{sub}</div>}
    </div>
  );
}

function PriceChart({
  history,
  equity,
  projectedPct,
}: {
  history: EquityHistoryBar[] | null;
  equity: Equity;
  projectedPct: number;
}) {
  if (history === null) {
    return (
      <section className="rounded-lg border border-neutral-800 bg-neutral-900/40 p-5 text-sm text-neutral-500">
        가격 히스토리 불러오는 중…
      </section>
    );
  }

  const closes = history.map((h) => h.close_local);
  const lastClose = closes[closes.length - 1] ?? equity.last_close_local ?? null;

  let projection: number[] | undefined;
  if (
    lastClose !== null &&
    lastClose !== undefined &&
    Math.abs(projectedPct) >= PROJECTION_THRESHOLD * PROJECTION_SCALE
  ) {
    // 30 dashed-forward points from last close → target.
    const target = lastClose * (1 + projectedPct / 100);
    projection = Array.from({ length: PROJECTION_DAYS + 1 }, (_, i) => {
      const t = i / PROJECTION_DAYS;
      return lastClose + (target - lastClose) * t;
    });
  }

  return (
    <section className="rounded-lg border border-neutral-800 bg-neutral-900/40 p-5">
      <div className="mb-3 flex items-baseline gap-3">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-neutral-300">
          Price · 90d
        </h2>
        <span className="text-[11px] text-neutral-600">
          {history.length} bars · dashed = 30d projection
        </span>
      </div>
      {closes.length === 0 ? (
        <div className="rounded border border-dashed border-neutral-800 p-4 text-xs text-neutral-500">
          quote history가 적재되지 않았습니다. data-pipeline의
          <code className="mx-1 rounded bg-neutral-950 px-1 py-0.5">
            refresh-quote-history
          </code>
          job을 실행해주세요.
        </div>
      ) : (
        <div>
          <Sparkline
            values={closes}
            projectionValues={projection}
            width={720}
            height={140}
            filled
            showLastDot
            ariaLabel={`${equity.ticker} 90d 가격 + 30d projection`}
          />
          <div className="mt-2 flex flex-wrap gap-3 text-[10px] uppercase tracking-wider text-neutral-600">
            <span>
              from {history[0]?.trade_date ? formatDate(history[0].trade_date) : "—"}
            </span>
            <span>
              to {history[history.length - 1]?.trade_date ? formatDate(history[history.length - 1]!.trade_date) : "—"}
            </span>
            <span>
              min {fmtPrice(Math.min(...closes))}
            </span>
            <span>
              max {fmtPrice(Math.max(...closes))}
            </span>
          </div>
        </div>
      )}
    </section>
  );
}

function WhyThisNumber({
  breakdown,
  sectorName,
}: {
  breakdown: EquityImpactBreakdownRow | null;
  sectorName: string;
}) {
  const [showAdvanced, setShowAdvanced] = useState(false);
  const positive = (breakdown?.score ?? 0) >= 0;
  return (
    <section className="rounded-lg border border-neutral-800 bg-neutral-900/40 p-5">
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <h2 className="text-base font-semibold text-neutral-100">
          왜 이 숫자인가요?
        </h2>
        {breakdown && breakdown.contributions.length > 0 && (
          <button
            type="button"
            onClick={() => setShowAdvanced((v) => !v)}
            className="text-[11px] text-neutral-500 hover:text-cyan-300"
          >
            {showAdvanced ? "간단히 보기" : "숫자로 보기"}
          </button>
        )}
      </div>

      {!breakdown || breakdown.contributions.length === 0 ? (
        <p className="text-sm text-neutral-500">
          이 종목은 {sectorName} 의 그래프에서 직접 연결된 요인이 없거나, 그래프가
          아직 초기화되지 않았습니다.
        </p>
      ) : (
        <>
          <p className="mb-4 text-sm leading-relaxed text-neutral-300">
            현재 가정에서 이 종목이{" "}
            <span
              className={
                positive
                  ? "font-semibold text-emerald-400"
                  : "font-semibold text-rose-400"
              }
            >
              {positive ? "수혜" : "피해"}
            </span>
            를 받는 이유 — 가장 큰 영향을 주는 요인 순서대로:
          </p>
          {showAdvanced ? (
            <>
              <DriverContribTable rows={breakdown.contributions} />
              <p className="mt-3 text-[11px] text-neutral-600">
                raw sum = {breakdown.raw_sum.toFixed(3)} → score = 100 ×
                tanh(raw) = {breakdown.score.toFixed(0)} · projected Δ = score ×
                0.3%.
              </p>
            </>
          ) : (
            <ContributionReasonList rows={breakdown.contributions} />
          )}
        </>
      )}
    </section>
  );
}

/**
 * Plain-language list of driver contributions, written so a beginner
 * can read it as English sentences. Top 5 contributions; the rest
 * collapse behind a `+N more` footer line.
 */
function ContributionReasonList({ rows }: { rows: DriverContribution[] }) {
  const top = rows.slice(0, 5);
  const rest = rows.length - top.length;
  return (
    <ul className="flex flex-col gap-2">
      {top.map((c) => (
        <li
          key={c.driver}
          className="flex items-start gap-3 rounded border border-neutral-800 bg-neutral-950/60 p-3"
        >
          <span aria-hidden className="mt-0.5 text-base">
            {c.contribution >= 0 ? "🟢" : "🔴"}
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-sm text-neutral-100">
              <span className="font-medium">{humanizeDriver(c.driver)}</span>{" "}
              {plainLanguageDelta(c.delta_pct, c.weight)}
            </p>
            <div className="mt-1 flex flex-wrap items-baseline gap-2 text-[11px] text-neutral-500">
              <span>
                기본값 {fmtCompactNum(c.default_value)} → 현재{" "}
                {fmtCompactNum(c.current_value)}
              </span>
              <span className="text-neutral-700">·</span>
              <span
                className={
                  c.contribution >= 0
                    ? "font-semibold text-emerald-400"
                    : "font-semibold text-rose-400"
                }
              >
                기여 {c.contribution >= 0 ? "+" : ""}
                {c.contribution.toFixed(2)}
              </span>
            </div>
          </div>
        </li>
      ))}
      {rest > 0 && (
        <li className="text-[11px] text-neutral-600">
          + {rest}개 요인 추가 — "숫자로 보기" 에서 전체 표 확인
        </li>
      )}
    </ul>
  );
}

/**
 * Translate a (delta_pct, weight) pair into a one-line Korean
 * sentence. delta_pct is a fraction (0.3 = +30%); weight encodes the
 * direction of effect (positive/negative).
 */
function plainLanguageDelta(deltaPct: number, weight: number): string {
  const pct = Math.abs(deltaPct * 100);
  const driverDirection = deltaPct >= 0 ? "올라가서" : "내려가서";
  const driverMagnitude = pct < 0.5 ? "약간 " : pct < 5 ? "" : "크게 ";
  // Sign of contribution = sign(deltaPct * weight)
  const helps = deltaPct * weight >= 0;
  const verb = helps ? "이 종목에 유리하게 작용합니다." : "이 종목에 불리하게 작용합니다.";
  if (pct < 0.5) {
    return `기본값 근처에 머물러 있어 영향이 미미합니다.`;
  }
  return `가 기본값 대비 ${driverMagnitude}${pct.toFixed(1)}% ${driverDirection} ${verb}`;
}

function humanizeDriver(name: string): string {
  return name
    .replace(/_/g, " ")
    .replace(/\bpct\b/g, "%")
    .replace(/\busd per\b/g, "$/")
    .replace(/\busd\b/g, "$")
    .replace(/\bpb y0\b/g, "PB y0")
    .trim();
}

/** Power-user view — keep the existing table for "숫자로 보기" mode. */
function DriverContribTable({ rows }: { rows: DriverContribution[] }) {
  const maxAbs = rows.reduce((m, r) => Math.max(m, Math.abs(r.contribution)), 0) || 1;
  return (
    <div className="overflow-hidden rounded border border-neutral-800">
      <table className="w-full text-sm">
        <thead className="bg-neutral-900/60 text-[10px] uppercase tracking-wider text-neutral-500">
          <tr>
            <th className="px-3 py-2 text-left font-medium">요인</th>
            <th className="px-3 py-2 text-right font-medium">기본</th>
            <th className="px-3 py-2 text-right font-medium">현재</th>
            <th className="px-3 py-2 text-right font-medium">Δ %</th>
            <th className="px-3 py-2 text-right font-medium">영향력</th>
            <th className="px-3 py-2 text-right font-medium">기여</th>
            <th className="px-3 py-2 text-left font-medium">시각화</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-neutral-800">
          {rows.map((c) => {
            const positive = c.contribution >= 0;
            const pct = (Math.abs(c.contribution) / maxAbs) * 100;
            return (
              <tr key={c.driver} className="hover:bg-neutral-900">
                <td className="px-3 py-2 font-mono text-xs text-neutral-300">
                  {c.driver}
                </td>
                <td className="px-3 py-2 text-right font-mono text-xs text-neutral-500">
                  {fmtCompactNum(c.default_value)}
                </td>
                <td className="px-3 py-2 text-right font-mono text-xs text-neutral-300">
                  {fmtCompactNum(c.current_value)}
                </td>
                <td className="px-3 py-2 text-right font-mono text-xs text-neutral-300">
                  {(c.delta_pct * 100).toFixed(1)}%
                </td>
                <td className="px-3 py-2 text-right font-mono text-xs text-neutral-300">
                  {c.weight.toFixed(2)}
                </td>
                <td
                  className={`px-3 py-2 text-right font-mono text-xs ${positive ? "text-emerald-400" : "text-rose-400"}`}
                >
                  {positive ? "+" : ""}
                  {c.contribution.toFixed(3)}
                </td>
                <td className="w-32 px-3 py-2">
                  <div className="relative h-2 w-full overflow-hidden rounded bg-neutral-950">
                    <div
                      className={`absolute top-0 h-2 ${positive ? "bg-emerald-500/70 left-1/2" : "bg-rose-500/70 right-1/2"}`}
                      style={{ width: `${pct / 2}%` }}
                    />
                    <div className="absolute left-1/2 top-0 h-2 w-px bg-neutral-700" />
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function FinancialsBlock({
  financials,
}: {
  financials: EquityFinancialQuarter[] | null;
}) {
  if (financials === null) {
    return (
      <section className="rounded-lg border border-neutral-800 bg-neutral-900/40 p-5 text-sm text-neutral-500">
        Financials 불러오는 중…
      </section>
    );
  }
  if (financials.length === 0) {
    return null;
  }
  const sorted = [...financials].sort(
    (a, b) => new Date(a.period_end).getTime() - new Date(b.period_end).getTime(),
  );
  const labels = sorted.map((r) => `${String(r.fiscal_year).slice(2)}Q${r.fiscal_quarter}`);
  const revenue = sorted.map((r) => r.revenue_usd ?? 0);
  const grossMarginPct = sorted.map((r) =>
    r.revenue_usd && r.gross_profit_usd ? (r.gross_profit_usd / r.revenue_usd) * 100 : 0,
  );
  const ebitda = sorted.map((r) => r.ebitda_usd ?? 0);
  const capex = sorted.map((r) => r.capex_usd ?? 0);

  const sourceMock = sorted[0]!.source === "mock";

  return (
    <section className="rounded-lg border border-neutral-800 bg-neutral-900/40 p-5">
      <div className="mb-3 flex items-baseline gap-2">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-neutral-300">
          Financials · last {sorted.length} quarters
        </h2>
        {sourceMock && (
          <span className="rounded bg-amber-950/60 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-amber-400">
            Mock data
          </span>
        )}
      </div>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <MiniBar label="Revenue (USD)" values={revenue} labels={labels} formatUsd />
        <MiniBar label="Gross margin %" values={grossMarginPct} labels={labels} suffix="%" />
        <MiniBar label="EBITDA (USD)" values={ebitda} labels={labels} formatUsd />
        <MiniBar label="Capex (USD)" values={capex} labels={labels} formatUsd />
      </div>
    </section>
  );
}

function MiniBar({
  label,
  values,
  labels,
  formatUsd = false,
  suffix = "",
}: {
  label: string;
  values: number[];
  labels: string[];
  formatUsd?: boolean;
  suffix?: string;
}) {
  const width = 220;
  const height = 80;
  const padX = 8;
  const padY = 14;
  const barGap = 2;
  const safeMax = values.length ? Math.max(...values, 1) : 1;
  const last = values[values.length - 1] ?? 0;
  const formatVal = (v: number) => {
    if (formatUsd) {
      if (v >= 1e9) return `$${(v / 1e9).toFixed(1)}B`;
      if (v >= 1e6) return `$${(v / 1e6).toFixed(0)}M`;
      return `$${v.toFixed(0)}`;
    }
    return `${v.toFixed(1)}${suffix}`;
  };
  const innerW = width - padX * 2;
  const innerH = height - padY * 2;
  const barWidth = values.length
    ? (innerW - barGap * (values.length - 1)) / values.length
    : 0;
  const trendUp = values.length >= 2 && values[values.length - 1]! >= values[0]!;
  const color = trendUp ? "rgb(34 211 238)" : "rgb(115 115 115)";

  return (
    <div className="rounded border border-neutral-800 bg-neutral-950/60 p-2">
      <div className="mb-1 flex items-baseline justify-between gap-2">
        <span className="text-[10px] uppercase tracking-wider text-neutral-500">
          {label}
        </span>
        <span className="text-[11px] font-semibold tabular-nums text-neutral-200">
          {formatVal(last)}
        </span>
      </div>
      <svg
        width="100%"
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="none"
      >
        {values.map((v, i) => {
          const h = Math.max(1, (v / safeMax) * innerH);
          const x = padX + i * (barWidth + barGap);
          const y = padY + (innerH - h);
          return <rect key={i} x={x} y={y} width={barWidth} height={h} fill={color} />;
        })}
      </svg>
      <div className="mt-1 flex justify-between text-[9px] text-neutral-600">
        <span>{labels[0]}</span>
        <span>{labels[labels.length - 1]}</span>
      </div>
    </div>
  );
}

function Citations({ equity }: { equity: Equity }) {
  // M17 minimal citations — just the canonical filings landing pages
  // for KR (DART) and US (SEC EDGAR), if we can construct a stable URL.
  // Per-driver source dive-in stays on the Sources tab.
  const filings = filingLinks(equity);
  if (filings.length === 0) return null;
  return (
    <section className="rounded-lg border border-neutral-800 bg-neutral-900/40 p-5">
      <div className="mb-3 flex items-baseline gap-3">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-neutral-300">
          Filings · sources
        </h2>
        <span className="text-[11px] text-neutral-600">원문 공시로 바로 이동</span>
      </div>
      <ul className="flex flex-wrap gap-2 text-xs">
        {filings.map((f) => (
          <li key={f.url}>
            <a
              href={f.url}
              target="_blank"
              rel="noreferrer noopener"
              className="inline-flex items-center gap-1 rounded border border-neutral-800 bg-neutral-950 px-2 py-1 text-neutral-300 hover:border-cyan-700 hover:text-cyan-300"
            >
              {f.label} ↗
            </a>
          </li>
        ))}
      </ul>
      <p className="mt-2 text-[10px] text-neutral-600">
        Driver별 출처는{" "}
        <Link
          href={`/sectors/${equity.sector_slug}/sources`}
          className="text-neutral-400 hover:text-cyan-400"
        >
          Sources 탭
        </Link>
        에서 확인하세요.
      </p>
    </section>
  );
}

function filingLinks(equity: Equity): { label: string; url: string }[] {
  const out: { label: string; url: string }[] = [];
  if (equity.iso_country === "KR" && /^\d{6}$/.test(equity.ticker)) {
    // DART 회사별 공시 검색 — 종목코드 기반 deep link.
    out.push({
      label: `DART 공시 (${equity.ticker})`,
      url: `https://dart.fss.or.kr/dsab007/main.do?option=corp&textCrpCik=&textCrpNm=${encodeURIComponent(equity.ticker)}`,
    });
  } else if (equity.iso_country === "US") {
    out.push({
      label: `SEC EDGAR (${equity.ticker})`,
      url: `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${encodeURIComponent(equity.ticker)}&type=10-&dateb=&owner=include&count=40`,
    });
  }
  return out;
}

function fmtPrice(n: number): string {
  if (Math.abs(n) >= 10_000) return n.toLocaleString("en-US", { maximumFractionDigits: 0 });
  if (Math.abs(n) >= 100) return n.toLocaleString("en-US", { maximumFractionDigits: 1 });
  return n.toLocaleString("en-US", { maximumFractionDigits: 2 });
}

function fmtCompactNum(n: number): string {
  if (Math.abs(n) >= 1e9) return `${(n / 1e9).toFixed(2)}B`;
  if (Math.abs(n) >= 1e6) return `${(n / 1e6).toFixed(2)}M`;
  if (Math.abs(n) >= 1e3) return `${(n / 1e3).toFixed(2)}k`;
  if (Math.abs(n) >= 10) return n.toFixed(1);
  return n.toFixed(3);
}

function fmtCompactUsd(n: number): string {
  if (n >= 1e12) return `${(n / 1e12).toFixed(2)}T`;
  if (n >= 1e9) return `${(n / 1e9).toFixed(1)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(0)}M`;
  return n.toFixed(0);
}

function formatDate(d: Date | string): string {
  const s = typeof d === "string" ? d : d.toISOString();
  return s.slice(0, 10);
}
