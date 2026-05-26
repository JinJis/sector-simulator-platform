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

// Grounded-search citations the digest fetcher attaches to its
// signal row (one url + display title each). Most adapter-sourced
// signals (arXiv / USPTO / crawl4ai news) leave this empty since
// their `source_url` is already the primary reference.
const SignalCitation = z.object({
  url: z.string(),
  title: z.string(),
});

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
  citations: z.array(SignalCitation).default([]),
});

/**
 * Defensive parse of the Signal.citations JSONB column. The DB
 * stores `[{url, title}]` when the digest wrote them, NULL otherwise.
 * Any older row written before the column existed parses as `[]`.
 */
function parseCitations(raw: unknown): { url: string; title: string }[] {
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
          citations: parseCitations(s.citations),
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
        citations: parseCitations(s.citations),
      };
    }),

  /**
   * Daily signal volume per vision. Feeds M53 FeasibilityTimeline's
   * bottom-axis bars so signal spikes line up with the composite line.
   * Date returned as ISO "YYYY-MM-DD" (UTC) so client-side date math
   * is timezone-stable.
   */
  dailyVolume: publicProcedure
    .input(
      z.object({
        sector_slug: z.string().min(1),
        days: z.number().int().positive().max(365).default(180),
      }),
    )
    .output(
      z.array(z.object({ date: z.string(), count: z.number().int() })),
    )
    .query(async ({ ctx, input }) => {
      const since = new Date(Date.now() - input.days * 24 * 60 * 60 * 1000);
      const rows = await ctx.prisma.$queryRaw<
        Array<{ d: Date; count: bigint }>
      >`
        SELECT date_trunc('day', published_at) AS d,
               COUNT(*) AS count
        FROM signals
        WHERE sector_slug = ${input.sector_slug}
          AND published_at >= ${since}
        GROUP BY date_trunc('day', published_at)
        ORDER BY d ASC
      `;
      return rows.map((r) => ({
        date: r.d.toISOString().slice(0, 10),
        count: Number(r.count),
      }));
    }),

  /**
   * Per-actor 90-day signal count for a vision. Feeds M53
   * ActorRelevanceBubble's y-axis (signal volume) + the bot proposal
   * confidence story. Returns only actors with non-zero signals to
   * keep the bubble plot readable; consumers merge with the full
   * VisionActor list for relevance + stage.
   */
  countByActor: publicProcedure
    .input(
      z.object({
        sector_slug: z.string().min(1),
        days: z.number().int().positive().max(365).default(90),
      }),
    )
    .output(
      z.array(
        z.object({
          actor_id: z.string(),
          actor_key: z.string(),
          actor_name: z.string(),
          count: z.number().int(),
        }),
      ),
    )
    .query(async ({ ctx, input }) => {
      const since = new Date(Date.now() - input.days * 24 * 60 * 60 * 1000);
      const grouped = await ctx.prisma.signal.groupBy({
        by: ["actor_id"],
        where: {
          sector_slug: input.sector_slug,
          published_at: { gte: since },
          actor_id: { not: null },
        },
        _count: { _all: true },
      });
      const ids = grouped
        .map((g) => g.actor_id)
        .filter((x): x is string => typeof x === "string");
      if (ids.length === 0) return [];
      const actors = await ctx.prisma.actor.findMany({
        where: { id: { in: ids } },
        select: { id: true, key: true, name: true },
      });
      const byId = new Map(actors.map((a) => [a.id, a]));
      return grouped
        .map((g) => {
          const a = g.actor_id ? byId.get(g.actor_id) : null;
          if (!a) return null;
          return {
            actor_id: a.id,
            actor_key: a.key,
            actor_name: a.name,
            count: g._count._all,
          };
        })
        .filter((x): x is NonNullable<typeof x> => x !== null);
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
