/**
 * `audit.*` procedures — read-only window onto `audit_logs`.
 *
 * Every graph / scenario mutation since M7 writes a row here (CLAUDE.md
 * requires an audit log for admin / state-changing actions). M16's home
 * page surfaces the recent feed; M18's admin viewer adds filtering and
 * pagination.
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
  // Optional filters — M18 expands these; M16 only uses the bare list.
  sector_slug: z.string().min(1).optional(),
  action_prefix: z.string().min(1).optional(),
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
});
