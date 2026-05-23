# REFACTOR.md — File-by-file code surgery for the Vision Feasibility Monitor pivot

**Date**: 2026-05-23
**Companion to**: [PIVOT.md](./PIVOT.md)
**Purpose**: Where PIVOT.md is the strategic memo + milestone outline, this doc
is the **executable inventory**. Every file in the repo gets a disposition.
Read this when you (or future Claude) are about to start a milestone — find
the relevant section, follow the disposition, repeat.

---

## Legend

| Tag | Meaning | When applied |
|---|---|---|
| `KEEP` | No change. File works as-is for the new product. | M36 |
| `EDIT` | Small-to-medium edits (labels, types, paths), same purpose. | per milestone |
| `RENAME` | Move to new path, same content. Refactor follows separately. | M37 |
| `REFRAME` | Same code, new product framing (text/labels/copy/exports change). | M37/M38 |
| `REPURPOSE` | Major rewrite, reusing infrastructure. | M39-M41 |
| `ARCHIVE` | Code retained, hidden behind `ENABLE_LEGACY_INVESTMENT_FEATURES` flag. | M43 |
| `DELETE` | Permanent removal (git history preserves). | M43+ (only after archive proves stable) |
| `NEW` | Built from scratch. | M36+ |

**Default rule**: do not delete during the pivot. We may want to reactivate
parts (e.g., equity actor tagging) post-M44. `ARCHIVE` over `DELETE`. A real
deletion pass can come after 4 weeks of "archived" stability.

---

## Per-milestone code surgery quick-reference

| Milestone | Mostly affects | New files | Renamed files | Deleted | Archived |
|---|---|---|---|---|---|
| **M36** | Prisma + tRPC + DESIGN.md | ~12 | 0 | 0 | 0 |
| **M37** | apps/web routes + packages/ui | ~25 | ~10 | 0 | 0 |
| **M38** | packages/db seeds + capability detail UI | ~10 | 0 | 0 | 0 |
| **M39** | data-pipeline + agent-orch + signals UI | ~14 | 0 | 0 | 0 |
| **M40** | simulation-service feasibility module | ~7 | 0 | 0 | 0 |
| **M41** | agent-orch workflows + admin propose flow | ~6 | ~6 (reshape) | 0 | 0 |
| **M42** | apps/web playground + lib + sector-nav | ~3 | 0 | 0 | 0 |
| **M43** | apps/web routes guard + crons + docs | ~3 | 0 | 0 | ~30 |
| **M44** | seeds + sim + landing | ~6 | 0 | 0 | 0 |

---

## Section 1 — `apps/web/src/app/` (user app routes)

Total files: 62. The biggest single-domain refactor.

### 1.1 Top-level investment routes — ARCHIVE behind flag at M43

| Path | Current purpose | Disposition | Milestone |
|---|---|---|---|
| `community/leaderboard/page.tsx` | Prediction leaderboard | ARCHIVE | M43 |
| `community/my-predictions/page.tsx` | User's own predictions list | ARCHIVE | M43 |
| `community/page.tsx` | Community hub landing | ARCHIVE | M43 |
| `community/predict/page.tsx` | Predict form host | ARCHIVE | M43 |
| `community/predict/predict-form.tsx` | Stock prediction form | ARCHIVE | M43 |
| `community/prediction-rationale.tsx` | AI rationale UI | ARCHIVE | M43 |
| `community/suggestions/page.tsx` | Sector suggestion list | ARCHIVE | M43 |
| `community/suggestions/suggestions-browser.tsx` | Suggestion browser | ARCHIVE | M43 |
| `my-sectors/page.tsx` | "My sectors" portfolio view | ARCHIVE | M43 |
| `my-sectors/my-sectors-table.tsx` | Portfolio table | ARCHIVE | M43 |
| `predict/[id]/page.tsx` | Prediction permalink | ARCHIVE | M43 |
| `predict/[id]/share-button.tsx` | Share predicted Q4 etc. | ARCHIVE | M43 |
| `watchlist/page.tsx` | Equity watchlist | ARCHIVE | M43 |
| `watchlist/watch-button.tsx` | Add/remove from watchlist | ARCHIVE | M43 |
| `watchlist/watchlist-table.tsx` | Watchlist render | ARCHIVE | M43 |

**M43 implementation pattern**:
```tsx
// apps/web/src/app/predict/[id]/page.tsx
import { isLegacyEnabled } from "@/lib/feature-flags";
import { NotAvailable } from "@/lib/not-available";
export default function Page(props: Props) {
  if (!isLegacyEnabled()) return <NotAvailable feature="predict" />;
  return <PredictPagelegacy {...props} />;  // existing impl moved here
}
```

`isLegacyEnabled()` reads `ENABLE_LEGACY_INVESTMENT_FEATURES` env (server-side)
or `process.env.NEXT_PUBLIC_ENABLE_LEGACY_INVESTMENT_FEATURES` (RSC-safe).

### 1.2 Sector hub investment sub-tabs — ARCHIVE at M43

| Path | Current purpose | Disposition | Milestone |
|---|---|---|---|
| `sectors/[slug]/compare-stocks/page.tsx` | Stock A/B compare in sector | ARCHIVE | M43 |
| `sectors/[slug]/equities/[ticker]/equity-detail.tsx` | Per-equity drill-down | ARCHIVE | M43 |
| `sectors/[slug]/equities/[ticker]/page.tsx` | Per-equity page | ARCHIVE | M43 |
| `sectors/[slug]/equities/equities-table.tsx` | Equity list table | ARCHIVE | M43 |
| `sectors/[slug]/equities/page.tsx` | Equities tab landing | ARCHIVE | M43 |

These don't need flag-guards individually because `sector-nav.tsx` won't render
the tabs (removed in M37). But the routes themselves should still return
`<NotAvailable />` if someone direct-links — guard at the page level.

### 1.3 Sector hub core pages — RENAME to `/visions/[slug]/` at M37

| Old path | New path (M37) | Disposition | Notes |
|---|---|---|---|
| `sectors/[slug]/layout.tsx` | `visions/[slug]/layout.tsx` | RENAME + EDIT | sub-nav swap |
| `sectors/[slug]/page.tsx` | `visions/[slug]/page.tsx` | REPURPOSE (full rewrite) | becomes the **Hero** |
| `sectors/[slug]/sector-context.tsx` | `visions/[slug]/vision-context.tsx` | RENAME + EDIT | rename exports |
| `sectors/[slug]/sector-nav.tsx` | `visions/[slug]/vision-nav.tsx` | REPURPOSE | sub-nav: Overview / Capabilities / Signals / Risks / Economics / Playground / Sources |
| `sectors/[slug]/sector-shell.tsx` | `visions/[slug]/vision-shell.tsx` | RENAME + EDIT | |
| `sectors/[slug]/live/page.tsx` | `visions/[slug]/live/page.tsx` (or merge into Overview KPI strip) | REFRAME | live KPIs become "Live driver values" strip atop Overview/Playground; standalone tab may not survive |
| `sectors/[slug]/manual/page.tsx` | `visions/[slug]/playground/page.tsx` | RENAME + EDIT | M42 adds capability badges |
| `sectors/[slug]/graph/page.tsx` | (demoted to drill-down) `visions/[slug]/capabilities/[key]/page.tsx#dependency-graph` | REFRAME | causal graph becomes per-capability dependency view |
| `sectors/[slug]/sources/page.tsx` | `visions/[slug]/sources/page.tsx` | RENAME | M39 augments with Signal sources |
| `sectors/[slug]/simulate/page.tsx` | DELETE | DELETE | duplicate of /manual; verify before deletion |
| `sectors/[slug]/narrative/page.tsx` | (defer to M44 "reports" or merge with Capability rationale) | DELETE-LATER | not used by hero; keep in legacy folder if unsure |
| `sectors/[slug]/narrative/narrative-view.tsx` | same | DELETE-LATER | |
| `sectors/[slug]/narrative/thesis-content.ts` | same | DELETE-LATER | |
| `sectors/page.tsx` | `visions/page.tsx` | REPURPOSE | vision-card grid landing |

**Backward-compat handling for M37 → M43**:
- `/sectors/*` routes stay alive as 301 redirects → `/visions/*`.
- Add a `next.config.ts` `redirects()` block that maps each old path to new.
- Drop redirects at M43.

