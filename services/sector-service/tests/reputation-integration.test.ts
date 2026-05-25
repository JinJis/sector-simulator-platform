/**
 * M46c integration tests — DB-backed reputation hook on
 * `communityProposal.vote` + reputation/follow read paths.
 *
 * Uses real Postgres. Verifies:
 *   - Voting on a proposal credits the author with `weight` rep points
 *   - Voting off revokes the same amount (PointEvent log + total_points
 *     net to zero)
 *   - Self-votes don't grant rep
 *   - Vote weight scales with voter reputation
 *   - follow.toggle on/off updates counts
 *   - reputation.{get,events,leaderboard} read paths
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

async function createTestUser(prefix = "m46c"): Promise<FakeUser> {
  const id = `${prefix}-test-${randomUUID()}`;
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

const SAMPLE_INPUT = {
  sector_slug: TEST_SECTOR,
  target_kind: "add_driver" as const,
  target_ref: null,
  title: "Reputation hook test proposal",
  body: "Body text long enough to satisfy the min length bound.",
  proposed_payload: { name: "rep_test_driver" },
  evidence: [],
};

async function wipe(): Promise<void> {
  // Order: rep + events first (FK back to user), then proposals/votes,
  // then users.
  await prisma.proposalVote.deleteMany({
    where: { user_id: { startsWith: "m46c-test-" } },
  });
  await prisma.pointEvent.deleteMany({
    where: { user_id: { startsWith: "m46c-test-" } },
  });
  await prisma.userReputation.deleteMany({
    where: { user_id: { startsWith: "m46c-test-" } },
  });
  await prisma.userFollow.deleteMany({
    where: {
      OR: [
        { follower_id: { startsWith: "m46c-test-" } },
        { followed_id: { startsWith: "m46c-test-" } },
      ],
    },
  });
  await prisma.communityProposal.deleteMany({
    where: { author_id: { startsWith: "m46c-test-" } },
  });
  await prisma.auditLog.deleteMany({
    where: { sector_slug: TEST_SECTOR, action: "community_proposal.create" },
  });
  await prisma.user.deleteMany({ where: { id: { startsWith: "m46c-test-" } } });
}

beforeEach(wipe);

afterAll(async () => {
  await wipe();
  await prisma.$disconnect();
});

// ===== Reputation hook on vote =========================================

describe("communityProposal.vote → reputation", () => {
  it("voting credits the author 1p (newcomer voter)", async () => {
    const author = await createTestUser();
    const voter = await createTestUser();
    const { id } = await caller(author).communityProposal.create(SAMPLE_INPUT);
    await caller(voter).communityProposal.vote({ proposal_id: id });

    const rep = await caller(null).reputation.get({ user_id: author.id });
    expect(rep.total_points).toBe(1);
    expect(rep.tier).toBe("newcomer");
    const events = await caller(null).reputation.events({ user_id: author.id });
    expect(events.length).toBe(1);
    expect(events[0]?.kind).toBe("proposal_vote_received");
    expect(events[0]?.amount).toBe(1);
  });

  it("toggling off revokes the rep — net zero on log", async () => {
    const author = await createTestUser();
    const voter = await createTestUser();
    const { id } = await caller(author).communityProposal.create(SAMPLE_INPUT);
    await caller(voter).communityProposal.vote({ proposal_id: id });
    await caller(voter).communityProposal.vote({ proposal_id: id });
    const rep = await caller(null).reputation.get({ user_id: author.id });
    expect(rep.total_points).toBe(0);
    const events = await caller(null).reputation.events({ user_id: author.id });
    expect(events.length).toBe(2);
    expect(events.reduce((s, e) => s + e.amount, 0)).toBe(0);
  });

  it("self-vote does NOT grant rep", async () => {
    const author = await createTestUser();
    const { id } = await caller(author).communityProposal.create(SAMPLE_INPUT);
    await caller(author).communityProposal.vote({ proposal_id: id });
    const rep = await caller(null).reputation.get({ user_id: author.id });
    expect(rep.total_points).toBe(0);
    const events = await caller(null).reputation.events({ user_id: author.id });
    expect(events.length).toBe(0);
  });

  it("vote weight scales with voter rep — author gets weight points", async () => {
    const author = await createTestUser();
    const voter = await createTestUser();
    // Seed the voter as an Analyst (1500p → weight 2)
    await prisma.userReputation.create({
      data: { user_id: voter.id, total_points: 1500, tier: "analyst" },
    });
    const { id } = await caller(author).communityProposal.create(SAMPLE_INPUT);
    await caller(voter).communityProposal.vote({ proposal_id: id });
    const rep = await caller(null).reputation.get({ user_id: author.id });
    expect(rep.total_points).toBe(2);
    const proposal = await caller(null).communityProposal.get({ id });
    expect(proposal.vote_score).toBe(2);
  });
});

// ===== reputation.* read paths =========================================

describe("reputation read paths", () => {
  it("get returns synthetic newcomer row for a user with no rep", async () => {
    const u = await createTestUser();
    const r = await caller(null).reputation.get({ user_id: u.id });
    expect(r.total_points).toBe(0);
    expect(r.tier).toBe("newcomer");
  });

  it("leaderboard excludes zero-point users + sorts desc", async () => {
    const big = await createTestUser();
    const small = await createTestUser();
    const zero = await createTestUser();
    await prisma.userReputation.create({
      data: { user_id: big.id, total_points: 5000, tier: "senior" },
    });
    await prisma.userReputation.create({
      data: { user_id: small.id, total_points: 200, tier: "member" },
    });
    await prisma.userReputation.create({
      data: { user_id: zero.id, total_points: 0, tier: "newcomer" },
    });
    const lb = await caller(null).reputation.leaderboard({ limit: 50 });
    const ids = lb.map((r) => r.user_id);
    const bigIdx = ids.indexOf(big.id);
    const smallIdx = ids.indexOf(small.id);
    expect(bigIdx).toBeGreaterThanOrEqual(0);
    expect(smallIdx).toBeGreaterThan(bigIdx);
    expect(ids.includes(zero.id)).toBe(false);
  });
});

// ===== follow.* ========================================================

describe("follow.toggle + counts", () => {
  it("toggles on then off; counts track", async () => {
    const a = await createTestUser();
    const b = await createTestUser();
    const c1 = await caller(a).follow.counts({ user_id: b.id });
    expect(c1).toEqual({ followers: 0, following: 0, viewer_follows: false });
    const t1 = await caller(a).follow.toggle({ followed_id: b.id });
    expect(t1).toEqual({ following: true, followers_count: 1 });
    const c2 = await caller(a).follow.counts({ user_id: b.id });
    expect(c2.followers).toBe(1);
    expect(c2.viewer_follows).toBe(true);
    const t2 = await caller(a).follow.toggle({ followed_id: b.id });
    expect(t2.following).toBe(false);
    expect(t2.followers_count).toBe(0);
  });

  it("rejects anonymous + self-follow + missing target", async () => {
    const a = await createTestUser();
    await expect(
      caller(null).follow.toggle({ followed_id: a.id }),
    ).rejects.toThrow(TRPCError);
    await expect(
      caller(a).follow.toggle({ followed_id: a.id }),
    ).rejects.toThrow(/yourself/);
    await expect(
      caller(a).follow.toggle({ followed_id: "doesnotexist" }),
    ).rejects.toThrow(TRPCError);
  });

  it("followersOf + followingOf list the right edges", async () => {
    const a = await createTestUser();
    const b = await createTestUser();
    const c = await createTestUser();
    await caller(a).follow.toggle({ followed_id: c.id });
    await caller(b).follow.toggle({ followed_id: c.id });
    const followers = await caller(null).follow.followersOf({ user_id: c.id });
    expect(followers.length).toBe(2);
    expect(followers.map((f) => f.user_id).sort()).toEqual([a.id, b.id].sort());
    const aFollowing = await caller(null).follow.followingOf({ user_id: a.id });
    expect(aFollowing.length).toBe(1);
    expect(aFollowing[0]?.user_id).toBe(c.id);
  });
});
