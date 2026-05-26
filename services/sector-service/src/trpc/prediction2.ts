/**
 * `prediction2.*` — M46b Community 3.0 predictions.
 *
 * Auto-tier (easy/medium/hard) from (horizon × volatility × spread).
 * Server recomputes the tier on placement to prevent client-side
 * spoofing. Resolution is handled out-of-band by the M46b data-
 * pipeline cron (`resolve_predictions_v2.py`); this router only
 * accepts placement + serves read paths + leaderboard.
 *
 * Notable design choices:
 *   - quote() is a tier-preview helper for the form — calling code
 *     posts user inputs (horizon + band) and we return the tier +
 *     explanation + anchor price. Same code path used at place().
 *   - place() refuses bands that don't straddle the anchor (the
 *     prediction must be in the direction the placer means — if
 *     anchor is 100 and band is 110-120 it's still valid; we just
 *     ensure spread > 0).
 *   - Auth required on place(); list/get/leaderboard are public.
 */

import { TRPCError } from "@trpc/server";
import { z } from "zod";

import {
  annualizedVolPct,
  assignTier,
  resolvesAt,
  spreadPct,
  type Horizon,
} from "../lib/prediction-tier.js";

import { publicProcedure, router } from "./init.js";

// ============ Schemas ===================================================

const HorizonEnum = z.enum(["1d", "1w", "1m"]);
const TierEnum = z.enum(["easy", "medium", "hard"]);
const StatusEnum = z.enum(["open", "resolved"]);

const QuoteOutput = z.object({
  equity_id: z.string(),
  ticker: z.string(),
  exchange: z.string(),
  company_name: z.string(),
  sector_slug: z.string(),
  anchor_price: z.number(),
  anchor_date: z.date(),
  annualized_vol_pct: z.number().nullable(),
  tier: TierEnum,
  tier_explanation: z.string(),
  multiplier: z.number(),
});

const PredictionSummary = z.object({
  id: z.string(),
  sector_slug: z.string(),
  ticker: z.string(),
  exchange: z.string(),
  company_name: z.string(),
  horizon: z.string(),
  tier: z.string(),
  status: z.string(),
  anchor_price: z.number(),
  anchor_date: z.date(),
  expected_price_min: z.number(),
  expected_price_max: z.number(),
  placed_at: z.date(),
  resolves_at: z.date(),
  resolved_at: z.date().nullable(),
  actual_price: z.number().nullable(),
  score: z.number().nullable(),
  reward_points: z.number().int().nullable(),
  author: z.object({ id: z.string(), label: z.string() }),
});

const PredictionDetail = PredictionSummary.extend({
  rationale: z.string().nullable(),
  tier_explanation: z.string().nullable(),
});

const LeaderRow = z.object({
  user_id: z.string(),
  user_label: z.string(),
  resolved_count: z.number().int(),
  total_points: z.number().int(),
  avg_score: z.number(),
});

// ============ Helpers ===================================================

const VOL_WINDOW_DAYS = 60;

function authorLabel(user: {
  id: string;
  name: string | null;
  email: string;
} | null | undefined): { id: string; label: string } {
  if (!user) return { id: "anonymous", label: "anonymous" };
  return { id: user.id, label: user.name ?? user.email };
}

async function tierForEquity(
  ctx: { prisma: typeof import("@platform/db").prisma },
  equityId: string,
  horizon: Horizon,
  spread_pct: number,
): Promise<{
  equity: {
    id: string;
    ticker: string;
    exchange: string;
    company_name: string;
    sector_slug: string;
    last_close_local: number | null;
    last_close_date: Date | null;
  };
  anchor_price: number;
  anchor_date: Date;
  annualized_vol_pct: number | null;
  tier: ReturnType<typeof assignTier>;
}> {
  const equity = await ctx.prisma.sectorEquity.findUnique({
    where: { id: equityId },
    select: {
      id: true,
      ticker: true,
      exchange: true,
      company_name: true,
      sector_slug: true,
      last_close_local: true,
      last_close_date: true,
    },
  });
  if (!equity) {
    throw new TRPCError({ code: "NOT_FOUND", message: `equity ${equityId}` });
  }
  if (equity.last_close_local == null || equity.last_close_date == null) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: `equity ${equity.ticker} has no quote — wait for the next price ingest`,
    });
  }

  // Pull recent quotes for vol calculation. EquityQuote is the M6 seed
  // table (90 days of daily closes). We take the most-recent
  // VOL_WINDOW_DAYS rows.
  const quotes = await ctx.prisma.equityQuote.findMany({
    where: { equity_id: equityId },
    orderBy: { trade_date: "desc" },
    take: VOL_WINDOW_DAYS,
    select: { close_local: true, trade_date: true },
  });
  // Sort ascending for the rolling-return walk.
  quotes.sort((a, b) => a.trade_date.getTime() - b.trade_date.getTime());
  const annualized_vol_pct = annualizedVolPct(quotes.map((q) => q.close_local));

  const tier = assignTier({
    horizon,
    spread_pct,
    annualized_vol_pct,
  });
  return {
    equity,
    anchor_price: equity.last_close_local,
    anchor_date: equity.last_close_date,
    annualized_vol_pct,
    tier,
  };
}

