# Tech Sector Simulator Platform

> Turn industries into simulatable causal graphs, drive them with live market data, see how every key listed equity reacts in real time.

For product vision / personas / business model see [DESIGN.md](./DESIGN.md). For day-to-day coding conventions see [CLAUDE.md](./CLAUDE.md). For the per-slice work log see [docs/tasks/current.md](./docs/tasks/current.md).

---

## Problem

Investors who care about a thematic sector — AI memory, orbital data centers, hydrogen fuel cells — hit the same wall every quarter:

1. **The macro story lives in analyst notes.** "AI HBM demand will grow 50%" sits in a PDF. There's no machinery that connects that claim to any single ticker's earnings, let alone its price.
2. **The supporting data is scattered.** Quarterly revenue from EDGAR, KR filings from DART, daily prices from yfinance, capex from a 10-K appendix — five logins, five formats, none stitched.
3. **Theses don't update.** When ASP cycles or HBM premium drifts, the original "memory will rip" thesis ages silently. The investor who wrote it doesn't get a ping.
4. **Counterfactuals are hand-coded.** "What if HBM mix drops to 50%?" — answering means rebuilding an Excel model from scratch, every time.
5. **Per-equity attribution is muddy.** Even if you have a sector view, mapping it back to "which of the 17 listed names benefits most, and by how much" is a separate research project.

The chain *macro driver → sector flow → company P&L → stock price* exists in every investor's head, but nowhere in software. So the chain rots — and the investor finds out late.

## Solution

A platform where each sector is a **simulatable causal graph**, every node has a **provenance source**, and every key listed equity is a **first-class node** wired to its driver dependencies.

Three things light up at once:

- **Edit the graph, the math moves.** Drag an edge weight to 2.0 in `/sectors/memory-semi/graph` → the NPV chart on the overview page updates → every equity's 30-day projection line shifts. Real time, no rebuilds.
- **Per-equity narrative falls out of the model.** Each equity carries a graph-derived `impactScore ∈ [-100, +100]` summarizing how today's driver state vs defaults benefits or hurts it. Map that score → 30-day projected price → upside vs current.
- **Real data keeps the graph honest.** Daily yfinance ingest refreshes quote series; weekly SEC EDGAR + Korean OPEN DART refresh quarterly revenue / margins / capex / balance sheet. Frankfurter handles historical FX so old quarters aren't distorted by today's KRW rate.

The platform answers, in one place: *"What's the upside on this stock if the sector goes the way I think it does, and what would have to be true?"*

## Why now

- **Open financial data is unusually open.** SEC EDGAR's XBRL Facts API ships every US public filing as machine-readable JSON, no key. DART exposes every Korean filing the same way. yfinance handles intra-day. None of this existed in usable shape a decade ago.
- **AI agents make causal-graph authoring tractable.** Hand-coding a sector simulation takes a senior engineer two weeks. An agent loop (research → decomposition → driver inference → code-gen → review) can ship a credible first cut in hours. Phase 3 brings that loop fully online.
- **Investor demand is shifting toward thesis iteration speed.** Public-side allocators want to flex a thesis in minutes (slider drag) rather than days (Excel rebuild). The slow-iteration alternative isn't competitive.

## How (mechanism in 60 seconds)

1. **Each sector is a `SimulationBase` class** in Python (`services/simulation-service`). It declares drivers (with ranges + provenance), an in-code causal `SimGraph`, and a `simulate(**drivers)` method.
2. **First boot bootstraps the graph into Postgres** — `graph_nodes` + `graph_edges` rows. From then on the DB is authoritative; the Python literal is the "reset target."
3. **Each row in `sector_equities`** (49 hand-curated US + KR tickers across 3 sectors today) becomes a `GraphNode(kind="equity")` with `driver_links` JSONB lifted into `GraphEdge` rows. `weight = sign × magnitude_weight`.
4. **Sliders + graph edits feed the same simulation.** Sector-service reads `graph_edges`, forwards non-neutral weights to simulation-service on every `sim.run`; sims multiply by those weights at named choke points. Default weight = 1.0 means edits are opt-in — legacy math is unchanged until someone touches the graph.
5. **Per-equity impact derives from the graph.** `equity.impactScores` walks inbound edges to each equity node:
   ```
   raw_i  = (driver_value_i − default_i) / |default_i|
   score  = 100 · tanh( Σ edge.weight × raw_i )
   ```
   M5 turns the score into a 30-day projected price line on every sparkline.
