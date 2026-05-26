import type { Health24h } from "@/lib/sim-client";

const PER_VISION_DAILY_CAP = 2.0;

function successTone(rate: number): string {
  if (rate >= 0.95) return "border-emerald-800/60 bg-emerald-950/40 text-emerald-300";
  if (rate >= 0.7) return "border-amber-800/60 bg-amber-950/40 text-amber-300";
  return "border-rose-800/60 bg-rose-950/40 text-rose-300";
}

function costTone(spent: number, cap: number): string {
  const pct = cap > 0 ? spent / cap : 0;
  if (pct < 0.5) return "border-emerald-800/60 bg-emerald-950/40 text-emerald-300";
  if (pct < 0.9) return "border-amber-800/60 bg-amber-950/40 text-amber-300";
  return "border-rose-800/60 bg-rose-950/40 text-rose-300";
}

/**
 * HealthPane (M52). Stripe-Status-style per-fetcher pills (success rate
 * + P95 latency + 24h cost) and per-vision $/day vs cap chips.
 */
export function HealthPane({ health }: { health: Health24h | null }) {
  if (health == null) {
    return (
      <section>
        <h2 className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-neutral-500">
          24h health
        </h2>
        <p className="rounded border border-dashed border-neutral-800 bg-neutral-950/40 px-4 py-6 text-center text-xs text-neutral-500">
          health stats unavailable.
        </p>
      </section>
    );
  }
  return (
    <section>
      <div className="mb-2 flex items-baseline justify-between">
        <h2 className="text-[10px] font-semibold uppercase tracking-wider text-neutral-500">
          24h health
        </h2>
        <span className="text-[10px] text-neutral-600 tabular-nums">
          {health.total_runs} runs · ${health.total_cost_usd.toFixed(4)}
        </span>
      </div>
      {health.by_fetcher.length === 0 ? (
        <p className="rounded border border-dashed border-neutral-800 bg-neutral-950/40 px-4 py-4 text-center text-xs text-neutral-500">
          No runs in the last {health.window_hours}h.
        </p>
      ) : (
        <div className="grid grid-cols-2 gap-2 md:grid-cols-3">
          {health.by_fetcher.map((row) => {
            const tone = successTone(row.success_rate);
            return (
              <div
                key={row.fetcher_kind}
                className="rounded-lg border border-neutral-800 bg-neutral-900/40 p-3"
              >
                <div className="mb-1 flex items-baseline justify-between">
                  <span className="font-mono text-[11px] text-neutral-300">
                    {row.fetcher_kind}
                  </span>
                  <span
                    className={`rounded border px-1.5 py-0.5 text-[10px] font-mono uppercase tracking-wider ${tone}`}
                  >
                    {Math.round(row.success_rate * 100)}%
                  </span>
                </div>
                <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[10px] text-neutral-500 tabular-nums">
                  <span>{row.count} runs</span>
                  {row.error_count > 0 && (
                    <span className="text-rose-400">{row.error_count} err</span>
                  )}
                  <span>
                    p95{" "}
                    {row.p95_duration_ms != null
                      ? `${Math.round(row.p95_duration_ms)}ms`
                      : "—"}
                  </span>
                  <span>${row.total_cost_usd.toFixed(4)}</span>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <h3 className="mb-1.5 mt-4 text-[10px] font-semibold uppercase tracking-wider text-neutral-500">
        Per-vision spend · 24h vs ${PER_VISION_DAILY_CAP.toFixed(2)} cap
      </h3>
      {health.by_vision.length === 0 ? (
        <p className="text-[11px] text-neutral-500">No spend recorded yet.</p>
      ) : (
        <div className="flex flex-wrap gap-2">
          {health.by_vision.map((v) => {
            const tone = costTone(v.total_cost_usd, PER_VISION_DAILY_CAP);
            const pct = Math.min(
              100,
              Math.round((v.total_cost_usd / PER_VISION_DAILY_CAP) * 100),
            );
            return (
              <span
                key={v.vision_slug}
                className={`rounded border px-2 py-1 text-[10px] tabular-nums ${tone}`}
              >
                <span className="font-mono">{v.vision_slug}</span>{" "}
                ${v.total_cost_usd.toFixed(4)} ({pct}%)
              </span>
            );
          })}
        </div>
      )}
    </section>
  );
}
