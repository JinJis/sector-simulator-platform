"""Memory semiconductor (DRAM/HBM) sector — revenue/margin/FCF trajectory.

Planning-grade techno-economic model for an integrated memory maker (think
SK Hynix / Samsung memory / Micron). The model splits demand into AI-driven
HBM-class bits and broader commodity DRAM, projects industry revenue from
demand × ASP, applies the firm's market share, then walks down to gross
margin → opex → capex → free cash flow → NPV.

Conventions
-----------
- "Bits" priced and produced in GB. 1 PB = 1e6 GB (we use base-10 for
  industry-quoted numbers; not 2^30).
- HBM ASP = commodity_dram_asp × hbm_premium_x. Cost-per-GB tracks
  commodity-DRAM cost (HBM also gets cost-down, premium is reflected in ASP).
- Deterministic stdlib-only math — same drivers → same outputs.
- Horizon 10 years; series indexed 0..horizon inclusive.
"""

from __future__ import annotations

from platform_sdk import (
    Driver,
    GraphEdge,
    GraphNode,
    HistoryPoint,
    Output,
    Provenance,
    SimGraph,
    SimulationBase,
    Source,
)


def _hist(points: list[tuple[str, float]]) -> tuple[HistoryPoint, ...]:
    return tuple(HistoryPoint(date=d, value=v) for d, v in points)


_DEMO_NOTE = (
    "Seeded demo provenance — Phase 2에서 data-pipeline-service가 실제 출처로 교체."
)


