// Browser-side: same-origin via Next.js rewrites (see next.config.ts). This
// keeps the simulation-service off the public internet and dodges CORS /
// host-mismatch issues when apps/web is served from a non-localhost origin
// (Docker on a remote host, cloud-workstation preview URL, etc.).
const BROWSER_BASE = "/api/sim";

// Server-side (RSC / route handlers): run inside the web container, so prefer
// the docker-internal hostname. Falls back to the public URL when unset
// (host-mode dev).
const SERVER_BASE =
  process.env.SIMULATION_SERVICE_URL ?? "http://localhost:8000";

const FETCH_BASE = typeof window === "undefined" ? SERVER_BASE : BROWSER_BASE;

// Exported for diagnostic UI text only.
export const SIM_SERVICE_URL = SERVER_BASE;

export interface DriverSchema {
  name: string;
  default: number;
  min: number;
  max: number;
  unit: string;
  description: string;
  group: string;
}

export interface OutputSchema {
  name: string;
  series: number[] | null;
  scalar: number | null;
  unit: string;
  description: string;
}

export interface SourceSchema {
  title: string;
  url: string;
  excerpt: string;
  as_of: string;
  /** paper | vendor_doc | analyst | benchmark | gov_report | dataset | news | filing | "" */
  kind: string;
}

export interface HistoryPointSchema {
  date: string;
  value: number;
}

export interface ProvenanceSchema {
  history: HistoryPointSchema[];
  sources: SourceSchema[];
  note: string;
}

export interface SimMetadata {
  slug: string;
  name: string;
  description: string;
  horizon_years: number;
  drivers: DriverSchema[];
  presets: Record<string, Record<string, number>>;
  provenance: Record<string, ProvenanceSchema>;
}

export interface SimRunResponse {
  slug: string;
  drivers: Record<string, number>;
  outputs: OutputSchema[];
}

export interface SensitivityEntry {
  driver: string;
  swing: number;
}

export interface SensitivityResponse {
  slug: string;
  by_output: Record<string, SensitivityEntry[]>;
}

export interface LiveResponse {
  slug: string;
  tick: number;
  timestamp: string;
  drivers: Record<string, number>;
  outputs: OutputSchema[];
}

export async function fetchSim(slug: string): Promise<SimMetadata> {
  const res = await fetch(`${FETCH_BASE}/sims/${slug}`, { cache: "no-store" });
  if (!res.ok) throw new Error(`fetchSim failed: ${res.status} ${res.statusText}`);
  return res.json() as Promise<SimMetadata>;
}

export async function runSim(
  slug: string,
  drivers: Record<string, number>,
): Promise<SimRunResponse> {
  const res = await fetch(`${FETCH_BASE}/sims/${slug}/run`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ drivers }),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`runSim failed: ${res.status} ${res.statusText}`);
  return res.json() as Promise<SimRunResponse>;
}

export async function fetchSensitivity(slug: string): Promise<SensitivityResponse> {
  const res = await fetch(`${FETCH_BASE}/sims/${slug}/sensitivity`, {
    cache: "no-store",
  });
  if (!res.ok)
    throw new Error(`fetchSensitivity failed: ${res.status} ${res.statusText}`);
  return res.json() as Promise<SensitivityResponse>;
}

export async function fetchLive(slug: string): Promise<LiveResponse> {
  const res = await fetch(`${FETCH_BASE}/sims/${slug}/live`, { cache: "no-store" });
  if (!res.ok) throw new Error(`fetchLive failed: ${res.status} ${res.statusText}`);
  return res.json() as Promise<LiveResponse>;
}
