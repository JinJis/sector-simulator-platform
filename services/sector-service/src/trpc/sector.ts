/**
 * `sector.*` procedures — DB-level sector lifecycle.
 *
 * The Python `simulation-service` has its own /sims registry (the
 * in-code sim classes). Those are the *runtime* sims. The `sectors`
 * table is the *metadata layer* — it records what the platform knows
 * about: which sectors are live, which are agent-proposed drafts
 * pending Python implementation, which are archived.
 *
 * M21 lands the draft-from-agent path: an admin reviews an
 * `agent_workflows` row (status = succeeded, kind = decomposition),
 * promotes its Decomposition output to a `sectors` row + matching
 * `graph_nodes`. Activation (draft → live) and archival flip the
 * status field. Audit log captures every transition.
 */

import { TRPCError } from "@trpc/server";
import { z } from "zod";

import { simFetch } from "../lib/sim-proxy.js";
import { publicProcedure, router } from "./init.js";

/**
 * Tell simulation-service to drop its cached GenericDagSim for this
 * slug so the next sim.* call re-reads the DB. Fail-soft: a network
 * blip shouldn't roll back an otherwise-good DB transition.
 */
async function reloadUpstream(slug: string, ctx_log: import("fastify").FastifyBaseLogger): Promise<void> {
  try {
    await simFetch(`/sims/${slug}/reload`, {
      method: "POST",
      context: `sims-reload:${slug}`,
    });
  } catch (e) {
    ctx_log.warn(
      { slug, err: e instanceof Error ? e.message : String(e) },
      "sims-reload upstream failed; cache may be stale until next reload",
    );
  }
}

// ---------- Schemas ----------

const SectorStatus = z.enum(["live", "draft", "archived"]);

const SectorOut = z.object({
  id: z.string(),
  slug: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  source_module: z.string().nullable(),
  status: z.string(),
  agent_workflow_id: z.string().nullable(),
  created_by_user_id: z.string().nullable(),
  created_at: z.date(),
  updated_at: z.date(),
});

const ListInput = z
  .object({
    status: SectorStatus.optional(),
    limit: z.number().int().positive().max(200).default(100),
  })
  .default({});

const ProposeFromAgentInput = z.object({
  workflow_id: z.string().min(1),
  /**
   * Optional overrides — if the agent's proposed slug or name need
   * tweaking before persisting, the admin can pass them through here.
   * Slug must match `[a-z0-9-]+`; collisions resolved by suffixing.
   */
  slug: z.string().regex(/^[a-z0-9-]+$/).max(80).optional(),
  name: z.string().min(1).max(120).optional(),
  description: z.string().max(2000).optional(),
  author_label: z.string().max(120).optional(),
});

const SlugInput = z.object({
  slug: z.string().min(1),
  author_label: z.string().max(120).optional(),
});

// Mirror of `agent.Decomposition` — duplicated here so this router
// validates the JSONB payload without import-cycling through the agent
// router.
const Decomposition = z.object({
  name: z.string(),
  slug: z.string(),
  description: z.string(),
  horizon_years: z.number().int(),
  drivers: z.array(
    z.object({
      name: z.string(),
      group: z.string(),
      unit: z.string(),
      default: z.number(),
      min: z.number(),
      max: z.number(),
      description: z.string(),
    }),
  ),
  intermediates: z.array(
    z.object({
      name: z.string(),
      unit: z.string(),
      description: z.string(),
    }),
  ),
  outputs: z.array(
    z.object({
      name: z.string(),
      kind: z.enum(["scalar", "series"]),
      unit: z.string(),
      description: z.string(),
    }),
  ),
});

// EdgeInferenceResult shape from M22a.
const EdgeInferenceResult = z.object({
  edges: z.array(
    z.object({
      source: z.string(),
      target: z.string(),
      label: z.string().default(""),
    }),
  ),
  intermediates: z
    .array(
      z.object({
        name: z.string(),
        formula: z.string(),
        unit: z.string().default(""),
        description: z.string().default(""),
      }),
    )
    .default([]),
  outputs: z
    .array(
      z.object({
        name: z.string(),
        formula: z.string(),
        kind: z.enum(["scalar", "series"]),
        depends_on: z.array(z.string()).default([]),
      }),
    )
    .default([]),
  assumptions: z.array(z.string()).default([]),
});

