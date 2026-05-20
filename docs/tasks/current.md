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
- [x] **`services/sector-service`** (Fastify + tRPC) (2026-05-20).
      Backend layer that:
      - proxies the simulation-service via `sim.{list,get,run,sensitivity,live}`
        tRPC procedures (zod-validated, BAD_REQUEST/NOT_FOUND maps applied
        on upstream errors);
      - exposes `scenario.{list,get,create,update,delete}` CRUD over
        `@platform/db`;
      - logs every tRPC call as a structured audit line via Pino
        (procedure path + type + duration + ok flag + request_id);
      - listens on `:8001`, env-validated via zod (boot fails loud on
        missing `SIMULATION_SERVICE_URL` / `DATABASE_URL`).
      Tests: 17 vitest (11 scenario integration vs real Postgres + 6 sim
      proxy with mocked fetch). Docker image builds via
      `infra/docker/sector-service.Dockerfile` (dev = `tsx watch`,
      prod = `tsx`); compose entries added to base + local + dev.
      Auth context (currentUser, tenantId) deliberately omitted —
      `createContext` is the seam where the auth slice will plug in.
- [x] **Web app: tRPC client migration** (2026-05-20). `sim-client.ts`
      rewritten on `createTRPCClient<AppRouter>` from `@platform/sector-service`;
      same `fetchSims` / `fetchSim` / `runSim` / `fetchSensitivity` /
      `fetchLive` surface so call sites are unchanged. Response types are now
      inferred via `inferRouterOutputs<AppRouter>` instead of duplicated.
      Next rewrite of `/api/sim/:path*` retargeted at `sector-service:8001`;
      docker-compose web service env swapped to `SECTOR_SERVICE_URL`; web
      Dockerfile deps stage copies sector-service + packages/db source so TS
      can walk the AppRouter type graph (runtime never executes any of it).
- [x] **Scenario CRUD UI** (2026-05-20). New `ScenarioBar` strip rendered
      above the tab switcher, visible on every tab:
      - Driver values lifted from `ManualPanel` to `Workspace` so the bar can
        read them at save time and write them at load time. `ManualPanel`
        becomes controlled (values + setter passed as props).
      - Picker dropdown of saved scenarios (`scenario.list` filtered to the
        current sector). Selecting one applies its `driver_overrides` over
        defaults and auto-switches to Manual.
      - Save-as / Update / Rename / Fork / Delete / Share buttons with a
        dirty indicator computed against the loaded scenario (not against
        defaults). Save-as uses `window.prompt`; replace with a proper
        dialog when shadcn comes in.
      - Share copies a self-contained `?sector=&scenario=` URL to clipboard
        (falls back to inline display if the Clipboard API is denied).
      - `?scenario=<id>` deeplink resolved server-side in `page.tsx` and
        passed to `Workspace` as `initialScenario`; the scenario's
        `sector_slug` wins over `?sector=` so paste-and-go works regardless
        of the current sector.
      - Stored payload is the diff vs sector defaults (not the full driver
        map), so scenarios survive future sector schema additions.
- [x] **A/B comparison** (2026-05-20). New `/compare?sector=&a=&b=` route:
      - `a` and `b` accept either a scenario id or the literal `defaults`,
        so any saved scenario can be compared against the sector defaults
        without having to seed an "empty scenario" row.
      - Server-side `page.tsx` fetches the sector metadata, both scenarios
        (if any), and runs `runSim` for each side in parallel. Returns a
        single coherent error page if either side can't be resolved (e.g.
        scenario id from a different sector pasted in).
      - `compare-view.tsx` renders three blocks: a scalar diff grid
        (A / B / Δ / Δ%), overlay line charts (cyan = A solid, orange = B
        dashed, paired by the same suffix-stripping rule as the manual
        panel), and a "Driver differences" table sorted by largest
        relative delta.
      - Entry points: a "Compare…" button on `ScenarioBar` opens an inline
        picker of other scenarios (plus "defaults" when a scenario is
        loaded). The currently-loaded side becomes A; the picked one
        becomes B. Within the compare view, the A/B selects let users
        swap either side without bouncing back to the workspace.
      - No backend changes needed — uses existing `sim.run`, `scenario.get`,
        `scenario.list`. Scenario CRUD is unchanged.
