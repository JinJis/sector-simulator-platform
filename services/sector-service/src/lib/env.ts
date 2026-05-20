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
  DATABASE_URL: z.string().min(1),
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  LOG_LEVEL: z.enum(["trace", "debug", "info", "warn", "error", "fatal"]).default("info"),
});

export type EnvT = z.infer<typeof Env>;

let cached: EnvT | undefined;

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