// Composite output of ProposeSectorWorkflow.
const ProposeSectorResult = z.object({
  decomposition: Decomposition,
  edge_inference: EdgeInferenceResult,
});

// ---------- Helpers ----------

async function findUniqueSlug(
  prisma: import("@platform/db").PrismaClient,
  preferred: string,
): Promise<string> {
  const base = preferred;
  let candidate = base;
  let n = 1;
  // Bounded loop — if 50 collisions happen something's wrong, surface
  // it rather than loop forever.
  while (n < 50) {
    const hit = await prisma.sector.findUnique({ where: { slug: candidate } });
    if (!hit) return candidate;
    n += 1;
    candidate = `${base}-${n}`;
  }
  throw new TRPCError({
    code: "INTERNAL_SERVER_ERROR",
    message: `slug collision storm starting at "${base}"`,
  });
}

// ---------- Procedures ----------

export const sectorRouter = router({
  list: publicProcedure
    .input(ListInput)
    .output(z.array(SectorOut))
    .query(async ({ ctx, input }) => {
      const rows = await ctx.prisma.sector.findMany({
        where: input.status ? { status: input.status } : undefined,
        orderBy: [{ status: "asc" }, { created_at: "desc" }],
        take: input.limit,
      });
      return rows as z.infer<typeof SectorOut>[];
    }),

  get: publicProcedure
    .input(z.object({ slug: z.string().min(1) }))
    .output(SectorOut)
    .query(async ({ ctx, input }) => {
      const row = await ctx.prisma.sector.findUnique({
        where: { slug: input.slug },
      });
      if (!row) throw new TRPCError({ code: "NOT_FOUND", message: `sector ${input.slug}` });
      return row as z.infer<typeof SectorOut>;
    }),

  /**
   * M25c: sectors created by the current user. Auth-required. Used
   * by the /my-sectors page so each user can see + manage their own
   * agent-proposed sectors.
   */
  listMine: publicProcedure
    .output(z.array(SectorOut))
    .query(async ({ ctx }) => {
      if (!ctx.user) {
        throw new TRPCError({
          code: "UNAUTHORIZED",
          message: "내가 만든 섹터는 로그인 후 확인할 수 있습니다.",
        });
      }
      const rows = await ctx.prisma.sector.findMany({
        where: { created_by_user_id: ctx.user.id },
        orderBy: { created_at: "desc" },
      });
      return rows as z.infer<typeof SectorOut>[];
    }),

  /**
   * M25c: a user can delete a sector *they* created (any status).
   * Admins and the 3 seed sims aren't reachable through this because
   * the where-clause is anchored to `created_by_user_id = ctx.user.id`.
   */
  deleteMine: publicProcedure
    .input(SlugInput)
    .output(z.object({ ok: z.boolean(), slug: z.string() }))
    .mutation(async ({ ctx, input }) => {
      if (!ctx.user) {
        throw new TRPCError({
          code: "UNAUTHORIZED",
          message: "삭제는 로그인이 필요합니다.",
        });
      }
      const sector = await ctx.prisma.sector.findUnique({
        where: { slug: input.slug },
      });
      if (!sector) {
        throw new TRPCError({ code: "NOT_FOUND", message: `sector ${input.slug}` });
      }
      if (sector.created_by_user_id !== ctx.user.id) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "이 섹터는 다른 사용자가 만들었습니다.",
        });
      }
      // Hard delete — cascades through graph_nodes / graph_edges /
      // scenarios / sector_equities (none expected on agent-generated
      // sectors today, but the FKs are set up to cascade).
      await ctx.prisma.sector.delete({ where: { slug: input.slug } });
      await ctx.prisma.auditLog.create({
        data: {
          action: "sector.deleteMine",
          sector_slug: input.slug,
          payload: { user_id: ctx.user.id, slug: input.slug },
          author_label: input.author_label ?? ctx.user.label ?? "anonymous",
        },
      });
      // Bust the upstream sim cache so /sims stops surfacing it.
      await reloadUpstream(input.slug, ctx.log);
      return { ok: true, slug: input.slug };
    }),

  proposeFromAgent: publicProcedure
    .input(ProposeFromAgentInput)
    .output(
      z.object({
        sector: SectorOut,
        node_counts: z.object({
          driver: z.number().int(),
          intermediate: z.number().int(),
          output: z.number().int(),
        }),
        edge_count: z.number().int(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      // 1. Fetch + validate the source workflow.
      const wf = await ctx.prisma.agentWorkflow.findUnique({
        where: { id: input.workflow_id },
      });
      if (!wf) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: `agent workflow ${input.workflow_id} not found`,
        });
      }
      if (wf.status !== "succeeded") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `workflow ${input.workflow_id} status is "${wf.status}" — only succeeded workflows can be promoted`,
        });
      }

      // 2. Branch on workflow kind:
      //    - decomposition: nodes only (no edges)
      //    - propose_sector: nodes + agent-inferred edges (M22a)
      let decomp: z.infer<typeof Decomposition>;
      let edgeInference: z.infer<typeof EdgeInferenceResult> | null = null;
      if (wf.kind === "decomposition") {
        const parsed = Decomposition.safeParse(wf.output);
        if (!parsed.success) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: `workflow output does not match Decomposition schema: ${parsed.error.message}`,
          });
        }
        decomp = parsed.data;
      } else if (wf.kind === "propose_sector") {
        const parsed = ProposeSectorResult.safeParse(wf.output);
        if (!parsed.success) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: `workflow output does not match ProposeSectorResult schema: ${parsed.error.message}`,
          });
        }
        decomp = parsed.data.decomposition;
        edgeInference = parsed.data.edge_inference;
      } else {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `workflow kind "${wf.kind}" not supported — expected "decomposition" or "propose_sector"`,
        });
      }

      // 3. Resolve final slug / name / description (caller overrides win).
      const preferredSlug = (input.slug ?? decomp.slug)
        .toLowerCase()
        .replace(/[^a-z0-9-]+/g, "-")
        .replace(/^-+|-+$/g, "");
      if (!preferredSlug) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "could not derive a usable slug from the workflow output",
        });
      }
      const finalSlug = await findUniqueSlug(ctx.prisma, preferredSlug);
      const finalName = input.name ?? decomp.name;
      const finalDescription = input.description ?? decomp.description;

      // 4. Transaction: create Sector + GraphNodes + AuditLog.
      const author = input.author_label ?? ctx.user?.label ?? "anonymous";
      const result = await ctx.prisma.$transaction(async (tx) => {
        const sector = await tx.sector.create({
          data: {
            slug: finalSlug,
            name: finalName,
            description: finalDescription,
            // No Python sim yet — GenericDagSim (M22b) evaluates the
            // agent-inferred formulas at runtime once the sector is
            // activated.
            source_module: null,
            status: "draft",
            agent_workflow_id: wf.id,
            // M25a: record who created this so the /my-sectors page
            // can list it. Anonymous propose-from-agent rows stay
            // null (admin-driven legacy path).
            created_by_user_id: ctx.user?.id ?? null,
          },
        });

        // Driver nodes
        const driverGroups = new Set<string>();
        for (const d of decomp.drivers) {
          await tx.graphNode.create({
            data: {
              sector_slug: sector.slug,
              node_key: d.name,
              kind: "driver",
              label: d.name,
              group: d.group,
              unit: d.unit || null,
              description: d.description || null,
            },
          });
          driverGroups.add(d.group);
        }
        // Intermediate nodes
        for (const i of decomp.intermediates) {
          await tx.graphNode.create({
            data: {
              sector_slug: sector.slug,
              node_key: i.name,
              kind: "intermediate",
              label: i.name,
              group: "Intermediate",
              unit: i.unit || null,
              description: i.description || null,
            },
          });
        }
        // Output nodes
        for (const o of decomp.outputs) {
          await tx.graphNode.create({
            data: {
              sector_slug: sector.slug,
              node_key: o.name,
              kind: "output",
              label: o.name,
              group: o.kind === "scalar" ? "Scalar output" : "Trajectory output",
              unit: o.unit || null,
              description: o.description || null,
            },
          });
        }

        // M22a: edges from EdgeInferenceResult, if present. Weight
        // defaults to 1.0 (neutral) — the agent's inference is structural,
        // not quantitative. `origin = "agent"` so the M19 graph legend
        // can render these with the agent-specific dash pattern.
        // Skip any edge whose endpoint isn't in the decomposition (the
        // agent occasionally drifts; we log + count rather than fail).
        let edge_count = 0;
        let skipped_endpoint_misses = 0;
        if (edgeInference) {
          const knownNodeKeys = new Set<string>([
            ...decomp.drivers.map((d) => d.name),
            ...decomp.intermediates.map((i) => i.name),
            ...decomp.outputs.map((o) => o.name),
          ]);
          for (const e of edgeInference.edges) {
            if (!knownNodeKeys.has(e.source) || !knownNodeKeys.has(e.target)) {
              skipped_endpoint_misses += 1;
              continue;
            }
            await tx.graphEdge.create({
              data: {
                sector_slug: sector.slug,
                source_key: e.source,
                target_key: e.target,
                label: e.label || null,
                weight: 1.0,
                magnitude: "med",
                origin: "agent",
                author_label: author,
              },
            });
            edge_count += 1;
          }
        }

        await tx.auditLog.create({
          data: {
            action: "sector.proposeFromAgent",
            sector_slug: sector.slug,
            payload: {
              workflow_id: wf.id,
              workflow_kind: wf.kind,
              slug_preferred: preferredSlug,
              slug_final: finalSlug,
              driver_count: decomp.drivers.length,
              intermediate_count: decomp.intermediates.length,
              output_count: decomp.outputs.length,
              edge_count,
              skipped_endpoint_misses,
              cost_usd: wf.cost_usd,
            },
            author_label: author,
          },
        });

        return { sector, edge_count };
      });

      ctx.log.info(
        {
          slug: finalSlug,
          workflow_id: wf.id,
          workflow_kind: wf.kind,
          drivers: decomp.drivers.length,
          intermediates: decomp.intermediates.length,
          outputs: decomp.outputs.length,
          edges: result.edge_count,
        },
        "sector.proposeFromAgent",
      );

      // Invalidate the upstream GenericDagSim cache so the new sector
      // is queryable via /sims immediately (even though it's draft
      // and the user app won't show it until activate).
      await reloadUpstream(finalSlug, ctx.log);

      return {
        sector: result.sector as z.infer<typeof SectorOut>,
        node_counts: {
          driver: decomp.drivers.length,
          intermediate: decomp.intermediates.length,
          output: decomp.outputs.length,
        },
        edge_count: result.edge_count,
      };
    }),

  activate: publicProcedure
    .input(SlugInput)
    .output(SectorOut)
    .mutation(async ({ ctx, input }) => {
      return transitionStatus(ctx, input, "live", "sector.activate");
    }),

  archive: publicProcedure
    .input(SlugInput)
    .output(SectorOut)
    .mutation(async ({ ctx, input }) => {
      return transitionStatus(ctx, input, "archived", "sector.archive");
    }),

  toDraft: publicProcedure
    .input(SlugInput)
    .output(SectorOut)
    .mutation(async ({ ctx, input }) => {
      return transitionStatus(ctx, input, "draft", "sector.toDraft");
    }),
});

