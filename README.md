# Vision Feasibility Monitor

> Pick any bold technology vision (orbital data centers, fusion power,
> room-temperature superconductors). We track every capability it needs,
> every signal that moves it, and roll it up into one number you can
> glance at in 5 seconds.

For strategy / personas / business model see [DESIGN.md](./DESIGN.md). For
coding conventions see [CLAUDE.md](./CLAUDE.md). For active milestone
status see [docs/tasks/current.md](./docs/tasks/current.md). For the
Phase 4 data-pipeline / fetcher / bot / UX design ground-truth see
[docs/architecture/composition.md](./docs/architecture/composition.md).

**Now** (Phase 4 — Real-time Intelligence): building a continuous-ingest
crawler service (Docker) with per-surface fetchers + Gemini Deep
Research, a `@feasibility_bot` user that auto-proposes newly-discovered
actors / capabilities / risks for community voting, a transparent
"Live Pulse" UX that makes the source → judgment → score flow legible
on every vision page, an admin crawler cockpit, a richer visualization
pack, and a full data seed across 4 visions. Phase 3 (the Sector
Simulator → Vision Feasibility Monitor pivot) is shipped — see git log
or [docs/archive/pivot.md](./docs/archive/pivot.md) for history.

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

각 Vision은 ~10개의 **Capability** (기술 / 경제 / 규제 / 공급)로 분해.
**크롤러 서비스**가 arXiv / 특허 / 뉴스 / 정부 / Gemini Deep Research를
계속 흡수해서 **Signal** 로 떨어뜨리고, SignalExtractor agent가 capability
score delta로 변환, ScoreUpdater agent가 4-차원 점수에 반영. **FeasibilityIndex**
가 Bayesian 집계 + Liebig binding constraint로 vision 단위 0-100 점수와 ETA
분포를 도출. **Actor** layer가 각 capability를 끌어가는 회사 · 연구소 ·
정부 기관을 추적. 새로 발견된 entity는 **`@feasibility_bot`** 이 직접
`CommunityProposal` 을 띄워 유저 투표로 큐레이션.

시뮬레이션은 부수 기능 — 사용자가 슬라이더로 산업을 이해하는 Playground
(driver→capability 배지 + WhatIfFeasibility callout).

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

Open `http://localhost:3000` (user app — auto-redirects to `/visions`)
or `http://localhost:8003/admin` (SQLAdmin — login with `ADMIN_EMAIL`
+ `ADMIN_PASSWORD` from `.env`).

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
                  └─ Google Gemini (deep / balanced / fast tiers)
                      via Vertex AI single SA JSON (F9 — Gemini-only)
```

Services + packages — see [CLAUDE.md "Repository Structure"](./CLAUDE.md#repository-structure).

---

## What works today

Grouped by surface; live milestone status lives only in
[docs/tasks/current.md](./docs/tasks/current.md).

**Vision pages** — `/visions` landing with domain themes + filter chips;
`/visions/[slug]` 8-tab layout (Overview / Capabilities / Actors /
Signals / Risks / Economics / Playground / Sources), DB-backed. Hero
shows feasibility score · ETA window · capability bands · actor band.

**Scoring pipeline** — 6 Prisma models for Capability / Signal / Risk /
VisionFeasibility / Actor / CapabilityActor. 4-dim aggregation per
capability + Liebig binding rollup + ETA inference; daily recompute
cron. Signal ingest covers arXiv + USPTO + NewsAPI, fed through a
SignalExtractor (fast) and ScoreUpdater (balanced); Signals tab + admin
health card included.

**Vision Builder agent** — admin types a one-line question →
PromptValidator → VisionResearch → VisionDecomposition →
DataSourceSelector → ValidationGate (DAG + FK + weight-sum checks) →
single-Prisma-transaction commit. 5-vision eval set in
`tests/agent_evals/`.

**Playground** — sliders + WhatIfFeasibility callout + driver→capability
badges; client-side Liebig aggregator mirrors the simulation service.

**Community** — 3-kind community surface: `CommunityProposal` (7
`target_kind`s, voting feed, admin queue), tiered `PredictionV2`
(Easy/Medium/Hard auto-assigned from horizon × spread × volatility,
resolution cron, leaderboard), `UserReputation` tiers + follow graph +
`/u/[id]` profile pages. Multi-step proposal (5-step) + prediction
(3-step) wizards.

**i18n + theme** — ko default + en parity; dark default + light + system;
cookie-backed (`tssp_locale` / `tssp_theme`) and mirrored on
`User.locale` / `User.theme` for cross-device sync.

**Legacy investment surface** — Equity / Prediction-v1 / Watchlist /
sector suggestion / pre-pivot community gated by
`ENABLE_LEGACY_INVESTMENT_FEATURES` (default false). Tables preserved;
routes 410 when flag off. Reversible config flip.

**Phase 4 shipped** (M48–M54) — Crawler service · Gemini Deep
Research · 6 per-surface fetchers · orchestrator · `@feasibility_bot`
auto-proposals · Live Pulse UX · cockpit · visualization pack ·
4-vision seeding. Then **M55** swapped the Next.js admin (`apps/admin/`,
port 3100) for **SQLAdmin** at `data-pipeline:8003/admin` — same data,
much less hand-rolled UI. See
[docs/tasks/current.md](./docs/tasks/current.md).

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

Via SQLAdmin: `http://localhost:8003/admin` → sidebar **Vision
Builder**. Submit a one-line question. The Vision Builder Conductor
runs:

```
PromptValidator (fast)
  → VisionResearch (balanced)
  → VisionDecomposition (deep)
  → DataSourceSelector (balanced)
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

- [docs/tasks/current.md](./docs/tasks/current.md) — live milestone status
- [docs/architecture/composition.md](./docs/architecture/composition.md) — Phase 4 data-pipeline + fetcher + bot + UX ground-truth
- [services/data-pipeline/README.md](./services/data-pipeline/README.md) — 데이터 파이프라인 수집 주기 및 데이터베이스 ERD 아키텍처 분석서 (Pure Markdown)
- [docs/adr/](./docs/adr/) — Architectural Decision Records
- [docs/agent-capabilities.md](./docs/agent-capabilities.md) — agent / workflow inventory
- [docs/archive/](./docs/archive/) — historical Phase 3 memos (pivot, refactor inventory)
- [CLAUDE.md](./CLAUDE.md) — operational context (read every session)
- [DESIGN.md](./DESIGN.md) — vision, personas, NFRs
- [prompts/](./prompts) — agent system prompts (versioned)
