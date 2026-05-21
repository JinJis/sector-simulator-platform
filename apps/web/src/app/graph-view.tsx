"use client";

import dagre from "@dagrejs/dagre";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Background,
  type Connection,
  Controls,
  type Edge,
  Handle,
  MarkerType,
  type Node,
  type NodeProps,
  Position,
  ReactFlow,
  type ReactFlowProps,
} from "reactflow";
import "reactflow/dist/style.css";

import {
  deleteGraphEdge,
  deleteGraphNode,
  fetchDbGraph,
  fetchGraph,
  type DbGraph,
  type DbGraphEdge,
  type DbGraphNode,
  type GraphEdge,
  type GraphNode,
  normalizeDbGraph,
  resetGraphToDefaults,
  type SimGraphResponse,
  type SimMetadata,
  upsertGraphEdge,
  upsertGraphNode,
} from "@/lib/sim-client";

import { GraphAddNodeModal, GraphSidePanel, type SidePanelSelection } from "./graph-side-panel";
import { formatDriverValue, prettyName } from "./shared";

interface Props {
  meta: SimMetadata;
  /** Current driver values from the workspace — shown inline on driver nodes so
   *  the graph reflects whatever the user has dialed in on the Manual tab. */
  driverValues: Record<string, number>;
}

/**
 * Causal dependency graph for the current sim. Layout is hand-rolled:
 *
 *   drivers (left)  →  intermediates (middle)  →  outputs (right)  →  equities (far right)
 *
 * Two modes:
 *
 *   - **Editable**: when the DB-backed graph is loaded (M7+ seed has
 *     run). Click an edge → side panel with weight slider, magnitude
 *     select, label, delete. Drag from one node's right handle to
 *     another's left handle → creates an edge at weight=1.0 / med.
 *     Click a node → read-only details.
 *
 *   - **Read-only fallback**: when the DB has no rows for this sector
 *     yet, fall back to the Python `SimGraph` literal via the legacy
 *     `sim.graph` proxy. Editing is disabled until the bootstrap
 *     completes.
 */
