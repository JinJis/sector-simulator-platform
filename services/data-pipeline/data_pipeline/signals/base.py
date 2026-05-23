"""SignalSource Protocol — the contract every signal adapter implements.

A source represents one upstream provider (arXiv, USPTO, NewsAPI,
gov-feed, ...). It takes a per-capability keyword set and returns
RawSignal records. The orchestrator (jobs/signal_ingest.py) iterates
over visions × capabilities × sources and writes the deduplicated
results to the `signals` table.

Design notes:
  - Adapters return raw signals only — no delta scoring, no actor
    tagging. That's the SignalExtractor agent's job (M39b, haiku tier).
  - Signals are deduplicated by (source_url, capability_id) — the
    table's @@unique. Re-running an adapter for the same capability is
    idempotent.
  - Adapters MUST tolerate network errors gracefully (log + return
    empty list rather than raising — one bad source shouldn't break
    the whole cron).
  - `freshness_window_days` caps how far back the adapter looks.
    Daily cron uses 2-3 days to catch what slipped through retries.
"""

from __future__ import annotations

from datetime import datetime
from typing import Protocol

from pydantic import BaseModel, Field


class RawSignal(BaseModel):
    """One source-grounded event before extractor scoring.

    Mirrors the `signals` table shape minus the per-dimension deltas
    (those land after the SignalExtractor agent runs in M39b). All raw
    signals start with `delta_*=None` and `is_highlight=False`.
    """

    sector_slug: str = Field(..., description="Vision slug — `Sector.slug` in DB.")
    capability_key: str = Field(
        ...,
        description=(
            "Capability key within the vision. Adapters scope their search "
            "per-capability so the same Signal row can be written once per "
            "capability mention without violating the (source_url, capability_id) "
            "unique constraint."
        ),
    )
    source_kind: str = Field(
        ...,
        description="paper / patent / news / filing / gov_report / vendor_doc / dataset / social",
    )
    source_url: str
    source_id_ext: str | None = Field(
        None, description="arXiv id, USPTO patent number, DOI, etc."
    )
    title: str
    summary: str | None = None
    published_at: datetime


class SignalSource(Protocol):
    """One upstream provider. Implementations live in
    services/data-pipeline/data_pipeline/signals/<name>.py."""

    #: Source kind written into Signal.source_kind. One of the taxonomy
    #: values in the Signal model docstring.
    source_kind: str

    #: Human-readable name for logs + admin monitoring health card.
    name: str

    async def fetch(
        self,
        *,
        sector_slug: str,
        capability_key: str,
        keywords: list[str],
        since: datetime,
        max_results: int = 20,
    ) -> list[RawSignal]:
        """Fetch matching signals for one (vision × capability) pair.

        Args:
            sector_slug: Stamped onto each returned RawSignal.
            capability_key: Stamped onto each returned RawSignal.
            keywords: Search terms — adapters join with OR semantics.
            since: Only return signals published >= this timestamp.
            max_results: Cap per call. Adapters MUST respect this.

        Returns:
            Empty list on network / parse failure (log + swallow).
        """
        ...
