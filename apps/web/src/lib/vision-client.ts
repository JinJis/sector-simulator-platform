/**
 * Typed client for the M36 `vision.*` / `capability.*` / `signal.*` /
 * `risk.*` / `feasibility.*` tRPC namespaces. Same shape as sim-client.ts —
 * wraps the namespace procedures into plain async functions so the pages
 * stay readable and the seam for transport changes is in one file.
 *
 * Reuses the same tRPC client + session-forwarding fetch from sim-client
 * so we don't end up with two independent transports.
 *
 * In M37 the hero page uses local fixtures (see
 * apps/web/src/app/visions/_fixtures/). M38c flips the page to call
 * `fetchVisionOverview` against the real DB. Type contracts are inferred
 * from the AppRouter so the swap is a pure import-source change.
 */

import type { AppRouter } from "@platform/sector-service";
import { TRPCClientError } from "@trpc/client";
import type { inferRouterOutputs } from "@trpc/server";

import { trpc } from "./sim-client";

// ---------- Inferred types (consumed by pages + fixtures) ----------

type RouterOutputs = inferRouterOutputs<AppRouter>;

export type VisionSummary = RouterOutputs["vision"]["list"][number];
export type VisionOverview = RouterOutputs["vision"]["getOverview"];
export type CapabilityInOverview = VisionOverview["capabilities"][number];
export type RiskInOverview = VisionOverview["risks"][number];
export type SignalInOverview = VisionOverview["recent_signals"][number];
export type FeasibilityHistoryPoint = RouterOutputs["vision"]["feasibilityHistory"][number];

export type CapabilityDetail = RouterOutputs["capability"]["get"];
export type CapabilityScorePoint = RouterOutputs["capability"]["scoreHistory"][number];

export type SignalListResult = RouterOutputs["signal"]["list"];
export type SignalDetail = RouterOutputs["signal"]["get"];

// ---------- Wrappers ----------

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

export async function fetchVisions(opts?: {
  include_legacy?: boolean;
}): Promise<VisionSummary[]> {
  return rethrow(
    () => trpc.vision.list.query(opts ?? {}),
    "fetchVisions",
  );
}

export async function fetchVisionSummary(slug: string): Promise<VisionSummary> {
  return rethrow(
    () => trpc.vision.get.query({ slug }),
    `fetchVisionSummary(${slug})`,
  );
}

export async function fetchVisionOverview(
  slug: string,
  signalLimit = 8,
): Promise<VisionOverview> {
  return rethrow(
    () => trpc.vision.getOverview.query({ slug, signal_limit: signalLimit }),
    `fetchVisionOverview(${slug})`,
  );
}

export async function fetchFeasibilityHistory(
  slug: string,
  limit = 180,
): Promise<FeasibilityHistoryPoint[]> {
  return rethrow(
    () => trpc.vision.feasibilityHistory.query({ slug, limit }),
    `fetchFeasibilityHistory(${slug})`,
  );
}

export async function fetchCapability(
  sectorSlug: string,
  key: string,
): Promise<CapabilityDetail> {
  return rethrow(
    () => trpc.capability.get.query({ sector_slug: sectorSlug, key }),
    `fetchCapability(${sectorSlug}/${key})`,
  );
}

export async function fetchCapabilityScoreHistory(
  sectorSlug: string,
  key: string,
  limit = 120,
): Promise<CapabilityScorePoint[]> {
  return rethrow(
    () => trpc.capability.scoreHistory.query({ sector_slug: sectorSlug, key, limit }),
    `fetchCapabilityScoreHistory(${sectorSlug}/${key})`,
  );
}

export async function fetchSignals(input: {
  sector_slug: string;
  capability_key?: string;
  source_kind?: string;
  highlight_only?: boolean;
  cursor?: string;
  limit?: number;
}): Promise<SignalListResult> {
  return rethrow(
    () =>
      trpc.signal.list.query({
        sector_slug: input.sector_slug,
        capability_key: input.capability_key,
        source_kind: input.source_kind as never,
        highlight_only: input.highlight_only ?? false,
        cursor: input.cursor,
        limit: input.limit ?? 30,
      }),
    `fetchSignals(${input.sector_slug})`,
  );
}
