/**
 * Typed tRPC client for the admin app. Same shape as apps/web's client —
 * kept in-app rather than extracted to a shared package because the admin
 * surface will diverge as more admin-specific procedures land (ingest
 * controls, approval workflow, etc.) and we don't want to bend the user
 * client around admin needs.
 */

import type { AppRouter } from "@platform/sector-service";
import { createTRPCClient, httpBatchLink, TRPCClientError } from "@trpc/client";
import type { inferRouterOutputs } from "@trpc/server";

const BROWSER_BASE = "/api/sim/trpc";
const SERVER_BASE = `${process.env.SECTOR_SERVICE_URL ?? "http://localhost:8001"}/trpc`;
const TRPC_URL = typeof window === "undefined" ? SERVER_BASE : BROWSER_BASE;

export const SECTOR_SERVICE_URL =
  process.env.SECTOR_SERVICE_URL ?? "http://localhost:8001";

export const trpc = createTRPCClient<AppRouter>({
  links: [
    httpBatchLink({
      url: TRPC_URL,
      fetch: (input, init) => fetch(input, { ...init, cache: "no-store" }),
    }),
  ],
});

type RouterOutput = inferRouterOutputs<AppRouter>;

export type SimMetadata = RouterOutput["sim"]["get"];
export type DriverSchema = SimMetadata["drivers"][number];
export type ProvenanceSchema = SimMetadata["provenance"][string];
export type SourceSchema = ProvenanceSchema["sources"][number];
export type Scenario = RouterOutput["scenario"]["get"];
export type AgentWorkflow = RouterOutput["agent"]["getWorkflow"];
/** M22a EdgeInferenceResult shape — used by ProposeSectorWorkflow output. */
export type AgentEdgeInference = {
  edges: { source: string; target: string; label: string }[];
  intermediates: {
    name: string;
    formula: string;
    unit: string;
    description: string;
  }[];
  outputs: {
    name: string;
    formula: string;
    kind: "scalar" | "series";
    depends_on: string[];
  }[];
  assumptions: string[];
};

/** Composite output of ProposeSectorWorkflow. */
export type AgentProposeSectorResult = {
  decomposition: AgentDecomposition;
  edge_inference: AgentEdgeInference;
};

export type AgentDecomposition = {
  // Mirror of the orchestration Decomposition shape; the upstream
  // procedure types this as `Record<string, unknown>` because the
  // tRPC schema doesn't model the dynamic output, so we narrow it
  // here for the admin UI's benefit.
  name: string;
  slug: string;
  description: string;
  horizon_years: number;
  drivers: {
    name: string;
    group: string;
    unit: string;
    default: number;
    min: number;
    max: number;
    description: string;
  }[];
  intermediates: { name: string; unit: string; description: string }[];
  outputs: {
    name: string;
    kind: "scalar" | "series";
    unit: string;
    description: string;
  }[];
};

export async function fetchSims(): Promise<SimMetadata[]> {
  // Admin sees everything (drafts + archived included) — the per-row
  // status badge handles the visual distinction.
  return rethrow(
    () => trpc.sim.list.query({ include_non_live: true }),
    "fetchSims",
  );
}

export async function fetchSim(slug: string): Promise<SimMetadata> {
  return rethrow(() => trpc.sim.get.query({ slug }), `fetchSim(${slug})`);
}

export async function fetchScenarios(sectorSlug?: string): Promise<Scenario[]> {
  return rethrow(
    () =>
      trpc.scenario.list.query({
        sector_slug: sectorSlug,
        limit: 200,
      }),
    `fetchScenarios(${sectorSlug ?? "*"})`,
  );
}

// ---------- Agent (orchestration proxy) ----------

export async function startDecomposition(input: {
  description: string;
  reference_data?: string;
}): Promise<AgentWorkflow> {
  return rethrow(
    () => trpc.agent.startDecomposition.mutate(input),
    "startDecomposition",
  );
}

export async function startProposeSector(input: {
  description: string;
  reference_data?: string;
}): Promise<AgentWorkflow> {
  return rethrow(
    () => trpc.agent.startProposeSector.mutate(input),
    "startProposeSector",
  );
}

export async function getAgentWorkflow(id: string): Promise<AgentWorkflow> {
  return rethrow(
    () => trpc.agent.getWorkflow.query({ id }),
    `getAgentWorkflow(${id})`,
  );
}

