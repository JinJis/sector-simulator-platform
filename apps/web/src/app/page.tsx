/**
 * Home — M23 rewrite.
 *
 * Beginner-first front door. The page is mostly *editorial*: a hero,
 * 3 big sector cards (the only thing a new user has to look at), and
 * a short "오늘의 시장" feed of 2-3 highlight stories. Everything that
 * looked like a Bloomberg terminal in M16 (movers table, scenarios
 * carousel, audit feed, full-text search) is collapsed behind a
 * "더 보기" expander so it stays available without overwhelming the
 * landing experience.
 *
 * Server-rendered: fans out per Promise.all (sims / equities /
 * basketStats / scenarios / audit) so the page paints in one round
 * trip. Legacy `/?sector=…[&scenario=…]` redirects preserved.
 */

import { Sparkline } from "@platform/ui";
import { redirect } from "next/navigation";
import Link from "next/link";

import {
  fetchBasketStats,
  fetchEquities,
  fetchRecentAuditLogs,
  fetchScenarios,
  fetchSims,
  SECTOR_SERVICE_URL,
  type AuditLog,
  type BasketStats,
  type BasketStatsEquity,
  type Equity,
  type Scenario,
  type SimMetadata,
} from "@/lib/sim-client";

import { HomeSearch, type SearchItem } from "./home/home-search";
import { MoreExpander } from "./home/more-expander";
import { SECTOR_THESES } from "./sectors/[slug]/narrative/thesis-content";

interface SearchParams {
  sector?: string;
  scenario?: string;
}

interface SectorSnapshot {
  meta: SimMetadata;
  equities: Equity[];
  basket: BasketStats | null;
  scenarios: Scenario[];
}

interface MoverRow {
  equity: Equity;
  sectorName: string;
  sectorSlug: string;
  stats: BasketStatsEquity;
}

const SECTOR_EMOJI: Record<string, string> = {
  "memory-semi": "💾",
  "space-data-center": "🛰️",
  "sofc": "⚡",
};

export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const { sector, scenario } = await searchParams;
  if (sector) {
    const q = scenario ? `?scenario=${encodeURIComponent(scenario)}` : "";
    redirect(`/sectors/${encodeURIComponent(sector)}${q}`);
  }

  let sims: SimMetadata[];
  try {
    sims = await fetchSims();
  } catch (err) {
    return (
      <ErrorShell
        title={`sector-service에 연결할 수 없습니다 (${SECTOR_SERVICE_URL})`}
        detail={err instanceof Error ? err.message : String(err)}
      />
    );
  }

  const userFacingSims = sims.filter((s) => s.slug !== "placeholder");
  const [scenarios, audit, ...sectorBundles] = await Promise.all([
    fetchScenarios().catch(() => [] as Scenario[]),
    fetchRecentAuditLogs({ limit: 20 }).catch(() => [] as AuditLog[]),
    ...userFacingSims.map((sim) => buildSectorSnapshot(sim)),
  ]);
  const snapshots = sectorBundles as SectorSnapshot[];

  const searchItems = buildSearchIndex(snapshots);
  const movers = collectMovers(snapshots, 8);
  const highlightMovers = movers.slice(0, 3);
  const recentScenarios = scenarios.slice(0, 5);

  return (
    <main className="mx-auto min-h-screen max-w-7xl px-6 pb-16 pt-8">
      {/* 1) Hero */}
      <section className="mb-10">
        <h1 className="text-3xl font-semibold tracking-tight text-neutral-50 sm:text-4xl">
          산업의 성장이 어떤 주식으로 이어지는지, 한눈에.
        </h1>
        <p className="mt-3 max-w-2xl text-sm leading-relaxed text-neutral-400">
          섹터의 성장 가설을 직접 가정해보고, 그 가정에서 어떤 종목이 가장 큰
          영향을 받는지를 실시간으로 확인하세요. 모든 숫자에는 근거 데이터가
          연결되어 있습니다.
        </p>
      </section>

      {/* 2) Sector cards (main entry point) */}
      <section className="mb-10">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-neutral-300">
          어떤 산업이 궁금하신가요?
        </h2>
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {snapshots.map((s) => (
            <SectorEntryCard key={s.meta.slug} snapshot={s} />
          ))}
          {snapshots.length === 0 && (
            <p className="text-sm text-neutral-500">등록된 섹터가 없습니다.</p>
          )}
        </div>
      </section>

      {/* 3) 오늘의 시장 highlights */}
      {highlightMovers.length > 0 && (
        <section className="mb-10">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-neutral-300">
            최근 90일, 가장 크게 움직인 종목
          </h2>
          <div className="grid gap-3 md:grid-cols-3">
            {highlightMovers.map((m) => (
              <MoverHighlight key={m.equity.id} mover={m} />
            ))}
          </div>
        </section>
      )}

      {/* 4) 더 보기 — search + full movers table + scenarios + audit */}
      <MoreExpander
        searchItems={searchItems}
        movers={movers}
        recentScenarios={recentScenarios}
        sims={userFacingSims}
        audit={audit}
      />
    </main>
  );
}

