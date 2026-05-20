# Current task — Phase 2 entry (multi-sector platform)

**Status**: Phase 1 vertical slice closed (2026-05-20). Phase 2 entry — multi-sector
platform with 3 user-facing sectors registered (2026-05-21).

## Phase 1 — shipped (closed)

`space-data-center` (orbital data-center techno-economic feasibility) is the
reference sector, deployed end-to-end:

- SDK (`packages/sdk-python`): `Driver.group`, `SimulationBase.presets`,
  default `sensitivity()` sweep, `Source` / `HistoryPoint` / `Provenance`
  with `kind` taxonomy (paper / vendor_doc / analyst / benchmark / gov_report
  / dataset / news / filing).
- simulation-service: `/sims`, `/sims/{slug}`, `/sims/{slug}/run`,
  `/sims/{slug}/sensitivity`, `/sims/{slug}/live` (deterministic drift).
- Web (`apps/web`): three-tab workspace (Live / Manual / Sources) under a
  sticky live KPI strip. Live tab polls `/live` every 3s with rolling
  30-tick sparklines, per-driver source disclosure, and a `Data ingest`
  panel that aggregates distinct sources grouped by kind.

## Phase 2 — multi-sector (in progress)

### Registered sectors (2026-05-21)

| slug | name | horizon | drivers | groups |
|------|------|---------|---------|--------|
| `space-data-center` | Space Data Center | 15 yr | 14 | Launch / Compute / Power / Thermal / Economics |
| `memory-semi` | Memory Semiconductor | 10 yr | 14 | Demand / Pricing / Supply / Cost |
| `sofc` | SOFC (Solid Oxide Fuel Cell) | 20 yr | 14 | System / Stack / Fuel / Operations / Economics |

Each sector ships with: presets, full provenance (history + kind-labeled
sources) on every driver, sensitivity sweep, and ≥10 pytest cases.

### UI changes for multi-sector

- `apps/web/src/app/sector-picker.tsx` — pill row (or dropdown if >6) above
  the workspace. Single source of truth is the `?sector=<slug>` query param.
- `page.tsx` is now `searchParams`-driven and falls back to the first
  registered sector if no/invalid slug.
- `Workspace` is keyed by `meta.slug` so the live-tick rolling window
  resets cleanly on sector switch.

### Phase 2 backlog (ordered by leverage)

This is the sequence to take us from "3 hand-coded sectors" to "agents
generate sectors from research". Each item is a distinct slice — do not
bundle.

- [x] **Postgres + Prisma schema v1** (2026-05-20). `packages/db`
      workspace package with Prisma 5.22, schema with `sectors` + `scenarios`
      tables, initial migration applied, seed script registers the 3
      in-code sims, Docker `postgres:16-alpine` service wired into base
      compose with port exposure in `local.yml`. Root scripts:
      `pnpm db:{up,down,migrate,seed,studio,generate}`. `tenant_id`
      intentionally absent — added when auth lands.
- [ ] **`services/sector-service`** (Fastify + tRPC): proxy + auth boundary
      over simulation-service. Adds auditable per-request logging.
- [ ] **Scenario CRUD UI**: save / load / share / fork from any tab.
- [ ] **A/B comparison**: multi-line overlay of two scenarios on the same
      chart. Triggers a `compare` URL pattern.
- [ ] **React Flow causal graph view**: render the dependency graph
      (drivers → intermediate quantities → outputs). Needs a `graph()`
      method on `SimulationBase` returning nodes + edges; manually authored
      per sim for now, agent-generated in a later slice.
- [ ] **Report generation (PDF/markdown)**: LLM-stub OK; template scalars +
      chart snapshots + sources used.
- [ ] **`apps/admin` skeleton**: list registered sectors, kick off ingest
      runs, approve agent-proposed sectors. No agent UI yet — just the
      shell.
- [ ] **Agent orchestration foundation** (this is the big one — do not
      start until everything above is in):
  - [ ] `packages/agent-tools` MCP tool definitions (research, decompose,
        infer-driver, propose-edge, generate-sim-code, review-sim-code).
  - [ ] `services/agent-orchestration` (Temporal workflow shell).
  - [ ] `prompts/` directory with versioned system prompts per agent.
  - [ ] Model routing via `packages/agent-tools/llm-client` (Haiku for
        routing/extraction; Sonnet for code-gen/review; Opus reserved for
        decomposition/edge-inference).
  - [ ] Sandbox (Modal) integration for executing generated sim code.
  - [ ] `tests/agent-evals` cases for each agent.
  - [ ] LangSmith (or Helicone) tracing + per-tenant cost meter.

### Out of scope for now

- Monte Carlo / probabilistic drivers (`SimulationBase.monte_carlo` still
  raises `NotImplementedError`).
- Real `data-pipeline-service` feeds replacing the seeded `/live` drift.
- Backtesting / `services/validation-service`.
- `apps/docs`, `packages/sdk-ts`, `packages/shared-types`.

## Verifying locally

```bash
pnpm install
uv sync
pnpm dev          # apps/web :3000 + services/simulation-service :8000
```

Open http://localhost:3000. Switch sectors via the pill row at the top
(`?sector=memory-semi`, `?sector=sofc`, `?sector=space-data-center`).
Live KPI strip is sticky and stays visible across tabs.

Tests:

```bash
uv run --project services/simulation-service pytest services/simulation-service/tests -v
# expect ~45 tests across SpaceDataCenter / MemorySemi / SOFC / api
```

## Architecture notes for this slice

- **Sector-agnostic core**: drivers/outputs/sensitivity/presets/provenance
  are all generic in the SDK; nothing in `apps/web` is hard-coded to a
  particular sector beyond a single space↔ground series-pairing rule
  (`_(space|ground)_usd` suffix → paired line chart). Memory and SOFC don't
  trigger pairing; their series render as single-line charts which is the
  intended fallback.
- **`Workspace` keyed by `meta.slug`**: the live rolling window in
  `LiveDashboard` is per-driver-name, so a stale window would mix sectors.
  Remounting on slug change is the cleanest reset.
- **Provenance for Memory/SOFC is seeded demo**: real ingestion is a Phase 2
  later-slice. The seed data is realistic enough (TrendForce/IDC/EIA/DOE/
  Bloom/Bernstein etc.) to validate the UX, with public URLs where
  available.