class MemorySemiSim(SimulationBase):
    slug = "memory-semi"
    name = "Memory Semiconductor"
    description = (
        "DRAM/HBM 메모리 반도체 메이커의 10년 매출·마진·FCF 궤적을 시뮬레이션합니다. "
        "AI 서버 HBM 수요와 커머디티 DRAM 사이클을 별도로 모델링하고, "
        "ASP 사이클·원가 감소·capex intensity를 반영해 NPV와 피크 마진을 계산합니다."
    )
    horizon_years = 10

    drivers = {
        # --- Demand ---
        "ai_dram_demand_pb_y0": Driver(
            default=800.0,
            range=(50.0, 5000.0),
            unit="PB",
            description="Year-0 AI/HBM 수요. 1 PB ≈ H100 8-GPU 노드 ~6,000대 분량.",
            group="Demand",
        ),
        "ai_dram_demand_cagr_pct": Driver(
            default=55.0,
            range=(0.0, 150.0),
            unit="%/yr",
            description="AI 메모리 수요 CAGR. 2023→2025 실제 ~80%, 장기 둔화 가정.",
            group="Demand",
        ),
        "commodity_dram_demand_pb_y0": Driver(
            default=8000.0,
            range=(1000.0, 25000.0),
            unit="PB",
            description="Year-0 커머디티 DRAM 수요 (서버·PC·모바일·자동차 합산).",
            group="Demand",
        ),
        "commodity_dram_demand_cagr_pct": Driver(
            default=8.0,
            range=(-10.0, 30.0),
            unit="%/yr",
            description="커머디티 DRAM 비트 수요 장기 성장률. 역사적 ~10%.",
            group="Demand",
        ),
        # --- Pricing ---
        "commodity_dram_asp_usd_per_gb": Driver(
            default=3.0,
            range=(0.5, 15.0),
            unit="$/GB",
            description="커머디티 DRAM ASP. 사이클 트로프 ~$1.5, 피크 ~$8.",
            group="Pricing",
        ),
        "commodity_dram_asp_cagr_pct": Driver(
            default=0.0,
            range=(-25.0, 30.0),
            unit="%/yr",
            description="ASP 장기 트렌드. 사이클 평균은 0~slight negative, 단기 변동성 큼.",
            group="Pricing",
        ),
        "hbm_premium_x": Driver(
            default=5.0,
            range=(2.0, 12.0),
            unit="x",
            description="HBM ASP / commodity DRAM ASP. HBM3E ≈ 5-7x, 차세대 더 낮아질 전망.",
            group="Pricing",
        ),
        # --- Supply / Mix ---
        "hbm_mix_pct_of_ai_demand": Driver(
            default=60.0,
            range=(10.0, 95.0),
            unit="%",
            description="AI 수요 중 HBM이 차지하는 비율 (나머지는 high-end commodity).",
            group="Supply",
        ),
        "company_market_share_pct": Driver(
            default=30.0,
            range=(5.0, 55.0),
            unit="%",
            description="자사의 글로벌 DRAM bit 점유율. Big3 각각 ~22-32%.",
            group="Supply",
        ),
        # --- Cost & Economics ---
        "dram_cost_usd_per_gb_y0": Driver(
            default=1.8,
            range=(0.3, 10.0),
            unit="$/GB",
            description="Year-0 비트 원가. 마진은 ASP - 이 값 × bits sold.",
            group="Cost",
        ),
        "dram_cost_reduction_pct_per_year": Driver(
            default=15.0,
            range=(0.0, 35.0),
            unit="%/yr",
            description="비트당 원가 감소율. 역사적 ~15-20%, 노드 미세화 둔화로 감소 추세.",
            group="Cost",
        ),
        "capex_intensity_pct": Driver(
            default=30.0,
            range=(5.0, 60.0),
            unit="%",
            description="매출 대비 연간 capex. Big3 평균 25-35% (사이클 상단 50%까지).",
            group="Cost",
        ),
        "opex_pct_of_revenue": Driver(
            default=18.0,
            range=(5.0, 40.0),
            unit="%",
            description="매출 대비 R&D + SG&A 운영비.",
            group="Cost",
        ),
        "discount_rate_pct": Driver(
            default=9.0,
            range=(0.0, 25.0),
            unit="%",
            description="WACC. 메모리 반도체 ~8-11%.",
            group="Cost",
        ),
    }

    presets: dict[str, dict[str, float]] = {
        "Baseline (2026)": {},
        "AI super-cycle": {
            "ai_dram_demand_cagr_pct": 90.0,
            "commodity_dram_asp_usd_per_gb": 5.0,
            "commodity_dram_asp_cagr_pct": 10.0,
            "hbm_premium_x": 7.0,
            "hbm_mix_pct_of_ai_demand": 75.0,
        },
        "Downcycle": {
            "ai_dram_demand_cagr_pct": 15.0,
            "commodity_dram_demand_cagr_pct": -5.0,
            "commodity_dram_asp_usd_per_gb": 1.5,
            "commodity_dram_asp_cagr_pct": -15.0,
            "hbm_premium_x": 3.0,
        },
        "Mature low-growth": {
            "ai_dram_demand_cagr_pct": 25.0,
            "commodity_dram_demand_cagr_pct": 4.0,
            "commodity_dram_asp_cagr_pct": -3.0,
            "dram_cost_reduction_pct_per_year": 8.0,
            "capex_intensity_pct": 20.0,
        },
    }

    provenance: dict[str, Provenance] = {
        "ai_dram_demand_pb_y0": Provenance(
            history=_hist(
                [
                    ("2022", 80.0),
                    ("2023", 220.0),
                    ("2024", 480.0),
                    ("2025E", 800.0),
                    ("2026E", 1300.0),
                ]
            ),
            sources=(
                Source(
                    title="TrendForce HBM/AI memory demand outlook",
                    url="https://www.trendforce.com/",
                    excerpt="AI server HBM bit demand more than doubles annually 2023-2025.",
                    as_of="2025-Q1",
                    kind="analyst",
                ),
                Source(
                    title="Yole Memory Market Monitor",
                    url="https://www.yolegroup.com/",
                    excerpt="AI accelerator HBM3/HBM3E content reached ~480 PB in 2024.",
                    as_of="2024-Q4",
                    kind="analyst",
                ),
            ),
            note="AI 메모리 수요는 ChatGPT 이후 hockey-stick. 2025년 ~800 PB 추정.",
        ),
        "ai_dram_demand_cagr_pct": Provenance(
            history=_hist([("2023", 175.0), ("2024", 118.0), ("2025E", 65.0), ("2027E", 35.0)]),
            sources=(
                Source(
                    title="Bernstein Research: AI memory cycle notes",
                    url="https://www.bernsteinresearch.com/",
                    excerpt="Initial AI memory ramp 80-150%/yr, normalizing to 30-50% by 2027.",
                    as_of="2024-Q4",
                    kind="analyst",
                ),
            ),
            note="AI 수요 성장률은 빠르게 둔화. 베이스는 중기 ~55%.",
        ),
        "commodity_dram_demand_pb_y0": Provenance(
            history=_hist(
                [("2020", 4500.0), ("2022", 6200.0), ("2024", 7400.0), ("2025E", 8000.0)]
            ),
            sources=(
                Source(
                    title="WSTS (World Semiconductor Trade Statistics)",
                    url="https://www.wsts.org/",
                    excerpt="Industry DRAM bit shipments grew from 4.5 EB (2020) to 7.4 EB (2024).",
                    as_of="2024-Q4",
                    kind="dataset",
                ),
                Source(
                    title="IDC Memory Quarterly Tracker",
                    url="https://www.idc.com/",
                    excerpt="Server/PC/mobile DRAM bit demand 2024 ~7,400 PB.",
                    as_of="2024-Q4",
                    kind="analyst",
                ),
            ),
            note="커머디티 DRAM 비트 수요. 단위 PB.",
        ),
        "commodity_dram_demand_cagr_pct": Provenance(
            history=_hist(
                [("2018-2020", 11.0), ("2020-2022", 8.5), ("2022-2024", 9.5), ("2025E-2027E", 7.0)]
            ),
            sources=(
                Source(
                    title="IDC Memory shipment forecast",
                    url="https://www.idc.com/",
                    excerpt="Long-run bit growth 7-10%/yr; AI net adds ~3-5pp.",
                    as_of="2024-Q3",
                    kind="analyst",
                ),
            ),
            note="장기 bit growth는 한자릿수 후반. 모바일/PC 둔화 + 서버 부상 상쇄.",
        ),
        "commodity_dram_asp_usd_per_gb": Provenance(
            history=_hist(
                [
                    ("2021", 4.20),
                    ("2022", 3.30),
                    ("2023", 2.10),
                    ("2024", 2.90),
                    ("2025E", 3.40),
                ]
            ),
            sources=(
                Source(
                    title="DRAMeXchange spot/contract pricing",
                    url="https://www.dramexchange.com/",
                    excerpt="DDR5 16Gb contract ~$3.0/GB Q1'25 (DDR4 lower).",
                    as_of="2025-Q1",
                    kind="dataset",
                ),
                Source(
                    title="TrendForce DRAM contract price index",
                    url="https://www.trendforce.com/",
                    excerpt="Cycle ASP range 2021-2024: $1.5 (trough) to $4.2 (peak).",
                    as_of="2025-Q1",
                    kind="analyst",
                ),
            ),
            note="ASP는 강한 사이클성. Spot vs contract 차이 ~10-25%.",
        ),
        "commodity_dram_asp_cagr_pct": Provenance(
            history=_hist(
                [("2018-2020", -22.0), ("2020-2022", -8.0), ("2022-2024", -8.0)]
            ),
            sources=(
                Source(
                    title="TrendForce memory cycle analysis",
                    url="https://www.trendforce.com/",
                    excerpt="장기 ASP 트렌드는 mild deflation; cycle peaks +30-50% YoY 가능.",
                    as_of="2024-Q4",
                    kind="analyst",
                ),
            ),
            note="장기 ASP는 mild deflation. 단기는 사이클로 ±25%.",
        ),
        "hbm_premium_x": Provenance(
            history=_hist([("2022", 3.5), ("2023", 4.5), ("2024", 5.5), ("2026E", 4.5)]),
            sources=(
                Source(
                    title="Bernstein HBM3/HBM3E pricing analysis",
                    url="https://www.bernsteinresearch.com/",
                    excerpt="HBM3E priced ~5-7x commodity DDR5 in 2024.",
                    as_of="2024-Q4",
                    kind="analyst",
                ),
                Source(
                    title="SK hynix HBM3E product brief",
                    url="https://www.skhynix.com/eng/product/hbm.jsp",
                    excerpt="HBM3E 36GB 12-Hi targets AI accelerators at premium ASP.",
                    as_of="2024-Q3",
                    kind="vendor_doc",
                ),
            ),
            note="HBM 프리미엄은 공급 부족 완화로 점진적 축소 전망.",
        ),
        "hbm_mix_pct_of_ai_demand": Provenance(
            history=_hist([("2023", 45.0), ("2024", 58.0), ("2025E", 65.0)]),
            sources=(
                Source(
                    title="SK hynix Q4 2024 earnings call",
                    url="https://www.skhynix.com/eng/ir/quarterlyEarnings.do",
                    excerpt="HBM share of company DRAM revenue >40% in Q4'24.",
                    as_of="2025-Q1",
                    kind="filing",
                ),
            ),
            note="AI 워크로드 중 HBM이 차지하는 비중. 나머지는 high-end DDR5.",
        ),
        "company_market_share_pct": Provenance(
            history=_hist(
                [("2020", 28.0), ("2022", 27.5), ("2023", 30.0), ("2024", 31.0)]
            ),
            sources=(
                Source(
                    title="Statista DRAM market share",
                    url="https://www.statista.com/",
                    excerpt="2024 DRAM share: Samsung ~42%, SK hynix ~31%, Micron ~22%.",
                    as_of="2024-Q4",
                    kind="dataset",
                ),
            ),
            note="자사 점유율. AI/HBM 강세 기업은 점유율 상승 추세.",
        ),
        "dram_cost_usd_per_gb_y0": Provenance(
            history=_hist(
                [("2020", 2.80), ("2022", 2.30), ("2024", 1.95), ("2025E", 1.80)]
            ),
            sources=(
                Source(
                    title="Morgan Stanley memory cost stack",
                    url="https://www.morganstanley.com/",
                    excerpt="Bit cost ~$1.8-2.0/GB at leading-edge nodes (1a/1b nm).",
                    as_of="2024-Q4",
                    kind="analyst",
                ),
            ),
            note="원가는 노드 미세화 + 수율 개선으로 꾸준히 감소.",
        ),
        "dram_cost_reduction_pct_per_year": Provenance(
            history=_hist(
                [("2010-2015", 22.0), ("2015-2020", 17.0), ("2020-2024", 13.0), ("2025E", 11.0)]
            ),
            sources=(
                Source(
                    title="IC Insights process node cost curve",
                    url="https://www.icinsights.com/",
                    excerpt="Bit cost reduction slowing: 22% (2010s) → 13% (2020s) per year.",
                    as_of="2024-Q3",
                    kind="analyst",
                ),
            ),
            note="EUV 도입 + 3D 스택으로 추가 미세화 비용 상승. 감소율 둔화.",
        ),
        "capex_intensity_pct": Provenance(
            history=_hist(
                [("2020", 28.0), ("2022", 35.0), ("2023", 22.0), ("2024", 31.0)]
            ),
            sources=(
                Source(
                    title="SK hynix 10-K / annual report",
                    url="https://www.skhynix.com/eng/ir/annualReport.do",
                    excerpt="Capex/revenue ratio 22-38% across 2020-2024 cycle.",
                    as_of="2024-Q4",
                    kind="filing",
                ),
                Source(
                    title="Micron Technology 10-K (FY2024)",
                    url="https://investors.micron.com/",
                    excerpt="FY24 capex ~$8B on ~$25B revenue ≈ 32%.",
                    as_of="2024-Q4",
                    kind="filing",
                ),
            ),
            note="Big3 평균. 사이클 상단(downturn 직전)에 capex intensity 50%까지 튐.",
        ),
        "opex_pct_of_revenue": Provenance(
            history=_hist([("2020", 14.0), ("2022", 17.0), ("2024", 18.0)]),
            sources=(
                Source(
                    title="Memory peer comparable analysis",
                    url="https://example.com/memory-peer-comp",
                    excerpt="R&D ~8-10% + SG&A ~6-8% = blended opex 14-20% of rev.",
                    as_of="2024-Q4",
                    kind="analyst",
                ),
            ),
            note="HBM은 R&D 집약적 → opex 비중 점진적 상승.",
        ),
        "discount_rate_pct": Provenance(
            history=_hist([("2020", 7.5), ("2022", 9.0), ("2024", 9.0)]),
            sources=(
                Source(
                    title="Sell-side WACC consensus for memory makers",
                    url="https://example.com/memory-wacc",
                    excerpt="Big3 memory WACC band 8-11% (cyclical industry premium).",
                    as_of="2024-Q4",
                    kind="analyst",
                ),
            ),
            note="자본비용 (WACC). 사이클성·자본집약으로 일반 IT보다 +1-2pp.",
        ),
    }

    # Causal graph for the memory-semi sector. Walks demand × ASP → industry
    # revenue → company revenue → gross margin → FCF.
    graph = SimGraph(
        nodes=(
            # Drivers
            GraphNode("ai_dram_demand_pb_y0", "AI bits (year 0)", "driver", "Demand", "PB"),
            GraphNode("ai_dram_demand_cagr_pct", "AI bits CAGR", "driver", "Demand", "%/yr"),
            GraphNode("commodity_dram_demand_pb_y0", "Commodity bits (year 0)", "driver", "Demand", "PB"),
            GraphNode("commodity_dram_demand_cagr_pct", "Commodity bits CAGR", "driver", "Demand", "%/yr"),
            GraphNode("commodity_dram_asp_usd_per_gb", "Commodity ASP", "driver", "Pricing", "$/GB"),
            GraphNode("commodity_dram_asp_cagr_pct", "ASP CAGR", "driver", "Pricing", "%/yr"),
            GraphNode("hbm_premium_x", "HBM premium", "driver", "Pricing", "x"),
            GraphNode("hbm_mix_pct_of_ai_demand", "HBM mix", "driver", "Supply", "%"),
            GraphNode("company_market_share_pct", "Market share", "driver", "Supply", "%"),
            GraphNode("dram_cost_usd_per_gb_y0", "Cost / GB (year 0)", "driver", "Cost", "$/GB"),
            GraphNode("dram_cost_reduction_pct_per_year", "Cost reduction", "driver", "Cost", "%/yr"),
            GraphNode("capex_intensity_pct", "Capex intensity", "driver", "Cost", "%"),
            GraphNode("opex_pct_of_revenue", "Opex / revenue", "driver", "Cost", "%"),
            GraphNode("discount_rate_pct", "Discount rate", "driver", "Cost", "%"),

            # Intermediates
            GraphNode("ai_pb_trajectory", "AI bits / yr", "intermediate", "Demand", "PB"),
            GraphNode("co_pb_trajectory", "Commodity bits / yr", "intermediate", "Demand", "PB"),
            GraphNode("commodity_asp_trajectory", "Commodity ASP / yr", "intermediate", "Pricing", "$/GB"),
            GraphNode("hbm_asp_trajectory", "HBM ASP / yr", "intermediate", "Pricing", "$/GB",
                      description="commodity ASP × HBM premium"),
            GraphNode("cost_per_gb_trajectory", "Cost / GB / yr", "intermediate", "Cost", "$/GB"),
            GraphNode("industry_hbm_revenue", "Industry HBM revenue", "intermediate", "Industry", "USD"),
            GraphNode("industry_comm_revenue", "Industry commodity revenue", "intermediate", "Industry", "USD"),
            GraphNode("industry_revenue_total", "Industry revenue", "intermediate", "Industry", "USD"),
            GraphNode("company_revenue_intermediate", "Company revenue", "intermediate", "Company", "USD",
                      description="industry × market share"),
            GraphNode("company_bits_gb", "Company bits sold", "intermediate", "Company", "GB"),
            GraphNode("company_cogs", "COGS", "intermediate", "Company", "USD"),
            GraphNode("gross_profit_intermediate", "Gross profit", "intermediate", "Margins", "USD"),
            GraphNode("opex_intermediate", "Opex", "intermediate", "Margins", "USD"),
            GraphNode("ebit_intermediate", "EBIT", "intermediate", "Margins", "USD"),
            GraphNode("capex_intermediate", "Capex", "intermediate", "Cash", "USD"),

            # Outputs
            GraphNode("npv_free_cash_flow_usd", "NPV (FCF)", "output", "Outputs", "USD"),
            GraphNode("peak_revenue_usd", "Peak revenue", "output", "Outputs", "USD"),
            GraphNode("peak_gross_margin_pct", "Peak gross margin", "output", "Outputs", "%"),
            GraphNode("free_cash_flow_usd", "FCF / yr", "output", "Outputs", "USD"),
        ),
        edges=(
            # Demand trajectories
            GraphEdge("ai_dram_demand_pb_y0", "ai_pb_trajectory", "× (1+g)^t"),
            GraphEdge("ai_dram_demand_cagr_pct", "ai_pb_trajectory", "g"),
            GraphEdge("commodity_dram_demand_pb_y0", "co_pb_trajectory", "× (1+g)^t"),
            GraphEdge("commodity_dram_demand_cagr_pct", "co_pb_trajectory", "g"),

            # Pricing trajectories
            GraphEdge("commodity_dram_asp_usd_per_gb", "commodity_asp_trajectory", "× (1+g)^t"),
            GraphEdge("commodity_dram_asp_cagr_pct", "commodity_asp_trajectory", "g"),
            GraphEdge("commodity_asp_trajectory", "hbm_asp_trajectory", "× premium"),
            GraphEdge("hbm_premium_x", "hbm_asp_trajectory", "×"),

            # Cost
            GraphEdge("dram_cost_usd_per_gb_y0", "cost_per_gb_trajectory", "× (1−drop)^t"),
            GraphEdge("dram_cost_reduction_pct_per_year", "cost_per_gb_trajectory", "drop"),

            # Industry revenue split
            GraphEdge("ai_pb_trajectory", "industry_hbm_revenue", "× mix × HBM ASP"),
            GraphEdge("hbm_mix_pct_of_ai_demand", "industry_hbm_revenue", "mix"),
            GraphEdge("hbm_asp_trajectory", "industry_hbm_revenue", "×"),
            GraphEdge("ai_pb_trajectory", "industry_comm_revenue", "× (1−mix)"),
            GraphEdge("hbm_mix_pct_of_ai_demand", "industry_comm_revenue", "1−mix"),
            GraphEdge("co_pb_trajectory", "industry_comm_revenue", "+"),
            GraphEdge("commodity_asp_trajectory", "industry_comm_revenue", "× ASP"),
            GraphEdge("industry_hbm_revenue", "industry_revenue_total", "+"),
            GraphEdge("industry_comm_revenue", "industry_revenue_total", "+"),

            # Company
            GraphEdge("industry_revenue_total", "company_revenue_intermediate", "× share"),
            GraphEdge("company_market_share_pct", "company_revenue_intermediate", "×"),
            GraphEdge("ai_pb_trajectory", "company_bits_gb", "× share"),
            GraphEdge("co_pb_trajectory", "company_bits_gb", "× share"),
            GraphEdge("company_market_share_pct", "company_bits_gb", "×"),
            GraphEdge("company_bits_gb", "company_cogs", "× cost/GB"),
            GraphEdge("cost_per_gb_trajectory", "company_cogs", "×"),

            # Margins
            GraphEdge("company_revenue_intermediate", "gross_profit_intermediate", "− COGS"),
            GraphEdge("company_cogs", "gross_profit_intermediate", "−"),
            GraphEdge("company_revenue_intermediate", "opex_intermediate", "× opex%"),
            GraphEdge("opex_pct_of_revenue", "opex_intermediate", "×"),
            GraphEdge("gross_profit_intermediate", "ebit_intermediate", "− opex"),
            GraphEdge("opex_intermediate", "ebit_intermediate", "−"),
            GraphEdge("company_revenue_intermediate", "capex_intermediate", "× intensity"),
            GraphEdge("capex_intensity_pct", "capex_intermediate", "×"),

            # FCF + outputs
            GraphEdge("ebit_intermediate", "free_cash_flow_usd", "− capex"),
            GraphEdge("capex_intermediate", "free_cash_flow_usd", "−"),
            GraphEdge("free_cash_flow_usd", "npv_free_cash_flow_usd", "Σ discount"),
            GraphEdge("discount_rate_pct", "npv_free_cash_flow_usd", "discount"),
            GraphEdge("company_revenue_intermediate", "peak_revenue_usd", "max"),
            GraphEdge("gross_profit_intermediate", "peak_gross_margin_pct", "÷ revenue, max"),
            GraphEdge("company_revenue_intermediate", "peak_gross_margin_pct", "÷"),
        ),
    )

    def simulate(self, **kwargs: float) -> dict[str, Output]:
        v = self.resolve_drivers(kwargs)
        n = self.horizon_years + 1
        years = range(n)

        ai_y0 = v["ai_dram_demand_pb_y0"]
        ai_g = v["ai_dram_demand_cagr_pct"] / 100.0
        co_y0 = v["commodity_dram_demand_pb_y0"]
        co_g = v["commodity_dram_demand_cagr_pct"] / 100.0
        asp_y0 = v["commodity_dram_asp_usd_per_gb"]
        asp_g = v["commodity_dram_asp_cagr_pct"] / 100.0
        hbm_x = v["hbm_premium_x"]
        hbm_mix = v["hbm_mix_pct_of_ai_demand"] / 100.0
        share = v["company_market_share_pct"] / 100.0
        cost_y0 = v["dram_cost_usd_per_gb_y0"]
        cost_drop = v["dram_cost_reduction_pct_per_year"] / 100.0
        capex_int = v["capex_intensity_pct"] / 100.0
        opex_int = v["opex_pct_of_revenue"] / 100.0
        r = v["discount_rate_pct"] / 100.0

        # Bits demand (PB) → GB by × 1e6.
        ai_pb = [ai_y0 * (1.0 + ai_g) ** t for t in years]
        co_pb = [co_y0 * (1.0 + co_g) ** t for t in years]

        commodity_asp = [asp_y0 * (1.0 + asp_g) ** t for t in years]
        hbm_asp = [a * hbm_x for a in commodity_asp]
        cost_per_gb = [cost_y0 * (1.0 - cost_drop) ** t for t in years]

        # Edge-weight multipliers (default 1.0 — no-op when the graph
        # editor hasn't touched the edge). Each one corresponds to a
        # graph_edges row in the DB; M9 lets users dial these to
        # explore "what if HBM premium → revenue impact were 2× as
        # strong" without rewriting the sim.
        w_hbm_rev = (
            self.w("ai_pb_trajectory", "industry_hbm_revenue")
            * self.w("hbm_mix_pct_of_ai_demand", "industry_hbm_revenue")
            * self.w("hbm_asp_trajectory", "industry_hbm_revenue")
        )
        w_comm_rev = (
            self.w("ai_pb_trajectory", "industry_comm_revenue")
            * self.w("hbm_mix_pct_of_ai_demand", "industry_comm_revenue")
            * self.w("co_pb_trajectory", "industry_comm_revenue")
            * self.w("commodity_asp_trajectory", "industry_comm_revenue")
        )
        w_company_rev = (
            self.w("industry_revenue_total", "company_revenue_intermediate")
            * self.w("company_market_share_pct", "company_revenue_intermediate")
        )
        w_company_cogs = (
            self.w("company_bits_gb", "company_cogs")
            * self.w("cost_per_gb_trajectory", "company_cogs")
        )
        w_opex = (
            self.w("company_revenue_intermediate", "opex_intermediate")
            * self.w("opex_pct_of_revenue", "opex_intermediate")
        )
        w_capex = (
            self.w("company_revenue_intermediate", "capex_intermediate")
            * self.w("capex_intensity_pct", "capex_intermediate")
        )

        # Industry revenue split: HBM bits priced at premium, rest at commodity.
        industry_hbm_revenue = [
            ai_pb[t] * 1e6 * hbm_mix * hbm_asp[t] * w_hbm_rev for t in years
        ]
        industry_comm_revenue = [
            (ai_pb[t] * 1e6 * (1.0 - hbm_mix) + co_pb[t] * 1e6) * commodity_asp[t] * w_comm_rev
            for t in years
        ]
        industry_revenue = [
            industry_hbm_revenue[t] + industry_comm_revenue[t] for t in years
        ]

        company_revenue = [industry_revenue[t] * share * w_company_rev for t in years]
        company_hbm_revenue = [industry_hbm_revenue[t] * share * w_company_rev for t in years]

        # Bits the company actually sells (its share of industry bits).
        company_bits_gb = [
            (ai_pb[t] * 1e6 + co_pb[t] * 1e6) * share for t in years
        ]
        company_cogs = [company_bits_gb[t] * cost_per_gb[t] * w_company_cogs for t in years]
        gross_profit = [company_revenue[t] - company_cogs[t] for t in years]
        gross_margin_pct = [
            (gross_profit[t] / company_revenue[t] * 100.0) if company_revenue[t] > 1e-6 else 0.0
            for t in years
        ]
        opex = [company_revenue[t] * opex_int * w_opex for t in years]
        ebit = [gross_profit[t] - opex[t] for t in years]
        capex = [company_revenue[t] * capex_int * w_capex for t in years]
        fcf = [ebit[t] - capex[t] for t in years]

        hbm_revenue_share_pct = [
            (company_hbm_revenue[t] / company_revenue[t] * 100.0)
            if company_revenue[t] > 1e-6
            else 0.0
            for t in years
        ]

        # NPV of FCF (t=0..horizon).
        npv = sum(fcf[t] / ((1.0 + r) ** t) for t in years)

        # Peak revenue / peak gross margin / terminal margin.
        peak_rev = max(company_revenue)
        peak_rev_year = float(company_revenue.index(peak_rev))
        peak_gm = max(gross_margin_pct)
        terminal_gm = gross_margin_pct[-1]

        return {
            "npv_free_cash_flow_usd": Output(
                scalar=npv,
                unit="USD",
                description=(
                    "10년 free cash flow의 NPV. 양수=가치 창출, 음수=가치 파괴."
                ),
            ),
            "peak_revenue_usd": Output(
                scalar=peak_rev,
                unit="USD",
                description="기간 중 최대 연간 매출.",
            ),
            "peak_revenue_year": Output(
                scalar=peak_rev_year,
                unit="yr",
                description="최대 매출이 달성되는 연도 (0 = year 0).",
            ),
            "peak_gross_margin_pct": Output(
                scalar=peak_gm,
                unit="%",
                description="기간 중 최대 매출총이익률.",
            ),
            "terminal_gross_margin_pct": Output(
                scalar=terminal_gm,
                unit="%",
                description="최종 연도의 매출총이익률 — 장기 균형 마진 추정.",
            ),
            "company_revenue_usd": Output(
                series=company_revenue,
                unit="USD",
                description="자사 연간 매출.",
            ),
            "gross_margin_pct": Output(
                series=gross_margin_pct,
                unit="%",
                description="연도별 매출총이익률.",
            ),
            "free_cash_flow_usd": Output(
                series=fcf,
                unit="USD",
                description="연간 free cash flow (EBIT − capex).",
            ),
            "company_capex_usd": Output(
                series=capex,
                unit="USD",
                description="연간 capex.",
            ),
            "hbm_revenue_share_pct": Output(
                series=hbm_revenue_share_pct,
                unit="%",
                description="자사 매출 중 HBM이 차지하는 비율.",
            ),
        }
