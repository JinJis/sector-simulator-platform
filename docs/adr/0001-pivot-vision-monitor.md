# ADR-0001 — Pivot from "Sector Simulator" to "Vision Feasibility Monitor"

- **Status**: accepted
- **Date**: 2026-05-23
- **Deciders**: Ayoung
- **Supersedes**: parts of DESIGN.md §9 (roadmap), §10 (business model),
  §14 (Equities domain — fully deprecated)

## Context

Over Phase 1 (M1-M10) and Phase 2 (M5-M35) the platform shipped a
working sector-simulation product on the original DESIGN.md vision:
"산업을 시뮬레이션 가능한 인과 그래프로 변환." Phase 2.5 (DESIGN.md
§14, added 2026-05-20) introduced a new domain — SectorEquity /
EquityFinancial / EquityQuote / MarketFactor — in response to a
single user request about "key player 종목 분석." Subsequent slices
(M5, M32, M33) added Prediction / Community / Watchlist / "/my-sectors"
on top.

By 2026-05-23 the product surface has drifted:

- 4 of 7 user-app top-level routes are investment tools
  (/predict, /community, /watchlist, /my-sectors)
- 2 of 9 sector hub sub-tabs are investment tools (equities,
  compare-stocks)
- 5 of 22 Prisma models are investment-domain (SectorEquity,
  EquityQuote, EquityFinancial, Prediction, PredictionResult)
- Half of the data-pipeline service exists to refresh yfinance /
  EDGAR / DART data

The founder reviewing the product (2026-05-23) noted that this is not
what they set out to build. The original intent — "Will [bold
technology vision like orbital data centers] actually happen?" — has
been buried under a stock-tracking layer. They want to pivot back.

## Decision

We pivot the product framing from "Sector Simulator" (investment-tool
shape) to **"Vision Feasibility Monitor"** — a single-page, source-
grounded readout of how close a major technology vision is to reality,
roll up from multi-dimensional capability scores (technical / economic
/ regulatory / supply) plus a live signal feed.

Concrete reframe:

- **Sector → Vision** in product language; DB column name unchanged.
  An existing `Sector` row with `is_vision_eligible = true` IS a Vision.
- **The Hero** (`/visions/[slug]`) is one 5-second-comprehension page:
  Feasibility Gauge (0-100 + delta + ETA window) + Capability cards
  (4-dim bars, latest signal) + Risk board + Economics curve + Live
  signal feed.
- **Simulation demoted to Playground**: sliders move from the primary
  workspace to a sub-tab. Driver changes can preview a what-if
  Feasibility delta.
- **Investment surface archived** behind
  `ENABLE_LEGACY_INVESTMENT_FEATURES` (default false at M43). No data
  destruction — rows retained, UI hidden.
- **Signals replace stock quotes** as the daily ingest: arXiv,
  USPTO/KIPO, NewsAPI, govt feeds drive capability score updates
  through an extractor agent (haiku tier).
- **Universal**: the same template (Vision → Capabilities → Signals →
  Risks → Feasibility) must work for any technology vision the user
  phrases. M41 Vision Builder agent generates the capability tree
  from a one-line vision.

Execution: M36 → M44 (8-10 weeks). See docs/PIVOT.md for strategic
memo + milestone outline, docs/REFACTOR.md for file-by-file refactor
inventory.

Founder calls (override-able):

1. DB column rename = NO. Migration churn > value.
2. First showcase vision = space-data-center (already curated).
   Second = fusion-power-grid-parity (M44).
3. Investment features = ARCHIVE behind flag, not DELETE.
4. Monetization pause until M44.
5. No new infra (Temporal Cloud / Modal / E2B) in pivot scope.
6. Bilingual UI: ko default + en parity.

## Consequences

### Positive

- Recovers original product narrative — the platform answers "Will X
  happen?" which is what the founder set out to build.
- Broader audience: not just investors. VCs (deep-tech thesis check),
  R&D policy planners, corp strategy, curious engineers, journalists.
- Better viral coefficient — each Vision page is screenshot-shareable.
- Capability scoring framework generalizes; one template for many
  visions.
- All prior platform investments (Postgres + Prisma, dual-LLM
  Vertex AI, agent orchestration, provenance system, 3 existing sims
  that become Playgrounds) are reused.

### Negative

- ~3 months of investment-feature work (Equity / Prediction /
  Community / Watchlist) becomes archived code. Estimated 30+ files
  hidden behind a flag.
- Existing alpha users who came for the stock-prediction game lose
  their use case. Mitigation: the flag can be flipped back on for
  them while we figure out how (or whether) to re-incorporate that
  use case.
- M29 (OAuth), M30 (multi-tenant), M31 (backtest harness) deferred
  past M44. The platform stays single-tenant + local-auth-only
  through Q3.
- Existing tests across data-pipeline / Prisma / sector-service that
  cover legacy features get either skipped or re-tagged; risk of
  rot mitigated by a weekly CI job running with the flag on.

### Reversibility

The decision is highly reversible by design:

- No data destruction. Legacy tables retain rows.
- `ENABLE_LEGACY_INVESTMENT_FEATURES=true` re-enables the old surface
  in one env var flip.
- Migration is purely additive — `git revert` is not the rollback
  path; config + UI gating is.

If the pivot misses (no traction by M44 + 30 days), reverting is a
one-PR change to default the flag to true and restore default landing
URL.

## Open follow-ups

- ADR-0002 will document the M40 feasibility aggregation formula
  decision (weighted mean vs Bayesian vs strict Liebig).
- ADR-0003 will document the i18n storage choice (column-per-locale
  vs JSON blob) — deferred to M37 or M38.
- ADR-0004 will document the eventual delete vs archive decision for
  legacy investment tables, scheduled for M44 + 60d.
