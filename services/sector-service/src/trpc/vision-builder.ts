/**
 * `visionBuilder.*` — M41 Vision Builder agent surface.
 *
 * Two procedures with a manual approval seam between them:
 *
 *   1. `propose({ prompt, ... })` — calls agent-orchestration's
 *      `/vision-builder/build` (haiku → opus → sonnet → pure-Python
 *      gate). Returns the validated draft + signal config + gate
 *      verdict. NOTHING is persisted — admin reviews the draft and
 *      may edit it client-side before committing.
 *
 *   2. `commit({ draft, signal_config })` — persists the (possibly
 *      admin-edited) draft into the live DB inside one Prisma
 *      transaction:
 *        Sector / Capability[] / CapabilityDependency[] / Risk[] /
 *        Actor[] (UPSERT by global key) / VisionActor[] /
 *        CapabilityActor[] / initial CapabilityScore[] /
 *        seed VisionFeasibility row / signal_keywords[] per capability
 *
 * The split is deliberate: the agent CAN make mistakes that Pydantic
 * + the validation gate didn't catch, and "click before write" is
 * the safety net.
 */

import { TRPCError } from "@trpc/server";
import { z } from "zod";

import { agentFetch } from "../lib/agent-proxy.js";
import { publicProcedure, router } from "./init.js";

// ============== input / output schemas ===============================

// Mirror agent-orchestration/schemas.py — kept narrow to what
// persistence + the admin UI actually consume.

const CapabilityDraft = z.object({
  key: z
    .string()
    .regex(/^[a-z][a-z0-9_]*$/)
    .max(64),
  name: z.string().min(2).max(120),
  short_name: z.string().max(40).nullable().optional(),
  description: z.string().min(20).max(600),
  rationale: z.string().min(20).max(600),
  weight: z.number().min(0.02).max(0.50),
  display_order: z.number().int().min(10).max(10_000),
  primary_driver_name: z.string().max(80).nullable().optional(),
  initial_technical: z.number().min(0).max(100).nullable().optional(),
  initial_economic: z.number().min(0).max(100).nullable().optional(),
  initial_regulatory: z.number().min(0).max(100).nullable().optional(),
  initial_supply: z.number().min(0).max(100).nullable().optional(),
  confidence: z.number().min(0).max(1).default(0.7),
});

const CapabilityDependencyDraft = z.object({
  source_key: z.string().max(64),
  target_key: z.string().max(64),
  rationale: z.string().min(10).max(400),
});

const RiskDraft = z.object({
  key: z
    .string()
    .regex(/^[a-z][a-z0-9_]*$/)
    .max(64),
  category: z.enum([
    "political",
    "legal",
    "supply",
    "safety",
    "environmental",
    "financial",
    "social",
  ]),
  name: z.string().min(2).max(120),
  description: z.string().min(20).max(600),
  severity: z.enum(["low", "medium", "high", "critical"]),
  likelihood: z.enum(["low", "medium", "high"]),
  time_horizon: z.enum(["immediate", "1y", "3y", "5y", "10y"]),
  mitigations: z.string().max(600).nullable().optional(),
  affected_capability_keys: z.array(z.string()).max(10).default([]),
  display_order: z.number().int().min(10).max(10_000),
});

const ActorDraft = z.object({
  key: z
    .string()
    .regex(/^[a-z][a-z0-9_]*$/)
    .max(64),
  name: z.string().min(2).max(160),
  short_name: z.string().max(80).nullable().optional(),
  name_local: z.string().max(160).nullable().optional(),
  iso_country: z.string().regex(/^[A-Z]{2}$/),
  category: z.enum([
    "public_corp",
    "private_startup",
    "government_lab",
    "national_lab",
    "academic_lab",
    "standards_body",
    "ngo",
  ]),
  ticker: z.string().max(20).nullable().optional(),
  exchange: z.string().max(20).nullable().optional(),
  blurb: z.string().min(10).max(280),
  description: z.string().max(2000).nullable().optional(),
  stage: z.enum(["research", "pilot", "commercial", "scaling"]),
  website: z.string().max(300).nullable().optional(),
  signal_keywords: z.array(z.string()).min(1).max(20),
  relevance: z.number().min(0).max(100),
  rationale: z.string().min(10).max(600),
  display_order: z.number().int().min(10).max(10_000),
});

