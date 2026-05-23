# PIVOT — From "Sector Simulator" to "Vision Feasibility Monitor"

**Date**: 2026-05-23
**Owner**: Ayoung
**Status**: Proposed → execution starts at M36
**Supersedes**: parts of DESIGN.md §1, §4, §9, §10, §14 (legacy investment-side
features). Detailed reconciliation in §10 below.
**Companion doc**: [REFACTOR.md](./REFACTOR.md) — file-by-file code surgery
inventory (every file in the repo gets a disposition: KEEP / EDIT / RENAME /
REFRAME / REPURPOSE / ARCHIVE / DELETE / NEW). Read REFACTOR.md before starting
any milestone.

---

## 0. TL;DR

우리는 *"산업 시뮬레이터"*를 만들고 있었지만, 사용자가 진짜 원했던 건
**"하나의 대담한 기술 비전이 실현 가능한가, 언제, 무엇이 가로막고 있는가"**에
대한 살아 있는 모니터링 플랫폼이었다. 우주 데이터센터가 첫 사례.

지난 4개월간 product가 천천히 투자 도구 쪽으로 표류했다 — Equity 테이블,
Prediction 게임, Community 종목 토론 등. 원래 의도와 어긋난다. **Pivot 실행.**

새 product 한 줄: **"Pick any bold technology vision. We track every capability
it needs, every signal that moves it, and roll it all up into one number: how
close is it, really?"**

| 변경 영역 | 방향 |
|---|---|
| 핵심 abstraction | `Sector` → `Vision` (제품 언어) + new `Capability` / `Signal` / `Risk` |
| 메인 화면 | 4-tab workspace (Live/Manual/Graph/Sources) → **1-page "Feasibility Monitor"** (요약 hero) |
| Simulation | 메인 → 부가 ("Playground" 탭) |
| 데이터 수집 | yfinance 시세 → **arXiv + Patents + News + Policy + Vendor docs** (capability signals) |
| 점수 모델 | 임의 시뮬 outputs → **Feasibility Index** (Bayesian, 4-dim aggregation) |
| Agent 출력 | sector code → **Vision capability tree + signal mapping** |
| 투자 기능 (Equity / Prediction / Watchlist / Compare-stocks) | **archive behind feature flag** |
| 비즈니스 모델 | $199/mo analyst tool → **freemium media + insights** (재설계) |

**실행 윈도우**: 8주 (M36 → M44), 1인 founder + Claude pace 기준.

---

## 1. Why Pivot — Strategic Diagnosis

### 1.1 The drift

DESIGN.md §1.1 (한 줄 비전)을 다시 보자:

> "산업을 시뮬레이션 가능한 인과 그래프로 변환하고, 실시간 데이터로 미래를
> 검증하는 AI 에이전트 기반 분석 플랫폼"

이 문장 자체는 옳다. 그런데 product를 빌드하면서:

- Phase 1 (M1-M10): 시뮬 + 인과 그래프 ✓ (vision에 부합)
- Phase 2 시작 (M5-M10b, M14-M22): 의도대로 멀티 섹터 + agent
- **여기서부터 드리프트**: Phase 2.5 (DESIGN §14, 2026-05-20 추가) — 사용자가
  "섹터별 전세계 상장 키 플레이어 종목"을 언급한 한마디로 SectorEquity /
  EquityFinancial / EquityQuote / MarketFactor 4개 테이블 + yfinance 어댑터 +
  /equities, /compare-stocks 두 라우트 + 49개 equity seed + 7,200개 quote row.
- Phase 2.5 후반 (M32~M33): Prediction 시스템 추가. "이 종목이 Q4에 얼마"
  formate. /predict, /community, /watchlist, /my-sectors 추가. Prediction
  scoring cron 추가.
- M34, M35: LLM 인프라 리팩토링 — vision-neutral, OK.

**드리프트의 정량 지표** (2026-05-23 기준):
- 총 7개 user-app 상위 라우트 중 4개가 투자 도구 (`/predict`,
  `/community`, `/watchlist`, `/my-sectors`)
- 섹터 hub 9개 sub-tab 중 2개가 투자 도구 (`equities`, `compare-stocks`)
- DB 22개 모델 중 5개가 투자 도메인 (`SectorEquity`, `EquityFinancial`,
  `EquityQuote`, `Prediction`, `PredictionResult`)
- 5개 user-invocable agent workflow 중 1개가 prediction rationale 분석
  (`prediction.analyzeRationale`)

원인 진단: **slice 단위로 빠르게 빌드하다 보니, 매 슬라이스에서 "한 줄
사용자 요청"에 반응했고, 누구도 "이게 코어 vision에 부합하는지" 묻지
않았다.** 1인 founder 트랩.

### 1.2 What the user actually wanted from day 1

오늘 사용자가 자기 말로 핵심을 다시 말해줬다:

> "우주 데이터 센터가 과연 실현 가능성 있을까? 우주 데이터 센터에 필요한
> 모든 기술들을 나열하고, 각 기술별로 동향을 파악하고 이를 하나로 묶어서
> 실시간으로 이 비전의 실현 가능성을 하나의 모니터링 플랫폼으로 보고자
> 했던거지. 시뮬레이션은 약간 부수적인 기능."

DESIGN.md를 다시 읽으면 이게 처음부터 있었다:
- §1.4 사용자 가치: "VC 파트너 → thesis 검증", "정부 R&D 기획자 → 정책
  시나리오 임팩트" — *전부 기술 실현 가능성 평가지, 종목 트레이딩 아님*
- §9.1 Phase 0 데모: "AI Memory Demand" → 슬라이더 → 차트 (현재 product와
  일치하지만, 이건 데모일 뿐이었고 진짜 product는 §1.4)
- §11 risk: "시뮬레이션 신뢰도 부족 (사용자 회의)" — backtesting을 공개해서
  신뢰 확보. *이것도 비전 실현 가능성 monitor 컨셉의 산물.*

§14 (Equities)는 *나중에 추가된, "수익 모델을 어떻게 잡지"라는 압박감*에서
나온 부수 결정이었다. 다시 본다: §14 첫줄 — "Phase 2.5 신규 도메인. 섹터
(시뮬레이션 단위)와 글로벌 상장 종목(투자 의사결정 단위) 사이에 다리." —
이미 stretch 임을 적어두었다.

### 1.3 What the world needs — market opportunity

기술 실현 가능성을 한눈에 보는 product는 *지금까지 존재하지 않는다*:

| 인접 product | 한계 |
|---|---|
| MIT Tech Review "10 Breakthrough Technologies" | 1년 1회 PDF. 정적. 노후화 즉시. |
| Gartner Hype Cycle | 분기. PDF. 데이터 출처 불명. 컨설팅 패키지의 일부. |
| CB Insights | 종합. 그러나 회사 중심 (스타트업 DB), 기술 중심 X. |
| Wood Mackenzie / IEA Reports | 에너지 전문. 깊지만 좁고 비싸다 ($25k+/y). |
| Polymarket / Manifold | forecasting 시장. 기술 가능성도 게임화하지만 underlying 데이터/이유가 안 보임. |
| arXiv / Patent DBs | 원천 데이터. 노이즈 너무 많고 aggregation 없음. |
| Our World in Data | 데이터 시각화의 갓 standard. 그러나 retrospective. 미래 지향 X. |

**Whitespace**: *"living, multi-dimensional, source-grounded readout of how
close a major technology vision is to reality."*

타겟 사용자가 확장된다:
- VC 파트너 (deep-tech thesis 검증)
- 정부 R&D 기획자
- corp dev / 전략기획
- 깊은 호기심을 가진 엔지니어 / 창업자 / 저널리스트
- (그리고 우리가 처음에 노렸던) 산업 애널리스트

투자자만이 아닌 *"진지하게 미래를 이해하고 싶은 사람"* 전체로. 이게 더 큰
TAM이고 더 viral하다 (screenshot 가능, 대중도 흥미).

### 1.4 Comparables — category-creator 분석

내가 벤치마킹할 product:

- **Our World in Data** — "데이터로 story 한다." 우리는 "데이터로 미래
  feasibility 한다." 같은 source-grounded, narrative-strong DNA.
- **Stripe Atlas/Press** — 디자인 품질이 product의 일부. screenshot 한 장에
  product 가치가 담겨야 한다.
- **Linear** — 정보 밀도와 keyboard-first navigation. 우리도 그래야 한다.
- **NTI Nuclear Threat Initiative Index** — multi-dimensional readiness를
  시각화하는 좋은 selector pattern.
- **Polymarket** — 큰 질문에 베팅하는 행위가 engagement를 만든다. 우리는
  "베팅" 대신 "구독 + 알림"이지만 "이 vision 어떻게 가고 있어?" 호기심은
  같다.
- **Bloomberg Terminal** — 정보 밀도 + 신속성. 우리는 consumer-friendly
  버전.

### 1.5 What we keep, what we drop

**Keep & repurpose** (이미 잘 만든 것):
- ✅ `SimulationBase` / `Driver` / `Output` / causal graph / sensitivity
  → **Vision Playground**로 데모트, capability와 매핑
- ✅ `Source` / `HistoryPoint` / `Provenance` (kind taxonomy: paper /
  vendor_doc / analyst / benchmark / gov_report / dataset / news / filing)
  → 그대로 사용, **Signal**의 기반
- ✅ Agent topology (Conductor, Decomposition, Driver Inference, Edge
  Inference, Code Gen, Code Review) → **Vision Builder agent**로 reshape
- ✅ Dual LLM (Claude opus + Gemini sonnet/haiku, Vertex AI) → 그대로
- ✅ Postgres + Prisma + tRPC + sector-service + simulation-service +
  agent-orchestration → 그대로 (rename/add only)
