/**
 * /admin/crawler — M52 cockpit.
 *
 * Four panes (composition.md §7):
 *   1. Service health pills + manual fetcher triggers
 *   2. Live jobs (auto-refresh 5s, client component)
 *   3. 24h health stats (per-fetcher success/p95/cost + per-vision $/day vs cap)
 *   4. Bot proposal queue (bulk apply/reject with audit reason)
 *   5. Schedule + orchestrator preview / discovery trigger
 *
 * Server component pre-loads the read paths; client subcomponents own
 * polling + mutations.
 */

import { Breadcrumbs } from "@platform/ui";

import { ActorTrigger } from "@/components/crawler/ActorTrigger";
import { BotProposalQueue } from "@/components/crawler/BotProposalQueue";
import { CapabilityTrigger } from "@/components/crawler/CapabilityTrigger";
import { HealthPane } from "@/components/crawler/HealthPane";
import { HelloWorldTrigger } from "@/components/crawler/HelloWorldTrigger";
import { LiveJobsTable } from "@/components/crawler/LiveJobsTable";
import { RiskTrigger } from "@/components/crawler/RiskTrigger";
import { SchedulePane } from "@/components/crawler/SchedulePane";
import { SignalTrigger } from "@/components/crawler/SignalTrigger";
import {
  type BotProposalRow,
  type CrawlerHealth,
  type CrawlRun,
  type Health24h,
  fetchCrawlerHealth,
  fetchHealth24h,
  listBotProposals,
  listCrawlRuns,
  SECTOR_SERVICE_URL,
} from "@/lib/sim-client";

export const dynamic = "force-dynamic";

export default async function CrawlerCockpitPage() {
  let health: CrawlerHealth | null = null;
  let healthError: string | null = null;
  let runs: CrawlRun[] = [];
  let runsError: string | null = null;
  let stats: Health24h | null = null;
  let statsError: string | null = null;
  let bots: BotProposalRow[] = [];
  let botsError: string | null = null;

  try {
    health = await fetchCrawlerHealth();
  } catch (err) {
    healthError = err instanceof Error ? err.message : String(err);
  }
  try {
    runs = await listCrawlRuns({ limit: 20 });
  } catch (err) {
    runsError = err instanceof Error ? err.message : String(err);
  }
  try {
    stats = await fetchHealth24h(24);
  } catch (err) {
    statsError = err instanceof Error ? err.message : String(err);
  }
  try {
    bots = await listBotProposals({ limit: 30 });
  } catch (err) {
    botsError = err instanceof Error ? err.message : String(err);
  }

  return (
    <main className="mx-auto max-w-6xl px-6 py-8">
      <Breadcrumbs className="mb-3" items={[{ label: "Crawler" }]} />
      <header className="mb-5">
        <h1 className="text-xl font-semibold text-neutral-50">Crawler cockpit</h1>
        <p className="mt-1 text-xs text-neutral-500">
          Phase 4 real-time crawler — live jobs, 24h health, bot proposal
          queue, schedule + orchestrator preview. M48 → M50 shipped; full
          per-vision schedule editor lands when CrawlerConfig column is
          added.
        </p>
      </header>

      {/* Pane 1: service health pills + manual triggers */}
      <section className="mb-6">
        <h2 className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-neutral-500">
          Service health
        </h2>
        {healthError ? (
          <div className="rounded-lg border border-rose-800/60 bg-rose-950/30 px-4 py-3 text-sm text-rose-300">
            crawler 서비스에 연결할 수 없습니다 — {SECTOR_SERVICE_URL}
            <div className="mt-1 text-[11px] text-rose-400/80">{healthError}</div>
          </div>
        ) : health ? (
          <div className="flex flex-wrap items-baseline gap-2 text-[11px]">
            <ReadyChip label="repo" on={health.ready.repo} />
            <ReadyChip label="deep_research" on={health.ready.deep_research} />
            <ReadyChip
              label="agent_client"
              on={health.ready.agent_client ?? false}
            />
            <ReadyChip
              label="signal_repo"
              on={
                health.ready.signal_repo ??
                health.ready.data_pipeline_client ??
                false
              }
            />
            <span className="ml-auto text-neutral-500">
              checked {new Date(health.now).toISOString().slice(0, 19).replace("T", " ")}
            </span>
          </div>
        ) : null}
      </section>

      <section className="mb-6">
        <h2 className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-neutral-500">
          Manual fetcher triggers
        </h2>
        <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
          <HelloWorldTrigger />
          <CapabilityTrigger />
          <ActorTrigger />
          <SignalTrigger />
          <RiskTrigger />
        </div>
      </section>

      {/* Pane 2: Live jobs (auto-refresh) */}
      <div className="mb-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
        {runsError ? (
          <p className="rounded border border-rose-800/60 bg-rose-950/30 px-3 py-2 text-xs text-rose-300">
            {runsError}
          </p>
        ) : (
          <LiveJobsTable initialRuns={runs} limit={20} />
        )}
        {/* Pane 3: 24h health */}
        {statsError ? (
          <p className="rounded border border-rose-800/60 bg-rose-950/30 px-3 py-2 text-xs text-rose-300">
            {statsError}
          </p>
        ) : (
          <HealthPane health={stats} />
        )}
      </div>

      {/* Pane 4: Bot proposal queue */}
      <div className="mb-6">
        {botsError ? (
          <p className="rounded border border-rose-800/60 bg-rose-950/30 px-3 py-2 text-xs text-rose-300">
            {botsError}
          </p>
        ) : (
          <BotProposalQueue initialProposals={bots} />
        )}
      </div>

      {/* Pane 5: Schedule + orchestrator preview */}
      <SchedulePane />
    </main>
  );
}

function ReadyChip({ label, on }: { label: string; on: boolean }) {
  return (
    <span
      className={`rounded border px-2 py-0.5 font-medium uppercase tracking-wider ${
        on
          ? "border-emerald-800/60 bg-emerald-950/40 text-emerald-300"
          : "border-rose-800/60 bg-rose-950/40 text-rose-300"
      }`}
    >
      {label} {on ? "on" : "off"}
    </span>
  );
}
