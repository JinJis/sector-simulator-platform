/**
 * Tests for the M41c `visionBuilder.*` router.
 *
 * - propose(): agent-orchestration HTTP mocked via globalThis.fetch
 * - commit(): hits real Postgres — verifies the full transaction
 *   persists Sector / Capability / Risk / Actor / joins / seed scores /
 *   seed feasibility / signal_keywords.
 *
 * Pre-requisites:
 *   - DATABASE_URL reachable
 *   - migrations applied
 *   - sectors table seeded (pnpm db:seed)
 */

import { TRPCError } from "@trpc/server";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

process.env.SIMULATION_SERVICE_URL ??= "http://localhost:8000";
process.env.AGENT_ORCHESTRATION_URL ??= "http://agent-mock";

const { prisma } = await import("@platform/db");
const { createCallerFactory } = await import("../src/trpc/init.js");
const { appRouter } = await import("../src/trpc/router.js");
const { stubContext } = await import("./stub-context.js");

const TEST_SLUG = "vb-test-quantum-rsa-break";
const createCaller = createCallerFactory(appRouter);

function caller() {
  return createCaller(
    stubContext({
      prisma,
      user: { id: "test-user", email: "t@e.com", name: "T", label: "tester" },
    }),
  );
}

async function wipe(): Promise<void> {
  // Cascade order: signals → scores → deps → caps → risks → feas →
  // joins → sector. Actor rows are global — leave them so the next
  // test can verify the upsert/reuse path.
  await prisma.signal.deleteMany({ where: { sector_slug: TEST_SLUG } });
  await prisma.capabilityScore.deleteMany({
    where: { capability: { sector_slug: TEST_SLUG } },
  });
  await prisma.capabilityDependency.deleteMany({
    where: { source: { sector_slug: TEST_SLUG } },
  });
  await prisma.capabilityActor.deleteMany({
    where: { capability: { sector_slug: TEST_SLUG } },
  });
  await prisma.visionActor.deleteMany({ where: { sector_slug: TEST_SLUG } });
  await prisma.capability.deleteMany({ where: { sector_slug: TEST_SLUG } });
  await prisma.risk.deleteMany({ where: { sector_slug: TEST_SLUG } });
  await prisma.visionFeasibility.deleteMany({ where: { sector_slug: TEST_SLUG } });
  await prisma.auditLog.deleteMany({ where: { sector_slug: TEST_SLUG } });
  await prisma.sector.deleteMany({ where: { slug: TEST_SLUG } });
  // Wipe synthetic actor rows the tests insert (prefix "vb_test_").
  await prisma.actor.deleteMany({ where: { key: { startsWith: "vb_test_" } } });
  // And the unscoped audit rows we wrote on propose().
  await prisma.auditLog.deleteMany({
    where: {
      action: { in: ["vision_builder.propose", "vision_builder.commit"] },
      sector_slug: null,
    },
  });
}

beforeAll(async () => {
  // Ensure migrations are applied and the legacy seed exists.
});

beforeEach(async () => {
  vi.restoreAllMocks();
  await wipe();
});

afterEach(() => {
  vi.restoreAllMocks();
});

afterAll(async () => {
  await wipe();
  await prisma.$disconnect();
});

// --------- fixture builders --------------------------------------------

function _capability(overrides: Partial<Record<string, unknown>> = {}): Record<string, unknown> {
  return {
    key: "cap_a",
    name: "Capability A",
    short_name: null,
    description: "Description that satisfies the min length bound for capability.",
    rationale: "Rationale that satisfies the min length bound for capability.",
    weight: 0.25,
    display_order: 10,
    primary_driver_name: null,
    initial_technical: 55,
    initial_economic: 40,
    initial_regulatory: 60,
    initial_supply: 45,
    confidence: 0.7,
    ...overrides,
  };
}

function _actor(key: string, overrides: Partial<Record<string, unknown>> = {}): Record<string, unknown> {
  return {
    key,
    name: key.toUpperCase(),
    short_name: null,
    name_local: null,
    iso_country: "US",
    category: "public_corp",
    ticker: null,
    exchange: null,
    blurb: "ten chars min for actor",
    description: null,
    stage: "commercial",
    website: null,
    signal_keywords: ["x"],
    relevance: 70,
    rationale: "Long enough rationale for actor.",
    display_order: 10,
    ...overrides,
  };
}

