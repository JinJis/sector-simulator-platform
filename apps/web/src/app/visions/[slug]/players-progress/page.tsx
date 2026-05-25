/**
 * /visions/[slug]/players-progress — merged Capabilities + Actors page.
 *
 * Part of the 8 → 4 sub-tab collapse. Composes the existing
 * /capabilities and /actors pages so there is one source of truth for
 * each subsection's body. Both source pages stay around as
 * direct-link targets.
 */

import { getT } from "@/lib/i18n/server";

import ActorsIndexPage from "../actors/page";
import CapabilitiesIndexPage from "../capabilities/page";

interface Props {
  params: Promise<{ slug: string }>;
}

export default async function PlayersProgressPage({ params }: Props) {
  const t = await getT();
  // Both child pages await params again — Promise.resolve so the same
  // value flows through twice without exhausting a one-shot Promise.
  const resolved = await params;
  const passthrough = Promise.resolve(resolved);

  return (
    <div className="space-y-10">
      <header>
        <h1 className="text-lg font-semibold text-neutral-100">
          {t("subnav.players-progress")}
        </h1>
        <p className="mt-1 text-xs text-neutral-500">
          Capability tree + actors driving each.
        </p>
      </header>

      <section>
        <h2 className="mb-4 text-sm font-medium uppercase tracking-wider text-neutral-400">
          Capabilities
        </h2>
        <CapabilitiesIndexPage params={passthrough} />
      </section>

      <section>
        <h2 className="mb-4 text-sm font-medium uppercase tracking-wider text-neutral-400">
          Actors
        </h2>
        <ActorsIndexPage params={passthrough} />
      </section>
    </div>
  );
}
