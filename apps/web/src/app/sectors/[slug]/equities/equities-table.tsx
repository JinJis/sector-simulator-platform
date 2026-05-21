"use client";

import { Sparkline } from "@platform/ui";
import { useEffect, useMemo, useState } from "react";

import {
  fetchBasketStats,
  fetchEquityFinancials,
  fetchEquityHistory,
  fetchEquityImpactScores,
  type BasketStats,
  type BasketStatsEquity,
  type Equity,
  type EquityDriverLink,
  type EquityFinancialQuarter,
  type EquityHistoryBar,
} from "@/lib/sim-client";

interface Props {
  equities: Equity[];
  defaults: Record<string, number>;
  driverValues: Record<string, number>;
  /** Set by the page: needed to fetch sector-wide basketStats. */
  sectorSlug: string;
}

type CountryFilter = "all" | "US" | "KR";
type SortKey = "editorial" | "marketCap" | "exposure" | "impact" | "ticker";

const MAGNITUDE_WEIGHT: Record<EquityDriverLink["magnitude"], number> = {
  low: 0.5,
  med: 1.0,
  high: 2.0,
};

/**
 * Map an impliedImpact score (∈ [-100, +100]) to a projected return %
 * over `PROJECTION_DAYS`. SCALE = 0.3 means a saturated +100 impact
 * implies +30% over the forward window — illustrative for an editorial
 * signal, not a forecasting commitment.
 *
 * The projection is suppressed (returns null) when |impact| is below
 * `PROJECTION_THRESHOLD`, so a chart resting on slider defaults isn't
 * cluttered by a meaningless flat extension.
 */
const PROJECTION_SCALE = 0.3;
const PROJECTION_DAYS = 30;
const PROJECTION_THRESHOLD = 1.0;

function projectFromImpact(
  lastClose: number,
  impactScore: number,
): { projectedClose: number; projectedReturnPct: number } | null {
  if (Math.abs(impactScore) < PROJECTION_THRESHOLD) return null;
  if (!Number.isFinite(lastClose) || lastClose <= 0) return null;
  const projectedReturnPct = impactScore * PROJECTION_SCALE;
  const projectedClose = lastClose * (1 + projectedReturnPct / 100);
  return { projectedClose, projectedReturnPct };
}

/**
 * Compute a normalized directional impact score in [-100, +100] based on
 * how far the current driver state has drifted from defaults, weighted by
 * the equity's editorial driver_links (sign + magnitude).
 *
 * This isn't an econometric model — it's a structured directional cue so
 * users can see at a glance "if I push HBM premium up 20%, who lights up?"
 * Calibration is by editorial choice in seed-equities.ts (the magnitudes).
 *
 * Algorithm:
 *   For each link: deltaPct = (current - default) / |default|
 *   contribution = deltaPct * sign * magnitudeWeight
 *   Sum, then squash with tanh-like clamp so any single huge slider doesn't
 *   pin the score at ±infinity.
 */
function impliedImpactPct(
  equity: Equity,
  defaults: Record<string, number>,
  current: Record<string, number>,
): { score: number; activeLinks: number } {
  let raw = 0;
  let active = 0;
  for (const link of equity.driver_links) {
    const def = defaults[link.driver];
    const cur = current[link.driver];
    if (def === undefined || cur === undefined) continue;
    if (Math.abs(def) < 1e-9) continue;
    const deltaPct = (cur - def) / Math.abs(def);
    if (Math.abs(deltaPct) < 1e-4) continue;
    active += 1;
    const signed = link.sign === "+" ? 1 : -1;
    raw += deltaPct * signed * MAGNITUDE_WEIGHT[link.magnitude] * 100;
  }
  // Clamp via tanh-style squash so a single 200% slider doesn't drown out
  // the rest of the basket. Saturates near ±100.
  const score = 100 * Math.tanh(raw / 100);
  return { score, activeLinks: active };
}

function compactUsd(usd: number): string {
  const abs = Math.abs(usd);
  if (abs >= 1e12) return `$${(usd / 1e12).toFixed(2)}T`;
  if (abs >= 1e9) return `$${(usd / 1e9).toFixed(1)}B`;
  if (abs >= 1e6) return `$${(usd / 1e6).toFixed(0)}M`;
  return `$${Math.round(usd).toLocaleString()}`;
}

function formatLocalPrice(price: number, currency: string | null): string {
  if (currency === "KRW") return `₩${Math.round(price).toLocaleString()}`;
  if (currency === "USD") return `$${price.toFixed(2)}`;
  return price.toLocaleString();
}

const COUNTRY_LABEL: Record<CountryFilter, string> = {
  all: "All",
  US: "🇺🇸 US",
  KR: "🇰🇷 KR",
};

