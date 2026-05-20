"""Orbital data-center economic + technical feasibility simulation.

Planning-grade back-of-envelope model. The system is sized for a target PFLOPS
capacity at year 0 — solar panels, radiators, and an overhead factor for
structure / ADCS / propellant give a launch mass, then launch + chip hardware
costs roll up to capex. Effective compute degrades over the mission lifetime
(panel + chip degradation) and operating cost is compared against a terrestrial
$/PFLOPS-year baseline. NPV (vs ground) and the year at which cumulative space
cost overtakes cumulative ground cost ("break-even year") are surfaced.

Conventions
-----------
- All masses in kg, all costs in USD.
- "PFLOPS" is treated as a single planning unit; `chip_pflops_per_kw` is the
  compute-per-power ratio (≈ TOPS/W if 1 PFLOPS = 1000 TOPS).
- Solar duty cycle abstracts orbit + battery sizing — panels must produce
  `chip_power_kw / duty_cycle` peak so the average matches load.
- Deterministic: same drivers → same outputs (caching invariant per CLAUDE.md).
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
    "Seeded demo provenance. Phase 2에서 data-pipeline-service를 통해 실제 소스로 교체."
)


class SpaceDataCenterSim(SimulationBase):
    slug = "space-data-center"
    name = "Space Data Center"
    description = (
        "궤도 위 데이터센터의 기술/경제 타당성을 시뮬레이션합니다. "
        "발사 비용, 패널 효율, 칩 효율, 열관리, 미션 수명을 조절해 "
        "지상 데이터센터 baseline 대비 NPV와 break-even year를 확인합니다."
    )
    horizon_years = 15

    drivers = {
        # --- Launch ---
        "launch_cost_usd_per_kg": Driver(
            default=1500.0,
            range=(200.0, 5000.0),
            unit="$/kg",
            description="LEO/GEO 도달 비용. Falcon 9 ~$2.7k, Starship 목표 ~$200-500.",
            group="Launch",
        ),
        "payload_overhead_factor": Driver(
            default=1.6,
            range=(1.1, 3.0),
            unit="x",
            description="구조/ADCS/추진제 등 dry mass 위의 launch mass 배수.",
            group="Launch",
        ),
        # --- Compute ---
        "compute_demand_pflops": Driver(
            default=10.0,
            range=(1.0, 1000.0),
            unit="PFLOPS",
            description="Year 0 목표 effective 컴퓨팅 용량.",
            group="Compute",
        ),
        "chip_pflops_per_kw": Driver(
            default=40.0,
            range=(5.0, 200.0),
            unit="PFLOPS/kW",
            description="칩 전력 효율. H100 세대 ≈ 40, 차세대 가속기 추정 100+.",
            group="Compute",
        ),
        "chip_capex_usd_per_pflops": Driver(
            default=250000.0,
            range=(50000.0, 2000000.0),
            unit="$/PFLOPS",
            description="컴퓨팅 하드웨어 단가 (보드+냉각판 포함).",
            group="Compute",
        ),
        "chip_radiation_degradation_pct_per_year": Driver(
            default=3.0,
            range=(0.0, 15.0),
            unit="%/yr",
            description="우주 방사선에 의한 칩 성능 저하율.",
            group="Compute",
        ),
        # --- Power ---
        "panel_efficiency_w_per_kg": Driver(
            default=150.0,
            range=(50.0, 500.0),
            unit="W/kg",
            description="태양 전지판 비출력. ISS급 ≈ 80, ROSA ≈ 150, 차세대 박막 ≈ 300+.",
            group="Power",
        ),
        "panel_degradation_pct_per_year": Driver(
            default=2.0,
            range=(0.0, 10.0),
            unit="%/yr",
            description="UV/방사선 노출에 의한 패널 출력 저하율.",
            group="Power",
        ),
        "solar_duty_cycle": Driver(
            default=0.65,
            range=(0.3, 1.0),
            unit="ratio",
            description="궤도+배터리 보정 후 실효 일조율. LEO ≈ 0.6, GEO ≈ 0.99.",
            group="Power",
        ),
        # --- Thermal ---
        "radiator_kg_per_kw_heat": Driver(
            default=25.0,
            range=(5.0, 100.0),
            unit="kg/kW",
            description="복사 방열판 비질량. 우주에선 공랭이 불가능해 무게가 큰 변수.",
            group="Thermal",
        ),
        # --- Economics ---
        "mission_lifetime_years": Driver(
            default=10.0,
            range=(3.0, 15.0),
            unit="yr",
            description="운영 기간. 미션 종료 시 deorbit 가정 (잔존가치 0).",
            group="Economics",
        ),
        "annual_opex_pct_of_capex": Driver(
            default=5.0,
            range=(1.0, 25.0),
            unit="%/yr",
            description="capex 대비 연간 운영비 (지상국, 통신, station-keeping).",
            group="Economics",
        ),
        "discount_rate_pct": Driver(
            default=8.0,
            range=(0.0, 20.0),
            unit="%",
            description="NPV 계산 할인율.",
            group="Economics",
        ),
        "ground_baseline_cost_per_pflops_year_usd": Driver(
            default=800000.0,
            range=(50000.0, 5000000.0),
            unit="$/PFLOPS·yr",
            description="지상 데이터센터의 동일 컴퓨팅 1년 운영 비용 (전력+감가+ops).",
            group="Economics",
        ),
    }

    presets: dict[str, dict[str, float]] = {
        "Baseline (2026)": {},  # all defaults
        "Optimistic (Starship era)": {
            "launch_cost_usd_per_kg": 300.0,
            "panel_efficiency_w_per_kg": 300.0,
            "chip_pflops_per_kw": 100.0,
            "chip_capex_usd_per_pflops": 120000.0,
            "radiator_kg_per_kw_heat": 12.0,
            "ground_baseline_cost_per_pflops_year_usd": 600000.0,
        },
        "Pessimistic": {
            "launch_cost_usd_per_kg": 3500.0,
            "panel_efficiency_w_per_kg": 90.0,
            "chip_pflops_per_kw": 25.0,
            "chip_radiation_degradation_pct_per_year": 6.0,
            "panel_degradation_pct_per_year": 4.0,
            "radiator_kg_per_kw_heat": 50.0,
            "annual_opex_pct_of_capex": 10.0,
            "ground_baseline_cost_per_pflops_year_usd": 1_200_000.0,
        },
        "Edge inference (small sat)": {
            "compute_demand_pflops": 2.0,
            "mission_lifetime_years": 5.0,
            "annual_opex_pct_of_capex": 8.0,
        },
    }

    # Historical points + citations per driver. Demo seed data — Phase 2 will
    # replace these via data-pipeline-service hooks.
    provenance: dict[str, Provenance] = {
        "launch_cost_usd_per_kg": Provenance(
            history=_hist(
                [
                    ("2010", 12000.0),
                    ("2015", 4500.0),
                    ("2018", 2720.0),
                    ("2021", 2500.0),
                    ("2024", 1500.0),
                    ("2026E", 800.0),
                ]
            ),
            sources=(
                Source(
                    title="FAA Commercial Space Transportation: Year in Review",
                    url="https://www.faa.gov/space/additional_information/cst_reports",
                    excerpt="Falcon 9 rideshare achieves ~$2.7k/kg LEO as of 2022.",
                    as_of="2024-Q1",
                    kind="gov_report",
                ),
                Source(
                    title="SpaceX Starship capability statements",
                    url="https://www.spacex.com/vehicles/starship/",
                    excerpt="Target operational cost: $200-500/kg LEO.",
                    as_of="2024-Q3",
                    kind="vendor_doc",
                ),
            ),
            note="LEO 진입 cost는 2010년 대비 8배 감소. Starship으로 추가 감소 전망.",
        ),
        "payload_overhead_factor": Provenance(
            history=_hist([("2015", 2.0), ("2020", 1.8), ("2024", 1.6), ("2027E", 1.4)]),
            sources=(
                Source(
                    title="NASA Spacecraft Bus Mass Breakdown (planning factor)",
                    url="https://ntrs.nasa.gov/",
                    excerpt="Structure+ADCS+propellant typically 40-80% of payload dry mass.",
                    as_of="2023-Q4",
                    kind="gov_report",
                ),
            ),
            note="버스 mass 비율은 점진적으로 감소 (구조 경량화 + electric propulsion).",
        ),
        "compute_demand_pflops": Provenance(
            history=_hist([("2024", 5.0), ("2025", 8.0), ("2026E", 10.0), ("2027E", 25.0)]),
            sources=(
                Source(
                    title="Hyperscaler GPU footprint estimates",
                    url="https://example.com/hyperscaler-gpu-estimates",
                    excerpt="Edge inference workloads sized 1-50 PFLOPS per orbital node.",
                    as_of="2025-Q2",
                    kind="analyst",
                ),
            ),
            note="섹터 규모 가정. 사용자 시나리오에 따라 조정 가능.",
        ),
        "chip_pflops_per_kw": Provenance(
            history=_hist(
                [
                    ("2016", 5.0),
                    ("2018", 10.0),
                    ("2020", 18.0),
                    ("2022", 28.0),
                    ("2024", 40.0),
                    ("2026E", 65.0),
                ]
            ),
            sources=(
                Source(
                    title="NVIDIA H100 datasheet",
                    url="https://www.nvidia.com/en-us/data-center/h100/",
                    excerpt="~40 BF16 PFLOPS/kW at SXM5 700W TDP.",
                    as_of="2024-Q3",
                    kind="vendor_doc",
                ),
                Source(
                    title="MLPerf v4 trends",
                    url="https://mlcommons.org/benchmarks/",
                    excerpt="Perf/W 2x every ~24mo on recent accelerator generations.",
                    as_of="2024-Q4",
                    kind="benchmark",
                ),
            ),
            note="가속기 perf/W는 2년마다 약 2배. 차세대(2026E) ~65 PFLOPS/kW 추정.",
        ),
        "chip_capex_usd_per_pflops": Provenance(
            history=_hist(
                [
                    ("2020", 800_000.0),
                    ("2022", 500_000.0),
                    ("2024", 250_000.0),
                    ("2026E", 150_000.0),
                ]
            ),
            sources=(
                Source(
                    title="Hyperscaler GPU procurement (analyst estimates)",
                    url="https://example.com/gpu-procurement",
                    excerpt=(
                        "H100 SXM5 ~$30k street price / ~2 PFLOPS FP16 ≈ $15k/PFLOPS "
                        "chip-only; rack+integration 적용 시 약 $250k/PFLOPS."
                    ),
                    as_of="2024-Q4",
                    kind="analyst",
                ),
            ),
            note="보드+전원+냉각 통합 단가. 칩-only 가격과 구분.",
        ),
        "chip_radiation_degradation_pct_per_year": Provenance(
            history=_hist([("2020", 5.0), ("2024", 3.0), ("2027E", 2.0)]),
            sources=(
                Source(
                    title="ESA Total Ionizing Dose effects on commercial silicon",
                    url="https://www.esa.int/",
                    excerpt=(
                        "Commercial 7nm logic shows 2-5%/yr perf loss at LEO TID rates "
                        "with adequate shielding."
                    ),
                    as_of="2023-Q2",
                    kind="paper",
                ),
            ),
            note="방사선 차폐 + radiation-hardened 설계로 감소 추세.",
        ),
        "panel_efficiency_w_per_kg": Provenance(
            history=_hist(
                [
                    ("2000", 40.0),
                    ("2010", 80.0),
                    ("2018", 120.0),
                    ("2022", 150.0),
                    ("2026E", 250.0),
                ]
            ),
            sources=(
                Source(
                    title="NASA ROSA (Roll-Out Solar Array) performance",
                    url="https://www1.grc.nasa.gov/space/sep/",
                    excerpt="ROSA achieves ~150 W/kg, next-gen target 300+ W/kg.",
                    as_of="2024-Q2",
                    kind="gov_report",
                ),
            ),
            note="박막 + roll-out 구조로 비출력 빠르게 상승 중.",
        ),
        "panel_degradation_pct_per_year": Provenance(
            history=_hist([("2010", 4.0), ("2020", 2.5), ("2024", 2.0)]),
            sources=(
                Source(
                    title="NREL outdoor PV degradation meta-analysis",
                    url="https://www.nrel.gov/",
                    excerpt="LEO 환경에서 multi-junction GaAs 패널 평균 1.5-3%/yr.",
                    as_of="2023-Q4",
                    kind="paper",
                ),
            ),
            note="LEO 방사선 환경 가정. GEO는 더 낮음.",
        ),
        "solar_duty_cycle": Provenance(
            history=_hist([("2020", 0.60), ("2024", 0.65), ("2026E", 0.70)]),
            sources=(
                Source(
                    title="LEO eclipse + battery sizing models",
                    url="https://example.com/leo-eclipse-models",
                    excerpt=(
                        "Sun-synchronous LEO: ~60% sunlit; battery buffering achieves "
                        "65-70% effective."
                    ),
                    as_of="2024-Q1",
                    kind="dataset",
                ),
            ),
            note="배터리 비중 증가로 실효 duty cycle 상승. GEO ≈ 0.99.",
        ),
        "radiator_kg_per_kw_heat": Provenance(
            history=_hist([("2015", 50.0), ("2020", 35.0), ("2024", 25.0), ("2027E", 15.0)]),
            sources=(
                Source(
                    title="AIAA: Two-phase radiator scaling for high-power spacecraft",
                    url="https://arc.aiaa.org/",
                    excerpt="Deployable two-phase loop: 20-30 kg/kW at 100 kW class.",
                    as_of="2023-Q1",
                    kind="paper",
                ),
            ),
            note="우주 냉각의 최대 mass 변수. 2-phase radiator로 감소 추세.",
        ),
        "mission_lifetime_years": Provenance(
            history=_hist([("2015", 5.0), ("2020", 7.0), ("2024", 10.0)]),
            sources=(
                Source(
                    title="NASA Heliophysics mission lifetime survey",
                    url="https://nasa.gov/heliophysics",
                    excerpt="LEO scientific missions: 5-15 year nominal lifetime.",
                    as_of="2023-Q3",
                    kind="dataset",
                ),
            ),
            note="실제 운영 기간. Deorbit 후 잔존가치 0 가정.",
        ),
        "annual_opex_pct_of_capex": Provenance(
            history=_hist([("2020", 8.0), ("2024", 5.0), ("2027E", 4.0)]),
            sources=(
                Source(
                    title="SpaceOps cost benchmarks",
                    url="https://example.com/spaceops-cost",
                    excerpt="지상국 + comms + station-keeping: typical 3-10% of capex annually.",
                    as_of="2024-Q2",
                    kind="benchmark",
                ),
            ),
            note="자동화 + ground station sharing으로 감소 추세.",
        ),
        "discount_rate_pct": Provenance(
            history=_hist([("2020", 5.0), ("2022", 7.0), ("2024", 8.0)]),
            sources=(
                Source(
                    title="WACC for early-stage space infrastructure (analyst)",
                    url="https://example.com/space-infra-wacc",
                    excerpt="Pre-revenue space infra typically discounted 7-12%.",
                    as_of="2024-Q4",
                    kind="analyst",
                ),
            ),
            note="자본비용. 시장 금리 + 섹터 리스크 프리미엄 반영.",
        ),
        "ground_baseline_cost_per_pflops_year_usd": Provenance(
            history=_hist(
                [
                    ("2020", 1_400_000.0),
                    ("2022", 1_000_000.0),
                    ("2024", 800_000.0),
                    ("2027E", 600_000.0),
                ]
            ),
            sources=(
                Source(
                    title="Hyperscaler PUE + GPU TCO breakdowns",
                    url="https://example.com/hyperscaler-pue-tco",
                    excerpt="$0.07/kWh + 1.15 PUE + 4yr GPU depreciation ≈ $800k/PFLOPS·yr.",
                    as_of="2024-Q3",
                    kind="analyst",
                ),
            ),
            note="지상 데이터센터의 fully-loaded $/PFLOPS·yr. 전력+감가+ops 포함.",
        ),
    }

    # Causal dependency graph — drivers → sizing → capex/opex →
    # degradation/cost trajectories → headline outputs. Mirrors the actual
    # flow in `simulate()`; edges are labelled with the multiplicative or
    # accumulative role so the UI can read like a back-of-envelope.
    graph = SimGraph(
        nodes=(
            # --- Driver nodes (kind="driver") echo the slider names so the
            # client can join them with the live driver values. ---
            GraphNode("launch_cost_usd_per_kg", "Launch $/kg", "driver", "Launch", "$/kg"),
            GraphNode("payload_overhead_factor", "Payload overhead", "driver", "Launch", "x"),
            GraphNode("compute_demand_pflops", "Compute demand", "driver", "Compute", "PFLOPS"),
            GraphNode("chip_pflops_per_kw", "Chip perf/W", "driver", "Compute", "PFLOPS/kW"),
            GraphNode("chip_capex_usd_per_pflops", "Chip $/PFLOPS", "driver", "Compute", "$/PFLOPS"),
            GraphNode("chip_radiation_degradation_pct_per_year", "Chip degradation", "driver", "Compute", "%/yr"),
            GraphNode("panel_efficiency_w_per_kg", "Panel W/kg", "driver", "Power", "W/kg"),
            GraphNode("panel_degradation_pct_per_year", "Panel degradation", "driver", "Power", "%/yr"),
            GraphNode("solar_duty_cycle", "Solar duty cycle", "driver", "Power", "ratio"),
            GraphNode("radiator_kg_per_kw_heat", "Radiator kg/kW", "driver", "Thermal", "kg/kW"),
            GraphNode("mission_lifetime_years", "Mission lifetime", "driver", "Economics", "yr"),
            GraphNode("annual_opex_pct_of_capex", "Opex / capex", "driver", "Economics", "%/yr"),
            GraphNode("discount_rate_pct", "Discount rate", "driver", "Economics", "%"),
            GraphNode("ground_baseline_cost_per_pflops_year_usd", "Ground $/PFLOPS·yr", "driver", "Economics", "$/PFLOPS·yr"),

            # --- Intermediates (kind="intermediate") ---
            GraphNode("chip_power_kw", "Chip power", "intermediate", "Sizing", "kW",
                      description="compute_demand ÷ chip_pflops_per_kw"),
            GraphNode("panel_mass_kg", "Panel mass", "intermediate", "Sizing", "kg",
                      description="(chip_power × 1000) ÷ (panel W/kg × duty cycle)"),
            GraphNode("radiator_mass_kg", "Radiator mass", "intermediate", "Sizing", "kg",
                      description="chip_power × radiator kg/kW"),
            GraphNode("dry_mass_kg", "Dry mass", "intermediate", "Sizing", "kg",
                      description="panel + radiator"),
            GraphNode("launch_capex", "Launch capex", "intermediate", "Capex", "USD"),
            GraphNode("hardware_capex", "Hardware capex", "intermediate", "Capex", "USD"),
            GraphNode("annual_opex", "Annual opex", "intermediate", "Capex", "USD/yr"),
            GraphNode("effective_pflops", "Effective compute", "intermediate", "Trajectory", "PFLOPS",
                      description="compute_demand × (1−panel_drop)^t × (1−chip_drop)^t"),
            GraphNode("space_yearly_cost", "Space yearly cost", "intermediate", "Trajectory", "USD"),
            GraphNode("ground_yearly_cost", "Ground yearly cost", "intermediate", "Trajectory", "USD",
                      description="effective_pflops × ground baseline price"),

            # --- Output nodes (kind="output") ---
            GraphNode("launch_mass_kg", "Launch mass", "output", "Outputs", "kg"),
            GraphNode("system_capex_usd", "System capex", "output", "Outputs", "USD"),
            GraphNode("npv_savings_vs_ground_usd", "NPV savings", "output", "Outputs", "USD"),
            GraphNode("break_even_year", "Break-even year", "output", "Outputs", "yr"),
        ),
        edges=(
            # Sizing
            GraphEdge("compute_demand_pflops", "chip_power_kw", "÷ perf/W"),
            GraphEdge("chip_pflops_per_kw", "chip_power_kw", "÷"),
            GraphEdge("chip_power_kw", "panel_mass_kg", "× 1000 / (W/kg × duty)"),
            GraphEdge("panel_efficiency_w_per_kg", "panel_mass_kg", "÷"),
            GraphEdge("solar_duty_cycle", "panel_mass_kg", "÷"),
            GraphEdge("chip_power_kw", "radiator_mass_kg", "× kg/kW"),
            GraphEdge("radiator_kg_per_kw_heat", "radiator_mass_kg", "×"),
            GraphEdge("panel_mass_kg", "dry_mass_kg", "+"),
            GraphEdge("radiator_mass_kg", "dry_mass_kg", "+"),
            GraphEdge("dry_mass_kg", "launch_mass_kg", "× overhead"),
            GraphEdge("payload_overhead_factor", "launch_mass_kg", "×"),

            # Capex
            GraphEdge("launch_mass_kg", "launch_capex", "× $/kg"),
            GraphEdge("launch_cost_usd_per_kg", "launch_capex", "×"),
            GraphEdge("compute_demand_pflops", "hardware_capex", "× $/PFLOPS"),
            GraphEdge("chip_capex_usd_per_pflops", "hardware_capex", "×"),
            GraphEdge("launch_capex", "system_capex_usd", "+"),
            GraphEdge("hardware_capex", "system_capex_usd", "+"),
            GraphEdge("system_capex_usd", "annual_opex", "× opex%"),
            GraphEdge("annual_opex_pct_of_capex", "annual_opex", "×"),

            # Trajectories
            GraphEdge("compute_demand_pflops", "effective_pflops", "decay base"),
            GraphEdge("panel_degradation_pct_per_year", "effective_pflops", "decay"),
            GraphEdge("chip_radiation_degradation_pct_per_year", "effective_pflops", "decay"),
            GraphEdge("system_capex_usd", "space_yearly_cost", "year 0 only"),
            GraphEdge("annual_opex", "space_yearly_cost", "every year"),
            GraphEdge("effective_pflops", "ground_yearly_cost", "× $/PFLOPS·yr"),
            GraphEdge("ground_baseline_cost_per_pflops_year_usd", "ground_yearly_cost", "×"),

            # Outputs
            GraphEdge("space_yearly_cost", "npv_savings_vs_ground_usd", "Σ discount"),
            GraphEdge("ground_yearly_cost", "npv_savings_vs_ground_usd", "Σ discount"),
            GraphEdge("discount_rate_pct", "npv_savings_vs_ground_usd", "discount"),
            GraphEdge("mission_lifetime_years", "npv_savings_vs_ground_usd", "horizon"),
            GraphEdge("space_yearly_cost", "break_even_year", "cumulative"),
            GraphEdge("ground_yearly_cost", "break_even_year", "cumulative"),
        ),
    )

    def simulate(self, **kwargs: float) -> dict[str, Output]:
        v = self.resolve_drivers(kwargs)

        mission_years = int(round(v["mission_lifetime_years"]))
        # Series indexed 0..mission_years inclusive.
        n = mission_years + 1
        years = range(n)

        # --- Sizing (year 0) ---
        chip_power_kw = v["compute_demand_pflops"] / v["chip_pflops_per_kw"]
        # Panels must average chip_power_kw given duty cycle.
        panel_mass_kg = (chip_power_kw * 1000.0) / (
            v["panel_efficiency_w_per_kg"] * v["solar_duty_cycle"]
        )
        radiator_mass_kg = chip_power_kw * v["radiator_kg_per_kw_heat"]
        dry_mass_kg = panel_mass_kg + radiator_mass_kg
        launch_mass_kg = dry_mass_kg * v["payload_overhead_factor"]

        # --- Capex (year 0) ---
        launch_capex = launch_mass_kg * v["launch_cost_usd_per_kg"]
        hardware_capex = v["compute_demand_pflops"] * v["chip_capex_usd_per_pflops"]
        capex_year0 = launch_capex + hardware_capex
        annual_opex = capex_year0 * v["annual_opex_pct_of_capex"] / 100.0

        # --- Degradation → effective compute per year ---
        panel_drop = v["panel_degradation_pct_per_year"] / 100.0
        chip_drop = v["chip_radiation_degradation_pct_per_year"] / 100.0
        effective_pflops: list[float] = [
            v["compute_demand_pflops"] * (1.0 - panel_drop) ** t * (1.0 - chip_drop) ** t
            for t in years
        ]

        # --- Cost trajectories (nominal, not discounted) ---
        # Space: capex upfront at t=0 then opex every year (inclusive of t=0).
        space_yearly_cost: list[float] = [
            (capex_year0 if t == 0 else 0.0) + annual_opex for t in years
        ]
        cumulative_space_cost: list[float] = []
        running = 0.0
        for c in space_yearly_cost:
            running += c
            cumulative_space_cost.append(running)

        # Ground: pay per PFLOPS-year for the same compute the space system actually delivered.
        ground_price = v["ground_baseline_cost_per_pflops_year_usd"]
        ground_yearly_cost: list[float] = [effective_pflops[t] * ground_price for t in years]
        cumulative_ground_cost: list[float] = []
        running = 0.0
        for c in ground_yearly_cost:
            running += c
            cumulative_ground_cost.append(running)

        # --- $/PFLOPS-year (space cost amortized over mission, divided by year-t compute) ---
        amortized_space_yearly = capex_year0 / max(mission_years, 1) + annual_opex
        cost_per_pflops_space: list[float] = [
            amortized_space_yearly / pf if pf > 1e-6 else float("inf") for pf in effective_pflops
        ]
        cost_per_pflops_ground: list[float] = [ground_price for _ in years]

        # --- NPV vs ground over mission ---
        r = v["discount_rate_pct"] / 100.0
        npv_savings = 0.0
        for t in years:
            df = 1.0 / ((1.0 + r) ** t)
            npv_savings += (ground_yearly_cost[t] - space_yearly_cost[t]) * df

        # --- Break-even year (smallest t where cumulative_space <= cumulative_ground) ---
        break_even = -1.0
        for t in years:
            if cumulative_space_cost[t] <= cumulative_ground_cost[t]:
                break_even = float(t)
                break

        return {
            "launch_mass_kg": Output(
                scalar=launch_mass_kg,
                unit="kg",
                description="Year-0 launch mass (dry × overhead).",
            ),
            "system_capex_usd": Output(
                scalar=capex_year0,
                unit="USD",
                description="Year-0 총 capex (발사 + 컴퓨팅 하드웨어).",
            ),
            "npv_savings_vs_ground_usd": Output(
                scalar=npv_savings,
                unit="USD",
                description=(
                    "지상 baseline 대비 NPV 절감액. 양수면 space가 경제적, 음수면 지상이 우위."
                ),
            ),
            "break_even_year": Output(
                scalar=break_even,
                unit="yr",
                description=(
                    "누적 비용이 지상 대비 같아지는 첫 해. -1이면 미션 내 break-even 미달성."
                ),
            ),
            "effective_compute_pflops": Output(
                series=effective_pflops,
                unit="PFLOPS",
                description="패널+칩 degradation 적용 실효 컴퓨팅 (연도별).",
            ),
            "cost_per_pflops_year_space_usd": Output(
                series=cost_per_pflops_space,
                unit="$/PFLOPS·yr",
                description="우주 시스템 단가 (capex 균등상각 + opex) ÷ 연도별 실효 컴퓨팅.",
            ),
            "cost_per_pflops_year_ground_usd": Output(
                series=cost_per_pflops_ground,
                unit="$/PFLOPS·yr",
                description="지상 baseline 단가 (드라이버 값, overlay용).",
            ),
            "cumulative_cost_space_usd": Output(
                series=cumulative_space_cost,
                unit="USD",
                description="누적 우주 시스템 비용 (nominal, capex 선반영).",
            ),
            "cumulative_cost_ground_usd": Output(
                series=cumulative_ground_cost,
                unit="USD",
                description="같은 실효 컴퓨팅을 지상에서 구매 시 누적 비용.",
            ),
        }
