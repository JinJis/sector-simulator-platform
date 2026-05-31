# 🚀 Vision Feasibility Monitor (비전 실현 가능성 모니터)

> 우주 데이터센터, 핵융합 발전, 상온 초전도체 등 세상을 바꿀 원대한 기술 비전을 하나 픽(Pick)해보자. 우리는 이 기술을 실현하는 데 필요한 모든 세부 능력(Capability)과 기술의 성숙도를 움직이는 외부 증거(Signal)들을 추적하여, 단 5초 만에 실현 가능성 수준을 직관적으로 파악할 수 있는 종합 점수로 요약해 보여준다.

전체적인 제품 전략과 가상 페르소나, 비즈니스 모델은 [DESIGN.md](./DESIGN.md)에서 볼 수 있다. 코딩 컨벤션(협업 규칙)은 [CLAUDE.md](./CLAUDE.md)를 참고하면 된다. 현재 진행 중인 마일스톤 현황은 [docs/tasks/current.md](./docs/tasks/current.md)에서 볼 수 있으며, 데이터 파이프라인/수집기/봇/UX 설계의 최종 기준점은 [docs/architecture/composition.md](./docs/architecture/composition.md)를 읽어보면 된다.

현재 마일스톤(Phase 4 — 실시간 정보 수집)에서는 도커 기반의 연속 수집 크롤러 서비스와 6가지 수집 어댑터, Gemini Deep Research 기술을 녹여내고 있다. 특히 새로 발견된 기업이나 기술 능력을 큐레이팅하는 `@feasibility_bot` 자동 제안 기능과 실시간 정보 흐름을 투명하게 비쳐주는 "Live Pulse" UX를 개발 완료하여 적용했다. 이전 마일스톤 내역은 [docs/archive/pivot.md](./docs/archive/pivot.md)에서 자세히 볼 수 있다.

---

## 🔍 우리가 해결하려는 문제 (Problem)

그동안 원대한 기술들의 실현 가능성 분석 정보는 너무 산발적으로 흩어져 있었다.

1. **보고서의 빠른 노후화**: 가트너 하이프 사이클(Hype Cycle)이나 MIT 테크 리뷰 같은 굵직한 리포트들은 분기나 연 단위로 PDF 형태로만 나와서 금방 옛날 정보가 되어버린다.
2. **블랙박스 같은 결론**: "AI 전력 부족 폭증" 같은 뜬구름 잡는 결론은 있지만, 어떤 인과 관계와 전제를 거쳐 그런 수치가 나왔는지 출처와 가정이 투명하지 않다.
3. **What-If 시뮬레이션 불가능**: "발사 비용이 50% 더 떨어진다면 실현 시기가 얼마나 당겨질까?" 같은 핵심 가정을 내 맘대로 튜닝하고 즉각 테스트할 수 없다.
4. **분석 확장성의 한계**: 새로운 비전(예: BCI, 우주 데이터센터)을 분석하려고 할 때마다 매번 수개월씩 걸리는 전문가 리서치 비용을 감당해야 한다.

---

## ✨ 해결책 (Solution)

우리는 각 거대 기술 비전(Vision)을 약 10가지 안팎의 세부 능력(**Capability**: 기술, 경제, 규제, 공급망 요건)으로 쪼갠다.
도커 기반의 **크롤러 서비스**가 arXiv 논문, 특허, 뉴스, 정부 발표, 그리고 Gemini Deep Research를 끊임없이 흡수하여 신뢰할 수 있는 외부 증거(**Signal**)로 정제해 낸다.
이 시그널들은 AI 에이전트(`SignalExtractor`, `ScoreUpdater`)를 거쳐 능력별 4차원 점수로 변환 및 실시간 누적된다.

최종적으로 **FeasibilityIndex** 시스템이 Bayesian 집계 연산과 리비히 최소량 법칙(Liebig binding constraint)을 버무려 0부터 100 사이의 종합 feasibility 점수와 달성 예상 시점(ETA) 분포를 실시간 도출해 낸다.
이와 함께 시장을 실질적으로 리드하는 기업과 연구소들을 추적하는 **Actor** 레이어가 연동된다. 파이프라인 중 새롭게 감지된 개체들은 **`@feasibility_bot`** 유저가 직접 커뮤니티 제안(`CommunityProposal`) 형태로 발의하여 커뮤니티 구성원들의 투표와 집단지성으로 검증 및 보완된다.