const CapabilityActorAssignmentDraft = z.object({
  capability_key: z.string().max(64),
  actor_key: z.string().max(64),
  role: z.enum(["lead", "competitor", "supplier", "customer", "regulator"]),
  rationale: z.string().max(400).nullable().optional(),
});

const VisionFeasibilityDraft = z.object({
  initial_composite: z.number().min(0).max(100),
  initial_p10: z.number().min(0).max(100).nullable().optional(),
  initial_p90: z.number().min(0).max(100).nullable().optional(),
  binding_capability_key: z.string().max(64),
  eta_median_years: z.number().min(0).max(50).nullable().optional(),
  eta_p10_years: z.number().min(0).max(50).nullable().optional(),
  eta_p90_years: z.number().min(0).max(50).nullable().optional(),
  rationale: z.string().min(20).max(600),
});

const VisionDraft = z.object({
  slug: z
    .string()
    .regex(/^[a-z0-9][a-z0-9-]*[a-z0-9]$/)
    .max(64),
  name: z.string().max(80),
  vision_question: z.string().max(240),
  description: z.string().min(50).max(2000),
  domain_label: z.string().max(40),
  capabilities: z.array(CapabilityDraft).min(3).max(15),
  dependencies: z.array(CapabilityDependencyDraft).max(50).default([]),
  risks: z.array(RiskDraft).min(2).max(12),
  actors: z.array(ActorDraft).min(3).max(30),
  capability_actors: z.array(CapabilityActorAssignmentDraft).min(1).max(100),
  initial_feasibility: VisionFeasibilityDraft,
  rationale: z.string().min(50).max(4000),
  confidence: z.number().min(0).max(1),
});

const CapabilityKeywordSet = z.object({
  capability_key: z.string().max(64),
  arxiv_keywords: z.array(z.string()).min(1).max(20),
  uspto_keywords: z.array(z.string()).max(20).default([]),
  news_keywords: z.array(z.string()).max(20).default([]),
});

const SignalConfig = z.object({
  keywords_by_capability: z.array(CapabilityKeywordSet).min(1).max(15),
  rationale: z.string().max(2000).default(""),
});

// F8a-2: editorial overlay produced by the ThesisDrafter agent stage.
// Mirrors agent_orchestration/schemas.py ThesisCatalystsDraft.
const ThesisBulletDraft = z.object({
  text: z.string().min(10).max(400),
  source_urls: z.array(z.string()).max(5).default([]),
});

const InvestmentThesisDraft = z.object({
  the_bet: z.string().min(20).max(400),
  bull_case: z.array(ThesisBulletDraft).min(2).max(6),
  bear_case: z.array(ThesisBulletDraft).min(2).max(6),
  conviction: z.enum(["high", "medium", "low", "exploratory"]),
});

const CatalystDraft = z.object({
  expected_at: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  label: z.string().min(5).max(200),
  capability_key: z.string().max(64).nullable().optional(),
  side: z.enum(["bull", "bear", "neutral"]),
  note: z.string().max(400).nullable().optional(),
  source_url: z.string().max(500).nullable().optional(),
});

const ThesisCatalystsDraftSchema = z.object({
  thesis: InvestmentThesisDraft,
  catalysts: z.array(CatalystDraft).min(2).max(10),
  rationale: z.string().max(2000).default(""),
});

const PromptValidationResult = z.object({
  is_valid: z.boolean(),
  rejection_kind: z
    .enum(["off_topic", "too_vague", "too_narrow", "policy_violation", "duplicate"])
    .nullable(),
  rejection_reason: z.string().nullable(),
  refined_question: z.string(),
  suggested_name: z.string(),
  suggested_slug: z.string(),
  domain_label: z.string(),
  scope: z.enum(["narrow", "balanced", "broad"]),
  suggested_capability_count: z.number().int(),
  suggested_actor_count: z.number().int(),
  review_notes: z.array(z.string()),
  reframing_options: z.array(z.string()).nullable().optional(),
  confidence: z.number(),
});

const ValidationGateDto = z.object({
  ok: z.boolean(),
  errors: z.array(z.string()),
  warnings: z.array(z.string()),
});

const StageMetricDto = z.object({
  name: z.string(),
  cost_usd: z.number(),
  duration_ms: z.number().int(),
});

