/**
 * Root tRPC router. The exported type is consumed by the web app via
 * `import type { AppRouter } from "@platform/sector-service"`.
 */

import { actorRouter } from "./actor.js";
import { agentRouter } from "./agent.js";
import { auditRouter } from "./audit.js";
import { authRouter } from "./auth.js";
import { billingRouter } from "./billing.js";
import { capabilityRouter } from "./capability.js";
import { communityRouter } from "./community.js";
import { communityProposalRouter } from "./community-proposal.js";
import { equityRouter } from "./equity.js";
import { feasibilityRouter } from "./feasibility.js";
import { graphRouter } from "./graph.js";
import { router } from "./init.js";
import { lifecycleRouter } from "./lifecycle.js";
import { monitoringRouter } from "./monitoring.js";
import { predictionRouter } from "./prediction.js";
import { prediction2Router } from "./prediction2.js";
import { riskRouter } from "./risk.js";
import { scenarioRouter } from "./scenario.js";
import { sectorRouter } from "./sector.js";
import { signalRouter } from "./signal.js";
import { simRouter } from "./sim.js";
import { suggestionRouter } from "./suggestion.js";
import { userAdminRouter } from "./user-admin.js";
import { visionRouter } from "./vision.js";
import { visionBuilderRouter } from "./vision-builder.js";
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
  // M46b — PredictionV2 (auto-tiered band predictions, see chat plan §4).
  prediction2: prediction2Router,
  suggestion: suggestionRouter,
  community: communityRouter,
  // M46a — Community 3.0 proposals (driver/equity/capability/risk/actor/
  // signal_source enrichment proposals with multi-source evidence + vote).
  communityProposal: communityProposalRouter,
  // M36 — Vision Feasibility Monitor namespace. Reads cover the hero
  // page composite payload; mutations cover M38 manual seeding +
  // M41 Vision Builder agent persistence. See docs/PIVOT.md.
  vision: visionRouter,
  // M41 — Vision Builder agent. Two-step propose/apply with manual
  // admin approval seam. See docs/PIVOT.md §12 PR-M41c.
  visionBuilder: visionBuilderRouter,
  capability: capabilityRouter,
  signal: signalRouter,
  risk: riskRouter,
  feasibility: feasibilityRouter,
  // M45 — Actor domain (the WHO layer). Global Actor table + per-vision
  // and per-capability M2M joins. See docs/PIVOT.md §5.1.
  actor: actorRouter,
});

export type AppRouter = typeof appRouter;
