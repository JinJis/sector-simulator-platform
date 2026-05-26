"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { runCapabilityFetcher } from "@/lib/sim-client";

import { TriggerError, TriggerOk } from "./TriggerFeedback";

export function CapabilityTrigger() {
  const router = useRouter();
  const [vision, setVision] = useState<string>("space-data-center");
  const [capability, setCapability] = useState<string>("rad_hard_compute");
  const [error, setError] = useState<string | null>(null);
  const [lastOk, setLastOk] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const onSubmit = (e: React.FormEvent): void => {
    e.preventDefault();
    setError(null);
    setLastOk(null);
    startTransition(async () => {
      try {
        const out = await runCapabilityFetcher({
          vision_slug: vision,
          capability_key: capability,
        });
        if (out.run.status === "ok" || out.run.status === "running") {
          const cost = out.run.cost_usd ?? 0;
          const conf =
            out.scoring_confidence != null
              ? `confidence ${out.scoring_confidence.toFixed(2)}`
              : "no scoring";
          const cache = out.dr_cached ? " (DR cache)" : "";
          setLastOk(
            `ok — wrote signal ${out.signal_id ?? "(none)"} · $${cost.toFixed(4)} · ${conf}${cache}`,
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
    <div className="rounded-lg border border-neutral-800 bg-neutral-900/40 px-4 py-3">
      <form onSubmit={onSubmit} className="flex flex-wrap items-center gap-2">
        <label className="text-xs text-neutral-400" htmlFor="cap-vision">
          Vision
        </label>
        <input
          id="cap-vision"
          type="text"
          value={vision}
          onChange={(e) => setVision(e.target.value)}
          className="w-52 rounded border border-neutral-700 bg-neutral-950 px-2 py-1 text-sm text-neutral-100 focus:border-neutral-500 focus:outline-none"
          autoComplete="off"
          spellCheck={false}
        />
        <label className="text-xs text-neutral-400" htmlFor="cap-key">
          Capability key
        </label>
        <input
          id="cap-key"
          type="text"
          value={capability}
          onChange={(e) => setCapability(e.target.value)}
          className="w-52 rounded border border-neutral-700 bg-neutral-950 px-2 py-1 text-sm text-neutral-100 focus:border-neutral-500 focus:outline-none"
          autoComplete="off"
          spellCheck={false}
        />
        <button
          type="submit"
          disabled={
            pending || vision.trim().length === 0 || capability.trim().length === 0
          }
          className="rounded bg-sky-700 px-3 py-1 text-xs font-medium text-sky-50 hover:bg-sky-600 disabled:cursor-not-allowed disabled:bg-neutral-700 disabled:text-neutral-400"
        >
          {pending ? "Running…" : "Run Capability fetcher"}
        </button>
      </form>
      {lastOk ? <TriggerOk text={lastOk} /> : null}
      {error ? <TriggerError raw={error} /> : null}
    </div>
  );
}
