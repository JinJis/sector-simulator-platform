"use client";

import { SourcesView } from "../../../sources-view";
import { useSector } from "../sector-context";

export default function SectorSourcesPage() {
  const { meta } = useSector();
  return <SourcesView meta={meta} />;
}
