"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { runSignalFetcher } from "@/lib/sim-client";

import { TriggerError, TriggerOk } from "./TriggerFeedback";

export function SignalTrigger() {
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
        const out = await runSignalFetcher({
          vision_slug: vision,
          capability_key: capability,
        });
        if (out.run.status === "ok") {
          setLastOk(
            `ok — fetched ${out.raw_signals_fetched} raw · wrote ${out.signals_written} · $${out.extractor_total_cost_usd.toFixed(4)}` +
              (out.extractor_failures > 0
                ? ` (${out.extractor_failures} extractor fail)`
                : ""),
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
        <label className="text-xs text-neutral-400" htmlFor="signal-vision">
          Vision
        </label>
        <input
          id="signal-vision"
          type="text"
          value={vision}
          onChange={(e) => setVision(e.target.value)}
          className="w-40 rounded border border-neutral-700 bg-neutral-950 px-2 py-1 text-sm text-neutral-100 focus:border-neutral-500 focus:outline-none"
          autoComplete="off"
          spellCheck={false}
        />
        <label className="text-xs text-neutral-400" htmlFor="signal-cap">
          Capability key
        </label>
        <input
          id="signal-cap"
          type="text"
          value={capability}
          onChange={(e) => setCapability(e.target.value)}
          className="w-40 rounded border border-neutral-700 bg-neutral-950 px-2 py-1 text-sm text-neutral-100 focus:border-neutral-500 focus:outline-none"
          autoComplete="off"
          spellCheck={false}
        />
        <button
          type="submit"
          disabled={pending || !vision.trim() || !capability.trim()}
          className="rounded bg-cyan-700 px-3 py-1 text-xs font-medium text-cyan-50 hover:bg-cyan-600 disabled:cursor-not-allowed disabled:bg-neutral-700 disabled:text-neutral-400"
        >
          {pending ? "Running…" : "Run Signal ingest"}
        </button>
      </form>
      {lastOk && <TriggerOk text={lastOk} />}
      {error && <TriggerError raw={error} />}
    </div>
  );
}
