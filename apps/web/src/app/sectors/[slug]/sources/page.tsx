"use client";

import { PageIntent } from "../../../page-intent";
import { SECTOR_PAGE_INTENTS } from "../../../page-intents";
import { SourcesView } from "../../../sources-view";
import { useSector } from "../sector-context";

export default function SectorSourcesPage() {
  const { meta } = useSector();
  return (
    <div>
      <PageIntent intent={SECTOR_PAGE_INTENTS.sources!} />
      <SourcesView meta={meta} />
    </div>
  );
}
