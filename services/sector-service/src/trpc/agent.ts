/**
 * `agent.*` procedures — thin proxy over services/agent-orchestration.
 *
 * Schema convention: mirror the upstream Pydantic shapes here as zod
 * objects. Duplicated on purpose (boundary is explicit), same pattern
 * as sim.ts.
 */

import { z } from "zod";

import { agentFetch } from "../lib/agent-proxy.js";
import { publicProcedure, router } from "./init.js";

// ---------- Domain: decomposition output ----------------------------------

const DriverNode = z.object({
  name: z.string(),
  group: z.string(),
  unit: z.string(),
  default: z.number(),
  min: z.number(),
  max: z.number(),
  description: z.string(),
});

const IntermediateNode = z.object({
  name: z.string(),
  unit: z.string(),
  description: z.string(),
});

const OutputNode = z.object({
  name: z.string(),
  kind: z.enum(["scalar", "series"]),
  unit: z.string(),
  description: z.string(),
});

const Decomposition = z.object({
  name: z.string(),
  slug: z.string(),
  description: z.string(),
  horizon_years: z.number().int(),
  drivers: z.array(DriverNode),
  intermediates: z.array(IntermediateNode),
  outputs: z.array(OutputNode),
});

// ---------- Workflow envelope ---------------------------------------------

const WorkflowStatus = z.enum([
  "pending",
  "running",
  "succeeded",
  "failed",
  "cancelled",
]);

const WorkflowRecord = z.object({
  id: z.string(),
  kind: z.string(),
  status: WorkflowStatus,
  created_at: z.string(),
  updated_at: z.string(),
  input: z.record(z.unknown()),
  output: z.record(z.unknown()).nullable(),
  error: z.string().nullable(),
  cost_usd: z.number(),
});

// ---------- Inputs --------------------------------------------------------

const DecompositionStartInput = z.object({
  description: z.string().min(10).max(4000),
  reference_data: z.string().max(20000).optional(),
});

// Same surface as DecompositionStartInput today — kept distinct because
// the propose-sector pipeline may grow new options (e.g. opt-out of the
// EdgeInference stage when the topology is already known).
const ProposeSectorStartInput = z.object({
  description: z.string().min(10).max(4000),
  reference_data: z.string().max(20000).optional(),
});

const WorkflowIdInput = z.object({ id: z.string().min(1) });

const WorkflowListInput = z.object({
  kind: z.string().optional(),
  limit: z.number().int().positive().max(200).default(50),
});

// ---------- Procedures ----------------------------------------------------

export const agentRouter = router({
  startDecomposition: publicProcedure
    .input(DecompositionStartInput)
    .output(WorkflowRecord)
    .mutation(({ input }) =>
      agentFetch("/workflows/decompose", {
        method: "POST",
        body: {
          description: input.description,
          reference_data: input.reference_data ?? null,
        },
        context: "agent.startDecomposition",
      }),
    ),

  startProposeSector: publicProcedure
    .input(ProposeSectorStartInput)
    .output(WorkflowRecord)
    .mutation(({ input }) =>
      agentFetch("/workflows/propose-sector", {
        method: "POST",
        body: {
          description: input.description,
          reference_data: input.reference_data ?? null,
        },
        context: "agent.startProposeSector",
      }),
    ),

  getWorkflow: publicProcedure
    .input(WorkflowIdInput)
    .output(WorkflowRecord)
    .query(({ input }) =>
      agentFetch(`/workflows/${encodeURIComponent(input.id)}`, {
        context: `agent.getWorkflow:${input.id}`,
      }),
    ),

  listWorkflows: publicProcedure
    .input(WorkflowListInput)
    .output(z.array(WorkflowRecord))
    .query(({ input }) => {
      const params = new URLSearchParams();
      if (input.kind) params.set("kind", input.kind);
      params.set("limit", String(input.limit));
      return agentFetch(`/workflows?${params.toString()}`, {
        context: "agent.listWorkflows",
      });
    }),

  cancelWorkflow: publicProcedure
    .input(WorkflowIdInput)
    .output(WorkflowRecord)
    .mutation(({ input }) =>
      agentFetch(`/workflows/${encodeURIComponent(input.id)}/cancel`, {
        method: "POST",
        context: `agent.cancelWorkflow:${input.id}`,
      }),
    ),
});
