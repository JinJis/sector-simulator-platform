"""NewsAPI.org signal adapter.

Free tier: 100 requests/day. With 3 visions × ~9 capabilities = 27
requests/day if we call once per capability, fits comfortably. No
multi-capability mention dedup is needed at this layer — the signal
table's `@@unique([source_url, capability_id])` handles same-URL-
multiple-capabilities downstream.

Endpoint: https://newsapi.org/v2/everything
Auth: header `X-Api-Key: <NEWSAPI_KEY>` (also accepts query param but
header keeps the key off URL logs).

Without NEWSAPI_KEY env set, the adapter short-circuits to empty list +
INFO log. Same posture as arXiv on transport errors — log + return [].
"""

from __future__ import annotations

import logging
import os
from datetime import UTC, datetime

import httpx

from .base import RawSignal

log = logging.getLogger(__name__)

NEWSAPI_ENDPOINT = "https://newsapi.org/v2/everything"
# NewsAPI's free tier limits articles per page to 100. We use far less.
_DEFAULT_PAGE_SIZE = 20


def _build_query(keywords: list[str]) -> str:
    """NewsAPI accepts double-quoted phrase keywords separated by OR.
    Single-word keywords don't strictly need quoting but quoting all is
    consistent + future-safe."""
    if not keywords:
        return ""
    parts = [f'"{kw}"' for kw in keywords if kw.strip()]
    return " OR ".join(parts)


def _parse_published(iso: str) -> datetime | None:
    try:
        return datetime.fromisoformat(iso.replace("Z", "+00:00"))
    except (ValueError, AttributeError):
        return None


class NewsApiSource:
    """NewsAPI.org client. Requires NEWSAPI_KEY env (or pass via ctor).
    Empty key → adapter returns [] silently."""

    source_kind: str = "news"
    name: str = "newsapi"

    def __init__(
        self,
        *,
        api_key: str | None = None,
        timeout_seconds: float = 15.0,
        language: str = "en",
    ) -> None:
        self._api_key = api_key or os.environ.get("NEWSAPI_KEY") or ""
        self._timeout = timeout_seconds
        self._language = language

    async def fetch(
        self,
        *,
        sector_slug: str,
        capability_key: str,
        keywords: list[str],
        since: datetime,
        max_results: int = 20,
    ) -> list[RawSignal]:
        if not self._api_key:
            log.info(
                "newsapi: NEWSAPI_KEY unset — skipping %s/%s",
                sector_slug,
                capability_key,
            )
            return []
        query = _build_query(keywords)
        if not query:
            return []

        params: dict[str, str] = {
            "q": query,
            "from": since.astimezone(UTC).strftime("%Y-%m-%dT%H:%M:%SZ"),
            "sortBy": "publishedAt",
            "language": self._language,
            "pageSize": str(min(_DEFAULT_PAGE_SIZE, max_results)),
        }
        headers = {"X-Api-Key": self._api_key}
        try:
            async with httpx.AsyncClient(timeout=self._timeout) as client:
                resp = await client.get(
                    NEWSAPI_ENDPOINT, params=params, headers=headers
                )
                resp.raise_for_status()
                data = resp.json()
        except (httpx.HTTPError, httpx.TimeoutException) as e:
            log.warning(
                "newsapi: fetch failed for %s/%s: %s",
                sector_slug,
                capability_key,
                e,
            )
            return []
        except ValueError as e:
            log.warning("newsapi: bad JSON for %s/%s: %s", sector_slug, capability_key, e)
            return []

        if data.get("status") != "ok":
            log.warning(
                "newsapi: non-ok status for %s/%s: %r",
                sector_slug,
                capability_key,
                data.get("message"),
            )
            return []

        articles = data.get("articles") or []
        signals: list[RawSignal] = []
        for art in articles[:max_results]:
            url = art.get("url")
            title = art.get("title")
            if not url or not title:
                continue
            published = _parse_published(art.get("publishedAt") or "")
            if published is None:
                continue
            # NewsAPI returns timezone-aware ISO; arXiv parity check.
            if since.tzinfo is None:
                cutoff = since.replace(tzinfo=UTC)
            else:
                cutoff = since
            if published < cutoff:
                continue
            description = art.get("description") or art.get("content")
            # description can be very long via "content" field; clip to
            # the extractor's reasonable input window.
            if description and len(description) > 2000:
                description = description[:2000] + "…"

            signals.append(
                RawSignal(
                    sector_slug=sector_slug,
                    capability_key=capability_key,
                    source_kind=self.source_kind,
                    source_url=url,
                    source_id_ext=None,  # NewsAPI has no stable per-article id
                    title=title,
                    summary=description,
                    published_at=published,
                )
            )

        log.info(
            "newsapi: %s/%s — %d signals from %d articles",
            sector_slug,
            capability_key,
            len(signals),
            len(articles),
        )
        return signals