export function GraphView({ meta, driverValues }: Props) {
  // Canonical state — the DB graph (when in edit mode) or null when
  // we're in fallback. `legacyGraph` carries the Python-side shape so
  // we can render *something* even when the DB hasn't been seeded.
  const [dbGraph, setDbGraph] = useState<DbGraph | null>(null);
  const [legacyGraph, setLegacyGraph] = useState<SimGraphResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selection, setSelection] = useState<SidePanelSelection>(null);
  const [mutationError, setMutationError] = useState<string | null>(null);
  const [addNodeOpen, setAddNodeOpen] = useState(false);
  const [resetStatus, setResetStatus] = useState<"idle" | "running">("idle");
  const [resetSummary, setResetSummary] = useState<string | null>(null);

  // Initial fetch — prefer DB, fall back to upstream Python proxy.
  useEffect(() => {
    let cancelled = false;
    setError(null);
    setSelection(null);
    setMutationError(null);
    void fetchDbGraph(meta.slug)
      .then(async (db) => {
        if (cancelled) return;
        if (db.nodes.length > 0) {
          setDbGraph(db);
          setLegacyGraph(null);
          return;
        }
        const upstream = await fetchGraph(meta.slug);
        if (!cancelled) {
          setDbGraph(null);
          setLegacyGraph(upstream);
        }
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : "graph fetch failed");
      });
    return () => {
      cancelled = true;
    };
  }, [meta.slug]);

  // The flat shape that `buildFlow` consumes. Computed from whichever
  // source loaded successfully.
  const renderable = useMemo<SimGraphResponse | null>(() => {
    if (dbGraph) return normalizeDbGraph(dbGraph);
    if (legacyGraph) return legacyGraph;
    return null;
  }, [dbGraph, legacyGraph]);

  // Map of node_key → label for the side panel.
  const nodeLabels = useMemo<Record<string, string>>(() => {
    const m: Record<string, string> = {};
    if (dbGraph) {
      for (const n of dbGraph.nodes) m[n.node_key] = n.label;
    } else if (legacyGraph) {
      for (const n of legacyGraph.nodes) m[n.id] = n.label;
    }
    return m;
  }, [dbGraph, legacyGraph]);

  const { nodes, edges } = useMemo(() => {
    if (!renderable) return { nodes: [] as Node<DriverNodeData>[], edges: [] as Edge[] };
    return buildFlow(renderable, driverValues, dbGraph);
  }, [renderable, driverValues, dbGraph]);

  // --- Mutation handlers (optimistic) ---

  const editable = !!dbGraph;

  const handleCommitEdge = useCallback(
    async (input: {
      source_key: string;
      target_key: string;
      weight: number;
      magnitude: "low" | "med" | "high";
      label?: string | null;
    }) => {
      if (!dbGraph) return;
      // Optimistic: patch local state first.
      setDbGraph((prev) => {
        if (!prev) return prev;
        const next = { ...prev, edges: [...prev.edges] };
        const idx = next.edges.findIndex(
          (e) => e.source_key === input.source_key && e.target_key === input.target_key,
        );
        if (idx >= 0) {
          next.edges[idx] = {
            ...next.edges[idx]!,
            weight: input.weight,
            magnitude: input.magnitude,
            label: input.label ?? null,
          };
        }
        return next;
      });
      // Then fire mutation; on failure rollback by re-fetching.
      try {
        const updated = await upsertGraphEdge({
          sector_slug: meta.slug,
          source_key: input.source_key,
          target_key: input.target_key,
          weight: input.weight,
          magnitude: input.magnitude,
          label: input.label,
        });
        // Sync selection so the panel sees server-canonical fields.
        setSelection((s) =>
          s?.kind === "edge" && s.edge.source_key === input.source_key && s.edge.target_key === input.target_key
            ? { kind: "edge", edge: updated }
            : s,
        );
        setMutationError(null);
      } catch (e) {
        setMutationError(e instanceof Error ? e.message : String(e));
        // Refetch to recover canonical state.
        const fresh = await fetchDbGraph(meta.slug);
        setDbGraph(fresh);
        throw e;
      }
    },
    [dbGraph, meta.slug],
  );

  const handleDeleteEdge = useCallback(
    async (input: { source_key: string; target_key: string }) => {
      if (!dbGraph) return;
      setDbGraph((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          edges: prev.edges.filter(
            (e) => !(e.source_key === input.source_key && e.target_key === input.target_key),
          ),
        };
      });
      setSelection(null);
      try {
        await deleteGraphEdge({
          sector_slug: meta.slug,
          source_key: input.source_key,
          target_key: input.target_key,
        });
        setMutationError(null);
      } catch (e) {
        setMutationError(e instanceof Error ? e.message : String(e));
        const fresh = await fetchDbGraph(meta.slug);
        setDbGraph(fresh);
        throw e;
      }
    },
    [dbGraph, meta.slug],
  );

  // Drag-new-edge — React Flow calls this on a successful handle drop.
  const handleConnect = useCallback(
    async (connection: Connection) => {
      if (!dbGraph || !connection.source || !connection.target) return;
      const exists = dbGraph.edges.some(
        (e) => e.source_key === connection.source && e.target_key === connection.target,
      );
      if (exists) return;
      // Optimistic placeholder; gets replaced when the upsert returns.
      // created_at/updated_at are inferred as strings on the wire
      // (tRPC has no transformer in this project) — we cast through
      // unknown so the placeholder satisfies the inferred type.
      const now = new Date().toISOString() as unknown as DbGraphEdge["created_at"];
      const placeholder: DbGraphEdge = {
        id: `tmp_${connection.source}_${connection.target}`,
        sector_slug: meta.slug,
        source_key: connection.source,
        target_key: connection.target,
        label: null,
        weight: 1.0,
        magnitude: "med",
        origin: "edit",
        author_label: null,
        created_at: now,
        updated_at: now,
      };
      setDbGraph((prev) => (prev ? { ...prev, edges: [...prev.edges, placeholder] } : prev));
      try {
        const created = await upsertGraphEdge({
          sector_slug: meta.slug,
          source_key: connection.source,
          target_key: connection.target,
          weight: 1.0,
          magnitude: "med",
        });
        setDbGraph((prev) => {
          if (!prev) return prev;
          return {
            ...prev,
            edges: prev.edges.map((e) =>
              e.source_key === created.source_key && e.target_key === created.target_key ? created : e,
            ),
          };
        });
        // Open the new edge in the panel so the user can dial it in.
        setSelection({ kind: "edge", edge: created });
        setMutationError(null);
      } catch (e) {
        setMutationError(e instanceof Error ? e.message : String(e));
        const fresh = await fetchDbGraph(meta.slug);
        setDbGraph(fresh);
      }
    },
    [dbGraph, meta.slug],
  );

  // Node mutations (M12).
  const handleCommitNode = useCallback(
    async (input: {
      node_key: string;
      kind: "driver" | "intermediate" | "output" | "equity";
      label: string;
      group?: string;
      unit?: string | null;
      description?: string | null;
    }) => {
      if (!dbGraph) return;
      // Optimistic: patch local state.
      setDbGraph((prev) => {
        if (!prev) return prev;
        const next = { ...prev, nodes: [...prev.nodes] };
        const idx = next.nodes.findIndex((n) => n.node_key === input.node_key);
        if (idx >= 0) {
          next.nodes[idx] = {
            ...next.nodes[idx]!,
            label: input.label,
            group: input.group ?? next.nodes[idx]!.group,
            unit: input.unit ?? null,
            description: input.description ?? null,
          };
        }
        return next;
      });
      try {
        const updated = await upsertGraphNode({
          sector_slug: meta.slug,
          node_key: input.node_key,
          kind: input.kind,
          label: input.label,
          group: input.group,
          unit: input.unit,
          description: input.description,
        });
        setSelection((s) =>
          s?.kind === "node" && s.node.node_key === input.node_key
            ? { kind: "node", node: updated }
            : s,
        );
        // If the node was newly created (add modal flow), it won't be
        // in the local graph yet — merge it in.
        setDbGraph((prev) => {
          if (!prev) return prev;
          if (prev.nodes.some((n) => n.node_key === updated.node_key)) return prev;
          return { ...prev, nodes: [...prev.nodes, updated] };
        });
        setMutationError(null);
      } catch (e) {
        setMutationError(e instanceof Error ? e.message : String(e));
        const fresh = await fetchDbGraph(meta.slug);
        setDbGraph(fresh);
        throw e;
      }
    },
    [dbGraph, meta.slug],
  );

  const handleDeleteNode = useCallback(
    async (input: { node_key: string }) => {
      if (!dbGraph) return;
      // Optimistic: remove from local state (the server-side guard
      // will reject if attached edges exist; we re-fetch on error).
      setDbGraph((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          nodes: prev.nodes.filter((n) => n.node_key !== input.node_key),
        };
      });
      setSelection(null);
      try {
        await deleteGraphNode({ sector_slug: meta.slug, node_key: input.node_key });
        setMutationError(null);
      } catch (e) {
        setMutationError(e instanceof Error ? e.message : String(e));
        const fresh = await fetchDbGraph(meta.slug);
        setDbGraph(fresh);
        throw e;
      }
    },
    [dbGraph, meta.slug],
  );

  const handleReset = useCallback(async () => {
    if (!confirm(
      "이 섹터의 graph 를 Python SimGraph + SectorEquity.driver_links 로 초기화합니다.\n" +
      "그동안의 edge weight / magnitude / label / 사용자 추가 노드 변경은 사라집니다.\n\n계속할까요?",
    )) {
      return;
    }
    setResetStatus("running");
    setResetSummary(null);
    setSelection(null);
    try {
      const result = await resetGraphToDefaults(meta.slug);
      const fresh = await fetchDbGraph(meta.slug);
      setDbGraph(fresh);
      setLegacyGraph(null);
      setMutationError(null);
      setResetSummary(
        `재구성 완료 — ${result.nodes} 노드 · ${result.edges} edges + ${result.equity_nodes} 종목 · ${result.equity_edges} driver→equity` +
          (result.skipped_driver_misses > 0
            ? ` (${result.skipped_driver_misses} edges skipped — driver mismatch)`
            : "."),
      );
    } catch (e) {
      setMutationError(e instanceof Error ? e.message : String(e));
    } finally {
      setResetStatus("idle");
    }
  }, [meta.slug]);

  // Click handlers.
  const handleEdgeClick = useCallback(
    (_: unknown, edge: Edge) => {
      if (!dbGraph) return;
      const data = edge.data as DbGraphEdge | undefined;
      if (!data) return;
      setSelection({ kind: "edge", edge: data });
    },
    [dbGraph],
  );

  const handleNodeClick = useCallback(
    (_: unknown, node: Node<DriverNodeData>) => {
      if (!dbGraph) return;
      const dbNode = dbGraph.nodes.find((n) => n.node_key === node.id);
      if (dbNode) setSelection({ kind: "node", node: dbNode });
    },
    [dbGraph],
  );

  // ---- Render ----

  if (error) {
    return (
      <div className="rounded-lg border border-red-900/60 bg-red-950/40 p-4 text-sm text-red-300">
        그래프 로드 실패: {error}
      </div>
    );
  }

  if (!renderable) {
    return (
      <div className="rounded-lg border border-neutral-800 bg-neutral-900/30 p-4 text-sm text-neutral-500">
        그래프 로드 중…
      </div>
    );
  }

  if (renderable.nodes.length === 0) {
    return (
      <div className="rounded-lg border border-neutral-800 bg-neutral-900/30 p-4 text-sm text-neutral-500">
        이 섹터는 아직 dependency graph가 등록되지 않았습니다. Phase 2 후반 슬라이스에서
        에이전트가 자동 생성할 예정입니다.
      </div>
    );
  }

  const counts = countByKind(renderable.nodes);

  return (
    <div className="space-y-3">
      <div className="rounded-lg border border-neutral-800 bg-neutral-900/30 p-3 text-xs text-neutral-400">
        <div className="mb-2 flex flex-wrap items-center gap-4">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-neutral-500">
            Causal graph
          </span>
          <LegendDot color={KIND_COLORS.driver} label={`drivers (${counts.driver ?? 0})`} />
          <LegendDot
            color={KIND_COLORS.intermediate}
            label={`intermediates (${counts.intermediate ?? 0})`}
          />
          <LegendDot color={KIND_COLORS.output} label={`outputs (${counts.output ?? 0})`} />
          {counts.equity ? (
            <LegendDot
              color={KIND_COLORS.equity}
              label={`equities (${counts.equity ?? 0})`}
            />
          ) : null}
          <div className="ml-auto flex items-center gap-2">
            {editable ? (
              <>
                <button
                  type="button"
                  onClick={() => setAddNodeOpen(true)}
                  className="rounded border border-cyan-700 bg-cyan-950/40 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-cyan-200 hover:bg-cyan-900/60"
                >
                  + Add node
                </button>
                <button
                  type="button"
                  onClick={handleReset}
                  disabled={resetStatus === "running"}
                  className="rounded border border-amber-700/70 bg-amber-950/40 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-amber-200 hover:bg-amber-900/60 disabled:cursor-not-allowed disabled:opacity-40"
                  title="Wipe & re-bootstrap from Python SimGraph + SectorEquity.driver_links"
                >
                  {resetStatus === "running" ? "Resetting…" : "↻ Reset"}
                </button>
              </>
            ) : null}
            <span
              className={`rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${
                editable
                  ? "bg-cyan-950/60 text-cyan-300"
                  : "bg-neutral-800/60 text-neutral-500"
              }`}
            >
              {editable ? "Editable" : "Read-only (seed pending)"}
            </span>
          </div>
        </div>
        <EdgeLegend />
        <p className="mt-2">
          {editable ? (
            <>
              Edge 클릭 → 우측 패널에서 weight / magnitude / label 수정. 노드 우측 핸들에서
              다른 노드 좌측 핸들로 드래그 → 새 edge 생성. 변경은 즉시 시뮬레이션과 종목
              영향도에 반영됩니다.
            </>
          ) : (
            <>
              DB graph 가 비어 있어 Python 소스의 SimGraph 를 fallback 으로 렌더링합니다.
              <code className="ml-1 rounded bg-neutral-950 px-1 py-0.5">pnpm db:seed:graph</code>
              실행 후 새로고침하면 편집 가능.
            </>
          )}
        </p>
        {mutationError ? (
          <p className="mt-2 rounded border border-rose-900/60 bg-rose-950/30 px-2 py-1 text-[11px] text-rose-300">
            저장 실패: {mutationError}
          </p>
        ) : null}
        {resetSummary ? (
          <p className="mt-2 rounded border border-emerald-900/60 bg-emerald-950/30 px-2 py-1 text-[11px] text-emerald-300">
            {resetSummary}
          </p>
        ) : null}
      </div>
      <div className="relative h-[640px] overflow-hidden rounded-lg border border-neutral-800 bg-neutral-950">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={NODE_TYPES}
          fitView
          fitViewOptions={{ padding: 0.15 }}
          minZoom={0.2}
          maxZoom={1.5}
          proOptions={REACTFLOW_PRO_OPTIONS}
          nodesConnectable={editable}
          nodesDraggable={editable}
          elementsSelectable={editable}
          onEdgeClick={handleEdgeClick}
          onNodeClick={handleNodeClick}
          onConnect={handleConnect}
          onPaneClick={() => setSelection(null)}
          defaultEdgeOptions={{
            type: "smoothstep",
            animated: false,
            style: { stroke: "#525252", strokeWidth: 1.25 },
            labelStyle: { fill: "#a3a3a3", fontSize: 10 },
            labelBgStyle: { fill: "#0a0a0a", fillOpacity: 0.8 },
            labelBgPadding: [3, 1],
            labelBgBorderRadius: 2,
            markerEnd: { type: MarkerType.ArrowClosed, color: "#525252", width: 14, height: 14 },
          }}
        >
          <Background gap={20} color="#1f1f1f" />
          <Controls
            showInteractive={false}
            className="!border-neutral-800 !bg-neutral-900 !text-neutral-200"
          />
        </ReactFlow>
        <GraphSidePanel
          selection={selection}
          onClose={() => setSelection(null)}
          onCommitEdge={handleCommitEdge}
          onDeleteEdge={handleDeleteEdge}
          onCommitNode={handleCommitNode}
          onDeleteNode={handleDeleteNode}
          nodeLabels={nodeLabels}
        />
      </div>
      <GraphAddNodeModal
        open={addNodeOpen}
        onClose={() => setAddNodeOpen(false)}
        onCreate={async (n) => {
          await handleCommitNode(n);
        }}
        existingKeys={new Set(dbGraph?.nodes.map((n) => n.node_key) ?? [])}
      />
    </div>
  );
}

