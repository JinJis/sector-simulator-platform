# CLAUDE.md

매 세션 읽는 운영 컨텍스트. 짧고 actionable. 제품/전략은
[DESIGN.md](./DESIGN.md), 현재 작업은
[docs/tasks/current.md](./docs/tasks/current.md), Phase 4 데이터
파이프라인 알고리즘 설계는
[docs/architecture/composition.md](./docs/architecture/composition.md).

---

## Behavioral guidelines

Tradeoff: bias toward caution over speed. For trivial tasks, use judgment.

### Think before coding
- State assumptions explicitly. If uncertain, ask.
- Multiple interpretations? Present them — don't pick silently.
- A simpler approach exists? Say so. Push back when warranted.
- Unclear? Stop, name what's confusing, ask.

### Simplicity first
- Minimum code that solves the problem. Nothing speculative.
- No features beyond the ask. No abstractions for single-use code.
- No "flexibility" / "configurability" that wasn't requested.
- No error handling for impossible scenarios.
- "Would a senior engineer call this overcomplicated?" If yes, rewrite.

### Surgical changes
- Touch only what the task requires. Don't "improve" adjacent code.
- Don't refactor things that aren't broken. Match existing style.
- Remove only the orphans **your** changes created (unused imports /
  vars / functions). Don't delete pre-existing dead code unless asked.
- Notice unrelated dead code → mention it, don't touch it.
- Test: every changed line traces directly to the user's request.

### Goal-driven execution
- Turn the task into a verifiable goal before starting.
  - "Add validation" → "Write tests for invalid inputs, make them pass."
  - "Fix the bug" → "Write a test that reproduces it, then make it pass."
  - "Refactor X" → "Ensure tests pass before and after."
- Multi-step → state a brief plan with one `verify:` check per step,
  then loop until verified.

### Before every commit — MD review

Read every MD file your change touches *or* that documents an area you
touched. Three questions:
1. Still accurate?
2. Simpler than it needs to be? Trim — but never drop the core.
3. Cross-references still resolve?

Important MD files (review when in scope):
- `CLAUDE.md`, `README.md`, `DESIGN.md`
- `docs/tasks/current.md`, `docs/architecture/composition.md`,
  `docs/agent-capabilities.md`, `docs/adr/*.md`
- `packages/*/README.md`, `prompts/README.md`,
  `infra/secrets/README.md`, `tests/agent_evals/README.md`
- Archived (read only when historical context matters):
  `docs/archive/pivot.md`, `docs/archive/refactor.md`

Bloat to watch for: status repeated in many places (canonical = `current.md`,
others link), restating what the code already says, historical PR
sequences in more than one file, growing tables when a paragraph would do.

These guidelines are working if: fewer unnecessary diffs, fewer rewrites
from overcomplication, clarifying questions arrive *before* implementation.

---

## Mission

> Pick any bold technology vision. We track every capability it needs,
> every signal that moves it, and roll it up into one number you can
> glance at in 5 seconds.

핵심 abstractions:
- **Vision** = 1 row in `Sector` table with `is_vision_eligible=true`
  (DB column name preserved through pivot).
- **Capability** = 비전을 구성하는 기술/경제/규제/공급 요건 (4-dim score).
- **Signal** = 매일 들어오는 source-grounded 이벤트 (arXiv / 특허 / 뉴스 /
  공시). Extractor 에이전트가 capability score delta로 변환.
- **Actor** = capability를 끌어가는 회사 / 연구소 / 정부 기관.
- **Risk / FeasibilityIndex** = 보조 도메인 — risk 카탈로그 + Bayesian
  rollup. (Phase 3 archive: `docs/archive/pivot.md §3` for original framing.)

---

## Current Phase

**Phase 4 (real-time intelligence) — steady state. M55 admin reset
in progress.** Phase 4 originally shipped M48–M54: crawler service,
6 per-surface fetchers, bot proposals, Live Pulse UX, an
`apps/admin/` Next.js cockpit, vision visualizations, and 4 seeded
visions. Those landed and the data path works.

What changed in M55: the `apps/admin/` console got tangled
(login + tRPC + 14 hand-rolled pages, drift between trigger UIs and
the actual fetcher contracts), so we **deleted it and moved the
admin surface into SQLAdmin** mounted at `data-pipeline:8003/admin`:

- 14 read-only model views (Sector, Capability, Signal, Risk,
  Actor, CrawlRun, CommunityProposal, AuditLog, …)
- 8 row actions (trigger the 6 fetchers + approve/reject proposal)
- a custom **Queue + Crons** page (ARQ depth + APScheduler
  pause/resume/run-now)
