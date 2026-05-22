/**
 * `agent.*` procedures — thin proxy over services/agent-orchestration.
 *
 * Schema convention: mirror the upstream Pydantic shapes here as zod
 * objects. Duplicated on purpose (boundary is explicit), same pattern
 * as sim.ts.
 */

import { TRPCError } from "@trpc/server";
import { z } from "zod";

import { agentFetch } from "../lib/agent-proxy.js";
import { checkBudget, readBudget } from "../lib/budget.js";
import { publicProcedure, router } from "./init.js";
import type { Context } from "./context.js";

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

// M28 — dormant prompts as live workflows. Standalone Research takes
// just a description; the four downstream agents take pre-structured
// upstream output (admin UI assembles it from prior workflow records).
const ResearchStartInput = z.object({
  description: z.string().min(10).max(4000),
  focus_areas: z.array(z.string().max(200)).max(20).default([]),
});

// `passthrough()` on the Decomposition shape would let new fields flow
// through without bumping schemas in lockstep, but we'd lose the
// guarantee that what the orchestrator receives matches what the
// downstream agents expect. Keep the explicit shape; bump both sides
// together when the contract changes.
const DriverInferenceStartInput = z.object({
  decomposition: Decomposition,
  research_brief: z
    .object({
      summary: z.string(),
      anchors: z.array(z.record(z.unknown())).default([]),
      open_questions: z.array(z.string()).default([]),
    })
    .nullable()
    .optional(),
});

const DriverInferenceResultShape = z.object({
  drivers: z.array(z.record(z.unknown())),
  unresolved: z.array(z.string()).default([]),
});

const EdgeInferenceResultShape = z.object({
  edges: z.array(
    z.object({ source: z.string(), target: z.string(), label: z.string() }),
  ),
  intermediates: z.array(z.record(z.unknown())).default([]),
  outputs: z.array(z.record(z.unknown())),
  assumptions: z.array(z.string()).default([]),
});

const CodeGenStartInput = z.object({
  slug: z.string().min(1).max(64),
  decomposition: Decomposition,
  driver_inference: DriverInferenceResultShape,
  edge_inference: EdgeInferenceResultShape,
});

const CodeReviewStartInput = z.object({
  source: z.string().min(1).max(200_000),
  decomposition: Decomposition,
  driver_inference: DriverInferenceResultShape,
  edge_inference: EdgeInferenceResultShape,
  concerns: z.array(z.string()).default([]),
});

const FullPipelineStartInput = z.object({
  description: z.string().min(10).max(4000),
  reference_data: z.string().max(20000).optional(),
  focus_areas: z.array(z.string().max(200)).max(20).default([]),
});

const WorkflowIdInput = z.object({ id: z.string().min(1) });

const WorkflowListInput = z.object({
  kind: z.string().optional(),
  limit: z.number().int().positive().max(200).default(50),
});

// ---------- Helper: kick off + tag a workflow ----------------------------

/**
 * Shared boilerplate for every M28 workflow mutation:
 * 1. require auth (UNAUTHORIZED if missing)
 * 2. check the per-user agent budget (FORBIDDEN if exceeded)
 * 3. POST to agent-orchestration
 * 4. tag the resulting workflow with user_id (best-effort, so the
 *    budget counter can find it on the next call)
 *
 * Returns the workflow envelope unchanged so the procedure passes it
 * to the typed output schema.
 */
async function startAgentWorkflow(
  ctx: Context,
  path: string,
  body: unknown,
  context: string,
): Promise<z.infer<typeof WorkflowRecord>> {
  if (!ctx.user) {
    throw new TRPCError({
      code: "UNAUTHORIZED",
      message: "에이전트 워크플로 실행은 로그인이 필요합니다.",
    });
  }
  await checkBudget(ctx.user.id);
  const wf = await agentFetch<{ id: string }>(path, {
    method: "POST",
    body,
    context,
  });
  try {
    await ctx.prisma.agentWorkflow.update({
      where: { id: wf.id },
      data: { user_id: ctx.user.id },
    });
  } catch (e) {
    ctx.log.warn(
      { err: e, wf_id: wf.id },
      "agent workflow user_id tag failed",
    );
  }
  return wf as unknown as z.infer<typeof WorkflowRecord>;
}

// ---------- Procedures ----------------------------------------------------

