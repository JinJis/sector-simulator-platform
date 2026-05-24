/**
 * Client wrappers for the M46a `communityProposal.*` namespace.
 *
 * Same shape as vision-client.ts — reuses the shared tRPC instance from
 * sim-client.ts so we don't end up with two transports.
 */

import type { AppRouter } from "@platform/sector-service";
import { TRPCClientError } from "@trpc/client";
import type { inferRouterInputs, inferRouterOutputs } from "@trpc/server";

import { trpc } from "./sim-client";

type Inputs = inferRouterInputs<AppRouter>;
type Outputs = inferRouterOutputs<AppRouter>;

export type ProposalListInput = Inputs["communityProposal"]["list"];
export type ProposalListResult = Outputs["communityProposal"]["list"];
export type ProposalSummary = ProposalListResult["rows"][number];
export type ProposalDetail = Outputs["communityProposal"]["get"];
export type ProposalEvidence = ProposalDetail["evidence"][number];
export type ProposalCreateInput = Inputs["communityProposal"]["create"];
export type ProposalTargetKind = ProposalCreateInput["target_kind"];
export type ProposalCreateEvidence = NonNullable<
  ProposalCreateInput["evidence"]
>[number];

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

export async function listProposals(
  input: ProposalListInput,
): Promise<ProposalListResult> {
  return rethrow(
    () => trpc.communityProposal.list.query(input),
    "listProposals",
  );
}

export async function fetchProposal(id: string): Promise<ProposalDetail> {
  return rethrow(
    () => trpc.communityProposal.get.query({ id }),
    `fetchProposal(${id})`,
  );
}

export async function createProposal(
  input: ProposalCreateInput,
): Promise<{ id: string }> {
  return rethrow(
    () => trpc.communityProposal.create.mutate(input),
    "createProposal",
  );
}

export async function toggleProposalVote(
  proposal_id: string,
): Promise<{ voted: boolean; vote_score: number }> {
  return rethrow(
    () => trpc.communityProposal.vote.mutate({ proposal_id }),
    `toggleProposalVote(${proposal_id})`,
  );
}