### 1.4 New routes built in M37+

| Path | Purpose | Milestone |
|---|---|---|
| `visions/page.tsx` | Home — vision card grid | M37 |
| `visions/[slug]/page.tsx` | Hero "Overview" | M37 |
| `visions/[slug]/playground/page.tsx` | Driver sliders + sim outputs (= old manual) | M37 |
| `visions/[slug]/sources/page.tsx` | Provenance | M37 |
| `visions/[slug]/capabilities/page.tsx` | Capability list | M37 skeleton → M38 full |
| `visions/[slug]/capabilities/[key]/page.tsx` | Capability detail | M38 |
| `visions/[slug]/signals/page.tsx` | Signal feed | M37 skeleton → M39 full |
| `visions/[slug]/risks/page.tsx` | Risk board detail | M37 skeleton → M38 full |
| `visions/[slug]/economics/page.tsx` | Cost curves, TCO, break-even | M37 skeleton → M40 full |
| `visions/new/page.tsx` | Vision Builder agent UI (admin) — moved from `/propose` | M41 (move from M41-rework) |

### 1.5 Cross-cutting components — minor edits

| Path | Disposition | Notes |
|---|---|---|
| `page.tsx` (root) | EDIT (M37) | redirect to `/visions` |
| `layout.tsx` (root) | KEEP | |
| `header/site-header.tsx` | EDIT (M37, M43) | nav links: replace "Sectors" → "Visions"; M43 hide community/predict/watchlist links behind flag |
| `header/user-menu.tsx` | KEEP | |
| `header/onboarding-modal.tsx` | EDIT (M37) | copy update — "tour the monitor" |
| `header/page-tour.tsx` | EDIT (M37) | rewrite tour for /visions IA |
| `header/page-tour-content.ts` | REPURPOSE (M37) | per-page tour content updated |
| `header/use-focus-trap.ts` | KEEP | |
| `home/home-search.tsx` | EDIT (M37) | search visions (not sectors) |
| `home/more-expander.tsx` | KEEP | |
| `live-dashboard.tsx` | KEEP | used in Overview live strip + Playground |
| `live-strip.tsx` | KEEP | |
| `manual-panel.tsx` | KEEP (M42 adds capability badge prop) | used in Playground |
| `report-panel.tsx` | KEEP — repositioned (M37 keeps the Markdown report; may rename to "Vision summary" in M44) | |
| `scenario-bar.tsx` | KEEP | scenarios still useful in Playground |
| `scenario-state.ts` | KEEP | |
| `sector-picker.tsx` | RENAME → `vision-picker.tsx` (M37) | used by `/visions` landing |
| `compare/page.tsx` | KEEP — REFRAME copy | scenario A/B compare still works; rephrase "compare scenarios within a Vision" |
| `compare/compare-view.tsx` | KEEP — REFRAME copy | |
| `graph-view.tsx` | REPURPOSE (M38/M42) | reused for capability dependency graphs |
| `graph-side-panel.tsx` | REPURPOSE (M38/M42) | side panel now shows Capability detail |
| `sources-view.tsx` | KEEP — REFRAME (M39) | extend to include Signal sources |
| `propose/page.tsx` | DELETE-or-MOVE to `visions/new/page.tsx` (M41) | |
| `propose/propose-flow.tsx` | DELETE-or-MOVE to `visions/new/propose-flow.tsx` (M41) | |
| `shared.ts` | KEEP | |
| `page-intent.tsx` | EDIT (M37) | i-intent palette adds Vision concepts |
| `page-intents.ts` | EDIT (M37) | |
| `login/*`, `signup/*`, `settings/*` | KEEP | |

### 1.6 New components in `apps/web/src/app/visions/[slug]/`

| Path | Purpose | Milestone |
|---|---|---|
| `_fixtures/space-data-center.json` | Hardcoded hero data (M37) → deleted at M38 (DB-backed) | M37 |
| `_fixtures/memory-semi.json` | Same | M37 |
| `_fixtures/sofc.json` | Same | M37 |
| `capabilities/[key]/dependency-graph.tsx` | Reuses graph-view | M38 |
| `playground/what-if-feasibility.tsx` | Slider → Feasibility delta callout | M42 |

---

## Section 2 — `apps/admin/src/app/` (admin app routes)

Total files: 18. Lighter touch.

| Path | Disposition | Milestone | Notes |
|---|---|---|---|
| `page.tsx` (admin home) | EDIT | M36 | grid of visions (label change), counts now include capability/signal/risk counts |
| `layout.tsx` | KEEP | | |
| `sectors/[slug]/page.tsx` | RENAME → `visions/[slug]/page.tsx` | M37 | admin sector detail → admin vision detail (capabilities/signals/risks editable) |
| `draft-sector-row.tsx` | RENAME + REPURPOSE → `draft-vision-row.tsx` | M41 | draft visions awaiting approval |
| `scenarios/page.tsx` | KEEP | | cross-sector scenarios list |
| `agent-runs/page.tsx` | KEEP | | agent runs cover both legacy (sector proposal) and new (vision builder) until M41 |
| `agent-runs/[id]/page.tsx` | KEEP | | |
| `agent-runs/[id]/promote-button.tsx` | EDIT | M41 | "Promote" now publishes a Vision (not a sector); copy + tRPC call shift |
| `agent-runs/[id]/watcher.tsx` | KEEP | | |
| `agent-runs/new/page.tsx` | EDIT or RENAME → `visions/new/page.tsx` | M41 | becomes Vision Builder entry; old agent-runs path stays as alias |
| `agent-runs/new/form.tsx` | EDIT | M41 | form fields shift — "describe the vision" not "describe the sector" |
| `agent-runs/status-pill.tsx` | KEEP | | |
| `audit/page.tsx` | KEEP | | |
| `monitoring/page.tsx` | EDIT | M39 | add signal-ingest health row |
| `lifecycle/page.tsx` | EDIT | M41 | "Sector lifecycle" → "Vision lifecycle" (draft / review / live / paused / sunset) |
| `lifecycle/lifecycle-candidate-card.tsx` | EDIT | M41 | |
| `users/page.tsx` | KEEP | | |
| `users/user-admin-table.tsx` | KEEP | | |

---

## Section 3 — `services/sector-service/src/trpc/` (16 routers)

### 3.1 Routers — disposition

| File | Procedures | Disposition | Milestone | Notes |
|---|---|---|---|---|
| `init.ts` | router/procedure factory | KEEP | | |
| `context.ts` | createContext | KEEP | | |
| `router.ts` (root) | wires all sub-routers | EDIT | M36 / M43 | add `vision`, `capability`, `signal`, `risk`, `feasibility`; gate `equity`/`prediction`/`suggestion`/`community`/`watchlist` behind flag |
| `auth.ts` | session check | KEEP | | |
| `audit.ts` | audit log list | KEEP | | |
| `agent.ts` | propose sector / list runs / get run | REPURPOSE | M41 | rename `propose` → `proposeVision`; same workflow shape, new schemas |
| `billing.ts` | Stripe customer/sub/checkout | KEEP | | gated behind `ENABLE_BILLING` (separate flag, default off through M44) |
| `community.ts` | community hub queries | ARCHIVE | M43 | hide router from registration when flag false |
| `equity.ts` | equity list/get/financials | ARCHIVE | M43 | as above |
| `graph.ts` | graph CRUD (was driver-edge for equity impact) | REPURPOSE | M36 / M38 | becomes Capability Dependency graph CRUD; same `upsertEdge`/`upsertNode` API surface, semantic shift |
| `lifecycle.ts` | sector lifecycle (draft/review/live) | EDIT | M41 | now vision lifecycle; same code, copy update |
| `monitoring.ts` | data-pipeline health card | EDIT | M39 | add signal-ingest status |
| `prediction.ts` | predict / analyzeRationale / resolve | ARCHIVE | M43 | |
| `scenario.ts` | scenario CRUD | KEEP | | |
| `sector.ts` | sector list/get/getBySlug | RENAME exports + KEEP impl | M36 | actual procedures live in new `vision.ts`; `sector.*` becomes a thin alias for 1 release then removed |
| `sim.ts` | sim list/get/run/sensitivity/live/graph/report | KEEP | | used by Playground |
| `suggestion.ts` | sector suggestions | ARCHIVE | M43 | |
| `user-admin.ts` | user admin queries | KEEP | | |
| `watchlist.ts` | watchlist CRUD | ARCHIVE | M43 | |

