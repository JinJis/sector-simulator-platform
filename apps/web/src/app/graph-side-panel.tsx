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
 *   - Node selected: editable label / group / description / unit (M12).
 *     For equity nodes, also surfaces ticker + a link to the equities
 *     tab.
 *
 * The parent (`GraphView`) owns the canonical graph state — this
 * panel just calls back via `onCommit*` / `onDelete*` so the parent
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
  onCommitNode: (n: {
    node_key: string;
    kind: "driver" | "intermediate" | "output" | "equity";
    label: string;
    group?: string;
    unit?: string | null;
    description?: string | null;
  }) => Promise<void>;
  onDeleteNode: (n: { node_key: string }) => Promise<void>;
  /** Map of node_key → label, so the edge editor can show "A → B" not
   *  "raw_key → raw_key". */
  nodeLabels: Record<string, string>;
}

export function GraphSidePanel({
  selection,
  onClose,
  onCommitEdge,
  onDeleteEdge,
  onCommitNode,
  onDeleteNode,
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
      aria-label={selection.kind === "edge" ? "Edge editor" : "Node editor"}
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
          <NodePanelBody
            node={selection.node}
            onCommit={onCommitNode}
            onDelete={onDeleteNode}
          />
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

// ---------- Node panel (editable, M12) ----------

function NodePanelBody({
  node,
  onCommit,
  onDelete,
}: {
  node: DbGraphNode;
  onCommit: (n: {
    node_key: string;
    kind: "driver" | "intermediate" | "output" | "equity";
    label: string;
    group?: string;
    unit?: string | null;
    description?: string | null;
  }) => Promise<void>;
  onDelete: (n: { node_key: string }) => Promise<void>;
}) {
  const [label, setLabel] = useState(node.label);
  const [group, setGroup] = useState(node.group);
  const [unit, setUnit] = useState(node.unit ?? "");
  const [description, setDescription] = useState(node.description ?? "");
  const [status, setStatus] = useState<"idle" | "saving" | "error">("idle");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    setLabel(node.label);
    setGroup(node.group);
    setUnit(node.unit ?? "");
    setDescription(node.description ?? "");
    setStatus("idle");
    setErrorMsg(null);
  }, [node.id]);

  const commit = async (next: {
    label?: string;
    group?: string;
    unit?: string | null;
    description?: string | null;
  }) => {
    setStatus("saving");
    setErrorMsg(null);
    try {
      await onCommit({
        node_key: node.node_key,
        kind: node.kind as "driver" | "intermediate" | "output" | "equity",
        label: next.label ?? label,
        group: next.group ?? group,
        unit: next.unit !== undefined ? next.unit : unit || null,
        description: next.description !== undefined ? next.description : description || null,
      });
      setStatus("idle");
    } catch (e) {
      setStatus("error");
      setErrorMsg(e instanceof Error ? e.message : String(e));
    }
  };

  const handleDelete = async () => {
    if (!confirm(`Delete node ${node.label}? (Attached edges must be removed first.)`)) return;
    setStatus("saving");
    setErrorMsg(null);
    try {
      await onDelete({ node_key: node.node_key });
      setStatus("idle");
    } catch (e) {
      setStatus("error");
      setErrorMsg(e instanceof Error ? e.message : String(e));
    }
  };

  // Driver/equity nodes are tied to upstream sources (sim literal /
  // SectorEquity) — renaming them is technically possible but the
  // bootstrap will overwrite on next run. Warn in those cases.
  const isManaged = node.kind === "driver" || node.kind === "equity";

  return (
    <div className="space-y-3 text-xs">
      <div className="rounded border border-neutral-800 bg-neutral-900/50 p-2">
        <div className="mb-1 text-[9px] uppercase tracking-wider text-neutral-600">
          {node.kind} · key
        </div>
        <div className="font-mono text-[11px] text-neutral-400">{node.node_key}</div>
        {isManaged ? (
          <div className="mt-1 text-[9px] text-amber-400">
            ⚠ {node.kind === "driver" ? "Python sim 의 driver" : "SectorEquity 행"}과 연결됨 —
            재부트스트랩 시 덮어쓰일 수 있음.
          </div>
        ) : null}
      </div>

      <div>
        <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-neutral-500">
          Label
        </label>
        <input
          type="text"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          onBlur={() => label !== node.label && commit({ label })}
          className="w-full rounded border border-neutral-800 bg-neutral-900/50 px-2 py-1 text-[11px] text-neutral-200 placeholder:text-neutral-700 focus:border-cyan-700 focus:outline-none"
        />
      </div>

      <div>
        <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-neutral-500">
          Group
        </label>
        <input
          type="text"
          value={group}
          onChange={(e) => setGroup(e.target.value)}
          onBlur={() => group !== node.group && commit({ group })}
          placeholder="e.g. Demand / Pricing / Cost"
          className="w-full rounded border border-neutral-800 bg-neutral-900/50 px-2 py-1 text-[11px] text-neutral-200 placeholder:text-neutral-700 focus:border-cyan-700 focus:outline-none"
        />
      </div>

      <div>
        <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-neutral-500">
          Unit
        </label>
        <input
          type="text"
          value={unit}
          onChange={(e) => setUnit(e.target.value)}
          onBlur={() => unit !== (node.unit ?? "") && commit({ unit: unit || null })}
          placeholder="USD / %/yr / PB"
          className="w-full rounded border border-neutral-800 bg-neutral-900/50 px-2 py-1 text-[11px] text-neutral-200 placeholder:text-neutral-700 focus:border-cyan-700 focus:outline-none"
        />
      </div>

      <div>
        <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-neutral-500">
          Description
        </label>
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          onBlur={() =>
            description !== (node.description ?? "") &&
            commit({ description: description || null })
          }
          rows={3}
          placeholder="자유 메모"
          className="w-full resize-none rounded border border-neutral-800 bg-neutral-900/50 px-2 py-1 text-[11px] leading-snug text-neutral-200 placeholder:text-neutral-700 focus:border-cyan-700 focus:outline-none"
        />
      </div>

      {node.kind === "equity" && node.equity_id ? (
        <p className="text-[10px] text-neutral-600">
          종목 상세 →{" "}
          <a className="text-cyan-400 hover:underline" href="../equities">
            Equities tab
          </a>
        </p>
      ) : null}

      <div className="flex items-center justify-between border-t border-neutral-800 pt-3">
        <span className="text-[10px] text-neutral-600">
          {status === "saving" && "저장 중…"}
          {status === "error" && (
            <span className="text-rose-400" title={errorMsg ?? undefined}>
              저장 실패
            </span>
          )}
          {status === "idle" && "blur 시 자동 저장"}
        </span>
        <button
          type="button"
          onClick={handleDelete}
          className="rounded border border-rose-900/70 px-2 py-1 text-[10px] font-semibold text-rose-400 hover:bg-rose-950/40"
        >
          Delete node
        </button>
      </div>
    </div>
  );
}

