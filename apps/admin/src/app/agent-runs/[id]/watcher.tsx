"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  cancelAgentWorkflow,
  getAgentWorkflow,
  type AgentCodeGenResult,
  type AgentCodeReviewResult,
  type AgentDecomposition,
  type AgentDriverInferenceResult,
  type AgentEdgeInference,
  type AgentResearchBrief,
  type AgentWorkflow,
} from "@/lib/sim-client";

import { StatusPill } from "../status-pill";
import { PromoteToDraftButton } from "./promote-button";

interface Props {
  id: string;
  initial: AgentWorkflow;
}

const TERMINAL_STATUSES = new Set(["succeeded", "failed", "cancelled"]);

/**
 * Server hydrated with the initial record; client polls until the
 * status is terminal. Poll cadence is 1.5s — workflows are typically
 * 5–20s end-to-end, so this samples ~5–15x without burning the server.
 */
export function RunWatcher({ id, initial }: Props) {
  const [record, setRecord] = useState<AgentWorkflow>(initial);
  const [cancelBusy, setCancelBusy] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const poll = useCallback(async () => {
    try {
      const next = await getAgentWorkflow(id);
      setRecord(next);
    } catch {
      // Transient — try again on the next tick. A persistent failure
      // surfaces as a stale "running" badge, which is a clear-enough
      // signal that something's wrong.
    }
  }, [id]);

  useEffect(() => {
    if (TERMINAL_STATUSES.has(record.status)) return;
    timer.current = setTimeout(poll, 1500);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [record.status, poll]);

  async function handleCancel() {
    if (!confirm("Cancel this workflow? In-flight LLM calls won't be aborted, but the result is discarded.")) {
      return;
    }
    setCancelBusy(true);
    try {
      const next = await cancelAgentWorkflow(id);
      setRecord(next);
    } catch (e) {
      alert(e instanceof Error ? e.message : String(e));
    } finally {
      setCancelBusy(false);
    }
  }

  const { decomp, edges, research, driverInference, codeGen, codeReview } =
    useMemo(() => extractResult(record), [record]);
  const inputDescription = String(
    (record.input as { description?: string }).description ?? "",
  );

  return (
    <>
      <header className="mb-6 flex flex-wrap items-baseline gap-3">
        <h1 className="text-xl font-semibold text-neutral-50">Agent run</h1>
        <StatusPill status={record.status} />
        <span className="rounded-full border border-neutral-700 bg-neutral-900 px-2.5 py-0.5 text-[10px] font-medium text-neutral-400">
          {record.kind}
        </span>
        <span className="font-mono text-[10px] text-neutral-600">{record.id}</span>
        <span className="ml-auto flex items-center gap-3 text-[11px] text-neutral-500">
          <span className="tabular-nums">${record.cost_usd.toFixed(4)}</span>
          <span>{String(record.updated_at).slice(0, 19).replace("T", " ")}</span>
          {!TERMINAL_STATUSES.has(record.status) && (
            <button
              onClick={handleCancel}
              disabled={cancelBusy}
              className="rounded border border-amber-700/60 bg-amber-950/40 px-2 py-0.5 text-[10px] text-amber-200 hover:bg-amber-900/60 disabled:opacity-50"
            >
              {cancelBusy ? "cancelling…" : "cancel"}
            </button>
          )}
        </span>
      </header>

      <section className="mb-6 rounded-lg border border-neutral-800 bg-neutral-900/30 p-4">
        <h2 className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-neutral-500">
          Input
        </h2>
        <p className="whitespace-pre-wrap text-sm leading-relaxed text-neutral-300">
          {inputDescription || <em className="text-neutral-600">(empty)</em>}
        </p>
      </section>

      {record.error && (
        <section className="mb-6 rounded-lg border border-red-900/60 bg-red-950/40 p-4 text-sm text-red-200">
          <h2 className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-red-300">
            Error
          </h2>
          <pre className="whitespace-pre-wrap font-mono text-[12px]">
            {record.error}
          </pre>
        </section>
      )}

      {record.status === "succeeded" && (
        <>
          {research && <ResearchBriefSection brief={research} />}
          {decomp && <DecompositionResult decomp={decomp} />}
          {driverInference && (
            <DriverInferenceSection result={driverInference} />
          )}
          {edges && <EdgeInferenceSection edges={edges} />}
          {codeReview && <CodeReviewSection result={codeReview} />}
          {codeGen && <CodeGenSection result={codeGen} />}
          {decomp && (
            <div className="mt-6">
              <PromoteToDraftButton
                workflowId={record.id}
                decomp={decomp}
                edgeCount={edges?.edges.length ?? 0}
              />
              {codeReview && codeReview.status !== "approve" && (
                <p className="mt-2 text-[10px] text-amber-400">
                  Code review status:{" "}
                  <span className="font-semibold uppercase">
                    {codeReview.status}
                  </span>{" "}
                  — review findings before promoting. The generated source is
                  for review only and is NOT executed by this orchestrator
                  (Modal sandbox is a future slice).
                </p>
              )}
            </div>
          )}
        </>
      )}

      {!TERMINAL_STATUSES.has(record.status) && (
        <section className="rounded-lg border border-cyan-900/60 bg-cyan-950/30 p-4 text-sm text-cyan-200">
          <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-cyan-400" />{" "}
          Agent is working. This page polls every 1.5 seconds.
        </section>
      )}
    </>
  );
}

interface ExtractedResult {
  decomp: AgentDecomposition | null;
  edges: AgentEdgeInference | null;
  research: AgentResearchBrief | null;
  driverInference: AgentDriverInferenceResult | null;
  codeGen: AgentCodeGenResult | null;
  codeReview: AgentCodeReviewResult | null;
}

const EMPTY_RESULT: ExtractedResult = {
  decomp: null,
  edges: null,
  research: null,
  driverInference: null,
  codeGen: null,
  codeReview: null,
};

function extractResult(record: AgentWorkflow): ExtractedResult {
  if (record.status !== "succeeded") return EMPTY_RESULT;
  const out = record.output;
  if (!out || typeof out !== "object") return EMPTY_RESULT;
  if (record.kind === "decomposition") {
    return { ...EMPTY_RESULT, decomp: out as unknown as AgentDecomposition };
  }
  if (record.kind === "propose_sector") {
    const composite = out as unknown as {
      decomposition?: AgentDecomposition;
      edge_inference?: AgentEdgeInference;
    };
    return {
      ...EMPTY_RESULT,
      decomp: composite.decomposition ?? null,
      edges: composite.edge_inference ?? null,
    };
  }
  if (record.kind === "research") {
    return { ...EMPTY_RESULT, research: out as unknown as AgentResearchBrief };
  }
  if (record.kind === "driver_inference") {
    return {
      ...EMPTY_RESULT,
      driverInference: out as unknown as AgentDriverInferenceResult,
    };
  }
  if (record.kind === "edge_inference") {
    return { ...EMPTY_RESULT, edges: out as unknown as AgentEdgeInference };
  }
  if (record.kind === "code_gen") {
    return { ...EMPTY_RESULT, codeGen: out as unknown as AgentCodeGenResult };
  }
  if (record.kind === "code_review") {
    return {
      ...EMPTY_RESULT,
      codeReview: out as unknown as AgentCodeReviewResult,
    };
  }
  if (record.kind === "full_pipeline") {
    const composite = out as unknown as {
      research?: AgentResearchBrief;
      decomposition?: AgentDecomposition;
      driver_inference?: AgentDriverInferenceResult;
      edge_inference?: AgentEdgeInference;
      code_gen?: AgentCodeGenResult;
      code_review?: AgentCodeReviewResult;
    };
    return {
      research: composite.research ?? null,
      decomp: composite.decomposition ?? null,
      driverInference: composite.driver_inference ?? null,
      edges: composite.edge_inference ?? null,
      codeGen: composite.code_gen ?? null,
      codeReview: composite.code_review ?? null,
    };
  }
  return EMPTY_RESULT;
}

function ResearchBriefSection({ brief }: { brief: AgentResearchBrief }) {
  return (
    <section className="mb-6 rounded-lg border border-violet-900/60 bg-violet-950/20 p-4">
      <h3 className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-violet-300">
        Research brief ({brief.anchors.length} anchors)
      </h3>
      <p className="text-sm leading-relaxed text-violet-100/80">
        {brief.summary}
      </p>
      {brief.anchors.length > 0 && (
        <ul className="mt-3 space-y-2 text-[11px]">
          {brief.anchors.map((a, i) => (
            <li
              key={i}
              className="rounded border border-violet-900/40 bg-neutral-950/50 p-2"
            >
              <div className="flex flex-wrap items-baseline gap-2">
                <span className="font-medium text-violet-200">{a.concept}</span>
                <span className="font-mono text-neutral-200">
                  {a.value_range}
                </span>
                <span className="text-[10px] text-neutral-500">
                  as of {a.as_of}
                </span>
              </div>
              {a.sources.length > 0 && (
                <ul className="mt-1 space-y-0.5 text-[10px] text-neutral-400">
                  {a.sources.map((s, j) => (
                    <li key={j}>
                      <span className="mr-1 rounded bg-neutral-800 px-1 py-px text-[9px] uppercase tracking-wider text-neutral-300">
                        {s.kind}
                      </span>
                      <span className="text-neutral-300">{s.title}</span>
                      {s.excerpt && (
                        <span className="text-neutral-500"> — {s.excerpt}</span>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ul>
      )}
      {brief.open_questions.length > 0 && (
        <div className="mt-3">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-amber-400">
            Open questions
          </p>
          <ul className="mt-1 space-y-0.5 text-[11px] text-amber-200">
            {brief.open_questions.map((q, i) => (
              <li key={i}>· {q}</li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

function DriverInferenceSection({
  result,
}: {
  result: AgentDriverInferenceResult;
}) {
  return (
    <section className="mt-6 space-y-3">
      <h3 className="text-[10px] font-semibold uppercase tracking-wider text-neutral-400">
        Calibrated drivers ({result.drivers.length}) — provenance + history
      </h3>
      <div className="space-y-2 rounded border border-neutral-800 bg-neutral-900/30 p-3">
        {result.drivers.map((d) => (
          <details
            key={d.name}
            className="rounded border border-neutral-800/60 bg-neutral-950/40 p-2 text-[11px]"
          >
            <summary className="cursor-pointer">
              <span className="font-mono text-cyan-300">{d.name}</span>
              <span className="text-neutral-500"> = </span>
              <span className="font-mono tabular-nums text-neutral-100">
                {d.default}
              </span>
              <span className="text-neutral-500">
                {" "}
                ({d.unit}, range [{d.min}, {d.max}])
              </span>
              <span className="ml-2 text-[10px] text-neutral-500">
                {d.history.length} hist · {d.sources.length} src
              </span>
            </summary>
            <div className="mt-2 space-y-1 pl-3 text-neutral-300">
              <p>{d.description}</p>
              {d.note && (
                <p className="text-[10px] italic text-neutral-500">
                  note: {d.note}
                </p>
              )}
              {d.history.length > 0 && (
                <p className="text-[10px] text-neutral-500">
                  history:{" "}
                  {d.history.map((h) => `${h.date}=${h.value}`).join(", ")}
                </p>
              )}
              {d.sources.length > 0 && (
                <ul className="space-y-0.5 text-[10px]">
                  {d.sources.map((s, i) => (
                    <li key={i}>
                      <span className="mr-1 rounded bg-neutral-800 px-1 py-px text-[9px] uppercase tracking-wider text-neutral-300">
                        {s.kind}
                      </span>
                      <span className="text-neutral-300">{s.title}</span>
                      {s.excerpt && (
                        <span className="text-neutral-500">
                          {" "}
                          — {s.excerpt}
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </details>
        ))}
      </div>
      {result.unresolved.length > 0 && (
        <div className="rounded border border-amber-900/40 bg-amber-950/20 p-2 text-[10px] text-amber-200">
          <span className="font-semibold uppercase tracking-wider">
            Unresolved drivers ({result.unresolved.length})
          </span>
          <span className="ml-2">— {result.unresolved.join(", ")}</span>
        </div>
      )}
    </section>
  );
}

function CodeGenSection({ result }: { result: AgentCodeGenResult }) {
  function copySource() {
    navigator.clipboard?.writeText(result.source).catch(() => {});
  }
  function downloadSource() {
    const blob = new Blob([result.source], { type: "text/x-python" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${result.module_name}.py`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }
  return (
    <section className="mt-6 space-y-3">
      <div className="flex flex-wrap items-baseline gap-3">
        <h3 className="text-[10px] font-semibold uppercase tracking-wider text-neutral-400">
          Generated source ({result.source.split("\n").length} lines)
        </h3>
        <span className="text-[10px] text-neutral-600">
          {result.module_name}.py · class {result.class_name}
        </span>
        <button
          onClick={copySource}
          className="ml-auto rounded border border-neutral-700 bg-neutral-900 px-2 py-0.5 text-[10px] text-neutral-300 hover:bg-neutral-800"
        >
          Copy
        </button>
        <button
          onClick={downloadSource}
          className="rounded border border-neutral-700 bg-neutral-900 px-2 py-0.5 text-[10px] text-neutral-300 hover:bg-neutral-800"
        >
          Download .py
        </button>
      </div>
      <pre className="max-h-96 overflow-auto rounded border border-neutral-800 bg-neutral-950 p-3 text-[10px] leading-relaxed text-neutral-200">
        <code className="font-mono">{result.source}</code>
      </pre>
      {result.concerns.length > 0 && (
        <div className="rounded border border-amber-900/40 bg-amber-950/20 p-2 text-[10px] text-amber-200">
          <p className="font-semibold uppercase tracking-wider">
            Self-reported concerns ({result.concerns.length})
          </p>
          <ul className="mt-1 space-y-0.5">
            {result.concerns.map((c, i) => (
              <li key={i}>· {c}</li>
            ))}
          </ul>
        </div>
      )}
      <p className="rounded border border-rose-900/40 bg-rose-950/20 p-2 text-[10px] text-rose-200">
        🔒 Security: generated source is shown for review only. It is NOT
        executed by the orchestrator — Modal sandbox is a future slice.
      </p>
    </section>
  );
}

function CodeReviewSection({ result }: { result: AgentCodeReviewResult }) {
  const tone =
    result.status === "approve"
      ? {
          border: "border-emerald-900/60",
          bg: "bg-emerald-950/30",
          text: "text-emerald-200",
        }
      : result.status === "revise"
        ? {
            border: "border-amber-900/60",
            bg: "bg-amber-950/30",
            text: "text-amber-200",
          }
        : {
            border: "border-rose-900/60",
            bg: "bg-rose-950/30",
            text: "text-rose-200",
          };
  const counts: Record<string, number> = {
    blocker: 0,
    major: 0,
    minor: 0,
    nit: 0,
  };
  for (const f of result.findings) counts[f.severity] = (counts[f.severity] ?? 0) + 1;
  return (
    <section
      className={`mt-6 rounded-lg border ${tone.border} ${tone.bg} p-4 space-y-3`}
    >
      <div className="flex flex-wrap items-baseline gap-3">
        <h3
          className={`text-[10px] font-semibold uppercase tracking-wider ${tone.text}`}
        >
          Code review · {result.status}
        </h3>
        <span className="text-[10px] text-neutral-500">
          blocker {counts.blocker} · major {counts.major} · minor {counts.minor}{" "}
          · nit {counts.nit}
        </span>
      </div>
      <p className={`text-sm leading-relaxed ${tone.text}`}>{result.summary}</p>
      {result.findings.length > 0 && (
        <ul className="space-y-1.5 text-[11px]">
          {result.findings.map((f, i) => (
            <li
              key={i}
              className="rounded border border-neutral-800 bg-neutral-950/40 p-2"
            >
              <div className="flex flex-wrap items-baseline gap-2">
                <span
                  className={`rounded px-1.5 py-px text-[9px] font-medium uppercase tracking-wider ${
                    f.severity === "blocker"
                      ? "bg-rose-900/60 text-rose-100"
                      : f.severity === "major"
                        ? "bg-amber-900/60 text-amber-100"
                        : f.severity === "minor"
                          ? "bg-neutral-800 text-neutral-300"
                          : "bg-neutral-900 text-neutral-500"
                  }`}
                >
                  {f.severity}
                </span>
                <span className="text-[10px] uppercase tracking-wider text-neutral-500">
                  {f.category}
                </span>
                <span className="font-mono text-[10px] text-cyan-300">
                  {f.location}
                </span>
              </div>
              <p className="mt-1 text-neutral-200">{f.message}</p>
              {f.suggestion && (
                <p className="mt-0.5 text-[10px] text-neutral-400">
                  💡 {f.suggestion}
                </p>
              )}
            </li>
          ))}
        </ul>
      )}
      {(result.rerun_inputs.rerun.length > 0 ||
        result.rerun_inputs.preserve.length > 0) && (
        <p className="text-[10px] text-neutral-500">
          {result.rerun_inputs.rerun.length > 0 && (
            <>rerun: {result.rerun_inputs.rerun.join(", ")}</>
          )}
          {result.rerun_inputs.preserve.length > 0 && (
            <>
              {result.rerun_inputs.rerun.length > 0 && " · "}preserve:{" "}
              {result.rerun_inputs.preserve.join(", ")}
            </>
          )}
        </p>
      )}
    </section>
  );
}

function EdgeInferenceSection({ edges }: { edges: AgentEdgeInference }) {
  return (
    <section className="mt-6 space-y-4">
      <div>
        <h3 className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-neutral-400">
          Causal edges ({edges.edges.length})
        </h3>
        <div className="overflow-hidden rounded border border-neutral-800">
          <table className="w-full text-[11px]">
            <thead className="bg-neutral-900/60 text-left text-[9px] uppercase tracking-wider text-neutral-500">
              <tr>
                <th className="px-3 py-1.5 font-medium">Source</th>
                <th className="px-3 py-1.5 font-medium">Target</th>
                <th className="px-3 py-1.5 font-medium">Label</th>
              </tr>
            </thead>
            <tbody className="text-neutral-200">
              {edges.edges.map((e, i) => (
                <tr key={i} className="border-t border-neutral-800/60">
                  <td className="px-3 py-1.5 font-mono text-[10px] text-cyan-300">
                    {e.source}
                  </td>
                  <td className="px-3 py-1.5 font-mono text-[10px] text-amber-300">
                    {e.target}
                  </td>
                  <td className="px-3 py-1.5 text-neutral-400">
                    {e.label || <em className="text-neutral-600">(no label)</em>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {edges.intermediates.length > 0 && (
        <div>
          <h3 className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-neutral-400">
            Intermediate formulas ({edges.intermediates.length})
          </h3>
          <ul className="space-y-1.5 rounded border border-neutral-800 bg-neutral-900/30 p-3 text-[11px]">
            {edges.intermediates.map((i) => (
              <li key={i.name}>
                <span className="font-mono text-cyan-300">{i.name}</span>
                <span className="text-neutral-600"> = </span>
                <code className="font-mono text-neutral-200">{i.formula}</code>
                {i.unit && (
                  <span className="ml-1 text-[10px] text-neutral-600">[{i.unit}]</span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {edges.outputs.length > 0 && (
        <div>
          <h3 className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-neutral-400">
            Output formulas ({edges.outputs.length})
          </h3>
          <ul className="space-y-1.5 rounded border border-neutral-800 bg-neutral-900/30 p-3 text-[11px]">
            {edges.outputs.map((o) => (
              <li key={o.name}>
                <span className="font-mono text-amber-300">{o.name}</span>
                <span className="text-neutral-600"> = </span>
                <code className="font-mono text-neutral-200">{o.formula}</code>
              </li>
            ))}
          </ul>
        </div>
      )}

      {edges.assumptions.length > 0 && (
        <div>
          <h3 className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-amber-400">
            Assumptions ({edges.assumptions.length})
          </h3>
          <ul className="space-y-1 rounded border border-amber-900/40 bg-amber-950/20 p-3 text-[11px] text-amber-200">
            {edges.assumptions.map((a, i) => (
              <li key={i}>· {a}</li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

function DecompositionResult({ decomp }: { decomp: AgentDecomposition }) {
  const groupedDrivers = groupBy(decomp.drivers, (d) => d.group || "Other");
  const groupNames = [...groupedDrivers.keys()];
  return (
    <section className="space-y-6">
      <div className="rounded-lg border border-emerald-900/60 bg-emerald-950/30 p-4">
        <div className="flex items-baseline justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-emerald-200">
              {decomp.name}
            </h2>
            <p className="mt-0.5 text-[10px] text-emerald-400">
              slug: <code className="font-mono">{decomp.slug}</code> · horizon{" "}
              {decomp.horizon_years} yr · {decomp.drivers.length} drivers ·{" "}
              {decomp.outputs.length} outputs
            </p>
          </div>
        </div>
        <p className="mt-2 text-sm leading-relaxed text-emerald-100/80">
          {decomp.description}
        </p>
      </div>

      <div>
        <h3 className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-neutral-400">
          Drivers ({decomp.drivers.length})
        </h3>
        <div className="space-y-3">
          {groupNames.map((group) => (
            <div
              key={group}
              className="rounded border border-neutral-800 bg-neutral-900/30"
            >
              <div className="border-b border-neutral-800 px-3 py-1.5 text-[10px] uppercase tracking-wider text-cyan-400">
                {group}
                <span className="ml-2 text-neutral-600">
                  {(groupedDrivers.get(group) ?? []).length} driver
                  {(groupedDrivers.get(group) ?? []).length === 1 ? "" : "s"}
                </span>
              </div>
              <table className="w-full text-[11px]">
                <thead>
                  <tr className="text-left text-[9px] uppercase tracking-wider text-neutral-500">
                    <th className="px-3 py-1.5 font-medium">Name</th>
                    <th className="px-3 py-1.5 font-medium">Default</th>
                    <th className="px-3 py-1.5 font-medium">Range</th>
                    <th className="px-3 py-1.5 font-medium">Description</th>
                  </tr>
                </thead>
                <tbody className="text-neutral-200">
                  {(groupedDrivers.get(group) ?? []).map((d) => (
                    <tr key={d.name} className="border-t border-neutral-800/60">
                      <td className="px-3 py-1.5 font-mono text-[10px] text-neutral-300">
                        {d.name}
                      </td>
                      <td className="px-3 py-1.5 tabular-nums">
                        {d.default}{" "}
                        <span className="text-neutral-600">{d.unit}</span>
                      </td>
                      <td className="px-3 py-1.5 tabular-nums text-neutral-500">
                        {d.min} – {d.max}
                      </td>
                      <td className="px-3 py-1.5 text-neutral-500">
                        {d.description}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
        </div>
      </div>

      {decomp.intermediates.length > 0 && (
        <div>
          <h3 className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-neutral-400">
            Intermediates ({decomp.intermediates.length})
          </h3>
          <ul className="space-y-1.5 rounded border border-neutral-800 bg-neutral-900/30 p-3 text-[11px]">
            {decomp.intermediates.map((i) => (
              <li key={i.name}>
                <span className="font-mono text-neutral-300">{i.name}</span>{" "}
                <span className="text-neutral-600">{i.unit && `(${i.unit})`}</span>
                <span className="text-neutral-500"> — {i.description}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div>
        <h3 className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-neutral-400">
          Outputs ({decomp.outputs.length})
        </h3>
        <table className="w-full rounded border border-neutral-800 text-[11px]">
          <thead>
            <tr className="bg-neutral-900/60 text-left text-[9px] uppercase tracking-wider text-neutral-500">
              <th className="px-3 py-1.5 font-medium">Name</th>
              <th className="px-3 py-1.5 font-medium">Kind</th>
              <th className="px-3 py-1.5 font-medium">Unit</th>
              <th className="px-3 py-1.5 font-medium">Description</th>
            </tr>
          </thead>
          <tbody className="text-neutral-200">
            {decomp.outputs.map((o) => (
              <tr key={o.name} className="border-t border-neutral-800/60">
                <td className="px-3 py-1.5 font-mono text-[10px]">{o.name}</td>
                <td className="px-3 py-1.5 text-neutral-400">{o.kind}</td>
                <td className="px-3 py-1.5 text-neutral-500">{o.unit}</td>
                <td className="px-3 py-1.5 text-neutral-500">{o.description}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="rounded border border-neutral-800 bg-neutral-900/40 p-3 text-[11px] text-neutral-400">
        아래 버튼으로 draft sector로 등록할 수 있습니다. Draft는 graph_nodes를 채워 admin에서
        검토할 수 있지만, Python sim이 작성되어 활성화(activate)되기 전까지는 user app에
        노출되지 않습니다.
      </p>
    </section>
  );
}

function groupBy<T, K>(items: T[], keyFn: (t: T) => K): Map<K, T[]> {
  const m = new Map<K, T[]>();
  for (const it of items) {
    const k = keyFn(it);
    const arr = m.get(k);
    if (arr) arr.push(it);
    else m.set(k, [it]);
  }
  return m;
}
