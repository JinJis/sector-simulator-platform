"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { runCapabilityFetcher } from "@/lib/sim-client";

export function CapabilityTrigger() {
  const router = useRouter();
  const [vision, setVision] = useState<string>("space-data-center");
  const [capability, setCapability] = useState<string>("rad-hard-compute");
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
        const cost = out.run.cost_usd ?? 0;
        const conf =
          out.scoring_confidence != null
            ? `confidence ${out.scoring_confidence.toFixed(2)}`
            : "no scoring";
        const cache = out.dr_cached ? " (DR cache)" : "";
        setLastOk(
          `ok — wrote signal ${out.signal_id ?? "(none)"} · $${cost.toFixed(4)} · ${conf}${cache}`,
        );
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    });
  };

  return (
    <form
      onSubmit={onSubmit}
      className="flex flex-wrap items-center gap-2 rounded-lg border border-neutral-800 bg-neutral-900/40 px-4 py-3"
    >
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
      {lastOk ? <span className="text-[11px] text-sky-400">{lastOk}</span> : null}
      {error ? <span className="text-[11px] text-rose-400">{error}</span> : null}
    </form>
  );
}
