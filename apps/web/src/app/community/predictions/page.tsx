/**
 * /community/predictions — M46b hub.
 *
 * Three tabs (URL query `?tab=live|resolved|leaderboard`):
 *   - Live: open predictions sorted by placed_at desc
 *   - Resolved: same, status='resolved'
 *   - Leaderboard: sum(reward_points) per user, resolved-only
 *
 * Each row is a server-rendered card; the place CTA lives in a
 * sticky banner. No client islands needed at this level — the
 * placement form is a separate route.
 */

import Link from "next/link";

import {
  fetchLeaderboard,
  listPredictions,
  type PredictionSummary,
} from "@/lib/prediction2-client";

export const dynamic = "force-dynamic";

interface Props {
  searchParams: Promise<{ tab?: string }>;
}

export default async function PredictionsHubPage({ searchParams }: Props) {
  const { tab: tabRaw } = await searchParams;
  const tab: "live" | "resolved" | "leaderboard" =
    tabRaw === "resolved"
      ? "resolved"
      : tabRaw === "leaderboard"
        ? "leaderboard"
        : "live";

  return (
    <main className="mx-auto max-w-5xl px-6 py-10">
      <header className="flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-neutral-100">
            Price predictions
          </h1>
          <p className="mt-1 text-[12px] text-neutral-500">
            Bet a 1D / 1W / 1M price band. Difficulty is auto-assigned
            from horizon × volatility × spread — Easy 10p / Medium 25p /
            Hard 50p when you nail it.
          </p>
        </div>
        <Link
          href="/community/predictions/new"
          className="rounded-md border border-cyan-700 bg-cyan-900/40 px-4 py-2 text-sm font-medium text-cyan-100 hover:bg-cyan-800/60"
        >
          🎯 Place prediction
        </Link>
      </header>

      <nav className="mt-6 flex gap-1 rounded-md border border-neutral-800 bg-neutral-950 p-1 text-[12px]">
        <TabLink current={tab} value="live" label="🔴 Live" />
        <TabLink current={tab} value="resolved" label="✅ Resolved" />
        <TabLink current={tab} value="leaderboard" label="🏆 Leaderboard" />
      </nav>

      {tab === "leaderboard" ? (
        <LeaderboardPanel />
      ) : (
        <PredictionsListPanel status={tab === "live" ? "open" : "resolved"} />
      )}
    </main>
  );
}

function TabLink({
  current,
  value,
  label,
}: {
  current: string;
  value: "live" | "resolved" | "leaderboard";
  label: string;
}) {
  const active = current === value;
  return (
    <Link
      href={`/community/predictions?tab=${value}`}
      className={`rounded px-3 py-1.5 transition ${
        active ? "bg-cyan-900/50 text-cyan-100" : "text-neutral-400 hover:text-neutral-200"
      }`}
    >
      {label}
    </Link>
  );
}

async function PredictionsListPanel({
  status,
}: {
  status: "open" | "resolved";
}) {
  let rows: PredictionSummary[] = [];
  let error: string | null = null;
  try {
    const out = await listPredictions({ status, limit: 50 });
    rows = out.rows;
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
  }
  if (error) {
    return (
      <p className="mt-6 rounded border border-red-900/60 bg-red-950/40 p-3 text-[12px] text-red-300">
        {error}
      </p>
    );
  }
  if (rows.length === 0) {
    return (
      <p className="mt-12 text-center text-[12px] text-neutral-500">
        {status === "open"
          ? "No live predictions yet. Be the first to place one."
          : "No resolved predictions yet."}
      </p>
    );
  }
  return (
    <ul className="mt-4 space-y-3">
      {rows.map((p) => (
        <li key={p.id}>
          <PredictionCard row={p} />
        </li>
      ))}
    </ul>
  );
}

