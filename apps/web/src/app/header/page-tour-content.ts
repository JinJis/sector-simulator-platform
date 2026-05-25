/**
 * Per-page tour content. Keyed by URL pattern (`:slug` matches one
 * segment). Sorted longest-first at resolution time so specific
 * patterns win over generic ones.
 *
 * Post-pivot cleanup: legacy `/sectors/*`, `/predict`, `/propose`,
 * `/watchlist`, `/my-sectors`, `/community/{predict,leaderboard,
 * suggestions,my-predictions}` tours were deleted alongside the routes.
 * Only Vision Feasibility Monitor + Community 3.0 entries remain.
 *
 * Each entry has a short label (chip text) + 3-5 walkthrough steps.
 */

export interface TourStep {
  title: string;
  body: string;
  tip?: string;
}

export interface PageTourEntry {
  label: string;
  steps: TourStep[];
}

export const PAGE_TOURS: Record<string, PageTourEntry> = {
  // ----- Community 3.0 hub -----
  "/community": {
    label: "커뮤니티",
    steps: [
      {
        title: "두 개의 flywheel",
        body:
          "Proposals = 섹터 데이터를 함께 개선. Predictions = 가격 밴드 베팅 + 평판. 둘이 한 reputation pool로 묶입니다.",
      },
      {
        title: "🆕 Proposal — 무엇이든 제안",
        body:
          "driver / equity / capability / risk / actor / signal source — 섹터를 구성하는 어떤 요소든 자유롭게 제안하고 다른 유저가 upvote 합니다. 충분히 모이면 admin이 한 번에 DB에 적용.",
      },
      {
        title: "🎯 Prediction — 자동 난이도",
        body:
          "1일 / 1주 / 1달 가격 밴드를 베팅. 변동성 + horizon + 밴드 폭으로 Easy(10p) / Medium(25p) / Hard(50p) 자동 산정. 마감 시 EquityQuote 종가로 자동 채점.",
      },
      {
        title: "리더보드",
        body:
          "resolved prediction의 누적 reward 합산. 추후 (M46c) reputation tier가 열리면 admin queue 가중치 + 직접 적용 권한이 점진적으로 unlock.",
      },
    ],
  },

  "/community/proposals": {
    label: "제안 모음",
    steps: [
      {
        title: "Hot vs New",
        body:
          "Hot = vote_score 내림차순. New = placed_at 내림차순. 섹터 필터 + 카드 클릭하면 detail로.",
      },
      {
        title: "Status pills",
        body:
          "open (투표 중) · review (admin 검토 중) · applied (DB 반영됨) · rejected (반영 안 함) · stale (90일 무응답).",
      },
      {
        title: "Vote button",
        body:
          "▲ 한 번 더 누르면 취소. 익명은 sign-in으로 자동 안내. M46c부터 vote weight가 voter rep에 비례하도록 업그레이드 예정.",
      },
    ],
  },

  "/community/predictions": {
    label: "예측",
    steps: [
      {
        title: "Live / Resolved / Leaderboard",
        body:
          "Live: 마감 전 베팅 — 카운트다운 표시. Resolved: 결과 + 받은 reward. Leaderboard: resolved 합산 top 20.",
      },
      {
        title: "Tier 배지",
        body:
          "🟢 Easy 10p · 🟡 Medium 25p · 🔴 Hard 50p. 각 prediction 카드에 tier 배지 + max reward 함께 표시.",
      },
      {
        title: "베팅 폼",
        body:
          "stock + horizon + 밴드 폭(spread%) + 방향(offset%). 슬라이드 움직일 때마다 tier 미리보기가 200ms debounce로 실시간 갱신.",
      },
    ],
  },

  // ----- M37 pivot: Vision Feasibility Monitor -----

  "/visions": {
    label: "Visions",
    steps: [
      {
        title: "기술 비전 모니터링",
        body:
          "각 비전은 'X 기술이 실현될 것인가?'라는 큰 질문입니다. 우주 데이터센터 / AI 메모리 / SOFC 같은 기술 분야가 비전 단위.",
      },
      {
        title: "비전 카드 한눈에",
        body:
          "각 카드: 현재 Feasibility (0-100) · 90일 변동 · ETA 추정 · 추적 중인 capability 수 · 최근 30일 signal 수. 클릭해서 깊이 들어가세요.",
        tip: "처음 본다면 우주 데이터센터(Space Data Centers)부터 추천 — 가장 깊이 큐레이션되어 있습니다.",
      },
      {
        title: "Capability 기반 분해",
        body:
          "비전 하나는 ~10개의 capability(기술 / 경제 / 규제 / 공급)로 쪼개지고, 각 capability는 4-차원 readiness score를 가집니다.",
      },
      {
        title: "Signals로 점수가 움직임",
        body:
          "arXiv 논문 · 특허 · 뉴스 · 정부 보고서가 들어올 때마다 추출기(M39+) 가 capability score를 업데이트. Hero 페이지의 trajectory + delta가 자동 반영.",
      },
    ],
  },

  "/visions/:slug": {
    label: "Vision Overview",
    steps: [
      {
        title: "한눈에 보는 Feasibility",
        body:
          "큰 숫자(0-100)가 이 비전의 현재 실현 가능성. 90일 변동(▲/▼) · ETA 분포(median + P10-P90) · trajectory 6개월이 함께.",
      },
      {
        title: "Capabilities — binding부터",
        body:
          "기본 정렬은 'binding-ness'. 가장 점수가 낮은(가장 가로막는) capability가 먼저. 각 카드 안에 tech/econ/reg/supply 4-차원 막대.",
        tip: "⚠ BINDING 배지가 붙은 capability는 비전 전체의 점수 상한을 결정합니다 (Liebig's law).",
      },
      {
        title: "Economics — 경제성 곡선",
        body:
          "있을 때만 표시. 비전 기술의 비용 곡선 vs 기존 기준선. 교차점(crossover)이 표시되면 그 시점부터 비용 우위 달성.",
      },
      {
        title: "Risk Board",
        body:
          "정치 · 법률 · 공급 · 안전 · 환경 · 재무 · 사회. severity × likelihood × time_horizon. 영향 받는 capability 키도 같이 표시.",
      },
      {
        title: "Live Signals — 최근 24h",
        body:
          "오른쪽 화살표(↗/↘)는 해당 신호가 capability score에 미친 dimension delta. 강조된(amber 좌측 막대) 행이 hero 'Live signals' 패널에 노출되는 highlight.",
      },
    ],
  },

  "/visions/:slug/capabilities": {
    label: "Capabilities",
    steps: [
      {
        title: "Capability 전체 목록",
        body:
          "Overview에서는 binding 순으로 정렬됐다면, 여기서는 display_order 기준. 더 dense한 그리드로 한눈에 비교.",
      },
      {
        title: "카드 클릭 → 4-차원 + dependency graph",
        body:
          "각 카드를 클릭하면 4-차원 점수 추이(time series), 어떤 capability에 의존/의존받는지(DAG), 해당 capability에 매핑된 signal feed로 drill-down.",
      },
    ],
  },

  "/visions/:slug/signals": {
    label: "Signals",
    steps: [
      {
        title: "Signal feed",
        body:
          "비전에 연결된 원천 데이터(논문 · 특허 · 뉴스 · 공시 · 정부 보고서 · 벤더 문서 · 데이터셋 · 소셜) 시간순. 각 signal은 extractor agent가 4-차원 delta로 채점.",
      },
    ],
  },

  "/visions/:slug/risks": {
    label: "Risks",
    steps: [
      {
        title: "Risk 전체 보드",
        body:
          "Overview의 5개를 넘어 전체 risk 목록. 심각도 · 가능성 · 시간 지평 + 대응 방안. severity × likelihood 매트릭스는 추후 슬라이스에서.",
      },
    ],
  },

  "/visions/:slug/economics": {
    label: "Economics",
    steps: [
      {
        title: "비용 곡선 + 민감도",
        body:
          "TCO 비교 · break-even sensitivity · unit economics.",
      },
    ],
  },

  "/visions/:slug/playground": {
    label: "Playground",
    steps: [
      {
        title: "슬라이더로 산업을 이해하기",
        body:
          "비전을 구성하는 driver를 직접 조작해보세요. 차트가 실시간으로 반응합니다. 시뮬레이션은 부수 기능 — 비전을 이해하는 도구.",
      },
      {
        title: "What-if Feasibility (M42)",
        body:
          "슬라이더를 움직일 때 'Feasibility Index가 어떻게 변할지' 즉시 표시되는 callout이 위에 떠 있습니다. driver → capability tech 점수 → 비전 composite으로 propagate.",
      },
      {
        title: "Scenario 저장 + 비교",
        body:
          "마음에 드는 driver 조합을 저장하고 (`scenario`), 다른 사람과 공유(`share`) 하거나 두 scenario를 A/B 비교(`compare`) 할 수 있습니다.",
      },
    ],
  },

  "/visions/:slug/sources": {
    label: "Sources",
    steps: [
      {
        title: "모든 숫자의 원천",
        body:
          "capability rationale + score history 전체에 걸친 aggregated source index. paper · patent · news · filing · gov_report · vendor_doc · dataset · social.",
      },
    ],
  },
};