const ProposeOutput = z.object({
  success: z.boolean(),
  validation: PromptValidationResult,
  draft: VisionDraft.nullable(),
  signal_config: SignalConfig.nullable(),
  gate: ValidationGateDto.nullable(),
  // F8a-2: editorial overlay. Null when the gate failed (drafter
  // skipped) or the drafter raised — commit still works in both cases,
  // just without thesis/catalysts rows.
  thesis_catalysts: ThesisCatalystsDraftSchema.nullable().optional(),
  stages: z.array(StageMetricDto),
  total_cost_usd: z.number(),
  total_duration_ms: z.number().int(),
});

const ApplyOutput = z.object({
  slug: z.string(),
  capability_count: z.number().int(),
  risk_count: z.number().int(),
  actor_count_inserted: z.number().int(),
  actor_count_reused: z.number().int(),
});

// ============== procedures ===========================================

export const visionBuilderRouter = router({
  /**
   * Stage 1 of the admin flow — runs the full agent pipeline and
   * returns the draft for review. No DB writes.
   *
   * The admin UI surfaces:
   *   - validation.rejection_reason on stage-1 reject
   *   - gate.errors on validation-gate failure (admin can re-prompt)
   *   - draft + gate.warnings on success (admin reviews + may edit)
   */
  propose: publicProcedure
    .input(
      z.object({
        prompt: z.string().min(15).max(4000),
        research_brief: z.string().max(20_000).nullable().optional(),
      }),
    )
    .output(ProposeOutput)
    .mutation(async ({ ctx, input }) => {
      // Pre-fetch existing vision slugs + actor keys so the validator
      // can flag duplicates and the decomposer can reuse existing
      // global actor keys (don't create samsung_2 when samsung exists).
      const [visions, actors] = await Promise.all([
        ctx.prisma.sector.findMany({
          where: { is_vision_eligible: true },
          select: { slug: true },
        }),
        ctx.prisma.actor.findMany({ select: { key: true } }),
      ]);
      const result = await agentFetch<z.infer<typeof ProposeOutput>>(
        "/vision-builder/build",
        {
          method: "POST",
          body: {
            prompt: input.prompt,
            existing_vision_slugs: visions.map((v) => v.slug),
            existing_actor_keys: actors.map((a) => a.key),
            research_brief: input.research_brief ?? null,
          },
          context: "vision-builder.propose",
        },
      );
      // Audit even rejections — the user-facing prompts ARE the
      // product, so we want to see how often each rejection kind hits.
      await ctx.prisma.auditLog.create({
        data: {
          action: "vision_builder.propose",
          payload: {
            prompt_length: input.prompt.length,
            success: result.success,
            rejection_kind: result.validation.rejection_kind,
            slug: result.draft?.slug ?? null,
            total_cost_usd: result.total_cost_usd,
          },
          author_label: ctx.user?.label ?? "anonymous",
        },
      });
      return result;
    }),

  /**
   * Stage 2 — persist the (admin-approved, possibly admin-edited)
   * draft + signal_config into the DB in one transaction. Returns
   * the new vision slug + summary counts so the admin UI can
   * redirect to `/visions/<slug>`.
   *
   * Idempotency: this procedure REFUSES to write if a Sector with
   * the same slug already exists — duplicate detection happens at
   * propose() time. To re-apply with edits, the admin must delete
   * the old sector first (sector.delete).
   */
  commit: publicProcedure
    .input(
      z.object({
        draft: VisionDraft,
        signal_config: SignalConfig.nullable().optional(),
        // F8a-2: optional editorial overlay produced by Stage 5
        // (ThesisDrafter). When present, the commit transaction also
        // writes one InvestmentThesis row + N Catalyst rows.
        thesis_catalysts: ThesisCatalystsDraftSchema.nullable().optional(),
        author_label: z.string().max(120).optional(),
      }),
    )
    .output(ApplyOutput)
    .mutation(async ({ ctx, input }) => {
      const { draft, signal_config, thesis_catalysts } = input;

      const existing = await ctx.prisma.sector.findUnique({
        where: { slug: draft.slug },
        select: { slug: true },
      });
      if (existing) {
        throw new TRPCError({
          code: "CONFLICT",
          message: `vision '${draft.slug}' already exists — delete first or refine the prompt`,
        });
      }

      const author = input.author_label ?? ctx.user?.label ?? "vision-builder";

      // ---- one transaction; everything or nothing ----
      const result = await ctx.prisma.$transaction(async (tx) => {
        // 1. Sector row (the Vision)
        const sector = await tx.sector.create({
          data: {
            slug: draft.slug,
            name: draft.name,
            description: draft.description,
            vision_question: draft.vision_question,
            is_vision_eligible: true,
            status: "draft", // admin promotes to "live" via SQLAdmin Sector edit
          },
        });

        // 2. Capabilities — keep key → id map for downstream FKs
        const capIdByKey = new Map<string, string>();
        for (const c of draft.capabilities) {
          const merged_keywords = signal_config
            ? mergeKeywords(c.key, signal_config.keywords_by_capability)
            : [];
          const row = await tx.capability.create({
            data: {
              sector_slug: sector.slug,
              key: c.key,
              name: c.name,
              short_name: c.short_name ?? null,
              description: c.description,
              rationale: c.rationale,
              display_order: c.display_order,
              weight: c.weight,
              primary_driver_name: c.primary_driver_name ?? null,
              signal_keywords: merged_keywords,
            },
          });
          capIdByKey.set(c.key, row.id);
        }

        // 3. CapabilityDependency rows (DAG already validated by gate)
        for (const dep of draft.dependencies) {
          const sourceId = capIdByKey.get(dep.source_key);
          const targetId = capIdByKey.get(dep.target_key);
          if (!sourceId || !targetId) continue; // gate would have rejected
          await tx.capabilityDependency.create({
            data: {
              source_id: sourceId,
              target_id: targetId,
              rationale: dep.rationale,
            },
          });
        }

        // 4. Risk rows
        for (const r of draft.risks) {
          await tx.risk.create({
            data: {
              sector_slug: sector.slug,
              key: r.key,
              category: r.category,
              name: r.name,
              description: r.description,
              severity: r.severity,
              likelihood: r.likelihood,
              time_horizon: r.time_horizon,
              mitigations: r.mitigations ?? null,
              affected_capability_keys: r.affected_capability_keys,
              display_order: r.display_order,
            },
          });
        }

        // 5. Actors — UPSERT by global `key`. New actors get inserted;
        //    existing ones get their description/keywords merged-in
        //    (don't overwrite curator-set data wholesale).
        const actorIdByKey = new Map<string, string>();
        let actor_count_inserted = 0;
        let actor_count_reused = 0;
        for (const a of draft.actors) {
          const before = await tx.actor.findUnique({
            where: { key: a.key },
            select: { id: true },
          });
          if (before) {
            actor_count_reused += 1;
            actorIdByKey.set(a.key, before.id);
          } else {
            const row = await tx.actor.create({
              data: {
                key: a.key,
                name: a.name,
                short_name: a.short_name ?? null,
                name_local: a.name_local ?? null,
                iso_country: a.iso_country,
                category: a.category,
                ticker: a.ticker ?? null,
                exchange: a.exchange ?? null,
                blurb: a.blurb,
                description: a.description ?? null,
                stage: a.stage,
                website: a.website ?? null,
                signal_keywords: a.signal_keywords,
              },
            });
            actor_count_inserted += 1;
            actorIdByKey.set(a.key, row.id);
          }
        }
        // 5b. capability_actors may reference actors outside draft.actors[]
        //     (existing global keys). Resolve those now.
        const referencedKeys = new Set(draft.capability_actors.map((ca) => ca.actor_key));
        const unresolvedKeys = [...referencedKeys].filter((k) => !actorIdByKey.has(k));
        if (unresolvedKeys.length > 0) {
          const externals = await tx.actor.findMany({
            where: { key: { in: unresolvedKeys } },
            select: { id: true, key: true },
          });
          for (const a of externals) actorIdByKey.set(a.key, a.id);
          const stillMissing = unresolvedKeys.filter((k) => !actorIdByKey.has(k));
          if (stillMissing.length > 0) {
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: `capability_actors references unknown actors: ${stillMissing.join(", ")}`,
            });
          }
        }

        // 6. VisionActor join — one per actor in draft.actors[]
        for (const a of draft.actors) {
          await tx.visionActor.create({
            data: {
              actor_id: actorIdByKey.get(a.key)!,
              sector_slug: sector.slug,
              relevance: a.relevance,
              rationale: a.rationale,
              display_order: a.display_order,
            },
          });
        }

        // 7. CapabilityActor join
        for (const ca of draft.capability_actors) {
          const capId = capIdByKey.get(ca.capability_key);
          const actorId = actorIdByKey.get(ca.actor_key);
          if (!capId || !actorId) continue; // gate validated; defensive
          await tx.capabilityActor.create({
            data: {
              capability_id: capId,
              actor_id: actorId,
              role: ca.role,
              rationale: ca.rationale ?? null,
            },
          });
        }

        // 8. Seed CapabilityScore (is_current=true) per capability
        const now = new Date();
        for (const c of draft.capabilities) {
          const capId = capIdByKey.get(c.key)!;
          await tx.capabilityScore.create({
            data: {
              capability_id: capId,
              technical: c.initial_technical ?? null,
              economic: c.initial_economic ?? null,
              regulatory: c.initial_regulatory ?? null,
              supply: c.initial_supply ?? null,
              composite: pickComposite(c),
              as_of: now,
              is_current: true,
              rationale: "Seeded by Vision Builder agent.",
            },
          });
        }

        // 9. Seed VisionFeasibility
        await tx.visionFeasibility.create({
          data: {
            sector_slug: sector.slug,
            as_of: now,
            is_current: true,
            composite: draft.initial_feasibility.initial_composite,
            composite_p10: draft.initial_feasibility.initial_p10 ?? null,
            composite_p90: draft.initial_feasibility.initial_p90 ?? null,
            binding_capability_key: draft.initial_feasibility.binding_capability_key,
            eta_median_years: draft.initial_feasibility.eta_median_years ?? null,
            eta_p10_years: draft.initial_feasibility.eta_p10_years ?? null,
            eta_p90_years: draft.initial_feasibility.eta_p90_years ?? null,
            rationale: draft.initial_feasibility.rationale,
          },
        });

        // 10. (F8a-2) Editorial overlay — investment thesis + catalysts.
        //     Optional; the panels render empty if these are absent.
        if (thesis_catalysts) {
          await tx.investmentThesis.create({
            data: {
              sector_slug: sector.slug,
              the_bet: thesis_catalysts.thesis.the_bet,
              bull_case: thesis_catalysts.thesis.bull_case,
              bear_case: thesis_catalysts.thesis.bear_case,
              conviction: thesis_catalysts.thesis.conviction,
              last_reviewed: now,
            },
          });
          for (let i = 0; i < thesis_catalysts.catalysts.length; i++) {
            const cat = thesis_catalysts.catalysts[i]!;
            await tx.catalyst.create({
              data: {
                sector_slug: sector.slug,
                // Parse ISO date string to a UTC midnight so timezone
                // shifts don't surface ±1 day on the timeline.
                expected_at: new Date(`${cat.expected_at}T00:00:00Z`),
                label: cat.label,
                capability_key: cat.capability_key ?? null,
                side: cat.side,
                note: cat.note ?? null,
                source_url: cat.source_url ?? null,
                display_order: (i + 1) * 10,
              },
            });
          }
        }

        return {
          slug: sector.slug,
          capability_count: draft.capabilities.length,
          risk_count: draft.risks.length,
          actor_count_inserted,
          actor_count_reused,
        };
      });

      // Audit log outside the transaction so the apply commits even
      // if the audit insert hiccups.
      await ctx.prisma.auditLog.create({
        data: {
          action: "vision_builder.commit",
          sector_slug: result.slug,
          payload: {
            slug: result.slug,
            capability_count: result.capability_count,
            risk_count: result.risk_count,
            actor_count_inserted: result.actor_count_inserted,
            actor_count_reused: result.actor_count_reused,
          },
          author_label: author,
        },
      });

      return result;
    }),
});

// ---- helpers --------------------------------------------------------

function mergeKeywords(
  capability_key: string,
  keyword_sets: z.infer<typeof CapabilityKeywordSet>[],
): string[] {
  const match = keyword_sets.find((kws) => kws.capability_key === capability_key);
  if (!match) return [];
  return [
    ...new Set([
      ...match.arxiv_keywords,
      ...match.uspto_keywords,
      ...match.news_keywords,
    ]),
  ];
}

/**
 * Synthesize an initial composite from the 4-dim seed scores. We
 * deliberately use a simple weighted-mean here rather than calling
 * the simulation-service aggregator — this is a Day-0 snapshot, the
 * M40 recompute cron will overwrite tomorrow.
 */
function pickComposite(c: z.infer<typeof CapabilityDraft>): number | null {
  const dims = [
    c.initial_technical,
    c.initial_economic,
    c.initial_regulatory,
    c.initial_supply,
  ].filter((v): v is number => v != null);
  if (dims.length === 0) return null;
  const sum = dims.reduce((a, b) => a + b, 0);
  return Math.round((sum / dims.length) * 100) / 100;
}
