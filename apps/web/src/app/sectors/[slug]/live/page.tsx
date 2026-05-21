"use client";

import { LiveDashboard } from "../../../live-dashboard";
import { PageIntent } from "../../../page-intent";
import { SECTOR_PAGE_INTENTS } from "../../../page-intents";
import { useSector } from "../sector-context";

export default function SectorLivePage() {
  const { meta, sensitivity, initialLive } = useSector();
  return (
    <div>
      <PageIntent intent={SECTOR_PAGE_INTENTS.live!} />
      <LiveDashboard meta={meta} sensitivity={sensitivity} initial={initialLive} />
    </div>
  );
}