- [x] **React Flow causal graph view** (2026-05-20). Drivers → intermediates
      → outputs dependency graph, manually authored per sim. Agent-generated
      version is a Phase 2 later slice.
      - SDK (`packages/sdk-python/platform_sdk/base.py`): `GraphNode`,
        `GraphEdge`, `SimGraph` dataclasses + `graph: ClassVar[SimGraph]` slot
        on `SimulationBase`. Frozen dataclasses, so a sim's graph travels with
        its class and is statically introspectable.
      - simulation-service: `GET /sims/{slug}/graph` returns
        `{slug, nodes, edges}` (Pydantic `SimGraphResponse`). Three test
        cases verify that every authored graph is internally consistent
        (edge endpoints reference declared nodes, driver-kind ids match real
        drivers, output-kind ids match real `simulate()` outputs).
      - sector-service: `sim.graph` tRPC procedure proxies with the same
        404→NOT_FOUND mapping used by the other sim.* procedures. 2 new
        vitest cases. Sim tests also gained a `DATABASE_URL` stub so they
        run without Postgres (the pre-existing env() validator was crashing
        the suite on machines without a DB).
      - Web: new `Graph` tab on the workspace tab strip. Uses `reactflow`
        with a hand-rolled three-column layout (drivers ← intermediates ←
        outputs), kind-coloured nodes, edge labels carrying the math step
        (× duty, ÷ η, Σ discount, …). Driver nodes display the current
        slider value live so the graph reflects whatever the user is
        currently exploring on the Manual tab.
      - Graphs authored for all three sims (space-data-center detailed
        through capex/opex/trajectories; memory-semi through demand × ASP
        → revenue → margin → FCF; sofc through sizing → fuel/carbon/stack →
        LCOE/NPV).
- [x] **Report generation (markdown)** (2026-05-20). Markdown only; PDF is a
      later slice once we adopt a renderer. No LLM yet — the template is
      deterministic so caching is trivial and the UI can iterate on shape.
      Phase 2 later slice swaps the body for an LLM call (with the
      templated version as fallback).
      - simulation-service: `POST /sims/{slug}/report` accepts driver
        overrides + optional `scenario_name` / `scenario_notes`, runs sim
        + sensitivity once, returns
        `{slug, generated_at, markdown, sources[]}`. The markdown has:
        title, overview, optional notes blockquote, headline scalars
        table, trajectory summary (start → end + range), driver overrides
        table with Δ%, top-5 sensitivity per scalar output, and a sources
        section grouped by kind with back-references to the drivers each
        source backs. Builder lives in
        `simulation_service/report.py`; 8 pytest cases cover defaults,
        overrides, source dedupe, sensitivity block, scenario notes, and
        the 3-sector smoke (each registered sim builds without errors).
      - sector-service: `sim.report` tRPC mutation proxies through with
        the same 400/404 mappings used by `sim.run`. 2 new vitest cases.
      - Web: `Report` button on `ScenarioBar` opens a right-side slide-over
        (`ReportPanel`) that re-generates on every driver tweak. Renders
        the markdown via a small in-file renderer (~140 LOC, no
        dependency) covering ATX headings, pipe tables with alignment,
        blockquotes, ordered/unordered lists, bold/italic, inline code,
        and links. Copy-to-clipboard + download-as-`.md` actions, plus a
        kind-tagged citation summary at the bottom that links back to
        the existing `SOURCE_KINDS` colour scheme so the report's
        citations match the rest of the workspace visually.
- [x] **`apps/admin` skeleton** (2026-05-20). New Next.js 15 app on port
      3100. Talks to sector-service through the same `/api/sim/*` rewrite
      pattern as `apps/web`, with its own typed tRPC client (kept
      in-app — the admin surface will diverge from the user client as
      ingest / approval procedures land).
      - `/` — registered sectors grid. Each card shows horizon, driver
        count + group count, preset count, source count, and scenario
        count, plus a deep-link into the user app for that sector.
      - `/sectors/[slug]` — driver tables grouped by Driver.group,
        presets with their override diff, scenarios list (deep-linked to
        the user app), and a kind-collapsed sources roll-up.
      - `/scenarios` — flat scenarios index grouped by sector so an
        admin can see what users have saved across the platform.
      - Top nav links to the user app on :3000.
      - Action buttons (Run ingest, Re-run agent, Review proposal,
        Propose new sector, Approve queue) are present but `disabled`
        with a `title` tooltip explaining they land in the agent
        orchestration slice. Keeps the shell honest about what's
        wired vs not.
