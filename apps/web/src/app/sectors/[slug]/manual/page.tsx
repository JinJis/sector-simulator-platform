"use client";

import { ManualPanel } from "../../../manual-panel";
import { PageIntent } from "../../../page-intent";
import { SECTOR_PAGE_INTENTS } from "../../../page-intents";
import { useSector } from "../sector-context";

export default function SectorManualPage() {
  const { meta, sensitivity, driverValues, setDriverValues, defaults } = useSector();
  return (
    <div>
      <PageIntent intent={SECTOR_PAGE_INTENTS.manual!} />
      <ManualPanel
        meta={meta}
        sensitivity={sensitivity}
        values={driverValues}
        onChangeValues={setDriverValues}
        defaults={defaults}
      />
    </div>
  );
}