export function EquitiesTable({ equities, defaults, driverValues, sectorSlug }: Props) {
  const [country, setCountry] = useState<CountryFilter>("all");
  const [sort, setSort] = useState<SortKey>("editorial");
  const [expandedId, setExpandedId] = useState<string | null>(null);

  // Lazy-loaded 90-day history per equity. Null = pending, [] = no bars
  // ingested (run `pnpm db:seed:equities` + the data-pipeline refresh-
  // quote-history job). Fetched in parallel once after first render so
  // the table renders immediately and sparklines pop in as they arrive.
  const [histories, setHistories] = useState<
    Record<string, EquityHistoryBar[] | null>
  >({});

  // Sector-wide basket statistics (β / α / σ / max DD vs equal-weighted
  // basket of all equities in the sector + the basket's cumulative index
  // curve for the overlay sparkline). Computed server-side from quote
  // history; matches the per-equity history we fetch separately.
  const [basket, setBasket] = useState<BasketStats | null>(null);

  // M9 server-side impliedImpact (graph-traversal). Falls back to the
  // client-side `driver_links` formula when this map is empty (graph
  // not seeded yet) so old behavior is preserved.
  const [serverScores, setServerScores] = useState<Record<string, number>>({});

  useEffect(() => {
    let cancelled = false;
    // Reset so a sector-switch doesn't show the old basket's bars.
    setHistories({});
    setBasket(null);
    void Promise.all(
      equities.map(async (e) => {
        try {
          const bars = await fetchEquityHistory(e.id, 90);
          return [e.id, bars] as const;
        } catch {
          return [e.id, [] as EquityHistoryBar[]] as const;
        }
      }),
    ).then((pairs) => {
      if (cancelled) return;
      setHistories(Object.fromEntries(pairs));
    });
    void fetchBasketStats(sectorSlug, 90)
      .then((r) => {
        if (!cancelled) setBasket(r);
      })
      .catch(() => {
        if (!cancelled) setBasket({ sector_slug: sectorSlug, days: 90, basket: [], equities: [] });
      });
    return () => {
      cancelled = true;
    };
  }, [equities, sectorSlug]);

  // Re-fetch server-side impact whenever the driver values change.
  // Debounced indirectly by React batching; the call is cheap (no
  // Python sim run, just Postgres + math).
  useEffect(() => {
    let cancelled = false;
    void fetchEquityImpactScores(sectorSlug, driverValues)
      .then((r) => {
        if (!cancelled) setServerScores(r.scores);
      })
      .catch(() => {
        // Leave previous scores in place; client-side fallback covers.
      });
    return () => {
      cancelled = true;
    };
  }, [sectorSlug, driverValues]);

  // Index basket stats by equity_id for O(1) row lookup.
  const basketByEquity = useMemo(() => {
    const m = new Map<string, BasketStatsEquity>();
    if (!basket) return m;
    for (const s of basket.equities) m.set(s.equity_id, s);
    return m;
  }, [basket]);

  // Pre-compute impact once per render — sorting + display both need it.
  // M9: prefer the server-computed graph-traversal score when available
  // (graph_edges seeded). Fall back to the M1 client-side formula
  // (driver_links JSONB) when the server map is empty.
  const enriched = useMemo(
    () =>
      equities.map((e) => {
        const fallback = impliedImpactPct(e, defaults, driverValues);
        const serverScore = serverScores[e.id];
        if (serverScore === undefined) return { equity: e, ...fallback };
        return {
          equity: e,
          score: serverScore,
          activeLinks: fallback.activeLinks,
        };
      }),
    [equities, defaults, driverValues, serverScores],
  );

  const filtered = useMemo(
    () => (country === "all" ? enriched : enriched.filter((e) => e.equity.iso_country === country)),
    [enriched, country],
  );

  const sorted = useMemo(() => {
    const arr = [...filtered];
    switch (sort) {
      case "marketCap":
        arr.sort((a, b) => (b.equity.market_cap_usd ?? 0) - (a.equity.market_cap_usd ?? 0));
        break;
      case "exposure":
        arr.sort((a, b) => b.equity.sector_exposure_pct - a.equity.sector_exposure_pct);
        break;
      case "impact":
        arr.sort((a, b) => Math.abs(b.score) - Math.abs(a.score));
        break;
      case "ticker":
        arr.sort((a, b) => a.equity.ticker.localeCompare(b.equity.ticker));
        break;
      case "editorial":
      default:
        arr.sort((a, b) => {
          const o = a.equity.display_order - b.equity.display_order;
          if (o !== 0) return o;
          return (b.equity.market_cap_usd ?? 0) - (a.equity.market_cap_usd ?? 0);
        });
        break;
    }
    return arr;
  }, [filtered, sort]);

  // Header summary stats
  const stats = useMemo(() => {
    const us = enriched.filter((e) => e.equity.iso_country === "US").length;
    const kr = enriched.filter((e) => e.equity.iso_country === "KR").length;
    const totalCap = enriched.reduce((s, e) => s + (e.equity.market_cap_usd ?? 0), 0);
    const driversTouched = new Set(
      enriched.flatMap((e) =>
        e.equity.driver_links
          .filter((l) => {
            const def = defaults[l.driver];
            const cur = driverValues[l.driver];
            if (def === undefined || cur === undefined) return false;
            return Math.abs((cur - def) / (Math.abs(def) + 1e-9)) > 1e-4;
          })
          .map((l) => l.driver),
      ),
    );
    return { us, kr, totalCap, driversTouched: driversTouched.size };
  }, [enriched, defaults, driverValues]);

  return (
    <div>
      {/* ---- Top metric strip ---- */}
      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatTile label="Equities" value={`${enriched.length}`} caption={`${stats.us} US · ${stats.kr} KR`} />
        <StatTile label="Aggregate market cap" value={compactUsd(stats.totalCap)} caption="snapshot 2026-04-30" />
        <StatTile
          label="Active drivers"
          value={`${stats.driversTouched}`}
          caption={stats.driversTouched > 0 ? "조정 중" : "defaults"}
          tone={stats.driversTouched > 0 ? "active" : undefined}
        />
        <StatTile
          label="Top impact"
          value={(() => {
            const top = [...enriched].sort((a, b) => Math.abs(b.score) - Math.abs(a.score))[0];
            if (!top || stats.driversTouched === 0) return "—";
            const arrow = top.score >= 0 ? "▲" : "▼";
            return `${top.equity.ticker} ${arrow} ${Math.abs(top.score).toFixed(1)}`;
          })()}
          caption="현재 슬라이더 기준"
        />
      </div>

      {/* ---- Filter / sort controls ---- */}
      <div className="mb-3 flex flex-wrap items-center gap-3 rounded-lg border border-neutral-800 bg-neutral-900/40 p-2.5">
        <div className="flex items-center gap-1.5">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-neutral-500">
            Country
          </span>
          {(["all", "US", "KR"] as CountryFilter[]).map((c) => (
            <button
              key={c}
              onClick={() => setCountry(c)}
              className={`rounded border px-2.5 py-1 text-[11px] font-medium transition ${
                country === c
                  ? "border-cyan-700 bg-cyan-950/60 text-cyan-200"
                  : "border-neutral-800 bg-neutral-950 text-neutral-300 hover:bg-neutral-900"
              }`}
            >
              {COUNTRY_LABEL[c]}
            </button>
          ))}
        </div>

        <div className="ml-auto flex items-center gap-2">
          <label className="text-[10px] font-semibold uppercase tracking-wider text-neutral-500">
            Sort
          </label>
          <select
            value={sort}
            onChange={(e) => setSort(e.target.value as SortKey)}
            className="rounded border border-neutral-800 bg-neutral-950 px-2 py-1 text-xs text-neutral-200"
          >
            <option value="editorial">Editorial</option>
            <option value="marketCap">Market cap ↓</option>
            <option value="exposure">Sector exposure ↓</option>
            <option value="impact">Implied impact ↓</option>
            <option value="ticker">Ticker A–Z</option>
          </select>
        </div>
      </div>

      {/* ---- Table ---- */}
      <div className="overflow-x-auto rounded-lg border border-neutral-800 bg-neutral-900/30">
        <table className="w-full min-w-[920px] border-collapse text-sm">
          <thead>
            <tr className="border-b border-neutral-800 bg-neutral-950/60 text-left text-[10px] uppercase tracking-wider text-neutral-500">
              <th className="px-3 py-2 font-semibold">Ticker</th>
              <th className="px-3 py-2 font-semibold">Company</th>
              <th className="px-3 py-2 text-right font-semibold">Last close</th>
              <th className="px-3 py-2 text-right font-semibold">Market cap</th>
              <th className="px-3 py-2 font-semibold">90d trend</th>
              <th className="px-3 py-2 text-right font-semibold">Exposure</th>
              <th className="px-3 py-2 font-semibold">Key drivers</th>
              <th className="px-3 py-2 text-right font-semibold">Implied impact</th>
              <th className="px-3 py-2 font-semibold" />
            </tr>
          </thead>
          <tbody>
            {sorted.map(({ equity, score, activeLinks }) => {
              const expanded = expandedId === equity.id;
              return (
                <Row
                  key={equity.id}
                  equity={equity}
                  score={score}
                  activeLinks={activeLinks}
                  history={histories[equity.id] ?? null}
                  basketStats={basketByEquity.get(equity.id) ?? null}
                  basketIndex={basket?.basket ?? null}
                  expanded={expanded}
                  onToggle={() => setExpandedId(expanded ? null : equity.id)}
                  defaults={defaults}
                  driverValues={driverValues}
                />
              );
            })}
          </tbody>
        </table>
      </div>

      <p className="mt-3 text-[11px] leading-relaxed text-neutral-600">
        Implied impact는 편집팀이 수기로 부여한 driver→equity 링크(부호 + magnitude)와 현재 슬라이더의
        default 대비 편차로 계산한 방향성 점수입니다 (econometric 모델 아님, [-100,+100] 클램프). 90d
        trend는 data-pipeline이 yfinance에서 받아온 일별 종가 시계열입니다 — 아직 ingest 안 됐으면
        대시(—)로 표시. <b className="text-neutral-400">30d projection</b>은 impact score × 0.3%로 매핑한
        forward 30일 dashed line(예: score +50 → +15% 추정) — 편집팀 시그널의 직관적 시각화이며 가격
        예측이 아닙니다.
      </p>
    </div>
  );
}

