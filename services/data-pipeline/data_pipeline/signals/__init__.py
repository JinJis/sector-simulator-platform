"""Signal ingestion adapters (M39).

Each adapter implements the SignalSource Protocol — fetch fresh signals
(papers / patents / news / filings / etc.) for one vision's capability
keyword set. The signal_ingest job (M39c) drives all adapters in
rotation; each writes raw rows to `signals` with `delta_*=null`. The
SignalExtractor agent (M39b, haiku tier) then scores each Signal with
per-dimension deltas + optional actor_id tag.

See docs/PIVOT.md §5 M39 + docs/REFACTOR.md §5 for the full plan.
"""

from .arxiv import ArxivSource
from .base import RawSignal, SignalSource
from .crawl4ai_news import (
    Crawl4aiFinvizSource,
    Crawl4aiNaverSource,
    Crawl4aiYahooSource,
)
from .google_news import GoogleNewsSource
from .uspto import UsptoSource

__all__ = [
    "ArxivSource",
    "Crawl4aiFinvizSource",
    "Crawl4aiNaverSource",
    "Crawl4aiYahooSource",
    "GoogleNewsSource",
    "RawSignal",
    "SignalSource",
    "UsptoSource",
]
