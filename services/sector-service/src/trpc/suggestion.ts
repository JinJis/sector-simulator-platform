/**
 * `suggestion.*` procedures — community-driven sector improvements.
 *
 * Anyone can submit a suggestion to add/remove a driver or equity,
 * rename a node, etc. Other users upvote/downvote. The score column
 * is denormalized for cheap sort-by-popularity reads.
 *
 * Status transitions (open → under_review → approved / rejected) stay
 * admin-only in M32 v1 — there's no review UI yet, just the data
 * structure to support one.
 */

import { TRPCError } from "@trpc/server";
import { z } from "zod";

import { publicProcedure, router } from "./init.js";

const KINDS = [
  "add_driver",
  "remove_driver",
  "add_equity",
  "remove_equity",
  "rename_node",
  "rewire_edge",
  "other",
] as const;

const SuggestionOut = z.object({
  id: z.string(),
  user_id: z.string(),
  user_label: z.string(),
  sector_slug: z.string(),
  kind: z.enum(KINDS),
  title: z.string(),
  body: z.string().nullable(),
  payload: z.unknown(),
  status: z.string(),
  score: z.number().int(),
  my_vote: z.number().int().nullable(),
  created_at: z.date(),
  updated_at: z.date(),
});

function requireUser(ctx: import("./context.js").Context) {
  if (!ctx.user) {
    throw new TRPCError({
      code: "UNAUTHORIZED",
      message: "제안 등록은 로그인이 필요합니다.",
    });
  }
  return ctx.user;
}

async function loadVotedBy(
  ctx: import("./context.js").Context,
  suggestionIds: string[],
): Promise<Map<string, number>> {
  if (!ctx.user || suggestionIds.length === 0) return new Map();
  const votes = await ctx.prisma.sectorSuggestionVote.findMany({
    where: {
      user_id: ctx.user.id,
      suggestion_id: { in: suggestionIds },
    },
    select: { suggestion_id: true, value: true },
  });
  return new Map(votes.map((v) => [v.suggestion_id, v.value]));
}

export const suggestionRouter = router({
  create: publicProcedure
    .input(
      z.object({
        sector_slug: z.string().min(1),
        kind: z.enum(KINDS),
        title: z.string().min(3).max(200),
        body: z.string().max(4000).optional(),
        payload: z.record(z.unknown()).optional(),
      }),
    )
    .output(SuggestionOut)
    .mutation(async ({ ctx, input }) => {
      const user = requireUser(ctx);
      // Confirm the sector exists so a typo doesn't accumulate orphans.
      const sector = await ctx.prisma.sector.findUnique({
        where: { slug: input.sector_slug },
        select: { slug: true },
      });
      if (!sector) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: `sector ${input.sector_slug}`,
        });
      }
      const created = await ctx.prisma.sectorSuggestion.create({
        data: {
          user_id: user.id,
          sector_slug: input.sector_slug,
          kind: input.kind,
          title: input.title,
          body: input.body ?? null,
          payload: (input.payload ?? {}) as object,
        },
      });
      await ctx.prisma.auditLog.create({
        data: {
          action: "suggestion.create",
          sector_slug: input.sector_slug,
          payload: {
            suggestion_id: created.id,
            kind: input.kind,
            title: input.title,
          },
          author_label: user.label,
        },
      });
      return {
        ...created,
        user_label: user.label,
        my_vote: null,
      } as z.infer<typeof SuggestionOut>;
    }),

  listForSector: publicProcedure
    .input(
      z.object({
        sector_slug: z.string().min(1),
        status: z.enum(["open", "under_review", "approved", "rejected"]).optional(),
        limit: z.number().int().positive().max(100).default(50),
      }),
    )
    .output(z.array(SuggestionOut))
    .query(async ({ ctx, input }) => {
      const rows = await ctx.prisma.sectorSuggestion.findMany({
        where: {
          sector_slug: input.sector_slug,
          ...(input.status ? { status: input.status } : {}),
        },
        include: { user: { select: { name: true, email: true } } },
        orderBy: [{ score: "desc" }, { created_at: "desc" }],
        take: input.limit,
      });
      const voted = await loadVotedBy(
        ctx,
        rows.map((r) => r.id),
      );
      return rows.map((r) => ({
        id: r.id,
        user_id: r.user_id,
        user_label: r.user.name ?? r.user.email,
        sector_slug: r.sector_slug,
        kind: r.kind as (typeof KINDS)[number],
        title: r.title,
        body: r.body,
        payload: r.payload,
        status: r.status,
        score: r.score,
        my_vote: voted.get(r.id) ?? null,
        created_at: r.created_at,
        updated_at: r.updated_at,
      })) as z.infer<typeof SuggestionOut>[];
    }),

  recent: publicProcedure
    .input(z.object({ limit: z.number().int().positive().max(50).default(10) }).default({}))
    .output(z.array(SuggestionOut))
    .query(async ({ ctx, input }) => {
      const rows = await ctx.prisma.sectorSuggestion.findMany({
        include: { user: { select: { name: true, email: true } } },
        orderBy: { created_at: "desc" },
        take: input.limit,
      });
      const voted = await loadVotedBy(
        ctx,
        rows.map((r) => r.id),
      );
      return rows.map((r) => ({
        id: r.id,
        user_id: r.user_id,
        user_label: r.user.name ?? r.user.email,
        sector_slug: r.sector_slug,
        kind: r.kind as (typeof KINDS)[number],
        title: r.title,
        body: r.body,
        payload: r.payload,
        status: r.status,
        score: r.score,
        my_vote: voted.get(r.id) ?? null,
        created_at: r.created_at,
        updated_at: r.updated_at,
      })) as z.infer<typeof SuggestionOut>[];
    }),

  /**
   * +1 / -1 / 0 (0 = retract vote). Transactional: insert/update the
   * vote, then recompute the suggestion's denormalized `score`.
   * Idempotent — repeated calls with the same value are no-ops.
   */
  vote: publicProcedure
    .input(
      z.object({
        suggestion_id: z.string().min(1),
        value: z.union([z.literal(-1), z.literal(0), z.literal(1)]),
      }),
    )
    .output(z.object({ score: z.number().int(), my_vote: z.number().int().nullable() }))
    .mutation(async ({ ctx, input }) => {
      const user = requireUser(ctx);
      const result = await ctx.prisma.$transaction(async (tx) => {
        if (input.value === 0) {
          await tx.sectorSuggestionVote.deleteMany({
            where: {
              suggestion_id: input.suggestion_id,
              user_id: user.id,
            },
          });
        } else {
          await tx.sectorSuggestionVote.upsert({
            where: {
              suggestion_id_user_id: {
                suggestion_id: input.suggestion_id,
                user_id: user.id,
              },
            },
            create: {
              suggestion_id: input.suggestion_id,
              user_id: user.id,
              value: input.value,
            },
            update: { value: input.value },
          });
        }
        const agg = await tx.sectorSuggestionVote.aggregate({
          where: { suggestion_id: input.suggestion_id },
          _sum: { value: true },
        });
        const next = agg._sum.value ?? 0;
        await tx.sectorSuggestion.update({
          where: { id: input.suggestion_id },
          data: { score: next },
        });
        return { score: next, my_vote: input.value === 0 ? null : input.value };
      });
      return result;
    }),
});
