/**
 * Equities seed — populates `sector_equities` with 49 hand-curated US +
 * KR listings across the three registered sectors. Snapshot prices /
 * market caps are end-of-day 2026-04-30 (FX 1,380 KRW/USD) — point-in-
 * time, not live. The data-pipeline-service ingest milestone (Equities
 * #2) replaces these snapshots with refreshed daily quotes.
 *
 * Idempotent: re-running upserts on the (sector_slug, ticker, exchange)
 * composite key. Safe to run in any environment.
 *
 *   pnpm db:seed-equities
 *
 * Driver linkage convention:
 *   driver_links: [
 *     { driver: "<exact driver name from sims/<slug>.py>",
 *       sign:   "+" | "-",   // direction of impact on this equity's revenue
 *       magnitude: "low" | "med" | "high",
 *       note?:  string }    // 1-line rationale shown in the UI tooltip
 *   ]
 *
 * The user-app Equities view reads `driver_links` to compute a directional
 * impact preview when the active driver state diverges from the sector
 * defaults — a structured editorial overlay, not an econometric model.
 */

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const SNAPSHOT_DATE = new Date("2026-04-30T00:00:00Z");
const FX_KRW_PER_USD = 1380;

type DriverLink = {
  driver: string;
  sign: "+" | "-";
  magnitude: "low" | "med" | "high";
  note?: string;
};

interface SeedEquity {
  sector_slug: string;
  ticker: string;
  exchange: "NYSE" | "NASDAQ" | "KOSPI" | "KOSDAQ";
  iso_country: "US" | "KR";
  company_name: string;
  company_name_local?: string;
  sector_exposure_pct: number;
  rationale?: string;
  currency: "USD" | "KRW";
  last_close_local: number;
  market_cap_usd_b: number; // billions; converted below
  driver_links: DriverLink[];
  display_order?: number;
}

