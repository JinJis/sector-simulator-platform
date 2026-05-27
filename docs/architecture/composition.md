# Composition — how real-time data becomes a vision score

> Read alongside [docs/tasks/current.md](../tasks/current.md). Phase 4
> design ground-truth: how raw internet data turns into a per-vision
> feasibility score, what each of the 8 vision surfaces fetches, how
> the bot proposes new entities, and the UX rules that make the whole
> pipeline legible to a user in 5 seconds.

---

## 1. Per-vision surfaces

A vision page has 8 sub-routes. Three are **derived** (no fetcher);
five are **fed** (have a dedicated fetcher).

| # | Surface | Source of truth | Fetcher? |
|---|---|---|---|
| 1 | Overview | `VisionFeasibility` row (rolled-up from capabilities) | derived |
| 2 | Capabilities | `Capability` + `CapabilityScore` | `CapabilityFetcher` |
| 3 | Actors | `Actor` + `VisionActor` + `CapabilityActor` | `ActorFetcher` |
| 4 | Signals | `Signal` (raw events) | `SignalFetcher` (extends M39) |
| 5 | Risks | `Risk` | `RiskFetcher` |
| 6 | Economics | `EconomicsDatapoint` (**new**) | `EconomicsFetcher` |
| 7 | Playground | `Capability.primary_driver_name` × `SimulationBase` | derived |
| 8 | Sources | `Signal.source_url` GROUP BY type | derived |

Derived surfaces re-compute from base tables; they have no crawler
footprint but every change to a fed surface ripples through them
(invalidation rule: write to `Signal` or `CapabilityScore` → recompute
`VisionFeasibility` async via the M40 ScoreUpdater).

---

## 2. The pipeline (signal → insight → score)

```
[External]            [Fetcher]                  [Extractor]              [Updater]                  [Aggregator]
arXiv API     →   arxiv_fetcher       →    SignalExtractor      →    ScoreUpdater          →    FeasibilityAggregator
USPTO API     →   uspto_fetcher       →    (haiku, per signal)       (sonnet, per cap)          (cron, per vision)
NewsAPI       →   news_fetcher        →                                                          
SEC EDGAR     →   edgar_fetcher       →                              ↑                          ↑
Gov sources   →   gov_fetcher         →                                                          
Gemini DRA    →   deep_research       →    EntityDetector       →    CommunityProposal       
                  (per surface)             (sonnet)                  (bot author)             
                                            ↓                                                  
                                       new Actor / Capability / Risk / SignalSource
                                            ↓
                                       Vote → Admin queue → Apply → DB row
```

Three loops, intentionally separated:

1. **Ingest loop** (fetcher → SignalExtractor → `Signal`) — high-volume,
   haiku-tier, ~$0.001 per signal. Runs hourly.
2. **Score loop** (`Signal` → ScoreUpdater → `CapabilityScore` →
   FeasibilityAggregator → `VisionFeasibility`) — sonnet-tier on
   capability batches, cron every 6h or on-demand.
3. **Discovery loop** (Deep Research → EntityDetector → bot
   `CommunityProposal`) — opus/sonnet-tier, runs weekly per binding
   capability or on admin trigger.

Splitting Ingest from Discovery is the key cost lever: keyword sweeps
are cheap, but recognizing "a new actor we don't track yet" is a
language-model judgment that costs 100× more — so we do it on a slower
beat, only on the slice of signals that passed extractor relevance.

---

## 3. Fetcher specs

Every fetcher is a Python class in `services/crawler/` implementing:

```python
class Fetcher(Protocol):
    surface: Literal["capability", "actor", "signal", "risk", "economics"]
    async def plan(self, vision: Vision) -> FetchPlan: ...
    async def run(self, plan: FetchPlan) -> FetchResult: ...
    async def write(self, result: FetchResult) -> WriteSummary: ...
```

`FetchPlan` is the prompt or query the fetcher will issue. `FetchResult`
is the raw fetched payload (cached for 30d so the same plan does not
re-pay the LLM bill). `WriteSummary` is what the admin cockpit displays.

