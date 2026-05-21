/**
 * Root tRPC router. The exported type is consumed by the web app via
 * `import type { AppRouter } from "@platform/sector-service"`.
 */

import { agentRouter } from "./agent.js";
import { auditRouter } from "./audit.js";
import { equityRouter } from "./equity.js";
import { graphRouter } from "./graph.js";
import { router } from "./init.js";
import { scenarioRouter } from "./scenario.js";
import { simRouter } from "./sim.js";

export const appRouter = router({
  sim: simRouter,
  scenario: scenarioRouter,
  agent: agentRouter,
  equity: equityRouter,
  graph: graphRouter,
  audit: auditRouter,
});

export type AppRouter = typeof appRouter;
