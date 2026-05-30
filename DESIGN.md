# DESIGN.md — Vision Feasibility Monitor

**Owner**: Ayoung · **Last updated**: 2026-05-25.

> 운영/개발 컨텍스트는 [CLAUDE.md](./CLAUDE.md). 현재 작업은
> [docs/tasks/current.md](./docs/tasks/current.md). Phase 4
> 데이터 파이프라인 설계는
> [docs/architecture/composition.md](./docs/architecture/composition.md).
> 에이전트 인벤토리는
> [docs/agent-capabilities.md](./docs/agent-capabilities.md).
>
> 이 문서는 *durable strategic content* 만 유지 — 로드맵 / business
> model / IA sitemap / equities 등 superseded 섹션은 git history에
> 보존됨. Phase 3 (Sector Simulator → Vision Feasibility Monitor pivot)
> 의 historical context 가 필요하면
> [docs/archive/pivot.md](./docs/archive/pivot.md).

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
   정부 기관을 추적
5. **크롤러 서비스** 가 실시간으로 인터넷 데이터를 흡수해 Signal/
   Capability/Risk/Economics 로 떨어뜨리고, 새 entity 가 발견되면
   **`@feasibility_bot`** 이 `CommunityProposal` 을 띄워 유저 투표로
   큐레이션
6. 시뮬레이션은 Playground 부가 기능 — 사용자가 슬라이더로 산업을
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

Priority order:

| # | Persona | Core job | Primary use |
|---|---|---|---|
| 1 | Deep-tech VC partner | Thesis validation | "Should I write a $20M check into orbital DCs?" — 5min on Hero, sub-tabs as needed |
| 2 | R&D policy planner (KISTEP / NSF / ARPA-E / DARPA) | Grant allocation | "Where to deploy program funding?" — compare 5+ visions side by side |
| 3 | Corp strategy (Samsung 미래사업본부 / Microsoft FoC) | 5-10y placement | "Where should we be?" — drill into capability cards |
| 4 | Curious engineer / founder | "Worth working on?" | scroll feed of capability movements over time |
| 5 | Tech journalist | Citation source | drill into source-grounded signals; embed Hero in articles |

Domain contributor (proposal submitter, voter on bot-drafted proposals)
is everyone except #4.

---

## 3. Core abstractions

```
Vision (1 row = Sector with is_vision_eligible=true)
  ├─ Capability   tech / econ / reg / supply scores (CapabilityScore time series)
  ├─ Actor        global Company/Lab/Govt entities; per-capability roles
  ├─ Signal       paper / patent / news / filing / gov / vendor / dataset / social
  ├─ Risk         political / legal / supply / safety / env / fin / social
  └─ Feasibility  vision-level composite + ETA P10-median-P90
```

Phase 4 layer on top: a continuous **Crawler** service pushes new
`Signal` / `EconomicsDatapoint` rows into the model and asks
`@feasibility_bot` to draft a `CommunityProposal` whenever a new
Actor / Capability / Risk / signal source shows up. See
[docs/architecture/composition.md](./docs/architecture/composition.md).

Signal → ExtractorAgent (fast tier) → per-dim deltas + actor tags →
ScoreUpdaterAgent (balanced) → CapabilityScore time series → VisionAggregator
(Liebig binding) → VisionFeasibility snapshot.

---

## 4. Features

Live status is in [docs/tasks/current.md](./docs/tasks/current.md).
This list is intentionally durable — feature *shape*, not feature *state*.

### F1. Vision creation
Natural-language vision question → Vision Builder Conductor
(PromptValidator → Research → VisionDecomposition → DataSourceSelector
→ ValidationGate) → admin approval → tRPC commit. Cost target ~$2 per
vision on the 5-vision eval set. Sandbox for scoring-code execution
remains deferred.

### F2. Signal ingest (continuous)
- Direct adapters (cheap, keyword-driven): arXiv papers · USPTO
  PatentsView · NewsAPI · government RSS
- Synthesis: Gemini Deep Research Agent for state-of-X paragraphs no
  single API can produce
