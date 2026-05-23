# PIVOT — From "Sector Simulator" to "Vision Feasibility Monitor"

**Date**: 2026-05-23 (initial), 2026-05-23 (Actor + Community 2.0 extension)
**Owner**: Ayoung
**Companion**: [REFACTOR.md](./REFACTOR.md) (file-by-file inventory) +
[ADR-0001](./adr/0001-pivot-vision-monitor.md) (decision record).

---

## 1. TL;DR

We were building "Sector Simulator + investment tools." The user actually
wanted "Will this bold technology vision happen, and when?" Pivot back.

Product one-liner:
> **Pick any bold technology vision. We track every capability it needs,
> every signal that moves it, and roll it up into one number you can
> glance at in 5 seconds.**

Investment-side surface (Equity / Prediction / Watchlist / Community)
archives behind `ENABLE_LEGACY_INVESTMENT_FEATURES` at M43. Simulation
infrastructure stays as a "Playground" sub-tab. Existing space-data-center
sim becomes the first showcase Vision; Fusion Power is the second (M44).

Two extensions added 2026-05-23: **Actors** (the WHO layer — companies +
labs per capability + signal pipeline tagging) and **Community 2.0**
(per-vision proposals + voting + admin apply pipeline).

Execution: M36 → M47, ~9-11 weeks at 1-person pace.

---

## 2. New positioning

**Target users** (priority order):
1. Deep-tech VCs (thesis validation in minutes vs weeks)
2. R&D policy planners (grant funding allocation)
3. Corp strategy (5-10y "where should we be" calls)
4. Curious engineers + founders ("worth working on?")
5. Tech journalists (citation source)

**Category claim**: *"The canonical living monitor for the next 10 years
of technology."* Living, source-grounded, glanceable. The category does
not exist today — Gartner is quarterly PDFs, CB Insights is company-
centric, Polymarket is forecasting without underlying causality.

**Wedge**: Space Data Centers (already curated, multidisciplinary
enough to force all 4 dimension types). Second showcase: Fusion Power.

---

## 3. Core abstraction

```
Vision                                "Space Data Centers"
  ├─ Capability                       "Radiation-hard compute" (×9 for SDC)
  │    ├─ technical 0-100             TRL-like
  │    ├─ economic 0-100              cost curve + mass production
  │    ├─ regulatory 0-100            ITAR / ITU / safety law
  │    └─ supply 0-100                supply chain + talent + capital
  ├─ Actor (M45)                      "SpaceX / Lonestar / NASA" per capability
  ├─ Signal                           arXiv / patent / news / filing → per-dim deltas
  ├─ Risk                             political / legal / supply / safety / ...
  └─ FeasibilityIndex                 Bayesian aggregation + Liebig binding constraint
                                       → vision-level 0-100 + ETA
```

`Vision` is a `Sector` row with `is_vision_eligible=true` — DB schema
keeps the legacy name; product language flips.

---

## 4. The Hero page (M37 demo target)

5-second comprehension target. One page per vision:

```
┌─────────────────────────────────────────────────────────────────┐
│ SPACE DATA CENTERS                              ↻ 14m ago        │
│ "By when will compute in orbit be commercially viable?"          │
│                                                                  │
│              FEASIBILITY        73 / 100   ▲ +8 (90d)            │
│              ETA window  ●─────●─────●     median: 2034 ± 3y     │
│              ████ medium confidence · 9 cap · 142 sig · 5 risks  │
├─────────────────────────────────────────────────────────────────┤
│ CAPABILITIES (sorted by binding-ness)                            │
│ ┌─ Rad-hard compute ⚠ BINDING ─┐ ┌─ Thermal rejection ─┐  ...   │
│ │ 51   ▼ -3                     │ │ 68   ─ 0             │       │
│ │ tech █████ econ █░░ reg ██░  │ │ tech ████ econ ███   │       │
│ │ Latest: MI300 rad-test delayed│ │ Latest: Starcloud 1kW │       │
│ │ Actors: AMD · NVIDIA · Intel │ │ Actors: Starcloud · ESA│       │
│ └───────────────────────────────┘ └──────────────────────┘       │
├─────────────────────────────────────────────────────────────────┤
│ ACTORS (M45) — sorted by relevance                               │
│ ┌─ SpaceX 🇺🇸 public · scaling ─┐ ┌─ Lonestar 🇺🇸 private ─┐ ...│
├─────────────────────────────────────────────────────────────────┤
│ ECONOMICS  orbit vs ground            ▼ crossover ~2034          │
│ RISK BOARD   ITAR · Kessler · insurance · spectrum · CHIPS Act   │
│ LIVE SIGNALS (24h)  papers · patents · news · filings · gov      │
│ Sub-nav: Overview | Capabilities | Actors | Signals | Risks |    │
│          Economics | Playground | Sources                        │
└─────────────────────────────────────────────────────────────────┘
```

---

## 5. Milestones

