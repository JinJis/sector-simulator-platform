/**
 * Integration tests for the M45a `actor.*` router. Hits real Postgres
 * (same pattern as vision.test.ts / graph.test.ts) so unique
 * constraints, FK cascades, and the Actor→Vision M2M wiring all
 * exercise the real engine.
 *
 * Pre-requisites:
 *   - DATABASE_URL reachable
 *   - migrations applied (capability schema + actor domain)
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
  // Cascade order: capability_actors + vision_actors → actors.
  await prisma.capabilityActor.deleteMany({
    where: { capability: { sector_slug: SEEDED_SECTOR } },
  });
  await prisma.visionActor.deleteMany({ where: { sector_slug: SEEDED_SECTOR } });
  // Actors are global; wipe any test-created keys to keep runs isolated.
  await prisma.actor.deleteMany({
    where: { key: { in: ["test_spacex", "test_starcloud", "test_kr_kaist", "test_amd"] } },
  });
  await prisma.capability.deleteMany({ where: { sector_slug: SEEDED_SECTOR } });
  await prisma.auditLog.deleteMany({
    where: { action: { startsWith: "actor." } },
  });
}

beforeAll(async () => {
  const sector = await prisma.sector.findUnique({ where: { slug: SEEDED_SECTOR } });
  if (!sector) {
    throw new Error(`seeded sector "${SEEDED_SECTOR}" missing — run pnpm db:seed`);
  }
});

beforeEach(wipe);

afterAll(async () => {
  await wipe();
  await prisma.$disconnect();
});

describe("actor.upsert + get + delete", () => {
  it("creates a new actor and re-upsert updates by key", async () => {
    const c = caller();
    const first = await c.actor.upsert({
      key: "test_spacex",
      name: "SpaceX",
      iso_country: "us",
      category: "private_startup",
      blurb: "Cheap launch + reusables",
      stage: "scaling",
      signal_keywords: ["SpaceX", "Starship", "Starlink"],
    });
    expect(first.key).toBe("test_spacex");
    expect(first.iso_country).toBe("US"); // upper-cased
    expect(first.signal_keywords).toEqual(["SpaceX", "Starship", "Starlink"]);

    const second = await c.actor.upsert({
      key: "test_spacex",
      name: "SpaceX",
      iso_country: "US",
      category: "private_startup",
      blurb: "Updated tagline",
      stage: "scaling",
      ticker: "SPCX",
      exchange: "NYSE",
      signal_keywords: ["SpaceX", "Starship"],
    });
    expect(second.id).toBe(first.id);
    expect(second.blurb).toBe("Updated tagline");
    expect(second.ticker).toBe("SPCX");
    expect(second.signal_keywords).toEqual(["SpaceX", "Starship"]);
  });

  it("rejects invalid key formats", async () => {
    const c = caller();
    await expect(
      c.actor.upsert({
        key: "SpaceX",
        name: "x",
        iso_country: "US",
        category: "private_startup",
        blurb: "x",
        stage: "scaling",
      }),
    ).rejects.toThrow();
  });

  it("rejects category outside the enum", async () => {
    const c = caller();
    await expect(
      c.actor.upsert({
        key: "test_spacex",
        name: "x",
        iso_country: "US",
        // @ts-expect-error - bad category for test
        category: "weird",
        blurb: "x",
        stage: "scaling",
      }),
    ).rejects.toThrow();
  });

  it("get returns 404 for missing key", async () => {
    const c = caller();
    await expect(c.actor.get({ key: "nonexistent" })).rejects.toThrow(TRPCError);
  });

  it("delete throws NOT_FOUND for missing key", async () => {
    const c = caller();
    await expect(c.actor.delete({ key: "nonexistent" })).rejects.toThrow(TRPCError);
  });

  it("delete removes the actor row + cascades joins", async () => {
    const c = caller();
    await c.actor.upsert({
      key: "test_spacex",
      name: "SpaceX",
      iso_country: "US",
      category: "private_startup",
      blurb: "x",
      stage: "scaling",
    });
    await c.actor.linkToVision({
      actor_key: "test_spacex",
      sector_slug: SEEDED_SECTOR,
      relevance: 90,
    });
    await c.actor.delete({ key: "test_spacex" });
    // VisionActor cascades.
    const remaining = await prisma.visionActor.count({
      where: { sector_slug: SEEDED_SECTOR },
    });
    expect(remaining).toBe(0);
  });
});

describe("actor.linkToVision", () => {
  it("upserts a join row and sorts listForVision by relevance desc", async () => {
    const c = caller();
    await c.actor.upsert({
      key: "test_spacex",
      name: "SpaceX",
      iso_country: "US",
      category: "private_startup",
      blurb: "x",
      stage: "scaling",
    });
    await c.actor.upsert({
      key: "test_starcloud",
      name: "Starcloud",
      iso_country: "US",
      category: "private_startup",
      blurb: "x",
      stage: "pilot",
    });
    await c.actor.linkToVision({
      actor_key: "test_spacex",
      sector_slug: SEEDED_SECTOR,
      relevance: 95,
    });
    await c.actor.linkToVision({
      actor_key: "test_starcloud",
      sector_slug: SEEDED_SECTOR,
      relevance: 65,
    });
    const out = await c.actor.listForVision({ sector_slug: SEEDED_SECTOR });
    expect(out.map((v) => v.actor.key)).toEqual(["test_spacex", "test_starcloud"]);
  });

  it("re-linking updates the join row, not creates a dupe", async () => {
    const c = caller();
    await c.actor.upsert({
      key: "test_spacex",
      name: "SpaceX",
      iso_country: "US",
      category: "private_startup",
      blurb: "x",
      stage: "scaling",
    });
    const a = await c.actor.linkToVision({
      actor_key: "test_spacex",
      sector_slug: SEEDED_SECTOR,
      relevance: 70,
      rationale: "v1",
    });
    const b = await c.actor.linkToVision({
      actor_key: "test_spacex",
      sector_slug: SEEDED_SECTOR,
      relevance: 95,
      rationale: "v2",
    });
    expect(b.id).toBe(a.id);
    expect(b.relevance).toBe(95);
    expect(b.rationale).toBe("v2");
  });

  it("returns NOT_FOUND on missing actor or sector", async () => {
    const c = caller();
    await expect(
      c.actor.linkToVision({
        actor_key: "ghost",
        sector_slug: SEEDED_SECTOR,
      }),
    ).rejects.toThrow(/actor ghost/);
  });

  it("unlinkFromVision is idempotent on missing link", async () => {
    const c = caller();
    const r = await c.actor.unlinkFromVision({
      actor_key: "ghost",
      sector_slug: SEEDED_SECTOR,
    });
    expect(r.ok).toBe(true);
  });
});

describe("actor.linkToCapability", () => {
  async function setupCap() {
    const c = caller();
    await c.capability.upsert({
      sector_slug: SEEDED_SECTOR,
      key: "rad_hard_compute",
      name: "Radiation-hard compute",
      description: "x",
      rationale: "x",
      weight: 0.2,
    });
    await c.actor.upsert({
      key: "test_amd",
      name: "AMD",
      iso_country: "US",
      category: "public_corp",
      blurb: "x",
      stage: "scaling",
    });
    return c;
  }

  it("links + listForCapability returns the row with actor expanded", async () => {
    const c = await setupCap();
    await c.actor.linkToCapability({
      actor_key: "test_amd",
      sector_slug: SEEDED_SECTOR,
      capability_key: "rad_hard_compute",
      role: "competitor",
      stage: "pilot",
      rationale: "MI300 rad-test in flight",
    });
    const out = await c.actor.listForCapability({
      sector_slug: SEEDED_SECTOR,
      capability_key: "rad_hard_compute",
    });
    expect(out.length).toBe(1);
    expect(out[0]?.actor.key).toBe("test_amd");
    expect(out[0]?.role).toBe("competitor");
    expect(out[0]?.stage).toBe("pilot");
  });

  it("re-link updates the role/rationale, doesn't duplicate", async () => {
    const c = await setupCap();
    const a = await c.actor.linkToCapability({
      actor_key: "test_amd",
      sector_slug: SEEDED_SECTOR,
      capability_key: "rad_hard_compute",
      role: "competitor",
    });
    const b = await c.actor.linkToCapability({
      actor_key: "test_amd",
      sector_slug: SEEDED_SECTOR,
      capability_key: "rad_hard_compute",
      role: "lead",
      rationale: "now the lead vendor",
    });
    expect(b.id).toBe(a.id);
    expect(b.role).toBe("lead");
    expect(b.rationale).toBe("now the lead vendor");
  });

  it("NOT_FOUND when capability_key missing", async () => {
    const c = caller();
    await c.actor.upsert({
      key: "test_amd",
      name: "AMD",
      iso_country: "US",
      category: "public_corp",
      blurb: "x",
      stage: "scaling",
    });
    await expect(
      c.actor.linkToCapability({
        actor_key: "test_amd",
        sector_slug: SEEDED_SECTOR,
        capability_key: "no_such_cap",
      }),
    ).rejects.toThrow(/capability/);
  });

  it("unlinkFromCapability removes the join cleanly", async () => {
    const c = await setupCap();
    await c.actor.linkToCapability({
      actor_key: "test_amd",
      sector_slug: SEEDED_SECTOR,
      capability_key: "rad_hard_compute",
      role: "lead",
    });
    await c.actor.unlinkFromCapability({
      actor_key: "test_amd",
      sector_slug: SEEDED_SECTOR,
      capability_key: "rad_hard_compute",
    });
    const out = await c.actor.listForCapability({
      sector_slug: SEEDED_SECTOR,
      capability_key: "rad_hard_compute",
    });
    expect(out.length).toBe(0);
  });
});

describe("Audit log", () => {
  it("upsert + linkToVision + linkToCapability all write audit rows", async () => {
    const c = caller();
    await c.capability.upsert({
      sector_slug: SEEDED_SECTOR,
      key: "thermal",
      name: "Thermal rejection",
      description: "x",
      rationale: "x",
    });
    await c.actor.upsert({
      key: "test_starcloud",
      name: "Starcloud",
      iso_country: "US",
      category: "private_startup",
      blurb: "x",
      stage: "pilot",
    });
    await c.actor.linkToVision({
      actor_key: "test_starcloud",
      sector_slug: SEEDED_SECTOR,
      relevance: 60,
    });
    await c.actor.linkToCapability({
      actor_key: "test_starcloud",
      sector_slug: SEEDED_SECTOR,
      capability_key: "thermal",
      role: "lead",
    });
    const actions = await prisma.auditLog.findMany({
      where: { action: { startsWith: "actor." } },
      select: { action: true },
    });
    const set = new Set(actions.map((a) => a.action));
    expect(set.has("actor.upsert")).toBe(true);
    expect(set.has("actor.linkToVision")).toBe(true);
    expect(set.has("actor.linkToCapability")).toBe(true);
  });
});
