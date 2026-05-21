# Agent capabilities inventory

플랫폼이 가진 모든 에이전트(Anthropic Claude 기반) 능력을 한 곳에 정리한 문서입니다.
M25 시점에 작성 (2026-05-21). 사용자 노출 여부 / 모델 / 평균 비용 / 워크플로 상태를 함께 표기합니다.

## 1. Shipped & user-facing (M25부터 일반 사용자 노출)

### 1.1 `DecompositionWorkflow`

| | |
|---|---|
| **kind** | `decomposition` |
| **모델** | Claude **Opus 4.7** (adaptive thinking) |
| **인풋** | 자연어 산업 설명 (10–4000자) + 선택적 reference_data (≤20000자) |
| **아웃풋 (Pydantic)** | `Decomposition` — drivers / intermediates / outputs + horizon + slug |
| **HTTP** | `POST /workflows/decompose` (agent-orchestration:8002) |
| **tRPC** | `agent.startDecomposition` (sector-service) |
| **평균 비용** | $0.10 – $0.30 / 호출 |
| **소요 시간** | 약 30s – 90s |
| **사용자 진입** | `/propose` (단독으로는 노출 안 됨 — 아래 1.3 의 일부로 호출됨) |
| **프롬프트** | [`prompts/decomposition.md`](../prompts/decomposition.md) |

### 1.2 `EdgeInferenceWorkflow`

| | |
|---|---|
| **kind** | `edge_inference` |
| **모델** | Claude **Opus 4.7** (adaptive thinking) |
| **인풋** | 완성된 `Decomposition` 객체 |
| **아웃풋 (Pydantic)** | `EdgeInferenceResult` — edges + intermediate formulas + output formulas + assumptions |
| **HTTP** | (단독 endpoint 없음 — `ProposeSectorWorkflow` 내부에서 호출) |
| **평균 비용** | $0.10 – $0.30 / 호출 |
| **소요 시간** | 약 30s – 90s |
| **사용자 진입** | `/propose` (1.3 의 일부) |
| **프롬프트** | [`prompts/edge-inference.md`](../prompts/edge-inference.md) |

### 1.3 `ProposeSectorWorkflow` ★ (사용자가 직접 호출하는 메인 entry)

| | |
|---|---|
| **kind** | `propose_sector` |
| **체인** | `DecompositionWorkflow` → `EdgeInferenceWorkflow` |
| **모델** | Opus 4.7 × 2 (양쪽 stage 모두) |
| **인풋** | 자연어 설명 + 선택 reference_data |
| **아웃풋** | `ProposeSectorResult` (`decomposition` + `edge_inference` composite) |
| **HTTP** | `POST /workflows/propose-sector` |
| **tRPC** | `agent.startProposeSector` |
| **평균 비용** | $0.20 – $0.60 / 호출 |
| **소요 시간** | 약 60s – 180s |
| **사용자 진입** | `/propose` → 4-step UX (Prompt → Working → Result → Activate) |
| **베타 정책** | 가입자 전원 무료. 정식 출시 후 ★ Premium 전용으로 전환 예정. |

### 1.4 `sector.proposeFromAgent` → 드래프트 섹터 생성

| | |
|---|---|
| **종류** | tRPC mutation (sector-service) |
| **인풋** | 완료된 `propose_sector` (또는 `decomposition`) 워크플로의 id |
| **동작** | sectors row + graph_nodes + graph_edges (agent-inferred) 를 트랜잭션으로 생성 + audit log |
| **권한** | 로그인 사용자 (M25 부터 `sectors.created_by_user_id = ctx.user.id` 기록) |
| **사용자 진입** | `/propose` 의 "내 시뮬레이터로 만들기 →" 버튼 |

### 1.5 `sector.activate / archive / toDraft / deleteMine`

| | |
|---|---|
| **종류** | tRPC mutations (sector-service) |
| **권한** | activate/archive/toDraft = 모두; deleteMine = 본인 생성 섹터만 |
| **동작** | 상태 트랜지션 + audit log + simulation-service `/sims/<slug>/reload` 캐시 무효화 |
| **사용자 진입** | `/propose` 완료 → 자동 activate; `/my-sectors` → delete |

### 1.6 `GenericDagSim` 런타임

| | |
|---|---|
| **종류** | Python 클래스 (simulation-service) |
| **목적** | 에이전트 생성 섹터를 실제로 simulate (`simulate()`, `sensitivity()`, `live`) |
| **방식** | DB 의 graph_nodes / graph_edges / agent_workflows.output (formulas) 을 asyncpg 로 읽어 simpleeval 로 평가 |
| **안전성** | simpleeval whitelist (산술 + min/max/sqrt/exp/log/pow/abs/round + pi/e/MMBtu/MWh). 차단: dunder, `__import__`, lambda, comprehension. 비유한 결과 거부 |
| **edge weight** | 모든 변수 reference 에 곱해짐 — M19 hybrid weights 가 에이전트 섹터에도 동일 적용 |
| **사용자 진입** | activate 된 에이전트 섹터의 모든 페이지가 자동 사용 |

## 2. 작성된 프롬프트 (아직 워크플로 미연결)

