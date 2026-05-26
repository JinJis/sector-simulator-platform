/**
 * /admin/data-pipeline/proposals — Bot proposal queue (M50).
 * Bulk apply / reject with audit reason.
 */

import { BotProposalQueue } from "@/components/data-pipeline/BotProposalQueue";
import {
  type BotProposalRow,
  listBotProposals,
} from "@/lib/sim-client";

export const dynamic = "force-dynamic";

export default async function DataPipelineProposals() {
  let bots: BotProposalRow[] = [];
  let error: string | null = null;
  try {
    bots = await listBotProposals({ limit: 50 });
  } catch (err) {
    error = err instanceof Error ? err.message : String(err);
  }
  if (error) {
    return (
      <p className="rounded border border-rose-800/60 bg-rose-950/30 px-3 py-2 text-xs text-rose-300">
        {error}
      </p>
    );
  }
  return <BotProposalQueue initialProposals={bots} />;
}