단순히 읽기만 하는 정적 페이지가 아니라, 사용자가 직접 드라이버 수치를 조절하여 미래를 예측해 볼 수 있는 시뮬레이션 운동장인 **Playground** 탭도 함께 서비스한다.

---

## 🚀 빠른 시작 (Quickstart)

```bash
# 준비물: Node 20 이상, pnpm 9 이상, Python 3.12 이상, uv, Docker
pnpm install
cp .env.example .env

# 선택 사항: AI 및 에이전트 기능을 100% 활용하려면 Vertex AI 서비스 계정 JSON 키를
# infra/secrets/vertex-ai-sa.json 경로에 놓아두면 된다. 상세 가이드는 infra/secrets/README.md 참고.
# 키가 없더라도 기본 가동은 잘 되며, 에이전트 기능들이 깔끔하게 숨김 처리된다.

# 모든 앱과 서비스를 핫 리로드 환경으로 전체 기동하기 (도커 기반)
docker compose -f docker-compose.yml -f docker-compose.local.yml up --build

# 또는 로컬 PC 호스트 환경에서 개별 마이그레이션 및 서비스 수동 기동하기
pnpm db:migrate dev
pnpm seed
pnpm dev                                # 터보(Turbo)를 통해 프론트와 모든 백엔드 일괄 로컬 실행
```

기동 완료 후 브라우저를 열어 다음 주소로 바로 진입해 볼 수 있다.
*   **사용자 서비스 서비스**: `http://localhost:3000` (접속 시 자동으로 `/visions` 비전 목록으로 이동)
*   **어드민 코크핏 (SQLAdmin)**: `http://localhost:8003/admin` (접속 시 `.env`에 기재된 `ADMIN_EMAIL`과 `ADMIN_PASSWORD`로 로그인)

### 🛠️ 개별 마일스톤 및 PR 로컬 테스트 실행

```bash
# 활성화된 특정 백엔드 서비스의 정적 타입 체크 및 로컬 테스트 실행 예시
pnpm --filter @platform/sector-service typecheck
pnpm --filter @platform/sector-service test

# 프론트 웹 앱 빌드 테스트 (RSC 등 Next.js 빌드 오류 조기 차단)
pnpm --filter @platform/web build
```

---

## 🏗️ 시스템 구조 및 아키텍처 (Architecture)

```
사용자 브라우저
  → Next.js 웹서버 (apps/web → /visions)
  → trpc 라우팅 프록시 (/api/sim/trpc/*)
  → sector-service:8001 (Fastify + tRPC 라우터 백엔드)
      ├─ Prisma ORM → Postgres 16 + TimescaleDB + pgvector
      ├─ → simulation-service:8000 (Python 기반 시뮬레이션 및 Feasibility 합산 엔진)
      ├─ → data-pipeline:8003 (Python 기반 데이터 수집기, 크론 배치 및 SQLAdmin 관리도구)
      └─ → agent-orchestration:8002 (Python 기반 에이전트 조율 서버, Vision Builder 및 Extractor 구동)
                  └─ Google Gemini (프로, 밸런스, 패스트 등급 모델)
                      via Vertex AI single SA JSON (Gemini 단일 인증 연동)
```

