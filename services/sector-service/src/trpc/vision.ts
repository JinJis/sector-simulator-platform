/**
 * `vision.*` procedures — the M36 pivot's product-language namespace.
 *
 * A "Vision" is the user-facing concept layered on top of the existing
 * `sectors` table (rows where `is_vision_eligible = true`). The
 * underlying physical table keeps its name for migration-history hygiene
 * (see docs/PIVOT.md §4.1) — only the tRPC surface, UI copy, and prompt
 * vocabulary shift.
 *
 * This router is intentionally small: it exposes the *vision-shaped*
 * reads the hero page needs (overview composite + history). CRUD for
 * the underlying sector row still lives in `sector.*`. CRUD for
 * capabilities / signals / risks lives in their own sibling routers
 * (capability.* / signal.* / risk.* / feasibility.*).
 */

import { TRPCError } from "@trpc/server";
import { z } from "zod";

import { publicProcedure, router } from "./init.js";

// ---------- Schemas ----------

const VisionSummary = z.object({
  slug: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  vision_question: z.string().nullable(),
  is_vision_eligible: z.boolean(),
  status: z.string(),
  capability_count: z.number().int(),
  signal_count_30d: z.number().int(),
  risk_count: z.number().int(),
  feasibility: z
    .object({
      composite: z.number(),
      composite_p10: z.number().nullable(),
      composite_p90: z.number().nullable(),
      binding_capability_key: z.string().nullable(),
      eta_median_years: z.number().nullable(),
      eta_p10_years: z.number().nullable(),
      eta_p90_years: z.number().nullable(),
      delta_90d: z.number().nullable(),
      as_of: z.date(),
    })
    .nullable(),
});

// M45a: per-capability actor pill shape — minimal so the Hero capability
// card footer can render "Active: SpaceX 🇺🇸 · Lonestar 🇺🇸 · Starcloud
// 🇺🇸" without a second tRPC round-trip.
const CapabilityActorInOverview = z.object({
  actor_key: z.string(),
  actor_name: z.string(),
  actor_short_name: z.string().nullable(),
  iso_country: z.string(),
  role: z.string(),
});

const CapabilityInVisionOverview = z.object({
  id: z.string(),
  key: z.string(),
  name: z.string(),
  short_name: z.string().nullable(),
  description: z.string(),
  rationale: z.string(),
  display_order: z.number().int(),
  weight: z.number(),
  primary_driver_name: z.string().nullable(),
  is_binding: z.boolean(),
  current_score: z
    .object({
      technical: z.number().nullable(),
      economic: z.number().nullable(),
      regulatory: z.number().nullable(),
      supply: z.number().nullable(),
      composite: z.number().nullable(),
      composite_p10: z.number().nullable(),
      composite_p90: z.number().nullable(),
      as_of: z.date(),
      rationale: z.string().nullable(),
    })
    .nullable(),
  latest_signal: z
    .object({
      id: z.string(),
      title: z.string(),
      source_kind: z.string(),
      source_url: z.string(),
      published_at: z.date(),
      delta_composite: z.number().nullable(),
    })
    .nullable(),
  // M45a: top-3 actors active on this capability (sorted by role then
  // CapabilityActor.id for stability). Renders in the card footer.
  active_actors: z.array(CapabilityActorInOverview),
});

// M45a: vision-level actor card shape (sorted by VisionActor.relevance
// desc). Renders in the Hero "Actors" band.
const ActorInVisionOverview = z.object({
  actor_key: z.string(),
  actor_id: z.string(),
  name: z.string(),
  short_name: z.string().nullable(),
  iso_country: z.string(),
  category: z.string(),
  stage: z.string(),
  blurb: z.string(),
  ticker: z.string().nullable(),
  exchange: z.string().nullable(),
  logo_url: z.string().nullable(),
  relevance: z.number().nullable(),
  rationale: z.string().nullable(),
  display_order: z.number().int(),
});

