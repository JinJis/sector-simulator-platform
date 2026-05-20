/**
 * Integration tests for `scenario.*` procedures. Hits a real Postgres so
 * we cover the FK + Prisma round-trip; truncates the table (not sectors)
 * before each case to keep tests isolated.
 *
 * Pre-requisites:
 *   - DATABASE_URL points at a reachable Postgres
 *   - migrations applied (pnpm db:migrate)
 *   - sectors table seeded with at least "space-data-center" (pnpm db:seed)
 *
 * `pnpm test` from this package picks these up.
 */

import { TRPCError } from "@trpc/server";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

// Stub env for tests — sim-proxy lib reads SIMULATION_SERVICE_URL at first
// call; we set a placeholder so the import doesn't bail.
process.env.SIMULATION_SERVICE_URL ??= "http://localhost:8000";

const { prisma } = await import("@platform/db");
const { createCallerFactory } = await import("../src/trpc/init.js");
const { appRouter } = await import("../src/trpc/router.js");
const ctxModule = await import("../src/trpc/context.js");
type Ctx = Awaited<ReturnType<typeof ctxModule.createContext>>;

const SEEDED_SECTOR = "space-data-center";
const createCaller = createCallerFactory(appRouter);

function caller() {
  return createCaller({
    log: console as unknown as Ctx["log"],
    requestId: "test-req",
    prisma,
  });
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
  await prisma.scenario.deleteMany({});
});

afterAll(async () => {
  await prisma.scenario.deleteMany({});
  await prisma.$disconnect();
});

describe("scenario.create", () => {
  it("creates a scenario for a registered sector", async () => {
    const c = caller();
    const created = await c.scenario.create({
      sector_slug: SEEDED_SECTOR,
      name: "Aggressive launch cost",
      notes: "Starship-era pricing",
      driver_overrides: { launch_cost_usd_per_kg: 300, chip_pflops_per_kw: 100 },
      author_label: "test-user",
    });
    expect(created.id).toBeDefined();
    expect(created.name).toBe("Aggressive launch cost");
    expect(created.driver_overrides).toEqual({
      launch_cost_usd_per_kg: 300,
      chip_pflops_per_kw: 100,
    });
    expect(created.sector_slug).toBe(SEEDED_SECTOR);
  });

  it("rejects unknown sector with BAD_REQUEST", async () => {
    const c = caller();
    await expect(
      c.scenario.create({
        sector_slug: "nope-not-a-sector",
        name: "x",
        driver_overrides: {},
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("rejects empty name via zod", async () => {
    const c = caller();
    await expect(
      c.scenario.create({
        sector_slug: SEEDED_SECTOR,
        name: "",
        driver_overrides: {},
      }),
    ).rejects.toBeInstanceOf(TRPCError);
  });
});

describe("scenario.list", () => {
  it("returns recent scenarios in updated_at desc order", async () => {
    const c = caller();
    const a = await c.scenario.create({
      sector_slug: SEEDED_SECTOR,
      name: "A",
      driver_overrides: {},
    });
    // Ensure b has a strictly later updated_at.
    await new Promise((r) => setTimeout(r, 5));
    const b = await c.scenario.create({
      sector_slug: SEEDED_SECTOR,
      name: "B",
      driver_overrides: {},
    });
    const list = await c.scenario.list({ limit: 50 });
    expect(list.map((s) => s.id)).toEqual([b.id, a.id]);
  });

  it("filters by sector_slug when provided", async () => {
    const c = caller();
    await c.scenario.create({
      sector_slug: SEEDED_SECTOR,
      name: "A",
      driver_overrides: {},
    });
    const list = await c.scenario.list({ sector_slug: "memory-semi", limit: 50 });
    expect(list).toEqual([]);
  });
});

describe("scenario.get", () => {
  it("fetches a previously-created scenario by id", async () => {
    const c = caller();
    const created = await c.scenario.create({
      sector_slug: SEEDED_SECTOR,
      name: "fetchable",
      driver_overrides: { launch_cost_usd_per_kg: 800 },
    });
    const fetched = await c.scenario.get({ id: created.id });
    expect(fetched.id).toBe(created.id);
    expect(fetched.driver_overrides).toEqual({ launch_cost_usd_per_kg: 800 });
  });

  it("returns NOT_FOUND for missing id", async () => {
    const c = caller();
    await expect(c.scenario.get({ id: "does-not-exist" })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });
});

describe("scenario.update", () => {
  it("patches fields and rejects empty updates", async () => {
    const c = caller();
    const created = await c.scenario.create({
      sector_slug: SEEDED_SECTOR,
      name: "before",
      driver_overrides: {},
    });
    const updated = await c.scenario.update({ id: created.id, name: "after", notes: "edited" });
    expect(updated.name).toBe("after");
    expect(updated.notes).toBe("edited");

    await expect(c.scenario.update({ id: created.id })).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
  });

  it("returns NOT_FOUND when target id is missing", async () => {
    const c = caller();
    await expect(
      c.scenario.update({ id: "ghost", name: "x" }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("scenario.delete", () => {
  it("deletes and returns the id", async () => {
    const c = caller();
    const created = await c.scenario.create({
      sector_slug: SEEDED_SECTOR,
      name: "to-delete",
      driver_overrides: {},
    });
    const result = await c.scenario.delete({ id: created.id });
    expect(result.id).toBe(created.id);
    await expect(c.scenario.get({ id: created.id })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });

  it("returns NOT_FOUND when target id is missing", async () => {
    const c = caller();
    await expect(c.scenario.delete({ id: "ghost" })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });
});
