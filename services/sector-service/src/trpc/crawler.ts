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

const CrawlerHealth = z.object({
  status: z.string(),
  now: z.string(),
  ready: z.object({
    repo: z.boolean(),
    deep_research: z.boolean(),
  }),
});

// ---------- Helpers ----------

function crawlerBase(): string {
  const base = env().CRAWLER_URL;
  if (!base) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message:
        "CRAWLER_URL not configured — start the crawler service or " +
        "set CRAWLER_URL to its base URL.",
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
  }),
});
