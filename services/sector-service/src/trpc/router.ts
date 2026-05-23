/**
 * Root tRPC router. The exported type is consumed by the web app via
 * `import type { AppRouter } from "@platform/sector-service"`.
 */

import { agentRouter } from "./agent.js";
import { auditRouter } from "./audit.js";
import { authRouter } from "./auth.js";
import { billingRouter } from "./billing.js";
import { capabilityRouter } from "./capability.js";
import { communityRouter } from "./community.js";
import { equityRouter } from "./equity.js";
import { feasibilityRouter } from "./feasibility.js";
import { graphRouter } from "./graph.js";
import { router } from "./init.js";
import { lifecycleRouter } from "./lifecycle.js";
import { monitoringRouter } from "./monitoring.js";
import { predictionRouter } from "./prediction.js";
import { riskRouter } from "./risk.js";
import { scenarioRouter } from "./scenario.js";
import { sectorRouter } from "./sector.js";
import { signalRouter } from "./signal.js";
import { simRouter } from "./sim.js";
import { suggestionRouter } from "./suggestion.js";
import { userAdminRouter } from "./user-admin.js";
import { visionRouter } from "./vision.js";
import { watchlistRouter } from "./watchlist.js";

export const appRouter = router({
  sim: simRouter,
  scenario: scenarioRouter,
  agent: agentRouter,
  equity: equityRouter,
  graph: graphRouter,
  audit: auditRouter,
  lifecycle: lifecycleRouter,
  monitoring: monitoringRouter,
  auth: authRouter,
  sector: sectorRouter,
  watchlist: watchlistRouter,
  admin: userAdminRouter,
  billing: billingRouter,
  prediction: predictionRouter,
  suggestion: suggestionRouter,
  community: communityRouter,
  // M36 — Vision Feasibility Monitor namespace. Reads cover the hero
  // page composite payload; mutations cover M38 manual seeding +
  // M41 Vision Builder agent persistence. See docs/PIVOT.md.
  vision: visionRouter,
  capability: capabilityRouter,
  signal: signalRouter,
  risk: riskRouter,
  feasibility: feasibilityRouter,
});

export type AppRouter = typeof appRouter;
