/**
 * `actor.*` procedures — Actor CRUD + per-vision and per-capability
 * linking. Global Actor table; vision/capability M2M via VisionActor +
 * CapabilityActor.
 *
 * M45a ships:
 *   - global CRUD (upsert/delete)
 *   - per-vision list (sorted by relevance)
 *   - per-capability list (sorted by role priority)
 *   - link / unlink vision-actor and capability-actor
 *
 * Used by:
 *   - Hero "Actors" band — `vision.getOverview` extended payload at M45a
 *   - Capability card "active actors" footer — `capability.get` extended
 *   - Admin seed scripts (M45b)
 *   - Vision Builder agent persist step (M41+M45)
 */

import { TRPCError } from "@trpc/server";
import { z } from "zod";

import { publicProcedure, router } from "./init.js";

// ---------- Schemas ----------

const ActorCategory = z.enum([
  "public_corp",
  "private_startup",
  "government_lab",
  "national_lab",
  "academic_lab",
  "standards_body",
  "ngo",
]);
const ActorStage = z.enum(["research", "pilot", "commercial", "scaling"]);
const CapabilityActorRole = z.enum([
  "lead",
  "competitor",
  "supplier",
  "customer",
  "regulator",
]);

const ActorOut = z.object({
  id: z.string(),
  key: z.string(),
  name: z.string(),
  short_name: z.string().nullable(),
  name_local: z.string().nullable(),
  iso_country: z.string(),
  category: z.string(),
  ticker: z.string().nullable(),
  exchange: z.string().nullable(),
  blurb: z.string(),
  description: z.string().nullable(),
  stage: z.string(),
  logo_url: z.string().nullable(),
  website: z.string().nullable(),
  signal_keywords: z.array(z.string()),
  created_at: z.date(),
  updated_at: z.date(),
});

const VisionActorOut = z.object({
  id: z.string(),
  actor_id: z.string(),
  sector_slug: z.string(),
  relevance: z.number().nullable(),
  rationale: z.string().nullable(),
  display_order: z.number().int(),
  actor: ActorOut,
});

const CapabilityActorOut = z.object({
  id: z.string(),
  capability_id: z.string(),
  actor_id: z.string(),
  role: z.string(),
  stage: z.string().nullable(),
  rationale: z.string().nullable(),
  actor: ActorOut,
});

const UpsertActorInput = z.object({
  key: z
    .string()
    .regex(/^[a-z0-9_]+$/, "snake_case lowercase alphanumeric only")
    .min(1)
    .max(80),
  name: z.string().min(1).max(160),
  short_name: z.string().max(80).nullable().optional(),
  name_local: z.string().max(160).nullable().optional(),
  iso_country: z.string().length(2),
  category: ActorCategory,
  ticker: z.string().max(20).nullable().optional(),
  exchange: z.string().max(20).nullable().optional(),
  blurb: z.string().min(1).max(280),
  description: z.string().max(4000).nullable().optional(),
  stage: ActorStage,
  logo_url: z.string().url().nullable().optional(),
  website: z.string().url().nullable().optional(),
  signal_keywords: z.array(z.string().min(1).max(120)).default([]),
  author_label: z.string().max(120).optional(),
});

const LinkVisionInput = z.object({
  actor_key: z.string().min(1),
  sector_slug: z.string().min(1),
  relevance: z.number().min(0).max(100).nullable().optional(),
  rationale: z.string().max(1000).nullable().optional(),
  display_order: z.number().int().min(0).max(10_000).default(100),
  author_label: z.string().max(120).optional(),
});

const LinkCapabilityInput = z.object({
  actor_key: z.string().min(1),
  sector_slug: z.string().min(1),
  capability_key: z.string().min(1),
  role: CapabilityActorRole.default("competitor"),
  stage: ActorStage.nullable().optional(),
  rationale: z.string().max(1000).nullable().optional(),
  author_label: z.string().max(120).optional(),
});

// ---------- Procedures ----------