- ✅ space-data-center / memory-semi / sofc 3개 sim → 첫 3개 Vision의
  Playground 데이터 소스

**Drop / Archive** (투자 표류 잔재):
- 🗑 `/predict`, `/community`, `/watchlist`, `/my-sectors` 라우트 → archive
- 🗑 `/sectors/[slug]/equities`, `compare-stocks` sub-tabs → archive
- 🗑 SectorEquity / EquityQuote / EquityFinancial / Prediction /
  PredictionResult 테이블 → keep data (no migration), hide UI behind
  feature flag `ENABLE_LEGACY_INVESTMENT_FEATURES`
- 🗑 seed-equities / seed-equity-quotes / seed-equity-financials → keep
  scripts (idempotent), remove from default `db-migrate` chain
- 🗑 yfinance ingest cron → 비활성화 (`INGEST_SCHEDULE=off`)
- 🗑 prediction.* tRPC 라우터 → keep code, omit from user UI
- 🗑 prediction-resolve cron → 비활성화
- 🗑 community / suggestion 라우터 → keep code, omit from default UI
- 🗑 `M29` (OAuth), `M30` (multi-tenant), `M31` (backtest harness) 우선순위
  강등 → pivot 이후로 deferral (백테스트는 vision feasibility의 backtest로
  reframe될 가능성 있음)

**Demoted but kept visible** (UI 위치/메인 메시지만 변경):
- ⬇ Manual workspace (slider) → "Playground" tab in Vision page
- ⬇ Causal Graph → "Capability dependencies" tab (semantic relabel)
- ⬇ Sources tab → 그대로지만 새 Signal feed와 통합 가능

**Add fresh** (M36 ~ M44에서 만듬):
- 🆕 `Vision` 개념 layer (DB에는 `Sector`로 남되 product 언어/라우트는 Vision)
- 🆕 `Capability` 테이블 + `CapabilityScore` (TRL/Economic/Regulatory/Supply
  4-dim)
- 🆕 `Signal` 테이블 + signal ingest 어댑터 (arXiv, USPTO/KIPO, NewsAPI,
  govt feeds)
- 🆕 `Risk` 테이블 (정치/법률/공급망/안전)
- 🆕 `FeasibilityIndex` 계산 엔진 (Python, Bayesian aggregation)
- 🆕 `VisionPage` UI (the hero, one-glance comprehension target)
- 🆕 Vision Builder agent (one-line vision → full capability tree + signal
  sources)

---

## 2. The New Positioning

### 2.1 One-line product

> **"Will [bold technology vision] actually happen, and when? A living,
> source-grounded monitor that decomposes any technology vision into the
> capabilities it needs, tracks every signal that moves it, and rolls it
> all up into one number you can glance at in 5 seconds."**

### 2.2 Target user (in priority order)

1. **Deep-tech VCs** — thesis 검증. "Should I write a $20M check into
   orbital DCs?" 5분 안에 답 얻는 도구.
2. **R&D 정책 기획자** (KISTEP, NSF, ARPA-E, DARPA) — "어디에 grant funding
   배분?"
3. **Corporate strategy** (Samsung 미래사업본부, 삼성SDI 신기술팀, Microsoft
   future-of-compute group 등) — "5-10년 후 우리 회사 어디 있어야 하나?"
4. **Curious engineers + founders** — "이거 일할 가치 있는 영역인가?"
5. **Tech journalists** — Bloomberg/The Information 기자. 우리 도구가 그들
   citation source가 되는 게 목표.

