"use client";

import { useEffect, useState } from "react";

import { fetchQueueStatus, type QueueStatus } from "@/lib/sim-client";

/**
 * Polls `crawler.queueStatus` every 3s and renders ARQ queue depth +
 * worker liveness. Sub-component of /admin/data-pipeline/queue.
 *
 * Stat tiles:
 *   - Queued    — jobs waiting for a worker to pick up
 *   - In flight — jobs a worker has but hasn't finished yet
 *   - Workers   — connected worker count (heartbeats in Redis)
 *   - Deferred  — jobs scheduled for a future timestamp
 *
 * `available=false` means data-pipeline lost its Redis connection
 * (or REDIS_URL is unset). All tiles render dashed; banner explains
 * the cause.
 */
export function QueueLivePanel({ initial }: { initial: QueueStatus }) {
  const [status, setStatus] = useState<QueueStatus>(initial);
  const [tickedAt, setTickedAt] = useState<Date | null>(null);
  const [pollError, setPollError] = useState<string | null>(null);

  useEffect(() => {
    setTickedAt(new Date());
    let cancelled = false;
    const tick = async () => {
      try {
        const next = await fetchQueueStatus();
        if (!cancelled) {
          setStatus(next);
          setPollError(null);
          setTickedAt(new Date());
        }
      } catch (err) {
        if (!cancelled) {
          setPollError(err instanceof Error ? err.message : String(err));
        }
      }
    };
    const id = window.setInterval(tick, 3000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, []);

  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-baseline justify-between text-[11px] text-neutral-500">
        <span>
          queue:{" "}
          <span className="font-mono text-neutral-300">
            {status.queue_name || "—"}
          </span>
        </span>
        <span suppressHydrationWarning>
          auto-refresh 3s
          {tickedAt ? ` · last ${tickedAt.toLocaleTimeString()}` : ""}
        </span>
      </div>

      {!status.available ? (
        <div className="rounded-lg border border-amber-800/60 bg-amber-950/30 px-4 py-3 text-[11px] text-amber-200">
          queue offline — data-pipeline can&apos;t reach Redis. Check{" "}
          <code className="rounded bg-amber-950 px-1 py-0.5 text-amber-100">
            docker compose ps redis
          </code>{" "}
          + the data-pipeline container&apos;s REDIS_URL.
        </div>
      ) : null}

      {pollError ? (
        <p className="rounded border border-rose-800/60 bg-rose-950/30 px-3 py-1.5 text-[11px] text-rose-300">
          poll failed: {pollError}
        </p>
      ) : null}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Tile
          label="Queued"
          value={status.queued}
          dimmed={!status.available}
        />
        <Tile
          label="In flight"
          value={status.in_progress}
          dimmed={!status.available}
          accent={status.in_progress > 0 ? "blue" : undefined}
        />
        <Tile
          label="Workers"
          value={status.workers}
          dimmed={!status.available}
          accent={
            !status.available
              ? "muted"
              : status.workers === 0
                ? "rose"
                : "emerald"
          }
        />
        <Tile
          label="Deferred"
          value={status.deferred}
          dimmed={!status.available}
        />
      </div>
    </section>
  );
}

function Tile({
  label,
  value,
  dimmed,
  accent,
}: {
  label: string;
  value: number;
  dimmed?: boolean;
  accent?: "emerald" | "blue" | "rose" | "muted";
}) {
  const accentTone =
    accent === "emerald"
      ? "text-emerald-300"
      : accent === "blue"
        ? "text-blue-300"
        : accent === "rose"
          ? "text-rose-300"
          : accent === "muted"
            ? "text-neutral-600"
            : "text-neutral-100";
  return (
    <div
      className={`rounded-lg border border-neutral-800 bg-neutral-900/40 p-3 ${
        dimmed ? "opacity-50" : ""
      }`}
    >
      <div className="text-[10px] uppercase tracking-wider text-neutral-500">
        {label}
      </div>
      <div className={`mt-1 text-2xl font-semibold tabular-nums ${accentTone}`}>
        {dimmed ? "—" : value.toLocaleString("en-US")}
      </div>
    </div>
  );
}
