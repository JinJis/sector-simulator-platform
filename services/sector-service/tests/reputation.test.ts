/**
 * Pure-function unit tests for M46c reputation lib.
 *
 * The DB-side `recordPointDelta` is exercised end-to-end by the
 * communityProposal.vote / proposal-applied tests + the Python
 * resolver test on its side.
 */

import { describe, expect, it } from "vitest";

import {
  tierFromPoints,
  voteWeightFromPoints,
} from "../src/lib/reputation.js";

describe("tierFromPoints", () => {
  it("maps brackets per the Community 3.0 plan", () => {
    expect(tierFromPoints(0)).toBe("newcomer");
    expect(tierFromPoints(99)).toBe("newcomer");
    expect(tierFromPoints(100)).toBe("member");
    expect(tierFromPoints(499)).toBe("member");
    expect(tierFromPoints(500)).toBe("analyst");
    expect(tierFromPoints(2_999)).toBe("analyst");
    expect(tierFromPoints(3_000)).toBe("senior");
    expect(tierFromPoints(9_999)).toBe("senior");
    expect(tierFromPoints(10_000)).toBe("maintainer");
    expect(tierFromPoints(50_000)).toBe("maintainer");
  });

  it("clamps negative points to newcomer", () => {
    expect(tierFromPoints(-50)).toBe("newcomer");
  });
});

describe("voteWeightFromPoints", () => {
  it("Newcomer votes weight 1", () => {
    expect(voteWeightFromPoints(0)).toBe(1);
    expect(voteWeightFromPoints(999)).toBe(1);
  });

  it("scales 1 + floor(rep/1000) per the plan", () => {
    expect(voteWeightFromPoints(1_000)).toBe(2);
    expect(voteWeightFromPoints(2_500)).toBe(3);
    expect(voteWeightFromPoints(4_000)).toBe(5);
  });

  it("caps at 5", () => {
    expect(voteWeightFromPoints(50_000)).toBe(5);
    expect(voteWeightFromPoints(1_000_000)).toBe(5);
  });

  it("clamps negative to weight 1", () => {
    expect(voteWeightFromPoints(-100)).toBe(1);
  });
});
