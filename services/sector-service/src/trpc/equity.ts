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

import { computeImpactScores, type ImpactEdge } from "../lib/graph-impact.js";
import { simFetch } from "../lib/sim-proxy.js";
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

const FinancialQuarterOut = z.object({
  fiscal_year: z.number().int(),
  fiscal_quarter: z.number().int().min(1).max(4),
  period_end: z.date(),
  revenue_usd: z.number().nullable(),
  cogs_usd: z.number().nullable(),
  gross_profit_usd: z.number().nullable(),
  opex_usd: z.number().nullable(),
  ebitda_usd: z.number().nullable(),
  net_income_usd: z.number().nullable(),
  capex_usd: z.number().nullable(),
  // Balance sheet (M10d) — usually populated; the simple-endpoint
  // legacy data and mock-seed earlier than M10d leaves these null.
  total_assets_usd: z.number().nullable(),
  total_liabilities_usd: z.number().nullable(),
  total_equity_usd: z.number().nullable(),
  source: z.string(),
});

const FinancialsInput = z.object({
  id: z.string().min(1),
  quarters: z.number().int().positive().max(40).default(8),
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

  financials: publicProcedure
    .input(FinancialsInput)
    .output(z.array(FinancialQuarterOut))
    .query(async ({ ctx, input }) => {
      const exists = await ctx.prisma.sectorEquity.findUnique({
        where: { id: input.id },
        select: { id: true },
      });
      if (!exists) {
        throw new TRPCError({ code: "NOT_FOUND", message: `equity ${input.id}` });
      }
      const rows = await ctx.prisma.equityFinancial.findMany({
        where: { equity_id: input.id },
        orderBy: { period_end: "desc" },
        take: input.quarters,
      });
      return rows as z.infer<typeof FinancialQuarterOut>[];
    }),

  impactScores: publicProcedure
    .input(
      z.object({
        sector_slug: z.string().min(1),
        driver_values: z.record(z.number()),
      }),
    )
    .output(
      z.object({
        sector_slug: z.string(),
        // {equity_id: score ∈ [-100, +100]}
        scores: z.record(z.number()),
      }),
    )
    .query(async ({ ctx, input }) => {
      // M9 server-side impliedImpact — derived from the graph topology
      // (driver → equity edges in `graph_edges`) rather than the
      // legacy `driver_links` JSONB. Falls back to the M1 formula on
      // the client if this returns an empty map (no graph seeded).
      const [meta, edges, equityNodes] = await Promise.all([
        simFetch<{
          drivers: { name: string; default: number }[];
        }>(`/sims/${input.sector_slug}`, { context: `sim:${input.sector_slug}` }),
        ctx.prisma.graphEdge.findMany({
          where: { sector_slug: input.sector_slug },
          select: { source_key: true, target_key: true, weight: true },
        }),
        ctx.prisma.graphNode.findMany({
          where: { sector_slug: input.sector_slug, kind: "equity" },
          select: { node_key: true, equity_id: true },
        }),
      ]);

      const driverDefaults: Record<string, number> = {};
      for (const d of meta.drivers) {
        driverDefaults[d.name] = d.default;
      }

      // Keep only edges that terminate at an equity node — we don't
      // care about driver → intermediate edges for this score.
      const equityKeys = new Set(equityNodes.map((n) => n.node_key));
      const equityEdges: ImpactEdge[] = edges
        .filter((e) => equityKeys.has(e.target_key))
        .map((e) => ({
          source_key: e.source_key,
          target_key: e.target_key,
          weight: e.weight,
        }));

      const byNodeKey = computeImpactScores({
        driverValues: input.driver_values,
        driverDefaults,
        edges: equityEdges,
      });

      // Translate node_key → equity_id for client-side joins with
      // the existing equities list.
      const scoresById: Record<string, number> = {};
      for (const n of equityNodes) {
        if (n.equity_id && n.node_key in byNodeKey) {
          scoresById[n.equity_id] = byNodeKey[n.node_key]!;
        }
      }

      return { sector_slug: input.sector_slug, scores: scoresById };
    }),
});
