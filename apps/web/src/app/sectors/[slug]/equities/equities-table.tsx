"use client";

import { useMemo, useState } from "react";

import type { Equity, EquityDriverLink } from "@/lib/sim-client";

interface Props {
  equities: Equity[];
  defaults: Record<string, number>;
  driverValues: Record<string, number>;
}

type CountryFilter = "all" | "US" | "KR";
type SortKey = "editorial" | "marketCap" | "exposure" | "impact" | "ticker";

const MAGNITUDE_WEIGHT: Record<EquityDriverLink["magnitude"], number> = {
  low: 0.5,
  med: 1.0,
  high: 2.0,
};

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

export function EquitiesTable({ equities, defaults, driverValues }: Props) {
  const [country, setCountry] = useState<CountryFilter>("all");
  const [sort, setSort] = useState<SortKey>("editorial");
  const [expandedId, setExpandedId] = useState<string | null>(null);

  // Pre-compute impact once per render — sorting + display both need it.
  const enriched = useMemo(
    () =>
      equities.map((e) => ({
        equity: e,
        ...impliedImpactPct(e, defaults, driverValues),
      })),
    [equities, defaults, driverValues],
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
        default 대비 편차로 계산한 방향성 점수입니다 (econometric 모델 아님, [-100,+100] 클램프). 가격
        스냅샷은 2026-04-30 종가 기준 · FX 1,380 KRW/USD.
      </p>
    </div>
  );
}

function Row({
  equity,
  score,
  activeLinks,
  expanded,
  onToggle,
  defaults,
  driverValues,
}: {
  equity: Equity;
  score: number;
  activeLinks: number;
  expanded: boolean;
  onToggle: () => void;
  defaults: Record<string, number>;
  driverValues: Record<string, number>;
}) {
  const flag = equity.iso_country === "US" ? "🇺🇸" : "🇰🇷";
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
          <td colSpan={8} className="px-4 py-4">
            <div className="grid gap-4 lg:grid-cols-2">
              <div>
                <h4 className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-neutral-500">
                  편입 사유
                </h4>
                <p className="text-sm leading-relaxed text-neutral-300">
                  {equity.rationale || "— 편입 메모 없음 —"}
                </p>
              </div>
              <div>
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
            </div>
          </td>
        </tr>
      )}
    </>
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