export async function listAgentWorkflows(input: {
  kind?: string;
  limit?: number;
} = {}): Promise<AgentWorkflow[]> {
  return rethrow(
    () =>
      trpc.agent.listWorkflows.query({
        kind: input.kind,
        limit: input.limit ?? 50,
      }),
    "listAgentWorkflows",
  );
}

export async function cancelAgentWorkflow(id: string): Promise<AgentWorkflow> {
  return rethrow(
    () => trpc.agent.cancelWorkflow.mutate({ id }),
    `cancelAgentWorkflow(${id})`,
  );
}

// ---------- Audit / Lifecycle / Monitoring (M18) ----------

export type AuditLog = RouterOutput["audit"]["list"]["rows"][number];
export type AuditList = RouterOutput["audit"]["list"];
export type AuditFacets = RouterOutput["audit"]["facets"];
export type LifecycleCandidates = RouterOutput["lifecycle"]["candidates"];
export type LifecycleCandidate = LifecycleCandidates["candidates"][number];
export type LifecycleReviewResult = RouterOutput["lifecycle"]["review"];
export type MonitoringHealth = RouterOutput["monitoring"]["health"];

export async function listAudit(
  input: {
    limit?: number;
    before?: string;
    sector_slug?: string;
    action_prefix?: string;
    author_label?: string;
  } = {},
): Promise<AuditList> {
  return rethrow(
    () =>
      trpc.audit.list.query({
        limit: input.limit ?? 50,
        before: input.before,
        sector_slug: input.sector_slug,
        action_prefix: input.action_prefix,
        author_label: input.author_label,
      }),
    "listAudit",
  );
}

export async function fetchAuditFacets(): Promise<AuditFacets> {
  return rethrow(() => trpc.audit.facets.query(), "fetchAuditFacets");
}

export async function fetchLifecycleCandidates(
  opts: { equity_stale_days?: number; sector_cold_days?: number } = {},
): Promise<LifecycleCandidates> {
  return rethrow(
    () => trpc.lifecycle.candidates.query(opts),
    "fetchLifecycleCandidates",
  );
}

export async function reviewLifecycleCandidate(input: {
  category: LifecycleCandidate["category"];
  ref_id: string;
  sector_slug?: string | null;
  action: "keep" | "defer" | "approve_deprecate";
  defer_until?: string;
  reason?: string;
  author_label?: string;
}): Promise<LifecycleReviewResult> {
  return rethrow(
    () => trpc.lifecycle.review.mutate(input),
    `reviewLifecycleCandidate(${input.category}/${input.ref_id})`,
  );
}

export async function fetchMonitoringHealth(): Promise<MonitoringHealth> {
  return rethrow(() => trpc.monitoring.health.query(), "fetchMonitoringHealth");
}

// ---------- Sector lifecycle (M21) ----------

export type SectorRow = RouterOutput["sector"]["list"][number];
export type SectorProposeResult = RouterOutput["sector"]["proposeFromAgent"];

export async function listSectors(
  status?: "live" | "draft" | "archived",
): Promise<SectorRow[]> {
  return rethrow(
    () =>
      trpc.sector.list.query({
        ...(status ? { status } : {}),
      }),
    `listSectors(${status ?? "any"})`,
  );
}

export async function proposeSectorFromAgent(input: {
  workflow_id: string;
  slug?: string;
  name?: string;
  description?: string;
}): Promise<SectorProposeResult> {
  return rethrow(
    () => trpc.sector.proposeFromAgent.mutate(input),
    `proposeSectorFromAgent(${input.workflow_id})`,
  );
}

export async function activateSector(slug: string): Promise<SectorRow> {
  return rethrow(
    () => trpc.sector.activate.mutate({ slug }),
    `activateSector(${slug})`,
  );
}

export async function archiveSector(slug: string): Promise<SectorRow> {
  return rethrow(
    () => trpc.sector.archive.mutate({ slug }),
    `archiveSector(${slug})`,
  );
}

export async function sectorToDraft(slug: string): Promise<SectorRow> {
  return rethrow(
    () => trpc.sector.toDraft.mutate({ slug }),
    `sectorToDraft(${slug})`,
  );
}

async function rethrow<T>(fn: () => Promise<T>, label: string): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof TRPCClientError) {
      throw new Error(`${label} failed: ${e.message}`);
    }
    throw e;
  }
}
