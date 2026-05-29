/**
 * Zod schemas backing the `vision.*` tRPC procedures.
 *
 * Lifted out of `vision.ts` so the router file can focus on procedure
 * wiring + the Prisma queries that back each shape. Types are still
 * inferred via `z.infer<typeof X>` where needed; consumers in
 * `apps/web` continue to read them through tRPC's `AppRouter`
 * inference, so this extraction is internal-only.
 */

import { z } from "zod";

export const VisionSummary = z.object({
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
export const CapabilityActorInOverview = z.object({
  actor_key: z.string(),
  actor_name: z.string(),
  actor_short_name: z.string().nullable(),
  iso_country: z.string(),
  role: z.string(),
});

export const CapabilityInVisionOverview = z.object({
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
export const ActorInVisionOverview = z.object({
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

export const RiskInVisionOverview = z.object({
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

export const SignalInVisionOverview = z.object({
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

// F8a-3: editorial overlay shapes. Match
// apps/web/src/app/visions/_types.ts so the renderer types stay
// stable. SourceRef is loose here (just URL) — the DB column is JSON
// and the frontend SourceChip degrades to URL-only.
export const ThesisBulletDto = z.object({
  text: z.string(),
  source_urls: z.array(z.string()).default([]),
});

export const InvestmentThesisDto = z.object({
  the_bet: z.string(),
  bull_case: z.array(ThesisBulletDto),
  bear_case: z.array(ThesisBulletDto),
  conviction: z.enum(["high", "medium", "low", "exploratory"]),
  last_reviewed: z.date(),
});

export const CatalystDto = z.object({
  id: z.string(),
  expected_at: z.date(),
  label: z.string(),
  capability_key: z.string().nullable(),
  side: z.enum(["bull", "bear", "neutral"]),
  source_url: z.string().nullable(),
  note: z.string().nullable(),
  display_order: z.number().int(),
});

export const VisionOverview = z.object({
  vision: VisionSummary,
  capabilities: z.array(CapabilityInVisionOverview),
  risks: z.array(RiskInVisionOverview),
  recent_signals: z.array(SignalInVisionOverview),
  // M45a: vision-level top-N actor cards for the Hero "Actors" band.
  actors: z.array(ActorInVisionOverview),
  // F8a-3: editorial overlay rows — null/empty when the Vision Builder's
  // ThesisDrafter stage didn't run or the admin hasn't authored them.
  investment_thesis: InvestmentThesisDto.nullable(),
  catalysts: z.array(CatalystDto),
});

export const FeasibilityHistoryPoint = z.object({
  as_of: z.date(),
  composite: z.number(),
  composite_p10: z.number().nullable(),
  composite_p90: z.number().nullable(),
  binding_capability_key: z.string().nullable(),
  eta_median_years: z.number().nullable(),
});
