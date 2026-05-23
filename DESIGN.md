# DESIGN.md — Vision Feasibility Monitor

**Owner**: Ayoung · **Last updated**: 2026-05-23 (pivot rewrite)

> 운영/개발 컨텍스트는 [CLAUDE.md](./CLAUDE.md). 전략 메모는
> [docs/PIVOT.md](./docs/PIVOT.md). 파일별 refactor inventory는
> [docs/REFACTOR.md](./docs/REFACTOR.md). 현재 작업은
> [docs/tasks/current.md](./docs/tasks/current.md).
>
> M36-M47 pivot 진행 중. 이 문서는 *durable strategic content*만 유지 —
> 로드맵 / business model / IA sitemap / equities 등 superseded 섹션은
> 통째로 삭제됐고 git history에 보존됨. PIVOT.md를 first read로.

---

## 1. Vision

### 1.1 One-line

> **Pick any bold technology vision — orbital data centers, fusion power,
> room-temperature superconductors. We track every capability it needs,
> every signal that moves it, and roll it up into one number you can
> glance at in 5 seconds.**

### 1.2 The problem

기술 실현 가능성에 대한 답이 흩어져 있다:
- 분석 리포트는 발간 즉시 노후화 (Gartner Hype Cycle, MIT Tech Review
  10 Breakthrough = 분기/연 단위, PDF)
- "AI 메모리가 폭증할 것"이라는 결론은 있지만 그 결론을 뒷받침하는
  인과 구조 + 가정 + 출처가 불투명
- "발사 비용이 50% 더 떨어지면?" 같은 what-if를 즉시 테스트할 수 없음
- 새로운 기술 비전(우주 데이터센터 / 핵융합 / BCI) 분석에는 매번
  수개월의 전문가 리서치 필요

### 1.3 The solution

1. 각 Vision은 ~10개의 **Capability**(기술 / 경제 / 규제 / 공급)로
   분해
2. 매일 들어오는 **Signal**(arXiv 논문 · 특허 · 뉴스 · 정부 보고서)이
   extractor 에이전트를 통과해 capability score를 업데이트
3. **FeasibilityIndex**가 Bayesian 집계 + Liebig binding constraint 으로
   vision 단위 0-100 점수와 ETA 분포를 도출
4. **Actor** layer가 각 capability를 개발/경쟁하는 회사 + 연구소 +
   정부 기관을 추적 (M45)
5. 시뮬레이션은 Playground 부가 기능 — 사용자가 슬라이더로 산업을
   이해하는 도구

### 1.4 Differentiator

| Existing | Limitation | Our edge |
|---|---|---|
| MIT Tech Review breakthroughs | annual PDF, static | living, daily-updating, source-grounded |
| Gartner Hype Cycle | quarterly, opaque sources | every number drills to source |
| CB Insights | company-centric, not tech-centric | tech-vision-centric |
| Polymarket | game-shaped, no causality | full causality (capability tree → signals) |
| Wood Mackenzie / IEA | sector-deep but $25k/y | broad set of visions, freemium |
| arXiv / patent DBs | raw signal, no aggregation | signals aggregate to capability scores |

---

## 2. Users & personas

Priority order (highest → lowest in M44 launch):

| # | Persona | Core job | Pivot-era usage |
|---|---|---|---|
| 1 | Deep-tech VC partner | Thesis validation | "Should I write a $20M check into orbital DCs?" — 5min on Hero, sub-tabs as needed |
| 2 | R&D policy planner (KISTEP / NSF / ARPA-E / DARPA) | Grant allocation | "Where to deploy program funding?" — compare 5+ visions side by side |
| 3 | Corp strategy (Samsung 미래사업본부 / Microsoft FoC) | 5-10y placement | "Where should we be?" — drill into capability cards |
| 4 | Curious engineer / founder | "Worth working on?" | scroll feed of capability movements over time |
| 5 | Tech journalist | Citation source | drill into source-grounded signals; embed Hero in articles |

Domain contributor (proposal submitter, M46+) is everyone except #4.

---

## 3. Core abstractions

