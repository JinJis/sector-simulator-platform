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
  - [x] **More agent prompts** (2026-05-20). The five remaining pipeline
        prompts ship as authored markdown alongside `decomposition.md`,
        plus a structured catalog so future workflow slices can pick
        them up consistently:
        - `prompts/research.md` (sonnet → `ResearchBrief`) — numeric
          anchor extraction with kind-labeled citations.
        - `prompts/driver-inference.md` (sonnet → `DriverInferenceResult`)
          — calibrated defaults / ranges / history / sources per
          driver.
        - `prompts/edge-inference.md` (opus → `EdgeInferenceResult`) —
          causal DAG with labeled edges, formulas, dimensional
          checks, and explicit `assumptions`.
        - `prompts/code-gen.md` (sonnet → `CodeGenResult`) —
          transcribes the structured spec to a `SimulationBase`
          subclass file matching the existing sim house style.
        - `prompts/code-review.md` (sonnet → `CodeReviewResult`) —
          finding-oriented review with severity rubric (Sonnet on
          purpose; the Opus 4.7 literal-severity-filter shift would
          depress recall here).
        - Convention: YAML-ish front-matter at the top of each file
          (`role`, `tier`, `inputs`, `outputs`, `version`), parsed by
          a tiny in-house parser (no pyyaml dep) in
          `agent_orchestration/prompts.py`. `load_prompt()` returns
          body only (cache-stable); `prompt_metadata()` /
          `prompt_catalog()` expose the structured fields.
          `decomposition.md` refactored to match.
        - 11 new pytest cases (24 total in the suite) cover catalog
          membership, tier routing, body sanity, and every front-matter
          error path. Future workflows wiring these prompts is its own
          slice.
  - [x] **`tests/agent-evals`** (2026-05-20). Two-tier harness at
        `tests/agent_evals/` (underscore — directory imports cleanly
        as a Python package; conceptual name in CLAUDE.md keeps the
        hyphen).
        - **Tier 1 — prompt sanity** (`test_prompt_sanity.py`).
          Parameterized over every prompt in the catalog. Verifies the
          body mentions its declared `outputs` schema, has the
          `## Principles` + `## Anti-patterns` sections, contains no
          interpolation markers (`{{ }}` / `%(` / `${`), and loads
          deterministically. Plus cross-prompt invariants: the six
          pipeline agents are all present in the catalog, and no two
          agents share a role string. Pure markdown introspection;
          no API.
        - **Tier 2 — workflow behavior** (`test_decomposition.py`,
          one file per workflow as more wire up). Runs the actual
          `DecompositionWorkflow` against two realistic sector
          descriptions (battery recycling, grid-scale Li storage).
          Eight baseline invariants per case: snake_case driver
          names, `default ∈ [min, max]`, non-empty groups,
          ≥ 1 scalar output, driver-count and output-count in
          reasonable ranges, horizon ∈ [1, 50], kebab-case slug.
          Each case carries a `CostBudget`; the harness fails if
          the workflow exceeds it.
        - **Modes**: offline by default (canned `Decomposition`
          replayed via a per-case `FakeAnthropic`).
          `ANTHROPIC_EVAL_LIVE=1` flips to real Opus 4.7 — opt-in so
          CI doesn't burn API budget. Same Python assertions in
          both modes.
        - 34 evals total (32 Tier 1 + 2 Tier 2). One real find from
          authoring: the original Tier 1 volatile-data check tripped
          on `code-review.md` quoting `datetime.now()` as an
          example of an unsafe pattern to *look for* in generated
          code. Narrowed the check to interpolation markers only —
          function-name citations in prompt bodies are legitimate.
  - [ ] **LangSmith / Helicone tracing** wired through `LLMClient`.

### End-to-end agent plumbing (2026-05-20)

The foundation pieces (LLM client → workflow runner → orchestration
service → prompts → evals) are now accessible from the admin UI, end-
to-end. Pasting a sector concept into the form actually invokes Claude
Opus 4.7 against `prompts/decomposition.md` and renders the resulting
schema back for review.

- **sector-service**: new `agent.*` tRPC router proxying to
  agent-orchestration. `startDecomposition` / `getWorkflow` /
  `listWorkflows` / `cancelWorkflow`. `agent-proxy.ts` mirrors
  sim-proxy.ts shape; `AGENT_ORCHESTRATION_URL` is optional so dev
  setups without the agent layer get a clean PRECONDITION_FAILED
  rather than a 500. 9 new vitest cases covering happy paths +
  upstream 404 / 422 / missing-URL.
- **apps/admin**: three new pages.
  - `/agent-runs` — list of past + in-flight runs, kind/status/id/
    cost/description columns, deep links.
  - `/agent-runs/new` — kickoff form (description + optional
    reference_data). Submitting routes to the run detail page.
  - `/agent-runs/[id]` — server-hydrated record + a `RunWatcher`
    client component polling every 1.5 s until terminal. On
    `succeeded`, renders the `Decomposition` (grouped drivers,
    intermediates, outputs) with a "not yet a registered sector"
    note pointing at the next pipeline slices.
  - Home page stub buttons updated — `+ Propose new sector (agent)`
    and `↻ Agent runs` now real links; `Run ingest` and `Approve
    queue` stay stubbed.
  - Top nav gains an `Agent runs` link.
- **Wiring**: `docker-compose.yml` plumbs
  `AGENT_ORCHESTRATION_URL=http://agent-orchestration:8002` into
  sector-service + adds the agent-orchestration `depends_on` edge.
- **Side-fix**: pre-existing tRPC typecheck errors in
  `tests/{sim,scenario}.test.ts` and `src/server.ts` (the
  `Parameters<typeof createCaller>[0]["log"]` union access stopped
  working after a tRPC bump) — fixed by referencing `Context`
  directly + typing the `onError` callback. Sector-service typecheck
  is now clean.

### Persistence (2026-05-20)

Workflow records now survive process restarts.

- **`packages/db`**: new `AgentWorkflow` Prisma model + migration
  (`20260520200000_agent_workflows`). Two indices: `(kind, created_at)`
  for the list view and `(status, updated_at)` for the dangling-sweep.
- **`services/agent-orchestration`**:
  - New `repo.py` exposes a `WorkflowRepository` protocol with two
    implementations: `InMemoryWorkflowRepository` (default, dict-backed,
    used in tests) and `PostgresWorkflowRepository` (asyncpg, raw SQL).
    Schema duplicated as raw SQL strings on the Python side; the Prisma
    model is authoritative for migrations.
  - `WorkflowRunner` refactored to use the repo for all state — every
    transition writes through. CostMeter instances still live in-memory
    (cheap; only used for the final cost roll-up).
  - `main.py` lifespan: `build_repository(DATABASE_URL)` picks the
    implementation. On boot with Postgres, sweeps `pending` / `running`
    workflows whose `updated_at` is older than 5 minutes — flips them
    to `failed: process crashed or was restarted before completion`.
    No more perpetually-running ghosts after a restart.
- **Tests**: 8 new repo-layer cases (6 in-memory, 2 Postgres-conditional
  via `AGENT_ORCH_TEST_DATABASE_URL` env). All 24 existing tests still
  pass — the in-memory repo preserves the pre-refactor behavior.
- **Compose**: agent-orchestration gains `DATABASE_URL` +
  `depends_on: {postgres: healthy, db-migrate: completed_successfully}`.
  Dev setups without DB still work via the in-memory fallback.

### Phase 2.5 IA slice 1 — Breadcrumbs + SubNav (2026-05-20)

First step of the §8.5 IA redesign. Just the shared components +
applying breadcrumbs to existing nested routes. The bigger sector-hub
split is slice 2.

