/**
 * /u/[id] — user profile (M46c).
 *
 * Header strip: avatar (initial circle) + label + tier badge + total
 * points + follower/following counts + Follow button (client island).
 *
 * Activity tabs (URL query `?tab=proposals|predictions|activity`):
 *   - Proposals  — user's open + applied proposals
 *   - Predictions — user's resolved predictions (open ones live on /community/predictions)
 *   - Activity   — recent PointEvents (full reputation ledger)
 *
 * Followers / Following lists are collapsible sections below the
 * header (rendered server-side when shown).
 */

import Link from "next/link";
import { notFound } from "next/navigation";

import {
  fetchFollowCounts,
  fetchFollowersOf,
  fetchFollowingOf,
  fetchPointEvents,
  fetchReputation,
  type FollowCounts,
  type FollowEdge,
  type PointEventRow,
  type ReputationSnapshot,
} from "@/lib/profile-client";
import { listProposals } from "@/lib/community-proposal-client";
import { listPredictions } from "@/lib/prediction2-client";
import { fetchMe } from "@/lib/sim-client";

import { FollowButton } from "./follow-button";

export const dynamic = "force-dynamic";

interface Props {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string; show?: string }>;
}

const TIER_COLORS: Record<string, string> = {
  newcomer: "border-neutral-700 text-neutral-400 bg-neutral-900",
  member: "border-cyan-800 text-cyan-300 bg-cyan-950/40",
  analyst: "border-emerald-800 text-emerald-300 bg-emerald-950/40",
  senior: "border-amber-800 text-amber-300 bg-amber-950/40",
  maintainer: "border-rose-800 text-rose-300 bg-rose-950/40",
};

const POINT_EVENT_LABELS: Record<string, string> = {
  prediction_resolved: "Prediction rewarded",
  proposal_vote_received: "Proposal upvoted",
  proposal_applied: "Proposal applied",
  reply_upvote: "Reply upvoted",
  manual_grant: "Admin grant",
};

export default async function ProfilePage({ params, searchParams }: Props) {
  const { id } = await params;
  const sp = await searchParams;
  const tab: "proposals" | "predictions" | "activity" =
    sp.tab === "predictions"
      ? "predictions"
      : sp.tab === "activity"
        ? "activity"
        : "proposals";

  let rep: ReputationSnapshot;
  let counts: FollowCounts;
  try {
    [rep, counts] = await Promise.all([
      fetchReputation(id),
      fetchFollowCounts(id),
    ]);
  } catch {
    notFound();
  }
  const me = await fetchMe();
  const isSelf = !!me && me.id === id;

  return (
    <main className="mx-auto max-w-[88rem] px-6 py-10">
      <ProfileHeader
        rep={rep}
        counts={counts}
        isSelf={isSelf}
        viewerSignedIn={!!me}
      />

      <FollowLists
        userId={id}
        followerCount={counts.followers}
        followingCount={counts.following}
        show={sp.show ?? ""}
      />

      <nav className="mt-8 flex gap-1 rounded-md border border-neutral-800 bg-neutral-950 p-1 text-[12px]">
        <TabLink current={tab} value="proposals" label="Proposals" userId={id} />
        <TabLink current={tab} value="predictions" label="Predictions" userId={id} />
        <TabLink current={tab} value="activity" label="Activity" userId={id} />
      </nav>

      <section className="mt-4">
        {tab === "proposals" && <ProposalsPanel userId={id} />}
        {tab === "predictions" && <PredictionsPanel userId={id} />}
        {tab === "activity" && <ActivityPanel userId={id} />}
      </section>
    </main>
  );
}

// ===== Header ==========================================================

function ProfileHeader({
  rep,
  counts,
  isSelf,
  viewerSignedIn,
}: {
  rep: ReputationSnapshot;
  counts: FollowCounts;
  isSelf: boolean;
  viewerSignedIn: boolean;
}) {
  const initial = rep.user_label.slice(0, 1).toUpperCase();
  const tierClass = TIER_COLORS[rep.tier] ?? TIER_COLORS["newcomer"];
  return (
    <header className="flex items-start gap-5 rounded-xl border border-neutral-800 bg-neutral-900/40 p-5">
      <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-full border border-cyan-700 bg-cyan-950/40 text-2xl font-semibold text-cyan-200">
        {initial}
      </div>
      <div className="flex-1">
        <div className="flex flex-wrap items-baseline gap-2">
          <h1 className="text-xl font-semibold text-neutral-100">
            {rep.user_label}
          </h1>
          <span
            className={`rounded border px-1.5 py-0.5 text-[10px] uppercase tracking-wider ${tierClass}`}
          >
            {rep.tier}
          </span>
          <span className="text-[12px] text-neutral-500">
            <strong className="font-mono text-cyan-300">
              {rep.total_points.toLocaleString()}p
            </strong>
          </span>
        </div>
        <p className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[12px] text-neutral-400">
          <FollowsLink userId={rep.user_id} kind="followers" count={counts.followers} />
          <FollowsLink userId={rep.user_id} kind="following" count={counts.following} />
        </p>
      </div>
      {!isSelf && (
        <FollowButton
          followedId={rep.user_id}
          initialFollowing={counts.viewer_follows}
          initialFollowersCount={counts.followers}
          viewerSignedIn={viewerSignedIn}
        />
      )}
    </header>
  );
}

