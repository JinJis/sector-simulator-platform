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
