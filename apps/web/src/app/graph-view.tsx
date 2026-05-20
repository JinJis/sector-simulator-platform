"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Background,
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
  fetchGraph,
  type GraphEdge,
  type GraphNode,
  type SimGraphResponse,
  type SimMetadata,
} from "@/lib/sim-client";

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
 *   drivers (left)  →  intermediates (middle, grouped vertically by `group`)  →  outputs (right)
 *
 * No auto-layout (dagre/elk) so we don't ship another dep for an MVP. The
 * column-by-kind layout reads cleanly because the authored graphs are already
 * acyclic and roughly DAG-shaped left-to-right.
 */
export function GraphView({ meta, driverValues }: Props) {
  const [graph, setGraph] = useState<SimGraphResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    void fetchGraph(meta.slug)
      .then((g) => {
        if (!cancelled) setGraph(g);
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : "graph fetch failed");
      });
    return () => {
      cancelled = true;
    };
  }, [meta.slug]);

  const { nodes, edges } = useMemo(() => {
    if (!graph) return { nodes: [] as Node<DriverNodeData>[], edges: [] as Edge[] };
    return buildFlow(graph, driverValues);
  }, [graph, driverValues]);

  if (error) {
    return (
      <div className="rounded-lg border border-red-900/60 bg-red-950/40 p-4 text-sm text-red-300">
        그래프 로드 실패: {error}
      </div>
    );
  }

  if (!graph) {
    return (
      <div className="rounded-lg border border-neutral-800 bg-neutral-900/30 p-4 text-sm text-neutral-500">
        그래프 로드 중…
      </div>
    );
  }

  if (graph.nodes.length === 0) {
    return (
      <div className="rounded-lg border border-neutral-800 bg-neutral-900/30 p-4 text-sm text-neutral-500">
        이 섹터는 아직 dependency graph가 등록되지 않았습니다. Phase 2 후반 슬라이스에서
        에이전트가 자동 생성할 예정입니다.
      </div>
    );
  }

  const counts = countByKind(graph.nodes);

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
          <span className="ml-auto text-[10px] text-neutral-600">
            {graph.edges.length} edges · authored, agent-generated in a later slice
          </span>
        </div>
        <p>
          왼쪽 드라이버 → 중간 계산 → 오른쪽 산출물로 흐르는 인과 그래프. 노드를 클릭하면
          연결된 edge가 강조되고, drag로 위치 조정이 가능합니다.
        </p>
      </div>
      <div className="h-[640px] overflow-hidden rounded-lg border border-neutral-800 bg-neutral-950">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={NODE_TYPES}
          fitView
          fitViewOptions={{ padding: 0.15 }}
          minZoom={0.2}
          maxZoom={1.5}
          proOptions={REACTFLOW_PRO_OPTIONS}
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
      </div>
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

const KIND_COLORS: Record<"driver" | "intermediate" | "output", KindStyle> = {
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
};

function colorFor(kind: string): KindStyle {
  if (kind === "driver" || kind === "intermediate" || kind === "output") {
    return KIND_COLORS[kind];
  }
  return KIND_COLORS.intermediate;
}

function GraphFlowNode({ data }: NodeProps<DriverNodeData>) {
  const c = colorFor(data.kind);
  return (
    <div
      className={`rounded-md border ${c.border} ${c.bg} px-2.5 py-1.5 shadow-sm`}
      style={{ minWidth: 140, maxWidth: 200 }}
      title={data.description || undefined}
    >
      <Handle type="target" position={Position.Left} className="!h-2 !w-2 !bg-neutral-700" />
      <div className="flex items-baseline justify-between gap-1.5">
        <span className={`text-[11px] font-semibold ${c.accent}`}>{data.label}</span>
        {data.unit && (
          <span className="text-[9px] text-neutral-500">{data.unit}</span>
        )}
      </div>
      {data.value !== undefined && (
        <div className="mt-0.5 text-[10px] tabular-nums text-neutral-200">
          {formatDriverValue(data.value, data.unit)}
        </div>
      )}
      {data.group && data.kind !== "driver" && (
        <div className="mt-0.5 text-[9px] uppercase tracking-wider text-neutral-600">
          {data.group}
        </div>
      )}
      <Handle type="source" position={Position.Right} className="!h-2 !w-2 !bg-neutral-700" />
    </div>
  );
}

const NODE_TYPES = { sim: GraphFlowNode };

/**
 * Hand-rolled layout: stack nodes by kind into three columns, within each
 * column stack vertically by group, then by id. Spacing is tuned for the
 * 14-driver / ~10-intermediate / ~5-output graphs we ship today. If graphs
 * grow well beyond that, swap this for dagre.
 */
function buildFlow(
  g: SimGraphResponse,
  driverValues: Record<string, number>,
): { nodes: Node<DriverNodeData>[]; edges: Edge[] } {
  const COLS = { driver: 0, intermediate: 1, output: 2 } as const;
  const COL_X = [40, 480, 980];
  const ROW_HEIGHT = 78;
  const GROUP_GAP = 28;

  const byCol: Record<string, GraphNode[]> = { driver: [], intermediate: [], output: [] };
  for (const n of g.nodes) {
    const col = (n.kind in COLS ? n.kind : "intermediate") as keyof typeof COLS;
    byCol[col]!.push(n);
  }

  // Within each column, group → id (stable + readable).
  for (const col of Object.keys(byCol)) {
    byCol[col]!.sort((a, b) => {
      if (a.group !== b.group) return a.group.localeCompare(b.group);
      return a.id.localeCompare(b.id);
    });
  }

  const nodes: Node<DriverNodeData>[] = [];
  for (const col of Object.keys(byCol) as (keyof typeof COLS)[]) {
    let y = 30;
    let lastGroup: string | null = null;
    for (const n of byCol[col]!) {
      if (lastGroup !== null && n.group !== lastGroup) y += GROUP_GAP;
      lastGroup = n.group;
      nodes.push({
        id: n.id,
        type: "sim",
        position: { x: COL_X[COLS[col]]!, y },
        data: {
          label: n.label || prettyName(n.id),
          kind: n.kind,
          unit: n.unit,
          group: n.group,
          description: n.description,
          value: n.kind === "driver" ? driverValues[n.id] : undefined,
        },
      });
      y += ROW_HEIGHT;
    }
  }

  const edges: Edge[] = g.edges.map((e, i) => ({
    id: `${e.source}->${e.target}-${i}`,
    source: e.source,
    target: e.target,
    label: e.label || undefined,
  }));

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