6. **Real data refreshes on schedule.** Daily yfinance (08:30 UTC), weekly EDGAR + DART financials (Sun 04:00 UTC). All ingest is failure-isolated per ticker.

## What it doesn't try to be

- Not a brokerage. We don't route orders; we surface a thesis-and-evidence layer.
- Not an analyst-report generator. The agent slices write code + graph topology; humans approve before deploy.
- Not a backtester (yet). Phase 4 adds historical replay; for now the projection layer is forward-only.
- Not multi-tenant. Single workspace until auth lands.

---

## 1. Current architecture (2026-05-21)

**5 services + 2 Next.js apps**, all wired through `docker-compose`. Postgres-backed; Anthropic + yfinance + Gemini consumed externally.

```
                            ┌───────────────────────────────────────┐
 Browser  ──── :3000 ──────►│  apps/web  (Next.js 15, RSC)          │
                            │  sector workspace + equities + report │
                            └──────┬────────────────────────────────┘
                                   │  /api/sim/* rewrite
                            ┌──────▼────────────┐
 Admin    ──── :3100 ──────►│  apps/admin       │──┐
                            │  sectors / agent  │  │
                            │  runs / scenarios │  │
                            └──────┬────────────┘  │
                                   │ tRPC          │
                            ┌──────▼────────────────▼──┐
                            │  sector-service  :8001   │
                            │  Fastify + tRPC + Prisma │
                            └─┬──────────┬─────────┬───┘
                              │          │         │
                ┌─────────────▼┐  ┌──────▼──────┐ ┌▼──────────────────┐
                │ simulation-  │  │ agent-      │ │ data-pipeline     │
                │  service     │  │ orchestr.   │ │  yfinance ingest  │
                │  :8000       │  │  :8002      │ │  :8003            │
                │  FastAPI     │  │  FastAPI    │ │  FastAPI +        │
                │  Python sims │  │  workflows  │ │  APScheduler      │
                └──────┬───────┘  └──────┬──────┘ └─────┬─────────────┘
                       │                 │              │
                       └───────┬─────────┴──────────────┘
                               ▼
                       ┌────────────────┐
                       │ postgres :5432 │  (host :6543)
                       │  16-alpine     │
                       └────────────────┘
```

### Service inventory

| Service | Port | Language | Role |
|---|---:|---|---|
| `apps/web` | **3000** | TS / Next.js 15 | User-facing sector workspace |
| `apps/admin` | **3100** | TS / Next.js 15 | Sector / scenario / agent-run inspection |
| `services/sector-service` | **8001** | TS / Fastify + tRPC | Single API surface — proxies sims, owns scenarios + equities |
| `services/simulation-service` | **8000** | Python / FastAPI | Executes `SimulationBase` sims (3 hand-coded sectors) |
| `services/agent-orchestration` | **8002** | Python / FastAPI | LLM workflows (DecompositionWorkflow live; more in pipeline) |
| `services/data-pipeline` | **8003** | Python / FastAPI + APScheduler | Daily yfinance ingest — snapshot + 90d history |
| `postgres` | 5432 → host **6543** | PostgreSQL 16 | Sectors / scenarios / agent_workflows / sector_equities / equity_quotes |

### Shared workspaces (`packages/`)

