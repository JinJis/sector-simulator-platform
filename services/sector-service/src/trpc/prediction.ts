/**
 * `prediction.*` procedures — community predictions + leaderboard.
 *
 * Resolution (computing actual_close + score once target_date passes)
 * is a follow-up cron in validation-service. M32 v1 ships the
 * write/read paths; resolved counts stay at 0 until the cron is up.
 */

import { TRPCError } from "@trpc/server";
import { z } from "zod";

import { publicProcedure, router } from "./init.js";

const HORIZONS = ["1d", "1w", "1m"] as const;

const PredictionOut = z.object({
  id: z.string(),
  user_id: z.string(),
  equity_id: z.string(),
  horizon: z.enum(HORIZONS),
  predicted_pct: z.number(),
  anchor_close: z.number(),
  predicted_close: z.number(),
  anchor_at: z.date(),
  target_date: z.date(),
  scenario_id: z.string().nullable(),
  rationale: z.string().nullable(),
  resolved: z.boolean(),
  created_at: z.date(),
});

const PredictionWithMetaOut = PredictionOut.extend({
  user_label: z.string(),
  equity: z.object({
    id: z.string(),
    ticker: z.string(),
    company_name: z.string(),
    company_name_local: z.string().nullable(),
    sector_slug: z.string(),
    iso_country: z.string(),
    currency: z.string().nullable(),
  }),
  result: z
    .object({
      actual_close: z.number(),
      actual_pct: z.number(),
      abs_error: z.number(),
      score: z.number(),
      resolved_at: z.date(),
    })
    .nullable(),
});

const LeaderboardRowOut = z.object({
  user_id: z.string(),
  user_label: z.string(),
  total_points: z.number(),
  predictions_made: z.number().int(),
  predictions_resolved: z.number().int(),
  hit_rate_pct: z.number(),
  current_streak: z.number().int(),
  best_streak: z.number().int(),
});

function horizonToDays(h: (typeof HORIZONS)[number]): number {
  return h === "1d" ? 1 : h === "1w" ? 7 : 30;
}

function requireUser(ctx: import("./context.js").Context) {
  if (!ctx.user) {
    throw new TRPCError({
      code: "UNAUTHORIZED",
      message: "예측 등록은 로그인이 필요합니다.",
    });
  }
  return ctx.user;
}