// =========================
// Data shaping helpers
// =========================

async function buildSectorSnapshot(sim: SimMetadata): Promise<SectorSnapshot> {
  const [equities, basket, scenarios] = await Promise.all([
    fetchEquities(sim.slug).catch(() => [] as Equity[]),
    fetchBasketStats(sim.slug, 90).catch(() => null),
    fetchScenarios(sim.slug).catch(() => [] as Scenario[]),
  ]);
  return { meta: sim, equities, basket, scenarios };
}

function buildSearchIndex(snapshots: SectorSnapshot[]): SearchItem[] {
  const items: SearchItem[] = [];
  for (const s of snapshots) {
    items.push({
      kind: "sector",
      label: s.meta.name,
      hint: `${s.meta.slug} · ${s.meta.drivers.length} drivers · ${s.equities.length} equities`,
      href: `/sectors/${s.meta.slug}`,
    });
    for (const eq of s.equities) {
      const localName = eq.company_name_local
        ? ` · ${eq.company_name_local}`
        : "";
      items.push({
        kind: "equity",
        label: `${eq.ticker} · ${eq.company_name}${localName}`,
        hint: `${s.meta.name} · ${eq.exchange} · ${eq.iso_country}`,
        href: `/sectors/${s.meta.slug}/equities/${encodeURIComponent(eq.ticker)}`,
      });
    }
    for (const d of s.meta.drivers) {
      items.push({
        kind: "driver",
        label: d.name,
        hint: `${s.meta.name} · ${d.group} · default ${d.default}`,
        href: `/sectors/${s.meta.slug}/simulate`,
      });
    }
  }
  return items;
}

function collectMovers(snapshots: SectorSnapshot[], n: number): MoverRow[] {
  const rows: MoverRow[] = [];
  for (const s of snapshots) {
    if (!s.basket) continue;
    const byId = new Map(s.equities.map((eq) => [eq.id, eq]));
    for (const stat of s.basket.equities) {
      const eq = byId.get(stat.equity_id);
      if (!eq) continue;
      if (stat.return_pct === null || stat.return_pct === undefined) continue;
      rows.push({
        equity: eq,
        sectorName: s.meta.name,
        sectorSlug: s.meta.slug,
        stats: stat,
      });
    }
  }
  rows.sort(
    (a, b) => Math.abs(b.stats.return_pct!) - Math.abs(a.stats.return_pct!),
  );
  return rows.slice(0, n);
}

// =========================
// Presentational components
// =========================

