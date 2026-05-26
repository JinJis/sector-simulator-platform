"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { runHelloWorldFetcher } from "@/lib/sim-client";

import { TriggerError, TriggerOk } from "./TriggerFeedback";

const DEFAULT_VISION = "space-data-center";

export function HelloWorldTrigger() {
  const router = useRouter();
  const [vision, setVision] = useState<string>(DEFAULT_VISION);
  const [error, setError] = useState<string | null>(null);
  const [lastOk, setLastOk] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const onSubmit = (e: React.FormEvent): void => {
    e.preventDefault();
    setError(null);
    setLastOk(null);
    startTransition(async () => {
      try {
        const out = await runHelloWorldFetcher({ vision_slug: vision });
        // The crawler returns 200 even on fetcher failure so the UI
        // can render structured feedback — split here on run.status.
        if (out.run.status === "ok" || out.run.status === "running") {
          setLastOk(
            out.cached
              ? `cache hit — reused run ${out.run.id}`
              : `ok — created run ${out.run.id} ($${(out.run.cost_usd ?? 0).toFixed(4)})`,
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
        <label className="text-xs text-neutral-400" htmlFor="hello-vision">
          Vision slug
        </label>
        <input
          id="hello-vision"
          type="text"
          value={vision}
          onChange={(e) => setVision(e.target.value)}
          className="w-64 rounded border border-neutral-700 bg-neutral-950 px-2 py-1 text-sm text-neutral-100 focus:border-neutral-500 focus:outline-none"
          autoComplete="off"
          spellCheck={false}
        />
        <button
          type="submit"
          disabled={pending || vision.trim().length === 0}
          className="rounded bg-emerald-700 px-3 py-1 text-xs font-medium text-emerald-50 hover:bg-emerald-600 disabled:cursor-not-allowed disabled:bg-neutral-700 disabled:text-neutral-400"
        >
          {pending ? "Running…" : "Run HelloWorld"}
        </button>
      </form>
      {lastOk ? <TriggerOk text={lastOk} /> : null}
      {error ? <TriggerError raw={error} /> : null}
    </div>
  );
}
