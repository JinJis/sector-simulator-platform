/**
 * Integration tests for `graph.*` procedures. Same DB-required pattern
 * as scenario.test.ts — hits real Postgres for upsert / unique / FK
 * coverage. Skipped automatically when DATABASE_URL is unreachable.
 *
 * Pre-requisites:
 *   - DATABASE_URL points at a reachable Postgres
 *   - migrations applied (pnpm db:migrate)
 *   - sectors table seeded (pnpm db:seed)
 */

import { TRPCError } from "@trpc/server";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

process.env.SIMULATION_SERVICE_URL ??= "http://localhost:8000";

const { prisma } = await import("@platform/db");
const { createCallerFactory } = await import("../src/trpc/init.js");
const { appRouter } = await import("../src/trpc/router.js");
const { stubContext } = await import("./stub-context.js");

const SEEDED_SECTOR = "space-data-center";
const createCaller = createCallerFactory(appRouter);

function caller() {
  return createCaller(stubContext({ prisma }));
}

async function wipe(): Promise<void> {
  await prisma.graphEdge.deleteMany({ where: { sector_slug: SEEDED_SECTOR } });
  await prisma.graphNode.deleteMany({ where: { sector_slug: SEEDED_SECTOR } });
  await prisma.auditLog.deleteMany({ where: { sector_slug: SEEDED_SECTOR } });
}

beforeAll(async () => {
  const sector = await prisma.sector.findUnique({ where: { slug: SEEDED_SECTOR } });
  if (!sector) {
    throw new Error(
      `seeded sector "${SEEDED_SECTOR}" missing — run pnpm db:seed before tests`,
    );
  }
});

beforeEach(async () => {
  await wipe();
});

afterAll(async () => {
  await wipe();
  await prisma.$disconnect();
});

async function seedTriangle(): Promise<void> {
  // Three nodes: A (driver) → B (intermediate) → C (output) plus a
  // shortcut A → C. Used by multiple cases.
  const c = caller();
  for (const [key, kind, label] of [
    ["a_driver", "driver", "A"],
    ["b_inter", "intermediate", "B"],
    ["c_output", "output", "C"],
  ] as const) {
    await c.graph.upsertNode({
      sector_slug: SEEDED_SECTOR,
      node_key: key,
      kind,
      label,
      group: "Test",
    });
  }
  await c.graph.upsertEdge({
    sector_slug: SEEDED_SECTOR,
    source_key: "a_driver",
    target_key: "b_inter",
    weight: 1.0,
    magnitude: "med",
    label: "A → B",
    origin: "edit",
  });
  await c.graph.upsertEdge({
    sector_slug: SEEDED_SECTOR,
    source_key: "b_inter",
    target_key: "c_output",
    weight: 1.5,
    magnitude: "high",
    label: "B → C",
    origin: "edit",
  });
}

