import { describe, expect, it } from "vitest";

import { computeImpactScores, type ImpactEdge } from "../src/lib/graph-impact.js";

describe("computeImpactScores", () => {
  it("returns 0 when every driver is at its default", () => {
    const edges: ImpactEdge[] = [
      { source_key: "ai_growth", target_key: "eq_a", weight: 2.0 },
      { source_key: "share", target_key: "eq_a", weight: 1.0 },
    ];
    const scores = computeImpactScores({
      driverValues: { ai_growth: 50, share: 30 },
      driverDefaults: { ai_growth: 50, share: 30 },
      edges,
    });
    expect(scores.eq_a).toBe(0);
  });

  it("scores positive when a positive-weight driver is above default", () => {
    const edges: ImpactEdge[] = [
      { source_key: "growth", target_key: "eq_a", weight: 2.0 },
    ];
    const scores = computeImpactScores({
      driverValues: { growth: 60 },
      driverDefaults: { growth: 50 },
      edges,
    });
    // raw = (60-50)/50 = 0.2; sum = 0.4; tanh(0.4) ≈ 0.3799
    expect(scores.eq_a).toBeCloseTo(100 * Math.tanh(0.4), 4);
    expect(scores.eq_a).toBeGreaterThan(0);
  });

  it("scores negative when a negative-weight driver is above default", () => {
    const edges: ImpactEdge[] = [
      { source_key: "costs", target_key: "eq_b", weight: -1.5 },
    ];
    const scores = computeImpactScores({
      driverValues: { costs: 25 },
      driverDefaults: { costs: 20 },
      edges,
    });
    expect(scores.eq_b).toBeLessThan(0);
  });

  it("saturates near ±100 for large divergences", () => {
    const edges: ImpactEdge[] = [
      { source_key: "x", target_key: "eq_a", weight: 2.0 },
    ];
    const big = computeImpactScores({
      driverValues: { x: 1000 },
      driverDefaults: { x: 10 },
      edges,
    });
    // raw = 99, sum = 198, tanh(198) ≈ 1.0 → 100
    expect(big.eq_a).toBeCloseTo(100, 6);
  });

  it("sums contributions across multiple inbound edges to one equity", () => {
    const edges: ImpactEdge[] = [
      { source_key: "a", target_key: "eq", weight: 1.0 },
      { source_key: "b", target_key: "eq", weight: 1.0 },
    ];
    const scores = computeImpactScores({
      driverValues: { a: 60, b: 70 },
      driverDefaults: { a: 50, b: 50 },
      edges,
    });
    // raw_a = 0.2, raw_b = 0.4; sum = 0.6; tanh ≈ 0.5370
    expect(scores.eq).toBeCloseTo(100 * Math.tanh(0.6), 4);
  });

  it("handles missing driver values gracefully (skips)", () => {
    const edges: ImpactEdge[] = [
      { source_key: "ghost", target_key: "eq", weight: 2.0 },
      { source_key: "real", target_key: "eq", weight: 1.0 },
    ];
    const scores = computeImpactScores({
      driverValues: { real: 60 },
      driverDefaults: { real: 50 },
      edges,
    });
    // Only real contributes: raw = 0.2, weight = 1.0, sum = 0.2
    expect(scores.eq).toBeCloseTo(100 * Math.tanh(0.2), 4);
  });

  it("handles zero-default drivers by skipping", () => {
    const edges: ImpactEdge[] = [
      { source_key: "z", target_key: "eq", weight: 2.0 },
    ];
    const scores = computeImpactScores({
      driverValues: { z: 5 },
      driverDefaults: { z: 0 },
      edges,
    });
    expect(scores.eq).toBe(0);
  });

  it("returns no entries for equities not referenced in edges", () => {
    const edges: ImpactEdge[] = [
      { source_key: "x", target_key: "eq_a", weight: 1.0 },
    ];
    const scores = computeImpactScores({
      driverValues: { x: 50 },
      driverDefaults: { x: 50 },
      edges,
    });
    expect(Object.keys(scores)).toEqual(["eq_a"]);
  });

  it("produces independent scores for multiple equities", () => {
    const edges: ImpactEdge[] = [
      { source_key: "growth", target_key: "eq_a", weight: 2.0 },
      { source_key: "growth", target_key: "eq_b", weight: -1.0 },
    ];
    const scores = computeImpactScores({
      driverValues: { growth: 60 },
      driverDefaults: { growth: 50 },
      edges,
    });
    expect(scores.eq_a).toBeGreaterThan(0);
    expect(scores.eq_b).toBeLessThan(0);
    expect(Math.sign(scores.eq_a!)).not.toBe(Math.sign(scores.eq_b!));
  });
});
