/**
 * /community — Community 3.0 hub (M46a + M46b).
 *
 * Two flywheels:
 *   - Proposals: enrich the platform (drivers / equities / capabilities
 *     / risks / actors / signal sources) with evidence + votes.
 *   - Predictions: auto-tiered band predictions on real stocks;
 *     reward = score × tier × 10.
 *
 * The legacy investment-frame hub (predict / leaderboard / my-predictions
 * / suggestions) was deleted at the pivot cleanup — the new tabs above
 * supersede it. Reputation + follow + profile pages land in M46c.
 */

import Link from "next/link";

import { getT } from "@/lib/i18n/server";
import {
  listProposals,
  type ProposalSummary,
} from "@/lib/community-proposal-client";
import {
  fetchLeaderboard,
  listPredictions,
  type PredictionLeaderRow,
  type PredictionSummary,
} from "@/lib/prediction2-client";

export const dynamic = "force-dynamic";

export default async function CommunityHomePage() {
  const [t, proposals, livePredictions, leaderboard] = await Promise.all([
    getT(),
    listProposals({ sort: "hot", limit: 5 }).catch(() => ({
      rows: [] as ProposalSummary[],
      next_cursor: null,
    })),
    listPredictions({ status: "open", limit: 5 }).catch(() => ({
      rows: [] as PredictionSummary[],
      next_cursor: null,
    })),
    fetchLeaderboard(5).catch(() => [] as PredictionLeaderRow[]),
  ]);

  return (
    <main className="mx-auto max-w-[100rem] px-6 py-10">
      <header className="rounded-xl border border-violet-900/40 bg-gradient-to-br from-violet-950/30 via-neutral-950 to-cyan-950/20 p-6">
        <span className="rounded-full border border-violet-700/60 bg-violet-950/50 px-2.5 py-0.5 text-[10px] uppercase tracking-wider text-violet-300">
          {t("community.badge")}
        </span>
        <h1 className="mt-3 text-2xl font-semibold text-neutral-50">
          {t("community.title")}
        </h1>
        <p className="mt-2 max-w-3xl text-[13px] leading-relaxed text-neutral-300">
          {t("community.subtitle")}
        </p>
        <div className="mt-5 flex flex-wrap gap-3">
          <Link
            href="/community/proposals/new"
            className="rounded border border-cyan-700 bg-cyan-900/40 px-4 py-2 text-sm font-medium text-cyan-100 hover:bg-cyan-800/60"
          >
            {t("community.proposeCta")}
          </Link>
          <Link
            href="/community/predictions/new"
            className="rounded border border-amber-700 bg-amber-900/40 px-4 py-2 text-sm font-medium text-amber-100 hover:bg-amber-800/60"
          >
            {t("community.predictCta")}
          </Link>
        </div>
      </header>

      <div className="mt-8 grid gap-6 lg:grid-cols-2">
        <Card
          title={t("community.cards.hotProposals")}
          link={{ href: "/community/proposals?sort=hot", label: t("community.cards.seeAll") }}
        >
          {proposals.rows.length === 0 ? (
            <Empty hint={t("community.empty.proposals")} />
          ) : (
            <ul className="space-y-2">
              {proposals.rows.map((p) => (
                <li key={p.id}>
                  <Link
                    href={`/community/proposals/${p.id}`}
                    className="flex items-baseline gap-2 rounded border border-neutral-800 bg-neutral-950/40 p-2 text-[12px] hover:border-neutral-700"
                  >
                    <span className="rounded border border-cyan-900/40 bg-cyan-950/30 px-1.5 py-0.5 text-[10px] font-mono text-cyan-300">
                      ▲ {p.vote_score}
                    </span>
                    <span className="truncate text-neutral-100">{p.title}</span>
                    <span className="ml-auto font-mono text-[10px] text-neutral-500">
                      {p.sector_slug}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card
          title={t("community.cards.livePredictions")}
          link={{ href: "/community/predictions?tab=live", label: t("community.cards.seeAll") }}
        >
          {livePredictions.rows.length === 0 ? (
            <Empty hint={t("community.empty.predictions")} />
          ) : (
            <ul className="space-y-2">
              {livePredictions.rows.map((p) => (
                <li key={p.id}>
                  <Link
                    href={`/community/predictions/${p.id}`}
                    className="flex items-baseline gap-2 rounded border border-neutral-800 bg-neutral-950/40 p-2 text-[12px] hover:border-neutral-700"
                  >
                    <span className="rounded border border-neutral-700 px-1 py-0.5 text-[10px] uppercase tracking-wider text-neutral-300">
                      {p.tier}
                    </span>
                    <span className="rounded border border-neutral-700 px-1 py-0.5 text-[10px] text-neutral-400">
                      {p.horizon}
                    </span>
                    <span className="truncate text-neutral-100">
                      {p.ticker}{" "}
                      <span className="font-mono text-[10px] text-neutral-500">
                        {p.expected_price_min.toFixed(0)}–
                        {p.expected_price_max.toFixed(0)}
                      </span>
                    </span>
                    <span className="ml-auto text-[10px] text-neutral-500">
                      {p.author.label}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <section className="mt-8">
        <Card
          title={t("community.cards.leaderboard")}
          link={{
            href: "/community/predictions?tab=leaderboard",
            label: t("community.cards.fullLeaderboard"),
          }}
        >
          {leaderboard.length === 0 ? (
            <Empty hint={t("community.empty.leaderboard")} />
          ) : (
            <table className="w-full text-[13px]">
              <thead>
                <tr className="border-b border-neutral-800 text-[10px] uppercase tracking-wider text-neutral-500">
                  <th className="py-2 text-left">#</th>
                  <th className="py-2 text-left">User</th>
                  <th className="py-2 text-right">Points</th>
                  <th className="py-2 text-right">Avg</th>
                </tr>
              </thead>
              <tbody>
                {leaderboard.map((r, i) => (
                  <tr
                    key={r.user_id}
                    className="border-b border-neutral-900 last:border-0"
                  >
                    <td className="py-1.5 font-mono text-neutral-500">{i + 1}</td>
                    <td className="py-1.5 text-neutral-200">
                      <Link
                        href={`/u/${encodeURIComponent(r.user_id)}`}
                        className="hover:text-cyan-300"
                      >
                        {r.user_label}
                      </Link>
                    </td>
                    <td className="py-1.5 text-right font-mono text-cyan-300">
                      {r.total_points.toLocaleString()}p
                    </td>
                    <td className="py-1.5 text-right font-mono text-neutral-400">
                      {(r.avg_score * 100).toFixed(0)}%
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      </section>
    </main>
  );
}

function Card({
  title,
  link,
  children,
}: {
  title: string;
  link?: { href: string; label: string };
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-xl border border-neutral-800 bg-neutral-900/40 p-5">
      <div className="mb-3 flex items-baseline justify-between">
        <h2 className="text-sm font-semibold text-neutral-100">{title}</h2>
        {link && (
          <Link
            href={link.href}
            className="text-[11px] text-cyan-400 hover:text-cyan-300"
          >
            {link.label}
          </Link>
        )}
      </div>
      {children}
    </section>
  );
}

function Empty({ hint }: { hint: string }) {
  return (
    <p className="rounded border border-dashed border-neutral-800 bg-neutral-950/40 p-3 text-[12px] leading-relaxed text-neutral-500">
      {hint}
    </p>
  );
}
