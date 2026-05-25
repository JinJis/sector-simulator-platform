/**
 * Vision fixtures registry. M37 uses these to render the hero pages
 * before M38 seeds real capability data. The shape mirrors the tRPC
 * `vision.getOverview` response so swapping to live data in M38c is
 * a pure import-source change.
 */

import type { VisionOverview } from "@/lib/vision-client";

import {
  fusionPowerFixture,
  fusionPowerTrajectory,
} from "./fusion-power";
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

/** Compact investor-facing narrative — what's the bet, what would
 *  make us wrong, what would make us right. Lives on the vision
 *  Overview (top of fold) and is the highest-density artifact for
 *  someone deciding whether to write a check / write a grant /
 *  bet a career. Authored manually for now; a future agent slice
 *  drafts it from capability + risk + economics structure. */
export interface InvestmentThesis {
  /** One-sentence punch line — what is the bet in plain English. */
  the_bet: string;
  /** 2-4 bullets — why it works if the world cooperates. */
  bull_case: string[];
  /** 2-4 bullets — what kills it / what we're betting against. */
  bear_case: string[];
  /** Conviction level — informs the visual treatment + caveats. */
  conviction: "high" | "medium" | "low" | "exploratory";
  /** ISO date when this draft was last reviewed by a human. */
  last_reviewed: string;
}

/** Upcoming events that would move the score within ~6 months.
 *  Capability launches, regulatory decisions, actor milestones,
 *  fundraising windows. Sorted client-side by `expected_at`. */
export interface Catalyst {
  /** Stable id — slug-shaped, for keyed renders + dedup. */
  id: string;
  /** When we expect it (ISO date). Imprecise targets allowed — use
   *  the midpoint of the window and put the spread in `note`. */
  expected_at: string;
  /** Headline — what the event is, in <60 chars. */
  label: string;
  /** Which capability would shift if this lands. Slug from the
   *  Capability table; null = vision-wide impact. */
  capability_key: string | null;
  /** Which side of the thesis it pulls — green chip on bull, red
   *  on bear, neutral chip on "could go either way". */
  side: "bull" | "bear" | "neutral";
  /** Optional source link + analyst note (2-3 sentences max). */
  source_url?: string;
  note?: string;
}

export interface VisionFixture {
  overview: VisionOverview;
  trajectory: Array<{
    /** ISO datetime string (matches the wire format of `feasibility.history`). */
    as_of: string;
    composite: number;
    p10: number;
    p90: number;
  }>;
  /** Editorial thesis + catalyst track. Optional — pages render a
   *  graceful "not yet curated" placeholder when missing. */
  thesis?: InvestmentThesis;
  catalysts?: Catalyst[];
}

const SDC_THESIS: InvestmentThesis = {
  the_bet: "Launch cost collapse + rad-hard silicon cross at the same time and orbital compute becomes cheaper than terrestrial for latency-tolerant batch workloads by ~2034.",
  bull_case: [
    "Starship V3 mass-to-orbit lands in 2026-27 → $/kg drops 5–10× from F9 baseline.",
    "AMD MI300 family already in radiation qualification at Aerospace Corp — first crewed-class orbital compute pod feasible 2028-30.",
    "Hyperscaler power constraints (Texas/Virginia grid) + ML training $/kWh make orbit's free cooling structurally attractive at scale.",
  ],
  bear_case: [
    "Kessler-syndrome insurance premiums could double effective $/kg and gate commercial deployment indefinitely.",
    "ITAR + CHIPS-Act export rules concentrate the supply chain to 2-3 US primes — single-point-of-failure on AMD/Intel.",
    "Optical downlink ground-station economics are unproven at petabit/day; if AT&T/SES don't build the network, the use case stalls.",
  ],
  conviction: "medium",
  last_reviewed: "2026-05-20",
};

