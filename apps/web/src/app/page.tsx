import { redirect } from "next/navigation";

interface SearchParams {
  sector?: string;
  scenario?: string;
}

/**
 * Legacy URL handler. The workspace used to live at `/?sector=<slug>` with
 * the tab strip rendered inline. Phase 2.5 IA slice 2 moved each tab to its
 * own route under `/sectors/<slug>/{live,manual,graph,sources}` — this
 * redirect keeps old bookmarks and external share links working.
 *
 *   /                          → /sectors
 *   /?sector=<slug>            → /sectors/<slug>
 *   /?sector=<slug>&scenario=X → /sectors/<slug>?scenario=X
 */
export default async function LegacyRootRedirect({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const { sector, scenario } = await searchParams;
  if (sector) {
    const q = scenario ? `?scenario=${encodeURIComponent(scenario)}` : "";
    redirect(`/sectors/${encodeURIComponent(sector)}${q}`);
  }
  redirect("/sectors");
}
