/**
 * `graph.*` procedures — CRUD over the causal-graph topology stored in
 * `graph_nodes` + `graph_edges`. The Python `SimGraph` literal is still
 * the *bootstrap* source (one-time seed via `seed-graph.ts`) but
 * thereafter the DB is authoritative — every read on the user app's
 * `/sectors/[slug]/graph` page goes through `graph.get`, and the
 * upcoming graph editor (M7+) writes back through `upsertNode` /
 * `upsertEdge` / `delete*` mutations.
 *
 * Every mutation writes an `audit_logs` row so we can attribute edits
 * once auth lands. Free-form `author_label` defaults to "anonymous"
 * for now.
 *
 * Milestone 9 will wire `weight` into the Python sim at choke points;
 * for milestone 7 the math layer ignores it (still default 1.0 for
 * every seeded edge), so editing it is a no-op on outputs — only the
 * topology + UI shape change.
 */

import { TRPCError } from "@trpc/server";
import { z } from "zod";

import type { Context } from "./context.js";
import { publicProcedure, router } from "./init.js";

// ---------- Schemas ----------

const NodeKind = z.enum(["driver", "intermediate", "output", "equity"]);
const Magnitude = z.enum(["low", "med", "high"]);
const Origin = z.enum(["seed", "edit", "agent"]);

const GraphNodeOut = z.object({
  id: z.string(),
  sector_slug: z.string(),
  node_key: z.string(),
  kind: z.string(),
  label: z.string(),
  group: z.string(),
  unit: z.string().nullable(),
  description: z.string().nullable(),
  position_x: z.number().nullable(),
  position_y: z.number().nullable(),
  equity_id: z.string().nullable(),
  created_at: z.date(),
  updated_at: z.date(),
});

const GraphEdgeOut = z.object({
  id: z.string(),
  sector_slug: z.string(),
  source_key: z.string(),
  target_key: z.string(),
  label: z.string().nullable(),
  weight: z.number(),
  magnitude: z.string(),
  origin: z.string(),
  author_label: z.string().nullable(),
  created_at: z.date(),
  updated_at: z.date(),
});

const GraphResponse = z.object({
  sector_slug: z.string(),
  nodes: z.array(GraphNodeOut),
  edges: z.array(GraphEdgeOut),
});

const SlugInput = z.object({ sector_slug: z.string().min(1) });

const UpsertNodeInput = z.object({
  sector_slug: z.string().min(1),
  node_key: z.string().min(1).max(120),
  kind: NodeKind,
  label: z.string().min(1).max(200),
  group: z.string().max(120).default(""),
  unit: z.string().max(40).nullable().optional(),
  description: z.string().max(2000).nullable().optional(),
  position_x: z.number().nullable().optional(),
  position_y: z.number().nullable().optional(),
  equity_id: z.string().nullable().optional(),
  author_label: z.string().max(120).optional(),
});

const NodeKeyInput = z.object({
  sector_slug: z.string().min(1),
  node_key: z.string().min(1),
  author_label: z.string().max(120).optional(),
});

const UpsertEdgeInput = z.object({
  sector_slug: z.string().min(1),
  source_key: z.string().min(1),
  target_key: z.string().min(1),
  weight: z.number().finite().min(-10).max(10).default(1.0),
  magnitude: Magnitude.default("med"),
  label: z.string().max(200).nullable().optional(),
  origin: Origin.default("edit"),
  author_label: z.string().max(120).optional(),
});

const EdgeKeyInput = z.object({
  sector_slug: z.string().min(1),
  source_key: z.string().min(1),
  target_key: z.string().min(1),
  author_label: z.string().max(120).optional(),
});

const ResetInput = z.object({
  sector_slug: z.string().min(1),
  author_label: z.string().max(120).optional(),
});

// ---------- Helpers ----------

async function logAudit(
  ctx: Context,
  action: string,
  sector_slug: string,
  payload: unknown,
  author_label?: string,
): Promise<void> {
  await ctx.prisma.auditLog.create({
    data: {
      action,
      sector_slug,
      payload: payload as object,
      author_label: author_label ?? "anonymous",
    },
  });
}

// ---------- Procedures ----------