const REACTFLOW_PRO_OPTIONS: NonNullable<ReactFlowProps["proOptions"]> = {
  // Suppress the React Flow attribution overlay in our self-hosted UI; we'll
  // surface attribution in a footer if/when we ship marketing pages.
  hideAttribution: true,
};

interface DriverNodeData {
  label: string;
  kind: string;
  unit: string;
  group: string;
  description: string;
  /** Only set for kind="driver" nodes — the live value from the workspace. */
  value?: number;
}

type KindStyle = { border: string; bg: string; accent: string };

const KIND_COLORS: Record<"driver" | "intermediate" | "output" | "equity", KindStyle> = {
  driver: {
    border: "border-cyan-700/70",
    bg: "bg-cyan-950/70",
    accent: "text-cyan-300",
  },
  intermediate: {
    border: "border-neutral-700",
    bg: "bg-neutral-900/80",
    accent: "text-neutral-300",
  },
  output: {
    border: "border-amber-700/70",
    bg: "bg-amber-950/60",
    accent: "text-amber-300",
  },
  equity: {
    border: "border-yellow-700/70",
    bg: "bg-yellow-950/40",
    accent: "text-yellow-300",
  },
};

function colorFor(kind: string): KindStyle {
  if (
    kind === "driver" ||
    kind === "intermediate" ||
    kind === "output" ||
    kind === "equity"
  ) {
    return KIND_COLORS[kind];
  }
  return KIND_COLORS.intermediate;
}

