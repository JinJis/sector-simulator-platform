/**
 * Thin HTTP client for the agent-orchestration service.
 *
 * Mirrors sim-proxy.ts: HTTP status → tRPC error. Extra wrinkle: the
 * agent layer is optional in dev (compose can be brought up without it),
 * so we return a clear PRECONDITION_FAILED when AGENT_ORCHESTRATION_URL
 * isn't configured rather than hitting an undefined URL.
 */

import { TRPCError } from "@trpc/server";

import { env } from "./env.js";

interface ProxyOpts {
  method?: "GET" | "POST";
  body?: unknown;
  context?: string;
}

export async function agentFetch<T>(path: string, opts: ProxyOpts = {}): Promise<T> {
  const baseUrl = env().AGENT_ORCHESTRATION_URL;
  if (!baseUrl) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message:
        "agent-orchestration service is not configured (AGENT_ORCHESTRATION_URL missing)",
    });
  }
  const url = `${baseUrl}${path}`;
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
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: `agent-orchestration unreachable: ${
        e instanceof Error ? e.message : String(e)
      }`,
    });
  }

  if (res.status === 404) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: `${opts.context ?? "resource"} not found in agent-orchestration`,
    });
  }
  if (res.status === 400 || res.status === 422) {
    // FastAPI returns 422 for Pydantic validation, 400 for our explicit
    // HTTPException(400, ...). Surface the upstream `detail`.
    const detail = await safeJson(res);
    throw new TRPCError({
      code: "BAD_REQUEST",
      message:
        typeof detail === "object" && detail && "detail" in detail
          ? formatDetail((detail as { detail: unknown }).detail)
          : `${opts.context ?? "request"} rejected`,
    });
  }
  if (!res.ok) {
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: `agent-orchestration returned ${res.status} for ${path}`,
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

function formatDetail(detail: unknown): string {
  if (typeof detail === "string") return detail;
  // FastAPI 422 returns a list of error objects — keep just the first
  // field path + message so the UI gets a one-line summary.
  if (Array.isArray(detail) && detail.length > 0) {
    const first = detail[0] as { loc?: string[]; msg?: string };
    if (first?.msg) return `${(first.loc ?? []).join(".") || "input"}: ${first.msg}`;
  }
  return JSON.stringify(detail);
}
