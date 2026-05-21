"use client";

/**
 * Simulate page — M23.
 *
 * Beginner-first slider experience: show only the 5 most-impactful
 * drivers (ranked by `sensitivity.swing`), with large visual gauges
 * that make "current vs default" obvious. Below, a live preview of
 * which stocks move the most under the current assumption.
 *
 * For power users: a toggle reveals the full ManualPanel (all 14
 * drivers + every scalar/series chart) inline.
 */

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import { ManualPanel } from "../../../manual-panel";
import {
  fetchEquities,
  fetchEquityImpactScores,
  type DriverSchema,
  type Equity,
} from "@/lib/sim-client";

import { useSector } from "../sector-context";

const TOP_N = 5;
const PROJECTION_SCALE = 0.3;
const PROJECTION_THRESHOLD = 1;

export default function SectorSimulatePage() {
  const {
    meta,
    sensitivity,
    defaults,
    driverValues,
    setDriverValues,
  } = useSector();

  // Pick top-N drivers by max absolute swing across scalar outputs.
  const topDrivers = useMemo(
    () => pickTopDrivers(meta.drivers, sensitivity, TOP_N),
    [meta.drivers, sensitivity],
  );

  // Equity + impact-score live preview.
  const [equities, setEquities] = useState<Equity[] | null>(null);
  useEffect(() => {
    let cancelled = false;
    setEquities(null);
    void fetchEquities(meta.slug)
      .then((r) => {
        if (!cancelled) setEquities(r);
      })
      .catch(() => {
        if (!cancelled) setEquities([]);
      });
    return () => {
      cancelled = true;
    };
  }, [meta.slug]);

  const [scores, setScores] = useState<Record<string, number>>({});
  useEffect(() => {
    let cancelled = false;
    void fetchEquityImpactScores(meta.slug, driverValues)
      .then((r) => {
        if (!cancelled) setScores(r.scores);
      })
      .catch(() => {
        if (!cancelled) setScores({});
      });
    return () => {
      cancelled = true;
    };
  }, [meta.slug, driverValues]);

  const [showAdvanced, setShowAdvanced] = useState(false);

  function setDriver(name: string, next: number) {
    setDriverValues((prev) => ({ ...prev, [name]: next }));
  }

  function resetTop() {
    setDriverValues((prev) => {
      const out = { ...prev };
      for (const d of topDrivers) out[d.name] = d.default;
      return out;
    });
  }

  const dirtyCount = topDrivers.filter(
    (d) => Math.abs((driverValues[d.name] ?? d.default) - d.default) > 1e-9,
  ).length;

  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="text-2xl font-semibold text-neutral-50">
          내 가정으로 시뮬레이션
        </h1>
        <p className="mt-1 max-w-3xl text-sm text-neutral-400">
          이 섹터에서 가장 영향력이 큰 {topDrivers.length}개 요인을 직접
          조정해보세요. 슬라이더를 움직이면{" "}
          <span className="text-cyan-300">모든 종목의 30일 예상 변동이
          실시간으로 갱신</span>됩니다.
        </p>
      </header>

      {/* Top sliders */}
      <section className="rounded-lg border border-neutral-800 bg-neutral-900/30 p-5">
        <div className="mb-4 flex items-baseline justify-between gap-3">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-neutral-300">
            가장 영향력이 큰 {topDrivers.length}개 요인
          </h2>
          <div className="flex items-center gap-3 text-[11px]">
            <span className="text-neutral-500">
              {dirtyCount > 0 ? `${dirtyCount}개 조정 중` : "기본값"}
            </span>
            {dirtyCount > 0 && (
              <button
                type="button"
                onClick={resetTop}
                className="text-cyan-400 hover:text-cyan-300"
              >
                ↺ 기본값으로
              </button>
            )}
          </div>
        </div>
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-3">
          {topDrivers.map((d) => (
            <BeginnerSlider
              key={d.name}
              driver={d}
              value={driverValues[d.name] ?? d.default}
              onChange={(v) => setDriver(d.name, v)}
            />
          ))}
        </div>
        {topDrivers.length === 0 && (
          <p className="text-sm text-neutral-500">
            영향력 분석 데이터를 불러오는 중…
          </p>
        )}
      </section>

      {/* Live impact preview */}
      <ImpactPreview
        sectorSlug={meta.slug}
        equities={equities}
        scores={scores}
      />

      {/* Advanced — full Manual panel */}
      <section className="rounded-lg border border-neutral-800 bg-neutral-900/30">
        <button
          type="button"
          onClick={() => setShowAdvanced((v) => !v)}
          className="flex w-full items-center justify-between gap-3 px-5 py-3 text-left transition hover:bg-neutral-900/60"
          aria-expanded={showAdvanced}
        >
          <div>
            <div className="text-sm font-medium text-neutral-200">
              고급 — 전체 드라이버 + 산출물 차트 보기
            </div>
            <div className="text-[11px] text-neutral-500">
              {meta.drivers.length}개 드라이버 모두 조정 · 시계열 차트 · 민감도
              상세
            </div>
          </div>
          <span
            className={`text-[10px] text-neutral-500 ${showAdvanced ? "rotate-180" : ""}`}
          >
            ▾
          </span>
        </button>
        {showAdvanced && (
          <div className="border-t border-neutral-800 px-5 py-4">
            <ManualPanel
              meta={meta}
              sensitivity={sensitivity}
              values={driverValues}
              onChangeValues={setDriverValues}
              defaults={defaults}
            />
          </div>
        )}
      </section>
    </div>
  );
}

