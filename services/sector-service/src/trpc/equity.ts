/**
 * `equity.*` procedures — read-only window onto `sector_equities`.
 *
 * Equities Milestone 1 ships read-only: editorial curation lives in the
 * `seed-equities.ts` script. Milestone 2 introduces ingestion (yfinance /
 * AlphaVantage / DART) which writes via a separate scheduled service, not
 * via this tRPC surface.
 */

import { TRPCError } from "@trpc/server";
import { z } from "zod";

import { computeBasketStats } from "../lib/stats.js";
import { publicProcedure, router } from "./init.js";

const DriverLink = z.object({
  driver: z.string(),
  sign: z.enum(["+", "-"]),
  magnitude: z.enum(["low", "med", "high"]),
  note: z.string().optional(),
});

const EquityOut = z.object({
  id: z.string(),
  sector_slug: z.string(),
  ticker: z.string(),
  exchange: z.string(),
  iso_country: z.string(),
  company_name: z.string(),
  company_name_local: z.string().nullable(),
  sector_exposure_pct: z.number(),
  rationale: z.string().nullable(),
  currency: z.string().nullable(),
  last_close_local: z.number().nullable(),
  last_close_usd: z.number().nullable(),
  last_close_date: z.date().nullable(),
  market_cap_usd: z.number().nullable(),
  driver_links: z.array(DriverLink),
  display_order: z.number().int(),
  created_at: z.date(),
  updated_at: z.date(),
});

const ListInput = z.object({
  sector_slug: z.string().min(1),
  iso_country: z.enum(["US", "KR"]).optional(),
});

const HistoryInput = z.object({
  id: z.string().min(1),
  // Most equity views want a ~90-day sparkline; cap at 5y so a runaway
  // query can't hammer Postgres.
  days: z.number().int().positive().max(1825).default(90),
});

const HistoryBarOut = z.object({
  trade_date: z.date(),
  close_local: z.number(),
  close_usd: z.number().nullable(),
  volume: z.number().nullable(),
});

export const equityRouter = router({
  listForSector: publicProcedure
    .input(ListInput)
    .output(z.array(EquityOut))
    .query(async ({ ctx, input }) => {
      const rows = await ctx.prisma.sectorEquity.findMany({
        where: {
          sector_slug: input.sector_slug,
          ...(input.iso_country ? { iso_country: input.iso_country } : {}),
        },
        // Editorial display_order first, then largest market cap, then ticker
        // for deterministic tie-breaking across snapshots.
        orderBy: [
          { display_order: "asc" },
          { market_cap_usd: "desc" },
          { ticker: "asc" },
        ],
      });
      return rows as z.infer<typeof EquityOut>[];
    }),

  get: publicProcedure
    .input(z.object({ id: z.string().min(1) }))
    .output(EquityOut)
    .query(async ({ ctx, input }) => {
      const row = await ctx.prisma.sectorEquity.findUnique({
        where: { id: input.id },
      });
      if (!row) {
        throw new TRPCError({ code: "NOT_FOUND", message: `equity ${input.id}` });
      }
      return row as z.infer<typeof EquityOut>;
    }),

  basketStats: publicProcedure
    .input(
      z.object({
        sector_slug: z.string().min(1),
        days: z.number().int().positive().max(1825).default(90),
      }),
    )
    .output(
      z.object({
        sector_slug: z.string(),
        days: z.number(),
        basket: z.array(
          z.object({ trade_date: z.string(), basket_index: z.number() }),
        ),
        equities: z.array(
          z.object({
            equity_id: z.string(),
            return_pct: z.number().nullable(),
            volatility_annual_pct: z.number().nullable(),
            max_drawdown_pct: z.number().nullable(),
            beta: z.number().nullable(),
            alpha_annual_pct: z.number().nullable(),
            r_squared: z.number().nullable(),
            bars_used: z.number().int(),
          }),
        ),
      }),
    )
    .query(async ({ ctx, input }) => {
      const since = new Date();
      since.setUTCDate(since.getUTCDate() - input.days);

      // Pull all equities in the sector + each one's quote history in a
      // single round-trip. For ~20 equities × 90 bars this is fast — when
      // the basket grows past a few hundred equities we'll move this
      // aggregation into Postgres directly.
      const equities = await ctx.prisma.sectorEquity.findMany({
        where: { sector_slug: input.sector_slug },
        select: { id: true },
        orderBy: { ticker: "asc" },
      });
      const allQuotes = await ctx.prisma.equityQuote.findMany({
        where: {
          equity_id: { in: equities.map((e) => e.id) },
          trade_date: { gte: since },
        },
        orderBy: [{ equity_id: "asc" }, { trade_date: "asc" }],
        select: { equity_id: true, trade_date: true, close_local: true },
      });

      // Group by equity_id, preserving asc-by-date order.
      const byEquity = new Map<
        string,
        { trade_date: string; close: number }[]
      >();
      for (const e of equities) byEquity.set(e.id, []);
      for (const q of allQuotes) {
        const arr = byEquity.get(q.equity_id);
        if (arr) {
          arr.push({
            // Postgres DATE comes back as a Date — normalize to YYYY-MM-DD
            // string for the stats helper's date-key alignment.
            trade_date: q.trade_date.toISOString().slice(0, 10),
            close: q.close_local,
          });
        }
      }

      const series = equities.map((e) => ({
        equity_id: e.id,
        bars: byEquity.get(e.id) ?? [],
      }));
      const result = computeBasketStats(series);

      return {
        sector_slug: input.sector_slug,
        days: input.days,
        basket: result.basket,
        equities: result.equities,
      };
    }),

  history: publicProcedure
    .input(HistoryInput)
    .output(z.array(HistoryBarOut))
    .query(async ({ ctx, input }) => {
      // Confirm the equity exists so a deleted/wrong id surfaces as
      // 404 rather than an empty array (which is meaningful for
      // "equity exists, no bars ingested yet" cases).
      const exists = await ctx.prisma.sectorEquity.findUnique({
        where: { id: input.id },
        select: { id: true },
      });
      if (!exists) {
        throw new TRPCError({ code: "NOT_FOUND", message: `equity ${input.id}` });
      }
      const since = new Date();
      since.setUTCDate(since.getUTCDate() - input.days);
      const rows = await ctx.prisma.equityQuote.findMany({
        where: {
          equity_id: input.id,
          trade_date: { gte: since },
        },
        orderBy: { trade_date: "asc" },
        select: {
          trade_date: true,
          close_local: true,
          close_usd: true,
          volume: true,
        },
      });
      return rows as z.infer<typeof HistoryBarOut>[];
    }),
});
