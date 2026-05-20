/**
 * Thin HTTP client wrapper for upstream simulation-service.
 *
 * Translates HTTP status into tRPC errors so callers don't have to repeat
 * the same `if (status === 404) throw new TRPCError(...)` boilerplate in
 * every procedure.
 */

import { TRPCError } from "@trpc/server";

import { env } from "./env.js";

interface ProxyOpts {
  method?: "GET" | "POST";
  body?: unknown;
  // Procedure name for log/error tagging.
  context?: string;
}

export async function simFetch<T>(path: string, opts: ProxyOpts = {}): Promise<T> {
  const url = `${env().SIMULATION_SERVICE_URL}${path}`;
  const init: RequestInit = {
    method: opts.method ?? "GET",
    headers: opts.body
      ? { "Content-Type": "application/json", Accept: "application/json" }
      : { Accept: "application/json" },
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  };

  let res: Response;
  try {
    res = await fetch(url, init);
  } catch (e) {
    // Network / DNS / connection refused. Treat as upstream outage.
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: `simulation-service unreachable: ${e instanceof Error ? e.message : String(e)}`,
    });
  }

  if (res.status === 404) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: `${opts.context ?? "resource"} not found in simulation-service`,
    });
  }
  if (res.status === 400) {
    // Surface the FastAPI validation message to the client — useful for
    // unknown-driver errors etc.
    const detail = await safeJson(res);
    throw new TRPCError({
      code: "BAD_REQUEST",
      message:
        typeof detail === "object" && detail && "detail" in detail
          ? String(detail.detail)
          : `${opts.context ?? "request"} rejected`,
    });
  }
  if (!res.ok) {
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: `simulation-service returned ${res.status} for ${path}`,
    });
  }

  return (await res.json()) as T;
}

async function safeJson(res: Response): Promise<unknown> {
  try {
    return await res.json();
  } catch {
    return null;
  }
}
