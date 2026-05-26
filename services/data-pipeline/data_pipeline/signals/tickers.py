"""Static vision → tickers map for the crawl4ai news sources.

The crawl4ai-based adapters (Yahoo Finance, Naver Finance, Finviz)
need a per-vision symbol list because their news pages are addressed
by ticker, not by free-text keyword. This map will move to the DB
(`Actor.ticker_us` / `Actor.ticker_kr` columns) once the schema
migration lands, but a hardcoded constant gets us live data today.

To extend a vision: drop a ticker into the right list. To add a new
vision: add a new entry keyed by `Sector.slug`.

Tickers:
  - US: NYSE/NASDAQ tickers (Yahoo + Finviz)
  - KR: KOSPI 6-digit codes WITHOUT the .KS suffix (Naver Finance uses
        the bare code in its URL; we add .KS for Yahoo elsewhere)
"""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True, slots=True)
class VisionTickers:
    us: tuple[str, ...]
    kr: tuple[str, ...]


# Curated lineup — companies whose business outcome is most informative
# for each vision's feasibility. Bias toward names with active investor
# relations (i.e. lots of Yahoo / Finviz coverage).
VISION_TICKERS: dict[str, VisionTickers] = {
    "space-data-center": VisionTickers(
        us=("AMZN", "GOOGL", "MSFT", "PLTR", "RKLB", "TXN", "NVDA"),
        kr=("005930",),  # Samsung Electronics
    ),
    "fusion-power-grid-parity": VisionTickers(
        us=("BWXT", "GE", "OKLO", "SMR", "PWR", "GEV"),
        kr=(),
    ),
    "memory-semi": VisionTickers(
        us=("NVDA", "AMD", "AVGO", "MU", "TSM"),
        kr=("005930", "000660"),  # Samsung, SK Hynix
    ),
    "sofc": VisionTickers(
        us=("BLDP", "PLUG", "FCEL", "BE", "CMI"),
        kr=(),
    ),
}


def tickers_for(sector_slug: str) -> VisionTickers:
    """Return the curated ticker lineup for a vision. Empty tuples on
    both sides when the vision isn't mapped (the crawler then no-ops
    cleanly rather than fanning out a meaningless 0-ticker crawl)."""
    return VISION_TICKERS.get(sector_slug, VisionTickers(us=(), kr=()))
