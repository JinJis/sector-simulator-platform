/**
 * `crawler.*` procedures — admin-facing read + trigger surface for the
 * Phase 4 crawler service (`services/crawler/`).
 *
 * M48d ships:
 *   - `crawler.runs.list`   — paginated CrawlRun feed for the cockpit
 *   - `crawler.runs.get`    — single run detail (drawer click target)
 *   - `crawler.runs.hello`  — fire the HelloWorldFetcher smoke run
 *   - `crawler.health`      — proxied /health from the crawler service
 *
 * The router is a thin proxy — every call hits the Python service's
 * FastAPI surface via `CRAWLER_URL`. We don't read `crawl_runs`
 * directly from Postgres here; keeping the DB ownership inside the
 * crawler service avoids two routers fighting over schema evolution.
 *
 * Auth: all procedures are open `publicProcedure` for M48d. The admin
 * UI is the only consumer; tightening to a real `adminProcedure` is
 * an M52 cockpit-hardening task (the same one that adds bulk-approve
 * for bot proposals).
 */

import { TRPCError } from "@trpc/server";
import { z } from "zod";

import { env } from "../lib/env.js";
import { publicProcedure, router } from "./init.js";

// ---------- Schemas — mirror crawler/main.py CrawlRunOut ----------

const CrawlRunStatus = z.enum([
  "queued",
  "running",
  "ok",
  "error",
  "cancelled",
  "timeout",
]);

const CrawlRunOut = z.object({
  id: z.string(),
  vision_slug: z.string(),
  fetcher_kind: z.string(),
  status: z.string(),
  plan: z.record(z.unknown()),
  result_summary: z.record(z.unknown()).nullable(),
  cost_usd: z.number().nullable(),
  signals_written: z.number().int(),
  proposals_written: z.number().int(),
  error: z.string().nullable(),
  started_at: z.coerce.date(),
  ended_at: z.coerce.date().nullable(),
});

const HelloWorldOut = z.object({
  run: CrawlRunOut,
  cached: z.boolean(),
});

const CapabilityOut = z.object({
  run: CrawlRunOut,
  signal_id: z.string().nullable(),
  dr_cached: z.boolean(),
  scoring_confidence: z.number().nullable(),
});

const ActorTriggerOut = z.object({
  run: CrawlRunOut,
  signal_id: z.string().nullable(),
  dr_cached: z.boolean(),
  scoring_confidence: z.number().nullable(),
  matched_actor_key: z.string().nullable(),
  primary_capability_key: z.string().nullable(),
});

const SignalTriggerOut = z.object({
  run: CrawlRunOut,
  raw_signals_fetched: z.number().int(),
  signals_written: z.number().int(),
  extractor_failures: z.number().int(),
  extractor_total_cost_usd: z.number(),
});

const RiskTriggerOut = z.object({
  run: CrawlRunOut,
  signal_id: z.string().nullable(),
  dr_cached: z.boolean(),
  scoring_confidence: z.number().nullable(),
  primary_capability_key: z.string().nullable(),
  risk_severity: z.string(),
  risk_likelihood: z.string(),
});

const DigestRunOut = z.object({
  run: CrawlRunOut,
  anchor_capability_key: z.string().nullable(),
  signal_id: z.string().nullable(),
  dr_cached: z.boolean(),
  scoring_confidence: z.number().nullable(),
});

const OrchestratorCandidateOut = z.object({
  vision_slug: z.string(),
  fetcher_kind: z.string(),
  key: z.string(),
  anchor_composite: z.number().nullable(),
  stale_hours: z.number(),
  estimated_cost_usd: z.number(),
  ranking_score: z.number(),
});

const OrchestratorTickOut = z.object({
  dry_run: z.boolean(),
  total_candidates: z.number().int(),
  over_budget_skipped: z.number().int(),
  picked: z.array(OrchestratorCandidateOut),
  per_vision_remaining_usd: z.record(z.number()),
  dispatch_summary: z.record(z.unknown()).nullable(),
});

const DiscoveryRunOut = z.object({
  summary: z.record(z.unknown()),
});