| Fetcher | Tier | Cadence | Writes |
|---|---|---|---|
| `CapabilityFetcher` | Deep Research (opus-equivalent) | weekly per binding cap | `Signal` (per-dim delta) → ripples to `CapabilityScore` |
| `ActorFetcher` | Deep Research + news scrape | daily for top-N relevance | `Signal` (actor_id-tagged), draft proposals for new actors |
| `SignalFetcher` | haiku (extends M39 arXiv/USPTO/News) | hourly | `Signal` |
| `RiskFetcher` | sonnet (regulatory keyword + safety event watch) | daily | `Signal` (risk_id-tagged), draft proposals for new risk categories |
| `EconomicsFetcher` | Deep Research (analyst reports + benchmark papers) | weekly | `EconomicsDatapoint` row (cost / $ / unit / source_url / as_of) |

### Why Deep Research vs direct crawling

Direct crawlers (arXiv / USPTO / NewsAPI / SEC) cover **structured**
sources where the schema is known and the cost is API-only — keyword
sweep + extractor is the right hammer. Deep Research (Gemini agent)
covers **unstructured** synthesis: "what's the current state of the
rad-hard compute market for orbital data centers?" — an
iterative-search-and-read problem that no single API handles. We use
it for surfaces where the answer is a *paragraph* with cited sources,
not a list of papers.

Tier picker:

- Surface needs a list of recent items → direct fetcher.
- Surface needs a synthesized state-of-X → Deep Research.
- Both? Run both; merge in extractor.

### Deep Research wrapper

`packages/agent-tools/deep_research.py` — single async client:

```python
async def deep_research(
    *,
    prompt: str,
    surface: Literal["capability", "actor", "risk", "economics"],
    vision_slug: str,
    max_tier: Literal["fast", "max"] = "fast",
    collaborative: bool = False,            # admin-approves the plan first
) -> DeepResearchResult:
    """One call = one CrawlRun row. Caches by hash(prompt, surface, vision_slug)
    for 30d. Cost is metered into the same per-vision $/day budget the
    other fetchers share."""
```