- `@platform/db` — Prisma 5.22, schema + migrations source-of-truth
- `@platform/ui` — shared shadcn-flavored components (`Breadcrumbs`, `SubNav`, `Sparkline`)
- `@platform/sdk-python` — `SimulationBase`, `Driver`, `Output`
- `@platform/agent-tools` — Anthropic LLM client + prompt loader + cost meter

---

## 2. Feature inventory (what works today)

### User app (`/`)

| Route | What |
|---|---|
| `/` | **Investor home** — unified search + trending sectors + biggest movers + recent scenarios + audit feed |
| `/login`, `/signup` | Email + password auth |
| `/settings` | Profile + locale/theme preference + password change + onboarding replay |
| `/sectors` | Registered sector grid (3 sectors) |
| `/sectors/[slug]` | Overview hub — 6-card preview |
| `/sectors/[slug]/narrative` | **Investment narrative** — growth thesis + key drivers/blockers + per-equity upside/downside grid |
| `/sectors/[slug]/live` | Live KPI dashboard, 3s polling |
| `/sectors/[slug]/manual` | Slider editor, drivers → outputs |
| `/sectors/[slug]/graph` | React Flow causal graph |
| `/sectors/[slug]/sources` | Provenance (history + source URLs) |
| `/sectors/[slug]/equities` | **Equities tab** — 49 curated US/KR stocks, 90d sparklines, impliedImpact score |
| `/sectors/[slug]/equities/[ticker]` | **Per-equity narrative** — 30d target, "why this number" decomposition, financials, filings |
| `/compare?sector=…&a=…&b=…` | A/B scenario comparison |
| `/?sector=<slug>` | Legacy redirect → `/sectors/<slug>` |

### Admin app (`/`)

| Route | What |
|---|---|
| `/` | Sector list with "Open in user app" links |
| `/sectors/[slug]` | Sector internal view + scenario inspection |
| `/agent-runs` | List of recent agent workflow runs |
| `/agent-runs/new` | Trigger a new DecompositionWorkflow (form) |
| `/agent-runs/[id]` | Workflow status + output (decomposition JSON, cost USD, errors) |
| `/scenarios` | Scenario list across sectors |
| `/lifecycle` | **Deprecate review** — stale equities / orphan nodes / neutral edges / cold sectors. Keep / Defer / Approve buttons; every action logs to audit. |
| `/audit` | **Audit log viewer** — filterable by action / sector / author, cursor-paginated |
| `/monitoring` | **Data freshness panel** — data-pipeline cron status + DB table counts |

### Equities domain

- **49 hand-curated listings** (17 memory-semi + 15 space-data-center + 17 sofc) across NASDAQ / NYSE / KOSPI / KOSDAQ.
- Each row carries editorial **`driver_links`** (which sim drivers affect this stock + sign + magnitude).
- **`impliedImpact`** score: `100 × tanh(Σ((cur-def)/|def| × sign × magnitude) × 100 / 100)`. Editorial directional cue, not econometric.
- **90d sparklines** loaded lazily; period return % chip color-coded; **β chip** vs sector basket.
- **Slider → projection**: every sparkline grows a dashed forward-30d line that swings with `impliedImpact` × 0.3. Drag a driver on the Manual tab → every equity's chart updates in real-time.
- Expand row: dual sparkline (equity vs equal-weighted sector basket + 30d projection) + projection-target / β / α / σ / max DD / R² grids.
- Daily snapshot refresh via `data-pipeline:8003` cron (08:30 UTC = 17:30 KST).
- 90-day history refresh on demand (POST `/jobs/refresh-quote-history`).

### Agent orchestration

- `DecompositionWorkflow` (Opus 4.7) — natural-language sector description → structured `Decomposition` (drivers / intermediates / outputs).
- Workflow records persisted in Postgres (`agent_workflows` table), survive restarts.
- Dangling sweep on startup flips zombie pending/running workflows to failed after 5min grace.
- Prompt files in `prompts/` (5 versioned system prompts; hot-reloadable in local mode).
- Cost meter logs every LLM call with token + USD breakdown.
- Eval harness in `tests/agent_evals/` (Tier 1: prompt sanity / Tier 2: workflow behavior).

