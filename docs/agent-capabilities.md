# Agent capabilities inventory

플랫폼이 가진 모든 에이전트(LLM 기반 워크플로) 능력을 한 곳에 정리한
문서입니다. Vision Builder + signal pipeline + legacy sim-builder
3개 트랙으로 나뉘어 있어요. **Last updated**: 2026-05-31 (marketing
content agent + marketing_digest cron 추가).

소스 진실:
- 워크플로 구현 — `services/agent-orchestration/agent_orchestration/workflows/`
  (vision_builder.py / scoring.py / legacy.py — slice 6b로 분리)
- Conductor + 체이닝 — `services/agent-orchestration/agent_orchestration/conductor.py`
- 검증 게이트 — `services/agent-orchestration/agent_orchestration/validation_gate.py`
- Pydantic 스키마 — `services/agent-orchestration/agent_orchestration/schemas/`
  (common.py / vision_builder.py / scoring.py / legacy.py — slice 7로 분리)
- 프롬프트 — `prompts/*.md` (versioned)
- LLM 클라이언트 + 라우팅 — `packages/agent-tools/agent_tools/llm_client.py`

LLM 호출은 모두 `LLMClient`를 통과합니다. F9 이후 Gemini-only —
Vertex AI 단일 SA(`infra/secrets/vertex-ai-sa.json`)가 모든 tier를
인증해요. Prompt cache + Pydantic structured output + cost meter가
client-side에 빌트인. 자세한 라우팅은 [CLAUDE.md "LLM auth + tier routing"](../CLAUDE.md#llm-auth--tier-routing-f9--gemini-only) 참조.

---

## 1. Vision Builder (M41) ★ — 일등 시민

자연어 한 문장으로 새 비전을 만드는 메인 entry. Admin이
`/admin/visions/new`에서 발사하고, Conductor가 체인을 돌려 결과를
드래프트로 보여줍니다.

```
PromptValidator (fast)
  → VisionResearch (balanced)
  → VisionDecomposition (deep)
  → DataSourceSelector (balanced)
  → ValidationGate (DAG + FK + weight-sum)
  → admin checkpoint
  → tRPC commit (single Prisma transaction)
```

### 1.1 `PromptValidatorWorkflow` (stage 1)

| | |
|---|---|
| **tier** | fast (gemini-3.5-flash-lite) |
| **input** | 자연어 prompt (10–800자) |
| **output** | `PromptValidation` — verdict (`accept` / `reject`) + reason + (선택) suggested rewrite |
| **prompt** | [`prompts/prompt_validator.md`](../prompts/prompt_validator.md) |
| **목적** | "AI가 좋네요" 같은 무내용 prompt를 일찍 거름. Hallucination 비용 절감 |

### 1.2 `ResearchWorkflow` (stage 2)

| | |
|---|---|
| **tier** | balanced (gemini-3.5-flash) |
| **input** | 검증된 vision prompt |
| **output** | `ResearchBrief` — numeric anchors + citations + key references |
| **prompt** | [`prompts/research.md`](../prompts/research.md) |
| **adaptive_thinking** | True (dynamic budget) |

### 1.3 `VisionDecompositionWorkflow` (stage 3) ★ 핵심

| | |
|---|---|
| **tier** | deep (gemini-3.1-pro-preview), adaptive thinking |
| **input** | `ResearchBrief` + 원본 prompt |
| **output** | `VisionDecomposition` — 8-12개의 `CapabilityDraft` + `RiskDraft[]` + `ActorDraft[]` + 메타데이터 |
| **prompt** | [`prompts/vision_decomposition.md`](../prompts/vision_decomposition.md) |
| **검증** | 각 capability는 4-dim 초기 점수 + weight + dependencies + 출처 URL을 반드시 가짐. LLM이 fabricate 못하도록 `source_ref` 강제 |

### 1.4 `DataSourceSelectorWorkflow` (stage 4)

| | |
|---|---|
| **tier** | balanced |
| **input** | `VisionDecomposition` |
| **output** | `DataSourceSelection` — 각 capability별 추적 키워드 (arXiv / USPTO / NewsAPI) |
| **prompt** | [`prompts/data_source_selector.md`](../prompts/data_source_selector.md) |
| **저장** | `Capability.signal_keywords` JSON 컬럼에 영구 기록 |

### 1.5 `ValidationGate` (stage 5 — non-LLM)

`agent_orchestration/validation_gate.py`. LLM 출력을 받아 다음을 검사:
- Capability dependency 그래프에 cycle 없음 (위상 정렬)
- weight 합이 0.95 ~ 1.05
- 모든 `affected_capability_keys`가 실제 capability key를 가리킴 (FK)
- 4-dim 초기 점수가 0-100 범위 안
- Risk severity / likelihood / time_horizon이 enum 값
실패하면 admin UI에 친화적 에러로 노출.

### 1.6 `VisionBuilderConductor`

`agent_orchestration/conductor.py`. 위 5단계를 orchestration하고 각
stage의 cost / tokens / 소요 시간을 `agent_workflows` Prisma 테이블에
기록합니다. 실패하면 status=`failed`로 마킹.

### 1.7 `vision.commitProposal` (tRPC)

`services/sector-service/src/trpc/vision.ts`. Conductor 결과를 받아
한 Prisma transaction으로 `Sector` + `Capability[]` +
`CapabilityScore[]` + `Risk[]` + `Actor[]` + `VisionActor[]` +
`CapabilityActor[]` + `VisionFeasibility` snapshot을 commit합니다.
모든 mutation은 `audit_logs`에 기록.

### 1.8 Eval set (M41e)

`tests/agent_evals/` — 5개 canonical vision으로 회귀 테스트:
SDC / Fusion / Quantum / Humanoid / mRNA. Offline (canned response)이
기본, `GEMINI_EVAL_LIVE=1` 환경변수로 실제 API 호출.

**평균 비용**: $1.50 – $4.00 / 새 vision (Research + Decomposition이 대부분).
**소요 시간**: 약 60s – 180s (Decomposition stage가 병목).

---

## 2. Signal pipeline (M39 + M40)

매일 들어오는 외부 신호(arXiv / USPTO / NewsAPI)가 capability score를
어떻게 움직이는지 정하는 자동화 트랙.

### 2.1 `SignalExtractorWorkflow` (M39b)

| | |
|---|---|
| **tier** | fast |
| **input** | raw signal payload (title / abstract / source URL / source kind) + 후보 capabilities + keywords |
| **output** | `SignalScoring` — `capability_id` + 4-dim deltas + confidence + (선택) `actor_id` (M45b) |
| **prompt** | [`prompts/signal_extractor.md`](../prompts/signal_extractor.md) |
| **트리거** | `data-pipeline` 의 `signal_ingest` job이 새 signal을 가져올 때마다 |
| **confidence gating** | confidence < 0.8이면 actor 태깅 생략, score delta는 weight로 감쇠 |

### 2.2 `CapabilityScoreUpdaterWorkflow` (M40b)

| | |
|---|---|
| **tier** | balanced |
| **input** | capability current state + 새로 들어온 `SignalScoring[]` |
| **output** | `CapabilityScoreUpdate` — 새 4-dim score + rationale + source refs |
| **prompt** | [`prompts/score_updater.md`](../prompts/score_updater.md) |
| **트리거** | daily `recompute_feasibility` cron (M40) |
| **결과** | 새 `CapabilityScore` row 추가 (시계열), 이전 row의 `is_current=false`로 flip |

### 2.3 Feasibility aggregation (non-LLM, M40)

LLM이 아닌 결정적 수학:
- `simulation_service/feasibility/aggregator.py` — capability 4-dim →
  단일 score (weighted mean + 신뢰 밴드)
- `simulation_service/feasibility/vision_aggregator.py` — capability
  scores → vision composite. **Liebig binding constraint**: 가장 낮은
  capability가 vision 상한을 결정 (binding capability에 ⚠ 배지).
- `simulation_service/feasibility/eta.py` — 현재 추세에서 0-100 도달
  연도 추정 (median + P10-P90 분포)
- `simulation_service/feasibility/delta.py` — 90일 변동

`feasibility.recompute` tRPC procedure가 위 모듈을 호출하고
`VisionFeasibility` row를 저장합니다. Daily cron이 모든
vision에 대해 자동 실행.

### 2.4 `MarketingContentWorkflow` (growth — 파이프라인 산출물 소비)

signal pipeline이 만든 점수 + 신호를 마케팅 카피로 바꾸는 distribution
트랙. recompute와 똑같이 `data-pipeline` cron이 같은 DB를 읽어 트리거해요.

| | |
|---|---|
| **tier** | balanced (adaptive thinking) |
| **input** | `VisionMarketingSnapshot` — binding-constraint(병목) capability + 현재 readiness + 가장 임팩트 큰 최근 signal(+source_url) + lead actor + vision page URL |
| **output** | `MarketingPostSet` — Threads + Instagram 포스트(각 ko + en 변형 + hashtags) + `source_refs` |
| **prompt** | [`prompts/marketing_content.md`](../prompts/marketing_content.md) |
| **트리거** | `marketing_digest` cron (cost-gated, **기본 off** — `digest_daily`와 동일하게 operator가 켬). `/jobs/marketing-digest`로 수동 실행도 가능 |
| **provenance** | snapshot에 있는 숫자만 사용 — 새 수치 생성 금지. CTA는 항상 무료 vision page로 (product-led). 투자 권유 문구 금지 |
| **assembler** | `data-pipeline/data_pipeline/jobs/marketing_digest.py` — current capability score로 composite 계산, 최저 composite = binding constraint, 최근 window에서 \|delta\| 최대 signal 선택. 생성된 카피는 자동 게시하지 않고 `last_marketing_digest_result`에 담아 operator 검토용으로 반환 |

---

## 3. Legacy sim-builder track (pre-pivot)

사용자가 직접 자기 시뮬레이터를 만드는 옛 entry. M37 이후
Vision Builder로 무게 중심이 옮겨갔지만, agent-generated sector를
Playground에서 돌리는 인프라는 유지됩니다.

### 3.1 `DecompositionWorkflow`

| | |
|---|---|
| **tier** | deep (adaptive thinking) |
| **input** | 자연어 산업 설명 (10–4000자) + 선택 reference_data |
| **output** | `Decomposition` — drivers / intermediates / outputs + horizon + slug |
| **prompt** | [`prompts/decomposition.md`](../prompts/decomposition.md) |

### 3.2 `EdgeInferenceWorkflow`

| | |
|---|---|
| **tier** | deep |
| **input** | `Decomposition` |
| **output** | `EdgeInferenceResult` — edges + intermediate formulas + output formulas + assumptions |
| **prompt** | [`prompts/edge-inference.md`](../prompts/edge-inference.md) |

### 3.3 `ProposeSectorWorkflow`

`DecompositionWorkflow` → `EdgeInferenceWorkflow` 체인. 사용자 entry는
`/propose` (legacy UI는 M43 cleanup에서 삭제됐지만 워크플로 자체와
tRPC `agent.startProposeSector`는 남아 있어 admin에서 호출 가능).

### 3.4 `DriverInferenceWorkflow` / `CodeGenWorkflow` / `CodeReviewWorkflow`

전체 파이프라인 (Research → Decomposition → DriverInference →
EdgeInference → CodeGen → CodeReview) 의 부품. `FullPipelineWorkflow`로
묶여 있지만 사용자 노출은 보류. 향후 Vision Builder의 capability
scoring code 생성과 연결될 수 있어요. 현재는 `GenericDagSim` runtime이
simpleeval 기반 formula 평가로 우회.

### 3.5 `GenericDagSim` runtime (simulation-service)

| | |
|---|---|
| **목적** | 에이전트가 생성한 섹터를 실제로 simulate |
| **방식** | DB의 `graph_nodes` / `graph_edges` / `agent_workflows.output`(formulas)을 asyncpg로 읽어 simpleeval로 평가 |
| **안전성** | whitelist (산술 + min/max/sqrt/exp/log/pow/abs/round + 상수). 차단: dunder / `__import__` / lambda / comprehension. 비유한 결과 거부 |
| **사용자 진입** | activate된 에이전트 섹터의 모든 페이지가 자동 사용. Playground sub-tab을 통해 표시 |

---

## 4. 인프라 & 운영

| | |
|---|---|
| **모델 routing** | `agent_tools/llm_client.py` — `fast` / `balanced` / `deep` tier를 gemini-3.5-flash-lite / gemini-3.5-flash / gemini-3.1-pro-preview로 매핑. Vertex AI 단일 SA 인증 (F9 — Gemini-only). 각 tier는 `LLM_{FAST,BALANCED,DEEP}_MODEL` env로 오버라이드 가능 |
| **Prompt caching** | 모든 호출에 `cache_control: ephemeral`. system block만 캐시 |
| **Adaptive thinking** | 명시적 opt-in. VisionDecomposition / VisionResearch가 사용 |
| **Structured output** | Gemini의 native `response_schema` + Pydantic post-validate. 스키마가 Vertex의 FST 제약 한계(~5888 states)를 넘으면 prompt-injection retry로 fall back; retry가 validation 실패시 1회 corrective re-prompt (9ac7a03) |
| **Cost meter** | 호출당 토큰 + USD가 `CostMeter`에 기록 → workflow record의 `cost_usd` 컬럼에 roll-up |
| **Persistence** | `agent_workflows` Prisma 테이블에 모든 워크플로 입력 / 출력 / cost / status 영구 저장 |
| **Dangling sweep** | 프로세스 재시작 시 `pending` / `running` 상태로 5분 이상 stale → 자동 `failed` 마킹 |
| **Sandbox (Modal/E2B)** | **미구현 (M28b deferred)**. LLM이 생성한 Python을 직접 실행하지 않음. `GenericDagSim`의 simpleeval 평가가 우회 솔루션 |

---

## 5. 사용자 노출 매트릭스

| 기능 | Free 사용자 (베타) | Free 사용자 (정식) | Premium |
|---|---|---|---|
| 3 기본 비전 탐색 (SDC · Memory · SOFC) | ✓ | ✓ | ✓ |
| 시뮬레이션 슬라이더 (Playground) | ✓ | ✓ | ✓ |
| 시나리오 저장 / 공유 | ✓ | ✓ | ✓ |
| Community 3.0 (proposal vote / prediction) | ✓ | ✓ | ✓ |
| **Vision Builder (admin)** | (admin only) | (admin only) | (admin only) |
| **legacy `/propose` agent sim 생성** | ✓ (workflow) | ✗ | ✓ |
| Agent 실행 우선순위 | (공용 queue) | — | (전용 queue, 향후) |

베타 종료 시점에 free 사용자에게 안내 메일 + settings 페이지의 Premium
CTA가 실제 Stripe 결제로 연결되도록 전환 예정. 베타 동안은 결제가
`ENABLE_BILLING=false`로 꺼져 있어요.

---

## 6. 보안 / 안전 정책

- **LLM이 생성한 코드는 sandbox 밖에서 실행 금지** (현재는 Python
  code-gen 미작동 → 해당 없음). Modal / E2B sandbox는 M28b로 deferred.
- **GenericDagSim의 formula 평가**는 simpleeval 기반 — 산술 / 내장 함수
  whitelist만 허용. dunder / import / lambda / comprehension은 모두
  차단.
- **모든 mutation은 `audit_logs`에 기록**. agent → vision 변환,
  proposal apply, activate / archive 모든 단계가 추적 가능.
- **모든 데이터 포인트에 `source_url` + `timestamp` + `confidence`**.
  LLM이 숫자를 fabricate하지 못하도록 Pydantic 스키마에서 `source_ref`
  강제. Capability rationale + Signal extraction 모두 적용.
- **사용자별 비용 제한**: `AgentBudget` 시스템이 monthly $USD 한도와
  동시 실행 한도를 시행. 베타 동안은 한도가 0이라 free queue 공용.

---

## 7. 향후 로드맵

1. **M44 — Fusion Power second vision**: Vision Builder가 새 비전에서
   잘 작동하는지 first real pressure test.
2. **M46e — Admin proposal queue 1-click apply**: 커뮤니티 proposal을
   한 번에 적용. 각 proposal kind별 `proposal-applier` 모듈이 필요.
3. **M28b — Modal / E2B sandbox**: agent가 만든 capability scoring
   code를 실제로 격리 실행 (현재는 simpleeval로 우회).
4. **Observability — LangSmith / Helicone**: 각 워크플로의 트레이스를
   기록해서 어떤 stage에서 시간 / 비용이 가장 많이 나가는지 가시화.
5. **Pricing & quota wiring**: `user.tier` 기반 hard gate +
   monthly budget + rate limit. Stripe 활성화는 M44 이후.
6. **모델 router 자동 최적화**: 비용 / latency / 정확도 trade-off에
   따라 fast ↔ balanced ↔ deep 동적 선택.
