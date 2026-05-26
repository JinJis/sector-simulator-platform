"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import {
  startDecomposition,
  startFullPipeline,
  startProposeSector,
} from "@/lib/sim-client";

type Pipeline = "full_pipeline" | "propose_sector" | "decomposition";

export function NewDecompositionForm() {
  const router = useRouter();
  const [description, setDescription] = useState("");
  const [referenceData, setReferenceData] = useState("");
  const [focusAreasRaw, setFocusAreasRaw] = useState("");
  const [pipeline, setPipeline] = useState<Pipeline>("full_pipeline");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const payload = {
        description: description.trim(),
        reference_data: referenceData.trim() || undefined,
      };
      let record;
      if (pipeline === "full_pipeline") {
        const focus_areas = focusAreasRaw
          .split("\n")
          .map((s) => s.trim())
          .filter(Boolean)
          .slice(0, 20);
        record = await startFullPipeline({ ...payload, focus_areas });
      } else if (pipeline === "propose_sector") {
        record = await startProposeSector(payload);
      } else {
        record = await startDecomposition(payload);
      }
      router.push(`/data-pipeline/agent-runs/${encodeURIComponent(record.id)}`);
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
      <fieldset>
        <legend className="text-[10px] font-semibold uppercase tracking-wider text-neutral-400">
          Pipeline
        </legend>
        <div className="mt-2 grid gap-2 sm:grid-cols-3">
          <PipelineOption
            value="full_pipeline"
            current={pipeline}
            onSelect={setPipeline}
            title="Full pipeline (M28)"
            subtitle="6 agents end-to-end"
            blurb="Research → Decomposition → DriverInference → EdgeInference → CodeGen → CodeReview. Produces a reviewed SimulationBase source file. Typical cost $0.50–$1.00 — most expensive option."
          />
          <PipelineOption
            value="propose_sector"
            current={pipeline}
            onSelect={setPipeline}
            title="Propose sector"
            subtitle="Decomp → Edges"
            blurb="Two-stage chain. Returns drivers + intermediates + outputs AND a causal DAG with formulas. Both Opus stages — typical cost $0.20–$0.60."
          />
          <PipelineOption
            value="decomposition"
            current={pipeline}
            onSelect={setPipeline}
            title="Decomposition only"
            subtitle="Single-stage"
            blurb="Just the node schema. Faster + cheaper but you add edges manually. Typical cost $0.10–$0.30."
          />
        </div>
      </fieldset>

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

      {pipeline === "full_pipeline" && (
        <div>
          <label
            htmlFor="focus_areas"
            className="block text-[10px] font-semibold uppercase tracking-wider text-neutral-400"
          >
            Focus areas{" "}
            <span className="text-neutral-600">(optional, one per line)</span>
          </label>
          <textarea
            id="focus_areas"
            name="focus_areas"
            rows={3}
            value={focusAreasRaw}
            onChange={(e) => setFocusAreasRaw(e.target.value)}
            placeholder={"launch cost trends 2015-2025\npanel efficiency floor for LEO\nbattery cycle life vs depth-of-discharge"}
            className="mt-1 w-full rounded border border-neutral-800 bg-neutral-950 px-3 py-2 text-sm text-neutral-100 placeholder:text-neutral-700 focus:border-cyan-700 focus:outline-none"
          />
          <p className="mt-1 text-[10px] text-neutral-600">
            Passed to the Research Agent as priorities. Up to 20.
          </p>
        </div>
      )}

      {error && (
        <p className="rounded border border-red-900/60 bg-red-950/40 p-2 text-[11px] text-red-300">
          {error}
        </p>
      )}

      <div className="flex items-center justify-between gap-3">
        <p className="text-[10px] text-neutral-600">
          {tooShort
            ? "Description is too short to submit."
            : "Submitting will route to /data-pipeline/agent-runs/[id] with live status."}
        </p>
        <button
          type="submit"
          disabled={tooShort || busy}
          className="rounded border border-rose-700 bg-rose-900/40 px-4 py-1.5 text-xs font-medium text-rose-200 hover:bg-rose-800/60 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {busy
            ? "Submitting…"
            : pipeline === "full_pipeline"
              ? "Run full pipeline"
              : pipeline === "propose_sector"
                ? "Run propose-sector"
                : "Run decomposition"}
        </button>
      </div>
    </form>
  );
}

function PipelineOption({
  value,
  current,
  onSelect,
  title,
  subtitle,
  blurb,
}: {
  value: Pipeline;
  current: Pipeline;
  onSelect: (p: Pipeline) => void;
  title: string;
  subtitle: string;
  blurb: string;
}) {
  const active = value === current;
  return (
    <label
      className={`flex cursor-pointer flex-col gap-1 rounded-lg border p-3 transition ${
        active
          ? "border-cyan-700 bg-cyan-950/40"
          : "border-neutral-800 bg-neutral-950/40 hover:border-neutral-700"
      }`}
    >
      <div className="flex items-baseline justify-between gap-2">
        <span
          className={`text-sm font-medium ${active ? "text-cyan-200" : "text-neutral-200"}`}
        >
          {title}
        </span>
        <input
          type="radio"
          name="pipeline"
          value={value}
          checked={active}
          onChange={() => onSelect(value)}
          className="accent-cyan-500"
        />
      </div>
      <span className="text-[10px] uppercase tracking-wider text-neutral-500">
        {subtitle}
      </span>
      <p className="text-[11px] leading-relaxed text-neutral-400">{blurb}</p>
    </label>
  );
}
