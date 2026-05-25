# Vision Feasibility Monitor

> Pick any bold technology vision (orbital data centers, fusion power,
> room-temperature superconductors). We track every capability it needs,
> every signal that moves it, and roll it up into one number you can
> glance at in 5 seconds.

For strategy / personas / business model see [DESIGN.md](./DESIGN.md). For
coding conventions see [CLAUDE.md](./CLAUDE.md). For active milestone
status see [docs/tasks/current.md](./docs/tasks/current.md).

**Status** (2026-05-25): M36 → M43 + M45a/b + M46a/b/c ✅ shipped.
Polish slices in: i18n (ko/en), theme switcher (dark/light/system), wider
layouts, multi-step wizards, legacy-route cleanup. Active next: **M44**
(Fusion Power second showcase + 4-tile public landing + Twitter demo)
and the M46 d/e/f sub-slices (Evidence sources / Admin queue /
Per-sector tab). Pre-pivot history (M1-M35) lives in git log.

---

## Problem

기술 실현 가능성에 대한 답이 흩어져 있다:

1. **분석 리포트는 즉시 노후화** — Gartner Hype Cycle, MIT Tech Review
   10 Breakthrough Technologies: 분기/연 단위 PDF.
2. **블랙박스** — "AI 메모리 폭증" 결론은 있지만 인과 구조 + 가정 + 출처가
   불투명.
3. **수정 불가** — "발사 비용이 50% 더 떨어지면?" 같은 what-if를 즉시
   테스트할 수 없음.
4. **확장 불가** — 새 비전 (우주 데이터센터 / 핵융합 / BCI) 분석에 매번
   수개월 전문가 리서치.

## Solution

각 Vision은 ~10개의 **Capability** (기술 / 경제 / 규제 / 공급)로 분해. 매일
들어오는 **Signal** (arXiv 논문 / 특허 / 뉴스 / 정부 보고서)이 SignalExtractor
agent를 통과해 capability score delta로 변환되고, ScoreUpdater agent가
4-차원 점수에 반영. **FeasibilityIndex**가 Bayesian 집계 + Liebig binding
constraint로 vision 단위 0-100 점수와 ETA 분포를 도출. **Actor** layer
(M45)가 각 capability를 끌어가는 회사 · 연구소 · 정부 기관을 추적.

시뮬레이션은 부수 기능 — 사용자가 슬라이더로 산업을 이해하는 Playground
(M42에서 driver→capability 배지 + WhatIfFeasibility callout 추가).

---

## Quickstart

```bash
# Prerequisites: Node 20+, pnpm 9+, Python 3.12+, uv, Docker
pnpm install
cp .env.example .env

# Optional: drop Vertex AI service-account JSON at
# infra/secrets/vertex-ai-sa.json for LLM features. See
# infra/secrets/README.md. Without it, agent calls return a clear error
# and the AI features hide.

# Full stack with hot reload
docker compose -f docker-compose.yml -f docker-compose.local.yml up --build

# Or: run individual services from host
pnpm db:migrate dev
pnpm seed
pnpm dev                                # all apps + services via Turbo
```

Open `http://localhost:3000` (user app — auto-redirects to `/visions`),
`http://localhost:3100` (admin console).

### Run a single milestone PR locally

```bash
# Typecheck + tests for active service
pnpm --filter @platform/sector-service typecheck
pnpm --filter @platform/sector-service test

# Web app build (catches RSC issues)
pnpm --filter @platform/web build
```

---

## Architecture (current)

```
Browser
  → Vercel Edge (Next.js apps/web → /visions)
  → /api/sim/trpc/* (Next rewrite)
  → sector-service:8001 (Fastify + tRPC)
      ├─ Prisma → Postgres 16 + TimescaleDB + pgvector
      ├─ → simulation-service:8000 (Python, sim + feasibility engine)
      ├─ → data-pipeline:8003 (Python, signal ingest + crons)
      └─ → agent-orchestration:8002 (Python, Vision Builder + extractor/updater)
                  └─ Anthropic Claude (opus) + Google Gemini (sonnet/haiku)
                      via Vertex AI (same SA JSON)
```