Collaborative planning (the SDK's `collaborative_planning=True`) is
exposed so an admin can review the research plan before paying for the
expensive run on Deep Research Max.

---

## 4. Orchestrator

`FetcherOrchestrator` picks what to run each tick. Ranking score:

```
score(fetch_candidate) =
      W_binding   * (100 - capability.score)        # bottom-half caps first
    + W_stale     * hours_since_last_update
    + W_priority  * vision.admin_pinned             # admin can pin
    - W_cost      * estimated_cost_usd              # respects $/day cap
```

Default weights live in `services/crawler/config.py`; admin can edit
per-vision in the cockpit. Picks the top-K candidates whose total
estimated cost fits the daily budget, queues them onto Redis (BullMQ).

Daily budget per vision: $2/day default (~$60/mo), bumpable per
vision. The "5 visions × $2/day = $300/mo" envelope keeps total LLM
spend predictable.

---

## 5. Bot proposal flow

```
EntityDetector(signal_batch)
  → diff vs {known actors, known capabilities, known risks, known sources}
  → for each candidate not yet tracked:
       if confidence >= 0.85 and mentioned in >= 2 distinct signals in 7d:
         CommunityProposal.create({
           author_id:        BOT_USER_ID,                # one global system row
           sector_slug:      vision.slug,
           target_kind:      "add_actor" | "add_capability" | "add_risk" | "add_signal_source",
           proposed_payload: drafted_fields_with_source_urls,
           title:            f"Bot proposal: {entity.name}",
           body:             rendered_template_with_evidence_links,
         })
         AuditLog.write(actor=BOT, action="bot_propose", ref=proposal.id)
       else:
         enqueue_for_recheck(candidate)
```

### Bot user

Schema additive (one migration in M50):

```prisma
model User {
  // ... existing fields ...
  is_bot   Boolean @default(false) @map("is_bot")
  bot_kind String? @map("bot_kind")     // "research_agent" | "extractor" | "watcher"
}
```

One bot per kind. The first one we ship is
`@feasibility_bot` (`bot_kind = research_agent`). UI rules:

- AI ✨ badge next to the name everywhere (Twitter-verified-bot style)
- Excluded from leaderboard, reputation tiers, follower mechanics
- Cannot vote (only proposes); cannot reply
- Bot-authored proposals get a gradient border + "How this was drafted"
  drawer that links the source signals it was built from

### Why use the existing `CommunityProposal` flow

M46a already gives us proposals + voting + audit linkage + admin queue.
The bot route is just a new author, not a new pipeline — so admin queue
UX, vote weighting, applier logic, and reputation effects all carry
over for free. The only addition is the `is_bot` flag (so we never
award the bot reputation) and a single `bot_authored` index for the
admin cockpit filter.

### What counts as a "new entity" worth proposing

| Kind | Detection rule |
|---|---|
| `add_actor` | Org name appears in ≥2 signals in 7d, doesn't fuzzy-match any existing `Actor.name` (Jaro-Winkler ≥ 0.92), and the extractor classified it as a `company / lab / govt`. |
| `add_capability` | Recurring technical phrase appears in ≥3 signals across ≥2 actors in 14d, doesn't fuzzy-match an existing `Capability.name`, and the extractor classified it as a `requirement`. |
| `add_risk` | Regulatory action / accident / supply-shock event matches a risk template, doesn't fuzzy-match an existing `Risk.title`. |
| `add_signal_source` | A new URL host shows up as a citation in ≥3 Deep Research runs, isn't in the existing source allowlist. |

All thresholds are admin-tunable in the cockpit; the defaults above are
the starting numbers for the first 4 weeks of production data.

---

## 6. UX transparency layer

Three rules drive the user-facing surface:

1. **Every number has a "why" drawer.** Click any score, ETA, or
   capability dim → see the last 5 signals that moved it, with the
   `source_url` and the extractor's rationale.
2. **Every surface advertises its own sync state.** Pill on each tab:
   `Synced 2m ago · 3 sources · 7 signals`. Stale (>24h) goes amber;
   broken (>72h) goes red.
3. **The pipeline is the story.** A "Live Pulse" widget on the Hero
   shows the ingest loop running in real time, so the user feels the
   service breathing.

### Live Pulse widget (Hero)

```
┌──────────────────────────────────────────────────────────────┐
│  ↻ Live ingest — last 24h                       see all →    │
│                                                              │
│   arXiv   ████████░░░░  47 screened · 5 relevant             │
│   News    ██████░░░░░░  23 screened · 3 relevant             │
│   USPTO   ██░░░░░░░░░░   8 screened · 1 relevant             │
│   Deep    ██████████░░   4 runs    · 2 proposals drafted     │
│                                                              │
│   Latest: "AMD rad-hard MI300 tape-out delayed" — 14m ago    │
│           → moved Rad-hard compute · technical  -3           │
└──────────────────────────────────────────────────────────────┘
```

Click → drawer with the actual fetched docs and extracted insight
lines per signal. The "→ moved X · Y -3" line is the audit-trail
sentence: source → judgment → score impact, made visible.

### Capability card — Signal → Insight → Score funnel

Below each capability card, a 1-line mini-funnel:

```
3 signals (7d) → "MI300 tape-out delayed" + 2 more → tech -3 · econ 0 · reg 0 · supply -1
                                                     90d delta: -8 ▼
```

Click expands to the full chain.

### Bot proposal treatment

```
┌─ ✨ AI proposed · 7 votes needed ────────────────────────────┐
│                                                              │
│   Add actor: Starcloud Inc.                                  │
│   Suggested role: lead · supply (rad-hard compute)           │
│                                                              │
│   Drafted from 4 signals in the last 14d ↓                  │
│   • TechCrunch: "Starcloud raises $21M Series A" (3d ago)    │
│   • Starcloud press: "1kW orbital compute milestone" (8d)    │
│   • arXiv: "Thermal management for LEO compute" (11d)        │
│   • USPTO: filing 2026/0987654 (14d)                         │
│                                                              │
│   [👍 7]  [👎 1]   [Reply]   How this was drafted →          │
└──────────────────────────────────────────────────────────────┘
```

Gradient border + ✨ chip = visually distinct from human proposals,
but voting + applier path are identical. The "How this was drafted"
link is the discoverability hook for the transparency story.

---

## 7. Admin cockpit (M52 → M55 SQLAdmin)

The M52 admin cockpit was a hand-rolled Next.js app at
`apps/admin/` (port 3100). M55 deleted it and moved everything to
**SQLAdmin** mounted on the data-pipeline FastAPI at
`http://localhost:8003/admin`. Same operator concerns, fewer
moving parts.

The four original M52 panes map onto SQLAdmin like this:

| M52 pane | M55 SQLAdmin surface |
|---|---|
| Live jobs table | **Crawl runs** ModelView (read-only, sortable by `started_at`) |
| 24h health | (deferred — `/health` JSON still exists; not surfaced as a tile yet) |
| Bot proposal queue | **Community proposals** ModelView with `Approve` / `Reject` row actions that mirror `bulkDecide` tRPC |
| Fetcher schedule editor | **Queue + Crons** custom BaseView — ARQ depth + APScheduler list with pause/resume/run-now |

Additionally, M55 added the **Vision Builder** wizard as a custom
BaseView (3 Jinja pages — prompt / review / commit) that forwards to
sector-service `visionBuilder.propose` + `commit` so the heavy Prisma
transaction stays in one place.

---

## 8. Reference inspiration (similar services)

| Service | What we borrow |
|---|---|
| Glassnode / Dune | Always-on "synced X ago" + drill-down to raw datapoints |
| Perplexity / Exa | Inline source citations; Sources surface is first-class |
| Polymarket | Recent-activity ticker beside the main number |
| GitHub Pulse | "Activity in last 24h" summary grouped by source type |
| Stripe Status | Per-source health pills (green / amber / red) |
| Linear Triage | Admin queue with bulk actions + reasoning capture |
| Notion AI | "Generated by AI — review me" treatment on every bot artifact |
| Wikipedia | Edit-history visibility + bot edit flags |
| Twitter verified bots | "✓ Bot account" badge so users trust the source |

---

## 9. Visualization pack (M53)

Today's visions are mostly cards + bars. The visualization gap to
close is the "what is moving and why" question. Five new chart
components in `packages/ui/charts/`:

| Component | Used on | What it answers |
|---|---|---|
| `CapabilityRadar` | Overview + capability detail | 4-dim score now vs 90d ago — where the binding constraint is |
| `FeasibilityTimeline` | Overview | Vision-level score over time + signal volume bars (so spikes have causality) |
| `CostCurveCrossover` | Economics | Dual-line cost intersection (e.g., orbit-compute $/TFLOP vs ground $/TFLOP), with crossover-year band |
| `ActorRelevanceBubble` | Actors | x: relevance · y: signal count 90d · size: stage. One bubble per actor |
| `RiskHeatmap` | Risks | Risk × likelihood × impact matrix (now vs 90d ago) |

Every chart is click-to-source: hover a point → tooltip with the
signal(s) that contributed.

---

## 10. Data-model additions

Two additive tables in Phase 4 (kept narrow on purpose):

### `CrawlRun` (M48)

```prisma
model CrawlRun {
  id                String   @id @default(cuid())
  vision_slug       String   @map("vision_slug")
  fetcher_kind      String   @map("fetcher_kind")    // "capability" | "actor" | "signal" | "risk" | "economics" | "deep_research"
  status            String                            // "queued" | "running" | "ok" | "error"
  plan              Json                              // FetchPlan
  result_summary    Json?    @map("result_summary")   // WriteSummary
  cost_usd          Decimal? @map("cost_usd") @db.Decimal(10, 4)
  signals_written   Int      @default(0) @map("signals_written")
  proposals_written Int      @default(0) @map("proposals_written")
  error             String?
  started_at        DateTime @default(now()) @map("started_at")
  ended_at          DateTime? @map("ended_at")

  @@index([vision_slug, started_at(sort: Desc)])
  @@index([fetcher_kind, started_at(sort: Desc)])
  @@map("crawl_runs")
}
```

### `EconomicsDatapoint` (M49)

```prisma
model EconomicsDatapoint {
  id          String   @id @default(cuid())
  sector_slug String   @map("sector_slug")
  metric_key  String   @map("metric_key")        // "cost_per_tflop_orbit" | "cost_per_tflop_ground" | ...
  value       Decimal  @db.Decimal(20, 6)
  unit        String                              // "USD/TFLOP" | "USD/kWh" | ...
  as_of       DateTime
  source_url  String   @map("source_url")
  source_kind String   @map("source_kind")        // "analyst_report" | "paper" | "filing" | "press"
  confidence  Decimal  @db.Decimal(3, 2)
  notes       String?
  created_at  DateTime @default(now()) @map("created_at")

  @@index([sector_slug, metric_key, as_of(sort: Desc)])
  @@map("economics_datapoints")
}
```

Plus the additive `User.is_bot` + `User.bot_kind` in M50.

No other schema churn — actors, capabilities, signals, risks,
proposals, audit log all already exist (M36–M46c).
