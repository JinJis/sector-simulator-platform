# Current task — Phase 3 PIVOT: Vision Feasibility Monitor (M36+)

**Status**: 2026-05-23 pivot from Sector Simulator → Vision Feasibility
Monitor. M36 + M37 ✅ shipped. M38 → M47 in flight.

Strategy memo: [PIVOT.md](../PIVOT.md). File-by-file refactor inventory:
[REFACTOR.md](../REFACTOR.md). Decision record: [ADR-0001](../adr/0001-pivot-vision-monitor.md).

Pre-pivot M1-M35 history lives in git log — not duplicated here.

## Pivot summary

Investment-tool surface drifted away from the original vision ("우주
데이터센터가 실현 가능한가?"). Reset to a single-page Feasibility Monitor
for any bold technology vision.

| Before → after | |
|---|---|
| Top abstraction | `Sector` (sim) → `Vision` (feasibility) — DB unchanged |
| Main UI | 4-tab workspace → 1-page Feasibility Monitor (hero) |
| Simulation | 주연 → "Playground" sub-tab |
| Data ingest | yfinance quotes → arXiv + patents + news + policy (capability signals) |
| Score | sim outputs → Feasibility Index (4-dim Bayesian aggregation + binding constraint) |
| Investment surface (Equity / Prediction / Watchlist / Community) | core → archived behind `ENABLE_LEGACY_INVESTMENT_FEATURES` (M43) |

## Active milestones

Execution order (M45a slots BEFORE M38 for Hero demo lift; M45b AFTER M38
for DB wiring):

```
M36 ✅ → M37 ✅ → M45a → M38 → M45b → M39 → M40 → M41
       → M42 → M43 → M44 → M46 → M47
```

- [x] **M36** — Capability/Signal/Risk/VisionFeasibility schema + tRPC.
      Shipped in 3 PRs.
- [x] **M37** — Hero page (hardcoded SDC showcase). Shipped in 5 PRs.
      `/visions` landing + `/visions/[slug]` hero + 7-tab sub-nav +
      Playground migration + onboarding/tour rewrite.
- [x] **M45a** — Actor schema + tRPC + Hero "Actors" band + capability
      card "active actors" footer + sub-nav tab. Fixture-backed for SDC.
- [x] **M38** — Capability decomposition (manual seed, 3 sectors).
      seed-capabilities.ts / seed-risks.ts / seed-feasibility.ts. Real
      DB data on the Hero.
- [x] **M45b** — Actor DB seed + capability_actor wiring + replace
      fixtures with DB.
- [x] **M39** — Signal ingest (arXiv + USPTO + NewsAPI) + extractor
      agent (haiku) + actor tagging. Shipped in 6 PRs.
- [x] **M40** — Feasibility scoring engine (4-dim aggregation + Liebig
      binding constraint + ETA inference + daily recompute cron).
      Shipped in 2 PRs.
- [x] **M41** — Vision Builder agent: NL prompt → validator (haiku)
      → decomposition (opus) → data-source selector (sonnet) →
      validation gate (DAG + FK + weight-sum) → tRPC propose/commit
      with full Prisma transaction → admin /visions/new UI → 5-case
      eval set. Shipped in 5 PRs (M41a-e).
- [ ] **M42** — Simulation → Playground re-positioning. Driver capability
      badges + WhatIfFeasibility callout above sim chart. 2-3d.
- [ ] **M43** — Archive investment features behind
      `ENABLE_LEGACY_INVESTMENT_FEATURES` (default false). Disable
      yfinance + prediction-resolve crons by default. 1-2d.
- [ ] **M44** — Fusion Power as second showcase vision + polish +
      `/visions` 4-tile public landing + Twitter demo thread. 4-6d.
- [ ] **M46** — Community 2.0: VisionProposal schema + 7 proposal kinds
      + voting + admin approve/apply pipeline with audit log linkage.
      Replaces the archived prediction game. 5-7d.
- [ ] **M47** — Discussions + reputation (optional polish). Reddit-style
      threads + nested replies + vote-weight multiplier from
      proposal-approval rate. 4-5d. Calibrate after 4 weeks of M46
      production data.

**Total** (M36 → M47): ~45-55 days at 1-person + Claude pace, ~9-11 weeks.

Per-milestone PR sequence: [REFACTOR.md §16](../REFACTOR.md#section-16--order-of-operations-within-each-milestone).

## Deferred (resume after M47)

- M29 — OAuth providers (Google / GitHub)
- M30 — Multi-tenant scoping (tenant_id + Postgres RLS)
- M31 — Backtest harness (reframed as vision-feasibility backtest, not
  sector-sim backtest)
- M28b — Modal/E2B sandbox for agent-generated capability scoring code
  (M41 may surface need)
- M10b — DART/EDGAR adapters (deprecated; signals pipeline replaces)
- Observability — LangSmith / Helicone integration

## Per-milestone workflow

1. Read PIVOT.md §5 entry (or §11 for M45-M47)
2. Read REFACTOR.md relevant sections (§1-§17 for M36-M44; §18-§19 for
   M45-M47)
3. Check REFACTOR.md §16 PR sequence
4. Execute slice-by-slice; one PR per slice