/**
 * Kind-tone color reference for edges (must match the node accent
 * palette so an edge entering an amber output node looks unmistakably
 * "headed into output land"). Hex/rgb because React Flow inline styles
 * don't speak Tailwind class names.
 */
const KIND_STROKE: Record<string, string> = {
  driver: "rgb(34 211 238)", // cyan-400 — drivers rarely receive, but harmless
  intermediate: "rgb(34 211 238)", // cyan-400
  output: "rgb(245 158 11)", // amber-500
  equity: "rgb(234 179 8)", // yellow-500 — gold, distinct from output amber
};

const KIND_BG_BAND: Record<string, string> = {
  driver: "bg-cyan-400",
  intermediate: "bg-neutral-500",
  output: "bg-amber-400",
  equity: "bg-yellow-400",
};

function GraphFlowNode({ data }: NodeProps<DriverNodeData>) {
  const c = colorFor(data.kind);
  return (
    <div
      className={`relative overflow-hidden rounded-md border ${c.border} ${c.bg} px-2.5 py-1.5 shadow-sm`}
      style={{ width: NODE_W, minHeight: NODE_H }}
      title={data.description || undefined}
    >
      {/* Left color band — semantic key for kind. */}
      <span
        aria-hidden
        className={`absolute left-0 top-0 h-full w-1 ${KIND_BG_BAND[data.kind] ?? KIND_BG_BAND.intermediate}`}
      />
      <Handle type="target" position={Position.Left} className="!h-2 !w-2 !bg-neutral-700" />
      <div className="ml-1.5 flex items-baseline justify-between gap-1.5">
        <span className={`truncate text-[11px] font-semibold ${c.accent}`}>
          {data.label}
        </span>
        {data.unit && (
          <span className="shrink-0 text-[9px] text-neutral-500">{data.unit}</span>
        )}
      </div>
      <div className="ml-1.5 mt-0.5 flex items-center gap-1.5">
        <span
          className={`rounded px-1 py-px text-[8px] font-semibold uppercase tracking-wider ${c.bg} ${c.accent}`}
          style={{ borderWidth: 0.5 }}
        >
          {data.kind}
        </span>
        {data.group && (
          <span className="truncate text-[9px] uppercase tracking-wider text-neutral-600">
            {data.group}
          </span>
        )}
      </div>
      {data.value !== undefined && (
        <div className="ml-1.5 mt-0.5 text-[10px] tabular-nums text-neutral-200">
          {formatDriverValue(data.value, data.unit)}
        </div>
      )}
      <Handle type="source" position={Position.Right} className="!h-2 !w-2 !bg-neutral-700" />
    </div>
  );
}