function FollowsLink({
  userId,
  kind,
  count,
}: {
  userId: string;
  kind: "followers" | "following";
  count: number;
}) {
  return (
    <Link
      href={`/u/${encodeURIComponent(userId)}?show=${kind}`}
      className="hover:text-cyan-300"
    >
      <span className="font-mono text-neutral-200">{count.toLocaleString()}</span>{" "}
      {kind === "followers" ? "followers" : "following"}
    </Link>
  );
}

function TabLink({
  current,
  value,
  label,
  userId,
}: {
  current: string;
  value: string;
  label: string;
  userId: string;
}) {
  const active = current === value;
  return (
    <Link
      href={`/u/${encodeURIComponent(userId)}?tab=${value}`}
      className={`rounded px-3 py-1.5 transition ${
        active
          ? "bg-cyan-900/50 text-cyan-100"
          : "text-neutral-400 hover:text-neutral-200"
      }`}
    >
      {label}
    </Link>
  );
}

// ===== Follow lists (lazy via ?show= query) ============================

async function FollowLists({
  userId,
  followerCount,
  followingCount,
  show,
}: {
  userId: string;
  followerCount: number;
  followingCount: number;
  show: string;
}) {
  if (show !== "followers" && show !== "following") return null;
  const edges =
    show === "followers"
      ? await fetchFollowersOf(userId)
      : await fetchFollowingOf(userId);
  const title =
    show === "followers"
      ? `Followers (${followerCount})`
      : `Following (${followingCount})`;
  return (
    <section className="mt-6 rounded-lg border border-neutral-800 bg-neutral-900/40 p-4">
      <div className="mb-2 flex items-baseline justify-between">
        <h2 className="text-sm font-semibold text-neutral-200">{title}</h2>
        <Link
          href={`/u/${encodeURIComponent(userId)}`}
          className="text-[11px] text-neutral-500 hover:text-neutral-300"
        >
          ✕ close
        </Link>
      </div>
      {edges.length === 0 ? (
        <p className="text-[12px] text-neutral-500">— empty</p>
      ) : (
        <ul className="space-y-1">
          {edges.map((e) => (
            <li key={e.user_id}>
              <FollowEdgeRow edge={e} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function FollowEdgeRow({ edge }: { edge: FollowEdge }) {
  const tierClass = TIER_COLORS[edge.tier] ?? TIER_COLORS["newcomer"];
  return (
    <Link
      href={`/u/${encodeURIComponent(edge.user_id)}`}
      className="flex items-baseline gap-2 rounded border border-neutral-800 bg-neutral-950/40 p-2 text-[12px] hover:border-neutral-700"
    >
      <span className="text-neutral-100">{edge.user_label}</span>
      <span
        className={`rounded border px-1 py-0.5 text-[9px] uppercase tracking-wider ${tierClass}`}
      >
        {edge.tier}
      </span>
      <span className="ml-auto text-[10px] text-neutral-600">
        followed{" "}
        {new Date(edge.followed_at).toISOString().slice(0, 10)}
      </span>
    </Link>
  );
}

// ===== Tab panels =====================================================

async function ProposalsPanel({ userId }: { userId: string }) {
  // We don't filter listProposals by author directly (router has no
  // such filter today); fetch a wide window and slice client-side.
  // Cheap because rows are tiny.
  const res = await listProposals({ sort: "new", limit: 100 }).catch(
    () => null,
  );
  const rows = (res?.rows ?? []).filter((p) => p.author.id === userId);
  if (rows.length === 0) {
    return <Empty hint="No proposals yet." />;
  }
  return (
    <ul className="space-y-2">
      {rows.map((p) => (
        <li key={p.id}>
          <Link
            href={`/community/proposals/${p.id}`}
            className="flex items-baseline gap-2 rounded border border-neutral-800 bg-neutral-900/40 p-3 hover:border-neutral-700"
          >
            <span className="rounded border border-cyan-900/40 bg-cyan-950/30 px-1.5 py-0.5 font-mono text-[10px] text-cyan-300">
              ▲ {p.vote_score}
            </span>
            <span className="rounded border border-neutral-700 px-1 py-0.5 text-[10px] uppercase tracking-wider text-neutral-400">
              {p.status}
            </span>
            <span className="truncate text-[13px] text-neutral-100">
              {p.title}
            </span>
            <span className="ml-auto font-mono text-[10px] text-neutral-500">
              {p.sector_slug}
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

async function PredictionsPanel({ userId }: { userId: string }) {
  // Same approach — wide window + client-side filter by author.
  const res = await listPredictions({ status: "resolved", limit: 100 }).catch(
    () => null,
  );
  const rows = (res?.rows ?? []).filter((p) => p.author.id === userId);
  if (rows.length === 0) {
    return <Empty hint="No resolved predictions yet. Pending ones live on /community/predictions." />;
  }
  return (
    <ul className="space-y-2">
      {rows.map((p) => (
        <li key={p.id}>
          <Link
            href={`/community/predictions/${p.id}`}
            className="flex items-baseline gap-2 rounded border border-neutral-800 bg-neutral-900/40 p-3 hover:border-neutral-700"
          >
            <span className="rounded border border-neutral-700 px-1 py-0.5 text-[10px] uppercase tracking-wider text-neutral-300">
              {p.tier}
            </span>
            <span className="rounded border border-neutral-700 px-1 py-0.5 text-[10px] text-neutral-400">
              {p.horizon}
            </span>
            <span className="text-[13px] text-neutral-100">
              {p.ticker}.{p.exchange}
            </span>
            {p.reward_points !== null && (
              <span
                className={`ml-auto rounded border px-1.5 py-0.5 text-[10px] font-mono ${
                  p.reward_points > 0
                    ? "border-emerald-700 text-emerald-300 bg-emerald-950/30"
                    : "border-rose-700 text-rose-300 bg-rose-950/30"
                }`}
              >
                {p.reward_points > 0 ? `+${p.reward_points}p` : "miss"}
              </span>
            )}
          </Link>
        </li>
      ))}
    </ul>
  );
}

async function ActivityPanel({ userId }: { userId: string }) {
  const rows: PointEventRow[] = await fetchPointEvents(userId, 50).catch(() => []);
  if (rows.length === 0) {
    return <Empty hint="No reputation events yet." />;
  }
  return (
    <ul className="space-y-1.5">
      {rows.map((e) => (
        <li
          key={e.id}
          className="flex items-baseline gap-3 rounded border border-neutral-800 bg-neutral-900/40 p-2.5 text-[12px]"
        >
          <span
            className={`shrink-0 font-mono text-[11px] ${
              e.amount > 0
                ? "text-emerald-300"
                : e.amount < 0
                  ? "text-rose-300"
                  : "text-neutral-400"
            }`}
          >
            {e.amount > 0 ? "+" : ""}
            {e.amount}p
          </span>
          <span className="text-neutral-200">
            {POINT_EVENT_LABELS[e.kind] ?? e.kind}
          </span>
          {e.refers_to_kind && (
            <ReferLink
              refersToKind={e.refers_to_kind}
              refersToId={e.refers_to_id}
            />
          )}
          <span className="ml-auto text-[10px] text-neutral-600">
            {new Date(e.created_at).toISOString().slice(0, 10)}
          </span>
        </li>
      ))}
    </ul>
  );
}

function ReferLink({
  refersToKind,
  refersToId,
}: {
  refersToKind: string;
  refersToId: string | null;
}) {
  if (!refersToId) return null;
  if (refersToKind === "proposal") {
    return (
      <Link
        href={`/community/proposals/${refersToId}`}
        className="font-mono text-[10px] text-cyan-400 hover:underline"
      >
        proposal
      </Link>
    );
  }
  if (refersToKind === "prediction") {
    return (
      <Link
        href={`/community/predictions/${refersToId}`}
        className="font-mono text-[10px] text-cyan-400 hover:underline"
      >
        prediction
      </Link>
    );
  }
  return (
    <span className="font-mono text-[10px] text-neutral-500">
      {refersToKind}
    </span>
  );
}

function Empty({ hint }: { hint: string }) {
  return (
    <p className="rounded border border-dashed border-neutral-800 bg-neutral-950/40 p-3 text-[12px] leading-relaxed text-neutral-500">
      {hint}
    </p>
  );
}
