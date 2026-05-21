"use client";

import { GraphView } from "../../../graph-view";
import { useSector } from "../sector-context";

export default function SectorGraphPage() {
  const { meta, driverValues } = useSector();
  return <GraphView meta={meta} driverValues={driverValues} />;
}