See [docs/tasks/current.md](./tasks/current.md) for live status. Per-PR
sequencing in [REFACTOR.md §16](./REFACTOR.md#section-16--order-of-operations-within-each-milestone).

| ID | Title | Days | Status | Notes |
|---|---|---|---|---|
| M36 | Capability/Signal/Risk/Feasibility schema + tRPC | 2-3 | ✅ | foundation |
| M37 | Hero page (hardcoded SDC) + Playground migration | 4-6 | ✅ | demo gate met |
| M45a | Actor schema + tRPC + Hero band (fixtures) | 4-5 | next | demo lift |
| M38 | Capability/Risk/Feasibility manual seed | 3-4 | | real DB data |
| M45b | Actor DB seed + capability_actor + signal tagging | 2-3 | | |
| M39 | Signal ingest (arXiv + USPTO + News) + extractor agent | 6-8 | | high risk (adapter flakiness) |
| M40 | Feasibility scoring engine + Score Updater agent | 4-5 | | Liebig binding constraint |
| M41 | Vision Builder agent (one-liner → full tree + actors) | 6-8 | | high risk (LLM hallucination) |
| M42 | Simulation → Playground reposition + WhatIf callout | 2-3 | | |
| M43 | Archive investment behind `ENABLE_LEGACY_INVESTMENT_FEATURES` | 1-2 | | flag-only, no data delete |
| M44 | Fusion Power showcase + 4-tile landing + Twitter demo | 4-6 | | |
| M46 | Community 2.0: VisionProposal + voting + admin apply | 5-7 | after M44 | replaces /community |
| M47 | Discussions + reputation (optional polish) | 4-5 | after 4w M46 prod | |

Total: ~45-55 days, 9-11 weeks.

### 5.1 M45 — Actor domain (split into M45a + M45b)

**Why**: Hero shows capabilities/signals/risks but no actors — the WHO.
VCs / journalists / corp strategy ask "which companies?" first. Adding
country + ticker (when listed) + stage + role-per-capability makes the
Hero immediately actionable.

**Schema** (3 new tables, additive):
- `Actor` (global) — key, name, country, category, ticker?, exchange?,
  stage, blurb, signal_keywords[], logo_url?
- `VisionActor` (M2M Vision↔Actor) — relevance, rationale, display_order
- `CapabilityActor` (M2M Capability↔Actor) — role (`lead | competitor |
  supplier | customer | regulator`), stage override, rationale
- `Signal.actor_id` FK extension — extractor tags signals by company

**Why fresh model, not equity repurpose** (key decision):
- `SectorEquity.driver_links` JSONB is investment-frame, not capability-
  frame
- `sector_exposure_pct` measures revenue share, not relevance
- Labs / govt / standards bodies don't have tickers — equity model
  forces it
- Migration churn > clean schema. Backfill script in M45b reads
  SectorEquity → drafts Actor entries for admin review

**Hero integration**: new Actors band between Capabilities and Economics
(sorted by relevance). Capability cards get "Active actors:" footer
showing top 3.

### 5.2 M46-M47 — Community 2.0

**Why**: `/community/predict` is a stock-prediction game — residue of
the investment surface. The right mechanic for a Vision Monitor is
per-vision *proposals* (data sources, actors, capabilities, score
challenges) with voting + admin-applied changes. Wikipedia-meets-
Polymarket; community curation as a moat.

**7 proposal kinds**:
- `ADD_ACTOR` — propose a new company/lab → calls actor.upsert on apply
- `ADD_DATA_SOURCE` — propose an RSS/API feed → updates ingest config
- `ADD_CAPABILITY` → calls capability.upsert
- `REVISE_CAPABILITY_SCORE` — challenge with evidence → writes new
  CapabilityScore with rationale referencing proposal_id
- `FLAG_SIGNAL` — auto-applies (sets Signal.is_hidden=true)
- `REWORD_RISK` → calls risk.upsert
- `ADD_RISK` → calls risk.upsert (create)
- `ADD_NEW_VISION` — kicks off Vision Builder agent (M41)

**Flow**: submit → community votes (+1/-1, weight 1.0 default) → +5 net
moves to admin queue → admin approves → tRPC mutation applies + audit
log linkage → `Proposal.status=applied`, `applied_audit_log_id=...`.
Auto-apply for non-destructive kinds.

**M47 reputation**: per-user vote-weight multiplier 1.0× → up to 2× based
on proposal-approval rate + discussion score. Calibrate after 4 weeks
of M46 production data.

---

## 6. Founder calls (override-able)

1. **DB rename = NO**. `Sector` column stays; product language is "Vision".
2. **First showcase = SDC** (already curated). Second = Fusion (M44).
3. **Investment features = ARCHIVE behind flag, not DELETE**. Reversible.
4. **Monetization pause until M44**. Stripe stays off.
5. **No new infra in pivot scope** (no Temporal Cloud / Modal sandbox).
6. **Bilingual UI: ko default + en parity**. Twitter share needs en.
7. **Fresh Actor model, not equity repurpose** (see §5.1).
8. **Community after M44**. Need data layer mature before letting users
   propose into it.

---

## 7. Risks (current)

| Risk | Mitigation |
|---|---|
| LLM hallucinates capabilities (M41) | Force `source_url` per draft, admin approval gate, eval set with 5 known visions |
| Signal extractor noise — low-relevance papers shift scores | Per-dim confidence threshold; `Signal.actor_id` only set when keyword match confidence > 0.8 |
| "73/100" feels arbitrary to readers | Every number hover → drill-down to source signals + rationale; Sources tab is first-class |
| Framework over-fits SDC → doesn't generalize | M44 pressure-tests on Fusion; eval set covers 5 visions (SDC, fusion, quantum, humanoid, mRNA) |
| Investment-tool users frustrated by archive | Flag stays togglable; data preserved |
| Founder bandwidth (1 person, 9-11 weeks) | Each PR is independently mergeable; M37 hero demo is the first vital screenshot |
| Signal extractor false-positives on common names ("SpaceX" in unrelated papers) | Per-extractor confidence score; tag only when > 0.8 |

---

## 8. Reversibility

Pivot is config-flippable, not git-revert:
- No data destruction
- Legacy tables stay; UI gated by `ENABLE_LEGACY_INVESTMENT_FEATURES`
- One env-var flip restores the old surface
- Reactivation as 1-PR config change, not code revert

If pivot misses (no traction by M44 + 30d), flip flag → done.

---

*M45a follows next. See REFACTOR.md §18 for file-by-file plan.*