async function LeaderboardPanel() {
  let rows: Awaited<ReturnType<typeof fetchLeaderboard>> = [];
  let error: string | null = null;
  try {
    rows = await fetchLeaderboard(20);
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
  }
  if (error) {
    return (
      <p className="mt-6 rounded border border-red-900/60 bg-red-950/40 p-3 text-[12px] text-red-300">
        {error}
      </p>
    );
  }
  if (rows.length === 0) {
    return (
      <p className="mt-12 text-center text-[12px] text-neutral-500">
        No resolved predictions yet — leaderboard fills in after the
        first horizon closes.
      </p>
    );
  }
  return (
    <div className="mt-4 overflow-x-auto rounded-lg border border-neutral-800">
      <table className="min-w-full text-[13px]">
        <thead className="bg-neutral-950">
          <tr className="border-b border-neutral-800 text-[10px] uppercase tracking-wider text-neutral-500">
            <th className="px-3 py-2 text-left">#</th>
            <th className="px-3 py-2 text-left">User</th>
            <th className="px-3 py-2 text-right">Total points</th>
            <th className="px-3 py-2 text-right">Resolved</th>
            <th className="px-3 py-2 text-right">Avg score</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr
              key={r.user_id}
              className="border-b border-neutral-900 last:border-0 hover:bg-neutral-950"
            >
              <td className="px-3 py-2 font-mono text-neutral-500">
                {i + 1}
              </td>
              <td className="px-3 py-2 text-neutral-200">{r.user_label}</td>
              <td className="px-3 py-2 text-right font-mono text-cyan-300">
                {r.total_points.toLocaleString()}p
              </td>
              <td className="px-3 py-2 text-right font-mono text-neutral-300">
                {r.resolved_count}
              </td>
              <td className="px-3 py-2 text-right font-mono text-neutral-400">
                {(r.avg_score * 100).toFixed(0)}%
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function PredictionCard({ row }: { row: PredictionSummary }) {
  return (
    <Link
      href={`/community/predictions/${row.id}`}
      className="block rounded-lg border border-neutral-800 bg-neutral-900/40 p-4 hover:border-neutral-700"
    >
      <div className="flex items-baseline gap-2 text-[11px]">
        <TierBadge tier={row.tier} />
        <HorizonBadge horizon={row.horizon} />
        {row.status === "resolved" && row.reward_points !== null && (
          <span
            className={`rounded border px-1.5 py-0.5 text-[10px] uppercase tracking-wider ${
              row.reward_points > 0
                ? "border-emerald-700 text-emerald-300 bg-emerald-950/30"
                : "border-rose-700 text-rose-300 bg-rose-950/30"
            }`}
          >
            {row.reward_points > 0 ? `+${row.reward_points}p` : "miss"}
          </span>
        )}
        <span className="text-neutral-500">{row.author.label}</span>
        <span className="ml-auto font-mono text-[10px] text-neutral-600">
          {row.sector_slug}
        </span>
      </div>
      <div className="mt-2 flex items-baseline justify-between gap-3">
        <div>
          <p className="text-sm font-medium text-neutral-100">
            {row.company_name}{" "}
            <span className="font-mono text-[11px] text-neutral-500">
              {row.ticker}.{row.exchange}
            </span>
          </p>
          <p className="mt-1 text-[12px] text-neutral-400">
            from{" "}
            <span className="font-mono text-neutral-300">
              {row.anchor_price.toFixed(2)}
            </span>{" "}
            → predict{" "}
            <span className="font-mono text-cyan-300">
              {row.expected_price_min.toFixed(2)}
            </span>
            <span className="text-neutral-700">–</span>
            <span className="font-mono text-cyan-300">
              {row.expected_price_max.toFixed(2)}
            </span>
            {row.status === "resolved" && row.actual_price !== null && (
              <span className="ml-2 text-neutral-500">
                · actual{" "}
                <span
                  className={`font-mono ${
                    row.actual_price >= row.expected_price_min &&
                    row.actual_price <= row.expected_price_max
                      ? "text-emerald-300"
                      : "text-rose-300"
                  }`}
                >
                  {row.actual_price.toFixed(2)}
                </span>
              </span>
            )}
          </p>
        </div>
        <div className="shrink-0 text-right text-[10px] text-neutral-500">
          {row.status === "resolved" ? (
            <>resolved {relativeTime(row.resolved_at)}</>
          ) : (
            <>resolves {relativeTime(row.resolves_at)}</>
          )}
        </div>
      </div>
    </Link>
  );
}

function TierBadge({ tier }: { tier: string }) {
  const cls =
    tier === "hard"
      ? "border-rose-700 text-rose-200 bg-rose-950/40"
      : tier === "medium"
        ? "border-amber-700 text-amber-200 bg-amber-950/40"
        : "border-emerald-700 text-emerald-200 bg-emerald-950/40";
  const emoji = tier === "hard" ? "🔴" : tier === "medium" ? "🟡" : "🟢";
  return (
    <span
      className={`rounded border px-1.5 py-0.5 text-[10px] uppercase tracking-wider ${cls}`}
    >
      {emoji} {tier}
    </span>
  );
}

function HorizonBadge({ horizon }: { horizon: string }) {
  return (
    <span className="rounded border border-neutral-700 px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-neutral-300">
      {horizon}
    </span>
  );
}

function relativeTime(d: string | Date | null): string {
  if (!d) return "—";
  const date = typeof d === "string" ? new Date(d) : d;
  const seconds = (date.getTime() - Date.now()) / 1000;
  const abs = Math.abs(seconds);
  const fmt = (n: number, unit: string) =>
    seconds > 0 ? `in ${n}${unit}` : `${n}${unit} ago`;
  if (abs < 60) return fmt(Math.round(abs), "s");
  if (abs < 3600) return fmt(Math.round(abs / 60), "m");
  if (abs < 86400) return fmt(Math.round(abs / 3600), "h");
  if (abs < 86400 * 30) return fmt(Math.round(abs / 86400), "d");
  return date.toISOString().slice(0, 10);
}