### 3.2 New routers (M36+)

| File | Procedures (signature) | Milestone | Notes |
|---|---|---|---|
| `vision.ts` | `list`, `get(slug)`, `getOverview(slug)` (composite payload), `feasibility.history(slug)`, `propose`, `approve` | M36 (core), M41 (propose/approve) | |
| `capability.ts` | `list(slug)`, `get(slug, key)`, `scoreHistory(slug, key)`, `upsert`, `delete`, `addDependency`, `removeDependency` | M36 | |
| `signal.ts` | `list(slug, filter)`, `get(id)`, `markHighlight(id, bool)`, `extractScore(id)` (admin re-runs extractor) | M39 | |
| `risk.ts` | `list(slug)`, `upsert`, `delete` | M36 | minimal CRUD |
| `feasibility.ts` | `current(slug)`, `history(slug, limit)`, `recompute(slug)` (admin trigger) | M40 | proxies to simulation-service |

### 3.3 `services/sector-service/src/lib/`

| File | Purpose | Disposition | Milestone |
|---|---|---|---|
| `agent-proxy.ts` | HTTP client → agent-orchestration | KEEP | |
| `auth.ts` | session helpers | KEEP | |
| `billing-webhook.ts` | Stripe webhook handler | KEEP | gated by billing flag |
| `budget.ts` | per-user agent budget | KEEP | gated by billing flag |
| `env.ts` | env validation | EDIT (M36, M39, M40, M43) | add NEWSAPI_KEY, signal cron vars, ENABLE_LEGACY_INVESTMENT_FEATURES, ENABLE_BILLING |
| `graph-impact.ts` | server-side impact calc (was equity→driver) | REPURPOSE | M38 | becomes capability-dependency traversal helper |
| `sim-proxy.ts` | HTTP client → simulation-service | KEEP — extend (M40) | add `/feasibility/*` endpoints |
| `stats.ts` | usage stats | KEEP | |
| `stripe.ts` | Stripe client | KEEP | gated |
| `feature-flags.ts` | NEW | NEW | M43 — central read of ENABLE_LEGACY_*, ENABLE_BILLING |
| `driver-feasibility-projection.ts` | NEW | NEW | M42 — slider → feasibility delta |

### 3.4 `services/sector-service/src/`

| File | Disposition | Notes |
|---|---|---|
| `index.ts` | KEEP | exports AppRouter type |
| `server.ts` | KEEP | Fastify bootstrap |

---

## Section 4 — `services/agent-orchestration/` (Python service)

### 4.1 Core modules

| File | Disposition | Milestone | Notes |
|---|---|---|---|
| `__init__.py` | KEEP | | |
| `main.py` | EDIT (M39, M40, M41) | | add `/signal-extractor/score`, `/score-updater/run`, `/vision/propose` endpoints |
| `prompts.py` | EDIT | M41 | load new prompt files (vision_*.md), keep existing as aliases for one release |
| `repo.py` | EDIT | M36 / M41 | extend agent_workflows storage with vision_draft state |
| `schemas.py` | EDIT (HEAVY) | M36 / M39 / M40 / M41 | see schema map below |
| `workflows.py` | REPURPOSE (HEAVY) | M41 | see workflow map below |

### 4.2 Schemas in `schemas.py`

Current schemas (M28 era):
- `Decomposition`, `DriverNode`, `IntermediateNode`, `OutputNode` — sector tree
- `DriverInferenceResult` — drivers per node
- `EdgeInferenceResult` — node-to-node edges
- `CodeGenResult` — Python sim code
- `CodeReviewResult` — review verdict
- `ResearchBrief` — research output

Reshape plan (M41):
- `Decomposition` → `VisionDecomposition` (capabilities not nodes; risks attached; rationale per capability)
- `DriverNode` → `CapabilityDraft` (key, name, desc, rationale, weight, primary_driver_name, initial 4-dim scores, keyword set)
- `EdgeInferenceResult` → `CapabilityDependencies` (key→key edges with rationale)
- `CodeGenResult` → `CapabilityScoringCode` (Python that produces scores from raw signals)
- `CodeReviewResult` — unchanged structurally; review target is scoring code
- `ResearchBrief` → `VisionResearch` (focus shifts to "what does this vision need")
- NEW: `RiskDraft` (key, category, name, severity, likelihood, time_horizon, affected_capability_keys)
- NEW: `SignalScoring` (M39) — extractor output: per-dimension delta + is_highlight
- NEW: `CapabilityScoreUpdate` (M40) — updater output: new 4-dim scores + rationale

Keep old class names as type aliases for one release (`Decomposition = VisionDecomposition`) so tests don't break in bulk. Drop aliases at M44.

### 4.3 Workflows in `workflows.py`

Current workflows (one class each):
- `DecompositionWorkflow` — sector → tree
- `EdgeInferenceWorkflow` — edges
- `DriverInferenceWorkflow` — drivers
- `ResearchWorkflow` — research brief
- `CodeGenWorkflow` — sim code
- `CodeReviewWorkflow` — review

Reshape:
- `DecompositionWorkflow` → keep class name + signature; payload reshape to `VisionDecomposition`. Prompts swapped (M41).
- `EdgeInferenceWorkflow` → keep; payload = `CapabilityDependencies`
- `DriverInferenceWorkflow` → keep; payload = `CapabilityToDriver` (links Capability.key → existing Driver.name)
- `ResearchWorkflow` → keep; payload = `VisionResearch`
- `CodeGenWorkflow` → keep; payload = `CapabilityScoringCode` (now Python that scores signals, not full sim)
- `CodeReviewWorkflow` → keep
- **NEW** `SignalExtractorWorkflow` (M39) — file split into `workflows/signal_extractor.py`. Tier: haiku. ~100-1000 calls/day.
- **NEW** `ScoreUpdaterWorkflow` (M40) — file `workflows/score_updater.py`. Tier: sonnet. Triggered by new signal arrival per capability.
- **NEW** `VisionBuilderConductor` (M41) — orchestrates Research → Decomposition → CapabilityToDriver → Dependencies → ScoringCode → CodeReview → human approval → SignalKeywordExpander → persist.

File split decision: `workflows.py` is currently one 700+ line file. M41 splits into `workflows/__init__.py` + per-workflow files. Do this in M39 (the new signal_extractor workflow is the trigger).

### 4.4 Tests

| File | Disposition | Notes |
|---|---|---|
| `tests/conftest.py` | EDIT | schema registry update, agent fixture extends to new schemas |
| `tests/test_api.py` | EDIT | new endpoints |
| `tests/test_m28_api.py` | RENAME → `test_legacy_m28_api.py` or KEEP and add new test file | dormant agent tests kept but become "we still support the legacy propose-sector shape" |
| `tests/test_m28_workflows.py` | same as above | |
| `tests/test_workflows.py` | EDIT | already touched in M35 fix; needs new schema assertions in M41 |
| `tests/test_prompts.py` | EDIT (M41) | new prompt files |
| `tests/test_propose_sector.py` | RENAME → `test_propose_vision.py` | M41 |
| `tests/test_repo.py` | EDIT | M36 — vision_draft state shape |
| **NEW** `tests/test_signal_extractor.py` | NEW (M39) | extractor eval |
| **NEW** `tests/test_score_updater.py` | NEW (M40) | updater eval |
| **NEW** `tests/test_vision_builder.py` | NEW (M41) | full pipeline integration |

---

## Section 5 — `services/data-pipeline/` (Python service)

### 5.1 Adapters

