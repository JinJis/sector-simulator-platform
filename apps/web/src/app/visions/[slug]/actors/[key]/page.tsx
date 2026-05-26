/**
 * /visions/[slug]/actors/[key] — actor detail page.
 *
 * MP3 (was M45a fixture-only):
 *   1. trpc.actor.get(key) for full Actor row (logo / website /
 *      name_local / description that overview doesn't carry).
 *   2. trpc.signal.list({sector_slug, actor_key, limit:20}) for the
 *      Recent Signals feed — replaces the old M39/M45b stub.
 *   3. CapabilityHeatmap (packages/ui) bucketing those signals by
 *      capability_key — at-a-glance read on which capability this
 *      actor is moving most.
 *   4. SourceList chip on "Why this actor matters here" pulled from
 *      the actor's 3 most recent tagged signals.
 *
 * All four still degrade to the fixture path when DB is unreachable.
 */

import {
  ActorPill,
  CapabilityHeatmap,
  type CapabilityHeatmapItem,
  SignalRow,
  SourceList,
  type SourceRef,
  countryFlag,
} from "@platform/ui";
import { notFound } from "next/navigation";

import { trpc } from "@/lib/sim-client";

import { getVisionFixture } from "../../../_fixtures";

interface Props {
  params: Promise<{ slug: string; key: string }>;
}

const CATEGORY_LABEL: Record<string, string> = {
  public_corp: "Public corporation",
  private_startup: "Private startup",
  government_lab: "Government lab",
  national_lab: "National lab",
  academic_lab: "Academic lab",
  standards_body: "Standards body",
  ngo: "NGO",
};

const STAGE_LABEL: Record<string, string> = {
  research: "Research",
  pilot: "Pilot",
  commercial: "Commercial",
  scaling: "Scaling",
};

type ActorView = {
  actor_key: string;
  name: string;
  name_local: string | null;
  iso_country: string;
  category: string;
  stage: string;
  blurb: string;
  description: string | null;
  ticker: string | null;
  exchange: string | null;
  logo_url: string | null;
  website: string | null;
  relevance: number | null;
  rationale: string | null;
};

type ActiveOnRow = {
  capability: { key: string; short_name: string | null; name: string };
  role: string;
};

type RecentSignal = {
  id: string;
  capability_key: string | null;
  source_kind: string;
  source_url: string;
  title: string;
  summary: string | null;
  // tRPC superjson hands us a string over the wire; SourceChip + SignalRow
  // both accept either, so keep it permissive here.
  published_at: string | Date;
  delta_technical: number | null;
  delta_economic: number | null;
  delta_regulatory: number | null;
  delta_supply: number | null;
  is_highlight: boolean;
  citations?: { url: string; title: string }[];
};

function compositeDelta(s: RecentSignal): number | null {
  const parts = [
    s.delta_technical,
    s.delta_economic,
    s.delta_regulatory,
    s.delta_supply,
  ].filter((x): x is number => typeof x === "number");
  if (parts.length === 0) return null;
  return parts.reduce((a, b) => a + b, 0) / parts.length;
}

