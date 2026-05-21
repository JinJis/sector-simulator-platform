/**
 * `audit.*` procedures — read-only window onto `audit_logs`.
 *
 * Every graph / scenario mutation since M7 writes a row here (CLAUDE.md
 * requires an audit log for admin / state-changing actions). M16's
 * home page surfaces a fixed 20-row feed via `audit.recent`; M18's
 * admin viewer (`/admin/audit`) uses `audit.list` with cursor
 * pagination + filters.
 */

import { z } from "zod";

import { publicProcedure, router } from "./init.js";

const AuditLogOut = z.object({
  id: z.string(),
  action: z.string(),
  sector_slug: z.string().nullable(),
  payload: z.unknown(),
  author_label: z.string().nullable(),
  created_at: z.date(),
});

const RecentInput = z.object({
  limit: z.number().int().positive().max(100).default(20),
  sector_slug: z.string().min(1).optional(),
  action_prefix: z.string().min(1).optional(),
});

const ListInput = z.object({
  limit: z.number().int().positive().max(200).default(50),
  /**
   * `created_at` cursor — return entries strictly older than this ISO
   * timestamp. First page omits; subsequent pages send the last row's
   * `created_at` from the previous page.
   */
  before: z.string().datetime().optional(),
  sector_slug: z.string().min(1).optional(),
  action_prefix: z.string().min(1).optional(),
  author_label: z.string().min(1).optional(),
});

export const auditRouter = router({
  recent: publicProcedure
    .input(RecentInput)
    .output(z.array(AuditLogOut))
    .query(async ({ ctx, input }) => {
      const where: Record<string, unknown> = {};
      if (input.sector_slug) where.sector_slug = input.sector_slug;
      if (input.action_prefix) where.action = { startsWith: input.action_prefix };
      const rows = await ctx.prisma.auditLog.findMany({
        where,
        orderBy: { created_at: "desc" },
        take: input.limit,
      });
      return rows as z.infer<typeof AuditLogOut>[];
    }),

  list: publicProcedure
    .input(ListInput)
    .output(
      z.object({
        rows: z.array(AuditLogOut),
        next_before: z.string().datetime().nullable(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const where: Record<string, unknown> = {};
      if (input.sector_slug) where.sector_slug = input.sector_slug;
      if (input.action_prefix) where.action = { startsWith: input.action_prefix };
      if (input.author_label) where.author_label = input.author_label;
      if (input.before) where.created_at = { lt: new Date(input.before) };

      const rows = await ctx.prisma.auditLog.findMany({
        where,
        orderBy: { created_at: "desc" },
        take: input.limit,
      });
      const last = rows[rows.length - 1];
      const next_before =
        rows.length === input.limit && last
          ? last.created_at.toISOString()
          : null;
      return { rows: rows as z.infer<typeof AuditLogOut>[], next_before };
    }),

  /**
   * Distinct values for the action / author / sector filter dropdowns.
   * Each list is computed on the fly — fine at our `audit_logs` scale
   * (10s-1000s of rows); when it grows beyond that we'll cache.
   */
  facets: publicProcedure
    .input(z.object({}).optional())
    .output(
      z.object({
        actions: z.array(z.string()),
        sectors: z.array(z.string()),
        authors: z.array(z.string()),
      }),
    )
    .query(async ({ ctx }) => {
      const [actions, sectors, authors] = await Promise.all([
        ctx.prisma.auditLog.findMany({
          distinct: ["action"],
          select: { action: true },
          orderBy: { action: "asc" },
        }),
        ctx.prisma.auditLog.findMany({
          distinct: ["sector_slug"],
          select: { sector_slug: true },
          where: { sector_slug: { not: null } },
          orderBy: { sector_slug: "asc" },
        }),
        ctx.prisma.auditLog.findMany({
          distinct: ["author_label"],
          select: { author_label: true },
          where: { author_label: { not: null } },
          orderBy: { author_label: "asc" },
        }),
      ]);
      return {
        actions: actions.map((a) => a.action),
        sectors: sectors.map((s) => s.sector_slug!).filter(Boolean),
        authors: authors.map((a) => a.author_label!).filter(Boolean),
      };
    }),
});