- [~] **Agent orchestration foundation** (split into independent sub-slices —
      the foundational LLM client landed first; the rest follow as
      separate slices, each gated on the previous):
  - [x] **`packages/agent-tools` LLM client + first prompt** (2026-05-20).
        New uv workspace member `packages/agent-tools` with three modules:
        - `llm_client.py` — `LLMClient` wraps `anthropic.Anthropic` with
          model routing by tier ("haiku" / "sonnet" / "opus" → the canonical
          IDs `claude-haiku-4-5` / `claude-sonnet-4-6` / `claude-opus-4-7`).
          Prompt caching is on by default — the last system block carries
          `cache_control: ephemeral`. Adaptive thinking is off by default
          and opt-in via `adaptive_thinking=True` (per the Opus 4.7
          guidance — overthinking is the failure mode, not under-thinking).
          `effort` defaults per tier ("medium" for haiku/sonnet, "high"
          for opus). Structured output goes through `messages.parse()`
          when a Pydantic `response_model` is passed.
        - `cost.py` — `model_price()` / `price_call()` / `CostMeter`.
          Encodes the public per-1M-token rates and the 0.1× cache-read /
          1.25× cache-write multipliers. Meter is thread-safe and emits a
          JSON-serializable `summary()` for /audit lines.
        - `tools/__init__.py` — `ToolDef` dataclass + `tool_defs()` registry.
          Ships one starter `lookup_sector` tool that the orchestrator will
          wire to the existing sim-service tRPC procedures in a later slice.
        18 pytest cases cover routing, cache_control placement, effort
        defaults, thinking opt-in, cost math, and the parse() path. All
        offline — Anthropic client is faked in tests.
  - [x] **`prompts/` directory + first agent prompt** (2026-05-20).
        `prompts/README.md` documents the convention (one file per
        agent role, structured front-matter + free-form body, kept
        cache-stable). `prompts/decomposition.md` is the first
        agent system prompt — assigned to the opus tier per the model-
        routing rules, with explicit principles + anti-patterns for the
        agent that will turn sector descriptions into Driver / Output
        schemas.
  - [x] **`services/agent-orchestration` shell** (2026-05-20). FastAPI
        service on port 8002 with an in-memory workflow runner shaped to
        the Temporal interface — the swap to Temporal is a runner
        replacement, not an API change.
        - `Workflow` protocol (async `run(request, *, cost_meter)`),
          `WorkflowRunner` schedules tasks via `asyncio.create_task` and
          tracks `WorkflowStatus` (pending → running → succeeded /
          failed / cancelled). Cost rolls up per workflow via
          `agent-tools.CostMeter`.
        - First concrete workflow: `DecompositionWorkflow` — loads
          `prompts/decomposition.md`, calls Claude Opus 4.7 with
          adaptive thinking + structured output (`Decomposition`
          Pydantic schema mirroring `SimulationBase`), validates the
          result. The synchronous SDK call is wrapped in
          `asyncio.to_thread` so the event loop stays free.
        - `prompts.py` loader walks up from the module to find the
          repo `prompts/` directory; `PROMPTS_DIR` env var overrides.
          `lru_cache` per process; `clear_prompt_cache()` for tests.
        - HTTP surface: `POST /workflows/decompose` (202 with record),
          `GET /workflows/{id}`, `GET /workflows?kind=&limit=`,
          `POST /workflows/{id}/cancel`, `GET /health`. Runner + LLM
          client are `app.state` singletons so tests inject fakes.
        - 12 pytest cases (5 workflow-runner + 7 HTTP), all offline —
          a `FakeAnthropic` exposes `messages.create` /
          `messages.parse` and returns a canned `Decomposition` value.
        - Docker: `infra/docker/agent-orchestration.Dockerfile`
          (dev + prod stages, `PROMPTS_DIR=/repo/prompts`). Compose
          entries in base + local with port 8002 exposed and
          `ANTHROPIC_API_KEY` plumbed through.
        - Modal sandbox / persistence / multi-tenant scoping
          intentionally deferred — they're separate later slices.
  - [ ] **Sandbox (Modal) integration** for executing generated sim code.
  - [ ] **More agent prompts**: research / driver-inference / edge-inference /
        code-gen / code-review (each their own slice — author + eval).
  - [ ] **`tests/agent-evals`** harness + cases per agent.
  - [ ] **LangSmith / Helicone tracing** wired through `LLMClient`.

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