function Row({
  equity,
  score,
  activeLinks,
  history,
  basketStats,
  basketIndex,
  expanded,
  onToggle,
  defaults,
  driverValues,
}: {
  equity: Equity;
  score: number;
  activeLinks: number;
  history: EquityHistoryBar[] | null;
  basketStats: BasketStatsEquity | null;
  basketIndex: BasketStats["basket"] | null;
  expanded: boolean;
  onToggle: () => void;
  defaults: Record<string, number>;
  driverValues: Record<string, number>;
}) {
  const flag = equity.iso_country === "US" ? "🇺🇸" : "🇰🇷";
  const periodReturnPct = useMemo(() => {
    if (!history || history.length < 2) return null;
    const first = history[0]!.close_local;
    const last = history[history.length - 1]!.close_local;
    if (!first) return null;
    return ((last - first) / first) * 100;
  }, [history]);

  // Projection — recompute every time the impact score changes (slider
  // drag). Memo dep is the score itself so we don't recompute when only
  // unrelated state shifts.
  const projection = useMemo(() => {
    if (!history || history.length < 1) return null;
    const lastClose = history[history.length - 1]!.close_local;
    return projectFromImpact(lastClose, score);
  }, [history, score]);
  const scoreVisible = activeLinks > 0;
  const scoreColor =
    !scoreVisible
      ? "text-neutral-600"
      : score > 5
        ? "text-emerald-300"
        : score < -5
          ? "text-rose-300"
          : "text-neutral-300";

  return (
    <>
      <tr
        className={`border-b border-neutral-900 transition hover:bg-neutral-900/40 ${
          expanded ? "bg-neutral-900/40" : ""
        }`}
      >
        <td className="px-3 py-2.5 align-top">
          <div className="flex items-center gap-1.5">
            <span className="text-xs">{flag}</span>
            <span className="font-mono text-sm font-semibold text-neutral-100">
              {equity.ticker}
            </span>
          </div>
          <div className="mt-0.5 text-[10px] uppercase tracking-wider text-neutral-600">
            {equity.exchange}
          </div>
        </td>
        <td className="px-3 py-2.5 align-top">
          <div className="text-sm text-neutral-100">{equity.company_name}</div>
          {equity.company_name_local && (
            <div className="text-[11px] text-neutral-500">{equity.company_name_local}</div>
          )}
        </td>
        <td className="px-3 py-2.5 text-right align-top tabular-nums">
          {equity.last_close_local !== null ? (
            <>
              <div className="text-sm text-neutral-100">
                {formatLocalPrice(equity.last_close_local, equity.currency)}
              </div>
              {equity.currency !== "USD" && equity.last_close_usd !== null && (
                <div className="text-[10px] text-neutral-600">
                  ${equity.last_close_usd.toFixed(2)}
                </div>
              )}
            </>
          ) : (
            <span className="text-neutral-600">—</span>
          )}
        </td>
        <td className="px-3 py-2.5 text-right align-top tabular-nums">
          <span className="text-sm text-neutral-200">
            {equity.market_cap_usd !== null ? compactUsd(equity.market_cap_usd) : "—"}
          </span>
        </td>
        <td className="px-3 py-2.5 align-top">
          <TrendCell
            history={history}
            returnPct={periodReturnPct}
            beta={basketStats?.beta ?? null}
            projection={projection}
          />
        </td>
        <td className="px-3 py-2.5 text-right align-top tabular-nums">
          <ExposureBar pct={equity.sector_exposure_pct} />
        </td>
        <td className="px-3 py-2.5 align-top">
          <div className="flex flex-wrap gap-1">
            {equity.driver_links.slice(0, 3).map((link) => (
              <DriverChip key={link.driver} link={link} compact />
            ))}
            {equity.driver_links.length > 3 && (
              <span className="rounded border border-neutral-800 px-1.5 py-0.5 text-[10px] text-neutral-500">
                +{equity.driver_links.length - 3}
              </span>
            )}
          </div>
        </td>
        <td className="px-3 py-2.5 text-right align-top tabular-nums">
          {scoreVisible ? (
            <div className="flex flex-col items-end">
              <span className={`text-sm font-semibold ${scoreColor}`}>
                {score > 0 ? "▲" : score < 0 ? "▼" : "·"} {Math.abs(score).toFixed(1)}
              </span>
              <span className="text-[10px] text-neutral-600">{activeLinks} active</span>
            </div>
          ) : (
            <span className="text-[11px] text-neutral-600">defaults</span>
          )}
        </td>
        <td className="px-3 py-2.5 text-right align-top">
          <button
            onClick={onToggle}
            className="rounded border border-neutral-800 bg-neutral-950 px-2 py-1 text-[10px] text-neutral-400 hover:bg-neutral-900 hover:text-neutral-200"
            aria-expanded={expanded}
            aria-label={expanded ? "Collapse details" : "Expand details"}
          >
            {expanded ? "▴" : "▾"}
          </button>
        </td>
      </tr>

      {expanded && (
        <tr className="border-b border-neutral-900 bg-neutral-950/40">
          <td colSpan={9} className="px-4 py-4">
            <div className="grid gap-4 lg:grid-cols-3">
              <div className="lg:col-span-2">
                <h4 className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-neutral-500">
                  편입 사유
                </h4>
                <p className="mb-4 text-sm leading-relaxed text-neutral-300">
                  {equity.rationale || "— 편입 메모 없음 —"}
                </p>
                <h4 className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-neutral-500">
                  Driver linkage ({equity.driver_links.length})
                </h4>
                <ul className="space-y-1.5">
                  {equity.driver_links.map((link) => (
                    <DriverDetailRow
                      key={link.driver}
                      link={link}
                      defaults={defaults}
                      driverValues={driverValues}
                    />
                  ))}
                </ul>
              </div>
              <div>
                <h4 className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-neutral-500">
                  Price history (90d) · vs sector basket
                </h4>
                <ExpandedHistoryPanel
                  history={history}
                  currency={equity.currency}
                  periodReturnPct={periodReturnPct}
                  basketStats={basketStats}
                  basketIndex={basketIndex}
                  projection={projection}
                  impactScore={score}
                  activeLinks={activeLinks}
                />
              </div>
            </div>
            <EquityFinancialsPanel equityId={equity.id} />
          </td>
        </tr>
      )}
    </>
  );
}