export const agentRouter = router({
  startDecomposition: publicProcedure
    .input(DecompositionStartInput)
    .output(WorkflowRecord)
    .mutation(async ({ ctx, input }) => {
      if (!ctx.user) {
        throw new TRPCError({
          code: "UNAUTHORIZED",
          message: "에이전트 시뮬레이터 생성은 로그인이 필요합니다.",
        });
      }
      await checkBudget(ctx.user.id);
      const wf = await agentFetch<{ id: string }>("/workflows/decompose", {
        method: "POST",
        body: {
          description: input.description,
          reference_data: input.reference_data ?? null,
        },
        context: "agent.startDecomposition",
      });
      // Tag the workflow with the user_id post-hoc so the budget
      // counter can find it. Idempotent: a future double-tag is a
      // no-op since the column allows the same value.
      try {
        await ctx.prisma.agentWorkflow.update({
          where: { id: wf.id },
          data: { user_id: ctx.user.id },
        });
      } catch (e) {
        ctx.log.warn(
          { err: e, wf_id: wf.id },
          "agent workflow user_id tag failed",
        );
      }
      return wf as unknown as z.infer<typeof WorkflowRecord>;
    }),

  startProposeSector: publicProcedure
    .input(ProposeSectorStartInput)
    .output(WorkflowRecord)
    .mutation(async ({ ctx, input }) => {
      if (!ctx.user) {
        throw new TRPCError({
          code: "UNAUTHORIZED",
          message: "에이전트 시뮬레이터 생성은 로그인이 필요합니다.",
        });
      }
      await checkBudget(ctx.user.id);
      const wf = await agentFetch<{ id: string }>(
        "/workflows/propose-sector",
        {
          method: "POST",
          body: {
            description: input.description,
            reference_data: input.reference_data ?? null,
          },
          context: "agent.startProposeSector",
        },
      );
      try {
        await ctx.prisma.agentWorkflow.update({
          where: { id: wf.id },
          data: { user_id: ctx.user.id },
        });
      } catch (e) {
        ctx.log.warn(
          { err: e, wf_id: wf.id },
          "agent workflow user_id tag failed",
        );
      }
      return wf as unknown as z.infer<typeof WorkflowRecord>;
    }),

  /**
   * M28 — Research Agent (Sonnet). Standalone entry point; the
   * full-pipeline workflow runs the same agent as its first stage.
   */
  startResearch: publicProcedure
    .input(ResearchStartInput)
    .output(WorkflowRecord)
    .mutation(async ({ ctx, input }) =>
      startAgentWorkflow(ctx, "/workflows/research", input, "agent.startResearch"),
    ),

  /**
   * M28 — Driver Inference Agent (Sonnet). Takes a decomposition +
   * optional research brief (both come from prior workflow outputs;
   * the client assembles them).
   */
  startDriverInference: publicProcedure
    .input(DriverInferenceStartInput)
    .output(WorkflowRecord)
    .mutation(async ({ ctx, input }) =>
      startAgentWorkflow(
        ctx,
        "/workflows/driver-inference",
        input,
        "agent.startDriverInference",
      ),
    ),

  /**
   * M28 — Code Gen Agent (Sonnet). Takes the full structured spec,
   * returns the SimulationBase subclass source as a string. Not
   * executed here; Modal sandbox is a future slice.
   */
  startCodeGen: publicProcedure
    .input(CodeGenStartInput)
    .output(WorkflowRecord)
    .mutation(async ({ ctx, input }) =>
      startAgentWorkflow(
        ctx,
        "/workflows/code-gen",
        input,
        "agent.startCodeGen",
      ),
    ),

  /**
   * M28 — Code Review Agent (Sonnet). Returns approve/revise/reject
   * with severity-tagged findings.
   */
  startCodeReview: publicProcedure
    .input(CodeReviewStartInput)
    .output(WorkflowRecord)
    .mutation(async ({ ctx, input }) =>
      startAgentWorkflow(
        ctx,
        "/workflows/code-review",
        input,
        "agent.startCodeReview",
      ),
    ),

  /**
   * M28 — Headline workflow: chains all six agents (research →
   * decomposition → driver_inference → edge_inference → code_gen →
   * code_review). Typical cost $0.50–$1.00; gated by per-user budget.
   */
  startFullPipeline: publicProcedure
    .input(FullPipelineStartInput)
    .output(WorkflowRecord)
    .mutation(async ({ ctx, input }) =>
      startAgentWorkflow(
        ctx,
        "/workflows/full-pipeline",
        input,
        "agent.startFullPipeline",
      ),
    ),

  /**
   * Surface the current user's agent budget to the client — used by
   * Settings' "이번 달 사용량" meter + the /propose flow's pre-submit
   * sanity check.
   */
  budget: publicProcedure
    .output(
      z.object({
        tier: z.enum(["free", "premium"]),
        limit_usd: z.number(),
        used_usd: z.number(),
        remaining_usd: z.number(),
        exhausted: z.boolean(),
        in_flight: z.number().int(),
        concurrent_limit: z.number().int(),
        beta_free: z.boolean(),
      }),
    )
    .query(async ({ ctx }) => {
      const betaFree =
        (await import("../lib/env.js")).env().AGENT_BETA_FREE;
      if (!ctx.user) {
        return {
          tier: "free" as const,
          limit_usd: 0,
          used_usd: 0,
          remaining_usd: 0,
          exhausted: true,
          in_flight: 0,
          concurrent_limit: 0,
          beta_free: betaFree,
        };
      }
      const snap = await readBudget(ctx.user.id);
      return { ...snap, beta_free: betaFree };
    }),

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
