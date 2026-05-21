"""Unit tests for the Frankfurter historical-FX adapter (M10c).

Network calls are stubbed via `httpx.MockTransport` so the suite stays
offline. We assert: the URL/params built correctly, the cache works,
HTTP non-2xx → None, network errors → None.
"""

from __future__ import annotations

from datetime import date

import httpx
import pytest

from data_pipeline.adapters import frankfurter_fx as fx_mod
from data_pipeline.adapters.frankfurter_fx import FrankfurterFx

# Hold onto the real AsyncClient before any monkey-patching so the
# mock-transport client construction itself doesn't recurse into the
# patched name.
_REAL_ASYNC_CLIENT = httpx.AsyncClient


def _install_mock(monkeypatch: pytest.MonkeyPatch, handler) -> None:
    """Swap `frankfurter_fx.httpx.AsyncClient` for a factory that hands
    back a fresh client wired to `handler`. We patch through the module
    attribute (not `httpx.AsyncClient` globally) so other tests aren't
    affected."""

    def factory(*args, **kwargs):  # noqa: ANN001, ANN002, ANN003
        return _REAL_ASYNC_CLIENT(
            transport=httpx.MockTransport(handler),
            timeout=kwargs.get("timeout", 5.0),
        )

    monkeypatch.setattr(fx_mod.httpx, "AsyncClient", factory)


@pytest.mark.asyncio
async def test_returns_rate_for_historical_date(monkeypatch: pytest.MonkeyPatch) -> None:
    captured: dict = {}

    def handler(request: httpx.Request) -> httpx.Response:
        captured["url"] = str(request.url)
        return httpx.Response(
            200,
            json={"amount": 1.0, "base": "USD", "date": "2025-03-31", "rates": {"KRW": 1457.21}},
        )

    _install_mock(monkeypatch, handler)

    fx = FrankfurterFx()
    rate = await fx.krw_per_usd(date(2025, 3, 31))
    assert rate == pytest.approx(1457.21)
    assert "2025-03-31" in captured["url"]
    assert "from=USD" in captured["url"]
    assert "to=KRW" in captured["url"]


@pytest.mark.asyncio
async def test_caches_by_date(monkeypatch: pytest.MonkeyPatch) -> None:
    calls = {"n": 0}

    def handler(request: httpx.Request) -> httpx.Response:
        calls["n"] += 1
        return httpx.Response(200, json={"rates": {"KRW": 1380.0}})

    _install_mock(monkeypatch, handler)

    fx = FrankfurterFx()
    a = await fx.krw_per_usd(date(2025, 6, 30))
    b = await fx.krw_per_usd(date(2025, 6, 30))
    assert a == b == 1380.0
    assert calls["n"] == 1


@pytest.mark.asyncio
async def test_separate_dates_are_separate_cache_entries(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    calls = {"n": 0}

    def handler(request: httpx.Request) -> httpx.Response:
        calls["n"] += 1
        return httpx.Response(200, json={"rates": {"KRW": 1380.0 + calls["n"]}})

    _install_mock(monkeypatch, handler)

    fx = FrankfurterFx()
    a = await fx.krw_per_usd(date(2024, 3, 31))
    b = await fx.krw_per_usd(date(2025, 3, 31))
    assert calls["n"] == 2
    assert a != b


@pytest.mark.asyncio
async def test_non_2xx_returns_none(monkeypatch: pytest.MonkeyPatch) -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(500, json={"error": "boom"})

    _install_mock(monkeypatch, handler)

    fx = FrankfurterFx()
    rate = await fx.krw_per_usd(date(2025, 3, 31))
    assert rate is None


@pytest.mark.asyncio
async def test_network_error_returns_none(monkeypatch: pytest.MonkeyPatch) -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("no route to host")

    _install_mock(monkeypatch, handler)

    fx = FrankfurterFx()
    rate = await fx.krw_per_usd(date(2025, 3, 31))
    assert rate is None


@pytest.mark.asyncio
async def test_missing_target_currency_returns_none(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={"rates": {}})

    _install_mock(monkeypatch, handler)

    fx = FrankfurterFx()
    rate = await fx.krw_per_usd(date(2025, 3, 31))
    assert rate is None
