# DESIGN.md — Tech Sector Simulation Platform
 
**Version**: 0.1 (Draft)
**Owner**: Ayoung
**Status**: Pre-development
**Last updated**: 2026-05-20
 
> 운영/개발 컨텍스트는 [CLAUDE.md](./CLAUDE.md) 참조. 이 문서는 제품/비즈니스/디자인 의사결정의 source of truth입니다.
 
---
 
## Table of Contents
 
1. [비전](#1-비전-vision)
2. [사용자 및 페르소나](#2-사용자-및-페르소나)
3. [도메인 모델](#3-도메인-모델-core-concepts)
4. [핵심 기능](#4-핵심-기능-feature-requirements)
5. [에이전트 아키텍처](#5-에이전트-아키텍처)
6. [시스템 아키텍처](#6-시스템-아키텍처)
7. [비기능 요구사항](#7-비기능-요구사항-nfrs)
8. [UX 설계 원칙](#8-ux-설계-원칙)
9. [로드맵](#9-로드맵-phased-delivery)
10. [비즈니스 모델](#10-비즈니스-모델)
11. [리스크 및 대응](#11-리스크-및-대응)
12. [성공 지표](#12-성공-지표-metrics)
13. [Open Questions](#13-open-questions)
14. [Equities & Market Factors (new domain)](#14-equities--market-factors-new-domain)
15. [Appendices](#appendices)
---
 
## 1. 비전 (Vision)
 
### 1.1 한 줄 요약
 
> **"산업을 시뮬레이션 가능한 인과 그래프로 변환하고, 실시간 데이터로 미래를 검증하는 AI 에이전트 기반 분석 플랫폼."**
 
### 1.2 문제 정의
 
현재 산업 분석은 다음의 한계를 가짐:
 
1. **정적**: 분석 리포트는 발간 즉시 노후화됨. 시장은 분기 단위로 움직이는데 리포트는 연 단위로 갱신.
2. **블랙박스**: "AI 메모리 수요가 폭증할 것"이라는 결론은 있지만, 그 결론을 뒷받침하는 인과 구조와 가정은 불투명.
3. **수정 불가**: 사용자가 "발사 비용이 50% 더 떨어지면?" 같은 what-if를 즉시 테스트할 수 없음.
4. **확장 불가**: 새로운 섹터(예: 우주 데이터센터, 핵융합, 휴머노이드) 분석에는 매번 수개월의 전문가 리서치 필요.
### 1.3 솔루션
 
관리자가 자연어로 섹터를 등록하면 → 멀티에이전트 시스템이 자동으로:
 
1. **분해**(Decompose): 섹터를 구성 기술/회사/제품 노드로 탑다운 분해
2. **연결**(Connect): 노드 간 인과 관계를 추정해 인과 그래프 생성
3. **모델링**(Model): 각 관계를 시뮬레이션 가능한 함수/방정식으로 변환
4. **연결**(Feed): 실시간 데이터 소스를 시뮬레이션 입력 변수에 매핑
5. **배포**(Deploy): 사용자가 인터랙티브하게 탐색 가능한 형태로 플랫폼에 배포
6. **검증**(Validate): 과거 데이터로 backtesting하여 모델의 예측력 측정
### 1.4 핵심 가치 제안
 
| 사용자 | 가치 |
|--------|------|
| VC 파트너 | 새로운 thesis 검증을 며칠 → 시간 단위로 |
| 헤지펀드 PM | 매크로 가정(예: 칩 발열 효율 +20%)을 즉시 P&L 임팩트로 변환 |
| 기업 전략기획 | 인접 산업 진입 시 capex/ROI 시뮬레이션 |
| 산업 애널리스트 | 정성적 직관을 정량 모델로 외화(externalize) |
| 정부 R&D 기획자 | 기술 정책 시나리오 임팩트 측정 |
 
### 1.5 시장 포지셔닝
 
**경쟁**: Bloomberg Intelligence, Gartner Magic Quadrant, CB Insights, Wood Mackenzie, AlphaSense
 
**차별점**: 정적 리포트가 아닌 실시간 데이터로 업데이트되는 인과 시뮬레이션. 사용자가 직접 가정 조정 가능. 새 섹터 추가가 코드 작성 없이 자연어로 가능.
 
---
 
## 2. 사용자 및 페르소나
 
### 2.1 페르소나
 
#### P1. Administrator / Curator (초기엔 본인)
- 새로운 섹터를 등록하고 자동 생성된 모델을 검수
- 가정/가중치/엣지 정정
- 도메인 전문가 컨트리뷰션 승인
- **핵심 워크플로**: 자연어 섹터 등록 → 트리 검수 → Driver 검토 → 배포
#### P2. Power Analyst (주요 유료 사용자)
- 헤지펀드 PM, VC 파트너, corp dev 임원
- 시나리오를 작성하고 결과를 자신의 thesis와 비교
- 리포트 익스포트 (PDF, Notion, Slack)
- **핵심 워크플로**: 섹터 탐색 → 시나리오 작성 → 결과 분석 → 리포트 공유
#### P3. Domain Contributor (커뮤니티)
- 특정 섹터의 도메인 전문가
- 모델 정정 PR 제출
- 새로운 Edge 함수나 데이터 소스 제안
- **핵심 워크플로**: 모델 챌린지 → 개선안 제출 → 머지
#### P4. Casual Reader (Free tier, viral 입구)
- 트렌딩 섹터 리포트 무료 열람
- SNS 공유
### 2.2 사용자 여정 (Admin: 섹터 등록)
 
```
[자연어 입력]
"우주 데이터센터의 경제성을 시뮬레이션하고 싶다"
        ↓
[Research Agent: 1차 정보 수집] (Gemini Deep Search, web fetch)
        ↓
[Decomposition Agent: 트리 분해]
- L1: 발사·궤도 / 위성 플랫폼 / 컴퓨팅 / 열관리 / 전력 / 통신
- L2: (발사) Falcon 9, Starship, Neutron / (열관리) 복사 방열판, 액체 냉각 ...
        ↓
[관리자 검수: 트리 수정/추가]
        ↓
[Driver Inference Agent: 입력 변수 정의]
- 발사 비용 $/kg, 패널 효율 W/kg, 칩 TOPS/W ...
        ↓
[Edge Inference Agent: 노드 간 영향 함수]
- f(발사비용, 데이터센터 질량, 전력) → 총 capex
        ↓
[Code Gen Agent: 시뮬레이션 코드 생성 (Python)]
        ↓
[Code Review Agent: 정합성 검사]
        ↓
[관리자 최종 승인]
        ↓
[Deployment Agent: 컨테이너 빌드 + 배포]
        ↓
[데이터 파이프라인 자동 연결]
        ↓
[사용자에게 노출]
```
 
### 2.3 사용자 여정 (Power Analyst: 시나리오 분석)
 
```
홈 → 섹터 카드 클릭 → 인과 그래프 + 현재 시뮬레이션 뷰
  → Driver 슬라이더 조정 → 실시간 재계산
  → 시나리오 저장 → 리포트 자동 생성 → 공유
```
 
---
 
## 3. 도메인 모델 (Core Concepts)
 
### 3.1 Entity Definitions
 
| Entity | 정의 | 주요 속성 |
|--------|------|----------|
| **Sector** | 분석 대상 산업 단위 | `id, name, slug, description, owner, status (draft/review/published), version` |
| **TechnologyNode** | 섹터를 구성하는 추상 기술 요소 | `id, sector_id, parent_id, name, level, description, kpis[]` |
| **Component** | 노드를 구현하는 구체 제품/회사 | `id, node_id, name, company, specs, source_url, last_updated` |
| **Driver** | 시뮬레이션 입력 변수 | `id, node_id, name, unit, current_value, historical_series_ref, data_source_id` |
| **Edge** | 노드/Driver 간 인과 관계 | `id, source_id, target_id, function_type, params, confidence, evidence_refs[]` |
| **Assumption** | 명시적 가정 | `id, scenario_id, statement, default_value, range, justification` |
| **Scenario** | Driver + Assumption 조합 | `id, sector_id, name, author, drivers_override{}, assumptions[]` |
| **Simulation** | Scenario 실행 결과 | `id, scenario_id, code_version, run_timestamp, outputs{}, runtime_ms` |
| **Report** | 시뮬레이션 결과 내러티브 | `id, simulation_id, narrative_md, charts[], exports[]` |
| **DataSource** | 외부 데이터 공급원 | `id, type, endpoint, schedule, transform_script, freshness_sla` |
| **Validation** | Backtesting 결과 | `id, sector_id, as_of_date, predicted, actual, error_metric` |
 
### 3.2 핵심 관계
 
- `Sector 1:N TechnologyNode` (트리 구조, `parent_id` self-reference)
- `TechnologyNode 1:N Component`
- `TechnologyNode 1:N Driver`
- `Edge N:M` (DAG, cycle 방지 검증 필요)
- `Scenario 1:N Simulation` (재실행 가능)
- `DataSource 1:N Driver` (한 데이터 소스가 여러 Driver 공급 가능)
### 3.3 시뮬레이션 코드 인터페이스
 
자동 생성된 시뮬레이션은 다음 인터페이스를 따름:
 
```python
# Auto-generated per sector
from platform.sdk import SimulationBase, Driver, Output
 
class SpaceDataCenterSim(SimulationBase):
    drivers = {
        "launch_cost_usd_per_kg": Driver(default=1500, range=(200, 5000)),
        "panel_efficiency_w_per_kg": Driver(default=150, range=(50, 500)),
        "chip_tops_per_watt": Driver(default=40, range=(10, 200)),
        # ...
    }
 
    def simulate(self, horizon_years: int = 10) -> dict[str, Output]:
        # Deterministic core + Monte Carlo wrapper
        ...
        return {
            "annual_capex_usd": Output(series=...),
            "cost_per_pflop_year": Output(series=...),
            "break_even_year": Output(scalar=...),
        }
```
 
이 인터페이스를 모든 시뮬레이션이 따르므로, 프론트엔드는 sector-agnostic하게 렌더링 가능.
 
---
 
## 4. 핵심 기능 (Feature Requirements)
 
### F1. 섹터 등록 (Admin Workflow)
 
- **F1.1** 관리자는 자연어로 섹터 의도를 기술할 수 있다.
  - 예: "우주에서 운영되는 데이터센터의 경제성"
  - 추가 제약 조건 입력 가능 (분석 horizon, 관심 지표 등)
- **F1.2** 시스템은 단계별 워크플로를 화면 좌측에 보여주고, 각 단계에서 검수 가능하다.
  - 단계: Research → Decompose → Drivers → Edges → Code → Review → Deploy
  - 각 단계는 LLM 출력의 streaming view 제공
- **F1.3** 관리자는 트리, 드라이버, 엣지를 인터랙티브하게 편집할 수 있다.
  - 노드 추가/삭제/병합/이동
  - Driver 단위/범위 수정
  - Edge 함수 형태 변경 (linear, exponential, piecewise, custom Python)
- **F1.4** 자동 생성된 시뮬레이션 코드는 diff view로 보여지며, 관리자가 수동 수정 가능.
- **F1.5** 배포 전 자동 검증:
  - 단위 정합성 (dimensional analysis)
  - 시뮬레이션 출력의 sanity range
  - Driver의 데이터 소스 연결 여부
  - DAG cycle 검사
### F2. 데이터 파이프라인
 
- **F2.1** 다음 데이터 소스를 native 지원:
  - Gemini Deep Search API (실시간 web research)
  - Polygon.io / Alpha Vantage (시장 데이터)
  - SEC EDGAR (재무)
  - arXiv / Semantic Scholar (논문)
  - USPTO (특허)
  - 산업별 RSS / API (사용자 정의 가능)
- **F2.2** 데이터 소스는 추상화 계층 뒤에 있어 한 소스가 끊겨도 fallback 가능.
- **F2.3** 각 데이터 포인트는 신선도(freshness), 신뢰도(confidence), 출처(provenance) 메타데이터를 가진다.
- **F2.4** 정기 동기화 + on-demand refresh 모두 지원.
- **F2.5** Driver 값에 데이터가 mapping된 후, 변환 스크립트(Python)로 정규화. 변환 스크립트는 LLM이 초안을 생성하고 admin이 검수.
### F3. 시뮬레이션 실행
 
- **F3.1** 시뮬레이션은 격리된 sandbox(Modal, E2B, 혹은 firecracker)에서 실행. 네트워크/파일시스템 화이트리스트.
- **F3.2** 결정론적 실행: 동일 입력 → 동일 출력. 결과는 캐시.
- **F3.3** Monte Carlo 모드: 각 Driver의 분포를 정의하고 N회 sampling, 결과 분포 제공.
- **F3.4** 민감도 분석: 어떤 Driver가 결과에 가장 큰 영향을 미치는지 토네이도 차트.
- **F3.5** 시뮬레이션 결과 스트리밍: 장기 실행 시 progress 표시 + 부분 결과.

### F4. 시각화 및 인터랙션
 
- **F4.1** 인과 그래프 뷰
  - React Flow 기반
  - 노드 클릭 시 세부 정보 (Driver, Component, 출처)
  - 엣지 hover 시 영향 함수 시각화
- **F4.2** 시계열 차트 (Recharts/Plotly)
  - 실제 데이터 vs 시뮬레이션 예측 overlay
  - Confidence interval band
- **F4.3** Driver 슬라이더
  - 즉시(< 1초) 재시뮬레이션 (캐시 + diff 실행)
  - 슬라이더 변경의 결과 임팩트 inline 표시
- **F4.4** 시나리오 비교 (A/B/...)
  - 동일 차트에 multi-line overlay
  - 표 형태로 핵심 지표 diff
- **F4.5** 출처 추적: 모든 숫자 클릭 시 원천 데이터/문서로 drill-down.
### F5. 리포트 생성
 
- **F5.1** 시뮬레이션 결과는 LLM이 자동으로 내러티브 리포트로 변환.
  - 구조: 요약 → 핵심 가정 → 결과 → 민감도 → 한계 → 출처
- **F5.2** 리포트는 인터랙티브 차트 임베드 가능 (사용자가 차트 조작 가능한 채로 공유).
- **F5.3** 익스포트 포맷: PDF, Notion, Slack message, public link.
- **F5.4** 리포트 버전 관리: 시뮬레이션 코드/데이터/가정 변경 시 새 버전 생성.
### F6. 협업 및 거버넌스
 
- **F6.1** 시나리오 공유 링크 (view-only / fork).
- **F6.2** 코멘트, 가정 챌린지 기능.
- **F6.3** 모델 버전 관리 (git-like): 누가 언제 무엇을 바꿨는지 추적.
- **F6.4** 도메인 전문가 컨트리뷰션: PR 형태로 모델 개선안 제출 → admin 머지.
### F7. Backtesting & Continuous Validation
 
- **F7.1** 각 시뮬레이션은 과거 시점(예: 1년 전)에서 실행 → 그 시점에서 미래(현재)를 얼마나 잘 예측했는지 측정.
- **F7.2** 측정 지표: MAPE, R², directional accuracy.
- **F7.3** Backtesting 결과는 섹터별로 공개 (사용자 신뢰 확보).
- **F7.4** 지속적으로 backtest 결과가 나빠지면 알림 → 모델 재학습 트리거.
---
 
## 5. 에이전트 아키텍처
 
### 5.1 Multi-Agent Topology
 
**Hierarchical Orchestration with Specialized Workers**
 
```
┌─────────────────────────────────────────┐
│  Conductor Agent (Workflow Orchestrator) │
│  - Temporal-based long-running workflow │
│  - State machine: Research → ... → Deploy│
│  - Human-in-the-loop checkpoints        │
└─────────────────────────────────────────┘
                  ↓ delegates to
   ┌──────────────┼──────────────────┐
   ↓              ↓                  ↓
┌──────────┐ ┌──────────────┐ ┌────────────────┐
│ Research │ │ Decomposition │ │ Code Gen       │
│ Agent    │ │ Agent         │ │ Agent          │
└──────────┘ └──────────────┘ └────────────────┘
   ↓              ↓                  ↓
┌──────────┐ ┌──────────────┐ ┌────────────────┐
│ Driver   │ │ Edge Inference│ │ Code Reviewer  │
│ Inference│ │ Agent         │ │ Agent          │
└──────────┘ └──────────────┘ └────────────────┘
                  ↓
              ┌────────────┐
              │ Deployment │
              │ Agent      │
              └────────────┘
                  ↓
              ┌────────────┐
              │ Validation │
              │ Agent (CI) │
              └────────────┘
```
 
### 5.2 에이전트 명세
 
| Agent | 모델 권장 | 핵심 역할 | 도구(Tools) |
|-------|----------|----------|------------|
| Conductor | Claude Sonnet | 워크플로 상태 관리, 에이전트 호출 | Temporal SDK |
| Research | Gemini Deep Search + Claude Sonnet | 초기 정보 수집, 종합 | web_search, web_fetch, arxiv_search, edgar_query |
| Decomposition | Claude Opus | 섹터 → 노드 트리 분해 | structured_output (JSON schema) |
| Driver Inference | Claude Sonnet | 노드별 핵심 입력 변수 정의 | unit_dictionary, historical_data_search |
| Edge Inference | Claude Opus | 노드 간 함수 관계 추정 | physics_constraints_checker, regression_helper |
| Code Gen | Claude Sonnet | 시뮬레이션 Python 코드 작성 | sandbox_execute, sdk_docs |
| Code Reviewer | Claude Sonnet | 정합성, 단위, 엣지케이스 검사 | static_analyzer, unit_test_runner, dimensional_analysis |
| Deployment | Claude Haiku | Docker 빌드 + K8s 배포 | docker, kubectl, terraform |
| Validation | Claude Sonnet | Backtesting 자동 실행/분석 | sandbox_execute, time_series_db |
| Report Writer | Claude Sonnet | 결과 → 내러티브 | citation_generator, chart_embed |
 
### 5.3 에이전트 설계 원칙
 
1. **Least privilege**: 각 에이전트는 명시적으로 허용된 도구만 사용
2. **Idempotent**: 동일 입력 → 동일 출력 (Conductor 재시도 안전)
3. **Auditable**: 모든 LLM call은 input/output/latency/cost가 로깅됨
4. **Schema-driven**: 모든 inter-agent 통신은 Pydantic schema로 검증
5. **Human checkpoint**: 비용/임팩트 큰 작업(배포, 코드 변경) 전 admin approval
6. **Cost-aware routing**: 작업 복잡도에 따라 Haiku/Sonnet/Opus 자동 라우팅
### 5.4 Prompt 캐싱 전략
 
- Sector 메타데이터 (변경 적음) → prompt prefix로 캐시
- Tool definitions → 캐시
- 대화별 변동 부분만 동적 → Anthropic prompt caching으로 50%+ 비용 절감
---
 
## 6. 시스템 아키텍처
 
### 6.1 High-Level Architecture
 
```
┌──────────────────────────────────────────────────────┐
│ Edge Layer                                            │
│ - Cloudflare (CDN, WAF, DDoS)                        │
│ - Vercel (Next.js frontend)                          │
└──────────────────────────────────────────────────────┘
                          ↕
┌──────────────────────────────────────────────────────┐
│ Application Layer (API Gateway, AuthN/Z)             │
│ - Fastify + tRPC                                     │
│ - Clerk or Auth.js                                   │
│ - Stripe billing                                     │
└──────────────────────────────────────────────────────┘
                          ↕
┌──────────────────────────────────────────────────────┐
│ Core Services (Node.js + Python microservices)       │
│ - sector-service        (CRUD, version)              │
│ - simulation-service    (run, cache, queue)          │
│ - data-pipeline-service (ingest, transform)          │
│ - agent-orchestration   (Temporal workflows)         │
│ - report-service        (narrative, exports)         │
│ - validation-service    (backtesting cron)           │
└──────────────────────────────────────────────────────┘
                          ↕
┌──────────────────────────────────────────────────────┐
│ Execution Layer                                       │
│ - Modal / E2B for sandboxed code execution           │
│ - Temporal Cloud for long workflows                  │
│ - Agent runtime (Claude API + Gemini API)            │
└──────────────────────────────────────────────────────┘
                          ↕
┌──────────────────────────────────────────────────────┐
│ Data Layer                                            │
│ - PostgreSQL 16 (metadata, OLTP)                     │
│ - TimescaleDB extension (time-series)                │
│ - pgvector (semantic search on sectors/docs)         │
│ - S3 / R2 (simulation artifacts, code versions)      │
│ - Redis (cache, rate limit, pub/sub)                 │
└──────────────────────────────────────────────────────┘
                          ↕
┌──────────────────────────────────────────────────────┐
│ Observability                                         │
│ - Datadog or Grafana stack (metrics, logs, traces)   │
│ - LangSmith / Helicone (LLM tracing, cost)           │
│ - Sentry (errors)                                     │
└──────────────────────────────────────────────────────┘
```
 
### 6.2 기술 스택 (상세는 CLAUDE.md 참조)
 
**Frontend**: Next.js 15, TypeScript, shadcn/ui, React Flow, Recharts + Plotly, TanStack Query
**Backend Node**: Fastify, tRPC, Prisma, Zod
**Backend Python**: FastAPI, NumPy/Pandas/SciPy, PyMC, Pydantic v2
**Agent/LLM**: Anthropic Claude (Opus/Sonnet/Haiku), Gemini Deep Search, Temporal, Modal/E2B
**Data**: PostgreSQL 16 + TimescaleDB + pgvector, Cloudflare R2, Redis
**Infra**: Turborepo, Vercel + Railway/Fly.io → EKS, Cloudflare, Terraform, GitHub Actions
 
---

## 7. 비기능 요구사항 (NFRs)
 
### 7.1 확장성 (Scalability)
 
| 지표 | 목표 (12개월) |
|------|-------------|
| 등록 섹터 수 | 1,000+ |
| 동시 시뮬레이션 실행 | 100+ concurrent |
| 일 시뮬레이션 실행 | 50,000+ |
| 동시 사용자 (WAU) | 5,000+ |
 
**전략**:
- 시뮬레이션 실행은 stateless 워커 풀 (Modal autoscale)
- DB는 vertical scaling 우선 → read replica → sharding
- Tenant 격리는 row-level security (Postgres RLS)
### 7.2 성능 (Performance)
 
| 지표 | 목표 |
|------|------|
| API P95 latency (메타데이터) | < 300ms |
| API P95 latency (시뮬레이션, 캐시 hit) | < 1s |
| API P95 latency (시뮬레이션, cold) | < 30s |
| Driver 슬라이더 즉시 응답 (diff 실행) | < 800ms |
| 첫 페이지 로드 (LCP) | < 2s |
| LLM 토큰 streaming TTFT | < 1s |
 
### 7.3 비용 최적화 (Cost)
 
LLM 비용이 가장 큰 cost driver. 다음 전략:
 
1. **모델 라우팅**: 단순 분류/추출 → Haiku, 복잡한 추론 → Sonnet, 핵심 분해 → Opus
2. **Prompt caching**: Anthropic prompt caching으로 system + tool def 캐시
3. **결과 캐싱**: 동일 (sector_id, scenario_hash) → 캐시 hit, 0 LLM call
4. **배치 처리**: 비실시간 작업(주기적 backtesting)은 Anthropic Batch API (50% 할인)
5. **시뮬레이션 deduplication**: scenario hash로 동일 실행 결과 재사용
**목표 unit economics (Pro plan $199/mo)**:
- 사용자당 월 LLM 비용 < $30
- 사용자당 월 인프라 비용 < $5
- Gross margin > 80%
### 7.4 신뢰성 (Reliability)
 
| 컴포넌트 | SLO |
|----------|-----|
| Public API | 99.9% (월 43분 다운타임) |
| 시뮬레이션 실행 | 99.5% |
| 데이터 파이프라인 | 99.0% (배치) |
 
- 모든 Critical path에 retry + circuit breaker
- Temporal workflow는 자체 retry/checkpoint
- DB는 multi-AZ + daily snapshot
### 7.5 보안 (Security)
 
1. **코드 실행 격리**: Modal/E2B의 microVM sandbox, 네트워크 화이트리스트
2. **API 키 관리**: AWS Secrets Manager / Doppler
3. **데이터 격리**: Postgres RLS, tenant-scoped queries
4. **인증**: OAuth (Google, GitHub) + email magic link
5. **인가**: RBAC (Admin / Contributor / Pro / Free)
6. **감사 로그**: Admin 모든 작업, 시뮬레이션 코드 변경 이력
7. **SOC2 준비**: Drata 등 활용, 6개월 내 Type 1
8. **PII 최소화**: 시뮬레이션 데이터는 비개인정보
### 7.6 데이터 거버넌스
 
- **출처(provenance)**: 모든 데이터 포인트는 source URL + timestamp
- **신선도(freshness)**: 각 데이터 소스의 SLA 정의 (예: 시장 데이터 < 15분 지연)
- **저작권**: 외부 콘텐츠는 paraphrase + 출처 인용, 원문 저장 시 라이선스 확인
- **삭제권**: 사용자 데이터 삭제 요청 시 30일 내 처리
---
 
## 8. UX 설계 원칙
 
### 8.1 핵심 원칙
 
1. **Show, don't tell** — 텍스트 설명보다 인터랙티브 시각화
2. **Progressive disclosure** — 첫 화면은 명확한 결론, drill-down으로 디테일
3. **Uncertainty visualization** — 모든 예측에 신뢰구간/가정 표시
4. **Mutability** — 모든 가정은 사용자가 즉시 토글 가능
5. **Provenance tracking** — 모든 숫자는 원천 데이터로 추적 가능
6. **Keyboard-first** — Linear/Notion 수준의 단축키 + cmd+K command palette
7. **Dark mode default** — 분석 워크플로에 적합한 데이터 밀도
### 8.2 핵심 화면
 
#### S1. Home (Discovery)
- 등록된 섹터 카드 그리드 (썸네일: 인과 그래프 미리보기)
- 트렌딩 / 최근 업데이트 / 내 워크스페이스
- 글로벌 검색 (semantic, pgvector)
- "+ Register new sector" (admin)
#### S2. Sector Detail
- **좌측 (60%)**: 인과 그래프 (인터랙티브, 줌/팬)
- **우측 (40%)**: 현재 시뮬레이션 결과 (차트 스택)
- **하단 (collapsible)**: Driver 슬라이더 패널 (실시간 재계산)
- **상단**: Sector 메타데이터, 버전, backtest score, 출처 수
#### S3. Scenario Workshop
- 시나리오 빌더 (drag-drop 가정)
- 좌측: 가정 리스트, 우측: 결과 chart
- A/B 비교 모드
- "Save scenario", "Generate report"
#### S4. Report View
- 자동 생성된 내러티브 (markdown 렌더링)
- 인터랙티브 차트 임베드 (reader도 슬라이더 조작 가능)
- 출처 표시 (각 숫자 hover시 출처)
- 익스포트: PDF / Notion / public link
#### S5. Admin Sector Builder
- 좌측: 워크플로 단계 (Research → Decompose → ... → Deploy)
- 중앙: 현재 단계의 LLM 출력 (streaming)
- 우측: 검수/편집 패널
- 하단: 로그 + LLM cost meter
#### S6. Validation Dashboard
- 섹터별 backtest 정확도 추이
- 모델 drift 알림
- 데이터 소스 신선도 모니터

### 8.3 디자인 시스템
 
- **컬러**: 다크모드 우선 (Slack-like neutral), accent는 데이터 카테고리별
- **타이포**: Inter (UI), JetBrains Mono (코드/숫자)
- **간격**: 8px 그리드
- **차트**: 단일 시각 언어 (라인은 항상 같은 스타일, CI 밴드 일관)
- **모션**: 데이터 변경 시 짧은 transition (200ms) — 인지에 도움
- **에러**: 명확한 메시지 + 해결 방법 제시
### 8.4 모바일 전략
 
- **MVP**: 데스크톱 우선 (전문 사용자), 모바일은 read-only
- **Phase 3+**: 모바일에서 리포트 read + Driver 슬라이더 일부 지원

### 8.5 정보 구조 (IA) — Phase 2.5 재설계

**문제 (2026-05-20 시점)**. Phase 1/2를 통해 기능 면적은 크게 늘었으나
사용자 앱은 여전히 단일 페이지에 탭으로 모든 것이 쌓여 있다 (`/?sector=...`
+ 4-tab workspace). 다음 문제가 누적됨:

- 컨텍스트 손실: 슬라이더를 만지다가 시나리오 비교를 열면 다시 돌아오기 어렵다.
- 발견성 부족: 시나리오, 리포트, 그래프, 출처가 모두 같은 깊이에 있어 우선순위가 안 보임.
- 브레드크럼/뒤로가기 없음. 페이지가 한두 개라 URL이 의미를 안 가짐.
- 글로벌 검색 부재. cmd+K가 8.1 원칙 6에 명시되어 있지만 구현되지 않음.
- 신규 도메인(섹터별 종목, 시장 팩터 — §14 참조)이 들어올 자리가 없음.

**원칙**. (8.1을 그대로 따르되 IA-specific 원칙 추가)

1. **URL is the state.** 같은 URL은 같은 화면을 만든다. 슬라이더 값 + 활성
   탭 + 비교 대상 — 전부 URL에 인코딩한다. 새로고침/공유가 자연스럽게 동작.
2. **Three levels of depth.** Top-nav → category → detail. 모든 의미 있는
   객체(섹터, 시나리오, 리포트, agent run)가 자기 detail 페이지를 가짐.
3. **Breadcrumbs everywhere.** detail 페이지는 ≥1 단계의 상위 컨텍스트를
   클릭으로 되돌아갈 수 있는 breadcrumb로 노출.
4. **Hub pages, not catch-all.** 한 객체의 모든 면을 한 페이지에 쑤셔 넣지
   않는다. Sector hub는 overview + 자식 탭들(live / manual / graph /
   sources / equities / scenarios)을 가진 *index*다.
5. **One thing per page, many pages per session.** 깊이 있는 작업은 여러
   페이지를 keyboard로 옮겨 다니며 한다. 모달 남발하지 않음.

**제안 사이트맵 (User app, port 3000)**.

```
/                                    # Discovery — top-N sectors + global search
/sectors                             # 전체 섹터 그리드 (현재 / 페이지)
/sectors/[slug]                      # Sector hub — overview + child links
/sectors/[slug]/live                 # Live KPI 대시보드 (현재 Live 탭)
/sectors/[slug]/manual               # Manual workspace (슬라이더 + 차트)
/sectors/[slug]/graph                # React Flow 인과 그래프 (현재 Graph 탭)
/sectors/[slug]/sources              # Provenance (현재 Sources 탭)
/sectors/[slug]/equities             # NEW — key players, 가격, 펀더멘털 (§14)
/sectors/[slug]/scenarios            # 이 섹터의 시나리오 리스트
/sectors/[slug]/scenarios/[id]       # 시나리오 detail (현재는 ?scenario= 파라미터)
/sectors/[slug]/reports              # 이 섹터에서 만든 리포트 인덱스
/scenarios                           # 전체 시나리오 인덱스 (cross-sector)
/scenarios/[id]                      # 단일 시나리오 detail (deep link)
/compare/[scenarioA]/[scenarioB]     # A/B 비교 (현재 /compare?a=&b=, 더 깔끔)
/reports                             # 리포트 인덱스
/reports/[id]                        # 단일 리포트
/search?q=...                        # 글로벌 search 결과 (semantic, pgvector)
/cmd                                 # cmd+K 오버레이용 (실제 페이지는 없고 트리거)
```

**제안 사이트맵 (Admin app, port 3100)**.

```
/                                    # Admin home — 등록된 섹터 그리드
/sectors                             # 같은 그리드, /와 alias
/sectors/[slug]                      # 섹터 상세 (현재 동일)
/sectors/[slug]/drivers              # NEW — driver 편집 (수동 보정용)
/sectors/[slug]/provenance           # NEW — source 검수/추가
/sectors/[slug]/equities             # NEW — key player 큐레이션
/sectors/proposed                    # agent가 제안한 미승인 섹터 (Phase 2 후반)
/scenarios                           # 모든 사용자의 시나리오 인덱스
/agent-runs                          # (기존)
/agent-runs/new                      # (기존)
/agent-runs/[id]                     # (기존)
/ingest                              # NEW — data-pipeline 운영 (스케줄, 헬스)
/observability                       # NEW — LangSmith / Helicone 임베드
/settings                            # NEW — env vars 확인, 권한 (Phase 3)
```

**공통 UI 패턴**.

- **Top bar (sticky)**: 좌측 로고, 중앙 글로벌 검색 (cmd+K), 우측 사용자 메뉴.
- **Sub-nav (sector-scoped)**: sector hub 안에 들어가면 sector-level 탭이
  sub-nav로 들어옴 (overview / live / manual / graph / sources / equities /
  scenarios / reports). 현재 4-탭 strip은 이걸로 대체.
- **Breadcrumbs**: 모든 detail 페이지 상단. `Sectors > Memory Semi > Scenarios > AI super-cycle`
- **Empty states**: 데이터 없을 때 "왜 없는지" + "어떻게 채우는지" 안내. 현재 admin의 stub 버튼처럼 노출.
- **Page-level cost meter**: agent-run / report-generation처럼 비용을 유발하는 페이지는 우측 상단에 "이 페이지가 소비한 $".

**구현 단계 (Phase 2.5)**. 한 번에 다 갈아엎지 않고 점진적으로:

1. **Breadcrumb + sub-nav 컴포넌트**를 `packages/ui` (또는 inline at first)
   에 만든다.
2. **Sector hub 분리**: `/sectors/[slug]` → overview + 4개 자식 라우트
   (`live`, `manual`, `graph`, `sources`). 현재 탭 컴포넌트는 자식 라우트로
   리프트.
3. **Scenarios index**: `/scenarios` + `/scenarios/[id]`. ScenarioBar는
   이 인덱스로 deep-link.
4. **Compare URL 정규화**: `/compare/[a]/[b]` (현재 query param 유지하되
   리디렉트).
5. **Global search**: cmd+K 오버레이 + 결과 페이지. 일단 fuzzy 클라이언트
   서치부터, pgvector는 Phase 3.
6. **Reports index**: `/reports` + `/reports/[id]` — 현재 모달 형태의
   리포트 패널을 페이지로 승격.
7. **Equities tab**: §14 새 도메인에서 다시 다룸.

각 단계가 독립적인 슬라이스. 우선순위는 1 → 2 → 5(검색) → 3 → 4 → 6 → 7.

---
 
## 9. 로드맵 (Phased Delivery)
 
### Phase 0 — Foundation (Week 1-4)
 
**목표**: 인프라 + 1개 하드코딩 시뮬레이션으로 end-to-end 동작
 
- [ ] 모노레포 세팅 (Turborepo)
- [ ] CI/CD (GitHub Actions, preview deploy)
- [ ] 인프라 IaC (Terraform)
- [ ] DB 스키마 v1 (Prisma migration)
- [ ] Auth (Clerk), billing (Stripe) 골격
- [ ] 단일 섹터 하드코딩 ("AI Memory Demand") + 수동 시뮬레이션 코드
- [ ] 기본 시각화 (1개 차트, Driver 1개 슬라이더)
- [ ] **Demo**: 슬라이더 조작 → 실시간 차트 변경
### Phase 1 — MVP (Week 5-12)
 
**목표**: 1개 섹터의 완전한 사용자 경험, 알파 사용자 5-10명
 
- [ ] Sector + Scenario + Simulation 전체 CRUD
- [ ] 인과 그래프 뷰 (React Flow)
- [ ] Driver 슬라이더 + 즉시 재계산
- [ ] 시나리오 저장 / 비교
- [ ] 기본 데이터 파이프라인 (Polygon + SEC)
- [ ] 리포트 자동 생성 (LLM, PDF export)
- [ ] 관리자 화면 (수동 sector CRUD)
- [ ] **Alpha launch**: 5-10명 초대
### Phase 2 — Agentic Generation (Week 13-24)
 
**목표**: 자연어 섹터 등록 → 자동 모델 생성, 3-5개 섹터, 베타 50명
 
- [ ] Conductor + 핵심 에이전트 (Research, Decomposition, Driver Inference)
- [ ] Edge Inference + Code Gen + Code Review
- [ ] Temporal 기반 워크플로 (재시작 가능, HITL checkpoint)
- [ ] Sandbox 통합 (Modal)
- [ ] Deployment 자동화 (코드 → 컨테이너 → 서비스 등록)
- [ ] Backtesting 자동화
- [ ] **Beta launch**: 50명 + 첫 유료 사용자
### Phase 2.5 — Depth & Equities Coverage (Week 23-28)

**목표**: Phase 2의 agent foundation 위에 (1) IA 깊이 + (2) 섹터별 종목/시장
팩터 도메인을 얹어 "분석가가 한 페이지에서 모든 걸 보는" 도구에서 "여러
페이지에 걸쳐 깊이 탐색하는" 도구로 전환. Phase 3 (자가 개선)로 가기 전의
사용성 정비 단계.

- [ ] **IA 재구성** (8.5 참고). 점진적으로 7단계 — breadcrumb/sub-nav →
      sector hub 분리 → scenarios index → compare URL 정규화 → cmd+K
      글로벌 검색 → reports index → equities tab.
- [ ] **Equities domain** (§14): SectorEquity / EquityQuote /
      EquityFinancial / MarketFactor 스키마, `services/equities-pipeline`
      서비스 (또는 기존 `data-pipeline-service`로 통합), Yahoo Finance /
      AlphaVantage 어댑터, 어드민에서 키 플레이어 큐레이션 UI, 사용자
      앱의 `/sectors/[slug]/equities` 탭.
- [ ] **Driver ↔ Company 연결**: 각 회사의 매출/EBITDA를 섹터 드라이버
      함수로 표현 (`revenue_usd ≈ f(market_size, share, mix, price)`).
      시나리오를 회사 단위 P&L로 투영하는 기본 모델.
- [ ] **Backtest v0**: 과거 시나리오 예측 vs 실제 주가/실적 갭. 매주
      cron으로 발사, 결과를 sector hub overview에 작은 카드로 노출.
- [ ] **Sector hub overview 페이지**: 한 화면에 "지금 이 섹터가 어디로
      가고 있는가"가 보이도록. 라이브 KPI 3개 + 키 플레이어 최근 가격
      변동 + 최근 시나리오 3개 + recent reports.

### Phase 3 — Self-Improving Platform (Week 25-40)
 
**목표**: 모델 품질 자동 개선, 유료 사용자 100+
 
- [ ] Backtest 기반 자동 모델 재학습 트리거
- [ ] 커뮤니티 컨트리뷰션 (PR-like flow)
- [ ] 협업 기능 (댓글, 챌린지, 공유)
- [ ] 리포트 정교화 (인용, 시각화 자동 선택)
- [ ] 대시보드 (관리자 + 사용자)
- [ ] **Public launch**: Product Hunt, Hacker News
### Phase 4 — Scale (Week 41+)
 
**목표**: 50+ 섹터, B2B integration, 엔터프라이즈
 
- [ ] 50+ 섹터
- [ ] API 제공 (B2B integration)
- [ ] Enterprise (SSO, audit, on-prem option)
- [ ] 화이트라벨
---
 

## 10. 비즈니스 모델
 
### 10.1 가격 정책
 
| Plan | 가격 | 대상 | 주요 기능 |
|------|------|------|----------|
| **Free** | $0 | 캐주얼 리더 | View-only, 일부 섹터, 리포트 미리보기 |
| **Pro** | $199/mo | 개인 분석가 | 모든 섹터, 무제한 시나리오, 리포트 익스포트 |
| **Team** | $999/mo | 5 seat | + 협업, public link, API limited |
| **Enterprise** | Custom (>$25k/yr) | 헤지펀드/기업 | + SSO, audit log, custom sector, API 무제한, SLA |
 
### 10.2 추가 수익원
 
1. **Custom sector commissioning**: $5k-$25k per sector
2. **Data API**: 다른 fintech에 예측 결과 API 공급
3. **White-label**: 컨설팅펌, 리서치하우스 내부 사용
### 10.3 Go-to-Market
 
**Phase 1**: 콘텐츠 마케팅
- 자체 시뮬레이션 인사이트를 X/LinkedIn에 정기 발행 (예: "우리 모델이 본 NVIDIA Q4")
- 시뮬레이션 결과로 매크로 thesis 검증
- 무료 공개 섹터로 SEO + viral
**Phase 2**: Targeted outreach
- VC 파트너, 헤지펀드 PM에게 1:1 데모
- 산업 컨퍼런스 (Web Summit, SaaStr)
**Phase 3**: Bottom-up B2B
- 개별 분석가 → 팀 → 회사 단위 확산
### 10.4 Unit Economics 목표
 
| 지표 | Pro plan 목표 |
|------|--------------|
| ARPU | $199/mo |
| LLM cost / user / mo | < $30 |
| Infra cost / user / mo | < $5 |
| Gross margin | > 80% |
| CAC | < $300 (콘텐츠 중심) |
| LTV / CAC | > 5 |
| Payback period | < 6mo |
 
---
 
## 11. 리스크 및 대응
 
| 리스크 | 영향도 | 가능성 | 대응 전략 |
|--------|--------|--------|----------|
| LLM 환각으로 잘못된 시뮬레이션 | 매우 높음 | 중 | 다중 에이전트 cross-check + backtesting + human approval |
| LLM API 비용 폭증 | 높음 | 중 | 캐싱, 모델 라우팅, prompt caching, batch API |
| Gemini Deep Search 의존도 | 중 | 중 | DataSource 추상화, 다중 소스 fallback |
| 시뮬레이션 신뢰도 부족 (사용자 회의) | 매우 높음 | 높음 | Backtest 공개, 가정 투명성, 한계 명시, "이 모델이 틀릴 수 있는 이유" 섹션 |
| 코드 sandbox 보안 사고 | 매우 높음 | 낮음 | Modal/E2B의 microVM, 네트워크 화이트리스트, secret 차단 |
| 도메인 전문성 부족 → 모델 품질 ↓ | 높음 | 높음 | 섹터별 전문가 자문, 커뮤니티 컨트리뷰션 인센티브 |
| 경쟁사 (Bloomberg, AlphaSense) | 중 | 중 | "인터랙티브 + 사용자가 가정을 조정 가능" 차별성, 빠른 iteration |
| 데이터 라이선스 이슈 | 중 | 중 | 1차 소스 위주 (정부, SEC, arXiv), 상업 데이터는 명확한 라이선스 |
| 단일 의존성 (Anthropic, AWS) | 중 | 낮음 | LLM provider 추상화, 멀티 클라우드 옵션 보유 |
| Founder 1인 bottleneck | 매우 높음 | 매우 높음 | Phase 1 종료 시 1-2명 채용 (full-stack + ML eng) |
 
---
 
## 12. 성공 지표 (Metrics)
 
### 12.1 North Star Metric
 
**Weekly Active Scenarios** — 사용자가 매주 작성/실행하는 시나리오 수.
(단순 페이지뷰가 아닌 진짜 가치 창출 행동.)
 
### 12.2 제품 지표
 
| 카테고리 | 지표 | 6mo 목표 | 12mo 목표 |
|---------|------|---------|----------|
| Acquisition | Sign-ups / week | 200 | 1,000 |
| Activation | Time to first simulation | < 5 min | < 3 min |
| Retention | WAU / MAU | 40% | 50% |
| Engagement | Scenarios / WAU / week | 3 | 8 |
| Quality | Avg backtest MAPE | < 25% | < 15% |
| Quality | Sector count | 5 | 30 |
 
### 12.3 비즈니스 지표
 
| 지표 | 6mo | 12mo |
|------|-----|------|
| MRR | $10k | $100k |
| Paying users | 50 | 500 |
| Net retention | > 100% | > 120% |
| Gross margin | 70% | 80% |
 
### 12.4 기술 지표
 
| 지표 | 목표 |
|------|------|
| 시뮬레이션 P95 latency (cache hit) | < 1s |
| 시뮬레이션 P95 latency (cold) | < 30s |
| API P95 | < 500ms |
| Uptime | 99.9% |
| 에이전트 자동 생성 모델의 admin 수정률 | < 30% (낮을수록 자동화 잘 됨) |
 
---
 
## 13. Open Questions
 
작업 시작 전 결정 필요한 사항:
 
1. **타겟 사용자 1차 검증**: VC vs 헤지펀드 vs 기업 전략 — 어느 곳을 가장 먼저 깊게 잡을지?
2. **무료 vs 유료 boundary**: 어떤 섹터/기능이 무료여야 viral 효과 + paid conversion 둘 다 잡을지?
3. **모델 검증의 신뢰 임계점**: backtest MAPE 몇 % 이하면 published 가능한가?
4. **데이터 비용**: Polygon/Bloomberg 등 상업 데이터 라이선스 예산?
5. **첫 5개 섹터 선정**: 어떤 섹터가 가장 demo-able하고 thesis-worthy한가?
6. **호스팅 위치**: 한국 사용자 비중과 데이터 sovereignty 고려해 region 결정 필요.
---
 
## 14. Equities & Market Factors (new domain)

> Phase 2.5 신규 도메인. 섹터(시뮬레이션 단위)와 글로벌 상장 종목(투자
> 의사결정 단위) 사이에 다리를 놓는다. 사용자 요청 (2026-05-20):
>
> > 섹터별 전세계 주식시장에 상장되어 있는 키 플레이어 종목들을 따로 또 다
> > 긁어보아서 그 가격과 실적, 마켓에서 영향을 줄 수 있는 여러 팩터들을
> > 나열하고 이를 분석하는 구조

### 14.1 Why this is a separate domain

기존 `SimulationBase`는 sector의 **외부 추상화** (드라이버, 산출물,
인과 그래프)를 담는다. 종목/시장 팩터는 그 시뮬레이션을 **금융 시장
관찰값**과 연결하는 별도의 축:

- 시뮬레이션 출력은 "메모리 사이클이 다음 3년 어떻게 갈 것인가"
- 종목 데이터는 "SK Hynix가 거기서 얼마를 벌고, 그 주가가 어떻게
  반응했는가"

두 축을 분리해 두면 (a) 종목 데이터 ingestion 실패가 시뮬레이션을
망가뜨리지 않고, (b) 시뮬레이션 모델이 바뀌어도 과거 종목/실적
관찰값이 안전하게 backtest 기준으로 남는다.

### 14.2 Domain model

```prisma
// packages/db/prisma/schema.prisma 에 추가 예정

model SectorEquity {
  id            String   @id @default(cuid())
  sector_slug   String   @map("sector_slug")
  sector        Sector   @relation(fields: [sector_slug], references: [slug])
  ticker        String                                       // "005930" / "MU" / "BE"
  exchange      String                                       // "KRX" / "NASDAQ" / "NYSE" / "TSE" / "HKEX" / "LSE" / ...
  iso_country   String                                       // "KR" / "US" / ...
  company_name  String
  // 섹터 매출 비중 추정 (자가 매출 중 이 섹터에 노출된 비율).
  // 큐레이션 시작점 — agent가 나중에 자동 추정 가능.
  sector_exposure_pct  Float?   @map("sector_exposure_pct")
  // 섹터 내 가중치 (포트폴리오 표시 / 합산용)
  weight_pct    Float?   @map("weight_pct")
  rationale     String?            // "HBM 시장의 50%+ 점유" 같은 한 줄 메모
  is_active     Boolean  @default(true) @map("is_active")
  created_at    DateTime @default(now()) @map("created_at")
  updated_at    DateTime @updatedAt        @map("updated_at")

  quotes        EquityQuote[]
  financials    EquityFinancial[]

  @@unique([sector_slug, ticker, exchange])
  @@index([sector_slug])
  @@map("sector_equities")
}

model EquityQuote {
  id              String   @id @default(cuid())
  sector_equity_id String  @map("sector_equity_id")
  sector_equity    SectorEquity @relation(fields: [sector_equity_id], references: [id], onDelete: Cascade)
  as_of           DateTime
  close_price     Float    @map("close_price")
  currency        String                                         // "KRW" / "USD" — 원본 거래소 통화
  close_price_usd Float?   @map("close_price_usd")               // 정규화 (FX 적용)
  volume          Float?
  market_cap_usd  Float?   @map("market_cap_usd")
  pe_ratio        Float?   @map("pe_ratio")
  ev_ebitda       Float?   @map("ev_ebitda")
  source          String                                         // "yahoo" / "alphavantage" / "manual"
  ingested_at     DateTime @default(now()) @map("ingested_at")

  @@index([sector_equity_id, as_of])
  @@map("equity_quotes")
}

model EquityFinancial {
  id               String   @id @default(cuid())
  sector_equity_id String   @map("sector_equity_id")
  sector_equity    SectorEquity @relation(fields: [sector_equity_id], references: [id], onDelete: Cascade)
  fiscal_period    String   @map("fiscal_period")   // "FY2024" / "Q3-2025"
  period_end       DateTime @map("period_end")
  revenue_usd      Float?   @map("revenue_usd")
  ebitda_usd       Float?   @map("ebitda_usd")
  ebit_usd         Float?   @map("ebit_usd")
  net_income_usd   Float?   @map("net_income_usd")
  capex_usd        Float?   @map("capex_usd")
  free_cash_flow_usd Float? @map("free_cash_flow_usd")
  segment_revenue_usd Json? @map("segment_revenue_usd")  // {"HBM": 12e9, "DDR5": 30e9}
  source           String                                  // "edgar" / "dart" / "investor_pdf" / "manual"
  ingested_at      DateTime @default(now()) @map("ingested_at")

  @@unique([sector_equity_id, fiscal_period])
  @@map("equity_financials")
}

model MarketFactor {
  id            String   @id @default(cuid())
  sector_slug   String   @map("sector_slug")
  sector        Sector   @relation(fields: [sector_slug], references: [slug])
  name          String                          // "DRAM 16Gb contract price" / "Henry Hub NG price" / "USD/KRW"
  // driver  : 시뮬레이션 드라이버와 1:1 매핑 (이미 SimulationBase에 있음)
  // macro   : 거시 변수 (금리, 환율, 유가)
  // policy  : 규제/정책 이벤트
  // event   : earnings / M&A / 공급망 사건
  category      String                          // driver | macro | policy | event
  unit          String?
  // 어느 driver_name과 연결되는가 — driver 카테고리에만 채움
  linked_driver String?  @map("linked_driver")
  description   String?
  data_source   String?  @map("data_source")
  created_at    DateTime @default(now()) @map("created_at")
  updated_at    DateTime @updatedAt @map("updated_at")

  observations  MarketFactorObservation[]

  @@unique([sector_slug, name])
  @@index([sector_slug])
  @@map("market_factors")
}

model MarketFactorObservation {
  id                String   @id @default(cuid())
  market_factor_id  String   @map("market_factor_id")
  market_factor     MarketFactor @relation(fields: [market_factor_id], references: [id], onDelete: Cascade)
  as_of             DateTime
  value             Float
  source            String
  ingested_at       DateTime @default(now()) @map("ingested_at")

  @@index([market_factor_id, as_of])
  @@map("market_factor_observations")
}
```

### 14.3 Ingestion layer

새 서비스 `services/data-pipeline-service` (Python, FastAPI + APScheduler):

| Source | Coverage | Cadence | Notes |
|---|---|---|---|
| Yahoo Finance (yfinance) | 전세계 주요 거래소 시세 | 일 1회 EOD | 무료, rate limit 완만 |
| Alpha Vantage | US 시세 + 펀더멘털 | 일 1회 | 무료 키, 5 req/min |
| SEC EDGAR | US 10-K/10-Q/8-K | 발생 시 | XBRL 파싱 |
| DART (전자공시) | KR 공시 | 발생 시 | OpenDartReader |
| EDINET | JP 공시 | 발생 시 | |
| FRED | 거시 (금리, 환율, 인플레이션) | 일 1회 | 무료, 정확 |
| TradingEconomics | 상품 가격 (NG, oil, metals) | 일 1회 | 일부 paid tier |
| Sector-specific | DRAMeXchange, IEA, ICAO 등 | 주 1회 | 도메인별 어댑터 |

각 어댑터는 `DataSource` 추상화 (CLAUDE.md에 이미 명시됨)를 구현:

```python
class DataSource(Protocol):
    name: str
    freshness_sla: timedelta            # 이보다 오래되면 stale 표시
    async def fetch(self, since: datetime) -> list[Observation]: ...
    async def health_check(self) -> HealthStatus: ...
```

스케줄러는 cron으로 발사 (`services/data-pipeline-service/schedules.py`).
실패는 admin observability 페이지로 surface (Phase 2.5 IA의 `/ingest`).

### 14.4 Analysis structure (sector ↔ equity bridge)

핵심 통찰: **각 회사는 "exposure profile"을 갖는다** — 회사의 매출/마진이
어떤 드라이버에 얼마나 노출되는가.

```python
# packages/sdk-python/platform_sdk/equity.py (제안)

@dataclass(frozen=True)
class DriverExposure:
    driver_name: str        # SimulationBase의 드라이버
    sensitivity: float      # ∂revenue / ∂driver 의 정규화된 elasticity
    rationale: str          # "HBM 시장에서 SK Hynix는 ~50% 점유"

@dataclass(frozen=True)
class EquityExposureModel:
    """A simple linear projection from sector drivers to one company's P&L.

    revenue_usd(t) = base_revenue_usd
                   + Σ_d  exposures[d].sensitivity × (driver(d, t) − driver_baseline(d))
    """
    sector_equity_id: str
    base_revenue_usd: float
    base_period: str            # "FY2024"
    exposures: tuple[DriverExposure, ...]
    notes: str = ""
```

이 모델은 (a) 큐레이션 시작점은 수동 (admin이 채움), (b) 농업 후반
slice에서는 Driver Inference Agent가 회사 IR/공시 발췌를 보고 자동
제안하도록 확장.

**Scenario projection**. 사용자가 `Decomposition` 시나리오를 만들면
플랫폼이 자동으로 각 sector-equity의 `revenue_usd` 궤적을 계산:

```
For each scenario:
  For each SectorEquity in sector:
    For each driver in scenario.driver_overrides:
      apply exposures → company revenue trajectory
  Render: 회사별 매출 fan chart + 시나리오별 EBITDA range
```

**Backtest harness**. 매주 cron이 다음을 실행:

1. 6/12/24개월 전에 만들어진 시나리오들을 재실행
2. 그 시점 시나리오의 회사별 revenue 예측 vs 그 회사가 실제로 보고한
   revenue
3. Error metric (MAPE, directional accuracy) 저장
4. 섹터별로 "예측 정확도 trend" 카드 노출

backtesting 결과는 `validation-service`가 담당 (CLAUDE.md에 이미
계획되어 있음).

### 14.5 UX surface

**Admin (port 3100)**:

- `/sectors/[slug]/equities` — 키 플레이어 큐레이션 표:
  ticker / exchange / company / sector_exposure_pct / weight / rationale.
  Add / Remove / Edit. 검색은 "Add company" 모달에서 yfinance 자동
  완성으로.
- `/ingest` — data-pipeline 상태 + 마지막 fetch 시각 + 실패 알림.
- `/sectors/[slug]/factors` — MarketFactor 큐레이션 (driver 매핑 포함).

**User app (port 3000)**:

- `/sectors/[slug]/equities` — 섹터 종목 패널:
  - **상단**: 회사 카드 그리드. 각 카드에 ticker, 회사명, 현재가 (전일
    대비), 시총, sector_exposure_pct.
  - **중단**: "이 시나리오에서 각 회사 매출이 어떻게 움직이는가" —
    사용자가 현재 보고 있는 시나리오(또는 시나리오 선택)를 회사별 매출
    fan chart로.
  - **하단**: 최근 실적 (마지막 4개 분기 revenue/EBITDA 트렌드),
    각 회사 클릭 시 외부 상세 페이지 (예: 야후 파이낸스)로 link-out.
- `/sectors/[slug]/factors` — Market Factor 라이브 차트. driver와
  연결된 팩터는 시뮬레이션 드라이버 슬라이더 옆에 작은 sparkline으로도
  surface.

### 14.6 Phase 2.5 implementation milestones

1. **Schema + migration**: SectorEquity / EquityQuote / EquityFinancial /
   MarketFactor / MarketFactorObservation 추가. seed에 3개 등록 섹터의
   시작 종목 5–10개 씩 수동 큐레이션. (~ 1주)
2. **data-pipeline-service shell** + yfinance 어댑터 + FRED 거시
   어댑터. 매일 EOD 적재. (~ 1주)
3. **Admin equities curation UI** (`/sectors/[slug]/equities`). (~ 1주)
4. **User app equities tab** — 회사 카드 + 현재가 + 시총 표시. (~ 1주)
5. **EquityExposureModel** SDK 추가 + 수동 큐레이션 UI. (~ 1주)
6. **Scenario projection**: 시나리오 → 회사별 매출 fan chart. (~ 1주)
7. **Backtest harness** in validation-service. (~ 1–2주)

전체 ~ 7–9 주. Phase 2.5의 핵심 deliverable.

### 14.7 Open questions

- **Data licensing**: yfinance는 비공식 스크래핑, 상업적 사용 시 risk.
  유료 API (Polygon, IEX, FactSet) 옵션을 Phase 3 가격 plan에 옵션으로?
- **글로벌 거래소 정규화**: KRW 매출과 USD 매출을 한 차트에 어떻게? FX
  스냅을 매일 적재해서 USD 정규화로 가는 게 깔끔.
- **세그먼트 데이터**: SK Hynix의 HBM 매출만 따로 뽑으려면 IR 자료 파싱
  필요. 자동 vs 수동 큐레이션 균형이 어디인가.
- **Sector exposure 추정**: 회사 매출의 몇 %가 한 sector에 노출되는지
  자동 계산하기 어려움. 초기엔 수동, 나중에 LLM 보조.

---
 
## Appendices
 
### Appendix A. 데이터베이스 스키마 (초안)
 
```sql
-- Core entities
CREATE TABLE sectors (
  id UUID PRIMARY KEY,
  slug TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  owner_id UUID REFERENCES users(id),
  status TEXT CHECK (status IN ('draft', 'review', 'published')) DEFAULT 'draft',
  current_version INT DEFAULT 1,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
 
CREATE TABLE technology_nodes (
  id UUID PRIMARY KEY,
  sector_id UUID REFERENCES sectors(id) ON DELETE CASCADE,
  parent_id UUID REFERENCES technology_nodes(id),
  name TEXT NOT NULL,
  level INT NOT NULL,
  description TEXT,
  kpis JSONB DEFAULT '[]'
);
 
CREATE TABLE drivers (
  id UUID PRIMARY KEY,
  node_id UUID REFERENCES technology_nodes(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  unit TEXT,
  default_value NUMERIC,
  min_value NUMERIC,
  max_value NUMERIC,
  data_source_id UUID REFERENCES data_sources(id)
);
 
CREATE TABLE edges (
  id UUID PRIMARY KEY,
  sector_id UUID REFERENCES sectors(id) ON DELETE CASCADE,
  source_id UUID NOT NULL,
  target_id UUID NOT NULL,
  function_type TEXT,
  params JSONB,
  confidence NUMERIC,
  evidence_refs JSONB DEFAULT '[]'
);
 
CREATE TABLE scenarios (
  id UUID PRIMARY KEY,
  sector_id UUID REFERENCES sectors(id),
  name TEXT,
  author_id UUID REFERENCES users(id),
  drivers_override JSONB DEFAULT '{}',
  assumptions JSONB DEFAULT '[]',
  is_public BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
 
CREATE TABLE simulations (
  id UUID PRIMARY KEY,
  scenario_id UUID REFERENCES scenarios(id),
  code_version TEXT,
  inputs_hash TEXT,  -- for caching
  outputs JSONB,
  runtime_ms INT,
  cost_usd NUMERIC,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
 
CREATE INDEX idx_sim_cache ON simulations(scenario_id, code_version, inputs_hash);
 
-- Time-series for actuals
SELECT create_hypertable('driver_values', 'timestamp');
CREATE TABLE driver_values (
  driver_id UUID,
  timestamp TIMESTAMPTZ,
  value NUMERIC,
  source_url TEXT,
  PRIMARY KEY (driver_id, timestamp)
);
```
 
### Appendix B. SDK 인터페이스 (Python)
 
```python
# packages/sdk-python/platform_sdk/base.py
 
from typing import Any
from pydantic import BaseModel
from dataclasses import dataclass
 
@dataclass
class Driver:
    default: float
    range: tuple[float, float]
    unit: str = ""
    description: str = ""
 
@dataclass
class Output:
    series: list[float] | None = None
    scalar: float | None = None
    unit: str = ""
    description: str = ""
 
class SimulationBase:
    drivers: dict[str, Driver] = {}
    horizon_years: int = 10
 
    def simulate(self, **kwargs) -> dict[str, Output]:
        raise NotImplementedError
 
    def monte_carlo(self, n: int = 1000) -> dict[str, list[Output]]:
        """Default Monte Carlo wrapper."""
        # ...
 
    def sensitivity(self) -> dict[str, float]:
        """Tornado chart helper."""
        # ...
```
 
### Appendix C. Agent Prompt Template (예시)
 
```
# Decomposition Agent System Prompt
 
You are a Decomposition Agent. Given a tech sector name and a research brief,
produce a hierarchical tree of technology nodes (3 levels deep) that fully
covers the supply chain and dependencies of the sector.
 
Constraints:
- Each node has: name, level (1-3), description (<= 200 chars), kpis[]
- KPIs are measurable, with units (e.g., "$/kg", "TOPS/W")
- No overlap between sibling nodes
- Output strict JSON matching the provided schema
 
Use the research brief as ground truth. Cite specific sources in `evidence_refs`.
 
Schema: {schema_json}
 
Sector: {sector_name}
Research brief: {brief_md}
```
 
---
 
**END OF DESIGN.md v0.1**
 
이 문서는 Living Document로, 사용자 피드백과 backtest 결과에 따라 분기별로 업데이트됩니다. 운영/개발 작업 컨텍스트는 [CLAUDE.md](./CLAUDE.md) 참조.


