# Current task — Phase 1 vertical slice (Space Data Center)

**Status**: sector model + sensitivity shipped (2026-05-20)
**Sector**: `space-data-center` — orbital data-center techno-economic feasibility
(replaces the Phase 0 `placeholder`, which stays registered for regression).

## Shipped in this slice

### SDK (`packages/sdk-python`)
- `Driver.group` field (optional, default `""`) — UI groups sliders by section.
- `SimulationBase.presets: dict[str, dict[str, float]]` — named one-click
  scenario bundles (partial driver overrides).
- Default `SimulationBase.sensitivity()` — one-at-a-time min↔max sweep per
  driver, returns signed swing per scalar output. Sortable → tornado chart.

### Simulation (`services/simulation-service`)
- `SpaceDataCenterSim` (`sims/space_data_center.py`)
  - **14 drivers** across 5 groups: Launch, Compute, Power, Thermal, Economics
  - **9 outputs**:
    - scalars: `launch_mass_kg`, `system_capex_usd`,
      `npv_savings_vs_ground_usd`, `break_even_year`
    - series: `effective_compute_pflops`, `cost_per_pflops_year_{space,ground}_usd`,
      `cumulative_cost_{space,ground}_usd`
  - **4 presets**: Baseline (2026), Optimistic (Starship era), Pessimistic,
    Edge inference (small sat)
  - Deterministic; non-numpy stdlib only.
- Registered in `registry.py`; placeholder kept.
- `GET /sims/{slug}/sensitivity` endpoint returns per-output entries sorted
  by `|swing|`.
- `SimMetadata` now exposes `presets` and per-driver `group`.

### Web (`apps/web`)
- Default slug switched to `space-data-center`.
- Sliders grouped by section (Launch / Compute / Power / Thermal / Economics).
- Preset chips (Baseline / Optimistic / Pessimistic / Edge) + reset button.
- Scalar KPI cards (color-coded: NPV green/red, no-break-even red).
- Series outputs auto-pair by `_{space,ground}_usd` suffix → space-vs-ground
  line overlay (Recharts).
- Sensitivity tornado chart with selectable output (defaults to NPV vs ground).
- Number formatting helpers for $/k/M/B + unit awareness.

### Tests (`services/simulation-service/tests`)
- `test_space_data_center.py` — 10 unit tests: output shape, determinism,
  series length tracks `mission_lifetime_years`, effective compute monotonic
  degradation, NPV monotonic in launch cost, launch mass monotonic in chip
  efficiency, `break_even == -1` under bad economics, unknown driver raises,
  sensitivity ranks all drivers per output, all preset overrides validate.
- `test_api.py` — 7 integration tests: health, list, metadata (groups/presets),
  run with overrides, unknown-driver 400, sensitivity sorted descending,
  unknown-slug 404.
- All 17 pass. Ruff clean.

## Verifying locally

```bash
pnpm install
uv sync
pnpm dev   # apps/web :3000 + services/simulation-service :8000
```

Open http://localhost:3000. Drag any slider or click a preset — KPIs +
charts + sensitivity bars repaint with no perceptible latency (sim runs
locally in <5 ms).

Tests:
```bash
uv run --project services/simulation-service pytest services/simulation-service/tests -v
```

## Phase 1 backlog (DESIGN.md §9 — pick up next, ordered by leverage)

- [ ] **React Flow causal graph view** — now that we have >1 driver group +
      output, render the dependency graph (drivers → intermediate quantities
      → outputs). Sector-agnostic if we expose a `graph()` method on
      `SimulationBase` returning nodes + edges.
- [ ] **Scenario CRUD** — persist `{driver overrides, name, notes}` to
      Postgres. Needs Prisma schema v1 + `services/sector-service` (Fastify
      + tRPC), per DESIGN.md §3 entities.
- [ ] **Scenario comparison (A/B)** — once persistence is in, multi-line
      overlay on the existing charts.
- [ ] **Report generation (PDF/markdown)** — LLM stub OK in Phase 1; just
      template the scalars + chart snapshots.
- [ ] **Provenance**: each driver should declare a default `source_url`
      + last-updated timestamp. Driver tooltip → source link.
- [ ] `services/api-gateway` (Fastify + tRPC) in front of the Python
      simulation-service before adding auth.
- [ ] Auth (Clerk) + billing (Stripe) bootstrap.
- [ ] CI gates: ruff + pytest + tsc on PR.
- [ ] `apps/admin` skeleton.
- [ ] `packages/ui` — promote `<ScalarCard>`, `<DriverGroup>`, `<TornadoChart>`
      out of `apps/web/src/app/sim-workspace.tsx` once `apps/admin` lands.
- [ ] `packages/sdk-ts` — generate typed client from FastAPI OpenAPI.
- [ ] `packages/shared-types` — Zod schemas mirroring Pydantic.

## Out of scope (Phase 2+)

- `services/agent-orchestration`, `services/validation-service`,
  `packages/agent-tools`, `prompts/` — automated sector authoring.
- Modal/E2B sandbox for LLM-generated sim code.
- LangSmith / Helicone, LLM cost meters.
- Monte Carlo / probabilistic distributions on drivers
  (`SimulationBase.monte_carlo` still raises `NotImplementedError`).
- Backtesting cron.

## Architecture notes for this slice

- **Sector-agnostic frontend (mostly)**: drivers/outputs/sensitivity/presets
  are generic. The only sector-specific UI choice is the space↔ground series
  pairing, which is keyed off the `_{space,ground}_usd` suffix convention —
  other sims won't trigger pairing and will fall back to one-line charts.
- **No DB yet**: scenario state lives in React local state. Persisted CRUD
  is the next slice — it unlocks A/B comparison and shareable URLs.
- **CLAUDE.md determinism guarantee**: `SpaceDataCenterSim.simulate` is pure
  (no time/random); `test_simulation_is_deterministic` enforces it.
- **Open Question carry-over**: ground baseline ($/PFLOPS·yr) is currently a
  single number. Reality is a band (hyperscaler vs colo vs on-prem); when
  scenario CRUD lands, baseline could become a Driver with a data-source
  linkage (per DESIGN.md §F2 — but stub for Phase 1).
