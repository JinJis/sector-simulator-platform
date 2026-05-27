"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { runRiskFetcher } from "@/lib/sim-client";

import { TriggerSelectors, type TriggerSelectorsValue } from "./TriggerSelectors";
import { TriggerError, TriggerOk, TriggerPendingHint } from "./TriggerFeedback";

export function RiskTrigger() {
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
        const out = await runRiskFetcher({
          vision_slug: sel.vision_slug,
          risk_key: sel.secondary_key,
        });
        if (out.run.status === "error") {
          setError(
            `run ${out.run.id} error: ${out.run.error ?? "(no error message)"}`,
          );
        } else {
          setLastOk(
            `queued run ${out.run.id} for ${sel.secondary_key} — check Live jobs`,
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
          secondaryKind="risk"
          value={sel}
          onChange={setSel}
        />
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="submit"
            disabled={!ready}
            className="rounded bg-rose-700 px-3 py-1 text-xs font-medium text-rose-50 hover:bg-rose-600 disabled:cursor-not-allowed disabled:bg-neutral-700 disabled:text-neutral-400"
          >
            {pending ? "Queuing…" : "Queue Risk fetcher"}
          </button>
          {pending ? <TriggerPendingHint /> : null}
        </div>
      </form>
      {lastOk ? <TriggerOk text={lastOk} /> : null}
      {error ? <TriggerError raw={error} /> : null}
    </div>
  );
}
