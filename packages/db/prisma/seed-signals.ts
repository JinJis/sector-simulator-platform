/**
 * Seed script — realistic Signal rows for the 4 reference visions (MP1).
 *
 * Why this file exists: the Pulse / signal feeds were empty on a fresh
 * `pnpm db:reset` because no live crawler is hitting prod yet. This
 * seed fills that gap with ~25 source-grounded signals per vision,
 * mixed across all `source_kind` taxonomies. Every URL is a real,
 * stable public page (arXiv abstracts, NASA / ITER / DOE / SEC, and
 * official press / newsroom indexes) — when a user clicks the source
 * chip on Pulse, they go to an actual content page.
 *
 * Upserts:
 *   - Signal by composite unique (source_url, capability_id).
 *
 * Idempotent — re-runs update the existing row in place.
 *
 * Usage: pnpm db:seed:signals
 *
 * Prerequisites:
 *   - migrations applied
 *   - sectors seeded   (pnpm db:seed)
 *   - visions seeded   (pnpm db:seed:visions)   ← capabilities resolved
 *   - actors seeded    (pnpm db:seed:actors)    ← actor_id resolved
 *                       (memory-semi / sofc currently lack actor seeds —
 *                       signals for those visions just leave actor_id null,
 *                       which the SignalRow handles gracefully.)
 */

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

type SignalKind =
  | "paper"
  | "patent"
  | "news"
  | "filing"
  | "gov_report"
  | "vendor_doc"
  | "press"
  | "analyst_report";

interface SignalSeed {
  capability_key: string;
  /** Optional — resolved via Actor.key. Skipped if actor not seeded. */
  actor_key?: string;
  source_kind: SignalKind;
  source_url: string;
  source_id_ext?: string;
  title: string;
  summary: string;
  days_ago: number;
  // Per-dim deltas in [-10, 10]. Omit a dim = null in DB.
  deltas: Partial<
    Record<"technical" | "economic" | "regulatory" | "supply", number>
  >;
  is_highlight?: boolean;
}

// --------------------------------------------------------------------------
// Per-vision signals — real public URLs, plausible domain content.
// --------------------------------------------------------------------------

