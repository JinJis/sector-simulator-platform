# Current task — Phase 4: Real-time Intelligence (M48+)

**Last updated**: 2026-05-25. Phase 4 starts now. Phase 3 (the pivot
from Sector Simulator → Vision Feasibility Monitor) is shipped; the
data-model + scoring-engine + community-proposal foundations it left
behind are what Phase 4 builds on. Phase 3 history lives in git log.

Design ground-truth for this phase:
[docs/architecture/composition.md](../architecture/composition.md).
That doc has the per-surface fetcher map, the signal → insight → score
pipeline, the bot proposal flow, the UX transparency rules, and the
two additive tables (`CrawlRun`, `EconomicsDatapoint`).

---

## Phase 4 goal

> Every vision is a living thing. Real internet data flows in
> continuously, the user *sees* it flowing, every score number traces
> back to its sources, and when new entities show up the bot proposes
> them so the community can vote.

Six product-level outcomes Phase 4 ships:

1. A standalone **crawler service** (Docker) that runs continuously,
   per-surface fetchers, and the Gemini Deep Research Agent.
2. **8-surface coverage** — every vision sub-tab (overview /
   capabilities / actors / signals / risks / economics / playground /
   sources) has a real-time data path or is derived from one.
3. **Bot-authored proposals** for newly discovered actors /
   capabilities / risks / sources, voted on by users via the existing
   `CommunityProposal` flow.
4. **Live Pulse UX** — every surface advertises its sync state; every
   number has a "why" drawer; the Hero has a real-time ingest ticker.
5. **Admin Crawler Cockpit** — one page covering live jobs, health,
   bot proposal queue, and per-vision schedule.
6. **4 visions fully seeded** (Space Data Centers, Fusion Power,
   Memory Semiconductors, SOFC) with capabilities, actors, signals,
   risks, economics, and source URLs.

---

## Milestones

```
M48 ──► M49a ──► M49b ──► [MP1✅ ─► MP2✅ ─► MP3✅ ─► MP4✅ ─► MP5✅ ─► MP6 ─► MP7]
 │        │        │       │
 │        │        │       └─► M49c ─► M49d ─► M49f ─► M50 ─► M52 ─► M53 ─► M54
 │        │        │
 │        │        └─ ActorFetcher (per-actor 90-day DR → actor-tagged Signal)
 │        └─ CapabilityFetcher (per-cap DR → SignalExtractor → Signal)
 └─ Crawler service Docker + Deep Research wrapper
```

Product Polish (MP1–MP7) — inserted between M49b and M49c on
2026-05-26 after end-to-end UX review. Foundations from M48/M49a/M49b
gave us actor + capability data flowing; before finishing the rest of
the per-surface fetchers and the bot, we ship one cycle of polish so
the product is demo-able and source-grounded on the 4 seed visions.
Then we resume M49c/d/f → M50 → M52 → M53/M54 to make that polished
state self-sustaining.

Estimated total: ~7–9 weeks at 1-person pace (was 7–9; Product Polish
+2–3 weeks but compresses M51 + parts of M53/M54). Each milestone is
independently mergeable behind feature flags; the crawler service
starts dormant and is enabled per-vision once its fetcher pack lands.

### M48 — Crawler service + Deep Research foundation  (5–7d)

New Docker service. The substrate for everything else.

- New `services/crawler/` (FastAPI + asyncio worker, same pattern as
  `data-pipeline/`). Docker image: `infra/docker/crawler.Dockerfile`.
  Added to `docker-compose.yml` (always-on) and
  `docker-compose.local.yml` (hot reload).
- Job queue: Redis Streams (already in compose). Worker pulls
  `crawl.queue`, writes `crawl.events` for the admin cockpit to tail.
- `packages/agent-tools/deep_research.py` — async client around
  `google-genai` Interactions API, `deep-research-preview-04-2026` +
  `deep-research-max-preview-04-2026`. `collaborative_planning` flag
  surfaced. 30d cache by `hash(prompt, surface, vision_slug)`. Cost
  metering goes into the same LLMClient meter as opus/sonnet/haiku.
- `CrawlRun` Prisma model + tRPC `crawler.runs.list` /
  `crawler.runs.get` (read-only, admin-scoped).
- Single end-to-end smoke fetcher (`HelloWorldFetcher`) that hits
  Deep Research, writes a `CrawlRun` row, and surfaces in a stub
  `/admin/crawler` page — proves the seam end-to-end.

