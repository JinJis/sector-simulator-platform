/**
 * `reputation.*` — M46c read paths over UserReputation + PointEvent.
 *
 * Writes happen in-line in the routers that emit reputation events
 * (`communityProposal.vote`, prediction resolver CTE, eventual
 * `proposal_applied` in M46e). This router is read-only.
 */

import { TRPCError } from "@trpc/server";
import { z } from "zod";

import { publicProcedure, router } from "./init.js";

const TierEnum = z.enum([
  "newcomer",
  "member",
  "analyst",
  "senior",
  "maintainer",
]);

const ReputationOut = z.object({
  user_id: z.string(),
  user_label: z.string(),
  total_points: z.number().int(),
  tier: TierEnum,
});

const PointEventOut = z.object({
  id: z.string(),
  user_id: z.string(),
  kind: z.string(),
  amount: z.number().int(),
  refers_to_kind: z.string().nullable(),
  refers_to_id: z.string().nullable(),
  created_at: z.date(),
});

export const reputationRouter = router({
  /**
   * Single-user reputation snapshot. Returns a synthetic newcomer
   * row when the user has never received/lost points — keeps the
   * profile page simple.
   */
  get: publicProcedure
    .input(z.object({ user_id: z.string().min(1) }))
    .output(ReputationOut)
    .query(async ({ ctx, input }) => {
      const user = await ctx.prisma.user.findUnique({
        where: { id: input.user_id },
        select: {
          id: true,
          name: true,
          email: true,
          reputation: true,
        },
      });
      if (!user) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: `user ${input.user_id}`,
        });
      }
      return {
        user_id: user.id,
        user_label: user.name ?? user.email,
        total_points: user.reputation?.total_points ?? 0,
        tier: (user.reputation?.tier as
          | "newcomer"
          | "member"
          | "analyst"
          | "senior"
          | "maintainer"
          | undefined) ?? "newcomer",
      };
    }),

  /**
   * Recent point events for a user. Powers the profile "Activity"
   * tab. Single-user fetch; the admin-wide stream is a future
   * audit feature.
   */
  events: publicProcedure
    .input(
      z.object({
        user_id: z.string().min(1),
        limit: z.number().int().positive().max(100).default(30),
      }),
    )
    .output(z.array(PointEventOut))
    .query(async ({ ctx, input }) => {
      const rows = await ctx.prisma.pointEvent.findMany({
        where: { user_id: input.user_id },
        orderBy: { created_at: "desc" },
        take: input.limit,
      });
      return rows.map((r) => ({
        id: r.id,
        user_id: r.user_id,
        kind: r.kind,
        amount: r.amount,
        refers_to_kind: r.refers_to_kind,
        refers_to_id: r.refers_to_id,
        created_at: r.created_at,
      }));
    }),

  /**
   * Reputation-wide leaderboard. Sorted by total_points desc; users
   * with 0 points are excluded so we don't show a sea of newcomers.
   */
  leaderboard: publicProcedure
    .input(
      z.object({
        limit: z.number().int().positive().max(100).default(20),
      }).default({}),
    )
    .output(z.array(ReputationOut))
    .query(async ({ ctx, input }) => {
      const rows = await ctx.prisma.userReputation.findMany({
        // M50 — bot users are excluded from human-facing leaderboards.
        where: { total_points: { gt: 0 }, user: { is_bot: false } },
        orderBy: { total_points: "desc" },
        take: input.limit,
        include: {
          user: { select: { id: true, name: true, email: true } },
        },
      });
      return rows.map((r) => ({
        user_id: r.user_id,
        user_label: r.user.name ?? r.user.email,
        total_points: r.total_points,
        tier: r.tier as
          | "newcomer"
          | "member"
          | "analyst"
          | "senior"
          | "maintainer",
      }));
    }),
});
