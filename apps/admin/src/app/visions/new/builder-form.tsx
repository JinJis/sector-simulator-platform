"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import {
  visionBuilderCommit,
  visionBuilderPropose,
  type VisionBuilderDraft,
  type VisionBuilderProposeResult,
  type VisionBuilderSignalConfig,
} from "@/lib/sim-client";

type Phase = "prompt" | "building" | "review" | "committing";

const STAGE_LABELS: Record<string, string> = {
  prompt_validator: "Stage 1 — Prompt Validator",
  vision_decomposition: "Stage 2 — Vision Decomposition",
  data_source_selector: "Stage 3 — Data Source Selector",
  validation_gate: "Stage 4 — Validation Gate",
};

// All four stages in fixed order so the progress UI can render
// "Waiting…" for unstarted ones even before the response arrives.
const STAGE_ORDER = [
  "prompt_validator",
  "vision_decomposition",
  "data_source_selector",
  "validation_gate",
] as const;

const EXAMPLES = [
  "Will commercial fusion power reach grid parity by 2040?",
  "By when will quantum computers break RSA-2048?",
  "Will direct-to-cell satellite voice + data be mass-market by 2030?",
  "Can solid-state batteries hit $50/kWh at scale by 2035?",
];

export function VisionBuilderForm() {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>("prompt");
  const [prompt, setPrompt] = useState("");
  const [researchBrief, setResearchBrief] = useState("");
  const [result, setResult] = useState<VisionBuilderProposeResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editedDraft, setEditedDraft] = useState<VisionBuilderDraft | null>(null);
  const [showResearch, setShowResearch] = useState(false);
  const buildStartRef = useRef<number | null>(null);
  const [buildElapsedSec, setBuildElapsedSec] = useState(0);

  // Tick the build-elapsed counter every 500ms while running. Synch
  // opus calls take 15-60s so the user needs feedback that it's alive.
  useEffect(() => {
    if (phase !== "building") return;
    buildStartRef.current = Date.now();
    setBuildElapsedSec(0);
    const t = setInterval(() => {
      if (buildStartRef.current !== null) {
        setBuildElapsedSec(Math.floor((Date.now() - buildStartRef.current) / 1000));
      }
    }, 500);
    return () => clearInterval(t);
  }, [phase]);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setResult(null);
    setEditedDraft(null);
    setPhase("building");
    try {
      const out = await visionBuilderPropose({
        prompt: prompt.trim(),
        research_brief: researchBrief.trim() || null,
      });
      setResult(out);
      setEditedDraft(out.draft);
      setPhase("review");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setPhase("prompt");
    }
  }

  async function handleCommit() {
    if (!editedDraft || !result) return;
    setError(null);
    setPhase("committing");
    try {
      const out = await visionBuilderCommit({
        draft: editedDraft,
        signal_config: result.signal_config,
      });
      router.push(`/sectors/${encodeURIComponent(out.slug)}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setPhase("review");
    }
  }

  function handleReset() {
    setPhase("prompt");
    setResult(null);
    setEditedDraft(null);
    setError(null);
  }

  const tooShort = prompt.trim().length < 15;
  const tooLong = prompt.length > 4000;

  return (
    <div className="mt-6 space-y-6">
      {phase === "prompt" && (
        <form
          onSubmit={handleSubmit}
          className="space-y-4 rounded-lg border border-neutral-800 bg-neutral-900/40 p-5"
        >
          <div>
            <label
              htmlFor="prompt"
              className="block text-[10px] font-semibold uppercase tracking-wider text-neutral-400"
            >
              Vision prompt{" "}
              <span className="text-neutral-600">(15–4000 chars)</span>
            </label>
            <textarea
              id="prompt"
              required
              rows={3}
              value={prompt}
              maxLength={4000}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="By when will commercial fusion reach grid parity?"
              className="mt-1 w-full rounded border border-neutral-800 bg-neutral-950 px-3 py-2 text-sm text-neutral-100 placeholder:text-neutral-700 focus:border-cyan-700 focus:outline-none"
            />
            <div className="mt-1 flex items-center justify-between">
              <p className="text-[10px] text-neutral-600">
                {EXAMPLES.map((ex, i) => (
                  <span key={ex}>
                    {i > 0 && <span className="px-1 text-neutral-700">·</span>}
                    <button
                      type="button"
                      onClick={() => setPrompt(ex)}
                      className="text-neutral-500 hover:text-cyan-300"
                    >
                      {ex.slice(0, 40)}{ex.length > 40 ? "…" : ""}
                    </button>
                  </span>
                ))}
              </p>
              <p
                className={`text-[10px] ${
                  tooLong ? "text-red-400" : "text-neutral-600"
                }`}
              >
                {prompt.length} / 4000
              </p>
            </div>
          </div>

          <div>
            <button
              type="button"
              onClick={() => setShowResearch((v) => !v)}
              className="text-[10px] uppercase tracking-wider text-neutral-500 hover:text-neutral-300"
            >
              {showResearch ? "▾" : "▸"} Optional research brief
            </button>
            {showResearch && (
              <textarea
                rows={5}
                value={researchBrief}
                maxLength={20_000}
                onChange={(e) => setResearchBrief(e.target.value)}
                placeholder="Paste a one-page research brief here to anchor the decomposition with current data. Optional but improves quality on novel domains."
                className="mt-2 w-full rounded border border-neutral-800 bg-neutral-950 px-3 py-2 text-xs text-neutral-100 placeholder:text-neutral-700 focus:border-cyan-700 focus:outline-none"
              />
            )}
          </div>

          {error && (
            <p className="rounded border border-red-900/60 bg-red-950/40 p-2 text-[11px] text-red-300">
              {error}
            </p>
          )}

          <div className="flex items-center justify-between gap-3">
            <p className="text-[10px] text-neutral-600">
              {tooShort
                ? "Prompt is too short to submit."
                : tooLong
                  ? "Prompt is too long."
                  : "Builds typically take 15–60 seconds. Cost ≤ $0.55."}
            </p>
            <button
              type="submit"
              disabled={tooShort || tooLong}
              className="rounded border border-cyan-700 bg-cyan-900/40 px-5 py-2 text-xs font-medium text-cyan-100 hover:bg-cyan-800/60 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Build vision →
            </button>
          </div>
        </form>
      )}

      {phase === "building" && (
        <BuildingPanel elapsedSec={buildElapsedSec} />
      )}

      {(phase === "review" || phase === "committing") && result && (
        <ReviewPanel
          result={result}
          editedDraft={editedDraft}
          onEditDraft={setEditedDraft}
          onCommit={handleCommit}
          onReset={handleReset}
          committing={phase === "committing"}
          error={error}
        />
      )}
    </div>
  );
}

// ====================================================================
// Building (synchronous "still alive" panel)
// ====================================================================

function BuildingPanel({ elapsedSec }: { elapsedSec: number }) {
  return (
    <div className="rounded-lg border border-cyan-900/60 bg-cyan-950/20 p-5">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold text-cyan-200">
          Building vision…
        </h2>
        <span className="font-mono text-[11px] text-cyan-400">
          {elapsedSec}s elapsed
        </span>
      </div>
      <p className="mt-1 text-[11px] text-cyan-400/80">
        Running validator → decomposition → data sources → gate. Don't
        close this tab.
      </p>
      <ol className="mt-4 space-y-2">
        {STAGE_ORDER.map((kind) => (
          <li
            key={kind}
            className="flex items-center gap-2 text-[12px] text-neutral-400"
          >
            <span className="animate-pulse text-cyan-400">●</span>
            {STAGE_LABELS[kind]}
          </li>
        ))}
      </ol>
    </div>
  );
}

// ====================================================================
// Review panel (rejection / gate failure / success)
// ====================================================================

function ReviewPanel({
  result,
  editedDraft,
  onEditDraft,
  onCommit,
  onReset,
  committing,
  error,
}: {
  result: VisionBuilderProposeResult;
  editedDraft: VisionBuilderDraft | null;
  onEditDraft: (d: VisionBuilderDraft) => void;
  onCommit: () => void;
  onReset: () => void;
  committing: boolean;
  error: string | null;
}) {
  const rejected = !result.validation.is_valid;
  const gateFailed = !rejected && result.gate?.ok === false;

  return (
    <div className="space-y-6">
      <StagesStrip stages={result.stages} totalCost={result.total_cost_usd} />

      {error && (
        <p className="rounded border border-red-900/60 bg-red-950/40 p-2 text-[11px] text-red-300">
          {error}
        </p>
      )}

      {rejected && (
        <RejectionPanel result={result} onReset={onReset} />
      )}

      {gateFailed && result.gate && (
        <GatePanel
          gate={result.gate}
          draft={editedDraft}
          onReset={onReset}
        />
      )}

      {!rejected && !gateFailed && result.gate?.ok && editedDraft && (
        <SuccessPanel
          draft={editedDraft}
          signalConfig={result.signal_config}
          warnings={result.gate.warnings}
          onEditDraft={onEditDraft}
          onCommit={onCommit}
          onReset={onReset}
          committing={committing}
        />
      )}
    </div>
  );
}

function StagesStrip({
  stages,
  totalCost,
}: {
  stages: VisionBuilderProposeResult["stages"];
  totalCost: number;
}) {
  return (
    <div className="overflow-x-auto rounded-lg border border-neutral-800">
      <table className="min-w-full text-[11px]">
        <thead>
          <tr className="border-b border-neutral-800 text-[10px] uppercase tracking-wider text-neutral-500">
            <th className="px-3 py-2 text-left">Stage</th>
            <th className="px-3 py-2 text-right">Duration</th>
            <th className="px-3 py-2 text-right">Cost (USD)</th>
          </tr>
        </thead>
        <tbody>
          {stages.map((s) => (
            <tr key={s.name} className="border-b border-neutral-900 last:border-0">
              <td className="px-3 py-1.5 text-neutral-300">
                {STAGE_LABELS[s.name] ?? s.name}
              </td>
              <td className="px-3 py-1.5 text-right font-mono text-neutral-400">
                {(s.duration_ms / 1000).toFixed(2)}s
              </td>
              <td className="px-3 py-1.5 text-right font-mono text-neutral-400">
                ${s.cost_usd.toFixed(4)}
              </td>
            </tr>
          ))}
          <tr className="bg-neutral-950">
            <td className="px-3 py-2 text-[10px] font-semibold uppercase tracking-wider text-cyan-400">
              Total
            </td>
            <td className="px-3 py-2"></td>
            <td className="px-3 py-2 text-right font-mono text-cyan-300">
              ${totalCost.toFixed(4)}
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

function RejectionPanel({
  result,
  onReset,
}: {
  result: VisionBuilderProposeResult;
  onReset: () => void;
}) {
  const v = result.validation;
  return (
    <div className="rounded-lg border border-amber-900/60 bg-amber-950/20 p-5">
      <h2 className="text-sm font-semibold text-amber-200">
        Prompt rejected — {v.rejection_kind}
      </h2>
      <p className="mt-1 text-[12px] text-amber-100/90">{v.rejection_reason}</p>
      {v.refined_question && (
        <div className="mt-4 rounded border border-amber-900/60 bg-amber-950/40 p-3">
          <p className="text-[10px] uppercase tracking-wider text-amber-400">
            Try this instead
          </p>
          <p className="mt-1 text-[13px] text-amber-100">{v.refined_question}</p>
        </div>
      )}
      <button
        type="button"
        onClick={onReset}
        className="mt-4 rounded border border-amber-700 bg-amber-900/40 px-3 py-1 text-[11px] text-amber-100 hover:bg-amber-800/60"
      >
        Try a different prompt
      </button>
    </div>
  );
}

function GatePanel({
  gate,
  draft,
  onReset,
}: {
  gate: NonNullable<VisionBuilderProposeResult["gate"]>;
  draft: VisionBuilderDraft | null;
  onReset: () => void;
}) {
  return (
    <div className="rounded-lg border border-red-900/60 bg-red-950/20 p-5">
      <h2 className="text-sm font-semibold text-red-200">
        Validation gate failed — commit blocked
      </h2>
      <p className="mt-1 text-[12px] text-red-100/80">
        The draft passed Pydantic but failed relational checks. Fix the
        prompt and re-run; the agent's raw output is preserved below
        for inspection.
      </p>
      <ul className="mt-3 list-disc space-y-1 pl-5 text-[12px] text-red-200">
        {gate.errors.map((e, i) => (
          <li key={i}>{e}</li>
        ))}
      </ul>
      {gate.warnings.length > 0 && (
        <ul className="mt-3 list-disc space-y-1 pl-5 text-[11px] text-amber-300">
          {gate.warnings.map((w, i) => (
            <li key={i}>{w}</li>
          ))}
        </ul>
      )}
      <button
        type="button"
        onClick={onReset}
        className="mt-4 rounded border border-red-700 bg-red-900/40 px-3 py-1 text-[11px] text-red-100 hover:bg-red-800/60"
      >
        Re-prompt
      </button>
      {draft && (
        <details className="mt-4">
          <summary className="cursor-pointer text-[11px] text-neutral-500 hover:text-neutral-300">
            Raw draft (debug)
          </summary>
          <pre className="mt-2 overflow-x-auto rounded border border-neutral-800 bg-neutral-950 p-3 text-[10px] text-neutral-400">
            {JSON.stringify(draft, null, 2)}
          </pre>
        </details>
      )}
    </div>
  );
}

// ====================================================================
// Success panel — draft review + commit
// ====================================================================

function SuccessPanel({
  draft,
  signalConfig,
  warnings,
  onEditDraft,
  onCommit,
  onReset,
  committing,
}: {
  draft: VisionBuilderDraft;
  signalConfig: VisionBuilderSignalConfig | null;
  warnings: string[];
  onEditDraft: (d: VisionBuilderDraft) => void;
  onCommit: () => void;
  onReset: () => void;
  committing: boolean;
}) {
  return (
    <div className="space-y-6">
      <div className="rounded-lg border border-emerald-900/60 bg-emerald-950/20 p-5">
        <div className="flex items-baseline justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold text-emerald-200">
              Draft ready — review and commit
            </h2>
            <p className="mt-1 text-[12px] text-emerald-100/80">
              Slug{" "}
              <span className="font-mono text-emerald-300">{draft.slug}</span>{" "}
              · {draft.capabilities.length} capabilities ·{" "}
              {draft.risks.length} risks · {draft.actors.length} actors
            </p>
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onReset}
              disabled={committing}
              className="rounded border border-neutral-700 px-3 py-1 text-[11px] text-neutral-300 hover:bg-neutral-900 disabled:opacity-50"
            >
              Discard
            </button>
            <button
              type="button"
              onClick={onCommit}
              disabled={committing}
              className="rounded border border-emerald-600 bg-emerald-800 px-4 py-1 text-[12px] font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
            >
              {committing ? "Committing…" : "Commit to DB →"}
            </button>
          </div>
        </div>

        {warnings.length > 0 && (
          <details className="mt-3" open>
            <summary className="cursor-pointer text-[11px] text-amber-300">
              {warnings.length} warning{warnings.length === 1 ? "" : "s"}{" "}
              (commit allowed)
            </summary>
            <ul className="mt-2 list-disc space-y-1 pl-5 text-[11px] text-amber-200">
              {warnings.map((w, i) => (
                <li key={i}>{w}</li>
              ))}
            </ul>
          </details>
        )}
      </div>

      <DraftOverview draft={draft} onEditDraft={onEditDraft} />

      <DraftCapabilities draft={draft} onEditDraft={onEditDraft} />

      <DraftRisks draft={draft} />

      <DraftActors draft={draft} />

      {signalConfig && <DraftSignalKeywords signalConfig={signalConfig} />}
    </div>
  );
}

function DraftOverview({
  draft,
  onEditDraft,
}: {
  draft: VisionBuilderDraft;
  onEditDraft: (d: VisionBuilderDraft) => void;
}) {
  return (
    <section className="rounded-lg border border-neutral-800 bg-neutral-900/40 p-5">
      <SectionHeader title="Overview" />
      <dl className="mt-3 grid grid-cols-1 gap-y-3 text-[12px] sm:grid-cols-3 sm:gap-x-6">
        <Field label="Slug" mono>
          {draft.slug}
        </Field>
        <Field label="Domain">{draft.domain_label}</Field>
        <Field label="Confidence">
          {(draft.confidence * 100).toFixed(0)}%
        </Field>
      </dl>
      <div className="mt-4">
        <label className="block text-[10px] font-semibold uppercase tracking-wider text-neutral-500">
          Name
        </label>
        <input
          value={draft.name}
          onChange={(e) => onEditDraft({ ...draft, name: e.target.value })}
          className="mt-1 w-full rounded border border-neutral-800 bg-neutral-950 px-3 py-1.5 text-sm text-neutral-100 focus:border-cyan-700 focus:outline-none"
        />
      </div>
      <div className="mt-3">
        <label className="block text-[10px] font-semibold uppercase tracking-wider text-neutral-500">
          Vision question
        </label>
        <input
          value={draft.vision_question}
          onChange={(e) =>
            onEditDraft({ ...draft, vision_question: e.target.value })
          }
          className="mt-1 w-full rounded border border-neutral-800 bg-neutral-950 px-3 py-1.5 text-sm text-neutral-100 focus:border-cyan-700 focus:outline-none"
        />
      </div>
      <div className="mt-3">
        <label className="block text-[10px] font-semibold uppercase tracking-wider text-neutral-500">
          Description
        </label>
        <textarea
          rows={3}
          value={draft.description}
          onChange={(e) =>
            onEditDraft({ ...draft, description: e.target.value })
          }
          className="mt-1 w-full rounded border border-neutral-800 bg-neutral-950 px-3 py-1.5 text-sm text-neutral-100 focus:border-cyan-700 focus:outline-none"
        />
      </div>
      <details className="mt-3">
        <summary className="cursor-pointer text-[11px] text-neutral-500 hover:text-neutral-300">
          Agent rationale
        </summary>
        <p className="mt-2 whitespace-pre-wrap rounded border border-neutral-800 bg-neutral-950 p-3 text-[11px] leading-relaxed text-neutral-400">
          {draft.rationale}
        </p>
      </details>
    </section>
  );
}

function DraftCapabilities({
  draft,
  onEditDraft,
}: {
  draft: VisionBuilderDraft;
  onEditDraft: (d: VisionBuilderDraft) => void;
}) {
  const weightSum = draft.capabilities.reduce((a, c) => a + c.weight, 0);
  return (
    <section className="rounded-lg border border-neutral-800 bg-neutral-900/40 p-5">
      <SectionHeader
        title={`Capabilities (${draft.capabilities.length})`}
        subtitle={`Weights sum to ${weightSum.toFixed(3)} · binding: ${draft.initial_feasibility.binding_capability_key}`}
      />
      <div className="mt-3 space-y-2">
        {draft.capabilities.map((c, idx) => {
          const isBinding =
            draft.initial_feasibility.binding_capability_key === c.key;
          return (
            <div
              key={c.key}
              className={`rounded border p-3 ${
                isBinding
                  ? "border-amber-900/60 bg-amber-950/20"
                  : "border-neutral-800 bg-neutral-950/40"
              }`}
            >
              <div className="flex items-baseline justify-between gap-3">
                <div className="flex items-baseline gap-2">
                  <span className="font-mono text-[11px] text-cyan-400">
                    {c.key}
                  </span>
                  <span className="text-sm text-neutral-200">{c.name}</span>
                  {isBinding && (
                    <span className="rounded border border-amber-700 px-1 py-0.5 text-[9px] uppercase tracking-wider text-amber-300">
                      Binding
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-2 text-[11px] text-neutral-400">
                  <label className="flex items-center gap-1">
                    weight
                    <input
                      type="number"
                      step={0.01}
                      min={0.02}
                      max={0.5}
                      value={c.weight}
                      onChange={(e) => {
                        const updated = [...draft.capabilities];
                        updated[idx] = { ...c, weight: Number(e.target.value) };
                        onEditDraft({ ...draft, capabilities: updated });
                      }}
                      className="w-16 rounded border border-neutral-800 bg-neutral-950 px-1.5 py-0.5 text-right font-mono text-[11px] text-neutral-200 focus:border-cyan-700 focus:outline-none"
                    />
                  </label>
                </div>
              </div>
              <p className="mt-1 text-[12px] text-neutral-300">{c.description}</p>
              <p className="mt-1 text-[11px] italic text-neutral-500">
                {c.rationale}
              </p>
              <div className="mt-2 flex flex-wrap gap-2 text-[10px] text-neutral-500">
                <ScoreChip label="T" value={c.initial_technical} />
                <ScoreChip label="E" value={c.initial_economic} />
                <ScoreChip label="R" value={c.initial_regulatory} />
                <ScoreChip label="S" value={c.initial_supply} />
                <span className="ml-auto">
                  confidence: {(c.confidence * 100).toFixed(0)}%
                </span>
              </div>
            </div>
          );
        })}
      </div>
      {draft.dependencies.length > 0 && (
        <details className="mt-4">
          <summary className="cursor-pointer text-[11px] text-neutral-500 hover:text-neutral-300">
            Dependencies ({draft.dependencies.length})
          </summary>
          <ul className="mt-2 space-y-1 text-[11px] text-neutral-400">
            {draft.dependencies.map((d, i) => (
              <li key={i} className="font-mono">
                <span className="text-cyan-400">{d.source_key}</span>
                <span className="px-1 text-neutral-600">→</span>
                <span className="text-cyan-400">{d.target_key}</span>
                <span className="ml-2 text-neutral-500">— {d.rationale}</span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}

function ScoreChip({ label, value }: { label: string; value: number | null | undefined }) {
  if (value == null) {
    return (
      <span className="rounded border border-neutral-800 px-1.5 py-0.5 text-neutral-600">
        {label}: —
      </span>
    );
  }
  return (
    <span className="rounded border border-neutral-800 px-1.5 py-0.5 font-mono">
      {label}: {value.toFixed(0)}
    </span>
  );
}

function DraftRisks({ draft }: { draft: VisionBuilderDraft }) {
  return (
    <section className="rounded-lg border border-neutral-800 bg-neutral-900/40 p-5">
      <SectionHeader title={`Risks (${draft.risks.length})`} />
      <ul className="mt-3 space-y-2">
        {draft.risks.map((r) => (
          <li
            key={r.key}
            className="rounded border border-neutral-800 bg-neutral-950/40 p-3"
          >
            <div className="flex items-baseline gap-2">
              <span className="rounded border border-neutral-700 px-1 py-0.5 text-[9px] uppercase tracking-wider text-neutral-400">
                {r.category}
              </span>
              <span className="text-sm text-neutral-200">{r.name}</span>
              <span
                className={`ml-auto text-[10px] ${severityColor(r.severity)}`}
              >
                {r.severity} · {r.likelihood} · {r.time_horizon}
              </span>
            </div>
            <p className="mt-1 text-[12px] text-neutral-300">{r.description}</p>
            {r.affected_capability_keys.length > 0 && (
              <p className="mt-1 text-[11px] text-neutral-500">
                affects:{" "}
                {r.affected_capability_keys.map((k) => (
                  <span key={k} className="font-mono text-cyan-400">
                    {k}{" "}
                  </span>
                ))}
              </p>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

function severityColor(sev: string): string {
  switch (sev) {
    case "critical":
      return "text-red-400";
    case "high":
      return "text-orange-400";
    case "medium":
      return "text-amber-400";
    default:
      return "text-neutral-400";
  }
}

function DraftActors({ draft }: { draft: VisionBuilderDraft }) {
  return (
    <section className="rounded-lg border border-neutral-800 bg-neutral-900/40 p-5">
      <SectionHeader
        title={`Actors (${draft.actors.length})`}
        subtitle="Will be UPSERTed by key — existing global actors are reused"
      />
      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        {draft.actors.map((a) => (
          <div
            key={a.key}
            className="rounded border border-neutral-800 bg-neutral-950/40 p-3"
          >
            <div className="flex items-baseline gap-2">
              <span className="font-mono text-[11px] text-cyan-400">
                {a.key}
              </span>
              <span className="text-sm text-neutral-200">{a.name}</span>
              <span className="ml-auto rounded border border-neutral-700 px-1 py-0.5 text-[9px] uppercase tracking-wider text-neutral-400">
                {a.iso_country}
              </span>
            </div>
            <p className="text-[10px] text-neutral-500">
              {a.category.replace(/_/g, " ")} · {a.stage} · relevance{" "}
              {a.relevance.toFixed(0)}
            </p>
            <p className="mt-1 text-[12px] text-neutral-300">{a.blurb}</p>
          </div>
        ))}
      </div>
      {draft.capability_actors.length > 0 && (
        <details className="mt-4">
          <summary className="cursor-pointer text-[11px] text-neutral-500 hover:text-neutral-300">
            Capability-actor assignments ({draft.capability_actors.length})
          </summary>
          <ul className="mt-2 space-y-1 text-[11px] text-neutral-400">
            {draft.capability_actors.map((ca, i) => (
              <li key={i} className="font-mono">
                <span className="text-cyan-400">{ca.capability_key}</span>
                <span className="px-1 text-neutral-600">←</span>
                <span className="text-cyan-400">{ca.actor_key}</span>
                <span className="ml-2 rounded border border-neutral-800 px-1 text-[9px] uppercase tracking-wider text-neutral-500">
                  {ca.role}
                </span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}

function DraftSignalKeywords({
  signalConfig,
}: {
  signalConfig: VisionBuilderSignalConfig;
}) {
  return (
    <section className="rounded-lg border border-neutral-800 bg-neutral-900/40 p-5">
      <SectionHeader
        title="Signal keywords"
        subtitle="Per-capability keyword sets the M39 ingest cron will use"
      />
      <ul className="mt-3 space-y-2 text-[11px]">
        {signalConfig.keywords_by_capability.map((kws) => (
          <li
            key={kws.capability_key}
            className="rounded border border-neutral-800 bg-neutral-950/40 p-3"
          >
            <p className="font-mono text-cyan-400">{kws.capability_key}</p>
            <KeywordList label="arXiv" items={kws.arxiv_keywords} />
            <KeywordList label="USPTO" items={kws.uspto_keywords} />
            <KeywordList label="News" items={kws.news_keywords} />
          </li>
        ))}
      </ul>
    </section>
  );
}

function KeywordList({ label, items }: { label: string; items: string[] }) {
  if (items.length === 0) return null;
  return (
    <p className="mt-1 text-neutral-400">
      <span className="text-[9px] uppercase tracking-wider text-neutral-600">
        {label}:{" "}
      </span>
      {items.map((k, i) => (
        <span key={k}>
          {i > 0 && <span className="text-neutral-700">, </span>}
          <span className="text-neutral-300">{k}</span>
        </span>
      ))}
    </p>
  );
}

function SectionHeader({
  title,
  subtitle,
}: {
  title: string;
  subtitle?: string;
}) {
  return (
    <div>
      <h2 className="text-sm font-semibold text-neutral-200">{title}</h2>
      {subtitle && (
        <p className="mt-0.5 text-[11px] text-neutral-500">{subtitle}</p>
      )}
    </div>
  );
}

function Field({
  label,
  children,
  mono,
}: {
  label: string;
  children: React.ReactNode;
  mono?: boolean;
}) {
  return (
    <div>
      <dt className="text-[10px] font-semibold uppercase tracking-wider text-neutral-500">
        {label}
      </dt>
      <dd
        className={`mt-0.5 text-neutral-200 ${
          mono ? "font-mono text-[11px]" : ""
        }`}
      >
        {children}
      </dd>
    </div>
  );
}
