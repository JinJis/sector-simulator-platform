/**
 * /visions — landing grid of vision tiles. The M37 entry point for the
 * Vision Feasibility Monitor. Fixture-backed; M38c will swap to
 * `fetchVisions()` against the real DB.
 */

import { Breadcrumbs, VisionCard } from "@platform/ui";

import { listVisionFixtures } from "./_fixtures";

export const metadata = {
  title: "Visions — Vision Feasibility Monitor",
};

export default function VisionsIndexPage() {
  const fixtures = listVisionFixtures();
  const anchorYear = new Date().getFullYear();

  return (
    <main className="mx-auto min-h-screen max-w-7xl px-6 pb-16 pt-6">
      <Breadcrumbs className="mb-3" items={[{ label: "Visions" }]} />
      <header className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight text-neutral-50">
          Visions
        </h1>
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-neutral-400">
          Bold technology questions, with a live readout of how close each one
          is to reality. Each vision decomposes into capabilities (technical
          / economic / regulatory / supply) and is moved by source-grounded
          signals (papers, patents, news, filings) as they arrive.
        </p>
      </header>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {fixtures.map((f) => {
          const v = f.overview.vision;
          return (
            <VisionCard
              key={v.slug}
              slug={v.slug}
              name={v.name}
              question={v.vision_question}
              composite={v.feasibility?.composite ?? null}
              delta90d={v.feasibility?.delta_90d ?? null}
              capabilityCount={v.capability_count}
              signalCount30d={v.signal_count_30d}
              trajectory={f.trajectory}
              etaMedianYears={v.feasibility?.eta_median_years ?? null}
              anchorYear={anchorYear}
              href={`/visions/${v.slug}`}
            />
          );
        })}
      </div>

      <p className="mt-8 text-xs text-neutral-500">
        Fixture-backed preview (M37). Capability scores update from arXiv +
        patents + news once the M39 ingest pipeline lands.
      </p>
    </main>
  );
}
