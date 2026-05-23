# REFACTOR.md — File-by-file code surgery for the pivot

Companion to [PIVOT.md](./PIVOT.md). Read PIVOT.md §5 for the strategic
context per milestone, this doc for what to actually touch.

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

## 1. Investment surface — archived at M43

Following routes/files render `<NotAvailable />` when
`ENABLE_LEGACY_INVESTMENT_FEATURES=false`:

- `apps/web/src/app/community/**` — predict / leaderboard / suggestions /
  my-predictions
- `apps/web/src/app/predict/[id]/**`
- `apps/web/src/app/watchlist/**`
- `apps/web/src/app/my-sectors/**`
- `apps/web/src/app/sectors/[slug]/equities/**`
- `apps/web/src/app/sectors/[slug]/compare-stocks/**`

tRPC routers gated at register-time when flag false:
`community`, `equity`, `prediction`, `suggestion`, `watchlist`.

Crons default off: `INGEST_SCHEDULE`, `REFRESH_FINANCIALS_CRON`,
`RESOLVE_PREDICTIONS_CRON`.

Prisma deprecation comments on: `SectorEquity`, `EquityQuote`,
`EquityFinancial`, `Prediction`, `PredictionResult`, `UserScore`,
`SectorSuggestion`, `SectorSuggestionVote`, `WatchlistItem`.

Data is preserved. Flag re-enables everything.

---

## 2. Vision surface — built fresh

**Sector hub URL family** `/sectors/[slug]/*` stays alive as legacy
through M43 (sub-nav investment tabs already removed at M37d).
`/sectors/*` → `/visions/*` 301 redirects land at M43; full removal at
M44.

**New URL family** `/visions/*`:

| Route | Built | Notes |
|---|---|---|
| `/visions` | M37 | landing grid (VisionCard tiles) |
| `/visions/[slug]` | M37 | Hero Overview (5 sections) |
| `/visions/[slug]/capabilities` | M37 stub → M38 full | grid of capability cards |
| `/visions/[slug]/capabilities/[key]` | M38 | 4-dim detail + dep graph |
| `/visions/[slug]/actors` | M45a | actor list grouped by category |
| `/visions/[slug]/actors/[key]` | M45a | per-actor capability roles + signals |
| `/visions/[slug]/signals` | M37 stub → M39 full | chronological feed |
| `/visions/[slug]/risks` | M37 stub → M38 full | severity × likelihood |
| `/visions/[slug]/economics` | M37 stub → M40 full | cost curves + sensitivity |
| `/visions/[slug]/playground` | M37 | sim sliders (reused) + WhatIf (M42) |
| `/visions/[slug]/sources` | M37 stub → M39 full | provenance index |
| `/visions/[slug]/community` | M46 | proposals + voting hub |
| `/visions/[slug]/community/proposals/[id]` | M46 | proposal detail |
| `/visions/[slug]/community/discussions/[id]` | M47 | discussion thread |
| `/visions/new` | M41 | Vision Builder agent UI (admin) |

Root `/` → `/visions` (301, M37c). Legacy `/?sector=foo` → `/sectors/foo`
preserved through M43.

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
| `Actor` | M45a | global company/lab/govt entity |
| `VisionActor` | M45a | M2M with relevance + rationale |
| `CapabilityActor` | M45a | M2M with role (lead/competitor/supplier/...) |
| `Signal.actor_id` | M45b | extractor-tagged company FK |
| `VisionProposal` | M46 | community proposal with kind + payload + status |
| `VisionProposalVote` | M46 | +1/-1 per (user, proposal) |
| `VisionDiscussion` | M47 | free-form thread |
| `DiscussionComment` | M47 | reply with optional parent_comment_id |
| `DiscussionVote` | M47 | upvote/downvote thread or comment |
| `UserReputation` | M47 | per-user vote-weight multiplier |

Migration timestamps: existing `20260527000000_capability_schema` ✅.
Future: `20260530_actor_domain` (M45a), `20260620_vision_proposals`
(M46), `20260628_vision_discussions` (M47).

---

## 4. tRPC routers

| Router | Status | Procedures |
|---|---|---|
| `vision.*` | M36 ✅ | list / get / getOverview / feasibilityHistory |
| `capability.*` | M36 ✅ | CRUD + scoreHistory + addDependency / removeDependency (cycle check) |
| `signal.*` | M36 ✅ | list (cursor paginate) + get + markHighlight |
| `risk.*` | M36 ✅ | CRUD (soft-validate affected_capability_keys) |
| `feasibility.*` | M36 ✅ | current / history / recompute (M40-pending proxy) |
| `actor.*` | M45a | CRUD + linkToCapability + unlinkFromCapability |
| `proposal.*` | M46 | list / get / create / vote / withdraw / adminApprove / adminReject / adminApply |
| `discussion.*` | M47 | list / get / create / vote + comment.create / comment.vote |