// ---------- memory-semi ----------
// Driver names (see services/simulation-service/simulation_service/sims/memory_semi.py):
//   ai_dram_demand_cagr_pct, commodity_dram_demand_cagr_pct,
//   commodity_dram_asp_usd_per_gb, commodity_dram_asp_cagr_pct,
//   hbm_premium_x, hbm_mix_pct_of_ai_demand, company_market_share_pct,
//   dram_cost_reduction_pct_per_year, capex_intensity_pct,
//   opex_pct_of_revenue, discount_rate_pct
const MEMORY: SeedEquity[] = [
  // -- KR (makers / supply chain — closest to the sim's POV) --
  {
    sector_slug: "memory-semi",
    ticker: "005930",
    exchange: "KOSPI",
    iso_country: "KR",
    company_name: "Samsung Electronics",
    company_name_local: "삼성전자",
    sector_exposure_pct: 35,
    rationale:
      "글로벌 DRAM 1위. 메모리 외 비메모리·디바이스 합산 이익이 크지만 메모리 사이클이 EPS 변동의 가장 큰 변수.",
    currency: "KRW",
    last_close_local: 78_000,
    market_cap_usd_b: 295,
    driver_links: [
      { driver: "ai_dram_demand_cagr_pct", sign: "+", magnitude: "high", note: "AI DRAM 수요↑ → 매출 + 믹스 개선" },
      { driver: "hbm_mix_pct_of_ai_demand", sign: "+", magnitude: "high" },
      { driver: "hbm_premium_x", sign: "+", magnitude: "high" },
      { driver: "company_market_share_pct", sign: "+", magnitude: "high" },
      { driver: "commodity_dram_asp_usd_per_gb", sign: "+", magnitude: "med" },
    ],
    display_order: 1,
  },
  {
    sector_slug: "memory-semi",
    ticker: "000660",
    exchange: "KOSPI",
    iso_country: "KR",
    company_name: "SK hynix",
    company_name_local: "SK하이닉스",
    sector_exposure_pct: 95,
    rationale:
      "HBM 시장 선두. NVIDIA H/B/200·B100·블랙웰 메인 공급사로 hbm_premium·믹스에 가장 민감.",
    currency: "KRW",
    last_close_local: 220_000,
    market_cap_usd_b: 116,
    driver_links: [
      { driver: "hbm_premium_x", sign: "+", magnitude: "high", note: "HBM ASP 프리미엄이 EPS 핵심" },
      { driver: "hbm_mix_pct_of_ai_demand", sign: "+", magnitude: "high" },
      { driver: "ai_dram_demand_cagr_pct", sign: "+", magnitude: "high" },
      { driver: "company_market_share_pct", sign: "+", magnitude: "high" },
    ],
    display_order: 2,
  },
  {
    sector_slug: "memory-semi",
    ticker: "042700",
    exchange: "KOSDAQ",
    iso_country: "KR",
    company_name: "Hanmi Semiconductor",
    company_name_local: "한미반도체",
    sector_exposure_pct: 90,
    rationale: "HBM TC 본더(thermocompression bonder) 글로벌 1위. HBM 믹스 확대의 1차 수혜.",
    currency: "KRW",
    last_close_local: 110_000,
    market_cap_usd_b: 7.5,
    driver_links: [
      { driver: "hbm_mix_pct_of_ai_demand", sign: "+", magnitude: "high", note: "TC 본더는 HBM 적층 필수 장비" },
      { driver: "capex_intensity_pct", sign: "+", magnitude: "high", note: "고객 capex↑ = 장비 발주↑" },
    ],
    display_order: 3,
  },
  {
    sector_slug: "memory-semi",
    ticker: "403870",
    exchange: "KOSDAQ",
    iso_country: "KR",
    company_name: "HPSP",
    sector_exposure_pct: 80,
    rationale: "고압 어닐링 장비. HBM·로직 노드 미세화에 같이 침투. 메모리 capex 사이클에 후행.",
    currency: "KRW",
    last_close_local: 38_000,
    market_cap_usd_b: 2.3,
    driver_links: [
      { driver: "capex_intensity_pct", sign: "+", magnitude: "high" },
      { driver: "hbm_mix_pct_of_ai_demand", sign: "+", magnitude: "med" },
    ],
  },
  {
    sector_slug: "memory-semi",
    ticker: "357780",
    exchange: "KOSDAQ",
    iso_country: "KR",
    company_name: "Soulbrain",
    company_name_local: "솔브레인",
    sector_exposure_pct: 70,
    rationale: "HF 식각액·전구체. 메모리 fab 가동률에 직결.",
    currency: "KRW",
    last_close_local: 215_000,
    market_cap_usd_b: 1.3,
    driver_links: [
      { driver: "ai_dram_demand_cagr_pct", sign: "+", magnitude: "med" },
      { driver: "capex_intensity_pct", sign: "+", magnitude: "med" },
    ],
  },
  {
    sector_slug: "memory-semi",
    ticker: "240810",
    exchange: "KOSDAQ",
    iso_country: "KR",
    company_name: "Wonik IPS",
    company_name_local: "원익IPS",
    sector_exposure_pct: 75,
    rationale: "PECVD·ALD 장비. 메모리 capex 강한 사이클에서 수주 가속.",
    currency: "KRW",
    last_close_local: 30_000,
    market_cap_usd_b: 1.5,
    driver_links: [
      { driver: "capex_intensity_pct", sign: "+", magnitude: "high" },
      { driver: "ai_dram_demand_cagr_pct", sign: "+", magnitude: "med" },
    ],
  },
  {
    sector_slug: "memory-semi",
    ticker: "039030",
    exchange: "KOSDAQ",
    iso_country: "KR",
    company_name: "Eo Technics",
    company_name_local: "이오테크닉스",
    sector_exposure_pct: 65,
    rationale: "레이저 어닐러·마커. HBM 패키지 공정에 동반 침투.",
    currency: "KRW",
    last_close_local: 165_000,
    market_cap_usd_b: 1.3,
    driver_links: [
      { driver: "hbm_mix_pct_of_ai_demand", sign: "+", magnitude: "med" },
      { driver: "capex_intensity_pct", sign: "+", magnitude: "med" },
    ],
  },
  // -- US (makers + equipment + downstream consumers) --
  {
    sector_slug: "memory-semi",
    ticker: "MU",
    exchange: "NASDAQ",
    iso_country: "US",
    company_name: "Micron Technology",
    sector_exposure_pct: 100,
    rationale: "DRAM·NAND 순수 메모리 메이커. HBM3E 양산 진입으로 hbm 변수 민감도 상승.",
    currency: "USD",
    last_close_local: 110,
    market_cap_usd_b: 120,
    driver_links: [
      { driver: "ai_dram_demand_cagr_pct", sign: "+", magnitude: "high" },
      { driver: "hbm_premium_x", sign: "+", magnitude: "high" },
      { driver: "hbm_mix_pct_of_ai_demand", sign: "+", magnitude: "high" },
      { driver: "commodity_dram_asp_usd_per_gb", sign: "+", magnitude: "high" },
      { driver: "dram_cost_reduction_pct_per_year", sign: "+", magnitude: "med" },
    ],
    display_order: 4,
  },
  {
    sector_slug: "memory-semi",
    ticker: "NVDA",
    exchange: "NASDAQ",
    iso_country: "US",
    company_name: "NVIDIA",
    sector_exposure_pct: 25,
    rationale:
      "HBM의 가장 큰 수요처. AI DRAM 수요↑가 자사 GPU 수요와 동행. ASP↑는 BOM 부담이지만 통과 가능.",
    currency: "USD",
    last_close_local: 130,
    market_cap_usd_b: 3_200,
    driver_links: [
      { driver: "ai_dram_demand_cagr_pct", sign: "+", magnitude: "high", note: "AI 수요 = GPU 수요" },
      { driver: "hbm_premium_x", sign: "-", magnitude: "low", note: "BOM 부담 (대부분 통과)" },
    ],
  },
  {
    sector_slug: "memory-semi",
    ticker: "AMD",
    exchange: "NASDAQ",
    iso_country: "US",
    company_name: "AMD",
    sector_exposure_pct: 20,
    rationale: "MI300/Instinct 라인이 HBM 의존. AI 가속 수요와 동행.",
    currency: "USD",
    last_close_local: 185,
    market_cap_usd_b: 300,
    driver_links: [
      { driver: "ai_dram_demand_cagr_pct", sign: "+", magnitude: "high" },
      { driver: "hbm_premium_x", sign: "-", magnitude: "low" },
    ],
  },
  {
    sector_slug: "memory-semi",
    ticker: "INTC",
    exchange: "NASDAQ",
    iso_country: "US",
    company_name: "Intel",
    sector_exposure_pct: 10,
    rationale: "서버 DRAM 수요. Gaudi/AI 가속기 점유율 한계로 hbm 노출 낮음.",
    currency: "USD",
    last_close_local: 25,
    market_cap_usd_b: 108,
    driver_links: [
      { driver: "ai_dram_demand_cagr_pct", sign: "+", magnitude: "low" },
      { driver: "commodity_dram_asp_usd_per_gb", sign: "-", magnitude: "low" },
    ],
  },
  {
    sector_slug: "memory-semi",
    ticker: "AMAT",
    exchange: "NASDAQ",
    iso_country: "US",
    company_name: "Applied Materials",
    sector_exposure_pct: 30,
    rationale: "메모리 fab CVD/etch 핵심 공급. 메모리 capex 사이클의 글로벌 1차 수혜.",
    currency: "USD",
    last_close_local: 190,
    market_cap_usd_b: 158,
    driver_links: [
      { driver: "capex_intensity_pct", sign: "+", magnitude: "high" },
      { driver: "ai_dram_demand_cagr_pct", sign: "+", magnitude: "med" },
    ],
  },
  {
    sector_slug: "memory-semi",
    ticker: "LRCX",
    exchange: "NASDAQ",
    iso_country: "US",
    company_name: "Lam Research",
    sector_exposure_pct: 40,
    rationale: "에치·디포지션 강자. 메모리(특히 NAND, HBM TSV) 비중 절대적.",
    currency: "USD",
    last_close_local: 90,
    market_cap_usd_b: 115,
    driver_links: [
      { driver: "capex_intensity_pct", sign: "+", magnitude: "high" },
      { driver: "hbm_mix_pct_of_ai_demand", sign: "+", magnitude: "med", note: "TSV 식각 → HBM 직접 수혜" },
    ],
  },
  {
    sector_slug: "memory-semi",
    ticker: "KLAC",
    exchange: "NASDAQ",
    iso_country: "US",
    company_name: "KLA Corporation",
    sector_exposure_pct: 25,
    rationale: "검사·계측. 미세화·복잡도 증가로 메모리 capex와 동행.",
    currency: "USD",
    last_close_local: 810,
    market_cap_usd_b: 108,
    driver_links: [{ driver: "capex_intensity_pct", sign: "+", magnitude: "high" }],
  },
  {
    sector_slug: "memory-semi",
    ticker: "MRVL",
    exchange: "NASDAQ",
    iso_country: "US",
    company_name: "Marvell Technology",
    sector_exposure_pct: 15,
    rationale: "메모리 인터커넥트(CXL, 광 I/O). AI DRAM 대역폭 수요 동행.",
    currency: "USD",
    last_close_local: 72,
    market_cap_usd_b: 63,
    driver_links: [{ driver: "ai_dram_demand_cagr_pct", sign: "+", magnitude: "med" }],
  },
  {
    sector_slug: "memory-semi",
    ticker: "WDC",
    exchange: "NASDAQ",
    iso_country: "US",
    company_name: "Western Digital",
    sector_exposure_pct: 50,
    rationale: "NAND/HDD. AI 학습 데이터셋 스토리지 수요. HBM 직접 노출 아님.",
    currency: "USD",
    last_close_local: 58,
    market_cap_usd_b: 20,
    driver_links: [
      { driver: "ai_dram_demand_cagr_pct", sign: "+", magnitude: "med" },
      { driver: "commodity_dram_asp_usd_per_gb", sign: "+", magnitude: "med" },
    ],
  },
  {
    sector_slug: "memory-semi",
    ticker: "TSM",
    exchange: "NYSE",
    iso_country: "US",
    company_name: "Taiwan Semiconductor (ADR)",
    sector_exposure_pct: 15,
    rationale:
      "CoWoS 패키징을 통해 HBM과 GPU를 잇는 병목. HBM 믹스 확대 = CoWoS 수요.",
    currency: "USD",
    last_close_local: 190,
    market_cap_usd_b: 986,
    driver_links: [
      { driver: "hbm_mix_pct_of_ai_demand", sign: "+", magnitude: "high", note: "CoWoS 병목" },
      { driver: "ai_dram_demand_cagr_pct", sign: "+", magnitude: "high" },
    ],
  },
];

