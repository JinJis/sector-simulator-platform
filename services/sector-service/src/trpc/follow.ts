/**
 * `follow.*` — M46c one-way follow graph.
 *
 * Twitter-style: `toggle()` flips the (follower, followed) edge. Mutual
 * follow = two rows. Self-follow is rejected. Auth required on writes;
 * reads are public so anonymous browse still works.
 */

import { TRPCError } from "@trpc/server";
import { z } from "zod";

import { publicProcedure, router } from "./init.js";

const Counts = z.object({
  followers: z.number().int(),
  following: z.number().int(),
  /** True when the requesting user follows the queried user. False for
   *  anonymous or when querying their own profile (we never self-follow). */
  viewer_follows: z.boolean(),
});

const FollowEdge = z.object({
  user_id: z.string(),
  user_label: z.string(),
  tier: z.string(),
  followed_at: z.date(),
});

export const followRouter = router({
  /**
   * Counts + viewer-follows flag in one round-trip. Used by the
   * profile header on every page load.
   */
  counts: publicProcedure
    .input(z.object({ user_id: z.string().min(1) }))
    .output(Counts)
    .query(async ({ ctx, input }) => {
      const [followers, following] = await Promise.all([
        ctx.prisma.userFollow.count({
          where: { followed_id: input.user_id },
        }),
        ctx.prisma.userFollow.count({
          where: { follower_id: input.user_id },
        }),
      ]);
      let viewer_follows = false;
      if (ctx.user && ctx.user.id !== input.user_id) {
        const row = await ctx.prisma.userFollow.findUnique({
          where: {
            follower_id_followed_id: {
              follower_id: ctx.user.id,
              followed_id: input.user_id,
            },
          },
          select: { followed_id: true },
        });
        viewer_follows = row !== null;
      }
      return { followers, following, viewer_follows };
    }),

  /** Toggle on/off. Returns the post-toggle state for the caller's UI. */
  toggle: publicProcedure
    .input(z.object({ followed_id: z.string().min(1) }))
    .output(
      z.object({
        following: z.boolean(),
        followers_count: z.number().int(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      if (!ctx.user) {
        throw new TRPCError({
          code: "UNAUTHORIZED",
          message: "Sign in to follow other users",
        });
      }
      if (ctx.user.id === input.followed_id) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Can't follow yourself",
        });
      }
      const target = await ctx.prisma.user.findUnique({
        where: { id: input.followed_id },
        select: { id: true },
      });
      if (!target) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: `user ${input.followed_id}`,
        });
      }
      const result = await ctx.prisma.$transaction(async (tx) => {
        const existing = await tx.userFollow.findUnique({
          where: {
            follower_id_followed_id: {
              follower_id: ctx.user!.id,
              followed_id: input.followed_id,
            },
          },
        });
        if (existing) {
          await tx.userFollow.delete({
            where: {
              follower_id_followed_id: {
                follower_id: ctx.user!.id,
                followed_id: input.followed_id,
              },
            },
          });
          const count = await tx.userFollow.count({
            where: { followed_id: input.followed_id },
          });
          return { following: false, followers_count: count };
        }
        await tx.userFollow.create({
          data: {
            follower_id: ctx.user!.id,
            followed_id: input.followed_id,
          },
        });
        const count = await tx.userFollow.count({
          where: { followed_id: input.followed_id },
        });
        return { following: true, followers_count: count };
      });
      return result;
    }),

  /** List followers of a user (people who follow them). */
  followersOf: publicProcedure
    .input(
      z.object({
        user_id: z.string().min(1),
        limit: z.number().int().positive().max(100).default(30),
      }),
    )
    .output(z.array(FollowEdge))
    .query(async ({ ctx, input }) => {
      const rows = await ctx.prisma.userFollow.findMany({
        where: { followed_id: input.user_id },
        orderBy: { created_at: "desc" },
        take: input.limit,
        include: {
          follower: {
            select: {
              id: true,
              name: true,
              email: true,
              reputation: { select: { tier: true } },
            },
          },
        },
      });
      return rows.map((r) => ({
        user_id: r.follower.id,
        user_label: r.follower.name ?? r.follower.email,
        tier: r.follower.reputation?.tier ?? "newcomer",
        followed_at: r.created_at,
      }));
    }),

  /** List the users this user follows (their following list). */
  followingOf: publicProcedure
    .input(
      z.object({
        user_id: z.string().min(1),
        limit: z.number().int().positive().max(100).default(30),
      }),
    )
    .output(z.array(FollowEdge))
    .query(async ({ ctx, input }) => {
      const rows = await ctx.prisma.userFollow.findMany({
        where: { follower_id: input.user_id },
        orderBy: { created_at: "desc" },
        take: input.limit,
        include: {
          followed: {
            select: {
              id: true,
              name: true,
              email: true,
              reputation: { select: { tier: true } },
            },
          },
        },
      });
      return rows.map((r) => ({
        user_id: r.followed.id,
        user_label: r.followed.name ?? r.followed.email,
        tier: r.followed.reputation?.tier ?? "newcomer",
        followed_at: r.created_at,
      }));
    }),
});