export const actorRouter = router({
  /**
   * Per-vision actor list sorted by relevance desc, then display_order
   * asc. Used by the /visions/[slug]/actors page + the Hero "Actors"
   * band (top-N slice).
   */
  listForVision: publicProcedure
    .input(
      z.object({
        sector_slug: z.string().min(1),
        limit: z.number().int().positive().max(200).default(100),
      }),
    )
    .output(z.array(VisionActorOut))
    .query(async ({ ctx, input }) => {
      const rows = await ctx.prisma.visionActor.findMany({
        where: { sector_slug: input.sector_slug },
        include: { actor: true },
        orderBy: [{ relevance: { sort: "desc", nulls: "last" } }, { display_order: "asc" }],
        take: input.limit,
      });
      return rows.map((r) => ({
        id: r.id,
        actor_id: r.actor_id,
        sector_slug: r.sector_slug,
        relevance: r.relevance,
        rationale: r.rationale,
        display_order: r.display_order,
        actor: r.actor as z.infer<typeof ActorOut>,
      }));
    }),

  /**
   * Per-capability actor list. Used by capability detail page +
   * capability card "Active actors:" footer (top-N).
   */
  listForCapability: publicProcedure
    .input(
      z.object({
        sector_slug: z.string().min(1),
        capability_key: z.string().min(1),
      }),
    )
    .output(z.array(CapabilityActorOut))
    .query(async ({ ctx, input }) => {
      const cap = await ctx.prisma.capability.findUnique({
        where: {
          sector_slug_key: { sector_slug: input.sector_slug, key: input.capability_key },
        },
        select: { id: true },
      });
      if (!cap) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: `capability ${input.sector_slug}/${input.capability_key}`,
        });
      }
      const rows = await ctx.prisma.capabilityActor.findMany({
        where: { capability_id: cap.id },
        include: { actor: true },
        orderBy: { role: "asc" },
      });
      return rows.map((r) => ({
        id: r.id,
        capability_id: r.capability_id,
        actor_id: r.actor_id,
        role: r.role,
        stage: r.stage,
        rationale: r.rationale,
        actor: r.actor as z.infer<typeof ActorOut>,
      }));
    }),

  /**
   * Detail for one actor by global key — name, blurb, full description,
   * country + ticker. Used by the actor detail page.
   */
  get: publicProcedure
    .input(z.object({ key: z.string().min(1) }))
    .output(ActorOut)
    .query(async ({ ctx, input }) => {
      const row = await ctx.prisma.actor.findUnique({ where: { key: input.key } });
      if (!row) {
        throw new TRPCError({ code: "NOT_FOUND", message: `actor ${input.key}` });
      }
      return row as z.infer<typeof ActorOut>;
    }),

  /**
   * Upsert an Actor by global key. Used by:
   *  - M45b seed-actors.ts script
   *  - M41 Vision Builder agent (actor draft → admin approval →
   *    `actor.upsert`)
   *  - M46 community proposal ADD_ACTOR (admin approves → apply pipeline
   *    calls this)
   */
  upsert: publicProcedure
    .input(UpsertActorInput)
    .output(ActorOut)
    .mutation(async ({ ctx, input }) => {
      const row = await ctx.prisma.actor.upsert({
        where: { key: input.key },
        create: {
          key: input.key,
          name: input.name,
          short_name: input.short_name ?? null,
          name_local: input.name_local ?? null,
          iso_country: input.iso_country.toUpperCase(),
          category: input.category,
          ticker: input.ticker ?? null,
          exchange: input.exchange ?? null,
          blurb: input.blurb,
          description: input.description ?? null,
          stage: input.stage,
          logo_url: input.logo_url ?? null,
          website: input.website ?? null,
          signal_keywords: input.signal_keywords,
        },
        update: {
          name: input.name,
          short_name: input.short_name ?? null,
          name_local: input.name_local ?? null,
          iso_country: input.iso_country.toUpperCase(),
          category: input.category,
          ticker: input.ticker ?? null,
          exchange: input.exchange ?? null,
          blurb: input.blurb,
          description: input.description ?? null,
          stage: input.stage,
          logo_url: input.logo_url ?? null,
          website: input.website ?? null,
          signal_keywords: input.signal_keywords,
        },
      });
      await ctx.prisma.auditLog.create({
        data: {
          action: "actor.upsert",
          // Actor is global, not vision-scoped — sector_slug stays null.
          sector_slug: null,
          payload: {
            key: input.key,
            category: input.category,
            iso_country: input.iso_country,
            ticker: input.ticker ?? null,
          },
          author_label: input.author_label ?? ctx.user?.label ?? "anonymous",
        },
      });
      return row as z.infer<typeof ActorOut>;
    }),

  delete: publicProcedure
    .input(
      z.object({
        key: z.string().min(1),
        author_label: z.string().max(120).optional(),
      }),
    )
    .output(z.object({ ok: z.boolean(), key: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const existing = await ctx.prisma.actor.findUnique({
        where: { key: input.key },
        select: { id: true },
      });
      if (!existing) {
        throw new TRPCError({ code: "NOT_FOUND", message: `actor ${input.key}` });
      }
      await ctx.prisma.actor.delete({ where: { id: existing.id } });
      await ctx.prisma.auditLog.create({
        data: {
          action: "actor.delete",
          sector_slug: null,
          payload: { key: input.key, id: existing.id },
          author_label: input.author_label ?? ctx.user?.label ?? "anonymous",
        },
      });
      return { ok: true, key: input.key };
    }),

  /**
   * Link or update a VisionActor join row (Vision ↔ Actor M2M).
   * Idempotent on (actor_id, sector_slug) — second call updates the
   * existing row's relevance / rationale / display_order.
   */
  linkToVision: publicProcedure
    .input(LinkVisionInput)
    .output(VisionActorOut)
    .mutation(async ({ ctx, input }) => {
      const [actor, sector] = await Promise.all([
        ctx.prisma.actor.findUnique({
          where: { key: input.actor_key },
          select: { id: true },
        }),
        ctx.prisma.sector.findUnique({
          where: { slug: input.sector_slug },
          select: { slug: true },
        }),
      ]);
      if (!actor) {
        throw new TRPCError({ code: "NOT_FOUND", message: `actor ${input.actor_key}` });
      }
      if (!sector) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: `sector ${input.sector_slug}`,
        });
      }

      const row = await ctx.prisma.visionActor.upsert({
        where: {
          actor_id_sector_slug: { actor_id: actor.id, sector_slug: input.sector_slug },
        },
        create: {
          actor_id: actor.id,
          sector_slug: input.sector_slug,
          relevance: input.relevance ?? null,
          rationale: input.rationale ?? null,
          display_order: input.display_order,
        },
        update: {
          relevance: input.relevance ?? null,
          rationale: input.rationale ?? null,
          display_order: input.display_order,
        },
        include: { actor: true },
      });

      await ctx.prisma.auditLog.create({
        data: {
          action: "actor.linkToVision",
          sector_slug: input.sector_slug,
          payload: {
            actor_key: input.actor_key,
            relevance: input.relevance ?? null,
            display_order: input.display_order,
          },
          author_label: input.author_label ?? ctx.user?.label ?? "anonymous",
        },
      });

      return {
        id: row.id,
        actor_id: row.actor_id,
        sector_slug: row.sector_slug,
        relevance: row.relevance,
        rationale: row.rationale,
        display_order: row.display_order,
        actor: row.actor as z.infer<typeof ActorOut>,
      };
    }),

  unlinkFromVision: publicProcedure
    .input(
      z.object({
        actor_key: z.string().min(1),
        sector_slug: z.string().min(1),
        author_label: z.string().max(120).optional(),
      }),
    )
    .output(z.object({ ok: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      const actor = await ctx.prisma.actor.findUnique({
        where: { key: input.actor_key },
        select: { id: true },
      });
      if (!actor) {
        // Idempotent — removing from a nonexistent actor is a no-op.
        return { ok: true };
      }
      const existing = await ctx.prisma.visionActor.findUnique({
        where: {
          actor_id_sector_slug: { actor_id: actor.id, sector_slug: input.sector_slug },
        },
      });
      if (!existing) {
        return { ok: true };
      }
      await ctx.prisma.visionActor.delete({ where: { id: existing.id } });
      await ctx.prisma.auditLog.create({
        data: {
          action: "actor.unlinkFromVision",
          sector_slug: input.sector_slug,
          payload: { actor_key: input.actor_key },
          author_label: input.author_label ?? ctx.user?.label ?? "anonymous",
        },
      });
      return { ok: true };
    }),

  /**
   * Link or update a CapabilityActor join row (Capability ↔ Actor M2M).
   * Resolves capability by (sector_slug, capability_key) for caller
   * ergonomics. Idempotent on (capability_id, actor_id).
   */
  linkToCapability: publicProcedure
    .input(LinkCapabilityInput)
    .output(CapabilityActorOut)
    .mutation(async ({ ctx, input }) => {
      const [actor, cap] = await Promise.all([
        ctx.prisma.actor.findUnique({
          where: { key: input.actor_key },
          select: { id: true },
        }),
        ctx.prisma.capability.findUnique({
          where: {
            sector_slug_key: {
              sector_slug: input.sector_slug,
              key: input.capability_key,
            },
          },
          select: { id: true },
        }),
      ]);
      if (!actor) {
        throw new TRPCError({ code: "NOT_FOUND", message: `actor ${input.actor_key}` });
      }
      if (!cap) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: `capability ${input.sector_slug}/${input.capability_key}`,
        });
      }

      const row = await ctx.prisma.capabilityActor.upsert({
        where: {
          capability_id_actor_id: { capability_id: cap.id, actor_id: actor.id },
        },
        create: {
          capability_id: cap.id,
          actor_id: actor.id,
          role: input.role,
          stage: input.stage ?? null,
          rationale: input.rationale ?? null,
        },
        update: {
          role: input.role,
          stage: input.stage ?? null,
          rationale: input.rationale ?? null,
        },
        include: { actor: true },
      });

      await ctx.prisma.auditLog.create({
        data: {
          action: "actor.linkToCapability",
          sector_slug: input.sector_slug,
          payload: {
            actor_key: input.actor_key,
            capability_key: input.capability_key,
            role: input.role,
          },
          author_label: input.author_label ?? ctx.user?.label ?? "anonymous",
        },
      });

      return {
        id: row.id,
        capability_id: row.capability_id,
        actor_id: row.actor_id,
        role: row.role,
        stage: row.stage,
        rationale: row.rationale,
        actor: row.actor as z.infer<typeof ActorOut>,
      };
    }),

  unlinkFromCapability: publicProcedure
    .input(
      z.object({
        actor_key: z.string().min(1),
        sector_slug: z.string().min(1),
        capability_key: z.string().min(1),
        author_label: z.string().max(120).optional(),
      }),
    )
    .output(z.object({ ok: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      const [actor, cap] = await Promise.all([
        ctx.prisma.actor.findUnique({
          where: { key: input.actor_key },
          select: { id: true },
        }),
        ctx.prisma.capability.findUnique({
          where: {
            sector_slug_key: {
              sector_slug: input.sector_slug,
              key: input.capability_key,
            },
          },
          select: { id: true },
        }),
      ]);
      if (!actor || !cap) {
        return { ok: true }; // idempotent
      }
      const existing = await ctx.prisma.capabilityActor.findUnique({
        where: {
          capability_id_actor_id: { capability_id: cap.id, actor_id: actor.id },
        },
      });
      if (!existing) {
        return { ok: true };
      }
      await ctx.prisma.capabilityActor.delete({ where: { id: existing.id } });
      await ctx.prisma.auditLog.create({
        data: {
          action: "actor.unlinkFromCapability",
          sector_slug: input.sector_slug,
          payload: {
            actor_key: input.actor_key,
            capability_key: input.capability_key,
          },
          author_label: input.author_label ?? ctx.user?.label ?? "anonymous",
        },
      });
      return { ok: true };
    }),
});
