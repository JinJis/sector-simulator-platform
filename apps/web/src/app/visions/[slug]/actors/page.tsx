/**
 * /visions/[slug]/actors — full per-vision actor list. M45a hero gates
 * the top-8; this page renders all, grouped by category (public_corp /
 * private_startup / govt_lab / national_lab / academic_lab /
 * standards_body / ngo) and sorted within category by relevance desc.
 *
 * M45b swaps the fixture for `fetchVisionOverview` + the dedicated
 * `actor.listForVision` tRPC query once seed data lands.
 */

import {
  ActorCard,
  ActorRelevanceBubble,
  type ActorBubblePoint,
  type ActorBubbleStage,
  type ActorCategory,
  type ActorStage,
} from "@platform/ui";
import { notFound } from "next/navigation";

import { getT } from "@/lib/i18n/server";
import { trpc } from "@/lib/sim-client";

import { getVisionFixture } from "../../_fixtures";

interface Props {
  params: Promise<{ slug: string }>;
}

const CATEGORY_ORDER: ActorCategory[] = [
  "public_corp",
  "private_startup",
  "government_lab",
  "national_lab",
  "academic_lab",
  "standards_body",
  "ngo",
];

const CATEGORY_LABEL: Record<string, string> = {
  public_corp: "Public corporations",
  private_startup: "Private startups",
  government_lab: "Government labs / agencies",
  national_lab: "National labs",
  academic_lab: "Academic labs",
  standards_body: "Standards bodies",
  ngo: "NGOs / industry bodies",
};

