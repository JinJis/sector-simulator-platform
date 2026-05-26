"""Unit tests for the USPTO signal adapter. Same posture as
test_signal_adapters.py — mocked HTTP, no network."""

from __future__ import annotations

from datetime import UTC, datetime
from unittest.mock import AsyncMock, patch

import httpx
import pytest

from data_pipeline.signals.uspto import UsptoSource


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