---

## 3. Quickstart

### One-shot Docker (all 7 services)

```bash
cp .env.example .env       # set ANTHROPIC_API_KEY if you want agent runs
docker compose -f docker-compose.yml -f docker-compose.local.yml up --build
```

Then open:
- **http://localhost:3000** — user app
- **http://localhost:3100** — admin app
- `curl localhost:8000/health` / `:8001/health` / `:8002/health` / `:8003/health` — service liveness

### Without Docker

```bash
# prereqs: Node 20+, pnpm 9+, Python 3.12+, uv, Postgres 16 reachable
pnpm install
uv sync
cp .env.example .env       # set DATABASE_URL + ANTHROPIC_API_KEY
pnpm db:migrate            # apply all migrations
pnpm db:seed               # 3 sectors
pnpm db:seed:equities      # 49 equity rows
pnpm dev                   # turbo runs web + admin + 4 services in parallel
```

---

## 4. Database lifecycle

```bash
pnpm db:up                   # start the postgres container only
pnpm db:migrate              # prisma migrate dev — apply pending migrations
pnpm db:migrate:deploy       # prisma migrate deploy — production-safe variant
pnpm db:migrate:reset        # drop + recreate (DEV ONLY)
pnpm db:seed                 # upsert 3 sectors
pnpm db:seed:equities        # upsert 49 equity rows
pnpm db:seed:equity-quotes        # generate 49 × 90 = 4,410 mock daily bars (deterministic)
pnpm db:seed:equity-financials    # generate 49 × 8 = 392 mock quarterly financial rows (deterministic)
pnpm db:seed:graph                # bootstrap GraphNode + GraphEdge from each sim's SimGraph literal
pnpm db:seed:graph-equities       # promote SectorEquity rows to GraphNode(kind="equity") + driver→equity edges
pnpm db:studio               # Prisma Studio at :5555
pnpm db:logs                 # tail postgres logs
pnpm db:down                 # stop postgres (data persists in named volume)
```

In docker-compose, the `db-migrate` one-shot service runs `migrate:deploy && seed && seed:equities && seed:equity-quotes` automatically before sector-service / agent-orchestration / data-pipeline boot — so a fresh `up` produces fully populated equity tables without an external network call.

---

## 5. Common operations

### Refresh equity financials (data-pipeline)

```bash
# Manual trigger (US uses EDGAR, KR uses DART if DART_API_KEY set)
curl -X POST "http://localhost:8003/jobs/refresh-financials?quarters=8"

# Last result + per-equity failure reasons
curl http://localhost:8003/jobs/refresh-financials/last
```

Env:
- `EDGAR_USER_AGENT` — required for EDGAR (SEC policy). Default
  `"sector-simulator-platform info@example.com"` — please override
  with your contact email before production use.
- `DART_API_KEY` — required for KR equities. Skip KR silently when
  unset. Free registration: https://opendart.fss.or.kr/
- `REFRESH_FINANCIALS_CRON` — weekly cron (default `0 4 * * 0` —
  Sun 04:00 UTC). Set `INGEST_SCHEDULE=off` to disable all crons.
- `REFRESH_FINANCIALS_QUARTERS` — window for the scheduled run
  (default 8). Manual endpoint accepts `?quarters=` override.

Historical FX (M10c): the DART adapter calls Frankfurter
(public ECB-sourced, no key) to fetch the KRW/USD rate at each
quarter's end-date, so YoY comparisons aren't distorted by today's
FX. Falls back to the snapshot constant on lookup miss.

### Refresh equity prices (data-pipeline)

```bash
# Snapshot — updates last_close_local / last_close_usd / market_cap_usd
curl -X POST http://localhost:8003/jobs/refresh-quotes

# 90-day history — populates equity_quotes time-series for sparklines
curl -X POST "http://localhost:8003/jobs/refresh-quote-history?days=90"

# Check last run
curl http://localhost:8003/jobs/refresh-quotes/last
curl http://localhost:8003/jobs/refresh-quote-history/last
```