**verify**: docker compose up → admin triggers HelloWorld fetcher →
CrawlRun row appears with cost_usd > 0 and a Deep Research summary.

### M49 — Per-surface fetcher set + Orchestrator  (8–10d)

The 5 fetcher classes from composition.md §3, plus the orchestrator
that chooses which one to run.

- ✅ M49a — `services/crawler/fetchers/capability.py` — per binding
  capability per dim, Deep Research prompt template, writes `Signal`
  rows that ripple through existing M40 ScoreUpdater.
- ✅ M49b — `services/crawler/fetchers/actor.py` — per-actor 90-day
  Deep Research synthesis anchored on the actor's top CapabilityActor
  binding; writes one actor_id-tagged `Signal` per actor per UTC day
  (day-bucketed pseudo-URL dedup). Ungated keyword scan for new
  org names (feeds M50 EntityDetector) lands with M50.
- `services/crawler/fetchers/signal.py` — extends M39 arXiv / USPTO /
  NewsAPI sweeps with the new orchestrator-driven cadence.
- `services/crawler/fetchers/risk.py` — regulatory keyword + safety
  event watch; uses curated risk-keyword sets per vision.
- `services/crawler/fetchers/economics.py` — analyst report + paper
  benchmark extraction; writes new `EconomicsDatapoint` rows.
- `services/crawler/orchestrator.py` — ranking score from
  composition.md §4 (binding × stale × pinned − cost), per-vision
  $/day cap, picks top-K each tick.
- `EconomicsDatapoint` Prisma model + migration. `economics` tRPC
  router (list / latest-per-metric).
- Cron in `services/crawler/main.py` ticks the orchestrator every
  15min; manual `/admin/crawler/runs?vision=...&fetcher=...&run=now`.

**verify**: enable the 5 fetchers on Space Data Centers → 24h later,
`Signal` table has fresh rows tagged from each fetcher, capability
scores have moved, `EconomicsDatapoint` has at least one cost-curve
point, cost stays under $2 for the day.

---

## Product Polish (MP1–MP7) — UX + source-grounding sprint

Inserted between M49b and M49c on 2026-05-26 after end-to-end review.
The crawler foundation (M48 + M49a + M49b) is in place; the user-facing
surface still has gaps that block demo + adoption. Each MP slice is
one PR, verified live before the next starts. MP5 pulls forward
M49e's `EconomicsDatapoint` model. MP1+MP2+MP3+MP4+MP6 collectively
replace most of M51 (Live Pulse UX + source-grounded transparency).

### MP1 — Source-link design system + Signal mock seed  (2–3d) ✅

Builds the shared transparency primitive every other polish slice
reuses, plus enough seed data that the Pulse / signal feeds stop
looking empty on a fresh `db:reset`. Shipped 2026-05-26: ~82 signals
across the 4 visions with real clickable URLs; `SourceChip` /
`SourceList` live in `@platform/ui`; `pnpm db:seed:all` orchestrates
sectors → visions → actors → signals in one command.

- `packages/ui/src/source-chip/` — `<SourceChip>` (small 🔗 glyph,
  source_kind color, hover popover showing kind · title · published_at,
  click opens `source_url` in new tab) + `<SourceList>` (multi-source
  hover popover used by MP2/MP4 thesis + risk bullets).
- Wire `SignalRow` to use `SourceChip` instead of raw `<a>`.
- New `packages/db/prisma/seed-signals.ts` — per-vision 20–30 realistic
  Signal rows: mixed `source_kind` (paper / patent / news / filing /
  gov_report), **real URLs** (arxiv.org/abs/…, patents.uspto.gov/…,
  sec.gov/…, real press releases — clickable to actual content),
  per-dim deltas in -10..+10, `is_highlight` on ~20%, `actor_id` set
  where the source ties to a seeded actor, `capability_id` always set,
  `published_at` spread over the last 90 days.
- Register the seed in `packages/db/prisma/seed.ts` so `pnpm seed`
  populates signals on every reset.

**verify**: `pnpm db:reset && pnpm seed` → `/visions/space-data-center/pulse`
shows ≥20 signals with working source chips that open real arxiv /
news pages; Overview "Live Signals" band populated; SignalRow source
icon hover shows the source_kind label.

### MP2 — Investment Thesis sources + Catalysts filters  (2d) ✅

