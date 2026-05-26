/**
 * Per-vision metric pairings for the Economics chart (MP5).
 *
 * Shared between the Overview hero (small preview) and
 * `/visions/[slug]/economics` (full chart + table). One row per vision
 * tells the page which two metrics in `economics_datapoints` should be
 * paired as primary vs baseline, with display labels + y-axis unit.
 *
 * `null` = no pair configured (chart hidden gracefully).
 */

export interface EconomicsPair {
  title: string;
  primary: { key: string; label: string };
  baseline: { key: string; label: string };
  yUnit: string;
  /** One-line narrative shown under the full chart. */
  caption: string;
}

export const ECONOMICS_PAIRS: Record<string, EconomicsPair | null> = {
  "space-data-center": {
    title: "Orbital vs ground data-center $/kWh",
    primary: { key: "orbit_dc_per_kwh", label: "Orbit DC" },
    baseline: { key: "ground_dc_per_kwh", label: "Ground DC" },
    yUnit: "$/kWh",
    caption:
      "Launch + thermal economics drive orbit DC down the curve while hyperscaler grid pressure pushes ground DC up.",
  },
  "fusion-power": {
    title: "Fusion LCOE vs CCGT baseline",
    primary: { key: "fusion_lcoe_per_mwh", label: "Fusion" },
    baseline: { key: "ccgt_lcoe_per_mwh", label: "CCGT (Lazard)" },
    yUnit: "$/MWh",
    caption:
      "Pilot-plant indicative LCOE vs combined-cycle gas baseline. Confidence band widens past FOAK.",
  },
  "memory-semi": {
    title: "HBM vs commodity DDR5 ASP",
    primary: { key: "hbm_asp_per_gb", label: "HBM" },
    baseline: { key: "ddr_asp_per_gb", label: "DDR5" },
    yUnit: "$/GB",
    caption:
      "HBM premium compresses as multi-vendor qualification advances; commodity DDR keeps its slow secular decline.",
  },
  sofc: {
    title: "SOFC LCOE vs US grid baseload",
    primary: { key: "sofc_lcoe_per_mwh", label: "SOFC" },
    baseline: { key: "grid_lcoe_per_mwh", label: "US grid" },
    yUnit: "$/MWh",
    caption:
      "Stack durability + manufacturing scale push SOFC down; baseload grid retail trends up under capacity scarcity.",
  },
};
