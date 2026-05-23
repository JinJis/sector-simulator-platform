/**
 * `capability.*` procedures — CRUD for the Capability + CapabilityScore
 * + CapabilityDependency tables.
 *
 * M36 ships read paths + admin mutations (upsert / delete / dependency
 * add / remove) used by the M38 seed scripts and the future Vision
 * Builder agent (M41). Score time-series is read-only here; writes come
 * from the Score Updater agent (M40) and the recompute cron.
 *
 * Cycle enforcement on CapabilityDependency: Prisma can't express
 * graph constraints declaratively, so addDependency performs a
 * reachability check before insert.
 */

import { TRPCError } from "@trpc/server";
import { z } from "zod";

import { publicProcedure, router } from "./init.js";

// ---------- Schemas ----------

const CapabilityOut = z.object({
  id: z.string(),
  sector_slug: z.string(),
  key: z.string(),
  name: z.string(),
  short_name: z.string().nullable(),
  description: z.string(),
  rationale: z.string(),
  display_order: z.number().int(),
  weight: z.number(),
  primary_driver_name: z.string().nullable(),
  created_at: z.date(),
  updated_at: z.date(),
});

const CapabilityScoreOut = z.object({
  id: z.string(),
  capability_id: z.string(),
  technical: z.number().nullable(),
  economic: z.number().nullable(),
  regulatory: z.number().nullable(),
  supply: z.number().nullable(),
  composite: z.number().nullable(),
  composite_p10: z.number().nullable(),
  composite_p90: z.number().nullable(),
  as_of: z.date(),
  is_current: z.boolean(),
  rationale: z.string().nullable(),
});

const CapabilityDependencyOut = z.object({
  id: z.string(),
  source_id: z.string(),
  target_id: z.string(),
  rationale: z.string().nullable(),
  source_key: z.string(),
  target_key: z.string(),
});

const UpsertInput = z.object({
  sector_slug: z.string().min(1),
  key: z.string().regex(/^[a-z0-9_]+$/, "snake_case lowercase alphanumeric only").min(1).max(80),
  name: z.string().min(1).max(160),
  short_name: z.string().max(80).nullable().optional(),
  description: z.string().min(1).max(2000),
  rationale: z.string().min(1).max(2000),
  display_order: z.number().int().min(0).max(10_000).default(100),
  weight: z.number().min(0).max(1).default(0.1),
  primary_driver_name: z.string().max(120).nullable().optional(),
  author_label: z.string().max(120).optional(),
});

const DeleteInput = z.object({
  sector_slug: z.string().min(1),
  key: z.string().min(1),
  author_label: z.string().max(120).optional(),
});

const AddDependencyInput = z.object({
  sector_slug: z.string().min(1),
  source_key: z.string().min(1),
  target_key: z.string().min(1),
  rationale: z.string().max(500).nullable().optional(),
  author_label: z.string().max(120).optional(),
});

const RemoveDependencyInput = z.object({
  sector_slug: z.string().min(1),
  source_key: z.string().min(1),
  target_key: z.string().min(1),
  author_label: z.string().max(120).optional(),
});

// ---------- Helpers ----------

/**
 * Reachability check on the CapabilityDependency DAG. Returns true if
 * `start_id` can reach `goal_id` by following source→target edges.
 * Used by addDependency to prevent cycles (we add A→B only if there's
 * no existing path B→A).
 */
async function isReachable(
  prisma: import("@platform/db").PrismaClient,
  start_id: string,
  goal_id: string,
  sector_slug: string,
): Promise<boolean> {
  // BFS bounded by total capability count in the sector.
  const queue: string[] = [start_id];
  const seen = new Set<string>([start_id]);
  // Cap on iterations to defend against unexpected graph state.
  const max_iter = 1000;
  let iter = 0;
  while (queue.length > 0 && iter < max_iter) {
    iter += 1;
    const node = queue.shift()!;
    if (node === goal_id) return true;
    const outgoing = await prisma.capabilityDependency.findMany({
      where: {
        source_id: node,
        source: { sector_slug },
      },
      select: { target_id: true },
    });
    for (const e of outgoing) {
      if (!seen.has(e.target_id)) {
        seen.add(e.target_id);
        queue.push(e.target_id);
      }
    }
  }
  return false;
}

// ---------- Procedures ----------