In local mode the scheduler is **off by default** (`INGEST_SCHEDULE=off`) so dev restarts don't hammer yfinance. Set `INGEST_SCHEDULE=on` to enable the daily cron (08:30 UTC).

### Trigger a decomposition workflow

```bash
# Via admin UI: open http://localhost:3100/agent-runs/new

# Or via curl
curl -X POST http://localhost:8002/workflows/decompose \
  -H 'Content-Type: application/json' \
  -d '{"description": "Solid-state battery for EV", "horizon_years": 10}'
# → returns workflow_id

curl http://localhost:8002/workflows/<workflow_id>
```

Needs `ANTHROPIC_API_KEY` set in `.env`. Without it the endpoint returns the workflow record but the run errors out.

### Quality gates

```bash
pnpm typecheck    # tsc across web / admin / ui / db / sector-service
pnpm lint         # next lint + ruff
pnpm test         # vitest (sector-service in-mem) + see Python below
pnpm format:check # prettier

# Python services (run from repo root)
uv run --package agent-orchestration python -m pytest services/agent-orchestration/tests -q
uv run --package data-pipeline      python -m pytest services/data-pipeline/tests -q
uv run --package simulation-service python -m pytest services/simulation-service/tests -q
```

Current tally: **136 passing + 2 skipped** across all suites.

---

## 6. Milestones

### Shipped

