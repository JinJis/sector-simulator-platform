# DESIGN.md — Vision Feasibility Monitor

**Owner**: Ayoung · **Last updated**: 2026-05-25.

> Developer operational context is in [CLAUDE.md](./CLAUDE.md). Active milestones live in
> [docs/tasks/current.md](./docs/tasks/current.md). The Phase 4 data-pipeline algorithm design
> is described in [docs/architecture/composition.md](./docs/architecture/composition.md). The
> active agent inventory is listed in [docs/agent-capabilities.md](./docs/agent-capabilities.md).
>
> This document retains *durable strategic content* only — superseded sections such as
> old roadmaps, business models, IA sitemaps, and legacy equities lists are preserved in the
> git history. If you require historical context on the Phase 3 pivot (from Sector Simulator
> to Vision Feasibility Monitor), refer to [docs/archive/pivot.md](./docs/archive/pivot.md).

---

## 1. Vision

### 1.1 One-line

> **Pick any bold technology vision — orbital data centers, fusion power,
> room-temperature superconductors. We track every capability it needs,
> every signal that moves it, and roll it up into one number you can
> glance at in 5 seconds.**

### 1.2 The problem

Answers about technology feasibility are fragmented across various sources:
- **Analysis reports are immediately outdated**: Publications like the Gartner Hype Cycle or MIT Tech Review 10 Breakthrough Technologies are released quarterly or annually as heavy, static PDFs.
- **Black-box conclusions**: Statements like "Demand for AI memory will explode" are common, but the underlying causal structures, assumptions, and primary sources remain completely opaque.
- **No "What-If" testing**: Stakeholders cannot immediately simulate scenario shifts, such as "What if rocket launch costs drop by another 50%?"
- **High entry barriers for analysis**: Undertaking an analysis for a newly emerged technology vision (e.g. brain-computer interfaces or space-based computing) routinely demands months of expensive, bespoke expert research.

### 1.3 The solution

1. Decompose each technological **Vision** into ~10 distinct, essential **Capabilities** spanning technical, economic, regulatory, and supply chain requirements.
2. Feed daily **Signals** (arXiv academic papers, patents, news, government briefs) through a lightweight Extractor agent to automatically update capability scores.
3. Compute the overall **FeasibilityIndex** via a Bayesian rollup mechanism capped by Liebig's binding constraints, producing a single 0–100 composite score and an ETA distribution.
4. Establish an **Actor** layer to track the public corporations, private startups, national labs, and academic groups actively competing on or driving these capabilities.
5. Run a continuous background **Crawler service** to ingest real-world signals. If it discovers new actors, capabilities, or risks, the `@feasibility_bot` automatically drafts a `CommunityProposal` for user-voting curation.
6. Provide the **Playground** simulator as a secondary feature, allowing users to slide drivers and interactively explore technology structures.

### 1.4 Differentiator

| Existing | Limitation | Our edge |
| :--- | :--- | :--- |
| **MIT Tech Review breakthroughs** | annual PDF, static | living, daily-updating, source-grounded |
| **Gartner Hype Cycle** | quarterly, opaque sources | every number drills to its primary source |
| **CB Insights** | company-centric, not tech-centric | focused entirely on technology visions |
| **Polymarket** | game-shaped, no causality | full causality (capability tree ↔ signals) |
| **Wood Mackenzie / IEA** | sector-deep but $25k/y | broad set of visions, freemium tier |
| **arXiv / patent DBs** | raw signal, no aggregation | signals systematically aggregate to capability scores |

---

## 2. Users & personas

Priority order:

| # | Persona | Core job | Primary use |
| :--- | :--- | :--- | :--- |
| **1** | **Deep-tech VC partner** | Thesis validation | "Should I write a $20M check into orbital DCs?" — 5min on Hero, sub-tabs as needed |
| **2** | **R&D policy planner** | Grant allocation | "Where should we deploy program funding?" — compare 5+ visions side by side |
| **3** | **Corp strategy planner** | 5-10y placement | "Where should we position ourselves next?" — drill into capability cards |
| **4** | **Curious engineer / founder** | "Worth working on?" | scroll feed of capability movements over time |
| **5** | **Tech journalist** | Citation source | drill into source-grounded signals; embed Hero charts in articles |

