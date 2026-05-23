# CLAUDE.md

매 세션 읽는 운영 컨텍스트. 짧고 actionable. 제품/전략은
[DESIGN.md](./DESIGN.md) + [docs/PIVOT.md](./docs/PIVOT.md), 현재 작업은
[docs/tasks/current.md](./docs/tasks/current.md), 파일별 refactor inventory는
[docs/REFACTOR.md](./docs/REFACTOR.md).

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
- **Risk / Actor / FeasibilityIndex** = 보조 도메인. PIVOT.md §3 참조.

---

## Current Phase

**Phase 3 — Vision Feasibility Monitor pivot (M36→M47)**. 2026-05-23
pivot from Sector Simulator + investment tools → single-page
Feasibility Monitor.

M36 + M37 ✅ shipped. 다음 PR sequence는 current.md 참조; 매 milestone
시작 전 PIVOT.md §5 entry → REFACTOR.md 관련 sections → §12 PR sequence
순서로 읽기.

Investment-side features (Equity / Prediction / Watchlist / Community)
archive behind `ENABLE_LEGACY_INVESTMENT_FEATURES` at M43. Sim
infrastructure stays — Playground sub-tab.

---

## Tech Stack

| Layer | Stack |
|---|---|
| Frontend (`apps/web`, `apps/admin`) | Next.js 15 (App Router, RSC), TS strict, shadcn/ui + Tailwind, Recharts, React Flow, TanStack Query, tRPC client |
| Backend Node (`services/sector-service`) | Fastify + tRPC, Prisma (Postgres), Zod, Node 20 |
| Backend Python (`services/{simulation,data-pipeline,agent-orchestration}-service`) | FastAPI, NumPy/Pandas/SciPy, PyMC (Monte Carlo), Pydantic v2, Python 3.12+ |
| Agent / LLM | Anthropic Claude (opus) + Google Gemini (sonnet/haiku), dual-provider via Vertex AI |
| Data | Postgres 16 + TimescaleDB ext + pgvector; Cloudflare R2 (artifacts); Redis (cache + pubsub) |
| Infra | Turborepo + pnpm; Vercel (frontend) / Railway or Fly.io (services) → AWS EKS later; Cloudflare; Terraform; GitHub Actions; Doppler / AWS Secrets Manager |
| Observability | LangSmith / Helicone (LLM cost + trace); Sentry; Grafana/Datadog (planned) |

### LLM auth + tier routing (M35)

- **Vertex AI** both providers, same service-account JSON at
  `infra/secrets/vertex-ai-sa.json`. Compose auto-injects env:
  `GOOGLE_GENAI_USE_VERTEXAI=true`,
  `GOOGLE_CLOUD_LOCATION=global` (default),
  `GOOGLE_APPLICATION_CREDENTIALS=/secrets/vertex-ai-sa.json`.
- Dev fallback (no GCP): `GEMINI_API_KEY` (AI Studio). opus calls fail in
  this mode.
- Tier map (`packages/agent-tools/llm_client.py`):
  - `opus` → `claude-opus-4-7` (critical reasoning — Decomposition /
    EdgeInference / CodeGen / CodeReview)
  - `sonnet` → `gemini-3.5-flash` (balanced — Research / DriverInference /
    ScoreUpdater / prediction.analyzeRationale)
  - `haiku` → `gemini-3.5-flash-lite` (extraction / routing / signal
    extractor)
- All agent output validated via Pydantic schema. Gemini uses native
  `response_schema`; Claude uses tool-use trick (forced `tool_choice`).
- `adaptive_thinking=True`:
  - Gemini: dynamic thinking budget (`-1`)
  - Claude: extended thinking; auto-dropped when `response_model` forces
    tool_choice (API constraint)
- Always call via `packages/agent-tools/llm-client` (cost meter built in).

---

## Repository Structure

