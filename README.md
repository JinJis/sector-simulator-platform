# Vision Feasibility Monitor

> Pick any bold technology vision (orbital data centers, fusion power,
> room-temperature superconductors). We track every capability it needs,
> every signal that moves it, and roll it up into one number you can
> glance at in 5 seconds.

For strategy / personas / business model see [DESIGN.md](./DESIGN.md). For
coding conventions see [CLAUDE.md](./CLAUDE.md). For active milestone
status see [docs/tasks/current.md](./docs/tasks/current.md).

**Status**: M36 + M37 ✅ shipped (2026-05-23). Active pivot M38 → M47.
Pre-pivot history in git log.

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
들어오는 **Signal** (arXiv 논문 / 특허 / 뉴스 / 정부 보고서)이 extractor
agent를 통과해 capability score delta로 변환. **FeasibilityIndex**가
Bayesian 집계 + Liebig binding constraint로 vision 단위 0-100 점수와 ETA
분포를 도출.

시뮬레이션은 부수 기능 — 사용자가 슬라이더로 산업을 이해하는 Playground.

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
      ├─ → simulation-service:8000 (Python, sim + feasibility math)
      ├─ → data-pipeline:8003 (Python, signal ingest + crons)
      └─ → agent-orchestration:8002 (Python, Vision Builder agents)
                  └─ Anthropic Claude (opus) + Google Gemini (sonnet/haiku)
                      via Vertex AI (same SA JSON)
```

Services + packages — see [CLAUDE.md "Repository Structure"](./CLAUDE.md#repository-structure).

---

## What works today

| | Status | Notes |
|---|---|---|
| `/visions` landing + Hero page | ✅ M37 | Fixture-backed SDC (9 capabilities + 5 risks + 8 signals + ETA window + trajectory + economics curve) |
| `/visions/[slug]` sub-nav | ✅ M37 | Overview / Capabilities / Signals / Risks / Economics / Playground / Sources |
| Playground (sliders) | ✅ M37 | Reuses existing sim infrastructure |
| Capability / Signal / Risk / Feasibility schema + tRPC | ✅ M36 | 6 new Prisma models, 5 routers, 20 tests |
| Onboarding + page tours | ✅ M37e | 3-step Vision intro; per-page tour content |
| Dual-provider LLM client | ✅ M35 | Claude opus + Gemini sonnet/haiku via Vertex AI |
| Capability manual seed (3 visions) | pending M38 | Real DB data on Hero |
| Actor domain | pending M45 | Companies + labs per capability — the WHO layer |
| Signal ingest (arXiv + USPTO + News) | pending M39 | + Signal Extractor agent (haiku) |
| Feasibility scoring engine | pending M40 | 4-dim aggregation + Liebig binding + ETA inference |
| Vision Builder agent | pending M41 | One-liner → full capability tree + actors |
| Fusion Power showcase | pending M44 | Second vision; 4-tile public landing |
| Community 2.0 (proposals + voting) | pending M46 | Replaces archived prediction game |

Investment surface (Equity / Prediction / Watchlist / Community) is
behind `ENABLE_LEGACY_INVESTMENT_FEATURES` flag (default false at M43).
Rows preserved; UI hidden. Reversible config flip.

---

## Common operations

### Trigger signal ingest manually (M39+)

```bash
curl -X POST http://localhost:8003/jobs/signal-ingest
curl  http://localhost:8003/jobs/signal-ingest/last  # health
```

### Recompute feasibility for one vision (M40+)

```bash
# tRPC procedure (admin)
curl -X POST 'http://localhost:8001/trpc/feasibility.recompute' \
  -H 'Content-Type: application/json' \
  -d '{"sector_slug":"space-data-center"}'
```

### Create a new vision (M41+)

Via admin UI: `http://localhost:3100/visions/new`. Submit a one-line
question; Vision Builder Conductor runs through Research / Decomposition
/ ScoringCode / CodeReview, then waits at the admin approval checkpoint.

### Apply Prisma migrations

```bash
pnpm db:migrate dev --name <slug>        # dev, will create migration
pnpm db:migrate:deploy                   # CI/prod, deploy committed migrations
pnpm db:studio                           # Prisma Studio
pnpm db:reset                            # wipe + reseed (dev only)
```

---

## Repository layout

See [CLAUDE.md "Repository Structure"](./CLAUDE.md#repository-structure).

---

## Compose modes

```bash
docker compose -f docker-compose.yml -f docker-compose.local.yml up --build  # full stack, hot reload
docker compose -f docker-compose.yml -f docker-compose.dev.yml up            # CI-like
docker compose -f docker-compose.yml -f docker-compose.prod.yml up           # prod (no hot reload)
```

Bring up only specific services: `docker compose ... up postgres sector-service`.

---

## References

- [docs/PIVOT.md](./docs/PIVOT.md) — strategic memo + extensions
- [docs/REFACTOR.md](./docs/REFACTOR.md) — file-by-file disposition
- [docs/tasks/current.md](./docs/tasks/current.md) — milestone status
- [docs/adr/](./docs/adr/) — Architectural Decision Records
- [CLAUDE.md](./CLAUDE.md) — operational context (read every session)
- [DESIGN.md](./DESIGN.md) — vision, personas, NFRs
- [prompts/](./prompts) — agent system prompts (versioned)