Shipped 2026-05-26: `ThesisBullet { text, sources? }` fixture type;
all 4 visions have thesis + catalysts populated with real public
URLs (SpaceX / NASA / FCC / Lloyd's / CFS / DOE / Helion / NVIDIA /
TrendForce / Bloom / FERC / arXiv). `InvestmentThesisPanel` renders
`<SourceList>` chips per bullet (hover → list, click → real source).
`CatalystsTimeline` converted to client component with segmented
control (Latest · 1m · 3m · 6m · 1y) and refresh button wired to
`router.refresh()`.

- Extend the `InvestmentThesis` fixture type so each `bull_case` /
  `bear_case` bullet is `{ text, sources: [{ url, title, kind }] }`
  instead of plain string. Migrate all 4 vision fixtures.
- `InvestmentThesisPanel` renders a `<SourceList>` chip next to each
  bullet (hover → list, click → open). Empty `sources` → no chip.
- `CatalystsTimeline` — add segmented control with 5 buttons (Latest ·
  1m · 3m · 6m · 1y) that filters by `expected_at` window. "Latest" =
  upcoming + last 7d. Add a refresh icon button that re-fetches the
  underlying catalyst list (tRPC `vision.getOverview` for now; once
  M50 lands the bot may push new catalysts).
- All thesis source URLs in the 4 seed visions point to real,
  clickable analyst / press / paper pages.

**verify**: hover any thesis bullet → source list appears; click a
source → real page opens; switch Catalysts filter to "1m" → only
events within ±1 month visible.

### MP3 — Actor detail: signal feed + visuals + sources  (3d) ✅

Shipped 2026-05-26: `signal.list` accepts optional `actor_key` and
resolves it to `actor_id` (mirrors the `capability_key` path). The
actor detail page now composes `vision.getOverview` + `actor.get` +
`signal.list({actor_key})` so it surfaces logo / name_local / website
+ a Recent Signals feed with `SourceChip` per row + a new
`CapabilityHeatmap` (in `@platform/ui`) bucketing those signals by
binding capability with role-tinted bars. "Why this actor matters
here" gets a `SourceList` chip wired to the top 3 most-recent
tagged signals.

- New tRPC `signal.listForActor(sector_slug, actor_key, limit?, cursor?)`
  on `services/sector-service/src/trpc/signal.ts`. Same shape as
  `signal.list` but pre-joined on `actor_id`.
- `apps/web/src/app/visions/[slug]/actors/[key]/page.tsx` — replace
  the M39 stub at L196 with the real feed using `SignalRow` +
  `SourceChip`.
- Add a small Capability heatmap to the actor detail: bar per
  CapabilityActor binding, height = 90-day signal count for that
  (actor × capability) pair. Click bar → jump to that capability detail.
- Render `actor.website` + `actor.logo_url` + `actor.name_local`
  fields that exist but were never surfaced.
- "Why this actor matters here" gets a `<SourceList>` chip when the
  rationale links to one or more supporting signals — derive from the
  top 3 signals tagged with this actor in the last 30d.

**verify**: open `/visions/space-data-center/actors/spacex` → recent
signals list renders with source chips, capability heatmap shows
non-zero bars, "why this matters" chip opens 3 source links.

### MP4 — Risk Board source attribution + matrix  (2–3d) ✅

Shipped 2026-05-26: additive migration `risk_source_attribution`
adds `source_url`, `source_kind`, `source_title` on `Risk`. All 17
seeded risks across the 4 visions backfilled with real public URLs
(DDTC / ESA Space Debris / Lloyd's / ITU / Commerce / IAEA / DOE /
NRC / AMSC / IEA / BIS / EPA / arXiv / patents). tRPC `risk.*` +
`vision.getOverview` carry the new fields. `<RiskRow>` renders a
`<SourceChip>` next to severity when present. New `<RiskMatrix>`
component (severity × likelihood 4×3 grid, severity×likelihood-tinted
cells, hover ring) embedded at the top of `/visions/[slug]/risks`;
the page itself now reads from `trpc.risk.list` with fixture as
fallback.

- Schema migration: additive `source_url String?`, `source_kind
  String?`, `source_title String?` on `Risk`. One migration.
- `seed-visions.ts` updated to populate source fields on every seeded
  risk (real regulatory filings, accident reports, supply news).
