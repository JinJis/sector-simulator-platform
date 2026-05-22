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
  // M26 billing — unset means Premium upgrade is non-functional (UI
  // surfaces the stub message). Set all three to enable Stripe.
  STRIPE_SECRET_KEY: z.string().optional(),
  STRIPE_WEBHOOK_SECRET: z.string().optional(),
  STRIPE_PRICE_ID: z.string().optional(),
  STRIPE_SUCCESS_URL: z
    .string()
    .url()
    .default("http://localhost:3000/settings?upgraded=1"),
  STRIPE_CANCEL_URL: z
    .string()
    .url()
    .default("http://localhost:3000/settings"),
  // M26 transition flag: when true, /propose stays free-for-everyone
  // in beta even though the hard tier gate code is wired. Flip to
  // false at launch.
  AGENT_BETA_FREE: z
    .union([z.literal("true"), z.literal("false")])
    .default("true")
    .transform((v) => v === "true"),
  // M27 budgets — USD per user per month. The pre-call check in the
  // agent procedures reads these.
  BUDGET_USD_MONTHLY_FREE: z.coerce.number().nonnegative().default(0),
  BUDGET_USD_MONTHLY_PREMIUM: z.coerce.number().nonnegative().default(20),
  // M33 + M34 + M34b — direct synchronous Gemini call from
  // sector-service for prediction.analyzeRationale.
  //
  // Two auth modes:
  // 1. **Vertex AI (preferred)**: set GOOGLE_GENAI_USE_VERTEXAI=true +
  //    GOOGLE_CLOUD_PROJECT + GOOGLE_CLOUD_LOCATION +
  //    GOOGLE_APPLICATION_CREDENTIALS (path to service-account JSON).
  // 2. **API key (dev fallback)**: set GEMINI_API_KEY.
  //
  // When neither is configured, the analyze endpoint returns a
  // PRECONDITION_FAILED and the UI hides the AI button.
  GEMINI_API_KEY: z
    .string()
    .optional()
    .transform((v) => (v && v.length > 0 ? v : undefined)),
  // Accept any string; treat "true"/"1"/"yes"/"on" (case-insensitive)
  // as enabled. Empty string from docker-compose ${VAR:-} interpolation
  // resolves to disabled.
  GOOGLE_GENAI_USE_VERTEXAI: z
    .string()
    .optional()
    .transform((v) => {
      const t = (v ?? "").trim().toLowerCase();
      return t === "true" || t === "1" || t === "yes" || t === "on";
    }),
  GOOGLE_CLOUD_PROJECT: z
    .string()
    .optional()
    .transform((v) => (v && v.length > 0 ? v : undefined)),
  GOOGLE_CLOUD_LOCATION: z.string().default("us-central1"),
  GOOGLE_APPLICATION_CREDENTIALS: z
    .string()
    .optional()
    .transform((v) => (v && v.length > 0 ? v : undefined)),
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
