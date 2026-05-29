# Phase 0 baseline — read-only discovery

**Audience**: Principal Engineer · **Generated**: 2026-05-29 · **Scope**:
multi-week refactoring effort. All claims are evidence-backed unless
explicitly marked `[inferred]`.

The user's hypothesis going in: worst entanglement lives in
`data-pipeline`, `agent-orchestration`, and the `sector-service` tRPC +
Prisma layer; frontend is presumed cleaner. **This baseline confirms
all three hypotheses, ranks them by ROI, and proposes a first PR.**

Tooling note: `cloc`, `knip`, `ts-prune`, `vulture` not installed; npx
fallback was network-blocked. Numbers below use `wc -l` (excluding
`node_modules`, `.next`, `dist`, `.turbo`, `__pycache__`, `.venv`,
generated Prisma client), `pnpm typecheck`/`lint`/`format:check`, and
`ruff check --select F401,F841` per Python service.

---

## 1. Inventory

### LOC + file count per workspace (source files only, excludes tests)

| Workspace                              | Files | LOC    | Notes                              |
|----------------------------------------|------:|-------:|------------------------------------|
| `services/data-pipeline/data_pipeline` |    61 | 13 708 | + 6 114 LOC / 23 files of tests    |
| `apps/web/src`                         |    67 | 12 500 | "presumed cleaner" — mostly true   |
| `services/sector-service/src`          |    40 | 10 403 | + 4 119 LOC / 16 files of tests    |
| `services/agent-orchestration/agent_orchestration` | 8 | 4 429 | 89 % concentrated in 3 files |
| `services/simulation-service/simulation_service` | 19 | 4 878 | + 1 660 LOC / 11 files of tests |
| `packages/db/prisma`                   |    10 |  4 012 | seed scripts dominate              |
| `packages/ui/src`                      |    21 |  3 818 | 20 components + `index.ts`         |
| `packages/agent-tools/agent_tools`     |     5 |  1 490 | + 1 158 LOC / 6 files of tests     |
| `packages/db/src`                      |     3 |    339 | Prisma client re-export            |
| `packages/sdk-python/platform_sdk`     |     2 |    207 |                                    |
| `apps/admin`                           |     1 |      6 | **gitignored leftover** — see §5   |

**Source-file total**: 315 files, ~73 200 LOC (production + tests + seeds).

### Direct dependencies (top-level, excluding workspace links)

| Package                         | runtime deps | dev deps |
|---------------------------------|------------:|---------:|
| `apps/web`                      |          9 | 8        |
| `services/sector-service`       |         10 | 5        |
| `packages/ui`                   |  0 (3 peer) | 5        |
| `packages/db`                   |          1 | 5        |
| `services/data-pipeline`        | **13** (+ workspace `agent-tools`) | 5 |
| `services/agent-orchestration`  |          5 | 5        |
| `services/simulation-service`   |          4 | 5        |
| `packages/agent-tools`          |          2 | 4        |

`data-pipeline` is the only service that pulls in **crawl4ai +
playwright + arq + sqladmin + sqlalchemy + itsdangerous + jinja2 +
agent-tools** — it has merged at least four prior responsibilities
(quote refresh, signal ingest, crawler fetchers, admin UI).

### Public surface area

| Surface                                            | Count |
|----------------------------------------------------|------:|
| **tRPC procedures** (across 26 sub-routers, 1 root) |   119 |
| tRPC sub-routers in `services/sector-service/src/trpc/` | 26 (+`router.ts`, `init.ts`, `context.ts`) |
| **FastAPI routes — `data-pipeline`**               |    23 |
| **FastAPI routes — `agent-orchestration`**         |    18 |
| **FastAPI routes — `simulation-service`**          |    11 |
| **Next.js page routes** (`apps/web/src/app`)       |    25 |
| Next.js API route handlers (`route.ts`)            |     0 |
| **`packages/ui` exported components**              |    20 (+ `index.ts` re-exports all) |
| **Prisma models**                                  |    36 (1 524 LOC schema, 11 migrations) |
| **SQLAlchemy mirror models** (`admin/models.py`)   |    15 |

