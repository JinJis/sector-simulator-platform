/**
 * `community.*` procedures — aggregated reads for the /community hub.
 *
 * One round-trip per page load instead of 4 (predictions / leaderboard
 * / suggestions / scenarios). All queries here are public (anonymous
 * users see the feed too); auth gating is on the *write* surfaces in
 * prediction.* / suggestion.*.
 */

import { z } from "zod";

import { publicProcedure, router } from "./init.js";

export const communityRouter = router({
  hubFeed: publicProcedure
    .input(z.object({ limit: z.number().int().positive().max(20).default(5) }).default({}))
    .output(
      z.object({
        recent_predictions: z.array(
          z.object({
            id: z.string(),
            user_label: z.string(),
            ticker: z.string(),
            company_name: z.string(),
            sector_slug: z.string(),
            iso_country: z.string(),
            horizon: z.string(),
            predicted_pct: z.number(),
            anchor_close: z.number(),
            target_date: z.date(),
            resolved: z.boolean(),
            score: z.number().nullable(),
            created_at: z.date(),
          }),
        ),
        top_users: z.array(
          z.object({
            user_id: z.string(),
            user_label: z.string(),
            total_points: z.number(),
            hit_rate_pct: z.number(),
            predictions_resolved: z.number().int(),
            current_streak: z.number().int(),
          }),
        ),
        popular_scenarios: z.array(
          z.object({
            id: z.string(),
            name: z.string(),
            sector_slug: z.string(),
            override_count: z.number().int(),
            author_label: z.string().nullable(),
            updated_at: z.date(),
          }),
        ),
        recent_suggestions: z.array(
          z.object({
            id: z.string(),
            user_label: z.string(),
            sector_slug: z.string(),
            kind: z.string(),
            title: z.string(),
            score: z.number().int(),
            status: z.string(),
            created_at: z.date(),
          }),
        ),
        totals: z.object({
          predictions_made: z.number().int(),
          predictions_resolved: z.number().int(),
          suggestions_open: z.number().int(),
          scorers: z.number().int(),
        }),
      }),
    )
    .query(async ({ ctx, input }) => {
      const [preds, scores, scenarios, sugs, predTotal, resolvedTotal, sugOpen, scorers] =
        await Promise.all([
          ctx.prisma.prediction.findMany({
            include: {
              user: { select: { name: true, email: true } },
              equity: {
                select: {
                  ticker: true,
                  company_name: true,
                  sector_slug: true,
                  iso_country: true,
                },
              },
              result: true,
            },
            orderBy: { created_at: "desc" },
            take: input.limit,
          }),
          ctx.prisma.userScore.findMany({
            orderBy: { total_points: "desc" },
            take: input.limit,
            include: { user: { select: { name: true, email: true } } },
          }),
          ctx.prisma.scenario.findMany({
            orderBy: { updated_at: "desc" },
            take: input.limit,
          }),
          ctx.prisma.sectorSuggestion.findMany({
            include: { user: { select: { name: true, email: true } } },
            orderBy: { created_at: "desc" },
            take: input.limit,
          }),
          ctx.prisma.prediction.count(),
          ctx.prisma.prediction.count({ where: { resolved: true } }),
          ctx.prisma.sectorSuggestion.count({ where: { status: "open" } }),
          ctx.prisma.userScore.count(),
        ]);

      return {
        recent_predictions: preds.map((p) => ({
          id: p.id,
          user_label: p.user.name ?? p.user.email,
          ticker: p.equity.ticker,
          company_name: p.equity.company_name,
          sector_slug: p.equity.sector_slug,
          iso_country: p.equity.iso_country,
          horizon: p.horizon,
          predicted_pct: p.predicted_pct,
          anchor_close: p.anchor_close,
          target_date: p.target_date,
          resolved: p.resolved,
          score: p.result?.score ?? null,
          created_at: p.created_at,
        })),
        top_users: scores.map((s) => ({
          user_id: s.user_id,
          user_label: s.user.name ?? s.user.email,
          total_points: s.total_points,
          hit_rate_pct: s.hit_rate_pct,
          predictions_resolved: s.predictions_resolved,
          current_streak: s.current_streak,
        })),
        popular_scenarios: scenarios.map((s) => ({
          id: s.id,
          name: s.name,
          sector_slug: s.sector_slug,
          override_count: Object.keys(
            (s.driver_overrides ?? {}) as Record<string, unknown>,
          ).length,
          author_label: s.author_label,
          updated_at: s.updated_at,
        })),
        recent_suggestions: sugs.map((g) => ({
          id: g.id,
          user_label: g.user.name ?? g.user.email,
          sector_slug: g.sector_slug,
          kind: g.kind,
          title: g.title,
          score: g.score,
          status: g.status,
          created_at: g.created_at,
        })),
        totals: {
          predictions_made: predTotal,
          predictions_resolved: resolvedTotal,
          suggestions_open: sugOpen,
          scorers: scorers,
        },
      };
    }),
});
