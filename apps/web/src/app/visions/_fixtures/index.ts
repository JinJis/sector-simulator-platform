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

import type { SourceRef } from "@platform/ui";

/** One bullet of the bull/bear case. `text` is the claim; `sources` is
 *  the evidence behind it — papers, press releases, filings, news. The
 *  panel renders a `<SourceList>` chip next to the bullet when
 *  `sources` is non-empty; click → open the actual source. A bullet can
 *  also be given as a bare `string` for legacy / unsourced entries. */
export interface ThesisBullet {
  text: string;
  sources?: SourceRef[];
}

export type ThesisBulletInput = string | ThesisBullet;

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
  bull_case: ThesisBulletInput[];
  /** 2-4 bullets — what kills it / what we're betting against. */
  bear_case: ThesisBulletInput[];
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
  /** Optional richer source set — when present, the timeline renders
   *  a `<SourceList>` chip instead of the single source_url anchor. */
  sources?: SourceRef[];
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
    {
      text: "Starship V3 mass-to-orbit lands in 2026-27 → $/kg drops 5–10× from F9 baseline.",
      sources: [
        { url: "https://www.spacex.com/updates/", title: "SpaceX updates — Starship test campaign", kind: "press" },
        { url: "https://www.bloomberg.com/news/articles", title: "Bloomberg coverage on Starship cadence", kind: "news" },
      ],
    },
    {
      text: "AMD MI300 family already in radiation qualification at Aerospace Corp — first crewed-class orbital compute pod feasible 2028-30.",
      sources: [
        { url: "https://www.amd.com/en/newsroom.html", title: "AMD newsroom — MI300 family", kind: "press" },
        { url: "https://arxiv.org/abs/2310.13560", title: "SEU characterization of modern accelerators in LEO", kind: "paper" },
      ],
    },
    {
      text: "Hyperscaler power constraints (Texas/Virginia grid) + ML training $/kWh make orbit's free cooling structurally attractive at scale.",
      sources: [
        { url: "https://starcloud.com/", title: "Starcloud — orbital thermal demo", kind: "press" },
        { url: "https://www.bloomberg.com/news/articles", title: "Bloomberg — hyperscaler grid constraints", kind: "news" },
      ],
    },
  ],
  bear_case: [
    {
      text: "Kessler-syndrome insurance premiums could double effective $/kg and gate commercial deployment indefinitely.",
      sources: [
        { url: "https://www.lloyds.com/news-and-insights/news", title: "Lloyd's market bulletin on orbital concentration", kind: "analyst_report" },
        { url: "https://www.reuters.com/business/aerospace-defense/", title: "Reuters — reinsurers tighten satellite cover", kind: "news" },
      ],
    },
    {
      text: "ITAR + CHIPS-Act export rules concentrate the supply chain to 2-3 US primes — single-point-of-failure on AMD/Intel.",
      sources: [
        { url: "https://www.state.gov/bureau-of-political-military-affairs/directorate-of-defense-trade-controls-pm-ddtc/", title: "DDTC USML Cat XV guidance", kind: "gov_report" },
        { url: "https://www.bis.doc.gov/index.php", title: "BIS — Bureau of Industry & Security", kind: "filing" },
      ],
    },
    {
      text: "Optical downlink ground-station economics are unproven at petabit/day; if the network doesn't get built, the use case stalls.",
      sources: [
        { url: "https://www.fcc.gov/space", title: "FCC Space Bureau", kind: "filing" },
        { url: "https://arxiv.org/abs/2308.05847", title: "Atmospheric attenuation modelling for optical downlink at scale", kind: "paper" },
      ],
    },
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
    {
      text: "HTS magnet supply (CFS, Tokamak Energy, Faraday Factory) is now a multi-billion-dollar manufacturing problem, not a physics problem.",
      sources: [
        { url: "https://cfs.energy/news-and-media", title: "CFS news — SPARC magnet milestones", kind: "press" },
        { url: "https://www.tokamakenergy.com/", title: "Tokamak Energy — ST80-HTS programme", kind: "press" },
        { url: "https://faradayfactory.com/news/", title: "Faraday Factory — REBCO line expansion", kind: "press" },
      ],
    },
    {
      text: "DoE FIRE program + ARPA-E milestone funding crowd in $4B+ of late-stage private capital with backstop validation.",
      sources: [
        { url: "https://science.osti.gov/fes", title: "DOE FES — Milestone-Based Fusion Development Program", kind: "gov_report" },
        { url: "https://www.energy.gov/", title: "U.S. Department of Energy", kind: "gov_report" },
      ],
    },
    {
      text: "AI hyperscaler PPA appetite (Microsoft / Helion 2028) creates first credible commercial off-take before grid parity.",
      sources: [
        { url: "https://www.helionenergy.com/articles/", title: "Helion Energy — articles & milestones", kind: "press" },
        { url: "https://news.microsoft.com/", title: "Microsoft press — Helion PPA", kind: "press" },
      ],
    },
  ],
  bear_case: [
    {
      text: "Tritium fuel cycle is unsolved at industrial scale — breeding blanket TBR>1 is a 10-year materials science problem on its own.",
      sources: [
        { url: "https://www.iaea.org/topics/fusion-power", title: "IAEA — fusion power topic", kind: "analyst_report" },
        { url: "https://www.gov.uk/government/organisations/uk-atomic-energy-authority", title: "UKAEA — H3AT tritium handling", kind: "gov_report" },
        { url: "https://www.reuters.com/business/energy/", title: "Reuters — global tritium inventory tightens", kind: "news" },
      ],
    },
    {
      text: "Permitting + grid interconnect timelines (10y+ in the US) compress real ROI even on a successful pilot.",
      sources: [
        { url: "https://www.nrc.gov/reactors/new-reactors/advanced/fusion-energy.html", title: "NRC — fusion energy regulation", kind: "filing" },
        { url: "https://www.ferc.gov/news-events/news/news-releases", title: "FERC interconnection-queue reform releases", kind: "gov_report" },
      ],
    },
    {
      text: "Helion's pulsed approach and tokamak path are mutually exclusive bets on physics; one wins, the other strands billions.",
      sources: [
        { url: "https://arxiv.org/list/physics.plasm-ph/recent", title: "arXiv plasma-physics — recent", kind: "paper" },
        { url: "https://www.iter.org/news", title: "ITER news — central solenoid + plasma timeline", kind: "press" },
      ],
    },
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

const MEMORY_THESIS: InvestmentThesis = {
  the_bet: "AI training demand keeps HBM pricing power durable through the next cycle; Korean duopoly extends rather than compresses, and memory makers earn through-cycle FCF margins that re-rate the sector.",
  bull_case: [
    {
      text: "HBM bit shipments revise up every quarter; multi-vendor qualification keeps memory makers in the driver's seat on pricing.",
      sources: [
        { url: "https://www.trendforce.com/news", title: "TrendForce — HBM forecast revisions", kind: "analyst_report" },
        { url: "https://nvidianews.nvidia.com/", title: "NVIDIA — multi-vendor HBM4 qualification", kind: "press" },
      ],
    },
    {
      text: "Capex-per-bit hits multi-year low across the top three suppliers — through-cycle FCF generation upside materializes.",
      sources: [
        { url: "https://www.semiconductors.org/news/", title: "SIA — monthly billings data", kind: "analyst_report" },
        { url: "https://investors.micron.com/news-releases", title: "Micron — capex mix shift to HBM", kind: "press" },
      ],
    },
    {
      text: "Memory-bound model architectures keep winning benchmarks → HBM demand thesis durable beyond the current cycle.",
      sources: [
        { url: "https://arxiv.org/list/cs.LG/recent", title: "arXiv ML — recent benchmark architectures", kind: "paper" },
      ],
    },
  ],
  bear_case: [
    {
      text: "Hyperscaler earnings commentary introduces real caution on 2027 capex — first credible downside scenario in two years.",
      sources: [
        { url: "https://www.bloomberg.com/news/articles", title: "Bloomberg — hyperscaler capex commentary", kind: "news" },
      ],
    },
    {
      text: "US export controls tighten on HBM to Chinese AI customers — segment of demand structurally walled off through the decade.",
      sources: [
        { url: "https://www.bis.doc.gov/index.php", title: "BIS — HBM export-license guidance", kind: "filing" },
        { url: "https://www.reuters.com/technology/", title: "Reuters — China domestic memory subsidy expansion", kind: "news" },
      ],
    },
    {
      text: "Korea single-country supply concentration — one strike / earthquake / regulatory shift swings the global cycle.",
      sources: [
        { url: "https://english.motie.go.kr/en/main/main.do", title: "Korea MOTIE — strategic technology designation", kind: "gov_report" },
        { url: "https://www.reuters.com/technology/", title: "Reuters — Korean logistics disruption", kind: "news" },
      ],
    },
  ],
  conviction: "high",
  last_reviewed: "2026-05-24",
};

const MEMORY_CATALYSTS: Catalyst[] = [
  {
    id: "hbm4-mass-prod",
    expected_at: "2026-09-30",
    label: "HBM4 mass-production qualification",
    capability_key: "hbm_yield_curve",
    side: "bull",
    note: "First customer-shipping HBM4 stacks. Yield curve at 12-Hi sets per-bit cost ceiling for next two years.",
    sources: [
      { url: "https://news.skhynix.com/", title: "SK hynix — HBM3E 12-Hi yield update", kind: "press" },
      { url: "https://news.samsung.com/global/category/business", title: "Samsung — HBM3E qualification", kind: "press" },
    ],
  },
  {
    id: "ddr5-pricing-jul-q",
    expected_at: "2026-10-15",
    label: "Q4 server DDR5 contract pricing fix",
    capability_key: "ddr_pricing_power",
    side: "bull",
    note: "Sequential pricing direction in Q4 is the cleanest read on whether the cycle has peaked.",
    sources: [
      { url: "https://www.trendforce.com/news", title: "TrendForce — server DDR5 contract pricing", kind: "analyst_report" },
    ],
  },
  {
    id: "bis-hbm-license-window",
    expected_at: "2026-11-30",
    label: "BIS HBM export-license window closes",
    capability_key: "korea_supply_concentration",
    side: "bear",
    note: "Comment-period close on the next round of HBM export-license rules; rule scope determines China-side TAM through 2028.",
    sources: [
      { url: "https://www.bis.doc.gov/index.php", title: "BIS rule docket", kind: "filing" },
    ],
  },
  {
    id: "hyperscaler-capex-2027",
    expected_at: "2027-02-15",
    label: "Hyperscaler 2027 capex guidance",
    capability_key: "ai_hbm_demand_durability",
    side: "neutral",
    note: "Big-three earnings calls in Jan-Feb 2027 — the cleanest demand signal for the HBM cycle.",
    sources: [
      { url: "https://www.bloomberg.com/news/articles", title: "Bloomberg — hyperscaler earnings", kind: "news" },
    ],
  },
];

const SOFC_THESIS: InvestmentThesis = {
  the_bet: "Behind-the-meter SOFC reaches cost parity with on-grid baseload at AI data-center sites by 2028 — hyperscaler offtake anchors the first commercial-scale wave and stack-cost curves compound from there.",
  bull_case: [
    {
      text: "Hyperscaler offtake deals anchor first commercial-scale SOFC deployments at AI-cluster sites.",
      sources: [
        { url: "https://www.bloomberg.com/news/articles", title: "Bloomberg — data-center SOFC offtake", kind: "news" },
        { url: "https://www.bloomenergy.com/news/", title: "Bloom Energy — 2026 deployment guidance", kind: "press" },
      ],
    },
    {
      text: "System cost curve crosses gas-CHP parity under specific use cases — commercial inflection nearer than consensus.",
      sources: [
        { url: "https://www.iea.org/topics/hydrogen", title: "IEA — SOFC system cost analysis", kind: "analyst_report" },
        { url: "https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&company=bloom+energy", title: "Bloom Energy 10-Q — segment cost trend", kind: "filing" },
      ],
    },
    {
      text: "FERC interconnection-queue reform shortens behind-the-meter SOFC timelines materially — LCOE accretion under conservative assumptions.",
      sources: [
        { url: "https://www.ferc.gov/news-events/news/news-releases", title: "FERC — interconnection-queue reform order", kind: "gov_report" },
      ],
    },
  ],
  bear_case: [
    {
      text: "EU H2 backbone milestone slips by 6 months — SOFC fuel-source thesis shifts later in the decade; near-term economics anchored to natural gas.",
      sources: [
        { url: "https://energy.ec.europa.eu/topics/energy-systems-integration/hydrogen_en", title: "EU H2 backbone — milestone update", kind: "gov_report" },
      ],
    },
    {
      text: "Long-duration stack degradation past 40,000 hours remains the empirical question that determines whether LCOE math survives field reality.",
      sources: [
        { url: "https://arxiv.org/list/physics.app-ph/recent", title: "arXiv — stack-degradation survey", kind: "paper" },
        { url: "https://www.fuelcellsworks.com/", title: "FuelCellsWorks — independent test-rig data", kind: "press" },
      ],
    },
    {
      text: "Natural-gas + carbon-pricing combinatorics could flip the LCOE under aggressive emissions regimes — long-tail policy risk.",
      sources: [
        { url: "https://www.epa.gov/climate-change", title: "EPA — power-sector emissions reporting update", kind: "gov_report" },
      ],
    },
  ],
  conviction: "medium",
  last_reviewed: "2026-05-23",
};

const SOFC_CATALYSTS: Catalyst[] = [
  {
    id: "bloom-fremont-comm",
    expected_at: "2026-08-31",
    label: "Bloom Energy Fremont expansion commissioning",
    capability_key: "manufacturing_capacity",
    side: "bull",
    note: "Gigawatt-class runrate addition; supports next-quarter delivery commitments to hyperscaler customers.",
    sources: [
      { url: "https://www.bloomenergy.com/news/", title: "Bloom Energy — Fremont commissioning", kind: "press" },
    ],
  },
  {
    id: "doe-h2hubs-tranche",
    expected_at: "2026-10-31",
    label: "DOE H2Hubs SOFC tranche disbursement",
    capability_key: "system_cost_curve",
    side: "bull",
    note: "Balance-of-plant standardization spend hits next milestone — direct cost-down lever for SOFC OEMs.",
    sources: [
      { url: "https://www.energy.gov/eere/fuelcells", title: "DOE H2Hubs program update", kind: "gov_report" },
    ],
  },
  {
    id: "ferc-queue-effective",
    expected_at: "2027-01-31",
    label: "FERC interconnection-queue rule effective date",
    capability_key: "permitting_interconnection",
    side: "bull",
    note: "First reform-era interconnection requests cleared — empirical test of how much queue duration actually compresses.",
    sources: [
      { url: "https://www.ferc.gov/news-events/news/news-releases", title: "FERC — interconnection-queue reform order", kind: "gov_report" },
    ],
  },
  {
    id: "50khr-degradation-data",
    expected_at: "2027-04-30",
    label: "First 50,000-hour stack-degradation field readout",
    capability_key: "stack_durability",
    side: "neutral",
    note: "Empirical confirmation (or denial) of accelerated-aging curves — determines whether warranty-extension trend continues.",
    sources: [
      { url: "https://www.fuelcellsworks.com/", title: "FuelCellsWorks — 50,000-hour milestone", kind: "press" },
    ],
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
    thesis: MEMORY_THESIS,
    catalysts: MEMORY_CATALYSTS,
  },
  sofc: {
    overview: sofcFixture,
    trajectory: sofcTrajectory,
    thesis: SOFC_THESIS,
    catalysts: SOFC_CATALYSTS,
  },
};

export function getVisionFixture(slug: string): VisionFixture | null {
  return REGISTRY[slug] ?? null;
}

export function listVisionFixtures(): VisionFixture[] {
  return Object.values(REGISTRY);
}
