/**
 * /community/proposals/[id] — proposal detail.
 *
 * Server-rendered detail with evidence cards, decision metadata, and
 * the vote button (client island). Replies thread lands in M46c.
 */

import Link from "next/link";
import { notFound } from "next/navigation";

import {
  fetchProposal,
  type ProposalDetail,
  type ProposalEvidence,
} from "@/lib/community-proposal-client";

import { ProposalVoteBar } from "./proposal-vote-bar";

export const dynamic = "force-dynamic";

interface Props {
  params: Promise<{ id: string }>;
}

const TARGET_KIND_LABELS: Record<string, string> = {
  add_driver: "Add Driver",
  add_equity: "Add Equity",
  add_capability: "Add Capability",
  add_risk: "Add Risk",
  add_actor: "Add Actor",
  add_signal_source: "Add Signal Source",
  edit: "Edit",
  other: "Other",
};

export default async function ProposalDetailPage({ params }: Props) {
  const { id } = await params;
  let proposal: ProposalDetail;
  try {
    proposal = await fetchProposal(id);
  } catch {
    notFound();
  }

  const kindLabel = TARGET_KIND_LABELS[proposal.target_kind] ?? proposal.target_kind;

  return (
    <main className="mx-auto max-w-[100rem] px-6 py-10">
      <nav className="mb-4 flex gap-2 text-[11px] text-neutral-500">
        <Link href="/community/proposals" className="hover:text-neutral-300">
          ← Proposals
        </Link>
        <span className="text-neutral-700">·</span>
        <Link
          href={`/community/proposals?sector=${proposal.sector_slug}`}
          className="font-mono text-cyan-400 hover:underline"
        >
          {proposal.sector_slug}
        </Link>
      </nav>

      <header className="rounded-lg border border-neutral-800 bg-neutral-900/40 p-5">
        <div className="flex flex-wrap items-center gap-2 text-[11px]">
          <StatusPill status={proposal.status} />
          <span className="rounded border border-neutral-700 px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-neutral-300">
            {kindLabel}
          </span>
          {proposal.target_ref && (
            <span className="font-mono text-[10px] text-cyan-400">
              → {proposal.target_ref}
            </span>
          )}
          <span className="ml-auto text-[11px] text-neutral-500">
            by <strong className="text-neutral-300">{proposal.author.label}</strong> ·{" "}
            {new Date(proposal.created_at).toISOString().slice(0, 10)}
          </span>
        </div>
        <h1 className="mt-3 text-xl font-semibold text-neutral-100">
          {proposal.title}
        </h1>
        <p className="mt-3 whitespace-pre-wrap text-[13px] leading-relaxed text-neutral-300">
          {proposal.body}
        </p>
      </header>

      <ProposalVoteBar
        proposalId={proposal.id}
        initialVoted={proposal.viewer_voted}
        initialScore={proposal.vote_score}
      />

      {proposal.evidence.length > 0 && (
        <section className="mt-8">
          <h2 className="text-sm font-semibold text-neutral-200">
            Evidence ({proposal.evidence.length})
          </h2>
          <ul className="mt-3 space-y-3">
            {proposal.evidence.map((e) => (
              <li key={e.id}>
                <EvidenceCard evidence={e} />
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="mt-8 rounded-lg border border-neutral-800 bg-neutral-950/40 p-4">
        <h2 className="text-sm font-semibold text-neutral-200">Proposed payload</h2>
        <p className="mt-1 text-[11px] text-neutral-500">
          Raw data that gets fed to the applier on acceptance. Admin-level
          detail — most readers can skip.
        </p>
        <pre className="mt-3 max-h-64 overflow-auto rounded border border-neutral-900 bg-neutral-950 p-3 text-[11px] text-neutral-400">
          {JSON.stringify(proposal.proposed_payload, null, 2)}
        </pre>
      </section>

      {proposal.decided_at && (
        <section
          className={`mt-8 rounded-lg border p-4 ${
            proposal.status === "applied"
              ? "border-emerald-800/60 bg-emerald-950/20"
              : "border-neutral-800 bg-neutral-900/40"
          }`}
        >
          <h2 className="text-sm font-semibold text-neutral-200">Decision</h2>
          <p className="mt-1 text-[12px] text-neutral-400">
            <span className="text-neutral-300">{proposal.decided_by?.label ?? "anonymous"}</span>{" "}
            marked this <strong>{proposal.status}</strong> on{" "}
            {new Date(proposal.decided_at).toISOString().slice(0, 10)}.
          </p>
          {proposal.decision_reason && (
            <p className="mt-2 text-[12px] text-neutral-400">
              {proposal.decision_reason}
            </p>
          )}
        </section>
      )}
    </main>
  );
}

function StatusPill({ status }: { status: string }) {
  const cls =
    status === "open"
      ? "border-amber-700 text-amber-200 bg-amber-950/30"
      : status === "review"
        ? "border-blue-700 text-blue-200 bg-blue-950/30"
        : status === "applied"
          ? "border-emerald-700 text-emerald-200 bg-emerald-950/30"
          : "border-neutral-700 text-neutral-400 bg-neutral-900";
  return (
    <span
      className={`rounded border px-1.5 py-0.5 text-[10px] uppercase tracking-wider ${cls}`}
    >
      {status}
    </span>
  );
}

function EvidenceCard({ evidence }: { evidence: ProposalEvidence }) {
  if (evidence.kind === "url") {
    return (
      <a
        href={evidence.content}
        target="_blank"
        rel="noreferrer noopener"
        className="block rounded-lg border border-neutral-800 bg-neutral-950/40 p-3 hover:border-cyan-700"
      >
        <div className="flex items-baseline gap-2 text-[10px] uppercase tracking-wider text-cyan-400">
          <span>🔗 URL</span>
          <span className="text-neutral-700">·</span>
          <span className="truncate font-mono normal-case text-neutral-500">
            {tryHostname(evidence.content)}
          </span>
        </div>
        <p className="mt-1 break-all text-[12px] text-neutral-200">
          {evidence.content}
        </p>
      </a>
    );
  }
  if (evidence.kind === "text") {
    return (
      <div className="rounded-lg border border-neutral-800 bg-neutral-950/40 p-3">
        <p className="text-[10px] uppercase tracking-wider text-neutral-500">
          📝 Note
        </p>
        <p className="mt-1 whitespace-pre-wrap text-[12px] leading-relaxed text-neutral-200">
          {evidence.content}
        </p>
      </div>
    );
  }
  // pdf / image: rendered properly in M46d. v1 shows the key.
  return (
    <div className="rounded-lg border border-neutral-800 bg-neutral-950/40 p-3">
      <p className="text-[10px] uppercase tracking-wider text-neutral-500">
        {evidence.kind.toUpperCase()}
      </p>
      <p className="mt-1 break-all font-mono text-[11px] text-neutral-400">
        {evidence.content}
      </p>
    </div>
  );
}

function tryHostname(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}