- Each signal → SignalExtractor (fast) → per-dim deltas + actor tags +
  confidence → ScoreUpdater (balanced) → CapabilityScore time series →
  daily `recompute_feasibility` cron

### F3. The Hero
One screen per vision; 5-second comprehension. FeasibilityGauge +
trajectory + ETA window + capability cards + actors band + economics
curve + risk board + live signal feed + **Live Pulse widget** (ingest
ticker, last 24h). Sub-nav drills into 8 sub-pages (Overview /
Capabilities / Actors / Signals / Risks / Economics / Playground /
Sources). Every score number opens a "why" drawer with source signals.

### F4. Playground
Simulator as a sub-tab. Driver sliders + driver→capability badges +
WhatIfFeasibility callout above the sim chart showing how the index
would shift under the current assumptions (client-side Liebig
aggregator mirrors `simulation_service/feasibility/`).

### F5. Provenance
Every number on the Hero drills to source. `Signal.source_url` is
mandatory. Capability rationale references sources. Pydantic enforces
`source_ref` on every LLM-generated draft. Every surface advertises
its sync state via a pill (`Synced 2m ago · 3 sources · 7 signals`).

### F6. Community
Per-vision proposal flow (`add_driver / add_equity / add_capability /
add_risk / add_actor / add_signal_source / edit / other`) with vote +
admin queue + per-kind applier. Tiered predictions (Easy / Medium /
Hard auto-assigned by horizon × spread × volatility) with auto-
resolution against EquityQuote close. Reputation tiers + Follow graph
+ `/u/[id]` profiles.

### F7. Bot-authored proposals
`@feasibility_bot` (`User.is_bot=true`, `bot_kind="research_agent"`)
detects newly-mentioned actors / capabilities / risks / signal sources
from the crawl stream, drafts a `CommunityProposal` with source-linked
evidence, and submits it through the F6 pipeline. Bot is excluded
from leaderboard / reputation / follow / voting; visual treatment in
the proposal feed is a gradient border + ✨ chip + "How this was
drafted" drawer.

### F8. Admin Crawler Cockpit
`/admin/crawler` — live jobs · per-source health (Stripe-Status-style
pills) · bot proposal queue (Linear-Triage-style) · per-vision
schedule editor (orchestrator weights, $/day cap, "Run now" per
surface). Optional collaborative-plan approval for expensive Deep
Research runs.

### F9. Vision Visualization pack
CapabilityRadar · FeasibilityTimeline · CostCurveCrossover ·
ActorRelevanceBubble · RiskHeatmap. All click-to-source.
Dark + light theme parity.

### F10. Backtest harness (deferred)
Vision feasibility backtest — "what did we score this capability 12mo
ago vs. how did it actually evolve?"

### F11. i18n + theme
Cookie-backed ko/en (ko default) and dark/light/system theme, both
mirrored on `User.locale` / `User.theme` for cross-device sync.
Translation registry at `apps/web/src/lib/i18n/dict.ts`; tone target
is natural-friendly 존댓말 in Korean, conversational in English. Not
formal translation-ese in either.

---

## 5. Agent topology

