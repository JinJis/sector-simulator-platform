/**
 * `sim.*` procedures — thin proxy over services/simulation-service.
 *
 * Schemas are duplicated here (not imported) on purpose: tRPC clients only
 * see the types this router exposes, and we want the boundary explicit.
 * If simulation-service adds a field, we deliberately decide whether to
 * surface it here.
 */

import { z } from "zod";

import { simFetch } from "../lib/sim-proxy.js";
import { publicProcedure, router } from "./init.js";

// ---------- Schemas (mirror simulation-service Pydantic models) ----------

const Driver = z.object({
  name: z.string(),
  default: z.number(),
  min: z.number(),
  max: z.number(),
  unit: z.string(),
  description: z.string(),
  group: z.string(),
});

const Output = z.object({
  name: z.string(),
  series: z.array(z.number()).nullable(),
  scalar: z.number().nullable(),
  unit: z.string(),
  description: z.string(),
});

const Source = z.object({
  title: z.string(),
  url: z.string(),
  excerpt: z.string(),
  as_of: z.string(),
  kind: z.string(),
});

const HistoryPoint = z.object({
  date: z.string(),
  value: z.number(),
});

const Provenance = z.object({
  history: z.array(HistoryPoint),
  sources: z.array(Source),
  note: z.string(),
});

const SimMetadata = z.object({
  slug: z.string(),
  name: z.string(),
  description: z.string(),
  horizon_years: z.number(),
  drivers: z.array(Driver),
  presets: z.record(z.record(z.number())),
  provenance: z.record(Provenance),
});

const SimRunResponse = z.object({
  slug: z.string(),
  drivers: z.record(z.number()),
  outputs: z.array(Output),
});

const SensitivityEntry = z.object({
  driver: z.string(),
  swing: z.number(),
});

const SensitivityResponse = z.object({
  slug: z.string(),
  by_output: z.record(z.array(SensitivityEntry)),
});

const LiveResponse = z.object({
  slug: z.string(),
  tick: z.number(),
  timestamp: z.string(),
  drivers: z.record(z.number()),
  outputs: z.array(Output),
});

const GraphNode = z.object({
  id: z.string(),
  label: z.string(),
  kind: z.string(),
  group: z.string(),
  unit: z.string(),
  description: z.string(),
});

const GraphEdge = z.object({
  source: z.string(),
  target: z.string(),
  label: z.string(),
});

const SimGraphResponse = z.object({
  slug: z.string(),
  nodes: z.array(GraphNode),
  edges: z.array(GraphEdge),
});

const ReportSource = z.object({
  title: z.string(),
  url: z.string(),
  as_of: z.string(),
  kind: z.string(),
  drivers: z.array(z.string()),
});

const ReportResponse = z.object({
  slug: z.string(),
  generated_at: z.string(),
  markdown: z.string(),
  sources: z.array(ReportSource),
});

const SlugInput = z.object({ slug: z.string().min(1) });

// ---------- Procedures ----------

export const simRouter = router({
  list: publicProcedure
    .input(
      z
        .object({
          /** Admin clients pass true to see drafts + archived alongside live. */
          include_non_live: z.boolean().default(false),
        })
        .default({}),
    )
    .output(z.array(SimMetadata))
    .query(async ({ ctx, input }) => {
      const sims = await simFetch<z.infer<typeof SimMetadata>[]>("/sims", {
        context: "sims",
      });
      if (input.include_non_live) return sims;
      // M21: filter out anything whose DB row is not `live`. Sectors
      // without a DB row (e.g. the legacy "placeholder" or a sim that
      // hasn't been seeded yet) fall through as visible — the absence
      // of metadata isn't a strong "hide it" signal.
      try {
        const dbRows = await ctx.prisma.sector.findMany({
          where: { slug: { in: sims.map((s) => s.slug) } },
          select: { slug: true, status: true },
        });
        const statusBySlug = new Map(dbRows.map((r) => [r.slug, r.status]));
        return sims.filter((s) => {
          const st = statusBySlug.get(s.slug);
          return st === undefined || st === "live";
        });
      } catch (e) {
        ctx.log.warn(
          { err: e instanceof Error ? e.message : String(e) },
          "sim.list: status filter query failed; returning unfiltered",
        );
        return sims;
      }
    }),

  get: publicProcedure
    .input(SlugInput)
    .output(SimMetadata)
    .query(({ input }) => simFetch(`/sims/${input.slug}`, { context: `sim:${input.slug}` })),

  run: publicProcedure
    .input(SlugInput.extend({ drivers: z.record(z.number()) }))
    .output(SimRunResponse)
    .mutation(async ({ ctx, input }) => {
      // M9: load any non-neutral edge weights for this sector and forward
      // them to simulation-service. The Python sim multiplies by these
      // at named choke points; absent edges or weight==1.0 reproduce the
      // legacy hand-coded math byte-for-byte.
      //
      // Failure mode: if Postgres is unreachable or the graph hasn't
      // been seeded yet, we fall back to the empty-weights path (== the
      // legacy behavior). The sim should still produce outputs — graph
      // integration is additive, not gating.
      let edge_weights: { source: string; target: string; weight: number }[] = [];
      try {
        const edgeRows = await ctx.prisma.graphEdge.findMany({
          where: { sector_slug: input.slug },
          select: { source_key: true, target_key: true, weight: true },
        });
        edge_weights = edgeRows
          .filter((e) => Math.abs(e.weight - 1.0) > 1e-12)
          .map((e) => ({ source: e.source_key, target: e.target_key, weight: e.weight }));
      } catch (e) {
        ctx.log.warn(
          { err: e instanceof Error ? e.message : String(e), slug: input.slug },
          "sim.run: graph_edges query failed; falling back to neutral weights",
        );
      }
      return simFetch(`/sims/${input.slug}/run`, {
        method: "POST",
        body: { drivers: input.drivers, edge_weights },
        context: `sim.run:${input.slug}`,
      });
    }),

  sensitivity: publicProcedure
    .input(SlugInput)
    .output(SensitivityResponse)
    .query(({ input }) =>
      simFetch(`/sims/${input.slug}/sensitivity`, {
        context: `sim.sensitivity:${input.slug}`,
      }),
    ),

  live: publicProcedure
    .input(SlugInput)
    .output(LiveResponse)
    .query(({ input }) =>
      simFetch(`/sims/${input.slug}/live`, { context: `sim.live:${input.slug}` }),
    ),

  graph: publicProcedure
    .input(SlugInput)
    .output(SimGraphResponse)
    .query(({ input }) =>
      simFetch(`/sims/${input.slug}/graph`, { context: `sim.graph:${input.slug}` }),
    ),

  report: publicProcedure
    .input(
      SlugInput.extend({
        drivers: z.record(z.number()).default({}),
        scenario_name: z.string().nullable().optional(),
        scenario_notes: z.string().nullable().optional(),
      }),
    )
    .output(ReportResponse)
    .mutation(({ input }) =>
      simFetch(`/sims/${input.slug}/report`, {
        method: "POST",
        body: {
          drivers: input.drivers,
          scenario_name: input.scenario_name ?? null,
          scenario_notes: input.scenario_notes ?? null,
        },
        context: `sim.report:${input.slug}`,
      }),
    ),
});
