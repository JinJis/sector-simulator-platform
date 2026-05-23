"""Unit tests for signal adapter parsing — no network calls.

We pin the adapter against a small canned arXiv Atom response so
regression in `_parse_entries` / `_parse_published` / `_parse_arxiv_id`
shows up loudly. End-to-end network tests live in tests/test_api.py
behind a skip-if-no-internet marker.
"""

from __future__ import annotations

from datetime import UTC, datetime
from unittest.mock import AsyncMock, patch

import httpx
import pytest

from data_pipeline.signals.arxiv import (
    ArxivSource,
    _build_query,
    _parse_arxiv_id,
    _parse_entries,
    _parse_published,
)
from data_pipeline.signals.base import RawSignal


ARXIV_XML_SAMPLE = """<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <entry>
    <id>http://arxiv.org/abs/2401.12345v2</id>
    <title>Ka-band 100Gbps optical downlink demonstration over 1200km</title>
    <summary>We demonstrate sustained 100Gbps Ka-band optical
    downlink between LEO and an alpine ground station.</summary>
    <published>2026-04-22T18:00:00Z</published>
  </entry>
  <entry>
    <id>http://arxiv.org/abs/2402.99999</id>
    <title>Radiation hardness of AMD MI300 in LEO orbit</title>
    <summary>SEU rate measurements on MI300 under simulated LEO flux.</summary>
    <published>2026-05-10T00:00:00Z</published>
  </entry>
  <entry>
    <id>http://arxiv.org/abs/2401.00001</id>
    <title>Incomplete entry without published</title>
  </entry>
</feed>
"""


class TestParseHelpers:
    def test_parse_arxiv_id_strips_version_suffix(self) -> None:
        assert _parse_arxiv_id("http://arxiv.org/abs/2401.12345v2") == "2401.12345"
        assert _parse_arxiv_id("http://arxiv.org/abs/2402.99999") == "2402.99999"
        assert _parse_arxiv_id("https://arxiv.org/abs/cond-mat.1234") == "cond-mat.1234"

    def test_parse_arxiv_id_returns_none_on_bad_url(self) -> None:
        assert _parse_arxiv_id("https://example.com/foo") is None

    def test_parse_published_handles_z_suffix(self) -> None:
        result = _parse_published("2026-04-22T18:00:00Z")
        assert result is not None
        assert result.tzinfo is not None
        assert result.year == 2026 and result.month == 4 and result.day == 22

    def test_parse_published_returns_none_on_garbage(self) -> None:
        assert _parse_published("not-a-date") is None

    def test_build_query_joins_with_or(self) -> None:
        q = _build_query(["radiation hardened", "single event upset"])
        assert q == 'all:"radiation hardened" OR all:"single event upset"'

    def test_build_query_empty_keywords(self) -> None:
        assert _build_query([]) == ""

    def test_build_query_drops_empty_strings(self) -> None:
        q = _build_query(["arxiv", "", "test"])
        assert q == 'all:"arxiv" OR all:"test"'


class TestParseEntries:
    def test_parses_valid_entries(self) -> None:
        entries = _parse_entries(ARXIV_XML_SAMPLE)
        # 3 entries in sample; one is incomplete (no published) so skipped.
        assert len(entries) == 2
        assert entries[0]["arxiv_id"] == "2401.12345"
        assert entries[1]["arxiv_id"] == "2402.99999"
        # Whitespace collapsed in title.
        assert "Ka-band 100Gbps" in str(entries[0]["title"])
        # Summary preserved.
        assert isinstance(entries[0]["summary"], str)

    def test_parses_published_to_aware_datetime(self) -> None:
        entries = _parse_entries(ARXIV_XML_SAMPLE)
        published = entries[0]["published_at"]
        assert isinstance(published, datetime)
        assert published.tzinfo is not None

    def test_handles_garbage_xml(self) -> None:
        entries = _parse_entries("<not-valid-xml>")
        assert entries == []


