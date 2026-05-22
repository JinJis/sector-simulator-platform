# CLAUDE.md

이 파일은 Claude Code가 이 레포지토리에서 작업할 때 매 세션 읽는 운영 컨텍스트입니다. 짧고 actionable하게 유지하세요. 제품/비즈니스 맥락은 [DESIGN.md](./DESIGN.md)에 있습니다.

---

## Mission

산업을 시뮬레이션 가능한 인과 그래프로 변환하고, 실시간 데이터로 미래를 검증하는 AI 에이전트 기반 분석 플랫폼.

핵심 abstractions:
- **Sector**: 분석 단위 (예: "AI 메모리 수요", "우주 데이터센터")
- **TechnologyNode** + **Driver**: 섹터를 구성하는 노드와 입력 변수
- **Edge**: 노드 간 인과 함수
- **Scenario** → **Simulation** → **Report**: 사용자 워크플로

---

## Current Phase

**Phase 0 — Foundation** (Week 1-4)

목표: 모노레포 + 인프라 + 1개 하드코딩 시뮬레이션 end-to-end 동작 (관리자가 손으로 작성한 시뮬레이션 → 사용자가 슬라이더로 조작 → 차트 변경).

자동화/에이전트는 **Phase 2부터**. 지금은 손으로 만들고 인터페이스만 정확하게 잡으세요.

다음 작업은 `docs/tasks/current.md` 참조. 새 작업 받으면 이 파일을 먼저 보고, 끝나면 업데이트하세요.

---

## Tech Stack

### Frontend (`apps/web`, `apps/admin`)
- Next.js 15 (App Router, RSC), TypeScript **strict**
- shadcn/ui + Tailwind CSS
- React Flow (causal graph), Recharts (간단 차트), Plotly.js (인터랙티브)
- TanStack Query (server state), Zustand (client state, 필요시만)
- tRPC client

### Backend Node.js (`services/api-gateway`, `services/sector-service`, `services/report-service`)
- Fastify + tRPC
- Prisma ORM (Postgres)
- Zod validation
- Node 20 LTS

### Backend Python (`services/simulation-service`, `services/data-pipeline`, `services/agent-orchestration`, `services/validation-service`)
- FastAPI
- NumPy, Pandas, SciPy
- PyMC (Bayesian, Monte Carlo)
- Pydantic v2 (모든 I/O)
- Python 3.12+

### Agent / LLM
- Google Gemini (3.1-pro-preview / 3-flash-preview / 3.1-flash-lite) — model routing 필수
- 단일 API 키 사용 — `GEMINI_API_KEY` env 변수
- Tier mapping (`packages/agent-tools/llm_client.py`):
  - `opus` → `gemini-3.1-pro-preview` (critical reasoning)
  - `sonnet` → `gemini-3-flash-preview` (balanced)
  - `haiku` → `gemini-3.1-flash-lite` (cheapest)
- Temporal.io (long-running workflow)
- Modal 또는 E2B (sandboxed code execution)
- MCP tools (`packages/agent-tools`)
- (Anthropic Claude는 M34 (2026-05-22)에서 전체 제거됨 — `LLMClient.call()` 인터페이스는 그대로 유지)

### Data
- PostgreSQL 16 + TimescaleDB extension + pgvector
- Cloudflare R2 (artifacts, S3-compatible)
- Redis (cache, pubsub, rate limit)

### Infra
- Turborepo monorepo + pnpm
- Vercel (frontend) / Railway 또는 Fly.io (services, MVP) → 추후 AWS EKS
- Cloudflare (CDN, WAF, R2)
- Terraform (IaC)
- GitHub Actions (CI/CD)
- Doppler 또는 AWS Secrets Manager

### Observability
- LangSmith 또는 Helicone (LLM tracing + cost)
- Sentry (frontend/backend errors)
- Grafana stack 또는 Datadog (metrics/logs/traces)

---

## Repository Structure

```
.
├── apps/
│   ├── web/                    # Next.js, end users
│   ├── admin/                  # Admin console (sector builder)
│   └── docs/                   # Documentation site
├── services/
│   ├── api-gateway/            # Fastify + tRPC, 단일 진입점
│   ├── sector-service/         # Sector/Node/Edge CRUD (Node)
│   ├── simulation-service/     # 시뮬레이션 실행 (Python)
│   ├── data-pipeline/          # 데이터 수집/변환 (Python)
│   ├── agent-orchestration/    # 에이전트 워크플로 (Python + Temporal)
│   ├── report-service/         # 리포트 생성 (Node)
│   └── validation-service/     # Backtesting cron (Python)
├── packages/
│   ├── sdk-python/             # SimulationBase, Driver, Output
│   ├── sdk-ts/                 # Frontend SDK
│   ├── ui/                     # 공유 shadcn 컴포넌트
│   ├── shared-types/           # tRPC + Zod (FE/BE 공유)
│   └── agent-tools/            # MCP tool 정의
├── infra/
│   ├── terraform/
│   ├── k8s/
│   ├── docker/
│   └── seeds/                  # 초기 데이터 SQL
├── prompts/                    # 에이전트 system prompt (버전 관리)
├── tests/
│   ├── integration/
│   ├── e2e/
│   └── agent-evals/
├── docs/
│   ├── adr/                    # Architectural Decision Records
│   └── tasks/                  # 작업 상태
├── CLAUDE.md                   # ← 이 파일
├── DESIGN.md                   # 제품/디자인 스펙
└── turbo.json
```

