import Link from "next/link";

import {
  fetchScenarios,
  fetchSims,
  listAdminUsers,
  listSectors,
  SECTOR_SERVICE_URL,
  type AdminUserListResult,
  type Scenario,
  type SectorRow,
  type SimMetadata,
} from "@/lib/sim-client";

import { DraftSectorRow } from "./draft-sector-row";

export const dynamic = "force-dynamic";

type Settled<T> = { ok: true; value: T } | { ok: false; error: string };

async function settle<T>(p: Promise<T>): Promise<Settled<T>> {
  try {
    return { ok: true, value: await p };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export default async function AdminHome() {
  // M48 follow-up: each upstream call settles independently so one
  // hiccup (sim-service down, agent-orch unreachable, …) doesn't
  // blank the whole dashboard. The page renders all sections it CAN
  // render and surfaces an inline notice for the ones it can't.
  const [simsR, scenariosR, dbSectorsR, usersR] = await Promise.all([
    settle(fetchSims()),
    settle(fetchScenarios()),
    settle(listSectors()),
    settle(listAdminUsers({ limit: 5 })),
  ]);

  const sims: SimMetadata[] = simsR.ok ? simsR.value : [];
  const scenarios: Scenario[] = scenariosR.ok ? scenariosR.value : [];
  const dbSectors: SectorRow[] = dbSectorsR.ok ? dbSectorsR.value : [];
  const users: AdminUserListResult = usersR.ok
    ? usersR.value
    : { rows: [], total: 0 };

  const failures = [
    simsR.ok ? null : { source: "fetchSims (simulation-service)", error: simsR.error },
    scenariosR.ok ? null : { source: "fetchScenarios (sector-service)", error: scenariosR.error },
    dbSectorsR.ok ? null : { source: "listSectors (sector-service)", error: dbSectorsR.error },
    usersR.ok ? null : { source: "listAdminUsers (sector-service)", error: usersR.error },
  ].filter((x): x is { source: string; error: string } => x != null);

  const scenarioCount = new Map<string, number>();
  for (const s of scenarios) {
    scenarioCount.set(s.sector_slug, (scenarioCount.get(s.sector_slug) ?? 0) + 1);
  }

  // Hide the seed-only placeholder unless it's the only registered sim.
  const visible = sims.filter((s) => s.slug !== "placeholder");
  const list = visible.length > 0 ? visible : sims;
  const drafts = dbSectors.filter((s) => s.status === "draft");
  const archived = dbSectors.filter((s) => s.status === "archived");

  const premiumCount = users.rows.filter((u) => u.tier === "premium").length;

  return (
    <main className="mx-auto max-w-6xl px-6 py-8">
      <div className="mb-6 flex items-baseline justify-between">
        <div>
          <h1 className="text-xl font-semibold text-neutral-50">
            모니터링 대시보드
          </h1>
          <p className="mt-1 text-[11px] text-neutral-500">
            플랫폼 상태 · 사용자 · 섹터 · 데이터 freshness 한눈에 보기.
            에이전트 시뮬레이터 생성은 일반 사용자 앱(:3000)으로 이동되었습니다.
          </p>
        </div>
      </div>

      {failures.length > 0 && (
        <div className="mb-6 rounded-lg border border-amber-800/60 bg-amber-950/30 px-4 py-3">
          <div className="text-[11px] font-medium uppercase tracking-wider text-amber-200">
            Partial data — {failures.length} upstream{" "}
            {failures.length === 1 ? "source" : "sources"} unreachable
          </div>
          <ul className="mt-1 space-y-0.5 text-[11px] text-amber-100/80">
            {failures.map((f) => (
              <li key={f.source}>
                <span className="text-amber-300">{f.source}</span>:{" "}
                <span className="text-amber-200/70">{f.error}</span>
              </li>
            ))}
          </ul>
          <div className="mt-1 text-[10px] text-amber-200/50">
            sector-service: {SECTOR_SERVICE_URL}
          </div>
        </div>
      )}

      <section className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <MetricTile
          label="등록 사용자"
          value={users.total.toString()}
          sub={`Premium ${premiumCount}명`}
          href="/users"
        />
        <MetricTile
          label="Live 섹터"
          value={list.length.toString()}
          sub={`초안 ${drafts.length} · 보관 ${archived.length}`}
        />
        <MetricTile
          label="저장 시나리오"
          value={scenarios.length.toString()}
        />
        <MetricTile
          label="에이전트 활동"
          value="모니터"
          sub="사용자 에이전트 런 조회"
          href="/agent-runs"
        />
      </section>

      <div className="mb-6 flex flex-wrap gap-2">
        <Link
          href="/users"
          className="rounded border border-cyan-700 bg-cyan-900/40 px-3 py-1.5 text-[11px] font-medium text-cyan-200 hover:bg-cyan-800/60"
          title="가입자 / Premium / 활동 통계"
        >
          👤 사용자
        </Link>
        <Link
          href="/monitoring"
          className="rounded border border-neutral-700 bg-neutral-900 px-3 py-1.5 text-[11px] font-medium text-neutral-300 hover:bg-neutral-800"
          title="data-pipeline freshness + DB row counts"
        >
          ◔ Monitoring
        </Link>
        <Link
          href="/audit"
          className="rounded border border-neutral-700 bg-neutral-900 px-3 py-1.5 text-[11px] font-medium text-neutral-300 hover:bg-neutral-800"
          title="Full audit log viewer with filters"
        >
          ☷ Audit log
        </Link>
        <Link
          href="/lifecycle"
          className="rounded border border-amber-700 bg-amber-900/40 px-3 py-1.5 text-[11px] font-medium text-amber-200 hover:bg-amber-800/60"
          title="Stale equity / orphan node / cold sector deprecate review"
        >
          ⚠ Lifecycle review
        </Link>
        <Link
          href="/agent-runs"
          className="rounded border border-neutral-700 bg-neutral-900 px-3 py-1.5 text-[11px] font-medium text-neutral-300 hover:bg-neutral-800"
          title="See past + in-flight agent runs (now user-driven)"
        >
          🤖 Agent runs
        </Link>
        <StubAction title="kicks data-pipeline-service">
          ↻ Run ingest (all)
        </StubAction>
      </div>

      <h2 className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-neutral-500">
        Live · {list.length}
      </h2>
      <div className="mb-8 grid grid-cols-1 gap-3 md:grid-cols-2">
        {list.map((sim) => (
          <SectorCard
            key={sim.slug}
            sim={sim}
            scenarios={scenarioCount.get(sim.slug) ?? 0}
          />
        ))}
      </div>

      {drafts.length > 0 && (
        <>
          <h2 className="mb-2 flex items-baseline gap-2 text-[10px] font-semibold uppercase tracking-wider text-neutral-500">
            Draft · {drafts.length}
            <span className="text-[10px] font-normal normal-case text-neutral-600">
              agent decomposition으로 등록됨 — user app에는 노출되지 않음
            </span>
          </h2>
          <ul className="mb-8 flex flex-col gap-2">
            {drafts.map((s) => (
              <DraftSectorRow key={s.slug} sector={s} />
            ))}
          </ul>
        </>
      )}

      {archived.length > 0 && (
        <>
          <h2 className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-neutral-500">
            Archived · {archived.length}
          </h2>
          <ul className="flex flex-col gap-2">
            {archived.map((s) => (
              <DraftSectorRow key={s.slug} sector={s} />
            ))}
          </ul>
        </>
      )}
    </main>
  );
}

function SectorCard({ sim, scenarios }: { sim: SimMetadata; scenarios: number }) {
  const driverGroups = new Set(sim.drivers.map((d) => d.group).filter(Boolean));
  const sourceCount = Object.values(sim.provenance).reduce(
    (n, p) => n + p.sources.length,
    0,
  );
  const presets = Object.keys(sim.presets).length;
  return (
    <Link
      href={`/sectors/${encodeURIComponent(sim.slug)}`}
      className="group rounded-lg border border-neutral-800 bg-neutral-900/40 p-4 transition hover:border-neutral-700 hover:bg-neutral-900/70"
    >
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-sm font-semibold text-neutral-50 group-hover:text-cyan-200">
          {sim.name}
        </h2>
        <span className="text-[10px] uppercase tracking-wider text-neutral-600">
          {sim.slug}
        </span>
      </div>
      <p className="mt-1 line-clamp-2 text-[12px] leading-relaxed text-neutral-400">
        {sim.description}
      </p>
      <dl className="mt-3 grid grid-cols-4 gap-2 text-[11px]">
        <Stat label="horizon" value={`${sim.horizon_years} yr`} />
        <Stat label="drivers" value={`${sim.drivers.length}`} sub={`${driverGroups.size} groups`} />
        <Stat label="presets" value={`${presets}`} />
        <Stat label="sources" value={`${sourceCount}`} sub={`${scenarios} scenarios`} />
      </dl>
      <div className="mt-3 flex items-center justify-end text-[10px] text-neutral-500">
        <span className="inline-flex items-center gap-1 rounded-full border border-emerald-900/60 bg-emerald-950/40 px-1.5 py-0.5 text-emerald-300">
          <span className="h-1 w-1 rounded-full bg-emerald-400" />
          live
        </span>
      </div>
    </Link>
  );
}

function Stat({
  label,
  value,
  sub,
}: {
  label: string;
  value: string;
  sub?: string;
}) {
  return (
    <div>
      <dt className="text-[9px] uppercase tracking-wider text-neutral-600">{label}</dt>
      <dd className="text-sm font-semibold tabular-nums text-neutral-100">{value}</dd>
      {sub && <dd className="text-[10px] text-neutral-500">{sub}</dd>}
    </div>
  );
}

function MetricTile({
  label,
  value,
  sub,
  href,
}: {
  label: string;
  value: string;
  sub?: string;
  href?: string;
}) {
  const inner = (
    <>
      <div className="text-[10px] uppercase tracking-wider text-neutral-500">
        {label}
      </div>
      <div className="mt-1 text-2xl font-semibold tabular-nums text-neutral-100">
        {value}
      </div>
      {sub && <div className="mt-0.5 text-[11px] text-neutral-500">{sub}</div>}
    </>
  );
  if (href) {
    return (
      <Link
        href={href}
        className="rounded-lg border border-neutral-800 bg-neutral-900/40 p-4 transition hover:border-cyan-700"
      >
        {inner}
      </Link>
    );
  }
  return (
    <div className="rounded-lg border border-neutral-800 bg-neutral-900/40 p-4">
      {inner}
    </div>
  );
}

function StubAction({
  children,
  title,
}: {
  children: React.ReactNode;
  title: string;
}) {
  return (
    <button
      type="button"
      disabled
      title={title}
      className="rounded border border-neutral-800 bg-neutral-900/40 px-3 py-1.5 text-[11px] font-medium text-neutral-500 hover:border-neutral-700 disabled:cursor-not-allowed"
    >
      {children}
      <span className="ml-1.5 text-[9px] uppercase tracking-wider text-neutral-700">
        soon
      </span>
    </button>
  );
}
