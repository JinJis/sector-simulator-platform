/**
 * /visions/[slug]/sources — provenance index. M37 stub; M39 wires the
 * actual aggregated source list across signals + capability rationales.
 */

import { notFound } from "next/navigation";

import { getVisionFixture } from "../../_fixtures";

interface Props {
  params: Promise<{ slug: string }>;
}

export default async function SourcesIndexPage({ params }: Props) {
  const { slug } = await params;
  const fixture = getVisionFixture(slug);
  if (!fixture) notFound();
  const { recent_signals } = fixture.overview;

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-sm font-medium uppercase tracking-wider text-neutral-400">
          Sources
        </h2>
        <p className="mt-1 text-xs text-neutral-500">
          Every number on this Vision page is source-grounded. The full
          aggregated index (papers / patents / news / filings / gov
          reports / vendor docs / datasets) lands with M39 signal ingest.
          For now, here are the sources behind the recent signals.
        </p>
      </div>
      {recent_signals.length === 0 ? (
        <section className="rounded-xl border border-dashed border-neutral-800 bg-neutral-900/30 p-8 text-center">
          <p className="text-sm text-neutral-400">
            Source aggregation lands in <strong>M39</strong>.
          </p>
        </section>
      ) : (
        <ul className="space-y-2 rounded-lg border border-neutral-800 bg-neutral-900/40 px-4 py-3">
          {recent_signals.map((s) => (
            <li key={s.id} className="text-sm">
              <span className="mr-2 inline-block w-16 rounded-sm border border-neutral-800 px-1.5 py-0.5 text-center text-[10px] uppercase tracking-wider text-neutral-400">
                {s.source_kind}
              </span>
              <a
                href={s.source_url}
                target="_blank"
                rel="noreferrer"
                className="text-neutral-200 hover:text-cyan-400 hover:underline"
              >
                {s.title}
              </a>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
