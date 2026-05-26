"""Tests for the crawl4ai news adapters (Yahoo / Naver / Finviz).

Real crawl4ai isn't exercised — it pulls in playwright + chromium which
would balloon CI. Instead we monkeypatch `crawl4ai.AsyncWebCrawler` +
`JsonCssExtractionStrategy` with stubs that return canned `list_pages`
+ `article_bodies` per URL. The tests assert:

  - Per-vision ticker map drives which list URLs get hit.
  - Keyword filtering culls articles whose title doesn't match.
  - Empty / unmapped visions no-op (zero crawls, zero RawSignals).
  - Missing crawl4ai package degrades gracefully (returns []).
"""

from __future__ import annotations

import json
import sys
from contextlib import asynccontextmanager
from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import Any

import pytest

from data_pipeline.signals import (
    Crawl4aiFinvizSource,
    Crawl4aiNaverSource,
    Crawl4aiYahooSource,
)


# --------------------------------------------------------------------------
# Fake crawl4ai surface
# --------------------------------------------------------------------------


@dataclass
class _FakePage:
    extracted_content: Any = None
    markdown: str = "<article body markdown>"


@dataclass
class _FakeCrawler:
    """Stand-in for crawl4ai.AsyncWebCrawler. Lookup table by URL:
    `list_pages[url] = list[dict]` for list-scrape pages,
    `bodies[url] = str` for article-scrape pages. Records every
    `arun` call into `calls` so tests can assert URLs hit."""

    list_pages: dict[str, list[dict[str, Any]]] = field(default_factory=dict)
    bodies: dict[str, str] = field(default_factory=dict)
    calls: list[str] = field(default_factory=list)

    async def __aenter__(self) -> _FakeCrawler:
        return self

    async def __aexit__(self, *_: Any) -> None:
        pass

    async def arun(self, *, url: str, **_: Any) -> _FakePage:
        self.calls.append(url)
        if url in self.list_pages:
            return _FakePage(extracted_content=json.dumps(self.list_pages[url]))
        if url in self.bodies:
            return _FakePage(markdown=self.bodies[url])
        # Unknown URL → empty extraction
        return _FakePage(extracted_content=None, markdown="")


class _FakeStrategy:
    """JsonCssExtractionStrategy stand-in — we don't care about
    the schema in tests, only that the constructor accepts a dict."""

    def __init__(self, schema: dict[str, Any]) -> None:
        self.schema = schema


@pytest.fixture
def fake_crawl4ai(monkeypatch: pytest.MonkeyPatch):
    """Install a fake `crawl4ai` package into sys.modules so the
    adapter's lazy import finds it. The fixture yields the
    `_FakeCrawler` instance the test should pre-populate; the
    AsyncWebCrawler factory returns the same instance regardless
    of constructor args."""
    crawler = _FakeCrawler()

    fake_pkg = type(sys)("crawl4ai")
    fake_pkg.AsyncWebCrawler = lambda **_: crawler  # type: ignore[attr-defined]

    fake_strat_mod = type(sys)("crawl4ai.extraction_strategy")
    fake_strat_mod.JsonCssExtractionStrategy = _FakeStrategy  # type: ignore[attr-defined]

    monkeypatch.setitem(sys.modules, "crawl4ai", fake_pkg)
    monkeypatch.setitem(sys.modules, "crawl4ai.extraction_strategy", fake_strat_mod)
    yield crawler


# --------------------------------------------------------------------------
# Yahoo
# --------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_yahoo_pulls_articles_matching_keyword(
    fake_crawl4ai: _FakeCrawler,
) -> None:
    # space-data-center has 7 US tickers; we'll only stub two of the
    # list pages so the others return empty.
    fake_crawl4ai.list_pages["https://finance.yahoo.com/quote/NVDA/news"] = [
        {
            "url": "https://finance.yahoo.com/news/rad-hard-chip-1",
            "title": "Nvidia announces radiation-hardened GPU for satellites",
        },
        {
            "url": "https://finance.yahoo.com/news/gaming-1",
            "title": "Nvidia launches new gaming GPU",
        },
    ]
    fake_crawl4ai.bodies[
        "https://finance.yahoo.com/news/rad-hard-chip-1"
    ] = "Long article body about rad-hard silicon for orbital DCs ..."

    src = Crawl4aiYahooSource()
    sigs = await src.fetch(
        sector_slug="space-data-center",
        capability_key="rad_hard_compute",
        keywords=["radiation-hardened", "rad-hard"],
        since=datetime.now(UTC),
        max_results=20,
    )
    assert len(sigs) == 1
    s = sigs[0]
    assert s.source_kind == "news"
    assert s.title.startswith("Nvidia announces")
    assert s.source_url == "https://finance.yahoo.com/news/rad-hard-chip-1"
    assert s.summary is not None and "rad-hard silicon" in s.summary
    # Both the list page AND the article body were fetched.
    assert "https://finance.yahoo.com/quote/NVDA/news" in fake_crawl4ai.calls
    assert "https://finance.yahoo.com/news/rad-hard-chip-1" in fake_crawl4ai.calls


@pytest.mark.asyncio
async def test_yahoo_keyword_mismatch_filters_everything(
    fake_crawl4ai: _FakeCrawler,
) -> None:
    fake_crawl4ai.list_pages["https://finance.yahoo.com/quote/NVDA/news"] = [
        {"url": "https://finance.yahoo.com/news/gaming-1", "title": "Gaming GPU"},
    ]
    src = Crawl4aiYahooSource()
    sigs = await src.fetch(
        sector_slug="space-data-center",
        capability_key="rad_hard_compute",
        keywords=["radiation-hardened"],  # won't match "Gaming GPU"
        since=datetime.now(UTC),
        max_results=20,
    )
    assert sigs == []


