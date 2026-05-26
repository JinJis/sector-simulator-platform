/**
 * `signal.*` procedures — read paths over the Signal table.
 *
 * M36 ships:
 *   - list(slug, filter?) — paginated chronological feed
 *   - get(id)             — single signal detail
 *   - markHighlight       — admin toggle for the hero "highlight" pill
 *
 * The actual signal ingestion + extractor agent writes live in
 * services/data-pipeline + services/agent-orchestration (M39). This
 * router is the user-app/admin read surface only.
 */

import { TRPCError } from "@trpc/server";
import { z } from "zod";

import { publicProcedure, router } from "./init.js";

// ---------- Schemas ----------

const SignalKind = z.enum([
  "paper",
  "patent",
  "news",
  "filing",
  "gov_report",
  "vendor_doc",
  "dataset",
  "social",
]);

const SignalOut = z.object({
  id: z.string(),
  sector_slug: z.string(),
  capability_id: z.string().nullable(),
  capability_key: z.string().nullable(),
  source_kind: z.string(),
  source_url: z.string(),
  source_id_ext: z.string().nullable(),
  title: z.string(),
  summary: z.string().nullable(),
  published_at: z.date(),
  delta_technical: z.number().nullable(),
  delta_economic: z.number().nullable(),
  delta_regulatory: z.number().nullable(),
  delta_supply: z.number().nullable(),
  is_highlight: z.boolean(),
  ingested_at: z.date(),
});

const ListInput = z.object({
  sector_slug: z.string().min(1),
  capability_key: z.string().min(1).optional(),
  /** Optional global Actor.key — restricts to signals tagged with this
   *  actor_id. Used by MP3 actor detail "Recent signals about this
   *  actor" feed. Missing actor → NOT_FOUND. */
  actor_key: z.string().min(1).optional(),
  source_kind: SignalKind.optional(),
  highlight_only: z.boolean().default(false),
  cursor: z.string().optional(), // ISO datetime of last seen published_at
  limit: z.number().int().positive().max(100).default(30),
});

// ---------- Procedures ----------

export const signalRouter = router({
  list: publicProcedure
    .input(ListInput)
    .output(
      z.object({
        items: z.array(SignalOut),
        next_cursor: z.string().nullable(),
      }),
    )
    .query(async ({ ctx, input }) => {
      // Resolve capability filter to id if provided.
      let capabilityIdFilter: string | undefined;
      if (input.capability_key) {
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
        capabilityIdFilter = cap.id;
      }

      // Resolve actor filter to id if provided (MP3).
      let actorIdFilter: string | undefined;
      if (input.actor_key) {
        const actor = await ctx.prisma.actor.findUnique({
          where: { key: input.actor_key },
          select: { id: true },
        });
        if (!actor) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: `actor ${input.actor_key}`,
          });
        }
        actorIdFilter = actor.id;
      }

      const where = {
        sector_slug: input.sector_slug,
        ...(capabilityIdFilter ? { capability_id: capabilityIdFilter } : {}),
        ...(actorIdFilter ? { actor_id: actorIdFilter } : {}),
        ...(input.source_kind ? { source_kind: input.source_kind } : {}),
        ...(input.highlight_only ? { is_highlight: true } : {}),
        ...(input.cursor ? { published_at: { lt: new Date(input.cursor) } } : {}),
      };

      // Fetch limit+1 to detect next cursor.
      const rows = await ctx.prisma.signal.findMany({
        where,
        orderBy: { published_at: "desc" },
        take: input.limit + 1,
        include: { capability: { select: { key: true } } },
      });
      const has_more = rows.length > input.limit;
      const items = has_more ? rows.slice(0, input.limit) : rows;
      const last = items.length > 0 ? items[items.length - 1] : null;
      const next_cursor = has_more && last ? last.published_at.toISOString() : null;

      return {
        items: items.map((s) => ({
          id: s.id,
          sector_slug: s.sector_slug,
          capability_id: s.capability_id,
          capability_key: s.capability?.key ?? null,
          source_kind: s.source_kind,
          source_url: s.source_url,
          source_id_ext: s.source_id_ext,
          title: s.title,
          summary: s.summary,
          published_at: s.published_at,
          delta_technical: s.delta_technical,
          delta_economic: s.delta_economic,
          delta_regulatory: s.delta_regulatory,
          delta_supply: s.delta_supply,
          is_highlight: s.is_highlight,
          ingested_at: s.ingested_at,
        })),
        next_cursor,
      };
    }),

  get: publicProcedure
    .input(z.object({ id: z.string().min(1) }))
    .output(SignalOut)
    .query(async ({ ctx, input }) => {
      const s = await ctx.prisma.signal.findUnique({
        where: { id: input.id },
        include: { capability: { select: { key: true } } },
      });
      if (!s) {
        throw new TRPCError({ code: "NOT_FOUND", message: `signal ${input.id}` });
      }
      return {
        id: s.id,
        sector_slug: s.sector_slug,
        capability_id: s.capability_id,
        capability_key: s.capability?.key ?? null,
        source_kind: s.source_kind,
        source_url: s.source_url,
        source_id_ext: s.source_id_ext,
        title: s.title,
        summary: s.summary,
        published_at: s.published_at,
        delta_technical: s.delta_technical,
        delta_economic: s.delta_economic,
        delta_regulatory: s.delta_regulatory,
        delta_supply: s.delta_supply,
        is_highlight: s.is_highlight,
        ingested_at: s.ingested_at,
      };
    }),

  markHighlight: publicProcedure
    .input(
      z.object({
        id: z.string().min(1),
        is_highlight: z.boolean(),
        author_label: z.string().max(120).optional(),
      }),
    )
    .output(z.object({ ok: z.boolean(), id: z.string(), is_highlight: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      const existing = await ctx.prisma.signal.findUnique({
        where: { id: input.id },
        select: { sector_slug: true, is_highlight: true },
      });
      if (!existing) {
        throw new TRPCError({ code: "NOT_FOUND", message: `signal ${input.id}` });
      }
      await ctx.prisma.signal.update({
        where: { id: input.id },
        data: { is_highlight: input.is_highlight },
      });
      await ctx.prisma.auditLog.create({
        data: {
          action: "signal.markHighlight",
          sector_slug: existing.sector_slug,
          payload: {
            id: input.id,
            from: existing.is_highlight,
            to: input.is_highlight,
          },
          author_label: input.author_label ?? ctx.user?.label ?? "anonymous",
        },
      });
      return { ok: true, id: input.id, is_highlight: input.is_highlight };
    }),
});