export const predictionRouter = router({
  create: publicProcedure
    .input(
      z.object({
        equity_id: z.string().min(1),
        horizon: z.enum(HORIZONS),
        predicted_pct: z.number().finite().min(-90).max(900),
        rationale: z.string().max(2000).optional(),
        scenario_id: z.string().min(1).optional(),
      }),
    )
    .output(PredictionOut)
    .mutation(async ({ ctx, input }) => {
      const user = requireUser(ctx);
      const equity = await ctx.prisma.sectorEquity.findUnique({
        where: { id: input.equity_id },
        select: { id: true, last_close_local: true },
      });
      if (!equity) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: `equity ${input.equity_id}`,
        });
      }
      const anchor = equity.last_close_local;
      if (anchor === null || anchor === undefined) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message:
            "이 종목의 현재 가격이 적재되지 않아 예측을 등록할 수 없습니다.",
        });
      }
      const predictedClose = anchor * (1 + input.predicted_pct / 100);
      const targetDate = new Date();
      targetDate.setUTCDate(targetDate.getUTCDate() + horizonToDays(input.horizon));

      const prediction = await ctx.prisma.prediction.create({
        data: {
          user_id: user.id,
          equity_id: equity.id,
          horizon: input.horizon,
          predicted_pct: input.predicted_pct,
          anchor_close: anchor,
          predicted_close: predictedClose,
          target_date: targetDate,
          scenario_id: input.scenario_id ?? null,
          rationale: input.rationale ?? null,
        },
      });

      // Bump the user_scores counter.
      await ctx.prisma.userScore.upsert({
        where: { user_id: user.id },
        create: { user_id: user.id, predictions_made: 1 },
        update: { predictions_made: { increment: 1 } },
      });

      await ctx.prisma.auditLog.create({
        data: {
          action: "prediction.create",
          sector_slug: null,
          payload: {
            equity_id: equity.id,
            horizon: input.horizon,
            predicted_pct: input.predicted_pct,
          },
          author_label: user.label,
        },
      });

      return prediction as z.infer<typeof PredictionOut>;
    }),

  listMine: publicProcedure
    .input(z.object({ limit: z.number().int().positive().max(100).default(50) }).default({}))
    .output(z.array(PredictionWithMetaOut))
    .query(async ({ ctx, input }) => {
      if (!ctx.user) return [];
      const rows = await ctx.prisma.prediction.findMany({
        where: { user_id: ctx.user.id },
        include: {
          equity: {
            select: {
              id: true,
              ticker: true,
              company_name: true,
              company_name_local: true,
              sector_slug: true,
              iso_country: true,
              currency: true,
            },
          },
          result: true,
        },
        orderBy: { created_at: "desc" },
        take: input.limit,
      });
      return rows.map((r) => ({
        ...r,
        user_label: ctx.user!.label,
      })) as z.infer<typeof PredictionWithMetaOut>[];
    }),

  listForEquity: publicProcedure
    .input(
      z.object({
        equity_id: z.string().min(1),
        limit: z.number().int().positive().max(50).default(20),
      }),
    )
    .output(z.array(PredictionWithMetaOut))
    .query(async ({ ctx, input }) => {
      const rows = await ctx.prisma.prediction.findMany({
        where: { equity_id: input.equity_id },
        include: {
          user: { select: { name: true, email: true } },
          equity: {
            select: {
              id: true,
              ticker: true,
              company_name: true,
              company_name_local: true,
              sector_slug: true,
              iso_country: true,
              currency: true,
            },
          },
          result: true,
        },
        orderBy: { created_at: "desc" },
        take: input.limit,
      });
      return rows.map((r) => ({
        ...r,
        user_label: r.user.name ?? r.user.email,
      })) as z.infer<typeof PredictionWithMetaOut>[];
    }),

  recent: publicProcedure
    .input(z.object({ limit: z.number().int().positive().max(50).default(20) }).default({}))
    .output(z.array(PredictionWithMetaOut))
    .query(async ({ ctx, input }) => {
      const rows = await ctx.prisma.prediction.findMany({
        include: {
          user: { select: { name: true, email: true } },
          equity: {
            select: {
              id: true,
              ticker: true,
              company_name: true,
              company_name_local: true,
              sector_slug: true,
              iso_country: true,
              currency: true,
            },
          },
          result: true,
        },
        orderBy: { created_at: "desc" },
        take: input.limit,
      });
      return rows.map((r) => ({
        ...r,
        user_label: r.user.name ?? r.user.email,
      })) as z.infer<typeof PredictionWithMetaOut>[];
    }),

  leaderboard: publicProcedure
    .input(z.object({ limit: z.number().int().positive().max(100).default(20) }).default({}))
    .output(z.array(LeaderboardRowOut))
    .query(async ({ ctx, input }) => {
      const rows = await ctx.prisma.userScore.findMany({
        orderBy: { total_points: "desc" },
        take: input.limit,
        include: { user: { select: { name: true, email: true } } },
      });
      return rows.map((r) => ({
        user_id: r.user_id,
        user_label: r.user.name ?? r.user.email,
        total_points: r.total_points,
        predictions_made: r.predictions_made,
        predictions_resolved: r.predictions_resolved,
        hit_rate_pct: r.hit_rate_pct,
        current_streak: r.current_streak,
        best_streak: r.best_streak,
      }));
    }),

  myScore: publicProcedure
    .output(LeaderboardRowOut.nullable())
    .query(async ({ ctx }) => {
      if (!ctx.user) return null;
      const score = await ctx.prisma.userScore.findUnique({
        where: { user_id: ctx.user.id },
        include: { user: { select: { name: true, email: true } } },
      });
      if (!score) return null;
      return {
        user_id: score.user_id,
        user_label: score.user.name ?? score.user.email,
        total_points: score.total_points,
        predictions_made: score.predictions_made,
        predictions_resolved: score.predictions_resolved,
        hit_rate_pct: score.hit_rate_pct,
        current_streak: score.current_streak,
        best_streak: score.best_streak,
      };
    }),
});