Top tRPC routers by proc count: `agent` 11, `actor` 9, `sector` 8,
`equity` 8, `sim` 7, `graph` 7, `capability` 7, `prediction2` 6,
`community-proposal` 6, `auth` 6. Tail: `economics` 2,
`vision-builder` 2, `lifecycle` 2, `user-admin` 2, `monitoring` 1.

---

## 2. Quality baseline

### TypeScript / Node

| Gate                | Result | Detail                                                  |
|---------------------|:------:|---------------------------------------------------------|
| `pnpm typecheck`    | **FAIL** | `@platform/db`, `@platform/ui`, `@platform/sector-service` pass; `@platform/web` cached/successful in past runs; **`@platform/simulation-service` fails immediately**: `Failed to spawn: 'mypy'` (mypy isn't on `PATH` for the turbo runner; it's invoked through `uv run --package simulation-service mypy ...` but turbo loses the uv shim → see Phase 1 candidate). Zero TS errors detected. |
| `pnpm lint`         | **FAIL** | TS packages pass; **`@platform/simulation-service` fails with 45 Ruff errors** (mix of E501 long lines in tests, I001 import sort, N802 PascalCase test name, UP037/UP035 modernization). |
| `pnpm format:check` | **FAIL** | **156 files** need Prettier. Span includes every `packages/ui/src/*.tsx`, every `services/sector-service/src/trpc/*.ts`, every prompt MD, every `README.md`. Treat as a single mechanical fix. |

### Python — per service ruff status (full ruleset E,F,I,N,UP,B,SIM as configured)

| Service / package                           | Errors | Top codes                                           |
|---------------------------------------------|-------:|-----------------------------------------------------|
| `services/data-pipeline/data_pipeline`      | **40** | F401 ×12, I001 ×9, E501 ×8, UP037 ×7, UP035 ×2, others ×2 |
| `services/agent-orchestration/agent_orchestration` | **11** | (sample run; SIM, B, UP)                       |
| `services/simulation-service/simulation_service` | **27** | mostly E501 + UP                                  |
| `packages/agent-tools/agent_tools`          | **3**  | UP / collections.abc                                |
| `services/data-pipeline` (incl. tests)      | **256** | tests are the long pole — E501 + UP046 generic-class + UP037 |

### Dead-imports / unused-vars (`ruff --select F401,F841`)

| Service / package                  | F401+F841 |
|------------------------------------|----------:|
| `services/data-pipeline/data_pipeline` | **12** |
| `services/agent-orchestration/agent_orchestration` | 1 (`conductor.py:22  asyncio` unused) |
| `services/simulation-service/simulation_service`    | **0** |
| `packages/agent-tools/agent_tools` | 0 |

### Test breadth (file counts — coverage NOT measured)

| Workspace                          | Test files |
|------------------------------------|-----------:|
| `services/data-pipeline`           | 21         |
| `services/sector-service`          | 15         |
| `services/agent-orchestration`     | 13         |
| `services/simulation-service`      | 10         |
| `packages/agent-tools`             | 5          |
| `tests/agent_evals` (repo-level)   | 3          |
| `packages/db`                      | 2          |
| **`apps/web`**                     | **0**      |

`apps/web` has **zero** `*.test.{ts,tsx}` files. CLAUDE.md targets
"apps 50%" coverage; current is **structurally unmeasurable** because
there is nothing to measure. This is a separate problem from
refactoring and is called out for visibility only.

---

## 3. Dead-code candidates (need human verification)

`ts-prune` / `knip` could not be installed (network-blocked
`npx --no-install` failed, no global install permitted by task
constraints). The TS list below is built only from import-grep evidence
+ format/lint signals.

### Python — verified via `ruff --select F401,F841`

