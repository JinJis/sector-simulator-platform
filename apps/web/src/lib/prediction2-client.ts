/**
 * Client wrappers for the M46b `prediction2.*` namespace.
 *
 * Same shape as community-proposal-client.ts — reuses the shared tRPC
 * instance from sim-client.ts.
 */

import type { AppRouter } from "@platform/sector-service";
import { TRPCClientError } from "@trpc/client";
import type { inferRouterInputs, inferRouterOutputs } from "@trpc/server";

import { trpc } from "./sim-client";

type Inputs = inferRouterInputs<AppRouter>;
type Outputs = inferRouterOutputs<AppRouter>;

export type PredictionQuoteInput = Inputs["prediction2"]["quote"];
export type PredictionQuoteResult = Outputs["prediction2"]["quote"];
export type PredictionPlaceInput = Inputs["prediction2"]["place"];
export type PredictionListInput = Inputs["prediction2"]["list"];
export type PredictionListResult = Outputs["prediction2"]["list"];
export type PredictionSummary = PredictionListResult["rows"][number];
export type PredictionDetail = Outputs["prediction2"]["get"];
export type PredictionLeaderRow = Outputs["prediction2"]["leaderboard"][number];

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

export async function quotePrediction(
  input: PredictionQuoteInput,
): Promise<PredictionQuoteResult> {
  return rethrow(
    () => trpc.prediction2.quote.query(input),
    "quotePrediction",
  );
}

export async function placePrediction(
  input: PredictionPlaceInput,
): Promise<{ id: string }> {
  return rethrow(
    () => trpc.prediction2.place.mutate(input),
    "placePrediction",
  );
}

export async function listPredictions(
  input: PredictionListInput = {},
): Promise<PredictionListResult> {
  return rethrow(
    () => trpc.prediction2.list.query(input),
    "listPredictions",
  );
}

export async function fetchMyPredictions(
  status?: "open" | "resolved",
): Promise<PredictionSummary[]> {
  return rethrow(
    () => trpc.prediction2.mine.query(status ? { status } : {}),
    "fetchMyPredictions",
  );
}

export async function fetchPredictionDetail(
  id: string,
): Promise<PredictionDetail> {
  return rethrow(
    () => trpc.prediction2.get.query({ id }),
    `fetchPredictionDetail(${id})`,
  );
}

export async function fetchLeaderboard(
  limit = 20,
): Promise<PredictionLeaderRow[]> {
  return rethrow(
    () => trpc.prediction2.leaderboard.query({ limit }),
    "fetchLeaderboard",
  );
}
