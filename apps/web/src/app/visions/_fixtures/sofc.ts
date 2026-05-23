/**
 * Minimal placeholder fixture for the sofc vision until M38 seeds real
 * capability data.
 */

import type { VisionOverview } from "@/lib/vision-client";

const NOW = new Date();
const daysAgo = (n: number) =>
  new Date(NOW.getTime() - n * 24 * 60 * 60 * 1000).toISOString();

export const sofcFixture: VisionOverview = {
  vision: {
    slug: "sofc",
    name: "Solid Oxide Fuel Cells at Grid Scale",
    description:
      "Distributed power generation from SOFC stacks running on natural gas / hydrogen — replacing grid-scale gas turbines.",
    vision_question: "Can SOFCs deliver grid-parity LCOE by 2035?",
    is_vision_eligible: true,
    status: "live",
    capability_count: 0,
    signal_count_30d: 0,
    risk_count: 0,
    feasibility: {
      composite: 42,
      composite_p10: 32,
      composite_p90: 52,
      binding_capability_key: null,
      eta_median_years: 12,
      eta_p10_years: 9,
      eta_p90_years: 20,
      delta_90d: 1,
      as_of: daysAgo(0),
    },
  },
  capabilities: [],
  risks: [],
  recent_signals: [],
  actors: [],
};

export const sofcTrajectory = (() => {
  const points: Array<{ as_of: string; composite: number; p10: number; p90: number }> = [];
  for (let d = 180; d >= 0; d -= 7) {
    const t = (180 - d) / 180;
    const composite = 39 + 3 * t + Math.sin(t * 4 + 1) * 1;
    const band = 8 + 2 * t;
    points.push({
      as_of: daysAgo(d),
      composite: Number(composite.toFixed(1)),
      p10: Number((composite - band).toFixed(1)),
      p90: Number((composite + band).toFixed(1)),
    });
  }
  return points;
})();
