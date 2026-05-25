/**
 * /community/proposals — M46a feed.
 *
 * Hot vs New tabs (URL query `?sort=hot|new`), optional sector filter.
 * Server-rendered for SEO + cheap initial paint; the vote button is a
 * client island.
 */

import Link from "next/link";

import {
  listProposals,
  type ProposalSummary,
} from "@/lib/community-proposal-client";

import { ProposalCard } from "./proposal-card";

export const dynamic = "force-dynamic";

interface Props {
  searchParams: Promise<{ sort?: string; sector?: string }>;
}

const TARGET_KIND_LABELS: Record<string, string> = {
  add_driver: "+ Driver",
  add_equity: "+ Equity",
  add_capability: "+ Capability",
  add_risk: "+ Risk",
  add_actor: "+ Actor",
  add_signal_source: "+ Signal source",
  edit: "Edit",
  other: "Other",
};

export default async function ProposalsHomePage({ searchParams }: Props) {
  const params = await searchParams;
  const sortRaw = params.sort === "new" ? "new" : "hot";
  const sectorSlug = params.sector;

  let rows: ProposalSummary[] = [];
  let error: string | null = null;
  try {
    const res = await listProposals({
      sort: sortRaw,
      ...(sectorSlug ? { sector_slug: sectorSlug } : {}),
      limit: 30,
    });
    rows = res.rows;
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
  }

  return (
    <main className="mx-auto max-w-[88rem] px-6 py-10">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold text-neutral-100">
            Community proposals
          </h1>
          <p className="mt-1 text-[12px] text-neutral-500">
            Suggest new drivers, equities, capabilities, risks, actors, or
            signal sources — anything that makes the sectors more accurate.
            Other users upvote; top proposals get applied to the live data.
          </p>
        </div>
        <Link
          href="/community/proposals/new"
          className="rounded-md border border-cyan-700 bg-cyan-900/40 px-4 py-2 text-sm font-medium text-cyan-100 hover:bg-cyan-800/60"
        >
          ＋ Propose
        </Link>
      </header>

      <div className="mt-6 flex items-center justify-between">
        <nav className="flex gap-1 rounded-md border border-neutral-800 bg-neutral-950 p-1 text-[12px]">
          <SortLink current={sortRaw} value="hot" sector={sectorSlug}>
            🔥 Hot
          </SortLink>
          <SortLink current={sortRaw} value="new" sector={sectorSlug}>
            ✨ New
          </SortLink>
        </nav>
        {sectorSlug && (
          <Link
            href="/community/proposals"
            className="text-[11px] text-neutral-500 hover:text-neutral-300"
          >
            sector: <span className="font-mono text-cyan-400">{sectorSlug}</span> ✕
          </Link>
        )}
      </div>

      {error && (
        <p className="mt-6 rounded border border-red-900/60 bg-red-950/40 p-3 text-[12px] text-red-300">
          Failed to load proposals: {error}
        </p>
      )}

      {!error && rows.length === 0 && (
        <div className="mt-12 rounded border border-neutral-800 bg-neutral-900/40 p-8 text-center">
          <p className="text-sm text-neutral-300">No proposals yet here.</p>
          <p className="mt-1 text-[11px] text-neutral-500">
            Be the first to suggest an improvement. Your proposal gets a
            permalink, evidence cards, and a vote button.
          </p>
          <Link
            href="/community/proposals/new"
            className="mt-4 inline-block rounded border border-cyan-700 bg-cyan-900/40 px-3 py-1.5 text-xs font-medium text-cyan-100 hover:bg-cyan-800/60"
          >
            Open the proposal form →
          </Link>
        </div>
      )}

      {!error && rows.length > 0 && (
        <ul className="mt-4 space-y-3">
          {rows.map((p) => (
            <li key={p.id}>
              <ProposalCard
                proposal={p}
                kindLabel={TARGET_KIND_LABELS[p.target_kind] ?? p.target_kind}
              />
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}

function SortLink({
  current,
  value,
  sector,
  children,
}: {
  current: string;
  value: "hot" | "new";
  sector?: string;
  children: React.ReactNode;
}) {
  const active = current === value;
  const params = new URLSearchParams({ sort: value });
  if (sector) params.set("sector", sector);
  return (
    <Link
      href={`/community/proposals?${params.toString()}`}
      className={`rounded px-3 py-1.5 transition ${
        active
          ? "bg-cyan-900/50 text-cyan-100"
          : "text-neutral-400 hover:text-neutral-200"
      }`}
    >
      {children}
    </Link>
  );
}
