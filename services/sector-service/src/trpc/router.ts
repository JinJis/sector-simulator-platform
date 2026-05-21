/**
 * Root tRPC router. The exported type is consumed by the web app via
 * `import type { AppRouter } from "@platform/sector-service"`.
 */

import { agentRouter } from "./agent.js";
import { auditRouter } from "./audit.js";
import { authRouter } from "./auth.js";
import { equityRouter } from "./equity.js";
import { graphRouter } from "./graph.js";
import { router } from "./init.js";
import { lifecycleRouter } from "./lifecycle.js";
import { monitoringRouter } from "./monitoring.js";
import { scenarioRouter } from "./scenario.js";
import { sectorRouter } from "./sector.js";
import { simRouter } from "./sim.js";
import { userAdminRouter } from "./user-admin.js";
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
});

export type AppRouter = typeof appRouter;
