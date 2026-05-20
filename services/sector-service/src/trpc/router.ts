/**
 * Root tRPC router. The exported type is consumed by the web app via
 * `import type { AppRouter } from "@platform/sector-service"`.
 */

import { router } from "./init.js";
import { scenarioRouter } from "./scenario.js";
import { simRouter } from "./sim.js";

export const appRouter = router({
  sim: simRouter,
  scenario: scenarioRouter,
});

export type AppRouter = typeof appRouter;
