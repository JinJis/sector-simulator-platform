"use client";

/**
 * Graph editor side panel — slides in from the right when the user
 * clicks an edge or node on `/sectors/[slug]/graph`. Closes on the X
 * button or escape key.
 *
 * Two modes:
 *
 *   - Edge selected: weight slider [-2.0, +2.0], magnitude select,
 *     label text, delete button. Slider commits on `onMouseUp` so
 *     a single drag doesn't fire 100 mutations.
 *   - Node selected: read-only details (label / kind / group / unit /
 *     description). For equity nodes, also surfaces ticker + a link
 *     to the equities tab.
 *
 * The parent (`GraphView`) owns the canonical graph state — this
 * panel just calls back via `onCommit` / `onDelete` so the parent
 * can update optimistically + invalidate downstream queries.
 */

import { useEffect, useState } from "react";

import type { DbGraphEdge, DbGraphNode } from "@/lib/sim-client";

export type SidePanelSelection =
  | { kind: "edge"; edge: DbGraphEdge }
  | { kind: "node"; node: DbGraphNode }
  | null;

interface Props {
  selection: SidePanelSelection;
  onClose: () => void;
  onCommitEdge: (e: {
    source_key: string;
    target_key: string;
    weight: number;
    magnitude: "low" | "med" | "high";
    label?: string | null;
  }) => Promise<void>;
  onDeleteEdge: (e: { source_key: string; target_key: string }) => Promise<void>;
  /** Map of node_key → label, so the edge editor can show "A → B" not
   *  "raw_key → raw_key". */
  nodeLabels: Record<string, string>;
}

export function GraphSidePanel({
  selection,
  onClose,
  onCommitEdge,
  onDeleteEdge,
  nodeLabels,
}: Props) {
  // Close on Escape.
  useEffect(() => {
    if (!selection) return;
    const fn = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", fn);
    return () => window.removeEventListener("keydown", fn);
  }, [selection, onClose]);

  if (!selection) return null;

  return (
    <aside
      className="absolute right-3 top-3 z-10 w-[320px] rounded-lg border border-neutral-800 bg-neutral-950/95 shadow-xl backdrop-blur"
      role="dialog"
      aria-label={selection.kind === "edge" ? "Edge editor" : "Node details"}
    >
      <header className="flex items-center justify-between border-b border-neutral-800 px-3 py-2">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-neutral-500">
          {selection.kind === "edge" ? "Edge" : "Node"}
        </span>
        <button
          type="button"
          onClick={onClose}
          className="text-neutral-500 hover:text-neutral-200"
          aria-label="Close"
        >
          ✕
        </button>
      </header>
      <div className="p-3">
        {selection.kind === "edge" ? (
          <EdgePanelBody
            edge={selection.edge}
            nodeLabels={nodeLabels}
            onCommit={onCommitEdge}
            onDelete={onDeleteEdge}
          />
        ) : (
          <NodePanelBody node={selection.node} />
        )}
      </div>
    </aside>
  );
}

// ---------- Edge panel ----------

