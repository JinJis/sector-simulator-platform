/**
 * Client wrappers for `reputation.*` + `follow.*` (M46c).
 * Reuses the shared tRPC instance from sim-client.ts.
 */

import type { AppRouter } from "@platform/sector-service";
import { TRPCClientError } from "@trpc/client";
import type { inferRouterOutputs } from "@trpc/server";

import { trpc } from "./sim-client";

type Outputs = inferRouterOutputs<AppRouter>;

export type ReputationSnapshot = Outputs["reputation"]["get"];
export type ReputationLeaderRow = Outputs["reputation"]["leaderboard"][number];
export type PointEventRow = Outputs["reputation"]["events"][number];
export type FollowEdge = Outputs["follow"]["followersOf"][number];
export type FollowCounts = Outputs["follow"]["counts"];

async function rethrow<T>(call: () => Promise<T>, label: string): Promise<T> {
  try {
    return await call();
  } catch (err) {
    if (err instanceof TRPCClientError) {
      throw new Error(`${label}: ${err.message}`);
    }
    throw err instanceof Error ? new Error(`${label}: ${err.message}`) : err;
  }
}

export async function fetchReputation(user_id: string): Promise<ReputationSnapshot> {
  return rethrow(
    () => trpc.reputation.get.query({ user_id }),
    `fetchReputation(${user_id})`,
  );
}

export async function fetchPointEvents(
  user_id: string,
  limit = 30,
): Promise<PointEventRow[]> {
  return rethrow(
    () => trpc.reputation.events.query({ user_id, limit }),
    `fetchPointEvents(${user_id})`,
  );
}

export async function fetchReputationLeaderboard(
  limit = 20,
): Promise<ReputationLeaderRow[]> {
  return rethrow(
    () => trpc.reputation.leaderboard.query({ limit }),
    "fetchReputationLeaderboard",
  );
}

export async function fetchFollowCounts(user_id: string): Promise<FollowCounts> {
  return rethrow(
    () => trpc.follow.counts.query({ user_id }),
    `fetchFollowCounts(${user_id})`,
  );
}

export async function toggleFollow(
  followed_id: string,
): Promise<{ following: boolean; followers_count: number }> {
  return rethrow(
    () => trpc.follow.toggle.mutate({ followed_id }),
    `toggleFollow(${followed_id})`,
  );
}

export async function fetchFollowersOf(
  user_id: string,
  limit = 30,
): Promise<FollowEdge[]> {
  return rethrow(
    () => trpc.follow.followersOf.query({ user_id, limit }),
    `fetchFollowersOf(${user_id})`,
  );
}

export async function fetchFollowingOf(
  user_id: string,
  limit = 30,
): Promise<FollowEdge[]> {
  return rethrow(
    () => trpc.follow.followingOf.query({ user_id, limit }),
    `fetchFollowingOf(${user_id})`,
  );
}
