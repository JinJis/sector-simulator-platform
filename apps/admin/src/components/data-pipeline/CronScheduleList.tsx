/**
 * CronScheduleList — all APScheduler jobs on the data-pipeline
 * container with their next-run timestamp.
 *
 * Reads `health.scheduler_armed` + `health.next_runs` (added to the
 * tRPC CrawlerHealth schema alongside the new follow-up cleanup).
 * Server-rendered against the live health snapshot; the polling
 * LiveJobsTable handles live updates as crons actually fire.
 */

import {
  fetchCrawlerHealth,
  SECTOR_SERVICE_URL,
  type CrawlerHealth,
} from "@/lib/sim-client";

// Human description per APScheduler job id. Falls back to the bare
// id for jobs the data-pipeline arms but this list doesn't know.
const JOB_INFO: Record<
  string,
  {
    label: string;
    cadence: string;
    note: string;
  }
> = {
  news_ingest_5min: {
    label: "News ingest",
    cadence: "every 5 min",
    note: "crawl4ai over Yahoo + Naver + Finviz per vision ticker",
  },
  research_ingest_hourly: {
    label: "Research ingest",
    cadence: "hourly · :07 UTC",
    note: "arXiv + USPTO per capability keyword set",
  },
  recompute_feasibility_hourly: {
    label: "Recompute feasibility",
    cadence: "hourly · :25 UTC",
    note: "ScoreUpdater agent per capability → vision rollup",
  },
  digest_daily: {
    label: "DR digest (grounded)",
    cadence: "daily · 06:00 UTC default",
    note: "gemini-3.1-pro-preview synthesis per vision · ~$0.30/run",
  },
  orchestrator_tick_15min: {
    label: "Orchestrator picker",
    cadence: "every 15 min",
    note: "M49f opportunistic fetcher dispatch — gated off by default",
  },
  refresh_quotes_daily: {
    label: "Refresh quotes",
    cadence: "daily · 08:30 UTC default",
    note: "yfinance equity quote snapshot for PredictionV2 anchor",
  },
  resolve_predictions_v2_hourly: {
    label: "Resolve predictions v2",
    cadence: "hourly · :05 UTC",
    note: "M46b band-based prediction resolver",
  },
};

// Jobs that aren't (currently) armed but are valid env-gates the
// operator might want to flip on. Rendered after the armed list so
// the cockpit is a single source of truth for "what's running where".
const KNOWN_GATED: Array<{ id: string; envVar: string }> = [
  { id: "digest_daily", envVar: "DIGEST_SCHEDULE" },
  { id: "orchestrator_tick_15min", envVar: "ORCHESTRATOR_SCHEDULE" },
  { id: "news_ingest_5min", envVar: "NEWS_INGEST_SCHEDULE" },
  { id: "research_ingest_hourly", envVar: "RESEARCH_INGEST_SCHEDULE" },
];

export async function CronScheduleList() {
  let health: CrawlerHealth | null = null;
  let error: string | null = null;
  try {
    health = await fetchCrawlerHealth();
  } catch (err) {
    error = err instanceof Error ? err.message : String(err);
  }

  if (error || !health) {
    return (
      <section>
        <h2 className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-neutral-500">
          Cron schedule
        </h2>
        <div className="rounded-lg border border-rose-800/60 bg-rose-950/30 px-3 py-2 text-[11px] text-rose-300">
          could not load health — {error ?? "unknown error"}
          <div className="mt-1 text-[10px] text-rose-400/80">
            {SECTOR_SERVICE_URL}
          </div>
        </div>
      </section>
    );
  }

  const nextRuns = health.next_runs ?? {};
  const armed = Object.entries(nextRuns).map(([id, nextRunISO]) => ({
    id,
    nextRunISO,
    info: JOB_INFO[id] ?? { label: id, cadence: "—", note: "" },
  }));
  // Stable display order: by cadence (5min → daily) — use a lookup,
  // otherwise alpha as fallback.
  const order: Record<string, number> = {
    news_ingest_5min: 0,
    orchestrator_tick_15min: 1,
    resolve_predictions_v2_hourly: 2,
    research_ingest_hourly: 3,
    recompute_feasibility_hourly: 4,
    refresh_quotes_daily: 5,
    digest_daily: 6,
  };
  armed.sort((a, b) => {
    const ao = order[a.id] ?? 99;
    const bo = order[b.id] ?? 99;
    return ao - bo || a.id.localeCompare(b.id);
  });

  const armedIds = new Set(armed.map((r) => r.id));
  const offGates = KNOWN_GATED.filter((g) => !armedIds.has(g.id));

  return (
    <section>
      <div className="mb-2 flex items-baseline justify-between">
        <h2 className="text-[10px] font-semibold uppercase tracking-wider text-neutral-500">
          Cron schedule
        </h2>
        <span className="text-[10px] text-neutral-600">
          scheduler {health.scheduler_armed ? "armed" : "off"} ·{" "}
          checked{" "}
          {new Date(health.now).toISOString().slice(11, 19)} UTC
        </span>
      </div>

      {armed.length === 0 ? (
        <p className="rounded border border-dashed border-neutral-800 bg-neutral-950/40 px-4 py-4 text-center text-xs text-neutral-500">
          No armed cron jobs. INGEST_SCHEDULE may be off.
        </p>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {armed.map((row) => (
            <li
              key={row.id}
              className="rounded-lg border border-neutral-800 bg-neutral-900/40 px-3 py-2"
            >
              <div className="flex flex-wrap items-baseline gap-3 text-xs">
                <span className="rounded border border-emerald-800/60 bg-emerald-950/40 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider text-emerald-300">
                  on
                </span>
                <span className="font-medium text-neutral-100">
                  {row.info.label}
                </span>
                <span className="text-neutral-500">{row.info.cadence}</span>
                <span className="ml-auto font-mono text-[10px] text-neutral-500">
                  {row.id}
                </span>
                <span className="text-neutral-400 tabular-nums">
                  next{" "}
                  {row.nextRunISO
                    ? row.nextRunISO.slice(11, 19) + " UTC"
                    : "—"}
                </span>
              </div>
              {row.info.note ? (
                <p className="mt-1 text-[10px] text-neutral-500">
                  {row.info.note}
                </p>
              ) : null}
            </li>
          ))}
        </ul>
      )}

      {offGates.length > 0 ? (
        <div className="mt-4">
          <h3 className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-neutral-600">
            Disabled (env)
          </h3>
          <ul className="flex flex-col gap-1.5">
            {offGates.map((g) => {
              const info = JOB_INFO[g.id] ?? {
                label: g.id,
                cadence: "—",
                note: "",
              };
              return (
                <li
                  key={g.id}
                  className="rounded-lg border border-neutral-800/60 bg-neutral-900/20 px-3 py-2"
                >
                  <div className="flex flex-wrap items-baseline gap-3 text-xs">
                    <span className="rounded border border-neutral-700 bg-neutral-900 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider text-neutral-500">
                      off
                    </span>
                    <span className="text-neutral-400">{info.label}</span>
                    <span className="text-neutral-600">{info.cadence}</span>
                    <span className="ml-auto font-mono text-[10px] text-neutral-600">
                      set <span className="text-neutral-400">{g.envVar}=on</span>{" "}
                      to arm
                    </span>
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}
    </section>
  );
}
