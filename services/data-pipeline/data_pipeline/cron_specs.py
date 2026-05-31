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
from typing import Literal

CronScheduleKind = Literal["cron", "interval_min"]
"""Two trigger shapes APScheduler supports today:

- ``cron``         — 5-field crontab string (``"30 8 * * *"``), built
                     via ``CronTrigger.from_crontab(...)``.
- ``interval_min`` — float minutes between fires (``"5"``, ``"0.5"``),
                     built via ``IntervalTrigger(minutes=...)``.

Each ``CronSpec`` pins exactly one — the admin edit form picks the
right validator + widget per row."""


@dataclass(frozen=True, slots=True)
class CronSpec:
    """Static metadata for one cron job. Bound to a runner in
    ``main.py`` via the ``id`` — keeping this file pure-data so the
    admin template + the boot loop both consume the same list."""

    id: str
    """APScheduler job id. Also the stem used to derive JobConfig
    keys (``{id}.enabled`` + ``{id}.schedule``)."""

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

    schedule_kind: CronScheduleKind
    """Whether the schedule value is a crontab expression or a float
    minutes count. Drives the admin form widget + the server-side
    validator (``CronTrigger.from_crontab`` vs ``float()``)."""

    default_schedule_value: str
    """First-boot seed for ``{id}.schedule``. Cron-shape jobs use the
    5-field crontab string; interval-shape jobs use the minutes count
    as a string (kept stringly typed because that's how the JobConfig
    table stores everything)."""

    purpose: str
    """Operational purpose of the cron job, displayed in the Admin UI."""

    inputs: str
    """Description of external sources, APIs, or database tables called or queried."""

    outputs: str
    """Description of target tables, channels, or rollups modified by the job."""


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
        schedule_kind="interval_min",
        default_schedule_value="5",
        purpose="Crawls fast-paced external news sources to search for recent capability keywords and tags matched stock actors.",
        inputs="Dynamic capability keyword sets, stock tickers of sector actors.",
        outputs="signals table (news article records with AI-extracted dimension delta scores).",
    ),
    CronSpec(
        id="orchestrator_tick_15min",
        label="Orchestrator picker",
        cadence="every 15 min",
        note="M49f opportunistic fetcher dispatch — per-tick LLM cost",
        default_enabled=False,  # cost-gated; operator turns on
        schedule_kind="interval_min",
        default_schedule_value="15",
        purpose="Orchestrates daily budget-gated deep research agent dispatches for stale or unscored capabilities, actors, or risks.",
        inputs="Stale capabilities, actors, and risks; historical crawl_runs costs vs the daily dollar cap.",
        outputs="crawl_runs table logs (spawns active async deep research worker dispatcher runs).",
    ),
    CronSpec(
        id="resolve_predictions_v2_hourly",
        label="Resolve predictions v2",
        cadence="hourly · :05",
        note="M46b band-based prediction resolver",
        default_enabled=True,
        schedule_kind="cron",
        default_schedule_value="5 * * * *",
        purpose="Resolves active user bets (price bands) dynamically against recently ingested equity price snapshots.",
        inputs="equity_quotes table (historical price snap data), active user predictions.",
        outputs="Resolved prediction results, payouts, and status flags on user profiles.",
    ),
    CronSpec(
        id="research_ingest_hourly",
        label="Research ingest",
        cadence="hourly · :07",
        note="arXiv + USPTO (when ENABLE_USPTO=1) per capability keyword set",
        default_enabled=True,
        schedule_kind="cron",
        default_schedule_value="7 * * * *",
        purpose="Fetches external academic research papers from the arXiv API and patents from the USPTO PatentsView API matching capability keywords.",
        inputs="Dynamic capability keyword sets, USPTO_API_KEY (when ENABLE_USPTO=1).",
        outputs="signals table (academic papers & patent applications tagged with AI-extracted deltas).",
    ),
    CronSpec(
        id="recompute_feasibility_hourly",
        label="Recompute feasibility",
        cadence="hourly · :25",
        note="ScoreUpdater agent per capability → vision rollup",
        default_enabled=True,
        schedule_kind="cron",
        default_schedule_value="25 * * * *",
        purpose="Aggregates all recently ingested signal deltas and runs the ScoreUpdater agent (Gemini 1.5 Pro) to update feasibility indices.",
        inputs="signals table (last 30 days of deltas), current capability scores.",
        outputs="capability_scores table, vision_feasibility rollup via POST to simulation-service.",
    ),
    CronSpec(
        id="refresh_quotes_daily",
        label="Refresh quotes",
        cadence="daily · 17:30 KST default",
        note="yfinance equity snapshot for PredictionV2 anchor",
        default_enabled=True,
        schedule_kind="cron",
        default_schedule_value="30 8 * * *",  # 08:30 UTC = 17:30 KST
        purpose="Queries external yfinance (Yahoo Finance) to capture historical stock quote snaps for live vision actors.",
        inputs="Ticker symbols of actors mapped to active visions.",
        outputs="equity_quotes and equity_prices tables.",
    ),
    CronSpec(
        id="digest_daily",
        label="DR digest (grounded)",
        cadence="daily · 15:00 KST default",
        note="gemini-3.1-pro-preview synthesis per vision · ~$0.30/run",
        default_enabled=False,  # cost-gated; operator turns on
        schedule_kind="cron",
        default_schedule_value="0 6 * * *",  # 06:00 UTC = 15:00 KST
        purpose="Generates grounded sector synthesis briefs using Vertex AI Grounded Search (Gemini 3.1 Pro) across all active signals.",
        inputs="Vector-crawled signals, external Google Web Search API.",
        outputs="Daily grounded research digest, crawl_runs table log.",
    ),
    CronSpec(
        id="marketing_digest_daily",
        label="Marketing digest",
        cadence="daily · 23:00 KST default",
        note="balanced-tier bilingual social copy per vision · operator reviews + posts",
        default_enabled=False,  # cost-gated; operator turns on
        schedule_kind="cron",
        default_schedule_value="0 14 * * *",  # 14:00 UTC = 23:00 KST
        purpose="Builds a source-grounded snapshot per vision (binding constraint, notable signal, lead actor) and calls the marketing-content agent for ready-to-post bilingual (ko+en) Threads + Instagram copy. Does not auto-publish.",
        inputs="capability_scores (current), signals (last 7d), actors; agent-orchestration /marketing-content/generate.",
        outputs="Generated post sets returned in job stats (last_marketing_digest_result) for operator review.",
    ),
]