| # | File:line                                              | Symbol                                | Notes |
|---|--------------------------------------------------------|---------------------------------------|-------|
| 1 | `services/data-pipeline/data_pipeline/main.py:85`     | `DigestError`                         | Imported, never referenced in module |
| 2 | `services/data-pipeline/data_pipeline/main.py:93`     | `ActorFetcherError`                   | "                                    |
| 3 | `services/data-pipeline/data_pipeline/main.py:96`     | `run_actor_fetcher`                   | "                                    |
| 4 | `services/data-pipeline/data_pipeline/main.py:99`     | `CapabilityFetcherError`              | "                                    |
| 5 | `services/data-pipeline/data_pipeline/main.py:102`    | `run_capability_fetcher`              | "                                    |
| 6 | `services/data-pipeline/data_pipeline/main.py:107`    | `run_hello_world`                     | "                                    |
| 7 | `services/data-pipeline/data_pipeline/main.py:110`    | `RiskFetcherError`                    | "                                    |
| 8 | `services/data-pipeline/data_pipeline/main.py:113`    | `run_risk_fetcher`                    | "                                    |
| 9 | `services/data-pipeline/data_pipeline/main.py:116`    | `SignalFetcherError`                  | "                                    |
| 10| `services/data-pipeline/data_pipeline/main.py:120`    | `run_signal_fetcher`                  | "                                    |
| 11| `services/data-pipeline/data_pipeline/main.py:124`    | `QueueDepthSnapshot`                  | "                                    |
| 12| `services/data-pipeline/data_pipeline/signal_repo.py:13` | `datetime.UTC`                     | Now-tz lookup, never used after P2   |
| 13| `services/agent-orchestration/agent_orchestration/conductor.py:22` | `asyncio`                  | Leftover from a refactor             |

These 12 `main.py` F401 lines are **direct evidence** that
`data-pipeline/main.py` is a god module that previously dispatched
to fetcher entrypoints in-process and now relegates that to the ARQ
queue and SQLAdmin actions — the imports were never cleaned up.

### TypeScript — heuristic candidates (NOT verified — no ts-prune)

The format-check warning list (156 files) implies nothing has been
through Prettier since the M55 admin reset. `[inferred]` candidates
worth a ts-prune sweep when the tool is available:

| # | File                                                          | Reason flagged |
|---|---------------------------------------------------------------|----------------|
| 14 | `services/sector-service/src/trpc/agent.ts`                  | 11 procs (most of any router); CLAUDE.md says sector-service tRPC was thinned but this file looks like it grew. **Check whether all 11 are still reachable from apps/web.** |
| 15 | `services/sector-service/src/lib/agent-proxy.ts`             | Companion to `agent.ts`; if some procs are dead, this dies with them. |
| 16 | `services/sector-service/src/lib/sim-proxy.ts`               | Used to back the Playground sim runner — verify against current sim-service contract. |
| 17 | `services/sector-service/src/lib/budget.ts`                  | Not referenced by any of the 119 procs grep'd; potential orphan. |
| 18 | `services/sector-service/src/trpc/economics.ts`              | Only 2 procs; might fold into `vision.ts` or be unused since EconomicsDatapoint reads come through `vision.getOverview`. |
| 19 | `services/sector-service/src/trpc/monitoring.ts`             | 1 proc; smallest router. Single-call routers are often dead. |
| 20 | `services/sector-service/src/trpc/lifecycle.ts`              | 2 procs (366 LOC) — high LOC-per-proc ratio suggests dead helpers. |

All TS candidates are **unverified**; treat as a list of "files to
point ts-prune at" not "files to delete."

---

## 4. Entanglement evidence — top 10 hotspots

Fan-in counts use `grep -r "from <module>"` across `services/` and
`packages/` (excluding `__pycache__`/`node_modules`). They are
**source-file references**, not call sites.

### #1 — `services/data-pipeline/data_pipeline/main.py` — 1 928 LOC, fan-in 9
- **One file** holds: env-typo guard, lifespan bootstrap, asyncpg pool
  wiring for 8 different repos (`PostgresCapabilityReader`,
  `PostgresActorReader`, `PostgresRiskReader`,
  `PostgresOrchestratorReader`, `PostgresDiscoveryReader`,
  `PostgresProposalWriter`, `PostgresSignalWriter`,
  `PostgresCrawlRunRepository`), all 7 APScheduler cron handlers
  (`_run_refresh_job`, `_run_news_ingest_5min`, `_run_research_ingest_hourly`,
  `_run_digest_daily_job`, `_run_recompute_feasibility_job`,
  `_run_resolve_predictions_v2_job`, `_run_orchestrator_tick_job`),
  Pydantic request/response shapes for **23** endpoints
  (`HelloWorldTriggerBody/Out`, `CapabilityTriggerBody/Out`, ...,
  `OrchestratorTickBody/Out`, `DigestRunBody/Out`,
  `DiscoveryRunBody/Out`), and the `create_app()` factory that defines
  all 23 routes inline.