/**
 * Mock-seeded 8-quarter fundamentals (M10). Lazy-loaded when the row
 * is expanded so we don't fetch financials for every visible equity.
 * Rendered as four side-by-side mini bar charts: revenue, gross margin
 * %, EBITDA, capex.
 */
function EquityFinancialsPanel({ equityId }: { equityId: string }) {
  const [rows, setRows] = useState<EquityFinancialQuarter[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setRows(null);
    setError(null);
    void fetchEquityFinancials(equityId, 8)
      .then((r) => {
        if (!cancelled) setRows(r);
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      cancelled = true;
    };
  }, [equityId]);

  if (error) {
    return (
      <div className="mt-4 rounded border border-red-900/40 bg-red-950/30 p-3 text-xs text-red-300">
        Financials 로드 실패: {error}
      </div>
    );
  }
  if (!rows) {
    return (
      <div className="mt-4 rounded border border-neutral-800 bg-neutral-900/40 p-3 text-xs text-neutral-500">
        Financials 불러오는 중…
      </div>
    );
  }
  if (rows.length === 0) {
    return null;
  }

  // Sort oldest → newest for left-to-right chart reading.
  const sorted = [...rows].sort((a, b) =>
    new Date(a.period_end).getTime() - new Date(b.period_end).getTime(),
  );

  const revenue = sorted.map((r) => r.revenue_usd ?? 0);
  const grossMarginPct = sorted.map((r) =>
    r.revenue_usd && r.gross_profit_usd
      ? (r.gross_profit_usd / r.revenue_usd) * 100
      : 0,
  );
  const ebitda = sorted.map((r) => r.ebitda_usd ?? 0);
  const capex = sorted.map((r) => r.capex_usd ?? 0);

  const sourceBadge =
    sorted[0]!.source === "mock" ? (
      <span className="rounded bg-amber-950/60 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-amber-400">
        Mock data
      </span>
    ) : null;

  const labels = sorted.map((r) => `${String(r.fiscal_year).slice(2)}Q${r.fiscal_quarter}`);

  return (
    <div className="mt-5 border-t border-neutral-800 pt-4">
      <div className="mb-2 flex items-center gap-2">
        <h4 className="text-[10px] font-semibold uppercase tracking-wider text-neutral-500">
          Financials · last {sorted.length} quarters
        </h4>
        {sourceBadge}
      </div>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <MiniBarChart label="Revenue (USD)" values={revenue} labels={labels} formatUsd compact />
        <MiniBarChart
          label="Gross margin %"
          values={grossMarginPct}
          labels={labels}
          suffix="%"
          compact
        />
        <MiniBarChart label="EBITDA (USD)" values={ebitda} labels={labels} formatUsd compact />
        <MiniBarChart label="Capex (USD)" values={capex} labels={labels} formatUsd compact />
      </div>
      <p className="mt-2 text-[10px] text-neutral-600">
        분기 펀더멘털 (mock) — `market_cap / 8` 앵커로 결정론적 walk. 실 DART/EDGAR 어댑터는
        M10b 슬라이스에서 교체합니다.
      </p>
    </div>
  );
}

