/**
 * /visions/[slug]/risks — full risk board. M37 ships the same rows as
 * the Overview; M38 adds severity × likelihood matrix + mitigation
 * details.
 */

import { RiskRow, type RiskSeverity } from "@platform/ui";
import { notFound } from "next/navigation";

import { getVisionFixture } from "../../_fixtures";

interface Props {
  params: Promise<{ slug: string }>;
}

export default async function RisksIndexPage({ params }: Props) {
  const { slug } = await params;
  const fixture = getVisionFixture(slug);
  if (!fixture) notFound();
  const { risks } = fixture.overview;

  if (risks.length === 0) {
    return (
      <section className="rounded-xl border border-dashed border-neutral-800 bg-neutral-900/30 p-8 text-center">
        <p className="text-sm text-neutral-400">
          Risk curation lands with capability decomposition in{" "}
          <strong>M38</strong>.
        </p>
      </section>
    );
  }

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-sm font-medium uppercase tracking-wider text-neutral-400">
          Risk board
        </h2>
        <p className="mt-1 text-xs text-neutral-500">
          {risks.length} active. Severity × likelihood matrix + mitigation
          drill-down land in M38.
        </p>
      </div>
      <div className="rounded-lg border border-neutral-800 bg-neutral-900/40 px-4 py-2" role="list">
        {risks.map((r) => (
          <RiskRow
            key={r.key}
            category={r.category}
            name={r.name}
            description={r.description}
            severity={r.severity as RiskSeverity}
            likelihood={r.likelihood as "low" | "medium" | "high"}
            timeHorizon={r.time_horizon}
          />
        ))}
      </div>
    </div>
  );
}