export default async function ActorsIndexPage({ params }: Props) {
  const { slug } = await params;
  const t = await getT();

  // Try DB first via actor.listForVision; fall back to fixture if the
  // tRPC client can't reach sector-service. Maps the VisionActor join
  // shape into the same VisionActorInOverview shape the fixture provides.
  let actors: Array<{
    actor_key: string;
    name: string;
    short_name: string | null;
    iso_country: string;
    category: string;
    stage: string;
    blurb: string;
    ticker: string | null;
    exchange: string | null;
    logo_url: string | null;
    relevance: number | null;
    display_order: number;
  }>;
  try {
    const rows = await trpc.actor.listForVision.query({ sector_slug: slug });
    actors = rows.map((va) => ({
      actor_key: va.actor.key,
      name: va.actor.name,
      short_name: va.actor.short_name,
      iso_country: va.actor.iso_country,
      category: va.actor.category,
      stage: va.actor.stage,
      blurb: va.actor.blurb,
      ticker: va.actor.ticker,
      exchange: va.actor.exchange,
      logo_url: va.actor.logo_url,
      relevance: va.relevance,
      display_order: va.display_order,
    }));
  } catch {
    const fixture = getVisionFixture(slug);
    if (!fixture) notFound();
    actors = fixture.overview.actors;
  }

  // M53 — pull 90d signal counts per actor for the bubble plot.
  // Fail soft: chart hides itself when the query is empty.
  let signalCounts: Array<{
    actor_id: string;
    actor_key: string;
    actor_name: string;
    count: number;
  }> = [];
  try {
    signalCounts = await trpc.signal.countByActor.query({
      sector_slug: slug,
      days: 90,
    });
  } catch {
    signalCounts = [];
  }
  const countByActorKey = new Map(signalCounts.map((c) => [c.actor_key, c.count]));

  if (actors.length === 0) {
    return (
      <section className="rounded-xl border border-dashed border-neutral-800 bg-neutral-900/30 p-8 text-center">
        <p className="text-sm text-neutral-400">
          No actors curated for this vision yet — the Vision Builder
          agent produces actor drafts when a new vision is created.
        </p>
      </section>
    );
  }

  // Group by category, preserving CATEGORY_ORDER. Within each group,
  // sort by relevance desc then display_order asc.
  const grouped = new Map<string, typeof actors>();
  for (const a of actors) {
    const bucket = grouped.get(a.category) ?? [];
    bucket.push(a);
    grouped.set(a.category, bucket);
  }
  for (const [, bucket] of grouped) {
    bucket.sort((a, b) => {
      const ra = a.relevance ?? -1;
      const rb = b.relevance ?? -1;
      if (rb !== ra) return rb - ra;
      return a.display_order - b.display_order;
    });
  }

  // Derive bubble points: only actors with relevance + non-zero
  // signals make the chart legible. Empty → render an empty-state note.
  const bubblePoints: ActorBubblePoint[] = actors
    .filter((a) => a.relevance != null)
    .map((a) => ({
      actor_key: a.actor_key,
      label: a.short_name ?? a.name,
      relevance: a.relevance!,
      signal_count: countByActorKey.get(a.actor_key) ?? 0,
      stage: a.stage as ActorBubbleStage,
      category: a.category,
      href: `/visions/${slug}/actors/${a.actor_key}`,
    }));

  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-sm font-medium uppercase tracking-wider text-neutral-400">
          Actors — {actors.length} tracked
        </h2>
        <p className="mt-1 text-xs text-neutral-500">
          Companies + labs + standards bodies developing or influencing this
          vision's capabilities. Sorted by relevance within each category.
          The signal pipeline tags news / patents / papers to these actors
          when extractor confidence ≥ 0.8.
        </p>
      </div>

      {/* M53 — Actor relevance × signal-volume bubble plot. */}
      <section className="rounded-xl border border-neutral-800 bg-neutral-900/40 p-5">
        <div className="mb-1 flex items-baseline justify-between">
          <h3 className="text-sm font-medium uppercase tracking-wider text-neutral-400">
            {t("actors.bubble.title")}
          </h3>
          <span className="text-[10px] text-neutral-500">
            x relevance · y 90d signals · size stage · color category
          </span>
        </div>
        {bubblePoints.length === 0 || bubblePoints.every((p) => p.signal_count === 0) ? (
          <p className="text-xs text-neutral-500">{t("actors.bubble.empty")}</p>
        ) : (
          <ActorRelevanceBubble
            items={bubblePoints}
            width={720}
            height={320}
            className="w-full"
            ariaLabel="Actor relevance vs signal volume"
          />
        )}
      </section>

      {CATEGORY_ORDER.map((cat) => {
        const bucket = grouped.get(cat);
        if (!bucket || bucket.length === 0) return null;
        return (
          <section key={cat}>
            <h3 className="mb-3 text-[11px] font-medium uppercase tracking-widest text-neutral-500">
              {CATEGORY_LABEL[cat] ?? cat}
            </h3>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {bucket.map((a) => (
                <ActorCard
                  key={a.actor_key}
                  actorKey={a.actor_key}
                  name={a.name}
                  shortName={a.short_name}
                  isoCountry={a.iso_country}
                  category={a.category as ActorCategory}
                  stage={a.stage as ActorStage}
                  blurb={a.blurb}
                  ticker={a.ticker}
                  exchange={a.exchange}
                  logoUrl={a.logo_url}
                  relevance={a.relevance}
                  href={`/visions/${slug}/actors/${a.actor_key}`}
                />
              ))}
            </div>
          </section>
        );
      })}

      {/* Catch-all for unknown categories not in CATEGORY_ORDER */}
      {(() => {
        const known = new Set(CATEGORY_ORDER as string[]);
        const others = [...grouped.entries()].filter(([cat]) => !known.has(cat));
        if (others.length === 0) return null;
        return (
          <section>
            <h3 className="mb-3 text-[11px] font-medium uppercase tracking-widest text-neutral-500">
              Other
            </h3>
            {others.map(([cat, bucket]) => (
              <div key={cat} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                {bucket.map((a) => (
                  <ActorCard
                    key={a.actor_key}
                    actorKey={a.actor_key}
                    name={a.name}
                    shortName={a.short_name}
                    isoCountry={a.iso_country}
                    category={a.category as ActorCategory}
                    stage={a.stage as ActorStage}
                    blurb={a.blurb}
                    ticker={a.ticker}
                    exchange={a.exchange}
                    logoUrl={a.logo_url}
                    relevance={a.relevance}
                    href={`/visions/${slug}/actors/${a.actor_key}`}
                  />
                ))}
              </div>
            ))}
          </section>
        );
      })()}
    </div>
  );
}