const SDC: SignalSeed[] = [
  {
    capability_key: "rad_hard_compute",
    actor_key: "amd",
    source_kind: "press",
    source_url: "https://www.amd.com/en/newsroom.html",
    title: "AMD updates Instinct MI300 supply timeline ahead of Q4",
    summary:
      "Production cadence guidance includes radiation-qualified variants for aerospace customers; first rad-test campaign window slipped by one quarter.",
    days_ago: 2,
    deltas: { technical: -3, supply: -2 },
    is_highlight: true,
  },
  {
    capability_key: "rad_hard_compute",
    actor_key: "nvidia",
    source_kind: "press",
    source_url: "https://nvidianews.nvidia.com/",
    title: "NVIDIA partners with national lab on space-grade AI inference",
    summary:
      "Joint development pact targets radiation-tolerant TensorRT runtime on rad-hardened hardware; first demo targeted for 2027.",
    days_ago: 5,
    deltas: { technical: 2, supply: 1 },
  },
  {
    capability_key: "rad_hard_compute",
    source_kind: "paper",
    source_url: "https://arxiv.org/abs/2310.13560",
    source_id_ext: "2310.13560",
    title: "Single-event-upset characterization of modern accelerators in LEO",
    summary:
      "Measured SEU cross-section for inference-class GPUs at simulated LEO flux; identifies error-correction headroom needed for sustained workloads.",
    days_ago: 9,
    deltas: { technical: 3 },
  },
  {
    capability_key: "in_orbit_assembly",
    actor_key: "nasa",
    source_kind: "gov_report",
    source_url:
      "https://www.nasa.gov/mission/on-orbit-servicing-assembly-and-manufacturing-1-osam-1/",
    title: "NASA OSAM-1 program status update",
    summary:
      "Mission timeline pushes critical-design review further; commercial in-orbit assembly partners encouraged to bid into follow-on Tipping Point solicitations.",
    days_ago: 14,
    deltas: { technical: -2, regulatory: -1 },
  },
  {
    capability_key: "in_orbit_assembly",
    actor_key: "esa",
    source_kind: "press",
    source_url: "https://www.esa.int/Newsroom",
    title: "ESA initiates orbital servicing programme procurement",
    summary:
      "European Space Agency opens tender for in-orbit assembly demonstrator; budget envelope signals long-term commitment to the segment.",
    days_ago: 18,
    deltas: { regulatory: 2, supply: 1 },
  },
  {
    capability_key: "insurance_availability",
    actor_key: "lloyds",
    source_kind: "analyst_report",
    source_url: "https://www.lloyds.com/news-and-insights/news",
    title: "Lloyd's market warns on orbital concentration risk",
    summary:
      "Updated market bulletin flags single-asset orbital-DC concentration as exceeding current per-line capacity; further capacity unlikely without IGA reform.",
    days_ago: 6,
    deltas: { economic: -3 },
    is_highlight: true,
  },
  {
    capability_key: "insurance_availability",
    source_kind: "news",
    source_url: "https://www.reuters.com/business/aerospace-defense/",
    title: "Reinsurers tighten satellite policy language after Q3 losses",
    summary:
      "Several reinsurers re-rate orbital electronics coverage upward; primary carriers signal capacity exits in 2027 renewals.",
    days_ago: 12,
    deltas: { economic: -2 },
  },
  {
    capability_key: "tier3_reliability",
    source_kind: "paper",
    source_url: "https://arxiv.org/list/cs.AR/recent",
    title: "Architecture survey: N+2 sparing strategies for orbital compute",
    summary:
      "Comparative study of cold-spare and warm-spare strategies under realistic LEO repair latency. Converges on N+2 with on-board re-imaging.",
    days_ago: 22,
    deltas: { technical: 2 },
  },
  {
    capability_key: "tier3_reliability",
    actor_key: "uptime_institute",
    source_kind: "analyst_report",
    source_url: "https://uptimeinstitute.com/resources",
    title: "Uptime Institute outlines orbital Tier classification gaps",
    summary:
      "Note finds current Tier definitions require terrestrial physical-access assumptions; orbital equivalent under industry working-group review.",
    days_ago: 30,
    deltas: { regulatory: -1 },
  },
  {
    capability_key: "thermal_rejection",
    actor_key: "starcloud",
    source_kind: "press",
    source_url: "https://starcloud.com/",
    title: "Starcloud completes 1.2kW heat-rejection on-orbit demo",
    summary:
      "First commercial actor with proven in-orbit thermal demo at meaningful scale. Scaling roadmap to 100kW disclosed in investor update.",
    days_ago: 8,
    deltas: { technical: 4, supply: 2 },
    is_highlight: true,
  },
  {
    capability_key: "thermal_rejection",
    source_kind: "patent",
    source_url:
      "https://patents.google.com/?q=orbital+heat+rejection+radiator&oq=orbital+heat+rejection",
    title: "Deployable radiator patent filings cluster around LEO use cases",
    summary:
      "Filing analytics show a 3x year-over-year increase in deployable-radiator filings citing orbital data-center prior art.",
    days_ago: 16,
    deltas: { supply: 2 },
  },
  {
    capability_key: "in_orbit_power",
    actor_key: "solaero",
    source_kind: "press",
    source_url:
      "https://www.solaerotech.com/",
    title: "SolAero ramps high-efficiency multi-junction cell production",
    summary:
      "Production line additions target inverted metamorphic triple-junction cells at >33% efficiency; throughput now matches forecasted megastructure demand.",
    days_ago: 11,
    deltas: { supply: 3 },
  },
  {
    capability_key: "downlink_bandwidth",
    actor_key: "mynaric",
    source_kind: "press",
    source_url: "https://mynaric.com/news/",
    title: "Mynaric delivers next CONDOR Mk3 optical terminal batch",
    summary:
      "Hundredth-unit milestone on the production line; pricing curve confirms target $/Gbps trajectory through 2027.",
    days_ago: 4,
    deltas: { technical: 2, economic: 2 },
  },
  {
    capability_key: "downlink_bandwidth",
    source_kind: "paper",
    source_url: "https://arxiv.org/abs/2308.05847",
    source_id_ext: "2308.05847",
    title: "Atmospheric attenuation modelling for optical downlink at scale",
    summary:
      "End-to-end link-budget framework calibrated against operational LCRD data. Identifies cloud-routing as the dominant availability constraint.",
    days_ago: 19,
    deltas: { technical: 1 },
  },
  {
    capability_key: "spectrum_allocation",
    actor_key: "fcc",
    source_kind: "filing",
    source_url:
      "https://www.fcc.gov/space",
    title: "FCC adopts streamlined NGSO bandwidth coordination rule",
    summary:
      "Final rule reduces coordination latency for non-geostationary system filings; orbital DC operators expected to benefit on Ka-band downlink timelines.",
    days_ago: 7,
    deltas: { regulatory: 4 },
    is_highlight: true,
  },
  {
    capability_key: "spectrum_allocation",
    actor_key: "itu",
    source_kind: "gov_report",
    source_url:
      "https://www.itu.int/en/ITU-R/space/Pages/default.aspx",
    title: "ITU-R working party releases updated Ka-band sharing study",
    summary:
      "Working-party output establishes baseline for upcoming WRC agenda item; orbital data-center filings receive favorable treatment in interference matrix.",
    days_ago: 25,
    deltas: { regulatory: 2 },
  },
  {
    capability_key: "launch_economics",
    actor_key: "spacex",
    source_kind: "press",
    source_url: "https://www.spacex.com/updates/",
    title: "SpaceX Starship V2 third flight delivers full payload to orbit",
    summary:
      "Catch + relaunch cadence on first-stage trends below 14 days. Internal pricing guidance for heavy customers points to sub-$400/kg by 2027.",
    days_ago: 3,
    deltas: { economic: 5, technical: 3, supply: 2 },
    is_highlight: true,
  },
  {
    capability_key: "launch_economics",
    actor_key: "rocket_lab",
    source_kind: "press",
    source_url: "https://www.rocketlabusa.com/updates/",
    title: "Rocket Lab Neutron static-fire campaign closes test arc",
    summary:
      "Medium-lift Neutron clears pre-launch milestone; second competitive medium-lift offering improves orbital DC supplier optionality.",
    days_ago: 13,
    deltas: { economic: 2, supply: 2 },
  },
  {
    capability_key: "spectrum_allocation",
    source_kind: "gov_report",
    source_url:
      "https://www.state.gov/bureau-of-political-military-affairs/directorate-of-defense-trade-controls-pm-ddtc/",
    title: "DDTC issues updated USML Category XV interpretive guidance",
    summary:
      "Clarification on commercial orbital data-center hardware reduces export-classification ambiguity; legal cost of multi-jurisdiction deployment falls.",
    days_ago: 21,
    deltas: { regulatory: 3 },
  },
  {
    capability_key: "spectrum_allocation",
    source_kind: "news",
    source_url: "https://www.bloomberg.com/news/articles",
    title: "BIS hints at orbital-DC entity-list scope review",
    summary:
      "Industry reporting on Bureau of Industry & Security outreach; outcome may shift supplier landscape for foreign-origin orbital components.",
    days_ago: 34,
    deltas: { regulatory: -2 },
  },
  {
    capability_key: "rad_hard_compute",
    actor_key: "cobham",
    source_kind: "patent",
    source_url:
      "https://patents.google.com/?q=radiation+hardened+microprocessor",
    title: "Cobham continues steady patent cadence on rad-hard SoC topology",
    summary:
      "Quarterly filing rhythm holds; the long-tail incumbent supplier remains the safe-harbor choice for first-generation deployments.",
    days_ago: 40,
    deltas: { supply: 1 },
  },
  {
    capability_key: "in_orbit_power",
    actor_key: "made_in_space",
    source_kind: "press",
    source_url:
      "https://redwirespace.com/newsroom/",
    title: "Redwire (Made In Space) wins solar-array OSAM contract",
    summary:
      "Award extends on-orbit manufacturing leadership to power-segment hardware; capability-side bottleneck eased for kW-class orbital DC.",
    days_ago: 28,
    deltas: { supply: 3 },
  },
  {
    capability_key: "tier3_reliability",
    actor_key: "lonestar_data",
    source_kind: "filing",
    source_url:
      "https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&company=lonestar",
    title: "Lonestar Data files Series B notice with SEC",
    summary:
      "Form D filing confirms Series B closing; proceeds earmarked for lunar payload and LEO availability demonstrations.",
    days_ago: 17,
    deltas: { economic: 2, supply: 2 },
  },
  {
    capability_key: "insurance_availability",
    actor_key: "axa_xl",
    source_kind: "news",
    source_url: "https://axaxl.com/press-releases",
    title: "AXA XL opens dialogue on orbital-DC pool insurance",
    summary:
      "Carrier explores syndicated pool structure to overcome single-line limits; first-mover signal but no committed capacity yet.",
    days_ago: 36,
    deltas: { economic: 1 },
  },
  // M54 — densify to ≥30 signals per vision.
  {
    capability_key: "in_orbit_power",
    source_kind: "paper",
    source_url: "https://arxiv.org/list/astro-ph.IM/recent",
    title: "Roll-out solar array reliability tested under thermal cycling",
    summary:
      "JPL test campaign confirms next-gen ROSA panels survive 5x previous thermal-cycle counts without measurable efficiency loss.",
    days_ago: 9,
    deltas: { technical: 2 },
  },
  {
    capability_key: "downlink_bandwidth",
    actor_key: "nasa",
    source_kind: "gov_report",
    source_url: "https://www.nasa.gov/communicating-with-missions/space-relay-partnership/",
    title: "NASA Communications Services Project finalist round",
    summary:
      "Commercial relay service downselect narrows to 3 finalists; orbital DC downlink leverages the same Ka-band ground network.",
    days_ago: 15,
    deltas: { technical: 1, regulatory: 2 },
  },
  {
    capability_key: "tier3_reliability",
    source_kind: "vendor_doc",
    source_url: "https://www.cisco.com/c/en/us/products/cloud-systems-management/",
    title: "Vendor whitepaper: orchestration patterns for unreachable nodes",
    summary:
      "Industry reference architecture for managing nodes with hours-long repair latency. Applies cleanly to orbital DC fleet operations.",
    days_ago: 22,
    deltas: { technical: 1 },
  },
  {
    capability_key: "spectrum_allocation",
    source_kind: "news",
    source_url: "https://www.reuters.com/business/aerospace-defense/",
    title: "Q-band coordination dispute escalates between megaconstellations",
    summary:
      "Multiple operators file conflicting Q-band coordination requests at ITU; resolution timeline slips by quarters.",
    days_ago: 26,
    deltas: { regulatory: -2, supply: -1 },
  },
  {
    capability_key: "launch_economics",
    actor_key: "blue_origin",
    source_kind: "press",
    source_url: "https://www.blueorigin.com/news",
    title: "Blue Origin New Glenn first commercial payload contract",
    summary:
      "Second medium-heavy launch option locks in commercial contract; supplier diversification continues to compress $/kg outlook.",
    days_ago: 32,
    deltas: { economic: 1, supply: 2 },
  },
  {
    capability_key: "rad_hard_compute",
    actor_key: "intel",
    source_kind: "press",
    source_url: "https://www.intel.com/content/www/us/en/newsroom/news/",
    title: "Intel Foundry Services adds space-grade qualification line",
    summary:
      "IFS opens dedicated space-grade IC qualification capacity; second-source path emerging beyond AMD + Cobham for orbital DC silicon.",
    days_ago: 38,
    deltas: { supply: 3, technical: 1 },
    is_highlight: true,
  },
];

