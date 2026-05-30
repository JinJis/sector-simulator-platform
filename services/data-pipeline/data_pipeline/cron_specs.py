"""Single source of truth for the data-pipeline cron jobs.

Replaces the per-job ``if os.environ.get("*_SCHEDULE", "on") != "off":``
guards that lived in the lifespan. Every cron is always registered at
boot; the *enabled* state comes from the ``job_configs`` table (slice
12a), keyed by ``{job_id}.enabled``. Admin UI pause/resume writes back
to the same row, so the state survives container restarts.

Default enabled values mirror the previous .env defaults:
- ``digest_daily`` + ``orchestrator_tick_15min`` default **off** because
  each call is cost-heavy (~$0.30 / DEEP-tier LLM round on digest;
  per-tick LLM dispatch on orchestrator). Operator turns them on from
  the admin once they're happy with the per-vision behaviour.
- Everything else defaults **on** — they were already "on" by default
  in the legacy env-gate world (NEWS_INGEST_SCHEDULE=on,
  RESEARCH_INGEST_SCHEDULE=on, etc.).
"""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True, slots=True)
class CronSpec:
    """Static metadata for one cron job. Bound to a runner in
    ``main.py`` via the ``id`` — keeping this file pure-data so the
    admin template + the boot loop both consume the same list."""

    id: str
    """APScheduler job id. Also the stem used to derive the JobConfig
    enabled key (``{id}.enabled``)."""

    label: str
    """Human-friendly label rendered in the admin queue table."""

    cadence: str
    """Short text shown under the label — "every 5 min", "hourly · :07",
    "daily · 17:30 KST default" etc. Not parsed; display-only."""

    note: str
    """One-line summary of what the cron does — shown under the label
    in the admin table."""

    default_enabled: bool
    """When the ``{id}.enabled`` row is absent from job_configs, this is
    the value the boot loop assumes (and the seed step writes)."""


# Order matches the legacy admin queue display order. New crons append
# at the end unless they belong to an existing thematic group.
CRON_SPECS: list[CronSpec] = [
    CronSpec(
        id="news_ingest_5min",
        label="News ingest",
        cadence="every 5 min",
        note=(
            "Google News RSS by default; crawl4ai over "
            "Yahoo + Naver + Finviz when NEWS_INGEST_USE_CRAWL4AI=1"
        ),
        default_enabled=True,
    ),
    CronSpec(
        id="orchestrator_tick_15min",
        label="Orchestrator picker",
        cadence="every 15 min",
        note="M49f opportunistic fetcher dispatch — per-tick LLM cost",
        default_enabled=False,  # cost-gated; operator turns on
    ),
    CronSpec(
        id="resolve_predictions_v2_hourly",
        label="Resolve predictions v2",
        cadence="hourly · :05",
        note="M46b band-based prediction resolver",
        default_enabled=True,
    ),
    CronSpec(
        id="research_ingest_hourly",
        label="Research ingest",
        cadence="hourly · :07",
        note="arXiv + USPTO (when ENABLE_USPTO=1) per capability keyword set",
        default_enabled=True,
    ),
    CronSpec(
        id="recompute_feasibility_hourly",
        label="Recompute feasibility",
        cadence="hourly · :25",
        note="ScoreUpdater agent per capability → vision rollup",
        default_enabled=True,
    ),
    CronSpec(
        id="refresh_quotes_daily",
        label="Refresh quotes",
        cadence="daily · 17:30 KST default",
        note="yfinance equity snapshot for PredictionV2 anchor",
        default_enabled=True,
    ),
    CronSpec(
        id="digest_daily",
        label="DR digest (grounded)",
        cadence="daily · 15:00 KST default",
        note="gemini-3.1-pro-preview synthesis per vision · ~$0.30/run",
        default_enabled=False,  # cost-gated; operator turns on
    ),
]


# Stable display order keyed by job id.
DISPLAY_ORDER: dict[str, int] = {spec.id: i for i, spec in enumerate(CRON_SPECS)}


def enabled_key(job_id: str) -> str:
    """Canonical job_config key for the on/off toggle. Centralised so
    main.py (boot loop) + queue_view (toggle handler) + the future
    admin form all use the same string."""
    return f"{job_id}.enabled"
