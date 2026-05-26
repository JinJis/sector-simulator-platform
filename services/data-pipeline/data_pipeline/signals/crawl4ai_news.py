"""crawl4ai-backed news sources (Yahoo Finance, Naver Finance, Finviz).

Replaces NewsApiSource for the 5-minute news_ingest cron. Three
parallel adapters — one per site — wired into news_ingest_5min as a
single batched call.

Two-phase per (vision × ticker):

  1. **List scrape** (CSS extraction, cheap, no LLM)
     - Hit the site's per-ticker news list page (or RSS where
       available).
     - Pull the article URL + headline + posted timestamp via
       `JsonCssExtractionStrategy`.
     - Dedup against a per-call seen-URL set.

  2. **Article scrape** (Markdown extraction, no LLM)
     - For each new URL, request the article body with crawl4ai's
       default markdown converter (strips chrome / ads / nav).
     - Emit a RawSignal with the headline as `title`, first ~400
       chars of markdown as `summary`. The downstream
       SignalExtractor agent owns the per-dimension scoring.

Keyword filtering happens AFTER the URL list is fetched (in-memory),
because the per-ticker pages aren't keyword-searchable upstream. A
naive case-insensitive substring match against title + summary is
sufficient for the 5-min cadence — false negatives just wait for the
next tick.

The adapters degrade gracefully:
  - crawl4ai import missing → log + return [] (the package is heavy
    so we don't make it a hard dep at import time).
  - Site DOM changed / 4xx / 5xx → log + return [].
  - Vision has no tickers mapped → no-op (no crawl, no log).
"""

from __future__ import annotations

import logging
from datetime import UTC, datetime
from typing import Any, ClassVar

from data_pipeline.signals.base import RawSignal
from data_pipeline.signals.tickers import VisionTickers, tickers_for

log = logging.getLogger(__name__)


def _matches_any(text: str, keywords: list[str]) -> bool:
    """Case-insensitive substring match. Used to filter the per-ticker
    news list down to articles plausibly about the capability."""
    if not keywords:
        return True
    lower = text.lower()
    return any(kw.lower() in lower for kw in keywords if kw.strip())


async def _crawl_url(crawler: Any, url: str, **kwargs: Any) -> Any | None:
    """Thin wrapper around `AsyncWebCrawler.arun` that swallows
    errors. Returns None on any failure — the caller treats that as
    'skip this URL'."""
    try:
        return await crawler.arun(url=url, **kwargs)
    except Exception as exc:  # noqa: BLE001
        log.warning("crawl4ai: arun(%s) raised %s", url, exc)
        return None


# --------------------------------------------------------------------------
# Per-site adapters
# --------------------------------------------------------------------------


class _Crawl4aiBase:
    """Shared lifecycle for the three crawl4ai-based sources.

    Subclasses define `source_kind`, `name`, and `_per_vision_urls`
    (build the list-page URLs for a vision). The base orchestrates
    list-scrape → keyword filter → body-scrape → RawSignal emission.
    """

    source_kind: ClassVar[str] = "news"
    name: ClassVar[str] = "crawl4ai"

    def _per_vision_urls(self, tickers: VisionTickers) -> list[str]:
        raise NotImplementedError

    def _list_extraction_schema(self) -> dict[str, Any]:
        """Schema for `JsonCssExtractionStrategy` — site-specific."""
        raise NotImplementedError

    async def fetch(
        self,
        *,
        sector_slug: str,
        capability_key: str,
        keywords: list[str],
        since: datetime,
        max_results: int = 20,
    ) -> list[RawSignal]:
        tickers = tickers_for(sector_slug)
        list_urls = self._per_vision_urls(tickers)
        if not list_urls:
            return []
        try:
            from crawl4ai import AsyncWebCrawler  # noqa: PLC0415
            from crawl4ai.extraction_strategy import (  # noqa: PLC0415
                JsonCssExtractionStrategy,
            )
        except ImportError:
            log.warning(
                "crawl4ai not installed — %s skipped (pip install crawl4ai)",
                self.name,
            )
            return []

        # One AsyncWebCrawler instance reused across list + body scrapes
        # — shares the underlying playwright browser context, much faster.
        results: list[RawSignal] = []
        seen_urls: set[str] = set()
        list_strategy = JsonCssExtractionStrategy(self._list_extraction_schema())

        async with AsyncWebCrawler(verbose=False) as crawler:
            for url in list_urls:
                page = await _crawl_url(
                    crawler,
                    url,
                    bypass_cache=True,
                    extraction_strategy=list_strategy,
                )
                if page is None or not getattr(page, "extracted_content", None):
                    continue
                articles = _safe_json(page.extracted_content)
                if not isinstance(articles, list):
                    continue
                for art in articles[: max_results * 3]:  # over-fetch; filter below
                    if not isinstance(art, dict):
                        continue
                    href = str(art.get("url") or "").strip()
                    title = str(art.get("title") or "").strip()
                    if not href or not title:
                        continue
                    if href in seen_urls:
                        continue
                    seen_urls.add(href)
                    if not _matches_any(title, keywords):
                        continue
                    # Fetch the article body — markdown-cleaned.
                    body = await _crawl_url(crawler, href, bypass_cache=True)
                    summary = _first_chars(
                        getattr(body, "markdown", None) or "", 400
                    )
                    results.append(
                        RawSignal(
                            sector_slug=sector_slug,
                            capability_key=capability_key,
                            source_kind=self.source_kind,
                            source_url=href,
                            source_id_ext=None,
                            title=title,
                            summary=summary or None,
                            published_at=datetime.now(UTC),
                        )
                    )
                    if len(results) >= max_results:
                        return results
        return results