async function transitionStatus(
  ctx: import("./context.js").Context,
  input: { slug: string; author_label?: string },
  next: "live" | "draft" | "archived",
  action: string,
) {
  const existing = await ctx.prisma.sector.findUnique({
    where: { slug: input.slug },
  });
  if (!existing) {
    throw new TRPCError({ code: "NOT_FOUND", message: `sector ${input.slug}` });
  }
  const prev = existing.status;
  if (prev === next) return existing as z.infer<typeof SectorOut>;

  // M22b: on activation of an agent-generated sector (no Python sim
  // module), validate that the GenericDagSim can actually run before
  // exposing it to users. The simplest sanity check is that every
  // intermediate / output has a non-empty formula. We don't fail on
  // missing formulas — falling back to NaN is acceptable for some
  // node-only proposals — but we do surface a warning chip in the
  // audit row so admins know what's incomplete.
  let activationWarnings: string[] = [];
  if (next === "live" && !existing.source_module) {
    activationWarnings = await collectActivationWarnings(ctx, input.slug);
  }

  const updated = await ctx.prisma.sector.update({
    where: { slug: input.slug },
    data: { status: next },
  });
  await ctx.prisma.auditLog.create({
    data: {
      action,
      sector_slug: input.slug,
      payload: {
        from: prev,
        to: next,
        ...(activationWarnings.length > 0
          ? { activation_warnings: activationWarnings }
          : {}),
      },
      author_label: input.author_label ?? ctx.user?.label ?? "anonymous",
    },
  });
  ctx.log.info(
    { slug: input.slug, from: prev, to: next, warnings: activationWarnings.length },
    action,
  );
  await reloadUpstream(input.slug, ctx.log);
  return updated as z.infer<typeof SectorOut>;
}

