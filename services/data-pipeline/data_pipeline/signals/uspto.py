"""USPTO PatentsView signal adapter.

PatentsView (https://search.patentsview.org/api/v1/patent/) is the
USPTO's official query API. As of 2024 it requires a free API key —
register at https://patentsview.org/apis/keyrequest. Without
USPTO_API_KEY env set, adapter returns [] + INFO log.

Query shape (POST JSON):
    {
      "q": {
        "_and": [
          {"_or": [{"_text_any": {"patent_abstract": "<kw1>"}}, ...]},
          {"_gte": {"patent_date": "<since YYYY-MM-DD>"}}
        ]
      },
      "f": ["patent_id", "patent_title", "patent_abstract", "patent_date"],
      "o": {"size": <max_results>, "sort": [{"patent_date": "desc"}]}
    }

We aim modestly — 5-10 patents per (vision×capability×day) is plenty
for the demo loop.
"""

from __future__ import annotations

import logging
import os
from datetime import UTC, datetime

import httpx

from .base import RawSignal

log = logging.getLogger(__name__)

USPTO_ENDPOINT = "https://search.patentsview.org/api/v1/patent/"


class UsptoSource:
    """PatentsView v1 client. Default: returns [] when no API key. Same
    log+swallow posture as arxiv/newsapi on transport errors."""

    source_kind: str = "patent"
    name: str = "uspto"

    def __init__(
        self,
        *,
        api_key: str | None = None,
        timeout_seconds: float = 20.0,
    ) -> None:
        self._api_key = api_key or os.environ.get("USPTO_API_KEY") or ""
        self._timeout = timeout_seconds

    async def fetch(
        self,
        *,
        sector_slug: str,
        capability_key: str,
        keywords: list[str],
        since: datetime,
        max_results: int = 10,
    ) -> list[RawSignal]:
        if not self._api_key:
            log.info(
                "uspto: USPTO_API_KEY unset — skipping %s/%s",
                sector_slug,
                capability_key,
            )
            return []
        clean_keywords = [kw.strip() for kw in keywords if kw.strip()]
        if not clean_keywords:
            return []

        # PatentsView's text-search clauses run against the abstract.
        # Use _text_any (OR within a single field) clauses, _or-joined.
        text_clauses = [
            {"_text_any": {"patent_abstract": kw}} for kw in clean_keywords
        ]
        # patent_date is a DATE column; format YYYY-MM-DD.
        since_date = since.astimezone(UTC).strftime("%Y-%m-%d")
        body = {
            "q": {
                "_and": [
                    {"_or": text_clauses},
                    {"_gte": {"patent_date": since_date}},
                ]
            },
            "f": ["patent_id", "patent_title", "patent_abstract", "patent_date"],
            "o": {
                "size": max_results,
                "sort": [{"patent_date": "desc"}],
            },
        }
        headers = {"X-Api-Key": self._api_key, "Content-Type": "application/json"}
        try:
            async with httpx.AsyncClient(timeout=self._timeout) as client:
                resp = await client.post(USPTO_ENDPOINT, json=body, headers=headers)
                resp.raise_for_status()
                data = resp.json()
        except (httpx.HTTPError, httpx.TimeoutException) as e:
            log.warning(
                "uspto: fetch failed for %s/%s: %s",
                sector_slug,
                capability_key,
                e,
            )
            return []
        except ValueError as e:
            log.warning("uspto: bad JSON for %s/%s: %s", sector_slug, capability_key, e)
            return []

        patents = data.get("patents") or data.get("data", {}).get("patents") or []
        signals: list[RawSignal] = []
        for p in patents[:max_results]:
            pid = p.get("patent_id") or p.get("patentId")
            title = p.get("patent_title") or p.get("patentTitle")
            abstract = p.get("patent_abstract") or p.get("patentAbstract")
            date_str = p.get("patent_date") or p.get("patentDate")
            if not pid or not title or not date_str:
                continue
            try:
                published = datetime.fromisoformat(f"{date_str}T00:00:00+00:00")
            except ValueError:
                continue
            url = f"https://patents.google.com/patent/US{pid}"
            if abstract and len(abstract) > 2000:
                abstract = abstract[:2000] + "…"
            signals.append(
                RawSignal(
                    sector_slug=sector_slug,
                    capability_key=capability_key,
                    source_kind=self.source_kind,
                    source_url=url,
                    source_id_ext=pid,
                    title=title,
                    summary=abstract,
                    published_at=published,
                )
            )
        log.info(
            "uspto: %s/%s — %d signals from %d patents",
            sector_slug,
            capability_key,
            len(signals),
            len(patents),
        )
        return signals