- a custom **Vision Builder** wizard (prompt → review → commit,
  forwarding to the same sector-service tRPC that powered the
  React form)

Side effects: `apps/admin/` deleted, `services/sector-service/src/
trpc/crawler.ts` deleted (its only consumer was apps/admin), port
3100 freed. The historical M48–M54 milestone log lives in git;
[docs/tasks/current.md](./docs/tasks/current.md) is now M55-focused.

What didn't change: data pipeline (data-pipeline + agent-
orchestration), Prisma schema, scoring engine, public web app at
`/visions`, all the tier routing in
[docs/architecture/composition.md](./docs/architecture/composition.md).
Phase 3 context lives in
[docs/archive/pivot.md](./docs/archive/pivot.md).

매 변경 시작 전: composition.md 관련 §-section → current.md → 한
슬라이스 = 한 PR.

---

## Tech Stack

| Layer | Stack |
|---|---|
| Frontend (`apps/web`) | Next.js 15 (App Router, RSC), TS strict, shadcn/ui + Tailwind, Recharts, React Flow, TanStack Query, tRPC client. Admin surface is SQLAdmin (Tabler) at `data-pipeline:8003/admin` — see M55 in current.md. |
| Backend Node (`services/sector-service`) | Fastify + tRPC, Prisma (Postgres), Zod, Node 20 |
| Backend Python (`services/{simulation,data-pipeline,agent-orchestration}-service`) | FastAPI, NumPy/Pandas/SciPy, PyMC (Monte Carlo), Pydantic v2, Python 3.12+ |
| Agent / LLM | Anthropic Claude (opus) + Google Gemini (sonnet/haiku), dual-provider via Vertex AI |
| Data | Postgres 16 + TimescaleDB ext + pgvector; Cloudflare R2 (artifacts); Redis (cache + pubsub) |
| Infra | Turborepo + pnpm; Vercel (frontend) / Railway or Fly.io (services) → AWS EKS later; Cloudflare; Terraform; GitHub Actions; Doppler / AWS Secrets Manager |
| Observability | LangSmith / Helicone (LLM cost + trace); Sentry; Grafana/Datadog (planned) |
| i18n / theme (web) | Cookie-backed `tssp_locale` (ko default, en parity) + `tssp_theme` (dark default, light + system). Server reads via `getT()`; client via `useT()` / `useTheme()`. Inline boot script avoids FOUC. User table mirrors both columns for cross-device sync. |

### LLM auth + tier routing (M35 + grounded-research overhaul)

- **Vertex AI** both providers, same service-account JSON at
  `infra/secrets/vertex-ai-sa.json`. Compose auto-injects env:
  `GOOGLE_GENAI_USE_VERTEXAI=true`,
  `GOOGLE_CLOUD_LOCATION=global` (default),
  `GOOGLE_APPLICATION_CREDENTIALS=/secrets/vertex-ai-sa.json`.
- AI Studio fallback: `GEMINI_API_KEY`. Works for both the gemini-*
  agents AND grounded research; opus-tier (Claude) calls still need
  Vertex.
- **Agent tier map** (`packages/agent-tools/llm_client.py`) — env-overridable
  via `LLM_{OPUS,SONNET,HAIKU}_MODEL`:
  - `opus` → `claude-opus-4-7` (critical reasoning — VisionDecomposition /
    CapabilityDependencies / CapabilityScoringCode / CodeReview)
  - `sonnet` → `gemini-3.5-flash` (balanced — VisionResearch /
    DataSourceSelector / ScoreUpdater / prediction.analyzeRationale)
  - `haiku` → `gemini-3.5-flash-lite` (extraction / routing /
    SignalExtractor / PromptValidator)
- **Grounded research tier map**
  (`packages/agent-tools/grounded_research.py`) — replaces the deprecated
  Vertex Deep Research preview models. `models.generate_content` +
  `Tool(google_search=GoogleSearch())` for grounding + citations. Env
  override via `GROUNDED_MODEL_{FAST,DEEP}`:
  - `fast` → `gemini-2.5-flash` (capability / actor / risk / signal
    fetchers — low ThinkingConfig)
  - `deep` → `gemini-3.1-pro-preview` (daily digest — HIGH ThinkingConfig)
  - `max` is accepted as a back-compat alias for `deep`.
- All agent output validated via Pydantic schema. Gemini uses native
  `response_schema`; Claude uses tool-use trick (forced `tool_choice`).
- `adaptive_thinking=True`:
  - Gemini: dynamic thinking budget (`-1`)
  - Claude: extended thinking; auto-dropped when `response_model` forces
    tool_choice (API constraint)
- Always call via `packages/agent-tools/llm-client` (agent tiers) or
  `GroundedResearchClient` (research tiers). Both share `CostMeter`.