| File | Purpose | Disposition | Milestone |
|---|---|---|---|
| `adapters/base.py` | DataSource Protocol | KEEP | M39 — Signal adapters inherit this same Protocol pattern |
| `adapters/fake.py` | fake quote source | KEEP (gated) | M43 |
| `adapters/fake_financials.py` | fake financials | KEEP (gated) | M43 |
| `adapters/financials_base.py` | financials Protocol | KEEP (gated) | M43 |
| `adapters/yfinance_source.py` | yfinance quotes | KEEP (gated) | M43 |
| `adapters/edgar_source.py` | SEC EDGAR financials | KEEP (gated) | M43 |
| `adapters/dart_source.py` | DART KR financials | KEEP (gated) | M43 |
| `adapters/dart_corp_codes.py` | DART corp code cache | KEEP (gated) | M43 |
| `adapters/frankfurter_fx.py` | FX rates | KEEP | useful for any USD normalization |

### 5.2 NEW adapters (M39)

| File | Purpose | Milestone |
|---|---|---|
| `signals/__init__.py` | NEW | M39 |
| `signals/base.py` | SignalSource Protocol | M39 |
| `signals/arxiv.py` | arXiv API (M39a) | M39 |
| `signals/uspto.py` | USPTO PatentsView (M39c) | M39 |
| `signals/newsapi.py` | NewsAPI.org (M39b) | M39 |
| `signals/kipo.py` | Korean patents (placeholder for now) | Phase 3 |
| `signals/keywords/space-data-center.json` | per-capability keyword sets | M39 |
| `signals/keywords/memory-semi.json` | | M39 |
| `signals/keywords/sofc.json` | | M39 |
| `signals/keywords/fusion-power.json` | | M44 |

### 5.3 Jobs

| File | Disposition | Milestone |
|---|---|---|
| `jobs/__init__.py` | KEEP | |
| `jobs/refresh_quotes.py` | KEEP (gated, cron disabled by default) | M43 |
| `jobs/refresh_quote_history.py` | same | M43 |
| `jobs/refresh_financials.py` | same | M43 |
| `jobs/resolve_predictions.py` | same | M43 |
| **NEW** `jobs/signal_ingest.py` | NEW | M39 |
| **NEW** `jobs/recompute_feasibility.py` | NEW | M40 |

### 5.4 Repos

| File | Disposition | Milestone |
|---|---|---|
| `repo.py` | EDIT | M39 — add Signal repo methods; M40 — Capability/Feasibility ops |
| `prediction_repo.py` | KEEP (gated, no new writes when flag false) | M43 |
| **NEW** `signal_repo.py` | optional split out from repo.py | M39 |

### 5.5 Entry point

| File | Disposition | Milestone | Notes |
|---|---|---|---|
| `main.py` | EDIT (M39, M40, M43) | | Cron registration: disable refresh_quotes / refresh_financials / resolve_predictions when ENABLE_LEGACY_INVESTMENT_FEATURES=false (M43). Register signal_ingest + recompute_feasibility (M39+M40). Env defaults: INGEST_SCHEDULE=off (M43). |

### 5.6 Tests

| File | Disposition |
|---|---|
| `tests/test_adapters.py` | KEEP — skipped when flag off |
| `tests/test_api.py` | EDIT — add new endpoint tests in M39/M40 |
| `tests/test_corp_codes.py` | KEEP — skipped when flag off |
| `tests/test_financials_adapters.py` | KEEP — skipped when flag off |
| `tests/test_frankfurter_fx.py` | KEEP |
| `tests/test_refresh_financials.py` | KEEP — skipped when flag off |
| `tests/test_refresh_quote_history.py` | KEEP — skipped when flag off |
| `tests/test_refresh_quotes.py` | KEEP — skipped when flag off |
| `tests/test_repo.py` | EDIT — add Signal repo tests in M39 |
| `tests/test_resolve_predictions.py` | KEEP — skipped when flag off |
| **NEW** `tests/test_signal_adapters.py` | NEW (M39) |
| **NEW** `tests/test_signal_ingest.py` | NEW (M39) |
| **NEW** `tests/test_recompute_feasibility.py` | NEW (M40) |

**Skip pattern**: use pytest module-level marker
```python
pytestmark = pytest.mark.skipif(
    os.environ.get("ENABLE_LEGACY_INVESTMENT_FEATURES", "false").lower() != "true",
    reason="legacy investment features disabled",
)
```

---

## Section 6 — `services/simulation-service/` (Python service)

| File | Disposition | Milestone | Notes |
|---|---|---|---|
| `__init__.py` | KEEP | | |
| `main.py` | EDIT | M40 | add `/feasibility/recompute/{slug}`, `/feasibility/current/{slug}` |
| `schemas.py` | EDIT | M40 | add `FeasibilityResponse`, `CapabilityScoreResponse` |
| `registry.py` | EDIT | M44 | register fusion-power sim |
| `evaluator.py` | KEEP | | |
| `generic_dag.py` | KEEP | | |
| `db_loader.py` | EDIT (M38) | M38 | optionally load Capability list when serving a sim |
| `report.py` | KEEP | | M44 may extend |
| `sims/__init__.py` | KEEP | | |
| `sims/space_data_center.py` | KEEP | | reference sim, used in Playground |
| `sims/memory_semi.py` | KEEP | | |
| `sims/sofc.py` | KEEP | | |
| `sims/placeholder.py` | KEEP | | |
| **NEW** `sims/fusion_power.py` | NEW | M44 | minimal sim with ~10 drivers |
| **NEW** `feasibility/__init__.py` | NEW | M40 | |
| **NEW** `feasibility/aggregator.py` | NEW | M40 | 4-dim → composite |
| **NEW** `feasibility/vision_aggregator.py` | NEW | M40 | capability composite → vision; binding constraint logic |
| **NEW** `feasibility/eta.py` | NEW | M40 | linear extrapolation; later logistic |
| **NEW** `feasibility/delta.py` | NEW | M40 | 90d delta calc |

### Tests

| File | Disposition |
|---|---|
| `tests/test_api.py` | EDIT — `/feasibility/*` endpoints (M40) |
| `tests/test_edge_weights.py` | KEEP |
| `tests/test_evaluator.py` | KEEP |
| `tests/test_generic_dag.py` | KEEP |
| `tests/test_memory_semi.py` | KEEP |
| `tests/test_report.py` | KEEP |
| `tests/test_sofc.py` | KEEP |
| `tests/test_space_data_center.py` | KEEP |
| **NEW** `tests/test_feasibility.py` | NEW (M40) |
| **NEW** `tests/test_fusion_power.py` | NEW (M44) |

---

## Section 7 — `packages/db/prisma/`

### 7.1 schema.prisma — model dispositions

| Model | Disposition | Milestone | Notes |
|---|---|---|---|
| `Sector` | KEEP — EDIT | M36 | add relations: capabilities, signals, risks, feasibility_history; add `is_vision_eligible` boolean (default true); note "= Vision in product language" |
| `Scenario` | KEEP | | |
| `User` | KEEP | | |
| `Session` | KEEP | | |
| `AgentWorkflow` | KEEP — EDIT | M41 | optional `vision_draft_id` field for vision-builder runs |
| `AuditLog` | KEEP | | |
| `BillingCustomer` | KEEP (gated) | M43 | |
| `BillingSubscription` | KEEP (gated) | M43 | |
| `BillingEvent` | KEEP (gated) | M43 | |
| `GraphNode` | REPURPOSE — schema change | M36 | becomes Capability dependency node OR retired in favor of Capability table directly. **Decision**: retire GraphNode/Edge, use Capability + CapabilityDependency. Migration writes existing rows into deprecated namespace. |
| `GraphEdge` | REPURPOSE / RETIRE | M36 | see above |
| `WatchlistItem` | KEEP (gated) | M43 | may reactivate as "Vision watchlist" (subscribe to vision) post-pivot |
| `UserScore` | KEEP (gated) | M43 | prediction score; may reactivate as "vision forecast accuracy" later |
| `SectorEquity` | ARCHIVE (deprecation comment) | M36 | data retained |
| `EquityQuote` | ARCHIVE | M36 | |
| `EquityFinancial` | ARCHIVE | M36 | |
| `Prediction` | ARCHIVE | M36 | |
| `PredictionResult` | ARCHIVE | M36 | |
| `SectorSuggestion` | ARCHIVE | M36 | |
| `SectorSuggestionVote` | ARCHIVE | M36 | |
| **NEW** `Capability` | NEW | M36 | see PIVOT.md §4.2 |
| **NEW** `CapabilityScore` | NEW | M36 | 4-dim + composite + time series |
| **NEW** `CapabilityDependency` | NEW | M36 | DAG between capabilities |
| **NEW** `Signal` | NEW | M36 | source-grounded events with per-dim deltas |
| **NEW** `Risk` | NEW | M36 | political/legal/supply/safety |
| **NEW** `VisionFeasibility` | NEW | M36 | vision-level composite snapshot |