Phase 1 audience = #1 (VC) + #4 (curious eng). 둘 다 viral + content-driven.
Enterprise (#2, #3)는 Phase 3+.

### 2.3 Category claim

"**The canonical living monitor for the next 10 years of technology.**"

이게 카테고리 그 자체가 되기 위한 조건:
- Vision page 1장의 quality가 비교 불가해야 한다 (screenshot 한 장으로 product
  설명이 됨)
- 새 vision을 24h 내에 agent로 만들 수 있어야 한다 (scalability)
- 모든 숫자가 source까지 drill-down 가능 (credibility)
- 매일 vision 점수가 자동 업데이트 (living)
- 한국어 + 영어 둘 다 (글로벌 + 국내 deep-tech 사용자)

### 2.4 The viral hook

매주 1개 vision의 "Feasibility Update" newsletter / X thread:

> "Space Data Centers: 73/100, up +8 this quarter.
> ▲ Starship V3 first burn shaved $/kg projections 22%.
> ▼ AMD MI300 rad-test delayed Q3 → bottleneck widens.
> Read the live monitor: [link]"

매번 screenshot-able. 매번 새 데이터. 매번 사람들이 stake를 가진 미래
질문. 이거 viral coefficient 높다.

---

## 3. The Product Concept — One-glance Feasibility Monitor

### 3.1 Core abstraction

```
Vision                                      "Space Data Centers"
  ├─ Capability  (다음 모두 필요)
  │    ├─ Technical readiness   (0-100)     "TRL-like"
  │    ├─ Economic readiness    (0-100)     "비용 곡선, mass-producible?"
  │    ├─ Regulatory readiness  (0-100)     "ITAR, ITU, 안보, 환경법"
  │    └─ Supply readiness      (0-100)     "공급망, 인력, 자본 chokepoint"
  ├─ Signal                                  "Capability를 움직이는 외부 이벤트"
  │    └─ source-grounded (arXiv / patent / news / filing / govt) +
  │      timestamp + per-capability per-dimension delta
  ├─ Risk                                    "Vision을 죽일 수 있는 outside factor"
  │    └─ severity × likelihood × time-to-mitigation
  └─ FeasibilityIndex                        "Capability scores Bayesian aggregation +
                                              binding constraint logic → vision-level 0-100 +
                                              ETA 분포"
```

**Vision** = 거대한 질문 ("우주 데이터센터가 실현될 것인가").
**Capability** = 그 질문이 yes가 되려면 어떤 sub-기술/조건이 모두 ready
되어야 하는가의 list.
**Signal** = 매일/매주 들어오는 raw 데이터 포인트 (papers, patents, news,
filings) 중 capability score를 update할 수 있는 것.
**FeasibilityIndex** = capability score들의 weighted aggregation. *Binding
constraint*가 있으면 vision 점수는 그 constraint의 점수에 cap 된다 (Liebig's
law of the minimum 원리).

### 3.2 The Hero page — the 5-second comprehension target

This is what M37 ships. ASCII mock (실제 구현은 shadcn + Recharts):

```
┌────────────────────────────────────────────────────────────────────────────────┐
│ ◀ Visions    SPACE DATA CENTERS                              ↻ updated 14m ago │
│ ─────────────────────────────────────────────────────────────────────────────  │
│ "By when will compute in orbit be commercially viable?"                         │
│                                                                                 │
│                                                                                 │
│         FEASIBILITY                          73 / 100                           │
│           INDEX                              ▲ +8 (90d)                         │
│                                                                                 │
│         Trajectory       ████░░░░░░░░░░░░░░  median 73                          │
│                          ░░██████░░░░░░░░░░  P25-P75 67-79                      │
│                                                                                 │
│         ETA window       ●───────●────────●          median: 2034 ± 3y          │
│                         2031   2034    2040+                                    │
│                                                                                 │
│   ████ Confidence: medium │ 9 capabilities │ 142 signals (30d) │ 5 risks       │
│                                                                                 │
├────────────────────────────────────────────────────────────────────────────────┤
│ CAPABILITIES — sorted by binding-ness                                  [view all]│
│                                                                                 │
│ ┌─ Radiation-hard compute  ⚠ BINDING ┐   ┌─ In-orbit thermal rejection      ─┐ │
│ │     51 / 100   ▼ -3                 │   │      68 / 100   ─ 0                │ │
│ │     ─────────                       │   │      ─────────                     │ │
│ │  tech █████░░░░  (TRL 6)            │   │  tech ██████░░░░  (1.2 kW/m²)      │ │
│ │  econ █░░░░░░░░  ($/qualified chip) │   │  econ ████░░░░░░  (R&D phase)      │ │
│ │  reg  ████░░░░░░  (ITAR partial)    │   │  reg  ████████░░  (no blockers)    │ │
│ │  sup  ███░░░░░░░  (TSMC dependency) │   │  sup  ██████░░░░  (multi-vendor)   │ │
│ │  Latest: AMD MI300 rad-test pending │   │  Latest: Starcloud 1kW demo (2025) │ │
│ └─────────────────────────────────────┘   └────────────────────────────────────┘ │
│                                                                                 │
│ ┌─ Launch economics                  ─┐   ┌─ Downlink bandwidth             ─┐ │
│ │     82 / 100   ▲ +12                │   │      79 / 100   ▲ +5               │ │
│ │  tech █████████  ($1,400/kg → LEO)  │   │  tech ████████░  (4.2 Tbps)        │ │
│ │  econ ████████░  (-22%/y trend)     │   │  econ ████████░  (ground stns 22)  │ │
│ │  reg  ████████░  (no blockers)      │   │  reg  ████████░  (Ka cleared)      │ │
│ │  sup  ████████░  (Starship V3)      │   │  sup  ███████░░░  (optics supply)  │ │
│ │  Latest: Starship V3 first burn ↗   │   │  Latest: ESA optical comms milestone│ │
│ └─────────────────────────────────────┘   └────────────────────────────────────┘ │
│                                                                                 │
│ [ + 5 more capabilities sorted by lowest score ]                                │
│                                                                                 │
├────────────────────────────────────────────────────────────────────────────────┤
│ ECONOMICS   orbit vs ground DC                              ▼ crossover ~2034   │
│                                                                                 │
│   $0.50 ┤  ● orbit                                                              │
│   $0.40 ┤   \                                                                   │
│   $0.30 ┤    ●_                                                                 │
│   $0.20 ┤      \●                                                              │
│   $0.10 ┤        \●─────●─●  ground baseline                                   │
│         └──2026──2028──2030──2032──2034──2036                                  │
│                                                                                 │
├────────────────────────────────────────────────────────────────────────────────┤
│ RISK BOARD                                                                      │
│ ● ITAR / EAR (export control)         HIGH    blocks optics → KR/CN supply     │
│ ● Orbital debris (Kessler scenario)    MED    target orbit congestion          │
│ ● Insurance availability               MED    no carrier writing > $2B/y       │
│ ○ Spectrum / ITU coordination          LOW    Ka/Q-band cleared 2024           │
│ ● Climate / political grant flux       MED    CHIPS Act amendment in flux      │
│                                                                                 │
├────────────────────────────────────────────────────────────────────────────────┤
│ LIVE SIGNALS  (last 24h)                                            [view all] │
│ 🛰  Lonestar Data closes $48M Series B                      ↗ launch-econ +2 │
│ 📄  arXiv: "Ka-band 100Gbps optical downlink demo"          ↗ downlink     0 │
│ 📜  USPTO: SpaceX cooling loop assembly patent (granted)    ↗ thermal     +1 │
│ 🇺🇸  CHIPS Act amendment proposes orbital-DC tax credit     ↗ econ + reg  +3 │
│ 📰  Reuters: AMD postpones MI300 rad-test to Q4              ↘ rad-compute -2 │
│                                                                                 │
├────────────────────────────────────────────────────────────────────────────────┤
│ Sub-navigation:                                                                 │
│   [Overview]  Capabilities  Signals  Risks  Economics  Playground  Sources     │
└────────────────────────────────────────────────────────────────────────────────┘
```

### 3.3 Sub-pages (drill-down)

| Tab | Purpose | Anchor for |
|---|---|---|
| **Overview** (default) | The hero above | 5-second comprehension |
| Capabilities | Drill into each capability — 4-dim breakdown, signals scoped to it, sub-dependencies, "what would unblock this" | 30-second understanding of one capability |
| Signals | Full chronological signal feed, filter by capability/dimension/source/sentiment | journalist / serious researcher |
| Risks | Risk board expanded — for each risk: triggering events, recent movements, mitigations, severity-likelihood matrix | policy person |
| Economics | Cost curves, unit economics, TCO comparison, break-even analysis, sensitivity (driver→cost) | VC / corp strategy |
| **Playground** | The old `manual` workspace — slider + Recharts. Now reframed as: "what if launch costs halve? how does the feasibility index shift?" | curious technologist |
| Sources | Provenance index. Every number → source. Searchable. | trust-checker |

**Crucial**: 90% of users only see Overview. That page alone has to land
the product.

### 3.4 The same template fits any vision

Once the framework is right, the same hero page renders for:

- 🚀 Space Data Centers (M37 — reference)
- ⚛️ Commercial Fusion Power (M44 — second showcase)
- 🧬 Brain-Computer Interface for Mass Use
- 💎 Room-temperature Superconductor
- 🤖 Humanoid Robots in Manufacturing
- ⚡ Solid-state Batteries (mass production)
- 🌱 Lab-grown Meat (price parity with beef)
- 🧠 AGI by Internal Lab Estimates (meta-vision)
- 🛰️ Direct-to-cell satellite voice/data
- 💉 mRNA cancer vaccines (Phase 3 successes)

Each vision = 1 row in `Vision` table, decomposed into ~5-15 capabilities,
sourced from ~50-200 signals. Agent generates the skeleton; admin curates;
signals flow daily.

---

## 4. Domain Model Changes

### 4.1 Schema rename strategy — **no DB column rename**

`Sector` 테이블은 그대로 둔다. 이유:
1. Prisma migration churn 회피 (대규모 cascade 변경)
2. 기존 simulation/scenario/agent_workflow tied to sector_slug — 끊지 않음
3. *product 언어*는 즉시 "Vision"으로 (route, UI text, 새 docs)
4. *DB physical 언어*는 "Sector"로 유지 (서비스 코드 안에서는 sector로 부름)
5. M40+에서 product language가 안정되면 그때 한꺼번에 rename 결정

따라서 product language 사용 가이드:
- README, docs/, prompts/, /apps/web UI 문구: **Vision** 사용
- TypeScript/Python type 이름, 함수 이름, DB column: **Sector** 유지 + 주석에
  "= Vision in product language" 명시

### 4.2 New entities (M36)

```prisma
model Capability {
  id            String   @id @default(cuid())
  sector_slug   String   @map("sector_slug")
  sector        Sector   @relation(fields: [sector_slug], references: [slug])

  // Stable key for cross-version identity ("rad_hard_compute")
  key           String

  name          String                  // "Radiation-hard compute"
  short_name    String?  @map("short_name") // "Rad-hard compute" (card label)
  description   String                  // 1-2 sentences — "what this capability is"
  rationale     String                  // why this is necessary for the vision

  // Ordering within the vision (lower = more central / more blocking)
  display_order Int      @default(100) @map("display_order")

  // Weight in vision-level aggregation (0.0-1.0, sums to 1.0 within vision)
  weight        Float    @default(0.1)

  // Optional link to a Driver (= a slider in the Playground) so the
  // user can experiment with assumptions that affect this capability.
  primary_driver_name String? @map("primary_driver_name")

  created_at    DateTime @default(now()) @map("created_at")
  updated_at    DateTime @updatedAt      @map("updated_at")

  scores        CapabilityScore[]
  signals       Signal[]
  dependencies  CapabilityDependency[] @relation("Source")
  dependents    CapabilityDependency[] @relation("Target")

  @@unique([sector_slug, key])
  @@index([sector_slug])
  @@map("capabilities")
}

model CapabilityScore {
  id             String   @id @default(cuid())
  capability_id  String   @map("capability_id")
  capability     Capability @relation(fields: [capability_id], references: [id], onDelete: Cascade)

  // 4-dimension scores. Each 0-100. Null = "not yet assessed".
  technical      Float?
  economic       Float?
  regulatory     Float?
  supply         Float?

  // Composite, computed: min(weighted_avg, binding_constraint_score)
  composite      Float?

  // Confidence band (P10-P90)
  composite_p10  Float?  @map("composite_p10")
  composite_p90  Float?  @map("composite_p90")

  // Snapshot timestamp — we store a time series so we can show trends.
  as_of          DateTime
  is_current     Boolean  @default(false) @map("is_current")

  // What changed since the previous score (free-text, agent-written)
  rationale      String?

  created_at     DateTime @default(now()) @map("created_at")

  @@index([capability_id, as_of])
  @@index([capability_id, is_current])
  @@map("capability_scores")
}

model CapabilityDependency {
  id              String     @id @default(cuid())
  source_id       String     @map("source_id")    // depends on
  target_id       String     @map("target_id")    // depends on this
  source          Capability @relation("Source",  fields: [source_id], references: [id])
  target          Capability @relation("Target",  fields: [target_id], references: [id])
  rationale       String?

  @@unique([source_id, target_id])
  @@map("capability_dependencies")
}

model Signal {
  id              String   @id @default(cuid())
  sector_slug     String   @map("sector_slug")
  sector          Sector   @relation(fields: [sector_slug], references: [slug])

  // Which capabilities this signal moved, and how.
  // Stored as join table for many-to-many because one paper can move
  // multiple capabilities.
  capability_id   String?  @map("capability_id")
  capability      Capability? @relation(fields: [capability_id], references: [id])

  source_kind     String   @map("source_kind")      // paper/patent/news/filing/gov/vendor_doc/dataset/social
  source_url      String   @map("source_url")
  source_id_ext   String?  @map("source_id_ext")    // arxiv id, USPTO no., DOI, etc.

  title           String
  summary         String?
  published_at    DateTime @map("published_at")

  // Score delta this signal contributes (signed). Set by extractor agent.
  // (-10 .. +10), null = not yet scored.
  delta_technical   Float? @map("delta_technical")
  delta_economic    Float? @map("delta_economic")
  delta_regulatory  Float? @map("delta_regulatory")
  delta_supply      Float? @map("delta_supply")

  // For grouping in UI ("Latest: X")
  is_highlight    Boolean  @default(false) @map("is_highlight")

  ingested_at     DateTime @default(now()) @map("ingested_at")

  @@index([sector_slug, published_at])
  @@index([capability_id, published_at])
  @@map("signals")
}

model Risk {
  id              String   @id @default(cuid())
  sector_slug     String   @map("sector_slug")
  sector          Sector   @relation(fields: [sector_slug], references: [slug])

  key             String
  category        String                       // political | legal | supply | safety | environmental | financial | social
  name            String                       // "ITAR export control on radiation-hard chips"
  description     String

  severity        String                       // low | medium | high | critical
  likelihood      String                       // low | medium | high
  time_horizon    String                       // immediate | 1y | 3y | 5y | 10y
  mitigations     String?                      // free-text

  // Which capabilities does this risk threaten?
  affected_capability_keys String[]            // array of Capability.key

  created_at      DateTime @default(now()) @map("created_at")
  updated_at      DateTime @updatedAt      @map("updated_at")

  @@unique([sector_slug, key])
  @@index([sector_slug])
  @@map("risks")
}

model VisionFeasibility {
  id                 String   @id @default(cuid())
  sector_slug        String   @map("sector_slug")
  sector             Sector   @relation(fields: [sector_slug], references: [slug])

  as_of              DateTime
  is_current         Boolean  @default(false) @map("is_current")

  // Vision-level composite (0-100)
  composite          Float
  composite_p10      Float?   @map("composite_p10")
  composite_p90      Float?   @map("composite_p90")

  // The binding capability (lowest scoring above weight threshold)
  binding_capability_key String? @map("binding_capability_key")

  // ETA: in years from as_of, with confidence band
  eta_median_years   Float?   @map("eta_median_years")
  eta_p10_years      Float?   @map("eta_p10_years")
  eta_p90_years      Float?   @map("eta_p90_years")

  // 90d delta for hero display
  delta_90d          Float?   @map("delta_90d")

  rationale          String?

  created_at         DateTime @default(now()) @map("created_at")

  @@index([sector_slug, as_of])
  @@index([sector_slug, is_current])
  @@map("vision_feasibility")
}
```

`Sector` 모델에 새 relation들을 추가:
```prisma
model Sector {
  // ... 기존 필드 유지 ...

  // M36+ vision-feasibility domain
  capabilities       Capability[]
  signals            Signal[]
  risks              Risk[]
  feasibility_history VisionFeasibility[]
}
```

### 4.3 What gets archived (no data deletion)

`schema.prisma`에 주석으로 marking:

```prisma
/// DEPRECATED 2026-05-23 (M36 pivot). Investment-side features are
/// archived behind feature flag ENABLE_LEGACY_INVESTMENT_FEATURES.
/// Schema retained; not removed from migrations to preserve user data.
/// See docs/PIVOT.md.
model SectorEquity { ... }
model EquityQuote { ... }
model EquityFinancial { ... }
model Prediction { ... }
model PredictionResult { ... }
```

UI routes (`apps/web/src/app`):
- `/predict`, `/community`, `/watchlist`, `/my-sectors` → 404 by default,
  visible when `ENABLE_LEGACY_INVESTMENT_FEATURES=true`
- Sector hub sub-tabs (`/sectors/[slug]/equities`,
  `/sectors/[slug]/compare-stocks`) → removed from `sector-nav.tsx`

Crons:
- `INGEST_SCHEDULE=off` (yfinance)
- `RESOLVE_PREDICTIONS_SCHEDULE=off`

Seeds:
- `db-migrate` 명령에서 `seed:equities`, `seed:equity-quotes`,
  `seed:equity-financials` 제거 (scripts는 keep — 수동 발사 가능)

---

## 5. Engineering Pivot — Detailed Milestones

각 milestone은 **independent slice** — 다음 슬라이스를 시작하려면 이전이
ship 되어야 한다. *Phase 1 룰처럼.*

### M36 — Vision/Capability Schema + Product Language Migration

**Why first**: 모든 후속 milestone이 이 schema 위에서 돈다. 또한 product 언어
(Vision/Capability/Signal/FeasibilityIndex)가 codebase 전반에 도입되어야 한다.

**Estimated effort**: 2-3 days

**What ships**:
- New Prisma models: `Capability`, `CapabilityScore`, `CapabilityDependency`,
  `Signal`, `Risk`, `VisionFeasibility`. Migration applied.
- `Sector` 모델 deprecated fields에 주석 (위 §4.3).
- New tRPC router `vision.*` (alias for sector.* + new capability endpoints):
  - `vision.get(slug)` → `{sector, capabilities[], current_score, recent_signals[], risks[]}`
  - `vision.list()` → sectors with `is_vision_eligible = true` flag
  - `vision.capability.get(slug, key)` → detail
  - `vision.capability.scoreHistory(slug, key)` → time series
  - `vision.signal.list(slug, filter)` → paginated
  - `vision.risk.list(slug)` → risks
  - `vision.feasibility.history(slug)` → snapshots
- DESIGN.md §1, §14 update — §14 marked "DEPRECATED, see PIVOT.md".
- README — feature table row added: "vision-feasibility (M36)".
- `prompts/vision_decomposition.md` skeleton (consumed by M41).

**Files touched**:
- `packages/db/prisma/schema.prisma` — 6 new models, deprecation comments
- `packages/db/prisma/migrations/20260524_capability_schema/` — migration
- `services/sector-service/src/trpc/vision.ts` — new router
- `services/sector-service/src/trpc/root.ts` — wire `vision` router
- `services/sector-service/src/repo/capability.ts` — new repo module
- `apps/admin/src/app/visions/page.tsx` — admin index of visions (deprecate
  old `/sectors` page semantically — keep route alias)
- `DESIGN.md`, `README.md`, `prompts/vision_decomposition.md`

**Tests**:
- `services/sector-service/tests/vision.test.ts` — happy paths for all new
  procedures, capability dependency cycle check
- Prisma migration smoke (existing CI step)

**Demo verification**:
- `pnpm db:migrate dev` clean → tables present
- tRPC playground: `vision.get("space-data-center")` returns shape (with
  capabilities/signals/risks arrays empty — populated by M38)
- Admin `/visions` lists 3 sectors

**Risk**: low. Pure additions to schema, no edits to existing tables.

---

### M37 — The Hero Page (hardcoded SDC showcase)

**Why second**: 이게 product의 정체성을 결정한다. Demo screenshot이 viral
hook. Hardcoded data로 먼저 UI를 완벽하게 만들고 그 다음 M38에서 실제
데이터로 swap.

**Estimated effort**: 4-6 days

**What ships**:
- New route: `/visions/[slug]` (default landing changes to `/visions`)
- `/sectors/[slug]` keeps working as alias for back-compat
- The hero `Overview` page (§3.2 의 ASCII mockup의 Recharts/shadcn 구현)
- Sub-nav: `Overview / Capabilities / Signals / Risks / Economics /
  Playground / Sources`
- All sub-pages skeleton'd but only `Overview` and `Playground` (= old
  `manual`) ship in M37
