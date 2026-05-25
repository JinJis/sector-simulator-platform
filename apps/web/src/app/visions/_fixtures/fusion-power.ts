/**
 * Fallback fixture for the fusion-power vision when sector-service is
 * unreachable. Mirrors the curated seed at
 * `packages/db/prisma/seed-data/visions/fusion-power.json`.
 */

import type { VisionOverview } from "@/lib/vision-client";

const NOW = new Date();
const daysAgo = (n: number) =>
  new Date(NOW.getTime() - n * 24 * 60 * 60 * 1000).toISOString();

export const fusionPowerFixture: VisionOverview = {
  vision: {
    slug: "fusion-power",
    name: "Fusion Power (DT tokamak)",
    description:
      "DT 토카막 핵융합 발전소의 40년 LCOE / 경제성 시뮬레이션 + capability tree.",
    vision_question:
      "When will DT fusion deliver grid-parity LCOE at commercial scale?",
    is_vision_eligible: true,
    status: "live",
    capability_count: 9,
    signal_count_30d: 0,
    risk_count: 6,
    feasibility: {
      composite: 42,
      composite_p10: 34,
      composite_p90: 51,
      binding_capability_key: "tritium_breeding",
      eta_median_years: 12,
      eta_p10_years: 8,
      eta_p90_years: 22,
      delta_90d: 4,
      as_of: daysAgo(0),
    },
  },
  capabilities: [],
  risks: [],
  recent_signals: [],
  actors: [],
};

export const fusionPowerTrajectory = (() => {
  const points: Array<{ as_of: string; composite: number; p10: number; p90: number }> = [];
  for (let d = 180; d >= 0; d -= 7) {
    const t = (180 - d) / 180;
    // 38 → 42 over 6 months (delta_90d ≈ +4)
    const composite = 38 + 4 * t + Math.sin(t * 5 + 0.4) * 1.2;
    const band = 7 + 2 * t;
    points.push({
      as_of: daysAgo(d),
      composite: Number(composite.toFixed(1)),
      p10: Number((composite - band).toFixed(1)),
      p90: Number((composite + band).toFixed(1)),
    });
  }
  return points;
})();
