# Current task — Phase 3 PIVOT: Vision Feasibility Monitor (M36+)

**Last updated**: 2026-05-25. 2026-05-23 pivot from Sector Simulator →
Vision Feasibility Monitor. M36 → M43 + M45a/b + M46a/b/c ✅ shipped.
M44 + M46d/e/f + M47 in flight.

Strategy memo: [PIVOT.md](../PIVOT.md). File-by-file refactor inventory:
[REFACTOR.md](../REFACTOR.md). Decision record:
[ADR-0001](../adr/0001-pivot-vision-monitor.md). Agent / workflow
inventory: [agent-capabilities.md](../agent-capabilities.md).

Pre-pivot M1-M35 history lives in git log — not duplicated here.

## Pivot summary

Investment-tool surface drifted away from the original vision ("우주
데이터센터가 실현 가능한가?"). Reset to a single-page Feasibility Monitor
for any bold technology vision.

| Before → after | |
|---|---|
| Top abstraction | `Sector` (sim) → `Vision` (feasibility) — DB unchanged |
| Main UI | 4-tab workspace → 1-page Feasibility Monitor (hero) |
| Simulation | 주연 → "Playground" sub-tab + WhatIfFeasibility callout (M42) |
| Data ingest | yfinance quotes → arXiv + USPTO + NewsAPI (capability signals) |
| Score | sim outputs → Feasibility Index (4-dim aggregation + Liebig binding) |
| Investment surface (Equity / Prediction-v1 / Watchlist / pre-pivot Community) | core → archived behind `ENABLE_LEGACY_INVESTMENT_FEATURES` (M43, default off) |
| Community | stock-prediction game → Community 3.0 (proposals + tiered predictions + reputation), M46 train |

## Shipped milestones

```
M36 ✅ → M37 ✅ → M45a ✅ → M38 ✅ → M45b ✅ → M39 ✅ → M40 ✅ → M41 ✅
        → M42 ✅ → M43 ✅ → M46a ✅ → M46b ✅ → M46c ✅ → (polish slices) → M44 / M46d-f / M47
```

- [x] **M36** — Capability/Signal/Risk/VisionFeasibility schema + tRPC.
      6 Prisma models, 5 routers, ~20 tests. (3 PRs)
- [x] **M37** — Hero page (hardcoded SDC) + Playground migration +
      onboarding/tour rewrite. (5 PRs: M37a-e)
- [x] **M45a** — Actor schema + tRPC + Hero "Actors" band + capability
      card "active actors" footer + sub-nav tab. Fixture-backed.
- [x] **M38** — Capability/Risk/Feasibility manual seed for 3 visions
      (SDC / Memory / SOFC). Real DB data on the Hero +
      capability-detail page. (2 PRs)
- [x] **M45b** — Actor DB seed + capability_actor wiring + Hero/actors-
      page swap from fixtures to DB.
- [x] **M39** — Signal ingest pipeline + extractor + monitoring.
      SignalSource Protocol + arXiv / USPTO / NewsAPI adapters,
      SignalExtractor agent (haiku tier), ingest cron, full Signals tab,
      admin monitoring health card. (6 PRs: M39a-f)
- [x] **M40** — Feasibility scoring engine — 4-dim aggregator +
      vision-aggregator (Liebig binding) + ETA inference + 90d delta +
      ScoreUpdater agent + daily recompute_feasibility cron. (2 PRs)
- [x] **M41** — Vision Builder agent. NL prompt → PromptValidator
      (haiku) → VisionDecomposition (opus) → DataSourceSelector (sonnet)
      → ValidationGate (DAG + FK + weight-sum) → tRPC commit (single
      Prisma transaction) → admin /visions/new UI → 5-case eval set.
      (5 PRs: M41a-e)
- [x] **M42** — Simulation → Playground re-positioning. Driver →
      capability badges + WhatIfFeasibility callout above the sim chart;
      client-side Liebig aggregator mirrors
      `simulation_service/feasibility/`;
      `Capability.primary_driver_name` drives the driver→capability map.
- [x] **M43** — Investment features archived behind
      `ENABLE_LEGACY_INVESTMENT_FEATURES` (default false). yfinance +
      prediction-resolve crons off by default; legacy tRPC routers gated
      at register-time; legacy routes return 410. Reversible flag flip.
- [x] **M46a** — Community 3.0: Proposal schema + tRPC + minimal
      `/community/proposals` feed.
- [x] **M46b** — Community 3.0: PredictionV2 (tiered: Easy/Medium/Hard
      with auto-assigned multiplier) + resolution cron + leaderboard.
- [x] **M46c** — Reputation tiers + Follow graph + `/u/[id]` profile
      pages.

### Polish slices (post-M43, no separate milestone tag)

- [x] **i18n (ko/en) + theme switcher (dark/light/system) + wider
      page layouts**. Cookie-backed + cross-device sync via
      `User.locale`/`User.theme`. All visible strings in
      `apps/web/src/lib/i18n/dict.ts`. Tone: friendly, not 번역체.
- [x] **Visions visual hub revamp** — domain themes per card, filter
      chips, hero treatment.
- [x] **Multi-step wizards** for proposal (5 steps) + prediction
      creation (3 steps with live tier preview).
- [x] **Legacy UI cleanup** — pre-pivot `/sectors`, `/predict`,
      `/propose`, `/watchlist`, `/my-sectors`,
      `/community/{predict,leaderboard,suggestions,my-predictions}`
      routes deleted (M43 had only archived them).
- [x] **DB squash** — 20 historical migrations consolidated into a
      single init migration to keep clone time bounded.
- [x] **UI hygiene** — phase / version / M-milestone strings stripped
      from visible text; Predictions + Proposals dropped from primary
      nav (they live inside `/community`).

## In flight / next

- [ ] **M44** — Fusion Power as second showcase vision + polish +
      `/visions` 4-tile public landing + Twitter demo thread. Pressure-
      tests the framework on a second vision. 4-6d.
- [ ] **M46d** — Evidence sources: URL OG fetch + PDF/image upload to
      R2 (linkable evidence on proposals + predictions). 3-4d.
- [ ] **M46e** — Admin proposal queue + 1-click apply + audit-log
      linkage. 2-3d.
- [ ] **M46f** — Per-sector community tab + cold-start seed (a couple
      of curated proposals + predictions per vision). 2-3d.
- [ ] **M47** — Discussions + reputation polish. Reddit-style threads +
      nested replies + vote-weight multiplier from proposal-approval
      rate. Calibrate after ~4 weeks of M46 production data. 4-5d.

Per-milestone PR sequence:
[REFACTOR.md §12](../REFACTOR.md#12-pr-sequence-per-milestone).

## Deferred (resume after M47)

- M29 — OAuth providers (Google / GitHub)
- M30 — Multi-tenant scoping (tenant_id + Postgres RLS)
- M31 — Backtest harness (reframed as vision-feasibility backtest, not
  sector-sim backtest)
- M28b — Modal/E2B sandbox for agent-generated capability scoring code
  (M41 made the case for it; not yet a blocker)
- M10b — DART/EDGAR adapters (deprecated; signals pipeline replaces)
- Observability — LangSmith / Helicone integration

## Per-milestone workflow

1. Read PIVOT.md §5 entry for the strategic context
2. Read REFACTOR.md relevant sections (§1-§13 cover the full pivot —
   schema / routes / services / prompts / components / seeds / tests
   / infra / risks / PR sequence)
3. Check REFACTOR.md §12 for the per-milestone PR sequence
4. Execute slice-by-slice; one PR per slice