- Hardcoded JSON data for `space-data-center` in
  `apps/web/src/app/visions/[slug]/_fixtures/space-data-center.json`
  with realistic capability scores, signals, risks
- Component library additions in `packages/ui`:
  - `FeasibilityGauge` (large circle + delta + sparkline)
  - `CapabilityCard` (compact: name + composite + 4-dim bars + latest signal)
  - `RiskRow` (●/○ severity dot + category + description)
  - `SignalRow` (kind icon + title + capability tag + delta arrow)
  - `EconomicsCurveChart` (Recharts dual-line with crossover marker)
- New `/visions` home page: cards for each vision (3 sectors) with
  composite score + last update + 1-line tagline

**Files touched**:
- `apps/web/src/app/visions/page.tsx` — home, replaces `/sectors`
- `apps/web/src/app/visions/[slug]/layout.tsx` — sub-nav, breadcrumbs
- `apps/web/src/app/visions/[slug]/page.tsx` — Overview hero
- `apps/web/src/app/visions/[slug]/playground/page.tsx` — old manual UI
- `apps/web/src/app/visions/[slug]/capabilities/page.tsx` — list (full impl in M38)
- `apps/web/src/app/visions/[slug]/signals/page.tsx` — placeholder
- `apps/web/src/app/visions/[slug]/risks/page.tsx` — placeholder
- `apps/web/src/app/visions/[slug]/economics/page.tsx` — placeholder
- `apps/web/src/app/visions/[slug]/sources/page.tsx` — port of existing sources view
- `apps/web/src/app/visions/[slug]/_fixtures/*.json` — hardcoded sample data
- `apps/web/src/app/sector-picker.tsx` → `vision-picker.tsx` rename
- `apps/web/src/app/sectors/[slug]/*` → keep, mark as legacy
- `apps/web/src/app/sectors/[slug]/sector-nav.tsx` → remove
  `equities`/`compare-stocks` tabs (now hidden behind legacy flag)
- `packages/ui/src/feasibility-gauge.tsx`, etc. — new components
- `apps/web/src/app/page.tsx` → redirect to `/visions`

**Tests**:
- Vitest snapshot of hero page DOM with fixture data
- Playwright smoke: `/visions/space-data-center` loads, shows gauge,
  capability cards, signal feed, risk board, economics chart, sub-nav with
  all 7 tabs
- Accessibility: keyboard navigation through capability cards (tab order),
  screen-reader labels on gauge

**Demo verification** (most important — this is the "show, don't tell" gate):
- Open `/visions/space-data-center` cold (no DB)
- See the hero page render exactly as the ASCII mock
- Switch to `Playground` tab → existing slider workflow works
- Switch to `Sources` tab → existing source listing works
- All numbers feel realistic (curated fixture)
- Screenshot must be Twitter-shareable; we should be able to post it with
  caption "Tracking Space Data Centers in real time" and have people click

**Risk**: medium. UI design takes iteration. Mitigate: M37a = wireframe
PR, M37b = polish PR if needed.

---

### M38 — Capability Decomposition for SDC + memory-semi + sofc (manual)

**Why third**: now we replace fixture data with real DB-backed
capabilities. Hand-curate first (M38), agent-curate later (M41).

**Estimated effort**: 3-4 days

**What ships**:
- Manual seed scripts: `packages/db/prisma/seed-capabilities.ts` that
  upserts ~8-12 capabilities per vision for all 3 sectors. Each
  capability has:
  - name, short_name, description, rationale, weight, primary_driver_name
  - initial CapabilityScore row (`is_current=true`) with hand-curated
    4-dim numbers based on current public info (cited in admin UI)
  - dependencies (a few per capability — DAG)
- Same for ~3-5 risks per vision (`seed-risks.ts`)
- One initial VisionFeasibility row per vision (`seed-feasibility.ts`)
- Wire seeds into `db-migrate` chain after `seed:graph`
- Replace hero page fixtures with tRPC calls — `vision.get(slug)` now
  returns DB data, page renders identically