각 개별 서비스와 공유 패키지의 디렉토리별 세부 상세 구조는 [CLAUDE.md "Repository Structure"](./CLAUDE.md#repository-structure)에 상세히 적혀 있다.

---

## 🌟 현재 지원하는 핵심 기능 (What works today)

상세 마일스톤 로드맵 현황은 오직 [docs/tasks/current.md](./docs/tasks/current.md)를 기준으로 가장 정확히 반영된다.

*   **비전 상세 대시보드 (`Vision pages`)**: 카테고리 테마 및 필터링이 연동된 비전 목록 화면과 각 비전의 8개 세부 정보 탭(개요, 세부 능력, 액터 경쟁도, 외부 증거 시그널, 저해 위험, 경제 단가 곡선, Playground 시뮬레이터, 출처)을 온전히 지원한다.
*   **지표 평가 파이프라인 (`Scoring pipeline`)**: 6가지 스키마 모델을 기반으로 Liebig 병목 계산 및 ETA 통계를 실시간 처리한다. arXiv, 특허, RSS 채널을 수집하는 주기적 크론 및 어드민 헬스케어 뷰를 담고 있다.
*   **비전 생성 에이전트 (`Vision Builder`)**: 한 줄의 질문만 던지면 에이전트가 알아서 해외 웹 검색을 돌아 논문을 찾고 비전을 10대 요건으로 분해하여 완벽한 데이터베이스 단일 트랜잭션으로 커밋을 완료해 준다.
*   **플레이그라운드 시뮬레이터 (`Playground`)**: 웹 브라우저 단에서 Liebig 최소량 공식 연산이 부드럽게 돌아가 사용자가 슬라이더를 밀고 당기며 미래 실현률을 자유롭게 What-If 형태로 예측해 볼 수 있다.
*   **커뮤니티 및 예측 위저드 (`Community`)**: `CommunityProposal` (7종 발의, 투표 정렬 피드), 난이도 자동 판정 기반 주가 예측 `PredictionV2`, 활동에 비례해 등급이 변하는 유저 평판(`UserReputation`) 및 팔로우 프로필 위젯을 제공한다.
*   **다국어 및 테마 (`i18n + theme`)**: 한글 기본 및 영문 병행 지원, 다크 모드 디폴트 및 라이트/시스템 모드 연동과 함께 기기 간 설정을 동기화한다.

---

## 🛠️ 일상적인 운용 가이드 (Common operations)

### 1. 수집 파이프라인 수동 강제 구동
```bash
curl -X POST http://localhost:8003/jobs/signal-ingest
curl     http://localhost:8003/jobs/signal-ingest/last   # 마지막 수집 결과 헬스 체크
```

### 2. 특정 비전의 Feasibility 실시간 재집계
```bash
curl -X POST 'http://localhost:8001/trpc/feasibility.recompute' \
  -H 'Content-Type: application/json' \
  -d '{"sector_slug":"space-data-center"}'
```

### 3. 데이터베이스 마이그레이션 및 시딩
```bash
pnpm db:migrate dev --name <name>        # 스키마 변경 시 로컬 마이그레이션 파일 생성
pnpm db:migrate:deploy                   # 스테이징 및 서버 배포 시 마이그레이션 순차 적용
pnpm db:studio                           # Prisma Studio 웹 브라우저 뷰어 실행
pnpm db:reset                            # 데이터베이스 완전 초기화 및 전체 시드 데이터 재적재
```

---

## 📚 관련 레퍼런스 자료 (References)

- [docs/tasks/current.md](./docs/tasks/current.md) — 실시간 마일스톤 개발 현황판
- [docs/architecture/composition.md](./docs/architecture/composition.md) — 데이터 수집기 및 봇/UX 아키텍처 원론
- [services/data-pipeline/README.md](./services/data-pipeline/README.md) — 데이터 파이프라인 수집 주기 및 데이터베이스 ERD 아키텍처 분석서 (영문 기본)
- [services/data-pipeline/README.ko.md](./services/data-pipeline/README.ko.md) — 데이터 파이프라인 수집 주기 및 데이터베이스 ERD 아키텍처 분석서 (한글 평어체 해설)
- [docs/adr/](./docs/adr/) — 아키텍처 결정 기록서 (ADR)
- [docs/agent-capabilities.md](./docs/agent-capabilities.md) — 사내 에이전트 및 워크플로우 작동 인벤토리
- [CLAUDE.md](./CLAUDE.md) — 터미널 명령어 및 개발 운영 규칙 문서 (매 세션 필수 숙독)
- [DESIGN.md](./DESIGN.md) — 제품 비전, 가상 페르소나 및 비기능적 요구사항 (NFR)