*Every target group except persona #4 acts as a domain contributor (submitting proposals or voting on bot-drafted proposals).*

---

## 3. Core abstractions

```
Vision (1 row = Sector with is_vision_eligible=true)
  ├─ Capability   tech / econ / reg / supply scores (CapabilityScore time series)
  ├─ Actor        global Company/Lab/Govt entities; per-capability roles
  ├─ Signal       paper / patent / news / filing / gov / vendor / dataset / social
  ├─ Risk         political / legal / supply / safety / env / fin / social
  └─ Feasibility  vision-level composite + ETA P10-median-P90
```

The Phase 4 layer on top runs a continuous **Crawler** service that pushes new `Signal` and `EconomicsDatapoint` rows into the model, stashing drafts for `@feasibility_bot` to publish as `CommunityProposal` cards whenever a new entity is detected. See [docs/architecture/composition.md](./docs/architecture/composition.md).

*   **Pipeline execution order**:
    Signal ➔ ExtractorAgent (fast tier) ➔ per-dim deltas + actor tags ➔ ScoreUpdaterAgent (balanced) ➔ CapabilityScore time series ➔ VisionFeasibility composite snapshot (via Liebig binding constraints).

---

## 4. Features

Live status is detailed in [docs/tasks/current.md](./docs/tasks/current.md).
This list highlights durable functional abstractions, focusing on feature *shape* rather than current state.

*   **F1. Vision creation**: Natural-language question ➔ Vision Builder Conductor (PromptValidator ➔ Research ➔ VisionDecomposition ➔ DataSourceSelector ➔ ValidationGate) ➔ admin review ➔ single-transaction tRPC commit.
*   **F2. Signal ingest (continuous)**:
    *   Direct adapters: arXiv papers, USPTO Patents, News RSS, and government feeds.
    *   Synthesis: Gemini Deep Research Agent for state-of-X summaries that no single search API can synthesize.
*   **F3. The Hero**: One-page 5-second comprehension per vision. Embeds FeasibilityGauge, trajectory, ETA window, capability cards, actors band, risk board, and the **Live Pulse widget** (ingest ticker, last 24h). 8 sub-tabs route to detailed views.
*   **F4. Playground**: Interactive simulator sub-tab. Driver sliders + driver→capability badges + WhatIfFeasibility callout showing composite index shifts based on assumed parameters.
*   **F5. Provenance**: Every score number on the Hero drills to its primary source. `Signal.source_url` is strictly mandatory. Pydantic enforces `source_ref` constraints on every LLM-generated draft.
*   **F6. Community**: Per-vision proposal workflow (`add_driver`, `add_equity`, `add_capability`, `add_risk`, `add_actor`, `add_signal_source`, `edit`, `other`) with vote mechanism, admin approval queue, and automated applier code. Tiered prediction betting resolution.
*   **F7. Bot-authored proposals**: `@feasibility_bot` detects new actors / capabilities / risks from crawled feeds, drafts a `CommunityProposal` with linked evidence, and submits it for curation.
*   **F8. Admin Crawler Cockpit**: `/admin/queue` scheduler cockpit, monitoring cron health and orchestrator budgets. Admin can adjust lookback windows and signal ceilings dynamically via SQLAdmin.
*   **F9. Vision Visualization pack**: CapabilityRadar, FeasibilityTimeline, CostCurveCrossover, ActorBubble, and RiskHeatmap with complete dark and light theme parity.
*   **F10. i18n + theme**: Cookie-backed `ko` (default) / `en` and dark/light/system theme parity. The Korean translation strictly avoids translation-ese, utilizing a natural, friendly polite form (존댓말).

---

## 5. Agent topology