const CrawlerHealth = z.object({
  status: z.string(),
  now: z.string(),
  ready: z.object({
    repo: z.boolean(),
    deep_research: z.boolean(),
    // M49a → M49f — added incrementally; all optional so older
    // crawler builds still validate. `data_pipeline_client` was
    // replaced by `signal_repo` in the data-pipeline merger (commit
    // 2/6); both kept optional during the rollout.
    agent_client: z.boolean().optional(),
    data_pipeline_client: z.boolean().optional(),
    signal_repo: z.boolean().optional(),
  }),
});

const FetcherHealthRow = z.object({
  fetcher_kind: z.string(),
  count: z.number().int(),
  ok_count: z.number().int(),
  error_count: z.number().int(),
  success_rate: z.number(),
  p95_duration_ms: z.number().nullable(),
  total_cost_usd: z.number(),
});

const VisionDailyCostRow = z.object({
  vision_slug: z.string(),
  total_cost_usd: z.number(),
});

const Health24hOut = z.object({
  window_hours: z.number().int(),
  by_fetcher: z.array(FetcherHealthRow),
  by_vision: z.array(VisionDailyCostRow),
  total_runs: z.number().int(),
  total_cost_usd: z.number(),
});

// ---------- Helpers ----------

function crawlerBase(): string {
  // After the crawler/data-pipeline merger (commit 6/6), every former
  // crawler endpoint lives at the data-pipeline service. Prefer the
  // canonical DATA_PIPELINE_URL; fall back to the legacy CRAWLER_URL
  // for deploys still mid-rollover.
  const base = env().DATA_PIPELINE_URL ?? env().CRAWLER_URL;
  if (!base) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message:
        "DATA_PIPELINE_URL not configured — start the data-pipeline " +
        "service or set DATA_PIPELINE_URL to its base URL.",
    });
  }
  return base.replace(/\/+$/, "");
}

async function proxy<T>(
  path: string,
  init: RequestInit,
  schema: z.ZodType<T>,
): Promise<T> {
  const base = crawlerBase();
  let res: Response;
  try {
    res = await fetch(`${base}${path}`, {
      ...init,
      headers: {
        "content-type": "application/json",
        ...(init.headers ?? {}),
      },
      // The cockpit polls these — a 2.5s ceiling is plenty for
      // list/get and acceptable for trigger (which itself returns
      // immediately because the fetcher updates the row async on
      // the Python side once the LLM finishes).
      signal: AbortSignal.timeout(2500),
    });
  } catch (err) {
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: `crawler service unreachable: ${(err as Error).message}`,
      cause: err,
    });
  }
  const text = await res.text();
  if (!res.ok) {
    throw new TRPCError({
      code:
        res.status === 503
          ? "PRECONDITION_FAILED"
          : res.status === 404
            ? "NOT_FOUND"
            : "INTERNAL_SERVER_ERROR",
      message: `crawler ${res.status}: ${text || res.statusText}`,
    });
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: `crawler returned non-JSON body: ${(err as Error).message}`,
    });
  }
  const v = schema.safeParse(parsed);
  if (!v.success) {
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: `crawler response failed schema validation: ${v.error.message}`,
    });
  }
  return v.data;
}

// ---------- Router ----------