/**
 * Dependency-free SVG bar chart. Same visual budget as the inline
 * sparkline — 4 of these fit alongside each other in the expanded row.
 */
function MiniBarChart({
  label,
  values,
  labels,
  formatUsd = false,
  suffix = "",
  compact = false,
}: {
  label: string;
  values: number[];
  labels: string[];
  formatUsd?: boolean;
  suffix?: string;
  compact?: boolean;
}) {
  const width = 220;
  const height = compact ? 64 : 90;
  const padX = 8;
  const padY = 12;
  const barGap = 2;
  const max = values.length ? Math.max(...values) : 0;
  const safeMax = max > 0 ? max : 1;
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
  const barWidth = values.length ? (innerW - barGap * (values.length - 1)) / values.length : 0;

  // Color: positive trend (last > first) → cyan, else neutral grey
  const trendUp = values.length >= 2 && values[values.length - 1]! >= values[0]!;
  const color = trendUp ? "rgb(34 211 238)" : "rgb(115 115 115)";

  return (
    <div className="rounded border border-neutral-800 bg-neutral-950/60 p-2">
      <div className="mb-1 flex items-baseline justify-between gap-2">
        <span className="text-[10px] uppercase tracking-wider text-neutral-500">{label}</span>
        <span className="text-[11px] font-semibold tabular-nums text-neutral-200">
          {formatVal(last)}
        </span>
      </div>
      <svg width="100%" height={height} viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none">
        {values.map((v, i) => {
          const h = Math.max(1, (v / safeMax) * innerH);
          const x = padX + i * (barWidth + barGap);
          const y = padY + (innerH - h);
          return (
            <rect
              key={i}
              x={x}
              y={y}
              width={barWidth}
              height={h}
              fill={color}
              fillOpacity={i === values.length - 1 ? 1 : 0.55}
            />
          );
        })}
      </svg>
      <div className="mt-1 flex justify-between text-[9px] text-neutral-600">
        <span>{labels[0]}</span>
        <span>{labels[labels.length - 1]}</span>
      </div>
    </div>
  );
}

