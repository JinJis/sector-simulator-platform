"""Source adapters — one per upstream data provider.

Each adapter implements the `DataSource` Protocol so the jobs can swap
between live (yfinance) and fake (tests) without conditional code paths.
"""

from data_pipeline.adapters.base import DataSource, HistoryBar, Quote
from data_pipeline.adapters.fake import FakeSource
from data_pipeline.adapters.yfinance_source import YFinanceSource

__all__ = ["DataSource", "FakeSource", "HistoryBar", "Quote", "YFinanceSource"]
