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
