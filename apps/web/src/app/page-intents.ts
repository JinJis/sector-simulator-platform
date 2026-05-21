/**
 * Per-page intent content — milestone 15.
 *
 * Each page on the user app gets a small "왜 보는가 + 무엇을 찾는가"
 * intro card so first-time visitors immediately know the page's
 * purpose without having to reverse-engineer the layout. Power users
 * can collapse the card.
 *
 * Content lives here so editorial revisions don't touch component code.
 * Keep entries short — the one-liner is the page's elevator pitch; the
 * two bullet lists are reasons to scroll.
 */

export interface PageIntent {
  /** Short page name (matches the SubNav label). */
  page: string;
  /** One-sentence elevator pitch — displayed as the panel summary. */
  pitch: string;
  /** Why this view exists. 3-5 short bullets. */
  why: string[];
  /** What to look for / how to use it. 3-5 short bullets. */
  lookFor: string[];
}

/**
 * Sector subpages. Keyed by the route segment under
 * `/sectors/[slug]/`. The empty key is the sector overview hub.
 */
export const SECTOR_PAGE_INTENTS: Record<string, PageIntent> = {
  overview: {
    page: "Overview",
    pitch:
      "이 섹터의 전체 그림 — 6개 영역(Live / Manual / Graph / Sources / Equities / Scenarios)을 한눈에 보고 들어갈 곳을 정합니다.",
    why: [
      "섹터에 처음 들어왔거나, 어디서 시작할지 모를 때의 출발점.",
      "각 서브페이지가 무엇을 보여주는지 미니 프리뷰로 확인.",
      "Sensitivity와 Equities 미리보기로 가장 영향력 큰 드라이버와 핵심 종목을 즉시 파악.",
    ],
    lookFor: [
      "Sensitivity 카드 — 어떤 드라이버가 가장 큰 swing을 만드는가.",
      "Equities 카드 — 이 섹터에 묶인 키 종목 4개와 국가 분포.",
      "Scenarios 카드 — 저장된 가설들 (없으면 Manual에서 만들고 저장).",
    ],
  },

  live: {
    page: "Live",
    pitch:
      "실시간으로 떠다니는 드라이버 값을 보면서 시장 레짐 변화를 시장보다 먼저 감지합니다.",
    why: [
      "3초마다 자동 새로고침되는 KPI 띠로 핵심 산출물의 흐름을 추적.",
      "드라이버 값이 default에서 얼마나 떨어져 있는지 보고 시장 분위기를 읽음.",
      "Data ingest 패널로 어떤 데이터 소스가 실시간으로 들어오고 있는지 검증.",
    ],
    lookFor: [
      "Default 대비 큰 deviation을 보이는 드라이버 — 레짐 시프트 신호.",
      "Sparkline의 최근 30 ticks 추세 — 단기 모멘텀.",
      "ingest 패널의 source kind 분포 (filing / analyst / dataset 등).",
    ],
  },

  manual: {
    page: "Manual",
    pitch:
      "슬라이더로 직접 드라이버를 조정하며 가설을 스트레스 테스트합니다 — 결과는 즉시 차트에 반영됩니다.",
    why: [
      "\"What if HBM 프리미엄이 7배까지 오른다면?\" 같은 counterfactual을 즉시 테스트.",
      "Sensitivity 결과를 보고 가장 임팩트 큰 드라이버에 시간을 집중.",
      "Preset(AI super-cycle / Downcycle 등)으로 한 번에 여러 드라이버를 같이 흔들기.",
    ],
    lookFor: [
      "마음에 드는 시나리오가 나오면 우측 바에서 \"Save as…\"로 저장 → URL 공유 가능.",
      "각 슬라이더 옆의 default 마커 — 현재 값이 베이스에서 얼마나 떠 있는지.",
      "출력 차트의 형태 변화 — 단순 scale인지 곡선 형태가 바뀌는지.",
    ],
  },

  graph: {
    page: "Graph",
    pitch:
      "드라이버 → 중간 계산 → 산출물 → 종목 영향도로 흐르는 인과 그래프를 보고 편집합니다.",
    why: [
      "이 섹터의 \"왜 이렇게 움직이는가\"의 구조를 한눈에 파악.",
      "Edge의 weight를 클릭으로 조정 → 시뮬레이션 산출물 + 종목 projection이 즉시 갱신.",
      "종목 노드(우측 컬럼)를 보고 어떤 드라이버 묶음이 그 종목의 EPS를 끄는지 추적.",
    ],
    lookFor: [
      "Edge 색깔 — 청록(증폭) / 회색(중립) / 적색(역상관) / 흐림(약화).",
      "굵기 — magnitude (low / med / high).",
      "Edge 더블클릭 → 우측 패널에서 weight 슬라이더로 즉시 편집.",
      "\"+ Add node\"로 새 intermediate / output을 만들거나, \"↻ Reset\"으로 Python sim 정의로 되돌리기.",
    ],
  },

  narrative: {
    page: "Narrative",
    pitch:
      "이 섹터가 어떻게 성장할 것인지, 그 흐름이 어떤 종목으로 흘러가 어느 정도의 upside / downside를 만드는지를 한 화면에서 설명합니다.",
    why: [
      "투자 thesis: 어떤 드라이버가 이 섹터를 끌어올리고, 어떤 blocker가 발목을 잡는가.",
      "현재 슬라이더 상태에서 각 종목이 30일 뒤 어디로 갈지 (target price + upside %).",
      "각 종목에 대해 \"왜 이 숫자인가\" — 기여도 큰 상위 드라이버 3-5개로 분해.",
    ],
    lookFor: [
      "Growth thesis 카드 — 1-단락 요약 + key drivers + key blockers.",
      "Per-equity 그리드의 upside / downside % 컬럼 — 절댓값 큰 것부터.",
      "행 클릭 → 종목별 상세 페이지(`/equities/[ticker]`)로 이동해 \"왜\"를 본다.",
      "Manual 탭에서 슬라이더를 움직이면 모든 upside 숫자가 실시간 갱신.",
    ],
  },

  equityDetail: {
    page: "Equity detail",
    pitch:
      "이 종목 하나에 대해, 현재 드라이버 상태가 함의하는 가격 target과 그 근거를 driver 단위로 분해해 보여줍니다.",
    why: [
      "왜 이 종목이 지금 수혜 / 피해 종목인지 driver × edge weight 분해로 검증.",
      "30일 projected target과 현재 가격의 gap (upside / downside).",
      "분기 fundamentals (Revenue / Margin / EBITDA / Capex)와 BS 비율로 펀더멘털 컨텍스트 확인.",
    ],
    lookFor: [
      "Header의 30d target / upside chip — 현재 대비 얼마나 떨어져 있는가.",
      "\"Why this number\" 테이블 — contribution 절댓값 큰 드라이버 순.",
      "Financials 차트 — 8분기 추세가 thesis와 정합적인가.",
    ],
  },

  equities: {
    page: "Equities",
    pitch:
      "이 섹터에 묶인 키 상장사 49개의 현재 가격, 90일 추세, 그리고 현재 드라이버 상태가 함의하는 30일 projection을 한 화면에 봅니다.",
    why: [
      "섹터 thesis가 실제 어느 종목으로 가장 강하게 흘러가는지 (impact score) 즉시 비교.",
      "Manual 탭에서 슬라이더를 움직이면 모든 종목의 30일 projection이 실시간으로 갱신.",
      "행을 펼치면 driver linkage, 90일 차트 (vs 섹터 basket), 분기 펀더멘털을 한 번에.",
    ],
    lookFor: [
      "Impact score가 절댓값으로 큰 종목 — 현재 driver 상태에서 가장 강하게 움직일 후보.",
      "Sparkline 끝의 dashed 선 — 30d 추정 가격 (점선 끝점의 색이 방향).",
      "행을 펼친 뒤 \"30d projection\" 박스의 implied target price — 현재 대비 upside / downside.",
      "Financials 탭 — Revenue / Gross Margin / EBITDA / Capex 분기 추이.",
    ],
  },

  sources: {
    page: "Sources",
    pitch:
      "모든 드라이버 값의 출처를 source URL · timestamp · confidence까지 직접 확인합니다 — 근거 없는 숫자는 없습니다.",
    why: [
      "\"이 숫자 어디서 왔어?\" 질문에 1초 안에 답하기 위한 페이지.",
      "Provenance(분석가 노트 / 공시 / 벤더 자료 / 정부 보고서 등)별 분포로 데이터 품질 검증.",
      "오래된 출처를 찾아 업데이트가 필요한 드라이버를 식별.",
    ],
    lookFor: [
      "각 드라이버의 history 시계열 (역사적 값의 추세).",
      "Source list — 클릭으로 원문 링크 열기.",
      "kind 배지 (filing / analyst / dataset / vendor_doc 등)로 근거 강도 평가.",
    ],
  },
};

