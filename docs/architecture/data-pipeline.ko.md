# 🚀 섹터 가능성 및 데이터 파이프라인 아키텍처 (README.ko.md)

이 문서는 기술 비전(Vision)이 진짜 실현 가능한지 모니터링하는 **Vision Feasibility Monitor**의 뼈대가 되는 데이터 모델(ERD)과, 이를 뒤에서 실시간으로 든든하게 받쳐주는 **데이터 파이프라인(Data Pipeline) 서비스**의 작동 원리를 다룬다. 주기적으로 데이터를 긁어오고(Ingestion) 업데이트하는 배치 작업의 전체적인 구조를 최대한 이해하기 쉽게 정리했다.

---

## 1. 핵심 데이터 모델 및 관계 명세

우리 데이터베이스 스키마(`schema.prisma`)를 뜯어보면 다음과 같은 구조로 설계되어 있다. 가장 기본이 되는 **비전(Sector/Vision)**을 중심으로 여러 테이블들이 유기적으로 얽혀 있다.

### 📊 1.1 한눈에 보는 데이터 관계도 (Pure Markdown Relation Map)

다이어그램 이미지 없이 텍스트와 선만으로 테이블 간의 관계를 알기 쉽게 도식화했다.

```text
[ Sector (Vision) ] ── (1:1) ── [ InvestmentThesis ]
       │
       ├─ (1:N) ── [ Capability ] 
       │                 │
       │                 ├─ (1:N) ── [ CapabilityScore (최신 점수) ]
       │                 ├─ (N:M) ── [ CapabilityDependency (DAG) ]
       │                 └─ (M:N) ── [ CapabilityActor ] ── (N:1) ── [ Actor ]
       │                                                                │
       ├─ (1:N) ── [ Signal (외부 증거) ] ────── (N:1, Optional) ───────┘
       ├─ (1:N) ── [ Risk (저해 요소) ]
       ├─ (1:N) ── [ VisionFeasibility (Bayesian 합산) ]
       ├─ (1:N) ── [ Catalyst (마일스톤 일정) ]
       ├─ (1:N) ── [ EconomicsDatapoint (단가 정보) ]
       └─ (M:N) ── [ VisionActor (주체 플레이어) ] ── (N:1) ── [ Actor ]
```

*   **1:N (일대다)**: 비전 하나(`Sector`) 아래에 여러 개의 세부 능력(`Capability`), 팩트 조각(`Signal`), 방해 요소(`Risk`), 종합 점수 스냅샷(`VisionFeasibility`), 주요 일정(`Catalyst`), 비용 차트 데이터(`EconomicsDatapoint`)가 연결된다.
*   **1:1 (일대일)**: 비전 하나당 딱 하나의 투자 투자 핵심 논리(`InvestmentThesis`)가 맵핑된다.
*   **M:N (다대다 조인)**: 
    *   비전과 플레이어(`Actor`)는 `VisionActor` 테이블을 징검다리 삼아 다대다로 엮인다.
    *   세부 능력과 플레이어 또한 `CapabilityActor` 테이블을 거쳐 연결된다.
*   **자기 참조 N:M (의존성 그래프)**: 세부 능력끼리 서로 꼬리를 물고 의존하는 관계(DAG)는 `CapabilityDependency` 테이블이 중간에서 풀어준다.
*   **선택적 N:1 (있을 수도 있고 없을 수도 있는 관계)**: 하나의 외부 증거(`Signal`)가 특정 세부 능력(`Capability`)이나 플레이어(`Actor`)를 가리킬 수 있다. 필수가 아니라 널값(Null)을 허용한다.

---

### 📋 1.2 테이블별 핵심 역할과 스키마 상세 설명

각 테이블이 어떤 역할을 하고, 어떤 키값과 제약 조건을 가졌는지 알짜배기 정보만 표로 요약했다.