function EdgePanelBody({
  edge,
  nodeLabels,
  onCommit,
  onDelete,
}: {
  edge: DbGraphEdge;
  nodeLabels: Record<string, string>;
  onCommit: (e: {
    source_key: string;
    target_key: string;
    weight: number;
    magnitude: "low" | "med" | "high";
    label?: string | null;
  }) => Promise<void>;
  onDelete: (e: { source_key: string; target_key: string }) => Promise<void>;
}) {
  // Local state lets the slider feel snappy without committing until
  // mouseup. Reset to the prop value when the user clicks a different
  // edge (key change).
  const [weight, setWeight] = useState(edge.weight);
  const [magnitude, setMagnitude] = useState<"low" | "med" | "high">(
    (edge.magnitude as "low" | "med" | "high") ?? "med",
  );
  const [label, setLabel] = useState(edge.label ?? "");
  const [status, setStatus] = useState<"idle" | "saving" | "error">("idle");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    setWeight(edge.weight);
    setMagnitude((edge.magnitude as "low" | "med" | "high") ?? "med");
    setLabel(edge.label ?? "");
    setStatus("idle");
    setErrorMsg(null);
  }, [edge.id]);

  const sourceLabel = nodeLabels[edge.source_key] ?? edge.source_key;
  const targetLabel = nodeLabels[edge.target_key] ?? edge.target_key;

  const commit = async (next: {
    weight?: number;
    magnitude?: "low" | "med" | "high";
    label?: string | null;
  }) => {
    setStatus("saving");
    setErrorMsg(null);
    try {
      await onCommit({
        source_key: edge.source_key,
        target_key: edge.target_key,
        weight: next.weight ?? weight,
        magnitude: next.magnitude ?? magnitude,
        label: next.label !== undefined ? next.label : label || null,
      });
      setStatus("idle");
    } catch (e) {
      setStatus("error");
      setErrorMsg(e instanceof Error ? e.message : String(e));
    }
  };

  const handleDelete = async () => {
    if (!confirm(`Delete edge ${sourceLabel} → ${targetLabel}?`)) return;
    setStatus("saving");
    setErrorMsg(null);
    try {
      await onDelete({ source_key: edge.source_key, target_key: edge.target_key });
      setStatus("idle");
    } catch (e) {
      setStatus("error");
      setErrorMsg(e instanceof Error ? e.message : String(e));
    }
  };

  // Weight color cue: green when amplifying (>1), red when inverse (<0),
  // amber when dampening (0..1), neutral at 1.0.
  let weightChip = "bg-neutral-800 text-neutral-300";
  if (weight < 0) weightChip = "bg-rose-950 text-rose-300";
  else if (weight > 1.01) weightChip = "bg-emerald-950 text-emerald-300";
  else if (weight < 0.99) weightChip = "bg-amber-950 text-amber-300";

  return (
    <div className="space-y-3 text-xs">
      <div className="rounded border border-neutral-800 bg-neutral-900/50 p-2">
        <div className="mb-1 text-[9px] uppercase tracking-wider text-neutral-600">
          Source → target
        </div>
        <div className="font-medium text-neutral-200">
          {sourceLabel}
          <span className="mx-1.5 text-neutral-600">→</span>
          {targetLabel}
        </div>
        <div className="mt-1 text-[10px] text-neutral-600">
          {edge.origin === "seed" ? "from sim literal" : edge.origin}
        </div>
      </div>

      <div>
        <div className="mb-1 flex items-baseline justify-between">
          <label className="text-[10px] font-semibold uppercase tracking-wider text-neutral-500">
            Weight
          </label>
          <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold tabular-nums ${weightChip}`}>
            {weight.toFixed(2)}
          </span>
        </div>
        <input
          type="range"
          min={-2}
          max={2}
          step={0.05}
          value={weight}
          onChange={(e) => setWeight(parseFloat(e.target.value))}
          onMouseUp={() => commit({ weight })}
          onTouchEnd={() => commit({ weight })}
          className="w-full accent-cyan-500"
        />
        <div className="mt-1 flex justify-between text-[9px] text-neutral-600">
          <span>-2 (inverse-2×)</span>
          <span>0 (off)</span>
          <span>+1 (neutral)</span>
          <span>+2 (amplify 2×)</span>
        </div>
      </div>

      <div>
        <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-neutral-500">
          Magnitude
        </label>
        <div className="flex gap-1.5">
          {(["low", "med", "high"] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => {
                setMagnitude(m);
                void commit({ magnitude: m });
              }}
              className={`flex-1 rounded border px-2 py-1 text-[10px] uppercase tracking-wider transition ${
                magnitude === m
                  ? "border-cyan-700 bg-cyan-950/60 text-cyan-200"
                  : "border-neutral-800 bg-neutral-900/50 text-neutral-500 hover:text-neutral-300"
              }`}
            >
              {m}
            </button>
          ))}
        </div>
        <div className="mt-1 text-[9px] text-neutral-600">UI styling only — math reads weight</div>
      </div>

      <div>
        <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-neutral-500">
          Label
        </label>
        <input
          type="text"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          onBlur={() => commit({ label: label || null })}
          placeholder="e.g. × HBM premium"
          className="w-full rounded border border-neutral-800 bg-neutral-900/50 px-2 py-1 text-[11px] text-neutral-200 placeholder:text-neutral-700 focus:border-cyan-700 focus:outline-none"
        />
      </div>

      <div className="flex items-center justify-between border-t border-neutral-800 pt-3">
        <span className="text-[10px] text-neutral-600">
          {status === "saving" && "저장 중…"}
          {status === "error" && (
            <span className="text-rose-400" title={errorMsg ?? undefined}>
              저장 실패
            </span>
          )}
          {status === "idle" && "변경은 자동 저장됩니다"}
        </span>
        <button
          type="button"
          onClick={handleDelete}
          className="rounded border border-rose-900/70 px-2 py-1 text-[10px] font-semibold text-rose-400 hover:bg-rose-950/40"
        >
          Delete edge
        </button>
      </div>
    </div>
  );
}

// ---------- Node panel ----------

function NodePanelBody({ node }: { node: DbGraphNode }) {
  return (
    <div className="space-y-2 text-xs">
      <div className="rounded border border-neutral-800 bg-neutral-900/50 p-2">
        <div className="mb-1 text-[9px] uppercase tracking-wider text-neutral-600">
          {node.kind} · {node.group || "—"}
        </div>
        <div className="text-sm font-medium text-neutral-200">{node.label}</div>
        <div className="mt-0.5 text-[10px] text-neutral-500">{node.node_key}</div>
        {node.unit ? (
          <div className="mt-1 text-[10px] text-neutral-600">unit: {node.unit}</div>
        ) : null}
      </div>
      {node.description ? (
        <div className="rounded border border-neutral-800 bg-neutral-900/30 p-2 text-[11px] leading-relaxed text-neutral-400">
          {node.description}
        </div>
      ) : null}
      {node.kind === "equity" && node.equity_id ? (
        <p className="text-[10px] text-neutral-600">
          종목 상세 →{" "}
          <a className="text-cyan-400 hover:underline" href="../equities">
            Equities tab
          </a>
        </p>
      ) : null}
      <p className="border-t border-neutral-800 pt-2 text-[10px] text-neutral-600">
        노드 편집은 다음 슬라이스 — 지금은 edge 의 weight / magnitude / label 만 수정
        가능합니다.
      </p>
    </div>
  );
}