export const crawlerRouter = router({
  health: publicProcedure
    .output(CrawlerHealth)
    .query(async () =>
      proxy("/health", { method: "GET" }, CrawlerHealth),
    ),

  runs: router({
    list: publicProcedure
      .input(
        z
          .object({
            vision: z.string().min(1).max(128).optional(),
            fetcher: z.string().min(1).max(64).optional(),
            status: CrawlRunStatus.optional(),
            limit: z.number().int().min(1).max(200).default(50),
          })
          .default({}),
      )
      .output(z.array(CrawlRunOut))
      .query(async ({ input }) => {
        const q = new URLSearchParams();
        if (input.vision) q.set("vision", input.vision);
        if (input.fetcher) q.set("fetcher", input.fetcher);
        if (input.status) q.set("status", input.status);
        q.set("limit", String(input.limit));
        return proxy(
          `/jobs/runs?${q.toString()}`,
          { method: "GET" },
          z.array(CrawlRunOut),
        );
      }),

    get: publicProcedure
      .input(z.object({ run_id: z.string().min(1) }))
      .output(CrawlRunOut)
      .query(async ({ input }) =>
        proxy(
          `/jobs/runs/${encodeURIComponent(input.run_id)}`,
          { method: "GET" },
          CrawlRunOut,
        ),
      ),

    hello: publicProcedure
      .input(
        z.object({
          vision_slug: z.string().min(1).max(128),
          prompt: z.string().min(1).max(2000).optional(),
        }),
      )
      .output(HelloWorldOut)
      .mutation(async ({ input }) =>
        proxy(
          "/fetchers/hello-world/run",
          {
            method: "POST",
            body: JSON.stringify(input),
          },
          HelloWorldOut,
        ),
      ),

    // M49a — CapabilityFetcher: per binding capability, ask Deep
    // Research for state-of-X, hand to SignalExtractor for per-dim
    // scoring, upsert a Signal row.
    capability: publicProcedure
      .input(
        z.object({
          vision_slug: z.string().min(1).max(128),
          capability_key: z.string().min(1).max(128),
          prompt: z.string().min(1).max(4000).optional(),
        }),
      )
      .output(CapabilityOut)
      .mutation(async ({ input }) =>
        proxy(
          "/fetchers/capability/run",
          {
            method: "POST",
            body: JSON.stringify(input),
          },
          CapabilityOut,
        ),
      ),

    // M49b — ActorFetcher.
    actor: publicProcedure
      .input(
        z.object({
          vision_slug: z.string().min(1).max(128),
          actor_key: z.string().min(1).max(128),
          prompt: z.string().min(1).max(4000).optional(),
        }),
      )
      .output(ActorTriggerOut)
      .mutation(async ({ input }) =>
        proxy(
          "/fetchers/actor/run",
          { method: "POST", body: JSON.stringify(input) },
          ActorTriggerOut,
        ),
      ),

    // M49c — SignalFetcher (delegates to data-pipeline scoped ingest).
    signal: publicProcedure
      .input(
        z.object({
          vision_slug: z.string().min(1).max(128),
          capability_key: z.string().min(1).max(128),
          lookback_days: z.number().int().min(1).max(30).optional(),
          per_capability_limit: z.number().int().min(1).max(100).optional(),
        }),
      )
      .output(SignalTriggerOut)
      .mutation(async ({ input }) =>
        proxy(
          "/fetchers/signal/run",
          { method: "POST", body: JSON.stringify(input) },
          SignalTriggerOut,
        ),
      ),

    // M49d — RiskFetcher.
    risk: publicProcedure
      .input(
        z.object({
          vision_slug: z.string().min(1).max(128),
          risk_key: z.string().min(1).max(128),
          prompt: z.string().min(1).max(4000).optional(),
        }),
      )
      .output(RiskTriggerOut)
      .mutation(async ({ input }) =>
        proxy(
          "/fetchers/risk/run",
          { method: "POST", body: JSON.stringify(input) },
          RiskTriggerOut,
        ),
      ),
  }),

  // Commit 5/6 — daily DR digest. Manual trigger only at this time.
  digestRun: publicProcedure
    .input(
      z.object({
        vision_slug: z.string().min(1).max(128),
        prompt: z.string().max(4000).optional(),
      }),
    )
    .output(DigestRunOut)
    .mutation(async ({ input }) =>
      proxy(
        "/jobs/deep-research-digest/run",
        { method: "POST", body: JSON.stringify(input) },
        DigestRunOut,
      ),
    ),

  // M49f — orchestrator dry-run + execute. Cockpit defaults to
  // dry_run so admins can preview the tick without burning budget.
  orchestratorTick: publicProcedure
    .input(
      z
        .object({
          dry_run: z.boolean().default(true),
          pinned_visions: z.array(z.string()).max(50).optional(),
        })
        .default({}),
    )
    .output(OrchestratorTickOut)
    .mutation(async ({ input }) =>
      proxy(
        `/jobs/orchestrator/tick?dry_run=${input.dry_run ? "true" : "false"}`,
        {
          method: "POST",
          body: JSON.stringify({
            pinned_visions: input.pinned_visions ?? null,
          }),
        },
        OrchestratorTickOut,
      ),
    ),

  // M50 — bot discovery loop.
  discoveryRun: publicProcedure
    .input(
      z
        .object({
          vision_slugs: z.array(z.string()).max(50).optional(),
          min_signal_count: z.number().int().min(1).max(20).optional(),
          lookback_days: z.number().int().min(1).max(30).optional(),
          fuzzy_threshold: z.number().min(0.5).max(1.0).optional(),
        })
        .default({}),
    )
    .output(DiscoveryRunOut)
    .mutation(async ({ input }) =>
      proxy(
        "/jobs/discovery/run",
        { method: "POST", body: JSON.stringify(input) },
        DiscoveryRunOut,
      ),
    ),

  // M52 — 24h health aggregation read directly from Postgres
  // (crawl_runs lives in the shared DB). Avoids a roundtrip through
  // the crawler service and gives us GROUP BY / percentile in-engine.
  stats: router({
    health24h: publicProcedure
      .input(
        z.object({
          window_hours: z.number().int().min(1).max(168).default(24),
        }).default({}),
      )
      .output(Health24hOut)
      .query(async ({ ctx, input }) => {
        const since = new Date(Date.now() - input.window_hours * 3600 * 1000);

        const byFetcherRaw = await ctx.prisma.$queryRaw<
          Array<{
            fetcher_kind: string;
            count: bigint;
            ok_count: bigint;
            error_count: bigint;
            p95_duration_ms: number | null;
            total_cost_usd: number | null;
          }>
        >`
          SELECT fetcher_kind,
                 COUNT(*) AS count,
                 COUNT(*) FILTER (WHERE status = 'ok')     AS ok_count,
                 COUNT(*) FILTER (WHERE status = 'error')  AS error_count,
                 percentile_cont(0.95) WITHIN GROUP (
                   ORDER BY EXTRACT(EPOCH FROM (ended_at - started_at)) * 1000
                 ) FILTER (WHERE ended_at IS NOT NULL) AS p95_duration_ms,
                 COALESCE(SUM(cost_usd), 0) AS total_cost_usd
          FROM crawl_runs
          WHERE started_at >= ${since}
          GROUP BY fetcher_kind
          ORDER BY fetcher_kind ASC
        `;
        const byVisionRaw = await ctx.prisma.$queryRaw<
          Array<{ vision_slug: string; total_cost_usd: number | null }>
        >`
          SELECT vision_slug,
                 COALESCE(SUM(cost_usd), 0) AS total_cost_usd
          FROM crawl_runs
          WHERE started_at >= ${since}
          GROUP BY vision_slug
          ORDER BY total_cost_usd DESC NULLS LAST
        `;

        const by_fetcher = byFetcherRaw.map((r) => {
          const count = Number(r.count);
          const ok = Number(r.ok_count);
          const err = Number(r.error_count);
          return {
            fetcher_kind: r.fetcher_kind,
            count,
            ok_count: ok,
            error_count: err,
            success_rate: count > 0 ? ok / count : 0,
            p95_duration_ms:
              r.p95_duration_ms != null ? Number(r.p95_duration_ms) : null,
            total_cost_usd: Number(r.total_cost_usd ?? 0),
          };
        });
        const by_vision = byVisionRaw.map((r) => ({
          vision_slug: r.vision_slug,
          total_cost_usd: Number(r.total_cost_usd ?? 0),
        }));
        const total_runs = by_fetcher.reduce((s, r) => s + r.count, 0);
        const total_cost_usd = by_fetcher.reduce(
          (s, r) => s + r.total_cost_usd,
          0,
        );

        return {
          window_hours: input.window_hours,
          by_fetcher,
          by_vision,
          total_runs,
          total_cost_usd,
        };
      }),
  }),
});
