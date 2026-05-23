/**
 * Hardcoded showcase fixture for the Space Data Center vision. Drives
 * the M37 hero page until M38c swaps in the real `vision.getOverview`
 * tRPC call.
 *
 * Numbers were curated from public information as of 2026-05:
 *   - $/kg-to-LEO trend (SpaceX manifests, Starship V3 ETA)
 *   - rad-hard compute (AMD MI300 rad qualification status, NASA
 *     Pegasus reports)
 *   - in-orbit thermal (Starcloud 1kW demo 2025, ESA radiator papers)
 *   - downlink optical comms (ESA/JAXA milestones, Mynaric ground stns)
 *   - ITAR / Kessler / spectrum context per published policy briefs
 *
 * These are CURATED for demo polish, not authoritative. The Vision
 * Builder agent (M41) will produce comparable structure for new
 * visions from public sources with proper provenance.
 */

import type { VisionOverview } from "@/lib/vision-client";

const NOW = new Date();
// tRPC infers z.date() outputs as ISO strings on the client side
// (no transformer is configured — see sim-client.ts). Fixtures emit
// strings so they line up with the live `vision.getOverview` response
// shape and the M38c swap-over is a pure import-source change.
const daysAgo = (n: number) =>
  new Date(NOW.getTime() - n * 24 * 60 * 60 * 1000).toISOString();