- Capability detail page (`/visions/[slug]/capabilities/[key]`) implemented:
  - 4-dim bar breakdown with explanations per dim
  - Time-series chart of composite score (CapabilityScore history)
  - Dependencies (incoming + outgoing) as a small graph
  - Signals filtered to this capability
  - "What would unblock this" — agent-written rationale (manual for now,
    LLM in M41)

**Files touched**:
- `packages/db/prisma/seed-capabilities.ts` (new)
- `packages/db/prisma/seed-risks.ts` (new)
- `packages/db/prisma/seed-feasibility.ts` (new)
- `packages/db/prisma/seed-data/visions/space-data-center.json` —
  curated capability+risk data
- (same for memory-semi.json, sofc.json)
- `docker-compose.yml` `db-migrate` chain — add 3 new seed calls
- `services/sector-service/src/repo/capability.ts` — fetch with relations
- `apps/web/src/app/visions/[slug]/capabilities/[key]/page.tsx` — new
- `apps/web/src/app/visions/[slug]/page.tsx` — wire to tRPC
- Hero page fixture deletion (`_fixtures/*.json`) — only kept as e2e test
  fallback

**Tests**:
- DB seed integration: each vision has ≥5 capabilities, ≥3 risks, 1
  feasibility snapshot, all capabilities have `is_current=true` score
- tRPC `vision.get` returns full graph
- Playwright: hero page renders the same regardless of fixture vs DB
- Cycle detection in `CapabilityDependency` (no self-cycles)

**Demo verification**:
- Clean `docker compose up` → SDC vision page shows ~10 hand-curated
  capabilities with real-feeling numbers
- Click capability → detail page shows breakdown
- Each capability's `primary_driver_name` matches a real driver in the
  Playground tab

**Risk**: medium. The curation work itself is non-trivial — needs deep
domain reading. Mitigate: time-boxed per vision (1 day each).

---

### M39 — Signal Ingest Pipeline (arXiv → patents → news → policy)

**Why fourth**: signals make the platform "living." Without them,
capability scores are static and product is just a static report.

**Estimated effort**: 6-8 days (multiple adapters)

**What ships**:
- New service module: `services/data-pipeline/data_pipeline/signals/`
  - `base.py` — `SignalSource` Protocol (similar to existing `DataSource`)
  - `arxiv.py` — arXiv API adapter (free, no key)
    - Daily: query arXiv categories cs.AR/cs.AI/astro-ph/cond-mat/physics
      by keyword sets per capability
    - Each result → `Signal` row with `source_kind=paper`
  - `uspto.py` — USPTO PatentsView API
    - Daily: search patents by keyword sets per capability
    - `source_kind=patent`
  - `newsapi.py` — NewsAPI.org (free tier 100 req/day, fine for cron)
    - Daily: search top news by capability keywords
    - `source_kind=news`
  - `arxiv_keywords.json`, `news_keywords.json` etc. — per-capability
    keyword sets (M38에서 capability table에 추가한 field 활용)
  - Future: `kipo.py` (Korean patents), `gov_feeds.py` (USTR, OSTP,
    Federal Register, Korea NTIS RSS) — Phase 3
- New cron in `data-pipeline/main.py`:
  - `SIGNAL_INGEST_CRON_DAILY=0 9 * * *` (UTC, 18:00 KST)
  - Each adapter run sequentially, throttled
- **Signal Extractor Agent** (`services/agent-orchestration/agent_orchestration/workflows/signal_extractor.py`):
  - Input: raw signal (title + summary + capability context)
  - Output: per-dimension delta scores (technical/economic/regulatory/supply)
    + `is_highlight: bool`
  - Tier: haiku (cheap, runs ~100-1000x/day)
  - Pydantic schema: `SignalScoring`
- HTTP endpoint in agent-orchestration: `POST /signal-extractor/score`
- Wired: data-pipeline ingests raw signal → POSTs to extractor → updates
  Signal row with deltas
- Hero page Signals tab implemented: chronological feed, filters
- Old `INGEST_SOURCE=yfinance`, `INGEST_SCHEDULE=on`,
  `REFRESH_FINANCIALS_CRON` → defaults flipped to off

**Files touched**:
- `services/data-pipeline/data_pipeline/signals/*.py` (new)
- `services/data-pipeline/data_pipeline/jobs/signal_ingest.py` (new)
- `services/data-pipeline/data_pipeline/scheduler.py` — register cron
- `services/data-pipeline/data_pipeline/main.py` — `/jobs/signal-ingest`
- `services/agent-orchestration/agent_orchestration/workflows/signal_extractor.py` (new)
- `services/agent-orchestration/agent_orchestration/schemas.py` — `SignalScoring`
- `services/agent-orchestration/agent_orchestration/main.py` — `/signal-extractor/score`
- `prompts/signal_extractor.md` (new)
- `apps/web/src/app/visions/[slug]/signals/page.tsx` — full impl
- `packages/db/prisma/migrations/...` — Signal indexes if needed
- `.env.example` — NEWSAPI_KEY, signal cron vars

**Tests**:
- Per-adapter pytest with mocked HTTP (vcr or aioresponses)
- Signal extractor agent eval: 10 hand-curated signals, assert
  extractor scores within ±2 of human label per dimension
- Integration: ingest → extract → DB → render in Signals tab
- arXiv/NewsAPI rate limit handling (backoff)

**Demo verification**:
- Trigger signal ingest manually: `POST /jobs/signal-ingest` →
  watch logs → see Signals tab fill with last 24h of arXiv papers about
  "radiation hardening", "in-space optical communications", etc.
- Each signal has a non-null `capability_id` and at least 1 non-null
  `delta_*` from extractor
- Hero page "Live Signals" panel shows latest 5

**Risk**: high. External APIs flaky, extractor quality variable. Mitigate:
- Start with arXiv only (most reliable) for M39a
- Add NewsAPI for M39b
- Add USPTO for M39c
- Each adapter is an independent commit

---

### M40 — Feasibility Scoring Engine

**Why fifth**: with capabilities + signals + score history flowing, we
need the math that rolls it all up into a single Feasibility Index.

**Estimated effort**: 4-5 days

