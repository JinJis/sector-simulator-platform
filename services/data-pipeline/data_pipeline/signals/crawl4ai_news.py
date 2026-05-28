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
import re
from datetime import UTC, datetime
from typing import Any, Awaitable, Callable, ClassVar

from data_pipeline.signals.base import RawSignal
from data_pipeline.signals.tickers import VisionTickers, tickers_for

log = logging.getLogger(__name__)


# Injected per-vision ticker lookup. Default uses the static map in
# `tickers.py` (keeps tests + zero-config dev working); production
# wires a closure over `SignalRepository.list_vision_tickers` so the
# DB is the source of truth.
TickerProvider = Callable[[str], Awaitable[VisionTickers]]


async def _static_ticker_provider(sector_slug: str) -> VisionTickers:
    return tickers_for(sector_slug)


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


async def _safe_close(crawler: Any, tag: str) -> None:
    """Best-effort `AsyncWebCrawler.__aexit__`. The playwright browser
    teardown can timeout / raise under fast cadences (news_ingest at
    1-min interval × ~80 fetcher iterations); log the error but never
    propagate — the cron's collected RawSignals are already returned
    to the caller. Leaked browser resources will GC."""
    try:
        await crawler.__aexit__(None, None, None)
    except Exception as exc:  # noqa: BLE001
        log.warning("%s crawler close raised (ignored): %s", tag, exc)


# --------------------------------------------------------------------------
# Per-site adapters
# --------------------------------------------------------------------------