Cross-reference [CLAUDE.md "Tech Stack → Agent / LLM"](./CLAUDE.md#agent--llm)
for model routing + auth. Conductor orchestrates the workflows below.

| Workflow | Tier | Triggered by |
|---|---|---|
| VisionResearch | balanced | new vision proposal |
| VisionDecomposition | deep | post-Research |
| CapabilityToDriver | balanced | post-Decomposition |
| CapabilityDependencies | deep | post-CapabilityToDriver |
| CapabilityScoringCode | deep | post-Dependencies |
| CodeReview | deep | post-CodeGen |
| SignalExtractor | fast | each new signal (~100–1000/day) |
| ScoreUpdater | balanced | new signal arrives for a capability |
| DeepResearch | gemini-3.1-pro-preview (deep tier, grounded) | per-surface fetcher (Phase 4) |
| EntityDetector | balanced | post-signal-batch; diffs vs known entities |
| ProposalDrafter | balanced | detected entity passes confidence + recurrence |

All output goes through Pydantic schema validation via Gemini's native
`response_schema`; when the FST constraint overflows (~5888 states) the
client falls back to prompt-injection + post-parse, with a corrective
re-prompt on validation failure (see `packages/agent-tools/agent_tools/
llm_client.py`). Cost meter tracks per-workflow $$.

---

## 6. System architecture

See [CLAUDE.md "Tech Stack"](./CLAUDE.md#tech-stack) for the
stack + service list. The Python service set is Postgres + tRPC +
Prisma on top, FastAPI services behind, dual-provider LLM client
shared across.

Service map:
- `data-pipeline` — direct-adapter signal sweeps (arXiv / USPTO /
  NewsAPI) + score recompute crons. Hourly cadence.
- `simulation-service` — `feasibility/` module: 4-dim aggregation +
  Liebig binding + ETA inference.
- `agent-orchestration` — Vision Builder Conductor + extractor /
  updater workflows.
- `crawler` (Phase 4) — Gemini Deep Research Agent + per-surface
  fetchers (capability / actor / risk / economics) + orchestrator +
  EntityDetector → ProposalDrafter (bot author). Redis Streams queue.
  Always-on Docker service.

Temporal Cloud + Modal/E2B sandbox remain parked.

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
1. Prompt caching (Gemini `cache_control: ephemeral` on system blocks)
2. Result caching (`hash(sector_id, code_version, drivers_dict)`)
3. Model routing (fast for extraction / classification; balanced for
   reasoning; deep only for critical decomposition / code review)
4. Batch API for non-realtime (backtest, signal extractor batching)

### 7.3 Security

- LLM-generated code runs ONLY in sandbox (Modal / E2B — pending,
  blocks M28b)
- Sandbox network: whitelist only, no arbitrary outbound
- Secrets via Doppler / AWS Secrets Manager — never repo
- Vertex AI SA JSON at `infra/secrets/vertex-ai-sa.json` (gitignored)
- All admin actions → audit log
- Multi-tenant + RLS planned (parked)
- SOC2 prep at scale (parked)

### 7.4 Reliability

- Simulation results are deterministic (caching invariant)
- 30s+ work runs through Temporal — parked
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
6. **Keyboard-first** — Linear/Notion shortcuts + cmd+K (parked)
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
| LLM hallucinates capability tree | High | Force `source_url` per draft; admin approval gate; 5-vision eval set |
| Signal extractor noise → score drift | High | Per-dim confidence threshold; per-vision keyword tuning iteration |
| "73/100" feels arbitrary | High | Every number → source drill-down; Sources tab first-class |
| Framework over-fits one vision | Medium | 4-vision baseline seed; eval set across 5 |
| Signal / EntityDetector false-positives on common names | Medium | Confidence > 0.8 threshold + LLM `is_org` + `domain_relevant` classification gate |
| Bot floods proposal queue | Medium | Recurrence rule (≥2 distinct signals in 7d) + 7d dedup window; admin can bulk-reject |
| Crawler $/day overrun | Medium | Per-vision cap in orchestrator; spend meter visible in cockpit; admin pre-approval for Deep Research Max |
| Vote brigading | Medium | Weight starts 1.0×; reputation gates weights once tier system is live; rate-limit |
| Logo URLs 404 | Low | Fallback to colored initial-letter avatar; don't host |

---

## 10. References

- [CLAUDE.md](./CLAUDE.md) — operational context, tech stack, conventions
- [docs/tasks/current.md](./docs/tasks/current.md) — live milestone status
- [docs/architecture/composition.md](./docs/architecture/composition.md) — Phase 4 data-pipeline + fetcher + bot + UX ground-truth
- [docs/adr/](./docs/adr/) — Architectural Decision Records
- [docs/archive/](./docs/archive/) — historical Phase 3 memos
- [prompts/](./prompts) — agent system prompts (versioned)
