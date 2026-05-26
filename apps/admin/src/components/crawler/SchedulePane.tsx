"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import {
  type OrchestratorTickResult,
  runDiscoveryLoop,
  runOrchestratorTick,
} from "@/lib/sim-client";

/**
 * SchedulePane (M52). Orchestrator dry-run preview + manual triggers.
 *
 * - "Preview tick" (dry_run=true) shows the picked candidates without
 *   executing — cheap, no LLM burn.
 * - "Run tick" (dry_run=false) actually dispatches via the
 *   crawler.orchestratorTick mutation.
 * - "Run discovery" calls the M50 discovery loop.
 *
 * Full per-vision schedule editor (weight knobs, $/day cap overrides)
 * is a follow-up — needs the `CrawlerConfig` JSON column to ship.
 * This pane is read-mostly today.
 */
export function SchedulePane() {
  const router = useRouter();
  const [tickResult, setTickResult] = useState<OrchestratorTickResult | null>(
    null,
  );
  const [discoverySummary, setDiscoverySummary] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const tick = (dry_run: boolean) => {
    setError(null);
    setTickResult(null);
    setDiscoverySummary(null);
    startTransition(async () => {
      try {
        const r = await runOrchestratorTick({ dry_run });
        setTickResult(r);
        if (!dry_run) router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    });
  };

  const discovery = () => {
    setError(null);
    setTickResult(null);
    setDiscoverySummary(null);
    startTransition(async () => {
      try {
        const r = await runDiscoveryLoop();
        const s = r.summary as {
          candidates_detected?: number;
          proposals_written?: number;
          proposals_skipped?: number;
        };
        setDiscoverySummary(
          `detected ${s.candidates_detected ?? 0} · ` +
            `wrote ${s.proposals_written ?? 0} · ` +
            `skipped ${s.proposals_skipped ?? 0}`,
        );
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    });
  };

  return (
    <section>
      <h2 className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-neutral-500">
        Schedule + manual triggers
      </h2>
      <div className="rounded-lg border border-neutral-800 bg-neutral-900/40 px-4 py-3">
        <p className="text-[11px] text-neutral-500">
          Orchestrator config (CRAWLER_SCHEDULE):{" "}
          <span className="font-mono text-neutral-300">
            cron 15min · top-K 8 · $2/day per vision · cost-aware
          </span>
        </p>
        <div className="mt-2 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => tick(true)}
            disabled={pending}
            className="rounded bg-neutral-700 px-3 py-1 text-xs font-medium text-neutral-100 hover:bg-neutral-600 disabled:cursor-not-allowed disabled:bg-neutral-800 disabled:text-neutral-500"
          >
            Preview tick
          </button>
          <button
            type="button"
            onClick={() => tick(false)}
            disabled={pending}
            className="rounded bg-sky-700 px-3 py-1 text-xs font-medium text-sky-50 hover:bg-sky-600 disabled:cursor-not-allowed disabled:bg-neutral-700 disabled:text-neutral-400"
          >
            Run tick now
          </button>
          <button
            type="button"
            onClick={discovery}
            disabled={pending}
            className="rounded bg-amber-700 px-3 py-1 text-xs font-medium text-amber-50 hover:bg-amber-600 disabled:cursor-not-allowed disabled:bg-neutral-700 disabled:text-neutral-400"
          >
            Run discovery loop
          </button>
        </div>
        {error && (
          <p className="mt-2 text-[11px] text-rose-400">{error}</p>
        )}
        {discoverySummary && (
          <p className="mt-2 text-[11px] text-emerald-400">
            discovery: {discoverySummary}
          </p>
        )}
        {tickResult && (
          <div className="mt-3 rounded border border-neutral-800 bg-neutral-950/50 px-3 py-2">
            <div className="text-[11px] text-neutral-400">
              {tickResult.dry_run ? "dry run · " : "executed · "}
              {tickResult.total_candidates} candidates · picked{" "}
              {tickResult.picked.length} · skipped{" "}
              {tickResult.over_budget_skipped}
            </div>
            {tickResult.picked.length > 0 && (
              <ul className="mt-1.5 flex flex-col gap-1">
                {tickResult.picked.map((c) => (
                  <li
                    key={`${c.vision_slug}/${c.fetcher_kind}/${c.key}`}
                    className="grid grid-cols-12 gap-2 text-[10px] tabular-nums text-neutral-400"
                  >
                    <span className="col-span-3 truncate font-mono text-neutral-300">
                      {c.vision_slug}
                    </span>
                    <span className="col-span-2 font-mono">{c.fetcher_kind}</span>
                    <span className="col-span-3 truncate">{c.key}</span>
                    <span className="col-span-2 text-right text-neutral-500">
                      stale {Math.round(c.stale_hours)}h
                    </span>
                    <span className="col-span-1 text-right text-neutral-500">
                      ${c.estimated_cost_usd.toFixed(3)}
                    </span>
                    <span className="col-span-1 text-right text-emerald-300">
                      {c.ranking_score.toFixed(0)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
            {tickResult.dispatch_summary && (
              <pre className="mt-2 max-h-40 overflow-auto rounded bg-neutral-950 p-2 text-[10px] text-neutral-400">
                {JSON.stringify(tickResult.dispatch_summary, null, 2)}
              </pre>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
