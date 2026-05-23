/**
 * /visions/[slug]/actors — full per-vision actor list. M45a hero gates
 * the top-8; this page renders all, grouped by category (public_corp /
 * private_startup / govt_lab / national_lab / academic_lab /
 * standards_body / ngo) and sorted within category by relevance desc.
 *
 * M45b swaps the fixture for `fetchVisionOverview` + the dedicated
 * `actor.listForVision` tRPC query once seed data lands.
 */

import { ActorCard, type ActorCategory, type ActorStage } from "@platform/ui";
import { notFound } from "next/navigation";

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
  const fixture = getVisionFixture(slug);
  if (!fixture) notFound();
  const { actors } = fixture.overview;

  if (actors.length === 0) {
    return (
      <section className="rounded-xl border border-dashed border-neutral-800 bg-neutral-900/30 p-8 text-center">
        <p className="text-sm text-neutral-400">
          Actor curation lands alongside capability seed in{" "}
          <strong>M45b</strong>. Vision Builder agent (M41) also produces
          actor drafts.
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

  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-sm font-medium uppercase tracking-wider text-neutral-400">
          Actors — {actors.length} tracked
        </h2>
        <p className="mt-1 text-xs text-neutral-500">
          Companies + labs + standards bodies developing or influencing this
          vision's capabilities. Sorted by relevance within each category.
          Real-time data pipeline (M39+M45b) tags signals to these actors
          when extractor confidence ≥ 0.8.
        </p>
      </div>

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