function _draft(): Record<string, unknown> {
  return {
    slug: TEST_SLUG,
    name: "Quantum vs RSA",
    vision_question: "By when will quantum computers break RSA-2048?",
    description:
      "Long enough description satisfying the field bound for the vision-level summary.",
    domain_label: "Compute",
    capabilities: [
      _capability({ key: "qubit_count", weight: 0.30, display_order: 10 }),
      _capability({ key: "fidelity", weight: 0.25, display_order: 20 }),
      _capability({ key: "shor_implementation", weight: 0.25, display_order: 30 }),
      _capability({ key: "cryo_supply", weight: 0.20, display_order: 40 }),
    ],
    dependencies: [
      {
        source_key: "qubit_count",
        target_key: "shor_implementation",
        rationale: "Shor needs millions of physical qubits to break RSA-2048.",
      },
    ],
    risks: [
      {
        key: "post_quantum_migration",
        category: "political",
        name: "Post-quantum crypto adoption pace",
        description: "Governments may roll out PQ crypto before RSA is breakable.",
        severity: "medium",
        likelihood: "high",
        time_horizon: "5y",
        mitigations: null,
        affected_capability_keys: ["shor_implementation"],
        display_order: 10,
      },
      {
        key: "export_controls",
        category: "legal",
        name: "Quantum export controls",
        description: "US BIS may restrict quantum-tech exports, slowing global progress.",
        severity: "medium",
        likelihood: "medium",
        time_horizon: "3y",
        mitigations: null,
        affected_capability_keys: [],
        display_order: 20,
      },
    ],
    actors: [
      _actor("vb_test_ibm"),
      _actor("vb_test_google_q", { key: "vb_test_google_q" }),
      _actor("vb_test_psiquantum"),
    ],
    capability_actors: [
      { capability_key: "qubit_count", actor_key: "vb_test_ibm", role: "lead", rationale: null },
      { capability_key: "fidelity", actor_key: "vb_test_google_q", role: "lead", rationale: null },
      {
        capability_key: "shor_implementation",
        actor_key: "vb_test_psiquantum",
        role: "competitor",
        rationale: null,
      },
      { capability_key: "cryo_supply", actor_key: "vb_test_ibm", role: "lead", rationale: null },
    ],
    initial_feasibility: {
      initial_composite: 32,
      initial_p10: 18,
      initial_p90: 48,
      binding_capability_key: "qubit_count",
      eta_median_years: 12,
      eta_p10_years: 7,
      eta_p90_years: 20,
      rationale: "Qubit count is the binding constraint today.",
    },
    rationale:
      "Decomposition rationale long enough to satisfy the bound for this test draft.",
    confidence: 0.78,
  };
}

function _signalConfig(): Record<string, unknown> {
  return {
    keywords_by_capability: [
      {
        capability_key: "qubit_count",
        arxiv_keywords: ["superconducting qubits"],
        uspto_keywords: ["qubit array"],
        news_keywords: ["IBM Heron"],
      },
      {
        capability_key: "fidelity",
        arxiv_keywords: ["quantum error correction"],
        uspto_keywords: [],
        news_keywords: [],
      },
      {
        capability_key: "shor_implementation",
        arxiv_keywords: ["shor algorithm"],
        uspto_keywords: [],
        news_keywords: [],
      },
      {
        capability_key: "cryo_supply",
        arxiv_keywords: ["dilution refrigerator"],
        uspto_keywords: [],
        news_keywords: [],
      },
    ],
    rationale: "",
  };
}

