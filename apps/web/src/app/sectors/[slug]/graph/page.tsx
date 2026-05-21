"use client";

import { GraphView } from "../../../graph-view";
import { PageIntent } from "../../../page-intent";
import { SECTOR_PAGE_INTENTS } from "../../../page-intents";
import { useSector } from "../sector-context";

export default function SectorGraphPage() {
  const { meta, driverValues } = useSector();
  return (
    <div>
      <PageIntent intent={SECTOR_PAGE_INTENTS.graph!} />
      <GraphView meta={meta} driverValues={driverValues} />
    </div>
  );
}