export const graphRouter = router({
  get: publicProcedure
    .input(SlugInput)
    .output(GraphResponse)
    .query(async ({ ctx, input }) => {
      const [nodes, edges] = await Promise.all([
        ctx.prisma.graphNode.findMany({
          where: { sector_slug: input.sector_slug },
          orderBy: [{ kind: "asc" }, { group: "asc" }, { node_key: "asc" }],
        }),
        ctx.prisma.graphEdge.findMany({
          where: { sector_slug: input.sector_slug },
          orderBy: [{ source_key: "asc" }, { target_key: "asc" }],
        }),
      ]);
      return {
        sector_slug: input.sector_slug,
        nodes: nodes as z.infer<typeof GraphNodeOut>[],
        edges: edges as z.infer<typeof GraphEdgeOut>[],
      };
    }),

  upsertNode: publicProcedure
    .input(UpsertNodeInput)
    .output(GraphNodeOut)
    .mutation(async ({ ctx, input }) => {
      const { author_label, sector_slug, node_key, equity_id, ...common } = input;

      // Guard against orphan equity_id references.
      if (input.kind === "equity" && equity_id) {
        const eq = await ctx.prisma.sectorEquity.findUnique({ where: { id: equity_id } });
        if (!eq) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: `equity ${equity_id} does not exist`,
          });
        }
      }

      const row = await ctx.prisma.graphNode.upsert({
        where: { sector_slug_node_key: { sector_slug, node_key } },
        update: {
          ...common,
          equity_id: equity_id ?? null,
        },
        create: {
          sector_slug,
          node_key,
          ...common,
          unit: common.unit ?? null,
          description: common.description ?? null,
          equity_id: equity_id ?? null,
        },
      });
      await logAudit(ctx, "graph.upsertNode", sector_slug, input, author_label);
      return row as z.infer<typeof GraphNodeOut>;
    }),

  deleteNode: publicProcedure
    .input(NodeKeyInput)
    .output(z.object({ sector_slug: z.string(), node_key: z.string() }))
    .mutation(async ({ ctx, input }) => {
      // Guard: refuse to delete a node that still has inbound or outbound
      // edges — the editor should require the user to clean those up
      // first so we don't silently strand mathematics.
      const referencingEdges = await ctx.prisma.graphEdge.count({
        where: {
          sector_slug: input.sector_slug,
          OR: [{ source_key: input.node_key }, { target_key: input.node_key }],
        },
      });
      if (referencingEdges > 0) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `node ${input.node_key} has ${referencingEdges} attached edges — delete those first`,
        });
      }
      try {
        await ctx.prisma.graphNode.delete({
          where: {
            sector_slug_node_key: {
              sector_slug: input.sector_slug,
              node_key: input.node_key,
            },
          },
        });
      } catch (e) {
        if ((e as { code?: string }).code === "P2025") {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: `node ${input.node_key} in ${input.sector_slug}`,
          });
        }
        throw e;
      }
      await logAudit(ctx, "graph.deleteNode", input.sector_slug, input, input.author_label);
      return { sector_slug: input.sector_slug, node_key: input.node_key };
    }),

  upsertEdge: publicProcedure
    .input(UpsertEdgeInput)
    .output(GraphEdgeOut)
    .mutation(async ({ ctx, input }) => {
      // Guard: both endpoints must exist as nodes in the same sector.
      const endpoints = await ctx.prisma.graphNode.findMany({
        where: {
          sector_slug: input.sector_slug,
          node_key: { in: [input.source_key, input.target_key] },
        },
        select: { node_key: true },
      });
      const present = new Set(endpoints.map((n) => n.node_key));
      const missing: string[] = [];
      if (!present.has(input.source_key)) missing.push(input.source_key);
      if (!present.has(input.target_key)) missing.push(input.target_key);
      if (missing.length > 0) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `node(s) not found in ${input.sector_slug}: ${missing.join(", ")}`,
        });
      }

      const { author_label, sector_slug, source_key, target_key, ...common } = input;
      const row = await ctx.prisma.graphEdge.upsert({
        where: {
          sector_slug_source_key_target_key: {
            sector_slug,
            source_key,
            target_key,
          },
        },
        update: {
          weight: common.weight,
          magnitude: common.magnitude,
          label: common.label ?? null,
          origin: common.origin,
          author_label: author_label ?? null,
        },
        create: {
          sector_slug,
          source_key,
          target_key,
          weight: common.weight,
          magnitude: common.magnitude,
          label: common.label ?? null,
          origin: common.origin,
          author_label: author_label ?? null,
        },
      });
      await logAudit(ctx, "graph.upsertEdge", sector_slug, input, author_label);
      return row as z.infer<typeof GraphEdgeOut>;
    }),

  deleteEdge: publicProcedure
    .input(EdgeKeyInput)
    .output(z.object({ sector_slug: z.string(), source_key: z.string(), target_key: z.string() }))
    .mutation(async ({ ctx, input }) => {
      try {
        await ctx.prisma.graphEdge.delete({
          where: {
            sector_slug_source_key_target_key: {
              sector_slug: input.sector_slug,
              source_key: input.source_key,
              target_key: input.target_key,
            },
          },
        });
      } catch (e) {
        if ((e as { code?: string }).code === "P2025") {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: `edge ${input.source_key} → ${input.target_key} in ${input.sector_slug}`,
          });
        }
        throw e;
      }
      await logAudit(ctx, "graph.deleteEdge", input.sector_slug, input, input.author_label);
      return {
        sector_slug: input.sector_slug,
        source_key: input.source_key,
        target_key: input.target_key,
      };
    }),

  resetToDefaults: publicProcedure
    .input(ResetInput)
    .output(z.object({ sector_slug: z.string(), nodes_deleted: z.number(), edges_deleted: z.number() }))
    .mutation(async ({ ctx, input }) => {
      // Wipe all graph state for this sector. The caller is expected to
      // re-run `pnpm db:seed:graph <slug>` after this; we don't fetch
      // from simulation-service here to keep the API surface
      // dependency-free (the seed script handles that).
      const [edges, nodes] = await ctx.prisma.$transaction([
        ctx.prisma.graphEdge.deleteMany({ where: { sector_slug: input.sector_slug } }),
        ctx.prisma.graphNode.deleteMany({ where: { sector_slug: input.sector_slug } }),
      ]);
      await logAudit(
        ctx,
        "graph.resetToDefaults",
        input.sector_slug,
        { nodes_deleted: nodes.count, edges_deleted: edges.count },
        input.author_label,
      );
      return {
        sector_slug: input.sector_slug,
        nodes_deleted: nodes.count,
        edges_deleted: edges.count,
      };
    }),
});
