"use client";

import { useEffect, useState } from "react";

import { type CrawlRun, listCrawlRuns } from "@/lib/sim-client";

const STATUS_TONE: Record<string, string> = {
  ok: "border-emerald-800/60 bg-emerald-950/40 text-emerald-300",
  running: "border-blue-800/60 bg-blue-950/40 text-blue-300",
  queued: "border-neutral-800 bg-neutral-900/40 text-neutral-300",
  error: "border-rose-800/60 bg-rose-950/40 text-rose-300",
  cancelled: "border-amber-800/60 bg-amber-950/40 text-amber-300",
  timeout: "border-amber-800/60 bg-amber-950/40 text-amber-300",
};

function statusTone(s: string): string {
  return STATUS_TONE[s] ?? "border-neutral-800 bg-neutral-900/40 text-neutral-400";
}

/**
 * LiveJobsTable (M52). Polls `crawler.runs.list` every 5s and renders
 * the most recent runs. Surfaces status, fetcher, vision, elapsed, and
 * cost so admins can watch a tick unfold without manual refresh.
 */
export function LiveJobsTable({
  initialRuns,
  limit = 20,
}: {
  initialRuns: CrawlRun[];
  limit?: number;
}) {
  const [runs, setRuns] = useState<CrawlRun[]>(initialRuns);
  const [error, setError] = useState<string | null>(null);
  const [tickedAt, setTickedAt] = useState<Date>(new Date());

  useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      try {
        const next = await listCrawlRuns({ limit });
        if (!cancelled) {
          setRuns(next);
          setError(null);
          setTickedAt(new Date());
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err));
        }
      }
    };
    const id = window.setInterval(tick, 5000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [limit]);

  return (
    <section>
      <div className="mb-2 flex items-baseline justify-between">
        <h2 className="text-[10px] font-semibold uppercase tracking-wider text-neutral-500">
          Live jobs ({runs.length})
        </h2>
        <span className="text-[10px] text-neutral-600">
          auto-refresh 5s · last {tickedAt.toLocaleTimeString()}
        </span>
      </div>
      {error ? (
        <p className="mb-2 rounded border border-rose-800/60 bg-rose-950/30 px-3 py-1.5 text-[11px] text-rose-300">
          poll failed: {error}
        </p>
      ) : null}
      {runs.length === 0 ? (
        <p className="rounded border border-dashed border-neutral-800 bg-neutral-950/40 px-4 py-6 text-center text-xs text-neutral-500">
          No runs yet. Trigger a fetcher above or wait for the cron tick.
        </p>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {runs.map((r) => (
            <RunRow key={r.id} run={r} />
          ))}
        </ul>
      )}
    </section>
  );
}

function RunRow({ run }: { run: CrawlRun }) {
  const started = new Date(run.started_at);
  const ended = run.ended_at ? new Date(run.ended_at) : null;
  const elapsed =
    ended != null
      ? `${((ended.getTime() - started.getTime()) / 1000).toFixed(2)}s`
      : `${((Date.now() - started.getTime()) / 1000).toFixed(0)}s…`;
  const costStr = run.cost_usd != null ? `$${run.cost_usd.toFixed(4)}` : "—";
  const preview =
    run.result_summary && typeof run.result_summary === "object"
      ? (run.result_summary as { output_preview?: string }).output_preview ?? ""
      : "";
  return (
    <li className="rounded-lg border border-neutral-800 bg-neutral-900/40 px-3 py-2">
      <div className="flex flex-wrap items-baseline gap-3 text-xs">
        <span
          className={`rounded border px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider ${statusTone(run.status)}`}
        >
          {run.status}
        </span>
        <span className="font-mono text-neutral-200">{run.fetcher_kind}</span>
        <span className="text-neutral-400">{run.vision_slug}</span>
        <span className="ml-auto text-neutral-500 tabular-nums">{elapsed}</span>
        <span className="text-neutral-500 tabular-nums">{costStr}</span>
        {run.signals_written > 0 && (
          <span className="text-emerald-400 tabular-nums">
            +{run.signals_written} sig
          </span>
        )}
      </div>
      {preview && (
        <p className="mt-1 line-clamp-1 text-[11px] text-neutral-400">{preview}</p>
      )}
      {run.error && (
        <p className="mt-1 line-clamp-1 text-[11px] text-rose-400">
          error: {run.error}
        </p>
      )}
    </li>
  );
}
