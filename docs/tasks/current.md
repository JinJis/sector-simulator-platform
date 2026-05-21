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
