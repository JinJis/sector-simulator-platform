/**
 * Graph topology seed — bootstraps `graph_nodes` + `graph_edges` from
 * the authoritative Python `SimGraph` literals via the simulation-service
 * `GET /sims/{slug}/graph` endpoint.
 *
 * This is the one-time bridge from "Python source defines graph" to "DB
 * defines graph". After this seed runs, future graph edits live in the
 * DB; the Python literal becomes the *reset target* (callable via
 * `graph.resetToDefaults` tRPC mutation) but is no longer the runtime
 * source.
 *
 * Idempotent: re-running upserts on (sector_slug, node_key) and
 * (sector_slug, source_key, target_key). Edges that exist in the Python
 * graph have their `origin` left as "seed"; edges that don't exist
 * upstream are NOT deleted (graph edits survive a re-seed). Use the
 * `graph.resetToDefaults` mutation when you want a hard reset.
 *
 * Usage:
 *   pnpm db:seed:graph                      # all sectors
 *   pnpm db:seed:graph memory-semi          # one sector
 */

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const SIM_URL = process.env.SIMULATION_SERVICE_URL ?? "http://localhost:8000";

interface UpstreamNode {
  id: string;
  label: string;
  kind: string;
  group: string;
  unit: string;
  description: string;
}

interface UpstreamEdge {
  source: string;
  target: string;
  label: string;
}

interface UpstreamGraph {
  slug: string;
  nodes: UpstreamNode[];
  edges: UpstreamEdge[];
}

async function fetchGraph(slug: string): Promise<UpstreamGraph> {
  const res = await fetch(`${SIM_URL}/sims/${slug}/graph`);
  if (!res.ok) {
    throw new Error(`simulation-service ${SIM_URL}/sims/${slug}/graph → ${res.status}`);
  }
  return (await res.json()) as UpstreamGraph;
}

async function seedSector(slug: string): Promise<{ nodes: number; edges: number }> {
  const g = await fetchGraph(slug);

  // Upsert nodes first so edges can reference them via (sector_slug, node_key).
  let nodesUpserted = 0;
  for (const n of g.nodes) {
    await prisma.graphNode.upsert({
      where: { sector_slug_node_key: { sector_slug: slug, node_key: n.id } },
      update: {
        kind: n.kind,
        label: n.label,
        group: n.group,
        unit: n.unit || null,
        description: n.description || null,
      },
      create: {
        sector_slug: slug,
        node_key: n.id,
        kind: n.kind,
        label: n.label,
        group: n.group,
        unit: n.unit || null,
        description: n.description || null,
      },
    });
    nodesUpserted += 1;
  }

  // Upsert edges with weight=1.0 default. Pre-existing edges (origin
  // = "edit") get their weight preserved — only the label is refreshed.
  let edgesUpserted = 0;
  for (const e of g.edges) {
    await prisma.graphEdge.upsert({
      where: {
        sector_slug_source_key_target_key: {
          sector_slug: slug,
          source_key: e.source,
          target_key: e.target,
        },
      },
      update: {
        label: e.label || null,
        // Don't overwrite weight / magnitude / origin on re-seed — only
        // the human-readable label, which is editorial.
      },
      create: {
        sector_slug: slug,
        source_key: e.source,
        target_key: e.target,
        label: e.label || null,
        weight: 1.0,
        magnitude: "med",
        origin: "seed",
      },
    });
    edgesUpserted += 1;
  }

  return { nodes: nodesUpserted, edges: edgesUpserted };
}

async function main(): Promise<void> {
  const targetSlug = process.argv[2];
  const sectors = targetSlug
    ? [{ slug: targetSlug }]
    : await prisma.sector.findMany({ select: { slug: true }, orderBy: { slug: "asc" } });

  if (sectors.length === 0) {
    console.log("[seed-graph] no sectors found — run pnpm db:seed first.");
    return;
  }

  console.log(`[seed-graph] bootstrapping graph topology for ${sectors.length} sector(s) from ${SIM_URL}…`);
  let totalNodes = 0;
  let totalEdges = 0;
  for (const s of sectors) {
    try {
      const { nodes, edges } = await seedSector(s.slug);
      totalNodes += nodes;
      totalEdges += edges;
      console.log(`  ✓ ${s.slug}: ${nodes} nodes, ${edges} edges`);
    } catch (e) {
      console.error(`  ✗ ${s.slug}: ${e instanceof Error ? e.message : e}`);
    }
  }
  console.log(`[seed-graph] done. ${totalNodes} nodes, ${totalEdges} edges across ${sectors.length} sector(s).`);
}

main()
  .catch((e) => {
    console.error("[seed-graph] failed:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
