"use client";

import { ManualPanel } from "../../../manual-panel";
import { useSector } from "../sector-context";

export default function SectorManualPage() {
  const { meta, sensitivity, driverValues, setDriverValues, defaults } = useSector();
  return (
    <ManualPanel
      meta={meta}
      sensitivity={sensitivity}
      values={driverValues}
      onChangeValues={setDriverValues}
      defaults={defaults}
    />
  );
}
