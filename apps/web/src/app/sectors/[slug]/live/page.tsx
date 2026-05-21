"use client";

import { LiveDashboard } from "../../../live-dashboard";
import { useSector } from "../sector-context";

export default function SectorLivePage() {
  const { meta, sensitivity, initialLive } = useSector();
  return <LiveDashboard meta={meta} sensitivity={sensitivity} initial={initialLive} />;
}
