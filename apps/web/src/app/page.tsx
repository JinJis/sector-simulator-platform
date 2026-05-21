/**
 * Home page — investor dashboard.
 *
 * Server-rendered entry door. Pulls everything in parallel from
 * sector-service:
 *   - sims list (3 sectors today)
 *   - equities per sector (49 today, fanned out)
 *   - basket stats per sector (90d return / β / volatility)
 *   - scenarios across all sectors (last 5)
 *   - audit_logs (last 20 mutations)
 *
 * Legacy `/` redirects (`?sector=...`) are preserved at the top — old
 * bookmarks and share links keep jumping straight to a sector hub.
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
import { PageIntent } from "./page-intent";
import { STANDALONE_PAGE_INTENTS } from "./page-intents";

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
  stats: BasketStatsEquity;
}

export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const { sector, scenario } = await searchParams;

  // Legacy URL handler — keep old bookmarks working.
  if (sector) {
    const q = scenario ? `?scenario=${encodeURIComponent(scenario)}` : "";
    redirect(`/sectors/${encodeURIComponent(sector)}${q}`);
  }

  // -------- Fetch core data in parallel --------
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

  // -------- Build search index --------
  const searchItems = buildSearchIndex(snapshots);

  // -------- Biggest movers (90d, absolute return) --------
  const movers = collectMovers(snapshots, 6);

  // -------- Recent scenarios (top 5 by updated_at) --------
  const recentScenarios = scenarios.slice(0, 5);

  return (
    <main className="mx-auto min-h-screen max-w-7xl px-6 pb-16 pt-6">
      <header className="mb-4">
        <h1 className="text-2xl font-semibold tracking-tight text-neutral-50">
          Sector Simulator
        </h1>
        <p className="mt-1 text-xs text-neutral-500">
          산업을 시뮬레이션 가능한 인과 그래프로 변환하고, 실시간 데이터로 미래를 검증합니다.
        </p>
      </header>

      <PageIntent intent={STANDALONE_PAGE_INTENTS.home!} />

      <section className="mb-6">
        <HomeSearch items={searchItems} />
      </section>

      <section className="mb-8">
        <SectionHeader title="Trending sectors" hint="등록된 섹터의 90일 basket 추이" />
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {snapshots.map((s) => (
            <SectorCard key={s.meta.slug} snapshot={s} />
          ))}
          {snapshots.length === 0 && (
            <p className="text-sm text-neutral-500">등록된 섹터가 없습니다.</p>
          )}
        </div>
      </section>

      <section className="mb-8 grid gap-6 lg:grid-cols-5">
        <div className="lg:col-span-3">
          <SectionHeader
            title="Biggest movers (90d)"
            hint="섹터 전체에서 절대 수익률 상위"
          />
          <MoversTable movers={movers} />
        </div>
        <div className="lg:col-span-2">
          <SectionHeader title="Recent scenarios" hint="최근 저장된 가설" />
          <RecentScenarios scenarios={recentScenarios} sims={userFacingSims} />
        </div>
      </section>

      <section className="mb-4">
        <SectionHeader
          title="What's changed"
          hint="그래프 / 시나리오 변경 audit 피드"
        />
        <AuditFeed entries={audit} />
      </section>
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
        href: `/sectors/${s.meta.slug}/manual`,
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
      rows.push({ equity: eq, sectorName: s.meta.name, stats: stat });
    }
  }
  rows.sort((a, b) => Math.abs(b.stats.return_pct!) - Math.abs(a.stats.return_pct!));
  return rows.slice(0, n);
}

// =========================
// Presentational components
// =========================

function SectionHeader({ title, hint }: { title: string; hint: string }) {
  return (
    <div className="mb-3 flex items-baseline gap-3">
      <h2 className="text-sm font-semibold uppercase tracking-wider text-neutral-300">
        {title}
      </h2>
      <span className="text-[11px] text-neutral-600">{hint}</span>
    </div>
  );
}

function SectorCard({ snapshot }: { snapshot: SectorSnapshot }) {
  const { meta, equities, basket, scenarios } = snapshot;
  const basketSeries =
    basket?.basket.map((b) => b.basket_index).filter((v): v is number => v !== null && v !== undefined) ?? [];
  const basketReturn =
    basketSeries.length >= 2
      ? ((basketSeries[basketSeries.length - 1]! - basketSeries[0]!) / basketSeries[0]!) * 100
      : null;
  const positive = basketReturn !== null && basketReturn >= 0;

  return (
    <Link
      href={`/sectors/${meta.slug}`}
      className="group flex flex-col rounded-lg border border-neutral-800 bg-neutral-900/40 p-5 transition hover:border-cyan-700 hover:bg-neutral-900"
    >
      <div className="mb-2 flex items-baseline justify-between gap-2">
        <h3 className="text-base font-semibold text-neutral-100 group-hover:text-cyan-300">
          {meta.name}
        </h3>
        <span className="text-[10px] uppercase tracking-wider text-neutral-600">
          {meta.horizon_years} yr
        </span>
      </div>
      <p className="mb-3 line-clamp-2 text-xs leading-relaxed text-neutral-500">
        {meta.description}
      </p>
      {basketSeries.length > 0 ? (
        <div className="mb-3">
          <Sparkline
            values={basketSeries}
            width={240}
            height={36}
            filled
            showLastDot
            ariaLabel={`${meta.name} basket 90d`}
          />
        </div>
      ) : (
        <div className="mb-3 h-9 rounded border border-dashed border-neutral-800" />
      )}
      <div className="mt-auto grid grid-cols-3 gap-2 text-[11px] text-neutral-400">
        <Metric
          label="90d"
          value={
            basketReturn !== null
              ? `${basketReturn >= 0 ? "+" : ""}${basketReturn.toFixed(1)}%`
              : "—"
          }
          tone={positive ? "up" : basketReturn === null ? "muted" : "down"}
        />
        <Metric label="종목" value={String(equities.length)} />
        <Metric label="시나리오" value={String(scenarios.length)} />
      </div>
    </Link>
  );
}

function Metric({
  label,
  value,
  tone = "muted",
}: {
  label: string;
  value: string;
  tone?: "up" | "down" | "muted";
}) {
  const color =
    tone === "up"
      ? "text-emerald-400"
      : tone === "down"
        ? "text-rose-400"
        : "text-neutral-200";
  return (
    <div className="rounded border border-neutral-800 bg-neutral-950/40 px-2 py-1.5">
      <div className="text-[9px] uppercase tracking-wider text-neutral-600">
        {label}
      </div>
      <div className={`mt-0.5 text-xs font-semibold ${color}`}>{value}</div>
    </div>
  );
}

function MoversTable({ movers }: { movers: MoverRow[] }) {
  if (movers.length === 0) {
    return (
      <div className="rounded border border-dashed border-neutral-800 p-4 text-xs text-neutral-500">
        가격 히스토리가 아직 적재되지 않았습니다. data-pipeline의{" "}
        <code className="rounded bg-neutral-950 px-1 py-0.5">
          refresh-quote-history
        </code>{" "}
        job을 실행해주세요.
      </div>
    );
  }
  return (
    <div className="overflow-hidden rounded-lg border border-neutral-800 bg-neutral-900/40">
      <table className="w-full text-sm">
        <thead className="bg-neutral-900/60 text-[10px] uppercase tracking-wider text-neutral-500">
          <tr>
            <th className="px-3 py-2 text-left font-medium">Ticker</th>
            <th className="px-3 py-2 text-left font-medium">Sector</th>
            <th className="px-3 py-2 text-right font-medium">90d</th>
            <th className="px-3 py-2 text-right font-medium">β</th>
            <th className="px-3 py-2 text-right font-medium">σ ann.</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-neutral-800">
          {movers.map((m) => {
            const ret = m.stats.return_pct!;
            const positive = ret >= 0;
            const flag = m.equity.iso_country === "KR" ? "🇰🇷" : "🇺🇸";
            return (
              <tr
                key={m.equity.id}
                className="transition hover:bg-neutral-900"
              >
                <td className="px-3 py-2">
                  <Link
                    href={`/sectors/${m.equity.sector_slug}/equities/${encodeURIComponent(m.equity.ticker)}`}
                    className="flex items-center gap-2 text-neutral-100 hover:text-cyan-300"
                  >
                    <span aria-hidden>{flag}</span>
                    <span className="font-medium">{m.equity.ticker}</span>
                    <span className="text-[11px] text-neutral-500">
                      {m.equity.company_name_local ?? m.equity.company_name}
                    </span>
                  </Link>
                </td>
                <td className="px-3 py-2 text-[11px] text-neutral-500">
                  {m.sectorName}
                </td>
                <td
                  className={`px-3 py-2 text-right font-mono text-xs ${positive ? "text-emerald-400" : "text-rose-400"}`}
                >
                  {positive ? "+" : ""}
                  {ret.toFixed(1)}%
                </td>
                <td className="px-3 py-2 text-right font-mono text-xs text-neutral-300">
                  {m.stats.beta !== null ? m.stats.beta.toFixed(2) : "—"}
                </td>
                <td className="px-3 py-2 text-right font-mono text-xs text-neutral-300">
                  {m.stats.volatility_annual_pct !== null
                    ? `${m.stats.volatility_annual_pct.toFixed(0)}%`
                    : "—"}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function RecentScenarios({
  scenarios,
  sims,
}: {
  scenarios: Scenario[];
  sims: SimMetadata[];
}) {
  if (scenarios.length === 0) {
    return (
      <div className="rounded border border-dashed border-neutral-800 p-4 text-xs text-neutral-500">
        저장된 시나리오가 아직 없습니다. 섹터의 Manual 탭에서 슬라이더를 조정해 저장해보세요.
      </div>
    );
  }
  const simBySlug = new Map(sims.map((s) => [s.slug, s]));
  return (
    <ul className="flex flex-col gap-2">
      {scenarios.map((sc) => {
        const sim = simBySlug.get(sc.sector_slug);
        const driverCount = Object.keys(sc.driver_overrides).length;
        return (
          <li key={sc.id}>
            <Link
              href={`/sectors/${sc.sector_slug}?scenario=${sc.id}`}
              className="group block rounded-lg border border-neutral-800 bg-neutral-900/40 p-3 transition hover:border-cyan-700 hover:bg-neutral-900"
            >
              <div className="flex items-baseline justify-between gap-2">
                <span className="truncate text-sm font-medium text-neutral-100 group-hover:text-cyan-300">
                  {sc.name}
                </span>
                <span className="shrink-0 text-[10px] uppercase tracking-wider text-neutral-600">
                  {driverCount}× drivers
                </span>
              </div>
              <div className="mt-1 flex items-center gap-2 text-[11px] text-neutral-500">
                <span>{sim?.name ?? sc.sector_slug}</span>
                <span>·</span>
                <span>{formatRelative(sc.updated_at)}</span>
                {sc.author_label && (
                  <>
                    <span>·</span>
                    <span className="truncate">{sc.author_label}</span>
                  </>
                )}
              </div>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

function AuditFeed({ entries }: { entries: AuditLog[] }) {
  if (entries.length === 0) {
    return (
      <div className="rounded border border-dashed border-neutral-800 p-4 text-xs text-neutral-500">
        아직 기록된 변경이 없습니다. 그래프 편집이나 시나리오 저장이 이루어지면 여기에 나타납니다.
      </div>
    );
  }
  return (
    <ol className="overflow-hidden rounded-lg border border-neutral-800 bg-neutral-900/40 divide-y divide-neutral-800">
      {entries.map((e) => {
        const summary = describeAudit(e);
        const tone = toneForAction(e.action);
        return (
          <li key={e.id} className="flex items-baseline gap-3 px-3 py-2">
            <span
              className={`shrink-0 rounded border px-1.5 py-0.5 text-[10px] font-medium ${tone}`}
            >
              {shortAction(e.action)}
            </span>
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm text-neutral-200">{summary}</div>
              <div className="mt-0.5 flex items-center gap-2 text-[11px] text-neutral-600">
                {e.sector_slug && (
                  <Link
                    href={`/sectors/${e.sector_slug}`}
                    className="hover:text-cyan-400"
                  >
                    {e.sector_slug}
                  </Link>
                )}
                <span>·</span>
                <span>{formatRelative(e.created_at)}</span>
                {e.author_label && (
                  <>
                    <span>·</span>
                    <span className="truncate">{e.author_label}</span>
                  </>
                )}
              </div>
            </div>
          </li>
        );
      })}
    </ol>
  );
}

// =========================
// Tiny formatting helpers
// =========================

function shortAction(action: string): string {
  const idx = action.indexOf(".");
  return idx === -1 ? action : action.slice(idx + 1);
}

function toneForAction(action: string): string {
  if (action.startsWith("graph.")) return "border-cyan-900/60 bg-cyan-950/40 text-cyan-300";
  if (action.startsWith("scenario.")) return "border-amber-900/60 bg-amber-950/40 text-amber-300";
  if (action.startsWith("lifecycle.")) return "border-rose-900/60 bg-rose-950/40 text-rose-300";
  return "border-neutral-800 bg-neutral-950 text-neutral-400";
}

function describeAudit(e: AuditLog): string {
  const p = (e.payload ?? {}) as Record<string, unknown>;
  switch (e.action) {
    case "graph.upsertEdge":
      return `edge ${asString(p.source_key)} → ${asString(p.target_key)}${
        p.weight !== undefined ? ` · w=${asString(p.weight)}` : ""
      }`;
    case "graph.deleteEdge":
      return `delete edge ${asString(p.source_key)} → ${asString(p.target_key)}`;
    case "graph.upsertNode":
      return `node ${asString(p.node_key)}${p.label ? ` · ${asString(p.label)}` : ""}`;
    case "graph.deleteNode":
      return `delete node ${asString(p.node_key)}`;
    case "graph.resetToDefaults":
      return `${asString(p.sector_slug)} 그래프 재구성`;
    case "graph.wipe":
      return `${asString(p.sector_slug)} 그래프 wipe`;
    case "scenario.create":
      return `시나리오 생성 · ${asString(p.name)}`;
    case "scenario.update":
      return `시나리오 수정 · ${asString(p.id)}`;
    case "scenario.delete":
      return `시나리오 삭제 · ${asString(p.id)}`;
    default:
      return e.action;
  }
}

function asString(v: unknown): string {
  if (v === undefined || v === null) return "—";
  if (typeof v === "number") return v.toString();
  if (typeof v === "string") return v;
  return JSON.stringify(v);
}

/**
 * `created_at` / `updated_at` arrive as ISO strings over the wire (no
 * tRPC transformer in this project), so we accept Date | string here.
 */
function formatRelative(input: Date | string): string {
  const t = typeof input === "string" ? Date.parse(input) : input.getTime();
  if (!Number.isFinite(t)) return "—";
  const diff = Date.now() - t;
  const minutes = Math.round(diff / 60_000);
  if (minutes < 1) return "방금";
  if (minutes < 60) return `${minutes}분 전`;
  const hours = Math.round(diff / 3_600_000);
  if (hours < 24) return `${hours}시간 전`;
  const days = Math.round(diff / 86_400_000);
  if (days < 7) return `${days}일 전`;
  const date = new Date(t);
  return date.toISOString().slice(0, 10);
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