- 33 top-level defs/classes; 11 unused imports (§3) prove the file is
  drifting.
- Inline comments self-identify three merged origins: `# Crawler-side
  bootstrap (merged from crawler/main.py in commit 3/6)` + `# Crawler-
  side Pydantic shapes (merged from services/crawler/crawler/main.py`
  + `# Crawler-side endpoints (merged from crawler/main.py …)`.
- **Suggested refactor scope**: **multi-phase** (4-6 PRs). Order:
  (a) drop the 11 dead imports (1 PR, < 50 LOC); (b) extract the 23
  endpoint Pydantic shapes to `data_pipeline/api/schemas.py`; (c) move
  each cron handler to `data_pipeline/jobs/` with a thin route module
  in `data_pipeline/api/` per surface (refresh, signal_ingest,
  fetchers, orchestrator, digest, resolve); (d) `main.py` keeps only
  `lifespan` + `create_app()` wiring.

### #2 — `services/agent-orchestration/agent_orchestration/workflows.py` — 1 577 LOC, fan-in 19
- 17 workflow classes (`DecompositionWorkflow`, `EdgeInferenceWorkflow`,
  `ProposeSectorWorkflow`, `ResearchWorkflow`, `DriverInferenceWorkflow`,
  `CodeGenWorkflow`, `CodeReviewWorkflow`, `FullPipelineWorkflow`,
  `SignalExtractorWorkflow`, `CapabilityScoreUpdaterWorkflow`,
  `PromptValidatorWorkflow`, `VisionDecompositionWorkflow`,
  `DataSourceSelectorWorkflow`, `ThesisDrafterWorkflow`,
  `ProposalPayloadDrafterWorkflow`) **plus** `WorkflowRunner`
  (general-purpose async + persistence shim) **plus** `Workflow`
  protocol — three logically distinct concerns in one file.
- Doc-comments still mention "calls Claude Opus 4.7" (`workflows.py:234`
  and `workflows.py` edge inference comment) — stale post-F9 (Gemini-
  only). Doc drift in production code.
- **Fan-in 19** — every test in `agent-orchestration/tests/*` and
  `main.py` + `conductor.py` import from here. Splitting will require
  updating each importer site.
- **Suggested refactor scope**: **multi-phase** (3-4 PRs). (a) extract
  `WorkflowRunner` + `Workflow` protocol to `agent_orchestration/runner.py`;
  (b) split the 17 workflows into `workflows/vision_builder.py` (5
  classes: PromptValidator, VisionDecomposition, DataSourceSelector,
  ThesisDrafter, ProposalPayloadDrafter), `workflows/scoring.py`
  (SignalExtractor, CapabilityScoreUpdater), `workflows/legacy.py`
  (Decomposition, EdgeInference, ProposeSector, Research,
  DriverInference, CodeGen, CodeReview, FullPipeline — these are
  Phase-3 holdovers).

### #3 — `services/agent-orchestration/agent_orchestration/schemas.py` — 1 152 LOC, fan-in 19
- 72 Pydantic classes in one file. Same fan-in as workflows.py because
  the import patterns are identical. Splitting must happen alongside
  #2 to avoid double-touching every importer.
- **Suggested refactor scope**: pair with #2.

### #4 — `services/data-pipeline/data_pipeline/admin/views.py` — 757 LOC, 15 classes
- 15 SQLAdmin ModelViews (`SectorView`, `CapabilityView`, ...,
  `AuditLogView`). Each is ~30-70 lines; the file mixes columns,
  filters, formatters, FK-name joins, status-badge renderers.