Existing routers — disposition:

| Router | Action |
|---|---|
| `sim` / `scenario` / `audit` / `auth` / `billing` / `user-admin` | KEEP |
| `agent` | REPURPOSE in M41 (vision.propose alias) |
| `graph` | REPURPOSE in M38 (capability dependency CRUD becomes the real thing) |
| `lifecycle` / `monitoring` | EDIT — copy + add signal-ingest health |
| `equity` / `prediction` / `suggestion` / `community` / `watchlist` | gated at flag (M43) |
| `sector` | becomes thin alias for `vision.*`; remove at M44 |

---

## 5. Python services

**`services/agent-orchestration/`** — repurpose at M41:
- `workflows.py` splits into `workflows/` directory (M39 trigger)
- 6 existing workflows reshape: `decomposition → vision_decomposition`,
  `edge_inference → capability_dependencies`, `driver_inference →
  capability_to_driver`, `research → vision_research`, `code_gen →
  capability_scoring_code`, `code_review` unchanged
- New: `signal_extractor.py` (M39), `score_updater.py` (M40),
  `vision_builder.py` Conductor (M41)
- Schemas: `Decomposition → VisionDecomposition`, new `CapabilityDraft`,
  `RiskDraft`, `ActorDraft` (M45b), `SignalScoring`, `CapabilityScoreUpdate`
- Old class names retained as type aliases for one release

**`services/data-pipeline/`**:
- New `signals/{base,arxiv,uspto,newsapi}.py` (M39); `kipo.py` later
- Per-vision keyword JSON at `signals/keywords/<slug>.json`
- New jobs: `signal_ingest.py` (M39), `recompute_feasibility.py` (M40)
- Existing yfinance / EDGAR / DART adapters retain; module-level pytest
  `skipif` on flag-off; weekly CI job runs flag-on for rot prevention

**`services/simulation-service/`** — extend at M40:
- New `feasibility/{aggregator,vision_aggregator,eta,delta}.py`
- `/feasibility/recompute/{slug}` + `/feasibility/current/{slug}`
  endpoints
- Existing sims (space-data-center / memory-semi / sofc) unchanged
- M44 adds `sims/fusion_power.py` (minimal, ~10 drivers)

---

## 6. Prompts

| File | Disposition | Milestone |
|---|---|---|
| `decomposition.md` | REPURPOSE → vision_decomposition.md | M41 |
| `driver-inference.md` | REPURPOSE → capability_to_driver.md | M41 |
| `edge-inference.md` | REPURPOSE → capability_dependencies.md | M41 |
| `research.md` | REPURPOSE → vision_research.md | M41 |
| `code-gen.md` | REPURPOSE → capability_scoring_code.md | M41 |
| `code-review.md` | EDIT (review target shifts to scoring code) | M41 |
| `signal_extractor.md` | NEW | M39 |
| `score_updater.md` | NEW | M40 |
| `keyword_expander.md` | NEW | M41 |

Old prompts retained as file copies one release (M44 drops aliases).

---

## 7. Component library — packages/ui

Shipped M37a:
- `FeasibilityGauge`, `DimensionBars`, `CapabilityCard`, `RiskRow`,
  `SignalRow`, `EtaWindow`, `TrajectorySparkline`,
  `EconomicsCurveChart`, `VisionCard`

New M45a:
- `ActorCard` (logo + name + flag + stage pill + latest signal)
- `ActorPill` (inline pill for capability card footer + signal row)

New M46:
- `ProposalCard`, `ProposalStatusPill`, `VoteButtons`

New M47:
- `DiscussionThread`

KEEP: existing `Breadcrumbs`, `Sparkline`, `SubNav`.

---

## 8. Seeds + db-migrate chain

After M37 ✅:
```
migrate:deploy → seed (3 sectors)
```

After M38 + M45b:
```
migrate:deploy
  → seed                    # 3 sectors + is_vision_eligible
  → seed:capabilities       # M38
  → seed:risks              # M38
  → seed:feasibility        # M38
  → seed:actors             # M45b
  → seed:capability-actors  # M45b
```

After M44:
```
... + fusion-power-grid-parity vision data
```