const NODE_TYPES = { sim: GraphFlowNode };

/** Dagre needs to know node dimensions before layout — keep these in
 *  sync with the values used in `GraphFlowNode`. */
const NODE_W = 180;
const NODE_H = 64;

/**
 * Map an edge's (weight, magnitude, origin, targetKind) into React Flow
 * styling along four orthogonal visual axes:
 *
 *   - COLOR    by target kind     (cyan / amber / gold)
 *   - WIDTH    continuous by |weight|  (clamp 0.7 .. 4)
 *   - DASH     by origin          (seed: solid · edit: dashed · agent: dotted)
 *   - ARROW    by sign            (filled if w≥0, open if w<0)
 *
 * Opacity dims neutral seeded edges (weight=1, magnitude=med) so the
 * eye gravitates to edges that someone has actually tuned.
 */
function edgeStyleFor(
  weight: number | null,
  magnitude: string | null,
  origin: string | null,
  targetKind: string,
): {
  stroke: string;
  strokeWidth: number;
  strokeOpacity: number;
  strokeDasharray: string | undefined;
  markerType: MarkerType;
} {
  const baseColor = KIND_STROKE[targetKind] ?? "rgb(115 115 115)";
  const w = weight ?? 1.0;
  const absW = Math.abs(w);

  // Width: continuous mapping of |weight| → stroke px. Magnitude is
  // now presentation-only ornament (low → −0.3, high → +0.6) so the
  // legacy `magnitude` field still nudges the eye, but |weight| does
  // most of the visual work.
  const mag = magnitude ?? "med";
  const magBoost = mag === "high" ? 0.6 : mag === "low" ? -0.3 : 0;
  const strokeWidth = clamp(0.7 + absW * 1.1 + magBoost, 0.5, 4.0);

  // Dash by origin.
  let strokeDasharray: string | undefined;
  if (origin === "edit") strokeDasharray = "5 3";
  else if (origin === "agent") strokeDasharray = "1 3";

  // Arrow head shape encodes sign.
  const markerType = w < 0 ? MarkerType.Arrow : MarkerType.ArrowClosed;

  // Opacity: untouched neutral edges fade; tuned edges saturate. Negative
  // weight bumps opacity a notch so inverse edges read at a glance.
  const isUntouched =
    weight === null ||
    (Math.abs(w - 1.0) < 1e-3 && (origin === "seed" || origin === null));
  let strokeOpacity = isUntouched ? 0.35 : Math.min(1, 0.55 + absW * 0.2);
  if (w < 0) strokeOpacity = Math.max(strokeOpacity, 0.85);

  return {
    stroke: baseColor,
    strokeWidth,
    strokeOpacity,
    strokeDasharray,
    markerType,
  };
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

/**
 * Auto-layout with dagre. Edges are routed orthogonally; node
 * coordinates emerge from the layered DAG layout so no two edges
 * cross unnecessarily and no two nodes overlap (which the old
 * hand-rolled column layout sometimes did once equity nodes joined
 * the right side).
 *
 * Note that we feed dagre an LR (left-to-right) graph and let kind
 * fall out of the topology: drivers usually have no incoming edges,
 * so dagre places them on the left rank; equity nodes usually have
 * many incoming edges and none outgoing, so they land on the right.
 * No `setRank()` hacks needed.
 */
function buildFlow(
  g: SimGraphResponse,
  driverValues: Record<string, number>,
  db: DbGraph | null,
): { nodes: Node<DriverNodeData>[]; edges: Edge[] } {
  const dag = new dagre.graphlib.Graph();
  dag.setDefaultEdgeLabel(() => ({}));
  dag.setGraph({
    rankdir: "LR",
    ranker: "tight-tree",
    // Sizing tuned for ~50-node graphs (memory-semi after equity nodes).
    nodesep: 18, // px between nodes in the same rank
    ranksep: 70, // px between ranks
    edgesep: 8,
    marginx: 24,
    marginy: 24,
  });

  for (const n of g.nodes) {
    dag.setNode(n.id, { width: NODE_W, height: NODE_H });
  }
  for (const e of g.edges) {
    // dagre tolerates duplicate addEdge calls (overwrite); guard
    // against missing endpoints for graphs that drift before the seed
    // re-runs.
    if (!dag.hasNode(e.source) || !dag.hasNode(e.target)) continue;
    dag.setEdge(e.source, e.target);
  }

  dagre.layout(dag);

  // Index node lookups so we can know each target's kind for edge
  // coloring (M19: color by target kind).
  const kindByKey = new Map<string, string>();
  for (const n of g.nodes) kindByKey.set(n.id, n.kind);

  const nodes: Node<DriverNodeData>[] = g.nodes.map((n) => {
    const dn = dag.node(n.id);
    // dagre returns center coordinates; React Flow expects top-left.
    const x = (dn?.x ?? 0) - NODE_W / 2;
    const y = (dn?.y ?? 0) - NODE_H / 2;
    return {
      id: n.id,
      type: "sim",
      position: { x, y },
      data: {
        label: n.label || prettyName(n.id),
        kind: n.kind,
        unit: n.unit,
        group: n.group,
        description: n.description,
        value: n.kind === "driver" ? driverValues[n.id] : undefined,
      },
    };
  });

  // Build a lookup from the DB edges (when available) so we can
  // style each rendered edge by (weight, magnitude, origin) AND attach
  // the canonical row to the React Flow edge's `data` field for click
  // handlers.
  const dbByPair = new Map<string, DbGraphEdge>();
  if (db) {
    for (const e of db.edges) dbByPair.set(`${e.source_key}->${e.target_key}`, e);
  }

  const edges: Edge[] = g.edges.map((e, i) => {
    const dbEdge = dbByPair.get(`${e.source}->${e.target}`);
    const targetKind = kindByKey.get(e.target) ?? "intermediate";
    const style = edgeStyleFor(
      dbEdge?.weight ?? null,
      dbEdge?.magnitude ?? null,
      dbEdge?.origin ?? null,
      targetKind,
    );

    // Label policy (M19): only show a label when there's a user
    // signal — a non-neutral weight, an explicit edit label, or both.
    // Routine seeded math labels (`× duty`, `÷ η`) stay visible since
    // they describe the math; but the auto-appended `w=1.00` suffix
    // for neutral edges is dropped.
    const hasCustomLabel = !!(e.label && e.label.trim());
    const showWeight = !!(dbEdge && Math.abs(dbEdge.weight - 1.0) > 1e-3);
    const labelStr = showWeight
      ? hasCustomLabel
        ? `${e.label} · w=${dbEdge!.weight.toFixed(2)}`
        : `w=${dbEdge!.weight.toFixed(2)}`
      : hasCustomLabel
        ? e.label
        : undefined;

    return {
      id: `${e.source}->${e.target}-${i}`,
      source: e.source,
      target: e.target,
      label: labelStr,
      labelStyle: { fontSize: 10, fill: "rgb(163 163 163)" },
      labelBgStyle: { fill: "rgb(10 10 10)", fillOpacity: 0.7 },
      labelBgPadding: [3, 1],
      style: {
        stroke: style.stroke,
        strokeWidth: style.strokeWidth,
        strokeOpacity: style.strokeOpacity,
        strokeDasharray: style.strokeDasharray,
      },
      markerEnd: {
        type: style.markerType,
        color: style.stroke,
        width: 14,
        height: 14,
      },
      data: dbEdge,
    };
  });

  return { nodes, edges };
}

function countByKind(nodes: GraphNode[]): Record<string, number> {
  const c: Record<string, number> = {};
  for (const n of nodes) c[n.kind] = (c[n.kind] ?? 0) + 1;
  return c;
}

function LegendDot({ color, label }: { color: KindStyle; label: string }) {
  return (
    <span className="flex items-center gap-1.5 text-[10px] text-neutral-400">
      <span
        className={`inline-block h-2.5 w-2.5 rounded-sm border ${color.border} ${color.bg}`}
      />
      {label}
    </span>
  );
}

/**
 * Compact edge-encoding legend. Walks 4 axes — color / thickness /
 * dash / arrow head — using inline SVG so the swatches match what
 * React Flow actually draws.
 */
function EdgeLegend() {
  return (
    <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-neutral-800 pt-2 text-[10px] text-neutral-500">
      <span className="font-semibold uppercase tracking-wider text-neutral-600">
        Edge:
      </span>
      <EdgeSample
        label="→ intermediate"
        stroke="rgb(34 211 238)"
        width={1.5}
        marker="filled"
      />
      <EdgeSample
        label="→ output"
        stroke="rgb(245 158 11)"
        width={1.5}
        marker="filled"
      />
      <EdgeSample
        label="→ equity"
        stroke="rgb(234 179 8)"
        width={1.5}
        marker="filled"
      />
      <span className="text-neutral-700">|</span>
      <EdgeSample
        label="amplify (|w| 큼)"
        stroke="rgb(115 115 115)"
        width={3.0}
        marker="filled"
      />
      <EdgeSample
        label="neutral (untouched)"
        stroke="rgb(115 115 115)"
        width={1.0}
        marker="filled"
        opacity={0.4}
      />
      <EdgeSample
        label="inverse (w<0)"
        stroke="rgb(115 115 115)"
        width={1.5}
        marker="open"
      />
      <span className="text-neutral-700">|</span>
      <EdgeSample
        label="seed"
        stroke="rgb(115 115 115)"
        width={1.5}
        marker="filled"
      />
      <EdgeSample
        label="edit"
        stroke="rgb(115 115 115)"
        width={1.5}
        marker="filled"
        dash="5 3"
      />
      <EdgeSample
        label="agent"
        stroke="rgb(115 115 115)"
        width={1.5}
        marker="filled"
        dash="1 3"
      />
    </div>
  );
}

function EdgeSample({
  label,
  stroke,
  width,
  marker,
  dash,
  opacity = 1,
}: {
  label: string;
  stroke: string;
  width: number;
  marker: "filled" | "open";
  dash?: string;
  opacity?: number;
}) {
  // Generate a unique marker id per swatch so React Flow's globally-
  // shared arrow markers don't get in the way at component scale.
  const id = `edge-leg-${marker}-${stroke.replace(/[^a-z0-9]/gi, "")}-${width}`;
  return (
    <span className="flex items-center gap-1.5">
      <svg width="38" height="10" viewBox="0 0 38 10">
        <defs>
          <marker
            id={id}
            markerWidth="6"
            markerHeight="6"
            refX="5"
            refY="3"
            orient="auto"
          >
            {marker === "filled" ? (
              <path d="M0,0 L6,3 L0,6 Z" fill={stroke} />
            ) : (
              <path
                d="M0,0 L6,3 L0,6"
                fill="none"
                stroke={stroke}
                strokeWidth="1"
              />
            )}
          </marker>
        </defs>
        <line
          x1="0"
          y1="5"
          x2="30"
          y2="5"
          stroke={stroke}
          strokeWidth={width}
          strokeOpacity={opacity}
          strokeDasharray={dash}
          markerEnd={`url(#${id})`}
        />
      </svg>
      <span>{label}</span>
    </span>
  );
}