function DriverChip({
  link,
  compact,
}: {
  link: EquityDriverLink;
  compact?: boolean;
}) {
  const signClass =
    link.sign === "+"
      ? "border-emerald-900/60 bg-emerald-950/40 text-emerald-300"
      : "border-rose-900/60 bg-rose-950/40 text-rose-300";
  const magnitudeLabel = link.magnitude === "high" ? "●●●" : link.magnitude === "med" ? "●●" : "●";
  return (
    <span
      className={`inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[10px] font-medium ${signClass}`}
      title={`${link.driver} (${link.sign}/${link.magnitude})${link.note ? ` — ${link.note}` : ""}`}
    >
      <span className="opacity-70">{magnitudeLabel}</span>
      <span className="font-mono">{shortDriver(link.driver, compact ? 18 : 30)}</span>
      <span className="font-bold">{link.sign}</span>
    </span>
  );
}

function DriverDetailRow({
  link,
  defaults,
  driverValues,
}: {
  link: EquityDriverLink;
  defaults: Record<string, number>;
  driverValues: Record<string, number>;
}) {
  const def = defaults[link.driver];
  const cur = driverValues[link.driver];
  const hasState = def !== undefined && cur !== undefined && Math.abs(def) > 1e-9;
  const deltaPct = hasState ? ((cur - def) / Math.abs(def)) * 100 : 0;
  const signed = link.sign === "+" ? 1 : -1;
  const contrib = hasState ? deltaPct * signed * MAGNITUDE_WEIGHT[link.magnitude] : 0;
  const contribColor =
    Math.abs(contrib) < 0.1
      ? "text-neutral-600"
      : contrib > 0
        ? "text-emerald-300"
        : "text-rose-300";

  return (
    <li className="flex flex-wrap items-baseline gap-2 rounded border border-neutral-900 bg-neutral-950/60 p-2 text-[11px]">
      <DriverChip link={link} />
      {hasState ? (
        <>
          <span className="font-mono text-neutral-500">
            {def.toFixed(2)} → {cur.toFixed(2)}
          </span>
          <span className={`tabular-nums ${contribColor}`}>
            Δ {deltaPct > 0 ? "+" : ""}
            {deltaPct.toFixed(1)}%
          </span>
          <span className={`ml-auto tabular-nums ${contribColor}`}>
            contrib {contrib > 0 ? "+" : ""}
            {contrib.toFixed(1)}
          </span>
        </>
      ) : (
        <span className="ml-auto text-neutral-600">no slider state</span>
      )}
      {link.note && (
        <p className="basis-full text-[10px] text-neutral-500">— {link.note}</p>
      )}
    </li>
  );
}

function TrendCell({
  history,
  returnPct,
  beta,
  projection,
}: {
  history: EquityHistoryBar[] | null;
  returnPct: number | null;
  beta: number | null;
  projection: { projectedClose: number; projectedReturnPct: number } | null;
}) {
  if (history === null) {
    return <span className="text-[11px] text-neutral-600">…</span>;
  }
  if (history.length < 2 || returnPct === null) {
    return <span className="text-[11px] text-neutral-600">—</span>;
  }
  const values = history.map((b) => b.close_local);
  // Projection series for the small chart: just two points (last close
  // → projected close). Sparkline interpolates a straight dashed line.
  const projectionValues = projection
    ? [values[values.length - 1]!, projection.projectedClose]
    : undefined;
  const color =
    returnPct > 0.5
      ? "text-emerald-300"
      : returnPct < -0.5
        ? "text-rose-300"
        : "text-neutral-400";
  return (
    <div className="flex items-center gap-2">
      <Sparkline
        values={values}
        projectionValues={projectionValues}
        width={88}
        height={26}
        filled
        ariaLabel={
          projection
            ? `90-day price + 30d projection ${
                projection.projectedReturnPct > 0 ? "+" : ""
              }${projection.projectedReturnPct.toFixed(1)}%`
            : `90-day price trend, ${returnPct.toFixed(1)}%`
        }
      />
      <div className="flex flex-col leading-tight">
        <span className={`text-[11px] tabular-nums ${color}`}>
          {returnPct > 0 ? "+" : ""}
          {returnPct.toFixed(1)}%
        </span>
        {beta !== null && (
          <span
            className="text-[9px] uppercase tracking-wider text-neutral-500 tabular-nums"
            title="Beta vs equal-weighted sector basket"
          >
            β {beta.toFixed(2)}
          </span>
        )}
      </div>
    </div>
  );
}