export const spaceDataCenterFixture: VisionOverview = {
  vision: {
    slug: "space-data-center",
    name: "Space Data Centers",
    description:
      "Orbital compute infrastructure: data centers operating in LEO/MEO with launch-amortized capex, radiative thermal management, and optical downlink to ground.",
    vision_question:
      "By when will compute in orbit be commercially viable?",
    is_vision_eligible: true,
    status: "live",
    capability_count: 9,
    signal_count_30d: 142,
    risk_count: 5,
    feasibility: {
      composite: 73,
      composite_p10: 67,
      composite_p90: 79,
      binding_capability_key: "rad_hard_compute",
      eta_median_years: 8,
      eta_p10_years: 5,
      eta_p90_years: 14,
      delta_90d: 8,
      as_of: daysAgo(0),
    },
  },
  capabilities: [
    {
      id: "fx_rad_hard_compute",
      key: "rad_hard_compute",
      name: "Radiation-hard compute",
      short_name: "Rad-hard compute",
      description:
        "GPUs/accelerators that survive LEO TID + SEU flux at sustained performance.",
      rationale:
        "Without radiation tolerance, orbital DCs face unacceptable error rates and lifetime. Currently the binding constraint on the vision — TRL 6 demonstration pending.",
      display_order: 10,
      weight: 0.2,
      primary_driver_name: "chip_tops_per_watt",
      is_binding: true,
      current_score: {
        technical: 56,
        economic: 30,
        regulatory: 48,
        supply: 38,
        composite: 51,
        composite_p10: 44,
        composite_p90: 58,
        as_of: daysAgo(2),
        rationale:
          "AMD MI300 rad-test campaign postponed to Q4 — slips both technical and supply scores.",
      },
      latest_signal: {
        id: "fx_sig_amd_postpone",
        title: "Reuters: AMD postpones MI300 radiation-qualification campaign to Q4",
        source_kind: "news",
        source_url: "https://example.com/news/amd-mi300-radtest-q4",
        published_at: daysAgo(2),
        delta_composite: -2,
      },
    },
    {
      id: "fx_assembly",
      key: "in_orbit_assembly",
      name: "In-orbit DC assembly",
      short_name: "In-orbit assembly",
      description:
        "Robotic / human assembly of modular DC racks in orbit beyond single-launch envelope.",
      rationale:
        "Single launches cap DC scale at ~5 MW. Beyond that, in-orbit assembly is required.",
      display_order: 20,
      weight: 0.12,
      primary_driver_name: null,
      is_binding: false,
      current_score: {
        technical: 38,
        economic: 25,
        regulatory: 70,
        supply: 52,
        composite: 45,
        composite_p10: 38,
        composite_p90: 52,
        as_of: daysAgo(7),
        rationale: "TRL 4. NASA OSAM-1 mission delays; commercial alternatives early-stage.",
      },
      latest_signal: {
        id: "fx_sig_osam",
        title: "NASA OSAM-1 servicing demonstrator delayed to 2027",
        source_kind: "news",
        source_url: "https://example.com/news/osam-1-delay",
        published_at: daysAgo(11),
        delta_composite: -1,
      },
    },
    {
      id: "fx_insurance",
      key: "insurance_availability",
      name: "Insurance availability",
      short_name: "Insurance",
      description:
        "Commercial space insurance underwriters willing to write > $2B/yr per orbital asset.",
      rationale:
        "Capital deployment at orbital-DC scale (>$5B/asset) requires insurance market depth that doesn't yet exist.",
      display_order: 30,
      weight: 0.08,
      primary_driver_name: null,
      is_binding: false,
      current_score: {
        technical: 60,
        economic: 35,
        regulatory: 65,
        supply: 50,
        composite: 52,
        composite_p10: 44,
        composite_p90: 60,
        as_of: daysAgo(14),
        rationale: "Lloyd's reports cap at $2B/yr per orbital line; 2 carriers active.",
      },
      latest_signal: {
        id: "fx_sig_lloyds",
        title: "Lloyd's market report flags constrained orbital underwriting capacity",
        source_kind: "gov_report",
        source_url: "https://example.com/lloyds/orbital-2026",
        published_at: daysAgo(28),
        delta_composite: 0,
      },
    },
    {
      id: "fx_reliability",
      key: "tier3_reliability",
      name: "Tier-3 reliability uptime",
      short_name: "Tier-3 uptime",
      description:
        "99.982% uptime equivalent on orbital hardware — redundancy + sparing strategy.",
      rationale:
        "Enterprise customers require ground-equivalent SLAs. Orbital constraints (limited spares, repair latency) make this nontrivial.",
      display_order: 40,
      weight: 0.1,
      primary_driver_name: null,
      is_binding: false,
      current_score: {
        technical: 62,
        economic: 55,
        regulatory: 70,
        supply: 58,
        composite: 60,
        composite_p10: 54,
        composite_p90: 66,
        as_of: daysAgo(20),
        rationale: "Architectural studies converging on N+2 + cold-spare orbit strategy.",
      },
      latest_signal: null,
    },
    {
      id: "fx_thermal",
      key: "thermal_rejection",
      name: "In-orbit thermal rejection",
      short_name: "Thermal rejection",
      description:
        "Heat rejection in vacuum — radiator panels, working-fluid loops at MW scale.",
      rationale:
        "All electrical input becomes heat; without effective radiative rejection the DC overheats within minutes.",
      display_order: 50,
      weight: 0.13,
      primary_driver_name: "thermal_loop_efficiency",
      is_binding: false,
      current_score: {
        technical: 70,
        economic: 62,
        regulatory: 82,
        supply: 64,
        composite: 68,
        composite_p10: 62,
        composite_p90: 74,
        as_of: daysAgo(3),
        rationale: "Starcloud 1kW demo on track; scale-up to 100kW being studied.",
      },
      latest_signal: {
        id: "fx_sig_starcloud",
        title: "Starcloud completes 1kW heat-rejection demo in LEO",
        source_kind: "news",
        source_url: "https://example.com/starcloud-1kw",
        published_at: daysAgo(5),
        delta_composite: 1,
      },
    },
    {
      id: "fx_power",
      key: "in_orbit_power",
      name: "In-orbit power generation",
      short_name: "Power generation",
      description:
        "Solar arrays + battery packs sized for MW continuous DC operation through eclipse seasons.",
      rationale:
        "Mature technology; scale to MW class is engineering, not invention.",
      display_order: 60,
      weight: 0.1,
      primary_driver_name: "panel_efficiency_w_per_kg",
      is_binding: false,
      current_score: {
        technical: 75,
        economic: 68,
        regulatory: 88,
        supply: 70,
        composite: 72,
        composite_p10: 66,
        composite_p90: 78,
        as_of: daysAgo(4),
        rationale: "Solar perovskite W/kg gains shipping in 2026 production runs.",
      },
      latest_signal: null,
    },
    {
      id: "fx_downlink",
      key: "downlink_bandwidth",
      name: "Downlink bandwidth",
      short_name: "Downlink",
      description:
        "Optical comms uplink/downlink at Tbps scale + ground station network.",
      rationale:
        "Determines viable workloads: training is bandwidth-bound; inference can tolerate higher latency.",
      display_order: 70,
      weight: 0.1,
      primary_driver_name: null,
      is_binding: false,
      current_score: {
        technical: 80,
        economic: 76,
        regulatory: 84,
        supply: 72,
        composite: 79,
        composite_p10: 73,
        composite_p90: 84,
        as_of: daysAgo(6),
        rationale: "Mynaric optical terminals shipping; ESA optical comms milestone.",
      },
      latest_signal: {
        id: "fx_sig_esa_optical",
        title: 'arXiv: "Ka-band 100Gbps optical downlink demonstration over 1200km"',
        source_kind: "paper",
        source_url: "https://arxiv.org/abs/2401.00001",
        published_at: daysAgo(8),
        delta_composite: 0,
      },
    },
    {
      id: "fx_spectrum",
      key: "spectrum_allocation",
      name: "Spectrum allocation",
      short_name: "Spectrum",
      description:
        "ITU coordination + national allocation for Ka/Q-band orbital DC links.",
      rationale:
        "Ka/Q-band cleared 2024; minor coordination remaining for some constellations.",
      display_order: 80,
      weight: 0.07,
      primary_driver_name: null,
      is_binding: false,
      current_score: {
        technical: 90,
        economic: 80,
        regulatory: 88,
        supply: 85,
        composite: 85,
        composite_p10: 80,
        composite_p90: 90,
        as_of: daysAgo(30),
        rationale: "ITU process largely resolved; remaining is per-orbit coordination.",
      },
      latest_signal: null,
    },
    {
      id: "fx_launch",
      key: "launch_economics",
      name: "Launch economics",
      short_name: "Launch econ",
      description:
        "$/kg to LEO trending down via Starship class reusables; sets the floor for orbital DC capex.",
      rationale:
        "Single largest cost lever. Each 50% drop in $/kg roughly doubles addressable workload.",
      display_order: 90,
      weight: 0.1,
      primary_driver_name: "launch_cost_usd_per_kg",
      is_binding: false,
      current_score: {
        technical: 88,
        economic: 78,
        regulatory: 80,
        supply: 82,
        composite: 82,
        composite_p10: 76,
        composite_p90: 88,
        as_of: daysAgo(1),
        rationale: "Starship V3 first burn validates -22%/y trend; Falcon 9 backlog clearing.",
      },
      latest_signal: {
        id: "fx_sig_lonestar",
        title: "Lonestar Data closes $48M Series B for orbital DC payloads",
        source_kind: "news",
        source_url: "https://example.com/lonestar-series-b",
        published_at: daysAgo(1),
        delta_composite: 2,
      },
    },
  ],
  risks: [
    {
      id: "fx_risk_itar",
      key: "itar_ear",
      category: "legal",
      name: "ITAR / EAR export control",
      description:
        "US export controls block optics + rad-hard chips to KR/CN suppliers; risk to supply chain depth.",
      severity: "high",
      likelihood: "medium",
      time_horizon: "3y",
      mitigations:
        "Dual-source non-US optics; license-exempt chip variants; political engagement.",
      affected_capability_keys: ["rad_hard_compute", "downlink_bandwidth"],
      display_order: 10,
    },
    {
      id: "fx_risk_kessler",
      key: "kessler_scenario",
      category: "safety",
      name: "Orbital debris (Kessler)",
      description:
        "Cascade collisions in target orbit could render shells uninsurable / unusable.",
      severity: "medium",
      likelihood: "medium",
      time_horizon: "5y",
      mitigations: "Active debris monitoring + deorbit reserves required by insurers.",
      affected_capability_keys: ["insurance_availability"],
      display_order: 20,
    },
    {
      id: "fx_risk_insurance",
      key: "insurance_thinness",
      category: "financial",
      name: "Insurance market thinness",
      description:
        "No commercial carrier writing > $2B/y per orbital asset — caps project size.",
      severity: "medium",
      likelihood: "high",
      time_horizon: "1y",
      mitigations: "Sovereign backstop programs; coinsurance pools across primes.",
      affected_capability_keys: ["insurance_availability"],
      display_order: 30,
    },
    {
      id: "fx_risk_spectrum",
      key: "itu_coordination",
      category: "legal",
      name: "Spectrum / ITU coordination",
      description: "Ka/Q-band cleared 2024; tail coordination items remain per constellation.",
      severity: "low",
      likelihood: "low",
      time_horizon: "1y",
      mitigations: "Standard ITU process.",
      affected_capability_keys: ["spectrum_allocation"],
      display_order: 40,
    },
    {
      id: "fx_risk_chips",
      key: "chips_act_flux",
      category: "political",
      name: "CHIPS Act amendment in flux",
      description:
        "Proposed orbital-DC tax credit could shift capex economics ±30%; outcome uncertain.",
      severity: "medium",
      likelihood: "high",
      time_horizon: "1y",
      mitigations: "Diversify across jurisdictions; lobby for technology-neutral language.",
      affected_capability_keys: ["launch_economics", "rad_hard_compute"],
      display_order: 50,
    },
  ],
  recent_signals: [
    {
      id: "fx_sig_lonestar",
      title: "Lonestar Data closes $48M Series B for orbital DC payloads",
      summary:
        "Series B led by Type One Ventures. Funds 2027 orbital DC tech demo + ground network.",
      source_kind: "news",
      source_url: "https://example.com/lonestar-series-b",
      published_at: daysAgo(1),
      capability_id: "fx_launch",
      capability_key: "launch_economics",
      delta_technical: null,
      delta_economic: 2,
      delta_regulatory: null,
      delta_supply: 1,
      is_highlight: true,
    },
    {
      id: "fx_sig_amd_postpone",
      title: "Reuters: AMD postpones MI300 radiation-qualification campaign to Q4",
      summary:
        "Rad-test campaign at NASA Pegasus facility slipped from Q2 to Q4 2026 — bottleneck widens.",
      source_kind: "news",
      source_url: "https://example.com/news/amd-mi300-radtest-q4",
      published_at: daysAgo(2),
      capability_id: "fx_rad_hard_compute",
      capability_key: "rad_hard_compute",
      delta_technical: -2,
      delta_economic: null,
      delta_regulatory: null,
      delta_supply: -1,
      is_highlight: true,
    },
    {
      id: "fx_sig_starcloud",
      title: "Starcloud completes 1kW heat-rejection demo in LEO",
      summary:
        "First-stage radiator demo on a Starlink-class platform. Scaling path to 100kW under study.",
      source_kind: "news",
      source_url: "https://example.com/starcloud-1kw",
      published_at: daysAgo(5),
      capability_id: "fx_thermal",
      capability_key: "thermal_rejection",
      delta_technical: 1,
      delta_economic: null,
      delta_regulatory: null,
      delta_supply: null,
      is_highlight: true,
    },
    {
      id: "fx_sig_esa_optical",
      title: 'arXiv: "Ka-band 100Gbps optical downlink demonstration over 1200km"',
      summary:
        "ESA + ETH Zurich; theoretical lower bound on BER at 100Gbps over typical haze conditions.",
      source_kind: "paper",
      source_url: "https://arxiv.org/abs/2401.00001",
      published_at: daysAgo(8),
      capability_id: "fx_downlink",
      capability_key: "downlink_bandwidth",
      delta_technical: 0,
      delta_economic: null,
      delta_regulatory: null,
      delta_supply: null,
      is_highlight: false,
    },
    {
      id: "fx_sig_chips_amendment",
      title: "CHIPS Act amendment proposes orbital-DC tax credit",
      summary:
        "Bipartisan bill: 25% ITC for orbital compute infrastructure. Senate Finance hearing scheduled.",
      source_kind: "gov_report",
      source_url: "https://example.com/chips-act-orbital-itc",
      published_at: daysAgo(9),
      capability_id: "fx_launch",
      capability_key: "launch_economics",
      delta_technical: null,
      delta_economic: 3,
      delta_regulatory: 2,
      delta_supply: null,
      is_highlight: true,
    },
    {
      id: "fx_sig_osam",
      title: "NASA OSAM-1 servicing demonstrator delayed to 2027",
      summary:
        "Spacecraft assembly + servicing demonstrator slipped one year; commercial alternatives early.",
      source_kind: "news",
      source_url: "https://example.com/news/osam-1-delay",
      published_at: daysAgo(11),
      capability_id: "fx_assembly",
      capability_key: "in_orbit_assembly",
      delta_technical: -1,
      delta_economic: null,
      delta_regulatory: null,
      delta_supply: null,
      is_highlight: false,
    },
    {
      id: "fx_sig_spacex_patent",
      title: "USPTO: SpaceX cooling loop assembly patent granted",
      summary:
        "Sealed two-phase loop concept for orbital heat rejection. Patent claims cover modular array.",
      source_kind: "patent",
      source_url: "https://example.com/uspto/12345678",
      published_at: daysAgo(14),
      capability_id: "fx_thermal",
      capability_key: "thermal_rejection",
      delta_technical: 1,
      delta_economic: null,
      delta_regulatory: null,
      delta_supply: null,
      is_highlight: false,
    },
    {
      id: "fx_sig_lloyds",
      title: "Lloyd's market report flags constrained orbital underwriting capacity",
      summary:
        "Annual orbital risk review: 2 active carriers, $2B/y aggregate cap, premium hardening trend.",
      source_kind: "gov_report",
      source_url: "https://example.com/lloyds/orbital-2026",
      published_at: daysAgo(28),
      capability_id: "fx_insurance",
      capability_key: "insurance_availability",
      delta_technical: null,
      delta_economic: 0,
      delta_regulatory: null,
      delta_supply: 0,
      is_highlight: false,
    },
  ],
};

/**
 * Time-series trajectory for the SDC vision feasibility — used by the
 * hero's TrajectorySparkline. Approximates a +8 (90d) climb from 65 to 73
 * with a widening confidence band.
 */
export const spaceDataCenterTrajectory = (() => {
  const points: Array<{
    as_of: string;
    composite: number;
    p10: number;
    p90: number;
  }> = [];
  for (let d = 180; d >= 0; d -= 7) {
    const t = (180 - d) / 180; // 0 → 1
    const composite = 60 + 13 * t + Math.sin(t * 9) * 1.4;
    const band = 4 + 4 * t;
    points.push({
      as_of: daysAgo(d),
      composite: Number(composite.toFixed(1)),
      p10: Number((composite - band).toFixed(1)),
      p90: Number((composite + band).toFixed(1)),
    });
  }
  return points;
})();
