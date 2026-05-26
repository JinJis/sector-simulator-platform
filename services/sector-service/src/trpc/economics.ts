/**
 * `economics.*` procedures — read paths over `economics_datapoints` (MP5).
 *
 * The Economics tab pairs metrics (primary vs baseline — e.g.,
 * orbit-DC $/kWh vs ground-DC $/kWh, fusion LCOE vs CCGT LCOE) and
 * renders them on EconomicsCurveChart with click-to-source datapoint
 * chips. Two procedures:
 *
 *   - list(sector_slug, metric_key?, since?, limit?) — paginated
 *     time-series per metric. Ordered ascending by `as_of` so
 *     charts can plot left → right.
 *   - latestPerMetric(sector_slug) — most-recent row per metric_key,
 *     used by the Overview hero preview to grab "what's the current
 *     point on each curve" in one roundtrip.
 *
 * Writes land later (M49e proper / MP7 cleanup); for now the data
 * comes from `pnpm db:seed:economics`.
 */

import { z } from "zod";

import { publicProcedure, router } from "./init.js";

// ---------- Schemas ----------

const EconomicsDatapointOut = z.object({
  id: z.string(),
  sector_slug: z.string(),
  metric_key: z.string(),
  value: z.number(),
  unit: z.string(),
  as_of: z.date(),
  source_url: z.string(),
  source_kind: z.string(),
  confidence: z.number(),
  notes: z.string().nullable(),
});

const ListInput = z.object({
  sector_slug: z.string().min(1),
  metric_key: z.string().min(1).optional(),
  since: z.string().optional(), // ISO date — lower bound on as_of
  limit: z.number().int().positive().max(500).default(200),
});

const LatestInput = z.object({
  sector_slug: z.string().min(1),
});

// ---------- Procedures ----------

export const economicsRouter = router({
  list: publicProcedure
    .input(ListInput)
    .output(z.array(EconomicsDatapointOut))
    .query(async ({ ctx, input }) => {
      const rows = await ctx.prisma.economicsDatapoint.findMany({
        where: {
          sector_slug: input.sector_slug,
          ...(input.metric_key ? { metric_key: input.metric_key } : {}),
          ...(input.since ? { as_of: { gte: new Date(input.since) } } : {}),
        },
        orderBy: [{ metric_key: "asc" }, { as_of: "asc" }],
        take: input.limit,
      });
      return rows.map((r) => ({
        id: r.id,
        sector_slug: r.sector_slug,
        metric_key: r.metric_key,
        value: r.value.toNumber(),
        unit: r.unit,
        as_of: r.as_of,
        source_url: r.source_url,
        source_kind: r.source_kind,
        confidence: r.confidence.toNumber(),
        notes: r.notes,
      }));
    }),

  latestPerMetric: publicProcedure
    .input(LatestInput)
    .output(z.array(EconomicsDatapointOut))
    .query(async ({ ctx, input }) => {
      // Postgres DISTINCT ON (metric_key) keyed by as_of desc gives us
      // "latest row per metric in one shot". Prisma doesn't expose
      // DISTINCT ON directly, so we use $queryRaw.
      const rows = await ctx.prisma.$queryRaw<
        Array<{
          id: string;
          sector_slug: string;
          metric_key: string;
          value: { toNumber: () => number };
          unit: string;
          as_of: Date;
          source_url: string;
          source_kind: string;
          confidence: { toNumber: () => number };
          notes: string | null;
        }>
      >`
        SELECT DISTINCT ON (metric_key)
          id, sector_slug, metric_key, value, unit, as_of,
          source_url, source_kind, confidence, notes
        FROM economics_datapoints
        WHERE sector_slug = ${input.sector_slug}
        ORDER BY metric_key ASC, as_of DESC
      `;
      return rows.map((r) => ({
        id: r.id,
        sector_slug: r.sector_slug,
        metric_key: r.metric_key,
        value: typeof r.value === "number" ? r.value : r.value.toNumber(),
        unit: r.unit,
        as_of: r.as_of,
        source_url: r.source_url,
        source_kind: r.source_kind,
        confidence:
          typeof r.confidence === "number"
            ? r.confidence
            : r.confidence.toNumber(),
        notes: r.notes,
      }));
    }),
});