/**
 * Rank drivers by their maximum |swing| across all scalar outputs.
 * Falls back to meta.drivers order when sensitivity is unavailable.
 */
function pickTopDrivers(
  drivers: DriverSchema[],
  sensitivity: ReturnType<typeof useSector>["sensitivity"],
  n: number,
): DriverSchema[] {
  if (!sensitivity) return drivers.slice(0, n);
  const maxSwingByDriver = new Map<string, number>();
  for (const entries of Object.values(sensitivity.by_output)) {
    for (const e of entries) {
      const prev = maxSwingByDriver.get(e.driver) ?? 0;
      if (Math.abs(e.swing) > prev) {
        maxSwingByDriver.set(e.driver, Math.abs(e.swing));
      }
    }
  }
  const ranked = [...drivers].sort((a, b) => {
    const sa = maxSwingByDriver.get(a.name) ?? 0;
    const sb = maxSwingByDriver.get(b.name) ?? 0;
    return sb - sa;
  });
  return ranked.slice(0, n);
}

function BeginnerSlider({
  driver,
  value,
  onChange,
}: {
  driver: DriverSchema;
  value: number;
  onChange: (next: number) => void;
}) {
  const step = (driver.max - driver.min) / 200;
  const dirty = Math.abs(value - driver.default) > 1e-9;
  const delta =
    driver.default !== 0
      ? ((value - driver.default) / Math.abs(driver.default)) * 100
      : 0;
  const positive = delta >= 0;
  const tone =
    Math.abs(delta) < 0.5
      ? "text-neutral-400"
      : positive
        ? "text-emerald-400"
        : "text-rose-400";

  return (
    <div className="rounded-lg border border-neutral-800 bg-neutral-950/60 p-4">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-sm font-medium text-neutral-100">
          {humanize(driver.name)}
        </span>
        {dirty && (
          <span className={`text-xs font-semibold tabular-nums ${tone}`}>
            {positive ? "+" : ""}
            {delta.toFixed(1)}%
          </span>
        )}
      </div>
      {driver.description && (
        <p className="mt-1 line-clamp-2 text-[11px] leading-snug text-neutral-500">
          {driver.description}
        </p>
      )}
      <div className="mt-3">
        <input
          type="range"
          min={driver.min}
          max={driver.max}
          step={step}
          value={value}
          onChange={(e) => onChange(Number(e.target.value))}
          className="w-full accent-cyan-400"
        />
        <div className="mt-1 flex items-center justify-between text-[10px] text-neutral-600 tabular-nums">
          <span>
            {formatNumber(driver.min)} {driver.unit}
          </span>
          <span
            className={
              dirty ? "font-semibold text-cyan-300" : "text-neutral-400"
            }
          >
            현재 {formatNumber(value)} {driver.unit}
          </span>
          <span>
            {formatNumber(driver.max)} {driver.unit}
          </span>
        </div>
        <div className="mt-1 text-center text-[10px] text-neutral-600">
          기본값 {formatNumber(driver.default)} {driver.unit}
        </div>
      </div>
    </div>
  );
}