- Pairs with `admin/models.py` (387 LOC, 15 SQLAlchemy mirror models)
  + `admin/actions.py` (322 LOC, row actions) + `admin/format.py`
  (244 LOC, custom field formatters).
- **One PR** scope: split `views.py` into `admin/views/{sector.py,
  capability.py, signal.py, ...}` mirroring the model boundary. Low-
  risk because SQLAdmin doesn't care where the class lives if it's
  registered in `mount.py`.

### #5 — `services/sector-service/src/trpc/vision.ts` — 726 LOC, fan-in 19
- Only 4 procedures, but each is ~150 LOC because it inlines large
  Zod schemas + multi-step Prisma transactions + LLM rationale joins.
  See lines 22-46 for the inline `VisionSummary` schema definition.
- Fan-in 19 — every visions/* page in apps/web pulls types from this
  module's exported `AppRouter`.
- **One PR** scope: lift the 5 Zod schemas (`VisionSummary`,
  `VisionHero`, `VisionHistoryPoint`, etc.) to
  `services/sector-service/src/trpc/schemas/vision.ts`. Keeps fan-in
  contract intact (types still exported via `AppRouter`).

### #6 — `services/sector-service/src/trpc/community-proposal.ts` — 676 LOC, 6 procs
- 6 procedures, ~113 LOC each. Inlines the `bulkDecide` audit-log
  write (mirrored in the SQLAdmin proposal action — drift target).
- **Suggested refactor scope**: extract the shared audit-log writer
  to `lib/audit.ts`; sector-service and SQLAdmin route to one place.

### #7 — `services/sector-service/src/trpc/sector.ts` — 672 LOC, fan-in 35
- **Highest fan-in of any service file** (rough grep — counts imports
  of "sector" as a token in router/path strings, so inflated).
  Still: this file is the canonical CRUD for the Sector/Vision row
  with 8 procs.
- CLAUDE.md M36 note says "in product language a `Sector` is a
  `Vision`". The router still uses the physical name, which is fine,
  but the proc set duplicates what `vision.ts` (#5) does for the
  read path. **Two routers, one model.**
- **Suggested refactor scope**: deferred — touching this requires
  product-side decision on whether to consolidate.

### #8 — `services/sector-service/src/trpc/vision-builder.ts` — 631 LOC, fan-in 1
- Only 2 procedures (`.propose` and `.commit`) but 631 LOC because
  `.commit` is a one-shot Prisma transaction that writes
  `Sector + Capability + Risk + Actor + VisionActor + CapabilityActor +
  CapabilityDependency + InvestmentThesis + Catalyst` in a single
  bound transaction (M55 design choice — heavy lifting stays here so
  SQLAdmin's Vision Builder wizard can stay thin).
- **Suggested refactor scope**: extract per-table writers to
  `lib/vision-builder/` so the transaction body becomes a sequence
  of typed calls.

### #9 — `services/data-pipeline/data_pipeline/deep_research/digest.py` — 436 LOC
- Combines: APScheduler entrypoint (`run_deep_research_digest`),
  ARQ enqueue path (`enqueue_deep_research_digest`), `GroundedResearchClient`
  call orchestration, per-capability summarization, signal write-back.
- Twin: `deep_research/fetchers/{actor,capability,risk,signal,hello_world}.py`
  follow the same enqueue + run + write pattern, 198-420 LOC each.
- **Suggested refactor scope**: extract a common
  `deep_research/_fetcher_base.py` that owns enqueue + run + crawl-run
  audit; each fetcher overrides only the LLM prompt + DB writeback.

### #10 — `services/agent-orchestration/agent_orchestration/main.py` — 573 LOC
- 18 FastAPI routes; each one ~25 LOC of route + Pydantic shape
  duplication. Same anti-pattern as data-pipeline/main.py but smaller
  blast radius.
- **Suggested refactor scope**: one PR — split routes into
  `api/{workflows.py, signal_extractor.py, score_updater.py,
  vision_builder.py}`.

### Long files in `apps/web` (kept brief — user's hypothesis confirmed)

| File                                                  | LOC  | Concern                                          |
|-------------------------------------------------------|-----:|--------------------------------------------------|
| `apps/web/src/lib/i18n/dict.ts`                      |  855 | Translation registry, intentional single source — leave |
| `apps/web/src/lib/sim-client.ts`                     |  661 | Playground client; candidate for splitting per surface |
| `apps/web/src/app/visions/[slug]/page.tsx`           |  609 | Hero page; mix of RSC fetch + client viz wiring  |
| `apps/web/src/app/manual-panel.tsx`                  |  580 | Legacy panel; check if still routed             |
| `apps/web/src/app/settings/settings-form.tsx`        |  519 | Single page                                      |

No file > 900 LOC in `apps/web` (vs 1 928 LOC in `data-pipeline/main.py`).
**Frontend confirmed less entangled.**

---

## 5. Architecture-vs-docs delta

| Source-of-truth claim                                 | Reality on disk                          | Severity |
|-------------------------------------------------------|------------------------------------------|:--------:|
| CLAUDE.md "Repository Structure": `services/{simulation,data-pipeline,agent-orchestration}-service` | Actual dirs: `services/{simulation-service, data-pipeline, agent-orchestration}` — **no `-service` suffix on data-pipeline or agent-orchestration**. | low |
| CLAUDE.md M55 + DESIGN.md §6 mention `services/crawler` (Phase 4) | `services/crawler/` directory exists but is **gitignored** (only `.venv/`, `.pytest_cache/`, `tests/__pycache__/` survive); merged into `data-pipeline` per the inline `# (merged from crawler/main.py in commit 3/6)` comments in `data-pipeline/main.py`. **Docs are correct (it was merged); the empty dir on disk is just leftover venv from before the merge.** | low / cosmetic |
| CLAUDE.md M55: "deleted `apps/admin/`"               | `apps/admin/` dir exists with 1 file (`next-env.d.ts`) + `.next/` + `.turbo/`; **also gitignored**. Same kind of leftover as `services/crawler`. | low / cosmetic |
| CLAUDE.md F9 line 156-160: tier names `opus/sonnet/haiku` | Most recent commit `72c2166` renamed them to `deep/balanced/fast`. CLAUDE.md acknowledges this ("post-F9 semantic names") but the leading example block still leads with the old names — **operator reading top-down sees stale names first**. | **medium** |
| CLAUDE.md F9 line 160: "legacy `LLM_{OPUS,SONNET,HAIKU}_MODEL` still honoured with a deprecation log" | `llm_client.py:82-86` reads ONLY `LLM_FAST_MODEL`, `LLM_BALANCED_MODEL`, `LLM_DEEP_MODEL`. No legacy env lookup, no deprecation log. **Setting `LLM_OPUS_MODEL=...` is silently ignored.** | **HIGH — config foot-gun** |
| DESIGN.md §5 table: "DeepResearch tier `deep-research-preview-04-2026`" | `grounded_research.py` resolves the `fast` tier to `gemini-2.5-flash` and `deep` to `gemini-3.1-pro-preview` per CLAUDE.md. The vendor-branded `deep-research-preview-04-2026` no longer exists. | medium |
| DESIGN.md §5 table: "Tool-use trick on Claude side (force `tool_choice` for structured output)" | F9 went Gemini-only; `tool_choice` mechanism gone. | medium |
| docs/agent-capabilities.md, docs/adr/0001, docs/archive/refactor.md, docs/architecture/composition.md all contain `opus|sonnet|haiku` | All Phase-3 / Phase-4 docs predate F9b rename. **Not in scope for refactor PRs but worth a sweep.** | low |
| CLAUDE.md "Tech Stack" table: "Frontend (`apps/web`) … Admin surface is SQLAdmin (Tabler) at `data-pipeline:8003/admin` — see M55" | Confirmed — `data-pipeline/main.py:1276` mounts SQLAdmin via `from data_pipeline.admin import mount_admin`. | accurate |
| `current.md` M56 P3: "agent-orchestration boots without LLM auth — lifespan catches `LLMClient()` RuntimeError" | Confirmed in `agent_orchestration/main.py:573`; this is the source of the "fan-in 19 from workflows.py" because every test stub needs the `app.state.llm=None` path. | accurate |
| `current.md` M56 Q1: "ModelView lists show FK row's `__str__` next to the opaque id" | Confirmed in `admin/views.py` (joined-name columns visible in CapabilityScoreView, SignalView, VisionActorView, CapabilityActorView). | accurate |

### Undocumented surface area

- **`packages/db/src` and `packages/db/tests`** — 339 LOC + 333 LOC of
  Prisma client re-export and tests, not documented in CLAUDE.md beyond
  the prisma `@platform/db` workspace name. Light, no action needed.
- **`packages/sdk-python/platform_sdk`** — 207 LOC; only `pyproject.toml`
  references it but it's named in `agent-orchestration` and
  `simulation-service` deps. CLAUDE.md "Repo structure" mentions
  `sdk-python` correctly.
- **`services/data-pipeline/data_pipeline/admin/templates/sqladmin/`** —
  Jinja templates for Queue + Crons + Vision Builder pages. Documented
  in `current.md` M55 step 3/4 but not in CLAUDE.md.

---

## 6. Verifications requested

**Q: Does `LLM_FAST_MODEL=gemini-3.1-flash-lite` resolve to a real
model in `packages/agent-tools/llm_client.py`, or does it silently
fall back / error?**

**A: It resolves to the literal string passed and is sent straight to
Gemini.** Evidence: `llm_client.py:89-93`:

```python
def model_for_tier(tier: ModelTier) -> str:
    """Resolve the active model id for `tier`. Order of precedence:
    env (`LLM_{DEEP,BALANCED,FAST}_MODEL`) → built-in default."""
    env_key = _MODEL_ENV_BY_TIER[tier]
    return os.environ.get(env_key) or _DEFAULT_MODEL_BY_TIER[tier]
```

There is **no allow-list, no validation, and no probe call** before the
string lands in `self._genai.models.generate_content(model=model, ...)`
at `llm_client.py:357`. Resolution paths:

1. Env value is non-empty → returned verbatim, regardless of whether
   it's a real model id. `gemini-3.1-flash-lite` is **not** in the
   default map (`gemini-3.5-flash-lite` is). Whether it's a real
   Gemini model id is a runtime question answered by Vertex / AI
   Studio with a 404 / `NOT_FOUND` / `Publisher Model … not servable`
   error at the first `.call()`.
2. Env value is empty/unset → falls back to
   `_DEFAULT_MODEL_BY_TIER["fast"] = "gemini-3.5-flash-lite"`.

**There is no graceful fall-back from "env value is rejected" to
"default."** A typo in the env wins until the first call blows up.

**Bonus finding**: CLAUDE.md claims `LLM_OPUS_MODEL` / `LLM_SONNET_MODEL`
/ `LLM_HAIKU_MODEL` are still honored with a deprecation warning.
**That is false** — the env-name dictionary at `llm_client.py:82-86`
only contains the post-F9b names. Setting `LLM_OPUS_MODEL=foo` is a
no-op. This matches the env-typo bug class flagged in M56's bonus
diagnosis (six leading-`i` typos silently no-op'd).

---

## 7. Phase 0 → Phase 1 handoff

### Proposed first PR: **`chore(data-pipeline): drop dead deep_research imports + extract endpoint Pydantic shapes`**

**Target file**: `services/data-pipeline/data_pipeline/main.py` (1 928
LOC → ~1 500 LOC after this PR).

**Why first**:
- Hits the user's #1 hypothesized hotspot.
- Self-contained: only edits one file plus creates one new
  `data_pipeline/api/__init__.py` + `data_pipeline/api/schemas.py`.
- Zero behavior change: the 11 unused imports are dead per ruff F401
  (§3); the Pydantic shapes are pure data classes with no side effects.
- Visible: removes one of the 12 lint hits in `data-pipeline` and
  shrinks the file by ~25 %.
- Low test risk: every endpoint integration test (21 test files in
  `services/data-pipeline/tests/`) imports `create_app()` and posts
  JSON — the move-and-re-export will be caught instantly by the
  request-shape tests.

**Exact change set** (estimated diff: ~350-450 LOC, well under 500):

1. **Remove lines 84-124** in `main.py` (the 11 dead `deep_research`
   imports + the unused `QueueDepthSnapshot`). Keep `QueueClient` and
   `build_queue_client` from the same `from data_pipeline.queue
   import` block.
2. **Create** `services/data-pipeline/data_pipeline/api/__init__.py`
   (empty).
3. **Create** `services/data-pipeline/data_pipeline/api/schemas.py`
   and move these 14 Pydantic classes from `main.py` (lines 739,
   983-1130) into it:
   - `SignalIngestScopeRequest`
   - `CrawlRunOut`
   - `HelloWorldTriggerBody`, `HelloWorldTriggerOut`
   - `CapabilityTriggerBody`, `CapabilityTriggerOut`
   - `ActorTriggerBody`, `ActorTriggerOut`
   - `SignalTriggerBody`, `SignalTriggerOut`
   - `RiskTriggerBody`, `RiskTriggerOut`
   - `OrchestratorCandidateOut`, `OrchestratorTickBody`,
     `OrchestratorTickOut`
   - `DigestRunBody`, `DigestRunOut`
   - `DiscoveryRunBody`, `DiscoveryRunOut`
4. **Re-import them** in `main.py` via `from data_pipeline.api.schemas
   import *` (or named imports if `*` is style-disallowed — repo uses
   ruff `F403` which forbids `*`, so named imports it is).
5. **Run** `cd services/data-pipeline && uv run ruff check
   data_pipeline` — should drop from 40 → 28 errors (12 F401 gone).

**Exit criteria** (verifiable):
- [ ] `cd services/data-pipeline && uv run ruff check data_pipeline`
      reports `Found 28 errors` (was 40), no new errors introduced.
- [ ] `cd services/data-pipeline && uv run pytest` passes (21 test
      files; baseline assumed green, NOT verified per task constraint).
- [ ] `wc -l services/data-pipeline/data_pipeline/main.py` returns a
      number in [1450, 1550].
- [ ] `git diff --stat` shows changes only in `main.py` and two new
      files under `data_pipeline/api/`.
- [ ] No change to `create_app()`'s route handlers or to
      `lifespan()` — the file shrinks purely by extraction, no
      semantic edits.

**Why not the "rename CLAUDE.md tier names to deep/balanced/fast"
PR first**: lower technical value, no LOC reduction, doc-only. Save it
for a docs-cleanup PR after the first three code PRs have landed and
the operator can grep for stale `opus|sonnet|haiku` references with
confidence.

**Why not "move workflows.py classes into per-domain files" first**:
fan-in 19 means **every test file in agent-orchestration** has to be
re-imported. High risk for a Phase-1 opener. Sequence that after the
`data-pipeline/main.py` cleanup proves the multi-file extraction
pattern works for this repo.

### Recommended Phase 1 PR sequence (after the first PR lands)

1. **(this proposal)** `data-pipeline/main.py` dead-import + schema
   extraction (~400 LOC diff).
2. `data-pipeline/main.py` extract one cron handler per file under
   `data_pipeline/jobs/` (~300 LOC diff, repeats for each of 7 jobs;
   could be one PR or seven).
3. `data-pipeline/admin/views.py` split 15 ModelViews into per-model
   files (low-risk, ~700 LOC moved).
4. **Sync CLAUDE.md tier-name section with reality** (~50 LOC diff,
   doc-only) — fix the "legacy env names still honoured" lie.
5. `agent_orchestration/workflows.py` extract `WorkflowRunner` +
   `Workflow` protocol to `runner.py` (~150 LOC moved, fan-in
   updates).
6. `agent_orchestration/workflows.py` split the 17 workflow classes
   along the (vision-builder | scoring | legacy) boundary.

Each PR should trace to a one-line problem statement (matching CLAUDE.md
"One PR per slice"). Expected total diff to bring the three hotspots
into shape: ~3 500 LOC moved, ~250 LOC deleted, zero behavior change.
