# [ARCHIVED] REFACTOR.md — File-by-file code surgery for the pivot

> **Archived 2026-05-25.** This was the pivot-era file inventory.
> Phase 3 (M36 → M46c) is shipped; the surgery described here is
> done. Kept as historical reference. Current work plan:
> [docs/tasks/current.md](../tasks/current.md).

---

Companion to [pivot.md](./pivot.md). Originally written when both
docs lived at `docs/`; both archived together 2026-05-25.

**Last updated**: 2026-05-25. Most sections describe shipped surface
(M36 → M43 + M45a/b + M46a/b/c). The remaining ✓-pending entries are
M44 (Fusion second showcase), M46d/e/f, and M47.

## Legend

| Tag | Meaning |
|---|---|
| `KEEP` | No change |
| `EDIT` | Small-to-medium edits, same purpose |
| `RENAME` | Move to new path |
| `REPURPOSE` | Major rewrite, reusing infra |
| `ARCHIVE` | Code retained, hidden behind `ENABLE_LEGACY_INVESTMENT_FEATURES` |
| `NEW` | Built from scratch |
| `DELETE` | Permanent removal (only post-M44+60d audit) |

Default rule: **ARCHIVE > DELETE** until the pivot ships. No data
destruction; flag-only gating.

---

## 1. Investment surface — archived at M43 ✅

Status: shipped 2026-05-24 (`cbfd979 feat(M43): archive investment
features behind ENABLE_LEGACY_INVESTMENT_FEATURES flag`). Plus
follow-up cleanup commit (`81ba52a chore: delete pre-pivot UI surfaces`)
that removed the legacy pages outright now that the flag-off behavior
was validated — the routes return 410 instead of rendering
`<NotAvailable />` placeholders.

When `ENABLE_LEGACY_INVESTMENT_FEATURES=false` (default):
- Legacy routes removed (post-M43): `apps/web/src/app/sectors/**`,
  `predict/`, `watchlist/`, `my-sectors/`,
  `community/{predict,leaderboard,suggestions,my-predictions}/`
- tRPC routers gated at register-time: `community` (pre-pivot),
  `equity`, `prediction` (v1), `suggestion`, `watchlist`
- Crons default off: `INGEST_SCHEDULE`, `REFRESH_FINANCIALS_CRON`,
  `RESOLVE_PREDICTIONS_CRON`
- Prisma deprecation comments on: `SectorEquity`, `EquityQuote`,
  `EquityFinancial`, `Prediction` (v1), `PredictionResult`, `UserScore`,
  `SectorSuggestion`, `SectorSuggestionVote`, `WatchlistItem`

Data is preserved. Flag re-enables the routers + crons; legacy routes
would need a revert of `81ba52a` to come back.

---

## 2. Vision surface — built fresh ✅

`/sectors/*` family was deleted after M43 once the flag-off path was
validated. There is no `/sectors → /visions` redirect anymore (the old
URLs return 410); the user app now redirects `/` → `/visions` directly.

**URL family** `/visions/*` (all shipped unless noted):

| Route | Status | Notes |
|---|---|---|
| `/visions` | ✅ + visual revamp | Vision cards with domain themes + filter chips |
| `/visions/[slug]` | ✅ M37 | Hero Overview (Feasibility / ETA / capabilities / actors / risks / economics / live signals) |
| `/visions/[slug]/capabilities` | ✅ M37 → M38 | grid of capability cards (DB-backed) |
| `/visions/[slug]/capabilities/[key]` | ✅ M38 | 4-dim detail + dependency graph |
| `/visions/[slug]/actors` | ✅ M45a/b | actor list grouped by category |
| `/visions/[slug]/actors/[key]` | ✅ M45a | per-actor capability roles + signals |
| `/visions/[slug]/signals` | ✅ M39 | chronological feed |
| `/visions/[slug]/risks` | ✅ M38 | full risk board |
| `/visions/[slug]/economics` | ✅ stub | cost curves + sensitivity (light pass; M40 deliverables done elsewhere) |
| `/visions/[slug]/playground` | ✅ M37 → M42 | sim sliders + driver→capability badges + WhatIfFeasibility callout |
| `/visions/[slug]/sources` | ✅ M39 | provenance index |
| `/visions/[slug]/community` | pending M46f | per-sector hub (the cross-vision `/community` hub already ships) |
| `/visions/new` | ✅ M41 | Vision Builder agent UI (admin) |