// ---------- space-data-center ----------
// Drivers: launch_cost_usd_per_kg, payload_overhead_factor,
//   compute_demand_pflops, chip_pflops_per_kw, chip_capex_usd_per_pflops,
//   chip_radiation_degradation_pct_per_year, panel_efficiency_w_per_kg,
//   panel_degradation_pct_per_year, solar_duty_cycle,
//   radiator_kg_per_kw_heat, mission_lifetime_years,
//   annual_opex_pct_of_capex, discount_rate_pct,
//   ground_baseline_cost_per_pflops_year_usd
const SPACE: SeedEquity[] = [
  {
    sector_slug: "space-data-center",
    ticker: "RKLB",
    exchange: "NASDAQ",
    iso_country: "US",
    company_name: "Rocket Lab USA",
    sector_exposure_pct: 70,
    rationale: "Electron·Neutron 발사체. launch_cost_per_kg 하락의 직접 수혜 + 핵심 가능 조건.",
    currency: "USD",
    last_close_local: 21,
    market_cap_usd_b: 9.7,
    driver_links: [
      { driver: "launch_cost_usd_per_kg", sign: "-", magnitude: "high", note: "발사단가↓ = 발사 시장 확대 → 매출↑" },
      { driver: "compute_demand_pflops", sign: "+", magnitude: "high", note: "궤도 컴퓨트 수요 = 발사 수요" },
    ],
    display_order: 1,
  },
  {
    sector_slug: "space-data-center",
    ticker: "ASTS",
    exchange: "NASDAQ",
    iso_country: "US",
    company_name: "AST SpaceMobile",
    sector_exposure_pct: 60,
    rationale: "Direct-to-cell 위성. 궤도 데이터 인프라 수요와 동행. 발사단가에 매우 민감.",
    currency: "USD",
    last_close_local: 22,
    market_cap_usd_b: 5.5,
    driver_links: [
      { driver: "launch_cost_usd_per_kg", sign: "-", magnitude: "high" },
      { driver: "mission_lifetime_years", sign: "+", magnitude: "med", note: "위성 수명↑ = capex/yr↓" },
    ],
  },
  {
    sector_slug: "space-data-center",
    ticker: "IRDM",
    exchange: "NASDAQ",
    iso_country: "US",
    company_name: "Iridium Communications",
    sector_exposure_pct: 50,
    rationale: "LEO 통신 위성 운용. 우주 데이터센터의 다운링크 가치 사슬.",
    currency: "USD",
    last_close_local: 28,
    market_cap_usd_b: 3.3,
    driver_links: [
      { driver: "compute_demand_pflops", sign: "+", magnitude: "med" },
      { driver: "launch_cost_usd_per_kg", sign: "-", magnitude: "med" },
    ],
  },
  {
    sector_slug: "space-data-center",
    ticker: "LUNR",
    exchange: "NASDAQ",
    iso_country: "US",
    company_name: "Intuitive Machines",
    sector_exposure_pct: 55,
    rationale: "달 표면 서비스 + 궤도 인프라. 미션 수명·발사단가에 영향.",
    currency: "USD",
    last_close_local: 7,
    market_cap_usd_b: 0.9,
    driver_links: [
      { driver: "launch_cost_usd_per_kg", sign: "-", magnitude: "med" },
      { driver: "mission_lifetime_years", sign: "+", magnitude: "med" },
    ],
  },
  {
    sector_slug: "space-data-center",
    ticker: "PL",
    exchange: "NYSE",
    iso_country: "US",
    company_name: "Planet Labs",
    sector_exposure_pct: 45,
    rationale: "지구관측 위성 데이터. 궤도 데이터 처리 수요 증가의 간접 수혜.",
    currency: "USD",
    last_close_local: 4,
    market_cap_usd_b: 1.2,
    driver_links: [
      { driver: "compute_demand_pflops", sign: "+", magnitude: "med" },
      { driver: "chip_radiation_degradation_pct_per_year", sign: "-", magnitude: "low" },
    ],
  },
  {
    sector_slug: "space-data-center",
    ticker: "NVDA",
    exchange: "NASDAQ",
    iso_country: "US",
    company_name: "NVIDIA",
    sector_exposure_pct: 5,
    rationale: "궤도 컴퓨트 칩 공급 가능성. 현재는 작은 익스포저이나 chip_capex 변수의 글로벌 1차 공급사.",
    currency: "USD",
    last_close_local: 130,
    market_cap_usd_b: 3_200,
    driver_links: [
      { driver: "compute_demand_pflops", sign: "+", magnitude: "high", note: "궤도 컴퓨트 = GPU 수요" },
      { driver: "chip_capex_usd_per_pflops", sign: "+", magnitude: "med", note: "프리미엄 칩 가격" },
    ],
  },
  {
    sector_slug: "space-data-center",
    ticker: "EQIX",
    exchange: "NASDAQ",
    iso_country: "US",
    company_name: "Equinix",
    sector_exposure_pct: 10,
    rationale: "지상 데이터센터 REIT. 우주 DC가 비용 경쟁력 가지면 장기 베이스라인 위협 (역방향 노출).",
    currency: "USD",
    last_close_local: 850,
    market_cap_usd_b: 80,
    driver_links: [
      {
        driver: "ground_baseline_cost_per_pflops_year_usd",
        sign: "+",
        magnitude: "high",
        note: "지상 단가↑ = 오비탈 대비 EQIX 매력도 ↑",
      },
      { driver: "launch_cost_usd_per_kg", sign: "+", magnitude: "low", note: "발사단가↑ = 오비탈 위협↓" },
    ],
  },
  {
    sector_slug: "space-data-center",
    ticker: "DLR",
    exchange: "NYSE",
    iso_country: "US",
    company_name: "Digital Realty Trust",
    sector_exposure_pct: 10,
    rationale: "지상 DC REIT. EQIX와 동일 구조.",
    currency: "USD",
    last_close_local: 158,
    market_cap_usd_b: 54,
    driver_links: [
      { driver: "ground_baseline_cost_per_pflops_year_usd", sign: "+", magnitude: "high" },
      { driver: "launch_cost_usd_per_kg", sign: "+", magnitude: "low" },
    ],
  },
  {
    sector_slug: "space-data-center",
    ticker: "VRT",
    exchange: "NYSE",
    iso_country: "US",
    company_name: "Vertiv Holdings",
    sector_exposure_pct: 15,
    rationale: "데이터센터 전력/열 관리. 우주 DC의 열 관리(라디에이터) 적용 가능.",
    currency: "USD",
    last_close_local: 98,
    market_cap_usd_b: 37,
    driver_links: [
      { driver: "radiator_kg_per_kw_heat", sign: "-", magnitude: "med", note: "열 관리 효율↑ = 솔루션 수요↑" },
      { driver: "compute_demand_pflops", sign: "+", magnitude: "med" },
    ],
  },
  {
    sector_slug: "space-data-center",
    ticker: "LMT",
    exchange: "NYSE",
    iso_country: "US",
    company_name: "Lockheed Martin",
    sector_exposure_pct: 15,
    rationale: "방산·우주 시스템 통합. 궤도 인프라 발사·서비스 계약.",
    currency: "USD",
    last_close_local: 480,
    market_cap_usd_b: 115,
    driver_links: [
      { driver: "compute_demand_pflops", sign: "+", magnitude: "med" },
      { driver: "mission_lifetime_years", sign: "+", magnitude: "low" },
    ],
  },
  // -- KR --
  {
    sector_slug: "space-data-center",
    ticker: "012450",
    exchange: "KOSPI",
    iso_country: "KR",
    company_name: "Hanwha Aerospace",
    company_name_local: "한화에어로스페이스",
    sector_exposure_pct: 30,
    rationale: "누리호 후속·차세대 발사체 개발 주관. 한국 launch_cost 곡선의 정책 베타.",
    currency: "KRW",
    last_close_local: 320_000,
    market_cap_usd_b: 11,
    driver_links: [
      { driver: "launch_cost_usd_per_kg", sign: "-", magnitude: "high" },
      { driver: "compute_demand_pflops", sign: "+", magnitude: "med" },
    ],
    display_order: 2,
  },
  {
    sector_slug: "space-data-center",
    ticker: "047810",
    exchange: "KOSPI",
    iso_country: "KR",
    company_name: "Korea Aerospace Industries",
    company_name_local: "한국항공우주산업",
    sector_exposure_pct: 25,
    rationale: "위성 본체 양산 + 우주 사업 확대. 발사 시장 확대의 국내 수혜.",
    currency: "KRW",
    last_close_local: 65_000,
    market_cap_usd_b: 4.7,
    driver_links: [
      { driver: "launch_cost_usd_per_kg", sign: "-", magnitude: "med" },
      { driver: "mission_lifetime_years", sign: "+", magnitude: "low" },
    ],
  },
  {
    sector_slug: "space-data-center",
    ticker: "099320",
    exchange: "KOSPI",
    iso_country: "KR",
    company_name: "Satrec Initiative",
    company_name_local: "쎄트렉아이",
    sector_exposure_pct: 80,
    rationale: "한화 자회사. EO 위성·소형위성 양산. 궤도 데이터 자산 직접 노출.",
    currency: "KRW",
    last_close_local: 50_000,
    market_cap_usd_b: 0.5,
    driver_links: [
      { driver: "compute_demand_pflops", sign: "+", magnitude: "med" },
      { driver: "launch_cost_usd_per_kg", sign: "-", magnitude: "med" },
      { driver: "mission_lifetime_years", sign: "+", magnitude: "med" },
    ],
  },
  {
    sector_slug: "space-data-center",
    ticker: "189300",
    exchange: "KOSDAQ",
    iso_country: "KR",
    company_name: "Intellian Technologies",
    company_name_local: "인텔리안테크",
    sector_exposure_pct: 55,
    rationale: "LEO 위성 통신 안테나 글로벌 점유. 다운링크 수요와 동행.",
    currency: "KRW",
    last_close_local: 95_000,
    market_cap_usd_b: 0.7,
    driver_links: [
      { driver: "compute_demand_pflops", sign: "+", magnitude: "med" },
      { driver: "launch_cost_usd_per_kg", sign: "-", magnitude: "med" },
    ],
  },
  {
    sector_slug: "space-data-center",
    ticker: "064350",
    exchange: "KOSPI",
    iso_country: "KR",
    company_name: "Hyundai Rotem",
    company_name_local: "현대로템",
    sector_exposure_pct: 10,
    rationale: "방산·궤도 서비스 가능성. 우주 노출은 옵션 가치 수준.",
    currency: "KRW",
    last_close_local: 51_000,
    market_cap_usd_b: 3.2,
    driver_links: [{ driver: "compute_demand_pflops", sign: "+", magnitude: "low" }],
  },
];

