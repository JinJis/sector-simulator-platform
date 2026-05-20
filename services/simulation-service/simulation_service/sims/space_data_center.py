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

from platform_sdk import Driver, Output, SimulationBase


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