Cross-vision surfaces:
- `/community` — hub with sub-tabs (proposals / predictions / leaderboard)
- `/community/proposals` + `/community/proposals/new` + detail page
- `/community/predictions` + `/community/predictions/new` + detail page
- `/u/[id]` — user profile (reputation, accuracy, top predictions,
  follow graph) — M46c

Root `/` → `/visions` (M37c). Legacy redirects removed alongside
`/sectors/*` deletion.

---

## 3. Schema additions

| Model | Milestone | Purpose |
|---|---|---|
| `Capability` | M36 ✅ | per-vision tech/econ/reg/supply requirement |
| `CapabilityScore` | M36 ✅ | 4-dim time series, `is_current` flag |
| `CapabilityDependency` | M36 ✅ | DAG (cycle check at tRPC layer) |
| `Signal` | M36 ✅ | source-grounded events with per-dim deltas |
| `Risk` | M36 ✅ | political/legal/supply/safety + affected_capability_keys[] |
| `VisionFeasibility` | M36 ✅ | vision-level composite snapshots + ETA |
| `Sector.vision_question` | M36 ✅ | framing question column |
| `Sector.is_vision_eligible` | M36 ✅ | opts row into /visions UI |
| `Actor` | M45a ✅ | global company/lab/govt entity |
| `VisionActor` | M45a ✅ | M2M with relevance + rationale |
| `CapabilityActor` | M45a ✅ | M2M with role (lead/competitor/supplier/...) |
| `Signal.actor_id` | M45b ✅ | extractor-tagged company FK |
| `Proposal` | M46a ✅ | community proposal with kind + payload + status |
| `ProposalVote` | M46a ✅ | +1/-1 per (user, proposal) |
| `PredictionV2` | M46b ✅ | tiered prediction: horizon × spread × auto-tier |
| `PredictionV2Result` | M46b ✅ | resolved snapshot (anchor_close, settle_close, reward) |
| `UserReputation` | M46c ✅ | tier + cumulative reward + accuracy + multiplier |
| `Follow` | M46c ✅ | follower / followee directed edge |
| `ProposalEvidence` | M46d (pending) | URL OG fetch + R2 upload for evidence rows |
| `Discussion` | M47 (pending) | free-form thread |
| `DiscussionComment` | M47 (pending) | reply with optional parent_comment_id |
| `DiscussionVote` | M47 (pending) | upvote/downvote thread or comment |

Migration history was squashed to a single init migration mid-pivot
(commit `5b8de3e chore(db): squash 20 migrations into a single init`)
to keep clone time bounded. Post-squash migrations are additive again.

---

## 4. tRPC routers

| Router | Status | Procedures |
|---|---|---|
| `vision.*` | M36 ✅ | list / get / getOverview / feasibilityHistory |
| `capability.*` | M36 ✅ | CRUD + scoreHistory + addDependency / removeDependency (cycle check) |
| `signal.*` | M36 ✅ → M39 | list (cursor paginate) + get + markHighlight + monitoring/health |
| `risk.*` | M36 ✅ | CRUD (soft-validate affected_capability_keys) |
| `feasibility.*` | M36 ✅ → M40 | current / history / recompute (live, hits simulation-service) |
| `actor.*` | M45a/b ✅ | CRUD + linkToCapability + unlinkFromCapability |
| `proposal.*` | M46a ✅ | list / get / create / vote / withdraw (admin queue pending M46e) |
| `predictionV2.*` | M46b ✅ | list / get / create / quote / leaderboard + auto-resolve cron |
| `reputation.*` / `follow.*` | M46c ✅ | tier lookup + accuracy + follow / unfollow |
| `discussion.*` | M47 (pending) | list / get / create / vote + comment.create / comment.vote |

Existing routers — disposition:

| Router | Action |
|---|---|
| `sim` / `scenario` / `audit` / `auth` / `billing` / `user-admin` | KEEP |
| `agent` | ✅ repurposed (M41 vision builder) |
| `graph` | ✅ repurposed (capability dependency CRUD) |
| `lifecycle` / `monitoring` | ✅ extended with signal-ingest health card (M39f) |
| `equity` / `prediction` (v1) / `suggestion` / `community` / `watchlist` | ✅ gated at flag (M43, register-time skip) |
| `sector` | ✅ removed alongside `/sectors/*` route deletion |

---

## 5. Python services

**`services/agent-orchestration/`** ✅ (M41 train):
- All workflows live in `agent_orchestration/workflows.py` (single file)
  + `conductor.py` (`VisionBuilderConductor`) + `validation_gate.py`
- Vision Builder chain: `PromptValidatorWorkflow` (haiku) →
  `ResearchWorkflow` (sonnet) → `VisionDecompositionWorkflow` (opus) →
  `DataSourceSelectorWorkflow` (sonnet) → ValidationGate (DAG + FK +
  weight-sum) → tRPC commit
- Signal pipeline: `SignalExtractorWorkflow` (haiku, M39) +
  `CapabilityScoreUpdaterWorkflow` (sonnet, M40)
- Legacy sim-builder workflows retained for backward compat:
  `DecompositionWorkflow`, `EdgeInferenceWorkflow`,
  `ProposeSectorWorkflow`, `DriverInferenceWorkflow`,
  `CodeGenWorkflow`, `CodeReviewWorkflow`, `FullPipelineWorkflow`
- Schemas in `schemas.py`: `VisionDecomposition`, `CapabilityDraft`,
  `RiskDraft`, `ActorDraft`, `DataSourceSelection`, `SignalScoring`,
  `CapabilityScoreUpdate` (plus the legacy `Decomposition` family)

**`services/data-pipeline/`** ✅ (M39 + M40):
- `signals/{base,arxiv,uspto,newsapi}.py` — `SignalSource` Protocol +
  3 adapters
- Per-vision keyword JSON at `signals/keywords/<slug>.json`
- Jobs: `signal_ingest` (M39), `recompute_feasibility` (M40)
- Legacy yfinance / EDGAR / DART adapters retained; gated off when
  `ENABLE_LEGACY_INVESTMENT_FEATURES=false`

**`services/simulation-service/`** ✅ (M40):
- `feasibility/{aggregator,vision_aggregator,eta,delta}.py` —
  4-dim aggregator + Liebig binding + ETA inference + 90d delta
- `/feasibility/recompute/{slug}` + `/feasibility/current/{slug}`
  endpoints
- Existing sims (space-data-center / memory-semi / sofc) unchanged;
  `placeholder.py` retained for generic agent-generated sectors
- M44 will add `sims/fusion_power.py` (~10 drivers)

---

## 6. Prompts

Current set in `prompts/` (all shipped):

| File | Tier | Workflow |
|---|---|---|
| `prompt_validator.md` | haiku | PromptValidatorWorkflow (M41a) |
| `research.md` | sonnet | ResearchWorkflow (legacy + Vision Builder) |
| `vision_decomposition.md` | opus | VisionDecompositionWorkflow (M41b) |
| `data_source_selector.md` | sonnet | DataSourceSelectorWorkflow (M41b) |
| `signal_extractor.md` | haiku | SignalExtractorWorkflow (M39b) |
| `score_updater.md` | sonnet | CapabilityScoreUpdaterWorkflow (M40b) |
| `decomposition.md` | opus | Legacy `DecompositionWorkflow` (retained) |
| `driver-inference.md` | sonnet | Legacy `DriverInferenceWorkflow` (retained) |
| `edge-inference.md` | opus | Legacy `EdgeInferenceWorkflow` (retained) |
| `code-gen.md` | sonnet | Legacy `CodeGenWorkflow` (retained) |
| `code-review.md` | sonnet | Legacy `CodeReviewWorkflow` (retained) |

Legacy prompts (decomposition, edge-inference, etc.) are kept because
they still power the agent-generated `Sector` flow used by the
Playground when a user-created sim is activated; the Vision Builder
chain (PromptValidator / VisionDecomposition / DataSourceSelector) is
separate and lives alongside them.

---

## 7. Component library — packages/ui

Current exports (all shipped):

