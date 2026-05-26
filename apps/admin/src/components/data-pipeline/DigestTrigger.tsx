"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { runDeepResearchDigest } from "@/lib/sim-client";

import { TriggerError, TriggerOk } from "./TriggerFeedback";

export function DigestTrigger() {
  const router = useRouter();
  const [vision, setVision] = useState<string>("space-data-center");
  const [error, setError] = useState<string | null>(null);
  const [lastOk, setLastOk] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const onSubmit = (e: React.FormEvent): void => {
    e.preventDefault();
    setError(null);
    setLastOk(null);
    startTransition(async () => {
      try {
        const out = await runDeepResearchDigest({ vision_slug: vision });
        if (out.run.status === "ok") {
          const conf =
            out.scoring_confidence != null
              ? `confidence ${out.scoring_confidence.toFixed(2)}`
              : "no scoring";
          const cost = out.run.cost_usd ?? 0;
          setLastOk(
            `ok — signal ${out.signal_id ?? "(none)"} on ${out.anchor_capability_key ?? "?"} · $${cost.toFixed(4)} · ${conf}`,
          );
        } else {
          setError(
            `run ${out.run.id} ${out.run.status}: ${out.run.error ?? "(no error message)"}`,
          );
        }
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    });
  };

  return (
    <div className="rounded-lg border border-violet-900/60 bg-violet-950/20 px-4 py-3">
      <form onSubmit={onSubmit} className="flex flex-wrap items-center gap-2">
        <span className="rounded bg-violet-900/60 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider text-violet-200">
          digest
        </span>
        <label className="text-xs text-neutral-400" htmlFor="digest-vision">
          Vision
        </label>
        <input
          id="digest-vision"
          type="text"
          value={vision}
          onChange={(e) => setVision(e.target.value)}
          className="w-52 rounded border border-neutral-700 bg-neutral-950 px-2 py-1 text-sm text-neutral-100 focus:border-violet-500 focus:outline-none"
          autoComplete="off"
          spellCheck={false}
        />
        <button
          type="submit"
          disabled={pending || vision.trim().length === 0}
          className="rounded bg-violet-700 px-3 py-1 text-xs font-medium text-violet-50 hover:bg-violet-600 disabled:cursor-not-allowed disabled:bg-neutral-700 disabled:text-neutral-400"
        >
          {pending ? "Running…" : "Run DR digest"}
        </button>
        <span className="ml-1 text-[10px] text-neutral-500">
          industry/macro synthesis · 1×/day per vision · ~$3-5 per run
        </span>
      </form>
      {lastOk ? <TriggerOk text={lastOk} /> : null}
      {error ? <TriggerError raw={error} /> : null}
    </div>
  );
}
