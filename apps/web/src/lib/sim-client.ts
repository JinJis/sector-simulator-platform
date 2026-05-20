// Public, host-accessible URL — used by the browser and any user-facing display.
export const SIM_SERVICE_URL =
  process.env.NEXT_PUBLIC_SIMULATION_SERVICE_URL ?? "http://localhost:8000";

// Server-side fetches (RSC/route handlers) run inside the web container and
// can't reach the host-mapped port. Prefer the docker-internal hostname when
// set; outside Docker the env var is unset and we fall back to the public URL.
const FETCH_BASE =
  typeof window === "undefined"
    ? (process.env.SIMULATION_SERVICE_URL ?? SIM_SERVICE_URL)
    : SIM_SERVICE_URL;

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

export interface SimMetadata {
  slug: string;
  name: string;
  description: string;
  horizon_years: number;
  drivers: DriverSchema[];
  presets: Record<string, Record<string, number>>;
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
