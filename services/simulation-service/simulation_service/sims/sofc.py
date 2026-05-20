"""SOFC (Solid Oxide Fuel Cell) stationary power LCOE model.

Planning-grade techno-economic model for a natural-gas-fueled SOFC system
(Bloom Energy class, 1 MW reference) over a 20-year project life. Computes
the levelized cost of electricity (LCOE) by walking yearly fuel + carbon +
O&M + amortized capex against electricity output, and compares cumulative
cost against a grid baseline to surface a break-even year and NPV savings.

Conventions
-----------
- Efficiency in %LHV. Energy flows in MWh of electricity; fuel input in
  MMBtu (1 MWh = 3.412 MMBtu of input heat).
- Stack replacement: at every multiple of `stack_lifetime_years` within the
  project life, add `stack_replacement_cost_usd_per_kw × system_size_mw × 1000`
  to that year's cost. Year 0 is the initial install (capex), not a stack
  swap.
- Carbon cost = fuel emissions × carbon_price. Set carbon_price=0 to skip.
- LCOE = NPV(annual costs incl. capex) / NPV(annual electricity).
- Break-even year = first year cumulative SOFC cost ≤ cumulative grid cost.
  -1 if never (e.g., capex too high relative to grid price savings).
- Deterministic stdlib-only math.
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


# Conversion: 1 MWh electricity = 3.412 MMBtu of heat input (at 100% efficiency).
MMBTU_PER_MWH = 3.412


class SOFCSim(SimulationBase):
    slug = "sofc"
    name = "SOFC (Solid Oxide Fuel Cell)"
    description = (
        "고체산화물 연료전지 발전 시스템의 20년 LCOE / 경제성을 시뮬레이션합니다. "
        "시스템 capex, 효율, 스택 수명·교체비, 천연가스 가격, 탄소비를 조절해 "
        "지역 전력망(grid) baseline 대비 NPV 절감액과 break-even year를 확인합니다."
    )
    horizon_years = 20

    drivers = {
        # --- System ---
        "system_capex_usd_per_kw": Driver(
            default=3500.0,
            range=(1000.0, 8000.0),
            unit="$/kW",
            description="설치 capex (스택 + BOP + EPC). Bloom ~$3.5-5k, 차세대 목표 $1.5k.",
            group="System",
        ),
        "system_efficiency_pct_lhv": Driver(
            default=55.0,
            range=(30.0, 70.0),
            unit="%LHV",
            description="순발전 효율 (LHV 기준). 상용 50-60%, R&D 65%+.",
            group="System",
        ),
        "system_size_mw": Driver(
            default=1.0,
            range=(0.1, 50.0),
            unit="MW",
            description="시스템 정격 출력. 1 MW = 표준 Bloom Energy Server 단위.",
            group="System",
        ),
        "capacity_factor_pct": Driver(
            default=90.0,
            range=(30.0, 99.0),
            unit="%",
            description="연간 가동률. 베이스로드 발전 ~90-95%.",
            group="System",
        ),
        # --- Stack & Degradation ---
        "stack_lifetime_years": Driver(
            default=5.0,
            range=(2.0, 15.0),
            unit="yr",
            description="스택 교체 주기. 현재 5-7년, 차세대 10년+ 목표.",
            group="Stack",
        ),
        "stack_replacement_cost_usd_per_kw": Driver(
            default=1500.0,
            range=(200.0, 4000.0),
            unit="$/kW",
            description="스택 교체 단가. 통상 초기 capex의 30-50%.",
            group="Stack",
        ),
        "degradation_pct_per_year": Driver(
            default=1.5,
            range=(0.0, 8.0),
            unit="%/yr",
            description="효율 저하율. 실증 데이터 1-2%/yr, EOL 0.5%/yr 목표.",
            group="Stack",
        ),
        # --- Fuel ---
        "natural_gas_price_usd_per_mmbtu": Driver(
            default=6.0,
            range=(2.0, 25.0),
            unit="$/MMBtu",
            description="천연가스 가격. 미국 Henry Hub ~$3-4, EU TTF ~$10-15.",
            group="Fuel",
        ),
        "fuel_carbon_intensity_kg_co2_per_mmbtu": Driver(
            default=53.0,
            range=(0.0, 75.0),
            unit="kg/MMBtu",
            description="연료 단위당 CO2. 천연가스 ~53, biogas ~10, green H2 ~0.",
            group="Fuel",
        ),
        # --- Operations ---
        "annual_om_pct_of_capex": Driver(
            default=4.0,
            range=(1.0, 15.0),
            unit="%/yr",
            description="capex 대비 연간 O&M (인건비 + 소모품 + 정비).",
            group="Operations",
        ),
        # --- Economics ---
        "discount_rate_pct": Driver(
            default=8.0,
            range=(0.0, 20.0),
            unit="%",
            description="WACC. 분산전원 프로젝트 통상 6-10%.",
            group="Economics",
        ),
        "carbon_price_usd_per_ton_co2": Driver(
            default=50.0,
            range=(0.0, 300.0),
            unit="$/t",
            description="탄소 가격. EU ETS ~€70-90, 미국 RGGI ~$15-25, social cost ~$185.",
            group="Economics",
        ),
        "grid_lcoe_usd_per_mwh": Driver(
            default=100.0,
            range=(40.0, 350.0),
            unit="$/MWh",
            description="비교 baseline 전력 가격. 미국 평균 ~$70-90, EU 산업용 $150+.",
            group="Economics",
        ),
        "project_lifetime_years": Driver(
            default=20.0,
            range=(5.0, 30.0),
            unit="yr",
            description="프로젝트 수명. 미션 종료 시 잔존가치 0 가정.",
            group="Economics",
        ),
    }

    presets: dict[str, dict[str, float]] = {
        "Baseline (US, 2026)": {},
        "EU industrial": {
            "natural_gas_price_usd_per_mmbtu": 13.0,
            "carbon_price_usd_per_ton_co2": 90.0,
            "grid_lcoe_usd_per_mwh": 180.0,
        },
        "Next-gen (DOE target)": {
            "system_capex_usd_per_kw": 1500.0,
            "system_efficiency_pct_lhv": 65.0,
            "stack_lifetime_years": 10.0,
            "stack_replacement_cost_usd_per_kw": 500.0,
            "degradation_pct_per_year": 0.5,
        },
        "Green hydrogen": {
            "natural_gas_price_usd_per_mmbtu": 22.0,  # equivalent $/MMBtu for green H2
            "fuel_carbon_intensity_kg_co2_per_mmbtu": 0.0,
            "carbon_price_usd_per_ton_co2": 100.0,
        },
    }

    provenance: dict[str, Provenance] = {
        "system_capex_usd_per_kw": Provenance(
            history=_hist(
                [("2015", 7500.0), ("2018", 5500.0), ("2022", 4200.0), ("2024", 3500.0)]
            ),
            sources=(
                Source(
                    title="Bloom Energy 10-K (FY2024)",
                    url="https://investor.bloomenergy.com/",
                    excerpt=(
                        "Installed system cost trending toward $3-4k/kW as production "
                        "scales; SLA pricing reflects this band."
                    ),
                    as_of="2024-Q4",
                    kind="filing",
                ),
                Source(
                    title="DOE SOFC Pathway to Commercialization",
                    url="https://www.energy.gov/eere/fuelcells/",
                    excerpt="DOE 2030 capex target $900-1500/kW (factory-installed).",
                    as_of="2024-Q2",
                    kind="gov_report",
                ),
            ),
            note="시스템 단가는 양산 규모 확대로 꾸준히 하락.",
        ),
        "system_efficiency_pct_lhv": Provenance(
            history=_hist([("2015", 47.0), ("2020", 52.0), ("2024", 55.0), ("2030E", 65.0)]),
            sources=(
                Source(
                    title="Bloom Energy Server datasheet",
                    url="https://www.bloomenergy.com/",
                    excerpt="Energy Server achieves >53% LHV electric efficiency.",
                    as_of="2024-Q3",
                    kind="vendor_doc",
                ),
                Source(
                    title="DOE Hydrogen Program Plan — SOFC efficiency targets",
                    url="https://www.hydrogen.energy.gov/",
                    excerpt="DOE 2030 target: 65% LHV stationary SOFC.",
                    as_of="2023-Q4",
                    kind="gov_report",
                ),
            ),
            note="순발전 효율. 열까지 회수하는 CHP 모드는 ~85%까지.",
        ),
        "system_size_mw": Provenance(
            history=_hist([("2018", 0.25), ("2022", 0.5), ("2024", 1.0)]),
            sources=(
                Source(
                    title="Bloom Energy Server 5 product spec",
                    url="https://www.bloomenergy.com/product/energy-server/",
                    excerpt="Standard Energy Server unit: 300 kW; sites scale to 50+ MW.",
                    as_of="2024-Q1",
                    kind="vendor_doc",
                ),
            ),
            note="단일 시스템 정격. 다중 모듈로 사이트 단위 확장.",
        ),
        "capacity_factor_pct": Provenance(
            history=_hist([("2018", 88.0), ("2022", 92.0), ("2024", 91.0)]),
            sources=(
                Source(
                    title="EIA Distributed Generation capacity factors",
                    url="https://www.eia.gov/",
                    excerpt="Commercial SOFC reported CF 88-95% (baseload mode).",
                    as_of="2024-Q2",
                    kind="dataset",
                ),
            ),
            note="베이스로드 운전 가정. 그리드 follow 모드면 70-80%.",
        ),
        "stack_lifetime_years": Provenance(
            history=_hist([("2015", 3.0), ("2020", 5.0), ("2024", 5.5), ("2030E", 10.0)]),
            sources=(
                Source(
                    title="Ceres Power stack longevity testing",
                    url="https://www.ceres.tech/",
                    excerpt="Steel-supported cells demonstrated >40,000h at <1%/1000h drop.",
                    as_of="2024-Q3",
                    kind="vendor_doc",
                ),
                Source(
                    title="DOE Solid Oxide Fuel Cell Program review",
                    url="https://www.netl.doe.gov/sofc",
                    excerpt="Long-term degradation goal: 80,000h with periodic refresh.",
                    as_of="2023-Q4",
                    kind="gov_report",
                ),
            ),
            note="실증 데이터 기준. 가속수명시험은 더 긴 값 보고됨.",
        ),
        "stack_replacement_cost_usd_per_kw": Provenance(
            history=_hist([("2018", 3000.0), ("2022", 2200.0), ("2024", 1500.0)]),
            sources=(
                Source(
                    title="DOE SOFC manufacturing cost study (Battelle)",
                    url="https://www.energy.gov/eere/fuelcells/",
                    excerpt="Stack-only manufacturing cost at scale: $300-800/kW.",
                    as_of="2023-Q1",
                    kind="gov_report",
                ),
            ),
            note="스택만 교체. BOP는 시스템 수명 내 재사용.",
        ),
        "degradation_pct_per_year": Provenance(
            history=_hist([("2015", 3.5), ("2020", 2.0), ("2024", 1.5), ("2030E", 0.5)]),
            sources=(
                Source(
                    title="Argonne National Lab SOFC degradation mechanisms",
                    url="https://www.anl.gov/",
                    excerpt=(
                        "Cathode poisoning + interconnect oxidation dominate; modern "
                        "cells achieve <2%/yr."
                    ),
                    as_of="2024-Q1",
                    kind="paper",
                ),
            ),
            note="효율 저하율. 발전량 감소로 LCOE 후반 상승.",
        ),
        "natural_gas_price_usd_per_mmbtu": Provenance(
            history=_hist(
                [("2020", 2.10), ("2022", 6.40), ("2023", 2.65), ("2024", 3.20), ("2025E", 4.20)]
            ),
            sources=(
                Source(
                    title="EIA Henry Hub spot price",
                    url="https://www.eia.gov/dnav/ng/hist/rngwhhdM.htm",
                    excerpt="2020-2024 Henry Hub avg $2-7/MMBtu; 2026 strip ~$4.",
                    as_of="2025-Q1",
                    kind="dataset",
                ),
                Source(
                    title="EIA AEO 2025 — natural gas outlook",
                    url="https://www.eia.gov/outlooks/aeo/",
                    excerpt="Reference case Henry Hub $3.50-5.00/MMBtu through 2030.",
                    as_of="2025-Q1",
                    kind="gov_report",
                ),
            ),
            note="미국 Henry Hub 기준. EU TTF는 보통 +$5-10 가산.",
        ),
        "fuel_carbon_intensity_kg_co2_per_mmbtu": Provenance(
            history=_hist([("천연가스", 53.0), ("biogas (정제)", 10.0), ("green H2", 0.0)]),
            sources=(
                Source(
                    title="EPA Emission Factors for Greenhouse Gas Inventories",
                    url="https://www.epa.gov/climateleadership/ghg-emission-factors-hub",
                    excerpt="Natural gas: 53.06 kg CO2/MMBtu (combustion only).",
                    as_of="2024-Q2",
                    kind="gov_report",
                ),
            ),
            note="연료 종류로 결정되는 상수. 천연가스 53, 바이오가스 ~10, 그린수소 0.",
        ),
        "annual_om_pct_of_capex": Provenance(
            history=_hist([("2018", 6.0), ("2022", 4.5), ("2024", 4.0)]),
            sources=(
                Source(
                    title="NREL Distributed Generation O&M benchmarks",
                    url="https://www.nrel.gov/",
                    excerpt="SOFC O&M 3-6% of installed cost, declining with fleet scale.",
                    as_of="2024-Q1",
                    kind="paper",
                ),
            ),
            note="원격 모니터링 보급으로 인건비 비중 감소.",
        ),
        "discount_rate_pct": Provenance(
            history=_hist([("2020", 6.0), ("2022", 7.5), ("2024", 8.0)]),
            sources=(
                Source(
                    title="IRENA Renewable Energy Cost Analysis — WACC band",
                    url="https://www.irena.org/",
                    excerpt="Distributed generation projects: WACC 6-10% in OECD markets.",
                    as_of="2024-Q3",
                    kind="gov_report",
                ),
            ),
            note="WACC. PPA 구조면 더 낮을 수 있음.",
        ),
        "carbon_price_usd_per_ton_co2": Provenance(
            history=_hist(
                [("2020", 25.0), ("2022", 85.0), ("2024", 70.0), ("EU ETS 2025E", 95.0)]
            ),
            sources=(
                Source(
                    title="EU ETS carbon allowance price",
                    url="https://ember-climate.org/data/data-tools/carbon-price-viewer/",
                    excerpt="EUA spot €60-95/t CO2 across 2023-2025.",
                    as_of="2025-Q1",
                    kind="dataset",
                ),
                Source(
                    title="ICCT Global carbon pricing benchmark",
                    url="https://theicct.org/",
                    excerpt="Major jurisdictions: $15 (RGGI) → $90 (EU ETS) → $185 (US SCC).",
                    as_of="2024-Q4",
                    kind="benchmark",
                ),
            ),
            note="시장가 vs social cost 차이 큼. 자체 ESG/내부 carbon price 적용도 가능.",
        ),
        "grid_lcoe_usd_per_mwh": Provenance(
            history=_hist([("2018", 75.0), ("2022", 95.0), ("2024", 105.0)]),
            sources=(
                Source(
                    title="Lazard Levelized Cost of Energy v17",
                    url="https://www.lazard.com/research-insights/levelized-cost-of-energyplus/",
                    excerpt="2024 unsubsidized grid LCOE band: $60-180/MWh (region-dependent).",
                    as_of="2024-Q3",
                    kind="analyst",
                ),
                Source(
                    title="EIA Annual Energy Outlook 2025 — retail rates",
                    url="https://www.eia.gov/outlooks/aeo/",
                    excerpt="Industrial retail electricity $80-120/MWh average.",
                    as_of="2025-Q1",
                    kind="gov_report",
                ),
            ),
            note="비교 baseline. 산업용 retail/industrial rate 기준.",
        ),
        "project_lifetime_years": Provenance(
            history=_hist([("2015", 10.0), ("2020", 15.0), ("2024", 20.0)]),
            sources=(
                Source(
                    title="Bloom Energy long-term service agreement disclosures",
                    url="https://investor.bloomenergy.com/",
                    excerpt="Typical PPA/LSA terms: 15-20 years with stack refresh included.",
                    as_of="2024-Q3",
                    kind="filing",
                ),
            ),
            note="자산 수명. 스택은 lifetime 내 여러 번 교체됨.",
        ),
    }

    # Causal graph: drivers fan into sizing → degradation-adjusted yearly
    # fuel + carbon + O&M + stack swaps → LCOE / NPV / break-even.
    graph = SimGraph(
        nodes=(
            # Drivers
            GraphNode("system_capex_usd_per_kw", "Capex $/kW", "driver", "System", "$/kW"),
            GraphNode("system_efficiency_pct_lhv", "Efficiency", "driver", "System", "%LHV"),
            GraphNode("system_size_mw", "Size", "driver", "System", "MW"),
            GraphNode("capacity_factor_pct", "Capacity factor", "driver", "System", "%"),
            GraphNode("stack_lifetime_years", "Stack lifetime", "driver", "Stack", "yr"),
            GraphNode("stack_replacement_cost_usd_per_kw", "Stack replace $/kW", "driver", "Stack", "$/kW"),
            GraphNode("degradation_pct_per_year", "Degradation", "driver", "Stack", "%/yr"),
            GraphNode("natural_gas_price_usd_per_mmbtu", "NG price", "driver", "Fuel", "$/MMBtu"),
            GraphNode("fuel_carbon_intensity_kg_co2_per_mmbtu", "Fuel CO₂", "driver", "Fuel", "kg/MMBtu"),
            GraphNode("annual_om_pct_of_capex", "O&M / capex", "driver", "Operations", "%/yr"),
            GraphNode("discount_rate_pct", "Discount rate", "driver", "Economics", "%"),
            GraphNode("carbon_price_usd_per_ton_co2", "Carbon price", "driver", "Economics", "$/t"),
            GraphNode("grid_lcoe_usd_per_mwh", "Grid LCOE", "driver", "Economics", "$/MWh"),
            GraphNode("project_lifetime_years", "Project lifetime", "driver", "Economics", "yr"),

            # Intermediates
            GraphNode("size_kw", "Size (kW)", "intermediate", "Sizing", "kW",
                      description="MW × 1000"),
            GraphNode("capex_total", "Total capex", "intermediate", "Capex", "USD"),
            GraphNode("om_annual", "Annual O&M", "intermediate", "Capex", "USD"),
            GraphNode("effective_efficiency", "Effective efficiency / yr", "intermediate", "Trajectory", "%LHV"),
            GraphNode("annual_mwh", "Electricity / yr", "intermediate", "Trajectory", "MWh"),
            GraphNode("annual_fuel_mmbtu", "Fuel input / yr", "intermediate", "Trajectory", "MMBtu",
                      description="MWh × 3.412 ÷ efficiency"),
            GraphNode("annual_fuel_cost", "Fuel cost / yr", "intermediate", "Trajectory", "USD"),
            GraphNode("annual_emissions", "Emissions / yr", "intermediate", "Trajectory", "t CO₂"),
            GraphNode("annual_carbon_cost", "Carbon cost / yr", "intermediate", "Trajectory", "USD"),
            GraphNode("stack_replacement_cost", "Stack swaps / yr", "intermediate", "Trajectory", "USD"),
            GraphNode("sofc_yearly_cost", "SOFC cost / yr", "intermediate", "Trajectory", "USD"),
            GraphNode("grid_yearly_cost", "Grid cost / yr", "intermediate", "Trajectory", "USD"),

            # Outputs
            GraphNode("lcoe_usd_per_mwh", "LCOE", "output", "Outputs", "$/MWh"),
            GraphNode("system_capex_total_usd", "Capex (Y0)", "output", "Outputs", "USD"),
            GraphNode("npv_savings_vs_grid_usd", "NPV savings", "output", "Outputs", "USD"),
            GraphNode("break_even_year", "Break-even year", "output", "Outputs", "yr"),
        ),
        edges=(
            # Sizing
            GraphEdge("system_size_mw", "size_kw", "× 1000"),
            GraphEdge("size_kw", "capex_total", "× $/kW"),
            GraphEdge("system_capex_usd_per_kw", "capex_total", "×"),
            GraphEdge("capex_total", "om_annual", "× O&M%"),
            GraphEdge("annual_om_pct_of_capex", "om_annual", "×"),

            # Trajectories
            GraphEdge("system_efficiency_pct_lhv", "effective_efficiency", "× (1−deg)^t"),
            GraphEdge("degradation_pct_per_year", "effective_efficiency", "deg"),
            GraphEdge("size_kw", "annual_mwh", "× CF × 8760h"),
            GraphEdge("capacity_factor_pct", "annual_mwh", "×"),
            GraphEdge("annual_mwh", "annual_fuel_mmbtu", "× 3.412 ÷ η"),
            GraphEdge("effective_efficiency", "annual_fuel_mmbtu", "÷ η"),
            GraphEdge("annual_fuel_mmbtu", "annual_fuel_cost", "× $/MMBtu"),
            GraphEdge("natural_gas_price_usd_per_mmbtu", "annual_fuel_cost", "×"),
            GraphEdge("annual_fuel_mmbtu", "annual_emissions", "× kg/MMBtu ÷ 1000"),
            GraphEdge("fuel_carbon_intensity_kg_co2_per_mmbtu", "annual_emissions", "×"),
            GraphEdge("annual_emissions", "annual_carbon_cost", "× $/t"),
            GraphEdge("carbon_price_usd_per_ton_co2", "annual_carbon_cost", "×"),
            GraphEdge("size_kw", "stack_replacement_cost", "× $/kW each cycle"),
            GraphEdge("stack_replacement_cost_usd_per_kw", "stack_replacement_cost", "×"),
            GraphEdge("stack_lifetime_years", "stack_replacement_cost", "cadence"),

            # Total SOFC cost trajectory
            GraphEdge("capex_total", "sofc_yearly_cost", "year 0 only"),
            GraphEdge("annual_fuel_cost", "sofc_yearly_cost", "+"),
            GraphEdge("annual_carbon_cost", "sofc_yearly_cost", "+"),
            GraphEdge("om_annual", "sofc_yearly_cost", "+"),
            GraphEdge("stack_replacement_cost", "sofc_yearly_cost", "+"),

            # Grid baseline
            GraphEdge("annual_mwh", "grid_yearly_cost", "× LCOE"),
            GraphEdge("grid_lcoe_usd_per_mwh", "grid_yearly_cost", "×"),

            # Outputs
            GraphEdge("sofc_yearly_cost", "lcoe_usd_per_mwh", "NPV ÷"),
            GraphEdge("annual_mwh", "lcoe_usd_per_mwh", "NPV ÷"),
            GraphEdge("discount_rate_pct", "lcoe_usd_per_mwh", "discount"),
            GraphEdge("capex_total", "system_capex_total_usd", "="),
            GraphEdge("sofc_yearly_cost", "npv_savings_vs_grid_usd", "Σ discount"),
            GraphEdge("grid_yearly_cost", "npv_savings_vs_grid_usd", "Σ discount"),
            GraphEdge("discount_rate_pct", "npv_savings_vs_grid_usd", "discount"),
            GraphEdge("project_lifetime_years", "npv_savings_vs_grid_usd", "horizon"),
            GraphEdge("sofc_yearly_cost", "break_even_year", "cumulative"),
            GraphEdge("grid_yearly_cost", "break_even_year", "cumulative"),
        ),
    )

    def simulate(self, **kwargs: float) -> dict[str, Output]:
        v = self.resolve_drivers(kwargs)
        # Project life capped by horizon.
        proj_years = int(round(min(v["project_lifetime_years"], self.horizon_years)))
        n = proj_years + 1
        years = range(n)

        size_kw = v["system_size_mw"] * 1000.0
        cf = v["capacity_factor_pct"] / 100.0
        deg = v["degradation_pct_per_year"] / 100.0
        ng_price = v["natural_gas_price_usd_per_mmbtu"]
        co2_intensity = v["fuel_carbon_intensity_kg_co2_per_mmbtu"]
        carbon_price = v["carbon_price_usd_per_ton_co2"]
        om_pct = v["annual_om_pct_of_capex"] / 100.0
        capex_per_kw = v["system_capex_usd_per_kw"]
        stack_replace_per_kw = v["stack_replacement_cost_usd_per_kw"]
        stack_life = max(1, int(round(v["stack_lifetime_years"])))
        r = v["discount_rate_pct"] / 100.0
        grid_lcoe = v["grid_lcoe_usd_per_mwh"]

        # Year-0 capex.
        capex_total = capex_per_kw * size_kw
        om_annual = capex_total * om_pct

        effective_efficiency_pct = [
            v["system_efficiency_pct_lhv"] * (1.0 - deg) ** t for t in years
        ]
        # MWh delivered per year = nameplate × hours × CF (efficiency only affects fuel input).
        annual_mwh = [size_kw * 24.0 * 365.0 * cf / 1000.0 for _ in years]
        # Fuel input in MMBtu = electricity MWh × 3.412 / efficiency.
        annual_fuel_mmbtu = [
            (annual_mwh[t] * MMBTU_PER_MWH) / max(effective_efficiency_pct[t] / 100.0, 1e-6)
            for t in years
        ]
        annual_fuel_cost = [annual_fuel_mmbtu[t] * ng_price for t in years]
        annual_emissions_tons = [
            annual_fuel_mmbtu[t] * co2_intensity / 1000.0 for t in years
        ]
        annual_carbon_cost = [annual_emissions_tons[t] * carbon_price for t in years]

        # Stack replacement: at every multiple of stack_life (excluding year 0).
        stack_replacement_cost = [
            stack_replace_per_kw * size_kw if (t > 0 and t % stack_life == 0) else 0.0
            for t in years
        ]

        # Total SOFC annual cost: capex at t=0, plus opex (fuel + carbon + O&M + stack swaps).
        sofc_yearly_cost = [
            (capex_total if t == 0 else 0.0)
            + annual_fuel_cost[t]
            + annual_carbon_cost[t]
            + om_annual
            + stack_replacement_cost[t]
            for t in years
        ]

        # Grid baseline: pay grid_lcoe × MWh consumed each year (no upfront).
        grid_yearly_cost = [annual_mwh[t] * grid_lcoe for t in years]

        # Cumulative trajectories.
        cum_sofc, cum_grid = [], []
        a, b = 0.0, 0.0
        for t in years:
            a += sofc_yearly_cost[t]
            b += grid_yearly_cost[t]
            cum_sofc.append(a)
            cum_grid.append(b)

        # LCOE = NPV(cost) / NPV(output).
        npv_cost = sum(sofc_yearly_cost[t] / ((1.0 + r) ** t) for t in years)
        npv_mwh = sum(annual_mwh[t] / ((1.0 + r) ** t) for t in years)
        lcoe = npv_cost / npv_mwh if npv_mwh > 1e-6 else float("inf")

        # NPV savings vs grid (positive = SOFC cheaper).
        npv_savings = sum(
            (grid_yearly_cost[t] - sofc_yearly_cost[t]) / ((1.0 + r) ** t) for t in years
        )

        # Break-even year (smallest t where cum_sofc <= cum_grid).
        break_even = -1.0
        for t in years:
            if cum_sofc[t] <= cum_grid[t]:
                break_even = float(t)
                break

        return {
            "lcoe_usd_per_mwh": Output(
                scalar=lcoe,
                unit="$/MWh",
                description=(
                    "Levelized cost of electricity (NPV 비용 ÷ NPV 발전량). "
                    "Grid LCOE 대비 낮으면 SOFC 우위."
                ),
            ),
            "system_capex_total_usd": Output(
                scalar=capex_total,
                unit="USD",
                description="Year-0 총 capex (size × $/kW).",
            ),
            "npv_savings_vs_grid_usd": Output(
                scalar=npv_savings,
                unit="USD",
                description=(
                    "프로젝트 수명간 grid baseline 대비 NPV 절감액. "
                    "양수=SOFC 경제적, 음수=grid 우위."
                ),
            ),
            "break_even_year": Output(
                scalar=break_even,
                unit="yr",
                description=(
                    "누적 SOFC 비용이 누적 grid 비용을 처음으로 따라잡는 해. "
                    "-1이면 수명 내 미달성."
                ),
            ),
            "effective_efficiency_pct": Output(
                series=effective_efficiency_pct,
                unit="%LHV",
                description="degradation 적용 연도별 실효 효율.",
            ),
            "annual_electricity_output_mwh": Output(
                series=annual_mwh,
                unit="MWh",
                description="연간 전력 출력 (CF × 정격 × 8760h).",
            ),
            "annual_fuel_cost_usd": Output(
                series=annual_fuel_cost,
                unit="USD",
                description="연간 천연가스 (또는 H2) 연료비.",
            ),
            "annual_carbon_cost_usd": Output(
                series=annual_carbon_cost,
                unit="USD",
                description="연간 탄소 비용 = 배출량 × carbon price.",
            ),
            "cumulative_cost_sofc_usd": Output(
                series=cum_sofc,
                unit="USD",
                description="SOFC 누적 비용 (capex 선반영 + 운영비 + 스택 교체).",
            ),
            "cumulative_cost_grid_usd": Output(
                series=cum_grid,
                unit="USD",
                description="같은 전력량을 grid에서 구매 시 누적 비용.",
            ),
        }
