# platform-sdk

Phase 0 — bare bones. `SimulationBase`, `Driver`, `Output`.

새 시뮬레이션은 `SimulationBase`를 상속하고 `slug`, `name`, `drivers`, `simulate(**kwargs)`를 구현한다. 예시: `services/simulation-service/simulation_service/sims/placeholder.py`.

## 인터페이스

```python
class MySim(SimulationBase):
    slug = "my_sim"
    name = "My sector"
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

- `simulate`는 deterministic이어야 한다 (캐싱 전제, CLAUDE.md 참조).
- 확률성이 필요하면 fixed seed.
- 단위는 `unit` 필드에 명시.