// ---------- sofc ----------
// Drivers: system_capex_usd_per_kw, system_efficiency_pct_lhv,
//   system_size_mw, capacity_factor_pct, stack_lifetime_years,
//   stack_replacement_cost_usd_per_kw, degradation_pct_per_year,
//   natural_gas_price_usd_per_mmbtu, annual_om_pct_of_capex,
//   discount_rate_pct, grid_lcoe_usd_per_mwh, project_lifetime_years
const SOFC: SeedEquity[] = [
  {
    sector_slug: "sofc",
    ticker: "BE",
    exchange: "NYSE",
    iso_country: "US",
    company_name: "Bloom Energy",
    sector_exposure_pct: 95,
    rationale: "순수 SOFC 제조·운영사. 모든 SOFC 드라이버의 직접 노출.",
    currency: "USD",
    last_close_local: 24,
    market_cap_usd_b: 5.7,
    driver_links: [
      { driver: "system_capex_usd_per_kw", sign: "-", magnitude: "high", note: "capex↓ = 경쟁력↑" },
      { driver: "system_efficiency_pct_lhv", sign: "+", magnitude: "high" },
      { driver: "stack_lifetime_years", sign: "+", magnitude: "high" },
      { driver: "natural_gas_price_usd_per_mmbtu", sign: "-", magnitude: "high" },
      { driver: "grid_lcoe_usd_per_mwh", sign: "+", magnitude: "high", note: "그리드 LCOE↑ = SOFC 매력도↑" },
    ],
    display_order: 1,
  },
  {
    sector_slug: "sofc",
    ticker: "PLUG",
    exchange: "NASDAQ",
    iso_country: "US",
    company_name: "Plug Power",
    sector_exposure_pct: 60,
    rationale: "PEMFC 중심이지만 H2 인프라·SOFC 인접 시장 동행.",
    currency: "USD",
    last_close_local: 2.5,
    market_cap_usd_b: 2.3,
    driver_links: [
      { driver: "system_capex_usd_per_kw", sign: "-", magnitude: "med" },
      { driver: "grid_lcoe_usd_per_mwh", sign: "+", magnitude: "med" },
    ],
  },
  {
    sector_slug: "sofc",
    ticker: "FCEL",
    exchange: "NASDAQ",
    iso_country: "US",
    company_name: "FuelCell Energy",
    sector_exposure_pct: 80,
    rationale: "MCFC + SOFC 라인업. 정부 보조·전력 시장 LCOE에 민감.",
    currency: "USD",
    last_close_local: 1.2,
    market_cap_usd_b: 0.6,
    driver_links: [
      { driver: "grid_lcoe_usd_per_mwh", sign: "+", magnitude: "high" },
      { driver: "natural_gas_price_usd_per_mmbtu", sign: "-", magnitude: "high" },
      { driver: "stack_lifetime_years", sign: "+", magnitude: "high" },
    ],
  },
  {
    sector_slug: "sofc",
    ticker: "BLDP",
    exchange: "NASDAQ",
    iso_country: "US",
    company_name: "Ballard Power Systems",
    sector_exposure_pct: 50,
    rationale: "PEMFC 모빌리티 중심. 고정형 SOFC와는 동조성 낮음.",
    currency: "USD",
    last_close_local: 1.8,
    market_cap_usd_b: 0.5,
    driver_links: [
      { driver: "system_capex_usd_per_kw", sign: "-", magnitude: "med" },
      { driver: "grid_lcoe_usd_per_mwh", sign: "+", magnitude: "low" },
    ],
  },
  {
    sector_slug: "sofc",
    ticker: "CMI",
    exchange: "NYSE",
    iso_country: "US",
    company_name: "Cummins",
    sector_exposure_pct: 15,
    rationale: "디젤 발전기 본업 + H2/연료전지 트랜지션. SOFC 직접 노출은 작음.",
    currency: "USD",
    last_close_local: 345,
    market_cap_usd_b: 48,
    driver_links: [
      { driver: "grid_lcoe_usd_per_mwh", sign: "+", magnitude: "low" },
      { driver: "natural_gas_price_usd_per_mmbtu", sign: "-", magnitude: "med" },
    ],
  },
  {
    sector_slug: "sofc",
    ticker: "LIN",
    exchange: "NYSE",
    iso_country: "US",
    company_name: "Linde",
    sector_exposure_pct: 10,
    rationale: "산업가스·H2 공급. SOFC 보다는 SOEC/그린수소 사이클.",
    currency: "USD",
    last_close_local: 480,
    market_cap_usd_b: 232,
    driver_links: [
      { driver: "natural_gas_price_usd_per_mmbtu", sign: "+", magnitude: "low", note: "본업은 그리드+가스 마진" },
    ],
  },
  {
    sector_slug: "sofc",
    ticker: "APD",
    exchange: "NYSE",
    iso_country: "US",
    company_name: "Air Products and Chemicals",
    sector_exposure_pct: 12,
    rationale: "H2 메가프로젝트 베팅. SOFC 시스템 가스 공급망.",
    currency: "USD",
    last_close_local: 295,
    market_cap_usd_b: 66,
    driver_links: [
      { driver: "natural_gas_price_usd_per_mmbtu", sign: "+", magnitude: "low" },
      { driver: "grid_lcoe_usd_per_mwh", sign: "+", magnitude: "low" },
    ],
  },
  {
    sector_slug: "sofc",
    ticker: "GTLS",
    exchange: "NYSE",
    iso_country: "US",
    company_name: "Chart Industries",
    sector_exposure_pct: 25,
    rationale: "수소·LNG·산업가스 인프라. 연료전지 가스 처리 보조.",
    currency: "USD",
    last_close_local: 160,
    market_cap_usd_b: 6.8,
    driver_links: [
      { driver: "natural_gas_price_usd_per_mmbtu", sign: "-", magnitude: "low" },
      { driver: "grid_lcoe_usd_per_mwh", sign: "+", magnitude: "low" },
    ],
  },
  {
    sector_slug: "sofc",
    ticker: "BWXT",
    exchange: "NYSE",
    iso_country: "US",
    company_name: "BWX Technologies",
    sector_exposure_pct: 10,
    rationale: "SMR 원전·수소 부산물 가능성. 분산형 발전 일반의 수혜.",
    currency: "USD",
    last_close_local: 115,
    market_cap_usd_b: 10.5,
    driver_links: [{ driver: "grid_lcoe_usd_per_mwh", sign: "+", magnitude: "low" }],
  },
  {
    sector_slug: "sofc",
    ticker: "NEE",
    exchange: "NYSE",
    iso_country: "US",
    company_name: "NextEra Energy",
    sector_exposure_pct: 8,
    rationale: "재생·전력 유틸리티. 그리드 LCOE 상승은 분산형 SOFC와 같은 방향.",
    currency: "USD",
    last_close_local: 78,
    market_cap_usd_b: 160,
    driver_links: [{ driver: "grid_lcoe_usd_per_mwh", sign: "+", magnitude: "low" }],
  },
  // -- KR --
  {
    sector_slug: "sofc",
    ticker: "336260",
    exchange: "KOSPI",
    iso_country: "KR",
    company_name: "Doosan Fuel Cell",
    company_name_local: "두산퓨얼셀",
    sector_exposure_pct: 95,
    rationale: "국내 유일 SOFC + PAFC 순수 플레이. RPS·CHPS 정책에 노출.",
    currency: "KRW",
    last_close_local: 19_500,
    market_cap_usd_b: 1.0,
    driver_links: [
      { driver: "system_capex_usd_per_kw", sign: "-", magnitude: "high" },
      { driver: "system_efficiency_pct_lhv", sign: "+", magnitude: "high" },
      { driver: "grid_lcoe_usd_per_mwh", sign: "+", magnitude: "high" },
      { driver: "natural_gas_price_usd_per_mmbtu", sign: "-", magnitude: "high" },
      { driver: "stack_lifetime_years", sign: "+", magnitude: "high" },
    ],
    display_order: 2,
  },
  {
    sector_slug: "sofc",
    ticker: "034020",
    exchange: "KOSPI",
    iso_country: "KR",
    company_name: "Doosan Enerbility",
    company_name_local: "두산에너빌리티",
    sector_exposure_pct: 25,
    rationale: "원자력·가스터빈·SMR. 분산형 발전 일반의 멀티 베타.",
    currency: "KRW",
    last_close_local: 23_000,
    market_cap_usd_b: 4.9,
    driver_links: [
      { driver: "grid_lcoe_usd_per_mwh", sign: "+", magnitude: "med" },
      { driver: "natural_gas_price_usd_per_mmbtu", sign: "-", magnitude: "low" },
    ],
  },
  {
    sector_slug: "sofc",
    ticker: "298040",
    exchange: "KOSPI",
    iso_country: "KR",
    company_name: "Hyosung Heavy Industries",
    company_name_local: "효성중공업",
    sector_exposure_pct: 15,
    rationale: "변압기·중전기. SOFC 보다는 분산형 발전 인프라 광역 수혜.",
    currency: "KRW",
    last_close_local: 470_000,
    market_cap_usd_b: 3.2,
    driver_links: [{ driver: "grid_lcoe_usd_per_mwh", sign: "+", magnitude: "med" }],
  },
  {
    sector_slug: "sofc",
    ticker: "009830",
    exchange: "KOSPI",
    iso_country: "KR",
    company_name: "Hanwha Solutions",
    company_name_local: "한화솔루션",
    sector_exposure_pct: 18,
    rationale: "수소·태양광·이차전지 멀티 베타. 청정 전력 LCOE 사이클.",
    currency: "KRW",
    last_close_local: 25_000,
    market_cap_usd_b: 3.7,
    driver_links: [
      { driver: "grid_lcoe_usd_per_mwh", sign: "+", magnitude: "low" },
      { driver: "natural_gas_price_usd_per_mmbtu", sign: "-", magnitude: "low" },
    ],
  },
  {
    sector_slug: "sofc",
    ticker: "051910",
    exchange: "KOSPI",
    iso_country: "KR",
    company_name: "LG Chem",
    company_name_local: "LG화학",
    sector_exposure_pct: 8,
    rationale: "이차전지·소재. SOFC 직접 노출 작음 (전해질 R&D 옵션).",
    currency: "KRW",
    last_close_local: 310_000,
    market_cap_usd_b: 16,
    driver_links: [{ driver: "grid_lcoe_usd_per_mwh", sign: "+", magnitude: "low" }],
  },
  {
    sector_slug: "sofc",
    ticker: "006400",
    exchange: "KOSPI",
    iso_country: "KR",
    company_name: "Samsung SDI",
    company_name_local: "삼성SDI",
    sector_exposure_pct: 8,
    rationale: "이차전지. 청정 전력 일반 베타로만 노출.",
    currency: "KRW",
    last_close_local: 290_000,
    market_cap_usd_b: 14.5,
    driver_links: [{ driver: "grid_lcoe_usd_per_mwh", sign: "+", magnitude: "low" }],
  },
  {
    sector_slug: "sofc",
    ticker: "003670",
    exchange: "KOSPI",
    iso_country: "KR",
    company_name: "POSCO Future M",
    company_name_local: "포스코퓨처엠",
    sector_exposure_pct: 10,
    rationale: "양극재·음극재. SOFC 직접 보다는 전반적 청정 전력/소재.",
    currency: "KRW",
    last_close_local: 155_000,
    market_cap_usd_b: 8.7,
    driver_links: [{ driver: "grid_lcoe_usd_per_mwh", sign: "+", magnitude: "low" }],
  },
];

