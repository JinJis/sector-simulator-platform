/**
 * /visions — visual hub of all tracked technology visions.
 *
 * Top: filter chips by domain. Below: a hero ("Featured") tile of the
 * most-active vision + a grid of tiles for the rest. Each tile carries
 * a domain emoji + accent, big composite + trajectory arrow, and
 * activity badges (🔥 trending / ⚠ slowing) so the page reads as a
 * dashboard rather than a list.
 */

import { Breadcrumbs } from "@platform/ui";

import { listVisionFixtures } from "./_fixtures";

import { DomainFilter } from "./_components/domain-filter";
import { themeForVision } from "./_components/domain-theme";
import { VisionTile, type VisionTileData } from "./_components/vision-tile";

export const metadata = {
  title: "Visions — Vision Feasibility Monitor",
};

interface Props {
  searchParams: Promise<{ domain?: string }>;
}

export default async function VisionsIndexPage({ searchParams }: Props) {
  const { domain: activeDomainRaw } = await searchParams;
  const activeDomain = activeDomainRaw && activeDomainRaw !== "all" ? activeDomainRaw : null;
  const anchorYear = new Date().getFullYear();
  const fixtures = listVisionFixtures();

  // Project to tile data + resolve theme. We resolve theme once and
  // bucket by theme.key so the domain filter shows accurate counts.
  const tiles: Array<{ tile: VisionTileData; themeKey: string }> = fixtures.map((f) => {
    const v = f.overview.vision;
    const theme = themeForVision(null, v.slug);
    return {
      tile: {
        slug: v.slug,
        name: v.name,
        description: v.description,
        question: v.vision_question,
        domain_label: null,
        composite: v.feasibility?.composite ?? null,
        delta_90d: v.feasibility?.delta_90d ?? null,
        binding_capability_key: v.feasibility?.binding_capability_key ?? null,
        eta_median_years: v.feasibility?.eta_median_years ?? null,
        capability_count: v.capability_count,
        signal_count_30d: v.signal_count_30d,
        anchorYear,
      },
      themeKey: theme.key,
    };
  });

  const countsByDomain: Record<string, number> = {};
  for (const { themeKey } of tiles) {
    countsByDomain[themeKey] = (countsByDomain[themeKey] ?? 0) + 1;
  }

  const filtered = activeDomain
    ? tiles.filter((t) => t.themeKey === activeDomain)
    : tiles;

  // Featured = highest 30d signal count among filtered. Ties → highest composite.
  const featured = [...filtered].sort((a, b) => {
    const sa = a.tile.signal_count_30d;
    const sb = b.tile.signal_count_30d;
    if (sa !== sb) return sb - sa;
    return (b.tile.composite ?? 0) - (a.tile.composite ?? 0);
  })[0];
  const rest = featured ? filtered.filter((t) => t.tile.slug !== featured.tile.slug) : filtered;

  return (
    <main className="mx-auto min-h-screen max-w-7xl px-6 pb-16 pt-6">
      <Breadcrumbs className="mb-3" items={[{ label: "Visions" }]} />

      <header className="mb-7 flex flex-col gap-2">
        <div className="flex items-baseline gap-2">
          <h1 className="text-3xl font-bold tracking-tight text-neutral-50">
            Visions
          </h1>
          <span className="rounded-full border border-emerald-700/40 bg-emerald-950/40 px-2 py-0.5 text-[10px] uppercase tracking-wider text-emerald-300">
            ● Live
          </span>
        </div>
        <p className="max-w-3xl text-[13px] leading-relaxed text-neutral-400">
          Bold technology questions, scored 0–100 by source-grounded signals
          (papers · patents · news · filings). Each vision decomposes into
          capabilities — when the data moves, the feasibility score moves with
          it.
        </p>
      </header>

      <section className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <DomainFilter
          activeDomain={activeDomain}
          countsByDomain={countsByDomain}
          totalCount={tiles.length}
        />
      </section>

      {filtered.length === 0 && (
        <p className="rounded-2xl border border-dashed border-neutral-800 bg-neutral-950/40 p-10 text-center text-[13px] text-neutral-500">
          No visions in this domain yet — try a different filter.
        </p>
      )}

      {featured && (
        <section className="mb-8">
          <p className="mb-3 flex items-center gap-2 text-[11px] uppercase tracking-wider text-neutral-500">
            <span className="text-amber-400">★</span> Featured · most active
          </p>
          <div className="grid gap-5">
            <VisionTile data={featured.tile} featured />
          </div>
        </section>
      )}

      {rest.length > 0 && (
        <section>
          {featured && (
            <p className="mb-3 text-[11px] uppercase tracking-wider text-neutral-500">
              All visions
            </p>
          )}
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {rest.map(({ tile }) => (
              <VisionTile key={tile.slug} data={tile} />
            ))}
          </div>
        </section>
      )}

      <p className="mt-10 text-[11px] text-neutral-600">
        Fixture-backed preview. Signal ingest cron updates capability scores
        from arXiv + USPTO + news daily.
      </p>
    </main>
  );
}

