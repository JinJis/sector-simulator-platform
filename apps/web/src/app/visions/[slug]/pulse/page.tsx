/**
 * /visions/[slug]/pulse — merged Signals + Sources page.
 *
 * Part of the 8 → 4 sub-tab collapse. Composes the existing /signals
 * and /sources pages so each subsection has one source of truth. Both
 * source pages stay around as direct-link targets.
 *
 * Note: the embedded /signals filter form still posts to /signals
 * (its own action), so filter submits leave the merged page. Acceptable
 * for the IA reshuffle — bookmarked /pulse?cap=x URLs still hydrate
 * correctly on first paint via Next.js searchParams forwarding.
 */

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

export default async function PulsePage({ params, searchParams }: Props) {
  const t = await getT();
  const resolvedParams = await params;
  const resolvedSearch = await searchParams;
  const paramsPassthrough = Promise.resolve(resolvedParams);
  const searchPassthrough = Promise.resolve(resolvedSearch);

  return (
    <div className="space-y-10">
      <header>
        <h1 className="text-lg font-semibold text-neutral-100">
          {t("subnav.pulse")}
        </h1>
        <p className="mt-1 text-xs text-neutral-500">
          Live signal stream + source coverage.
        </p>
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