function ImpactPreview({
  sectorSlug,
  equities,
  scores,
}: {
  sectorSlug: string;
  equities: Equity[] | null;
  scores: Record<string, number>;
}) {
  const rows = useMemo(() => {
    if (!equities) return [];
    return equities
      .map((eq) => {
        const score = scores[eq.id] ?? 0;
        const projectedPct =
          Math.abs(score) < PROJECTION_THRESHOLD ? 0 : score * PROJECTION_SCALE;
        const target =
          eq.last_close_local != null
            ? eq.last_close_local * (1 + projectedPct / 100)
            : null;
        return { equity: eq, score, projectedPct, target };
      })
      .filter((r) => Math.abs(r.projectedPct) >= 0.05)
      .sort((a, b) => Math.abs(b.projectedPct) - Math.abs(a.projectedPct))
      .slice(0, 6);
  }, [equities, scores]);

  return (
    <section className="rounded-lg border border-neutral-800 bg-neutral-900/30 p-5">
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-neutral-300">
          현재 가정에서 가장 큰 영향을 받는 종목
        </h2>
        <Link
          href={`/sectors/${sectorSlug}/equities`}
          className="text-[11px] text-cyan-400 hover:text-cyan-300"
        >
          전체 보기 →
        </Link>
      </div>
      {equities === null ? (
        <p className="text-sm text-neutral-500">불러오는 중…</p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-neutral-500">
          기본값에서 슬라이더를 움직여 보세요. 종목 별 변동이 여기에 표시됩니다.
        </p>
      ) : (
        <ul className="grid gap-2 md:grid-cols-2 lg:grid-cols-3">
          {rows.map((r) => {
            const positive = r.projectedPct >= 0;
            const flag = r.equity.iso_country === "KR" ? "🇰🇷" : "🇺🇸";
            return (
              <li key={r.equity.id}>
                <Link
                  href={`/sectors/${sectorSlug}/equities/${encodeURIComponent(r.equity.ticker)}`}
                  className="group block rounded border border-neutral-800 bg-neutral-950/60 p-3 transition hover:border-cyan-700"
                >
                  <div className="flex items-baseline justify-between gap-2">
                    <div className="flex items-center gap-1.5">
                      <span aria-hidden>{flag}</span>
                      <span className="font-mono text-sm font-semibold text-neutral-100 group-hover:text-cyan-300">
                        {r.equity.ticker}
                      </span>
                    </div>
                    <span
                      className={`text-sm font-semibold tabular-nums ${positive ? "text-emerald-400" : "text-rose-400"}`}
                    >
                      {positive ? "+" : ""}
                      {r.projectedPct.toFixed(1)}%
                    </span>
                  </div>
                  <div className="mt-0.5 truncate text-[11px] text-neutral-500">
                    {r.equity.company_name_local ?? r.equity.company_name}
                  </div>
                  {r.target !== null && r.equity.last_close_local != null && (
                    <div className="mt-1 text-[10px] text-neutral-600">
                      {formatPrice(r.equity.last_close_local)} →{" "}
                      <span
                        className={positive ? "text-emerald-400" : "text-rose-400"}
                      >
                        {formatPrice(r.target)}
                      </span>{" "}
                      {r.equity.currency ?? ""}
                    </div>
                  )}
                </Link>
              </li>
            );
          })}
        </ul>
      )}
      <p className="mt-3 text-[10px] text-neutral-600">
        30일 예상 변동은 단순화된 공식 (impact score × 0.3%) 입니다. 실제 시장의
        변동성·뉴스·이슈를 반영하지 않습니다.
      </p>
    </section>
  );
}

function humanize(name: string): string {
  return name
    .replace(/_/g, " ")
    .replace(/\bpct\b/g, "%")
    .replace(/\busd per\b/g, "$/")
    .replace(/\busd\b/g, "$")
    .replace(/\bpb y0\b/g, "PB y0")
    .trim();
}

function formatNumber(n: number): string {
  if (Math.abs(n) >= 1000) return n.toLocaleString("en-US", { maximumFractionDigits: 0 });
  if (Math.abs(n) >= 10) return n.toLocaleString("en-US", { maximumFractionDigits: 1 });
  return n.toLocaleString("en-US", { maximumFractionDigits: 2 });
}

function formatPrice(n: number): string {
  if (Math.abs(n) >= 10_000) return n.toLocaleString("en-US", { maximumFractionDigits: 0 });
  return n.toLocaleString("en-US", { maximumFractionDigits: 2 });
}
