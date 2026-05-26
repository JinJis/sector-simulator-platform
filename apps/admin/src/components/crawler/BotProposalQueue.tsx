"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { type BotProposalRow, bulkDecideProposals } from "@/lib/sim-client";

interface Props {
  initialProposals: BotProposalRow[];
}

const STATUS_TONE: Record<string, string> = {
  open: "border-amber-700 text-amber-200 bg-amber-950/30",
  review: "border-blue-700 text-blue-200 bg-blue-950/30",
  applied: "border-emerald-700 text-emerald-200 bg-emerald-950/30",
  rejected: "border-neutral-700 text-neutral-400 bg-neutral-900",
  stale: "border-neutral-800 text-neutral-500 bg-neutral-950",
};

/**
 * BotProposalQueue (M52). Lists bot-authored CommunityProposals
 * (queried with `author_is_bot=true`) and lets the admin bulk-decide
 * applied|rejected with an optional reason. The decision row writes
 * an audit log entry per proposal via `communityProposal.bulkDecide`.
 *
 * The M46e applier (which actually creates Actor/VisionActor rows
 * from `proposed_payload`) is a separate job — bulk-applying here
 * stamps the decision; the applier processes accepted entries on its
 * own cadence.
 */
export function BotProposalQueue({ initialProposals }: Props) {
  const router = useRouter();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [reason, setReason] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const allChecked =
    initialProposals.length > 0 && selected.size === initialProposals.length;

  const toggleAll = () => {
    if (allChecked) setSelected(new Set());
    else setSelected(new Set(initialProposals.map((p) => p.id)));
  };

  const decide = (status: "applied" | "rejected") => {
    if (selected.size === 0) return;
    setError(null);
    setOk(null);
    startTransition(async () => {
      try {
        const res = await bulkDecideProposals({
          ids: [...selected],
          status,
          reason: reason.trim(),
        });
        setOk(
          `decided ${res.decided_count} · skipped ${res.skipped_ids.length}`,
        );
        setSelected(new Set());
        setReason("");
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    });
  };

  return (
    <section>
      <div className="mb-2 flex items-baseline justify-between">
        <h2 className="text-[10px] font-semibold uppercase tracking-wider text-neutral-500">
          Bot proposal queue ({initialProposals.length})
        </h2>
        {initialProposals.length > 0 && (
          <button
            type="button"
            onClick={toggleAll}
            className="text-[10px] text-neutral-400 hover:text-cyan-300"
          >
            {allChecked ? "Deselect all" : "Select all"}
          </button>
        )}
      </div>

      {initialProposals.length === 0 ? (
        <p className="rounded border border-dashed border-neutral-800 bg-neutral-950/40 px-4 py-6 text-center text-xs text-neutral-500">
          No open bot proposals.{" "}
          <span className="text-neutral-600">
            Trigger `/jobs/discovery/run` after signals accumulate.
          </span>
        </p>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {initialProposals.map((p) => {
            const checked = selected.has(p.id);
            const tone = STATUS_TONE[p.status] ?? STATUS_TONE.open;
            return (
              <li
                key={p.id}
                className={`flex items-start gap-3 rounded-lg border px-3 py-2 ${
                  checked
                    ? "border-cyan-700/70 bg-cyan-950/20"
                    : "border-neutral-800 bg-neutral-900/40 hover:border-neutral-700"
                }`}
              >
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => {
                    const next = new Set(selected);
                    if (checked) next.delete(p.id);
                    else next.add(p.id);
                    setSelected(next);
                  }}
                  className="mt-1 h-3.5 w-3.5 shrink-0 cursor-pointer"
                  aria-label={`select ${p.title}`}
                />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-baseline gap-2 text-[11px]">
                    <span
                      className={`rounded border px-1.5 py-0.5 text-[10px] uppercase tracking-wider ${tone}`}
                    >
                      {p.status}
                    </span>
                    <span className="rounded border border-amber-500/50 bg-amber-500/10 px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-amber-300">
                      ✨ {p.author.bot_kind ?? "bot"}
                    </span>
                    <span className="font-mono text-[10px] text-cyan-400">
                      {p.sector_slug}
                    </span>
                    <span className="text-neutral-600">·</span>
                    <span className="text-neutral-500">
                      {new Date(p.created_at).toISOString().slice(0, 16)}
                    </span>
                    <span className="ml-auto font-mono text-neutral-400 tabular-nums">
                      {p.vote_score}▲
                    </span>
                  </div>
                  <a
                    href={`/community/proposals/${p.id}`}
                    target="_blank"
                    rel="noreferrer"
                    className="mt-1 block text-sm text-neutral-100 hover:text-cyan-200"
                  >
                    {p.title}
                  </a>
                  <div className="mt-0.5 text-[10px] text-neutral-500">
                    {p.evidence_count} evidence · {p.reply_count} replies
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {initialProposals.length > 0 && (
        <div className="mt-3 flex flex-wrap items-center gap-2 rounded-lg border border-neutral-800 bg-neutral-950/40 px-3 py-2">
          <input
            type="text"
            placeholder="Decision reason (audit log)"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            className="min-w-[240px] flex-1 rounded border border-neutral-700 bg-neutral-950 px-2 py-1 text-xs text-neutral-100 focus:border-neutral-500 focus:outline-none"
          />
          <button
            type="button"
            onClick={() => decide("applied")}
            disabled={pending || selected.size === 0}
            className="rounded bg-emerald-700 px-3 py-1 text-xs font-medium text-emerald-50 hover:bg-emerald-600 disabled:cursor-not-allowed disabled:bg-neutral-700 disabled:text-neutral-400"
          >
            Apply ({selected.size})
          </button>
          <button
            type="button"
            onClick={() => decide("rejected")}
            disabled={pending || selected.size === 0}
            className="rounded bg-rose-700 px-3 py-1 text-xs font-medium text-rose-50 hover:bg-rose-600 disabled:cursor-not-allowed disabled:bg-neutral-700 disabled:text-neutral-400"
          >
            Reject ({selected.size})
          </button>
          {ok && <span className="text-[11px] text-emerald-400">{ok}</span>}
          {error && <span className="text-[11px] text-rose-400">{error}</span>}
        </div>
      )}
    </section>
  );
}