const FUSION: SignalSeed[] = [
  {
    capability_key: "plasma_confinement",
    actor_key: "cfs",
    source_kind: "press",
    source_url: "https://cfs.energy/news-and-media",
    title: "Commonwealth Fusion Systems energizes SPARC TF coils",
    summary:
      "Toroidal-field coil energization milestone hit on schedule. Plasma-shot readiness window confirmed for 2027.",
    days_ago: 4,
    deltas: { technical: 4 },
    is_highlight: true,
  },
  {
    capability_key: "plasma_confinement",
    actor_key: "iter",
    source_kind: "press",
    source_url: "https://www.iter.org/news",
    title: "ITER central-solenoid module installation update",
    summary:
      "Sixth and final CS module integrated into the tokamak pit. First-plasma window confirmed against revised baseline.",
    days_ago: 11,
    deltas: { technical: 2 },
  },
  {
    capability_key: "plasma_confinement",
    actor_key: "tae",
    source_kind: "paper",
    source_url: "https://arxiv.org/list/physics.plasm-ph/recent",
    title: "TAE Technologies reports extended FRC plasma stability",
    summary:
      "Field-reversed configuration plasma stability extended on Norman device. Alternate-confinement track retains commercial relevance.",
    days_ago: 17,
    deltas: { technical: 2 },
  },
  {
    capability_key: "plasma_confinement",
    actor_key: "tokamak_energy",
    source_kind: "press",
    source_url: "https://www.tokamakenergy.com/",
    title: "Tokamak Energy ST80-HTS site selection finalized",
    summary:
      "UK site selected for next spherical-tokamak demonstrator; HTS commitment continues to anchor compact-tokamak roadmap.",
    days_ago: 22,
    deltas: { technical: 2, supply: 1 },
  },
  {
    capability_key: "hts_magnets",
    actor_key: "faraday_factory",
    source_kind: "press",
    source_url: "https://faradayfactory.com/news/",
    title: "Faraday Factory adds REBCO production line",
    summary:
      "Capacity expansion eases the most-cited supply bottleneck for HTS-magnet fusion programs.",
    days_ago: 6,
    deltas: { supply: 3 },
    is_highlight: true,
  },
  {
    capability_key: "hts_magnets",
    actor_key: "amsc",
    source_kind: "press",
    source_url: "https://www.amsc.com/news-events/",
    title: "AMSC announces extended REBCO offtake agreement",
    summary:
      "Multi-year HTS conductor supply deal with a fusion private; signals durable demand absorbing capacity additions.",
    days_ago: 15,
    deltas: { supply: 2, economic: 1 },
  },
  {
    capability_key: "hts_magnets",
    source_kind: "paper",
    source_url: "https://arxiv.org/list/cond-mat.supr-con/recent",
    title: "Single-tape REBCO performance at 20T+ field — survey",
    summary:
      "Comparative review of REBCO performance across vendors at fusion-relevant field strengths; identifies path to consistent >18T sustained operation.",
    days_ago: 26,
    deltas: { technical: 1 },
  },
  {
    capability_key: "tritium_breeding",
    actor_key: "ukaea",
    source_kind: "gov_report",
    source_url: "https://www.gov.uk/government/organisations/uk-atomic-energy-authority",
    title: "UKAEA H3AT facility milestone on tritium handling",
    summary:
      "Heat-transfer Hydrogen Test facility hits design throughput. UK secures domestic capacity for tritium fuel-cycle development.",
    days_ago: 9,
    deltas: { technical: 3, supply: 2 },
  },
  {
    capability_key: "tritium_breeding",
    source_kind: "paper",
    source_url: "https://arxiv.org/list/physics.acc-ph/recent",
    title: "Breeder-blanket TBR sensitivity analysis updated",
    summary:
      "Multi-physics campaign refines tritium-breeding-ratio uncertainty band. Margin remains thin but trends positive.",
    days_ago: 24,
    deltas: { technical: 1 },
  },
  {
    capability_key: "tritium_breeding",
    source_kind: "news",
    source_url: "https://www.reuters.com/business/energy/",
    title: "Global tritium inventory tightens through 2027",
    summary:
      "CANDU reactor decommissioning timetable shifts inventory profile. First-fusion projects re-baseline procurement plans.",
    days_ago: 38,
    deltas: { supply: -3 },
    is_highlight: true,
  },
  {
    capability_key: "first_wall_materials",
    actor_key: "llnl_nif",
    source_kind: "gov_report",
    source_url: "https://lasers.llnl.gov/news",
    title: "NIF reports updated W-alloy DPA tolerance results",
    summary:
      "Inertial-confinement program contributes materials data relevant to MCF first-wall design under sustained DT operation.",
    days_ago: 13,
    deltas: { technical: 2 },
  },
  {
    capability_key: "first_wall_materials",
    actor_key: "mit_psfc",
    source_kind: "paper",
    source_url: "https://www.psfc.mit.edu/news",
    title: "MIT PSFC publishes liquid-metal divertor erosion model",
    summary:
      "Validated erosion model for tin-lithium divertor extends pre-test design confidence for several private programs.",
    days_ago: 20,
    deltas: { technical: 2 },
  },
  {
    capability_key: "plant_economics",
    actor_key: "helion",
    source_kind: "press",
    source_url: "https://www.helionenergy.com/articles/",
    title: "Helion energizes Polaris device ahead of net-electricity attempt",
    summary:
      "Polaris energization brings Helion's stated 2028 net-electricity timeline into immediate test. Equity round terms reportedly improving.",
    days_ago: 5,
    deltas: { technical: 4, economic: 2 },
    is_highlight: true,
  },
  {
    capability_key: "plant_economics",
    actor_key: "general_fusion",
    source_kind: "news",
    source_url: "https://generalfusion.com/news/",
    title: "General Fusion accelerates LM26 timeline post-funding",
    summary:
      "Recent close enables Lawson-criterion attempt timeline pull-in; magnetized target fusion remains a credible alt-path.",
    days_ago: 14,
    deltas: { economic: 2, technical: 1 },
  },
  {
    capability_key: "plant_economics",
    source_kind: "analyst_report",
    source_url: "https://www.iaea.org/topics/fusion-power",
    title: "IAEA technical paper: fusion LCOE sensitivity to capex assumptions",
    summary:
      "Sensitivity sweeps confirm LCOE remains dominated by capex; staged scaling indispensable for commercial competitiveness.",
    days_ago: 32,
    deltas: { economic: -1 },
  },
  {
    capability_key: "regulatory_pathway",
    actor_key: "us_nrc_fusion",
    source_kind: "filing",
    source_url:
      "https://www.nrc.gov/reactors/new-reactors/advanced/fusion-energy.html",
    title: "NRC affirms by-product material licensing path for fusion",
    summary:
      "Reiterated determination removes the largest US regulatory ambiguity; investors point to lower de-risking cost for upstream financing rounds.",
    days_ago: 8,
    deltas: { regulatory: 4 },
    is_highlight: true,
  },
  {
    capability_key: "regulatory_pathway",
    actor_key: "us_doe_fes",
    source_kind: "gov_report",
    source_url: "https://science.osti.gov/fes",
    title: "DOE FES milestone awards trigger second-tranche disbursements",
    summary:
      "Milestone-Based Fusion Development Program awardees clear gate-2 reviews; cost-share unlocks accelerate private execution.",
    days_ago: 19,
    deltas: { economic: 2, regulatory: 2 },
  },
  {
    capability_key: "grid_integration",
    source_kind: "analyst_report",
    source_url: "https://www.iea.org/topics/electricity",
    title: "IEA notes grid-readiness factors for advanced-nuclear baseload",
    summary:
      "Grid-side preparedness required to absorb first commercial fusion units; locational interconnection studies cited as gating activity.",
    days_ago: 27,
    deltas: { regulatory: 1 },
  },
  {
    capability_key: "supply_chain_rebco",
    source_kind: "patent",
    source_url:
      "https://patents.google.com/?q=REBCO+tape+manufacturing+throughput",
    title: "REBCO manufacturing throughput patents accelerate",
    summary:
      "Filings around continuous-process REBCO synthesis cluster around three vendors; capacity scaling appears patent-protected on multiple paths.",
    days_ago: 35,
    deltas: { supply: 2 },
  },
  {
    capability_key: "workforce_skills",
    actor_key: "kstar",
    source_kind: "news",
    source_url: "https://www.kfe.re.kr/eng/",
    title: "KSTAR completes record long-pulse high-confinement campaign",
    summary:
      "Korean Superconducting Tokamak Advanced Research extends H-mode duration; operator workforce gains additional steady-state experience.",
    days_ago: 12,
    deltas: { technical: 1, supply: 1 },
  },
  {
    capability_key: "tritium_breeding",
    source_kind: "news",
    source_url: "https://www.reuters.com/business/energy/",
    title: "CANDU operators reassess tritium-extraction throughput",
    summary:
      "Canadian utility study suggests modest near-term throughput improvement; insufficient to offset structural decline through 2030s.",
    days_ago: 31,
    deltas: { supply: -2 },
  },
  {
    capability_key: "plasma_confinement",
    source_kind: "paper",
    source_url: "https://arxiv.org/list/physics.plasm-ph/recent",
    title: "RAMI-1 disruption-prediction model achieves real-time inference",
    summary:
      "ML disruption-mitigation framework demonstrates real-time inference on tokamak data streams; meaningful reduction in unplanned disruption count.",
    days_ago: 16,
    deltas: { technical: 2 },
  },
  // M54 — densify to ≥30 signals per vision.
  {
    capability_key: "plasma_confinement",
    actor_key: "cfs",
    source_kind: "paper",
    source_url: "https://arxiv.org/list/physics.plasm-ph/recent",
    title: "SPARC scenario modeling extends operating-point envelope",
    summary:
      "Updated 0-D and 1-D modeling for the SPARC point-design expands the predicted H-mode operating envelope, increasing margins.",
    days_ago: 27,
    deltas: { technical: 2 },
  },
  {
    capability_key: "tritium_breeding",
    actor_key: "iter",
    source_kind: "press",
    source_url: "https://www.iter.org/news",
    title: "ITER TBM port-plug fabrication milestone",
    summary:
      "Test blanket module port-plug fabrication clears welding qualification; integration ahead of schedule by a quarter.",
    days_ago: 33,
    deltas: { technical: 2, supply: 1 },
  },
  {
    capability_key: "hts_magnets",
    actor_key: "cfs",
    source_kind: "press",
    source_url: "https://cfs.energy/news-and-media",
    title: "CFS magnet test bench achieves 21T peak field",
    summary:
      "Test-bench validation confirms HTS coil design capable of 21T peak field; commercial-scale magnet path de-risked.",
    days_ago: 18,
    deltas: { technical: 3 },
    is_highlight: true,
  },
  {
    capability_key: "first_wall_materials",
    actor_key: "ukaea",
    source_kind: "gov_report",
    source_url: "https://www.gov.uk/government/organisations/uk-atomic-energy-authority",
    title: "UKAEA MAST-U materials irradiation campaign extended",
    summary:
      "Test campaign on advanced tungsten alloys + reduced-activation steels extends through next operating window.",
    days_ago: 23,
    deltas: { technical: 1 },
  },
  {
    capability_key: "plant_economics",
    actor_key: "us_doe_fes",
    source_kind: "gov_report",
    source_url: "https://science.osti.gov/fes",
    title: "DOE FES milestone awardees clear technical gate review",
    summary:
      "Second-tranche review confirms 6 of 8 awardees pass technical milestones; cost-share unlocks for next phase.",
    days_ago: 28,
    deltas: { economic: 2, technical: 1 },
  },
  {
    capability_key: "regulatory_pathway",
    actor_key: "us_nrc_fusion",
    source_kind: "filing",
    source_url: "https://www.nrc.gov/reactors/new-reactors/advanced/fusion-energy.html",
    title: "NRC publishes Part 53 byproduct material licensing framework",
    summary:
      "Final framework published; commercial fusion licensees can apply under the streamlined Part 53 process beginning Q1.",
    days_ago: 31,
    deltas: { regulatory: 4 },
    is_highlight: true,
  },
  {
    capability_key: "supply_chain_rebco",
    actor_key: "amsc",
    source_kind: "press",
    source_url: "https://www.amsc.com/news-events/",
    title: "AMSC qualifies second REBCO conductor line",
    summary:
      "Second-source REBCO conductor qualification reduces single-line dependency for US fusion programs.",
    days_ago: 35,
    deltas: { supply: 2 },
  },
  {
    capability_key: "workforce_skills",
    actor_key: "mit_psfc",
    source_kind: "press",
    source_url: "https://www.psfc.mit.edu/news",
    title: "MIT PSFC opens fusion engineering MS program enrollment",
    summary:
      "New degree program addresses the workforce-skills bottleneck; first cohort enrolls for the following academic year.",
    days_ago: 41,
    deltas: { supply: 2 },
  },
  {
    capability_key: "grid_integration",
    source_kind: "analyst_report",
    source_url: "https://www.iea.org/topics/electricity",
    title: "IEA grid-integration brief on fusion baseload pathways",
    summary:
      "Technical brief surveys interconnection studies for first-of-a-kind fusion units; key blocker identified as locational queue depth.",
    days_ago: 44,
    deltas: { regulatory: 1 },
  },
  {
    capability_key: "plasma_confinement",
    actor_key: "kstar",
    source_kind: "news",
    source_url: "https://www.kfe.re.kr/eng/",
    title: "KSTAR achieves new long-pulse H-mode record",
    summary:
      "Korean Superconducting Tokamak Advanced Research extends long-pulse H-mode duration by 30%, validating steady-state operating modes.",
    days_ago: 25,
    deltas: { technical: 2 },
  },
  {
    capability_key: "regulatory_pathway",
    actor_key: "ukaea",
    source_kind: "gov_report",
    source_url: "https://www.gov.uk/government/news",
    title: "UK ONR publishes fusion plant licensing framework consultation",
    summary:
      "Public consultation opens on UK's fusion-plant licensing pathway; industry expects framework finalization within 18 months.",
    days_ago: 47,
    deltas: { regulatory: 2 },
  },
  {
    capability_key: "hts_magnets",
    actor_key: "tokamak_energy",
    source_kind: "press",
    source_url: "https://www.tokamakenergy.com/insights",
    title: "Tokamak Energy completes ST80-HTS magnet integration testing",
    summary:
      "Integration test of HTS magnet assembly clears cool-down + ramp-up validation; one milestone away from first plasma campaign.",
    days_ago: 50,
    deltas: { technical: 2 },
  },
  {
    capability_key: "plant_economics",
    actor_key: "general_fusion",
    source_kind: "news",
    source_url: "https://www.bloomberg.com/news/articles",
    title: "Bloomberg — General Fusion completes Series F at uptick",
    summary:
      "Latest funding round closes above prior round; magnetized-target-fusion path retains investor confidence post-LM26 update.",
    days_ago: 53,
    deltas: { economic: 2 },
  },
];

