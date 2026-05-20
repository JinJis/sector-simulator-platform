import type { OutputSchema } from "@/lib/sim-client";

export function prettyName(snake: string): string {
  return snake
    .replace(/_/g, " ")
    .replace(/\busd\b/gi, "USD")
    .replace(/\bpflops\b/gi, "PFLOPS")
    .replace(/\bnpv\b/gi, "NPV")
    .replace(/\bpct\b/gi, "%")
    .replace(/\byr\b/gi, "yr")
    .replace(/\bkw\b/gi, "kW")
    .replace(/\bw\b/gi, "W")
    .replace(/\bkg\b/gi, "kg")
    .replace(/\s+per\s+/g, "/")
    .trim();
}

export function formatDriverValue(v: number, unit: string): string {
  const abs = Math.abs(v);
  let body: string;
  if (Number.isInteger(v) && abs < 1000) body = v.toFixed(0);
  else if (abs >= 1000) body = v.toLocaleString("en-US", { maximumFractionDigits: 0 });
  else if (abs >= 10) body = v.toFixed(1);
  else body = v.toFixed(2);
  return unit ? `${body} ${unit}` : body;
}

export function formatValue(v: number, unit: string): string {
  if (!Number.isFinite(v)) return "—";
  const abs = Math.abs(v);
  if (unit === "USD" || unit === "$") {
    const sign = v < 0 ? "-" : "";
    if (abs >= 1e9) return `${sign}$${(abs / 1e9).toFixed(2)}B`;
    if (abs >= 1e6) return `${sign}$${(abs / 1e6).toFixed(2)}M`;
    if (abs >= 1e3) return `${sign}$${(abs / 1e3).toFixed(1)}k`;
    return `${sign}$${abs.toFixed(0)}`;
  }
  if (unit === "yr") return `${v.toFixed(1)} yr`;
  if (abs >= 1e6) return `${(v / 1e6).toFixed(2)}M ${unit}`;
  if (abs >= 1e3) return `${(v / 1e3).toFixed(1)}k ${unit}`;
  if (abs >= 10) return `${v.toFixed(1)} ${unit}`;
  return `${v.toFixed(2)} ${unit}`;
}

export function compactNumber(v: number): string {
  const abs = Math.abs(v);
  if (abs >= 1e9) return `${(v / 1e9).toFixed(1)}B`;
  if (abs >= 1e6) return `${(v / 1e6).toFixed(1)}M`;
  if (abs >= 1e3) return `${(v / 1e3).toFixed(1)}k`;
  return v.toFixed(0);
}

export interface SeriesPair {
  key: string;
  title: string;
  unit: string;
  description: string;
  outputs: OutputSchema[];
}

export function pairSeries(series: OutputSchema[]): SeriesPair[] {
  const pairs = new Map<string, OutputSchema[]>();
  const order: string[] = [];
  for (const out of series) {
    const key = out.name
      .replace(/_(space|ground)_usd$/, "")
      .replace(/_(space|ground)$/, "");
    if (!pairs.has(key)) {
      pairs.set(key, []);
      order.push(key);
    }
    pairs.get(key)!.push(out);
  }
  return order.map((key) => {
    const outputs = pairs.get(key)!;
    const first = outputs[0]!;
    return {
      key,
      title: prettyName(key),
      unit: first.unit,
      description: first.description,
      outputs,
    };
  });
}

export function seriesLabel(out: OutputSchema): string {
  if (/_space_usd$/.test(out.name) || /_space$/.test(out.name)) return "space";
  if (/_ground_usd$/.test(out.name) || /_ground$/.test(out.name)) return "ground";
  return prettyName(out.name);
}

export const GROUP_ORDER = ["Launch", "Compute", "Power", "Thermal", "Economics"];

export const COLORS = {
  primary: "#22d3ee",
  secondary: "#f97316",
  tertiary: "#a3e635",
  positive: "#34d399",
  negative: "#f87171",
  muted: "#737373",
  grid: "#262626",
  surface: "#0a0a0a",
};

export interface SourceKindMeta {
  label: string;
  /** Long-form description shown in tooltips / ingest legends. */
  description: string;
  /** Tailwind classes baked at build-time (JIT can't see dynamic strings). */
  pillClass: string;
  /** Solid hex for chart accents (not used for badge bg). */
  accent: string;
}

const FALLBACK_KIND: SourceKindMeta = {
  label: "unclassified",
  description: "출처 종류 미지정",
  pillClass: "bg-neutral-800 text-neutral-400 border-neutral-700",
  accent: "#737373",
};

export const SOURCE_KINDS: Record<string, SourceKindMeta> = {
  paper: {
    label: "paper",
    description: "학술/기술 논문 (peer-reviewed, technical reports)",
    pillClass: "bg-violet-950/60 text-violet-300 border-violet-800/70",
    accent: "#a78bfa",
  },
  vendor_doc: {
    label: "vendor",
    description: "벤더 공식 문서 (datasheet, spec, 제조사 발표)",
    pillClass: "bg-amber-950/60 text-amber-300 border-amber-800/70",
    accent: "#fbbf24",
  },
  analyst: {
    label: "analyst",
    description: "애널리스트 리포트/추정 (sell-side, consulting)",
    pillClass: "bg-sky-950/60 text-sky-300 border-sky-800/70",
    accent: "#38bdf8",
  },
  benchmark: {
    label: "benchmark",
    description: "산업 벤치마크 (MLPerf, SPECpower 등 표준 테스트)",
    pillClass: "bg-emerald-950/60 text-emerald-300 border-emerald-800/70",
    accent: "#34d399",
  },
  gov_report: {
    label: "gov",
    description: "정부 기관 보고서 (FAA, NASA, ESA, NREL 등)",
    pillClass: "bg-rose-950/60 text-rose-300 border-rose-800/70",
    accent: "#fb7185",
  },
  dataset: {
    label: "dataset",
    description: "데이터셋/모델 출력 (관측 데이터, 시뮬레이션 결과)",
    pillClass: "bg-teal-950/60 text-teal-300 border-teal-800/70",
    accent: "#2dd4bf",
  },
  news: {
    label: "news",
    description: "보도 자료 / 뉴스 기사",
    pillClass: "bg-pink-950/60 text-pink-300 border-pink-800/70",
    accent: "#f472b6",
  },
  filing: {
    label: "filing",
    description: "공시 / 재무 보고 (10-K, 실적 발표 등)",
    pillClass: "bg-orange-950/60 text-orange-300 border-orange-800/70",
    accent: "#fb923c",
  },
};

export function sourceKindMeta(kind: string | undefined | null): SourceKindMeta {
  if (!kind) return FALLBACK_KIND;
  return SOURCE_KINDS[kind] ?? FALLBACK_KIND;
}

/** Render order for legend / ingest panel. */
export const SOURCE_KIND_ORDER = [
  "paper",
  "gov_report",
  "vendor_doc",
  "analyst",
  "benchmark",
  "dataset",
  "filing",
  "news",
];
