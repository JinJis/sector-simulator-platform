"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { runSignalFetcher } from "@/lib/sim-client";

import { TriggerSelectors, type TriggerSelectorsValue } from "./TriggerSelectors";
import { TriggerError, TriggerOk } from "./TriggerFeedback";

export function SignalTrigger() {
  const router = useRouter();
  const [sel, setSel] = useState<TriggerSelectorsValue>({
    vision_slug: "",
    secondary_key: "",
  });
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
          vision_slug: sel.vision_slug,
          capability_key: sel.secondary_key,
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

  const ready =
    sel.vision_slug.length > 0 && sel.secondary_key.length > 0 && !pending;

  return (
    <div className="rounded-lg border border-neutral-800 bg-neutral-900/40 px-4 py-3">
      <form onSubmit={onSubmit} className="flex flex-col gap-2">
        <TriggerSelectors
          secondaryKind="capability"
          secondaryLabel="Capability"
          value={sel}
          onChange={setSel}
        />
        <button
          type="submit"
          disabled={!ready}
          className="self-start rounded bg-cyan-700 px-3 py-1 text-xs font-medium text-cyan-50 hover:bg-cyan-600 disabled:cursor-not-allowed disabled:bg-neutral-700 disabled:text-neutral-400"
        >
          {pending ? "Running…" : "Run Signal ingest"}
        </button>
      </form>
      {lastOk ? <TriggerOk text={lastOk} /> : null}
      {error ? <TriggerError raw={error} /> : null}
    </div>
  );
}
