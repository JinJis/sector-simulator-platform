"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { runCapabilityFetcher } from "@/lib/sim-client";

import { TriggerSelectors, type TriggerSelectorsValue } from "./TriggerSelectors";
import { TriggerError, TriggerOk, TriggerPendingHint } from "./TriggerFeedback";

export function CapabilityTrigger() {
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
        const out = await runCapabilityFetcher({
          vision_slug: sel.vision_slug,
          capability_key: sel.secondary_key,
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

  const ready =
    sel.vision_slug.length > 0 && sel.secondary_key.length > 0 && !pending;

  return (
    <div className="rounded-lg border border-neutral-800 bg-neutral-900/40 px-4 py-3">
      <form onSubmit={onSubmit} className="flex flex-col gap-2">
        <TriggerSelectors
          secondaryKind="capability"
          value={sel}
          onChange={setSel}
        />
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="submit"
            disabled={!ready}
            className="rounded bg-sky-700 px-3 py-1 text-xs font-medium text-sky-50 hover:bg-sky-600 disabled:cursor-not-allowed disabled:bg-neutral-700 disabled:text-neutral-400"
          >
            {pending ? "Running…" : "Run Capability fetcher"}
          </button>
          {pending ? <TriggerPendingHint /> : null}
        </div>
      </form>
      {lastOk ? <TriggerOk text={lastOk} /> : null}
      {error ? <TriggerError raw={error} /> : null}
    </div>
  );
}