---

## Setup & Commands

### 초기 세팅
```bash
pnpm install
cp .env.example .env            # 필수 env 채우기 (DATABASE_URL, GEMINI_API_KEY, ...)
pnpm db:migrate dev             # Prisma migrations
pnpm seed                       # 시드 데이터 (1개 하드코딩 섹터)
```

### 개발
```bash
pnpm dev                        # 모든 앱 + 서비스 (turbo)
pnpm dev --filter web           # 특정 앱만
pnpm dev --filter simulation-service
```

### 테스트
```bash
pnpm test                       # 전체 unit
pnpm test --filter <pkg>        # 필터
pnpm test:integration
pnpm test:e2e                   # Playwright
pnpm test:agent-evals           # 에이전트 행동 eval (Phase 2+)
```

### 품질 게이트 (PR 머지 전 모두 통과 필수)
```bash
pnpm typecheck                  # tsc + mypy
pnpm lint                       # ESLint + Ruff
pnpm format:check               # Prettier + Ruff format
pnpm test
```

### 빌드/배포
```bash
pnpm build
pnpm deploy:preview             # PR preview
pnpm deploy:prod                # main 머지 시 자동 (GitHub Actions)
```

---

## Architecture Quick Guide

### User-facing request flow
```
Browser
  → Vercel Edge (Next.js)
  → API Gateway (Fastify + tRPC)
  → Core Service (sector/simulation/report)
  → Postgres / Redis / Sandbox / LLM API
```

### Admin sector registration flow (Phase 2+)
```
Admin UI
  → API Gateway
  → agent-orchestration-service
  → Temporal workflow
    → Research Agent (Gemini Flash)
    → Decomposition Agent (Gemini Pro)
    → Driver Inference Agent (Gemini Flash)
    → Edge Inference Agent (Gemini Pro)
    → Code Gen Agent (Gemini Pro)
    → Code Review Agent (Gemini Pro)
    [admin approval checkpoint]
    → Deployment Agent (Gemini Flash-Lite)
  → Sandbox (Modal) for code validation
  → Deploy to platform → live for users
```

### 핵심 abstraction: SimulationBase

모든 시뮬레이션은 이 인터페이스를 따릅니다. 프론트엔드를 sector-agnostic하게 만들어주는 핵심.

```python
# packages/sdk-python/platform_sdk/base.py
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

    def simulate(self, **kwargs) -> dict[str, Output]: ...
    def monte_carlo(self, n: int = 1000) -> dict[str, list[Output]]: ...
    def sensitivity(self) -> dict[str, float]: ...
```

---

## Conventions

### TypeScript
- `strict: true`, no `any` (use `unknown` + type guards)
- Named exports 선호, default export 지양
- Components `PascalCase`, hooks `useThing`, utils `camelCase`
- 경로 alias: `@/*`, `@platform/*`
- 새 컴포넌트는 `packages/ui`에 먼저 — 앱에서 직접 만들지 말 것

### Python
- Python 3.12+, type hint 필수
- Pydantic v2로 모든 I/O 검증
- Ruff (lint + format), config는 `pyproject.toml`
- pytest, async by default

### Database (Prisma)
- 스키마는 Prisma가 source of truth
- 마이그레이션은 PR 하나당 하나, 기존 마이그레이션 수정 금지
- 컬럼은 `snake_case`, 테이블은 복수형 (`sectors`, `technology_nodes`)
- Tenant-scoped 테이블은 RLS 정책 필수

### Git
- Conventional Commits: `feat:`, `fix:`, `chore:`, `docs:`, `refactor:`
- 브랜치: `feat/<short-desc>`, `fix/<short-desc>`
- PR 템플릿에 변경사항 / 테스트 방법 / UI 스크린샷 포함

### Tests
- Unit: 소스 옆에 (`foo.ts` + `foo.test.ts`)
- Integration: `tests/integration/`
- E2E: `tests/e2e/` (Playwright)
- Agent eval: `tests/agent-evals/<agent>/` (Phase 2+)
- Coverage 목표: services 70%, apps 50%

### LLM calls
- **항상** `packages/agent-tools/llm-client`를 통해 호출 (비용 로깅 내장)
- 공급자: Google Gemini (M34 이후). `LLMClient.call(tier=...)` 인터페이스는 변경 없음.
- Model routing (tier 이름은 historical — 의미는 그대로):
  - **`haiku`** (= `gemini-3.1-flash-lite`): routing, extraction, simple classification
  - **`sonnet`** (= `gemini-3-flash-preview`): reasoning, code gen, code review, report writing
  - **`opus`** (= `gemini-3.1-pro-preview`): critical decomposition, edge inference (높은 정확도 필요한 곳만)