- `RiskRow` renders a `SourceChip` when `source_url` is set.
- New `<RiskMatrix>` component in `packages/ui` — Severity × Likelihood
  grid (5×3), cell colored by aggregate `severity` of risks landing
  in that cell, click a cell → drawer with the underlying risks.
  Embedded at the top of `/visions/[slug]/risks` and (small variant)
  on Overview's Risk Board band.

**verify**: `/visions/space-data-center/risks` → matrix renders, every
risk row has a working source chip; clicking a matrix cell opens the
right subset.

### MP5 — Economics tab build-out (+ pull EconomicsDatapoint forward)  (3–4d) ✅

Shipped 2026-05-26: `EconomicsDatapoint` Prisma model + migration
`economics_datapoints` (composition.md §10 spec). New `economics.*`
tRPC router (`list` + `latestPerMetric` via raw `DISTINCT ON`).
`seed-economics.ts` writes **57 datapoints across 4 visions × 2
metrics each** (real source URLs — IEA / Lazard / EIA / DOE / IRENA /
TrendForce / SIA / Bloom Energy / Helion / CFS). New `seed:economics`
+ `db:seed:economics` scripts; `db:seed:all` extended.

`/visions/[slug]/economics` becomes a full page: paired-metric
`EconomicsCurveChart` (720×320), per-metric datapoint table with
year / value / confidence / notes / inline `SourceChip` per row,
low-confidence rows render at reduced opacity. Overview economics
section shrunk to a 560×160 preview reading from the same tRPC source
(hardcoded `ECONOMICS_CURVES` removed); "Full curves →" link drives
into the dedicated tab. Pair config extracted to
`_economics-pairs.ts` so Overview + Economics share one source of
truth.

Pulls M49e's `EconomicsDatapoint` model + tRPC router forward so the
Economics tab stops being a "coming soon" stub.

- `EconomicsDatapoint` Prisma model + migration (composition.md §10
  spec — sector_slug, metric_key, value, unit, as_of, source_url,
  source_kind, confidence, notes).
- `economics` tRPC router on `services/sector-service/src/trpc/` —
  `list(sector_slug, metric_key?, since?)`, `latestPerMetric(sector_slug)`.
- Move the hardcoded `ECONOMICS_CURVES` from Overview to `seed-economics.ts`
  (one curve per vision, ≥3 metrics, ≥8 datapoints each, real source URLs).
- `/visions/[slug]/economics/page.tsx` — full render: multi-line cost
  curve chart (legend, axes, hover datapoint → SourceChip), scenario
  toggle (baseline only for v1; placeholder for optimistic /
  pessimistic), data table view toggle.
- Overview keeps a *preview* of the primary curve (small variant)
  that links to the full Economics tab.

**verify**: `/visions/space-data-center/economics` shows the full
curve set with working source chips on every datapoint; Overview
shows the preview that routes to the full page.

### MP6 — IA polish: tab alignment + Top10 + Pulse clarity + click affordances  (1d)

The small high-leverage UX cleanup that addresses gaps 4 / 5
(perception) / 8 / 9 (explanation).

- `packages/ui/src/sub-nav.tsx` — `flex` container gets
  `justify-center`; tab links lose `flex-1` so they don't stretch.
- Overview Risk Board sliced to top 10 (sort by severity_score desc),
  with "View Full Board →" link (consistent with capabilities / actors).
- `/visions/[slug]/pulse/page.tsx` — header gets a one-line "what is
  Pulse" copy + a small legend explaining source_kind badges.
- `CapabilityCard` / `ActorCard` — add `cursor-pointer`, hover ring,
  and a small "Detail →" chevron in the card footer so the
  click-to-detail affordance is obvious.

**verify**: SubNav tabs visibly centered on every vision sub-route;
hovering a Capability card on Overview shows the chevron + ring;
Pulse header explains itself in one glance.

### MP7 — Deprecated code + schema cleanup  (2–3d)

Runs last so prior MPs aren't competing with churn. One PR per
removal; each PR proves no callers remain via grep + typecheck +
test.

- Remove `SectorEquity` + `EquityFinancial` + `EquityQuote` Prisma
  models + all downstream code paths + `seed-equities.ts` /
  `seed-equity-financials.ts` / `seed-equity-quotes.ts`.
- Confirm `SectorSuggestion` + `SectorSuggestionVote` have zero
  callers → remove if confirmed.
- Confirm old `Prediction` + `PredictionResult` superseded by
  `PredictionV2` → remove if confirmed.