class _Crawl4aiBase:
    """Shared lifecycle for the three crawl4ai-based sources.

    Subclasses define `source_kind`, `name`, and `_per_vision_urls`
    (build the list-page URLs for a vision). The base orchestrates
    list-scrape → keyword filter → body-scrape → RawSignal emission.

    `ticker_provider` decides where the per-vision ticker lineup
    comes from. Default = the static map in tickers.py (zero-config
    fallback); production passes a closure over
    `SignalRepository.list_vision_tickers` to read from the actors
    table. The closure layer also lets tests inject canned tickers
    without touching the static module.
    """

    source_kind: ClassVar[str] = "news"
    name: ClassVar[str] = "crawl4ai"

    def __init__(self, *, ticker_provider: TickerProvider | None = None) -> None:
        self._ticker_provider = ticker_provider or _static_ticker_provider

    def _per_vision_urls(self, tickers: VisionTickers) -> list[str]:
        raise NotImplementedError

    def _extract_articles_from_markdown(
        self, markdown: str
    ) -> list[tuple[str, str]]:
        """Return [(title, url)] from a list page's rendered markdown.

        We switched from JsonCssExtractionStrategy to markdown regex in
        M56-5: Yahoo Finance redesigned the news list DOM and the old
        `li[data-test="news-list-item"]` selector matches zero rows.
        Markdown-based extraction is less brittle — each subclass picks
        a regex that targets its site's article URL pattern.
        """
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
        # Tag every log line during this call with the job context so the
        # operator can demux interleaved crawl4ai output across visions /
        # capabilities. crawl4ai's own [FETCH]/[SCRAPE]/[COMPLETE] lines
        # come from its internal logger and we can't prefix those — but
        # the surrounding "start"/"list-url"/"article"/"done" lines we
        # emit are enough to identify the run.
        tag = f"[{self.name}|{sector_slug}|{capability_key}]"
        try:
            tickers = await self._ticker_provider(sector_slug)
        except Exception as exc:  # noqa: BLE001
            log.warning(
                "%s ticker_provider raised %s — falling back to static map",
                tag,
                exc,
            )
            tickers = tickers_for(sector_slug)
        list_urls = self._per_vision_urls(tickers)
        if not list_urls:
            log.info(
                "%s skipped — no tickers mapped (us=%d kr=%d)",
                tag,
                len(tickers.us or []),
                len(tickers.kr or []),
            )
            return []
        try:
            from crawl4ai import AsyncWebCrawler  # noqa: PLC0415
        except ImportError:
            log.warning(
                "%s crawl4ai not installed — skipped (pip install crawl4ai)",
                tag,
            )
            return []

        log.info(
            "%s start — %d list URLs, kw=%d, max=%d",
            tag,
            len(list_urls),
            len(keywords),
            max_results,
        )

        # One AsyncWebCrawler instance reused across list + body scrapes
        # — shares the underlying playwright browser context, much faster.
        # M56-5: list extraction is now markdown-regex per subclass; the
        # CSS extraction strategy was brittle (Yahoo's news-list DOM
        # changes silently broke it).
        results: list[RawSignal] = []
        seen_urls: set[str] = set()
        list_pages_ok = 0
        articles_seen = 0
        articles_matched = 0
        articles_fetched = 0

        # Manual __aenter__/__aexit__ instead of `async with`. Reason:
        # crawl4ai's playwright cleanup occasionally times out / raises
        # during __aexit__, which used to propagate out and discard the
        # `results` we already collected. Swallowing the cleanup
        # exception keeps the cron's per-vision result list intact —
        # whatever leaked playwright resource will GC eventually.
        crawler = AsyncWebCrawler(verbose=False)
        await crawler.__aenter__()
        try:
            for url in list_urls:
                log.info("%s list-page → %s", tag, url)
                page = await _crawl_url(crawler, url, bypass_cache=True)
                markdown = getattr(page, "markdown", None) or "" if page else ""
                if not markdown:
                    log.info("%s list-page empty: %s", tag, url)
                    continue
                articles = self._extract_articles_from_markdown(markdown)
                if not articles:
                    log.info(
                        "%s list-page yielded 0 articles (md %d chars): %s",
                        tag,
                        len(markdown),
                        url,
                    )
                    continue
                list_pages_ok += 1
                for title, href in articles[: max_results * 3]:
                    articles_seen += 1
                    if not href or not title:
                        continue
                    if href in seen_urls:
                        continue
                    seen_urls.add(href)
                    if not _matches_any(title, keywords):
                        continue
                    articles_matched += 1
                    log.info("%s article → %s — %.80s", tag, href, title)
                    body = await _crawl_url(crawler, href, bypass_cache=True)
                    articles_fetched += 1
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
                        log.info(
                            "%s done — hit max_results=%d (list_ok=%d seen=%d matched=%d)",
                            tag,
                            max_results,
                            list_pages_ok,
                            articles_seen,
                            articles_matched,
                        )
                        await _safe_close(crawler, tag)
                        return results
        finally:
            await _safe_close(crawler, tag)
        log.info(
            "%s done — raw_signals=%d (list_ok=%d/%d seen=%d matched=%d fetched=%d)",
            tag,
            len(results),
            list_pages_ok,
            len(list_urls),
            articles_seen,
            articles_matched,
            articles_fetched,
        )
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

    Yahoo redesigned the news-list DOM in mid-2026; the previous
    `li[data-test="news-list-item"]` selector matches zero rows now.
    We extract from the rendered markdown instead — Yahoo article
    URLs follow the stable `https://finance.yahoo.com/{news,m}/<slug>`
    pattern, which we can pull with a one-line regex against the
    full-page markdown.
    """

    source_kind: ClassVar[str] = "news"
    name: ClassVar[str] = "crawl4ai-yahoo"

    # Two URL flavors Yahoo serves on the per-ticker news page:
    #   /news/<slug>            — Yahoo-authored news article
    #   /m/<uuid>/<slug>        — partner/syndicated article
    # Both are linked from the list page; the chrome links (Skip to nav
    # etc.) are filtered out by the title-min-length guard.
    _YAHOO_LINK_RE = re.compile(
        r"\[([^\]]{20,200})\]\((https?://finance\.yahoo\.com/(?:news|m)/[^\)#]+)\)"
    )

    def _per_vision_urls(self, tickers: VisionTickers) -> list[str]:
        return [f"https://finance.yahoo.com/quote/{t}/news" for t in tickers.us]

    def _extract_articles_from_markdown(
        self, markdown: str
    ) -> list[tuple[str, str]]:
        return _dedupe_links(self._YAHOO_LINK_RE.findall(markdown))


class Crawl4aiFinvizSource(_Crawl4aiBase):
    """Finviz per-ticker news table. URL pattern:
    `https://finviz.com/quote.ashx?t={TICKER}`.

    Finviz aggregates external news for each ticker — the markdown
    contains a mix of internal finviz links + external article links
    from yahoo, barrons, digitimes, reuters, etc. Pull anything that's
    NOT a finviz.com URL and has a descriptive title.
    """

    source_kind: ClassVar[str] = "news"
    name: ClassVar[str] = "crawl4ai-finviz"

    _MD_LINK_RE = re.compile(r"\[([^\]]{15,200})\]\((https?://[^\)#]+)\)")

    def _per_vision_urls(self, tickers: VisionTickers) -> list[str]:
        return [f"https://finviz.com/quote.ashx?t={t}" for t in tickers.us]

    def _extract_articles_from_markdown(
        self, markdown: str
    ) -> list[tuple[str, str]]:
        candidates = self._MD_LINK_RE.findall(markdown)
        # Drop finviz internal nav + asset URLs; keep real outbound news.
        external = [
            (t.strip(), u)
            for (t, u) in candidates
            if "finviz.com" not in u and not _looks_like_asset(u)
        ]
        return _dedupe_links(external)


class Crawl4aiNaverSource(_Crawl4aiBase):
    """Naver Finance per-ticker news list. URL pattern:
    `https://finance.naver.com/item/news.naver?code={CODE}`.

    Korean stock codes are 6-digit numerics (no .KS suffix). The
    redesigned page wraps the list in an iframe whose markdown
    extraction is brittle; we fall back to a markdown regex that
    catches both naver-internal news (`news_read.naver`) and external
    syndicated articles. KR keywords (한글) match titles for visions
    whose keyword set is Korean; English-only keyword sets no-op.
    """

    source_kind: ClassVar[str] = "news"
    name: ClassVar[str] = "crawl4ai-naver"

    # Match naver.com URLs with multi-level subdomains (n.news.naver.com,
    # m.finance.naver.com, …). Don't try to filter on "news" in the URL
    # — naver's article URLs are opaque hashes; we trust the keyword
    # filter on the title to cull non-relevant rows.
    _NAVER_LINK_RE = re.compile(
        r"\[([^\]]{10,200})\]\((https?://(?:[a-z0-9-]+\.)*naver\.com/[^\)#]+)\)"
    )

    def _per_vision_urls(self, tickers: VisionTickers) -> list[str]:
        return [
            f"https://finance.naver.com/item/news.naver?code={c}"
            for c in tickers.kr
        ]

    def _extract_articles_from_markdown(
        self, markdown: str
    ) -> list[tuple[str, str]]:
        return _dedupe_links(self._NAVER_LINK_RE.findall(markdown))


# Markdown-extraction helpers ----------------------------------------------


def _dedupe_links(pairs: list[tuple[str, str]]) -> list[tuple[str, str]]:
    """Order-preserving dedupe by URL."""
    seen: set[str] = set()
    out: list[tuple[str, str]] = []
    for title, url in pairs:
        url = url.strip()
        title = title.strip()
        if not url or url in seen:
            continue
        seen.add(url)
        out.append((title, url))
    return out


_ASSET_EXTS = (
    ".png", ".jpg", ".jpeg", ".gif", ".svg", ".webp",
    ".css", ".js", ".ico", ".woff", ".woff2",
)


def _looks_like_asset(url: str) -> bool:
    """Filter out image/font/style URLs that show up in markdown."""
    u = url.lower().split("?", 1)[0]
    return any(u.endswith(ext) for ext in _ASSET_EXTS)


__all__ = [
    "Crawl4aiFinvizSource",
    "Crawl4aiNaverSource",
    "Crawl4aiYahooSource",
]
