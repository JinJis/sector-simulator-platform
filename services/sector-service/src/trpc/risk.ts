/**
 * `risk.*` procedures — Risk CRUD.
 *
 * Used by the hero Risk Board (read), the Risks detail tab (read), and
 * by M38 seed scripts + M41 Vision Builder agent (upsert).
 */

import { TRPCError } from "@trpc/server";
import { z } from "zod";

import { publicProcedure, router } from "./init.js";

// ---------- Schemas ----------

const RiskCategory = z.enum([
  "political",
  "legal",
  "supply",
  "safety",
  "environmental",
  "financial",
  "social",
]);
const RiskSeverity = z.enum(["low", "medium", "high", "critical"]);
const RiskLikelihood = z.enum(["low", "medium", "high"]);
const RiskTimeHorizon = z.enum(["immediate", "1y", "3y", "5y", "10y"]);

const RiskOut = z.object({
  id: z.string(),
  sector_slug: z.string(),
  key: z.string(),
  category: z.string(),
  name: z.string(),
  description: z.string(),
  severity: z.string(),
  likelihood: z.string(),
  time_horizon: z.string(),
  mitigations: z.string().nullable(),
  affected_capability_keys: z.array(z.string()),
  // MP4 — source attribution (additive; all nullable).
  source_url: z.string().nullable(),
  source_kind: z.string().nullable(),
  source_title: z.string().nullable(),
  display_order: z.number().int(),
  created_at: z.date(),
  updated_at: z.date(),
});

const UpsertInput = z.object({
  sector_slug: z.string().min(1),
  key: z.string().regex(/^[a-z0-9_]+$/, "snake_case lowercase alphanumeric only").min(1).max(80),
  category: RiskCategory,
  name: z.string().min(1).max(160),
  description: z.string().min(1).max(2000),
  severity: RiskSeverity,
  likelihood: RiskLikelihood,
  time_horizon: RiskTimeHorizon,
  mitigations: z.string().max(2000).nullable().optional(),
  affected_capability_keys: z.array(z.string()).default([]),
  display_order: z.number().int().min(0).max(10_000).default(100),
  // MP4 — additive source attribution. URL is required to be a URL
  // when present; kind/title are free strings.
  source_url: z.string().url().nullable().optional(),
  source_kind: z.string().max(40).nullable().optional(),
  source_title: z.string().max(280).nullable().optional(),
  author_label: z.string().max(120).optional(),
});

const DeleteInput = z.object({
  sector_slug: z.string().min(1),
  key: z.string().min(1),
  author_label: z.string().max(120).optional(),
});

// ---------- Procedures ----------

export const riskRouter = router({
  list: publicProcedure
    .input(z.object({ sector_slug: z.string().min(1) }))
    .output(z.array(RiskOut))
    .query(async ({ ctx, input }) => {
      const rows = await ctx.prisma.risk.findMany({
        where: { sector_slug: input.sector_slug },
        orderBy: { display_order: "asc" },
      });
      return rows as z.infer<typeof RiskOut>[];
    }),

  get: publicProcedure
    .input(z.object({ sector_slug: z.string().min(1), key: z.string().min(1) }))
    .output(RiskOut)
    .query(async ({ ctx, input }) => {
      const row = await ctx.prisma.risk.findUnique({
        where: { sector_slug_key: { sector_slug: input.sector_slug, key: input.key } },
      });
      if (!row) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: `risk ${input.sector_slug}/${input.key}`,
        });
      }
      return row as z.infer<typeof RiskOut>;
    }),

  upsert: publicProcedure
    .input(UpsertInput)
    .output(RiskOut)
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

      // Soft-validate affected_capability_keys — drop any that don't
      // exist in the same sector. We log the drop count in the audit
      // payload but don't fail so a partially-stale risk save still
      // succeeds.
      let validatedKeys = input.affected_capability_keys;
      let droppedKeys: string[] = [];
      if (validatedKeys.length > 0) {
        const found = await ctx.prisma.capability.findMany({
          where: { sector_slug: input.sector_slug, key: { in: validatedKeys } },
          select: { key: true },
        });
        const foundSet = new Set(found.map((c) => c.key));
        droppedKeys = validatedKeys.filter((k) => !foundSet.has(k));
        validatedKeys = validatedKeys.filter((k) => foundSet.has(k));
      }

      const row = await ctx.prisma.risk.upsert({
        where: { sector_slug_key: { sector_slug: input.sector_slug, key: input.key } },
        create: {
          sector_slug: input.sector_slug,
          key: input.key,
          category: input.category,
          name: input.name,
          description: input.description,
          severity: input.severity,
          likelihood: input.likelihood,
          time_horizon: input.time_horizon,
          mitigations: input.mitigations ?? null,
          affected_capability_keys: validatedKeys,
          display_order: input.display_order,
          source_url: input.source_url ?? null,
          source_kind: input.source_kind ?? null,
          source_title: input.source_title ?? null,
        },
        update: {
          category: input.category,
          name: input.name,
          description: input.description,
          severity: input.severity,
          likelihood: input.likelihood,
          time_horizon: input.time_horizon,
          mitigations: input.mitigations ?? null,
          affected_capability_keys: validatedKeys,
          display_order: input.display_order,
          source_url: input.source_url ?? null,
          source_kind: input.source_kind ?? null,
          source_title: input.source_title ?? null,
        },
      });
      await ctx.prisma.auditLog.create({
        data: {
          action: "risk.upsert",
          sector_slug: input.sector_slug,
          payload: {
            key: input.key,
            category: input.category,
            severity: input.severity,
            likelihood: input.likelihood,
            dropped_capability_keys: droppedKeys,
          },
          author_label: input.author_label ?? ctx.user?.label ?? "anonymous",
        },
      });
      return row as z.infer<typeof RiskOut>;
    }),

  delete: publicProcedure
    .input(DeleteInput)
    .output(z.object({ ok: z.boolean(), sector_slug: z.string(), key: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const existing = await ctx.prisma.risk.findUnique({
        where: { sector_slug_key: { sector_slug: input.sector_slug, key: input.key } },
        select: { id: true },
      });
      if (!existing) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: `risk ${input.sector_slug}/${input.key}`,
        });
      }
      await ctx.prisma.risk.delete({ where: { id: existing.id } });
      await ctx.prisma.auditLog.create({
        data: {
          action: "risk.delete",
          sector_slug: input.sector_slug,
          payload: { key: input.key, id: existing.id },
          author_label: input.author_label ?? ctx.user?.label ?? "anonymous",
        },
      });
      return { ok: true, sector_slug: input.sector_slug, key: input.key };
    }),
});