| Component | Milestone | Use |
|---|---|---|
| `Breadcrumbs` | pre-pivot | Server-friendly nav trail |
| `SubNav` | pre-pivot | Active-aware horizontal pill row |
| `Sparkline` | pre-pivot | Tiny inline chart |
| `FeasibilityGauge` | M37a | 0-100 dial with color ramp + delta |
| `DimensionBars` | M37a | 4-dim (tech/econ/reg/supply) horizontal bars |
| `CapabilityCard` | M37a | Hero capability tile (used by Hero + capability grid) |
| `RiskRow` | M37a | Risk-board row (severity × likelihood) |
| `SignalRow` | M37a | Live signal feed row (source kind + extracted deltas) |
| `EtaWindow` | M37a | ETA distribution (P10 — median — P90) |
| `TrajectorySparkline` | M37a | 6-month feasibility trajectory |
| `EconomicsCurveChart` | M37a | Cost curve vs incumbent baseline + crossover |
| `VisionCard` | M37a | Landing-grid card |
| `ActorCard` | M45a | Logo + name + flag + stage pill + latest signal |
| `ActorPill` | M45a | Inline pill for capability footer + signal row |

Pending: M46 community components are in `apps/web` for now
(`ProposalCard`, `ProposalStatusPill`, `VoteButtons` etc. — they will
migrate up to `packages/ui` when the surface stabilizes through M46f).
`DiscussionThread` is M47.

---

## 8. Seeds + db-migrate chain

Current chain (post-M40 + M45b ✅):
```
migrate:deploy
  → seed                    # 3 sectors + is_vision_eligible
  → seed:capabilities       # M38
  → seed:risks              # M38
  → seed:feasibility        # M38
  → seed:actors             # M45b
  → seed:capability-actors  # M45b
```

M44 will add fusion-power-grid-parity vision data into the chain.
M46f will add proposal + prediction cold-start seeds.

Legacy seeds preserved as scripts but NOT in default db-migrate chain
(only when `ENABLE_LEGACY_INVESTMENT_FEATURES=true`):
`seed:equities`, `seed:equity-quotes`, `seed:equity-financials`,
`seed:graph`, `seed:graph-equities`.

---

## 9. Tests

| Service | Pattern |
|---|---|
| `@platform/db` | Vitest; mock-financials / mock-quotes tests skip when `ENABLE_LEGACY_INVESTMENT_FEATURES=false` |
| `@platform/sector-service` | Vitest, real-Postgres integration; M36 added ~20 vision tests; M45a/M46a/b/c added ~15 each |
| `agent-orchestration` | pytest; workflow + conductor tests; live API gated by `GEMINI_EVAL_LIVE=1` |
| `data-pipeline` | pytest; yfinance/EDGAR/DART tests skip when flag false; signal adapters (arxiv/uspto/newsapi) covered |
| `simulation-service` | pytest; 3 sims + `tests/test_feasibility.py` (M40) |
| Agent evals | `tests/agent_evals/` — 5 canonical visions (SDC / fusion / quantum / humanoid / mRNA); offline by default; `GEMINI_EVAL_LIVE=1` for live |

CI: weekly scheduled job with `ENABLE_LEGACY_INVESTMENT_FEATURES=true`
keeps legacy tests warm.

---

## 10. Infra / env ✅

- Live env: `NEWSAPI_KEY`, `USPTO_API_KEY?`, `SIGNAL_INGEST_CRON_DAILY`,
  `FEASIBILITY_RECOMPUTE_CRON`, `ENABLE_LEGACY_INVESTMENT_FEATURES`,
  `ENABLE_BILLING`
- Flag defaults flipped at M43: legacy `INGEST_SCHEDULE=off`,
  prediction-resolve (v1) cron off
- No new compose services — signal ingest + feasibility recompute live
  inside `data-pipeline` / `simulation-service`

---

## 11. Risk callouts (cross-cutting)

1. ✅ **GraphNode/Edge retirement** — `/sectors/[slug]/graph` deleted
   alongside other legacy routes after M43.
2. ✅ **`agent.propose` rename** — `vision.propose` (M41) is the
   canonical entrypoint; `agent.propose` kept as compat alias.
