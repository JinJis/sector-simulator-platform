/**
 * Minimal placeholder fixture for the memory-semi vision until M38 seeds
 * real capability data.
 */

import type { VisionOverview } from "@/lib/vision-client";

const NOW = new Date();
const daysAgo = (n: number) =>
  new Date(NOW.getTime() - n * 24 * 60 * 60 * 1000).toISOString();

export const memorySemiFixture: VisionOverview = {
  vision: {
    slug: "memory-semi",
    name: "AI Memory Supercycle",
    description:
      "Will AI demand for HBM + DDR sustain a multi-year supercycle, and what are the binding constraints?",
    vision_question:
      "Does the AI HBM cycle hold for the next 5 years?",
    is_vision_eligible: true,
    status: "live",
    capability_count: 0,
    signal_count_30d: 0,
    risk_count: 0,
    feasibility: {
      composite: 64,
      composite_p10: 55,
      composite_p90: 73,
      binding_capability_key: null,
      eta_median_years: 4,
      eta_p10_years: 2,
      eta_p90_years: 7,
      delta_90d: 3,
      as_of: daysAgo(0),
    },
  },
  capabilities: [],
  risks: [],
  recent_signals: [],
  actors: [],
};

export const memorySemiTrajectory = (() => {
  const points: Array<{ as_of: string; composite: number; p10: number; p90: number }> = [];
  for (let d = 180; d >= 0; d -= 7) {
    const t = (180 - d) / 180;
    const composite = 58 + 6 * t + Math.sin(t * 5) * 1.5;
    const band = 6 + 3 * t;
    points.push({
      as_of: daysAgo(d),
      composite: Number(composite.toFixed(1)),
      p10: Number((composite - band).toFixed(1)),
      p90: Number((composite + band).toFixed(1)),
    });
  }
  return points;
})();