# --------------------------------------------------------------------------
# Finviz
# --------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_finviz_pulls_from_quote_page(
    fake_crawl4ai: _FakeCrawler,
) -> None:
    fake_crawl4ai.list_pages["https://finviz.com/quote.ashx?t=PLUG"] = [
        {
            "url": "https://example.com/plug-sofc-order",
            "title": "Plug Power books $500M SOFC order from hyperscaler",
        },
    ]
    fake_crawl4ai.bodies[
        "https://example.com/plug-sofc-order"
    ] = "Body about SOFC capex ..."

    src = Crawl4aiFinvizSource()
    sigs = await src.fetch(
        sector_slug="sofc",
        capability_key="stack_lifetime",
        keywords=["sofc", "fuel cell"],
        since=datetime.now(UTC),
        max_results=20,
    )
    assert len(sigs) == 1
    assert sigs[0].source_url == "https://example.com/plug-sofc-order"


# --------------------------------------------------------------------------
# Naver
# --------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_naver_uses_kr_ticker_codes(
    fake_crawl4ai: _FakeCrawler,
) -> None:
    fake_crawl4ai.list_pages[
        "https://finance.naver.com/item/news.naver?code=005930"
    ] = [
        {
            "url": "https://n.news.naver.com/HBM-supply",
            "title": "삼성전자 HBM4 양산 본격화",
        },
    ]
    fake_crawl4ai.bodies["https://n.news.naver.com/HBM-supply"] = "본문"

    src = Crawl4aiNaverSource()
    sigs = await src.fetch(
        sector_slug="memory-semi",
        capability_key="hbm_yield",
        keywords=["HBM"],
        since=datetime.now(UTC),
        max_results=20,
    )
    assert len(sigs) == 1
    assert sigs[0].title.startswith("삼성전자 HBM4")


# --------------------------------------------------------------------------
# Edge: no tickers for vision
# --------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_unmapped_vision_returns_empty_with_no_crawl(
    fake_crawl4ai: _FakeCrawler,
) -> None:
    src = Crawl4aiYahooSource()
    sigs = await src.fetch(
        sector_slug="vision-that-doesnt-exist",
        capability_key="anything",
        keywords=["whatever"],
        since=datetime.now(UTC),
        max_results=20,
    )
    assert sigs == []
    assert fake_crawl4ai.calls == []  # never even instantiated the crawler


# --------------------------------------------------------------------------
# Edge: crawl4ai not installed
# --------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_injected_ticker_provider_overrides_static_map(
    fake_crawl4ai: _FakeCrawler,
) -> None:
    """When the source is constructed with a custom `ticker_provider`
    (the production path — a closure over signal_repo.list_vision_tickers),
    the per-vision URLs come from that provider, not from
    tickers.py. Proves the DB-backed wiring."""
    from data_pipeline.signals.tickers import VisionTickers

    async def db_provider(sector_slug: str) -> VisionTickers:
        # Returns a ticker the static map doesn't have, so a hit
        # against the static URL list would fail.
        return VisionTickers(us=("ZZZX",), kr=())

    fake_crawl4ai.list_pages["https://finance.yahoo.com/quote/ZZZX/news"] = [
        {
            "url": "https://finance.yahoo.com/news/zzzx-launch",
            "title": "ZZZX announces orbital launch services",
        },
    ]
    fake_crawl4ai.bodies[
        "https://finance.yahoo.com/news/zzzx-launch"
    ] = "ZZZX body about orbital."

    src = Crawl4aiYahooSource(ticker_provider=db_provider)
    sigs = await src.fetch(
        sector_slug="any-vision",  # static map doesn't matter
        capability_key="anything",
        keywords=["orbital"],
        since=datetime.now(UTC),
        max_results=20,
    )
    assert len(sigs) == 1
    assert sigs[0].source_url == "https://finance.yahoo.com/news/zzzx-launch"


@pytest.mark.asyncio
async def test_ticker_provider_failure_falls_back_to_static_map(
    fake_crawl4ai: _FakeCrawler,
) -> None:
    """A DB-backed provider that raises (column missing, pool dead)
    must not crash news_ingest — the source falls back to the static
    map so the cron stays productive."""
    async def broken_provider(sector_slug: str):  # noqa: ANN202
        raise RuntimeError("DB pool dead")

    # space-data-center has NVDA in the STATIC map (tickers.py); stub
    # that URL so the fallback path returns something visible.
    fake_crawl4ai.list_pages["https://finance.yahoo.com/quote/NVDA/news"] = [
        {
            "url": "https://finance.yahoo.com/news/fallback",
            "title": "Fallback signal about radiation",
        },
    ]
    fake_crawl4ai.bodies["https://finance.yahoo.com/news/fallback"] = "body"

    src = Crawl4aiYahooSource(ticker_provider=broken_provider)
    sigs = await src.fetch(
        sector_slug="space-data-center",
        capability_key="rad_hard_compute",
        keywords=["radiation"],
        since=datetime.now(UTC),
        max_results=20,
    )
    assert len(sigs) == 1, "fallback to static map should have produced 1 signal"


@pytest.mark.asyncio
async def test_missing_crawl4ai_degrades_gracefully(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Make the lazy `import crawl4ai` fail and confirm the adapter
    returns [] instead of bubbling up an ImportError."""
    # Ensure crawl4ai isn't importable.
    monkeypatch.setitem(sys.modules, "crawl4ai", None)

    src = Crawl4aiYahooSource()
    sigs = await src.fetch(
        sector_slug="space-data-center",
        capability_key="rad_hard_compute",
        keywords=["rad-hard"],
        since=datetime.now(UTC),
        max_results=20,
    )
    assert sigs == []