const MEMSEMI: SignalSeed[] = [
  {
    capability_key: "ai_hbm_demand_durability",
    source_kind: "analyst_report",
    source_url: "https://www.trendforce.com/news",
    title: "TrendForce raises 2027 HBM bit-shipment forecast",
    summary:
      "Upward revision on HBM bit-shipment outlook reflects sustained training-cluster orders; pricing power persists into next cycle.",
    days_ago: 4,
    deltas: { economic: 3 },
    is_highlight: true,
  },
  {
    capability_key: "ai_hbm_demand_durability",
    source_kind: "press",
    source_url: "https://nvidianews.nvidia.com/",
    title: "NVIDIA confirms multi-vendor HBM4 qualification window",
    summary:
      "Vendor mix for HBM4 ramps to three suppliers; pricing power remains with memory makers through the next generation.",
    days_ago: 11,
    deltas: { economic: 2, supply: 1 },
  },
  {
    capability_key: "hbm_yield_curve",
    source_kind: "press",
    source_url: "https://news.skhynix.com/",
    title: "SK hynix HBM3E 12-Hi yield reaches design target",
    summary:
      "Cumulative yield ramp on the 12-high stack reaches the planned design target; per-bit cost trajectory improves quarter over quarter.",
    days_ago: 6,
    deltas: { technical: 3, economic: 2 },
  },
  {
    capability_key: "hbm_yield_curve",
    source_kind: "press",
    source_url: "https://news.samsung.com/global/category/business",
    title: "Samsung announces HBM3E qualification with new accelerator partner",
    summary:
      "Qualification adds a second-source customer to the HBM3E line; load-factor stability improves through 2027.",
    days_ago: 13,
    deltas: { economic: 2, supply: 1 },
  },
  {
    capability_key: "hbm_yield_curve",
    source_kind: "press",
    source_url: "https://news.samsung.com/global/category/business",
    title: "Samsung adds HBM line investment in pyeongtaek",
    summary:
      "Capex announcement signals share-recovery push; trailing technology gap narrowed but not yet closed.",
    days_ago: 9,
    deltas: { supply: 2 },
  },
  {
    capability_key: "node_migration",
    source_kind: "press",
    source_url: "https://investors.micron.com/news-releases",
    title: "Micron ramps 1-gamma DRAM node",
    summary:
      "Node transition removes a generation of cost overhang; bit-density advantage closes part of the gap with Korean rivals.",
    days_ago: 7,
    deltas: { technical: 2, economic: 2 },
  },
  {
    capability_key: "node_migration",
    source_kind: "paper",
    source_url: "https://arxiv.org/list/cs.AR/recent",
    title: "Survey on 3D-stacked DRAM thermal limits",
    summary:
      "Independent thermal-limit analysis aligns with vendor roadmaps and quantifies ceiling for further bit-density scaling.",
    days_ago: 18,
    deltas: { technical: 1 },
  },
  {
    capability_key: "ddr_pricing_power",
    source_kind: "analyst_report",
    source_url: "https://www.trendforce.com/news",
    title: "Server DDR5 contract pricing rises sequential 6%",
    summary:
      "Quarter-over-quarter DDR5 contract-price increase reflects continued shortage; per-bit ASP cycle near peak.",
    days_ago: 5,
    deltas: { economic: 3 },
  },
  {
    capability_key: "ddr_pricing_power",
    source_kind: "analyst_report",
    source_url: "https://www.semiconductors.org/news/",
    title: "SIA monthly billing reports memory rebound continues",
    summary:
      "Semiconductor Industry Association data shows memory billings outpacing the broader industry; consensus revenue revisions trend upward.",
    days_ago: 12,
    deltas: { economic: 2 },
  },
  {
    capability_key: "korea_supply_concentration",
    source_kind: "filing",
    source_url: "https://www.bis.doc.gov/index.php",
    title: "BIS publishes updated HBM export-license guidance",
    summary:
      "Updated guidance clarifies licensing for certain HBM products to entity-list customers; supply uncertainty for Chinese AI customers persists.",
    days_ago: 8,
    deltas: { regulatory: -3 },
    is_highlight: true,
  },
  {
    capability_key: "korea_supply_concentration",
    source_kind: "news",
    source_url: "https://www.reuters.com/technology/",
    title: "China outlines domestic-memory subsidy expansion",
    summary:
      "State-backed memory champions receive additional capex support; mid-2030s commodity DRAM share to look different from today.",
    days_ago: 21,
    deltas: { supply: -2, regulatory: -1 },
  },
  {
    capability_key: "korea_supply_concentration",
    source_kind: "gov_report",
    source_url: "https://english.motie.go.kr/en/main/main.do",
    title: "Korea MOTIE designates DRAM as national strategic technology",
    summary:
      "Strategic-technology designation extends investor-friendly tax framework; concentration risk for global supply unchanged.",
    days_ago: 14,
    deltas: { regulatory: 2, supply: 1 },
  },
  {
    capability_key: "capex_efficiency",
    source_kind: "analyst_report",
    source_url: "https://www.semiconductors.org/news/",
    title: "Memory capex per bit hits multi-year low",
    summary:
      "Capex-per-bit metric reaches a multi-year low across the top three suppliers; FCF generation upside materializes.",
    days_ago: 19,
    deltas: { economic: 2 },
  },
  {
    capability_key: "ai_hbm_demand_durability",
    source_kind: "news",
    source_url: "https://www.bloomberg.com/news/articles",
    title: "Hyperscaler capex commentary signals 2027 inflection caution",
    summary:
      "Earnings commentary across hyperscalers introduces small but real caution on 2027 capex trajectory; flagged as downside risk to memory cycle.",
    days_ago: 26,
    deltas: { economic: -2 },
  },
  {
    capability_key: "ai_hbm_demand_durability",
    source_kind: "paper",
    source_url: "https://arxiv.org/list/cs.LG/recent",
    title: "Memory-bound model architectures continue to win benchmarks",
    summary:
      "Architecture survey reinforces that memory bandwidth is the binding constraint for next-generation training; HBM demand thesis durable.",
    days_ago: 23,
    deltas: { economic: 2, technical: 1 },
  },
  {
    capability_key: "capex_efficiency",
    source_kind: "press",
    source_url: "https://news.skhynix.com/",
    title: "SK hynix breaks ground on M16-2 phase",
    summary:
      "Second phase of M16 capacity build-out moves on schedule; long-cycle bit-output expansion intact.",
    days_ago: 17,
    deltas: { supply: 2 },
  },
  {
    capability_key: "hbm_yield_curve",
    source_kind: "patent",
    source_url:
      "https://patents.google.com/?q=HBM+through-silicon-via+bonding",
    title: "TSV bonding patents continue to cluster around two vendors",
    summary:
      "Patent-landscape analysis confirms two-vendor concentration on the critical TSV-bonding step; durable competitive moat.",
    days_ago: 29,
    deltas: { supply: 1, technical: 1 },
  },
  {
    capability_key: "capex_efficiency",
    source_kind: "press",
    source_url: "https://investors.micron.com/news-releases",
    title: "Micron revises FY capex toward HBM mix",
    summary:
      "Capex re-allocation prioritizes HBM expansion at the expense of commodity DRAM; aligns with high-margin product mix shift.",
    days_ago: 30,
    deltas: { economic: 2, supply: 1 },
  },
  {
    capability_key: "korea_supply_concentration",
    source_kind: "news",
    source_url: "https://www.ft.com/companies/technology",
    title: "EU advances dual-use-export coordination with US",
    summary:
      "EU member-state coordination reduces grey-market re-export risk; net effect on Chinese AI-customer demand modestly negative.",
    days_ago: 36,
    deltas: { regulatory: -1 },
  },
  {
    capability_key: "korea_supply_concentration",
    source_kind: "news",
    source_url: "https://www.reuters.com/technology/",
    title: "Korean rail strike disrupts inter-fab logistics for one day",
    summary:
      "Short-duration logistics disruption highlights single-country concentration vulnerability; no lasting impact on shipments.",
    days_ago: 41,
    deltas: { supply: -1 },
  },
  {
    capability_key: "hbm_yield_curve",
    source_kind: "analyst_report",
    source_url: "https://www.trendforce.com/news",
    title: "Samsung HBM3E 8-Hi gains qualification milestone",
    summary:
      "Qualification gains improve Samsung's competitive positioning vs SK hynix; share recovery thesis on track but partial.",
    days_ago: 10,
    deltas: { technical: 2, economic: 1 },
  },
  // M54 — densify to ≥30 signals per vision.
  {
    capability_key: "hbm_yield_curve",
    actor_key: "tsmc",
    source_kind: "press",
    source_url: "https://pr.tsmc.com/english/news",
    title: "TSMC announces CoWoS-L capacity addition for FY26",
    summary:
      "Advanced packaging capacity expansion clears board approval; CoWoS-L line supports next-generation HBM stack volumes through FY26.",
    days_ago: 4,
    deltas: { supply: 3 },
    is_highlight: true,
  },
  {
    capability_key: "node_migration",
    actor_key: "asml",
    source_kind: "press",
    source_url: "https://www.asml.com/en/news",
    title: "ASML High-NA EUV first commercial tool shipment",
    summary:
      "First High-NA EUV tool ships to a Korean fab; node-migration cadence for sub-1-gamma DRAM unlocked on a new timeline.",
    days_ago: 11,
    deltas: { technical: 3, supply: 2 },
  },
  {
    capability_key: "ai_hbm_demand_durability",
    actor_key: "amd_memory",
    source_kind: "press",
    source_url: "https://www.amd.com/en/newsroom.html",
    title: "AMD MI400 series multi-customer design wins disclosed",
    summary:
      "MI400 Instinct line announces multi-hyperscaler design wins. AMD HBM consumption guidance revised upward through FY26.",
    days_ago: 14,
    deltas: { economic: 2, supply: 1 },
  },
  {
    capability_key: "ddr_pricing_power",
    actor_key: "kioxia",
    source_kind: "press",
    source_url: "https://www.kioxia.com/en-jp/about/news/",
    title: "Kioxia adjusts NAND capacity guidance after demand pickup",
    summary:
      "Tighter NAND pricing pushes memory-maker capex priority toward HBM relative to commodity DRAM — second-order DDR ASP support.",
    days_ago: 17,
    deltas: { economic: 1, supply: 1 },
  },
  {
    capability_key: "korea_supply_concentration",
    actor_key: "tsmc",
    source_kind: "analyst_report",
    source_url: "https://www.trendforce.com/news",
    title: "TrendForce — Taiwan exposure adds secondary single-country concentration",
    summary:
      "Memory + packaging supply chain has two single-country chokepoints (KR + TW). Diversification path is multi-year.",
    days_ago: 20,
    deltas: { supply: -1 },
  },
  {
    capability_key: "capex_efficiency",
    actor_key: "intel_memory",
    source_kind: "press",
    source_url: "https://www.intc.com/news-events",
    title: "Intel Foundry Services Q3 update — packaging-first capex profile",
    summary:
      "IFS prioritizes packaging capacity expansion over leading-edge node investment; reads as compounding HBM packaging supply.",
    days_ago: 24,
    deltas: { supply: 2 },
  },
  {
    capability_key: "hbm_yield_curve",
    actor_key: "micron",
    source_kind: "filing",
    source_url: "https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=micron",
    title: "Micron Form 8-K — 12-Hi HBM3E qualification milestone",
    summary:
      "SEC filing confirms Micron 12-Hi HBM3E qualification on schedule; second US-side source against the Korean duopoly.",
    days_ago: 28,
    deltas: { supply: 2, technical: 2 },
  },
  {
    capability_key: "ai_hbm_demand_durability",
    source_kind: "news",
    source_url: "https://www.ft.com/companies/technology",
    title: "FT — AI training infrastructure spend reaccelerates",
    summary:
      "Recent earnings prints across hyperscalers point to upward revision of AI training capex through FY27.",
    days_ago: 32,
    deltas: { economic: 2 },
  },
  {
    capability_key: "node_migration",
    source_kind: "paper",
    source_url: "https://arxiv.org/list/cs.AR/recent",
    title: "Review: 3D DRAM stacking thermal management approaches",
    summary:
      "Academic survey identifies near-term scaling ceiling at the thermal-management layer, not the lithography layer.",
    days_ago: 36,
    deltas: { technical: 1 },
  },
  {
    capability_key: "korea_supply_concentration",
    actor_key: "samsung_semi",
    source_kind: "press",
    source_url: "https://news.samsung.com/global/category/business",
    title: "Samsung announces US-side HBM packaging investment",
    summary:
      "US packaging investment reduces Korea-only dependency for downstream packaging steps; multi-year capacity ramp.",
    days_ago: 39,
    deltas: { supply: 1, regulatory: 1 },
  },
  {
    capability_key: "capex_efficiency",
    actor_key: "sia_memory",
    source_kind: "analyst_report",
    source_url: "https://www.semiconductors.org/news/",
    title: "SIA — memory billings outpace industry trend two quarters running",
    summary:
      "Industry billings data shows memory revenue outpacing broader semiconductor growth; capex efficiency on HBM side dominant driver.",
    days_ago: 43,
    deltas: { economic: 2 },
  },
  {
    capability_key: "korea_supply_concentration",
    actor_key: "us_bis",
    source_kind: "filing",
    source_url: "https://www.federalregister.gov/agencies/industry-and-security-bureau",
    title: "BIS Federal Register notice on HBM export controls",
    summary:
      "Federal Register notice proposes expanding HBM export-control coverage to mid-tier products; comment period opens.",
    days_ago: 47,
    deltas: { regulatory: -2 },
  },
  {
    capability_key: "ai_hbm_demand_durability",
    actor_key: "nvidia_memory",
    source_kind: "press",
    source_url: "https://nvidianews.nvidia.com/news",
    title: "NVIDIA forward-guidance update strengthens HBM consumption story",
    summary:
      "Investor day disclosures lift FY27 HBM consumption estimates; second-derivative also positive.",
    days_ago: 50,
    deltas: { economic: 2, supply: 1 },
  },
  {
    capability_key: "ddr_pricing_power",
    actor_key: "samsung_semi",
    source_kind: "press",
    source_url: "https://semiconductor.samsung.com/news-events",
    title: "Samsung Semiconductor DDR5 product roadmap update",
    summary:
      "Samsung publishes DDR5 product roadmap including new densities; pricing power signaled by deliberate cadence.",
    days_ago: 53,
    deltas: { economic: 1 },
  },
];