### 7.2 Migrations

| File | Disposition | Notes |
|---|---|---|
| `migrations/*` existing | KEEP | never edit historical migrations |
| **NEW** `migrations/20260524_capability_schema/` | NEW (M36) | adds 6 new models, adds `is_vision_eligible` to Sector, adds deprecation comments-as-SQL-comments |
| **NEW** `migrations/20260601_retire_graph_node_edge/` | NEW (M36b? optional) | drop GraphNode/GraphEdge or rename to legacy_ if used elsewhere |

### 7.3 Seeds

| File | Disposition | Milestone |
|---|---|---|
| `seed.ts` | EDIT | M36 — add `is_vision_eligible=true` to all 3 sectors |
| `seed-equities.ts` | KEEP — drop from default chain | M43 |
| `seed-equity-financials.ts` | KEEP — drop from default chain | M43 |
| `seed-equity-quotes.ts` | KEEP — drop from default chain | M43 |
| `seed-graph.ts` | KEEP for back-compat — drop from default chain | M36 (data superseded by Capability seeds) |
| `seed-graph-equities.ts` | DROP from default chain | M36 |
| **NEW** `seed-capabilities.ts` | NEW | M38 |
| **NEW** `seed-risks.ts` | NEW | M38 |
| **NEW** `seed-feasibility.ts` | NEW | M38 |
| **NEW** `seed-data/visions/space-data-center.json` | NEW | M38 |
| **NEW** `seed-data/visions/memory-semi.json` | NEW | M38 |
| **NEW** `seed-data/visions/sofc.json` | NEW | M38 |
| **NEW** `seed-data/visions/fusion-power-grid-parity.json` | NEW | M44 |

### 7.4 Tests

| File | Disposition |
|---|---|
| `tests/mock-financials.test.ts` | KEEP — skipped when flag off |
| `tests/mock-quotes.test.ts` | KEEP — skipped when flag off |
| **NEW** `tests/seed-capabilities.test.ts` | NEW (M38) |
| **NEW** `tests/seed-risks.test.ts` | NEW (M38) |
| **NEW** `tests/seed-feasibility.test.ts` | NEW (M38) |

### 7.5 db-migrate chain update

Currently (docker-compose.yml `db-migrate`):
```
migrate:deploy && seed && seed:equities && seed:equity-quotes && seed:equity-financials
```

After M38:
```
migrate:deploy
 && seed                                # 3 sectors
 && seed:capabilities                   # capabilities for 3 visions
 && seed:risks
 && seed:feasibility
```

After M44 (fusion added):
```
migrate:deploy
 && seed                                # 4 sectors (SDC, memory-semi, sofc, fusion)
 && seed:capabilities
 && seed:risks
 && seed:feasibility
```

Optional: behind ENABLE_LEGACY_INVESTMENT_FEATURES=true, additionally run
seed:equities chain. Keep this in a separate `db-migrate-legacy` compose
service that only runs when the flag is set.

---

## Section 8 — `packages/ui/`

| File | Disposition | Milestone |
|---|---|---|
| `breadcrumbs.tsx` | KEEP | |
| `sparkline.tsx` | KEEP | reused in Hero |
| `sub-nav.tsx` | EDIT (M37) | new tab list shape: support icon + warning badge for binding-constraint capability |
| `index.ts` | EDIT (M37) | export new components |
| **NEW** `feasibility-gauge.tsx` | NEW (M37) | |
| **NEW** `capability-card.tsx` | NEW (M37) | |
| **NEW** `dimension-bars.tsx` | NEW (M37) | tech/econ/reg/supply bar group |
| **NEW** `risk-row.tsx` | NEW (M37) | |
| **NEW** `signal-row.tsx` | NEW (M37) | |
| **NEW** `economics-curve-chart.tsx` | NEW (M37) | dual-line orbit vs ground |
| **NEW** `eta-window.tsx` | NEW (M37) | timeline with median + P10-P90 |
| **NEW** `trajectory-sparkline.tsx` | NEW (M37) | confidence-band sparkline |
| **NEW** `vision-card.tsx` | NEW (M37) | landing-page card |

---

## Section 9 — `prompts/`

| File | Disposition | Milestone | Notes |
|---|---|---|---|
| `README.md` | EDIT | M36 / M41 | describes new prompts |
| `decomposition.md` | EDIT or RENAME → `vision_decomposition.md` | M41 | reshape from "decompose sector → nodes" to "decompose vision → capabilities + risks" |
| `driver-inference.md` | EDIT | M41 | shift to "drivers per capability" (uses primary_driver_name link) |
| `edge-inference.md` | EDIT → `capability_dependencies.md` | M41 | edges between capabilities |
| `research.md` | EDIT → `vision_research.md` | M41 | |
| `code-gen.md` | EDIT → `capability_scoring_code.md` | M41 | output is Python that scores from signals |
| `code-review.md` | EDIT minor | M41 | review target is scoring code |
| **NEW** `signal_extractor.md` | NEW | M39 | per-dimension delta extraction |
| **NEW** `score_updater.md` | NEW | M40 | aggregate signal deltas into score updates |
| **NEW** `keyword_expander.md` | NEW | M41 | take capability description → expand into search keywords |

Old prompt files stay alive for one release as aliases (file copies) so any
external reference doesn't 404. Drop at M44.

---

## Section 10 — Tests (cross-service)

Already covered per-service in §3-§7. Cross-cutting:

| Path | Disposition | Milestone |
|---|---|---|
| `tests/agent_evals/test_prompt_sanity.py` | EDIT | M41 — add new prompts |
| `tests/agent_evals/conftest.py` | EDIT | M41 — new fixtures |
| `tests/agent_evals/harness.py` | EDIT | M41 — extend for vision decomp evals |
| `tests/agent_evals/test_decomposition.py` | RENAME → `test_vision_decomposition.py` | M41 |
| `tests/agent_evals/cases/decomposition_cases.py` | RENAME + EDIT → `vision_decomposition_cases.py` | M41 — replace sector cases with 5 vision cases (SDC, fusion, quantum, humanoid, mRNA-cancer) |
| **NEW** `tests/agent_evals/test_signal_extractor.py` | NEW | M39 — 10 hand-labeled signals |
| **NEW** `tests/agent_evals/test_score_updater.py` | NEW | M40 — score-shift expectations |
| **NEW** `tests/integration/vision-end-to-end.test.ts` | NEW | M40 — signal → extractor → updater → recompute → hero |

---

## Section 11 — Infra (docker-compose, env, CI)

### 11.1 docker-compose.yml

| Service / block | Disposition | Milestone |
|---|---|---|
| `postgres` | KEEP | |
| `simulation-service` | KEEP | |
| `db-migrate` command chain | EDIT | M36 (add capability seeds), M43 (drop equity seeds from default) |
| `graph-bootstrap` | EDIT or RETIRE | M36 — capability seed replaces graph bootstrap for new visions; keep for back-compat one release |
| `agent-orchestration` | KEEP — env vars added | M39 / M41 |
| `data-pipeline` | EDIT | M39 — signal cron vars; M43 — INGEST_SCHEDULE default → off |
| `sector-service` | EDIT | M43 — ENABLE_LEGACY_INVESTMENT_FEATURES env passthrough |
| `web` | EDIT | M43 — NEXT_PUBLIC_ENABLE_LEGACY_INVESTMENT_FEATURES env passthrough |
| `admin` | KEEP | |

### 11.2 .env.example

Add (M36+):
```
# Signal ingest (M39)
NEWSAPI_KEY=                            # https://newsapi.org (free tier)
USPTO_API_KEY=                          # PatentsView (optional, no key needed)
SIGNAL_INGEST_CRON_DAILY=0 9 * * *      # UTC, 18:00 KST
SIGNAL_INGEST_SCHEDULE=on

# Feasibility (M40)
FEASIBILITY_RECOMPUTE_CRON=30 9 * * *   # UTC, runs after signal ingest

# Legacy gating (M43)
ENABLE_LEGACY_INVESTMENT_FEATURES=false # equity / prediction / community / watchlist
ENABLE_BILLING=false                     # Stripe paths
```