---

## Repository Structure

```
apps/
└── web/                          Next.js, end users → /visions
services/
├── sector-service/               Fastify + tRPC entry point
├── simulation-service/           Python sim runner + feasibility engine
├── data-pipeline/                Signal ingest (arXiv / USPTO / crawl4ai Yahoo+Naver+Finviz) + crons + grounded research + SQLAdmin at /admin (M55)
└── agent-orchestration/          Vision Builder Conductor + extractor / updater agents
packages/
├── sdk-python/                   SimulationBase, Driver, Output
├── sdk-ts/                       Frontend SDK
├── ui/                           Shared shadcn + Hero components (FeasibilityGauge / CapabilityCard / ActorCard / SignalRow / ...)
├── shared-types/                 tRPC + Zod
├── agent-tools/                  Dual-provider LLMClient + MCP tools
└── db/                           Prisma schema + seeds
infra/{terraform,k8s,docker,secrets,seeds}/
prompts/                          Agent system prompts (versioned, see prompts/README.md)
tests/{integration,e2e,agent_evals}/
docs/{adr,architecture,tasks,archive}/   + agent-capabilities.md
```

---

## Setup & Commands

```bash
# Initial
pnpm install
cp .env.example .env                     # see infra/secrets/README.md
pnpm db:migrate dev                      # Prisma migrations
pnpm db:seed:all                         # sectors → visions → actors → signals (full demo chain)
# or piecemeal:
pnpm db:seed                             # sectors only
pnpm db:seed:signals                     # ~80 source-grounded signals (real arxiv / press / SEC URLs)

# Dev
pnpm dev                                 # all services (turbo)
pnpm dev --filter web                    # single app
docker compose -f docker-compose.yml -f docker-compose.local.yml up --build

# Tests
pnpm test                                # all unit
pnpm test --filter <pkg>
pnpm test:integration
pnpm test:e2e                            # Playwright
pnpm test:agent-evals                    # offline by default; GEMINI_EVAL_LIVE=1 for live

# Quality gates (must pass before merge)
pnpm typecheck                           # tsc + mypy
pnpm lint                                # ESLint + Ruff
pnpm format:check                        # Prettier + Ruff
pnpm test

# Build / deploy
pnpm build
pnpm deploy:preview                      # PR preview
pnpm deploy:prod                         # main merge → GitHub Actions
```

---

## Conventions

### TypeScript
- `strict: true`, no `any` (use `unknown` + type guards)
- Named exports preferred
- Components `PascalCase`, hooks `useThing`, utils `camelCase`
- Path alias: `@/*`, `@platform/*`
- New shared components → `packages/ui` first

### Python
- 3.12+, type hints required
- Pydantic v2 for all I/O
- Ruff lint + format (`pyproject.toml`)
- pytest, async by default

### Database (Prisma)
- Schema is source of truth
- One migration per PR; **never edit historical migrations**
- Columns `snake_case`, tables plural (`sectors`, `capabilities`)
- Tenant-scoped tables → RLS (M30, deferred)

### Git
- Conventional Commits: `feat`, `fix`, `chore`, `docs`, `refactor`
- Branches: `feat/<short-desc>` / `fix/<short-desc>`
- PR template: changes / test plan / UI screenshots

### Tests
- Unit: beside source (`foo.ts` + `foo.test.ts`)
- Integration: `tests/integration/`
- E2E: Playwright in `tests/e2e/`
- Agent evals: `tests/agent_evals/<workflow>/cases.py` (underscore dir)
- Coverage targets: services 70% / apps 50%

### LLM calls
- Always via `packages/agent-tools/llm-client`
- Choose tier explicitly (`opus | sonnet | haiku`)
- Pydantic `response_model` for structured output
- `adaptive_thinking=True` only when worth it (opt-in)

---

## Common Tasks

### New Vision (M41 conductor + M55 SQLAdmin wizard)
1. Admin opens `data-pipeline:8003/admin` → sidebar **Vision Builder**,
   types a one-line question
2. SQLAdmin POSTs to sector-service `visionBuilder.propose` tRPC →
   Conductor runs PromptValidator (haiku) → VisionResearch (sonnet) →
   VisionDecomposition (opus) → DataSourceSelector (sonnet) →
   ValidationGate (DAG + FK + weight-sum checks)
3. Admin reviews the draft summary (capabilities / risks / actors)
4. Commit → sector-service `visionBuilder.commit` writes everything in
   one Prisma transaction → redirects to `/admin/sector/list?search=<slug>`

### New sim (manual, edge case)
1. `services/simulation-service/simulation_service/sims/<slug>.py`
   extends `SimulationBase`