See [PIVOT.md §3](./docs/PIVOT.md#3-core-abstraction) for the
canonical model. Quick summary:

```
Vision (1 row = Sector with is_vision_eligible=true)
  ├─ Capability   tech / econ / reg / supply scores (CapabilityScore time series)
  ├─ Actor        global Company/Lab/Govt entities; per-capability roles (M45)
  ├─ Signal       paper / patent / news / filing / gov / vendor / dataset / social
  ├─ Risk         political / legal / supply / safety / env / fin / social
  └─ Feasibility  vision-level composite + ETA P10-median-P90
```

Signal → ExtractorAgent (haiku tier) → per-dim deltas + actor tags →
ScoreUpdaterAgent (sonnet) → CapabilityScore time series → VisionAggregator
(Liebig binding) → VisionFeasibility snapshot.

---

## 4. Features

Anchored to milestones — see [docs/tasks/current.md](./docs/tasks/current.md).

### F1. Vision creation (admin, M41+)
Natural-language vision question → Vision Builder Conductor →
research → capability tree → actor list → risk drafts → scoring code
→ admin approval → live. Cost target: < $5 per new vision.

### F2. Signal ingest (M39+)
- arXiv (papers) — daily, free
- USPTO PatentsView (patents) — daily, free
- NewsAPI.org (news) — daily, free tier
- Future: KIPO patents, government RSS, social listening
- Each signal → ExtractorAgent → per-dim deltas + actor tags + confidence

### F3. The Hero (M37 ✅)
One screen per vision; 5-second comprehension. FeasibilityGauge +
trajectory + ETA window + capability cards + economics curve + risk
board + live signal feed. Sub-nav drills into 7 sub-pages.

### F4. Playground (M37 ✅ → M42)
The original simulator demoted to a sub-tab. User moves driver
sliders; M42 adds a WhatIfFeasibility callout showing how the index
shifts with current assumptions.

### F5. Provenance (M36 ✅ ongoing)
Every number on the Hero drills to source. `Signal.source_url` is
mandatory. Capability rationale references sources. No hallucinated
numbers.

### F6. Community 2.0 (M46+)
Per-vision proposal flow (ADD_ACTOR / ADD_DATA_SOURCE /
ADD_CAPABILITY / REVISE_CAPABILITY_SCORE / FLAG_SIGNAL / REWORD_RISK /
ADD_RISK / ADD_NEW_VISION). Threshold-driven admin queue.
Approve → mutation applies + audit log linkage. Wikipedia-meets-
Polymarket; community curation as moat.

### F7. Backtest harness (deferred, M31 reframed)
Vision feasibility backtest — "what did we score this capability 12mo
ago vs. how did it actually evolve?" The original equity-price
backtest is dropped with the pivot.

---

## 5. Agent topology

Cross-reference [CLAUDE.md "Tech Stack → Agent / LLM"](./CLAUDE.md#agent--llm)
for model routing + auth. Conductor orchestrates the workflows below.

| Workflow | Tier | When | Triggered by |
|---|---|---|---|
| VisionResearch | sonnet | M41 | new vision proposal |
| VisionDecomposition | opus | M41 | post-Research |
| CapabilityToDriver | sonnet | M41 | post-Decomposition |
| CapabilityDependencies | opus | M41 | post-CapabilityToDriver |
| CapabilityScoringCode | opus | M41 | post-Dependencies |
| CodeReview | opus | M41 | post-CodeGen |
| SignalExtractor | haiku | M39+ | each new signal (~100-1000/day) |
| ScoreUpdater | sonnet | M40+ | new signal arrives for a capability |

All output goes through Pydantic schema validation. Tool-use trick on
Claude side (force `tool_choice` for structured output). Cost meter
tracks per-workflow $$.

---

## 6. System architecture

See [CLAUDE.md "Tech Stack"](./CLAUDE.md#tech-stack) for the
stack + service list. Pivot adds no new infra — same Postgres + tRPC +
Prisma + FastAPI services + dual-provider LLM client.

Signal ingest + score recompute crons run inside the existing
`data-pipeline` service. Feasibility math lives in `simulation-service`
(new `feasibility/` module). Vision Builder agent workflows run inside
`agent-orchestration`. No Temporal Cloud, no Modal/E2B sandbox in
pivot scope.

---

## 7. Non-functional requirements

### 7.1 Performance budgets (P95 unless noted)

| | Target |
|---|---|
| Hero page TTFB | < 500ms |
| `vision.getOverview` (one DB round trip) | < 200ms |
| Capability detail load | < 300ms |
| Driver slider re-sim (cache hit) | < 800ms |
| Driver slider re-sim (cold) | < 30s |
| LLM streaming TTFT | < 1s |
| First page LCP | < 2s |

### 7.2 Cost

Unit economics — Pro tier (TBD pricing M44+):
- Per-user LLM cost: < $30/mo
- Per-user infra cost: < $5/mo
- Gross margin target: > 80%

Strategies (active):
1. Prompt caching (Anthropic + Gemini both support)
2. Result caching (`hash(sector_id, code_version, drivers_dict)`)
3. Model routing (haiku for extraction / classification; sonnet for
   reasoning; opus only for critical decomposition / code review)
4. Batch API for non-realtime (backtest, signal extractor batching)

### 7.3 Security

- LLM-generated code runs ONLY in sandbox (Modal / E2B — pending,
  blocks M28b)
- Sandbox network: whitelist only, no arbitrary outbound
- Secrets via Doppler / AWS Secrets Manager — never repo
- Vertex AI SA JSON at `infra/secrets/vertex-ai-sa.json` (gitignored)
- All admin actions → audit log
- Multi-tenant + RLS planned (M30, deferred until M47)
- SOC2 prep at scale (post-M44)

### 7.4 Reliability

- Simulation results are deterministic (caching invariant)
- 30s+ work runs through Temporal — wired post-M47
- Long-tail feasibility recompute via daily cron, not request path
- DB multi-AZ + daily snapshot (Railway / Fly.io defaults)

### 7.5 Provenance

Every data point: `source_url` + `timestamp` + `confidence`.
`Signal.source_url` is `@unique` with `capability_id` (multi-cap
signals write N rows). LLM cannot fabricate numbers — schema-level
enforcement via Pydantic `source_ref` requirements on every draft.

---

## 8. UX principles

1. **Show, don't tell** — interactive viz over prose
2. **Progressive disclosure** — first screen = bottom-line; drill for
   detail
3. **Uncertainty visible** — every score has P10-P90 band
4. **Mutability** — every assumption (driver slider) is toggle-able
5. **Provenance always one click away** — Sources tab + per-number
   hover
6. **Keyboard-first** — Linear/Notion shortcuts + cmd+K (post-M44)
7. **Dark mode default** — data density needs it
8. **Bilingual** — ko default + en parity; Twitter share needs en

Visual language:
- Inter for UI, JetBrains Mono for numbers
- Tailwind 8px grid
- Color ramp: rose < 30 < amber < 60 < emerald (matches DimensionBars +
  FeasibilityGauge)
- Confidence as translucent band, not separate chart
- 200ms transitions on data updates (aids cognition)

---

## 9. Risks & mitigations

| Risk | Severity | Mitigation |
|---|---|---|
| LLM hallucinates capability tree (M41) | High | Force `source_url` per draft; admin approval gate; 5-vision eval set |
| Signal extractor noise → score drift | High | Per-dim confidence threshold; per-vision keyword tuning iteration |
| "73/100" feels arbitrary | High | Every number → source drill-down; Sources tab first-class |
| Framework over-fits SDC | Medium | M44 pressure-tests on Fusion; eval set: 5 visions |
| Signal extractor false-positives on common names | Medium | Confidence > 0.8 threshold for `actor_id` tag |
| Existing legacy users dislike archive | Medium | Flag stays toggleable; data preserved |
| Founder bandwidth (1 person 9-11 weeks) | High | Each PR independently mergeable; M37 Hero is the first vital screenshot |
| Vote brigading (M46) | Medium | Weight starts 1.0×; M47 reputation gates weights; rate-limit |
| Logo URLs 404 (M45) | Low | Fallback to colored initial-letter avatar; don't host |

---

## 10. References

- [CLAUDE.md](./CLAUDE.md) — operational context, tech stack, conventions
- [docs/PIVOT.md](./docs/PIVOT.md) — strategic memo
- [docs/REFACTOR.md](./docs/REFACTOR.md) — file-by-file refactor inventory
- [docs/adr/](./docs/adr/) — Architectural Decision Records
- [docs/tasks/current.md](./docs/tasks/current.md) — live milestone status
- [prompts/](./prompts) — agent system prompts (versioned)
