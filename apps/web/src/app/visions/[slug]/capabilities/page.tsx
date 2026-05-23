/**
 * /visions/[slug]/capabilities — full capability list with 4-dim
 * breakdowns. M37 ships the same cards as the Overview (denser layout);
 * M38 swaps the data source to DB and adds the capability detail
 * drill-down at /capabilities/[key].
 */

import { CapabilityCard } from "@platform/ui";
import { notFound } from "next/navigation";

import { getVisionFixture } from "../../_fixtures";

interface Props {
  params: Promise<{ slug: string }>;
}

export default async function CapabilitiesIndexPage({ params }: Props) {
  const { slug } = await params;
  const fixture = getVisionFixture(slug);
  if (!fixture) notFound();
  const { capabilities } = fixture.overview;

  if (capabilities.length === 0) {
    return (
      <section className="rounded-xl border border-dashed border-neutral-800 bg-neutral-900/30 p-8 text-center">
        <p className="text-sm text-neutral-400">
          Capability decomposition lands in <strong>M38</strong>.
        </p>
      </section>
    );
  }

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-sm font-medium uppercase tracking-wider text-neutral-400">
          All capabilities
        </h2>
        <p className="mt-1 text-xs text-neutral-500">
          Sorted by display order. Click a card to drill into the 4-dimension
          score breakdown + dependency graph (M38).
        </p>
      </div>
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {capabilities.map((c) => {
          const lsDir =
            c.latest_signal?.delta_composite == null
              ? undefined
              : c.latest_signal.delta_composite > 0
              ? ("up" as const)
              : c.latest_signal.delta_composite < 0
              ? ("down" as const)
              : ("neutral" as const);
          return (
            <CapabilityCard
              key={c.key}
              capabilityKey={c.key}
              shortName={c.short_name}
              name={c.name}
              composite={c.current_score?.composite ?? null}
              delta={null}
              isBinding={c.is_binding}
              technical={c.current_score?.technical ?? null}
              economic={c.current_score?.economic ?? null}
              regulatory={c.current_score?.regulatory ?? null}
              supply={c.current_score?.supply ?? null}
              latestSignal={
                c.latest_signal
                  ? { title: c.latest_signal.title, direction: lsDir }
                  : null
              }
              href={`/visions/${slug}/capabilities/${c.key}`}
            />
          );
        })}
      </div>
    </div>
  );
}
