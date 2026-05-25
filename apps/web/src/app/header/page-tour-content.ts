/**
 * Per-page tour content. Bilingual ko/en — the consumer picks via
 * locale at render time. Keys are URL patterns (`:slug` matches one
 * segment). Sorted longest-first so specific patterns win over
 * generic ones.
 */

import type { Locale } from "@/lib/i18n/dict";

type L = { ko: string; en: string };

export interface TourStep {
  title: L;
  body: L;
  tip?: L;
}

export interface PageTourEntry {
  label: L;
  steps: TourStep[];
}

/** Helper to pick a localized string from a {ko,en} pair. */
export function pickL(value: L, locale: Locale): string {
  return value[locale];
}

export const PAGE_TOURS: Record<string, PageTourEntry> = {
  "/community": {
    label: { ko: "커뮤니티", en: "Community" },
    steps: [
      {
        title: { ko: "두 개의 흐름", en: "Two flywheels" },
        body: {
          ko: "Proposals — 함께 섹터 데이터를 다듬어요. Predictions — 가격 밴드에 베팅하고 평판을 쌓아요. 두 흐름은 하나의 reputation pool로 묶입니다.",
          en: "Proposals improve sector data together. Predictions are price-band bets that earn reputation. Both feed into one shared rep pool.",
        },
      },
      {
        title: { ko: "🆕 무엇이든 제안", en: "🆕 Propose anything" },
        body: {
          ko: "driver · equity · capability · risk · actor · signal source — 섹터를 구성하는 어떤 요소든 자유롭게 제안하고, 다른 분들이 ▲ 투표하세요. 충분히 모이면 운영진이 한 번에 DB에 반영합니다.",
          en: "Drivers, equities, capabilities, risks, actors, signal sources — propose any piece of a sector and let others upvote. With enough support, admins apply it to the DB in one click.",
        },
      },
      {
        title: { ko: "🎯 난이도 자동 산정", en: "🎯 Tier auto-assigned" },
        body: {
          ko: "1일 / 1주 / 1달 가격 밴드에 베팅. 변동성·기간·밴드 폭으로 Easy(10p)·Medium(25p)·Hard(50p)이 자동 산정됩니다. 마감되면 EquityQuote 종가로 자동 채점.",
          en: "Bet a 1-day / 1-week / 1-month price band. Difficulty (Easy 10p · Medium 25p · Hard 50p) is auto-set from volatility + horizon + band width. Auto-scored against EquityQuote close at resolve.",
        },
      },
      {
        title: { ko: "리더보드", en: "Leaderboard" },
        body: {
          ko: "Resolved prediction의 누적 reward 합산이에요. 추후 reputation tier가 열리면 admin queue 가중치와 직접 적용 권한이 단계적으로 풀립니다.",
          en: "Cumulative reward from resolved predictions. Once reputation tiers ship, top users unlock admin-queue weighting and direct-apply rights.",
        },
      },
    ],
  },

  "/community/proposals": {
    label: { ko: "제안 모음", en: "Proposals" },
    steps: [
      {
        title: { ko: "Hot vs New", en: "Hot vs New" },
        body: {
          ko: "Hot = 투표 점수 내림차순. New = 등록 시각 내림차순. 섹터로 필터하거나, 카드를 누르면 상세로 들어가요.",
          en: "Hot = by vote score. New = by recency. Filter by sector, tap a card for details.",
        },
      },
      {
        title: { ko: "상태 배지", en: "Status pills" },
        body: {
          ko: "open(투표 중) · review(운영진 검토) · applied(반영 완료) · rejected(반영 안 함) · stale(90일 무응답).",
          en: "open · review · applied · rejected · stale (90 days of silence).",
        },
      },
      {
        title: { ko: "투표 버튼", en: "Vote button" },
        body: {
          ko: "▲ 한 번 더 누르면 취소돼요. 비로그인 상태에서 누르면 로그인 페이지로 안내합니다. 추후 평판이 높을수록 vote 가중치가 커지도록 업그레이드 예정.",
          en: "▲ once more to undo. Anonymous taps route to sign-in. Higher rep will mean heavier votes in a later upgrade.",
        },
      },
    ],
  },

  "/community/predictions": {
    label: { ko: "예측", en: "Predictions" },
    steps: [
      {
        title: { ko: "Live · Resolved · 리더보드", en: "Live · Resolved · Leaderboard" },
        body: {
          ko: "Live는 마감 전 베팅 — 카운트다운을 보여줘요. Resolved는 결과 + 받은 reward. Leaderboard는 resolved 합산 Top 20.",
          en: "Live = open bets with countdown. Resolved = result + reward received. Leaderboard = top 20 by resolved reward.",
        },
      },
      {
        title: { ko: "Tier 배지", en: "Tier badge" },
        body: {
          ko: "🟢 Easy 10p · 🟡 Medium 25p · 🔴 Hard 50p. 각 카드에 tier와 최대 보상이 함께 보여요.",
          en: "🟢 Easy 10p · 🟡 Medium 25p · 🔴 Hard 50p. Each card shows tier + max reward.",
        },
      },
      {
        title: { ko: "베팅 폼", en: "Bet form" },
        body: {
          ko: "종목 + 기간 + 밴드 폭(%) + 방향(offset%). 슬라이드를 움직일 때마다 tier 미리보기가 200ms debounce로 실시간 갱신됩니다.",
          en: "Stock + horizon + band width + direction. Tier preview updates live as you move the sliders (200ms debounce).",
        },
      },
    ],
  },

  "/visions": {
    label: { ko: "비전", en: "Visions" },
    steps: [
      {
        title: { ko: "기술 비전을 모니터링해요", en: "Tracking technology visions" },
        body: {
          ko: "각 비전은 'X 기술이 실현될 것인가?'라는 큰 질문입니다. 우주 데이터센터 · AI 메모리 · SOFC처럼 한 기술 분야가 하나의 비전.",
          en: "Each vision is the question \"will this technology happen?\" — Space data centers, AI memory, SOFC, etc.",
        },
      },
      {
        title: { ko: "비전 카드 한눈에", en: "Vision card at a glance" },
        body: {
          ko: "현재 Feasibility(0-100) · 90일 변동 · ETA 추정 · 추적 중인 capability 수 · 최근 30일 signal 수. 카드를 눌러 깊이 들어가세요.",
          en: "Current feasibility (0-100), 90-day delta, ETA estimate, # of capabilities tracked, signals in the last 30 days. Tap a card to dive in.",
        },
        tip: {
          ko: "처음이라면 우주 데이터센터(Space Data Centers)부터 추천 — 가장 깊이 큐레이션돼 있어요.",
          en: "If it's your first time, start with Space Data Centers — it's the most deeply curated.",
        },
      },
      {
        title: { ko: "Capability 분해", en: "Capability decomposition" },
        body: {
          ko: "비전 하나는 ~10개의 capability(기술 · 경제 · 규제 · 공급)로 쪼개지고, 각 capability는 4-차원 readiness score를 가집니다.",
          en: "Each vision breaks into ~10 capabilities (technical · economic · regulatory · supply), each scored on 4 readiness dimensions.",
        },
      },
      {
        title: { ko: "Signal로 점수가 움직여요", en: "Signals move the score" },
        body: {
          ko: "arXiv 논문 · 특허 · 뉴스 · 정부 보고서가 들어올 때마다 추출기가 capability score를 업데이트해요. Hero 페이지의 trajectory + delta에 자동 반영됩니다.",
          en: "When papers, patents, news, or gov reports arrive, the extractor updates capability scores. Hero trajectories + deltas refresh automatically.",
        },
      },
    ],
  },

  "/visions/:slug": {
    label: { ko: "비전 개요", en: "Vision overview" },
    steps: [
      {
        title: { ko: "한눈에 보는 Feasibility", en: "Feasibility at a glance" },
        body: {
          ko: "큰 숫자(0-100)가 이 비전의 현재 실현 가능성입니다. 90일 변동(▲/▼)과 ETA 분포(중앙값 + P10-P90), 6개월 trajectory가 함께 보여요.",
          en: "The big number (0-100) is current feasibility. 90-day delta, ETA distribution (median + P10-P90), and a 6-month trajectory accompany it.",
        },
      },
      {
        title: { ko: "Capabilities — 막힘부터", en: "Capabilities — most blocking first" },
        body: {
          ko: "기본 정렬은 'binding-ness'예요. 가장 점수가 낮은(가장 가로막는) capability가 먼저. 카드 안에 technical · economic · regulatory · supply 4-차원 막대가 있어요.",
          en: "Default sort is binding-ness — the lowest-scoring (most blocking) capability comes first. Each card shows tech / econ / reg / supply bars.",
        },
        tip: {
          ko: "⚠ BINDING 배지가 붙은 capability는 비전 전체의 점수 상한을 결정합니다 (Liebig의 최소량 법칙).",
          en: "⚠ A capability marked BINDING caps the whole vision's score (Liebig's law of the minimum).",
        },
      },
      {
        title: { ko: "Economics — 경제성 곡선", en: "Economics — cost curve" },
        body: {
          ko: "있을 때만 표시돼요. 비전 기술의 비용 곡선과 기존 기준선을 비교. 교차점(crossover)이 보이면 그 시점부터 비용 우위입니다.",
          en: "Shown when available. Cost curve of the new tech vs the incumbent baseline; the crossover marks when it wins on cost.",
        },
      },
      {
        title: { ko: "Risk 보드", en: "Risk board" },
        body: {
          ko: "정치 · 법률 · 공급 · 안전 · 환경 · 재무 · 사회. severity × likelihood × time_horizon. 영향 받는 capability 키도 함께 표시돼요.",
          en: "Political · legal · supply · safety · environmental · financial · social. Severity × likelihood × horizon. Affected capability keys are shown too.",
        },
      },
      {
        title: { ko: "Live Signals — 최근 24h", en: "Live signals — last 24h" },
        body: {
          ko: "오른쪽 화살표(↗/↘)는 신호가 capability score에 미친 dimension delta예요. amber 좌측 막대가 붙은 행이 hero의 'Live signals' 패널에 노출돼요.",
          en: "The right-side arrows (↗/↘) show how the signal moved each capability dimension. Rows with an amber bar surface on the hero 'Live signals' panel.",
        },
      },
    ],
  },

  "/visions/:slug/capabilities": {
    label: { ko: "Capabilities", en: "Capabilities" },
    steps: [
      {
        title: { ko: "Capability 전체 목록", en: "Full capability list" },
        body: {
          ko: "Overview에서는 binding 순으로 정렬됐다면, 여기서는 display_order 기준. 더 dense한 그리드로 한눈에 비교해요.",
          en: "Where the overview sorts by binding-ness, this view uses display order — a denser grid for side-by-side comparison.",
        },
      },
      {
        title: { ko: "카드 → 4-차원 + 의존성 그래프", en: "Card → 4 dimensions + dependency graph" },
        body: {
          ko: "각 카드를 누르면 4-차원 점수 추이(time series), 어떤 capability에 의존/의존받는지(DAG), 매핑된 signal feed로 깊게 들어갈 수 있어요.",
          en: "Tap a card to drill into 4-dim score history, the dependency DAG (depends-on / depended-by), and the mapped signal feed.",
        },
      },
    ],
  },

  "/visions/:slug/signals": {
    label: { ko: "Signals", en: "Signals" },
    steps: [
      {
        title: { ko: "Signal 피드", en: "Signal feed" },
        body: {
          ko: "비전에 연결된 원천 데이터(논문 · 특허 · 뉴스 · 공시 · 정부 보고서 · 벤더 문서 · 데이터셋 · 소셜) 시간순. 각 signal은 추출기 에이전트가 4-차원 delta로 채점해요.",
          en: "Sources tied to the vision (papers, patents, news, filings, gov reports, vendor docs, datasets, social) in time order. The extractor agent scores each as a 4-dim delta.",
        },
      },
    ],
  },

  "/visions/:slug/risks": {
    label: { ko: "Risks", en: "Risks" },
    steps: [
      {
        title: { ko: "Risk 전체 보드", en: "Full risk board" },
        body: {
          ko: "Overview의 5개를 넘어 전체 risk 목록이에요. 심각도 · 가능성 · 시간 지평 + 대응 방안. severity × likelihood 매트릭스는 다음 슬라이스에서.",
          en: "The full risk list beyond the overview's top 5 — severity, likelihood, horizon, and mitigations. Severity × likelihood matrix is coming next.",
        },
      },
    ],
  },

  "/visions/:slug/economics": {
    label: { ko: "Economics", en: "Economics" },
    steps: [
      {
        title: { ko: "비용 곡선 + 민감도", en: "Cost curve + sensitivity" },
        body: {
          ko: "TCO 비교 · break-even 민감도 · 단위 경제성.",
          en: "TCO comparison · break-even sensitivity · unit economics.",
        },
      },
    ],
  },

  "/visions/:slug/playground": {
    label: { ko: "Playground", en: "Playground" },
    steps: [
      {
        title: { ko: "슬라이더로 산업을 이해해요", en: "Slide to understand the industry" },
        body: {
          ko: "비전을 구성하는 driver를 직접 움직여 보세요. 차트가 실시간으로 반응합니다. 시뮬레이션 자체는 부수적인 도구 — 비전을 이해하기 위한 수단이에요.",
          en: "Move the drivers behind a vision yourself. Charts respond live. The simulation isn't the point — it's a tool for understanding.",
        },
      },
      {
        title: { ko: "What-if Feasibility", en: "What-if feasibility" },
        body: {
          ko: "슬라이더를 움직이면 'Feasibility Index가 어떻게 변할지' 즉시 보여주는 callout이 떠 있어요. driver → capability tech 점수 → 비전 composite으로 전파됩니다.",
          en: "As you slide, a callout shows how the feasibility index would shift. It propagates: driver → capability tech score → vision composite.",
        },
      },
      {
        title: { ko: "Scenario 저장 + 비교", en: "Save & compare scenarios" },
        body: {
          ko: "마음에 드는 driver 조합을 저장(`scenario`)하고, 공유(`share`)하거나 두 시나리오를 A/B 비교(`compare`)할 수 있어요.",
          en: "Save driver combinations as `scenario`, share them, or A/B-compare two with `compare`.",
        },
      },
    ],
  },

  "/visions/:slug/sources": {
    label: { ko: "Sources", en: "Sources" },
    steps: [
      {
        title: { ko: "모든 숫자의 원천", en: "Provenance for every number" },
        body: {
          ko: "capability rationale + score history 전반의 통합 source index예요. paper · patent · news · filing · gov_report · vendor_doc · dataset · social.",
          en: "Unified source index covering capability rationales + score history. Paper · patent · news · filing · gov report · vendor doc · dataset · social.",
        },
      },
    ],
  },
};
