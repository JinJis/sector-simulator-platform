"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import {
  toggleProposalVote,
  type ProposalSummary,
} from "@/lib/community-proposal-client";

interface Props {
  proposal: ProposalSummary;
  kindLabel: string;
}

const STATUS_COLORS: Record<string, string> = {
  open: "border-amber-700 text-amber-200 bg-amber-950/30",
  review: "border-blue-700 text-blue-200 bg-blue-950/30",
  applied: "border-emerald-700 text-emerald-200 bg-emerald-950/30",
  rejected: "border-neutral-700 text-neutral-400 bg-neutral-900",
  stale: "border-neutral-800 text-neutral-500 bg-neutral-950",
};

export function ProposalCard({ proposal, kindLabel }: Props) {
  const router = useRouter();
  const [voted, setVoted] = useState(proposal.viewer_voted);
  const [score, setScore] = useState(proposal.vote_score);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  async function handleVote() {
    setError(null);
    try {
      const result = await toggleProposalVote(proposal.id);
      setVoted(result.voted);
      setScore(result.vote_score);
      // Refresh the server-rendered feed so re-sort + counts are in
      // sync if the user lingers — React's Router cache invalidation.
      startTransition(() => router.refresh());
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes("UNAUTHORIZED")) {
        // Soft-prompt sign in — keep the page in place.
        router.push(
          `/sign-in?next=${encodeURIComponent(`/community/proposals/${proposal.id}`)}`,
        );
        return;
      }
      setError(msg);
    }
  }

  const statusClass = STATUS_COLORS[proposal.status] ?? STATUS_COLORS["open"];

  return (
    <div className="flex gap-3 rounded-lg border border-neutral-800 bg-neutral-900/40 p-4 hover:border-neutral-700">
      <VoteButton
        voted={voted}
        score={score}
        pending={pending}
        onClick={handleVote}
      />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-2 text-[11px]">
          <span
            className={`rounded border px-1.5 py-0.5 text-[10px] uppercase tracking-wider ${statusClass}`}
          >
            {proposal.status}
          </span>
          <span className="rounded border border-neutral-700 px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-neutral-300">
            {kindLabel}
          </span>
          <Link
            href={`/community/proposals?sector=${proposal.sector_slug}`}
            className="font-mono text-[10px] text-cyan-400 hover:underline"
          >
            {proposal.sector_slug}
          </Link>
          <span className="text-neutral-600">·</span>
          <span className="text-neutral-500">by {proposal.author.label}</span>
          <span className="text-neutral-700">·</span>
          <span className="text-neutral-600">{relativeTime(proposal.created_at)}</span>
        </div>
        <Link
          href={`/community/proposals/${proposal.id}`}
          className="mt-1.5 block text-base font-medium text-neutral-100 hover:text-cyan-200"
        >
          {proposal.title}
        </Link>
        <div className="mt-1 flex items-center gap-3 text-[11px] text-neutral-500">
          <span>{proposal.evidence_count} evidence</span>
          <span>·</span>
          <span>{proposal.reply_count} replies</span>
        </div>
        {error && (
          <p className="mt-1 text-[11px] text-red-400">{error}</p>
        )}
      </div>
    </div>
  );
}

function VoteButton({
  voted,
  score,
  pending,
  onClick,
}: {
  voted: boolean;
  score: number;
  pending: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={pending}
      className={`flex shrink-0 flex-col items-center justify-center rounded-md border px-3 py-2 text-xs transition ${
        voted
          ? "border-cyan-600 bg-cyan-900/40 text-cyan-200"
          : "border-neutral-700 text-neutral-300 hover:border-cyan-700 hover:text-cyan-200"
      } disabled:opacity-50`}
      aria-pressed={voted}
      aria-label={voted ? "Remove upvote" : "Upvote"}
    >
      <span className="text-base leading-none">▲</span>
      <span className="mt-0.5 font-mono text-sm font-semibold tabular-nums">{score}</span>
    </button>
  );
}

function relativeTime(d: string | Date): string {
  const date = typeof d === "string" ? new Date(d) : d;
  const seconds = Math.max(0, Math.floor((Date.now() - date.getTime()) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo ago`;
  return date.toISOString().slice(0, 10);
}