Flip defaults (M43):
```
INGEST_SCHEDULE=off              # was on
RESOLVE_PREDICTIONS_SCHEDULE=off # implicit on by default; flip explicit off
```

### 11.3 CI (GitHub Actions)

| Workflow | Disposition | Notes |
|---|---|---|
| typecheck | KEEP | |
| lint | KEEP | |
| test (unit + integration) | EDIT (M36+) | new test suites added per milestone |
| e2e (Playwright) | EDIT (M37+) | new vision flows |
| build + deploy preview | KEEP | |

CI must run with `ENABLE_LEGACY_INVESTMENT_FEATURES=false` by default. Add a
separate scheduled CI job that runs with the flag true to keep legacy tests
warm (catches regressions if someone needs to reactivate the surface).

---

## Section 12 — Documentation

| File | Disposition | Milestone |
|---|---|---|
| `CLAUDE.md` | EDIT | M36 | "Current Phase" → Phase 3 Vision Monitor; Common Tasks rename ("새 vision 추가") |
| `DESIGN.md` | EDIT (HEAVY) | M36 | §1 lede update; §14 banner DEPRECATED; §9 supersession note linking to PIVOT.md |
| `README.md` | EDIT | per milestone | feature table updated each slice (per repo convention) |
| `docs/PIVOT.md` | KEEP | | source of truth for strategy |
| `docs/REFACTOR.md` | KEEP — this file | | source of truth for surgery |
| `docs/tasks/current.md` | EDIT per milestone | | already pivot-redirected |
| `docs/adr/` | NEW: ADR-NNN-pivot-vision-monitor.md | M36 | record the strategic decision formally |

---

## Section 13 — Data migration plan

**Position**: zero data destruction. Investment data stays in DB, simply
unreachable through the UI when the flag is off.

| Concern | Resolution |
|---|---|
| Existing SectorEquity / EquityQuote / EquityFinancial rows | Retained in place. Tables marked DEPRECATED in schema.prisma. |
| Existing Prediction / PredictionResult rows | Same. |
| Existing GraphNode / GraphEdge rows | M36 introduces Capability + CapabilityDependency; existing graph rows kept for one release as fallback. M37+ uses Capability tables. |
| Existing Scenario rows | Untouched. Sectors → Visions is a product-language change only. |
| User accounts / sessions / billing | Untouched. |
| Audit logs | Untouched. |

**Rollback plan** (if pivot needs to be reversed):
1. Re-enable `ENABLE_LEGACY_INVESTMENT_FEATURES=true`
2. Re-add seed:equities chain to db-migrate
3. Restore investment routes from git (since they were ARCHIVE not DELETE)
4. Capability/Signal/Risk tables can co-exist; no destructive migration needed.

Rollback is a config change, not a code rollback. This is by design.

---

## Section 14 — Backward compatibility timeline

| Phase | Status | When |
|---|---|---|
| Pre-M36 | All current routes alive. | now |
| M36-M37 | Hero page + investment routes both alive. `/sectors/*` and `/visions/*` both work. | weeks 1-2 |
| M38-M42 | Both URL spaces alive. Investment surface still rendered. | weeks 2-6 |
| M43 | Investment routes hidden behind flag (default off). `/sectors/*` 301 → `/visions/*`. | week 7 |
| M44 | `/sectors/*` redirects removed. Single URL space. | week 8 |
| M44 + 30d | Flag-gated code still in repo. | week 12 |
| M44 + 60d | Audit: if legacy flag never enabled by anyone, propose deletion PR. | week 16 |

---

## Section 15 — Risk callouts (cross-cutting refactors)

### 15.1 `GraphNode` / `GraphEdge` retirement (M36)

These tables were added in M7 (graph-as-source-of-truth) but in practice
are *visualization decoration* for the existing sims. The Capability /
CapabilityDependency tables (M36) replace them functionally.

**Risk**: production data uses GraphNode for the `/sectors/[slug]/graph`
view's labels and positions. If we retire mid-pivot the graph page breaks.

**Mitigation**: M36 keeps GraphNode/GraphEdge alive. M38 introduces parallel
Capability data. M42 demotes the graph view to drill-down. M43 audits whether
GraphNode is still used anywhere; if not, M44 drops in a separate slice.

### 15.2 `propose` / `agent.propose` rename (M41)

The current `agent.propose` tRPC mutation kicks off a sector-proposal
workflow. M41 reshapes it to Vision Builder.

**Risk**: existing admin UI hits `agent.propose`. Test suite has
`test_propose_sector.py`. Type-check fails if signature changes.

**Mitigation**: M41 introduces `vision.propose` as the new name; `agent.propose`
becomes a thin alias that calls `vision.propose` and logs a deprecation
warning. Both work for one release. M44 removes the alias.

### 15.3 `Decomposition` schema rename (M41)

`agent_orchestration.schemas.Decomposition` is currently the tree shape.
M41 changes it to vision capability shape.

**Risk**: existing workflow tests assert against `Decomposition` shape.

**Mitigation**: M41a introduces `VisionDecomposition` as a new schema; old
`Decomposition` kept and the legacy workflow path stays. M41b adds new
endpoints. M41c migrates default tests + Conductor to the new schema. Old
schema retained one release as type alias.

### 15.4 `prompts/decomposition.md` rewrite (M41)

Existing prompt file gets a substantial rewrite.

**Risk**: prompt cache keys change; cached prefix invalidated. One spike
in LLM cost on first vision proposal after deploy.

**Mitigation**: write new prompt as `vision_decomposition.md`. Keep
`decomposition.md` as-is for the legacy workflow alias. New conductor uses
new prompt.

### 15.5 Investment tests skip pattern (M43)

40% of data-pipeline tests rely on yfinance / DART / EDGAR shapes. Skipping
them via `ENABLE_LEGACY_INVESTMENT_FEATURES` env risks them rotting.

**Mitigation**: weekly scheduled CI job with the flag on (see §11.3). Catches
regressions before someone reactivates the surface.

### 15.6 `graph-impact.ts` semantic shift (M38)

This file currently computes equity impact via graph traversal. M38
repurposes it for capability dependency traversal.

**Risk**: the function signature stays the same but the meaning changes —
tests pass but downstream UI may render confusing labels.

**Mitigation**: rename to `capability-impact.ts` at M38; old name kept as
re-export for one release. Update `equities-table.tsx` (already going to be
archived) to use deprecated alias.

---

## Section 16 — Order of operations within each milestone

For milestones that touch many files, here's the recommended PR sequence.

### M36 (3 PRs)

1. **PR-M36a**: schema + migration + admin shell renaming (`sectors/*` → `visions/*` page on admin only, no logic change). 1 day.
2. **PR-M36b**: tRPC `vision.ts` + `capability.ts` + `risk.ts` + `feasibility.ts` (CRUD only, no logic). 1 day.
3. **PR-M36c**: DESIGN.md + CLAUDE.md + README updates. ADR-NNN-pivot. 0.5 day.

### M37 (4-5 PRs)

1. **PR-M37a**: new `packages/ui` components (FeasibilityGauge, CapabilityCard, etc.) + Storybook stubs. 1.5 days.
2. **PR-M37b**: `/visions` + `/visions/[slug]` layout + Overview hero with fixtures. 1.5 days.
3. **PR-M37c**: sub-nav + Playground (rename from manual) + Sources (rename). 0.5 day.
4. **PR-M37d**: `/sectors/*` → `/visions/*` 301 redirects + sector-nav drop investment tabs. 0.5 day.
5. **PR-M37e**: page tour + onboarding modal copy update + a11y pass. 1 day.

### M38 (3 PRs)

1. **PR-M38a**: capability seed data JSON (curated content) for 3 visions. 1.5 days.
2. **PR-M38b**: seed scripts + db-migrate chain wiring + tests. 0.5 day.
3. **PR-M38c**: Capability detail page + hero wires to DB (drop fixtures). 1.5 days.

### M39 (5-6 PRs)

