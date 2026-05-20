/**
 * Typed tRPC client for the admin app. Same shape as apps/web's client —
 * kept in-app rather than extracted to a shared package because the admin
 * surface will diverge as more admin-specific procedures land (ingest
 * controls, approval workflow, etc.) and we don't want to bend the user
 * client around admin needs.
 */

import type { AppRouter } from "@platform/sector-service";
import { createTRPCClient, httpBatchLink, TRPCClientError } from "@trpc/client";
import type { inferRouterOutputs } from "@trpc/server";

const BROWSER_BASE = "/api/sim/trpc";
const SERVER_BASE = `${process.env.SECTOR_SERVICE_URL ?? "http://localhost:8001"}/trpc`;
const TRPC_URL = typeof window === "undefined" ? SERVER_BASE : BROWSER_BASE;

export const SECTOR_SERVICE_URL =
  process.env.SECTOR_SERVICE_URL ?? "http://localhost:8001";

export const trpc = createTRPCClient<AppRouter>({
  links: [
    httpBatchLink({
      url: TRPC_URL,
      fetch: (input, init) => fetch(input, { ...init, cache: "no-store" }),
    }),
  ],
});

type RouterOutput = inferRouterOutputs<AppRouter>;

export type SimMetadata = RouterOutput["sim"]["get"];
export type DriverSchema = SimMetadata["drivers"][number];
export type ProvenanceSchema = SimMetadata["provenance"][string];
export type SourceSchema = ProvenanceSchema["sources"][number];
export type Scenario = RouterOutput["scenario"]["get"];

export async function fetchSims(): Promise<SimMetadata[]> {
  return rethrow(() => trpc.sim.list.query(), "fetchSims");
}

export async function fetchSim(slug: string): Promise<SimMetadata> {
  return rethrow(() => trpc.sim.get.query({ slug }), `fetchSim(${slug})`);
}

export async function fetchScenarios(sectorSlug?: string): Promise<Scenario[]> {
  return rethrow(
    () =>
      trpc.scenario.list.query({
        sector_slug: sectorSlug,
        limit: 200,
      }),
    `fetchScenarios(${sectorSlug ?? "*"})`,
  );
}

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
