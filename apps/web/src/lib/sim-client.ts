/**
 * Typed client for the sector-service tRPC API.
 *
 * Boundary topology:
 *   Browser  → /api/sim/trpc/*           (Next.js rewrite, set in next.config.ts)
 *              ↓ same-origin, dodges CORS / non-localhost dev origins
 *              → sector-service:8001/trpc/*
 *
 *   RSC / route handler (Node side of Next)
 *            → ${SECTOR_SERVICE_URL}/trpc/*   default http://localhost:8001
 *              ↓ runs inside the web container — must use the docker-internal
 *                hostname, not the host port mapping.
 *
 * The wrapper functions below preserve the previous REST-era surface
 * (fetchSims / fetchSim / runSim / fetchSensitivity / fetchLive) so call
 * sites don't change. Types are inferred from the AppRouter export instead
 * of duplicated, so any schema change in sector-service surfaces here as a
 * type error.
 */

import type { AppRouter } from "@platform/sector-service";
import { createTRPCClient, httpBatchLink, TRPCClientError } from "@trpc/client";
import type { inferRouterOutputs } from "@trpc/server";

// ---------- URL resolution ----------

const BROWSER_BASE = "/api/sim/trpc";

const SERVER_BASE = `${process.env.SECTOR_SERVICE_URL ?? "http://localhost:8001"}/trpc`;

const TRPC_URL = typeof window === "undefined" ? SERVER_BASE : BROWSER_BASE;

// Exported only for diagnostic UI text — surfaces the upstream the *server*
// side sees, which is the one that fails first when sector-service is down.
export const SECTOR_SERVICE_URL =
  process.env.SECTOR_SERVICE_URL ?? "http://localhost:8001";

// ---------- tRPC client ----------

export const trpc = createTRPCClient<AppRouter>({
  links: [
    httpBatchLink({
      url: TRPC_URL,
      // `/live` polls every 3s — Next's default fetch cache would happily
      // serve a stale tick. Force no-store on every tRPC HTTP call.
      fetch: (input, init) => fetch(input, { ...init, cache: "no-store" }),
    }),
  ],
});

// ---------- Inferred types (replace the previously hand-maintained interfaces) ----------

type RouterOutput = inferRouterOutputs<AppRouter>;

export type SimMetadata = RouterOutput["sim"]["get"];
export type SimRunResponse = RouterOutput["sim"]["run"];
export type SensitivityResponse = RouterOutput["sim"]["sensitivity"];
export type LiveResponse = RouterOutput["sim"]["live"];

export type DriverSchema = SimMetadata["drivers"][number];
export type OutputSchema = SimRunResponse["outputs"][number];
export type ProvenanceSchema = SimMetadata["provenance"][string];
export type SourceSchema = ProvenanceSchema["sources"][number];
export type HistoryPointSchema = ProvenanceSchema["history"][number];
export type SensitivityEntry = SensitivityResponse["by_output"][string][number];

// Heads up: the `created_at` / `updated_at` fields on Scenario are typed as
// Date here (inferred from the server's zod schema) but arrive as ISO
// strings over the wire — tRPC doesn't ship a transformer in this project.
// Don't call Date methods on them client-side; treat as opaque.
export type Scenario = RouterOutput["scenario"]["get"];

// ---------- Functional surface (unchanged shape) ----------
//
// We wrap rather than re-export `trpc.sim.*.query/mutate` directly so the
// callers continue to read like plain async functions — and so that, if we
// later need to swap clients again (e.g. add suspense, change transport),
// the seam is here.

export async function fetchSims(): Promise<SimMetadata[]> {
  return rethrow(() => trpc.sim.list.query(), "fetchSims");
}

export async function fetchSim(slug: string): Promise<SimMetadata> {
  return rethrow(() => trpc.sim.get.query({ slug }), `fetchSim(${slug})`);
}

export async function runSim(
  slug: string,
  drivers: Record<string, number>,
): Promise<SimRunResponse> {
  return rethrow(() => trpc.sim.run.mutate({ slug, drivers }), `runSim(${slug})`);
}

export async function fetchSensitivity(slug: string): Promise<SensitivityResponse> {
  return rethrow(
    () => trpc.sim.sensitivity.query({ slug }),
    `fetchSensitivity(${slug})`,
  );
}

export async function fetchLive(slug: string): Promise<LiveResponse> {
  return rethrow(() => trpc.sim.live.query({ slug }), `fetchLive(${slug})`);
}

// ---------- Scenario CRUD ----------

export async function fetchScenarios(sectorSlug?: string): Promise<Scenario[]> {
  return rethrow(
    () =>
      trpc.scenario.list.query({
        sector_slug: sectorSlug,
        limit: 50,
      }),
    `fetchScenarios(${sectorSlug ?? "*"})`,
  );
}

export async function fetchScenario(id: string): Promise<Scenario> {
  return rethrow(() => trpc.scenario.get.query({ id }), `fetchScenario(${id})`);
}

export async function createScenario(input: {
  sector_slug: string;
  name: string;
  notes?: string;
  driver_overrides: Record<string, number>;
  author_label?: string;
}): Promise<Scenario> {
  return rethrow(() => trpc.scenario.create.mutate(input), "createScenario");
}

export async function updateScenario(input: {
  id: string;
  name?: string;
  notes?: string | null;
  driver_overrides?: Record<string, number>;
}): Promise<Scenario> {
  return rethrow(() => trpc.scenario.update.mutate(input), `updateScenario(${input.id})`);
}

export async function deleteScenario(id: string): Promise<{ id: string }> {
  return rethrow(() => trpc.scenario.delete.mutate({ id }), `deleteScenario(${id})`);
}

// ---------- Error normalization ----------
//
// tRPC throws TRPCClientError, whose `message` is the upstream error body.
// We prepend the calling function name so the existing error-handling UI
// (which prints `err.message`) keeps its previous level of detail.

async function rethrow<T>(fn: () => Promise<T>, label: string): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof TRPCClientError) {
      throw new Error(`${label} failed: ${e.message}`);
    }
    throw e;
  }
}
