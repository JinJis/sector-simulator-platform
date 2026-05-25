/**
 * `admin.*` procedures — operational metadata about platform users.
 *
 * Admin-role gating isn't wired yet (the platform has no role system
 * beyond `User.tier`). For now any authenticated user could hit
 * these; the admin app is the only consumer in practice and it sits
 * behind the same docker network. A future slice plugs an
 * `is_admin` boolean or an admin tier and routes through that.
 */

import { TRPCError } from "@trpc/server";
import { z } from "zod";

import { env } from "../lib/env.js";
import { publicProcedure, router } from "./init.js";

const INTERNAL_USER_LABEL = "admin-app";
const INTERNAL_TOKEN_HEADER = "x-admin-internal-token";

const UserSummaryOut = z.object({
  id: z.string(),
  email: z.string(),
  name: z.string().nullable(),
  tier: z.string(),
  locale: z.string().nullable(),
  theme: z.string().nullable(),
  created_at: z.date(),
  updated_at: z.date(),
  sector_count: z.number().int(),
  watchlist_count: z.number().int(),
  session_count: z.number().int(),
  last_session_at: z.date().nullable(),
});

const ListInput = z
  .object({
    limit: z.number().int().positive().max(500).default(100),
    /** `email` substring filter (case-insensitive). */
    search: z.string().min(1).optional(),
    /** Filter by tier when set. */
    tier: z.enum(["free", "premium"]).optional(),
  })
  .default({});

/** Admin endpoints accept two auth modes:
 *
 *  1. Real session user — any logged-in user (the platform has no
 *     role system beyond `User.tier` yet, so we don't gate by role).
 *  2. Internal-token bypass — apps/admin sends a shared secret via
 *     the `x-admin-internal-token` header on RSC / server-action
 *     fetches. Sector-service treats a matching header as
 *     authenticated and synthesizes a CurrentUser-shaped placeholder
 *     for the audit log. Browser-side fetches never carry this
 *     token (the admin Next.js client only injects it server-side),
 *     so the secret stays out of devtools / source maps.
 */
function requireUser(ctx: import("./context.js").Context) {
  if (ctx.user) return ctx.user;

  const expected = env().ADMIN_INTERNAL_TOKEN;
  if (expected) {
    const headers = ctx.req?.headers ?? {};
    const headerVal = headers[INTERNAL_TOKEN_HEADER];
    const provided = Array.isArray(headerVal) ? headerVal[0] : headerVal;
    if (typeof provided === "string" && provided === expected) {
      return {
        id: "admin-internal",
        email: "admin@internal",
        name: INTERNAL_USER_LABEL,
        label: INTERNAL_USER_LABEL,
      };
    }
  }

  throw new TRPCError({
    code: "UNAUTHORIZED",
    message: "admin endpoints require authentication",
  });
}

export const userAdminRouter = router({
  listUsers: publicProcedure
    .input(ListInput)
    .output(
      z.object({
        rows: z.array(UserSummaryOut),
        total: z.number().int(),
      }),
    )
    .query(async ({ ctx, input }) => {
      requireUser(ctx);
      const where: Record<string, unknown> = {};
      if (input.search) {
        where.email = { contains: input.search, mode: "insensitive" };
      }
      if (input.tier) {
        where.tier = input.tier;
      }
      const [users, total] = await Promise.all([
        ctx.prisma.user.findMany({
          where,
          orderBy: { created_at: "desc" },
          take: input.limit,
        }),
        ctx.prisma.user.count({ where }),
      ]);
      const userIds = users.map((u) => u.id);
      const [sectorCounts, watchCounts, sessions] = await Promise.all([
        ctx.prisma.sector.groupBy({
          by: ["created_by_user_id"],
          where: { created_by_user_id: { in: userIds } },
          _count: { _all: true },
        }),
        ctx.prisma.watchlistItem.groupBy({
          by: ["user_id"],
          where: { user_id: { in: userIds } },
          _count: { _all: true },
        }),
        ctx.prisma.session.groupBy({
          by: ["user_id"],
          where: { user_id: { in: userIds } },
          _count: { _all: true },
          _max: { created_at: true },
        }),
      ]);
      const sectorBy = new Map(
        sectorCounts.map((s) => [s.created_by_user_id ?? "", s._count._all]),
      );
      const watchBy = new Map(
        watchCounts.map((w) => [w.user_id, w._count._all]),
      );
      const sessionBy = new Map(
        sessions.map((s) => [
          s.user_id,
          { count: s._count._all, last: s._max.created_at },
        ]),
      );
      return {
        rows: users.map((u) => ({
          id: u.id,
          email: u.email,
          name: u.name,
          tier: u.tier,
          locale: u.locale,
          theme: u.theme,
          created_at: u.created_at,
          updated_at: u.updated_at,
          sector_count: sectorBy.get(u.id) ?? 0,
          watchlist_count: watchBy.get(u.id) ?? 0,
          session_count: sessionBy.get(u.id)?.count ?? 0,
          last_session_at: sessionBy.get(u.id)?.last ?? null,
        })) as z.infer<typeof UserSummaryOut>[],
        total,
      };
    }),

  /**
   * Toggle a user's tier — for the admin UI's "★ Promote / Demote"
   * button. Audit-logged. The mutation is intentionally idempotent.
   */
  setTier: publicProcedure
    .input(
      z.object({
        user_id: z.string().min(1),
        tier: z.enum(["free", "premium"]),
      }),
    )
    .output(z.object({ id: z.string(), tier: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const me = requireUser(ctx);
      const target = await ctx.prisma.user.findUnique({
        where: { id: input.user_id },
        select: { id: true, tier: true, email: true },
      });
      if (!target) {
        throw new TRPCError({ code: "NOT_FOUND", message: `user ${input.user_id}` });
      }
      if (target.tier === input.tier) {
        return { id: target.id, tier: target.tier };
      }
      const updated = await ctx.prisma.user.update({
        where: { id: input.user_id },
        data: { tier: input.tier },
        select: { id: true, tier: true },
      });
      await ctx.prisma.auditLog.create({
        data: {
          action: "admin.setTier",
          sector_slug: null,
          payload: {
            target_user_id: target.id,
            target_email: target.email,
            from: target.tier,
            to: input.tier,
          },
          author_label: me.label,
        },
      });
      ctx.log.info(
        { target: target.id, from: target.tier, to: input.tier },
        "admin.setTier",
      );
      return updated;
    }),
});