| 테이블명 (Prisma 모델) | 진짜 하는 일 (역할) | 뼈대 필드 (PK / FK / Unique) | 다른 테이블과의 관계 | 꼭 알아야 할 특이사항 |
| :--- | :--- | :--- | :--- | :--- |
| **`Sector`** (`sectors`) | **기술 비전**<br>- "2040년까지 상용 핵융합 발전이 가능할까?" 같은 굵직한 질문과 설명을 담는다. | - **PK**: `id` (cuid)<br>- **Unique**: `slug` (비전 식별용 단어) | - **1:N**: `Capability`, `Signal`, `Risk`, `VisionFeasibility`, `Catalyst`<br>- **1:1**: `InvestmentThesis` | - `is_vision_eligible` 필드로 대시보드에 보여줄지 숨길지 똑똑하게 가려낼 수 있다. |
| **`Capability`** (`capabilities`) | **세부 능력 요건**<br>- 비전을 이루기 위해 꼭 필요한 기술, 경제, 공급망 요건들이다. | - **PK**: `id` (cuid)<br>- **FK**: `sector_slug` -> `Sector.slug`<br>- **Unique**: `[sector_slug, key]` | - **N:1**: `Sector`<br>- **1:N**: `CapabilityScore`, `Signal`<br>- **M:N DAG**: `CapabilityDependency`<br>- **M:N**: `Actor` (via `CapabilityActor`) | - `signal_keywords` 배열 필드를 품고 있어서 데이터 파이프라인이 시그널을 긁어오는 검색 키워드로 다이렉트 활용한다. |
| **`CapabilityScore`** (`capability_scores`) | **4차원 점수 기록**<br>- 세부 능력의 성숙도를 다각도로 평가해 추적하는 시계열 데이터다. | - **PK**: `id` (cuid)<br>- **FK**: `capability_id` -> `Capability.id` | - **N:1**: `Capability` | - 기술, 경제, 규제, 공급망 4가지 차원의 평점을 보관한다.<br>- 여러 평점 스냅샷 중 **`is_current = true`** 인 녀석이 진짜 실시간 최신 점수다. |
| **`Signal`** (`signals`) | **수집된 팩트 증거**<br>- 논문, 특허, 업계 뉴스, 정부 발표 등 외부에서 긁어온 진짜 증거들이다. | - **PK**: `id` (cuid)<br>- **FK**: `sector_slug` -> `Sector.slug`, `capability_id` (Null 허용), `actor_id` (Null 허용) | - **N:1**: `Sector`, `Capability` (선택), `Actor` (선택) | - **`@@unique([source_url, capability_id])`** 복합 유니크 조건 덕분에 중복 뉴스가 여러 번 들어와 비싼 LLM 요금이 중복 지출되는 불상사를 원천 차단한다. |
| **`Risk`** (`risks`) | **저해 요소 (방해물)**<br>- 기술 외적으로 발목을 잡는 정치적, 사회적, 법적 위험이다. | - **PK**: `id` (cuid)<br>- **FK**: `sector_slug` -> `Sector.slug` | - **N:1**: `Sector` | - 영향받는 능력들의 key를 `affected_capability_keys` 문자열 배열에 직접 넣어두어 조회가 엄청 빠르다. |
| **`Actor`** (`actors`) | **시장 플레이어**<br>- 기술을 주도하는 대기업, 스타트업, 국립 연구소 등의 정보가 들어있다. | - **PK**: `id` (cuid)<br>- **Unique**: `key` | - **M:N**: `Sector` (via `VisionActor`), `Capability` (via `CapabilityActor`) | - 상장 회사라면 `ticker`, `exchange`를 연결해두어 재무 정보를 쉽게 찾아볼 수 있게 돕는다. |
| **`VisionFeasibility`** (`vision_feasibility`) | **종합 지표 스냅샷**<br>- 시뮬레이션을 돌려 완성한 비전의 최종 실현 가능성 점수와 예상 달성 시간표다. | - **PK**: `id` (cuid)<br>- **FK**: `sector_slug` -> `Sector.slug` | - **N:1**: `Sector` | - 종합 점수와 신뢰 구간(P10, P90), 달성 예상 년수(`eta_median_years`)가 여기 모두 기록된다. |
| **`CrawlRun`** (`crawl_runs`) | **파이프라인 이력**<br>- 크롤러와 에이전트가 언제, 어떤 비용을 써서 무엇을 수집했는지 적는 로그판이다. | - **PK**: `id` (cuid) | - *외래키 제약 없음* (기록 유실 방지를 위해 독립 보관) | - 에이전트가 소모한 달러 예산(`cost_usd`)과 유입 성과가 명확히 찍힌다. 어드민 대시보드가 이 테이블을 읽어 헬스케어를 보여준다. |
| **`JobConfig`** (`job_configs`) | **스케줄러 동적 설정**<br>- 크론 주기나 분석 범위, 개수 한도 설정을 담는다. | - **PK**: `key` (VARCHAR) | - *독립 설정 테이블* | - `.env`를 고치지 않고도 **어드민 UI(SQLAdmin)에서 동적으로 실시간 설정 수정이 가능하도록** 해주는 고마운 녀석이다. |

---

## 2. 데이터 수집 및 업데이트 라이프사이클

수집 파이프라인은 데이터의 성격과 갱신 주기에 맞춰 **총 5개의 등급(Tier)**으로 작동한다. 스케줄러(`APScheduler`)가 백그라운드에서 매 순간 일하며, 관리자가 어드민 UI를 통해 마음대로 스케줄을 제어할 수 있다.

### 🌐 Tier 1: 실시간 뉴스 수집 (`news_ingest_5min`)
*   **주기**: 5분마다 눈썹 휘날리며 실행
*   **수집처**: 구글 뉴스 RSS 또는 Yahoo/Naver Finance, Finviz 같은 금융 채널
*   **분석 범위**: 최근 14일간의 데이터
*   **동작 원리**:
    1. 활성 비전에 매핑된 Capability들의 `signal_keywords`를 취합한다.
    2. 이 키워드들을 쿼리로 삼아 최신 뉴스 소스를 긁어온다.
    3. **중복 검사**: 이미 긁어온 URL인지 DB에서 유니크 키 조건으로 체크하고, 이미 있으면 에이전트를 안 태우고 과감히 거른다. (LLM 사용료 아끼는 최고 꿀팁!)
    4. 진짜 새로 발견된 뉴스라면 **SignalExtractor 에이전트(Gemini Haiku/Fast 등급)**에 던져서 4대 차원별 평점 영향력(`delta_*` $\in [-10, +10]$)과 매칭된 플레이어(`Actor`), 주목할 만한 정보 여부(`is_highlight`)를 판정받아 DB에 적재한다.