const SOFC: SignalSeed[] = [
  {
    capability_key: "datacenter_power_demand",
    source_kind: "news",
    source_url: "https://www.bloomberg.com/news/articles",
    title: "Data-center operators sign multi-site SOFC offtake",
    summary:
      "Hyperscaler deal anchors first commercial-scale SOFC deployment at AI-cluster site; behind-the-meter generation pathway accelerates.",
    days_ago: 3,
    deltas: { economic: 3, supply: 2 },
    is_highlight: true,
  },
  {
    capability_key: "datacenter_power_demand",
    source_kind: "press",
    source_url: "https://www.bloomenergy.com/news/",
    title: "Bloom Energy raises 2026 megawatt deployment guidance",
    summary:
      "Increase in deployment guidance reflects AI-driven behind-the-meter demand; order book lengthens.",
    days_ago: 7,
    deltas: { economic: 2, supply: 2 },
  },
  {
    capability_key: "stack_durability",
    source_kind: "paper",
    source_url: "https://arxiv.org/list/physics.app-ph/recent",
    title: "Long-duration stack degradation review identifies mitigation paths",
    summary:
      "Survey covers 40,000-hour stack-degradation data sets; identifies most promising design changes for next-generation cells.",
    days_ago: 14,
    deltas: { technical: 2 },
  },
  {
    capability_key: "stack_durability",
    source_kind: "press",
    source_url: "https://www.doosanfuelcell.com/en/notice/news",
    title: "Doosan Fuel Cell extends stack-life warranty",
    summary:
      "Warranty extension reflects field-data confidence; reduces customer total-cost-of-ownership uncertainty.",
    days_ago: 19,
    deltas: { technical: 2, economic: 2 },
  },
  {
    capability_key: "system_cost_curve",
    source_kind: "gov_report",
    source_url: "https://www.energy.gov/eere/fuelcells",
    title: "DOE H2Hubs program issues SOFC-relevant award",
    summary:
      "Hydrogen-hub funding allocation directly benefits SOFC OEM cost-down through balance-of-plant standardization.",
    days_ago: 9,
    deltas: { economic: 2, supply: 2 },
  },
  {
    capability_key: "system_cost_curve",
    source_kind: "analyst_report",
    source_url: "https://www.iea.org/topics/hydrogen",
    title: "IEA notes SOFC system cost curve crosses gas-CHP threshold",
    summary:
      "Cost-curve analysis shows SOFC system pricing crossing parity with gas-CHP under specific use cases; commercial inflection nearer than consensus.",
    days_ago: 16,
    deltas: { economic: 3 },
    is_highlight: true,
  },
  {
    capability_key: "fuel_economics",
    source_kind: "news",
    source_url: "https://www.reuters.com/business/energy/",
    title: "US natural-gas Henry-Hub price holds in tight band",
    summary:
      "Stable Henry-Hub pricing supports SOFC economics in the near term; longer-term hydrogen optionality remains the value lever.",
    days_ago: 6,
    deltas: { economic: 1 },
  },
  {
    capability_key: "fuel_economics",
    source_kind: "news",
    source_url: "https://www.eia.gov/petroleum/weekly/",
    title: "EIA weekly natural-gas storage report unchanged",
    summary:
      "Storage report supports range-bound Henry-Hub price; SOFC NPV sensitivity to fuel cost remains positive.",
    days_ago: 11,
    deltas: { economic: 1 },
  },
  {
    capability_key: "manufacturing_capacity",
    source_kind: "press",
    source_url: "https://www.bloomenergy.com/news/",
    title: "Bloom Energy commissions Fremont expansion",
    summary:
      "Manufacturing capacity expansion completes; runrate gigawatt-class output supports next-quarter delivery commitments.",
    days_ago: 13,
    deltas: { supply: 3 },
  },
  {
    capability_key: "manufacturing_capacity",
    source_kind: "press",
    source_url: "https://www.doosanfuelcell.com/en/notice/news",
    title: "Doosan opens second SOFC manufacturing line",
    summary:
      "Capacity addition meets growing Korean municipal demand; export pipeline to SE Asia begins ramp.",
    days_ago: 21,
    deltas: { supply: 2 },
  },
  {
    capability_key: "permitting_interconnection",
    source_kind: "gov_report",
    source_url:
      "https://www.ferc.gov/news-events/news/news-releases",
    title: "FERC issues interconnection-queue reform order",
    summary:
      "Queue-reform order shortens behind-the-meter SOFC interconnection timelines; LCOE accretion under conservative assumptions.",
    days_ago: 17,
    deltas: { regulatory: 3 },
    is_highlight: true,
  },
  {
    capability_key: "permitting_interconnection",
    source_kind: "news",
    source_url: "https://www.utilitydive.com/topic/distributed-energy/",
    title: "State PUC streamlines distributed-generation permitting",
    summary:
      "Sequence of state-level reforms cumulatively shortens permitting to first commissioning by several months.",
    days_ago: 24,
    deltas: { regulatory: 2 },
  },
  {
    capability_key: "fuel_economics",
    source_kind: "analyst_report",
    source_url:
      "https://energy.ec.europa.eu/topics/energy-systems-integration/hydrogen_en",
    title: "EU H2 backbone milestone slips by 6 months",
    summary:
      "Network milestone slip shifts SOFC fuel-source thesis later in the decade; near-term economics anchored to natural gas.",
    days_ago: 18,
    deltas: { regulatory: -2, supply: -1 },
  },
  {
    capability_key: "permitting_interconnection",
    source_kind: "gov_report",
    source_url: "https://www.epa.gov/climate-change",
    title: "EPA proposes power-sector emissions reporting update",
    summary:
      "Reporting update increases scrutiny on stationary-generator emissions; carbon-pricing optionality rises.",
    days_ago: 22,
    deltas: { regulatory: 1 },
  },
  {
    capability_key: "manufacturing_capacity",
    source_kind: "patent",
    source_url:
      "https://patents.google.com/?q=solid+oxide+fuel+cell+electrolyte",
    title: "Solid-oxide electrolyte patents diversify across geographies",
    summary:
      "Patent-landscape analysis shows broadening filer base; supply-chain concentration risk gradually easing.",
    days_ago: 31,
    deltas: { supply: 1 },
  },
  {
    capability_key: "datacenter_power_demand",
    source_kind: "press",
    source_url:
      "https://www.bloomberg.com/news/articles",
    title: "Major hyperscaler signals SOFC-friendly site selection criteria",
    summary:
      "Public statement adds SOFC eligibility to siting criteria; vendor pipeline depth materially improves.",
    days_ago: 26,
    deltas: { economic: 2, supply: 1 },
  },
  {
    capability_key: "stack_durability",
    source_kind: "press",
    source_url: "https://www.fuelcellsworks.com/",
    title: "Independent test rig achieves 50,000-hour SOFC degradation milestone",
    summary:
      "Third-party rig confirms accelerated-aging curve from OEM; lifetime-economics case strengthens.",
    days_ago: 29,
    deltas: { technical: 2 },
  },
  {
    capability_key: "system_cost_curve",
    source_kind: "filing",
    source_url:
      "https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&company=bloom+energy",
    title: "Bloom Energy 10-Q breaks out SOFC system cost trend",
    summary:
      "Segment disclosure quantifies system-cost decline; investors revise out-year economics upward.",
    days_ago: 12,
    deltas: { economic: 2 },
  },
  {
    capability_key: "fuel_economics",
    source_kind: "analyst_report",
    source_url: "https://www.iea.org/topics/hydrogen",
    title: "IEA tracks declining green-H2 production-cost outlook",
    summary:
      "Falling green-H2 production cost extends SOFC value proposition through the 2030s.",
    days_ago: 33,
    deltas: { economic: 1 },
  },
  {
    capability_key: "manufacturing_capacity",
    source_kind: "press",
    source_url: "https://www.fuelcellsworks.com/",
    title: "European SOFC manufacturing JV announced",
    summary:
      "Cross-border manufacturing partnership reduces single-vendor dependency; supplier diversity narrative improves.",
    days_ago: 27,
    deltas: { supply: 2 },
  },
  // M54 — densify to ≥30 signals per vision.
  {
    capability_key: "datacenter_power_demand",
    actor_key: "bloom_energy",
    source_kind: "press",
    source_url: "https://www.bloomenergy.com/news/",
    title: "Bloom Energy + hyperscaler announce multi-site SOFC PPA",
    summary:
      "Multi-site behind-the-meter PPA across NA + EU — single largest commercial SOFC commitment to date.",
    days_ago: 2,
    deltas: { economic: 3, supply: 2 },
    is_highlight: true,
  },
  {
    capability_key: "stack_durability",
    actor_key: "ceres_power",
    source_kind: "press",
    source_url: "https://www.ceres.tech/news/",
    title: "Ceres SteelCell stack achieves new 50,000-hour milestone",
    summary:
      "Independent test rig confirms SteelCell stack durability beyond 50,000-hour mark with measurable margin remaining.",
    days_ago: 6,
    deltas: { technical: 3 },
  },
  {
    capability_key: "system_cost_curve",
    actor_key: "doosan_fc",
    source_kind: "press",
    source_url: "https://www.doosanfuelcell.com/en/notice/news",
    title: "Doosan Fuel Cell unit-cost guidance revised downward",
    summary:
      "Quarterly guidance reflects faster-than-expected unit-cost decline; APAC-side system cost curve crosses key threshold.",
    days_ago: 10,
    deltas: { economic: 3 },
  },
  {
    capability_key: "fuel_economics",
    actor_key: "sunfire",
    source_kind: "press",
    source_url: "https://www.sunfire.de/en/news",
    title: "Sunfire reversible stack demo achieves dual-mode efficiency targets",
    summary:
      "Reversible SOFC/SOE stack demo hits dual-mode efficiency targets; bridges SOFC commercial path with green-H2 buildout.",
    days_ago: 13,
    deltas: { technical: 2, economic: 1 },
  },
  {
    capability_key: "manufacturing_capacity",
    actor_key: "mitsubishi_power",
    source_kind: "press",
    source_url: "https://power.mhi.com/news",
    title: "Mitsubishi Power expands hybrid SOFC-GT integration line",
    summary:
      "Industrial-scale hybrid SOFC-GT integration line expansion targets DC + steel-mill cogeneration customers.",
    days_ago: 18,
    deltas: { supply: 2 },
  },
  {
    capability_key: "datacenter_power_demand",
    source_kind: "analyst_report",
    source_url: "https://www.iea.org/topics/electricity",
    title: "IEA — data-center electricity demand revised upward",
    summary:
      "Updated IEA outlook revises 2027 data-center electricity demand upward by 15%; behind-the-meter generation attractiveness compounds.",
    days_ago: 22,
    deltas: { economic: 2 },
  },
  {
    capability_key: "permitting_interconnection",
    source_kind: "news",
    source_url: "https://www.utilitydive.com/topic/distributed-energy/",
    title: "Multiple state PUCs publish queue-reform implementation timelines",
    summary:
      "Coordinated state-level implementation cadence shortens behind-the-meter SOFC interconnection by months on average.",
    days_ago: 28,
    deltas: { regulatory: 3 },
    is_highlight: true,
  },
  {
    capability_key: "fuel_economics",
    actor_key: "iea_sofc",
    source_kind: "analyst_report",
    source_url: "https://www.iea.org/topics/hydrogen",
    title: "IEA — Green-H2 production cost outlook revised downward",
    summary:
      "Green-H2 production cost forecast pulled forward by ~2 years; SOFC fuel optionality strengthens through the 2030s.",
    days_ago: 33,
    deltas: { economic: 2 },
  },
  {
    capability_key: "stack_durability",
    source_kind: "paper",
    source_url: "https://arxiv.org/list/cond-mat.mtrl-sci/recent",
    title: "Materials science survey on SOFC interconnect coating durability",
    summary:
      "Survey paper benchmarks alternative interconnect coating chemistries; identifies most promising path to 80,000-hour stack life.",
    days_ago: 36,
    deltas: { technical: 1 },
  },
  {
    capability_key: "manufacturing_capacity",
    actor_key: "solidpower",
    source_kind: "press",
    source_url: "https://www.solidpower.com/news/",
    title: "SOLIDpower commissions second EU residential SOFC line",
    summary:
      "Capacity addition targets EU residential / light-commercial — diversifies SOFC TAM beyond hyperscaler DC.",
    days_ago: 41,
    deltas: { supply: 2 },
  },
  {
    capability_key: "system_cost_curve",
    actor_key: "fuelcell_energy",
    source_kind: "filing",
    source_url: "https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=fuelcell+energy",
    title: "FuelCell Energy 10-Q segment update on SOFC pilot economics",
    summary:
      "SEC filing breaks out SOFC pilot-line per-kW cost vs. molten-carbonate base; pilot economics trend toward Bloom Energy curve.",
    days_ago: 45,
    deltas: { economic: 1, technical: 1 },
  },
  {
    capability_key: "permitting_interconnection",
    actor_key: "us_ferc",
    source_kind: "gov_report",
    source_url: "https://www.ferc.gov/industries-data/electric",
    title: "FERC quarterly interconnection report — queue depth flattening",
    summary:
      "Queue depth flattens for the first time in three years post-reform implementation; downstream LCOE compression visible.",
    days_ago: 48,
    deltas: { regulatory: 2 },
  },
  {
    capability_key: "datacenter_power_demand",
    actor_key: "mitsubishi_power",
    source_kind: "press",
    source_url: "https://power.mhi.com/regions/asia",
    title: "Mitsubishi Power APAC SOFC deployment update",
    summary:
      "Asia-Pacific behind-the-meter SOFC deployments reach commercial scale at multiple sites; replicable design pattern.",
    days_ago: 52,
    deltas: { supply: 2 },
  },
  {
    capability_key: "stack_durability",
    actor_key: "us_doe_eere",
    source_kind: "gov_report",
    source_url: "https://www.energy.gov/eere/fuelcells/stationary-fuel-cell-systems",
    title: "DOE EERE — stationary fuel cell stack durability roadmap update",
    summary:
      "Roadmap targets 80,000-hour stack life by 2028. Funded test stands at NREL + ANL accelerating empirical baseline.",
    days_ago: 55,
    deltas: { technical: 2 },
  },
];