- **New workspace package `@platform/ui`**: source-only (no build step;
  consumers compile via `transpilePackages` in next.config). The
  convention CLAUDE.md mandates ("shared components go in
  packages/ui first") now has an actual home. Exports map covers
  `@platform/ui` (everything), `@platform/ui/breadcrumbs`, and
  `@platform/ui/sub-nav`.
- **`Breadcrumbs`** (RSC-safe): trail of `<Link>`s ending in plain
  text for the current page. Replaces the ad-hoc `← back` patterns
  scattered across detail pages.
- **`SubNav`** (`use client`): horizontal pill row that auto-
  highlights the active item via `usePathname()` — longest-prefix
  match so nested routes still resolve correctly. Built but not yet
  applied; slice 2 will use it to drive the sector hub's child tabs.
- **Wired**: admin breadcrumbs on `/sectors/[slug]`,
  `/agent-runs/new`, `/agent-runs/[id]` (including the error
  branch); web breadcrumbs on `/compare`. Removed orphaned `Link`
  imports as a side-effect.
- **Tailwind + Docker plumbing**: both app tailwind configs now
  include `packages/ui/src/**/*` in their `content` glob (otherwise
  the shared components' classes get tree-shaken out of the
  generated CSS). The web Dockerfile + `docker-compose.local.yml`
  copy/bind-mount `packages/ui` so docker dev works.

### Phase 2.5 IA slice 2 — Sector hub split (2026-05-21)

Lift the four-tab strip (`live` / `manual` / `graph` / `sources`) out of
a single `?sector=<slug>` page into a proper nested route tree, so each
tool gets its own URL, its own back/forward history entry, and its own
deep link.

New route topology (apps/web):

```
/                          → redirect to /sectors (preserves ?sector and ?scenario)
/sectors                   → server-rendered grid of registered sims
/sectors/[slug]            → overview hub (cards linking to children)
/sectors/[slug]/live       → LiveDashboard
/sectors/[slug]/manual     → ManualPanel (slider editor)
/sectors/[slug]/graph      → GraphView (React Flow causal graph)
/sectors/[slug]/sources    → SourcesView (historical + provenance)
/compare?sector=…&a=…&b=…  → unchanged (normalization is slice 4)
```

Implementation pieces:

- **`apps/web/src/app/sectors/[slug]/layout.tsx`** — RSC; fetches sims,
  meta, sensitivity, initialLive; 404 on unknown slug; renders
  `<SectorShell>` (the chrome) wrapping `{children}`. Layouts in Next 15
  can't see `searchParams` server-side, so scenario hydration is
  client-side (see below).
- **`sector-context.tsx`** — Client React context lifting the shared
  state that used to live in `Workspace`: `driverValues`,
  `activeScenario`, `scenarios`, and all CRUD callbacks. Hydrates
  `?scenario=<id>` share links via `useSearchParams()` on mount —
  brief flash on direct-link landing, no flash for in-app loads.
- **`sector-shell.tsx`** — `"use client"`; renders the persistent chrome
  (LiveStrip, SectorPicker, header, ScenarioBar, ReportPanel modal,
  SubNav) once at the layout level so it stays mounted across child
  route transitions. Loading a scenario routes to `/manual` (preserving
  the original "show me the sliders that changed" affordance).
- **`page.tsx` (overview hub)** — 6-card grid: 4 child-route cards
  (Live / Manual / Graph / Sources) + Sensitivity preview (top-3
  drivers for first output) + Scenarios preview (first 4 saved).
- **Child pages** (`live/`, `manual/`, `graph/`, `sources/`) — each is
  a tiny `"use client"` component that pulls what it needs from
  `useSector()` and renders the existing panel. The panel components
  themselves are untouched.
- **`/sectors/page.tsx`** — Server-rendered grid replacing the bare
  SectorPicker chip strip with a real index. Click → `/sectors/<slug>`.
- **`SectorPicker` URL switch** — `/?sector=X` → `/sectors/X`,
  preserving the sub-path (`/manual`, `/graph`, etc.) so switching
  sectors mid-task doesn't snap you back to Live.
- **Share link** — `ScenarioBar.handleShare()` writes
  `/sectors/<slug>?scenario=<id>` instead of `/?sector=<slug>&scenario=<id>`.
- **Compare Breadcrumbs** — `Sectors → <sector name> → Compare`,
  linked into the new structure.
- **Admin "Open in user app"** — bumped to `/sectors/<slug>` too.
- **Legacy `/`** — converted to a server-side redirect file
  (`apps/web/src/app/page.tsx`) so old bookmarks
  (`/?sector=…&scenario=…`) keep working.
- **`workspace.tsx` deleted** — its responsibilities split between
  `sector-context.tsx` (state), `sector-shell.tsx` (chrome), and the
  4 child route files (tab content).

Verification: web/admin/ui typecheck pass; the in-memory sector-service
suites (sim + agent, 19 tests) still green; the DB-required
`scenario.test.ts` integration suite is skipped/red regardless of this
slice (needs local Postgres — pre-existing environment constraint).

### Equities Milestone 1 — schema + 49 curated US/KR listings + table UI (2026-05-21)

First slice of the §14 Equities & Market Factors domain. Read-only for
now — editorial curation in `seed-equities.ts`; the data-pipeline ingest
job that refreshes quotes daily is Milestone 2.

**Schema** (`packages/db/prisma/schema.prisma`, migration
`20260521000000_sector_equities`):

- `SectorEquity`: FK to `sectors.slug` (cascade delete). Columns:
  ticker, exchange, iso_country, company_name, company_name_local
  (Korean name), sector_exposure_pct (0–100), rationale, snapshot
  pricing (currency, last_close_local + last_close_usd FX-normalized,
  last_close_date, market_cap_usd), `driver_links` JSONB (structured
  editorial linkage — see below), display_order. Unique on
  `(sector_slug, ticker, exchange)`; indexed on `sector_slug` and
  `iso_country`.

`driver_links` shape: array of
`{ driver: string, sign: "+"|"-", magnitude: "low"|"med"|"high", note?: string }`.
Drives the implied-impact computation in the UI without committing to
an econometric model — purely editorial directionality.

**Seed** (`packages/db/prisma/seed-equities.ts`, runnable via
`pnpm db:seed:equities`): 49 listings curated by hand, 10+ per sector,
mix of US (NYSE/NASDAQ) + KR (KOSPI/KOSDAQ):

| sector | count | notable |
|---|---|---|
| memory-semi | 17 | 005930 Samsung, 000660 SK hynix, 042700 Hanmi Semi, MU, NVDA, AMAT, LRCX, TSM ADR |
| space-data-center | 15 | RKLB, ASTS, IRDM, NVDA, EQIX (reverse exposure), 012450 Hanwha Aero, 099320 Satrec |
| sofc | 17 | BE Bloom, PLUG, FCEL, CMI, LIN, 336260 Doosan Fuel Cell, 034020 Doosan Enerbility |

Snapshot prices end-of-day 2026-04-30, FX 1,380 KRW/USD. Each row
carries 2–5 hand-picked `driver_links` referencing the exact driver
names from the sector's Python sim.

**tRPC** (`services/sector-service/src/trpc/equity.ts`):
`equity.listForSector({ sector_slug, iso_country? })` and
`equity.get({ id })`. Read-only; writes happen via the seed script
today and the pipeline service later.

**UI** (`apps/web/src/app/sectors/[slug]/equities/`):

- `EquitiesTable` (client) — investment-grade layout:
  - Top metric strip (4 tiles): equity count + US/KR split, aggregate
    market cap, active driver count (drivers diverged from defaults),
    top-impact ticker.
  - Filter row: country chips (All / 🇺🇸 US / 🇰🇷 KR) + sort dropdown
    (Editorial / Market cap ↓ / Sector exposure ↓ / Implied impact ↓ /
    Ticker A–Z).
  - Sortable table with columns: ticker + flag + exchange, company
    name + Korean name, last close (local + USD parenthetical for KR),
    market cap, sector exposure bar, top-3 driver chips
    (sign-color-coded, magnitude dots ●–●●●), implied-impact score
    (tanh-squashed [-100,+100]), expand toggle.
  - Expand row shows full editorial rationale + every `driver_link`
    with `default → current → Δ% → contrib` decomposition. Driver
    contribution color = green / red matching direction.
- Implied-impact formula: for each link, contribution =
  `(current − default) / |default| × sign × magnitude_weight × 100`
  where `low=0.5, med=1.0, high=2.0`. Sum and squash with
  `100 × tanh(raw/100)` so a single huge slider doesn't pin everything
  at saturation.
- SubNav: new "Equities" tab added to SectorShell.
- Overview hub: new Equities card (replaces nothing — bumped grid to
  `lg:grid-cols-3`) showing count + US/KR split + first 4 tickers.

**Out of scope (Milestone 2+ has):**

- Live ingest (yfinance / AlphaVantage / DART / EDGAR)
- Time-series quote history + sparklines
- Segment-level financials (revenue_usd / ebitda_usd / capex_usd)
- MarketFactor + MarketFactorObservation tables (macro / policy / event)
- EquityExposureModel SDK + per-equity revenue projection from driver state

### Equities Milestone 2 — data-pipeline service + yfinance ingest (2026-05-21)

Second slice of the Equities domain — a dedicated FastAPI service that
refreshes the snapshot fields on `sector_equities` daily from yfinance.
Read path (Milestone 1's tRPC `equity.*`) is unchanged.

**Service** (`services/data-pipeline`, port **8003**, uv workspace member):

```
services/data-pipeline/
├── pyproject.toml             # adds yfinance, apscheduler, asyncpg
├── data_pipeline/
│   ├── __init__.py
│   ├── main.py                # FastAPI app + lifespan + APScheduler wiring
│   ├── adapters/
│   │   ├── base.py            # DataSource Protocol + Quote pydantic model
│   │   ├── fake.py            # in-process source for tests
│   │   └── yfinance_source.py # live; exchange→symbol mapping (.KS/.KQ)
│   ├── jobs/
│   │   ├── __init__.py        # no re-exports (avoids module/function name clash)
│   │   └── refresh_quotes.py  # the actual job
│   └── repo.py                # EquityRepository: Protocol + InMemory + Postgres
└── tests/                     # FakeSource + InMemoryEquityRepository, 18 cases
```

**Adapter contract** (`DataSource`):
```python
async def fetch_quote(symbol: str) -> Quote | None      # one ticker
async def fetch_fx_to_usd(currency: str) -> float | None # USD per 1 unit
```

`YFinanceSource.exchange_to_symbol`:
- `NASDAQ` / `NYSE` → bare ticker (NVDA, MU, …)
- `KOSPI` → `<6-digit>.KS` (005930 → 005930.KS)
- `KOSDAQ` → `<6-digit>.KQ` (042700 → 042700.KQ)

**`refresh_quotes` semantics**:
- Pre-fetches every currency's FX rate once at job start (one upstream
  call per currency, not one per equity).
- Per equity: fetch quote → compute USD = local × fx[currency] → write
  back via `repo.update_quote()`.
- Failure modes are isolated: a single broken symbol counts in
  `missing` / `errors` but never aborts the job. Up to 50 failure
  reasons surface on the result for diagnosis.
- Throttle: 200ms between symbols by default (configurable via
  `INGEST_THROTTLE_MS`).
- If FX for an equity's currency can't be fetched, local price still
  writes but USD-converted fields are nulled so the UI shows the gap.

**Scheduler**: `APScheduler.AsyncIOScheduler`, cron `30 8 * * *` UTC
(17:30 KST, after KOSPI close + a few hours after US close). Disable
via `INGEST_SCHEDULE=off`.

**HTTP surface**:
- `GET  /health` — liveness + `last_refresh` + `next_refresh_at`
- `POST /jobs/refresh-quotes` — manual trigger; returns the result
- `GET  /jobs/refresh-quotes/last` — last result or 404

**Repository** (`repo.py`) — same asyncpg pattern as
`agent-orchestration/repo.py`. `build_repository(database_url)` raises
when `DATABASE_URL` is unset (unlike agent-orchestration's in-memory
fallback, this service is useless without seeded equity rows to iterate).

**Tests** (18 cases, all hermetic — no network, no Postgres):
- adapter contract + exchange→symbol mapping (8)
- refresh_quotes orchestration: happy path, missing symbol, raised
  exception, missing FX, FX prefetched once per currency, KOSDAQ
  suffix (6)
- HTTP surface: /health initial state, manual trigger, /last 404
  before any run, degraded-path 200 (4)

**Docker/compose**: new `data-pipeline.Dockerfile` (multi-stage dev +
prod, port 8003). Wired into `docker-compose.yml` (depends on postgres
+ db-migrate) and `docker-compose.local.yml` (bind-mount + scheduler
off + fake source by default so local dev doesn't poll yfinance).

**Out of scope (Milestone 3+)**:
- EquityQuote time-series table (today: denormalized snapshot only)
- EquityFinancial (revenue / EBITDA / capex segments)
- MarketFactor + MarketFactorObservation (macro / policy / event)
- Sparkline-driven UI updates
- Backtest: "what would NVDA look like if I'd held HBM premium = X
  6 months ago?"
- DART / EDGAR scrapers, FRED, AlphaVantage paid backup

### Equities Milestone 3 — quote-history time-series + sparklines (2026-05-21)

Adds the time-series leg of the equities domain. After M2 refreshes the
snapshot fields daily, M3 adds a per-equity daily-close history table
and surfaces it as inline 90-day sparklines on the equities table.

The price-driver regression piece (visually correlating slider state
with historical returns) is **deferred to M4** — formal econometric
overlays need more thought than a single slice can fit.

**Schema** (`packages/db/prisma/schema.prisma`, migration
`20260521030000_equity_quotes`):

- `EquityQuote`: composite PK `(equity_id, trade_date)` — natural
  unique key per daily bar. Columns: close_local, close_usd (FX
  normalized, nullable), volume, source (default `yfinance`). Indexed
  `(equity_id, trade_date DESC)` for the dominant read pattern
  (last-N-days for one equity). CASCADE delete from sector_equities.
- Decision: regular table not a Timescale hypertable. ~50 equities ×
  ~90 bars = 4,500 rows initial; migration to a hypertable is a future
  ops task once we cross ~1M rows.

**data-pipeline additions**:

- `DataSource.fetch_history(symbol, days)` — Protocol extension
  returning a list of `HistoryBar { trade_date, close_local, volume }`,
  ascending by date.
- `YFinanceSource.fetch_history`: uses `yf.Ticker(symbol).history(period=...)`
  via `_period_for(days)` (3mo / 6mo / 1y / 2y / 5y buckets, sliced
  in Python to honor the exact `days` count). Auto-adjust off so we
  see raw closes.
- `FakeSource.fetch_history`: dict-backed; honors `raise_on` /
  missing-symbol semantics; records `history_calls` for assertions.
- `EquityRepository.bulk_upsert_quote_history(equity_id, bars)`:
  Postgres impl uses `executemany` against `INSERT ... ON CONFLICT
  (equity_id, trade_date) DO UPDATE` so re-runs overwrite cleanly.
  InMemory impl mirrors via `dict[equity_id, dict[date, QuoteBar]]`.
- `refresh_quote_history` job: same shape as `refresh_quotes` (per-
  currency FX prefetch, failure isolation, throttle), but writes the
  full series per equity. Result envelope:
  `RefreshHistoryResult { total, updated, bars_written, empty, errors,
  days, fx_rates, failure_reasons }`.
- HTTP endpoints:
  - `POST /jobs/refresh-quote-history?days=90` — manual trigger
  - `GET  /jobs/refresh-quote-history/last` — last result or 404

Note: the job applies the *current* FX to every historical bar (no
true historical FX). Milestone 4 may backfill via FRED's
exchange-rate series; for now this is a known approximation.

**sector-service**:

- New `equity.history({ id, days?: 90 })` tRPC procedure (read-only),
  returns array of `{ trade_date, close_local, close_usd, volume }`.
  404 on unknown id; empty array when ingest hasn't run yet.

**`@platform/ui`**:

- New `Sparkline` component — dependency-free SVG. Props:
  `values[], width=96, height=28, stroke?, filled?, showLastDot?,
  ariaLabel?`. Auto-colors green/red by first→last direction;
  caller can override via `stroke`. RSC-safe (no client hooks).
  Single-value / all-equal inputs render a flat dashed midline.

**Web UI** (`apps/web/src/app/sectors/[slug]/equities/equities-table.tsx`):

- Lazy-parallel history fetch on mount (`Promise.all` over all
  equities at once). Each row's sparkline pops in as its history
  arrives — initial render isn't blocked.
- New "90d trend" column: Sparkline (88×26, filled, last-dot) +
  period-return chip color-coded green/red. Renders `…` while
  loading, `—` if no bars ingested.
- Expand panel now lays out 2/3 + 1/3:
  - left: 편입 사유 + driver linkage decomposition
  - right: 280×60 sparkline + period-return / min / max / date-range
    panel
- Footnote updated to call out yfinance ingest as the bar source so
  users see why the trend column may be empty before the
  data-pipeline job runs.

**Tests** (6 new in data-pipeline, 33 total in that service):

- happy path: USD + KR equity, FX-converted close_usd
- KOSDAQ `.KQ` suffix used
- empty history counted as `empty` (not error), not fatal
- raised exception isolated
- missing FX nulls close_usd but writes local
- idempotent upsert on repeat (overwrite-on-conflict)

**Tally** (cumulative)
- agent-orchestration: 35 pass + 2 skipped
- simulation-service: 55
- data-pipeline: 27 (was 18 in M2 + 3 tz regression + 6 history)
- sector-service in-mem: 19
- **total: 136 pass + 2 skipped**

**End-to-end smoke** (when Postgres is running):

```bash
pnpm db:migrate                        # picks up equity_quotes migration
pnpm db:seed                           # 3 sectors
pnpm db:seed:equities                  # 49 equities
curl -X POST http://localhost:8003/jobs/refresh-quotes        # snapshot
curl -X POST http://localhost:8003/jobs/refresh-quote-history?days=90  # history
# → open http://localhost:3000/sectors/memory-semi/equities — sparklines
#   should appear next to each ticker within a second of load
```

**Out of scope (M4+)**:

- Price-driver regression / backtest — "if I'd held HBM premium at X
  90 days ago, where would NVDA be"
- Historical FX time-series (FRED exchange-rate API)
- Sparkline overlay showing the projected impliedImpact line vs the
  actual price line on the expand chart
- Quote refresh scheduler split (snapshot vs history can run on
  different cadences)

### Equities Milestone 4 — basket β/α/σ/MDD + dual sparkline (2026-05-21)

Adds the analytical leg on top of M3's time-series. Each equity now
gets per-sector β/α/σ/max-DD measured against an equal-weighted basket
of every equity in its sector, plus a dual sparkline (equity vs basket)
in the expand panel.

This is the "price-driver regression" piece, kept honest about its
scope — we're correlating equities against a peer basket, not against
slider state. Mapping slider state → projected price line is even
further (model layer) and is deliberately deferred.

**Pure math** (`services/sector-service/src/lib/stats.ts`):

- Generic descriptive: `mean / variance / stdev / covariance / correlation`
- Series helpers: `dailyReturns / cumulativeIndex / maxDrawdown`
- CAPM fit: `fitCapm(equity_r, basket_r) → { beta, alpha_annual_pct, r_squared }`
- Aggregator: `computeBasketStats(series[]) → { basket, equities[] }`
  - Basket date axis = union of *bar* dates (not return dates) so
    visually aligns from day 0 with any equity's price chart
  - First entry: `basket_index = 100` on the earliest date; compounds
    by mean of available equity returns each subsequent date
  - Per-equity CAPM fit uses only dates where both that equity and
    the basket have a return (skips holiday-asymmetric calendars)

**Tests** (`tests/stats.test.ts`, 17 cases): descriptive stats edge
cases, CAPM β=1/2/null sanity, KR-holiday alignment, monotonic-up
no-drawdown, empty/single-bar graceful nulls.

**tRPC**: `equity.basketStats({ sector_slug, days?: 90 })` →
`{ basket: { trade_date, basket_index }[], equities: { id, return_pct,
volatility_annual_pct, max_drawdown_pct, beta, alpha_annual_pct,
r_squared, bars_used }[] }`. Single Postgres round-trip per call:
one `findMany` over sector_equities + one over equity_quotes (filtered
by `equity_id IN (...)`), then math in-process.

**Sparkline overlay** (`@platform/ui/sparkline`): new optional
`overlayValues[]` + `overlayStroke` props. Drawn dashed neutral-500
behind the primary line; both series share the same y-domain so the
comparison is honest. Caller normalizes both to base-100 before
passing (see expand panel below).

**UI** (`apps/web/src/app/sectors/[slug]/equities/equities-table.tsx`):

- Mount-time `fetchBasketStats(sectorSlug, 90)` in parallel with the
  per-equity history fetches. Indexed by equity_id for O(1) row lookup.
- Trend column: β chip added under the period-return chip (uppercase
  small caps, "β 1.24").
- Expand panel re-laid-out:
  - Dual sparkline (280×60): equity normalized to base 100 +
    basket index dashed overlay. Legend row beneath ("종목" /
    "섹터 바스켓").
  - First stats grid (3-up): period return / min / max.
  - Second stats grid (4-up, only when basketStats present):
    β vs basket / α annualized % / volatility annualized % / max DD.
  - Footer line: date range · bars count · `β·α fit on N aligned
    returns · R² 0.xx`.

**Tally**
- sector-service vitest: 36 (was 19 + 17 stats)
- agent-orchestration: 35 + 2 skipped
- simulation-service: 55
- data-pipeline: 27
- **total: 153 + 2 skipped**

**Deferred to a future slice (still M5/M6 stuff)**:
- Slider-state → projected price overlay (forward dotted line from
  today's close to today × (1 + impliedImpact-derived target))
- True historical FX series for past close_usd backfill (FRED)
- Sector-rotation / factor breakdown beyond the equal-weighted basket
- Per-equity attribution showing which driver_links contributed to
  realized return over the period

### Equities Milestone 5 — slider → projected price overlay (2026-05-21)

Closes the loop the user opened in M1: a simulation slider drag now
shows up directly on every equity's price chart as a forward-30d
dashed projection. The chart says, in one glance: *"this is where the
price has been; this is where the current driver state implies it's
heading."*

Math (intentionally simple — editorial signal, not a forecast):

```
score        = impliedImpact ∈ [-100, +100]   # M1 formula
projected%   = score × 0.3                    # ±30% saturation cap
projected px = last_close × (1 + projected% / 100)
```

`projectFromImpact(lastClose, score)` is suppressed when
`|score| < 1` so resting-default charts stay clean. `PROJECTION_SCALE`,
`PROJECTION_DAYS`, `PROJECTION_THRESHOLD` are constants at the top of
`equities-table.tsx` — easy to tune as the editorial team calibrates.

**Sparkline component** (`@platform/ui/sparkline`):

Adds a third series alongside the existing `values` + `overlayValues`:

- `projectionValues?: number[]` — drawn dashed, **continuing from the
  last x of `values`** (first projection point usually equals last
  value for continuity). The x-axis is widened to accommodate, the
  y-domain pools all three series, and the projection endpoint gets
  its own colored dot.
- `projectionStroke?: string` — explicit color override; otherwise
  auto-greens when the projection ends above its start, auto-reds
  when below.

**UI integration** (web equities table):

- Trend column: the small sparkline now sprouts a dashed continuation
  every time the user drags a slider. Re-renders on every score
  change — at the ~50-equity scale it's instant.
- Expand panel:
  - Big sparkline gets the same projection (normalized to base 100)
  - New 3-up "projection" stat tile (cyan-tinted) under the chart:
    30d projection % / implied target price / impact score · active
    links count
  - Footer text explains "score × 0.3% → forward 30d dashed line"
    so the user understands what they're looking at

**No backend changes** — projection is purely derived UI state from
impliedImpact (client-computed since M1) and the last close price
(from M3's quote history). Drag responsiveness is bounded by React
re-render only.

**Verification**
- TS typecheck across web / admin / sector-service / ui / db ✅
- sector-service vitest: 36 pass (no regression — scenario.test.ts
  remains skipped without local Postgres, as before)
- No new Python tests; data-pipeline / agent-orchestration / sim-service
  test totals unchanged (27 / 35+2 / 55)
- **Cumulative: 153 + 2 skipped** (same as M4 — this slice is pure UI)

**Calibration note for future**: PROJECTION_SCALE = 0.3 means a
saturated impliedImpact of +100 produces a +30% 30-day projection.
That's aggressive — real 30-day single-name moves at that magnitude
are rare. The conservative alternative is 0.15 (±15% max). Easy to
flip when we have a real backtest to calibrate against (M6+).

**Out of scope (M6+)**:
- Real backtest: replay 90 historical days with the *current*
  impliedImpact formula and see how its prediction lines up vs realized
  returns — would let us calibrate SCALE empirically
- Multi-horizon projections (30d / 90d / 1y) selectable per row
- Confidence cone (low/med/high bands) instead of a single dashed line
- Slider-to-projection animation hint (motion when score changes)

### Phase 2 Epic — Graph SoT + Equity nodes + Financials (2026-05-21)

Approved plan in
`.claude/plans/fluffy-plotting-hanrahan.md`. A 5-slice train (M6→M10)
that restructures the platform so the causal graph becomes the
authoritative topology (DB-backed, editable, consumed by the sim),
equities become first-class graph nodes, and `EquityFinancial` joins
as a sibling time-series domain.

Decisions baked in (per `AskUserQuestion` round before plan exit):

- **Sim ↔ graph**: hybrid weights. Edge `weight` (default 1.0)
  multiplied at choke points inside Python `simulate()`. Graph
  topology change → sim output shift in real time.
- **Equities in graph**: each `SectorEquity` becomes one
  `GraphNode(kind="equity")`; existing `driver_links` JSONB lifts to
  `GraphEdge` rows during seed.
- **Mock first, real adapter later** for EquityFinancial — DART/EDGAR
  adapters are deferred to a follow-up M10b slice.

#### Equities Milestone 6 — EquityQuote mock seed (2026-05-21)

Foundation slice: without mock historical bars, fresh
`docker compose up` shows blank sparklines (data-pipeline ingest
hits yfinance, which isn't reachable in many dev environments). This
unblocks visual validation of every subsequent M7–M10 UI change.

**What ships:**

- `packages/db/src/mock-quotes.ts` — pure functions
  (`mulberry32`, `gauss`, `hash32`, `buildSeries`) for deterministic
  per-equity random walks. PRNG seeded by `hash(ticker || exchange)`
  so runs are stable across machines. Anchor: walk *backwards* from
  `last_close_local` on `last_close_date` so day-0 matches the
  snapshot exactly (no drift between card and sparkline endpoint).
- `packages/db/prisma/seed-equity-quotes.ts` — I/O layer. Reads
  every `SectorEquity`, generates 90 mock bars, deletes any prior
  `source = "mock"` rows for the equity, then bulk inserts via
  Prisma `createMany`.
- `packages/db/package.json` — adds `seed:equity-quotes` script +
  `vitest` devDep + `test` script.
- Root `package.json` — adds `db:seed:equity-quotes`.
- `docker-compose.yml` — `db-migrate` command chain becomes
  `migrate:deploy && seed && seed:equities && seed:equity-quotes`,
  so a fresh boot now produces ~4,410 EquityQuote rows automatically.
- `packages/db/tests/mock-quotes.test.ts` — 17 vitest unit tests
  covering: PRNG determinism, Box-Muller mean, exchange-keyed
  volatility, FX conversion, anchor pin, sort order, daysBack
  override, missing-anchor degradation, positive prices under high
  σ, positive integer volume.

**Volatility assumptions** (rough, not calibrated):

- KR exchanges (`KOSPI`, `KOSDAQ`): 1.8% daily σ
- US exchanges (`NASDAQ`, `NYSE`): 2.2% daily σ
- Drift: +0.024%/day (~+6%/yr neutral baseline)

These are placeholders — real volatility varies wildly per name and
will be replaced once yfinance ingest runs in CI.

**Verification:**

- `pnpm --filter @platform/db test` → 17/17 pass
- TS typecheck across web / admin / sector-service / ui / db ✅
- sector-service: 36 pass / 2 fail (scenario.test.ts — DB
  unavailable, pre-existing)
- `pnpm db:seed:equity-quotes` against local Postgres produces
  exactly 49 × 90 = 4,410 rows; re-running is idempotent (delete +
  recreate same series byte-for-byte).
- **Cumulative: 170 + 2 skipped** (+17 from M5).

**Out of scope (lands in M7+):**

- Graph topology in DB (M7)
- Equity nodes inside graph (M8)
- Sim consumes edge weights (M9)
- EquityFinancial domain (M10)

#### Equities Milestone 7 — Graph topology in DB + tRPC mutations (2026-05-21)

The causal graph leaves Python source and becomes editable DB state.
Python `SimGraph` literals stay as the *bootstrap source*; after the
seed runs, `graph_nodes` and `graph_edges` are authoritative.

**Schema** (`packages/db/prisma/schema.prisma` +
`migrations/20260522000000_graph_topology/migration.sql`):

- `graph_nodes(id, sector_slug, node_key, kind, label, group, unit,
  description, position_x, position_y, equity_id, ...)` with
  `@@unique([sector_slug, node_key])`. `kind` ∈ {driver,
  intermediate, output, equity}. `equity_id` is an optional FK to
  `sector_equities` (SET NULL on equity delete) for M8 nodes.
- `graph_edges(id, sector_slug, source_key, target_key, label,
  weight, magnitude, origin, author_label, ...)` with
  `@@unique([sector_slug, source_key, target_key])`. `weight`
  defaults to `1.0` — a no-op multiplier today; Milestone 9
  threads it into the Python sim at choke points. `origin` ∈
  {seed, edit, agent} so we can later distinguish what came from
  the Python literal vs. user edits vs. future agent generation.
- `audit_logs(id, action, sector_slug, payload, author_label,
  created_at)` — append-only record of every mutation. CLAUDE.md
  mandates audit for admin actions; we extend it to graph + future
  scenario edits so once auth lands we can backfill attribution.

**Bootstrap** (`packages/db/prisma/seed-graph.ts`): hits
simulation-service `GET /sims/{slug}/graph` for every registered
sector and upserts the rows. Idempotent — re-runs preserve any
`weight` / `magnitude` edits (only `label` is refreshed). Compose
adds a new `graph-bootstrap` one-shot service that depends on
`db-migrate` completion + `simulation-service` start, sleeps 5s,
then runs `pnpm db:seed:graph`. `sector-service` now waits on
`graph-bootstrap` to complete before starting.

**tRPC** (new `services/sector-service/src/trpc/graph.ts`):

| Procedure | Type | Use |
|---|---|---|
| `graph.get({ sector_slug })` | query | Returns full topology (nodes + edges) |
| `graph.upsertNode({ ... })` | mutation | Create / update via `(sector_slug, node_key)` |
| `graph.deleteNode({ ... })` | mutation | Guarded — refuses if attached edges exist |
| `graph.upsertEdge({ ..., weight, magnitude, ... })` | mutation | Endpoint existence checked first |
| `graph.deleteEdge({ ... })` | mutation | NOT_FOUND on missing |
| `graph.resetToDefaults({ ... })` | mutation | Wipes sector graph (caller re-runs `seed:graph`) |

Every mutation writes an `audit_logs` row with the full input as
`payload`.

**Web client** (`apps/web/src/lib/sim-client.ts`):

- `DbGraph` / `DbGraphNode` / `DbGraphEdge` types inferred from the
  router output.
- `fetchDbGraph(sector_slug)`, `normalizeDbGraph(db)`,
  `upsertGraphEdge(...)`, `deleteGraphEdge(...)`,
  `resetGraphToDefaults(slug)` helpers.
- `normalizeDbGraph(db)` is the bridge: it reshapes the DB graph
  (`node_key` / `source_key` / `target_key` field names) into the
  legacy `SimGraphResponse` shape that `GraphView` already speaks,
  so the renderer is untouched at the M7 boundary.

**`GraphView`** (`apps/web/src/app/graph-view.tsx`) now prefers the
DB graph and falls back to the upstream Python graph if the DB
returns zero nodes — keeps `/sectors/[slug]/graph` working in dev
between schema apply and `seed:graph` running.

**Tests** (`services/sector-service/tests/graph.test.ts`): 15
integration cases covering upsert / unique / NOT_FOUND / equity FK
guard / endpoint guard / weight clamp / reset round-trip / audit
log row count. DB-required; auto-skips when Postgres is unreachable
(same pattern as `scenario.test.ts`).

**Verification:**

- TS typecheck across web / admin / sector-service / ui / db ✅
- `@platform/db` vitest (mock-quotes): 17/17 pass (no regression)
- `sector-service` vitest: 36 pass / 26 skipped (15 new graph cases
  skipped under no-DB env; same execution baseline as before M7).
- **Cumulative: 170 + 17 skipped → 170 active, +15 ready-to-run on
  DB-enabled CI.**

**Out of scope (lands in M8+):**

- Equity nodes as graph kind (M8)
- Edge editor side panel UI with weight slider (M8 + M9)
- Python sim actually consuming `weight` at runtime (M9)
- Removing the `sim.graph` upstream proxy (cleanup post-M9)

#### Equities Milestone 8 — Equity nodes inside the graph (2026-05-21)

Each `SectorEquity` row is promoted to a first-class
`GraphNode(kind="equity")`. The `driver_links` JSONB that M1 used as
an editorial overlay becomes a set of `GraphEdge` rows with weights
derived from `sign × magnitude`. The renderer learns about a new
fourth column on the right of the existing driver → intermediate →
output flow.

**Seed** (`packages/db/prisma/seed-graph-equities.ts`): for every
equity, upsert one `GraphNode(kind="equity", equity_id=…)` keyed
`equity_<TICKER>_<EXCHANGE>` + one `GraphEdge` per `driver_links`
entry. Weight mapping reproduces the M1 magnitudeWeight exactly so
M9's graph-traversal score doesn't shift the UX:

```
magnitude_weight = {low: 0.5, med: 1.0, high: 2.0}
weight = sign * magnitude_weight   # sign ∈ {+1, -1}
```

Edges whose `driver_links.driver` doesn't match any seeded driver
node are skipped with a log warning (catches stale hand-typed
references). Hooked into the `graph-bootstrap` compose service
chain after `seed:graph` so a fresh boot ends with every sector's
equity nodes pre-wired.

**Pure-math lib** (`services/sector-service/src/lib/graph-impact.ts`):
`computeImpactScores({ driverValues, driverDefaults, edges })`
returns `{equity_node_key: score ∈ [-100, +100]}` using:

```
raw_i  = (driver_value_i - default_i) / |default_i|
score  = 100 * tanh( Σ edge.weight × raw_i )
```

Division-by-zero on `default_i = 0` is skipped (drift from zero has
no defined %-change baseline). M9 wires this into the equity table
to replace the client-side `impliedImpact` formula; M8 ships the
math + unit tests only.

**Graph renderer** (`apps/web/src/app/graph-view.tsx`):

- `KIND_COLORS` gains a `equity` variant (yellow/gold accent — distinct
  from output amber).
- Layout becomes 4-column (driver / intermediate / output / equity).
  Equity column is at x=1280 with a tighter 56px row height so a
  17-ticker basket fits without blowing the canvas vertically.
- Legend gains an "equities" chip when the sector has any.
- Help text updated: "M9에서 슬라이더 변경이 weighted 합으로 종목에 전파"

**Tests** (`services/sector-service/tests/graph-impact.test.ts`):
9 vitest unit cases covering: 0 at defaults, positive lift from
positive-weight driver, negative for negative-weight, ±100
saturation, multi-edge summation, missing driver skip, zero-default
skip, no-output for unreferenced equities, independent equities.

**Verification:**

- TS typecheck across web / admin / sector-service / ui / db ✅
- `@platform/db` vitest: 17/17 pass (no regression)
- `sector-service` vitest: 45 pass / 26 skipped (+9 from
  graph-impact; graph.test.ts + scenario.test.ts still skip
  under no-DB env, expected).
- **Cumulative: 179 + 17 skipped** (+9 from M7 baseline).

**Out of scope (lands in M9):**

- Edge editor side panel UI (weight slider, magnitude select,
  delete button)
- Python `simulate()` reading edge weights at choke points
- Replacing M1's client-side `impliedImpact` with the
  `graph-impact.ts` server-side traversal
- Cache invalidation contract (`/sims/{slug}/reload`)

#### Equities Milestone 9 — Hybrid edge weights end-to-end (2026-05-21)

The architecturally biggest slice — actually wires graph edits to
simulation outputs and to per-equity projection scores. Default
weight `1.0` on every edge means the legacy hand-coded math is
byte-identical until a user (or agent) starts editing weights.

**SDK** (`packages/sdk-python/platform_sdk/base.py`):

```python
class EdgeWeights(dict[tuple[str, str], float]):
    def w(self, source: str, target: str) -> float:
        return self.get((source, target), 1.0)

class SimulationBase:
    def __init__(self, edge_weights: EdgeWeights | None = None):
        self.edge_weights = edge_weights or EdgeWeights()
    def w(self, source: str, target: str) -> float:
        return self.edge_weights.w(source, target)
```

The pattern in sims: `result_t = ... * self.w("src", "tgt")` at
each choke point. Sims that haven't been refactored continue to
work — they just ignore weights.

**Refactored sim** (`simulation_service/sims/memory_semi.py`):
14 choke points wired (HBM revenue triple, commodity revenue
quadruple, company revenue pair, COGS pair, opex pair, capex pair).
Snapshot regression confirms `simulate()` with empty weights ==
legacy outputs exactly.

space-data-center and sofc sims are left weight-naive in M9 — they
work fine without the hooks; refactor lands as a follow-up cleanup
when the editor surfaces them.

**simulation-service wire**:
- `SimRunRequest` gains `edge_weights: list[EdgeWeightInput]`
- `main.py /sims/{slug}/run` translates list → `EdgeWeights` dict
  (skipping neutral 1.0 entries to keep the map tiny) and passes
  via `sim_cls(edge_weights=ew).simulate(**resolved)`.

**sector-service wire**:
- `sim.run` reads `graph_edges` for the sector, filters non-neutral,
  forwards to simulation-service. Falls back to `[]` on DB error so
  the sim still runs (graph is additive, not gating).
- New `equity.impactScores({ sector_slug, driver_values })` query:
  walks the same graph topology to compute per-equity impact
  scores via the M8 `graph-impact.ts` lib. Returns `{equity_id:
  score ∈ [-100, +100]}`. Hits `/sims/{slug}` once to get driver
  defaults; the rest is in-process math.

**Web wire** (`apps/web/src/app/sectors/[slug]/equities/equities-table.tsx`):
- New `useEffect` re-fetches `equity.impactScores` whenever the
  driver values change.
- `enriched` prefers the server score when available; falls back
  to M1's client-side `impliedImpact` formula when the map is
  empty (graph not seeded).
- The downstream M5 projection (slider → forward 30d dashed line)
  now reads the server score — every equity's projection in
  the sector responds to graph weight edits in real time.

**Tests:**

- `services/simulation-service/tests/test_edge_weights.py` —
  6 regressions: neutral weights produce identical outputs to
  legacy; all-ones map = no-op; 2× weight on industry→company
  revenue exactly doubles peak revenue; weight=0 on capex edge
  zeroes capex line + lifts FCF; negative weight inverts
  contribution; `.w()` defaults to 1.0 for unset pairs.
- Existing test `sim.test.ts > forwards driver overrides as POST
  body` updated to expect `edge_weights: []` field.

**Verification:**

- TS typecheck (5 workspaces) clean
- `@platform/db` vitest: 17/17 pass (no regression)
- `sector-service` vitest: 45 pass / 26 skipped (same as M8)
- `simulation-service` pytest: 61 pass (+6 from test_edge_weights)
- agent-orchestration pytest: 35+2 skip (unchanged)
- data-pipeline pytest: 27 (unchanged)
- **Cumulative: 185 + 17 skipped** (+6 from M8 baseline).

**Out of scope (lands in M10+):**

- Edge editor side-panel UI with weight slider (the UI surface
  exists in plan; M9 ships the backend plumbing first)
- Cache invalidation `/sims/{slug}/reload` endpoint (sector-service
  reads `graph_edges` on every `sim.run` already — single
  Postgres lookup; we can add caching later)
- space-data-center + sofc choke-point refactor (defer until the
  editor exposes their edges to users — premature without UI demand)

#### Equities Milestone 10 — EquityFinancial domain (mock-seeded) (2026-05-21)

Closes the Phase 2 epic train: each equity now carries 8 quarters of
mock-seeded fundamentals (revenue, COGS, gross_profit, opex, EBITDA,
net_income, capex). DART/EDGAR real-data adapter splits to M10b.

**Schema** (`packages/db/prisma/schema.prisma` + migration
`20260522030000_equity_financials/migration.sql`):

```prisma
model EquityFinancial {
  equity_id      String
  fiscal_year    Int
  fiscal_quarter Int       // 1..4
  period_end     DateTime  @db.Date
  revenue_usd, cogs_usd, gross_profit_usd, opex_usd,
  ebitda_usd, net_income_usd, capex_usd: Float?
  source         String   @default("mock")
  @@id([equity_id, fiscal_year, fiscal_quarter])
}
```

**Mock generator** (`packages/db/src/mock-financials.ts`):
- Anchor: `market_cap_usd / 8` as rough quarterly revenue baseline
- Quarterly growth: ~2.4% (≈ 10%/yr) compounded back from "today"
- Per-equity margins drawn from deterministic mulberry32 PRNG seeded
  by `hash(ticker || exchange || "financials")`:
  - gross margin 25-45%
  - opex (R&D + SG&A) 10-22% of revenue
  - capex 10-30% of revenue
  - tax + depreciation drag 30-45% of EBITDA
- Each quarter wobbles ±3% off the trend line
- Accounting identities preserved: `revenue = cogs + gross_profit`,
  `ebitda = gross_profit - opex`

**Mock seed** (`packages/db/prisma/seed-equity-financials.ts`): for
every equity with non-null `market_cap_usd`, deletes prior
`source="mock"` rows then bulk inserts the regenerated series.
Idempotent. Wired into `db-migrate` compose chain after
`seed:equity-quotes`.

**tRPC** (`equity.financials({ id, quarters?: 8 })`): returns array
sorted by `period_end` desc.

**Web** (equities-table.tsx):
- New `EquityFinancialsPanel` lazy-loaded on row expansion
- New `MiniBarChart` dependency-free SVG component (4 charts:
  Revenue / Gross margin % / EBITDA / Capex)
- "Mock data" amber badge in the section header
- Auto-color: cyan when last >= first (positive trend), grey
  otherwise

**Tests** (`packages/db/tests/mock-financials.test.ts`): 15 vitest
cases — quarter-end dates, 8-quarter default, determinism per
ticker, distinct per ticker, scale matches anchor ±20%, growth
within ±2pp of configured, accounting identities, capex
fractional bounds, missing-anchor degradation, quarters override,
endYear/endQuarter override, fiscal_quarter ∈ [1,4].

**Verification:**

- TS typecheck (5 workspaces) clean
- `@platform/db` vitest: 32/32 pass (17 quotes + 15 financials)
- `sector-service` vitest: 45 pass / 26 skipped (unchanged)
- `simulation-service` pytest: 61 pass (unchanged)
- **Cumulative: 200 + 17 skipped** (+15 from M9 baseline).

**Out of scope (M10b → future):**

- DART OPEN API adapter for KR fiscal data
- SEC EDGAR XBRL Facts adapter for US 10-K / 10-Q
- `source = "dart"` / `source = "edgar"` variants alongside mock
- data-pipeline refresh job for quarterly cadence
- Reconciliation: warn when mock and real values diverge >50%

#### Equities Milestone 11 — Graph editor UI (2026-05-21)

Brings the M7-M9 backend plumbing alive. Up to this slice every
`graph.upsertEdge` / `deleteEdge` / `upsertNode` mutation was
wired but unreachable from the UI — `/sectors/[slug]/graph` was
purely a viewer. M11 ships the side panel, click handlers,
weight slider, and drag-new-edge connector.

**Side panel** (`apps/web/src/app/graph-side-panel.tsx`):

- Slides in from the right when an edge or node is clicked
- Edge mode:
  - Source → target label (using human-readable node labels, not raw keys)
  - Weight slider [-2.0, +2.0] step 0.05 with color chip:
    cyan if amplifying (>1), amber if dampening (0..1),
    rose if inverse (<0)
  - Magnitude select: low / med / high (UI styling only — math reads weight)
  - Label text input (commits on blur)
  - Delete button with confirm prompt
  - Status chip: "저장 중…" / "저장 실패" / "변경은 자동 저장됩니다"
- Node mode:
  - Read-only details (label / kind / group / unit / description)
  - For equity nodes: link to `/sectors/[slug]/equities`
  - Note: node editing lands in a follow-up slice
- Closes on the X button, Escape key, or click outside the canvas

**Graph view** (`apps/web/src/app/graph-view.tsx`):

- Keeps `DbGraph` raw state in addition to the legacy
  `SimGraphResponse` shape so the renderer has access to
  `weight` + `magnitude` for edge styling and the panel for editing
- `editable` mode flips on iff the DB graph is loaded (vs the
  Python-side `sim.graph` fallback). Read-only badge in the header
  when the seed hasn't run yet
- Click handlers:
  - `onEdgeClick` → opens edge panel with the canonical row
  - `onNodeClick` → opens node panel
  - `onPaneClick` → closes the panel
  - `onConnect` (React Flow drag-new-edge from right-handle to
    left-handle) → creates a `weight=1.0, magnitude=med` edge
    and opens the panel so the user can tune it immediately
- Optimistic local state mutation; failure rolls back via
  `fetchDbGraph` re-fetch. Top-of-page error banner shows the
  reason if a mutation fails.
- Edge styling derived from `(weight, magnitude)`:
  - Color: cyan when amplifying (>1.05), rose when inverse (<0),
    grey at neutral (~1), faded grey when dampening (<0.95)
  - Stroke width: low=0.75 / med=1.25 / high=2.0
  - Label appends `· w=X.XX` when |weight - 1| > 0.001 so a
    weighted edge is identifiable at a glance
- React Flow `nodesConnectable={editable}` plus `nodesDraggable={editable}`
  plus `elementsSelectable={editable}` — read-only fallback stays
  truly read-only

**Web client** (`apps/web/src/lib/sim-client.ts`):

No new procedures — M7 already shipped `upsertGraphEdge`,
`deleteGraphEdge`, `resetGraphToDefaults` wrappers. M11 just uses
them.

**Verification:**

- TS typecheck (5 workspaces) clean
- @platform/db vitest: 32/32 pass (unchanged)
- sector-service vitest: 45 pass / 26 skipped (unchanged)
- Manual smoke (planned in dev compose):
  1. `/sectors/memory-semi/graph` → see graph with editable badge
  2. Click any edge → panel opens, weight slider works
  3. Slide weight to 2.0, release → toast "변경은 자동 저장됩니다"
  4. Navigate to `/sectors/memory-semi` overview → outputs reflect new weight
  5. Drag from a driver's right handle to an equity's left handle → new edge created at w=1.0, panel opens

**Out of scope (lands in M12+):**

- Node create / rename / delete (only edge-level mutations exposed
  this slice)
- Reset-to-defaults button in the UI (mutation exists at
  `graph.resetToDefaults`; needs a re-seed-from-Python step
  before exposing — defer until that flow is clean)
- Audit log viewer in admin app (`audit_logs` table is being
  written; visualization is a separate slice)
- Multi-select + bulk edit (currently single-selection only)
- Undo via audit log replay
- Hot-reload on `simulation-service` cache (sector-service
  re-reads on every `sim.run`, so the editor's changes are
  visible instantly; explicit cache invalidation isn't needed
  unless the sim grows hot caching later)

#### Equities Milestone 12 — Node CRUD UI (2026-05-21)

Completes the graph editor: nodes are now editable in the side
panel + creatable via an "Add node" modal. Removal already worked at
the backend; M12 wires it through the UI.

**Side panel — Node mode now editable** (`graph-side-panel.tsx`):

- Label / Group / Unit / Description text inputs (commit on blur)
- Warning chip when the node is driver- or equity-kind: "Python sim /
  SectorEquity row 과 연결됨 — 재부트스트랩 시 덮어쓰일 수 있음"
- "Delete node" button (server-side guard refuses if attached edges
  exist; the panel surfaces the BAD_REQUEST message)

**Add-node modal** (`GraphAddNodeModal`):

- Triggered by "+ Add node" toolbar button (editable mode only)
- Node key input with a-z / 0-9 / _ filter + collision check against
  existing node_keys
- Kind picker: intermediate or output (driver / equity come from
  upstream sources)
- Label (required), group, unit, description fields
- Disabled "Create" button until key + label are valid
- Posts via `graph.upsertNode` mutation → optimistic local insert

**Graph view** wiring:

- New `handleCommitNode` + `handleDeleteNode` callbacks with optimistic
  patches + rollback on error (same pattern as M11 edge handlers)
- Newly-created nodes are merged into local state in the same patch
  cycle so the toolbar button gives instant feedback even before
  React Flow re-renders

#### Equities Milestone 13 — Reset graph via re-bootstrap (2026-05-21)

The `graph.resetToDefaults` tRPC mutation now does an end-to-end
re-bootstrap instead of just wiping. Inlines the logic from
`seed-graph.ts` + `seed-graph-equities.ts` so the user can hit a
"Reset" button without dropping to a shell.

**Sector-service** (`services/sector-service/src/trpc/graph.ts`):

- New helper `rebootstrapGraph(ctx, sector_slug)`:
  1. Wipes `graph_nodes` + `graph_edges` for the sector
  2. Fetches the Python `SimGraph` from
     `GET /sims/{slug}/graph` and re-creates driver / intermediate /
     output nodes + their neutral (`weight=1.0`) edges
  3. Reads `sector_equities` for the sector and promotes each row to
     a `GraphNode(kind="equity")` plus driver→equity edges with
     `weight = sign × magnitude_weight` (matches M8 seed exactly)
- `graph.resetToDefaults` returns the full stat tuple
  (`{nodes, edges, equity_nodes, equity_edges, skipped_driver_misses}`)
- New `graph.wipe` mutation preserves the *old* destructive-only
  behavior for tests and admin operations

**Web** (`graph-view.tsx`):

- "↻ Reset" amber button next to "+ Add node" in the editor toolbar
- `confirm()` dialog before firing — wiping pending user edits is
  destructive
- On success: success banner with the rebuild stats
  (`재구성 완료 — N 노드 · M edges + K 종목 · L driver→equity edges`)
- On failure: existing mutation-error banner picks it up

**Test surface**:

- The graph integration test that previously asserted wipe-only
  behavior now calls `graph.wipe` instead. The full rebootstrap path
  needs a reachable simulation-service so it's exercised manually
  via the UI button + per-slice docker smoke.

#### Equities Milestone 10b — DART + EDGAR real financials adapters (2026-05-21)

Replaces the M10 mock fundamentals with real upstream data. The
adapters drop in alongside M10's mock; toggle by setting `INGEST_SOURCE`
in `data-pipeline`.

**New adapter layer** (`services/data-pipeline/data_pipeline/adapters/`):

- `financials_base.py` — `FinancialQuarter` pydantic model +
  `FinancialsSource` Protocol. USD-normalized at the adapter layer.
- `fake_financials.py` — `FakeFinancialsSource` (deterministic mulberry-
  style walk per ticker) for tests and `INGEST_SOURCE=fake` smoke
- `edgar_source.py` — SEC EDGAR XBRL Facts adapter:
  - Caches `sec.gov/files/company_tickers.json` for ticker → CIK
  - Hits `data.sec.gov/api/xbrl/companyfacts/CIK{cik}.json`
  - Walks fallback chains per concept (Revenues /
    RevenueFromContractWith…, CostOfRevenue / CostOfGoodsAndServicesSold,
    OperatingIncomeLoss, NetIncomeLoss, PaymentsToAcquirePPE)
  - Filters to `qtrs=1` rows so we get true quarterly slices
  - Aggregates into `FinancialQuarter` (gross profit / opex derived)
  - Requires `EDGAR_USER_AGENT` env var (`"Project name email@host"`)
    per SEC fair-access policy
- `dart_source.py` — OPEN DART (한국 금융감독원) adapter:
  - Hand-curated ticker → corp_code map for the 16 KR equities in
    `seed-equities.ts`
  - Hits `opendart.fss.or.kr/api/fnlttSinglAcnt.json` per (corp,
    year, reprt_code)
  - Matches K-IFRS line items by substring (매출액 / 영업이익 /
    당기순이익 / 매출원가)
  - Comma-delimited number parser + "-" sentinel handling
  - FX-converts to USD via `DEFAULT_KRW_PER_USD = 1380` (override
    via constructor for tests)
  - Requires `DART_API_KEY` env var; without it the adapter is
    not constructed and KR equities are silently skipped

**Repository extension** (`data_pipeline/repo.py`):

- New `FinancialRow` pydantic model (matches the schema)
- `EquityRepository.bulk_upsert_financials(equity_id, rows)` on both
  the Protocol, the in-memory implementation, and the asyncpg
  Postgres implementation
- SQL: `ON CONFLICT (equity_id, fiscal_year, fiscal_quarter) DO UPDATE`

**Job** (`data_pipeline/jobs/refresh_financials.py`):

- Routes per-equity by `iso_country` (US → EDGAR, KR → DART,
  others → skip)
- Failure-isolated per ticker; same `failure_reasons` map pattern
  as `refresh_quote_history`
- Returns `RefreshFinancialsResult(updated, rows_written, empty,
  errors, ...)`

**FastAPI surface** (`data_pipeline/main.py`):

- `POST /jobs/refresh-financials?quarters=8` — manual trigger
- `GET /jobs/refresh-financials/last` — last run's result
- Wires env: `EDGAR_USER_AGENT` + `DART_API_KEY` + `INGEST_SOURCE`
- Background scheduler hook + cron env var (`REFRESH_FINANCIALS_CRON`
  default weekly Sun 04:00 UTC) deferred to M10c — the manual
  endpoint is enough for now

**Tests** (`services/data-pipeline/tests/`):

- `test_financials_adapters.py` — 17 cases covering: fake source
  determinism / accounting identities / sort order, calendar quarter
  inference, EDGAR concept fallback chain, quarterly facts filter,
  aggregation math (gross / opex / capex sign flip), EDGAR + DART
  constructor validation, DART line-item matching + comma parsing +
  missing-field handling
- `test_refresh_financials.py` — 4 cases covering: routing (US +
  KR + unsupported country), KR skip when DART key missing,
  failure isolation per equity, empty-upstream is `empty` not `errors`

**Verification:**

- TS typecheck (5 workspaces) clean
- @platform/db vitest: 32/32 pass
- sector-service vitest: 45 pass / 26 skipped
- simulation-service pytest: 61 pass
- **data-pipeline pytest: 48 pass** (+21 from baseline of 27)
- **Cumulative: 229 + 17 skipped** (+29 from M11)

**Out of scope (lands in M10c+):**

- Quarterly cron scheduler (manual endpoint only for now)
- Full DART `fnlttSinglAcntAll` adapter for capex + balance sheet
- EDGAR Depreciation+Amortization for true EBITDA (currently uses
  operating income as proxy)
- DART corp_code auto-discovery from `corpCode.xml`
- Historical FX (current implementation applies a single FX constant
  to every KR quarter — fine for charts, wrong for YoY analysis)

#### Equities Milestone 10c — Financials refinement (2026-05-21)

Knocks down four items the M10b doc flagged as out-of-scope.

**EDGAR true EBITDA via D&A** (`adapters/edgar_source.py`):

- New `DA_CONCEPTS` fallback chain: `DepreciationAndAmortization` →
  `DepreciationDepletionAndAmortization` →
  `DepreciationAmortizationAndAccretionNet` → `Depreciation`
- `_aggregate()` now computes `ebitda = OpIncome + D&A` when D&A is
  available; falls back to OpIncome alone (M10b behavior) otherwise
- New test cases cover both branches

**DART full statements** (`adapters/dart_source.py`):

- New `DART_ACCT_ALL_URL` (`fnlttSinglAcntAll.json`) — fetched
  preferentially with `fs_div=CFS` → fallback `OFS` → fallback to
  the simple `fnlttSinglAcnt` endpoint M10b shipped
- Line-item matching now uses **K-IFRS `account_id`** as the
  primary key (`ifrs-full_Revenue` etc.) so we don't depend on
  localized Korean labels. The substring fallback path stays for
  the simple-endpoint case where account_id is empty
- New fields captured: **capex** (M10b returned None — now from
  `ifrs-full_PurchaseOfPropertyPlantAndEquipment...`) and **D&A**
  (`ifrs-full_DepreciationExpense`) → true EBITDA
- Capex normalized to positive absolute (DART reports as negative
  cashflow, like EDGAR)

**Historical FX via Frankfurter** (`adapters/frankfurter_fx.py`):

- New `FrankfurterFx` adapter — public ECB-sourced free API, no
  key needed
- Caches by `(date_iso, base, target)`; concurrent-safe behind an
  asyncio lock
- DART adapter accepts an optional `fx_for: Callable[[date],
  Awaitable[float | None]]` and resolves per-quarter FX before
  conversion. Falls back to the `DEFAULT_KRW_PER_USD = 1380`
  constant on lookup miss
- Wired in `main.py`: `app.state.fx = FrankfurterFx()` →
  `_build_financials_sources(fx=...)` → `DartSource(fx_for=...)`

**Cron scheduler** (`main.py`):

- New `REFRESH_FINANCIALS_CRON` env (default `0 4 * * 0`, Sunday
  04:00 UTC) wires the financials job into the same
  `AsyncIOScheduler` as the daily quote refresh
- `REFRESH_FINANCIALS_QUARTERS` env (default 8) controls the
  scheduled run's window — the manual endpoint still accepts a
  `?quarters=` override
- `/health` now reports `next_runs: {job_id: iso}` for both jobs
  + `last_financials_refresh`

**`.env.example` updated** to surface every new env var with notes.

**Tests:**

- `test_frankfurter_fx.py` (6) — caching, distinct dates, HTTP
  errors, network errors, missing target currency, monkey-patches
  `httpx.AsyncClient` via `MockTransport` (offline)
- `test_financials_adapters.py` (+8) — D&A added to EBITDA,
  fallback when D&A missing, DART account_id matching, DART
  account_id takes precedence over account_nm, legacy substring
  still works when account_id is empty, capex as absolute value,
  `_resolve_fx` uses lookup when present, ignores non-positive
  results
- All `test_dart_*` cases updated for the new field model

**Verification:**

- TS typecheck (5 workspaces) clean
- @platform/db vitest: 32/32 pass
- sector-service vitest: 45 pass / 26 skipped
- simulation-service pytest: 61 pass
- **data-pipeline pytest: 62 pass** (+14 from M10b)
- **Cumulative: 243 + 17 skipped**

**Out of scope (M10d+):**

- DART `corpCode.xml` auto-discovery (currently 22 hand-mapped KR
  tickers in `KR_CORP_CODES`)
- DART balance sheet items (total assets / debt / equity) — easy
  to add via the same full-statement endpoint when needed
- Multiple-currency FX (Frankfurter supports it; only KRW/USD
  wired for now)
- Frankfurter rate-limit handling (free tier is generous; not a
  problem at 50-equity scale)

#### Equities Milestone 10d — corpCode auto-discovery + balance sheet + multi-currency FX (2026-05-21)

Closes three of the four out-of-scope items M10c flagged. The
fourth (Frankfurter rate-limit handling) stays deferred — it's not a
problem at current scale.

**Schema** (`packages/db/prisma/schema.prisma` + migration
`20260522040000_equity_financials_bs/migration.sql`):

- `EquityFinancial` gains three nullable columns:
  `total_assets_usd`, `total_liabilities_usd`, `total_equity_usd`
- ALTER TABLE — no data migration required; existing rows have
  NULL BS values (M10b/M10c didn't capture them anyway)

**corpCode.xml auto-discovery**
(`services/data-pipeline/data_pipeline/adapters/dart_corp_codes.py`):

- New module with pure parsing helpers (`parse_corpcode_xml`,
  `extract_corpcode_xml_from_zip`) + the network fetcher
  `fetch_corp_code_map(api_key)`
- Drops malformed entries defensively — only accepts
  `stock_code` = 6 digits and `corp_code` = 8 digits
- `DartSource.__init__` gains `autodiscover_corp_codes=True` (opt-out
  for tests). On a curated-map miss, lazily fetches + caches the
  full corpCode.xml; a fetch failure caches an empty dict so we
  don't hammer the endpoint
- 22-ticker hand-curated `KR_CORP_CODES` stays as the first-look
  fast path (avoids the ~20MB cold-start fetch for known tickers)

**Balance sheet capture**
(`adapters/dart_source.py`, `adapters/edgar_source.py`):

- **DART**: full-statements endpoint reports BS under K-IFRS
  `account_id`s — new sets `ACCOUNT_ID_TOTAL_ASSETS` /
  `…LIABILITIES` / `…EQUITY` (latter accepts both
  `ifrs-full_Equity` and `…EquityAttributableToOwnersOfParent`)
- **EDGAR**: BS items are *instant* facts (no `qtrs` field) — new
  `_pick_instant_facts` helper filters by absence of `qtrs`
  rather than `qtrs == 1`. New concept chains
  `ASSETS_CONCEPTS` / `LIABILITIES_CONCEPTS` /
  `EQUITY_CONCEPTS`. Joined onto the matching quarter by `end`
  date inside `_aggregate`
- `FinancialQuarter` / `FinancialRow` / `FakeFinancialsSource` /
  `@platform/db/mock-financials.ts` / `seed-equity-financials.ts`
  all extended in lockstep
- Mock generators preserve the accounting identity
  (`assets = liabilities + equity`); per-ticker leverage drawn from
  a 35-65% range — sanity-checked by test

**Multi-currency Frankfurter**
(`adapters/frankfurter_fx.py`):

- New `rate(base, target, on)` generic method
- New `local_per_usd_factory(currency)` returns a curried
  `(date) → local-per-1-USD` callable — drop-in for the same
  `fx_for` parameter `DartSource` already accepts. Forward-looking
  for non-KR/US adapters (JPY / EUR / etc.)
- `krw_per_usd` preserved for backwards compat

**Tests** (+21):

- `test_corp_codes.py` (7) — XML parse, malformed-code drop,
  whitespace tolerance, ZIP extraction (case-insensitive), missing
  XML error
- `test_financials_adapters.py` (+9): DART BS extraction +
  accounting identity, EDGAR `_pick_instant_facts` filter, EDGAR
  BS aggregation, EDGAR null-BS fallback, DartSource
  auto-discovery (fallback + hit-cached / curated wins / disabled /
  fetch-error caches-empty), `FakeFinancialsSource` BS identity +
  growth + leverage band
- `test_frankfurter_fx.py` (+2) — generic `rate()` URL parameters,
  `local_per_usd_factory` returns currying closure
- `mock-financials.test.ts` (+3, vitest) — BS identity, BS grows,
  leverage in band

**Verification:**

- TS typecheck (5 workspaces) clean
- **@platform/db vitest: 35/35 pass** (+3)
- sector-service vitest: 45 pass / 26 skipped
- simulation-service pytest: 61 pass
- **data-pipeline pytest: 80 pass** (+18 from M10c)
- **Cumulative: 264 + 17 skipped** (+21 from M10c)

**Out of scope (M10e+):**

- Frankfurter rate-limit handling (free tier generous)
- DART per-line-item drill-down (operating cash flow, R&D expense,
  inventory turn) — full statement returns 100+ rows we currently
  filter to 9 line items
- UI surfacing of balance-sheet bars in the equities table (the
  data lands now; viewing is a follow-up slice)

---

## Planned next (M15 → M19)

Ordered by dependency + leverage. Each slice is independent enough to
ship alone; do them top-down so foundational context (M14 done, M15
next) is in place before the bigger UX builds (M16, M17). M18 + M19
are quality / operational improvements that can interleave when needed.

### M14 — README expansion (shipped 2026-05-21)

Added to README.md, before the architecture section:

- **Problem** — investors hit the same wall every quarter (macro
  story siloed from per-ticker impact, data scattered across
  EDGAR/DART/yfinance, theses don't update, counterfactuals are
  hand-coded, per-equity attribution muddy)
- **Solution** — sector = simulatable causal graph, every key
  equity is a graph node, edit the graph + math moves + projection
  lines shift in real time
- **Why now** — open financial data + AI agents for graph
  authoring + investor demand for thesis-iteration speed
- **How (mechanism in 60 seconds)** — SimulationBase → DB-bootstrap
  → equity nodes from `driver_links` → hybrid edge weights →
  graph-traversal impact score → forward projection
- **What it doesn't try to be** — not a brokerage, not an analyst-
  report generator, not yet a backtester, not multi-tenant

Korean DESIGN.md (vision / personas / business model in depth) is
unchanged and remains the in-depth product spec; README is the
English investor-facing front door.

### M15 — Per-page intent panels (shipped 2026-05-21)

Every sector subpage + the `/sectors` list + `/compare` now starts
with a small collapsible "Why" card explaining the page's purpose,
followed by two columns (왜 보는가 / 무엇을 찾는가) for orientation.

**What shipped**:

- `apps/web/src/app/page-intents.ts` — centralized content. Two
  maps: `SECTOR_PAGE_INTENTS` (keyed by overview / live / manual /
  graph / equities / sources) and `STANDALONE_PAGE_INTENTS` (compare,
  sectorsList). Editorial revisions touch one file.
- `apps/web/src/app/page-intent.tsx` — `<PageIntent>` component:
  - Native `<details>` element (keyboard + a11y free)
  - Summary row: small cyan "Why" chip + one-sentence elevator pitch
    + chevron that rotates on expand
  - Expanded: two-column grid with bulleted Why / What lists
  - `defaultOpen={true}` so first-time visitors see purpose
    immediately; power users can collapse
- Wired into every relevant page:
  - `/sectors/[slug]` (overview)
  - `/sectors/[slug]/live`
  - `/sectors/[slug]/manual`
  - `/sectors/[slug]/graph`
  - `/sectors/[slug]/equities` (above the table; loading/error states
    no longer return early so the intent stays visible)
  - `/sectors/[slug]/sources`
  - `/sectors` (replaces the old paragraph header)
  - `/compare`

**Content philosophy**:

- 한 줄 pitch — page의 elevator pitch
- 왜 보는가 (3-5 bullets) — "이 페이지가 존재하는 이유"
- 무엇을 찾는가 (3-5 bullets) — "구체적으로 어디를 보고 어떻게 사용하는가"
- 모든 한국어; editorial-team friendly

**Verification**:

- TS typecheck across all 5 workspaces clean
- @platform/db / sector-service / simulation-service / data-pipeline
  test totals unchanged (no logic touched)
- **Cumulative still 264 + 17 skipped** (no test code added; this
  is a content slice)

**Out of scope (lands in M16+)**:

- "지난 변경" 표시 (audit log integration) — M18
- 페이지 별 onboarding tour (interactive tooltips) — defer until
  user feedback says it's worth it
- 다국어 (English) — currently 한국어 only

### M16 — Home page / investor dashboard (shipped 2026-05-21)

`/` is no longer a bare redirect. It's a server-rendered investor
dashboard that pulls the platform's state into one view; legacy
`/?sector=…[&scenario=…]` URLs still redirect through to the sector
hub (preserved at the top of the page handler).

**What shipped**:

- **`audit.recent` tRPC procedure** (`services/sector-service/src/trpc/audit.ts`):
  read-only window onto `audit_logs`. Filters: `limit`,
  `sector_slug?`, `action_prefix?`. Sorted `created_at` desc.
  Wired into the root router; web client gets a
  `fetchRecentAuditLogs(...)` wrapper + `AuditLog` type inferred from
  the router output.
- **`/` page** (`apps/web/src/app/page.tsx`) — RSC. Fans out in
  parallel (per Promise.all): `sims.list` → `equities.listForSector`
  ×3 + `equity.basketStats` ×3 + `scenarios.list` ×3 +
  `scenarios.list` (all) + `audit.recent`.
- **Sections**:
  - `<HomeSearch>` (client) — single input with substring filter over
    a pre-flattened sector + equity + driver index. Kind badge per
    result (cyan / amber / violet). Caps at 8 hits; debounce-light
    (no setTimeout — just useMemo).
  - **Trending sectors** — 3 cards (lg:grid-cols-3) per sector with:
    name, description, 240×36 basket sparkline (90d), 90d return %
    (green/red), equity count, scenario count. Card itself links to
    the sector hub.
  - **Biggest movers (90d)** — table of equities sorted by
    |return_pct| from `equity.basketStats`. Columns: ticker (flag +
    name), sector, 90d %, β, σ annualized. Empty-state copy tells
    you to run `refresh-quote-history`.
  - **Recent scenarios** — top 5 by `updated_at` desc across all
    sectors. Each tile links to `/sectors/<slug>?scenario=<id>`
    (round-trips through the scenario deep-link path that the sector
    shell hydrates).
  - **What's changed** — feed over the audit log. `describeAudit()`
    formats per-action: edge upserts show
    `source → target · w=X.X`; node CRUD shows the node_key + label;
    scenario CRUD shows name / id; graph reset / wipe shows the
    sector. Action badge colors by prefix (graph / scenario /
    lifecycle).
- **`page-intents.ts`** — new `STANDALONE_PAGE_INTENTS.home` entry
  surfaced via the existing `<PageIntent>` collapsible card.

**Formatting helpers** colocated at the bottom of `page.tsx`:

- `formatRelative(Date | string)` — accepts both because tRPC's
  Date-typed fields arrive as ISO strings over the wire (no
  transformer configured). Buckets to "방금" / "N분 전" / "N시간 전" /
  "N일 전" / ISO date.
- `describeAudit(e)` / `shortAction(e.action)` / `toneForAction(...)`
  — pure functions; easy to extend as M18 adds lifecycle actions.

**Verification**:

- TS typecheck across all 5 workspaces clean (web / admin /
  sector-service / ui / db)
- @platform/db vitest: 35 pass (unchanged)
- sector-service vitest: 45 pass / 26 skipped (unchanged baseline —
  audit router is a thin Prisma wrapper that would only be
  exercised by a DB-enabled CI run, like the M7 graph procedures)
- **Cumulative still 264 + 17 skipped** (no test code added — the
  new tRPC procedure mirrors existing audit-log writes; runtime
  exercise comes from the home page itself)

**Out of scope (lands in M17+)**:

- Per-equity narrative drill-down (`/sectors/[slug]/equities/[ticker]`)
- Editorial "growth thesis" cards per sector
- Watchlist / user accounts (need auth — Phase 4)
- True 24h movers (current implementation surfaces 90d basket
  returns; daily change requires last-two-bar diff which we'll add
  alongside M17's narrative panels)
- Search ranking beyond substring (full-text via Postgres tsvector
  when the index grows past O(100s))

### M17 — Investment narrative UI (shipped 2026-05-21)

The platform's reason for existing — every previous slice has been
plumbing toward this: *섹터는 어떻게 성장하고, 그 흐름이 어떤 종목으로 흘러
어느 정도 upside를 만드는가, 그 근거는 무엇인가.*

**Backend**:

- `services/sector-service/src/lib/graph-impact.ts` gains
  `computeImpactBreakdown(...)` — same math as `computeImpactScores`
  but returns per-driver `DriverContribution { driver, weight,
  default_value, current_value, delta_pct, contribution }` for each
  equity, sorted by `|contribution|` desc. 5 new vitest cases.
- New `equity.getByTicker({ sector_slug, ticker, exchange? })`
  procedure — resolves human-readable URLs (`/equities/[ticker]`)
  to the canonical equity row. Ties broken by `market_cap_usd desc`.
- New `equity.impactBreakdown({ sector_slug, driver_values })`
  query — returns the breakdown for every equity in the sector.

**Frontend**:

- New `/sectors/[slug]/narrative` route:
  - **Growth thesis card** — editorial summary + horizon chip
  - **Key drivers / Key blockers** two-column grid with delta chips
    that live-update from sector context driverValues
  - **Per-equity grid** sorted by `|projectedΔ|` — ticker (★ flagship
    badge), current price, 30d target, Δ% (with score), top 3
    contributing drivers with sign-colored contributions
  - All numbers re-render on slider drag (subscribes to `useSector()`)
- New `/sectors/[slug]/equities/[ticker]` per-stock detail route:
  - Header card with 4 stat tiles (Current / 30d target / Implied Δ /
    Sector exposure + mkt cap)
  - 720×140 sparkline with dashed 30d projection
  - **"Why this number"** decomposition table — driver | default |
    current | Δ% | weight | contribution | symmetric bar — ranked by
    `|contribution|` desc. Footer shows `raw_sum → score = 100×tanh()
    → projectedΔ = score × 0.3%` so the formula is visible.
  - **Financials block** — 4 mini bar charts (Revenue / Gross margin
    % / EBITDA / Capex), 8 quarters, reuses the same SVG pattern as
    `EquityFinancialsPanel`
  - **Filings citations** — DART (KR ticker → 공시 검색 URL) or SEC
    EDGAR (US ticker → filings landing). Per-driver provenance still
    routes to the existing Sources tab.
- New `Narrative` tab inserted after `Overview` in the SubNav.
- Editorial thesis content for all 3 sectors lives in one file:
  `apps/web/src/app/sectors/[slug]/narrative/thesis-content.ts`
  (memory-semi / space-data-center / sofc, each with summary +
  horizon + 3 drivers + 3 blockers + 4 flagship tickers).
  `driverRefs` reference real sim driver names; the UI silently
  drops refs that don't match the current sector.
- Home page biggest movers + equities table ticker chip now link
  to `/equities/[ticker]`.
- `page-intents.ts` gains `narrative` + `equityDetail` entries.

**Verification**:

- TS typecheck across web / admin / sector-service / ui / db — clean
- sector-service vitest: **50 pass / 26 skipped** (+5 from M16
  baseline, all on `computeImpactBreakdown`)
- @platform/db: 35 pass (unchanged)
- simulation-service / data-pipeline / agent-orchestration: untouched
- **Cumulative: 269 + 17 skipped** (+5 from M16)

**Out of scope (M18+ / Phase 3+)**:

- LLM-generated thesis copy (today's content is hand-authored;
  agent slot is reserved in the structure but unwired)
- True forward-looking confidence cone (single dashed line only)
- Per-driver alerting / watchlists (need user accounts → Phase 4)
- Sector basket trajectory chart (basket sparkline already shown on
  home + equities expand; per-narrative version deferred until
  editorial requests it)

### M18 — Lifecycle review + audit history + monitoring (shipped 2026-05-21)

The platform's operational backbone. By M17 the system held 49+ equities,
4 sectors, 100+ graph nodes and a year+ of mutations; M18 surfaces those
artifacts for **human review with full audit trail — never auto** (per
durable user feedback: "자동으로 하지말고 항상 유저에게 허락 맡게끔. 그리고
그러한 action들은 history처럼 남겨서 기록해").

**Backend** (`services/sector-service`):

- **`audit.list`** — paginated audit viewer (cursor on `created_at`,
  filters by sector / action_prefix / author). Returns `next_before`
  for "older" pagination.
- **`audit.facets`** — distinct actions / sectors / authors for the
  filter dropdowns.
- **`lifecycle.candidates`** — single procedure that detects 4
  categories of "this might be ready to deprecate" candidates:
  1. `equity.stale_price` — `sector_equities` whose most recent
     `equity_quotes.trade_date` is older than `equity_stale_days`
     (default 14)
  2. `graph_node.orphan` — `graph_nodes` with zero edges in or out
  3. `graph_edge.neutral` — `graph_edges` with origin=seed AND
     weight=1.0 AND magnitude=med (untouched since bootstrap)
  4. `sector.cold` — sectors with no scenarios saved in
     `sector_cold_days` (default 90)
  Active deferrals (from the audit_log itself, by `defer_until`
  payload field) are filtered out so deferred candidates don't
  re-surface until the deadline.
- **`lifecycle.review`** — single mutation that takes
  `{category, ref_id, action: keep|defer|approve_deprecate,
  defer_until?, reason?}`. Writes an `audit_logs` row with action
  `lifecycle.<category>.<action>`. For `approve_deprecate` on
  `graph_edge.neutral`, also deletes the edge row; other categories
  log only (soft-delete of equities/sectors is intentionally
  manual — admin removes from `seed-equities.ts`).
- **`monitoring.health`** — proxies data-pipeline `/health` (2s
  timeout, fail-soft on connection error) + queries Postgres for
  table-level freshness (`max trade_date`, `max period_end`,
  `last audit_log`). Returns `feeds[]` (each with status: ok |
  stale | down | not_configured) + `table_counts`. New
  `DATA_PIPELINE_URL` env var on sector-service (optional —
  defaults to "not configured" feed when unset).

**Admin app** (`apps/admin`):

- **`/lifecycle`** — RSC page. 4 stat tiles at top, sections by
  category with `<LifecycleCandidateCard>` per item (client
  component). Each card shows reason + structured `detail` chips +
  reason textbox + defer-days input + three action buttons (Keep /
  Defer / Approve deprecate, color-coded amber/neutral/rose).
  Submitting calls `lifecycle.review` and `router.refresh()` so the
  server re-fetches and resolved candidates drop off.
- **`/audit`** — RSC page. Filter form with action / sector /
  author dropdowns populated from `audit.facets`. 50 rows per page
  with `Older →` cursor link. Action prefix badge color-codes by
  prefix (graph / scenario / lifecycle). Raw payload rendered as
  one-line JSON.
- **`/monitoring`** — RSC page. Feeds list with status badges +
  last/next timestamps + per-feed detail. Table count tiles
  (sectors / equities / quote bars / financial quarters / graph
  nodes / graph edges / scenarios / audit logs).
- Top-nav gains `Lifecycle`, `Audit`, `Monitoring` links.
- Admin home replaces the disabled `Approve queue` stub with three
  live entry-point buttons (⚠ Lifecycle review, ◔ Monitoring,
  ☷ Audit log).

**Compose**: `sector-service` gains
`DATA_PIPELINE_URL=http://data-pipeline:8003` + a `depends_on:
data-pipeline: service_started` edge so the monitoring panel can
reach it in containerized dev.

**Verification**:

- TS typecheck across all 5 workspaces clean (web / admin /
  sector-service / ui / db)
- sector-service vitest: 50 pass / 26 skipped (unchanged — new
  routers are DB-required, exercised by integration tests on a
  DB-enabled CI later)
- @platform/db: 35 pass (unchanged)
- **Cumulative: 269 + 17 skipped** (no test code added in this slice
  — new routers exercise via the admin UI; unit-test seam is the
  next slice)

**Out of scope (deferred)**:

- Background "weekly digest" job that emails the lifecycle queue —
  needs Resend/SendGrid + auth (Phase 4)
- Hard-delete of equities / drivers / sectors on
  `approve_deprecate` — currently log-only for those; admin removes
  from seed files manually
- Driver-level orphan detection (drivers with no `driver_links`
  referencing them anywhere) — requires walking the JSONB blob; skip
  until that's needed
- Custom defer windows (today: free-form days input; later: presets
  like "until next quarter close")
- Per-mutation rollback ("undo this graph edit") — audit_log has
  enough info to support it, but the inverse action math is its own
  slice

### M19 — Graph UI quality polish (shipped 2026-05-21)

Closes the backlog. M11 shipped a functional editor; M19 swaps the
hand-rolled 4-column layout for **dagre auto-layout** and gives every
edge four orthogonal visual axes so the renderer says more without
the user having to hover.

**Layout** (`apps/web/src/app/graph-view.tsx`):

- New `@dagrejs/dagre` dependency. `buildFlow(...)` constructs a
  dagre graph (`rankdir: LR`, `ranker: tight-tree`, nodesep=18,
  ranksep=70), seeds it with every node at `(NODE_W=180, NODE_H=64)`,
  adds every edge with endpoint guarding (drift-tolerant),
  and `dagre.layout(...)` resolves positions.
- The kind columns (drivers ← intermediates ← outputs ← equities)
  emerge from topology naturally — drivers have no inbound edges so
  they land on rank 0; equity nodes have no outbound so they're
  rightmost. No `setRank()` hacks.
- Crossings drop dramatically on the 50-node memory-semi graph
  (manual + visual inspection).

**Edge visual axes**:

| Axis | Encoding |
|---|---|
| **Color** | target node's `kind` — cyan (→intermediate), amber (→output), gold (→equity) |
| **Width** | continuous `clamp(0.7 + \|weight\| × 1.1 + magBoost, 0.5, 4)` — magnitude `low/med/high` is now a small ornament; \|weight\| drives the read |
| **Dash** | `origin` — solid (seed), `5 3` (edit), `1 3` (agent) — user touches become instantly identifiable |
| **Arrow head** | sign — `MarkerType.ArrowClosed` filled triangle for `w≥0`; `MarkerType.Arrow` open chevron for `w<0` (inverse) |
| **Opacity** | untouched neutral seeded edges fade to ~0.35; tuned edges saturate to >0.6; negative weights bump to ≥0.85 |

**Node visual**:

- Left color band (4px wide) keyed to kind — semantic stripe stays
  readable even at low zoom.
- `kind` chip on a new line below the label (e.g. `INTERMEDIATE` /
  `EQUITY`).
- Group string remains as muted secondary chip when present.
- Driver value preserved (live from the workspace sliders).
- Fixed `width=180px, minHeight=64px` so dagre's layout doesn't
  drift between layout calc and actual render.

**Label policy**:

- Routine seeded math labels (`× duty`, `÷ η`) stay (they explain
  the math).
- The auto-appended `· w=1.00` suffix is **dropped** for neutral
  edges — labels only appear when there's actual signal (edited
  weight OR custom label).
- Smaller 10px labels with semi-transparent dark background so
  they read at any zoom without occluding lines.

**Legend** (`<EdgeLegend>`):

- 9 inline SVG samples on a second row under the kind dots:
  3 target-color samples + 3 weight/sign samples (amplify thick /
  neutral faint / inverse open-arrow) + 3 origin-dash samples
  (seed/edit/agent). Each sample renders an actual `<line>` with
  marker so the legend matches what React Flow draws.

**Page intent** updated — `SECTOR_PAGE_INTENTS.graph` now teaches
the new visual encoding instead of the old "cyan/grey/rose/faded"
collapse.

**Verification**:

- TS typecheck across web / admin / sector-service / ui / db — clean
- sector-service vitest: 50 pass / 26 skipped (no test code touched)
- @platform/db vitest: 35 pass (unchanged)
- **Cumulative: 269 + 17 skipped** — no test code added (pure
  presentation slice; the underlying math hasn't moved since M9)

**Out of scope (defer)**:

- **Equity ticker pills + inline sparklines** on equity nodes — the
  spec called for them, but rendering 17+ sparklines per graph
  paint hurts scroll perf on a 50-node graph. Equity detail page
  (M17) already has sparklines; rebuild this as an opt-in zoom
  feature later if anyone asks.
- **Zoom-conditional label visibility** — would require subscribing
  to React Flow's viewport hook + a custom edge component; the
  smaller font + dropped neutral suffix is enough for now.
- **Edge bundling** — dagre doesn't bundle; if memory-semi hits
  100+ edges and re-clutters, elk's `layered.spacing.edgeNode` mode
  is the next step.

### M20 — SaaS foundation: auth, header, settings, onboarding (shipped 2026-05-21)

Closes the basic-SaaS gaps the user flagged: 최초 로그인 / 튜토리얼 /
header user menu / settings. Browse stays open to anonymous users —
mutations still work but record as "anonymous"; logged-in users get
the mutation label flipped to their display name. No gated routes
beyond `/settings`.

**Schema** (`packages/db/prisma/schema.prisma` + migration
`20260523000000_users_sessions`):

- `users(id, email UNIQUE, password_hash, name?, locale?, theme?, ...)`
- `sessions(id, user_id FK CASCADE, token UNIQUE, expires_at,
  user_agent?, ip?, ...)` — opaque token == cookie value (rotating /
  signed token design lands when session compromise is a real risk)

**Backend** (`services/sector-service`):

- New deps: `@fastify/cookie`, `bcryptjs` (+ `@types/bcryptjs`).
- `lib/auth.ts` — `hashPassword` (bcrypt cost 10) / `verifyPassword`
  / `generateSessionToken` (32-byte base64url) / `sessionExpiresAt`
  (now + 30d) / `SESSION_COOKIE_NAME = "sss_session"`.
- `auth.*` tRPC router with: `signUp` (CONFLICT on duplicate
  email) / `signIn` (constant-ish-time bcrypt against scratch hash
  when user missing) / `signOut` / `me` / `updateMe` (name / locale /
  theme) / `changePassword` (revokes *other* sessions on success).
- `createContext` now loads the current user from
  `cookies[SESSION_COOKIE_NAME]` and exposes `ctx.user` +
  `ctx.req` + `ctx.res`. Failure to look up a session degrades to
  anonymous rather than 500.
- Existing `author_label` fallback on graph / scenario / lifecycle
  mutations: `input.author_label ?? ctx.user?.label ?? "anonymous"`
  — explicit override still wins for CLI / script callers.
- Cookie attributes: `httpOnly`, `sameSite=lax`, `secure` in
  production, `path=/`, `maxAge=30d`.

**Frontend** (`apps/web`):

- `sim-client.ts` — `fetchWithSession` forwards browser cookies via
  `credentials: "include"` *and* on the RSC side reads
  `next/headers` cookies and forwards them as a `cookie` header so
  `auth.me` resolves correctly during server render.
- Client wrappers: `fetchMe` / `signUp` / `signIn` / `signOut` /
  `updateMe` / `changePassword`.
- `/login`, `/signup` — focused single-column forms with inline
  validation, post-success `router.refresh()` so the header
  user-menu re-hydrates without a hard reload.
- Global `<SiteHeader>` (server component) — logo, primary nav
  (Home / Sectors / Compare), `<UserMenu>` (client) with avatar
  initials + dropdown (Settings / Sign out) or Sign in / Sign up
  CTAs when anonymous. Click-outside and Escape close the menu.
- `<OnboardingModal>` (client) — 5-step tour
  (welcome → Sectors → Manual → Graph → Narrative) gated by
  `localStorage.sss_onboard_v1`. Forced open via `?onboard=1` after
  signup; replayable from `/settings`. Hidden on `/login`,
  `/signup` so auth forms aren't crowded.
- `/settings` (auth-required; anonymous → redirect to login):
  profile (display name + locale + theme), password change,
  onboarding replay, "위험 구역" placeholder for future self-delete.

**Tests** (+6, all hermetic):

- `tests/auth-lib.test.ts` — bcrypt round-trip + salt independence +
  empty-input rejection + 32-byte base64url token + 30-day expiry
  math + cookie name freeze.
- `tests/stub-context.ts` — shared test helper that fills the new
  `res` / `req` / `user` context slots so the existing 4 router
  test files (sim / scenario / graph / agent) keep compiling
  without ceremony.

**Verification**:

- TS typecheck across all 5 workspaces clean.
- sector-service vitest: **56 pass / 26 skipped** (+6 auth-lib).
- `@platform/db` vitest: 35 pass (unchanged).
- **Cumulative: 275 + 17 skipped** (+6 from M19).

**Out of scope (Phase 4+)**:

- OAuth providers (Google / GitHub / Apple) + magic links — the
  schema is friendly to layering these in
- Email verification flow (sendgrid / resend wiring)
- MFA / TOTP
- Multi-tenant scoping (tenant_id FK on every table) + Postgres RLS
- Active sessions list in Settings (data exists in `sessions`, UI
  surface deferred)
- Self-service account deletion
- Audit-log-driven activity timeline per user
- Rate limiting on signin / signup (no abuse vector at current scale,
  but trivial to add via fastify-rate-limit)

### M21 — Agent-generated sectors → draft (shipped 2026-05-21)

Closes the long-deferred loop on `agent-orchestration`: a Decomposition
workflow output can now be promoted to a first-class draft sector with
full graph topology, traceable back to the agent run that produced it,
without any auto-deploy. Hard rule preserved — every transition writes
an audit row, never auto.

**Schema** (`packages/db/prisma/schema.prisma` + migration
`20260523010000_sector_status`):

- `sectors.status TEXT NOT NULL DEFAULT 'live'` — live | draft | archived
- `sectors.agent_workflow_id TEXT` — FK to the agent_workflows row that
  proposed it (nullable for the 3 in-code seed sims)
- `CREATE INDEX sectors_status_idx ON sectors(status)`
- Existing rows seed as `live` (data preserved on apply).

**Backend** (`services/sector-service/src/trpc/sector.ts`):

- `sector.list({ status?, limit })` — DB-direct query, sorts by status
  then created_at desc.
- `sector.get({ slug })`.
- `sector.proposeFromAgent({ workflow_id, slug?, name?, description?,
  author_label? })` — validates that the workflow exists, status =
  succeeded, kind = decomposition; runs the JSONB output through the
  zod `Decomposition` schema; resolves a collision-safe slug (suffix
  loop, bounded at 50); transactionally creates the `sectors` row +
  every driver / intermediate / output node in `graph_nodes` +
  one `audit_logs` row capturing workflow_id + cost + node counts.
- `sector.activate({ slug })` / `sector.archive({ slug })` /
  `sector.toDraft({ slug })` — single transition helper logs the
  `from → to` payload to audit. No-op on identical transitions.
- All mutations default `author_label` to `ctx.user.label` (M20 chain).

**Sim list filter**:

- `sim.list` gains optional `include_non_live: boolean` (default false).
- User app: drafts + archived are hidden — `sim.list` joins against
  the DB sector status and filters by `live`. Sectors without a DB
  row (legacy / unseeded) fall through as visible (absence isn't a
  strong hide signal).
- Admin client: `fetchSims()` passes `include_non_live: true` so the
  admin sees everything with status badges.
- Postgres unreachable → falls back to unfiltered (the legacy path),
  logs a warn — graph integration is additive, never gating.

**Admin UI**:

- `/agent-runs/[id]` — succeeded decomposition workflows now show a
  `<PromoteToDraftButton>` instead of the old "not yet a registered
  sector" warning. Two-stage modal: confirmation collapsed →
  expanded form (Slug / Name / Description prefilled from the agent
  output) → result panel with deep-link to the new sector.
- Admin `/` — three sections now: **Live** (existing card grid),
  **Draft** (rows with status badge + Activate / Archive buttons +
  link back to the source agent run), **Archived** (rows with
  Restore button). Header counts updated to show live/draft/archived/scenarios.
- New `<DraftSectorRow>` client component encapsulates the per-row
  buttons with optimistic feedback + `router.refresh()` on success.

**Verification**:

- TS typecheck clean across all 5 workspaces.
- sector-service vitest: 56 pass / 26 skipped (existing baseline —
  the new sector.* routes are DB-required, exercise via the admin
  UI for now).
- @platform/db: 35 pass (unchanged).
- **Cumulative: 275 + 17 skipped** (M20 baseline).

**Out of scope (M22+)**:

- Multi-step orchestration: chain Decomposition → DriverInference →
  EdgeInference into a single `ProposeSectorWorkflow`. The 5 follow-on
  prompts already exist (M5 of the Phase 2 — agents milestone); they
  need workflow classes + Pydantic schemas.
- **Generic DAG-executor sim** — agent-generated sectors land
  without a Python sim, so `simulate()` calls return a clean
  "no runtime registered" error. A `GenericDagSim` in
  `simulation-service` that walks `graph_nodes` + `graph_edges`
  in topo order and applies linear `Σ (driver × weight)` math would
  let drafts run *some* simulation immediately on activation.
  Deferred until either an admin asks for it or M22 ships
  agent-generated Python code (sandboxed).
- Sandbox (Modal / E2B) execution of agent-generated Python code.
- Multi-tenant scoping on `sectors.tenant_id`.

### M22a — ProposeSectorWorkflow chain (shipped 2026-05-21)

Adds the second stage of the agent pipeline. The Decomposition agent
gave us the *node schema*; M22a's EdgeInference agent fills in the
*causal DAG* that connects drivers → intermediates → outputs with
math formulas + assumptions. Both stages chain into a single
`ProposeSectorWorkflow` whose composite output drops straight into
M21's `sector.proposeFromAgent` mutation — promoting now creates
both graph_nodes AND graph_edges from agent output, all in one
transaction.

**agent-orchestration** (`services/agent-orchestration/`):

- New Pydantic schemas: `EdgeSpec`, `IntermediateFormula`,
  `OutputFormula`, `EdgeInferenceResult`, `ProposeSectorResult`
  (composite), `EdgeInferenceRequest`, `ProposeSectorRequest`.
- New `EdgeInferenceWorkflow` (kind = `edge_inference`):
  - Loads `prompts/edge-inference.md`
  - Calls Claude Opus 4.7 with adaptive thinking
  - Serializes the input `Decomposition` into a plain-Markdown user
    turn (better prompt cache hits than JSON, every node name
    surfaces verbatim for the prompt's cross-check requirement)
- New `ProposeSectorWorkflow` (kind = `propose_sector`):
  - Two-stage chain: Decomposition (Opus) → EdgeInference (Opus)
  - Shares one `CostMeter` across both stages so the workflow record's
    `cost_usd` rolls up properly
  - Short-circuits cleanly if Decomposition fails (chain doesn't
    waste tokens on a doomed EdgeInference call)
- New HTTP endpoint: `POST /workflows/propose-sector`.
- Tests: 5 new in `tests/test_propose_sector.py` covering
  EdgeInferenceWorkflow happy + serialization + agent-parse-failure
  paths, plus ProposeSectorWorkflow chain success + early-fail
  short-circuit. Multi-stage parsed_factory dispatches on
  `kwargs["output_format"]` so one FakeAnthropic answers both stages.

**sector-service**:

- `agent.startProposeSector` tRPC mutation proxies to the new
  endpoint with the same shape as `startDecomposition`.
- `sector.proposeFromAgent` now branches on `workflow.kind`:
  - `decomposition` → nodes only (M21 path, unchanged)
  - `propose_sector` → nodes **and** edges in a single transaction
- Agent-inferred edges land with `weight = 1.0`, `magnitude = "med"`,
  `origin = "agent"` — the M19 graph view picks up the agent-dash
  pattern automatically.
- Drift safety: edges whose source/target isn't in the Decomposition's
  node set get skipped + counted as `skipped_endpoint_misses` on the
  audit log payload (agents occasionally drift; we log + count
  rather than reject the whole promotion).
- Audit payload gains `workflow_kind`, `edge_count`,
  `skipped_endpoint_misses`.

**Admin UI**:

- `/agent-runs/new` form gets a pipeline picker — "Propose sector
  (full)" (default) vs "Decomposition only". Submitting routes to
  the right endpoint.
- `/agent-runs/[id]` watcher resolves both kinds:
  - decomposition output → existing decomposition section
  - propose_sector output → decomposition section PLUS a new
    `<EdgeInferenceSection>` (edges table + intermediate formulas
    + output formulas + assumptions list)
- `<PromoteToDraftButton>` accepts an `edgeCount` prop, surfaces it
  in the confirmation copy ("graph_edges 에 N개 agent-inferred edges
  (weight=1.0 / origin=agent)"), and shows the edge count in the
  success message.
- New `AgentEdgeInference` + `AgentProposeSectorResult` TS types on
  the admin sim-client.

**Verification**:

- TS typecheck across all 5 workspaces clean.
- agent-orchestration pytest: **40 pass / 2 skipped** (+5 new).
- sector-service vitest: 56 pass / 26 skipped (unchanged — new
  sector.proposeFromAgent branch is DB-required, exercised via UI).
- **Cumulative: 280 + 17 skipped** (+5 from M21).

**Out of scope (M22b+)**:

- **GenericDagSim** in simulation-service so a draft sector can
  actually `simulate()` once activated — agent-inferred edges +
  formulas give us the topology, but executing them as math
  requires either a generic linear-DAG evaluator or sandboxed
  Python code-gen. The formulas are persisted (in audit_logs +
  workflow output) but currently not parsed.
- The 3 remaining prompts (research / driver-inference / code-gen
  + code-review). Research could enrich the decomposition input.
  Driver-inference could re-calibrate ranges before edge-inference.
  Code-gen + code-review would close the loop to a runnable Python
  class.
- Sandboxed (Modal / E2B) execution of agent-generated Python.

### M22b — GenericDagSim runtime for agent-generated sectors (shipped 2026-05-21)

Closes the activation-time question raised by M21: agent-proposed
sectors now have a real runtime. The simulation-service can evaluate
the DAG of formulas EdgeInference produced, so an admin activating an
agent-generated draft gets a sector that actually answers
`sim.run` / `sim.sensitivity` / `sim.live` requests — the same surface
the in-code sims expose.

**simulation-service** (`services/simulation-service/`):

- New deps: `simpleeval` (safe expression evaluator) + `asyncpg`
  (DB topology loader).
- **`evaluator.py`** — `evaluate_formula(formula, variables,
  edge_weights, target)`. Whitelist of operators + `min/max/abs/sum/exp/
  log/sqrt/pow/floor/ceil/round` functions + `pi/e/MWh_per_MMBtu/
  MMBtu_per_MWh` constants. Variable references at the target node
  get multiplied by their incoming edge weight (M19's hybrid model
  extends to agent sectors). Dunder access, `__import__`, attribute
  walks, lambdas, comprehensions: all blocked by simpleeval +
  wrapped as `FormulaError`. Non-finite results are rejected so
  inf / NaN don't propagate silently into charts.
- **`generic_dag.py`** — `GenericDagSpec` dataclass + `GenericDagSim`
  subclass of `SimulationBase` + `make_generic_dag_class(spec)`
  factory:
  - `simulate(**driver_values)` topologically sorts intermediates +
    outputs, evaluates each formula in order against the resolved
    variable bindings, returns the standard `dict[str, Output]`.
  - Series outputs evaluate once per year with `t` and `T` time
    variables bound; scalar outputs evaluate once.
  - FormulaError per node → NaN (graceful degradation; logged).
  - Cycle in the DAG → loud `ValueError`. Activation-time
    validation surfaces this before it ever runs.
  - Sensitivity sweep, `_metadata()`, live drift all work
    unchanged — the factory baking the spec into class-level slots
    keeps the SDK contract intact.
- **`db_loader.py`** — asyncpg-backed loader that walks `sectors` +
  `graph_nodes` + `graph_edges` + the agent_workflow's `output`
  JSONB (the canonical formula source). Pool is lazy + fail-soft:
  unset / unreachable `DATABASE_URL` disables the DB path without
  breaking the in-code sims.
- **`registry.py`** — extended with `all_sims_async` /
  `get_sim_async` that fall back to the DB loader. Per-process
  `_DB_CACHE` keyed by slug; `invalidate(slug)` + `invalidate_all()`
  expose cache busting.
- **`main.py`** — all `/sims*` routes converted to async +
  `get_sim_async`. New `POST /sims/{slug}/reload` (single-slug
  invalidate) + `POST /sims/_reload-all` (bulk). Lifespan shutdown
  drains the asyncpg pool.

**sector-service**:

- `sim-proxy.ts` handles `204 No Content` (the reload endpoint
  returns empty body — calling `res.json()` on that throws).
- `sector.proposeFromAgent` + every status transition
  (`activate` / `archive` / `toDraft`) POSTs
  `/sims/<slug>/reload` upstream so the GenericDagSim cache stays
  in sync. Fail-soft: a network blip during reload just logs a
  warning; the DB transition is still committed.
- **Activation-time validation**: when activating a sector with no
  Python module, `collectActivationWarnings` walks the workflow
  output and surfaces missing formulas, decomposition-only
  workflows, empty graphs, etc. Warnings go onto the audit_log
  payload (`activation_warnings: string[]`) so admins reviewing
  `/audit` see what's incomplete. Soft-block, not hard-block — the
  agent's intent is preserved even when partial.

**docker-compose.yml**:

- `simulation-service` gains `DATABASE_URL` (container-internal) +
  `depends_on: postgres: healthy`. Unset in non-Docker dev →
  DB sims silently disabled.

**Tests** (+31, all hermetic):

- `tests/test_evaluator.py` (17) — arithmetic correctness, edge-
  weight scaling, dunder block, `__import__` block, lambda block,
  division-by-zero, overflow → non-finite, bool coercion.
- `tests/test_generic_dag.py` (14) — scalar / series eval, driver
  override, unknown-driver rejection, topological sort (chain +
  edges-fallback), cycle detection, FormulaError → NaN, class-level
  metadata for SDK contract, sensitivity sweep works off
  GenericDagSim.

**Verification**:

- TS typecheck clean across all 5 workspaces.
- simulation-service pytest: **92 pass** (was 61 → +31).
- sector-service vitest: 56 pass / 26 skipped (unchanged baseline).
- agent-orchestration: 40 pass / 2 skipped (unchanged).
- @platform/db: 35 pass (unchanged).
- **Cumulative: 311 + 17 skipped** (+31 from M22a).

**End-to-end flow now**:

```
admin "Propose sector (full)" → Decomposition (Opus) → EdgeInference (Opus)
  → "+ Draft 등록" → sectors row + graph_nodes + graph_edges (origin=agent)
  → admin reviews draft + warnings in /audit
  → admin "✓ Activate" → POST /sims/<slug>/reload upstream
  → user app /sectors shows the new sector
  → /sectors/<slug>/manual sliders + /graph + /narrative all work
    via GenericDagSim evaluating the agent's formulas at run time
```

**Out of scope (M22c+)**:

- Cross-year coupling in series formulas (`x[t-1]`). Current series
  outputs can reference `t` but can't read prior-year results — the
  EdgeInference prompt doesn't reliably produce that shape yet.
  Workaround: a single discount-rate / aggregator formula treats
  `t` as the year index and produces the full series in one shot.
- The remaining 3 prompts (research, driver-inference,
  code-gen + code-review). Driver-inference would replace the
  "default=0 / range=(0,1)" placeholder in the DB loader with
  agent-calibrated ranges; code-gen + code-review would write a
  Python class to disk instead of falling back to GenericDagSim.
- Sandboxed (Modal / E2B) execution of agent-generated Python.
  GenericDagSim sidesteps the sandbox question by not executing
  Python — the formulas are pure expressions evaluated by
  `simpleeval` with a tight whitelist.
- Hard-block activation when warnings list is non-empty (current
  behavior is soft-warn). Will revisit once warning content
  stabilizes through real agent runs.

### M23 — Beginner-investor UX overhaul (shipped 2026-05-21)

The user feedback: "전체적으로 너무 전문가스러워. ... 좀 더 초보
투자자들이 쉽게 접할 수 있게끔 전체 UI와 구성을 모두 싹다 바꿔봐. 이
마일스톤이 제일 중요해 이제." M23 rewrites the IA + onboarding + every
primary surface into the **logical investor flow**: 산업이 왜 성장하나
→ 어떤 종목이 수혜인가 → 내 가정으로 시뮬레이션.

**Information architecture** (`sector-shell.tsx` + new `sector-nav.tsx`):

Old: 7 SubNav tabs all crammed together (Overview / Narrative / Live /
Manual / Graph / Sources / Equities) → user couldn't tell where to start.

New:
- **3 primary tabs**: 개요 · 종목 · 시뮬레이션 — the only thing a
  beginner sees on first paint.
- **"고급 도구" expander** below the primary row: 실시간 데이터 /
  전체 슬라이더 / 인과 그래프 / 데이터 출처 — auto-opens if the user
  navigates directly to one of those URLs so the active tab stays
  visible.
- URLs unchanged for backwards compat — only the chrome changed.
  `/narrative` becomes a permanent redirect to overview (its
  content moved into the new Overview).

**Sector Overview** (`/sectors/[slug]/page.tsx`):

Old: 6-card grid linking into the sub-tools — felt like a directory.

New (thesis-first):
1. Big "성장 가설" hero card with editorial 1-paragraph thesis +
   horizon chip (e.g. "AI 메모리 슈퍼사이클 (2026-2028)").
2. Two columns: **성장을 끌어올리는 힘** / **발목을 잡을 수 있는
   요인** — 3 bullets each, each with a tiny center-out gauge per
   driver ref showing "기본값 대비 +18% 위" style deviation.
3. Quick-stats row: 종목 수 / 90일 평균 변동 (sparkline) / 조정
   가능한 드라이버 수 / 시뮬레이션 기간.
4. Two CTAs at the top: "어떤 종목이 수혜를 받나요? →" / "내 가정으로
   시뮬레이션".

**Stocks page** (`/sectors/[slug]/equities/page.tsx`):

URL preserved. Header copy rewritten — title now "이 섹터의 종목",
intro spells out "위쪽 시뮬레이션 탭에서 가정을 바꾸면 종목별 30일
예상 변동이 실시간으로 갱신됩니다". Existing M5/M9 table component
unchanged (already does upside / sparkline / 행 펼치기).

**Simulate page** (`/sectors/[slug]/simulate/page.tsx`, **new**):

The headline beginner experience.
- Picks the **5 most-impactful drivers** from `sensitivity.swing`
  (max swing across all scalar outputs). Renders each as a large
  `<BeginnerSlider>` with: humanized title, plain-Korean description,
  current/default/min/max labels, +x% / -x% chip showing deviation
  from default.
- Below, an `<ImpactPreview>` card — fetches `equity.impactScores`
  per slider change and renders top-6 affected stocks with "현재
  가격 → 예상 가격" inline.
- Bottom toggle: "고급 — 전체 드라이버 + 산출물 차트 보기" expands
  into the full existing `<ManualPanel>` so power users still have
  the 14-slider + tornado-chart experience.

**Per-equity detail "왜 이 숫자인가"**
(`/sectors/[slug]/equities/[ticker]/equity-detail.tsx`):

Old: 7-column technical decomposition table (Driver / Default /
Current / Δ% / Weight / Contribution / Bar).

New default view: `<ContributionReasonList>` — plain-Korean
explanation cards, top-5 contributions:
- 🟢 / 🔴 emoji by sign-of-contribution
- One full Korean sentence: "AI DRAM 수요가 기본값 대비 크게 30%
  올라가서 이 종목에 유리하게 작용합니다."
- Footer: 기본값 → 현재 + 기여 점수

"숫자로 보기" toggle preserves the original technical table for
power users.

**Home** (`/page.tsx`):

Old: search + 3 sector cards + biggest movers table + recent
scenarios + audit feed all on first paint.

New:
1. Hero — "산업의 성장이 어떤 주식으로 이어지는지, 한눈에." + one-
   paragraph explainer.
2. **3 sector entry cards** — large, emoji-led, with editorial
   thesis blurb + 90d basket sparkline + 3 quick stats. The only
   thing a first-time visitor really needs.
3. **최근 90일 가장 크게 움직인 종목** — top 3 highlight cards
   (visual, large +/- %).
4. **"더 보기" expander** (`<MoreExpander>`, client-side,
   `localStorage` persistence) — collapses search + full movers
   table + recent scenarios + audit feed. Power users open once,
   stays open.

**Onboarding** (`<OnboardingModal>`, M20 → M23 rewrite):

Old: 5-step navigation tour.

New: **3-step value demo**. Storage key bumped to
`sss_onboard_v2` so existing users re-see the new tour once.
1. "어떤 산업이 가장 궁금하신가요?" — 3 emoji cards (memory / space /
   sofc) with editorial one-liner.
2. Selected sector's plain-Korean thesis paragraph in a hero card.
3. Single-slider live demo — slider 0..100 → mock 30d % per stock
   for 2-3 demo tickers. Animated. CTA "시작하기 →" drops user
   into the selected sector's `/simulate`.

The demo is *self-contained* (no live sim call from inside the
modal); the goal is to make the cause-effect connection visible in
the first 90 seconds.

**Language pass** (`page-intents.ts` + nav labels):

- Every page intent rewritten in plain-investor Korean. "Edge
  weight" / "decomposition" / "sensitivity sweep" / "topology"
  vocabulary banished from primary pages — kept only where the
  graph/manual surfaces truly need them.
- Top-nav: "Home" / "Sectors" / "Compare" → "홈" / "섹터" (Compare
  demoted to the per-sector scenario bar).
- SubNav captions in Korean question form: "왜 성장하나요?" / "어떤
  주식이 수혜?" / "내 가정으로 테스트".

**Verification**:

- TS typecheck clean across all 5 workspaces.
- sector-service / simulation-service / data-pipeline / agent-
  orchestration / @platform/db test totals **unchanged**: pure
  presentation / IA slice.
- Cumulative: 311 + 17 skipped.

**Manual smoke** (anyone running locally):

```
/                 → hero + 3 sector cards + 3 mover highlights
/sectors/memory-semi    → thesis hero + drivers/blockers + quick stats
/sectors/memory-semi/simulate → 5 sliders + live preview + 고급 expander
/sectors/memory-semi/equities → 종목 grid, header copy 친화적
/sectors/memory-semi/equities/005930 → 왜 이 숫자인가 plain
?onboard=1        → new 3-step value demo
```

**Out of scope (future polish)**:

- Per-page guided tour (current onboarding only shows once; an
  inline contextual `?tour=2` mode would let returning users
  re-trigger explanations on a specific page).
- Watchlist (\"내 관심 종목\") — needs auth + a `user_watchlist`
  table. The header's user menu is the natural seam.
- Stock comparison ("두 종목 나란히") — currently the platform only
  compares scenarios, not individual stocks.
- A11y deep pass — modal focus trap + skip links.

### Phase 2.5 roadmap (added to DESIGN.md, 2026-05-20)

Two new directions captured in `DESIGN.md` §8.5 (IA redesign) + §14
(Equities & Market Factors) with milestones in §9 → Phase 2.5:

- **IA redesign**: current single-page-with-tabs is shallow. Move to a
  3-level hierarchy (top-nav → sector hub → child pages). Add
  breadcrumbs, sub-nav, global cmd+K search, deep-linkable
  scenarios / reports / compare URLs. Implementation is 7 ordered
  slices, each independent.
- **Equities & Market Factors** (new domain): per-sector key player
  curation (`SectorEquity`), daily quotes (`EquityQuote`), fundamentals
  (`EquityFinancial`), and market factors (`MarketFactor` +
  `MarketFactorObservation`). New `data-pipeline-service` with
  yfinance / AlphaVantage / FRED / EDGAR / DART adapters.
  `EquityExposureModel` SDK addition projects scenario drivers to
  company-level revenue. Backtest harness compares predictions to
  reported financials weekly. 7 milestones, ~7–9 weeks total.

Both are now on the Phase 2.5 ladder. Implementation starts with the
first IA slice (breadcrumb + sub-nav component).

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