```
apps/
├── web/                          Next.js, end users
├── admin/                        Admin console
└── docs/                         Documentation site (planned)
services/
├── sector-service/               Fastify + tRPC entry point
├── simulation-service/           Python sim runner + feasibility engine (M40)
├── data-pipeline/                Signal ingest + cron (M39)
├── agent-orchestration/          Vision Builder + extractor/updater agents
└── report-service/               (planned) PDF/Notion export
packages/
├── sdk-python/                   SimulationBase, Driver, Output
├── sdk-ts/                       Frontend SDK
├── ui/                           Shared shadcn components + hero components (M37)
├── shared-types/                 tRPC + Zod
├── agent-tools/                  Dual-provider LLMClient + MCP tools
└── db/                           Prisma schema + seeds
infra/{terraform,k8s,docker,secrets,seeds}/
prompts/                          Agent system prompts (versioned)
tests/{integration,e2e,agent-evals}/
docs/{adr,tasks}/                 + PIVOT.md + REFACTOR.md
```

---

## Setup & Commands

```bash
# Initial
pnpm install
cp .env.example .env                     # see infra/secrets/README.md
pnpm db:migrate dev                      # Prisma migrations
pnpm seed                                # 3 seed sectors

# Dev
pnpm dev                                 # all services (turbo)
pnpm dev --filter web                    # single app
docker compose -f docker-compose.yml -f docker-compose.local.yml up --build

# Tests
pnpm test                                # all unit
pnpm test --filter <pkg>
pnpm test:integration
pnpm test:e2e                            # Playwright
pnpm test:agent-evals                    # M41+

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
- Agent evals: `tests/agent-evals/<agent>/cases.yaml`
- Coverage targets: services 70% / apps 50%

### LLM calls
- Always via `packages/agent-tools/llm-client`
- Choose tier explicitly (`opus | sonnet | haiku`)
- Pydantic `response_model` for structured output
- `adaptive_thinking=True` only when worth it (opt-in)

---

## Common Tasks

### New Vision (M41+)
1. Admin enters one-line vision at `/admin/visions/new`
2. Vision Builder Conductor runs (Research → Decomposition →
   CapabilityScoringCode → CodeReview → checkpoint → KeywordExpander)
3. Admin reviews capability + risk + actor drafts
4. Approve → live at `/visions/<slug>`

### New sim (pre-M41 / manual)
1. `services/simulation-service/sims/<slug>.py` extends `SimulationBase`
2. `pnpm db:migrate dev --name add-<sector>-data`
3. Seed in `infra/seeds/<sector>.sql`
4. Integration test in `tests/integration/sims/<sector>.test.ts`
5. Verify `pnpm typecheck && pnpm test`

### New signal adapter (M39+)
1. `services/data-pipeline/data_pipeline/signals/<name>.py` implementing
   `SignalSource` Protocol
2. Per-vision keyword set in `signals/keywords/<slug>.json`
3. Register in `signal_ingest.py` cron
4. Health-check endpoint
5. Test with mocked HTTP (vcr or aioresponses)

### New tRPC procedure
1. Implement in `services/sector-service/src/trpc/<router>.ts`
2. Wire in `router.ts`
3. Vitest integration in `services/sector-service/tests/<router>.test.ts`
4. Wrapper in `apps/web/src/lib/<domain>-client.ts` if user-app reads

### New UI component
1. Build in `packages/ui/src/`
2. Add subpath export to `packages/ui/package.json`
3. Re-export from `index.ts`
4. Use from apps

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
- Comments / internal docs: 혼용 OK

---

## Decision Log (ADR)

Non-trivial decisions → `docs/adr/`. Format `ADR-NNN-short-title.md` with
status / context / decision / consequences. PR description links the ADR.

## Open Questions

1. `DESIGN.md` §9 risks (above) — first surface
2. `docs/tasks/current.md` acceptance criteria — second
3. Still ambiguous → ADR draft, ask admin; do not block code on this —
   isolate to branch and progress other tasks

## References

- [DESIGN.md](./DESIGN.md) — vision, personas, features, NFRs
- [docs/PIVOT.md](./docs/PIVOT.md) — strategic pivot memo
- [docs/REFACTOR.md](./docs/REFACTOR.md) — file-by-file refactor inventory
- [docs/tasks/current.md](./docs/tasks/current.md) — live milestone status
- [docs/adr/](./docs/adr/) — ADRs
- [prompts/](./prompts) — agent system prompts (versioned)
- [packages/sdk-python/README.md](./packages/sdk-python/README.md) — Simulation SDK
- [packages/agent-tools/README.md](./packages/agent-tools/README.md) — MCP tool authoring
