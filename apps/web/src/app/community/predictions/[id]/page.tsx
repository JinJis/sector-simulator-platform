/**
 * /community/predictions/[id] — single-prediction detail.
 *
 * Server-rendered. Shows: anchor → band → resolves_at countdown
 * (open) or anchor → band vs actual close (resolved), plus
 * tier explanation + rationale.
 */

import Link from "next/link";
import { notFound } from "next/navigation";

import {
  fetchPredictionDetail,
  type PredictionDetail,
} from "@/lib/prediction2-client";

export const dynamic = "force-dynamic";

interface Props {
  params: Promise<{ id: string }>;
}

const TIER_MAX: Record<string, number> = { easy: 10, medium: 25, hard: 50 };

export default async function PredictionDetailPage({ params }: Props) {
  const { id } = await params;
  let p: PredictionDetail;
  try {
    p = await fetchPredictionDetail(id);
  } catch {
    notFound();
  }

  const hit =
    p.actual_price !== null &&
    p.actual_price >= p.expected_price_min &&
    p.actual_price <= p.expected_price_max;

  return (
    <main className="mx-auto max-w-[100rem] px-6 py-10">
      <nav className="mb-3 flex gap-2 text-[11px] text-neutral-500">
        <Link href="/community/predictions" className="hover:text-neutral-300">
          ← Predictions
        </Link>
        <span className="text-neutral-700">·</span>
        <Link
          href={`/community/predictions?tab=${p.status === "resolved" ? "resolved" : "live"}`}
          className="hover:text-neutral-300"
        >
          {p.status}
        </Link>
      </nav>

      <header className="rounded-lg border border-neutral-800 bg-neutral-900/40 p-5">
        <div className="flex flex-wrap items-baseline gap-2 text-[11px]">
          <TierBadge tier={p.tier} />
          <span className="rounded border border-neutral-700 px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-neutral-300">
            {p.horizon}
          </span>
          <span className="rounded border border-neutral-700 px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-neutral-300">
            {p.sector_slug}
          </span>
          <span className="ml-auto text-[11px] text-neutral-500">
            by <strong className="text-neutral-300">{p.author.label}</strong>{" "}
            on {new Date(p.placed_at).toISOString().slice(0, 16).replace("T", " ")}
          </span>
        </div>
        <h1 className="mt-3 text-xl font-semibold text-neutral-100">
          {p.company_name}{" "}
          <span className="font-mono text-sm text-neutral-500">
            {p.ticker}.{p.exchange}
          </span>
        </h1>

        <div className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-3">
          <Stat label="Anchor" value={p.anchor_price.toFixed(2)} sub={isoDate(p.anchor_date)} />
          <Stat
            label="Predicted band"
            value={`${p.expected_price_min.toFixed(2)} – ${p.expected_price_max.toFixed(2)}`}
            sub={`±${((p.expected_price_max - p.expected_price_min) / 2 / ((p.expected_price_min + p.expected_price_max) / 2) * 100).toFixed(1)}%`}
            accent="cyan"
          />
          {p.status === "resolved" ? (
            <Stat
              label="Actual close"
              value={p.actual_price !== null ? p.actual_price.toFixed(2) : "—"}
              sub={p.resolved_at ? isoDate(p.resolved_at) : ""}
              accent={hit ? "emerald" : "rose"}
            />
          ) : (
            <Stat
              label="Resolves at"
              value={isoDate(p.resolves_at)}
              sub={relativeTime(p.resolves_at)}
              accent="amber"
            />
          )}
        </div>
      </header>

      {p.status === "resolved" && p.reward_points !== null && (
        <section
          className={`mt-6 rounded-lg border p-4 ${
            p.reward_points > 0
              ? "border-emerald-800/60 bg-emerald-950/20"
              : "border-rose-800/60 bg-rose-950/20"
          }`}
        >
          <div className="flex items-baseline justify-between gap-3">
            <div>
              <p className="text-[10px] uppercase tracking-wider text-neutral-400">
                Resolution
              </p>
              <p className="mt-1 text-2xl font-semibold tabular-nums text-neutral-100">
                {p.reward_points > 0 ? `+${p.reward_points}p` : "0p"}
              </p>
            </div>
            <div className="text-right text-[12px]">
              <p className="text-neutral-500">
                score {p.score !== null ? (p.score * 100).toFixed(0) : "—"}%
              </p>
              <p className="text-neutral-500">
                tier cap {TIER_MAX[p.tier] ?? "—"}p
              </p>
            </div>
          </div>
        </section>
      )}

      {p.tier_explanation && (
        <section className="mt-6 rounded-lg border border-neutral-800 bg-neutral-950/40 p-4">
          <p className="text-[10px] uppercase tracking-wider text-neutral-500">
            Why this tier
          </p>
          <p className="mt-1 text-[12px] text-neutral-300">
            {p.tier_explanation}
          </p>
        </section>
      )}

      {p.rationale && (
        <section className="mt-6 rounded-lg border border-neutral-800 bg-neutral-900/40 p-4">
          <p className="text-[10px] uppercase tracking-wider text-neutral-500">
            Rationale
          </p>
          <p className="mt-1 whitespace-pre-wrap text-[13px] leading-relaxed text-neutral-300">
            {p.rationale}
          </p>
        </section>
      )}
    </main>
  );
}

function Stat({
  label,
  value,
  sub,
  accent,
}: {
  label: string;
  value: string;
  sub?: string;
  accent?: "cyan" | "emerald" | "rose" | "amber";
}) {
  const accentClass =
    accent === "cyan"
      ? "text-cyan-300"
      : accent === "emerald"
        ? "text-emerald-300"
        : accent === "rose"
          ? "text-rose-300"
          : accent === "amber"
            ? "text-amber-300"
            : "text-neutral-100";
  return (
    <div>
      <p className="text-[10px] uppercase tracking-wider text-neutral-500">
        {label}
      </p>
      <p className={`mt-1 font-mono text-lg font-semibold tabular-nums ${accentClass}`}>
        {value}
      </p>
      {sub && <p className="mt-0.5 text-[10px] text-neutral-600">{sub}</p>}
    </div>
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

function isoDate(d: Date | string): string {
  return new Date(d).toISOString().slice(0, 10);
}

function relativeTime(d: Date | string): string {
  const date = new Date(d);
  const sec = (date.getTime() - Date.now()) / 1000;
  const abs = Math.abs(sec);
  const fmt = (n: number, unit: string) =>
    sec > 0 ? `in ${n}${unit}` : `${n}${unit} ago`;
  if (abs < 3600) return fmt(Math.round(abs / 60), "m");
  if (abs < 86400) return fmt(Math.round(abs / 3600), "h");
  return fmt(Math.round(abs / 86400), "d");
}
