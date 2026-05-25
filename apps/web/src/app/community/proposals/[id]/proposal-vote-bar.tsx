"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { toggleProposalVote } from "@/lib/community-proposal-client";

interface Props {
  proposalId: string;
  initialVoted: boolean;
  initialScore: number;
}

export function ProposalVoteBar({
  proposalId,
  initialVoted,
  initialScore,
}: Props) {
  const router = useRouter();
  const [voted, setVoted] = useState(initialVoted);
  const [score, setScore] = useState(initialScore);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  async function handleVote() {
    setError(null);
    try {
      const result = await toggleProposalVote(proposalId);
      setVoted(result.voted);
      setScore(result.vote_score);
      startTransition(() => router.refresh());
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes("UNAUTHORIZED")) {
        router.push(
          `/sign-in?next=${encodeURIComponent(`/community/proposals/${proposalId}`)}`,
        );
        return;
      }
      setError(msg);
    }
  }

  return (
    <div className="mt-4 flex items-center gap-3 rounded-lg border border-neutral-800 bg-neutral-900/40 p-3">
      <button
        type="button"
        onClick={handleVote}
        disabled={pending}
        className={`flex items-center gap-2 rounded-md border px-4 py-2 text-sm font-medium transition ${
          voted
            ? "border-cyan-600 bg-cyan-900/40 text-cyan-200"
            : "border-neutral-700 text-neutral-300 hover:border-cyan-700 hover:text-cyan-200"
        } disabled:opacity-50`}
        aria-pressed={voted}
      >
        <span>▲</span>
        <span className="font-mono tabular-nums">{score}</span>
        <span className="text-[11px] font-normal text-neutral-500">
          {voted ? "voted" : "upvote"}
        </span>
      </button>
      <p className="text-[11px] text-neutral-500">
        High-vote proposals get auto-promoted into the admin review
        queue.
      </p>
      {error && (
        <p className="ml-auto text-[11px] text-red-400">{error}</p>
      )}
    </div>
  );
}