2. `pnpm db:migrate dev --name add-<slug>`
3. Seed in `packages/db/prisma/seed.ts` (and capability seed if vision-eligible)
4. Integration test in `tests/integration/sims/<slug>.test.ts`
5. Verify `pnpm typecheck && pnpm test`

### New signal adapter (M39 baseline)
1. `services/data-pipeline/data_pipeline/signals/<name>.py` implementing
   the `SignalSource` Protocol
2. Per-vision keyword set in `signals/keywords/<slug>.json`
3. Register in `signal_ingest` job
4. Health endpoint exposed via the data-pipeline FastAPI app
5. Test with mocked HTTP (vcr or aioresponses)

### New tRPC procedure
1. Implement in `services/sector-service/src/trpc/<router>.ts`
2. Wire in `router.ts`
3. Vitest integration in `services/sector-service/tests/<router>.test.ts`
4. Wrapper in `apps/web/src/lib/<domain>-client.ts` if user-app reads

### New UI component
1. Build in `packages/ui/src/`
2. Add subpath export to `packages/ui/package.json`
3. Re-export from `src/index.ts`
4. Use from apps via `@platform/ui` or `@platform/ui/<component>`

### New user-facing string
1. Add ko + en pair in `apps/web/src/lib/i18n/dict.ts`
2. Client: `const t = useT();` then `t("namespace.key")`
3. Server (RSC): `const t = await getT();` (reads cookie)
4. Korean tone goes natural-friendly 존댓말, not 번역체

---

## Important Notes

### Cost
LLM is biggest cost driver. Apply:
1. Prompt caching (system prompt + tool defs)
2. Result caching (`hash(sector_id, code_version, drivers_dict)`)
3. Model routing (haiku first, escalate only when needed)
4. Batch API for non-realtime
Target: per-user month LLM cost < $30 (Pro plan goal $20-$30/mo).

### Security (non-negotiable)
- LLM-generated code runs ONLY in sandbox (Modal/E2B — pending M28b)
- Sandbox network: whitelist only
- Secrets via Doppler / AWS Secrets Manager — never repo. SA JSON
  gitignored at `infra/secrets/vertex-ai-sa.json`
- All admin actions → audit log

### Determinism
- Simulations must be deterministic (caching invariant)
- Fixed seed when stochastic needed
- Cache key: `hash(sector_id, code_version, drivers_dict, data_snapshot_id)`

### Long-running work
- 30s+ work → Temporal workflow (post-M47)
- Frontend → tRPC subscription for progress streaming

### Multi-tenant (M30, deferred)
- All queries `tenant_id` scoped (Prisma middleware)
- Postgres RLS as 2nd defense

### Provenance
- Every data point: `source_url` + `timestamp` + `confidence`
- LLM cannot fabricate numbers → schema enforces `source_ref` on drafts

### 한국어 / English
- Code / variables / commits / ADR: **English**
- User-facing UI text: i18n (ko/en parity; ko default)
- Translation registry: `apps/web/src/lib/i18n/dict.ts` — all visible
  strings go here as `{ ko, en }` pairs. Tone in both languages: friendly,
  not formal-translation-ese.
- Comments / internal docs: 혼용 OK

---

## Decision Log (ADR)

Non-trivial decisions → `docs/adr/`. Format `ADR-NNN-short-title.md` with
status / context / decision / consequences. PR description links the ADR.

Current ADRs:
- [ADR-0001](./docs/adr/0001-pivot-vision-monitor.md) — Pivot to Vision
  Feasibility Monitor (accepted, 2026-05-23)

## Open Questions

1. `DESIGN.md` §9 risks — first surface
2. `docs/tasks/current.md` acceptance criteria — second
3. Still ambiguous → ADR draft, ask admin; do not block code on this —
   isolate to branch and progress other tasks

## References

- [DESIGN.md](./DESIGN.md) — vision, personas, features, NFRs
- [docs/tasks/current.md](./docs/tasks/current.md) — live milestone status
- [docs/architecture/composition.md](./docs/architecture/composition.md) —
  Phase 4 data-pipeline + fetcher + bot + UX ground-truth
- [docs/adr/](./docs/adr/) — ADRs
- [docs/agent-capabilities.md](./docs/agent-capabilities.md) — agent / workflow inventory
- [docs/archive/](./docs/archive/) — historical Phase 3 memos (pivot, refactor inventory)
- [prompts/](./prompts) — agent system prompts (versioned)
- [packages/sdk-python/README.md](./packages/sdk-python/README.md) — Simulation SDK
- [packages/agent-tools/README.md](./packages/agent-tools/README.md) — MCP tool authoring
- [packages/ui/README.md](./packages/ui/README.md) — Shared UI components
