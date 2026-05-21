"use client";

/**
 * Sector Overview — M23 rewrite.
 *
 * The investor's first stop. Plain-Korean thesis at the top, then
 * Growth drivers (3) + 발목 잡는 요인 (3) as visual cards with
 * current-vs-default gauges. Quick stats. Two simple CTAs at the
 * bottom: 종목 보기 / 시뮬레이션 시작.
 */

import { Sparkline } from "@platform/ui";
import Link from "next/link";
import { useEffect, useState } from "react";

import {
  fetchBasketStats,
  fetchEquities,
  type BasketStats,
  type Equity,
} from "@/lib/sim-client";

import {
  FALLBACK_THESIS_SUMMARY,
  SECTOR_THESES,
  type SectorThesis,
  type ThesisBullet,
} from "./narrative/thesis-content";
import { useSector } from "./sector-context";

export default function SectorOverviewPage() {
  const { meta, defaults, driverValues } = useSector();
  const thesis: SectorThesis | undefined = SECTOR_THESES[meta.slug];
  const base = `/sectors/${meta.slug}`;

  // Lazy fetches for the bottom-of-page quick stats. Don't block the
  // thesis section above — the page should feel fast.
  const [equities, setEquities] = useState<Equity[] | null>(null);
  const [basket, setBasket] = useState<BasketStats | null>(null);
  useEffect(() => {
    let cancelled = false;
    setEquities(null);
    setBasket(null);
    void fetchEquities(meta.slug)
      .then((r) => {
        if (!cancelled) setEquities(r);
      })
      .catch(() => {
        if (!cancelled) setEquities([]);
      });
    void fetchBasketStats(meta.slug, 90)
      .then((r) => {
        if (!cancelled) setBasket(r);
      })
      .catch(() => {
        if (!cancelled) setBasket(null);
      });
    return () => {
      cancelled = true;
    };
  }, [meta.slug]);

  const basketSeries =
    basket?.basket.map((b) => b.basket_index).filter((v): v is number => v != null) ??
    [];
  const basket90 =
    basketSeries.length >= 2
      ? ((basketSeries[basketSeries.length - 1]! - basketSeries[0]!) /
          basketSeries[0]!) *
        100
      : null;
  const positive90 = basket90 !== null && basket90 >= 0;

  return (
    <div className="flex flex-col gap-8">
      {/* 1) Thesis */}
      <section className="rounded-lg border border-cyan-900/40 bg-gradient-to-br from-cyan-950/30 via-neutral-950 to-neutral-950 p-6">
        <div className="mb-2 flex items-baseline gap-3">
          <span className="rounded-full border border-cyan-900/60 bg-cyan-950/60 px-2 py-0.5 text-[10px] uppercase tracking-wider text-cyan-300">
            성장 가설
          </span>
          {thesis && (
            <span className="text-[11px] text-cyan-400">{thesis.horizon}</span>
          )}
        </div>
        <p className="text-base leading-relaxed text-neutral-100">
          {thesis?.summary ?? FALLBACK_THESIS_SUMMARY}
        </p>
        <div className="mt-4 flex flex-wrap gap-3">
          <Link
            href={`${base}/equities`}
            className="rounded border border-cyan-700 bg-cyan-900/40 px-3 py-1.5 text-xs font-medium text-cyan-100 hover:bg-cyan-800/60"
          >
            어떤 종목이 수혜를 받나요? →
          </Link>
          <Link
            href={`${base}/simulate`}
            className="rounded border border-neutral-700 bg-neutral-900 px-3 py-1.5 text-xs text-neutral-200 hover:border-cyan-700 hover:text-cyan-200"
          >
            내 가정으로 시뮬레이션
          </Link>
        </div>
      </section>

      {/* 2) Drivers + Blockers */}
      {thesis && (
        <section className="grid gap-4 md:grid-cols-2">
          <BulletColumn
            title="성장을 끌어올리는 힘"
            tone="up"
            bullets={thesis.drivers}
            defaults={defaults}
            driverValues={driverValues}
            simulateHref={`${base}/simulate`}
          />
          <BulletColumn
            title="발목을 잡을 수 있는 요인"
            tone="down"
            bullets={thesis.blockers}
            defaults={defaults}
            driverValues={driverValues}
            simulateHref={`${base}/simulate`}
          />
        </section>
      )}

      {/* 3) Quick stats — at-a-glance numbers */}
      <section>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-neutral-300">
          한눈에 보기
        </h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard
            label="이 섹터의 종목 수"
            value={equities === null ? "…" : `${equities.length}개`}
            sub={
              equities && equities.length > 0
                ? `🇺🇸 ${equities.filter((e) => e.iso_country === "US").length} · 🇰🇷 ${equities.filter((e) => e.iso_country === "KR").length}`
                : undefined
            }
            href={`${base}/equities`}
            ctaLabel="목록 →"
          />
          <StatCard
            label="섹터 90일 평균 변동"
            value={
              basket90 === null
                ? "…"
                : `${basket90 >= 0 ? "+" : ""}${basket90.toFixed(1)}%`
            }
            sub={
              basketSeries.length > 0
                ? `${basketSeries.length} 거래일 평균`
                : "데이터 적재 대기"
            }
            tone={basket90 === null ? "muted" : positive90 ? "up" : "down"}
            sparkline={basketSeries.length > 0 ? basketSeries : undefined}
          />
          <StatCard
            label="조정 가능한 드라이버"
            value={`${meta.drivers.length}개`}
            sub="시뮬레이션에서 직접 조정 가능"
            href={`${base}/simulate`}
            ctaLabel="시뮬레이션 →"
          />
          <StatCard
            label="시뮬레이션 기간"
            value={`${meta.horizon_years}년`}
            sub="모든 출력의 시계열 길이"
          />
        </div>
      </section>

      {/* 4) Community pointer */}
      <section className="rounded-lg border border-violet-900/40 bg-violet-950/20 p-4 text-[11px] text-violet-200">
        <p>
          이 섹터에 빠진 요인이나 종목이 보이시나요?{" "}
          <Link
            href={`/community/suggestions?sector=${meta.slug}`}
            className="font-medium text-violet-300 underline-offset-4 hover:text-violet-100 hover:underline"
          >
            커뮤니티에서 추가/제거를 제안해 보세요 →
          </Link>{" "}
          인기 제안은 편집팀이 검토 후 실제 모델에 반영합니다.
        </p>
      </section>

      {/* 5) Footer hint */}
      <section className="rounded-lg border border-neutral-800 bg-neutral-900/30 p-4 text-[11px] text-neutral-500">
        <p>
          더 깊이 파보고 싶으신가요? 상단 메뉴의{" "}
          <span className="text-neutral-300">고급 도구</span> 에서 전체 드라이버 슬라이더,
          인과 그래프, 데이터 출처, 실시간 데이터, 시나리오 비교를 모두 다룰 수 있습니다.
        </p>
      </section>
    </div>
  );
}

