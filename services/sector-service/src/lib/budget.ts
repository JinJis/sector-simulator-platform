/**
 * M27 — per-user agent budget enforcement.
 *
 * Reads month-to-date `cost_usd` from `agent_workflows` filtered by
 * `user_id`, compares against the per-tier ceiling, and exposes a
 * single `checkBudget` helper that's called before scheduling a new
 * workflow.
 *
 * Concurrent-run cap is enforced the same way — count of
 * `pending|running` rows for the user.
 *
 * The values come from env so we can tune without code changes:
 *   BUDGET_USD_MONTHLY_FREE (default 0)
 *   BUDGET_USD_MONTHLY_PREMIUM (default 20)
 */

import { TRPCError } from "@trpc/server";

import { prisma } from "@platform/db";

import { env } from "./env.js";

export interface BudgetSnapshot {
  tier: "free" | "premium";
  limit_usd: number;
  used_usd: number;
  remaining_usd: number;
  /** True when the budget is exhausted (used >= limit). */
  exhausted: boolean;
  /** Count of in-flight (pending / running) workflows owned by this user. */
  in_flight: number;
  /** Max concurrent agent runs for this tier. */
  concurrent_limit: number;
}

const CONCURRENT_LIMIT: Record<"free" | "premium", number> = {
  free: 1, // beta-friendly; can drop to 0 when AGENT_BETA_FREE=false
  premium: 3,
};

export async function readBudget(userId: string): Promise<BudgetSnapshot> {
  // Fail-soft: if prisma can't reach Postgres (in-memory test envs,
  // transient outage) we return a generous default snapshot that
  // doesn't block the caller. The Anthropic-side cost guard + the
  // agent-orchestration concurrent-run cap still apply.
  try {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { tier: true },
    });
    const tier =
      user?.tier === "premium" ? "premium" : ("free" as "free" | "premium");
    const limit_usd =
      tier === "premium"
        ? env().BUDGET_USD_MONTHLY_PREMIUM
        : env().BUDGET_USD_MONTHLY_FREE;
    const monthStart = startOfMonth(new Date());
    const [agg, in_flight] = await Promise.all([
      prisma.agentWorkflow.aggregate({
        where: { user_id: userId, created_at: { gte: monthStart } },
        _sum: { cost_usd: true },
      }),
      prisma.agentWorkflow.count({
        where: { user_id: userId, status: { in: ["pending", "running"] } },
      }),
    ]);
    const used_usd = round4(agg._sum.cost_usd ?? 0);
    const remaining_usd = round4(Math.max(0, limit_usd - used_usd));
    return {
      tier,
      limit_usd,
      used_usd,
      remaining_usd,
      exhausted: used_usd >= limit_usd,
      in_flight,
      concurrent_limit: CONCURRENT_LIMIT[tier],
    };
  } catch {
    return {
      tier: "free",
      limit_usd: env().BUDGET_USD_MONTHLY_FREE,
      used_usd: 0,
      remaining_usd: env().BUDGET_USD_MONTHLY_FREE,
      exhausted: false,
      in_flight: 0,
      concurrent_limit: CONCURRENT_LIMIT.free,
    };
  }
}

/**
 * Throws TRPCError when the user can't start another agent run.
 * AGENT_BETA_FREE=true bypasses the tier gate but still enforces the
 * concurrent-run cap (so a runaway client can't burn through the
 * Anthropic budget).
 */
export async function checkBudget(userId: string): Promise<BudgetSnapshot> {
  const snap = await readBudget(userId);
  const betaFree = env().AGENT_BETA_FREE;
  if (snap.in_flight >= snap.concurrent_limit) {
    throw new TRPCError({
      code: "TOO_MANY_REQUESTS",
      message: `이미 ${snap.in_flight}개 워크플로가 실행 중입니다. 끝난 뒤에 다시 시도해 주세요.`,
    });
  }
  if (!betaFree && snap.exhausted) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message:
        snap.tier === "premium"
          ? `이번 달 사용량 한도($${snap.limit_usd}) 에 도달했습니다.`
          : "에이전트 시뮬레이터 생성은 ★ Premium 사용자에게 제공됩니다. 설정 페이지에서 업그레이드해 주세요.",
    });
  }
  return snap;
}

function startOfMonth(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
}

function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}
