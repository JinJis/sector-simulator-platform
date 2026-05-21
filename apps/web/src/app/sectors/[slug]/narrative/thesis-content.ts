/**
 * Editorial growth-thesis content per sector. Hand-curated for now;
 * the agent-generation slice will eventually plug in here, but the
 * structure (paragraph + drivers + blockers + flagship tickers) is
 * frozen so the UI can iterate independently.
 *
 * `driverRefs` reference drivers by their `name` (as they appear in
 * `meta.drivers`). The narrative page resolves them to current-value
 * + default and renders a delta chip; refs that don't match the
 * current sector's drivers are silently dropped.
 */

export interface ThesisBullet {
  /** Short title shown in the bullet header. */
  title: string;
  /** One-sentence explanation. */
  detail: string;
  /** Driver name(s) backing this point (must match `meta.drivers[].name`). */
  driverRefs?: string[];
}

export interface SectorThesis {
  /** 1-paragraph elevator pitch (~3 sentences). */
  summary: string;
  /**
   * "Growth horizon" — what we expect to come true if drivers
   * cooperate. Short phrase, 1-line max.
   */
  horizon: string;
  /** Positive forces — 3 bullets. */
  drivers: ThesisBullet[];
  /** Headwinds — 3 bullets. */
  blockers: ThesisBullet[];
  /** Tickers the editorial team views as the cleanest expressions. */
  flagshipTickers: string[];
}