| Phase / Milestone | Scope |
|---|---|
| **Phase 0** | SimulationBase SDK + simulation-service + slider workspace |
| **Phase 1** | Live KPI strip + scenarios + sources tab + sensitivity sweep (space-data-center reference sector) |
| **Phase 2** | Postgres + Prisma + sector-service (tRPC) + 3 sectors live (memory-semi, sofc, space-data-center) |
| **Phase 2 — agents** | agent-tools/llm-client + 6 versioned prompts + DecompositionWorkflow + admin UI |
| **Phase 2 — persistence** | `agent_workflows` table + asyncpg repo + dangling sweep |
| **Phase 2 — evals** | `tests/agent_evals/` two-tier harness (prompt sanity + workflow behavior) |
| **Phase 2.5 IA slice 1** | `@platform/ui` + Breadcrumbs + SubNav |
| **Phase 2.5 IA slice 2** | Sector hub split — `/sectors/[slug]/{live,manual,graph,sources}` nested routes |
| **Equities M1** | `SectorEquity` schema + 49 US/KR seed + analyst-grade table UI + impliedImpact score |
| **Equities M2** | `data-pipeline` service + yfinance adapter + daily snapshot refresh job |
| **Equities M3** | `EquityQuote` time-series + 90d sparkline ingest + inline sparkline column |
| **Equities M4** | Per-equity β / α / σ / max DD vs equal-weighted sector basket + dual sparkline overlay in expand view |
| **Equities M5** | Slider → projected price — every equity's sparkline grows a dashed forward-30d line driven by `impliedImpact` × 0.3 |
| **Equities M6** | Mock `EquityQuote` seed — deterministic 90d random walks anchored at each equity's snapshot close. Fresh `docker compose up` now ships ~4,410 quote rows; sparklines render without yfinance reachability. |
| **Equities M7** | Graph topology in DB — `GraphNode` + `GraphEdge` + `AuditLog` Prisma models, `graph.*` tRPC procedures (get / upsertNode / upsertEdge / delete / reset), `seed-graph.ts` bootstraps from each sim's Python `SimGraph` literal. New `graph-bootstrap` compose service. Web prefers DB graph with Python fallback. |
| **Equities M8** | Equity nodes inside the causal graph — each `SectorEquity` becomes a `GraphNode(kind="equity")` with edges from drivers (weights derived from sign × magnitude). Four-column graph layout (driver / intermediate / output / equity). Pure-math impliedImpact via `graph-impact.ts`. |
| **Equities M9** | Hybrid edge weights end-to-end — `EdgeWeights` in SDK, `memory-semi` sim refactored at 14 choke points, `sim.run` forwards `graph_edges` from DB → simulation-service. New `equity.impactScores` tRPC walks graph to score per-equity impliedImpact. Equity projections now move with edge weight edits. |
| **Equities M10** | `EquityFinancial` mock-seeded domain — 8 quarters × 49 equities (revenue, COGS, gross profit, opex, EBITDA, net income, capex). Deterministic per-ticker margins; accounting identities preserved. `equity.financials` tRPC + lazy-loaded Financials panel in expand row with 4 SVG bar charts. Real DART/EDGAR adapters deferred to M10b. |
| **Equities M11** | Graph editor UI — side panel with weight slider + magnitude select + label edit + delete on edge click. Drag-new-edge from node handles. Optimistic local state with rollback. Edge styling by weight (cyan amplify / rose inverse / amber dampen) and magnitude (stroke width). Brings M7-M9 backend plumbing alive. |
| **Equities M12** | Node CRUD UI — editable node side panel (label / group / unit / description, blur-to-save). "+ Add node" toolbar button → modal with key collision check + kind picker. Delete-node button respects the server-side attached-edges guard. |
| **Equities M13** | Reset graph — `graph.resetToDefaults` tRPC now wipes + re-bootstraps from Python SimGraph + SectorEquity.driver_links (inlines seed-graph + seed-graph-equities). New "↻ Reset" toolbar button with confirm + success banner. Convenience `graph.wipe` mutation preserved for tests. |
| **Equities M10b** | Real DART + EDGAR adapters — `EdgarSource` (SEC XBRL Facts, no key) + `DartSource` (OPEN DART, KR ticker→corp_code map for 16 seed equities) + `FakeFinancialsSource`. New `refresh_financials` APScheduler-ready job with per-country routing. `POST /jobs/refresh-financials` endpoint. 21 new tests covering adapter math, fallback chains, failure isolation. |
| **Equities M10c** | Financials refinement — EDGAR `DepreciationAndAmortization` → true EBITDA. DART switches to `fnlttSinglAcntAll` (full statements) so KR equities now have capex + true EBITDA. Historical FX via free `FrankfurterFx` (ECB-sourced) — DART converts each quarter at its quarter-end rate. Weekly cron via `REFRESH_FINANCIALS_CRON` (default Sun 04:00 UTC). 14 new tests. |
| **Equities M10d** | Financials breadth — DART `corpCode.xml` auto-discovery for unmapped KR tickers (lazy, cached, fetch-error tolerant). `EquityFinancial` schema gains `total_assets_usd` / `total_liabilities_usd` / `total_equity_usd` populated by both adapters (DART K-IFRS BS items + EDGAR instant facts via `_pick_instant_facts`). Frankfurter generalized to any base/target pair + `local_per_usd_factory` for non-KR future adapters. 21 new tests. |
| **M14** | README expansion — Problem / Solution / Why-now / How (mechanism in 60 seconds) / What it doesn't try to be. Investor narrative now precedes the architecture diagram. |
| **M15** | Per-page intent panels — collapsible `<PageIntent>` card at the top of every sector subpage + `/sectors` list + `/compare`. One-line pitch + two-column "왜 보는가 / 무엇을 찾는가" bullets. Centralized content in `apps/web/src/app/page-intents.ts`. |
| **M16** | Home page / investor dashboard — new `/` route fans out per Promise.all (sims / equities ×3 / basket stats ×3 / scenarios / audit). `<HomeSearch>` client-side filters a flattened sector + equity + driver index. Trending sectors cards (basket sparkline + 90d %), Biggest movers table (sorted by |return|), Recent scenarios tiles, What's-changed feed via new `audit.recent` tRPC procedure. Legacy `/?sector=…` redirect preserved. |
| **M17** | Investment narrative UI — `/sectors/[slug]/narrative` (thesis card + drivers/blockers + per-equity upside grid sorted by |Δ|) and `/sectors/[slug]/equities/[ticker]` (header stats + 90d+30d sparkline + "Why this number" driver × edge weight decomposition + financials + filings). New `equity.impactBreakdown` + `equity.getByTicker` tRPC. Editorial thesis content per sector in one file. |
| **M18** | Lifecycle review + audit history + monitoring — admin `/lifecycle` detects 4 deprecate-candidate classes (stale equities / orphan nodes / neutral edges / cold sectors), filters by active deferrals from the audit log, accepts Keep/Defer/Approve per item. Admin `/audit` paginated viewer with action/sector/author facets. Admin `/monitoring` proxies data-pipeline `/health` + per-table freshness. New `audit.list` / `audit.facets` / `lifecycle.candidates` / `lifecycle.review` / `monitoring.health` tRPC. Hard rule: every action writes an `audit_logs` row; nothing auto-applies. |
| **M19** | Graph UI quality polish — `@dagrejs/dagre` auto-layout (LR, tight-tree ranker, fixed 180×64 node box) replaces hand-rolled 4-column. Edges encode 4 orthogonal axes: color by target kind / width continuous on \|weight\| / dash by origin (seed solid · edit dashed · agent dotted) / arrow head by sign (filled positive, open negative). Untouched neutral edges fade to opacity ~0.35; tuned edges saturate. Nodes get kind chip + left color band. New `<EdgeLegend>` with 9 inline-SVG samples teaches the encoding. |
| **M20** | SaaS foundation — `users` + `sessions` Prisma models + bcrypt-hashed password auth, cookie-bound opaque sessions (httpOnly, sameSite=lax, 30d). New `auth.*` tRPC (`signUp` / `signIn` / `signOut` / `me` / `updateMe` / `changePassword`). Global sticky header on `apps/web` with logo + nav + user-menu dropdown (avatar initials, profile / settings / sign out, or sign-in CTA when anonymous). New `/login`, `/signup`, `/settings` routes. First-visit onboarding modal (localStorage-gated, replayable from Settings). Existing `author_label` fallback chain on graph / scenario / lifecycle mutations now defaults to the current user's display label. |
| **M21** | Agent-generated sectors → draft — `sectors.status` (live / draft / archived) + `sectors.agent_workflow_id` FK. New `sector.*` tRPC (`list` / `get` / `proposeFromAgent` / `activate` / `archive` / `toDraft`). Admin `/agent-runs/[id]` gets a "Register as draft sector" two-stage modal that takes a succeeded decomposition workflow → transactional create of `sectors` + every driver/intermediate/output node in `graph_nodes` + audit row. Admin home gets Live / Draft / Archived sections with status badges + per-row Activate / Archive / Demote / Restore buttons. `sim.list` filters drafts out of the user app by default; admin passes `include_non_live: true`. |

