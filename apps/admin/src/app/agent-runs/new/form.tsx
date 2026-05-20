"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { startDecomposition } from "@/lib/sim-client";

export function NewDecompositionForm() {
  const router = useRouter();
  const [description, setDescription] = useState("");
  const [referenceData, setReferenceData] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const record = await startDecomposition({
        description: description.trim(),
        reference_data: referenceData.trim() || undefined,
      });
      router.push(`/agent-runs/${encodeURIComponent(record.id)}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  }

  const tooShort = description.trim().length < 10;

  return (
    <form
      onSubmit={handleSubmit}
      className="space-y-5 rounded-lg border border-neutral-800 bg-neutral-900/40 p-5"
    >
      <div>
        <label
          htmlFor="description"
          className="block text-[10px] font-semibold uppercase tracking-wider text-neutral-400"
        >
          Sector description{" "}
          <span className="text-neutral-600">(min 10 chars)</span>
        </label>
        <textarea
          id="description"
          name="description"
          required
          rows={5}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="A hydrometallurgical lithium-ion battery recycling sector — EV pack feedstock, metals recovery (Ni / Co / Li), processing OPEX, facility CAPEX, and per-pack economics."
          className="mt-1 w-full rounded border border-neutral-800 bg-neutral-950 px-3 py-2 text-sm text-neutral-100 placeholder:text-neutral-700 focus:border-cyan-700 focus:outline-none"
        />
        <p className="mt-1 text-[10px] text-neutral-600">
          1–3 sentences describing the sector. The agent prefers concrete
          framing (technology + market + question) over generic descriptions.
        </p>
      </div>

      <div>
        <label
          htmlFor="reference_data"
          className="block text-[10px] font-semibold uppercase tracking-wider text-neutral-400"
        >
          Reference data{" "}
          <span className="text-neutral-600">(optional)</span>
        </label>
        <textarea
          id="reference_data"
          name="reference_data"
          rows={4}
          value={referenceData}
          onChange={(e) => setReferenceData(e.target.value)}
          placeholder="Prior analogous sector context — paste relevant excerpts from research, an analyst report, or a similar registered sector's metadata. The agent will use it to anchor driver defaults and ranges."
          className="mt-1 w-full rounded border border-neutral-800 bg-neutral-950 px-3 py-2 text-sm text-neutral-100 placeholder:text-neutral-700 focus:border-cyan-700 focus:outline-none"
        />
      </div>

      {error && (
        <p className="rounded border border-red-900/60 bg-red-950/40 p-2 text-[11px] text-red-300">
          {error}
        </p>
      )}

      <div className="flex items-center justify-between gap-3">
        <p className="text-[10px] text-neutral-600">
          {tooShort
            ? "Description is too short to submit."
            : "Submitting will route to /agent-runs/[id] with live status."}
        </p>
        <button
          type="submit"
          disabled={tooShort || busy}
          className="rounded border border-rose-700 bg-rose-900/40 px-4 py-1.5 text-xs font-medium text-rose-200 hover:bg-rose-800/60 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {busy ? "Submitting…" : "Run decomposition"}
        </button>
      </div>
    </form>
  );
}
