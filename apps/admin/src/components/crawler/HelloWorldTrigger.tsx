"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { runHelloWorldFetcher } from "@/lib/sim-client";

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
        setLastOk(
          out.cached
            ? `cache hit — reused run ${out.run.id}`
            : `ok — created run ${out.run.id} ($${(out.run.cost_usd ?? 0).toFixed(4)})`,
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
      {lastOk ? <span className="text-[11px] text-emerald-400">{lastOk}</span> : null}
      {error ? <span className="text-[11px] text-rose-400">{error}</span> : null}
    </form>
  );
}