function _proposeOk(): Record<string, unknown> {
  return {
    success: true,
    validation: {
      is_valid: true,
      rejection_kind: null,
      rejection_reason: null,
      refined_question: "By when will quantum computers break RSA-2048?",
      suggested_name: "Quantum vs RSA",
      suggested_slug: TEST_SLUG,
      domain_label: "Compute",
      scope: "balanced",
      suggested_capability_count: 4,
      suggested_actor_count: 8,
      review_notes: [],
      confidence: 0.85,
    },
    draft: _draft(),
    signal_config: _signalConfig(),
    gate: { ok: true, errors: [], warnings: [] },
    stages: [
      { name: "prompt_validator", cost_usd: 0.001, duration_ms: 50 },
      { name: "vision_decomposition", cost_usd: 0.4, duration_ms: 8000 },
      { name: "data_source_selector", cost_usd: 0.002, duration_ms: 500 },
      { name: "validation_gate", cost_usd: 0.0, duration_ms: 3 },
    ],
    total_cost_usd: 0.403,
    total_duration_ms: 8553,
  };
}

function mockAgentFetch(response: unknown): void {
  vi.spyOn(globalThis, "fetch").mockImplementation((input) => {
    const url = typeof input === "string" ? input : (input as URL).toString();
    if (url.endsWith("/vision-builder/build")) {
      return Promise.resolve(
        new Response(JSON.stringify(response), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      );
    }
    return Promise.resolve(new Response("not mocked", { status: 404 }));
  });
}

// --------- tests --------------------------------------------------------

describe("visionBuilder.propose", () => {
  it("returns the build envelope from agent-orchestration verbatim", async () => {
    mockAgentFetch(_proposeOk());
    const c = caller();
    const out = await c.visionBuilder.propose({ prompt: "Will quantum break RSA by 2040?" });
    expect(out.success).toBe(true);
    expect(out.validation.is_valid).toBe(true);
    expect(out.draft?.slug).toBe(TEST_SLUG);
    expect(out.gate?.ok).toBe(true);
    expect(out.stages.length).toBe(4);
  });

  it("audits propose call regardless of outcome", async () => {
    mockAgentFetch(_proposeOk());
    const c = caller();
    await c.visionBuilder.propose({ prompt: "Will quantum break RSA by 2040?" });
    const audits = await prisma.auditLog.findMany({
      where: { action: "vision_builder.propose" },
      orderBy: { created_at: "desc" },
      take: 1,
    });
    expect(audits.length).toBe(1);
    expect(audits[0]?.author_label).toBe("tester");
  });

  it("surfaces rejection from agent-orchestration as a success-false envelope", async () => {
    const rejected = {
      success: false,
      validation: {
        is_valid: false,
        rejection_kind: "off_topic",
        rejection_reason: "Not a tech vision.",
        refined_question: "x",
        suggested_name: "x",
        suggested_slug: "placeholder",
        domain_label: "Other",
        scope: "narrow",
        suggested_capability_count: 3,
        suggested_actor_count: 3,
        review_notes: [],
        confidence: 0.95,
      },
      draft: null,
      signal_config: null,
      gate: null,
      stages: [{ name: "prompt_validator", cost_usd: 0.0005, duration_ms: 30 }],
      total_cost_usd: 0.0005,
      total_duration_ms: 30,
    };
    mockAgentFetch(rejected);
    const c = caller();
    const out = await c.visionBuilder.propose({ prompt: "What's the weather today?" });
    expect(out.success).toBe(false);
    expect(out.validation.is_valid).toBe(false);
    expect(out.draft).toBeNull();
  });
});

describe("visionBuilder.commit", () => {
  it("persists a full draft inside one transaction", async () => {
    const c = caller();
    const result = await c.visionBuilder.commit({
      draft: _draft() as never,
      signal_config: _signalConfig() as never,
    });
    expect(result.slug).toBe(TEST_SLUG);
    expect(result.capability_count).toBe(4);
    expect(result.risk_count).toBe(2);
    expect(result.actor_count_inserted).toBe(3);
    expect(result.actor_count_reused).toBe(0);

    // Verify the inserted shape.
    const sector = await prisma.sector.findUnique({ where: { slug: TEST_SLUG } });
    expect(sector?.status).toBe("draft"); // admin must promote to "live"
    expect(sector?.is_vision_eligible).toBe(true);

    const caps = await prisma.capability.findMany({ where: { sector_slug: TEST_SLUG } });
    expect(caps.length).toBe(4);
    const capByKey = new Map(caps.map((c) => [c.key, c]));
    // signal_keywords merged across arxiv/uspto/news lists.
    expect(capByKey.get("qubit_count")?.signal_keywords.sort()).toEqual(
      ["IBM Heron", "qubit array", "superconducting qubits"].sort(),
    );

    const deps = await prisma.capabilityDependency.findMany({
      where: { source: { sector_slug: TEST_SLUG } },
    });
    expect(deps.length).toBe(1);

    const risks = await prisma.risk.findMany({ where: { sector_slug: TEST_SLUG } });
    expect(risks.length).toBe(2);

    const vas = await prisma.visionActor.findMany({ where: { sector_slug: TEST_SLUG } });
    expect(vas.length).toBe(3);

    const cas = await prisma.capabilityActor.findMany({
      where: { capability: { sector_slug: TEST_SLUG } },
    });
    expect(cas.length).toBe(4);

    const scores = await prisma.capabilityScore.findMany({
      where: { capability: { sector_slug: TEST_SLUG }, is_current: true },
    });
    expect(scores.length).toBe(4);
    // Seed scores come from the draft's initial_* fields.
    const scoreByCap = new Map(
      scores.map((s) => [s.capability_id, s] as const),
    );
    const qubitCount = capByKey.get("qubit_count");
    expect(qubitCount).toBeDefined();
    const qcScore = scoreByCap.get(qubitCount!.id);
    expect(qcScore?.technical).toBe(55);
    expect(qcScore?.composite).not.toBeNull();

    const feas = await prisma.visionFeasibility.findFirst({
      where: { sector_slug: TEST_SLUG, is_current: true },
    });
    expect(feas).not.toBeNull();
    expect(feas?.composite).toBe(32);
    expect(feas?.binding_capability_key).toBe("qubit_count");
  });

  it("reuses an existing Actor by global key on second apply", async () => {
    const c = caller();
    // Seed one of the actors as a pre-existing global row.
    await prisma.actor.create({
      data: {
        key: "vb_test_ibm",
        name: "IBM (pre-existing)",
        iso_country: "US",
        category: "public_corp",
        blurb: "pre-existing",
        stage: "commercial",
        signal_keywords: ["IBM"],
      },
    });
    const result = await c.visionBuilder.commit({
      draft: _draft() as never,
      signal_config: _signalConfig() as never,
    });
    expect(result.actor_count_inserted).toBe(2); // google_q + psiquantum
    expect(result.actor_count_reused).toBe(1); // vb_test_ibm
    // The pre-existing IBM row should still exist with its original name.
    const ibm = await prisma.actor.findUnique({ where: { key: "vb_test_ibm" } });
    expect(ibm?.name).toBe("IBM (pre-existing)");
  });

  it("refuses to overwrite an existing vision slug", async () => {
    const c = caller();
    await c.visionBuilder.commit({
      draft: _draft() as never,
      signal_config: _signalConfig() as never,
    });
    await expect(
      c.visionBuilder.commit({
        draft: _draft() as never,
        signal_config: _signalConfig() as never,
      }),
    ).rejects.toThrow(TRPCError);
  });

  it("audits the apply call with row counts in the payload", async () => {
    const c = caller();
    await c.visionBuilder.commit({
      draft: _draft() as never,
      signal_config: _signalConfig() as never,
    });
    const audits = await prisma.auditLog.findMany({
      where: { action: "vision_builder.commit", sector_slug: TEST_SLUG },
    });
    expect(audits.length).toBe(1);
    const payload = audits[0]?.payload as Record<string, unknown>;
    expect(payload.capability_count).toBe(4);
    expect(payload.risk_count).toBe(2);
    expect(payload.actor_count_inserted).toBe(3);
  });

  it("apply works with null signal_config (no keywords persisted)", async () => {
    const c = caller();
    await c.visionBuilder.commit({
      draft: _draft() as never,
      signal_config: null,
    });
    const caps = await prisma.capability.findMany({ where: { sector_slug: TEST_SLUG } });
    for (const c of caps) {
      expect(c.signal_keywords).toEqual([]);
    }
  });
});
