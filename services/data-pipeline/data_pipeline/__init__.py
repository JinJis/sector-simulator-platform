"""data-pipeline — FastAPI service that refreshes external data into Postgres.

Equities Milestone 2 surface:
- Adapter base + yfinance live source + a fake source for tests
- Equity repository (asyncpg) reading/writing `sector_equities`
- `refresh_quotes` job, runnable manually (POST /jobs/refresh-quotes) or
  on a daily cron via APScheduler

Next milestones expand the surface to financial statements (EDGAR/DART),
macro factors (FRED/TradingEconomics), and time-series quote history.
"""

from data_pipeline.adapters.base import DataSource, HistoryBar, Quote
from data_pipeline.adapters.fake import FakeSource
from data_pipeline.adapters.yfinance_source import YFinanceSource
from data_pipeline.jobs.refresh_quote_history import (
    RefreshHistoryResult,
    refresh_quote_history,
)
from data_pipeline.jobs.refresh_quotes import RefreshQuotesResult, refresh_quotes
from data_pipeline.repo import EquityRecord, EquityRepository, InMemoryEquityRepository

__all__ = [
    "DataSource",
    "EquityRecord",
    "EquityRepository",
    "FakeSource",
    "HistoryBar",
    "InMemoryEquityRepository",
    "Quote",
    "RefreshHistoryResult",
    "RefreshQuotesResult",
    "YFinanceSource",
    "refresh_quote_history",
    "refresh_quotes",
]
