"""Fusion Power (DT tokamak class) techno-economic LCOE model.

Planning-grade model representative of SPARC / ARC / ITER FOAK plants —
a 500 MW thermal class DT tokamak with high-field HTS magnets, breeding
blanket, and first-wall replacement cycle. Computes LCOE, NPV vs grid,
and break-even year over a 40-year project life with periodic first-
wall + blanket replacement at the end of each fluence lifetime.

Conventions
-----------
- Thermal power in MW; electric output = thermal × thermal_to_electric_pct.
- Duty cycle accounts for plasma availability + maintenance windows.
- First-wall + breeding blanket replaced at every multiple of
  `first_wall_lifetime_fpy` (full-power years), at `replacement_pct_of_capex`
  of original capex.
- Tritium fuel cost is small (kg/yr at ~$30k/g — but DT plants self-breed
  with TBR > 1.0). We model net tritium *purchase* as max(0, 1 - TBR) ×
  consumption.
- LCOE = NPV(annual costs incl. capex Y0) / NPV(annual MWh).
- Break-even year vs grid_lcoe baseline.
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


# 1 GW-y thermal DT plasma consumes ~56 kg of tritium (~150 g/MW-y).
TRITIUM_KG_PER_MWY_THERMAL = 0.15


class FusionPowerSim(SimulationBase):
    slug = "fusion-power"
    name = "Fusion Power (DT tokamak)"
    description = (
        "DT 토카막 핵융합 발전소의 40년 LCOE 시뮬레이션 — capex / 자기장 강도 / "
        "First-wall 수명 / 삼중수소 증식비 / 가동률을 조절해 grid baseline 대비 "
        "NPV 절감액과 break-even 시점을 확인합니다."
    )
    horizon_years = 40

    drivers = {
        # --- Plant ---
        "plant_thermal_mw": Driver(
            default=500.0,
            range=(100.0, 2000.0),
            unit="MW_th",
            description="플라즈마 열출력. SPARC 140, ITER 500, ARC 525, DEMO 2000.",
            group="Plant",
        ),
        "thermal_to_electric_pct": Driver(
            default=40.0,
            range=(25.0, 50.0),
            unit="%",
            description="열→전기 변환 효율. 헬륨 브레이튼 ~40%, 초임계 CO₂ 45%+.",
            group="Plant",
        ),
        "duty_cycle_pct": Driver(
            default=75.0,
            range=(20.0, 95.0),
            unit="%",
            description="연간 가동률. FOAK 50-70%, 성숙기 90%+.",
            group="Plant",
        ),
        "plant_capex_usd_per_kw_e": Driver(
            default=10000.0,
            range=(3000.0, 25000.0),
            unit="$/kW_e",
            description="설치 capex ($/kW 전기). FOAK ~$15k, 성숙기 $5k 목표.",
            group="Plant",
        ),
        # --- Magnets + plasma ---
        "magnet_field_strength_t": Driver(
            default=12.0,
            range=(5.0, 20.0),
            unit="T",
            description="중앙장 강도. SPARC 12T, ARC 9T, DEMO 13T+. 높을수록 plant 소형화.",
            group="Plasma",
        ),
        # --- Fuel cycle ---
        "tritium_breeding_ratio": Driver(
            default=1.05,
            range=(0.7, 1.4),
            unit="ratio",
            description="자체 증식비 (TBR). <1 외부 구매 필요, ≥1.05 self-sufficient.",
            group="Fuel",
        ),
        "tritium_price_usd_per_g": Driver(
            default=30000.0,
            range=(10000.0, 100000.0),
            unit="$/g",
            description="삼중수소 외부 시장 가격. CANDU 부산물 한정 공급.",
            group="Fuel",
        ),
        # --- First-wall + blanket ---
        "first_wall_lifetime_fpy": Driver(
            default=2.0,
            range=(0.5, 10.0),
            unit="FPY",
            description="중성자 손상 한계 도달까지 풀가동 연수. ITER 2 FPY, DEMO 5+.",
            group="Materials",
        ),
        "replacement_pct_of_capex": Driver(
            default=15.0,
            range=(5.0, 40.0),
            unit="%",
            description="First-wall + 블랭킷 교체 1회 비용 (capex 대비).",
            group="Materials",
        ),
        # --- Operations ---
        "annual_om_pct_of_capex": Driver(
            default=5.0,
            range=(1.0, 15.0),
            unit="%/yr",
            description="capex 대비 연간 O&M (운영진 + 보안 + 정비).",
            group="Operations",
        ),
        # --- Economics ---
        "discount_rate_pct": Driver(
            default=8.0,
            range=(0.0, 20.0),
            unit="%",
            description="WACC. FOAK 정부지원 6%, 민간 12%+.",
            group="Economics",
        ),
        "carbon_price_usd_per_ton_co2": Driver(
            default=80.0,
            range=(0.0, 300.0),
            unit="$/t",
            description="탄소 가격. EU ETS ~€90, US SCC ~$185. 융합은 0 배출.",
            group="Economics",
        ),
        "grid_lcoe_usd_per_mwh": Driver(
            default=100.0,
            range=(40.0, 350.0),
            unit="$/MWh",
            description="비교 baseline 전력 가격. 미국 평균 ~$80, 산업용 EU $150+.",
            group="Economics",
        ),
        "project_lifetime_years": Driver(
            default=40.0,
            range=(15.0, 60.0),
            unit="yr",
            description="플랜트 수명. FOAK 30년, 성숙기 60년 목표.",
            group="Economics",
        ),
    }

    presets: dict[str, dict[str, float]] = {
        "Baseline (FOAK 2035)": {},
        "Mature (2050)": {
            "plant_capex_usd_per_kw_e": 5000.0,
            "duty_cycle_pct": 90.0,
            "first_wall_lifetime_fpy": 5.0,
            "annual_om_pct_of_capex": 3.0,
            "discount_rate_pct": 6.0,
        },
        "Compact high-field (CFS SPARC class)": {
            "plant_thermal_mw": 140.0,
            "magnet_field_strength_t": 12.0,
            "plant_capex_usd_per_kw_e": 8000.0,
        },
        "ITER scale (slow)": {
            "plant_thermal_mw": 500.0,
            "duty_cycle_pct": 25.0,
            "plant_capex_usd_per_kw_e": 22000.0,
            "first_wall_lifetime_fpy": 1.5,
        },
    }

    provenance: dict[str, Provenance] = {
        "plant_thermal_mw": Provenance(
            history=_hist(
                [("JET (1991)", 16.0), ("ITER (2035E)", 500.0), ("ARC (paper)", 525.0)]
            ),
            sources=(
                Source(
                    title="Sorbom et al. — ARC reactor study (MIT PSFC)",
                    url="https://www.psfc.mit.edu/research/topics/arc",
                    excerpt="ARC: 525 MW fusion power demonstration.",
                    as_of="2015-Q1",
                    kind="paper",
                ),
                Source(
                    title="ITER Organization — plant overview",
                    url="https://www.iter.org/proj/inafewlines",
                    excerpt="ITER: 500 MW thermal fusion, Q ≥ 10.",
                    as_of="2024-Q4",
                    kind="gov_report",
                ),
            ),
            note="플라즈마 열출력. ITER 500MW를 기준선으로.",
        ),
        "thermal_to_electric_pct": Provenance(
            history=_hist([("Helium Brayton", 40.0), ("Supercritical CO2", 45.0)]),
            sources=(
                Source(
                    title="EUROfusion — power conversion options",
                    url="https://euro-fusion.org/",
                    excerpt="Helium Brayton 40%, sCO₂ 45-48% projected.",
                    as_of="2023-Q2",
                    kind="paper",
                ),
            ),
            note="2차 회로 열효율. sCO₂가 다음 세대 디폴트.",
        ),
        "tritium_breeding_ratio": Provenance(
            history=_hist(
                [("ITER initial", 0.0), ("ARC paper", 1.1), ("DEMO target", 1.15)]
            ),
            sources=(
                Source(
                    title="Sawan & Abdou — TBR requirements analysis",
                    url="https://doi.org/10.1016/j.fusengdes.2006.05.025",
                    excerpt="TBR ≥ 1.05 needed for tritium self-sufficiency.",
                    as_of="2006-Q1",
                    kind="paper",
                ),
                Source(
                    title="ARC reactor blanket design (MIT PSFC)",
                    url="https://www.psfc.mit.edu/research/topics/arc",
                    excerpt="FLiBe immersion blanket targets TBR 1.1+.",
                    as_of="2015-Q1",
                    kind="paper",
                ),
            ),
            note="자체 증식비. <1이면 외부 삼중수소 의존, 부담 큼.",
        ),
        "first_wall_lifetime_fpy": Provenance(
            history=_hist(
                [("ITER ELM regime", 1.0), ("ARC FLiBe (paper)", 5.0)]
            ),
            sources=(
                Source(
                    title="Bloom — FW/blanket lifetime limits (FNSF design)",
                    url="https://doi.org/10.1088/0029-5515/57/2/021502",
                    excerpt="Conventional FW: 1-2 FPY before neutron damage saturation.",
                    as_of="2017-Q1",
                    kind="paper",
                ),
            ),
            note="중성자 손상 한계. RAFM 강 ~2 FPY, ODS / liquid wall 5+.",
        ),
        "plant_capex_usd_per_kw_e": Provenance(
            history=_hist(
                [("ITER (sunk)", 30000.0), ("CFS SPARC est.", 8000.0), ("DEMO target", 5000.0)]
            ),
            sources=(
                Source(
                    title="Lindley et al. — Fusion plant cost benchmarking",
                    url="https://doi.org/10.1016/j.energy.2023.127935",
                    excerpt="FOAK fusion plant: $10-25k/kW_e cap.",
                    as_of="2023-Q3",
                    kind="paper",
                ),
                Source(
                    title="UKAEA STEP business case",
                    url="https://step.ukaea.uk/",
                    excerpt="STEP target: prototype by 2040 at competitive LCOE.",
                    as_of="2024-Q2",
                    kind="gov_report",
                ),
            ),
            note="FOAK 매우 비쌈; 양산 학습률 큰 변수.",
        ),
        "grid_lcoe_usd_per_mwh": Provenance(
            history=_hist([("2018", 75.0), ("2022", 95.0), ("2024", 105.0)]),
            sources=(
                Source(
                    title="Lazard Levelized Cost of Energy v17",
                    url="https://www.lazard.com/research-insights/levelized-cost-of-energyplus/",
                    excerpt="2024 unsubsidized grid LCOE band: $60-180/MWh.",
                    as_of="2024-Q3",
                    kind="analyst",
                ),
            ),
            note="비교 baseline. 산업용 retail/industrial rate 기준.",
        ),
    }

    graph = SimGraph(
        nodes=(
            # Drivers
            GraphNode("plant_thermal_mw", "Thermal MW", "driver", "Plant", "MW_th"),
            GraphNode("thermal_to_electric_pct", "Therm→Elec", "driver", "Plant", "%"),
            GraphNode("duty_cycle_pct", "Duty cycle", "driver", "Plant", "%"),
            GraphNode("plant_capex_usd_per_kw_e", "Capex $/kW_e", "driver", "Plant", "$/kW_e"),
            GraphNode("magnet_field_strength_t", "B-field", "driver", "Plasma", "T"),
            GraphNode("tritium_breeding_ratio", "TBR", "driver", "Fuel", "ratio"),
            GraphNode("tritium_price_usd_per_g", "T price", "driver", "Fuel", "$/g"),
            GraphNode("first_wall_lifetime_fpy", "FW lifetime", "driver", "Materials", "FPY"),
            GraphNode("replacement_pct_of_capex", "FW replace %", "driver", "Materials", "%"),
            GraphNode("annual_om_pct_of_capex", "O&M / capex", "driver", "Operations", "%/yr"),
            GraphNode("discount_rate_pct", "Discount rate", "driver", "Economics", "%"),
            GraphNode("carbon_price_usd_per_ton_co2", "Carbon price", "driver", "Economics", "$/t"),
            GraphNode("grid_lcoe_usd_per_mwh", "Grid LCOE", "driver", "Economics", "$/MWh"),
            GraphNode("project_lifetime_years", "Project lifetime", "driver", "Economics", "yr"),

            # Intermediates
            GraphNode("net_electric_mw", "Net electric MW", "intermediate", "Sizing", "MW_e"),
            GraphNode("capex_total", "Total capex", "intermediate", "Capex", "USD"),
            GraphNode("om_annual", "Annual O&M", "intermediate", "Capex", "USD"),
            GraphNode("annual_mwh", "Electricity / yr", "intermediate", "Trajectory", "MWh"),
            GraphNode("tritium_consumption_kg_y", "Tritium / yr", "intermediate", "Trajectory", "kg"),
            GraphNode("annual_fuel_cost", "Fuel cost / yr", "intermediate", "Trajectory", "USD"),
            GraphNode("wall_replacement_cost", "Wall swap / yr", "intermediate", "Trajectory", "USD"),
            GraphNode("fusion_yearly_cost", "Plant cost / yr", "intermediate", "Trajectory", "USD"),
            GraphNode("grid_yearly_cost", "Grid cost / yr", "intermediate", "Trajectory", "USD"),

            # Outputs
            GraphNode("lcoe_usd_per_mwh", "LCOE", "output", "Outputs", "$/MWh"),
            GraphNode("net_electric_capacity_mw", "Net capacity", "output", "Outputs", "MW_e"),
            GraphNode("npv_savings_vs_grid_usd", "NPV savings", "output", "Outputs", "USD"),
            GraphNode("break_even_year", "Break-even year", "output", "Outputs", "yr"),
        ),
        edges=(
            GraphEdge("plant_thermal_mw", "net_electric_mw", "× η_th2e"),
            GraphEdge("thermal_to_electric_pct", "net_electric_mw", "×"),
            GraphEdge("net_electric_mw", "capex_total", "× $/kW × 1000"),
            GraphEdge("plant_capex_usd_per_kw_e", "capex_total", "×"),
            GraphEdge("capex_total", "om_annual", "× O&M%"),
            GraphEdge("annual_om_pct_of_capex", "om_annual", "×"),
            GraphEdge("net_electric_mw", "annual_mwh", "× duty × 8760"),
            GraphEdge("duty_cycle_pct", "annual_mwh", "×"),
            GraphEdge("plant_thermal_mw", "tritium_consumption_kg_y", "× 0.15 kg/MW-y"),
            GraphEdge("duty_cycle_pct", "tritium_consumption_kg_y", "×"),
            GraphEdge("tritium_consumption_kg_y", "annual_fuel_cost", "× max(0,1-TBR) × $/g"),
            GraphEdge("tritium_breeding_ratio", "annual_fuel_cost", "× (1-TBR)"),
            GraphEdge("tritium_price_usd_per_g", "annual_fuel_cost", "×"),
            GraphEdge("capex_total", "wall_replacement_cost", "× replace% every FW life"),
            GraphEdge("replacement_pct_of_capex", "wall_replacement_cost", "×"),
            GraphEdge("first_wall_lifetime_fpy", "wall_replacement_cost", "cadence"),

            GraphEdge("capex_total", "fusion_yearly_cost", "year 0 only"),
            GraphEdge("annual_fuel_cost", "fusion_yearly_cost", "+"),
            GraphEdge("om_annual", "fusion_yearly_cost", "+"),
            GraphEdge("wall_replacement_cost", "fusion_yearly_cost", "+"),

            GraphEdge("annual_mwh", "grid_yearly_cost", "× grid LCOE"),
            GraphEdge("grid_lcoe_usd_per_mwh", "grid_yearly_cost", "×"),
            GraphEdge("carbon_price_usd_per_ton_co2", "grid_yearly_cost", "+ baseline carbon"),

            GraphEdge("fusion_yearly_cost", "lcoe_usd_per_mwh", "NPV ÷"),
            GraphEdge("annual_mwh", "lcoe_usd_per_mwh", "NPV ÷"),
            GraphEdge("discount_rate_pct", "lcoe_usd_per_mwh", "discount"),
            GraphEdge("net_electric_mw", "net_electric_capacity_mw", "="),
            GraphEdge("fusion_yearly_cost", "npv_savings_vs_grid_usd", "Σ discount"),
            GraphEdge("grid_yearly_cost", "npv_savings_vs_grid_usd", "Σ discount"),
            GraphEdge("discount_rate_pct", "npv_savings_vs_grid_usd", "discount"),
            GraphEdge("project_lifetime_years", "npv_savings_vs_grid_usd", "horizon"),
            GraphEdge("fusion_yearly_cost", "break_even_year", "cumulative"),
            GraphEdge("grid_yearly_cost", "break_even_year", "cumulative"),
        ),
    )

    def simulate(self, **kwargs: float) -> dict[str, Output]:
        v = self.resolve_drivers(kwargs)
        proj_years = int(round(min(v["project_lifetime_years"], self.horizon_years)))
        n = proj_years + 1
        years = range(n)

        # Sizing.
        net_electric_mw = v["plant_thermal_mw"] * v["thermal_to_electric_pct"] / 100.0
        net_electric_kw = net_electric_mw * 1000.0
        duty = v["duty_cycle_pct"] / 100.0
        annual_mwh_const = net_electric_mw * duty * 8760.0  # MW × hr → MWh
        annual_mwh = [annual_mwh_const for _ in years]

        # Capex + O&M.
        capex_total = v["plant_capex_usd_per_kw_e"] * net_electric_kw
        om_annual = capex_total * v["annual_om_pct_of_capex"] / 100.0

        # Tritium fuel — only buy if TBR < 1.
        thermal_mw_y = v["plant_thermal_mw"] * duty
        annual_tritium_consumption_kg = thermal_mw_y * TRITIUM_KG_PER_MWY_THERMAL
        tritium_shortfall = max(0.0, 1.0 - v["tritium_breeding_ratio"])
        annual_tritium_purchase_kg = annual_tritium_consumption_kg * tritium_shortfall
        annual_fuel_cost = [
            annual_tritium_purchase_kg * 1000.0 * v["tritium_price_usd_per_g"]
            for _ in years
        ]

        # First-wall + blanket replacement.
        fw_life = max(0.5, v["first_wall_lifetime_fpy"])
        fw_calendar_years_per_swap = max(1, int(round(fw_life / max(duty, 0.05))))
        replacement_single_cost = capex_total * v["replacement_pct_of_capex"] / 100.0
        wall_replacement_cost = [
            replacement_single_cost
            if (t > 0 and t % fw_calendar_years_per_swap == 0)
            else 0.0
            for t in years
        ]

        # Total fusion plant annual cost.
        fusion_yearly_cost = [
            (capex_total if t == 0 else 0.0)
            + annual_fuel_cost[t]
            + om_annual
            + wall_replacement_cost[t]
            for t in years
        ]

        # Grid baseline — pay grid_lcoe × MWh consumed. Carbon price implicitly
        # raises grid LCOE; we model it as additive shift on the grid side.
        carbon_uplift_per_mwh = v["carbon_price_usd_per_ton_co2"] * 0.45  # ~0.45 t CO2/MWh average grid
        effective_grid_lcoe = v["grid_lcoe_usd_per_mwh"] + carbon_uplift_per_mwh
        grid_yearly_cost = [annual_mwh[t] * effective_grid_lcoe for t in years]

        # Cumulative trajectories.
        cum_fusion, cum_grid = [], []
        a, b = 0.0, 0.0
        for t in years:
            a += fusion_yearly_cost[t]
            b += grid_yearly_cost[t]
            cum_fusion.append(a)
            cum_grid.append(b)

        # LCOE.
        r = v["discount_rate_pct"] / 100.0
        npv_cost = sum(fusion_yearly_cost[t] / ((1.0 + r) ** t) for t in years)
        npv_mwh = sum(annual_mwh[t] / ((1.0 + r) ** t) for t in years)
        lcoe = npv_cost / npv_mwh if npv_mwh > 1e-6 else float("inf")

        npv_savings = sum(
            (grid_yearly_cost[t] - fusion_yearly_cost[t]) / ((1.0 + r) ** t)
            for t in years
        )

        # Break-even.
        break_even = -1.0
        for t in years:
            if cum_fusion[t] <= cum_grid[t]:
                break_even = float(t)
                break

        return {
            "lcoe_usd_per_mwh": Output(
                scalar=lcoe,
                unit="$/MWh",
                description=(
                    "Levelized cost of electricity (NPV 비용 ÷ NPV 발전량). "
                    "Grid effective LCOE 대비 낮으면 fusion 우위."
                ),
            ),
            "net_electric_capacity_mw": Output(
                scalar=net_electric_mw,
                unit="MW_e",
                description="순전기 출력 = thermal × η_th2e.",
            ),
            "npv_savings_vs_grid_usd": Output(
                scalar=npv_savings,
                unit="USD",
                description=(
                    "프로젝트 수명간 grid baseline 대비 NPV 절감액. "
                    "양수=fusion 경제적, 음수=grid 우위."
                ),
            ),
            "break_even_year": Output(
                scalar=break_even,
                unit="yr",
                description=(
                    "누적 fusion 비용이 누적 grid 비용을 처음 따라잡는 해. "
                    "-1이면 수명 내 미달성."
                ),
            ),
            "annual_electricity_output_mwh": Output(
                series=annual_mwh,
                unit="MWh",
                description="연간 전력 출력 (net electric × duty × 8760h).",
            ),
            "annual_fuel_cost_usd": Output(
                series=annual_fuel_cost,
                unit="USD",
                description=(
                    "연간 외부 삼중수소 구매비. TBR ≥ 1이면 0; TBR < 1이면 "
                    "부족분 × 시장 가격."
                ),
            ),
            "wall_replacement_cost_usd": Output(
                series=wall_replacement_cost,
                unit="USD",
                description="First-wall + 블랭킷 주기적 교체 비용.",
            ),
            "cumulative_cost_fusion_usd": Output(
                series=cum_fusion,
                unit="USD",
                description="Fusion 누적 비용 (capex Y0 + 운영비 + wall swap).",
            ),
            "cumulative_cost_grid_usd": Output(
                series=cum_grid,
                unit="USD",
                description="같은 전력량을 grid에서 구매 시 누적 비용.",
            ),
        }
