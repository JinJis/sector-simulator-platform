"""Orchestrator config (M49f).

Defaults for composition.md §4's ranking formula:

  score(candidate) =
       W_binding   * (100 - anchor_composite_score)   # bottom-half caps first
     + W_stale     * hours_since_last_update
     + W_priority  * (100 if vision.admin_pinned else 0)
     - W_cost      * estimated_cost_usd

Plus per-vision $/day cap and per-fetcher estimated cost. All
overridable per-vision later via the admin cockpit (M52); for now a
single global instance.

The estimated costs reflect early observation:
  - capability/actor/risk fetchers each pay one Deep Research call
    (~$0.04) + one SignalExtractor call (~$0.001) = ~$0.041 amortized
    higher for safety margin.
  - signal fetcher pays N extractor calls per (vision × capability);
    average run in fixtures was ~5 raw signals × $0.001 = $0.005.

These shift to observed-from-CrawlRun-history when the cockpit ships.
"""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True, slots=True)
class OrchestratorConfig:
    # Ranking weights.
    w_binding: float = 0.6  # 0–100 contribution per unit
    w_stale: float = 0.4  # per hour
    w_priority: float = 30.0  # binary 0 or 100
    w_cost: float = 800.0  # per $ of estimated cost — strong damper

    # Per-vision daily LLM-cost cap (USD).
    per_vision_daily_usd_cap: float = 2.0

    # Per-fetcher estimated cost (USD). Conservative; orchestrator
    # respects this when checking remaining daily budget.
    cost_capability_usd: float = 0.05
    cost_actor_usd: float = 0.05
    cost_risk_usd: float = 0.05
    cost_signal_usd: float = 0.01

    # Max candidates dispatched per tick across all visions.
    top_k_per_tick: int = 8

    # When a (vision, fetcher_kind, key) has no prior CrawlRun, treat
    # it as "infinitely stale" so a fresh deploy ingests breadth
    # before depth. Capped to avoid score blowups.
    stale_hours_fallback: float = 24.0 * 30.0  # ~30d

    def estimated_cost(self, fetcher_kind: str) -> float:
        return {
            "capability": self.cost_capability_usd,
            "actor": self.cost_actor_usd,
            "risk": self.cost_risk_usd,
            "signal": self.cost_signal_usd,
        }.get(fetcher_kind, self.cost_capability_usd)


CONFIG = OrchestratorConfig()