// ============ Router ====================================================

export const prediction2Router = router({
  /**
   * Tier preview for the placement form. Returns anchor + tier +
   * explanation given (equity, horizon, band). Cheap; no write.
   *
   * The form calls this on each input change with a debounce so the
   * tier badge updates live.
   */
  quote: publicProcedure
    .input(
      z.object({
        equity_id: z.string(),
        horizon: HorizonEnum,
        expected_price_min: z.number().positive(),
        expected_price_max: z.number().positive(),
      }),
    )
    .output(QuoteOutput)
    .query(async ({ ctx, input }) => {
      if (input.expected_price_max <= input.expected_price_min) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "max must be greater than min",
        });
      }
      const sp = spreadPct(input.expected_price_min, input.expected_price_max);
      const res = await tierForEquity(ctx, input.equity_id, input.horizon, sp);
      return {
        equity_id: res.equity.id,
        ticker: res.equity.ticker,
        exchange: res.equity.exchange,
        company_name: res.equity.company_name,
        sector_slug: res.equity.sector_slug,
        anchor_price: res.anchor_price,
        anchor_date: res.anchor_date,
        annualized_vol_pct: res.annualized_vol_pct,
        tier: res.tier.tier,
        tier_explanation: res.tier.explanation,
        multiplier: res.tier.multiplier,
      };
    }),

  /**
   * Place a new prediction. Server recomputes tier + writes the
   * prediction + audit log in one transaction. Idempotency: there's
   * no natural unique key (a user can predict the same equity
   * twice with different bands), so we just write.
   */
  place: publicProcedure
    .input(
      z.object({
        equity_id: z.string(),
        horizon: HorizonEnum,
        expected_price_min: z.number().positive(),
        expected_price_max: z.number().positive(),
        rationale: z.string().max(2000).nullable().optional(),
      }),
    )
    .output(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      if (!ctx.user) {
        throw new TRPCError({
          code: "UNAUTHORIZED",
          message: "Sign in to place a prediction",
        });
      }
      if (input.expected_price_max <= input.expected_price_min) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "max must be greater than min",
        });
      }
      const sp = spreadPct(input.expected_price_min, input.expected_price_max);
      const res = await tierForEquity(
        ctx,
        input.equity_id,
        input.horizon,
        sp,
      );
      const placed_at = new Date();
      const resolves = resolvesAt(res.anchor_date, input.horizon);

      const row = await ctx.prisma.predictionV2.create({
        data: {
          user_id: ctx.user.id,
          equity_id: input.equity_id,
          horizon: input.horizon,
          expected_price_min: input.expected_price_min,
          expected_price_max: input.expected_price_max,
          anchor_price: res.anchor_price,
          anchor_date: res.anchor_date,
          tier: res.tier.tier,
          tier_explanation: res.tier.explanation,
          placed_at,
          resolves_at: resolves,
          rationale: input.rationale ?? null,
        },
      });
      await ctx.prisma.auditLog.create({
        data: {
          action: "prediction2.place",
          sector_slug: res.equity.sector_slug,
          payload: {
            id: row.id,
            equity_id: input.equity_id,
            horizon: input.horizon,
            tier: res.tier.tier,
            spread_pct: sp,
          },
          author_label: ctx.user.label,
        },
      });
      return { id: row.id };
    }),

  /**
   * Global feed. Defaults to Live (open) sorted by placed_at desc.
   * Pass status='resolved' for the resolved feed; the leaderboard
   * has its own endpoint.
   */
  list: publicProcedure
    .input(
      z
        .object({
          status: StatusEnum.optional(),
          sector_slug: z.string().optional(),
          equity_id: z.string().optional(),
          limit: z.number().int().positive().max(100).default(30),
          cursor: z.string().optional(),
        })
        .default({}),
    )
    .output(
      z.object({
        rows: z.array(PredictionSummary),
        next_cursor: z.string().nullable(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const where: {
        status?: string;
        equity_id?: string;
        equity?: { sector_slug?: string };
      } = {};
      where.status = input.status ?? "open";
      if (input.equity_id) where.equity_id = input.equity_id;
      if (input.sector_slug) where.equity = { sector_slug: input.sector_slug };

      const rows = await ctx.prisma.predictionV2.findMany({
        where,
        orderBy: { placed_at: "desc" },
        take: input.limit + 1,
        ...(input.cursor
          ? { cursor: { id: input.cursor }, skip: 1 }
          : {}),
        include: {
          equity: {
            select: {
              ticker: true,
              exchange: true,
              company_name: true,
              sector_slug: true,
            },
          },
          user: { select: { id: true, name: true, email: true } },
        },
      });
      const hasMore = rows.length > input.limit;
      const slice = hasMore ? rows.slice(0, input.limit) : rows;
      const next = hasMore ? (slice[slice.length - 1]?.id ?? null) : null;
      return {
        rows: slice.map((r) => ({
          id: r.id,
          sector_slug: r.equity.sector_slug,
          ticker: r.equity.ticker,
          exchange: r.equity.exchange,
          company_name: r.equity.company_name,
          horizon: r.horizon,
          tier: r.tier,
          status: r.status,
          anchor_price: r.anchor_price,
          anchor_date: r.anchor_date,
          expected_price_min: r.expected_price_min,
          expected_price_max: r.expected_price_max,
          placed_at: r.placed_at,
          resolves_at: r.resolves_at,
          resolved_at: r.resolved_at,
          actual_price: r.actual_price,
          score: r.score,
          reward_points: r.reward_points,
          author: authorLabel(r.user),
        })),
        next_cursor: next,
      };
    }),

  /** Current user's predictions, both open and resolved. Auth required. */
  mine: publicProcedure
    .input(
      z
        .object({
          limit: z.number().int().positive().max(200).default(50),
          status: StatusEnum.optional(),
        })
        .default({}),
    )
    .output(z.array(PredictionSummary))
    .query(async ({ ctx, input }) => {
      if (!ctx.user) {
        throw new TRPCError({
          code: "UNAUTHORIZED",
          message: "Sign in to see your predictions",
        });
      }
      const rows = await ctx.prisma.predictionV2.findMany({
        where: {
          user_id: ctx.user.id,
          ...(input.status ? { status: input.status } : {}),
        },
        orderBy: { placed_at: "desc" },
        take: input.limit,
        include: {
          equity: {
            select: {
              ticker: true,
              exchange: true,
              company_name: true,
              sector_slug: true,
            },
          },
          user: { select: { id: true, name: true, email: true } },
        },
      });
      return rows.map((r) => ({
        id: r.id,
        sector_slug: r.equity.sector_slug,
        ticker: r.equity.ticker,
        exchange: r.equity.exchange,
        company_name: r.equity.company_name,
        horizon: r.horizon,
        tier: r.tier,
        status: r.status,
        anchor_price: r.anchor_price,
        anchor_date: r.anchor_date,
        expected_price_min: r.expected_price_min,
        expected_price_max: r.expected_price_max,
        placed_at: r.placed_at,
        resolves_at: r.resolves_at,
        resolved_at: r.resolved_at,
        actual_price: r.actual_price,
        score: r.score,
        reward_points: r.reward_points,
        author: authorLabel(r.user),
      }));
    }),

  /** Single-prediction detail. */
  get: publicProcedure
    .input(z.object({ id: z.string().min(1) }))
    .output(PredictionDetail)
    .query(async ({ ctx, input }) => {
      const row = await ctx.prisma.predictionV2.findUnique({
        where: { id: input.id },
        include: {
          equity: {
            select: {
              ticker: true,
              exchange: true,
              company_name: true,
              sector_slug: true,
            },
          },
          user: { select: { id: true, name: true, email: true } },
        },
      });
      if (!row) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: `prediction ${input.id}`,
        });
      }
      return {
        id: row.id,
        sector_slug: row.equity.sector_slug,
        ticker: row.equity.ticker,
        exchange: row.equity.exchange,
        company_name: row.equity.company_name,
        horizon: row.horizon,
        tier: row.tier,
        status: row.status,
        anchor_price: row.anchor_price,
        anchor_date: row.anchor_date,
        expected_price_min: row.expected_price_min,
        expected_price_max: row.expected_price_max,
        placed_at: row.placed_at,
        resolves_at: row.resolves_at,
        resolved_at: row.resolved_at,
        actual_price: row.actual_price,
        score: row.score,
        reward_points: row.reward_points,
        rationale: row.rationale,
        tier_explanation: row.tier_explanation,
        author: authorLabel(row.user),
      };
    }),

  /**
   * Leaderboard. Sum of reward_points + avg score over resolved
   * predictions, grouped by user, sorted by total_points desc.
   */
  leaderboard: publicProcedure
    .input(
      z
        .object({
          limit: z.number().int().positive().max(100).default(20),
        })
        .default({}),
    )
    .output(z.array(LeaderRow))
    .query(async ({ ctx, input }) => {
      const grouped = await ctx.prisma.predictionV2.groupBy({
        by: ["user_id"],
        // M50 — bot accounts shouldn't compete on the human leaderboard.
        // They also shouldn't be placing predictions in v1, but the
        // filter keeps the guarantee load-bearing.
        where: { status: "resolved", user: { is_bot: false } },
        _sum: { reward_points: true },
        _count: { _all: true },
        _avg: { score: true },
        orderBy: { _sum: { reward_points: "desc" } },
        take: input.limit,
      });
      if (grouped.length === 0) return [];
      const userIds = grouped.map((g) => g.user_id);
      const users = await ctx.prisma.user.findMany({
        where: { id: { in: userIds } },
        select: { id: true, name: true, email: true },
      });
      const userById = new Map(users.map((u) => [u.id, u]));
      return grouped.map((g) => {
        const u = userById.get(g.user_id);
        return {
          user_id: g.user_id,
          user_label: u?.name ?? u?.email ?? "anonymous",
          resolved_count: g._count._all,
          total_points: g._sum.reward_points ?? 0,
          avg_score: g._avg.score ?? 0,
        };
      });
    }),
});