/**
 * Standalone routes (`/`, `/compare`, `/sectors` list, etc.).
 */
export const STANDALONE_PAGE_INTENTS: Record<string, PageIntent> = {
  home: {
    page: "Home",
    pitch:
      "오늘 시장에서 무슨 일이 일어나고 있는지, 어떤 섹터를 들여다보고 어떤 종목이 움직이고 있는지를 한 화면에서 시작합니다.",
    why: [
      "여러 섹터를 옮겨 다니지 않고도 \"지금 주목할 곳\"을 빠르게 파악.",
      "검색 한 번으로 섹터 / 종목 / 드라이버 어디로든 점프.",
      "저장된 시나리오와 그래프 편집 이력으로 팀 활동을 따라잡기.",
    ],
    lookFor: [
      "Trending sectors — 섹터 basket 90일 수익률과 종목 수.",
      "Biggest movers — 최근 90일 절대 수익률 상위 5개 종목.",
      "Recent scenarios — 동료가 저장한 최근 가설.",
      "What's changed — 그래프 / 시나리오 mutation 피드 (audit log).",
    ],
  },

  compare: {
    page: "Compare",
    pitch:
      "두 시나리오(또는 시나리오 vs 디폴트)를 나란히 놓고 차이를 측정합니다.",
    why: [
      "\"AI 슈퍼 사이클\" 시나리오와 \"다운사이클\" 시나리오의 NPV 차이가 얼마나 되는가?",
      "동일 섹터 내에서 가설끼리 비교 — 어떤 가설이 더 공격적인지 한눈에.",
      "공유 가능한 URL — 팀에 \"이 차이를 봐\" 라고 즉시 던지기.",
    ],
    lookFor: [
      "스칼라 출력의 % 차이 (NPV 등).",
      "시계열 출력의 곡선 차이 (수렴 / 발산 / 교차).",
      "변경된 드라이버 목록 — 어떤 가정이 달라졌는지.",
    ],
  },

  sectorsList: {
    page: "Sectors",
    pitch:
      "이 플랫폼에 등록된 섹터를 한눈에 보고 들어갈 곳을 고릅니다.",
    why: [
      "어떤 섹터들이 시뮬레이션 가능한지 카탈로그.",
      "각 섹터의 horizon / 드라이버 개수 / 종목 수를 미리 확인.",
      "Phase 2 후반에 에이전트가 새 섹터를 자동 등록하면 여기에 등장.",
    ],
    lookFor: [
      "관심 사이클(예: 메모리 사이클, 우주 인프라)에 해당하는 섹터 카드.",
      "horizon — 10년 / 15년 / 20년 등 시뮬레이션 시계.",
      "드라이버 개수 — 모델 복잡도의 proxy.",
    ],
  },
};