@pytest.mark.asyncio
class TestArxivSourceFetch:
    """Mock the httpx.AsyncClient.get call; verify the adapter shapes
    the result into RawSignal records correctly."""

    @pytest.fixture
    def source(self) -> ArxivSource:
        return ArxivSource(timeout_seconds=1.0)

    async def test_returns_signals_above_since_cutoff(self, source: ArxivSource) -> None:
        # Cutoff between the two entries (2026-04-22 paper vs 2026-05-10
        # paper). Expect only the newer one.
        since = datetime(2026, 5, 1, tzinfo=UTC)
        with patch("data_pipeline.signals.arxiv.httpx.AsyncClient") as MockClient:
            mock_resp = AsyncMock()
            mock_resp.text = ARXIV_XML_SAMPLE
            mock_resp.raise_for_status = lambda: None
            MockClient.return_value.__aenter__.return_value.get = AsyncMock(
                return_value=mock_resp
            )

            signals = await source.fetch(
                sector_slug="space-data-center",
                capability_key="rad_hard_compute",
                keywords=["radiation hardened"],
                since=since,
                max_results=20,
            )
        assert len(signals) == 1
        assert signals[0].source_id_ext == "2402.99999"
        assert signals[0].sector_slug == "space-data-center"
        assert signals[0].capability_key == "rad_hard_compute"
        assert signals[0].source_kind == "paper"
        assert isinstance(signals[0], RawSignal)

    async def test_returns_all_when_since_is_very_old(self, source: ArxivSource) -> None:
        since = datetime(2020, 1, 1, tzinfo=UTC)
        with patch("data_pipeline.signals.arxiv.httpx.AsyncClient") as MockClient:
            mock_resp = AsyncMock()
            mock_resp.text = ARXIV_XML_SAMPLE
            mock_resp.raise_for_status = lambda: None
            MockClient.return_value.__aenter__.return_value.get = AsyncMock(
                return_value=mock_resp
            )
            signals = await source.fetch(
                sector_slug="space-data-center",
                capability_key="rad_hard_compute",
                keywords=["radiation"],
                since=since,
            )
        assert len(signals) == 2

    async def test_returns_empty_on_empty_keywords(self, source: ArxivSource) -> None:
        # Should short-circuit without making an HTTP call.
        signals = await source.fetch(
            sector_slug="space-data-center",
            capability_key="rad_hard_compute",
            keywords=[],
            since=datetime(2020, 1, 1, tzinfo=UTC),
        )
        assert signals == []

    async def test_returns_empty_on_http_error(self, source: ArxivSource) -> None:
        with patch("data_pipeline.signals.arxiv.httpx.AsyncClient") as MockClient:
            # Simulate a network error.
            MockClient.return_value.__aenter__.return_value.get = AsyncMock(
                side_effect=httpx.ConnectError("connection refused")
            )
            signals = await source.fetch(
                sector_slug="space-data-center",
                capability_key="rad_hard_compute",
                keywords=["radiation"],
                since=datetime(2026, 1, 1, tzinfo=UTC),
            )
        assert signals == []

    async def test_returns_empty_on_4xx(self, source: ArxivSource) -> None:
        with patch("data_pipeline.signals.arxiv.httpx.AsyncClient") as MockClient:
            mock_resp = AsyncMock()
            mock_resp.raise_for_status = lambda: (_ for _ in ()).throw(
                httpx.HTTPStatusError(
                    "400 Bad Request",
                    request=httpx.Request("GET", "http://example.com"),
                    response=httpx.Response(400),
                )
            )
            MockClient.return_value.__aenter__.return_value.get = AsyncMock(
                return_value=mock_resp
            )
            signals = await source.fetch(
                sector_slug="space-data-center",
                capability_key="rad_hard_compute",
                keywords=["foo"],
                since=datetime(2026, 1, 1, tzinfo=UTC),
            )
        assert signals == []