export const capabilityRouter = router({
  list: publicProcedure
    .input(z.object({ sector_slug: z.string().min(1) }))
    .output(z.array(CapabilityOut))
    .query(async ({ ctx, input }) => {
      const rows = await ctx.prisma.capability.findMany({
        where: { sector_slug: input.sector_slug },
        orderBy: { display_order: "asc" },
      });
      return rows as z.infer<typeof CapabilityOut>[];
    }),

  get: publicProcedure
    .input(z.object({ sector_slug: z.string().min(1), key: z.string().min(1) }))
    .output(
      z.object({
        capability: CapabilityOut,
        current_score: CapabilityScoreOut.nullable(),
        dependencies: z.array(CapabilityDependencyOut),
        dependents: z.array(CapabilityDependencyOut),
      }),
    )
    .query(async ({ ctx, input }) => {
      const cap = await ctx.prisma.capability.findUnique({
        where: { sector_slug_key: { sector_slug: input.sector_slug, key: input.key } },
        include: {
          scores: { where: { is_current: true }, orderBy: { as_of: "desc" }, take: 1 },
          dependencies: { include: { target: { select: { key: true } } } },
          dependents: { include: { source: { select: { key: true } } } },
        },
      });
      if (!cap) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: `capability ${input.sector_slug}/${input.key}`,
        });
      }

      // Re-resolve source_key for dependencies (incoming `cap` is the source)
      // and dependents (incoming `cap` is the target).
      const dependencies = cap.dependencies.map((d) => ({
        id: d.id,
        source_id: d.source_id,
        target_id: d.target_id,
        rationale: d.rationale,
        source_key: cap.key,
        target_key: d.target.key,
      }));
      const dependents = cap.dependents.map((d) => ({
        id: d.id,
        source_id: d.source_id,
        target_id: d.target_id,
        rationale: d.rationale,
        source_key: d.source.key,
        target_key: cap.key,
      }));

      return {
        capability: {
          id: cap.id,
          sector_slug: cap.sector_slug,
          key: cap.key,
          name: cap.name,
          short_name: cap.short_name,
          description: cap.description,
          rationale: cap.rationale,
          display_order: cap.display_order,
          weight: cap.weight,
          primary_driver_name: cap.primary_driver_name,
          created_at: cap.created_at,
          updated_at: cap.updated_at,
        },
        current_score: cap.scores[0] ?? null,
        dependencies,
        dependents,
      };
    }),

  scoreHistory: publicProcedure
    .input(
      z.object({
        sector_slug: z.string().min(1),
        key: z.string().min(1),
        limit: z.number().int().positive().max(365).default(120),
      }),
    )
    .output(z.array(CapabilityScoreOut))
    .query(async ({ ctx, input }) => {
      const cap = await ctx.prisma.capability.findUnique({
        where: { sector_slug_key: { sector_slug: input.sector_slug, key: input.key } },
        select: { id: true },
      });
      if (!cap) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: `capability ${input.sector_slug}/${input.key}`,
        });
      }
      const rows = await ctx.prisma.capabilityScore.findMany({
        where: { capability_id: cap.id },
        orderBy: { as_of: "desc" },
        take: input.limit,
      });
      // Render-friendly asc order.
      rows.reverse();
      return rows as z.infer<typeof CapabilityScoreOut>[];
    }),

  /**
   * Upsert by (sector_slug, key). Used by M38 seed scripts and the
   * future Vision Builder agent (M41) to populate capabilities.
   *
   * Does NOT touch the score time series — that lives in
   * `capabilityScore` writes (admin tool / agent / cron).
   */
  upsert: publicProcedure
    .input(UpsertInput)
    .output(CapabilityOut)
    .mutation(async ({ ctx, input }) => {
      // Ensure the sector exists; otherwise the FK error surfaces as a
      // generic 500.
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
      const row = await ctx.prisma.capability.upsert({
        where: {
          sector_slug_key: { sector_slug: input.sector_slug, key: input.key },
        },
        create: {
          sector_slug: input.sector_slug,
          key: input.key,
          name: input.name,
          short_name: input.short_name ?? null,
          description: input.description,
          rationale: input.rationale,
          display_order: input.display_order,
          weight: input.weight,
          primary_driver_name: input.primary_driver_name ?? null,
        },
        update: {
          name: input.name,
          short_name: input.short_name ?? null,
          description: input.description,
          rationale: input.rationale,
          display_order: input.display_order,
          weight: input.weight,
          primary_driver_name: input.primary_driver_name ?? null,
        },
      });
      await ctx.prisma.auditLog.create({
        data: {
          action: "capability.upsert",
          sector_slug: input.sector_slug,
          payload: {
            key: input.key,
            name: input.name,
            display_order: input.display_order,
            weight: input.weight,
            primary_driver_name: input.primary_driver_name ?? null,
          },
          author_label: input.author_label ?? ctx.user?.label ?? "anonymous",
        },
      });
      return row as z.infer<typeof CapabilityOut>;
    }),

  /**
   * Delete a capability + its scores + its dependency rows.
   * Cascades via Prisma `onDelete: Cascade` on each FK.
   */
  delete: publicProcedure
    .input(DeleteInput)
    .output(z.object({ ok: z.boolean(), sector_slug: z.string(), key: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const cap = await ctx.prisma.capability.findUnique({
        where: { sector_slug_key: { sector_slug: input.sector_slug, key: input.key } },
        select: { id: true },
      });
      if (!cap) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: `capability ${input.sector_slug}/${input.key}`,
        });
      }
      await ctx.prisma.capability.delete({ where: { id: cap.id } });
      await ctx.prisma.auditLog.create({
        data: {
          action: "capability.delete",
          sector_slug: input.sector_slug,
          payload: { key: input.key, id: cap.id },
          author_label: input.author_label ?? ctx.user?.label ?? "anonymous",
        },
      });
      return { ok: true, sector_slug: input.sector_slug, key: input.key };
    }),

  addDependency: publicProcedure
    .input(AddDependencyInput)
    .output(CapabilityDependencyOut)
    .mutation(async ({ ctx, input }) => {
      if (input.source_key === input.target_key) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "self-dependency is not allowed",
        });
      }
      const [src, tgt] = await Promise.all([
        ctx.prisma.capability.findUnique({
          where: {
            sector_slug_key: { sector_slug: input.sector_slug, key: input.source_key },
          },
          select: { id: true },
        }),
        ctx.prisma.capability.findUnique({
          where: {
            sector_slug_key: { sector_slug: input.sector_slug, key: input.target_key },
          },
          select: { id: true },
        }),
      ]);
      if (!src) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: `source capability ${input.source_key}`,
        });
      }
      if (!tgt) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: `target capability ${input.target_key}`,
        });
      }
      // Cycle check: would (source → target) create a cycle? That would
      // mean target → ... → source already exists.
      const wouldCycle = await isReachable(
        ctx.prisma,
        tgt.id,
        src.id,
        input.sector_slug,
      );
      if (wouldCycle) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `adding ${input.source_key} → ${input.target_key} would introduce a cycle`,
        });
      }

      const row = await ctx.prisma.capabilityDependency.upsert({
        where: { source_id_target_id: { source_id: src.id, target_id: tgt.id } },
        create: { source_id: src.id, target_id: tgt.id, rationale: input.rationale ?? null },
        update: { rationale: input.rationale ?? null },
      });
      await ctx.prisma.auditLog.create({
        data: {
          action: "capability.addDependency",
          sector_slug: input.sector_slug,
          payload: { source_key: input.source_key, target_key: input.target_key },
          author_label: input.author_label ?? ctx.user?.label ?? "anonymous",
        },
      });
      return {
        id: row.id,
        source_id: row.source_id,
        target_id: row.target_id,
        rationale: row.rationale,
        source_key: input.source_key,
        target_key: input.target_key,
      };
    }),

  removeDependency: publicProcedure
    .input(RemoveDependencyInput)
    .output(z.object({ ok: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      const [src, tgt] = await Promise.all([
        ctx.prisma.capability.findUnique({
          where: {
            sector_slug_key: { sector_slug: input.sector_slug, key: input.source_key },
          },
          select: { id: true },
        }),
        ctx.prisma.capability.findUnique({
          where: {
            sector_slug_key: { sector_slug: input.sector_slug, key: input.target_key },
          },
          select: { id: true },
        }),
      ]);
      if (!src || !tgt) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "source or target capability not found",
        });
      }
      const existing = await ctx.prisma.capabilityDependency.findUnique({
        where: { source_id_target_id: { source_id: src.id, target_id: tgt.id } },
      });
      if (!existing) {
        // Idempotent: removing a non-existent edge is a no-op.
        return { ok: true };
      }
      await ctx.prisma.capabilityDependency.delete({ where: { id: existing.id } });
      await ctx.prisma.auditLog.create({
        data: {
          action: "capability.removeDependency",
          sector_slug: input.sector_slug,
          payload: { source_key: input.source_key, target_key: input.target_key },
          author_label: input.author_label ?? ctx.user?.label ?? "anonymous",
        },
      });
      return { ok: true };
    }),
});