const SDC_CATALYSTS: Catalyst[] = [
  {
    id: "starship-v3-flight-1",
    expected_at: "2026-09-15",
    label: "Starship V3 first orbital flight",
    capability_key: "launch_economics",
    side: "bull",
    note: "Confirms whether V3 stack hits target payload; downstream $/kg curve hinges on this within a quarter.",
  },
  {
    id: "mi300-rad-tape-out",
    expected_at: "2026-11-30",
    label: "AMD MI300 rad-hardened tape-out",
    capability_key: "rad_hard_compute",
    side: "bull",
    note: "AMD has signalled Q4 — delay would push the orbital-compute thesis out by 18 months minimum.",
  },
  {
    id: "itar-rule-review",
    expected_at: "2026-12-31",
    label: "ITAR Cat XV review (US DoS)",
    capability_key: null,
    side: "neutral",
    note: "Public comment closed Apr 2026; final rule could either codify the existing carve-outs or tighten supply chain.",
  },
  {
    id: "starcloud-3kw-demo",
    expected_at: "2027-03-31",
    label: "Starcloud 3 kW in-orbit compute demo",
    capability_key: "in_orbit_thermal",
    side: "bull",
    note: "Scaling from the 2025 1 kW demo. Successful continuous operation would validate the thermal envelope.",
  },
  {
    id: "kessler-insurance-renewal",
    expected_at: "2027-01-15",
    label: "Lloyd's/AGCS LEO insurance pool renewal",
    capability_key: null,
    side: "bear",
    note: "Premium increases > 30% YoY would compress orbital compute unit economics meaningfully.",
  },
];

const FUSION_THESIS: InvestmentThesis = {
  the_bet: "At least one of (CFS SPARC | Helion Polaris | Tokamak Energy ST80) hits net electric Q>1 by 2028 and the asset class transitions from science to engineering — grid-parity pilot plant feasible by mid-2030s.",
  bull_case: [
    "HTS magnet supply (CFS, Tokamak Energy) is now a multi-billion-dollar manufacturing problem, not a physics problem.",
    "DoE FIRE program + ARPA-E milestone funding crowd in $4B+ of late-stage private capital with backstop validation.",
    "AI hyperscaler PPA appetite (Microsoft / Helion 2028) creates first credible commercial off-take before grid parity.",
  ],
  bear_case: [
    "Tritium fuel cycle is unsolved at industrial scale — breeding blanket TBR>1 is a 10-year materials science problem on its own.",
    "Permitting + grid interconnect timelines (10y+ in the US) compress real ROI even on a successful pilot.",
    "Helion's pulsed approach + tokamak path are mutually exclusive bets on physics; one wins, the other strands billions.",
  ],
  conviction: "exploratory",
  last_reviewed: "2026-05-22",
};

const FUSION_CATALYSTS: Catalyst[] = [
  {
    id: "cfs-sparc-first-plasma",
    expected_at: "2026-12-31",
    label: "CFS SPARC first plasma",
    capability_key: "magnetic_confinement",
    side: "bull",
    note: "First HTS-tokamak plasma achievement; physics validation that the SPARC point design works.",
  },
  {
    id: "helion-polaris-7th-gen",
    expected_at: "2027-06-30",
    label: "Helion Polaris 7th-gen prototype",
    capability_key: "pulsed_fusion",
    side: "bull",
    note: "Designed to demonstrate net electricity (not just net Q). Watch for actual MWh delivered figures.",
  },
  {
    id: "tokamak-energy-st80",
    expected_at: "2027-09-30",
    label: "Tokamak Energy ST80-HTS first plasma",
    capability_key: "magnetic_confinement",
    side: "neutral",
    note: "Compact spherical tokamak design — diversification bet against CFS's high-aspect-ratio approach.",
  },
  {
    id: "iter-first-plasma-delay",
    expected_at: "2027-12-31",
    label: "ITER updated first-plasma date",
    capability_key: null,
    side: "bear",
    note: "Currently slipped to 2034. Another slip would shift consensus further from public-mega-project to private-startups.",
  },
];

const REGISTRY: Record<string, VisionFixture> = {
  "space-data-center": {
    overview: spaceDataCenterFixture,
    trajectory: spaceDataCenterTrajectory,
    thesis: SDC_THESIS,
    catalysts: SDC_CATALYSTS,
  },
  "fusion-power": {
    overview: fusionPowerFixture,
    trajectory: fusionPowerTrajectory,
    thesis: FUSION_THESIS,
    catalysts: FUSION_CATALYSTS,
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