1. **PR-M39a**: SignalSource Protocol + arXiv adapter + tests. 1.5 days.
2. **PR-M39b**: SignalExtractor agent workflow + prompt + Pydantic schema + eval. 1.5 days.
3. **PR-M39c**: Signal ingest cron + main.py wiring + Signals tab UI. 1 day.
4. **PR-M39d**: NewsAPI adapter + tests. 1 day.
5. **PR-M39e**: USPTO adapter + tests. 1 day.
6. **PR-M39f**: monitoring tab signal-health card. 0.5 day.

### M40 (3 PRs)

1. **PR-M40a**: `feasibility/*.py` module + tests (golden cases). 1.5 days.
2. **PR-M40b**: ScoreUpdater agent + recompute_feasibility cron + sector-service `feasibility.*` tRPC. 1.5 days.
3. **PR-M40c**: hero wires trajectory + ETA window to VisionFeasibility history. 1 day.

### M41 (5-6 PRs)

1. **PR-M41a**: new Pydantic schemas (VisionDecomposition, CapabilityDraft, RiskDraft, etc.) + type aliases for old names. 1 day.
2. **PR-M41b**: workflows.py → workflows/ split + reshape per-workflow files. 1.5 days.
3. **PR-M41c**: new prompt files + tests. 1 day.
4. **PR-M41d**: Conductor (VisionBuilderConductor) + repo.py vision_draft state + `/visions/new` admin UI. 1.5 days.
5. **PR-M41e**: eval cases (5 visions) + iteration. 1.5 days.

### M42 (2 PRs)

1. **PR-M42a**: capability badges on drivers + WhatIfFeasibility callout + projection helper. 1 day.
2. **PR-M42b**: causal-graph demote + capability-detail dependency graph drill-down. 1.5 days.

### M43 (2 PRs)

1. **PR-M43a**: feature-flags.ts + per-route guards + crons gating. 1 day.
2. **PR-M43b**: docs/README updates + DESIGN.md §14 banner. 0.5 day.

### M44 (3-4 PRs)

1. **PR-M44a**: Fusion sim + register. 1 day.
2. **PR-M44b**: run Vision Builder for fusion + admin hand-polish + initial signal seed. 2 days.
3. **PR-M44c**: 4-vision landing polish + Twitter screenshot package + README + DESIGN.md. 1 day.
4. **PR-M44d** (optional): drop `/sectors/*` redirect + drop deprecated schema aliases. 0.5 day.

---

## Section 17 — What this refactor explicitly does NOT do

So scope is clear:

- ❌ Does not delete any data
- ❌ Does not break URL backward compatibility before M43
- ❌ Does not introduce new infrastructure (no Temporal Cloud, no Modal/E2B in pivot scope)
- ❌ Does not rebuild the simulator (existing 3 sims become Playgrounds as-is)
- ❌ Does not implement OAuth, multi-tenant, RLS, observability (deferred per PIVOT.md §8)
- ❌ Does not enable monetization (Stripe stays off through M44)
- ❌ Does not change LLM provider routing (M35 dual-provider unchanged)
- ❌ Does not change the Causal Graph data model (CapabilityDependency is additive)

---

## Section 18 — Actor domain (M45 file-by-file)

Companion to PIVOT.md §11.1 and §11.3. M45a = Hero demo lift with
fixtures; M45b = real DB seed + capability wiring.

### 18.1 Prisma — 3 new models + Signal extension

| Path | Disposition | Milestone |
|---|---|---|
| `packages/db/prisma/schema.prisma` | EDIT | M45a | add Actor, VisionActor, CapabilityActor models + Signal.actor_id FK |
| `packages/db/prisma/migrations/20260530_actor_domain/migration.sql` | NEW | M45a | additive (no destructive ops) |
| `packages/db/prisma/seed-actors.ts` | NEW | M45b | per-vision actor seed |
| `packages/db/prisma/seed-data/actors/space-data-center.json` | NEW | M45b | ~12 actors (SpaceX / Lonestar / Starcloud / AMD / NASA / etc.) |
| `packages/db/prisma/seed-data/actors/memory-semi.json` | NEW | M45b | ~10 actors (Samsung / SK hynix / Micron / TSMC / NVIDIA / etc.) |
| `packages/db/prisma/seed-data/actors/sofc.json` | NEW | M45b | ~8 actors (Bloom Energy / Plug Power / Ceres / etc.) |
| `packages/db/prisma/seed-data/actors/fusion-power-grid-parity.json` | NEW | M44b/M45b | seeded with the Fusion vision in M44 |

### 18.2 tRPC

| Path | Disposition | Milestone |
|---|---|---|
| `services/sector-service/src/trpc/actor.ts` | NEW | M45a | `actor.list / get / upsert / delete / linkToCapability / unlinkFromCapability` + vision-scoped reads |
| `services/sector-service/src/trpc/router.ts` | EDIT | M45a | wire actorRouter |
| `services/sector-service/src/trpc/vision.ts` | EDIT | M45a | `vision.getOverview` extended payload: `actors[]` (top-N by relevance), `capabilities[].active_actors[]` (sub-N per cap) |
| `services/sector-service/src/trpc/capability.ts` | EDIT | M45a | `capability.get` includes `actors[]` array |
| `services/sector-service/tests/actor.test.ts` | NEW | M45a | parallel to vision.test.ts — CRUD, link/unlink, role enforcement |

### 18.3 UI — packages/ui

| Path | Disposition | Milestone |
|---|---|---|
| `packages/ui/src/actor-card.tsx` | NEW | M45a | compact card: logo + name + flag + stage pill + latest signal one-liner |
| `packages/ui/src/actor-pill.tsx` | NEW | M45a | inline pill ("SpaceX · 🇺🇸") used inside capability cards + signal rows |
| `packages/ui/src/index.ts` | EDIT | M45a | re-export |
| `packages/ui/package.json` | EDIT | M45a | add subpath exports |

### 18.4 UI — apps/web

| Path | Disposition | Milestone |
|---|---|---|
| `apps/web/src/lib/vision-client.ts` | EDIT | M45a | infer `ActorInOverview` type from vision.getOverview output; add fetchActors / fetchActor wrappers |
| `apps/web/src/app/visions/_fixtures/space-data-center.ts` | EDIT | M45a | extend with actors[] for the Hero demo |
| `apps/web/src/app/visions/_fixtures/memory-semi.ts` | EDIT | M45a | add actors[] (minimal) |
| `apps/web/src/app/visions/_fixtures/sofc.ts` | EDIT | M45a | add actors[] (minimal) |
| `apps/web/src/app/visions/[slug]/page.tsx` | EDIT | M45a | new "Actors" band between Capabilities and Economics; CapabilityCard's `latestSignal` slot extends to also show top-3 active actors |
| `apps/web/src/app/visions/[slug]/layout.tsx` | EDIT | M45a | add "Actors" sub-nav tab between Risks and Economics |
| `apps/web/src/app/visions/[slug]/actors/page.tsx` | NEW | M45a | actor list per vision — group by category + country |
| `apps/web/src/app/visions/[slug]/actors/[key]/page.tsx` | NEW | M45a/b | actor detail: capability list (where this actor is active), recent signals about this actor, external links |
| `apps/web/src/app/visions/[slug]/capabilities/[key]/page.tsx` | EDIT (when M38 lands) | M45b | capability detail shows the capability_actors mapping with roles |

### 18.5 Signal pipeline — extractor extension

| Path | Disposition | Milestone |
|---|---|---|
| `services/agent-orchestration/agent_orchestration/workflows/signal_extractor.py` | EDIT | M45b (or M39+M45 combined slice) | extractor input now includes `vision.actors[]` with their `signal_keywords`; output schema adds `actor_id`; populates Signal.actor_id when an actor's keywords match |
| `prompts/signal_extractor.md` | EDIT | M45b | per-vision actor list injected as prompt context |
| `services/agent-orchestration/agent_orchestration/schemas.py` | EDIT | M45b | SignalScoring.actor_key added (resolved to actor_id at write time) |
| `services/agent-orchestration/tests/test_signal_extractor.py` | EDIT | M45b | add 3 eval cases where actor tag is expected |

### 18.6 Backfill script (one-shot)

