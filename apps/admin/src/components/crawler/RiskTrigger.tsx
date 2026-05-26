"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { runRiskFetcher } from "@/lib/sim-client";

import { TriggerError, TriggerOk } from "./TriggerFeedback";

export function RiskTrigger() {
  const router = useRouter();
  const [vision, setVision] = useState<string>("space-data-center");
  const [risk, setRisk] = useState<string>("insurance_thinness");
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
          vision_slug: vision,
          risk_key: risk,
        });
        if (out.run.status === "ok") {
          const cost = out.run.cost_usd ?? 0;
          const conf =
            out.scoring_confidence != null
              ? `conf ${out.scoring_confidence.toFixed(2)}`
              : "no scoring";
          setLastOk(
            `ok — signal ${out.signal_id ?? "(none)"} · $${cost.toFixed(4)} · ${conf} · ${out.risk_severity}/${out.risk_likelihood}`,
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
        <label className="text-xs text-neutral-400" htmlFor="risk-vision">
          Vision
        </label>
        <input
          id="risk-vision"
          type="text"
          value={vision}
          onChange={(e) => setVision(e.target.value)}
          className="w-40 rounded border border-neutral-700 bg-neutral-950 px-2 py-1 text-sm text-neutral-100 focus:border-neutral-500 focus:outline-none"
          autoComplete="off"
          spellCheck={false}
        />
        <label className="text-xs text-neutral-400" htmlFor="risk-key">
          Risk key
        </label>
        <input
          id="risk-key"
          type="text"
          value={risk}
          onChange={(e) => setRisk(e.target.value)}
          className="w-40 rounded border border-neutral-700 bg-neutral-950 px-2 py-1 text-sm text-neutral-100 focus:border-neutral-500 focus:outline-none"
          autoComplete="off"
          spellCheck={false}
        />
        <button
          type="submit"
          disabled={pending || !vision.trim() || !risk.trim()}
          className="rounded bg-rose-700 px-3 py-1 text-xs font-medium text-rose-50 hover:bg-rose-600 disabled:cursor-not-allowed disabled:bg-neutral-700 disabled:text-neutral-400"
        >
          {pending ? "Running…" : "Run Risk fetcher"}
        </button>
      </form>
      {lastOk && <TriggerOk text={lastOk} />}
      {error && <TriggerError raw={error} />}
    </div>
  );
}