// ---------- Add-node modal (M12) ----------

interface AddNodeModalProps {
  open: boolean;
  onClose: () => void;
  onCreate: (n: {
    node_key: string;
    kind: "driver" | "intermediate" | "output" | "equity";
    label: string;
    group: string;
    unit: string | null;
    description: string | null;
  }) => Promise<void>;
  /** Existing node keys so we can reject collisions before the
   *  server does. */
  existingKeys: Set<string>;
}

export function GraphAddNodeModal({ open, onClose, onCreate, existingKeys }: AddNodeModalProps) {
  const [nodeKey, setNodeKey] = useState("");
  const [kind, setKind] = useState<"intermediate" | "output">("intermediate");
  const [label, setLabel] = useState("");
  const [group, setGroup] = useState("");
  const [unit, setUnit] = useState("");
  const [description, setDescription] = useState("");
  const [status, setStatus] = useState<"idle" | "saving" | "error">("idle");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setNodeKey("");
    setKind("intermediate");
    setLabel("");
    setGroup("");
    setUnit("");
    setDescription("");
    setStatus("idle");
    setErrorMsg(null);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const fn = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", fn);
    return () => window.removeEventListener("keydown", fn);
  }, [open, onClose]);

  if (!open) return null;

  const keyCollision = nodeKey && existingKeys.has(nodeKey);
  const canSubmit = Boolean(nodeKey) && Boolean(label) && !keyCollision && status !== "saving";

  const handleSubmit = async () => {
    if (!canSubmit) return;
    setStatus("saving");
    setErrorMsg(null);
    try {
      await onCreate({
        node_key: nodeKey,
        kind,
        label,
        group: group || "Custom",
        unit: unit || null,
        description: description || null,
      });
      onClose();
    } catch (e) {
      setStatus("error");
      setErrorMsg(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      role="dialog"
      aria-label="Add node"
      onClick={onClose}
    >
      <div
        className="w-[360px] rounded-lg border border-neutral-800 bg-neutral-950 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-center justify-between border-b border-neutral-800 px-4 py-3">
          <span className="text-xs font-semibold uppercase tracking-wider text-neutral-300">
            Add node
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
        <div className="space-y-3 p-4 text-xs">
          <div>
            <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-neutral-500">
              Node key <span className="text-rose-400">*</span>
            </label>
            <input
              type="text"
              value={nodeKey}
              onChange={(e) => setNodeKey(e.target.value.replace(/[^a-z0-9_]/gi, "_"))}
              placeholder="custom_intermediate_1"
              className={`w-full rounded border bg-neutral-900/50 px-2 py-1 text-[11px] font-mono text-neutral-200 placeholder:text-neutral-700 focus:outline-none ${
                keyCollision ? "border-rose-700 focus:border-rose-500" : "border-neutral-800 focus:border-cyan-700"
              }`}
            />
            {keyCollision ? (
              <div className="mt-0.5 text-[10px] text-rose-400">key 충돌 — 다른 이름 사용</div>
            ) : (
              <div className="mt-0.5 text-[10px] text-neutral-600">a-z, 0-9, _ 만 사용</div>
            )}
          </div>

          <div>
            <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-neutral-500">
              Kind
            </label>
            <div className="flex gap-1.5">
              {(["intermediate", "output"] as const).map((k) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => setKind(k)}
                  className={`flex-1 rounded border px-2 py-1 text-[10px] uppercase tracking-wider transition ${
                    kind === k
                      ? "border-cyan-700 bg-cyan-950/60 text-cyan-200"
                      : "border-neutral-800 bg-neutral-900/50 text-neutral-500 hover:text-neutral-300"
                  }`}
                >
                  {k}
                </button>
              ))}
            </div>
            <div className="mt-0.5 text-[10px] text-neutral-600">
              driver / equity 는 별도 경로 (Python sim · SectorEquity)에서 생성
            </div>
          </div>

          <div>
            <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-neutral-500">
              Label <span className="text-rose-400">*</span>
            </label>
            <input
              type="text"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="Industry HBM revenue (custom)"
              className="w-full rounded border border-neutral-800 bg-neutral-900/50 px-2 py-1 text-[11px] text-neutral-200 placeholder:text-neutral-700 focus:border-cyan-700 focus:outline-none"
            />
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-neutral-500">
                Group
              </label>
              <input
                type="text"
                value={group}
                onChange={(e) => setGroup(e.target.value)}
                placeholder="Custom"
                className="w-full rounded border border-neutral-800 bg-neutral-900/50 px-2 py-1 text-[11px] text-neutral-200 placeholder:text-neutral-700 focus:border-cyan-700 focus:outline-none"
              />
            </div>
            <div>
              <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-neutral-500">
                Unit
              </label>
              <input
                type="text"
                value={unit}
                onChange={(e) => setUnit(e.target.value)}
                placeholder="USD"
                className="w-full rounded border border-neutral-800 bg-neutral-900/50 px-2 py-1 text-[11px] text-neutral-200 placeholder:text-neutral-700 focus:border-cyan-700 focus:outline-none"
              />
            </div>
          </div>

          <div>
            <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-neutral-500">
              Description
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
              placeholder="자유 메모"
              className="w-full resize-none rounded border border-neutral-800 bg-neutral-900/50 px-2 py-1 text-[11px] leading-snug text-neutral-200 placeholder:text-neutral-700 focus:border-cyan-700 focus:outline-none"
            />
          </div>

          {status === "error" ? (
            <div className="rounded border border-rose-900/60 bg-rose-950/30 px-2 py-1 text-[11px] text-rose-300">
              {errorMsg}
            </div>
          ) : null}

          <div className="flex justify-end gap-2 border-t border-neutral-800 pt-3">
            <button
              type="button"
              onClick={onClose}
              className="rounded border border-neutral-800 px-3 py-1 text-[11px] text-neutral-400 hover:bg-neutral-900"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleSubmit}
              disabled={!canSubmit}
              className="rounded border border-cyan-700 bg-cyan-950/60 px-3 py-1 text-[11px] font-semibold text-cyan-200 hover:bg-cyan-900/60 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {status === "saving" ? "Creating…" : "Create node"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