const ALL: SeedEquity[] = [...MEMORY, ...SPACE, ...SOFC];

function toUsd(local: number, currency: "USD" | "KRW"): number {
  return currency === "USD" ? local : local / FX_KRW_PER_USD;
}

async function main(): Promise<void> {
  console.log(`[seed-equities] upserting ${ALL.length} equities across 3 sectors…`);
  let written = 0;
  for (const e of ALL) {
    const market_cap_usd = e.market_cap_usd_b * 1e9;
    const last_close_usd = toUsd(e.last_close_local, e.currency);
    await prisma.sectorEquity.upsert({
      where: {
        sector_slug_ticker_exchange: {
          sector_slug: e.sector_slug,
          ticker: e.ticker,
          exchange: e.exchange,
        },
      },
      update: {
        iso_country: e.iso_country,
        company_name: e.company_name,
        company_name_local: e.company_name_local ?? null,
        sector_exposure_pct: e.sector_exposure_pct,
        rationale: e.rationale ?? null,
        currency: e.currency,
        last_close_local: e.last_close_local,
        last_close_usd,
        last_close_date: SNAPSHOT_DATE,
        market_cap_usd,
        driver_links: e.driver_links,
        display_order: e.display_order ?? 0,
      },
      create: {
        sector_slug: e.sector_slug,
        ticker: e.ticker,
        exchange: e.exchange,
        iso_country: e.iso_country,
        company_name: e.company_name,
        company_name_local: e.company_name_local ?? null,
        sector_exposure_pct: e.sector_exposure_pct,
        rationale: e.rationale ?? null,
        currency: e.currency,
        last_close_local: e.last_close_local,
        last_close_usd,
        last_close_date: SNAPSHOT_DATE,
        market_cap_usd,
        driver_links: e.driver_links,
        display_order: e.display_order ?? 0,
      },
    });
    written += 1;
  }
  console.log(`[seed-equities] wrote ${written} rows.`);
  const counts = await prisma.sectorEquity.groupBy({
    by: ["sector_slug"],
    _count: { _all: true },
  });
  for (const c of counts) {
    console.log(`  ${c.sector_slug}: ${c._count._all}`);
  }
}

main()
  .catch((e) => {
    console.error("[seed-equities] failed:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
