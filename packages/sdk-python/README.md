# @platform/sdk-python

`SimulationBase`, `Driver`, `Output` — 시뮬레이션이 따라야 하는 최소
인터페이스. Phase 3 (Vision Feasibility Monitor)부터는 시뮬레이션이
Playground sub-tab으로 역할이 바뀌었지만 인터페이스 자체는 그대로예요.

새 시뮬레이션은 `SimulationBase`를 상속하고 `slug`, `name`, `drivers`,
`simulate(**kwargs)`를 구현합니다. 비전과 묶으려면 `Sector.is_vision_eligible=true`
+ `Capability.primary_driver_name`이 매핑되어 있어야 하고, 그러면 M42의
WhatIfFeasibility callout이 자동으로 작동합니다.

현재 라이브 sim:
- `services/simulation-service/simulation_service/sims/space_data_center.py`
- `services/simulation-service/simulation_service/sims/memory_semi.py`
- `services/simulation-service/simulation_service/sims/sofc.py`
- `services/simulation-service/simulation_service/sims/placeholder.py` (generic agent-generated sectors용)
- M44에서 추가 예정: `sims/fusion_power.py`

## 인터페이스

```python
from platform_sdk import SimulationBase, Driver, Output

class MySim(SimulationBase):
    slug = "my_vision"
    name = "My vision"
    drivers = {
        "growth_rate": Driver(default=0.05, range=(0.0, 0.5), unit="/yr"),
    }
    horizon_years = 10

    def simulate(self, **kwargs: float) -> dict[str, Output]:
        v = self.resolve_drivers(kwargs)
        ...
        return {"value": Output(series=[...], unit="USD")}
```

## 제약

- `simulate`는 deterministic이어야 합니다 (캐싱 전제 — 자세한 내용은
  [CLAUDE.md "Determinism"](../../CLAUDE.md#determinism) 참조).
- 확률성이 필요하면 fixed seed.
- 단위는 `Output.unit`에 명시.
- Driver value는 `kwargs`로 전달 — `self.resolve_drivers(kwargs)`로
  default + range 적용.

## 새 sim 추가 절차

[CLAUDE.md "New sim (manual)"](../../CLAUDE.md#new-sim-manual-edge-case)
참조. 5단계 (sim 파일 → migration → seed → integration test → typecheck).
Vision Builder agent (M41)로 prompt에서 자동 생성하는 것도 가능.
