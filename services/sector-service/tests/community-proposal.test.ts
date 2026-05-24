/**
 * Integration tests for M46a `communityProposal.*` router. Hits real
 * Postgres so the unique constraints + transaction semantics get
 * exercised against the real engine (same pattern as vision-builder.test.ts).
 *
 * Pre-requisites:
 *   - DATABASE_URL reachable
 *   - migrations applied (`pnpm db:migrate dev`)
 *   - sectors table seeded (`pnpm db:seed`)
 */

import { TRPCError } from "@trpc/server";
import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

process.env.SIMULATION_SERVICE_URL ??= "http://localhost:8000";

const { prisma } = await import("@platform/db");
const { createCallerFactory } = await import("../src/trpc/init.js");
const { appRouter } = await import("../src/trpc/router.js");
const { stubContext } = await import("./stub-context.js");

const TEST_SECTOR = "space-data-center";
const createCaller = createCallerFactory(appRouter);

interface FakeUser {
  id: string;
  email: string;
  name: string;
  label: string;
}

async function createTestUser(): Promise<FakeUser> {
  const id = `m46a-test-${randomUUID()}`;
  await prisma.user.create({
    data: {
      id,
      email: `${id}@example.com`,
      password_hash: "x",
      name: `Tester ${id.slice(0, 6)}`,
    },
  });
  return {
    id,
    email: `${id}@example.com`,
    name: `Tester ${id.slice(0, 6)}`,
    label: `Tester ${id.slice(0, 6)}`,
  };
}

function caller(user: FakeUser | null) {
  return createCaller(stubContext({ prisma, user }));
}

async function wipe(): Promise<void> {
  // ProposalVote + Evidence + Replies cascade-delete via FK.
  await prisma.communityProposal.deleteMany({
    where: { sector_slug: TEST_SECTOR },
  });
  await prisma.auditLog.deleteMany({
    where: { action: "community_proposal.create", sector_slug: TEST_SECTOR },
  });
  await prisma.user.deleteMany({ where: { id: { startsWith: "m46a-test-" } } });
}

beforeEach(wipe);

afterAll(async () => {
  await wipe();
  await prisma.$disconnect();
});

const SAMPLE_DRIVER_PAYLOAD = {
  name: "rad_hard_chip_yield_pct",
  group: "Compute",
  unit: "%",
  default: 65,
  min: 30,
  max: 95,
  description: "Per-wafer yield for radiation-hardened SoCs",
};

const SAMPLE_INPUT = {
  sector_slug: TEST_SECTOR,
  target_kind: "add_driver" as const,
  target_ref: null,
  title: "Add rad-hard chip yield driver",
  body: "Yield drives the unit economics of orbital DCs — we should expose it as a slider.",
  proposed_payload: SAMPLE_DRIVER_PAYLOAD,
  evidence: [
    { kind: "text" as const, content: "Rad-hard wafer yields are 60-75% based on Mil-Spec disclosures." },
    { kind: "url" as const, content: "https://example.com/wafer-yield-data" },
  ],
};

// ===== create ==========================================================

describe("communityProposal.create", () => {
  it("inserts proposal + evidence + audit log in one transaction", async () => {
    const user = await createTestUser();
    const c = caller(user);
    const { id } = await c.communityProposal.create(SAMPLE_INPUT);
    expect(id).toBeTruthy();

    const row = await prisma.communityProposal.findUnique({
      where: { id },
      include: { evidence: true },
    });
    expect(row?.title).toBe(SAMPLE_INPUT.title);
    expect(row?.status).toBe("open");
    expect(row?.vote_score).toBe(0);
    expect(row?.evidence.length).toBe(2);

    const audit = await prisma.auditLog.findFirst({
      where: { action: "community_proposal.create", sector_slug: TEST_SECTOR },
    });
    expect(audit).not.toBeNull();
  });

  it("rejects anonymous submissions", async () => {
    const c = caller(null);
    await expect(c.communityProposal.create(SAMPLE_INPUT)).rejects.toThrow(
      TRPCError,
    );
  });

  it("404 on unknown sector_slug", async () => {
    const user = await createTestUser();
    const c = caller(user);
    await expect(
      c.communityProposal.create({ ...SAMPLE_INPUT, sector_slug: "ghost" }),
    ).rejects.toThrow(TRPCError);
  });

  it("enforces 3-per-day cap per author", async () => {
    const user = await createTestUser();
    const c = caller(user);
    for (let i = 0; i < 3; i++) {
      await c.communityProposal.create({
        ...SAMPLE_INPUT,
        title: `Proposal ${i + 1}`,
      });
    }
    await expect(
      c.communityProposal.create({ ...SAMPLE_INPUT, title: "Fourth" }),
    ).rejects.toThrow(/Daily proposal cap/);
  });

  it("zod rejects too-short title / body", async () => {
    const user = await createTestUser();
    const c = caller(user);
    await expect(
      c.communityProposal.create({ ...SAMPLE_INPUT, title: "x" }),
    ).rejects.toThrow();
    await expect(
      c.communityProposal.create({ ...SAMPLE_INPUT, body: "too short" }),
    ).rejects.toThrow();
  });

  it("zod rejects non-URL url-kind evidence", async () => {
    const user = await createTestUser();
    const c = caller(user);
    await expect(
      c.communityProposal.create({
        ...SAMPLE_INPUT,
        evidence: [{ kind: "url", content: "not a url" }],
      }),
    ).rejects.toThrow();
  });
});

// ===== vote ============================================================