function ExpandedHistoryPanel({
  history,
  currency,
  periodReturnPct,
  basketStats,
  basketIndex,
  projection,
  impactScore,
  activeLinks,
}: {
  history: EquityHistoryBar[] | null;
  currency: string | null;
  periodReturnPct: number | null;
  basketStats: BasketStatsEquity | null;
  basketIndex: BasketStats["basket"] | null;
  projection: { projectedClose: number; projectedReturnPct: number } | null;
  impactScore: number;
  activeLinks: number;
}) {
  if (history === null) {
    return (
      <div className="rounded border border-neutral-900 bg-neutral-950/40 p-3 text-xs text-neutral-500">
        불러오는 중…
      </div>
    );
  }
  if (history.length === 0) {
    return (
      <div className="rounded border border-neutral-900 bg-neutral-950/40 p-3 text-xs text-neutral-500">
        ingest된 가격 시계열이 없습니다.
        <p className="mt-1 text-[10px] text-neutral-600">
          관리자:{" "}
          <code className="rounded bg-neutral-900 px-1 py-0.5">
            curl -X POST http://localhost:8003/jobs/refresh-quote-history
          </code>
        </p>
      </div>
    );
  }

  const first = history[0]!;
  const last = history[history.length - 1]!;

  // Normalize both the equity and the basket to a common base of 100 so
  // the dual sparkline shows percentage trajectories — comparing absolute
  // prices vs an index curve would be visually meaningless.
  const equityBase = first.close_local;
  const equityNormalized = history.map((b) => (b.close_local / equityBase) * 100);

  // Align basket dates with equity dates (basket may have a slightly
  // different calendar — use the dates that exist in both).
  const equityDates = new Set(history.map((b) => fmtDate(b.trade_date)));
  const overlayValues = basketIndex
    ? basketIndex.filter((p) => equityDates.has(p.trade_date)).map((p) => p.basket_index)
    : undefined;

  const min = Math.min(...history.map((b) => b.close_local));
  const max = Math.max(...history.map((b) => b.close_local));

  // Projection on the normalized axis: start at equity_normalized[last]
  // (i.e. the equity's last close expressed as % of its first close)
  // and apply the same projected return.
  const projectionNormalized = projection
    ? [
        equityNormalized[equityNormalized.length - 1]!,
        equityNormalized[equityNormalized.length - 1]! *
          (1 + projection.projectedReturnPct / 100),
      ]
    : undefined;

  return (
    <div className="rounded border border-neutral-900 bg-neutral-950/40 p-3">
      <Sparkline
        values={equityNormalized}
        overlayValues={overlayValues && overlayValues.length >= 2 ? overlayValues : undefined}
        projectionValues={projectionNormalized}
        width={280}
        height={60}
        filled
        ariaLabel={`90-day price vs sector basket${
          projection
            ? `, 30d projection ${projection.projectedReturnPct > 0 ? "+" : ""}${projection.projectedReturnPct.toFixed(1)}%`
            : ""
        }`}
      />
      {(overlayValues && overlayValues.length >= 2) || projection ? (
        <div className="mt-1 flex flex-wrap items-center gap-3 text-[9px] uppercase tracking-wider text-neutral-600">
          <span className="flex items-center gap-1">
            <span className="inline-block h-0.5 w-3 bg-cyan-300" /> 종목
          </span>
          {overlayValues && overlayValues.length >= 2 && (
            <span className="flex items-center gap-1">
              <span className="inline-block h-0.5 w-3 border-t border-dashed border-neutral-500" /> 섹터 바스켓
            </span>
          )}
          {projection && (
            <span
              className="flex items-center gap-1"
              title="Forward 30d projection from current driver state"
            >
              <span
                className={`inline-block h-0.5 w-3 border-t border-dashed ${
                  projection.projectedReturnPct >= 0 ? "border-emerald-400" : "border-rose-400"
                }`}
              />
              30d projection
            </span>
          )}
        </div>
      ) : null}
      <dl className="mt-2 grid grid-cols-3 gap-2 text-[10px] uppercase tracking-wider text-neutral-500">
        <Stat
          label="period return"
          value={
            periodReturnPct === null
              ? "—"
              : `${periodReturnPct > 0 ? "+" : ""}${periodReturnPct.toFixed(2)}%`
          }
          tone={
            periodReturnPct === null
              ? undefined
              : periodReturnPct > 0
                ? "pos"
                : periodReturnPct < 0
                  ? "neg"
                  : undefined
          }
        />
        <Stat label="min" value={formatLocalPrice(min, currency)} />
        <Stat label="max" value={formatLocalPrice(max, currency)} />
      </dl>

      {projection && (
        <dl className="mt-3 grid grid-cols-3 gap-2 rounded border border-cyan-900/40 bg-cyan-950/20 p-2 text-[10px] uppercase tracking-wider text-neutral-500">
          <Stat
            label="30d projection"
            value={
              projection.projectedReturnPct > 0
                ? `+${projection.projectedReturnPct.toFixed(1)}%`
                : `${projection.projectedReturnPct.toFixed(1)}%`
            }
            tone={projection.projectedReturnPct >= 0 ? "pos" : "neg"}
          />
          <Stat
            label="implied target"
            value={formatLocalPrice(projection.projectedClose, currency)}
            tone={projection.projectedReturnPct >= 0 ? "pos" : "neg"}
          />
          <Stat
            label="impact score"
            value={`${impactScore > 0 ? "+" : ""}${impactScore.toFixed(1)} · ${activeLinks}↗`}
          />
        </dl>
      )}

      {basketStats && (
        <dl className="mt-3 grid grid-cols-4 gap-2 border-t border-neutral-900 pt-3 text-[10px] uppercase tracking-wider text-neutral-500">
          <Stat
            label="β vs basket"
            value={basketStats.beta !== null ? basketStats.beta.toFixed(2) : "—"}
          />
          <Stat
            label="α (ann %)"
            value={
              basketStats.alpha_annual_pct !== null
                ? `${basketStats.alpha_annual_pct > 0 ? "+" : ""}${basketStats.alpha_annual_pct.toFixed(1)}`
                : "—"
            }
            tone={
              basketStats.alpha_annual_pct === null
                ? undefined
                : basketStats.alpha_annual_pct > 0
                  ? "pos"
                  : basketStats.alpha_annual_pct < 0
                    ? "neg"
                    : undefined
            }
          />
          <Stat
            label="vol (ann %)"
            value={
              basketStats.volatility_annual_pct !== null
                ? basketStats.volatility_annual_pct.toFixed(1)
                : "—"
            }
          />
          <Stat
            label="max DD"
            value={
              basketStats.max_drawdown_pct !== null
                ? `−${basketStats.max_drawdown_pct.toFixed(1)}%`
                : "—"
            }
            tone={
              basketStats.max_drawdown_pct !== null && basketStats.max_drawdown_pct > 0
                ? "neg"
                : undefined
            }
          />
        </dl>
      )}

      <p className="mt-2 text-[10px] text-neutral-600">
        {fmtDate(first.trade_date)} → {fmtDate(last.trade_date)} · {history.length}
        {" "}
        bars
        {basketStats && basketStats.bars_used > 0 && (
          <>
            {" · "}β·α fit on {basketStats.bars_used} aligned returns
            {basketStats.r_squared !== null && (
              <> · R² {basketStats.r_squared.toFixed(2)}</>
            )}
          </>
        )}
      </p>
    </div>
  );
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "pos" | "neg";
}) {
  const color =
    tone === "pos"
      ? "text-emerald-300"
      : tone === "neg"
        ? "text-rose-300"
        : "text-neutral-100";
  return (
    <div>
      <div>{label}</div>
      <div className={`font-mono text-sm tabular-nums normal-case ${color}`}>
        {value}
      </div>
    </div>
  );
}

