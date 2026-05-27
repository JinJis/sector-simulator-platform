/**
 * /admin/data-pipeline/queue — ARQ queue introspection.
 *
 * Shows queue depth, in-flight count, worker count, deferred jobs.
 * Server-renders the initial snapshot; the QueueLivePanel client
 * component polls every 3s for updates so admins can watch a backlog
 * drain in real time.
 */

import { QueueLivePanel } from "@/components/data-pipeline/QueueLivePanel";
import { fetchQueueStatus, type QueueStatus } from "@/lib/sim-client";

export const dynamic = "force-dynamic";

export default async function DataPipelineQueue() {
  let initial: QueueStatus | null = null;
  let error: string | null = null;
  try {
    initial = await fetchQueueStatus();
  } catch (err) {
    error = err instanceof Error ? err.message : String(err);
  }

  return (
    <div className="flex flex-col gap-4">
      <header>
        <h2 className="text-base font-semibold text-neutral-50">
          ARQ queue status
        </h2>
        <p className="mt-1 text-[11px] text-neutral-500">
          Live snapshot of the data-pipeline worker pool. Queue depth
          shows jobs waiting for a worker; in-progress counts jobs a
          worker has picked up but hasn&apos;t finished. Workers ≥ 1
          means at least one container is healthy and polling.
        </p>
      </header>
      {error || !initial ? (
        <div className="rounded-lg border border-rose-800/60 bg-rose-950/30 px-4 py-3 text-sm text-rose-300">
          could not reach queue — {error ?? "unknown error"}
        </div>
      ) : (
        <QueueLivePanel initial={initial} />
      )}
      <p className="text-[10px] text-neutral-500">
        Job IDs match CrawlRun.id — find a specific job in the Live
        tab by its run id. The worker logs full per-task stack traces;
        check{" "}
        <code className="rounded bg-neutral-900 px-1 py-0.5 text-neutral-300">
          docker compose logs data-pipeline-worker
        </code>{" "}
        for crashes that didn&apos;t make it to the CrawlRun row.
      </p>
    </div>
  );
}
