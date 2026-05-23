/**
 * Integration tests for the M36 Vision Feasibility Monitor routers:
 * vision / capability / signal / risk / feasibility.
 *
 * Hits real Postgres (same pattern as graph.test.ts / scenario.test.ts)
 * so unique constraints, FKs, cycle detection, and Prisma array columns
 * all get exercised against the real engine.
 *
 * Pre-requisites:
 *   - DATABASE_URL reachable
 *   - migrations applied
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
  // Order matters — FK dependencies cascade but we delete eagerly so
  // each test starts from a known empty state.
  await prisma.signal.deleteMany({ where: { sector_slug: SEEDED_SECTOR } });
  await prisma.capabilityScore.deleteMany({
    where: { capability: { sector_slug: SEEDED_SECTOR } },
  });
  await prisma.capabilityDependency.deleteMany({
    where: { source: { sector_slug: SEEDED_SECTOR } },
  });
  await prisma.capability.deleteMany({ where: { sector_slug: SEEDED_SECTOR } });
  await prisma.risk.deleteMany({ where: { sector_slug: SEEDED_SECTOR } });
  await prisma.visionFeasibility.deleteMany({ where: { sector_slug: SEEDED_SECTOR } });
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

beforeEach(wipe);

afterAll(async () => {
  await wipe();
  await prisma.$disconnect();
});

// --------------------------------------------------------------------
// capability.*
// --------------------------------------------------------------------

describe("capability router", () => {
  it("upsert creates then updates by (sector_slug, key)", async () => {
    const c = caller();
    const first = await c.capability.upsert({
      sector_slug: SEEDED_SECTOR,
      key: "rad_hard_compute",
      name: "Radiation-hard compute",
      description: "Compute hardware that survives orbital radiation flux.",
      rationale: "Without it, in-orbit DCs can't stay up.",
      weight: 0.15,
    });
    expect(first.key).toBe("rad_hard_compute");
    expect(first.weight).toBeCloseTo(0.15);

    const second = await c.capability.upsert({
      sector_slug: SEEDED_SECTOR,
      key: "rad_hard_compute",
      name: "Radiation-hard compute (rev)",
      description: "Updated description.",
      rationale: "Same rationale.",
      weight: 0.2,
    });
    expect(second.id).toBe(first.id); // same row
    expect(second.name).toBe("Radiation-hard compute (rev)");
    expect(second.weight).toBeCloseTo(0.2);

    const audit = await prisma.auditLog.findMany({
      where: { sector_slug: SEEDED_SECTOR, action: "capability.upsert" },
    });
    expect(audit.length).toBe(2);
  });

  it("rejects keys that aren't snake_case lowercase", async () => {
    const c = caller();
    await expect(
      c.capability.upsert({
        sector_slug: SEEDED_SECTOR,
        key: "Rad-Hard",
        name: "x",
        description: "x",
        rationale: "x",
      }),
    ).rejects.toThrow();
  });

  it("list orders by display_order asc", async () => {
    const c = caller();
    await c.capability.upsert({
      sector_slug: SEEDED_SECTOR,
      key: "a",
      name: "A",
      description: "x",
      rationale: "x",
      display_order: 30,
    });
    await c.capability.upsert({
      sector_slug: SEEDED_SECTOR,
      key: "b",
      name: "B",
      description: "x",
      rationale: "x",
      display_order: 10,
    });
    await c.capability.upsert({
      sector_slug: SEEDED_SECTOR,
      key: "c",
      name: "C",
      description: "x",
      rationale: "x",
      display_order: 20,
    });
    const list = await c.capability.list({ sector_slug: SEEDED_SECTOR });
    expect(list.map((c) => c.key)).toEqual(["b", "c", "a"]);
  });

  it("addDependency creates the edge; second call is idempotent", async () => {
    const c = caller();
    for (const k of ["a", "b"]) {
      await c.capability.upsert({
        sector_slug: SEEDED_SECTOR,
        key: k,
        name: k.toUpperCase(),
        description: "x",
        rationale: "x",
      });
    }
    const first = await c.capability.addDependency({
      sector_slug: SEEDED_SECTOR,
      source_key: "a",
      target_key: "b",
      rationale: "a depends on b",
    });
    const second = await c.capability.addDependency({
      sector_slug: SEEDED_SECTOR,
      source_key: "a",
      target_key: "b",
      rationale: "updated rationale",
    });
    expect(second.id).toBe(first.id);
    expect(second.rationale).toBe("updated rationale");
  });

  it("addDependency rejects self-dependency", async () => {
    const c = caller();
    await c.capability.upsert({
      sector_slug: SEEDED_SECTOR,
      key: "a",
      name: "A",
      description: "x",
      rationale: "x",
    });
    await expect(
      c.capability.addDependency({
        sector_slug: SEEDED_SECTOR,
        source_key: "a",
        target_key: "a",
      }),
    ).rejects.toThrow(/self-dependency/);
  });

  it("addDependency detects cycles (a→b→c→a is rejected)", async () => {
    const c = caller();
    for (const k of ["a", "b", "c"]) {
      await c.capability.upsert({
        sector_slug: SEEDED_SECTOR,
        key: k,
        name: k.toUpperCase(),
        description: "x",
        rationale: "x",
      });
    }
    await c.capability.addDependency({
      sector_slug: SEEDED_SECTOR,
      source_key: "a",
      target_key: "b",
    });
    await c.capability.addDependency({
      sector_slug: SEEDED_SECTOR,
      source_key: "b",
      target_key: "c",
    });
    // c → a would close the cycle.
    await expect(
      c.capability.addDependency({
        sector_slug: SEEDED_SECTOR,
        source_key: "c",
        target_key: "a",
      }),
    ).rejects.toThrow(/cycle/);
  });

  it("removeDependency is idempotent on missing edge", async () => {
    const c = caller();
    for (const k of ["a", "b"]) {
      await c.capability.upsert({
        sector_slug: SEEDED_SECTOR,
        key: k,
        name: k.toUpperCase(),
        description: "x",
        rationale: "x",
      });
    }
    const r = await c.capability.removeDependency({
      sector_slug: SEEDED_SECTOR,
      source_key: "a",
      target_key: "b",
    });
    expect(r.ok).toBe(true);
  });

  it("get returns capability + current score + dependencies/dependents", async () => {
    const c = caller();
    for (const k of ["a", "b", "c"]) {
      await c.capability.upsert({
        sector_slug: SEEDED_SECTOR,
        key: k,
        name: k.toUpperCase(),
        description: "x",
        rationale: "x",
      });
    }
    await c.capability.addDependency({
      sector_slug: SEEDED_SECTOR,
      source_key: "a",
      target_key: "b",
    });
    await c.capability.addDependency({
      sector_slug: SEEDED_SECTOR,
      source_key: "c",
      target_key: "a",
    });
    // Write a current score manually (M40 normally does this).
    const capA = await prisma.capability.findUniqueOrThrow({
      where: { sector_slug_key: { sector_slug: SEEDED_SECTOR, key: "a" } },
    });
    await prisma.capabilityScore.create({
      data: {
        capability_id: capA.id,
        technical: 60,
        economic: 40,
        regulatory: 80,
        supply: 70,
        composite: 62,
        as_of: new Date("2026-05-01"),
        is_current: true,
      },
    });

    const out = await c.capability.get({ sector_slug: SEEDED_SECTOR, key: "a" });
    expect(out.capability.key).toBe("a");
    expect(out.current_score?.composite).toBe(62);
    // a depends on b
    expect(out.dependencies.map((d) => d.target_key)).toEqual(["b"]);
    // c depends on a — so a's dependents include c
    expect(out.dependents.map((d) => d.source_key)).toEqual(["c"]);
  });
});

// --------------------------------------------------------------------
// risk.*
// --------------------------------------------------------------------

describe("risk router", () => {
  it("upsert preserves valid affected_capability_keys, drops missing ones", async () => {
    const c = caller();
    await c.capability.upsert({
      sector_slug: SEEDED_SECTOR,
      key: "exists",
      name: "Exists",
      description: "x",
      rationale: "x",
    });
    const r = await c.risk.upsert({
      sector_slug: SEEDED_SECTOR,
      key: "itar",
      category: "legal",
      name: "ITAR export control",
      description: "Export control restricts optics supply to KR/CN.",
      severity: "high",
      likelihood: "medium",
      time_horizon: "3y",
      affected_capability_keys: ["exists", "ghost_capability"],
    });
    expect(r.affected_capability_keys).toEqual(["exists"]);

    // Audit log records the drop.
    const audit = await prisma.auditLog.findFirst({
      where: { sector_slug: SEEDED_SECTOR, action: "risk.upsert" },
    });
    expect(audit?.payload).toMatchObject({ dropped_capability_keys: ["ghost_capability"] });
  });

  it("upsert is idempotent on (sector_slug, key)", async () => {
    const c = caller();
    const r1 = await c.risk.upsert({
      sector_slug: SEEDED_SECTOR,
      key: "kessler",
      category: "safety",
      name: "Kessler debris",
      description: "Orbital debris cascade risk.",
      severity: "medium",
      likelihood: "medium",
      time_horizon: "5y",
    });
    const r2 = await c.risk.upsert({
      sector_slug: SEEDED_SECTOR,
      key: "kessler",
      category: "safety",
      name: "Kessler debris (revised)",
      description: "Updated.",
      severity: "high",
      likelihood: "medium",
      time_horizon: "5y",
    });
    expect(r2.id).toBe(r1.id);
    expect(r2.name).toBe("Kessler debris (revised)");
    expect(r2.severity).toBe("high");
  });

  it("delete cascades cleanly", async () => {
    const c = caller();
    await c.risk.upsert({
      sector_slug: SEEDED_SECTOR,
      key: "x",
      category: "political",
      name: "X",
      description: "x",
      severity: "low",
      likelihood: "low",
      time_horizon: "1y",
    });
    const out = await c.risk.delete({ sector_slug: SEEDED_SECTOR, key: "x" });
    expect(out.ok).toBe(true);
    const after = await c.risk.list({ sector_slug: SEEDED_SECTOR });
    expect(after.length).toBe(0);
  });
});

// --------------------------------------------------------------------
// signal.*
// --------------------------------------------------------------------

describe("signal router", () => {
  it("list filters by capability_key + paginates via cursor", async () => {
    const c = caller();
    await c.capability.upsert({
      sector_slug: SEEDED_SECTOR,
      key: "downlink",
      name: "Downlink",
      description: "x",
      rationale: "x",
    });
    const cap = await prisma.capability.findUniqueOrThrow({
      where: { sector_slug_key: { sector_slug: SEEDED_SECTOR, key: "downlink" } },
    });
    // Seed 5 signals with descending published_at.
    for (let i = 0; i < 5; i += 1) {
      await prisma.signal.create({
        data: {
          sector_slug: SEEDED_SECTOR,
          capability_id: cap.id,
          source_kind: "paper",
          source_url: `https://arxiv.org/abs/2401.0000${i}`,
          title: `Paper ${i}`,
          published_at: new Date(2026, 0, 10 - i), // newer first when i smaller
        },
      });
    }

    const first = await c.signal.list({
      sector_slug: SEEDED_SECTOR,
      capability_key: "downlink",
      limit: 3,
    });
    expect(first.items.length).toBe(3);
    expect(first.next_cursor).toBeTruthy();

    const second = await c.signal.list({
      sector_slug: SEEDED_SECTOR,
      capability_key: "downlink",
      limit: 3,
      cursor: first.next_cursor!,
    });
    expect(second.items.length).toBe(2);
    expect(second.next_cursor).toBeNull();

    const allIds = [...first.items, ...second.items].map((s) => s.id);
    expect(new Set(allIds).size).toBe(5); // no overlap, no missing
  });

  it("markHighlight toggles flag and writes audit", async () => {
    const c = caller();
    const s = await prisma.signal.create({
      data: {
        sector_slug: SEEDED_SECTOR,
        source_kind: "news",
        source_url: "https://example.com/headline",
        title: "Headline",
        published_at: new Date(),
      },
    });
    await c.signal.markHighlight({ id: s.id, is_highlight: true });
    const after = await prisma.signal.findUniqueOrThrow({ where: { id: s.id } });
    expect(after.is_highlight).toBe(true);
    const audit = await prisma.auditLog.findFirst({
      where: { sector_slug: SEEDED_SECTOR, action: "signal.markHighlight" },
    });
    expect(audit).not.toBeNull();
  });
});

// --------------------------------------------------------------------
// vision.* (composite reads)
// --------------------------------------------------------------------

describe("vision router", () => {
  it("getOverview returns a coherent composite payload", async () => {
    const c = caller();
    // Two capabilities, one binding.
    for (const [key, weight] of [
      ["rad_hard", 0.2],
      ["thermal", 0.15],
    ] as const) {
      await c.capability.upsert({
        sector_slug: SEEDED_SECTOR,
        key,
        name: key,
        description: "x",
        rationale: "x",
        weight,
      });
    }
    const capRad = await prisma.capability.findUniqueOrThrow({
      where: { sector_slug_key: { sector_slug: SEEDED_SECTOR, key: "rad_hard" } },
    });
    const capTher = await prisma.capability.findUniqueOrThrow({
      where: { sector_slug_key: { sector_slug: SEEDED_SECTOR, key: "thermal" } },
    });
    await prisma.capabilityScore.create({
      data: {
        capability_id: capRad.id,
        technical: 40,
        economic: 30,
        regulatory: 50,
        supply: 35,
        composite: 38,
        as_of: new Date("2026-05-01"),
        is_current: true,
      },
    });
    await prisma.capabilityScore.create({
      data: {
        capability_id: capTher.id,
        technical: 70,
        economic: 65,
        regulatory: 80,
        supply: 75,
        composite: 72,
        as_of: new Date("2026-05-01"),
        is_current: true,
      },
    });
    // A risk affecting rad_hard.
    await c.risk.upsert({
      sector_slug: SEEDED_SECTOR,
      key: "itar",
      category: "legal",
      name: "ITAR",
      description: "x",
      severity: "high",
      likelihood: "medium",
      time_horizon: "3y",
      affected_capability_keys: ["rad_hard"],
    });
    // Signals.
    await prisma.signal.create({
      data: {
        sector_slug: SEEDED_SECTOR,
        capability_id: capRad.id,
        source_kind: "paper",
        source_url: "https://arxiv.org/abs/2401.99991",
        title: "Rad-hard breakthrough",
        published_at: new Date("2026-05-20"),
        delta_technical: 5,
        delta_economic: 2,
      },
    });
    // Vision-level feasibility snapshot.
    await prisma.visionFeasibility.create({
      data: {
        sector_slug: SEEDED_SECTOR,
        as_of: new Date("2026-05-01"),
        is_current: true,
        composite: 55,
        composite_p10: 48,
        composite_p90: 62,
        binding_capability_key: "rad_hard",
        eta_median_years: 8,
        eta_p10_years: 5,
        eta_p90_years: 14,
        delta_90d: 4,
      },
    });

    const out = await c.vision.getOverview({ slug: SEEDED_SECTOR });
    expect(out.vision.slug).toBe(SEEDED_SECTOR);
    expect(out.vision.capability_count).toBe(2);
    expect(out.vision.risk_count).toBe(1);
    expect(out.vision.signal_count_30d).toBe(1);
    expect(out.vision.feasibility?.composite).toBe(55);

    // Capability cards: rad_hard is marked binding.
    const radCard = out.capabilities.find((c) => c.key === "rad_hard");
    const therCard = out.capabilities.find((c) => c.key === "thermal");
    expect(radCard?.is_binding).toBe(true);
    expect(therCard?.is_binding).toBe(false);
    expect(radCard?.current_score?.composite).toBe(38);
    expect(radCard?.latest_signal?.title).toBe("Rad-hard breakthrough");
    // pickComposite picks the largest-magnitude dim delta = +5.
    expect(radCard?.latest_signal?.delta_composite).toBe(5);

    // Risk surfaces.
    expect(out.risks[0]?.affected_capability_keys).toEqual(["rad_hard"]);

    // Recent signals list.
    expect(out.recent_signals.length).toBe(1);
    expect(out.recent_signals[0]?.capability_key).toBe("rad_hard");
  });

  it("list returns vision-eligible sectors with summary counts", async () => {
    const c = caller();
    const out = await c.vision.list({});
    const sdc = out.find((v) => v.slug === SEEDED_SECTOR);
    expect(sdc).toBeDefined();
    expect(sdc?.is_vision_eligible).toBe(true);
  });

  it("get throws NOT_FOUND for missing slug", async () => {
    const c = caller();
    await expect(c.vision.get({ slug: "no-such-vision" })).rejects.toThrow(TRPCError);
  });

  it("feasibilityHistory returns asc-sorted snapshots", async () => {
    const c = caller();
    const dates = [
      new Date("2026-04-01"),
      new Date("2026-04-15"),
      new Date("2026-05-01"),
    ];
    for (const d of dates) {
      await prisma.visionFeasibility.create({
        data: {
          sector_slug: SEEDED_SECTOR,
          as_of: d,
          composite: 50 + d.getDate(),
        },
      });
    }
    const out = await c.vision.feasibilityHistory({ slug: SEEDED_SECTOR });
    expect(out.map((p) => p.as_of.toISOString())).toEqual(dates.map((d) => d.toISOString()));
  });
});

// --------------------------------------------------------------------
// feasibility.*
// --------------------------------------------------------------------

describe("feasibility router", () => {
  it("current returns null when no snapshot exists", async () => {
    const c = caller();
    const out = await c.feasibility.current({ sector_slug: SEEDED_SECTOR });
    expect(out).toBeNull();
  });

  it("history returns time-asc rows", async () => {
    const c = caller();
    for (let i = 0; i < 3; i += 1) {
      await prisma.visionFeasibility.create({
        data: {
          sector_slug: SEEDED_SECTOR,
          as_of: new Date(2026, 4, 1 + i),
          composite: 60 + i,
        },
      });
    }
    const out = await c.feasibility.history({ sector_slug: SEEDED_SECTOR, limit: 10 });
    expect(out.length).toBe(3);
    expect(out[0]?.composite).toBe(60);
    expect(out[2]?.composite).toBe(62);
  });

  it("recompute surfaces BAD_GATEWAY until M40 endpoint lands", async () => {
    const c = caller();
    await expect(
      c.feasibility.recompute({ sector_slug: SEEDED_SECTOR }),
    ).rejects.toThrow(/M40/);
  });
});
