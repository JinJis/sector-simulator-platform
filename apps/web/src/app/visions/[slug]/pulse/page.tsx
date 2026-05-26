/**
 * /visions/[slug]/pulse — merged Signals + Sources page.
 *
 * Part of the 8 → 4 sub-tab collapse. Composes the existing /signals
 * and /sources pages so each subsection has one source of truth. Both
 * source pages stay around as direct-link targets.
 *
 * MP6: the header now explains what Pulse *is* (sources → signals →
 * scores pipeline) and shows a SourceChip legend so users learn the
 * source_kind taxonomy from the page itself.
 *
 * Note: the embedded /signals filter form still posts to /signals
 * (its own action), so filter submits leave the merged page. Acceptable
 * for the IA reshuffle — bookmarked /pulse?cap=x URLs still hydrate
 * correctly on first paint via Next.js searchParams forwarding.
 */

import { SourceChip } from "@platform/ui";

import { getT } from "@/lib/i18n/server";

import SignalsIndexPage from "../signals/page";
import SourcesIndexPage from "../sources/page";

type SearchParams = {
  cap?: string;
  kind?: string;
  highlight?: string;
  cursor?: string;
};

interface Props {
  params: Promise<{ slug: string }>;
  searchParams: Promise<SearchParams>;
}

// Source-kind taxonomy rendered as a chip legend so a first-time
// reader of /pulse learns the colour code from one glance.
const KIND_LEGEND: Array<{ kind: string; label: string }> = [
  { kind: "paper", label: "Paper" },
  { kind: "patent", label: "Patent" },
  { kind: "news", label: "News" },
  { kind: "filing", label: "Filing" },
  { kind: "gov_report", label: "Gov report" },
  { kind: "press", label: "Press" },
  { kind: "analyst_report", label: "Analyst" },
  { kind: "research_brief", label: "Brief" },
];

export default async function PulsePage({ params, searchParams }: Props) {
  const t = await getT();
  const resolvedParams = await params;
  const resolvedSearch = await searchParams;
  const paramsPassthrough = Promise.resolve(resolvedParams);
  const searchPassthrough = Promise.resolve(resolvedSearch);

  return (
    <div className="space-y-10">
      <header className="rounded-xl border border-neutral-800 bg-neutral-900/40 p-5">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h1 className="text-lg font-semibold text-neutral-100">
            {t("subnav.pulse")}
          </h1>
          <span className="font-mono text-[10px] uppercase tracking-wider text-neutral-500">
            sources → signals → scores
          </span>
        </div>
        <p className="mt-2 text-xs leading-relaxed text-neutral-400">
          Pulse is the live stream of source-grounded events feeding this
          vision. Each row is one signal — a paper, patent, filing, press
          release, or news article — tagged to a capability, scored across
          the 4 dimensions, and (when confident) pinned to a specific
          actor. Click any source chip to land on the original document.
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <span className="text-[10px] uppercase tracking-wider text-neutral-500">
            Source kinds:
          </span>
          {KIND_LEGEND.map((k) => (
            <SourceChip
              key={k.kind}
              source={{ url: "#", title: k.label, kind: k.kind }}
              variant="labeled"
            />
          ))}
        </div>
      </header>

      <section>
        <h2 className="mb-4 text-sm font-medium uppercase tracking-wider text-neutral-400">
          Recent signals
        </h2>
        <SignalsIndexPage
          params={paramsPassthrough}
          searchParams={searchPassthrough}
        />
      </section>

      <section>
        <h2 className="mb-4 text-sm font-medium uppercase tracking-wider text-neutral-400">
          Source coverage
        </h2>
        <SourcesIndexPage params={Promise.resolve(resolvedParams)} />
      </section>
    </div>
  );
}