function BulletColumn({
  title,
  tone,
  bullets,
  defaults,
  driverValues,
  simulateHref,
}: {
  title: string;
  tone: "up" | "down";
  bullets: ThesisBullet[];
  defaults: Record<string, number>;
  driverValues: Record<string, number>;
  simulateHref: string;
}) {
  const headerTone =
    tone === "up"
      ? "border-emerald-900/40 bg-emerald-950/20 text-emerald-300"
      : "border-rose-900/40 bg-rose-950/20 text-rose-300";
  const icon = tone === "up" ? "▲" : "▼";
  return (
    <div className="rounded-lg border border-neutral-800 bg-neutral-900/40 p-5">
      <div
        className={`mb-3 inline-flex items-center gap-1.5 rounded border px-2 py-0.5 text-[11px] font-semibold ${headerTone}`}
      >
        <span aria-hidden>{icon}</span>
        {title}
      </div>
      <ul className="flex flex-col gap-4">
        {bullets.map((b, i) => (
          <li key={i} className="border-l-2 border-neutral-800 pl-3">
            <div className="text-sm font-medium text-neutral-100">{b.title}</div>
            <div className="mt-0.5 text-xs leading-relaxed text-neutral-400">
              {b.detail}
            </div>
            {b.driverRefs && b.driverRefs.length > 0 && (
              <div className="mt-2 flex flex-col gap-1.5">
                {b.driverRefs.map((d) => {
                  const def = defaults[d];
                  const cur = driverValues[d];
                  if (def === undefined || cur === undefined) return null;
                  return (
                    <DriverGauge
                      key={d}
                      name={d}
                      def={def}
                      current={cur}
                      simulateHref={simulateHref}
                    />
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

function DriverGauge({
  name,
  def,
  current,
  simulateHref,
}: {
  name: string;
  def: number;
  current: number;
  simulateHref: string;
}) {
  const delta = def !== 0 ? ((current - def) / Math.abs(def)) * 100 : 0;
  const positive = delta >= 0;
  const filledColor =
    Math.abs(delta) < 0.05
      ? "bg-neutral-600"
      : positive
        ? "bg-emerald-500/80"
        : "bg-rose-500/80";

  // Visualize the deviation from default — a center line and a bar
  // growing either direction. The width is capped at 50% so the bar
  // can't overflow.
  const widthPct = Math.min(50, Math.abs(delta));

  return (
    <Link
      href={simulateHref}
      className="group block rounded border border-neutral-800/80 bg-neutral-950/50 px-2 py-1.5 transition hover:border-neutral-700"
      title={`현재: ${current} · 기본값: ${def} · 시뮬레이션에서 조정`}
    >
      <div className="flex items-baseline justify-between gap-2">
        <span className="truncate font-mono text-[10px] text-neutral-400 group-hover:text-cyan-300">
          {humanize(name)}
        </span>
        <span
          className={
            Math.abs(delta) < 0.05
              ? "text-[10px] text-neutral-500"
              : positive
                ? "text-[10px] font-semibold text-emerald-400"
                : "text-[10px] font-semibold text-rose-400"
          }
        >
          {positive ? "+" : ""}
          {delta.toFixed(1)}%
        </span>
      </div>
      {/* Center-out gauge bar */}
      <div className="relative mt-1 h-1.5 w-full overflow-hidden rounded bg-neutral-900">
        <div className="absolute left-1/2 top-0 h-1.5 w-px bg-neutral-700" />
        <div
          className={`absolute top-0 h-1.5 ${filledColor} ${
            positive ? "left-1/2" : "right-1/2"
          }`}
          style={{ width: `${widthPct}%` }}
        />
      </div>
    </Link>
  );
}

function StatCard({
  label,
  value,
  sub,
  tone = "muted",
  sparkline,
  href,
  ctaLabel,
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: "up" | "down" | "muted";
  sparkline?: number[];
  href?: string;
  ctaLabel?: string;
}) {
  const valueClass =
    tone === "up"
      ? "text-emerald-400"
      : tone === "down"
        ? "text-rose-400"
        : "text-neutral-100";

  const body = (
    <>
      <div className="text-[10px] uppercase tracking-wider text-neutral-500">
        {label}
      </div>
      <div className={`mt-1 text-xl font-semibold tabular-nums ${valueClass}`}>
        {value}
      </div>
      {sub && <div className="mt-0.5 text-[11px] text-neutral-500">{sub}</div>}
      {sparkline && sparkline.length > 0 && (
        <div className="mt-2">
          <Sparkline
            values={sparkline}
            width={200}
            height={26}
            filled
            ariaLabel={label}
          />
        </div>
      )}
      {href && ctaLabel && (
        <div className="mt-2 text-[11px] text-cyan-400 group-hover:text-cyan-300">
          {ctaLabel}
        </div>
      )}
    </>
  );

  if (href) {
    return (
      <Link
        href={href}
        className="group rounded-lg border border-neutral-800 bg-neutral-900/40 p-4 transition hover:border-cyan-700"
      >
        {body}
      </Link>
    );
  }
  return (
    <div className="rounded-lg border border-neutral-800 bg-neutral-900/40 p-4">
      {body}
    </div>
  );
}

/** Make a snake_case driver name readable. Strips technical suffixes
 *  that don't help an investor (`_pct`, `_usd_per_kg`, `_y0`, ...).  */
function humanize(name: string): string {
  return name
    .replace(/_/g, " ")
    .replace(/\bpct\b/g, "%")
    .replace(/\busd per\b/g, "$/")
    .replace(/\busd\b/g, "$")
    .replace(/\bpb y0\b/g, "PB y0")
    .trim();
}