export default async function ActorDetailPage({ params }: Props) {
  const { slug, key } = await params;

  let actor: ActorView | null = null;
  let activeOn: ActiveOnRow[] = [];
  let signals: RecentSignal[] = [];

  try {
    const [overview, full] = await Promise.all([
      trpc.vision.getOverview.query({ slug, actor_limit: 200 }),
      trpc.actor.get.query({ key }),
    ]);
    const a = overview.actors.find((x) => x.actor_key === key);
    if (!a) notFound();

    actor = {
      actor_key: a.actor_key,
      name: full.name,
      name_local: full.name_local,
      iso_country: a.iso_country,
      category: a.category,
      stage: a.stage,
      blurb: a.blurb,
      description: full.description,
      ticker: a.ticker,
      exchange: a.exchange,
      logo_url: full.logo_url,
      website: full.website,
      relevance: a.relevance,
      rationale: a.rationale,
    };
    activeOn = overview.capabilities
      .map((c) => {
        const match = c.active_actors.find((aa) => aa.actor_key === key);
        return match
          ? {
              capability: {
                key: c.key,
                short_name: c.short_name,
                name: c.name,
              },
              role: match.role,
            }
          : null;
      })
      .filter((x): x is ActiveOnRow => x !== null);

    try {
      const feed = await trpc.signal.list.query({
        sector_slug: slug,
        actor_key: key,
        limit: 20,
      });
      signals = feed.items;
    } catch {
      signals = [];
    }
  } catch {
    const fixture = getVisionFixture(slug);
    if (!fixture) notFound();
    const a = fixture.overview.actors.find((x) => x.actor_key === key);
    if (!a) notFound();
    actor = {
      actor_key: a.actor_key,
      name: a.name,
      name_local: null,
      iso_country: a.iso_country,
      category: a.category,
      stage: a.stage,
      blurb: a.blurb,
      description: null,
      ticker: a.ticker,
      exchange: a.exchange,
      logo_url: null,
      website: null,
      relevance: a.relevance,
      rationale: a.rationale,
    };
    activeOn = fixture.overview.capabilities
      .map((c) => {
        const match = c.active_actors.find((aa) => aa.actor_key === key);
        return match
          ? {
              capability: {
                key: c.key,
                short_name: c.short_name,
                name: c.name,
              },
              role: match.role,
            }
          : null;
      })
      .filter((x): x is ActiveOnRow => x !== null);
  }

  if (!actor) notFound();

  // ---- Derived: capability heatmap (signal count per binding) ----
  const heatmapItems: CapabilityHeatmapItem[] = activeOn.map((row) => ({
    capability_key: row.capability.key,
    label: row.capability.short_name || row.capability.name,
    count: signals.filter((s) => s.capability_key === row.capability.key)
      .length,
    role: row.role,
    href: `/visions/${slug}/capabilities/${row.capability.key}`,
  }));

  // ---- Derived: top-3 sources for "Why this actor matters here" ----
  const rationaleSources: SourceRef[] = signals.slice(0, 3).map((s) => ({
    url: s.source_url,
    title: s.title,
    kind: s.source_kind,
    published_at: s.published_at,
  }));

  return (
    <div className="space-y-6">
      <header className="rounded-xl border border-neutral-800 bg-neutral-900/40 p-6">
        <div className="flex items-start gap-4">
          {actor.logo_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={actor.logo_url}
              alt={`${actor.name} logo`}
              className="mt-1 h-10 w-10 shrink-0 rounded border border-neutral-800 bg-neutral-950 object-contain"
            />
          ) : (
            <span className="mt-1 inline-flex h-10 w-10 shrink-0 items-center justify-center rounded border border-neutral-800 bg-neutral-950 font-mono text-sm uppercase text-neutral-500">
              {actor.name.slice(0, 2)}
            </span>
          )}
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <h2 className="text-2xl font-semibold text-neutral-50">
                {actor.name}
              </h2>
              {actor.name_local && actor.name_local !== actor.name && (
                <span className="text-sm text-neutral-400">
                  ({actor.name_local})
                </span>
              )}
              <span
                aria-label={actor.iso_country.toUpperCase()}
                className="text-xl"
              >
                {countryFlag(actor.iso_country)}
              </span>
              {actor.ticker && (
                <span className="rounded-sm border border-neutral-800 px-2 py-0.5 font-mono text-[11px] tracking-wider text-neutral-400">
                  {actor.ticker}
                  {actor.exchange ? ` · ${actor.exchange}` : ""}
                </span>
              )}
              {actor.website && (
                <a
                  href={actor.website}
                  target="_blank"
                  rel="noreferrer"
                  className="rounded-sm border border-cyan-900/50 bg-cyan-950/30 px-2 py-0.5 text-[11px] text-cyan-300 hover:bg-cyan-900/40"
                >
                  Website ↗
                </a>
              )}
            </div>
            <p className="mt-2 text-sm text-neutral-400">{actor.blurb}</p>
            {actor.description && actor.description !== actor.blurb && (
              <p className="mt-2 text-[13px] leading-relaxed text-neutral-500">
                {actor.description}
              </p>
            )}
            <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-neutral-500">
              <span>
                <strong className="text-neutral-300">
                  {CATEGORY_LABEL[actor.category] ?? actor.category}
                </strong>
              </span>
              <span>
                Stage:{" "}
                <strong className="text-neutral-300">
                  {STAGE_LABEL[actor.stage] ?? actor.stage}
                </strong>
              </span>
              {actor.relevance != null && (
                <span>
                  Per-vision relevance:{" "}
                  <strong className="text-neutral-300 tabular-nums">
                    {Math.round(actor.relevance)} / 100
                  </strong>
                </span>
              )}
            </div>
          </div>
        </div>
      </header>

      {(actor.rationale || rationaleSources.length > 0) && (
        <section className="rounded-xl border border-cyan-900/40 bg-cyan-950/10 p-5">
          <div className="flex items-baseline justify-between gap-3">
            <p className="text-[10px] font-medium uppercase tracking-widest text-cyan-300">
              Why this actor matters here
            </p>
            {rationaleSources.length > 0 && (
              <SourceList sources={rationaleSources} />
            )}
          </div>
          {actor.rationale && (
            <p className="mt-2 text-sm leading-relaxed text-neutral-200">
              {actor.rationale}
            </p>
          )}
          {rationaleSources.length > 0 && (
            <p className="mt-2 text-[10px] text-neutral-500">
              {signals.length} signal{signals.length === 1 ? "" : "s"} tagged
              with this actor in the recent window — chip lists the 3 most
              recent.
            </p>
          )}
        </section>
      )}

      {heatmapItems.length > 0 && (
        <section className="rounded-xl border border-neutral-800 bg-neutral-900/40 p-5">
          <div className="mb-3 flex items-baseline justify-between gap-3">
            <h3 className="text-sm font-medium uppercase tracking-wider text-neutral-400">
              Capability heatmap
            </h3>
            <span className="text-[10px] text-neutral-600">
              recent signal volume per binding
            </span>
          </div>
          <CapabilityHeatmap items={heatmapItems} />
        </section>
      )}

      <section>
        <h3 className="mb-3 text-sm font-medium uppercase tracking-wider text-neutral-400">
          Active on capabilities
        </h3>
        {activeOn.length === 0 ? (
          <p className="text-xs text-neutral-500">
            No per-capability mapping yet — populated alongside capability seed
            in M45b.
          </p>
        ) : (
          <ul className="space-y-2 rounded-lg border border-neutral-800 bg-neutral-900/40 px-4 py-3">
            {activeOn.map((row) => (
              <li
                key={row.capability.key}
                className="flex items-baseline justify-between gap-3"
              >
                <a
                  href={`/visions/${slug}/capabilities/${row.capability.key}`}
                  className="text-sm text-neutral-200 hover:text-cyan-400 hover:underline"
                >
                  {row.capability.short_name || row.capability.name}
                </a>
                <ActorPill
                  actorKey={actor.actor_key}
                  name={"" /* role-only pill */}
                  role={row.role}
                />
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <div className="mb-3 flex items-baseline justify-between gap-3">
          <h3 className="text-sm font-medium uppercase tracking-wider text-neutral-400">
            Recent signals about this actor
          </h3>
          <span className="text-[10px] text-neutral-600">
            {signals.length} {signals.length === 1 ? "signal" : "signals"}
          </span>
        </div>
        {signals.length === 0 ? (
          <p className="rounded-xl border border-dashed border-neutral-800 bg-neutral-900/30 p-6 text-center text-xs text-neutral-500">
            No tagged signals yet. New signals appear here as the crawler
            (M48–M50) and SignalExtractor (M39+M45b) tag events with this
            actor.
          </p>
        ) : (
          <ol
            className="space-y-1 rounded-lg border border-neutral-800 bg-neutral-900/40 px-4 py-3"
            role="list"
          >
            {signals.map((s) => (
              <SignalRow
                key={s.id}
                kind={s.source_kind}
                title={s.title}
                summary={s.summary}
                capability={
                  s.capability_key
                    ? { key: s.capability_key, label: s.capability_key }
                    : null
                }
                deltaComposite={compositeDelta(s)}
                sourceUrl={s.source_url}
                citations={s.citations}
                publishedAt={s.published_at}
                highlighted={s.is_highlight}
                showSummary
              />
            ))}
          </ol>
        )}
      </section>
    </div>
  );
}