describe("communityProposal.vote", () => {
  it("toggles on/off and updates vote_score atomically", async () => {
    const author = await createTestUser();
    const voter = await createTestUser();
    const { id } = await caller(author).communityProposal.create(SAMPLE_INPUT);

    const v1 = await caller(voter).communityProposal.vote({ proposal_id: id });
    expect(v1.voted).toBe(true);
    expect(v1.vote_score).toBe(1);

    // Toggling off
    const v2 = await caller(voter).communityProposal.vote({ proposal_id: id });
    expect(v2.voted).toBe(false);
    expect(v2.vote_score).toBe(0);

    // Idempotent re-vote
    const v3 = await caller(voter).communityProposal.vote({ proposal_id: id });
    expect(v3.voted).toBe(true);
    expect(v3.vote_score).toBe(1);
  });

  it("two distinct users sum independently", async () => {
    const author = await createTestUser();
    const v1 = await createTestUser();
    const v2 = await createTestUser();
    const { id } = await caller(author).communityProposal.create(SAMPLE_INPUT);
    await caller(v1).communityProposal.vote({ proposal_id: id });
    const r = await caller(v2).communityProposal.vote({ proposal_id: id });
    expect(r.vote_score).toBe(2);
  });

  it("rejects anonymous vote", async () => {
    const author = await createTestUser();
    const { id } = await caller(author).communityProposal.create(SAMPLE_INPUT);
    await expect(
      caller(null).communityProposal.vote({ proposal_id: id }),
    ).rejects.toThrow(TRPCError);
  });

  it("404 on unknown proposal", async () => {
    const voter = await createTestUser();
    await expect(
      caller(voter).communityProposal.vote({ proposal_id: "doesnotexist" }),
    ).rejects.toThrow(TRPCError);
  });
});

// ===== list / get ======================================================

describe("communityProposal.list", () => {
  it("hot sort surfaces high-vote-score proposal first", async () => {
    const author = await createTestUser();
    const a = await caller(author).communityProposal.create({
      ...SAMPLE_INPUT,
      title: "Low-vote",
    });
    const b = await caller(author).communityProposal.create({
      ...SAMPLE_INPUT,
      title: "High-vote",
    });
    const voter1 = await createTestUser();
    const voter2 = await createTestUser();
    await caller(voter1).communityProposal.vote({ proposal_id: b.id });
    await caller(voter2).communityProposal.vote({ proposal_id: b.id });

    const out = await caller(null).communityProposal.list({
      sector_slug: TEST_SECTOR,
      sort: "hot",
    });
    expect(out.rows[0]?.id).toBe(b.id);
    expect(out.rows[1]?.id).toBe(a.id);
    expect(out.rows[0]?.vote_score).toBe(2);
  });

  it("new sort surfaces most-recent first", async () => {
    const author = await createTestUser();
    const a = await caller(author).communityProposal.create({
      ...SAMPLE_INPUT,
      title: "First",
    });
    await new Promise((r) => setTimeout(r, 10));
    const b = await caller(author).communityProposal.create({
      ...SAMPLE_INPUT,
      title: "Second",
    });

    const out = await caller(null).communityProposal.list({
      sector_slug: TEST_SECTOR,
      sort: "new",
    });
    expect(out.rows[0]?.id).toBe(b.id);
    expect(out.rows[1]?.id).toBe(a.id);
  });

  it("viewer_voted is true when the caller has voted", async () => {
    const author = await createTestUser();
    const voter = await createTestUser();
    const { id } = await caller(author).communityProposal.create(SAMPLE_INPUT);
    await caller(voter).communityProposal.vote({ proposal_id: id });

    const outVoter = await caller(voter).communityProposal.list({
      sector_slug: TEST_SECTOR,
    });
    expect(outVoter.rows[0]?.viewer_voted).toBe(true);

    const outOther = await caller(null).communityProposal.list({
      sector_slug: TEST_SECTOR,
    });
    expect(outOther.rows[0]?.viewer_voted).toBe(false);
  });

  it("cursor-based pagination returns next page", async () => {
    const author = await createTestUser();
    // 3 proposals max (rate cap) — use 2 authors to get 6
    const u2 = await createTestUser();
    const ids: string[] = [];
    for (let i = 0; i < 3; i++) {
      const { id } = await caller(author).communityProposal.create({
        ...SAMPLE_INPUT,
        title: `Author A proposal ${i}`,
      });
      ids.push(id);
    }
    for (let i = 0; i < 3; i++) {
      const { id } = await caller(u2).communityProposal.create({
        ...SAMPLE_INPUT,
        title: `Author B proposal ${i}`,
      });
      ids.push(id);
    }

    const page1 = await caller(null).communityProposal.list({
      sector_slug: TEST_SECTOR,
      sort: "new",
      limit: 4,
    });
    expect(page1.rows.length).toBe(4);
    expect(page1.next_cursor).not.toBeNull();
    const page2 = await caller(null).communityProposal.list({
      sector_slug: TEST_SECTOR,
      sort: "new",
      limit: 4,
      cursor: page1.next_cursor!,
    });
    expect(page2.rows.length).toBe(2);
    // No overlap
    const seen = new Set(page1.rows.map((r) => r.id));
    for (const r of page2.rows) expect(seen.has(r.id)).toBe(false);
  });
});

describe("communityProposal.get", () => {
  it("returns evidence + decision metadata", async () => {
    const author = await createTestUser();
    const { id } = await caller(author).communityProposal.create(SAMPLE_INPUT);
    const detail = await caller(null).communityProposal.get({ id });
    expect(detail.id).toBe(id);
    expect(detail.evidence.length).toBe(2);
    expect(detail.evidence[0]?.kind).toBe("text");
    expect(detail.evidence[1]?.kind).toBe("url");
    expect(detail.decided_at).toBeNull();
  });

  it("404 on missing", async () => {
    await expect(
      caller(null).communityProposal.get({ id: "ghost" }),
    ).rejects.toThrow(TRPCError);
  });
});
