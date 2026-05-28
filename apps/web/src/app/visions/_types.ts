/**
 * Editorial overlay types for the vision pages.
 *
 * Today these arrive only via the legacy `_fixtures/` payloads (and
 * we hide the corresponding panels when no fixture is present —
 * F6/F7 made the rest of /visions DB-driven). When we add a DB-backed
 * source — most likely a Prisma model `InvestmentThesis` + `Catalyst`
 * filled by Vision Builder's LLM step or curated by the admin —
 * the tRPC response shape should match these interfaces verbatim so
 * the consuming panels (`InvestmentThesisPanel`, `CatalystsTimeline`)
 * don't need a second rewrite.
 */

import type { SourceRef } from "@platform/ui";

export interface ThesisBullet {
  text: string;
  sources?: SourceRef[];
}

export type ThesisBulletInput = string | ThesisBullet;

/** Investor-facing narrative — the bet, the bull case, the bear case,
 *  conviction. Manually authored for now; future Vision Builder slice
 *  drafts it from capability + risk + economics structure. */
export interface InvestmentThesis {
  the_bet: string;
  bull_case: ThesisBulletInput[];
  bear_case: ThesisBulletInput[];
  conviction: "high" | "medium" | "low" | "exploratory";
  last_reviewed: string;
}

/** Upcoming events that would move the score within ~6 months.
 *  Capability launches, regulatory decisions, actor milestones,
 *  fundraising windows. */
export interface Catalyst {
  id: string;
  expected_at: string;
  label: string;
  capability_key: string | null;
  side: "bull" | "bear" | "neutral";
  source_url?: string;
  note?: string;
  sources?: SourceRef[];
}
