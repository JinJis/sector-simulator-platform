"""Unit tests for the NewsAPI + USPTO signal adapters. Same posture as
test_signal_adapters.py — mocked HTTP, no network."""

from __future__ import annotations

from datetime import UTC, datetime
from unittest.mock import AsyncMock, patch

import httpx
import pytest

from data_pipeline.signals.newsapi import NewsApiSource
from data_pipeline.signals.uspto import UsptoSource


# ---- NewsAPI -------------------------------------------------------------


@pytest.mark.asyncio
class TestNewsApiSource:
    async def test_no_key_returns_empty_without_http_call(self) -> None:
        source = NewsApiSource(api_key="")
        with patch("data_pipeline.signals.newsapi.httpx.AsyncClient") as MockClient:
            signals = await source.fetch(
                sector_slug="space-data-center",
                capability_key="rad_hard_compute",
                keywords=["radiation"],
                since=datetime(2026, 1, 1, tzinfo=UTC),
            )
        assert signals == []
        MockClient.assert_not_called()

    async def test_parses_articles(self) -> None:
        source = NewsApiSource(api_key="test-key")
        body = {
            "status": "ok",
            "articles": [
                {
                    "url": "https://example.com/lonestar-series-b",
                    "title": "Lonestar Data closes $48M Series B",
                    "description": "Series B led by Type One Ventures.",
                    "publishedAt": "2026-05-21T12:00:00Z",
                },
                {
                    "url": "https://example.com/old",
                    "title": "Old article",
                    "description": "Stale content.",
                    "publishedAt": "2020-01-01T00:00:00Z",
                },
            ],
        }
        with patch("data_pipeline.signals.newsapi.httpx.AsyncClient") as MockClient:
            mock_resp = AsyncMock()
            mock_resp.json = lambda: body
            mock_resp.raise_for_status = lambda: None
            MockClient.return_value.__aenter__.return_value.get = AsyncMock(
                return_value=mock_resp
            )
            signals = await source.fetch(
                sector_slug="space-data-center",
                capability_key="launch_economics",
                keywords=["orbital"],
                since=datetime(2026, 5, 1, tzinfo=UTC),
            )
        # Older article filtered by `since`.
        assert len(signals) == 1
        assert signals[0].source_kind == "news"
        assert "Lonestar" in signals[0].title

    async def test_non_ok_status_returns_empty(self) -> None:
        source = NewsApiSource(api_key="test-key")
        body = {"status": "error", "message": "rate limit exceeded"}
        with patch("data_pipeline.signals.newsapi.httpx.AsyncClient") as MockClient:
            mock_resp = AsyncMock()
            mock_resp.json = lambda: body
            mock_resp.raise_for_status = lambda: None
            MockClient.return_value.__aenter__.return_value.get = AsyncMock(
                return_value=mock_resp
            )
            signals = await source.fetch(
                sector_slug="space-data-center",
                capability_key="thermal_rejection",
                keywords=["radiator"],
                since=datetime(2026, 1, 1, tzinfo=UTC),
            )
        assert signals == []

    async def test_http_error_returns_empty(self) -> None:
        source = NewsApiSource(api_key="test-key")
        with patch("data_pipeline.signals.newsapi.httpx.AsyncClient") as MockClient:
            MockClient.return_value.__aenter__.return_value.get = AsyncMock(
                side_effect=httpx.ConnectError("dns failure")
            )
            signals = await source.fetch(
                sector_slug="space-data-center",
                capability_key="downlink_bandwidth",
                keywords=["optical"],
                since=datetime(2026, 1, 1, tzinfo=UTC),
            )
        assert signals == []

    async def test_empty_keywords_short_circuits(self) -> None:
        source = NewsApiSource(api_key="test-key")
        with patch("data_pipeline.signals.newsapi.httpx.AsyncClient") as MockClient:
            signals = await source.fetch(
                sector_slug="space-data-center",
                capability_key="x",
                keywords=[],
                since=datetime(2026, 1, 1, tzinfo=UTC),
            )
        assert signals == []
        MockClient.assert_not_called()

    async def test_long_description_clipped(self) -> None:
        source = NewsApiSource(api_key="test-key")
        long_content = "A" * 5000
        body = {
            "status": "ok",
            "articles": [
                {
                    "url": "https://example.com/x",
                    "title": "Title",
                    "description": long_content,
                    "publishedAt": "2026-05-21T12:00:00Z",
                }
            ],
        }
        with patch("data_pipeline.signals.newsapi.httpx.AsyncClient") as MockClient:
            mock_resp = AsyncMock()
            mock_resp.json = lambda: body
            mock_resp.raise_for_status = lambda: None
            MockClient.return_value.__aenter__.return_value.get = AsyncMock(
                return_value=mock_resp
            )
            signals = await source.fetch(
                sector_slug="space-data-center",
                capability_key="x",
                keywords=["foo"],
                since=datetime(2026, 5, 1, tzinfo=UTC),
            )
        assert len(signals) == 1
        # 2000-char clip + ellipsis suffix.
        assert signals[0].summary is not None
        assert signals[0].summary.endswith("…")
        assert len(signals[0].summary) <= 2001 + 1