const RiskInVisionOverview = z.object({
  id: z.string(),
  key: z.string(),
  category: z.string(),
  name: z.string(),
  description: z.string(),
  severity: z.string(),
  likelihood: z.string(),
  time_horizon: z.string(),
  mitigations: z.string().nullable(),
  affected_capability_keys: z.array(z.string()),
  // MP4 — source attribution surfaced through the Overview Risk Board
  // so the same SourceChip wiring works without a second tRPC roundtrip.
  source_url: z.string().nullable(),
  source_kind: z.string().nullable(),
  source_title: z.string().nullable(),
  display_order: z.number().int(),
});

const SignalInVisionOverview = z.object({
  id: z.string(),
  title: z.string(),
  summary: z.string().nullable(),
  source_kind: z.string(),
  source_url: z.string(),
  published_at: z.date(),
  capability_id: z.string().nullable(),
  capability_key: z.string().nullable(),
  delta_technical: z.number().nullable(),
  delta_economic: z.number().nullable(),
  delta_regulatory: z.number().nullable(),
  delta_supply: z.number().nullable(),
  is_highlight: z.boolean(),
  // Grounded-search citations (digest signals carry them; adapter
  // signals leave the array empty). Same shape as `crawler.signal.list`.
  citations: z
    .array(z.object({ url: z.string(), title: z.string() }))
    .default([]),
});

const VisionOverview = z.object({
  vision: VisionSummary,
  capabilities: z.array(CapabilityInVisionOverview),
  risks: z.array(RiskInVisionOverview),
  recent_signals: z.array(SignalInVisionOverview),
  // M45a: vision-level top-N actor cards for the Hero "Actors" band.
  actors: z.array(ActorInVisionOverview),
});

const FeasibilityHistoryPoint = z.object({
  as_of: z.date(),
  composite: z.number(),
  composite_p10: z.number().nullable(),
  composite_p90: z.number().nullable(),
  binding_capability_key: z.string().nullable(),
  eta_median_years: z.number().nullable(),
});

// ---------- Helpers ----------

/**
 * Pick the highest-delta absolute value across the 4 dimensions —
 * surfaces as the "delta_composite" on the latest-signal hero pill.
 * Returns null when every dim is null (signal not yet scored).
 */
/**
 * Same helper as in signal.ts — defensive parse of Signal.citations
 * (JSONB column). Kept duplicated rather than extracted because each
 * router file should be readable in isolation; promote to a shared
 * helper if a third callsite appears.
 */
function parseSignalCitations(raw: unknown): { url: string; title: string }[] {
  if (!Array.isArray(raw)) return [];
  const out: { url: string; title: string }[] = [];
  for (const item of raw) {
    if (item && typeof item === "object") {
      const url = (item as { url?: unknown }).url;
      const title = (item as { title?: unknown }).title;
      if (typeof url === "string" && url.length > 0) {
        out.push({ url, title: typeof title === "string" ? title : url });
      }
    }
  }
  return out;
}

function pickComposite(s: {
  delta_technical: number | null;
  delta_economic: number | null;
  delta_regulatory: number | null;
  delta_supply: number | null;
}): number | null {
  const xs = [s.delta_technical, s.delta_economic, s.delta_regulatory, s.delta_supply].filter(
    (v): v is number => v != null,
  );
  let best: number | null = null;
  for (const v of xs) {
    if (best === null || Math.abs(v) > Math.abs(best)) best = v;
  }
  return best;
}

// ---------- Procedures ----------