3. ✅ **`Decomposition` schema rename** — `VisionDecomposition` shipped
   in M41b; legacy `Decomposition` retained for the legacy sim-builder
   flow.
4. **Prompt cache** — every prompt edit invalidates the Anthropic
   ephemeral cache. Cost spike on first call after prompt rewrites
   (matters for `vision_decomposition.md` + `score_updater.md`).
5. **Signal extractor false-positives** — "SpaceX" in unrelated papers
   shifts scores. Confidence threshold + per-vision keyword tuning is
   the mitigation; iterate as adapters mature.
6. **Actor key collisions across visions** — `Actor` is global; per-
   vision context lives on `VisionActor`. Watch for naming clashes
   when the Vision Builder agent (M41) creates actors via natural-
   language prompt.

---

## 12. PR sequence per milestone

Each milestone ships in 2-6 small PRs to keep merges green. Sequences
for shipped milestones are recorded here as historical reference; the
current PR queue is in `docs/tasks/current.md`.

**M37 — Hero + Playground migration** ✅ (5 PRs M37a-e):
1. M37a — Hero UI components in packages/ui
2. M37b — `/visions` hero page + sub-nav scaffold
3. M37c — Playground migration + `/` → `/visions` redirect
4. M37d — Drop investment tabs from legacy sector sub-nav
5. M37e — Onboarding modal + page-tour content for Vision IA

**M38 — Capability manual seed** ✅ (2 PRs):
1. Curated capability/risk/feasibility seed for 3 visions
2. Hero swap to DB + capability detail page

**M39 — Signal ingest** ✅ (6 PRs M39a-f):
1. SignalSource Protocol + arXiv adapter + keyword config
2. SignalExtractor agent (haiku tier) + HTTP endpoint
3. Signal ingest cron + repo + manual trigger endpoints
4. NewsAPI adapter
5. USPTO adapter
6. Full Signals tab + admin monitoring health card

**M40 — Feasibility scoring engine** ✅ (2 PRs):
1. Aggregator + ETA + delta
2. ScoreUpdater agent + recompute_feasibility cron

**M41 — Vision Builder** ✅ (5 PRs M41a-e):
1. M41a — PromptValidator + signal_keywords column
2. M41b — VisionDecomposition (opus) + DataSourceSelector (sonnet)
3. M41c — ValidationGate + Conductor + tRPC persistence
4. M41d — Admin UI for prompt → review → commit
5. M41e — Eval set (5 canonical visions) + prompt sanity coverage

**M45a + M45b — Actor domain** ✅ (3 + 1 PRs):
- M45a/1 — Schema + migration + tRPC router
- M45a/2 — ActorCard + ActorPill components
- M45a/3 — Hero "Actors" band + capability footer + sub-nav
- M45b — Actor DB seed + actors page swap to DB

**M46a/b/c — Community 3.0** ✅ (3 PRs):
1. M46a — Proposal schema + tRPC + /community/proposals feed
2. M46b — PredictionV2 (tiered) + resolution cron + leaderboard
3. M46c — Reputation tiers + Follow graph + /u/[id] profile

**M44 — Fusion second showcase** (next, ~4-6d, ~4 PRs estimate):
1. `sims/fusion_power.py` (~10 drivers) + capability/risk/actor seed
2. Hero seed swap + ETA / trajectory data
3. `/visions` 4-tile public landing
4. Twitter demo thread + polish

**M46d/e/f — Community train remainder** (~7-10d, 3 PRs):
1. M46d — Evidence sources (URL OG + R2 upload)
2. M46e — Admin proposal queue + 1-click apply + audit
3. M46f — Per-sector community tab + cold-start seed

---

## 13. What this refactor explicitly does NOT do

- No data destruction (legacy tables preserved; routes deleted but flag
  re-enables the routers + crons)
- No new infra (no Temporal Cloud / Modal / E2B)
- No simulator rebuild (existing 3 sims serve the Playground as-is;
  M44 adds Fusion as a 4th)
- No OAuth / multi-tenant / RLS / observability work (M29-31, deferred)
- No monetization enablement (Stripe stays off through M44)

---

*Read PIVOT.md §5 + current.md before starting any milestone.*