| 프롬프트 | 모델 (예정) | 출력 schema (예정) | 상태 |
|---|---|---|---|
| [`prompts/research.md`](../prompts/research.md) | Sonnet 4.6 | `ResearchBrief` (numeric anchors + citations) | 워크플로 미작성 |
| [`prompts/driver-inference.md`](../prompts/driver-inference.md) | Sonnet 4.6 | `DriverInferenceResult` (calibrated defaults / ranges / history) | 워크플로 미작성 |
| [`prompts/code-gen.md`](../prompts/code-gen.md) | Sonnet 4.6 | `CodeGenResult` (`SimulationBase` subclass Python) | 워크플로 미작성 |
| [`prompts/code-review.md`](../prompts/code-review.md) | Sonnet 4.6 | `CodeReviewResult` (findings + severity) | 워크플로 미작성 |

이 4개는 미래 풀파이프라인(`Research → Decomposition → DriverInference → EdgeInference → CodeGen → CodeReview`) 의 부품으로 남아 있으며, 정식 출시 단계에서 활성화 예정입니다. 현재는 plain Markdown 프롬프트만 존재.

## 3. 인프라 & 운영

| | |
|---|---|
| **모델 routing** | `agent_tools/llm_client.py` 의 tier 시스템 — `"haiku"` / `"sonnet"` / `"opus"` 를 canonical 모델 ID 로 매핑. M25 시점에는 Opus 만 사용 |
| **Prompt caching** | 모든 호출에 cache_control: ephemeral. 마지막 system block 가 캐시 |
| **Adaptive thinking** | 명시적 opt-in. Decomposition / EdgeInference 가 사용 |
| **Cost meter** | 호출당 토큰 + USD 가 `CostMeter` 에 기록 → workflow record 의 `cost_usd` 에 roll-up |
| **Persistence** | `agent_workflows` Prisma 테이블에 모든 워크플로 입력/출력/cost 영구 저장 |
| **Dangling sweep** | 프로세스 재시작 시 `pending` / `running` 5분 이상 stale → `failed` 마킹 |
| **Sandbox (Modal/E2B)** | **미구현**. 에이전트 생성 Python 실행은 아직 안 함. GenericDagSim 의 simpleeval 평가가 우회 솔루션 |

## 4. 사용자 노출 매트릭스

| 기능 | Free 사용자 (베타) | Free 사용자 (정식) | Premium |
|---|---|---|---|
| 3 기본 섹터 탐색 (메모리 · 우주 · SOFC) | ✓ | ✓ | ✓ |
| 종목 그리드 + 30일 projection | ✓ | ✓ | ✓ |
| 관심 종목 (★) | ✓ | ✓ | ✓ |
| 종목 vs 종목 비교 | ✓ | ✓ | ✓ |
| 시뮬레이션 슬라이더 | ✓ | ✓ | ✓ |
| 인과 그래프 편집 (edge weight) | ✓ | ✓ | ✓ |
| 시나리오 저장 / 공유 | ✓ | ✓ | ✓ |
| **`/propose` 에이전트로 시뮬레이터 생성** | ✓ | ✗ | ✓ |
| **`/my-sectors` 내가 만든 시뮬레이터** | ✓ | (Premium-only sectors) | ✓ |
| Agent 실행 우선순위 / quota | (공용 queue) | — | (전용 queue · M25+ 향후) |
| 추후 추가 기능 (research / driver-inference / code-gen / code-review) | — | — | ✓ (출시 시) |

베타 종료 시점에 free 사용자에게 안내 메일 발송 + settings 페이지의 Premium 업그레이드 CTA 가 실제 결제로 연결되도록 전환 예정.

## 5. 보안 / 안전 정책

- **에이전트 생성 코드는 절대 sandbox 밖에서 실행하지 않음** (현재는 Python code-gen 미구현 → 해당 없음).
- **GenericDagSim의 formula 평가**는 simpleeval 기반 — 산술/내장 함수 whitelist만 허용, dunder/import/lambda/comprehension은 모두 차단.
- **모든 mutation은 audit_logs 에 기록**. agent → sector 변환 → activate / archive 모든 단계가 trace 가능.
- **사용자별 비용 제한**은 아직 미구현. 정식 출시 시 monthly budget / rate limit 도입 예정.
- **데이터 출처(provenance)**는 in-code 섹터에만 적용. 에이전트 생성 섹터의 출처 부착은 `research.md` 워크플로 활성화 시 자동화.

## 6. 향후 로드맵

1. **`ResearchWorkflow` 활성화** — 자연어 prompt 받으면 Gemini Deep Search 로 numeric anchor + citations 수집 → DecompositionRequest 의 reference_data 로 자동 주입.
2. **`DriverInferenceWorkflow` 활성화** — Decomposition 의 drivers 에 caliberated defaults / ranges / 분기별 history / source URLs 자동 부착.
3. **`CodeGenWorkflow` + `CodeReviewWorkflow` 체인** — GenericDagSim 의 simpleeval 한계를 넘어 진짜 Python `SimulationBase` subclass 생성 → Modal/E2B 샌드박스 실행.
4. **Pricing & quota wiring** — `user.tier` 기반 hard gate + monthly budget + rate limit.
5. **모델 router 자동 최적화** — 비용 / latency / 정확도 trade-off 에 따라 Haiku ↔ Sonnet ↔ Opus 동적 선택.