**What ships**:
- New Python module `services/simulation-service/simulation_service/feasibility/`:
  - `aggregator.py` — per-capability composite from 4 dimensions
    (configurable weighted mean with binding-constraint logic)
  - `vision_aggregator.py` — vision composite from capabilities (Liebig's
    law: vision score ≤ binding capability's composite × softening factor)
  - `eta.py` — ETA inference from score trajectory (linear extrapolation
    with confidence band; later: logistic curve fit)
  - `delta.py` — 90d delta calc from `CapabilityScore` history
- Cron job: `recompute_feasibility.py`
  - Reads latest scores + recent signals
  - For each capability: re-aggregates 4-dim → composite
  - For each vision: re-aggregates capabilities → vision composite + ETA
  - Writes new `CapabilityScore` (`is_current=true`, old → `is_current=false`)
  - Writes new `VisionFeasibility` snapshot
- Score Updater Agent (`agent-orchestration`):
  - Trigger: new signal with non-null deltas arrives
  - Reads recent signals for the capability (last 30d)
  - Recomputes dimension scores (current + delta accumulation, with decay)
  - Schema: `CapabilityScoreUpdate`
  - Tier: sonnet (reasoning over 30d of signals)
- Hero page trajectory sparkline + ETA window + binding capability
  callout now wire to real `VisionFeasibility` history
- Capability detail page time-series chart wires to real
  `CapabilityScore` history

**Files touched**:
- `services/simulation-service/simulation_service/feasibility/*.py` (new)
- `services/simulation-service/simulation_service/main.py` —
  `/feasibility/recompute/{slug}` endpoint
- `services/data-pipeline/data_pipeline/jobs/recompute_feasibility.py`
  (new cron)
- `services/agent-orchestration/agent_orchestration/workflows/score_updater.py` (new)
- `services/agent-orchestration/agent_orchestration/schemas.py` — `CapabilityScoreUpdate`
- `prompts/score_updater.md` (new)
- `services/sector-service/src/trpc/vision.ts` — already has
  `feasibility.history`; ensure pagination

**Tests**:
- `tests/feasibility/test_aggregator.py` — golden cases for binding
  constraint logic (low capability caps vision score)
- `tests/feasibility/test_eta.py` — synthetic trajectory → ETA matches
  hand-computed linear extrapolation
- Score updater eval: 5 capability + signal-bundle scenarios → expected
  score shifts
- End-to-end: ingest signal → extractor → updater → vision recompute →
  hero page shows new score within 1 cron tick

**Demo verification**:
- Manually create a fake "breakthrough" signal in SDC's rad-hard
  capability with delta_technical=+10
- Run recompute → see hero page composite shift, "Latest signal"
  callout update
- See trajectory sparkline gain a new point

**Risk**: medium. Aggregation logic has edge cases (no current score,
sparse data, divergent dimensions). Mitigate: start with
weight-mean-only, add binding constraint in M40b.

---

### M41 — Vision Builder Agent (one-line vision → full capability tree)

**Why sixth**: this is the universalization step. With M36-M40, SDC works.
M41 makes it work for *any* vision the user can phrase.

**Estimated effort**: 6-8 days

**What ships**:
- Reshape existing agent workflows to vision-feasibility purpose:
  - `decomposition_workflow` → `VisionDecomposition` (was: sector tree;
    now: vision → ~8-12 capabilities, each with 4-dim baseline + initial
    rationale + keyword set for signal ingest + 1 sentence "why this
    matters")
  - `research_workflow` → `VisionResearch` (was: general research; now:
    targeted at "what does this vision require to happen?")
  - `driver_inference_workflow` → `CapabilityToDriver` (link each
    capability to a measurable slider — uses existing Driver concept)
  - `edge_inference_workflow` → `CapabilityDependencies` (which
    capabilities block which)
  - `code_gen_workflow` → `CapabilityScoringCode` (Python code that takes
    raw signals + capability state and produces scores)
  - `code_review_workflow` → unchanged but reviews scoring code
- New Pydantic schemas in `agent_orchestration/schemas.py`:
  - `VisionDecompositionResult { capabilities: list[CapabilityDraft], risks: list[RiskDraft], rationale: str }`
  - `CapabilityDraft { key, name, description, rationale, weight, primary_driver_name, initial_scores: dict[str, float], keywords: list[str] }`
  - `RiskDraft { key, category, name, description, severity, likelihood, time_horizon, affected_capability_keys }`
- Admin UI flow `/visions/new`:
  - Form: vision title + one-paragraph description
  - Click "Generate" → kicks off Conductor workflow:
    1. VisionResearch (Gemini sonnet) — gather context
    2. VisionDecomposition (Claude opus) — capability tree
    3. CapabilityScoringCode (Claude opus) — scoring functions
    4. CodeReview (Claude opus)
    5. Admin approval checkpoint
    6. SignalKeywordExpander (haiku) — expand keywords for ingest
    7. Persist → ready
  - Total estimated cost per new vision: ~$2-5 (opus heavy)
- Cost meter visible in admin during generation

**Files touched**:
- `services/agent-orchestration/agent_orchestration/workflows/vision_*.py` (rename/rework existing)
- `services/agent-orchestration/agent_orchestration/schemas.py` — new schemas
- `prompts/vision_research.md`, `prompts/vision_decomposition.md`,
  `prompts/capability_scoring_code.md` (new/rewritten)
- `apps/admin/src/app/visions/new/page.tsx` (rework existing
  `/agent-runs/new`)
- `apps/admin/src/app/visions/[slug]/review/page.tsx` — approval flow
- `services/sector-service/src/trpc/vision.ts` — `propose`, `approve`
  procedures

**Tests**:
- Eval set `tests/agent-evals/vision-decomposition/cases.yaml` — 5 known
  visions (SDC, fusion, quantum, humanoid, mRNA-cancer), expected
  capability count ranges, key capability names must appear
- End-to-end: propose vision → workflow completes → DB has all rows

**Demo verification**:
- Type "Will commercial fusion power reach grid parity by 2040?" in
  `/visions/new`
- Watch workflow log
- Admin approval page shows ~10 capabilities (plasma confinement, tritium
  breeding, neutron-tolerant materials, supply chain for HTS magnets,
  regulatory licensing, etc.) with reasoned 4-dim baselines
- Approve → new `/visions/fusion-power-grid-parity` is live

**Risk**: high. LLM hallucination of capabilities. Mitigate:
- Prompt eng to force `source_url` per capability draft (citing arXiv/IPCC/IEA)
- Admin approval as backstop
- Cost cap per workflow

---

### M42 — Simulation → Playground (re-positioning, not rebuild)

**Why seventh**: existing simulation infrastructure stays useful but
becomes secondary to the Monitor. This milestone reframes it.

**Estimated effort**: 2-3 days

**What ships**:
- `/visions/[slug]/playground` already shipped in M37 (=old `manual`).
  M42 adds:
- **Capability tie-in**: each Driver shows "primarily affects: [Capability]"
  badge. Sliders that move drivers tied to binding capabilities are flagged.
- **What-if Feasibility**: above the trajectory chart, show "If you set
  drivers to these values, the Feasibility Index would shift by ~Δ"
  (small calc, no agent call — uses driver→capability sensitivity mapping)
- **Scenario → Vision projection**: save-scenario workflow stays, but
  the Vision overview now optionally shows "Your scenarios" panel with
  each scenario's projected Feasibility Index
- Remove sliders/manual from default landing; default is Overview
- Existing causal-graph page demoted: `/visions/[slug]/graph` retained
  as drill-down, not in main sub-nav (accessible from Capabilities
  detail page "Show dependency graph")

**Files touched**:
- `apps/web/src/app/visions/[slug]/playground/page.tsx` (M37 base + this)
- `apps/web/src/app/visions/[slug]/playground/what-if-feasibility.tsx` (new)
- `services/sector-service/src/lib/driver-feasibility-projection.ts` (new
  — uses Capability.primary_driver_name + simple sensitivity map)
- `apps/web/src/app/visions/[slug]/layout.tsx` — sub-nav reorder
- README

**Tests**:
- Playwright: drag slider on playground → what-if Feasibility number
  shifts deterministically
- Unit: projection function golden cases

**Demo verification**:
- Open SDC playground → drag "launch_cost_usd_per_kg" from $1500 to $500
- See "Feasibility would shift +6 (binding capability unchanged)" callout
- Save as scenario → return to Overview → see scenario in "Your scenarios"
  with projected score

**Risk**: low.

---

### M43 — Archive Investment Features Behind Feature Flag

**Why eighth**: now that new IA is proven, hide the old surface so users
don't get confused by two co-existing products.

**Estimated effort**: 1-2 days

**What ships**:
- `ENABLE_LEGACY_INVESTMENT_FEATURES` env flag (default `false`)
- In `apps/web`:
  - `/predict`, `/community`, `/watchlist`, `/my-sectors`, and any
    `/sectors/[slug]/equities`, `/sectors/[slug]/compare-stocks` routes
    → render `<NotAvailable />` placeholder when flag is false, full
    behavior when true
  - `header.tsx` nav links to these → conditional on flag
  - Sector-nav sub-tabs for equities/compare-stocks → removed (already
    done in M37, finalize)
- In `services/data-pipeline`:
  - `INGEST_SCHEDULE` default → `off`
  - `REFRESH_FINANCIALS_CRON` not registered when flag is false
  - `RESOLVE_PREDICTIONS_SCHEDULE` default → `off`
- In `apps/admin`:
  - `/agent-runs` legacy view → kept (still useful for vision
    workflows since they use the same agent_orchestration)
  - Equity curation pages → hidden
- DESIGN.md §14 — banner: "DEPRECATED 2026-05-23. See PIVOT.md."
- README — feature table updated, "legacy investment features" row marked
  archived

**Files touched**:
- `.env.example`, `docker-compose.yml` — new flag
- `apps/web/src/lib/feature-flags.ts` (new)
- All 4 user-facing legacy routes — conditional rendering
- `services/data-pipeline/data_pipeline/scheduler.py` — guards
- `apps/admin/src/app/...` — guards
- `DESIGN.md` — banner
- `README.md`, `docs/tasks/current.md`

**Tests**:
- With flag false: routes return 404/placeholder, sub-tabs absent, cron
  not registered
- With flag true (CI flag): legacy product still works (smoke)

**Demo verification**:
- `docker compose up` clean (flag unset/false) → user app has zero
  investment surface
- Set `ENABLE_LEGACY_INVESTMENT_FEATURES=true` → old surface returns

**Risk**: low.

---

### M44 — Second Showcase Vision (Fusion Power) + Polish

**Why last**: validate that the framework truly generalizes. Pressure-test
the agent + UI on a vision *not* in our hand-curated 3.

**Estimated effort**: 4-6 days

**What ships**:
- Use M41 Vision Builder agent to generate "Commercial Fusion Power Grid
  Parity by 2040" end-to-end
- Hand-edit capabilities/risks to publishable quality (treat agent
  output as draft, admin polishes)
- Seed initial signals manually (a few representative arXiv papers,
  patents, news items so the page isn't empty before next ingest cron)
- Add Playground sim for fusion (basic econ model, 10 drivers — far
  simpler than SDC; deliberately so we test "minimal vision" case)
- Polish: capability detail page improvements based on user feedback
- Polish: signal extractor agent prompt tuning based on real-world data
  (likely 30-50% of extractions need re-prompting)
- Publish public landing at `/visions` with 4 visions: SDC, memory-semi,
  sofc, fusion
- Twitter/X demo thread + screenshot package

**Files touched**:
- `services/simulation-service/simulation_service/sims/fusion_power.py` (new, minimal)
- `services/simulation-service/simulation_service/registry.py` — register fusion
- `packages/db/prisma/seed-data/visions/fusion-power.json` — admin
  polished from agent output
- `apps/web/src/app/visions/page.tsx` — show 4 cards
- `README.md`, `DESIGN.md` — fusion as second canonical example

**Tests**:
- Same battery as M37 + M38 applied to fusion-power
- Playwright e2e on the 4 vision tiles

**Demo verification**:
- `/visions/fusion-power-grid-parity` looks as polished as SDC
- Screenshot of the 4-vision landing page is publishable

**Risk**: medium (agent output quality). Mitigate: budget 2 days for
hand-polish.

---

### Milestone summary table

| ID | Title | Estimated | Risk | Demo target |
|---|---|---|---|---|
| M36 | Capability schema + product language | 2-3d | low | tRPC `vision.get` returns shape |
| M37 | Hero page (hardcoded) | 4-6d | med | Twitter-shareable screenshot |
| M38 | Capability decomp (manual, 3 sectors) | 3-4d | med | Real data on hero page |
| M39 | Signal ingest pipeline | 6-8d | high | Live arXiv/news in Signals tab |
| M40 | Feasibility scoring engine | 4-5d | med | Score shifts on signal arrival |
| M41 | Vision Builder agent | 6-8d | high | New vision from one-liner |
| M42 | Simulation → Playground | 2-3d | low | What-if feasibility shows |
| M43 | Archive investment features | 1-2d | low | User app = pure vision monitor |
| M44 | Fusion as second showcase + polish | 4-6d | med | 4-vision public landing |

**Total**: ~32-45 days. Realistic 8-10 weeks at 1 person + Claude pace.

---

## 6. Business Model Implications

### 6.1 Pricing reframe (정식 결정은 M44 이후로 보류)

기존 `$199/mo Pro` 가격은 "분석가 도구" framing이라 적합하지 않다. 새 product
shape에 맞춘 *제안* (M44 이후 elaborate):

| Plan | $/mo | 대상 | 기능 |
|---|---|---|---|
| **Free** | $0 | curious public, viral 입구 | 모든 vision의 Overview 무제한, 30일 이상 시그널 archive 잠금 |
| **Pro** | $20 | engineer / founder / journalist | 무제한 signal archive, 알림, 워치리스트, custom view |
| **Team** | $200 (5 seats) | corp dev / VC team | + private notes, internal share, vision watchlist sharing |
| **Custom** | inquire | enterprise / govt | + custom vision commissioning ($25k-$50k/vision), API, on-prem |

이 가격이 우리가 처음 적었던 unit economics 가설보다 *낮다*. 그러나 viral
coefficient는 훨씬 높다. Trade-off가 product-led growth 쪽으로 옳다.

### 6.2 Go-to-market: media + viral

- **Weekly newsletter**: "Vision Feasibility Update" — 매주 1개 vision의
  주간 변화. screenshot + 짧은 narrative.
- **X / LinkedIn**: 매일 1개 signal의 highlight. "🚀 Lonestar Data closed
  $48M — moves SDC Feasibility Index from 71 to 73."
- **Press / podcast**: 기자가 "AI feasibility"를 쓸 때 우리 monitor를
  cite하도록 만든다. (CB Insights가 fundraising 통계의 source가 된 것처럼)
- **공개 demo**: SDC monitor는 회원가입 없이 공개. embed code 제공
  ("paste this 240px iframe to your blog post").

### 6.3 Pricing pause

M36-M44 동안 monetization 작업은 *완전 보류*. Stripe integration은 있지만
flag로 off. M44 ship 후 50명 organic 사용자 reach까지 무료. 그 후 가격
실험.

---

## 7. Risks & Mitigations

| 리스크 | 영향 | 가능성 | 완화 |
|---|---|---|---|
| LLM이 capability를 환각하거나 너무 일반적으로 분해 | 매우 높음 | 높음 | M41 Vision Builder에서 capability별 `source_url` 강제, admin approval checkpoint, eval set |
| Signal extractor noise (관련 없는 paper로 score 변동) | 높음 | 높음 | extractor 출력에 confidence score, low confidence면 score update skip; capability별 keyword tuning iteration |
| Hero page의 "73/100" 같은 숫자가 자의적/믿을 수 없어 보임 | 매우 높음 | 매우 높음 | 모든 점수 hover → drill-down to source signals + scoring rationale; Sources tab은 일급 시민 |
| 한 가지 vision (SDC)에 너무 fitting되어 framework가 다른 visions에 안 맞음 | 높음 | 중 | M44에서 fusion으로 cross-pressure-test; eval set는 5 visions |
| 투자 도구 사용자가 archive에 불만 | 중 | 중 | flag로 켤 수 있게 retain; 24 시간 안에 켜고 끌 수 있음 |
| Founder bandwidth (1인, 8-10주 stretch) | 매우 높음 | 매우 높음 | milestone을 진짜 slice 단위로 ship — 매 PR 빌드/머지 가능, 6주 안에 M37까지는 무조건 |
| 새 사용자에게 "이게 뭔지" 5초 안에 안 보임 | 매우 높음 | 중 | hero page UI를 polish하는 데 의도적으로 시간 투자 (M37+M44 두 번 iteration) |

---

## 8. Founder Calls (made now, override-able)

1. **DB column rename = NO**. 비용 대비 가치 적음. Product language는
   product에서, DB language는 DB에서 분리.
2. **First showcase = SDC** (이미 있다, deeply curated). Second = Fusion
   (well-known, 명확한 capability tree).
3. **Investment features = archive behind flag, not delete**. 데이터 손실
   불가, reversibility 유지.
4. **Pricing pause until M44**. Monetization < product proof right now.
5. **No new infra (Temporal Cloud, Modal sandbox 등) in pivot scope**.
   Pivot ships on existing infra. Sandbox는 M28b 그대로 backlog.
6. **Bilingual UI: ko default, en parity**. Vision 이름/설명은 두 언어로
   저장 (i18n field on Capability/Risk). Twitter share-ability 위해 영어
   필수.

---

## 9. What changes immediately (acceptance for starting M36)

- [x] PIVOT.md written and committed to repo
- [ ] `docs/tasks/current.md` rewritten — pivot becomes top priority,
      legacy backlog deferred
- [ ] M29 (OAuth), M30 (multi-tenant), M31 (backtest harness) tasks
      marked deferred
- [ ] DESIGN.md §1 leading paragraph updated with new framing (full
      DESIGN.md rewrite is M36 deliverable, not now)
- [ ] User confirms PIVOT.md direction (override any §8 founder call if
      needed) **← gating step before M36 starts**

---

## 10. Reconciliation with prior docs

| Prior doc | Section | Status |
|---|---|---|
| DESIGN.md | §1 (Vision) | KEEP (still accurate at high level) — minor edit to lead with feasibility framing |
| DESIGN.md | §2 (Personas) | KEEP, reorder priority to VC + curious eng |
| DESIGN.md | §3 (Domain model) | EXTEND with Capability/Signal/Risk; Sector retained |
| DESIGN.md | §4 (Features F1-F7) | KEEP F1-F5, reframe F6/F7 |
| DESIGN.md | §5 (Agent topology) | KEEP, agent purposes reshape in M41 |
| DESIGN.md | §6 (System arch) | KEEP, +signal ingest sub-tree |
| DESIGN.md | §7 (NFRs) | KEEP |
| DESIGN.md | §8 (UX) | UPDATE §8.5 sitemap (`/visions` family) — see M37 |
| DESIGN.md | §9 (Roadmap Phases) | SUPERSEDED by §5 above (this doc) |
| DESIGN.md | §10 (Business model) | SUPERSEDED — §6 above |
| DESIGN.md | §11 (Risks) | KEEP, additive |
| DESIGN.md | §12 (Metrics) | UPDATE — new NSM: "Weekly Vision Visits + Signal Click-throughs" |
| DESIGN.md | §13 (Open Q) | CLOSED — pivot answers most |
| DESIGN.md | §14 (Equities) | DEPRECATED, see §1.5 above |
| docs/tasks/current.md | All Phase 2.5 backlog | DEFERRED — M36+ replaces |
| CLAUDE.md | "Current Phase" section | Update to Phase 3 — Vision Monitor (pivot) |

DESIGN.md 풀 rewrite는 M36 ship 시점 (말미)에 일괄. PIVOT.md가 그동안은
source of truth.

---

## Appendix A — Why "Vision" is the right top-level abstraction

대안 명사 검토:
- "Sector" — 너무 industrial, 투자 색깔 강함. ❌
- "Initiative" — 정부/사내 program 느낌. ❌
- "Frontier" — 모호. "Tech Frontier"는 nice 하지만 무엇이 frontier인지 불분명. △
- "Mission" — 한 회사가 추구하는 것 느낌. ❌
- "Future" — 너무 무겁고 generic. ❌
- **"Vision"** — bold question, 누가 답을 모르는 미래, 모니터링 대상. ✅
- "Bet" — Polymarket 느낌이라 게임화. △ (가능한 sub-brand)
- "Horizon" — 좋지만 회사명에 너무 많이 쓰임. △

결정: **Vision**. 백업: "Frontier" (브랜드 이름이 Vision Monitor → Horizon
Monitor로 진화할 수 있음).

## Appendix B — Naming the platform

현재 monorepo 이름 `sector-simulator-platform`은 이제 부적절. 후보:

- **Horizon** — "see the next horizon of technology"
- **Threshold** — "when does each vision cross the threshold?"
- **Convergence** — "when capabilities converge into a vision"
- **Liftoff** — playful, space pun-ish
- **Critical Path** — direct, geeky
- **Watchpoint**

생각: **Horizon** if available domain-wise. 이건 M44 이후 결정. 지금은
monorepo 이름 안 바꾼다.

---

## 11. Extension Milestones — Actor domain + Community 2.0 (M45-M47)

**Added 2026-05-23 (post-M37 close)** after founder review identified two
gaps in the M36-M44 plan:

1. **Actor analysis layer missing**. The Hero shows capabilities,
   signals, risks, and economics — but not the *who*. Each capability has
   companies, labs, and government bodies competing to advance it; that
   competitive landscape is the strongest "is this real?" signal a user
   can read at a glance. Country + ticker (when listed) make this
   immediately actionable for VCs / corp dev / journalists.

2. **Community in current state is a stock-prediction game**.
   `/community/predict` is residue of the investment surface. The right
   community mechanic for a Vision Monitor is per-vision *proposals*
   (new actor, new data source, capability score challenge, …) with
   voting + admin-applied changes. This is Wikipedia-meets-Polymarket
   for tech visions — a moat over time as community curation
   compounds.

Both extensions slot into the existing pivot direction; neither requires
revisiting M36-M44 fundamentals. They add 3 new milestones after M44 (or
M45a slotted before M38 for the Hero demo lift — see §11.4).

### 11.1 Actor — domain model

```
Actor                                       "SpaceX"
  ├─ key, name, country, category            "spacex, SpaceX, US, public_corp"
  ├─ ticker + exchange (when public)         "SPCX, NYSE" (mock for now)
  ├─ stage                                   "scaling"
  ├─ blurb / description / website / logo
  └─ signal_keywords[]                       ["SpaceX", "Starship", "Starlink"]

VisionActor                                  Vision ↔ Actor M2M
  ├─ relevance (0-100)
  ├─ rationale                               "Starship is the cheap-launch
                                              story — primary catalyst for
                                              orbital DC economics"
  └─ display_order

CapabilityActor                              Capability ↔ Actor M2M
  ├─ role                                    "lead | competitor | supplier |
                                              customer | regulator"
  ├─ stage (override)
  └─ rationale

Signal                                       extends existing
  └─ actor_id (FK, nullable, single-actor)   tagged by extractor agent
```

**Schema notes**:
- `Actor` is a *global* entity (one row per real-world company/lab).
  Same Actor can be relevant to multiple Visions via VisionActor.
- `CapabilityActor` is the per-Capability wiring — lets the hero show
  "In-orbit thermal: Starcloud + ESA + JPL" at the bottom of the
  thermal capability card.
- The deprecated `SectorEquity` table is NOT repurposed; Actor is
  schema-fresh. Backfill from existing SectorEquity rows is a manual
  one-shot script at M45b (we keep what's useful: ticker, exchange,
  iso_country, company_name).
- `signal_keywords` powers the M47 extractor enhancement that tags
  signals with `actor_id`.

### 11.2 Community 2.0 — domain model

Replaces the archived stock-prediction game with a structured
proposal/voting mechanism + free-form discussion threads, both anchored
to each Vision.

```
VisionProposal                              per-vision change request
  ├─ sector_slug, user_id
  ├─ kind                                   "ADD_ACTOR | ADD_DATA_SOURCE |
                                             ADD_CAPABILITY |
                                             REVISE_CAPABILITY_SCORE |
                                             FLAG_SIGNAL | REWORD_RISK |
                                             ADD_RISK | ADD_NEW_VISION"
  ├─ title, body
  ├─ payload                                JSONB kind-specific detail
  │                                         (e.g. proposed Actor draft,
  │                                          score evidence URLs, ...)
  ├─ status                                 "open | review | approved |
                                             rejected | applied | withdrawn"
  ├─ score                                  net votes (denormalized)
  ├─ applied_audit_log_id                   set when admin applies → links
  │                                         to the resulting mutation
  └─ admin_decision_reason                  set on approve/reject

VisionProposalVote                          one row per (user, proposal)
  ├─ value                                  +1 | -1

VisionDiscussion                            free-form per-vision thread
  ├─ sector_slug, user_id
  ├─ title, body
  ├─ score, pinned, locked
  └─ comments[]

DiscussionComment                           reply on a discussion
  ├─ parent_comment_id (nullable)
  ├─ body
  └─ score

DiscussionVote                              user vote on thread or comment
```

**Flow**:
1. User submits Proposal (e.g. ADD_ACTOR with payload `{key, name,
   country, ticker, capabilities[]}`)
2. Other users vote (+1 / -1)
3. Hits threshold (default +5 net) → status "review"
4. Admin sees in queue at `/admin/proposals`
5. Admin approves → tRPC mutation applies the change (`actor.upsert`,
   `capability.upsertScore`, etc.) + writes audit log + Proposal row
   gets `status=applied`, `applied_audit_log_id=...`
6. Admin rejects → status "rejected" with reason

For kinds that don't need admin (e.g., FLAG_SIGNAL, which just hides
the signal pending review), auto-apply when threshold hit. Each kind
has a configurable approval policy.

**Discussion** is separate from proposals — Reddit-style threads + nested
comments + up/down votes. Discussions can be a SOURCE for proposals
("we've been arguing about this for a week; let me submit a formal
proposal").

### 11.3 New milestones

**M45 — Actor domain + Hero integration**

Two sub-PRs split by demo lift vs DB depth:

- **M45a** (executable BEFORE M38 for Hero demo lift, optional dependency
  on it): Actor schema + tRPC routers + Hero "Actors" band + Capability
  card "active actors" footer + sub-nav "Actors" tab. Fixture-backed for
  SDC so the Hero shows ~10 actors immediately. 4-5 days.
- **M45b** (after M38, depends on capability data): manual Actor seed
  for 3 visions + CapabilityActor wiring + replace fixture with DB.
  Includes optional backfill script from deprecated SectorEquity rows.
  2-3 days.

Files: `packages/db/prisma/schema.prisma` (3 new models), Prisma
migration, `services/sector-service/src/trpc/actor.ts` (new), Hero page
+ Capability card updates, `packages/ui/actor-card.tsx` (new),
`packages/db/prisma/seed-actors.ts` (new), `seed-data/actors/<vision>.json`.

**M46 — Community 2.0: VisionProposal schema + voting + admin queue**

- Prisma models: VisionProposal, VisionProposalVote (the existing
  deprecated `SectorSuggestion` stays archived).
- tRPC: `proposal.list / get / create / vote / withdraw / adminApprove /
  adminReject`.
- Routes:
  - `/visions/[slug]/community` (vision-anchored proposal hub)
  - `/visions/[slug]/community/new` (proposal submit form, kind picker)
  - `/visions/[slug]/community/[id]` (proposal detail + voting)
  - `/admin/proposals` (admin queue, group by status)
- The "approve → apply" pipeline for each `kind`:
  - `ADD_ACTOR`: extract Actor draft from payload, call `actor.upsert`
  - `ADD_DATA_SOURCE`: append to per-vision `signal_keywords` JSON
    config (M39 ingest re-reads on next cron)
  - `ADD_CAPABILITY`: call `capability.upsert` with payload contents
  - `REVISE_CAPABILITY_SCORE`: write a new CapabilityScore row with
    `rationale` referencing the proposal id; old score → `is_current=false`
  - `FLAG_SIGNAL`: set `Signal.is_hidden=true` (new column)
  - `REWORD_RISK`: call `risk.upsert`
  - `ADD_RISK`: call `risk.upsert` (create)
  - `ADD_NEW_VISION`: kick off Vision Builder agent (M41) with the
    proposal text — heavyweight, admin sets priority
- 5-7 days.

**M47 — Discussions + reputation system (optional polish)**

- VisionDiscussion + DiscussionComment + DiscussionVote tables.
- `/visions/[slug]/community/discuss` thread index + detail pages.
- Reputation: per-user proposal-approval-rate + comment-score average →
  voting weight multiplier (1.0× default → up to 2× for top
  contributors). Applied in M46's score aggregation.
- Optional badges UI ("contributor", "top author") on user mentions.
- 4-5 days.

### 11.4 Execution sequence

The 8-week M36-M44 plan extends to 12-13 weeks with M45-M47.

| Week | Milestone | Demo lift |
|---|---|---|
| 1 | M36 ✅ | foundation |
| 2 | M37 ✅ | hero demo |
| **3** | **M45a — Actor Hero band (fixtures)** | "now I can see WHO is building this" |
| 3-4 | M38 — capability + actor manual seed (incl. M45b) | hero on real DB |
| 5-6 | M39 — signal ingest + actor tagging | live data |
| 6-7 | M40 — feasibility engine | scores move automatically |
| 7-8 | M41 — Vision Builder agent (incl. actor generation) | any vision in 24h |
| 9 | M42 — Playground re-position | what-if feasibility |
| 9 | M43 — archive legacy investment | one product message |
| 10 | M44 — Fusion + polish | public launch ready |
| **11-12** | **M46 — Community 2.0: proposals + voting + admin** | community-curated |
| **13** | **M47 — discussions + reputation (optional)** | engagement layer |

Net effect: Actor work integrates **into** M38 (capability seed), M39
(signal pipeline), M41 (Vision Builder agent) — those milestones grow
slightly in scope but don't lengthen calendar time materially (the
existing Capability data structures inform the Actor parallels — fewer
unknowns).

Community 2.0 is a clean two-milestone train after the foundation
ships (M44). Doing it earlier risks shipping a community surface with
no community yet.

### 11.5 Why not just resurrect the equity surface?

The existing `SectorEquity` table has ticker + exchange + iso_country —
~80% of what Actor needs. Why not just un-deprecate it?

Reasons we go with a fresh Actor model:
- **`driver_links` JSONB** (per-equity revenue exposure to drivers) is
  investment-frame and irrelevant to the Vision narrative.
- **`sector_exposure_pct`** is also investment-frame (what % of revenue
  comes from this sector); for Actor we want "relevance" not "exposure."
- **No good place to put labs / govt / standards bodies** in
  SectorEquity — it requires a `ticker` which doesn't apply to NASA or
  KAIST.
- **Per-capability wiring** doesn't exist in the equity surface
  (driver_links links to drivers, not capabilities).
- **Migration churn**: renaming columns + dropping JSONB columns +
  adding new relations is *more* work than starting fresh, given the
  schema is purpose-built.

So Actor is a new model. M45b includes a one-shot backfill script that
reads SectorEquity rows and proposes Actor drafts (admin reviews +
saves). Existing SectorEquity rows stay frozen behind the legacy flag.

### 11.6 Why community is *after* the rest

Order argument:
- Actor seed adds the "WHO" — concrete and visible
- Community proposals require actors/capabilities/data sources to
  PROPOSE INTO. Building community before the data layer is mature
  yields shallow proposals.
- Community is most valuable when there's signal that the platform is
  going somewhere — M44 (4 visions, fusion + SDC published) is the
  natural moment.
- Reputation system (M47) requires real proposal flow data — needs ≥4
  weeks of M46 in production to calibrate weights.

---

*End of PIVOT.md §11 extension. Next action: write REFACTOR.md §18-§19
for M45-M47 file-by-file disposition, then start M45a.*