- Remove `apps/web/src/app/visions/_components/domain-filter.tsx`
  if no caller.
- `ENABLE_LEGACY_INVESTMENT_FEATURES` flag + all branches: remove.

**verify**: `pnpm typecheck && pnpm lint && pnpm test` clean after
each removal slice; `git grep <removed-name>` returns no hits.

---

### M50 — Bot user + Auto-proposal engine  (4–5d)

The discovery loop from composition.md §5.

- Additive schema: `User.is_bot Boolean` + `User.bot_kind String?`.
  One migration. Seed: one bot user `@feasibility_bot`
  (`bot_kind="research_agent"`).
- `services/crawler/discovery/entity_detector.py` — sonnet-tier diff
  against known actors / capabilities / risks / signal sources.
  Fuzzy-match against `Actor.name`, `Capability.name`, `Risk.title`
  (Jaro-Winkler ≥ 0.92). Confidence threshold + 2-signals-in-7d
  recurrence rule.
- `services/crawler/discovery/proposal_drafter.py` — given a detected
  entity + its source signals, drafts a `CommunityProposal` row via
  the existing M46a writer. Author = bot user. Audit-log row written
  via existing audit pipeline.
- UI guardrails: bot user excluded from leaderboard
  (`predictions_v2.leaderboard`), reputation tier
  (`UserReputation.tier`), follower mechanics, and proposal voting.
- Bot proposal visual treatment in `apps/web/src/components/community/
  ProposalCard.tsx`: gradient border, ✨ chip, "How this was drafted"
  drawer linking source signals.

**verify**: seed a "Starcloud Inc." fixture set (4 mock signals,
no existing Actor row matching) → run discovery loop → exactly one
`CommunityProposal` row appears with `author_id = bot`,
`target_kind = "add_actor"`, payload populated, audit-log row linked.

### M51 — Live Pulse UX + source-grounded transparency  (6–8d)

The three UX rules from composition.md §6.

- Hero `LivePulse` widget (`packages/ui/src/live-pulse/`) — 24h
  source-grouped activity bars, latest insight line, click-to-drawer
  with full fetched docs. Pulled from new tRPC
  `crawler.pulse.byVision` aggregating `CrawlRun` + `Signal`.
- Per-tab sync pill (`packages/ui/src/sync-pill/`) showing
  `Synced Xm ago · N sources · M signals`. Color states: ≤24h green,
  ≤72h amber, >72h red. Drops into every sub-tab header.
- Capability-card "Signal → Insight → Score" mini-funnel under the
  4-dim bars. Click → drawer with last 5 signals + extractor
  rationale + per-dim score delta.
- Score-number "why" drawer — any feasibility or capability number
  becomes clickable; drawer shows last 5 signals + ScoreUpdater
  rationale. Single shared `<ScoreWhyDrawer>` component reused
  across Overview / Capabilities / Actors.
- i18n: all new strings into `apps/web/src/lib/i18n/dict.ts` (ko + en
  parity, friendly tone).

**verify**: load `/visions/space-data-center` → Live Pulse shows
non-zero counts for last 24h, every score number opens a drawer
with at least 1 source-linked signal, sync pills show fresh-green
across all 8 sub-tabs.

### M52 — Admin Crawler Cockpit  (4–5d)

`/admin/crawler` — composition.md §7. One page, four panes.

- Live jobs table (auto-refresh 5s): `CrawlRun.status="running"`,
  ETA, $ spent so far, abort button (writes
  `CrawlRun.status="error"` + cancel signal to worker).
- 24h health pane: per-source success rate, P95 latency, dedup rate,
  $/day spent vs cap, error feed. Stripe-Status-style health pills.
- Bot proposal queue: filtered `CommunityProposal.where(author.is_bot)`,
  sorted by confidence × `vote_score`. Bulk approve / reject with
  reason-capture (writes to existing audit log).
- Fetcher schedule editor: per-vision orchestrator weight knobs,
  $/day cap, cadence, "Run now" button per surface. Writes to
  `CrawlerConfig` Json column (new — single row keyed by vision).
- Optional: per-vision Deep Research collaborative-plan approval
  flow — admin sees the proposed plan before approving the spend.

**verify**: admin can trigger a Deep Research run, watch it live,
see its cost meter increment, then approve the resulting bot
proposal — all without leaving the cockpit.

### M53 — Vision Visualization pack  (5–7d)