function fmtDate(d: string | Date): string {
  const x = typeof d === "string" ? new Date(d) : d;
  if (isNaN(x.getTime())) return "—";
  return x.toISOString().slice(0, 10);
}

function ExposureBar({ pct }: { pct: number }) {
  const clamped = Math.max(0, Math.min(100, pct));
  return (
    <div className="ml-auto flex w-24 flex-col items-end gap-0.5">
      <span className="text-sm text-neutral-200">{pct.toFixed(0)}%</span>
      <div className="h-1 w-full overflow-hidden rounded-full bg-neutral-800">
        <div
          className="h-full rounded-full bg-cyan-500/60"
          style={{ width: `${clamped}%` }}
        />
      </div>
    </div>
  );
}

function StatTile({
  label,
  value,
  caption,
  tone,
}: {
  label: string;
  value: string;
  caption?: string;
  tone?: "active";
}) {
  return (
    <div
      className={`rounded-lg border p-3 ${
        tone === "active"
          ? "border-cyan-900/60 bg-cyan-950/30"
          : "border-neutral-800 bg-neutral-900/40"
      }`}
    >
      <div className="text-[10px] uppercase tracking-wider text-neutral-500">{label}</div>
      <div className="mt-0.5 text-base font-semibold tabular-nums text-neutral-100">{value}</div>
      {caption && <div className="text-[10px] text-neutral-600">{caption}</div>}
    </div>
  );
}

/** Truncate driver names to keep chips compact: `commodity_dram_asp_usd_per_gb`
 *  → `commodity_dram_asp…` */
function shortDriver(name: string, max: number): string {
  if (name.length <= max) return name;
  return name.slice(0, max - 1) + "…";
}
