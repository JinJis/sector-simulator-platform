"""arXiv signal adapter — fetches papers matching capability keywords.

Free, no key required. The export endpoint is rate-limited (~1 req/3s
per origin). For our daily cron with ~3 visions × ~9 capabilities = 27
requests, that's well within tolerance even with retry.

Endpoint: http://export.arxiv.org/api/query?search_query=...
Response: Atom XML.

We parse with stdlib (no lxml dependency added).
"""

from __future__ import annotations

import logging
import re
from datetime import UTC, datetime
from urllib.parse import quote_plus
from xml.etree import ElementTree as ET

import httpx

from .base import RawSignal

log = logging.getLogger(__name__)

ARXIV_ENDPOINT = "http://export.arxiv.org/api/query"

# Atom XML namespace.
_NS = {
    "atom": "http://www.w3.org/2005/Atom",
    "arxiv": "http://arxiv.org/schemas/atom",
}

# arXiv pulls full ISO-8601 with Z; Python datetime needs a tiny adjust.
_ARXIV_ID_PATTERN = re.compile(r"arxiv\.org/abs/([\w\.\-]+?)(?:v\d+)?$")


def _build_query(keywords: list[str]) -> str:
    """Build the search_query parameter from a keyword list.

    Each keyword becomes a phrase-quoted `all:"term"` clause; clauses
    OR together. Empty keywords produce an empty query (caller should
    short-circuit).
    """
    if not keywords:
        return ""
    # Quote each keyword as a phrase, prefix with `all:` (search across
    # title + abstract + author etc.), join with OR.
    parts = [f'all:"{kw}"' for kw in keywords if kw.strip()]
    return " OR ".join(parts)


def _parse_arxiv_id(entry_id_url: str) -> str | None:
    """Extract the bare arXiv id (e.g. "2401.12345") from a full URL.
    Strips any version suffix (`v1`, `v2`, ...)."""
    m = _ARXIV_ID_PATTERN.search(entry_id_url)
    return m.group(1) if m else None


def _parse_published(published_iso: str) -> datetime | None:
    """arXiv emits ISO 8601 with trailing 'Z'. Python <3.11 needed
    explicit fromisoformat patches; 3.12+ handles Z natively."""
    try:
        return datetime.fromisoformat(published_iso.replace("Z", "+00:00"))
    except ValueError:
        log.warning("arxiv: bad published timestamp %r", published_iso)
        return None


def _parse_entries(xml_text: str) -> list[dict[str, str | datetime | None]]:
    """Parse arXiv Atom XML into a list of {id, title, summary, link,
    published} dicts. Bad entries are skipped (logged)."""
    try:
        root = ET.fromstring(xml_text)
    except ET.ParseError as e:
        log.warning("arxiv: XML parse error: %s", e)
        return []

    out: list[dict[str, str | datetime | None]] = []
    for entry in root.findall("atom:entry", _NS):
        id_el = entry.find("atom:id", _NS)
        title_el = entry.find("atom:title", _NS)
        summary_el = entry.find("atom:summary", _NS)
        published_el = entry.find("atom:published", _NS)

        if id_el is None or title_el is None or published_el is None:
            log.debug("arxiv: skipping entry — missing required field")
            continue

        url = (id_el.text or "").strip()
        title = " ".join((title_el.text or "").split())  # collapse whitespace
        summary = " ".join((summary_el.text or "").split()) if summary_el is not None else None
        published = _parse_published(published_el.text or "")
        if published is None:
            continue

        out.append(
            {
                "url": url,
                "title": title,
                "summary": summary,
                "published_at": published,
                "arxiv_id": _parse_arxiv_id(url),
            }
        )
    return out


class ArxivSource:
    """arXiv export-API client. Stateless; fetch one (vision×capability)
    at a time. Tolerates errors by returning empty lists + logging."""

    source_kind: str = "paper"
    name: str = "arxiv"

    def __init__(self, *, timeout_seconds: float = 15.0) -> None:
        self._timeout = timeout_seconds

    async def fetch(
        self,
        *,
        sector_slug: str,
        capability_key: str,
        keywords: list[str],
        since: datetime,
        max_results: int = 20,
    ) -> list[RawSignal]:
        query = _build_query(keywords)
        if not query:
            return []

        params = {
            "search_query": query,
            "start": "0",
            "max_results": str(max_results),
            "sortBy": "submittedDate",
            "sortOrder": "descending",
        }
        url = f"{ARXIV_ENDPOINT}?{'&'.join(f'{k}={quote_plus(v)}' for k, v in params.items())}"

        try:
            async with httpx.AsyncClient(timeout=self._timeout) as client:
                resp = await client.get(url)
                resp.raise_for_status()
                xml_text = resp.text
        except (httpx.HTTPError, httpx.TimeoutException) as e:
            log.warning(
                "arxiv: fetch failed for %s/%s: %s", sector_slug, capability_key, e
            )
            return []

        entries = _parse_entries(xml_text)

        # `since` filter on parsed dates. arXiv sortBy=submittedDate is
        # close-enough; we apply our own bound to handle off-by-one.
        # Naive datetimes from arXiv are UTC-aware after our parsing.
        if since.tzinfo is None:
            since = since.replace(tzinfo=UTC)

        signals: list[RawSignal] = []
        for entry in entries:
            published_at = entry["published_at"]
            assert isinstance(published_at, datetime)
            if published_at < since:
                continue
            url_val = entry["url"]
            title_val = entry["title"]
            assert isinstance(url_val, str)
            assert isinstance(title_val, str)
            summary_val = entry["summary"]
            arxiv_id_val = entry["arxiv_id"]
            signals.append(
                RawSignal(
                    sector_slug=sector_slug,
                    capability_key=capability_key,
                    source_kind=self.source_kind,
                    source_url=url_val,
                    source_id_ext=arxiv_id_val if isinstance(arxiv_id_val, str) else None,
                    title=title_val,
                    summary=summary_val if isinstance(summary_val, str) else None,
                    published_at=published_at,
                )
            )

        log.info(
            "arxiv: %s/%s — %d signals (from %d entries)",
            sector_slug,
            capability_key,
            len(signals),
            len(entries),
        )
        return signals