# ---- USPTO ---------------------------------------------------------------


@pytest.mark.asyncio
class TestUsptoSource:
    async def test_no_key_returns_empty(self) -> None:
        source = UsptoSource(api_key="")
        with patch("data_pipeline.signals.uspto.httpx.AsyncClient") as MockClient:
            signals = await source.fetch(
                sector_slug="space-data-center",
                capability_key="thermal_rejection",
                keywords=["radiator"],
                since=datetime(2026, 1, 1, tzinfo=UTC),
            )
        assert signals == []
        MockClient.assert_not_called()

    async def test_parses_patents(self) -> None:
        source = UsptoSource(api_key="test-key")
        body = {
            "patents": [
                {
                    "patent_id": "12345678",
                    "patent_title": "Sealed two-phase thermal loop assembly",
                    "patent_abstract": "A two-phase loop assembly for orbital DC heat rejection.",
                    "patent_date": "2026-05-15",
                }
            ]
        }
        with patch("data_pipeline.signals.uspto.httpx.AsyncClient") as MockClient:
            mock_resp = AsyncMock()
            mock_resp.json = lambda: body
            mock_resp.raise_for_status = lambda: None
            MockClient.return_value.__aenter__.return_value.post = AsyncMock(
                return_value=mock_resp
            )
            signals = await source.fetch(
                sector_slug="space-data-center",
                capability_key="thermal_rejection",
                keywords=["thermal loop"],
                since=datetime(2026, 1, 1, tzinfo=UTC),
            )
        assert len(signals) == 1
        assert signals[0].source_kind == "patent"
        assert signals[0].source_id_ext == "12345678"
        assert "patents.google.com" in signals[0].source_url

    async def test_http_error_returns_empty(self) -> None:
        source = UsptoSource(api_key="test-key")
        with patch("data_pipeline.signals.uspto.httpx.AsyncClient") as MockClient:
            MockClient.return_value.__aenter__.return_value.post = AsyncMock(
                side_effect=httpx.ReadTimeout("slow")
            )
            signals = await source.fetch(
                sector_slug="space-data-center",
                capability_key="x",
                keywords=["foo"],
                since=datetime(2026, 1, 1, tzinfo=UTC),
            )
        assert signals == []

    async def test_empty_keywords_short_circuits(self) -> None:
        source = UsptoSource(api_key="test-key")
        with patch("data_pipeline.signals.uspto.httpx.AsyncClient") as MockClient:
            signals = await source.fetch(
                sector_slug="space-data-center",
                capability_key="x",
                keywords=[],
                since=datetime(2026, 1, 1, tzinfo=UTC),
            )
        assert signals == []
        MockClient.assert_not_called()

    async def test_bad_date_in_patent_skipped(self) -> None:
        source = UsptoSource(api_key="test-key")
        body = {
            "patents": [
                {
                    "patent_id": "1",
                    "patent_title": "x",
                    "patent_abstract": "y",
                    "patent_date": "not-a-date",
                },
                {
                    "patent_id": "2",
                    "patent_title": "ok",
                    "patent_abstract": "y",
                    "patent_date": "2026-05-15",
                },
            ]
        }
        with patch("data_pipeline.signals.uspto.httpx.AsyncClient") as MockClient:
            mock_resp = AsyncMock()
            mock_resp.json = lambda: body
            mock_resp.raise_for_status = lambda: None
            MockClient.return_value.__aenter__.return_value.post = AsyncMock(
                return_value=mock_resp
            )
            signals = await source.fetch(
                sector_slug="space-data-center",
                capability_key="x",
                keywords=["foo"],
                since=datetime(2026, 1, 1, tzinfo=UTC),
            )
        assert len(signals) == 1
        assert signals[0].source_id_ext == "2"
