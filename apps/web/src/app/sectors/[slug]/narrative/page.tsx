"use client";

import { PageIntent } from "../../../page-intent";
import { SECTOR_PAGE_INTENTS } from "../../../page-intents";

import { NarrativeView } from "./narrative-view";

export default function SectorNarrativePage() {
  return (
    <div>
      <PageIntent intent={SECTOR_PAGE_INTENTS.narrative!} />
      <NarrativeView />
    </div>
  );
}