Legacy seeds preserved as scripts but NOT in default db-migrate chain:
`seed:equities`, `seed:equity-quotes`, `seed:equity-financials`,
`seed:graph`, `seed:graph-equities`.

---

## 9. Tests

| Service | Pattern |
|---|---|
| `@platform/db` | Vitest; existing mock-financials / mock-quotes tests stay (skipif flag-off when M43 lands) |
| `@platform/sector-service` | Vitest, real-Postgres integration; M36 added 20 vision tests; M45a/M46/M47 add ~15 each |
| `agent-orchestration` | pytest; existing workflows tests stay; new evals per agent in `tests/agent-evals/` |
| `data-pipeline` | pytest; existing yfinance/EDGAR/DART tests skip when flag false; new signal adapter tests |
| `simulation-service` | pytest; existing 3 sims unchanged; M40 adds `tests/test_feasibility.py` |
| Agent evals | `tests/agent-evals/vision-decomposition/cases.yaml` — 5 visions (SDC / fusion / quantum / humanoid / mRNA) |

CI: weekly scheduled job with `ENABLE_LEGACY_INVESTMENT_FEATURES=true` to
keep legacy tests warm (catches regressions if anyone reactivates).

---

## 10. Infra / env

- New env: `NEWSAPI_KEY`, `USPTO_API_KEY?`, `SIGNAL_INGEST_CRON_DAILY`,
  `FEASIBILITY_RECOMPUTE_CRON`, `ENABLE_LEGACY_INVESTMENT_FEATURES`,
  `ENABLE_BILLING`
- Default flips at M43: `INGEST_SCHEDULE=off`, prediction-resolve cron
  off
- New compose services: none (M39 signal ingest + M40 feasibility
  recompute run inside existing `data-pipeline` / `simulation-service`)

---

## 11. Risk callouts (cross-cutting)

1. **GraphNode/Edge retirement** — M36 added Capability/Dependency as
   parallel; both live through M43. Audit at M43 — drop if unused. The
   `/sectors/[slug]/graph` page still uses GraphNode.
2. **`agent.propose` rename** — M41 introduces `vision.propose`;
   `agent.propose` becomes thin alias one release, removed M44.
3. **`Decomposition` schema rename** — M41a adds `VisionDecomposition`;
   old `Decomposition = VisionDecomposition` type alias one release.
4. **Prompt cache invalidation** — new `vision_decomposition.md` is a
   new cache key; expect one cost spike on first proposal after deploy.
5. **Signal extractor false-positives** — "SpaceX" in unrelated papers
   shifts scores. Confidence threshold + per-vision eval set.
6. **Actor key collisions across visions** — Actor is global; per-vision
   context lives on VisionActor join.

---

## 12. PR sequence per milestone

Each milestone ships in 2-6 small PRs to keep merges green.
Representative sequences (active milestones):

**M45a — Actor schema + Hero band (fixtures)** (4-5d, 4 PRs):
1. Prisma schema + migration + actor.ts tRPC
2. packages/ui ActorCard + ActorPill
3. Hero band + capability card footer + sub-nav tab
4. Fixture data + actors page

**M38 — Capability manual seed** (3-4d, 3 PRs):
1. seed-data JSON for 3 visions (curated)
2. seed-capabilities/risks/feasibility scripts + db-migrate wire
3. Capability detail page + tRPC swap from fixtures

**M45b — Actor DB seed + signal tagging** (2-3d, 3 PRs):
1. seed-actors.ts + per-vision actor JSON
2. capability_actor wiring + Hero swap fixtures→DB
3. Signal extractor agent actor tagging + eval

**M39 — Signal ingest** (6-8d, 6 PRs):
1. SignalSource Protocol + arXiv adapter
2. Signal Extractor agent + prompt + eval
3. Ingest cron + Signals tab full impl
4. NewsAPI adapter
5. USPTO adapter
6. Monitoring health card

**M46 — Community 2.0** (5-7d, 5 PRs):
1. Prisma + tRPC proposal router
2. lib/proposal-applier per-kind apply
3. /visions/[slug]/community routes + voting UI
4. /admin/proposals admin queue
5. Apply pipeline integration tests

---

## 13. What this refactor explicitly does NOT do

- No data destruction (ARCHIVE > DELETE through M44+60d audit)
- No URL break before M43
- No new infra (no Temporal Cloud / Modal / E2B)
- No simulator rebuild (existing 3 sims become Playgrounds as-is)
- No OAuth / multi-tenant / RLS / observability work
- No monetization enablement (Stripe stays off through M44)

---

*Read PIVOT.md §5 + current.md before starting any milestone.*