Services + packages — see [CLAUDE.md "Repository Structure"](./CLAUDE.md#repository-structure).

---

## What works today

| | Status | Notes |
|---|---|---|
| `/visions` landing + Hero | ✅ M37 + visual-hub revamp | Vision cards with domain themes + filter chips |
| `/visions/[slug]` sub-nav | ✅ M37 → M40 | Overview / Capabilities / Actors / Signals / Risks / Economics / Playground / Sources — DB-backed |
| Playground (sliders + WhatIfFeasibility callout) | ✅ M37 → M42 | Driver→capability badges + live Feasibility preview above sim chart |
| Capability / Signal / Risk / Feasibility schema + tRPC | ✅ M36 | 6 Prisma models, 5 routers |
| Capability / Risk / Feasibility manual seed (3 visions) | ✅ M38 | space-data-center, memory-semi, sofc curated |
| Actor domain + Hero band + capability footer | ✅ M45a/b | Schema, fixtures, then DB swap; signal extractor tags `actor_id` |
| Signal ingest (arXiv + USPTO + NewsAPI) | ✅ M39 | + SignalExtractor (haiku) + Signals tab + monitoring health card |
| Feasibility scoring engine | ✅ M40 | 4-dim aggregation + Liebig binding + ETA inference + daily recompute cron |
| Vision Builder agent (one-liner → full tree) | ✅ M41 | PromptValidator → Research → VisionDecomposition → DataSourceSelector → ValidationGate → admin commit |
| Investment surface archived behind flag | ✅ M43 | `ENABLE_LEGACY_INVESTMENT_FEATURES=false` (default); crons off; routes 410 |
| Community 3.0 — proposals + tiered predictions + reputation | ✅ M46a-c | Proposal schema + feed, PredictionV2 + leaderboard, Reputation + Follow + `/u/[id]` |
| Multi-step proposal + prediction wizards | ✅ slice | 5-step proposal · 3-step prediction with live tier preview |
| i18n (ko/en) + theme switcher + bilingual UI | ✅ slice | Cookie-backed, mirrored on `User.locale` / `User.theme`; friendly tone in both |
| Fusion Power second showcase + 4-tile landing | pending M44 | Pressure-tests the framework on a second vision |
| Evidence URL OG fetch + R2 upload | pending M46d | |
| Admin proposal queue + 1-click apply | pending M46e | |
| Per-sector community tab + cold-start seed | pending M46f | |
| Discussions + reputation polish | pending M47 | Gated on M46 production data (~4 weeks post-M46f) |

Investment surface (Equity / Prediction-v1 / Watchlist / sector
suggestion / pre-pivot community) is behind
`ENABLE_LEGACY_INVESTMENT_FEATURES` (default false at M43). Tables
preserved; routes 410 when flag off. Reversible config flip.

---

## Common operations

### Trigger signal ingest manually

```bash
curl -X POST http://localhost:8003/jobs/signal-ingest
curl     http://localhost:8003/jobs/signal-ingest/last   # last-run health
```

### Recompute feasibility for one vision

```bash
# tRPC procedure (admin)
curl -X POST 'http://localhost:8001/trpc/feasibility.recompute' \
  -H 'Content-Type: application/json' \
  -d '{"sector_slug":"space-data-center"}'
```

### Create a new vision

Via admin UI: `http://localhost:3100/visions/new`. Submit a one-line
question. The Vision Builder Conductor runs:

```
PromptValidator (haiku)
  → VisionResearch (sonnet)
  → VisionDecomposition (opus)
  → DataSourceSelector (sonnet)
  → ValidationGate (DAG + FK + weight-sum checks)
  → admin checkpoint
  → tRPC commit (single Prisma transaction)
```

Eval set (`tests/agent_evals/`): 5 canonical visions — SDC, fusion,
quantum, humanoid, mRNA. Offline by default;
`GEMINI_EVAL_LIVE=1 pnpm test:agent-evals` for live API.

### Apply Prisma migrations

```bash
pnpm db:migrate dev --name <slug>        # dev, will create migration
pnpm db:migrate:deploy                   # CI/prod, deploy committed migrations
pnpm db:studio                           # Prisma Studio
pnpm db:reset                            # wipe + reseed (dev only)
```

After M40 the seed chain runs:
`migrate → seed (3 sectors) → seed:capabilities → seed:risks →
seed:feasibility → seed:actors → seed:capability-actors`.

---

## Repository layout

See [CLAUDE.md "Repository Structure"](./CLAUDE.md#repository-structure).

---

## Compose modes

```bash
docker compose -f docker-compose.yml -f docker-compose.local.yml up --build  # full stack, hot reload
docker compose -f docker-compose.yml -f docker-compose.dev.yml   up          # CI-like
docker compose -f docker-compose.yml -f docker-compose.prod.yml  up          # prod (no hot reload)
```

Bring up only specific services:
`docker compose ... up postgres sector-service`.

---

## References

- [docs/PIVOT.md](./docs/PIVOT.md) — strategic memo + milestone outline
- [docs/REFACTOR.md](./docs/REFACTOR.md) — file-by-file disposition
- [docs/tasks/current.md](./docs/tasks/current.md) — live milestone status
- [docs/adr/](./docs/adr/) — Architectural Decision Records
- [docs/agent-capabilities.md](./docs/agent-capabilities.md) — agent / workflow inventory
- [CLAUDE.md](./CLAUDE.md) — operational context (read every session)
- [DESIGN.md](./DESIGN.md) — vision, personas, NFRs
- [prompts/](./prompts) — agent system prompts (versioned)
