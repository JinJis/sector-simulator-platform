/**
 * Vision fixtures registry. M37 uses these to render the hero pages
 * before M38 seeds real capability data. The shape mirrors the tRPC
 * `vision.getOverview` response so swapping to live data in M38c is
 * a pure import-source change.
 */

import type { VisionOverview } from "@/lib/vision-client";

import {
  memorySemiFixture,
  memorySemiTrajectory,
} from "./memory-semi";
import {
  sofcFixture,
  sofcTrajectory,
} from "./sofc";
import {
  spaceDataCenterFixture,
  spaceDataCenterTrajectory,
} from "./space-data-center";

export interface VisionFixture {
  overview: VisionOverview;
  trajectory: Array<{
    /** ISO datetime string (matches the wire format of `feasibility.history`). */
    as_of: string;
    composite: number;
    p10: number;
    p90: number;
  }>;
}

const REGISTRY: Record<string, VisionFixture> = {
  "space-data-center": {
    overview: spaceDataCenterFixture,
    trajectory: spaceDataCenterTrajectory,
  },
  "memory-semi": {
    overview: memorySemiFixture,
    trajectory: memorySemiTrajectory,
  },
  sofc: {
    overview: sofcFixture,
    trajectory: sofcTrajectory,
  },
};

export function getVisionFixture(slug: string): VisionFixture | null {
  return REGISTRY[slug] ?? null;
}

export function listVisionFixtures(): VisionFixture[] {
  return Object.values(REGISTRY);
}
