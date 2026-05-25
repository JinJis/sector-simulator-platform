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
M48 ──► M49 ──► M50 ──► M51 ──► M52 ──► M53 ──► M54
 │       │       │       │       │       │       │
 │       │       │       │       │       │       └─ 4-vision full seed
 │       │       │       │       │       └─ Visualization pack
 │       │       │       │       └─ Admin cockpit
 │       │       │       └─ Live Pulse UX
 │       │       └─ Bot user + auto-proposal
 │       └─ Per-surface fetcher set + orchestrator
 └─ Crawler service Docker + Deep Research wrapper
```

Estimated total: ~7–9 weeks at 1-person pace. Each milestone is
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

- `services/crawler/fetchers/capability.py` — per binding capability
  per dim, Deep Research prompt template, writes `Signal` rows that
  ripple through existing M40 ScoreUpdater.
- `services/crawler/fetchers/actor.py` — per top-N actor refresh
  (news + filings + hiring signals); ungated keyword scan for new
  org names (feeds M50 EntityDetector).
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