- 모든 agent output은 Pydantic schema로 validation (Gemini의 `response_schema` 기능 활용)
- `adaptive_thinking=True`는 Gemini의 dynamic thinking budget (`-1`)으로 매핑됨 — overthinking 방지를 위해 opt-in

---

## Common Tasks

### 새 섹터 추가 (Phase 0/1, 수동)
1. `services/simulation-service/sims/<sector_slug>.py`에 `SimulationBase` 상속 클래스 생성
2. 마이그레이션: `pnpm db:migrate dev --name add-<sector>-data`
3. 시드 데이터: `infra/seeds/<sector>.sql`
4. 통합 테스트: `tests/integration/sims/<sector>.test.ts`
5. `pnpm typecheck && pnpm test` 통과 확인
6. PR

### 새 에이전트 추가 (Phase 2+)
1. `services/agent-orchestration/agents/<name>.py`에 `AgentBase` 상속 클래스
2. 도구는 `packages/agent-tools/`에 정의
3. System prompt: `prompts/<name>.md` (버전 관리됨)
4. Conductor 워크플로에 연결
5. Eval cases: `tests/agent-evals/<name>/cases.yaml`
6. ADR 작성 (`docs/adr/`): 모델 선택 근거 + 비용 추정
7. PR

### 새 데이터 소스 추가
1. `services/data-pipeline/sources/`에 `DataSource` subclass
2. fetch + transform + freshness SLA 정의
3. `services/data-pipeline/schedules.py`에 cron 등록
4. Health check endpoint 추가
5. PR

### 새 UI 컴포넌트
1. `packages/ui/`에 먼저 (shadcn 패턴)
2. Storybook story 추가
3. 사용처에서는 import만

---

## Important Notes / Gotchas

### 비용 (가장 큰 단일 변수)
- LLM 비용 폭증 위험. 다음 4가지 항상 적용:
  1. Prompt caching (system prompt + tool defs)
  2. 결과 caching (`hash(sector_id, code_version, drivers_dict)`)
  3. Model routing (Haiku 먼저, 필요시만 escalate)
  4. Batch API (비실시간)
- 사용자당 월 LLM 비용 목표 **< $30** (Pro plan $199/mo에서 마진 80% 확보)

### 보안 (타협 금지)
- **LLM 생성 코드는 절대 sandbox 밖에서 실행하지 말 것**. Modal/E2B만.
- Sandbox network는 화이트리스트, 임의 outbound 차단
- Secrets는 Doppler/AWS Secrets Manager, 레포에 절대 커밋 금지
- 모든 admin action은 audit log

### Determinism
- 시뮬레이션은 **반드시** deterministic (캐싱 전제)
- 확률성 필요하면 fixed seed
- Cache key: `hash(sector_id, code_version, drivers_dict, data_snapshot_id)`

### Long-running work
- 30초 넘는 작업은 모두 Temporal workflow로
- 프론트엔드는 tRPC subscription으로 progress streaming

### Multi-tenant isolation
- 모든 query는 `tenant_id` scoped (Prisma middleware)
- Postgres RLS를 2차 방어선으로
- Sandbox는 tenant별로 격리

### 데이터 출처 (provenance)
- 모든 데이터 포인트는 source_url + timestamp + confidence
- 사용자가 모든 숫자를 원천까지 drill-down 할 수 있어야 함
- LLM이 환각으로 수치 만드는 것 방지: schema에 source_ref 강제

### 한국어 / English
- 코드, 변수명, 커밋, ADR: English
- 사용자 facing UI 텍스트: i18n (ko/en 둘 다, ko 기본)
- 주석/내부 문서: 필요에 따라 혼용 가능

---

## Decision Log (ADR)

Non-trivial한 결정 (새 라이브러리, 패턴, 인프라 선택)은 `docs/adr/`에 ADR로 남기세요.

Format: `ADR-NNN-short-title.md`, status (proposed/accepted/superseded), context, decision, consequences.

PR 설명에 ADR 링크 첨부.

---

## Open Questions / 결정 필요

Phase 진행 중 막히거나 의도가 모호하면 다음 우선순위로:

1. `DESIGN.md`의 "Open Questions" 섹션 확인
2. `docs/tasks/current.md`의 acceptance criteria 재확인
3. 그래도 모호하면 ADR draft로 옵션 정리 후 admin에게 결정 요청 (코드 진행 멈춤 금지 — branch에 격리하고 다른 task 진행)

---

## References

- [DESIGN.md](./DESIGN.md) — 비전, 페르소나, 기능, 비즈니스 모델, 로드맵, 리스크
- `docs/adr/` — Architectural Decision Records
- `docs/tasks/` — 현재 작업 목록과 backlog
- `prompts/` — 에이전트 system prompt
- `packages/sdk-python/README.md` — Simulation SDK 사용법
- `packages/agent-tools/README.md` — MCP tool 작성법