### Planned next

No backlog items remain on the M14-M21 track. Next direction TBD —
candidates: chain the remaining 5 agent prompts (research / driver-
inference / edge-inference / code-gen / code-review) into a multi-step
`ProposeSectorWorkflow`, build a `GenericDagSim` so agent-generated
drafts can actually `simulate()` on activation, sandboxed (Modal / E2B)
execution of agent-generated Python, OAuth providers, multi-tenant
scoping (see `### Deferred (Phase 3+)` below).

### In progress

| | Scope |
|---|---|
| _next pick TBD_ ||

(Approved plan: `.claude/plans/fluffy-plotting-hanrahan.md`.)

### Deferred (Phase 3+)

- Full agent business workflow: Research → Decomposition → Driver Inference → Edge Inference → Code Gen → Code Review → Sandbox validation → Deploy
- **DART (한국 공시) + EDGAR (US 10-K) adapters** → `EquityFinancial` (lands as M10b after the mock-seeded M10)
- MarketFactor / MarketFactorObservation (macro / policy / event)
- Backtest: counterfactual "if I'd held HBM premium at X 90 days ago"
- Modal / E2B sandboxed code execution
- LangSmith / Helicone tracing integration
- Temporal-backed workflow runner (current is in-process + Postgres)
- Sector hub IA slices 3-7 (cmd+K, `/scenarios/[id]`, `/compare/[a]/[b]`, reports index, equities tab — last shipped)