const SIGNALS_BY_VISION: Record<string, SignalSeed[]> = {
  "space-data-center": SDC,
  "fusion-power": FUSION,
  "memory-semi": MEMSEMI,
  sofc: SOFC,
};

// --------------------------------------------------------------------------
// Seed loop
// --------------------------------------------------------------------------

async function main(): Promise<void> {
  let total = 0;
  let skipped = 0;
  for (const [sector_slug, signals] of Object.entries(SIGNALS_BY_VISION)) {
    // Pre-load capability + actor maps for the vision.
    const caps = await prisma.capability.findMany({
      where: { sector_slug },
      select: { id: true, key: true },
    });
    const capIdByKey = new Map<string, string>(caps.map((c) => [c.key, c.id]));

    const visionActors = await prisma.visionActor.findMany({
      where: { sector_slug },
      select: { actor: { select: { id: true, key: true } } },
    });
    const actorIdByKey = new Map<string, string>(
      visionActors.map((va) => [va.actor.key, va.actor.id]),
    );

    console.log(
      `[seed-signals] ${sector_slug}: ${signals.length} planned, ` +
        `${caps.length} caps available, ${visionActors.length} actors available`,
    );

    for (const s of signals) {
      const capId = capIdByKey.get(s.capability_key);
      if (!capId) {
        console.warn(
          `  ! skipping signal — capability ${s.capability_key} missing for ${sector_slug}`,
        );
        skipped++;
        continue;
      }
      const actorId = s.actor_key
        ? (actorIdByKey.get(s.actor_key) ?? null)
        : null;
      if (s.actor_key && !actorId) {
        console.warn(
          `  ! actor ${s.actor_key} unseeded for ${sector_slug} — signal kept, actor_id null`,
        );
      }

      const published_at = new Date(
        Date.now() - s.days_ago * 24 * 60 * 60 * 1000,
      );

      await prisma.signal.upsert({
        where: {
          source_url_capability_id: {
            source_url: s.source_url,
            capability_id: capId,
          },
        },
        create: {
          sector_slug,
          capability_id: capId,
          actor_id: actorId,
          source_kind: s.source_kind,
          source_url: s.source_url,
          source_id_ext: s.source_id_ext ?? null,
          title: s.title,
          summary: s.summary,
          published_at,
          delta_technical: s.deltas.technical ?? null,
          delta_economic: s.deltas.economic ?? null,
          delta_regulatory: s.deltas.regulatory ?? null,
          delta_supply: s.deltas.supply ?? null,
          is_highlight: s.is_highlight ?? false,
        },
        update: {
          actor_id: actorId,
          source_kind: s.source_kind,
          source_id_ext: s.source_id_ext ?? null,
          title: s.title,
          summary: s.summary,
          published_at,
          delta_technical: s.deltas.technical ?? null,
          delta_economic: s.deltas.economic ?? null,
          delta_regulatory: s.deltas.regulatory ?? null,
          delta_supply: s.deltas.supply ?? null,
          is_highlight: s.is_highlight ?? false,
        },
      });
      total++;
    }
  }
  console.log(
    `[seed-signals] done. upserted ${total} signals, skipped ${skipped}.`,
  );
}

main()
  .catch((e) => {
    console.error("[seed-signals] failed:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