export const SECTOR_THESES: Record<string, SectorThesis> = {
  "memory-semi": {
    summary:
      "AI 학습/추론 워크로드 폭증으로 HBM(고대역폭 메모리) 수요가 2027년까지 연 40% 이상 성장. " +
      "DRAM ASP 강세 + HBM 프리미엄 7-9× 유지 시 메모리 3사의 영업이익이 사상 최대 수준에 진입. " +
      "다만 capex 사이클 과열과 일반 DRAM 공급 과잉은 후행 리스크다.",
    horizon: "AI 메모리 슈퍼사이클 (2026-2028)",
    drivers: [
      {
        title: "AI DRAM 수요 + CAGR",
        detail:
          "프론티어 모델 학습/추론 메모리 풋프린트가 두 자릿수 후반 CAGR로 성장. HBM 수요의 직접 동인.",
        driverRefs: ["ai_dram_demand_pb_y0", "ai_dram_demand_cagr_pct"],
      },
      {
        title: "HBM 프리미엄 × mix 확대",
        detail:
          "AI 수요 중 HBM 비중이 증가하면서 평균 단가 × 프리미엄 곱이 매출의 가장 큰 swing factor.",
        driverRefs: ["hbm_premium_x", "hbm_mix_pct_of_ai_demand"],
      },
      {
        title: "일반 DRAM ASP 회복",
        detail:
          "재고 정상화 + 공급 제약으로 일반 DRAM ASP도 동반 상승. 사이클의 깊이를 결정.",
        driverRefs: ["commodity_dram_asp_cagr_pct", "commodity_dram_asp_usd_per_gb"],
      },
    ],
    blockers: [
      {
        title: "Capex 인플레이션",
        detail:
          "선단 공정(1b/1c) fab 비용이 매 분기 갱신. capex_intensity 가 18% 이상으로 유지되면 FCF 회수 곡선이 압박.",
        driverRefs: ["capex_intensity_pct"],
      },
      {
        title: "회사별 시장점유율 변화",
        detail:
          "Samsung / SK hynix / Micron 간 HBM 점유율 이동이 개별사 실적의 최대 단일 변수.",
        driverRefs: ["company_market_share_pct"],
      },
      {
        title: "원가 절감 둔화",
        detail:
          "DRAM bit cost reduction 폭이 한 자릿수 후반에 머무르면 마진 확장이 ASP에만 의존. 사이클 후반 위험.",
        driverRefs: ["dram_cost_reduction_pct_per_year"],
      },
    ],
    flagshipTickers: ["005930", "000660", "MU", "NVDA"],
  },

  "space-data-center": {
    summary:
      "Starship/Neutron 시대의 발사 비용 하락(<$1k/kg)과 솔라/방열 기술 진보로 우주 데이터센터의 LCOE가 지상 대비 경쟁 가능 영역에 진입. " +
      "AI 추론 워크로드의 일부가 궤도로 옮겨갈 가능성 — 위성·발사·페이로드 공급망 전체가 동시 수혜. " +
      "단, 방열·전력·시스템 수명의 3대 병목이 해소되어야 본격 상업화가 열린다.",
    horizon: "궤도 컴퓨팅 인프라 (2027-2032)",
    drivers: [
      {
        title: "발사 비용 하락",
        detail:
          "재사용 로켓 확대로 kg당 발사 비용이 매년 15-25%씩 하락. 우주 데이터센터의 핵심 cost driver.",
        driverRefs: ["launch_cost_usd_per_kg"],
      },
      {
        title: "AI 추론 수요 분산",
        detail:
          "지상 데이터센터의 전력·냉각 한계로 일부 컴퓨팅이 궤도로 이전. 신규 수요 풀.",
        driverRefs: ["compute_demand_pflops"],
      },
      {
        title: "솔라 패널 효율",
        detail:
          "다중 접합 셀의 우주용 효율 진전. W/kg 비율이 발전 면적-비용 곡선을 압축.",
        driverRefs: ["panel_efficiency_w_per_kg"],
      },
    ],
    blockers: [
      {
        title: "방열 시스템 무게",
        detail:
          "진공에서 열을 버리는 방열판이 페이로드 무게의 큰 비중. 비용 곡선이 가장 더디게 내려옴.",
        driverRefs: ["radiator_kg_per_kw_heat"],
      },
      {
        title: "방사선 열화",
        detail:
          "궤도 환경의 누적 방사선이 칩 PFLOPS 성능을 연 단위로 갉아먹음. 교체 주기 압박.",
        driverRefs: ["chip_radiation_degradation_pct_per_year", "panel_degradation_pct_per_year"],
      },
      {
        title: "미션 수명 vs Capex",
        detail:
          "재투입 전 운용 기간이 짧으면 LCOE가 지상 대비 매력 없음. 회수 곡선의 가장 큰 변수.",
        driverRefs: ["mission_lifetime_years"],
      },
    ],
    flagshipTickers: ["RKLB", "ASTS", "012450", "099320"],
  },

  sofc: {
    summary:
      "데이터센터 백업·도시가스 분산발전 수요로 SOFC(고체산화물 연료전지) 도입이 가속. " +
      "발전효율 60%+ 가 검증되면 가스 터빈 대비 단위 발전 단가가 경쟁 가능 영역. " +
      "탄소 가격 상승과 EU 그린딜이 외부 tailwind. 다만 스택 내구도와 자본 회수 기간이 핵심 변수.",
    horizon: "분산발전 SOFC 상업화 (2026-2030)",
    drivers: [
      {
        title: "전기 발전 효율 (LHV)",
        detail:
          "스택 효율이 55% → 65%+로 진입하면 연료비 회수 곡선이 급격히 가파라진다.",
        driverRefs: ["system_efficiency_pct_lhv"],
      },
      {
        title: "탄소 가격 상승",
        detail:
          "EU ETS / 한국 K-ETS의 톤당 단가가 오를수록 가스 터빈 대비 SOFC의 LCOE 우위가 확대.",
        driverRefs: ["carbon_price_usd_per_ton_co2"],
      },
      {
        title: "그리드 LCOE 동반 상승",
        detail:
          "전력가격 자체가 오르면 자가발전 회수 기간이 단축. SOFC 도입 의사결정의 임계점이 낮아짐.",
        driverRefs: ["grid_lcoe_usd_per_mwh"],
      },
    ],
    blockers: [
      {
        title: "스택 내구도",
        detail:
          "스택 수명이 짧으면 LCOE 곡선이 가스 터빈 대비 매력 없음. 5년 미만이면 보조금 없이 ROI 곤란.",
        driverRefs: ["stack_lifetime_years", "stack_replacement_cost_usd_per_kw"],
      },
      {
        title: "Capex per kW",
        detail:
          "초기 설비 단가가 가스 터빈의 2-3× 수준. 양산 곡선 진입 전에는 자본 회수가 빡빡함.",
        driverRefs: ["system_capex_usd_per_kw"],
      },
      {
        title: "천연가스 가격 변동",
        detail:
          "가스 가격이 낮게 유지될수록 SOFC 운영 마진이 둔화. tailwind/headwind 양면.",
        driverRefs: ["natural_gas_price_usd_per_mmbtu"],
      },
    ],
    flagshipTickers: ["BE", "PLUG", "336260", "034020"],
  },
};

/**
 * Fallback used when a sector has no curated thesis yet. Keeps the
 * page non-empty for agent-generated sectors that ship before the
 * editorial team gets to them.
 */
export const FALLBACK_THESIS_SUMMARY =
  "이 섹터는 아직 편집 thesis가 작성되지 않았습니다. " +
  "Manual 탭의 sensitivity 결과와 Equities 탭의 driver_links를 참고하세요.";