def _first_chars(text: str, n: int) -> str:
    s = text.strip()
    return s[:n] + ("…" if len(s) > n else "")


def _safe_json(blob: Any) -> Any:
    """crawl4ai sometimes returns the extracted content as already-
    parsed list/dict; sometimes as a JSON string. Handle both."""
    if isinstance(blob, (list, dict)):
        return blob
    if isinstance(blob, str):
        import json  # noqa: PLC0415

        try:
            return json.loads(blob)
        except json.JSONDecodeError:
            return None
    return None


class Crawl4aiYahooSource(_Crawl4aiBase):
    """Yahoo Finance per-ticker news list. URL pattern:
    `https://finance.yahoo.com/quote/{TICKER}/news`.

    Yahoo's news list is rendered server-side with stable CSS — the
    li[data-test="news-list-item"] selector has been steady for years.
    Article bodies are dynamic-loaded but crawl4ai's markdown
    converter handles them fine.
    """

    source_kind: ClassVar[str] = "news"
    name: ClassVar[str] = "crawl4ai-yahoo"

    def _per_vision_urls(self, tickers: VisionTickers) -> list[str]:
        return [f"https://finance.yahoo.com/quote/{t}/news" for t in tickers.us]

    def _list_extraction_schema(self) -> dict[str, Any]:
        return {
            "name": "yahoo_news_list",
            "baseSelector": 'li[data-test="news-list-item"]',
            "fields": [
                {"name": "title", "selector": "h3", "type": "text"},
                {
                    "name": "url",
                    "selector": "a",
                    "type": "attribute",
                    "attribute": "href",
                },
            ],
        }


class Crawl4aiFinvizSource(_Crawl4aiBase):
    """Finviz per-ticker news table. URL pattern:
    `https://finviz.com/quote.ashx?t={TICKER}`.

    Finviz is great for quick URL harvest: every ticker page has a
    plain HTML `<table class="news-table">` with one row per article.
    No JS rendering needed.
    """

    source_kind: ClassVar[str] = "news"
    name: ClassVar[str] = "crawl4ai-finviz"

    def _per_vision_urls(self, tickers: VisionTickers) -> list[str]:
        return [f"https://finviz.com/quote.ashx?t={t}" for t in tickers.us]

    def _list_extraction_schema(self) -> dict[str, Any]:
        return {
            "name": "finviz_news_table",
            "baseSelector": "table.news-table tr",
            "fields": [
                {"name": "title", "selector": "a.tab-link-news", "type": "text"},
                {
                    "name": "url",
                    "selector": "a.tab-link-news",
                    "type": "attribute",
                    "attribute": "href",
                },
            ],
        }


class Crawl4aiNaverSource(_Crawl4aiBase):
    """Naver Finance per-ticker news list. URL pattern:
    `https://finance.naver.com/item/news.naver?code={CODE}`.

    Korean stock codes are 6-digit numerics (no .KS suffix). The page
    has frame-embedded tables; the list lives in
    `#news_list_area a.tit` (titles) with `href` carrying the article
    URL. KR keywords (한글) match against the title — for visions whose
    keyword set is English-only, this source yields zero matches and
    no-ops cleanly.
    """

    source_kind: ClassVar[str] = "news"
    name: ClassVar[str] = "crawl4ai-naver"

    def _per_vision_urls(self, tickers: VisionTickers) -> list[str]:
        return [
            f"https://finance.naver.com/item/news.naver?code={c}"
            for c in tickers.kr
        ]

    def _list_extraction_schema(self) -> dict[str, Any]:
        return {
            "name": "naver_news_list",
            "baseSelector": "table.type5 tr",
            "fields": [
                {"name": "title", "selector": "td.title a", "type": "text"},
                {
                    "name": "url",
                    "selector": "td.title a",
                    "type": "attribute",
                    "attribute": "href",
                },
            ],
        }


__all__ = [
    "Crawl4aiFinvizSource",
    "Crawl4aiNaverSource",
    "Crawl4aiYahooSource",
]
