"""Tests for the Google News RSS adapter.

Real HTTP isn't exercised — we monkeypatch `httpx.AsyncClient.get` to
return a canned RSS body. The tests pin the contract:

  - Empty keywords → empty list (no HTTP call).
  - Successful feed parse → one RawSignal per <item> whose pubDate is
    newer than `since` and whose title/link are non-empty.
  - Old items (pubDate < since) get filtered.
  - HTTP error → [] (logged, swallowed).
  - max_results respected.
"""

from __future__ import annotations

import sys
from datetime import UTC, datetime, timedelta

import httpx
import pytest

from data_pipeline.signals.google_news import GoogleNewsSource


_RSS_TEMPLATE = """<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>Google News</title>
    <item>
      <title>SpaceX deploys radiation-hardened processor for orbital DC</title>
      <link>https://news.google.com/articles/CBabc123</link>
      <pubDate>Tue, 28 May 2026 09:00:00 GMT</pubDate>
      <description>SpaceX announced ...</description>
      <source url="https://reuters.com">Reuters</source>
    </item>
    <item>
      <title>Old article we should skip</title>
      <link>https://news.google.com/articles/CBold</link>
      <pubDate>Mon, 01 Jan 2024 00:00:00 GMT</pubDate>
      <description>Old news</description>
    </item>
    <item>
      <title>Nvidia rad-hard GPU benchmark</title>
      <link>https://news.google.com/articles/CBdef456</link>
      <pubDate>Wed, 28 May 2026 10:00:00 GMT</pubDate>
      <description><![CDATA[<p>NVDA spec sheet leaked.</p>]]></description>
    </item>
  </channel>
</rss>
"""


class _FakeResponse:
    def __init__(self, text: str, status_code: int = 200) -> None:
        self.text = text
        self.status_code = status_code

    def raise_for_status(self) -> None:
        if self.status_code >= 400:
            raise httpx.HTTPStatusError(
                f"{self.status_code}", request=None, response=None
            )


class _FakeClient:
    def __init__(self, **_kwargs):
        self.calls: list[str] = []

    async def __aenter__(self) -> "_FakeClient":
        return self

    async def __aexit__(self, *_args) -> None:
        pass

    async def get(self, url: str) -> _FakeResponse:
        self.calls.append(url)
        return _FakeResponse(_RSS_TEMPLATE)


@pytest.fixture
def fake_httpx(monkeypatch: pytest.MonkeyPatch):
    client = _FakeClient()
    monkeypatch.setattr(httpx, "AsyncClient", lambda **kw: client)
    return client


@pytest.mark.asyncio
async def test_empty_keywords_skips_http(fake_httpx: _FakeClient) -> None:
    src = GoogleNewsSource()
    out = await src.fetch(
        sector_slug="x",
        capability_key="y",
        keywords=[],
        since=datetime.now(UTC),
    )
    assert out == []
    assert fake_httpx.calls == []


@pytest.mark.asyncio
async def test_parses_items_within_since(fake_httpx: _FakeClient) -> None:
    src = GoogleNewsSource()
    since = datetime(2026, 5, 28, 0, 0, tzinfo=UTC)
    out = await src.fetch(
        sector_slug="space-data-center",
        capability_key="rad_hard_compute",
        keywords=["rad-hard", "radiation hardened"],
        since=since,
    )
    # Two items pass the date filter, one is too old.
    assert len(out) == 2
    titles = [r.title for r in out]
    assert "SpaceX deploys radiation-hardened processor for orbital DC" in titles
    assert "Nvidia rad-hard GPU benchmark" in titles
    # Old item filtered out.
    assert "Old article we should skip" not in titles
    # source_kind / sector_slug / capability_key correctly stamped.
    assert all(r.source_kind == "news" for r in out)
    assert all(r.sector_slug == "space-data-center" for r in out)
    assert all(r.capability_key == "rad_hard_compute" for r in out)
    # The CDATA + HTML in description got stripped.
    nvda = next(r for r in out if "Nvidia" in r.title)
    assert nvda.summary == "NVDA spec sheet leaked."


@pytest.mark.asyncio
async def test_query_quotes_each_keyword(fake_httpx: _FakeClient) -> None:
    src = GoogleNewsSource()
    await src.fetch(
        sector_slug="x",
        capability_key="y",
        keywords=["rad-hard", "single event upset"],
        since=datetime(2020, 1, 1, tzinfo=UTC),
    )
    assert len(fake_httpx.calls) == 1
    url = fake_httpx.calls[0]
    # OR-joined quoted phrases (URL-encoded). Look for one of the
    # quoted forms — different urllib quote_plus interpretations encode
    # the quote/space differently, but '%22rad-hard%22' is stable.
    assert "%22rad-hard%22" in url
    assert "%22single+event+upset%22" in url or "%22single%20event%20upset%22" in url


@pytest.mark.asyncio
async def test_max_results_caps(fake_httpx: _FakeClient) -> None:
    src = GoogleNewsSource()
    since = datetime(2024, 1, 1, tzinfo=UTC)  # all in-window
    out = await src.fetch(
        sector_slug="x",
        capability_key="y",
        keywords=["test"],
        since=since,
        max_results=1,
    )
    assert len(out) == 1


@pytest.mark.asyncio
async def test_http_error_returns_empty(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    class _Fail:
        async def __aenter__(self) -> "_Fail":
            return self

        async def __aexit__(self, *_args) -> None:
            pass

        async def get(self, _url: str) -> None:
            raise httpx.ConnectError("nope")

    monkeypatch.setattr(httpx, "AsyncClient", lambda **kw: _Fail())
    src = GoogleNewsSource()
    out = await src.fetch(
        sector_slug="x",
        capability_key="y",
        keywords=["whatever"],
        since=datetime(2024, 1, 1, tzinfo=UTC),
    )
    assert out == []


@pytest.mark.asyncio
async def test_naive_since_treated_as_utc(fake_httpx: _FakeClient) -> None:
    """When the caller passes a naive datetime (legacy callers), the
    adapter must not crash — assume UTC."""
    src = GoogleNewsSource()
    out = await src.fetch(
        sector_slug="x",
        capability_key="y",
        keywords=["test"],
        since=datetime(2024, 1, 1),  # NOTE: naive
    )
    assert isinstance(out, list)