export const visionRouter = router({
  /**
   * Vision card grid for `/visions`. Returns one summary per
   * vision-eligible sector with feasibility + cardinality counts so
   * the landing renders in one query.
   */
  list: publicProcedure
    .input(
      z
        .object({
          include_legacy: z.boolean().default(false),
          limit: z.number().int().positive().max(200).default(100),
        })
        .default({}),
    )
    .output(z.array(VisionSummary))
    .query(async ({ ctx, input }) => {
      const sectors = await ctx.prisma.sector.findMany({
        where: input.include_legacy ? {} : { is_vision_eligible: true, status: "live" },
        orderBy: [{ status: "asc" }, { created_at: "desc" }],
        take: input.limit,
      });
      if (sectors.length === 0) return [];

      const slugs = sectors.map((s) => s.slug);
      const since30d = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

      // Parallel: counts + current feasibility per slug.
      const [capCounts, signalCounts, riskCounts, feasibilities] = await Promise.all([
        ctx.prisma.capability.groupBy({
          by: ["sector_slug"],
          where: { sector_slug: { in: slugs } },
          _count: { _all: true },
        }),
        ctx.prisma.signal.groupBy({
          by: ["sector_slug"],
          where: { sector_slug: { in: slugs }, published_at: { gte: since30d } },
          _count: { _all: true },
        }),
        ctx.prisma.risk.groupBy({
          by: ["sector_slug"],
          where: { sector_slug: { in: slugs } },
          _count: { _all: true },
        }),
        ctx.prisma.visionFeasibility.findMany({
          where: { sector_slug: { in: slugs }, is_current: true },
        }),
      ]);

      const capBySlug = new Map(capCounts.map((c) => [c.sector_slug, c._count._all]));
      const sigBySlug = new Map(signalCounts.map((c) => [c.sector_slug, c._count._all]));
      const riskBySlug = new Map(riskCounts.map((c) => [c.sector_slug, c._count._all]));
      const feasBySlug = new Map(feasibilities.map((f) => [f.sector_slug, f]));

      return sectors.map((s) => {
        const f = feasBySlug.get(s.slug);
        return {
          slug: s.slug,
          name: s.name,
          description: s.description,
          vision_question: s.vision_question,
          is_vision_eligible: s.is_vision_eligible,
          status: s.status,
          capability_count: capBySlug.get(s.slug) ?? 0,
          signal_count_30d: sigBySlug.get(s.slug) ?? 0,
          risk_count: riskBySlug.get(s.slug) ?? 0,
          feasibility: f
            ? {
                composite: f.composite,
                composite_p10: f.composite_p10,
                composite_p90: f.composite_p90,
                binding_capability_key: f.binding_capability_key,
                eta_median_years: f.eta_median_years,
                eta_p10_years: f.eta_p10_years,
                eta_p90_years: f.eta_p90_years,
                delta_90d: f.delta_90d,
                as_of: f.as_of,
              }
            : null,
        };
      });
    }),

  /**
   * Summary of one vision (without capability/signal/risk arrays).
   * Used by the page header — light query for breadcrumbs etc.
   */
  get: publicProcedure
    .input(z.object({ slug: z.string().min(1) }))
    .output(VisionSummary)
    .query(async ({ ctx, input }) => {
      const sector = await ctx.prisma.sector.findUnique({ where: { slug: input.slug } });
      if (!sector) {
        throw new TRPCError({ code: "NOT_FOUND", message: `vision ${input.slug}` });
      }
      const since30d = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
      const [capCount, signalCount, riskCount, feas] = await Promise.all([
        ctx.prisma.capability.count({ where: { sector_slug: input.slug } }),
        ctx.prisma.signal.count({
          where: { sector_slug: input.slug, published_at: { gte: since30d } },
        }),
        ctx.prisma.risk.count({ where: { sector_slug: input.slug } }),
        ctx.prisma.visionFeasibility.findFirst({
          where: { sector_slug: input.slug, is_current: true },
        }),
      ]);
      return {
        slug: sector.slug,
        name: sector.name,
        description: sector.description,
        vision_question: sector.vision_question,
        is_vision_eligible: sector.is_vision_eligible,
        status: sector.status,
        capability_count: capCount,
        signal_count_30d: signalCount,
        risk_count: riskCount,
        feasibility: feas
          ? {
              composite: feas.composite,
              composite_p10: feas.composite_p10,
              composite_p90: feas.composite_p90,
              binding_capability_key: feas.binding_capability_key,
              eta_median_years: feas.eta_median_years,
              eta_p10_years: feas.eta_p10_years,
              eta_p90_years: feas.eta_p90_years,
              delta_90d: feas.delta_90d,
              as_of: feas.as_of,
            }
          : null,
      };
    }),

  /**
   * Composite payload for the hero `/visions/[slug]` Overview page.
   * One query returns everything the page renders above the fold:
   * vision summary + capabilities (with current score + latest signal
   * per capability) + risks + recent_signals (top N for the live feed
   * panel).
   *
   * Designed for ≤1 round-trip per page load. The capability list is
   * sorted by display_order asc; the recent_signals list is sorted by
   * published_at desc.
   */
  getOverview: publicProcedure
    .input(
      z.object({
        slug: z.string().min(1),
        signal_limit: z.number().int().positive().max(50).default(8),
        // M45a: how many vision-level actors to surface in the Hero
        // "Actors" band (sorted by VisionActor.relevance desc).
        actor_limit: z.number().int().positive().max(50).default(12),
        // M45a: per-capability active-actor pills shown on the card
        // footer. 3 fits the layout; more requires the detail page.
        actors_per_capability: z.number().int().positive().max(10).default(3),
      }),
    )
    .output(VisionOverview)
    .query(async ({ ctx, input }) => {
      // Pull the sector + everything in parallel — the page can't render
      // until all of these arrive anyway.
      const [sector, capabilities, risks, recentSignals, currentFeas, visionActors] =
        await Promise.all([
          ctx.prisma.sector.findUnique({ where: { slug: input.slug } }),
          ctx.prisma.capability.findMany({
            where: { sector_slug: input.slug },
            orderBy: { display_order: "asc" },
            include: {
              scores: {
                where: { is_current: true },
                orderBy: { as_of: "desc" },
                take: 1,
              },
              signals: {
                orderBy: { published_at: "desc" },
                take: 1,
              },
              // M45a: include the top-N CapabilityActor rows per
              // capability for the card-footer pills. Prisma can't
              // order by an enum natively; we slice client-side after
              // a stable order, prioritizing role=lead, then sorting
              // by the role string for determinism.
              capability_actors: {
                include: { actor: true },
                orderBy: [{ role: "asc" }, { id: "asc" }],
                // Fetch more than display limit so we can prioritize
                // lead → competitor → supplier → customer → regulator
                // client-side without losing leads.
                take: input.actors_per_capability * 3,
              },
            },
          }),
          ctx.prisma.risk.findMany({
            where: { sector_slug: input.slug },
            orderBy: { display_order: "asc" },
          }),
          ctx.prisma.signal.findMany({
            where: { sector_slug: input.slug },
            orderBy: { published_at: "desc" },
            take: input.signal_limit,
            include: { capability: { select: { key: true } } },
          }),
          ctx.prisma.visionFeasibility.findFirst({
            where: { sector_slug: input.slug, is_current: true },
          }),
          ctx.prisma.visionActor.findMany({
            where: { sector_slug: input.slug },
            include: { actor: true },
            orderBy: [
              { relevance: { sort: "desc", nulls: "last" } },
              { display_order: "asc" },
            ],
            take: input.actor_limit,
          }),
        ]);
      if (!sector) {
        throw new TRPCError({ code: "NOT_FOUND", message: `vision ${input.slug}` });
      }

      const since30d = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
      const signalCount30d = await ctx.prisma.signal.count({
        where: { sector_slug: input.slug, published_at: { gte: since30d } },
      });

      const bindingKey = currentFeas?.binding_capability_key ?? null;

      const visionSummary = {
        slug: sector.slug,
        name: sector.name,
        description: sector.description,
        vision_question: sector.vision_question,
        is_vision_eligible: sector.is_vision_eligible,
        status: sector.status,
        capability_count: capabilities.length,
        signal_count_30d: signalCount30d,
        risk_count: risks.length,
        feasibility: currentFeas
          ? {
              composite: currentFeas.composite,
              composite_p10: currentFeas.composite_p10,
              composite_p90: currentFeas.composite_p90,
              binding_capability_key: currentFeas.binding_capability_key,
              eta_median_years: currentFeas.eta_median_years,
              eta_p10_years: currentFeas.eta_p10_years,
              eta_p90_years: currentFeas.eta_p90_years,
              delta_90d: currentFeas.delta_90d,
              as_of: currentFeas.as_of,
            }
          : null,
      };

      // M45a: role priority for trimming per-capability actor pills —
      // lead first, then competitor / supplier / customer / regulator.
      const ROLE_PRIORITY: Record<string, number> = {
        lead: 0,
        competitor: 1,
        supplier: 2,
        customer: 3,
        regulator: 4,
      };

      return {
        vision: visionSummary,
        capabilities: capabilities.map((c) => {
          const cs = c.scores[0] ?? null;
          const ls = c.signals[0] ?? null;
          // Prioritize lead → ... → regulator, then slice to limit.
          const orderedActors = [...c.capability_actors].sort((a, b) => {
            const pa = ROLE_PRIORITY[a.role] ?? 99;
            const pb = ROLE_PRIORITY[b.role] ?? 99;
            return pa - pb;
          });
          const sliced = orderedActors.slice(0, input.actors_per_capability);
          return {
            id: c.id,
            key: c.key,
            name: c.name,
            short_name: c.short_name,
            description: c.description,
            rationale: c.rationale,
            display_order: c.display_order,
            weight: c.weight,
            primary_driver_name: c.primary_driver_name,
            is_binding: bindingKey != null && c.key === bindingKey,
            current_score: cs
              ? {
                  technical: cs.technical,
                  economic: cs.economic,
                  regulatory: cs.regulatory,
                  supply: cs.supply,
                  composite: cs.composite,
                  composite_p10: cs.composite_p10,
                  composite_p90: cs.composite_p90,
                  as_of: cs.as_of,
                  rationale: cs.rationale,
                }
              : null,
            latest_signal: ls
              ? {
                  id: ls.id,
                  title: ls.title,
                  source_kind: ls.source_kind,
                  source_url: ls.source_url,
                  published_at: ls.published_at,
                  delta_composite: pickComposite(ls),
                }
              : null,
            active_actors: sliced.map((ca) => ({
              actor_key: ca.actor.key,
              actor_name: ca.actor.name,
              actor_short_name: ca.actor.short_name,
              iso_country: ca.actor.iso_country,
              role: ca.role,
            })),
          };
        }),
        risks: risks.map((r) => ({
          id: r.id,
          key: r.key,
          category: r.category,
          name: r.name,
          description: r.description,
          severity: r.severity,
          likelihood: r.likelihood,
          time_horizon: r.time_horizon,
          mitigations: r.mitigations,
          affected_capability_keys: r.affected_capability_keys,
          source_url: r.source_url,
          source_kind: r.source_kind,
          source_title: r.source_title,
          display_order: r.display_order,
        })),
        recent_signals: recentSignals.map((s) => ({
          id: s.id,
          title: s.title,
          summary: s.summary,
          source_kind: s.source_kind,
          source_url: s.source_url,
          published_at: s.published_at,
          capability_id: s.capability_id,
          capability_key: s.capability?.key ?? null,
          delta_technical: s.delta_technical,
          delta_economic: s.delta_economic,
          delta_regulatory: s.delta_regulatory,
          delta_supply: s.delta_supply,
          is_highlight: s.is_highlight,
          citations: parseSignalCitations(s.citations),
        })),
        actors: visionActors.map((va) => ({
          actor_key: va.actor.key,
          actor_id: va.actor.id,
          name: va.actor.name,
          short_name: va.actor.short_name,
          iso_country: va.actor.iso_country,
          category: va.actor.category,
          stage: va.actor.stage,
          blurb: va.actor.blurb,
          ticker: va.actor.ticker,
          exchange: va.actor.exchange,
          logo_url: va.actor.logo_url,
          relevance: va.relevance,
          rationale: va.rationale,
          display_order: va.display_order,
        })),
      };
    }),

  /**
   * Time series of the vision-level composite score. Used by the hero
   * trajectory sparkline and by the Feasibility tab's full trajectory
   * chart. Returns at most `limit` snapshots, ordered by as_of asc
   * so chart libraries don't have to reverse.
   */
  feasibilityHistory: publicProcedure
    .input(
      z.object({
        slug: z.string().min(1),
        limit: z.number().int().positive().max(365).default(180),
      }),
    )
    .output(z.array(FeasibilityHistoryPoint))
    .query(async ({ ctx, input }) => {
      const rows = await ctx.prisma.visionFeasibility.findMany({
        where: { sector_slug: input.slug },
        orderBy: { as_of: "desc" },
        take: input.limit,
      });
      // Render-friendly asc order.
      rows.reverse();
      return rows.map((r) => ({
        as_of: r.as_of,
        composite: r.composite,
        composite_p10: r.composite_p10,
        composite_p90: r.composite_p90,
        binding_capability_key: r.binding_capability_key,
        eta_median_years: r.eta_median_years,
      }));
    }),
});
