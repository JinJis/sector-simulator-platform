export const SIM_SERVICE_URL =
  process.env.NEXT_PUBLIC_SIMULATION_SERVICE_URL ?? "http://localhost:8000";

export interface DriverSchema {
  name: string;
  default: number;
  min: number;
  max: number;
  unit: string;
  description: string;
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
}

export interface SimRunResponse {
  slug: string;
  drivers: Record<string, number>;
  outputs: OutputSchema[];
}

export async function fetchSim(slug: string): Promise<SimMetadata> {
  const res = await fetch(`${SIM_SERVICE_URL}/sims/${slug}`, { cache: "no-store" });
  if (!res.ok) throw new Error(`fetchSim failed: ${res.status} ${res.statusText}`);
  return res.json() as Promise<SimMetadata>;
}

export async function runSim(
  slug: string,
  drivers: Record<string, number>,
): Promise<SimRunResponse> {
  const res = await fetch(`${SIM_SERVICE_URL}/sims/${slug}/run`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ drivers }),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`runSim failed: ${res.status} ${res.statusText}`);
  return res.json() as Promise<SimRunResponse>;
}