describe("graph.upsertNode", () => {
  it("creates a node and writes an audit log row", async () => {
    const c = caller();
    const before = await prisma.auditLog.count({ where: { sector_slug: SEEDED_SECTOR } });
    const node = await c.graph.upsertNode({
      sector_slug: SEEDED_SECTOR,
      node_key: "x",
      kind: "driver",
      label: "X driver",
      group: "Test",
    });
    expect(node.node_key).toBe("x");
    expect(node.kind).toBe("driver");
    const after = await prisma.auditLog.count({ where: { sector_slug: SEEDED_SECTOR } });
    expect(after).toBe(before + 1);
  });

  it("updates an existing node on conflict", async () => {
    const c = caller();
    await c.graph.upsertNode({
      sector_slug: SEEDED_SECTOR,
      node_key: "x",
      kind: "driver",
      label: "v1",
      group: "Test",
    });
    const v2 = await c.graph.upsertNode({
      sector_slug: SEEDED_SECTOR,
      node_key: "x",
      kind: "driver",
      label: "v2",
      group: "Test",
    });
    expect(v2.label).toBe("v2");
    const count = await prisma.graphNode.count({
      where: { sector_slug: SEEDED_SECTOR, node_key: "x" },
    });
    expect(count).toBe(1);
  });

  it("rejects an equity node referencing a non-existent equity", async () => {
    const c = caller();
    await expect(
      c.graph.upsertNode({
        sector_slug: SEEDED_SECTOR,
        node_key: "eq_ghost",
        kind: "equity",
        label: "Ghost",
        group: "Equities",
        equity_id: "no-such-id",
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" } as Partial<TRPCError>);
  });
});

describe("graph.upsertEdge", () => {
  it("creates an edge between existing nodes", async () => {
    await seedTriangle();
    const c = caller();
    const edge = await c.graph.upsertEdge({
      sector_slug: SEEDED_SECTOR,
      source_key: "a_driver",
      target_key: "c_output",
      weight: -0.5,
      magnitude: "low",
      label: "A → C shortcut",
      origin: "edit",
    });
    expect(edge.weight).toBe(-0.5);
    expect(edge.magnitude).toBe("low");
    expect(edge.origin).toBe("edit");
  });

  it("updates weight on conflict (same source/target)", async () => {
    await seedTriangle();
    const c = caller();
    const updated = await c.graph.upsertEdge({
      sector_slug: SEEDED_SECTOR,
      source_key: "a_driver",
      target_key: "b_inter",
      weight: 2.5,
      magnitude: "high",
      label: "A → B (bumped)",
      origin: "edit",
    });
    expect(updated.weight).toBe(2.5);
    const count = await prisma.graphEdge.count({
      where: { sector_slug: SEEDED_SECTOR, source_key: "a_driver", target_key: "b_inter" },
    });
    expect(count).toBe(1);
  });

  it("rejects an edge referencing missing endpoints", async () => {
    await seedTriangle();
    const c = caller();
    await expect(
      c.graph.upsertEdge({
        sector_slug: SEEDED_SECTOR,
        source_key: "a_driver",
        target_key: "no_such_node",
        weight: 1.0,
        magnitude: "med",
        origin: "edit",
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" } as Partial<TRPCError>);
  });

  it("clamps weight outside [-10, 10] via zod", async () => {
    await seedTriangle();
    const c = caller();
    await expect(
      c.graph.upsertEdge({
        sector_slug: SEEDED_SECTOR,
        source_key: "a_driver",
        target_key: "b_inter",
        weight: 100,
        magnitude: "high",
        origin: "edit",
      }),
    ).rejects.toBeDefined();
  });
});

describe("graph.deleteNode", () => {
  it("refuses to delete a node with attached edges", async () => {
    await seedTriangle();
    const c = caller();
    await expect(
      c.graph.deleteNode({ sector_slug: SEEDED_SECTOR, node_key: "a_driver" }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" } as Partial<TRPCError>);
  });

  it("deletes an orphan node", async () => {
    const c = caller();
    await c.graph.upsertNode({
      sector_slug: SEEDED_SECTOR,
      node_key: "orphan",
      kind: "intermediate",
      label: "Orphan",
      group: "Test",
    });
    const res = await c.graph.deleteNode({
      sector_slug: SEEDED_SECTOR,
      node_key: "orphan",
    });
    expect(res.node_key).toBe("orphan");
  });

  it("returns NOT_FOUND for a non-existent node", async () => {
    const c = caller();
    await expect(
      c.graph.deleteNode({ sector_slug: SEEDED_SECTOR, node_key: "phantom" }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" } as Partial<TRPCError>);
  });
});

describe("graph.deleteEdge", () => {
  it("removes an existing edge", async () => {
    await seedTriangle();
    const c = caller();
    const res = await c.graph.deleteEdge({
      sector_slug: SEEDED_SECTOR,
      source_key: "a_driver",
      target_key: "b_inter",
    });
    expect(res.source_key).toBe("a_driver");
    const remaining = await prisma.graphEdge.count({
      where: { sector_slug: SEEDED_SECTOR, source_key: "a_driver", target_key: "b_inter" },
    });
    expect(remaining).toBe(0);
  });

  it("returns NOT_FOUND for a non-existent edge", async () => {
    const c = caller();
    await expect(
      c.graph.deleteEdge({
        sector_slug: SEEDED_SECTOR,
        source_key: "ghost",
        target_key: "phantom",
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" } as Partial<TRPCError>);
  });
});

describe("graph.get", () => {
  it("returns the full topology for a sector", async () => {
    await seedTriangle();
    const c = caller();
    const g = await c.graph.get({ sector_slug: SEEDED_SECTOR });
    expect(g.sector_slug).toBe(SEEDED_SECTOR);
    expect(g.nodes.length).toBe(3);
    expect(g.edges.length).toBe(2);
    expect(g.edges.find((e) => e.target_key === "c_output")!.weight).toBe(1.5);
  });

  it("returns empty topology when not seeded", async () => {
    const c = caller();
    const g = await c.graph.get({ sector_slug: SEEDED_SECTOR });
    expect(g.nodes).toEqual([]);
    expect(g.edges).toEqual([]);
  });
});

describe("graph.wipe", () => {
  it("wipes all nodes and edges for the sector", async () => {
    await seedTriangle();
    const c = caller();
    const res = await c.graph.wipe({ sector_slug: SEEDED_SECTOR });
    expect(res.nodes_deleted).toBe(3);
    expect(res.edges_deleted).toBe(2);
    const left = await prisma.graphNode.count({ where: { sector_slug: SEEDED_SECTOR } });
    expect(left).toBe(0);
  });
});

// graph.resetToDefaults integration test is omitted here because it
// requires a reachable simulation-service (it calls GET /sims/{slug}/graph
// to re-bootstrap). The mutation is exercised manually + via the M13
// "Reset graph" button on /sectors/[slug]/graph.
