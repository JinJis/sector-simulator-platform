/**
 * `feasibility.*` procedures — VisionFeasibility read paths +
 * admin trigger for recompute.
 *
 * Heavy lifting (the actual aggregation math) lives in
 * services/simulation-service/simulation_service/feasibility/ (M40).
 * This router is the read surface + a proxy mutation.
 *
 * In M36, `recompute` is a stub that 404s until the simulation-service
 * endpoint lands in M40. Wiring the proxy here today means the hero
 * page's "recompute" button can be built in M37 without churning the
 * router contract.
 */

import { TRPCError } from "@trpc/server";
import { z } from "zod";

import { simFetch } from "../lib/sim-proxy.js";
import { publicProcedure, router } from "./init.js";

// ---------- Schemas ----------

const FeasibilityOut = z.object({
  id: z.string(),
  sector_slug: z.string(),
  as_of: z.date(),
  is_current: z.boolean(),
  composite: z.number(),
  composite_p10: z.number().nullable(),
  composite_p90: z.number().nullable(),
  binding_capability_key: z.string().nullable(),
  eta_median_years: z.number().nullable(),
  eta_p10_years: z.number().nullable(),
  eta_p90_years: z.number().nullable(),
  delta_90d: z.number().nullable(),
  rationale: z.string().nullable(),
  created_at: z.date(),
});

// ---------- Procedures ----------

export const feasibilityRouter = router({
  current: publicProcedure
    .input(z.object({ sector_slug: z.string().min(1) }))
    .output(FeasibilityOut.nullable())
    .query(async ({ ctx, input }) => {
      const row = await ctx.prisma.visionFeasibility.findFirst({
        where: { sector_slug: input.sector_slug, is_current: true },
      });
      if (!row) return null;
      return row as z.infer<typeof FeasibilityOut>;
    }),

  history: publicProcedure
    .input(
      z.object({
        sector_slug: z.string().min(1),
        limit: z.number().int().positive().max(365).default(180),
      }),
    )
    .output(z.array(FeasibilityOut))
    .query(async ({ ctx, input }) => {
      const rows = await ctx.prisma.visionFeasibility.findMany({
        where: { sector_slug: input.sector_slug },
        orderBy: { as_of: "desc" },
        take: input.limit,
      });
      rows.reverse();
      return rows as z.infer<typeof FeasibilityOut>[];
    }),

  /**
   * Admin trigger: ask simulation-service to recompute the vision
   * composite from current capability scores. In M36 this endpoint is
   * a placeholder that proxies to a not-yet-existent route — M40 wires
   * the real implementation. The 502 from `simFetch` until then is
   * intentional: the admin UI will show a clear "feature lands in M40"
   * message via the agent-proxy error map.
   */
  recompute: publicProcedure
    .input(
      z.object({
        sector_slug: z.string().min(1),
        author_label: z.string().max(120).optional(),
      }),
    )
    .output(z.object({ ok: z.boolean(), sector_slug: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const sector = await ctx.prisma.sector.findUnique({
        where: { slug: input.sector_slug },
        select: { slug: true },
      });
      if (!sector) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: `sector ${input.sector_slug} not found`,
        });
      }
      try {
        await simFetch(`/feasibility/recompute/${input.sector_slug}`, {
          method: "POST",
          context: `feasibility-recompute:${input.sector_slug}`,
        });
      } catch (e) {
        // Surface to admin so they know this is M40-pending.
        throw new TRPCError({
          code: "BAD_GATEWAY",
          message:
            `feasibility recompute endpoint not ready (M40); ` +
            (e instanceof Error ? e.message : String(e)),
        });
      }
      await ctx.prisma.auditLog.create({
        data: {
          action: "feasibility.recompute",
          sector_slug: input.sector_slug,
          payload: { sector_slug: input.sector_slug },
          author_label: input.author_label ?? ctx.user?.label ?? "anonymous",
        },
      });
      return { ok: true, sector_slug: input.sector_slug };
    }),
});