| Path | Disposition | Milestone |
|---|---|---|
| `packages/db/prisma/scripts/backfill-actors-from-equities.ts` | NEW (one-shot, do not wire into db-migrate) | M45b | reads existing SectorEquity rows → emits draft Actor JSON for admin review; admin runs `seed-actors.ts` after editing |

### 18.7 Documentation

| Path | Disposition | Milestone |
|---|---|---|
| `DESIGN.md` | EDIT | M45a | add §15 "Actors" — domain definition + relationship to capabilities |
| `README.md` | EDIT | M45a | feature row "Actor analysis (M45)" |
| `docs/adr/0002-actor-domain.md` | NEW | M45a | decision record: why fresh Actor model not equity repurpose |
| `prompts/vision_decomposition.md` | EDIT | M41+ (Vision Builder) | also emit Actor drafts when decomposing a new vision |

### 18.8 Risk callouts (Actor)

**R-1**: Actor key collisions across visions ("samsung_electronics" could
appear in memory-semi + SoFC). Mitigation: Actor is global; VisionActor
join carries per-vision context.

**R-2**: Signal extractor false-positives — "SpaceX" appearing in unrelated
papers. Mitigation: extractor agent scores actor-tag confidence; we only
set Signal.actor_id when confidence > 0.8. M45b includes per-vision eval
suite (10 hand-labeled signals).

**R-3**: Logo URLs are external — could 404 or change. Mitigation: graceful
fallback to a colored initial-letter avatar in `ActorCard`. Don't host
logos ourselves (licensing).

---

## Section 19 — Community 2.0 (M46 + M47 file-by-file)

Companion to PIVOT.md §11.2 and §11.3.

### 19.1 Prisma — 2 new domains

| Path | Disposition | Milestone |
|---|---|---|
| `packages/db/prisma/schema.prisma` | EDIT | M46 | add VisionProposal, VisionProposalVote models; legacy SectorSuggestion stays deprecated |
| `packages/db/prisma/schema.prisma` | EDIT | M47 | add VisionDiscussion, DiscussionComment, DiscussionVote models |
| `packages/db/prisma/migrations/20260620_vision_proposals/` | NEW | M46 | |
| `packages/db/prisma/migrations/20260628_vision_discussions/` | NEW | M47 | |

### 19.2 tRPC

| Path | Disposition | Milestone |
|---|---|---|
| `services/sector-service/src/trpc/proposal.ts` | NEW | M46 | `proposal.list / get / create / vote / withdraw / adminApprove / adminReject / adminApply` |
| `services/sector-service/src/trpc/discussion.ts` | NEW | M47 | `discussion.list / get / create / vote / comment.create / comment.vote` |
| `services/sector-service/src/trpc/router.ts` | EDIT | M46/M47 | wire |
| `services/sector-service/src/lib/proposal-applier.ts` | NEW | M46 | per-kind apply logic — calls capability.upsert / actor.upsert / risk.upsert etc. with audit-log linkage |
| `services/sector-service/tests/proposal.test.ts` | NEW | M46 | CRUD + voting + apply pipeline integration |
| `services/sector-service/tests/discussion.test.ts` | NEW | M47 | threads + comments + votes |

### 19.3 UI — apps/web

| Path | Disposition | Milestone |
|---|---|---|
| `apps/web/src/app/visions/[slug]/community/page.tsx` | NEW | M46 | vision-anchored community hub (proposal list + recent discussions) |
| `apps/web/src/app/visions/[slug]/community/proposals/page.tsx` | NEW | M46 | full proposal list, filter by kind/status |
| `apps/web/src/app/visions/[slug]/community/proposals/new/page.tsx` | NEW | M46 | submit form with kind picker + dynamic payload editor per kind |
| `apps/web/src/app/visions/[slug]/community/proposals/[id]/page.tsx` | NEW | M46 | detail page + voting + comment timeline |
| `apps/web/src/app/visions/[slug]/community/discussions/page.tsx` | NEW | M47 | discussion thread list |
| `apps/web/src/app/visions/[slug]/community/discussions/[id]/page.tsx` | NEW | M47 | discussion thread + comments |
| `apps/web/src/app/visions/[slug]/layout.tsx` | EDIT | M46 | add "Community" sub-nav tab |
| `apps/web/src/lib/vision-client.ts` | EDIT | M46/M47 | wrappers for proposal.* and discussion.* |

### 19.4 UI — apps/admin

| Path | Disposition | Milestone |
|---|---|---|
| `apps/admin/src/app/proposals/page.tsx` | NEW | M46 | admin queue grouped by status (open / review / approved / rejected) |
| `apps/admin/src/app/proposals/[id]/page.tsx` | NEW | M46 | proposal detail with Approve + Apply button (calls adminApprove + adminApply) |
| `apps/admin/src/app/layout.tsx` | EDIT | M46 | add Proposals nav link |

### 19.5 UI — packages/ui

| Path | Disposition | Milestone |
|---|---|---|
| `packages/ui/src/proposal-card.tsx` | NEW | M46 | proposal summary card (used in community list) |
| `packages/ui/src/proposal-status-pill.tsx` | NEW | M46 | colored status indicator |
| `packages/ui/src/vote-buttons.tsx` | NEW | M46 | +/- vote control with optimistic state |
| `packages/ui/src/discussion-thread.tsx` | NEW | M47 | nested comment rendering |

### 19.6 Reputation system (M47)

| Path | Disposition | Milestone |
|---|---|---|
| `services/sector-service/src/lib/reputation.ts` | NEW | M47 | compute per-user voting weight from proposal-approval rate + discussion score |
| `services/sector-service/src/trpc/proposal.ts` | EDIT | M47 | vote.value multiplied by user's weight; UserScore-like rollup table |
| `packages/db/prisma/schema.prisma` | EDIT | M47 | add UserReputation table (user_id PK + computed metrics) |

### 19.7 Risk callouts (Community 2.0)

**R-1**: Vote brigading / sockpuppets. Mitigation: vote weight starts at
1.0 for everyone; M47 reputation system gates weights; rate-limit votes
per user per minute.

**R-2**: Bad proposal text → bad applied DB rows. Mitigation: admin
approval gate (default policy). Auto-apply only for non-destructive kinds
(FLAG_SIGNAL hides; doesn't delete).

**R-3**: Spam proposals. Mitigation: 1 open proposal per user per vision
at a time; user-level rate limit; honeypot honestly first, captcha if
escalates.

**R-4**: Discussion thread moderation. Mitigation: admin can lock or
delete threads; deleted threads soft-delete with `deleted_at` so audit
survives.

---

## Section 20 — Summary table (all milestones M36-M47)

| ID | Title | Status | PR count | Duration | Key risk |
|---|---|---|---|---|---|
| M36 | Capability schema + product language migration | ✅ shipped | 3 | 2.5d | low |
| M37 | Hero page (hardcoded SDC showcase) | ✅ shipped | 5 | 5d | medium (design) |
| M38 | Capability decomposition (manual seed, 3 sectors) | pending | 3 | 3.5d | medium (curation) |
| M39 | Signal ingest pipeline (arXiv + USPTO + News) | pending | 6 | 6.5d | high (adapter flakiness) |
| M40 | Feasibility scoring engine | pending | 3 | 4d | medium |
| M41 | Vision Builder agent (one-liner → full capability tree) | pending | 5 | 6.5d | high (LLM hallucination) |
| M42 | Simulation → Playground re-positioning | pending | 2 | 2.5d | low |
| M43 | Archive investment features behind flag | pending | 2 | 1.5d | low |
| M44 | Fusion Power showcase + polish | pending | 4 | 4.5d | medium (agent quality) |
| **M45** | **Actor domain + Hero integration** | **NEW** | 4 (M45a×3 + M45b×1) | 6-8d | medium (integration scope) |
| **M46** | **Community 2.0: proposals + voting + admin** | **NEW** | 5 | 5-7d | medium (apply-pipeline kinds) |
| **M47** | **Discussions + reputation** | **NEW** (optional) | 3 | 4-5d | medium (reputation calibration) |

Total: ~45-55 days at 1-person + Claude pace → 9-11 weeks for full
M36-M47 ship. M45 inserts BEFORE M38 (M45a) and AFTER M38 (M45b) per
PIVOT.md §11.4.

---

*End of REFACTOR.md. Cross-link with PIVOT.md per milestone.*
