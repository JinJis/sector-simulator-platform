/**
 * Root tRPC router. The exported type is consumed by the web app via
 * `import type { AppRouter } from "@platform/sector-service"`.
 *
 * M43 cleanup: dropped the pre-pivot investment-frame routers
 * (`prediction.*`, `suggestion.*`, `watchlist.*`, `community.hubFeed`).
 * The new namespaces (`prediction2`, `communityProposal`, `reputation`,
 * `follow`) supersede them. Equity / scenario / sector survive — they
 * back the Playground + PredictionV2 + Vision Builder.
 */

import { actorRouter } from "./actor.js";
import { agentRouter } from "./agent.js";
import { auditRouter } from "./audit.js";
import { authRouter } from "./auth.js";
import { billingRouter } from "./billing.js";
import { capabilityRouter } from "./capability.js";
import { communityProposalRouter } from "./community-proposal.js";
import { crawlerRouter } from "./crawler.js";
import { equityRouter } from "./equity.js";
import { feasibilityRouter } from "./feasibility.js";
import { followRouter } from "./follow.js";
import { graphRouter } from "./graph.js";
import { router } from "./init.js";
import { lifecycleRouter } from "./lifecycle.js";
import { monitoringRouter } from "./monitoring.js";
import { prediction2Router } from "./prediction2.js";
import { reputationRouter } from "./reputation.js";
import { riskRouter } from "./risk.js";
import { scenarioRouter } from "./scenario.js";
import { sectorRouter } from "./sector.js";
import { signalRouter } from "./signal.js";
import { simRouter } from "./sim.js";
import { userAdminRouter } from "./user-admin.js";
import { visionRouter } from "./vision.js";
import { visionBuilderRouter } from "./vision-builder.js";

export const appRouter = router({
  // ---- Sim + scenarios (Playground deps) ----
  sim: simRouter,
  scenario: scenarioRouter,
  agent: agentRouter,
  // ---- Equity (read-only; backs PredictionV2 anchors + vol calc) ----
  equity: equityRouter,
  graph: graphRouter,
  // ---- Auth + admin infra ----
  audit: auditRouter,
  lifecycle: lifecycleRouter,
  monitoring: monitoringRouter,
  auth: authRouter,
  sector: sectorRouter,
  admin: userAdminRouter,
  billing: billingRouter,
  // ---- M46 — Community 3.0 ----
  prediction2: prediction2Router,
  reputation: reputationRouter,
  follow: followRouter,
  communityProposal: communityProposalRouter,
  // ---- M36+ — Vision Feasibility Monitor ----
  vision: visionRouter,
  visionBuilder: visionBuilderRouter,
  capability: capabilityRouter,
  signal: signalRouter,
  risk: riskRouter,
  feasibility: feasibilityRouter,
  actor: actorRouter,
  // ---- M48 — Phase 4 real-time crawler ----
  crawler: crawlerRouter,
});

export type AppRouter = typeof appRouter;
