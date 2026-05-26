/**
 * /admin/data-pipeline/health — Service health + 24h stats + table counts.
 *
 * Merges the former /admin/monitoring page (data freshness + table
 * counts) with the cockpit's HealthPane (24h per-fetcher stats +
 * per-vision $/day vs cap).
 */

import { HealthPane } from "@/components/data-pipeline/HealthPane";
import {
  type CrawlerHealth,
  type Health24h,
  type MonitoringHealth,
  fetchCrawlerHealth,
  fetchHealth24h,
  fetchMonitoringHealth,
  SECTOR_SERVICE_URL,
} from "@/lib/sim-client";

export const dynamic = "force-dynamic";

type Settled<T> = { ok: true; value: T } | { ok: false; error: string };

async function settle<T>(p: Promise<T>): Promise<Settled<T>> {
  try {
    return { ok: true, value: await p };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

const FEED_TONE: Record<MonitoringHealth["feeds"][number]["status"], string> = {
  ok: "border-emerald-800/60 bg-emerald-950/40 text-emerald-300",
  stale: "border-amber-800/60 bg-amber-950/40 text-amber-300",
  down: "border-rose-800/60 bg-rose-950/40 text-rose-300",
  not_configured: "border-neutral-800 bg-neutral-950 text-neutral-500",
};

export default async function DataPipelineHealth() {
  const [healthR, statsR, monR] = await Promise.all([
    settle(fetchCrawlerHealth()),
    settle(fetchHealth24h(24)),
    settle(fetchMonitoringHealth()),
  ]);
  const health: CrawlerHealth | null = healthR.ok ? healthR.value : null;
  const stats: Health24h | null = statsR.ok ? statsR.value : null;
  const mon: MonitoringHealth | null = monR.ok ? monR.value : null;

  return (
    <>
      <section className="mb-5">
        <h2 className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-neutral-500">
          Service ready
        </h2>
        {healthR.ok && health ? (
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
              checked{" "}
              {new Date(health.now).toISOString().slice(0, 19).replace("T", " ")}
            </span>
          </div>
        ) : (
          <div className="rounded-lg border border-rose-800/60 bg-rose-950/30 px-4 py-3 text-sm text-rose-300">
            data-pipeline 서비스에 연결할 수 없습니다 — {SECTOR_SERVICE_URL}
            <div className="mt-1 text-[11px] text-rose-400/80">
              {healthR.ok ? "" : healthR.error}
            </div>
          </div>
        )}
      </section>

      <section className="mb-5">
        <h2 className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-neutral-500">
          24h fetcher stats
        </h2>
        {statsR.ok ? (
          <HealthPane health={stats} />
        ) : (
          <p className="rounded border border-rose-800/60 bg-rose-950/30 px-3 py-2 text-xs text-rose-300">
            {statsR.error}
          </p>
        )}
      </section>

      <section className="mb-5">
        <h2 className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-neutral-500">
          Data freshness
        </h2>
        {monR.ok && mon ? (
          <ul className="flex flex-col gap-2">
            {mon.feeds.map((f) => (
              <li
                key={f.name}
                className="flex flex-wrap items-baseline gap-3 rounded-lg border border-neutral-800 bg-neutral-900/40 px-4 py-3"
              >
                <span
                  className={`rounded border px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider ${FEED_TONE[f.status]}`}
                >
                  {f.status}
                </span>
                <span className="text-sm font-medium text-neutral-100">
                  {f.name}
                </span>
                <span className="text-xs text-neutral-400">{f.detail}</span>
                <div className="ml-auto flex flex-col items-end text-[11px] text-neutral-500">
                  <span>
                    last:{" "}
                    {f.last_success_at
                      ? f.last_success_at.slice(0, 16).replace("T", " ")
                      : "—"}
                  </span>
                  {f.next_run_at ? (
                    <span>
                      next: {f.next_run_at.slice(0, 16).replace("T", " ")}
                    </span>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <p className="rounded border border-rose-800/60 bg-rose-950/30 px-3 py-2 text-xs text-rose-300">
            {monR.ok ? "" : monR.error}
          </p>
        )}
      </section>

      <section>
        <h2 className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-neutral-500">
          Table counts
        </h2>
        {monR.ok && mon ? (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Tile label="Sectors" value={mon.table_counts.sectors} />
            <Tile label="Equities" value={mon.table_counts.equities} />
            <Tile label="Quote bars" value={mon.table_counts.equity_quotes} />
            <Tile
              label="Financial qtrs"
              value={mon.table_counts.equity_financials}
            />
            <Tile label="Graph nodes" value={mon.table_counts.graph_nodes} />
            <Tile label="Graph edges" value={mon.table_counts.graph_edges} />
            <Tile label="Scenarios" value={mon.table_counts.scenarios} />
            <Tile label="Audit logs" value={mon.table_counts.audit_logs} />
          </div>
        ) : null}
      </section>
    </>
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

function Tile({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded border border-neutral-800 bg-neutral-900/40 px-3 py-2">
      <div className="text-[10px] uppercase tracking-wider text-neutral-500">
        {label}
      </div>
      <div className="mt-1 font-mono text-lg text-neutral-100">
        {value.toLocaleString("en-US")}
      </div>
    </div>
  );
}
