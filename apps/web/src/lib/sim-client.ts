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

/**
 * Forward the user's session cookie on every tRPC call.
 *
 * - Browser side: `credentials: "include"` is enough — the cookie is
 *   already on the same-origin /api/sim/trpc path thanks to the Next
 *   rewrite, and the browser sends it automatically.
 * - RSC / route handler side: the Next process is not the user's
 *   browser, so we have to read the incoming request's cookies via
 *   `next/headers` and forward them to sector-service ourselves.
 *
 * `next/headers` is server-only and import-side-effect-free at module
 * load, so we lazy-import it inside the fetch callback.
 */
async function fetchWithSession(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response> {
  let cookieHeader: string | undefined;
  if (typeof window === "undefined") {
    try {
      const { cookies } = await import("next/headers");
      const c = await cookies();
      cookieHeader = c.toString();
    } catch {
      // outside a request scope (e.g. build step) — no cookies, no auth
    }
  }
  return fetch(input, {
    ...init,
    cache: "no-store",
    credentials: "include",
    headers: {
      ...init?.headers,
      ...(cookieHeader ? { cookie: cookieHeader } : {}),
    },
  });
}

export const trpc = createTRPCClient<AppRouter>({
  links: [
    httpBatchLink({
      url: TRPC_URL,
      fetch: fetchWithSession,
    }),
  ],
});

// ---------- Inferred types (replace the previously hand-maintained interfaces) ----------

type RouterOutput = inferRouterOutputs<AppRouter>;

// ---------- Auth (M20) ----------

export type CurrentUser = NonNullable<RouterOutput["auth"]["me"]>;

export async function fetchMe(): Promise<CurrentUser | null> {
  // Don't go through `rethrow` — anonymous (no session) is a normal
  // state, not an error, and we don't want it logged as such.
  try {
    return await trpc.auth.me.query();
  } catch {
    return null;
  }
}

export async function signUp(input: {
  email: string;
  password: string;
  name?: string;
}): Promise<CurrentUser> {
  return rethrow(() => trpc.auth.signUp.mutate(input), "signUp");
}

export async function signIn(input: {
  email: string;
  password: string;
}): Promise<CurrentUser> {
  return rethrow(() => trpc.auth.signIn.mutate(input), "signIn");
}

export async function signOut(): Promise<{ ok: boolean }> {
  return rethrow(() => trpc.auth.signOut.mutate(), "signOut");
}

export async function updateMe(input: {
  name?: string | null;
  locale?: "ko" | "en" | null;
  theme?: "dark" | "light" | "system" | null;
}): Promise<CurrentUser> {
  return rethrow(() => trpc.auth.updateMe.mutate(input), "updateMe");
}

export async function changePassword(input: {
  current_password: string;
  new_password: string;
}): Promise<{ ok: boolean }> {
  return rethrow(
    () => trpc.auth.changePassword.mutate(input),
    "changePassword",
  );
}

// ---------- Inferred sim types ----------

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

export async function upsertGraphNode(input: {
  sector_slug: string;
  node_key: string;
  kind: "driver" | "intermediate" | "output" | "equity";
  label: string;
  group?: string;
  unit?: string | null;
  description?: string | null;
  equity_id?: string | null;
  author_label?: string;
}): Promise<DbGraphNode> {
  return rethrow(
    () => trpc.graph.upsertNode.mutate(input),
    `upsertGraphNode(${input.node_key})`,
  );
}

export async function deleteGraphNode(input: {
  sector_slug: string;
  node_key: string;
  author_label?: string;
}): Promise<{ sector_slug: string; node_key: string }> {
  return rethrow(
    () => trpc.graph.deleteNode.mutate(input),
    `deleteGraphNode(${input.node_key})`,
  );
}

export type GraphResetResult = {
  sector_slug: string;
  nodes: number;
  edges: number;
  equity_nodes: number;
  equity_edges: number;
  skipped_driver_misses: number;
};

export async function resetGraphToDefaults(
  sectorSlug: string,
  authorLabel?: string,
): Promise<GraphResetResult> {
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

export type EquityFinancialQuarter = RouterOutput["equity"]["financials"][number];

export async function fetchEquityFinancials(
  id: string,
  quarters: number = 8,
): Promise<EquityFinancialQuarter[]> {
  return rethrow(
    () => trpc.equity.financials.query({ id, quarters }),
    `fetchEquityFinancials(${id})`,
  );
}

// ---------- Billing (M26) ----------

export type BillingStatus = RouterOutput["billing"]["status"];
export type BillingSubscription = RouterOutput["billing"]["mySubscription"];

export async function fetchBillingStatus(): Promise<BillingStatus> {
  return rethrow(() => trpc.billing.status.query(), "fetchBillingStatus");
}

export async function fetchMySubscription(): Promise<BillingSubscription> {
  return rethrow(
    () => trpc.billing.mySubscription.query(),
    "fetchMySubscription",
  );
}

export async function startCheckout(): Promise<{ url: string }> {
  return rethrow(() => trpc.billing.checkout.mutate(), "startCheckout");
}

export async function openBillingPortal(): Promise<{ url: string }> {
  return rethrow(() => trpc.billing.portal.mutate(), "openBillingPortal");
}

// ---------- Agent budget (M27) ----------

export type AgentBudget = RouterOutput["agent"]["budget"];

export async function fetchAgentBudget(): Promise<AgentBudget> {
  return rethrow(() => trpc.agent.budget.query(), "fetchAgentBudget");
}

// ---------- Predictions (M32) ----------

export type PredictionRow = RouterOutput["prediction"]["recent"][number];
export type LeaderboardRow = RouterOutput["prediction"]["leaderboard"][number];
export type MyScore = RouterOutput["prediction"]["myScore"];

export type RationaleAnalysis = RouterOutput["prediction"]["analyzeRationale"];

export async function createPrediction(input: {
  equity_id: string;
  horizon: "1d" | "1w" | "1m";
  predicted_pct: number;
  rationale?: string;
  scenario_id?: string;
  rationale_analysis?: RationaleAnalysis;
}): Promise<RouterOutput["prediction"]["create"]> {
  return rethrow(
    () => trpc.prediction.create.mutate(input),
    `createPrediction(${input.equity_id})`,
  );
}

export async function analyzeRationale(input: {
  equity_id: string;
  horizon: "1d" | "1w" | "1m";
  predicted_pct: number;
  rationale: string;
  scenario_id?: string;
}): Promise<RationaleAnalysis> {
  return rethrow(
    () => trpc.prediction.analyzeRationale.mutate(input),
    "analyzeRationale",
  );
}

export async function fetchPredictionsForEquity(
  equity_id: string,
  limit = 20,
): Promise<PredictionRow[]> {
  return rethrow(
    () => trpc.prediction.listForEquity.query({ equity_id, limit }),
    `fetchPredictionsForEquity(${equity_id})`,
  );
}

export async function fetchMyPredictions(limit = 50): Promise<PredictionRow[]> {
  return rethrow(
    () => trpc.prediction.listMine.query({ limit }),
    "fetchMyPredictions",
  );
}

/**
 * M33b — fetch a single prediction by ID for the permalink page.
 * Returns null when the upstream returns NOT_FOUND (so the permalink
 * page can call `notFound()` cleanly); rethrows on every other error.
 */
export async function fetchPrediction(id: string): Promise<PredictionRow | null> {
  try {
    return await trpc.prediction.getOne.query({ id });
  } catch (e) {
    if (e instanceof TRPCClientError) {
      const code = (e.data as { code?: string } | null | undefined)?.code;
      if (code === "NOT_FOUND") return null;
      throw new Error(`fetchPrediction(${id}) failed: ${e.message}`);
    }
    throw e;
  }
}

export async function fetchLeaderboard(limit = 20): Promise<LeaderboardRow[]> {
  return rethrow(
    () => trpc.prediction.leaderboard.query({ limit }),
    "fetchLeaderboard",
  );
}

export async function fetchMyScore(): Promise<MyScore> {
  return rethrow(() => trpc.prediction.myScore.query(), "fetchMyScore");
}

// ---------- Suggestions (M32) ----------

export type SuggestionRow = RouterOutput["suggestion"]["listForSector"][number];
export type SuggestionKind = SuggestionRow["kind"];

export async function createSuggestion(input: {
  sector_slug: string;
  kind: SuggestionKind;
  title: string;
  body?: string;
  payload?: Record<string, unknown>;
}): Promise<SuggestionRow> {
  return rethrow(
    () => trpc.suggestion.create.mutate(input),
    `createSuggestion(${input.sector_slug})`,
  );
}

export async function fetchSuggestionsForSector(
  sector_slug: string,
  status?: "open" | "under_review" | "approved" | "rejected",
): Promise<SuggestionRow[]> {
  return rethrow(
    () =>
      trpc.suggestion.listForSector.query({
        sector_slug,
        status,
      }),
    `fetchSuggestionsForSector(${sector_slug})`,
  );
}

export async function fetchRecentSuggestions(
  limit = 10,
): Promise<SuggestionRow[]> {
  return rethrow(
    () => trpc.suggestion.recent.query({ limit }),
    "fetchRecentSuggestions",
  );
}

export async function voteSuggestion(input: {
  suggestion_id: string;
  value: -1 | 0 | 1;
}): Promise<{ score: number; my_vote: number | null }> {
  return rethrow(
    () => trpc.suggestion.vote.mutate(input),
    `voteSuggestion(${input.suggestion_id})`,
  );
}

// ---------- Community (M32) ----------

export type CommunityFeed = RouterOutput["community"]["hubFeed"];

export async function fetchCommunityFeed(): Promise<CommunityFeed> {
  return rethrow(() => trpc.community.hubFeed.query(), "fetchCommunityFeed");
}

// ---------- Agent / propose sector (M25b) ----------

export type AgentWorkflow = RouterOutput["agent"]["getWorkflow"];
export type AgentDecomposition = {
  name: string;
  slug: string;
  description: string;
  horizon_years: number;
  drivers: {
    name: string;
    group: string;
    unit: string;
    default: number;
    min: number;
    max: number;
    description: string;
  }[];
  intermediates: { name: string; unit: string; description: string }[];
  outputs: {
    name: string;
    kind: "scalar" | "series";
    unit: string;
    description: string;
  }[];
};
export type AgentEdgeInference = {
  edges: { source: string; target: string; label: string }[];
  intermediates: {
    name: string;
    formula: string;
    unit: string;
    description: string;
  }[];
  outputs: {
    name: string;
    formula: string;
    kind: "scalar" | "series";
    depends_on: string[];
  }[];
  assumptions: string[];
};
export type AgentProposeSectorResult = {
  decomposition: AgentDecomposition;
  edge_inference: AgentEdgeInference;
};

export async function startProposeSector(input: {
  description: string;
  reference_data?: string;
}): Promise<AgentWorkflow> {
  return rethrow(
    () => trpc.agent.startProposeSector.mutate(input),
    "startProposeSector",
  );
}

export async function getAgentWorkflow(id: string): Promise<AgentWorkflow> {
  return rethrow(
    () => trpc.agent.getWorkflow.query({ id }),
    `getAgentWorkflow(${id})`,
  );
}

export async function cancelAgentWorkflow(id: string): Promise<AgentWorkflow> {
  return rethrow(
    () => trpc.agent.cancelWorkflow.mutate({ id }),
    `cancelAgentWorkflow(${id})`,
  );
}

// ---------- Sector lifecycle for user-driven flow (M25) ----------

export type SectorRow = RouterOutput["sector"]["list"][number];
export type SectorProposeResult = RouterOutput["sector"]["proposeFromAgent"];

export async function proposeSectorFromAgent(input: {
  workflow_id: string;
  slug?: string;
  name?: string;
  description?: string;
}): Promise<SectorProposeResult> {
  return rethrow(
    () => trpc.sector.proposeFromAgent.mutate(input),
    `proposeSectorFromAgent(${input.workflow_id})`,
  );
}

export async function activateSector(slug: string): Promise<SectorRow> {
  return rethrow(
    () => trpc.sector.activate.mutate({ slug }),
    `activateSector(${slug})`,
  );
}

export async function listMySectors(): Promise<SectorRow[]> {
  return rethrow(() => trpc.sector.listMine.query(), "listMySectors");
}

export async function deleteMySector(slug: string): Promise<{
  ok: boolean;
  slug: string;
}> {
  return rethrow(
    () => trpc.sector.deleteMine.mutate({ slug }),
    `deleteMySector(${slug})`,
  );
}

// ---------- Watchlist (M24a) ----------

export type WatchlistRow = RouterOutput["watchlist"]["list"][number];

export async function fetchWatchlist(): Promise<WatchlistRow[]> {
  return rethrow(() => trpc.watchlist.list.query(), "fetchWatchlist");
}

export async function checkIsWatched(
  equityId: string,
): Promise<{ watched: boolean; id: string | null }> {
  // Anonymous => always { watched: false, id: null }. Don't go through
  // `rethrow` so an UNAUTHORIZED response doesn't surface as a noisy
  // error toast — the server already short-circuits when ctx.user is
  // missing.
  try {
    return await trpc.watchlist.isWatched.query({ equity_id: equityId });
  } catch {
    return { watched: false, id: null };
  }
}

export async function addToWatchlist(input: {
  equity_id: string;
  note?: string;
}): Promise<RouterOutput["watchlist"]["add"]> {
  return rethrow(
    () => trpc.watchlist.add.mutate(input),
    `addToWatchlist(${input.equity_id})`,
  );
}

export async function removeFromWatchlist(
  equityId: string,
): Promise<{ ok: boolean }> {
  return rethrow(
    () => trpc.watchlist.remove.mutate({ equity_id: equityId }),
    `removeFromWatchlist(${equityId})`,
  );
}

export type AuditLog = RouterOutput["audit"]["recent"][number];

export async function fetchRecentAuditLogs(input: {
  limit?: number;
  sector_slug?: string;
  action_prefix?: string;
} = {}): Promise<AuditLog[]> {
  return rethrow(
    () =>
      trpc.audit.recent.query({
        limit: input.limit ?? 20,
        sector_slug: input.sector_slug,
        action_prefix: input.action_prefix,
      }),
    "fetchRecentAuditLogs",
  );
}

export type EquityImpactScores = RouterOutput["equity"]["impactScores"];
export type EquityImpactBreakdown = RouterOutput["equity"]["impactBreakdown"];
export type EquityImpactBreakdownRow = EquityImpactBreakdown["equities"][number];
export type DriverContribution = EquityImpactBreakdownRow["contributions"][number];

export async function fetchEquityByTicker(input: {
  sectorSlug: string;
  ticker: string;
  exchange?: string;
}): Promise<Equity> {
  return rethrow(
    () =>
      trpc.equity.getByTicker.query({
        sector_slug: input.sectorSlug,
        ticker: input.ticker,
        exchange: input.exchange,
      }),
    `fetchEquityByTicker(${input.sectorSlug}/${input.ticker})`,
  );
}

export async function fetchEquityImpactBreakdown(
  sectorSlug: string,
  driverValues: Record<string, number>,
): Promise<EquityImpactBreakdown> {
  return rethrow(
    () =>
      trpc.equity.impactBreakdown.query({
        sector_slug: sectorSlug,
        driver_values: driverValues,
      }),
    `fetchEquityImpactBreakdown(${sectorSlug})`,
  );
}

/**
 * Server-computed impliedImpact via graph traversal (M9). Returns
 * `{equity_id: score ∈ [-100, +100]}`. Map will be empty when the
 * graph hasn't been seeded yet — callers should fall back to the
 * client-side `driver_links`-based formula in that case.
 */
export async function fetchEquityImpactScores(
  sectorSlug: string,
  driverValues: Record<string, number>,
): Promise<EquityImpactScores> {
  return rethrow(
    () =>
      trpc.equity.impactScores.query({
        sector_slug: sectorSlug,
        driver_values: driverValues,
      }),
    `fetchEquityImpactScores(${sectorSlug})`,
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