# Stable display order keyed by job id.
DISPLAY_ORDER: dict[str, int] = {spec.id: i for i, spec in enumerate(CRON_SPECS)}

# id → spec lookup; saves a linear scan in the admin reschedule
# handler + the boot loop's trigger-building branch.
SPEC_BY_ID: dict[str, CronSpec] = {spec.id: spec for spec in CRON_SPECS}


def enabled_key(job_id: str) -> str:
    """Canonical job_config key for the on/off toggle. Centralised so
    main.py (boot loop) + queue_view (toggle handler) + the future
    admin form all use the same string."""
    return f"{job_id}.enabled"


def schedule_key(job_id: str) -> str:
    """Canonical job_config key for the schedule value (cron expression
    or interval minutes). Same centralisation rationale as
    :func:`enabled_key`."""
    return f"{job_id}.schedule"


def build_trigger(kind: CronScheduleKind, value: str) -> object:
    """Construct the APScheduler trigger from a JobConfig value. Pure
    function — raises ``ValueError`` on a bad cron expression or a
    non-numeric interval so the admin handler can surface the failure
    inline. Returns the trigger as ``object`` to keep this module
    import-free of APScheduler types (so it can be tested without the
    SDK loaded)."""
    from apscheduler.triggers.cron import CronTrigger  # noqa: PLC0415
    from apscheduler.triggers.interval import IntervalTrigger  # noqa: PLC0415

    if kind == "cron":
        return CronTrigger.from_crontab(value, timezone="UTC")
    minutes = float(value)
    if minutes <= 0:
        raise ValueError(
            f"interval must be positive, got {minutes!r}"
        )
    return IntervalTrigger(minutes=minutes)
