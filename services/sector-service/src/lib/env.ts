/**
 * Validated environment variables. Fail loud at boot if any required
 * variable is missing or malformed — we don't want the server to silently
 * limp along with `undefined` URLs.
 */

import { z } from "zod";

const Env = z.object({
  PORT: z.coerce.number().int().positive().default(8001),
  HOST: z.string().default("0.0.0.0"),
  // Required even in dev: every endpoint that's not /health proxies or
  // writes through one of these.
  SIMULATION_SERVICE_URL: z.string().url(),
  // Optional — when unset, agent.* tRPC procedures return a clear
  // "agent layer not configured" error rather than 500ing. Set this
  // to the agent-orchestration service URL (default :8002) to enable.
  AGENT_ORCHESTRATION_URL: z.string().url().optional(),
  // Optional — used by monitoring.health to surface data-pipeline
  // freshness. Default `:8003` if the service is reachable on the
  // docker network; falls back to a "not configured" health card
  // when unset.
  DATA_PIPELINE_URL: z.string().url().optional(),
  DATABASE_URL: z.string().min(1),
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  LOG_LEVEL: z.enum(["trace", "debug", "info", "warn", "error", "fatal"]).default("info"),
});

export type EnvT = z.infer<typeof Env>;

let cached: EnvT | undefined;

/** Test-only helper. Bust the memoized parse so a test can mutate
 * process.env and observe a fresh re-parse. Not exported from index. */
export function _resetForTests(): void {
  cached = undefined;
}

export function env(): EnvT {
  if (cached) return cached;
  const parsed = Env.safeParse(process.env);
  if (!parsed.success) {
    console.error("[sector-service] invalid environment:");
    for (const issue of parsed.error.issues) {
      console.error(`  - ${issue.path.join(".")}: ${issue.message}`);
    }
    process.exit(1);
  }
  cached = parsed.data;
  return cached;
}