---

## 7. Repository layout

```
.
├── apps/
│   ├── web/                          # Next.js 15 — user app  (3000)
│   └── admin/                        # Next.js 15 — admin app (3100)
├── services/
│   ├── simulation-service/           # FastAPI — sim execution    (8000)
│   ├── sector-service/               # Fastify + tRPC — API     (8001)
│   ├── agent-orchestration/          # FastAPI — LLM workflows  (8002)
│   └── data-pipeline/                # FastAPI — ingest          (8003)
├── packages/
│   ├── db/                           # Prisma schema + migrations + seed
│   ├── ui/                           # Shared shadcn components
│   ├── sdk-python/                   # SimulationBase + Driver + Output
│   └── agent-tools/                  # Anthropic client + prompts loader
├── prompts/                          # 6 versioned agent prompts (.md)
├── infra/docker/                     # Per-service Dockerfiles
├── docker-compose.{yml,local,dev,prod}.yml
├── tests/
│   ├── agent_evals/                  # Tier-1/2 agent harnesses
│   ├── integration/                  # (reserved)
│   └── e2e/                          # (reserved)
├── docs/
│   ├── adr/                          # Architectural Decision Records
│   └── tasks/current.md              # Active slice log
├── pyproject.toml                    # uv workspace root
├── pnpm-workspace.yaml               # JS workspace
└── turbo.json
```

---

## 8. Compose modes — `local` / `dev` / `prod`

| Mode | File | Build target | Hot reload | Use case |
|---|---|---|---|---|
| `local` | `docker-compose.local.yml` | `dev` | yes (bind-mounts) | inner-loop dev on your machine |
| `dev` | `docker-compose.dev.yml` | `prod` | no | shared dev/staging |
| `prod` | `docker-compose.prod.yml` | `prod` | no | production deploy |

```bash
# Local — full stack with hot reload
docker compose -f docker-compose.yml -f docker-compose.local.yml up --build

# Bring up only some services
docker compose -f docker-compose.yml -f docker-compose.local.yml up admin web sector-service
```

### Env vars (set in `.env`)

| Var | Default | Purpose |
|---|---|---|
| `DATABASE_URL` | `postgresql://platform:platform@postgres:5432/platform_dev` | All services that talk to Postgres |
| `ANTHROPIC_API_KEY` | (unset) | Required for live agent runs; without it agent-orchestration only serves `/health` |
| `SECTOR_SERVICE_URL` | `http://sector-service:8001` | RSC-side fetch from web/admin |
| `AGENT_ORCHESTRATION_URL` | `http://agent-orchestration:8002` | Admin → orchestration calls |
| `INGEST_SOURCE` | local: `fake`, prod: `yfinance` | data-pipeline data source |
| `INGEST_SCHEDULE` | local: `off`, prod: `on` | data-pipeline daily cron |
| `INGEST_CRON_QUOTES` | `30 8 * * *` (UTC) | data-pipeline cron expression |

---

## 9. References

- [DESIGN.md](./DESIGN.md) — product vision, personas, roadmap, IA spec (§8.5), Equities domain spec (§14)
- [CLAUDE.md](./CLAUDE.md) — coding conventions, model routing, common-task recipes
- [docs/tasks/current.md](./docs/tasks/current.md) — per-slice work log
- [docs/adr/](./docs/adr/) — Architectural Decision Records
- [prompts/](./prompts/) — versioned agent system prompts
- [packages/sdk-python/README.md](./packages/sdk-python/README.md) — SimulationBase usage
