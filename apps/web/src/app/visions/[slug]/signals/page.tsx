/**
 * /visions/[slug]/signals — chronological signal feed. M37 ships the
 * fixture's recent_signals list rendered as SignalRow's; M39 wires the
 * full ingest pipeline + capability/dim/source/sentiment filters +
 * cursor pagination.
 */

import { SignalRow, type SignalKind } from "@platform/ui";
import { notFound } from "next/navigation";

import { getVisionFixture } from "../../_fixtures";

interface Props {
  params: Promise<{ slug: string }>;
}

export default async function SignalsIndexPage({ params }: Props) {
  const { slug } = await params;
  const fixture = getVisionFixture(slug);
  if (!fixture) notFound();
  const { recent_signals } = fixture.overview;

  if (recent_signals.length === 0) {
    return (
      <section className="rounded-xl border border-dashed border-neutral-800 bg-neutral-900/30 p-8 text-center">
        <p className="text-sm text-neutral-400">
          The signal pipeline (arXiv / patents / news) lands in{" "}
          <strong>M39</strong>. Capability score updates flow from this
          feed.
        </p>
      </section>
    );
  }

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-sm font-medium uppercase tracking-wider text-neutral-400">
          Signal feed
        </h2>
        <p className="mt-1 text-xs text-neutral-500">
          {recent_signals.length} most recent. Filtering + pagination land in
          M39 once the ingest pipeline is online.
        </p>
      </div>
      <div className="rounded-lg border border-neutral-800 bg-neutral-900/40 px-4 py-2" role="list">
        {recent_signals.map((s) => {
          const deltaComposite = [
            s.delta_technical,
            s.delta_economic,
            s.delta_regulatory,
            s.delta_supply,
          ]
            .filter((v): v is number => v != null)
            .reduce<number | null>(
              (best, v) =>
                best === null || Math.abs(v) > Math.abs(best) ? v : best,
              null,
            );
          return (
            <SignalRow
              key={s.id}
              kind={s.source_kind as SignalKind}
              title={s.title}
              summary={s.summary}
              capability={
                s.capability_key
                  ? { key: s.capability_key, label: s.capability_key }
                  : null
              }
              deltaComposite={deltaComposite}
              sourceUrl={s.source_url}
              publishedAt={s.published_at}
              highlighted={s.is_highlight}
              showSummary
            />
          );
        })}
      </div>
    </div>
  );
}