/**
 * Check that an agent-generated sector is plausibly runnable before
 * activation. Returns a list of human-readable warnings (empty when
 * everything is healthy).
 *
 * Today's checks:
 *   - At least one driver, intermediate, or output node exists
 *   - The agent workflow output carries formulas for every
 *     intermediate / output node (otherwise they'd evaluate to NaN)
 *
 * We surface as warnings rather than hard-blockers because the editor
 * can hand-author missing formulas in a follow-up slice, and the
 * platform should let the admin make that call.
 */
async function collectActivationWarnings(
  ctx: import("./context.js").Context,
  slug: string,
): Promise<string[]> {
  const warnings: string[] = [];
  const sector = await ctx.prisma.sector.findUnique({
    where: { slug },
    select: { agent_workflow_id: true },
  });
  const nodes = await ctx.prisma.graphNode.findMany({
    where: { sector_slug: slug },
    select: { node_key: true, kind: true },
  });
  if (nodes.length === 0) {
    warnings.push("그래프 노드가 하나도 없습니다 — simulate() 호출 시 빈 결과 반환");
    return warnings;
  }
  const intermediates = nodes
    .filter((n) => n.kind === "intermediate")
    .map((n) => n.node_key);
  const outputs = nodes
    .filter((n) => n.kind === "output")
    .map((n) => n.node_key);
  if (outputs.length === 0) {
    warnings.push("Output 노드가 없습니다 — UI 차트가 비어 보임");
  }

  if (!sector?.agent_workflow_id) {
    if (intermediates.length + outputs.length > 0) {
      warnings.push(
        "수식 소스(workflow)가 연결되지 않음 — intermediate/output이 NaN으로 평가됨",
      );
    }
    return warnings;
  }

  const wf = await ctx.prisma.agentWorkflow.findUnique({
    where: { id: sector.agent_workflow_id },
    select: { output: true, kind: true },
  });
  if (!wf || !wf.output) {
    warnings.push("원본 workflow 의 output이 비어있음 — 수식을 평가할 수 없음");
    return warnings;
  }
  // Walk the output JSONB for formula coverage.
  const blob = wf.output as Record<string, unknown>;
  const edgeInf =
    wf.kind === "propose_sector"
      ? (blob["edge_inference"] as Record<string, unknown> | undefined)
      : undefined;
  if (wf.kind === "decomposition") {
    warnings.push(
      "Decomposition-only workflow — edges/수식이 없음. Manual 으로 graph 편집 필요",
    );
    return warnings;
  }
  if (!edgeInf) {
    warnings.push("workflow output에 edge_inference 블록이 없음");
    return warnings;
  }
  const intermediateFormulas = new Set<string>();
  for (const f of (edgeInf.intermediates as { name: string }[]) ?? []) {
    intermediateFormulas.add(f.name);
  }
  const outputFormulas = new Set<string>();
  for (const f of (edgeInf.outputs as { name: string }[]) ?? []) {
    outputFormulas.add(f.name);
  }
  const missingI = intermediates.filter((n) => !intermediateFormulas.has(n));
  const missingO = outputs.filter((n) => !outputFormulas.has(n));
  if (missingI.length > 0) {
    warnings.push(
      `수식 없는 intermediate: ${missingI.slice(0, 5).join(", ")}${missingI.length > 5 ? " …" : ""}`,
    );
  }
  if (missingO.length > 0) {
    warnings.push(
      `수식 없는 output: ${missingO.slice(0, 5).join(", ")}${missingO.length > 5 ? " …" : ""}`,
    );
  }
  return warnings;
}
