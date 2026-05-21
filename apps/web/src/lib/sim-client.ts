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
export type SimGraphResponse = RouterOutput["sim"]["graph"];
export type GraphNode = SimGraphResponse["nodes"][number];
export type GraphEdge = SimGraphResponse["edges"][number];

// DB-backed graph (Milestone 7+). Replaces the upstream sim.graph proxy
// for read paths once seeded. Field names differ from the Python-side
// `id` / `source` / `target` legacy shape — see normalizeGraph() below
// for the bridge that GraphView consumes.
export type DbGraph = RouterOutput["graph"]["get"];
export type DbGraphNode = DbGraph["nodes"][number];
export type DbGraphEdge = DbGraph["edges"][number];
export type ReportResponse = RouterOutput["sim"]["report"];
export type ReportSource = ReportResponse["sources"][number];

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

export type Equity = RouterOutput["equity"]["get"];
export type EquityDriverLink = Equity["driver_links"][number];
export type EquityHistoryBar = RouterOutput["equity"]["history"][number];
export type BasketStats = RouterOutput["equity"]["basketStats"];
export type BasketStatsEquity = BasketStats["equities"][number];

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

export async function fetchGraph(slug: string): Promise<SimGraphResponse> {
  return rethrow(() => trpc.sim.graph.query({ slug }), `fetchGraph(${slug})`);
}

/**
 * Fetch the DB-backed causal graph for a sector. This is the
 * authoritative source after Milestone 7 — `fetchGraph` (sim.graph)
 * remains as a fallback while old call-sites migrate.
 */
export async function fetchDbGraph(sectorSlug: string): Promise<DbGraph> {
  return rethrow(
    () => trpc.graph.get.query({ sector_slug: sectorSlug }),
    `fetchDbGraph(${sectorSlug})`,
  );
}

/**
 * Normalize the DB graph shape into the legacy `SimGraphResponse`
 * shape that `GraphView` already speaks. This keeps the renderer
 * untouched at the M7 boundary; M8 will give it more first-class DB
 * fields (weight slider, magnitude styling, equity nodes).
 */
export function normalizeDbGraph(g: DbGraph): SimGraphResponse {
  return {
    slug: g.sector_slug,
    nodes: g.nodes.map((n) => ({
      id: n.node_key,
      label: n.label,
      kind: n.kind,
      group: n.group,
      unit: n.unit ?? "",
      description: n.description ?? "",
    })),
    edges: g.edges.map((e) => ({
      source: e.source_key,
      target: e.target_key,
      label: e.label ?? "",
    })),
  };
}

export async function upsertGraphEdge(input: {
  sector_slug: string;
  source_key: string;
  target_key: string;
  weight?: number;
  magnitude?: "low" | "med" | "high";
  label?: string | null;
  author_label?: string;
}): Promise<DbGraphEdge> {
  return rethrow(
    () => trpc.graph.upsertEdge.mutate(input),
    `upsertGraphEdge(${input.source_key}→${input.target_key})`,
  );
}

export async function deleteGraphEdge(input: {
  sector_slug: string;
  source_key: string;
  target_key: string;
  author_label?: string;
}): Promise<{ sector_slug: string; source_key: string; target_key: string }> {
  return rethrow(
    () => trpc.graph.deleteEdge.mutate(input),
    `deleteGraphEdge(${input.source_key}→${input.target_key})`,
  );
}

export async function resetGraphToDefaults(
  sectorSlug: string,
  authorLabel?: string,
): Promise<{ sector_slug: string; nodes_deleted: number; edges_deleted: number }> {
  return rethrow(
    () =>
      trpc.graph.resetToDefaults.mutate({
        sector_slug: sectorSlug,
        author_label: authorLabel,
      }),
    `resetGraphToDefaults(${sectorSlug})`,
  );
}

export async function generateReport(input: {
  slug: string;
  drivers: Record<string, number>;
  scenario_name?: string | null;
  scenario_notes?: string | null;
}): Promise<ReportResponse> {
  return rethrow(
    () => trpc.sim.report.mutate(input),
    `generateReport(${input.slug})`,
  );
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

// ---------- Equity (read-only) ----------

export async function fetchEquities(
  sectorSlug: string,
  isoCountry?: "US" | "KR",
): Promise<Equity[]> {
  return rethrow(
    () =>
      trpc.equity.listForSector.query({
        sector_slug: sectorSlug,
        iso_country: isoCountry,
      }),
    `fetchEquities(${sectorSlug})`,
  );
}

export async function fetchEquityHistory(
  id: string,
  days: number = 90,
): Promise<EquityHistoryBar[]> {
  return rethrow(
    () => trpc.equity.history.query({ id, days }),
    `fetchEquityHistory(${id})`,
  );
}

export async function fetchBasketStats(
  sectorSlug: string,
  days: number = 90,
): Promise<BasketStats> {
  return rethrow(
    () => trpc.equity.basketStats.query({ sector_slug: sectorSlug, days }),
    `fetchBasketStats(${sectorSlug})`,
  );
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