---

## 🎓 Tier 2: 연구/특허 아카이브 스위핑 (`research_ingest_hourly`)
*   **주기**: 매시 7분 (정각에 리소스가 몰리는 걸 피하려고 일부러 7분 오프셋을 둠)
*   **수집처**: arXiv (최신 논문), USPTO (미국 특허청, API 연동 활성화 시 작동)
*   **분석 범위**: 최근 7일간의 데이터 (환경변수로 조정 가능)
*   **동작 원리**:
    - 논문이나 특허는 뉴스보다 올라오는 주기가 기므로 정시에 차분히 돌며 기술적 깊이가 있는 고해상도 특허/논문 시그널을 긁어와 안전하게 밀어 넣는다.

---

## 🧮 Tier 3: Feasibility 실시간 재계산 (`recompute_feasibility_hourly`)
*   **주기**: 매시 25분
*   **분석 범위**: **최근 7일간 쌓인 시그널 데이터 (최대 100개 한도)**
    - *이전에는 30일 치 50개로 고정되어 있었지만, 매시 25분마다 도는 배치에서 30일간의 방대한 중복 데이터를 계속 LLM에 쑤셔 넣는 것은 엄청나게 비효율적이었다. 이에 기본 조회를 가장 핫한 최근 7일로 줄이고 한도를 100개로 늘리는 대대적인 최적화를 수행했다.*
    - ***어드민 보너스**: 이 `RECOMPUTE_WINDOW_DAYS`(조회 기간)와 `RECOMPUTE_LIMIT`(조회 개수) 설정은 이제 포트 `8003` 번의 SQLAdmin `Job Configs` 메뉴에서 실시간으로 내 맘대로 변경해 줄 수 있다.*
*   **동작 원리**:
    1. 각 비전 아래 속한 Capability의 최신 평점과 최근 7일간 모인 시그널들의 델타 내역을 추출한다.
    2. **ScoreUpdater 에이전트(Gemini Sonnet/Balanced 등급)**를 깨워서 "이 최신 증거들을 종합했을 때 새로운 평점을 매겨달라"라고 분석을 의뢰한다.
    3. 에이전트의 판단 신뢰도가 **0.5 미만**으로 낮거나, 아무 변화가 없다면 DB에 불필요한 쓰기 작업을 생략하고 조용히 넘어간다.
    4. 점수를 갱신할 때는 **리비히 최소량 법칙(Liebig's Law of Minimums) 완충 공식**을 쓴다.
       - **공식**:
         $$\text{weighted\_mean} = \text{가중치 반영한 4차원 평균값}$$
         $$\text{composite} = \text{4차원 점수 중 가장 꼴찌 최하점} + 0.6 \times (\text{weighted\_mean} - \text{4차원 중 최하점})$$
         *(가장 지체되는 최악의 병목 차원 점수가 전체 기술 성숙도를 꽉 틀어막아 발목 잡게 하되, 가중치 평균값을 60% 완충 계수로 섞어 상식적인 종합 점수를 빚어낸다)*
    5. 기존 활성 평점 레코드를 `is_current = false`로 미련 없이 은퇴시키고, 신규 계산본을 `is_current = true`로 교체하여 트랜잭션 인서트한다.
    6. 최종적으로 `simulation-service` API `/feasibility/recompute/{slug}`를 힘차게 두드려 비전 단위의 종합 Feasibility 점수와 ETA 시계열 통계를 완전히 갱신한다.

---

## 📝 Tier 4: 실시간 검색 기반 데일리 다이제스트 (`digest_daily`)
*   **주기**: 매일 딱 1회 (Deep-Loop)
*   **동작 원리**:
    - 매일 한 차례 **Vertex AI Grounded Gemini (DEEP/Pro 등급)**의 힘을 빌려 Google Search 실시간 인터넷 검색을 연동한 딥 리서치를 수행한다.
    - 비전마다 가장 기술적으로 유의미한 데일리 다이제스트 시그널을 우아하게 작문해내고, 실시간 검색을 증빙한 출처 리포트(`citations`) 정보까지 빈틈없이 매핑해 DB에 저장한다.

---

## ⚙️ Tier 5: 오케스트레이터 분기 틱 디스패처 (`orchestrator_tick_15min`)
*   **주기**: 15분마다 조용히 실행
*   **동작 원리**:
    - 에이전트들이 뇌절하며 너무 비싼 LLM 예산을 탕진하지 않도록 정해진 크롤러 예산을 관리하고 감시한다.
    - 백그라운드 크롤러 작업이 공평하고 기회주의적으로 분배되도록 통제하며, 에이전트들의 실시간 상태를 정리한다.