5 chart components from composition.md §9.

- `packages/ui/charts/CapabilityRadar.tsx` — Recharts radar, now vs
  90d ago overlay, 4-dim axes.
- `packages/ui/charts/FeasibilityTimeline.tsx` — line (score) + bar
  (signal volume) dual-axis; click point → drawer with signals
  that day.
- `packages/ui/charts/CostCurveCrossover.tsx` — dual-line cost
  intersection with crossover-year confidence band. Reads
  `EconomicsDatapoint`.
- `packages/ui/charts/ActorRelevanceBubble.tsx` — bubble chart,
  x relevance · y 90d signal count · size stage.
- `packages/ui/charts/RiskHeatmap.tsx` — likelihood × impact matrix,
  cell colored by `Risk.severity_score`, side-by-side now vs 90d.
- Embed in each surface: Radar → Overview + Capability detail;
  Timeline → Overview; CostCurve → Economics; Bubble → Actors;
  Heatmap → Risks.
- All charts click-to-source (tooltip links the contributing
  `Signal.source_url`).
- Dark + light theme parity; Recharts theme tokens from
  `packages/ui/src/charts/theme.ts`.

**verify**: open all 8 sub-tabs on each of the 4 visions →
visualizations render with real data, tooltips link sources,
both themes look clean.

### M54 — Full 4-vision seeding  (4–6d)

Pressure-tests the whole stack on 4 visions in parallel.

- For each of: Space Data Centers, Fusion Power, Memory
  Semiconductors, SOFC — ensure baseline:
  - ≥6 capabilities with `primary_driver_name` mapped + 4-dim seeded
  - ≥10 actors with country / stage / ticker (where applicable)
  - ≥5 risks with at least one concrete recent event each
  - ≥3 economics datapoints (cost over time per vision)
  - ≥30 historical signals (mix of arXiv / USPTO / news)
  - ≥20 curated source URLs (the Sources tab is never empty)
- Bootstrap path: Vision Builder agent (M41) drafts the tree → M48
  crawler back-fills 30d of signals → admin curates → seed JSONs
  written to `packages/db/prisma/seed/visions/<slug>/` for
  reproducible local resets.
- Each vision's Hero page is screenshot-quality (no empty bands,
  no broken charts, no stale-amber sync pills on first load).

**verify**: `pnpm db:reset && pnpm seed` → all 4 visions render
fully populated; the Twitter demo thread plan from the original
M44 brief is shootable.

---

## Open questions

Park here; raise as ADR if they block a milestone.

1. **Crawler service language** — Python (matches data-pipeline +
   agent-orchestration, shares `packages/agent-tools/`). Calling it
   now to avoid bikeshedding mid-M48.
2. **Bot identity surfacing in feeds** — does the bot also write
   short comments ("based on N signals this week") or is the drafted
   proposal body sufficient? Default: proposal body only for v1.
3. **Deep Research cost ceiling per vision** — $2/day default, but
   needs calibration after M48 lands (one Deep Research Max run can
   be $0.50+). Cap may need to move to per-week.
4. **EntityDetector false positives on common names** — fuzzy-match
   alone is insufficient ("Apple Inc." vs the fruit). Plan: pair
   Jaro-Winkler with an LLM classification gate (`is_org=true` +
   `domain_relevant_to_vision=true`).
5. **Bot voting** — Phase 4 says no. Could change in Phase 5 if
   high-confidence bot suggestions deserve a baseline +1 nudge.

---

## Deferred (still parked from Phase 3)

- M29 — OAuth providers (Google / GitHub)
- M30 — Multi-tenant scoping (tenant_id + Postgres RLS)
- M31 — Backtest harness (reframed as vision-feasibility backtest)
- M28b — Modal/E2B sandbox for agent-generated code
- M47 — Discussions + reputation polish (gated on real M46 production
  data; revisit after Phase 4 visions are live for 4 weeks)
- Observability — LangSmith / Helicone integration

---

## Per-milestone workflow

1. Read [composition.md](../architecture/composition.md) §-section
   matching the milestone (fetcher / bot / UX / cockpit / viz).
2. One PR per slice; each PR independently mergeable behind a
   feature flag (`ENABLE_CRAWLER`, `ENABLE_BOT_PROPOSALS`,
   `ENABLE_LIVE_PULSE`).
3. Update this file's milestone checkbox; never duplicate status
   into README / DESIGN / CLAUDE.