function SectorEntryCard({ snapshot }: { snapshot: SectorSnapshot }) {
  const { meta, equities, basket } = snapshot;
  const thesis = SECTOR_THESES[meta.slug];
  const emoji = SECTOR_EMOJI[meta.slug] ?? "📊";
  const basketSeries =
    basket?.basket.map((b) => b.basket_index).filter((v): v is number => v != null) ??
    [];
  const basket90 =
    basketSeries.length >= 2
      ? ((basketSeries[basketSeries.length - 1]! - basketSeries[0]!) /
          basketSeries[0]!) *
        100
      : null;
  const positive = basket90 !== null && basket90 >= 0;

  return (
    <Link
      href={`/sectors/${meta.slug}`}
      className="group flex flex-col gap-3 rounded-xl border border-neutral-800 bg-neutral-900/40 p-5 transition hover:border-cyan-700 hover:bg-neutral-900"
    >
      <div className="flex items-baseline gap-3">
        <span className="text-3xl">{emoji}</span>
        <div className="min-w-0 flex-1">
          <h3 className="text-base font-semibold text-neutral-50 group-hover:text-cyan-300">
            {meta.name}
          </h3>
          {thesis && (
            <p className="mt-0.5 text-[11px] text-cyan-400">{thesis.horizon}</p>
          )}
        </div>
      </div>

      <p className="line-clamp-3 text-xs leading-relaxed text-neutral-400">
        {thesis?.summary ?? meta.description}
      </p>

      {basketSeries.length > 0 && (
        <Sparkline
          values={basketSeries}
          width={260}
          height={32}
          filled
          ariaLabel={`${meta.name} basket 90d`}
        />
      )}

      <div className="mt-auto grid grid-cols-3 gap-2 border-t border-neutral-800 pt-3 text-[11px]">
        <Stat
          label="90일"
          value={
            basket90 === null
              ? "—"
              : `${basket90 >= 0 ? "+" : ""}${basket90.toFixed(1)}%`
          }
          tone={basket90 === null ? "muted" : positive ? "up" : "down"}
        />
        <Stat label="종목" value={`${equities.length}개`} />
        <Stat label="조정 가능" value={`${meta.drivers.length}`} />
      </div>

      <span className="text-[11px] text-cyan-400 group-hover:text-cyan-300">
        둘러보기 →
      </span>
    </Link>
  );
}

function Stat({
  label,
  value,
  tone = "muted",
}: {
  label: string;
  value: string;
  tone?: "up" | "down" | "muted";
}) {
  const cls =
    tone === "up"
      ? "text-emerald-400"
      : tone === "down"
        ? "text-rose-400"
        : "text-neutral-200";
  return (
    <div>
      <div className="text-[9px] uppercase tracking-wider text-neutral-600">
        {label}
      </div>
      <div className={`mt-0.5 text-sm font-semibold tabular-nums ${cls}`}>
        {value}
      </div>
    </div>
  );
}

function MoverHighlight({ mover }: { mover: MoverRow }) {
  const ret = mover.stats.return_pct!;
  const positive = ret >= 0;
  const flag = mover.equity.iso_country === "KR" ? "🇰🇷" : "🇺🇸";
  return (
    <Link
      href={`/sectors/${mover.sectorSlug}/equities/${encodeURIComponent(mover.equity.ticker)}`}
      className="group block rounded-lg border border-neutral-800 bg-neutral-900/40 p-4 transition hover:border-cyan-700 hover:bg-neutral-900"
    >
      <div className="flex items-baseline justify-between gap-2">
        <div className="flex items-center gap-2">
          <span aria-hidden>{flag}</span>
          <span className="font-mono text-base font-semibold text-neutral-100 group-hover:text-cyan-300">
            {mover.equity.ticker}
          </span>
        </div>
        <span
          className={`text-base font-semibold tabular-nums ${
            positive ? "text-emerald-400" : "text-rose-400"
          }`}
        >
          {positive ? "+" : ""}
          {ret.toFixed(1)}%
        </span>
      </div>
      <p className="mt-1 truncate text-xs text-neutral-400">
        {mover.equity.company_name_local ?? mover.equity.company_name}
      </p>
      <p className="mt-2 text-[11px] text-neutral-500">{mover.sectorName}</p>
    </Link>
  );
}

function ErrorShell({ title, detail }: { title: string; detail: string }) {
  return (
    <main className="mx-auto max-w-6xl px-6 py-10">
      <h1 className="text-2xl font-semibold">Sector Simulator</h1>
      <p className="mt-4 text-sm text-red-400">{title}</p>
      <p className="mt-2 text-xs text-neutral-500">{detail}</p>
      <pre className="mt-4 rounded bg-neutral-900 p-3 text-xs text-neutral-300">
        pnpm dev # sector-service + simulation-service + data-pipeline 동시 기동
      </pre>
    </main>
  );
}