Cross-reference [CLAUDE.md "Tech Stack → Agent / LLM"](./CLAUDE.md#agent--llm) for routing rules and system-account authentication details.

| Workflow | LLM Tier | Triggered by |
| :--- | :--- | :--- |
| **VisionResearch** | balanced | new vision proposal |
| **VisionDecomposition** | deep | post-Research |
| **CapabilityToDriver** | balanced | post-Decomposition |
| **CapabilityDependencies** | deep | post-CapabilityToDriver |
| **CapabilityScoringCode** | deep | post-Dependencies |
| **CodeReview** | deep | post-CodeGen |
| **SignalExtractor** | fast | new crawled signal (~100–1000/day) |
| **ScoreUpdater** | balanced | new signal arrives for a capability |
| **DeepResearch** | pro-preview (deep, grounded) | daily digest task |
| **EntityDetector** | balanced | post-signal-batch comparison |
| **ProposalDrafter** | balanced | high-confidence newly-detected entity |

All output enforces strict JSON schemas via Gemini's native `response_schema`, falling back to prompt-instructions + corrective re-prompting if the state compiler overflows.

---

## 6. System architecture

Refer to [CLAUDE.md "Repository Structure"](./CLAUDE.md#repository-structure) for directory layouts.
*   `data-pipeline`: Direct-adapter signal sweeps (arXiv, USPTO, NewsAPI) + score recompute crons. Mounts SQLAdmin at `/admin`.
*   `simulation-service`: Core feasibility math: 4-dim aggregation, Liebig binding constraints, and ETA stochastic inference.
*   `agent-orchestration`: Vision Builder Conductor and score extractor / updater workflows.
*   `crawler`: Always-on Docker container. Gemini Grounded Research and `@feasibility_bot` proposal dispatcher.

---

## 7. Non-functional requirements

### 7.1 Performance budgets (P95 target)
- Hero page TTFB: **< 500ms**
- Single tRPC database round trip: **< 200ms**
- Capability detail slideout: **< 300ms**
- Playground slider re-sim (cached): **< 800ms**
- LLM streaming time-to-first-token (TTFT): **< 1s**

### 7.2 Cost
- **Target**: Month LLM cost per user < $30 (Gross margin target > 80%).
- **Active Strategies**:
  1. **Prompt caching**: Gemini `cache_control: ephemeral` flag on static system blocks.
  2. **Result caching**: Cache keys derived from `hash(sector_slug, drivers_dict)`.
  3. **Model routing**: Fast models for extraction, balanced for updates, and deep models exclusively for critical coding and structural decomposition.

### 7.3 Security
- LLM-generated scoring code runs exclusively inside an isolated E2B/Modal sandbox.
- Every admin interaction is recorded to an immutable `AuditLog` table.
- Secrets are managed via Doppler/Railway — never committed to git.

---

## 8. UX principles

1. **Show, don't tell** — prioritizing interactive data viz and gauge charts over long prose.
2. **Progressive disclosure** — clean aggregated metrics first, sliding out to granular signal details.
3. **Uncertainty visible** — rendering honest P10-P90 confidence bands on every single score indicator.
4. **Provenance always one click away** — ensuring every score drills directly to its original URL.
5. **Dark mode default** — optimized for technical density and visual longevity.
6. **Natural translations** — conversational English and polite, friendly Korean (존댓말), rejecting formal literal translation styles.

---

## 9. Risks & mitigations

| Risk | Severity | Mitigation |
| :--- | :--- | :--- |
| **LLM hallucinates capability requirements** | High | Mandatory `source_url` per draft; admin checkpoint; 5-vision canonical eval set |
| **Extractor noise causes score drift** | High | Per-dimension confidence threshold gates; 7-day lookback updates |
| **"73/100" feels arbitrary** | High | Every metric drills down to primary source signals; Sources tab prominently featured |
| **Bot floods proposal queue** | Medium | Recurrence rule constraint (≥2 distinct signals in 7d) + 7d deduplication window |
| **Crawler $/day overrun** | Medium | Per-vision daily caps; cockpit budget meter; admin pre-approval for Grounded Deep Research runs |

---

## 10. References

- [CLAUDE.md](./CLAUDE.md) — operational context, tech stack, developer rules
- [docs/tasks/current.md](./docs/tasks/current.md) — live milestone status
- [docs/architecture/composition.md](./docs/architecture/composition.md) — Phase 4 data-pipeline & fetcher composition
- [docs/adr/](./docs/adr/) — Architectural Decision Records
- [docs/archive/](./docs/archive/) — historical Phase 3 memos
- [prompts/](./prompts) — agent system prompts (versioned)
