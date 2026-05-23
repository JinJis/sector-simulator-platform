/**
 * Root home — M37 pivot redirect.
 *
 * Previously a rich editorial landing (sector cards + market feed + audit
 * + sparkline equity bundles). Per docs/PIVOT.md the default landing is
 * now the Vision Feasibility Monitor at /visions; the legacy editorial
 * content is investment-surface that archives behind
 * ENABLE_LEGACY_INVESTMENT_FEATURES at M43. Old content is preserved in
 * git history (see commit aa000a7 and earlier).
 *
 * Two legacy URL shapes still resolve here:
 *   - `/?sector=foo`              → `/sectors/foo`     (sector deep link)
 *   - `/?sector=foo&scenario=bar` → `/sectors/foo?scenario=bar`
 *
 * The `/sectors/*` URL family stays alive through M43 — this redirect
 * just retargets the *empty* `/` to the new landing.
 */

import { redirect } from "next/navigation";

interface SearchParams {
  sector?: string;
  scenario?: string;
}

export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const { sector, scenario } = await searchParams;
  if (sector) {
    const q = scenario ? `?scenario=${encodeURIComponent(scenario)}` : "";
    redirect(`/sectors/${encodeURIComponent(sector)}${q}`);
  }
  redirect("/visions");
}
