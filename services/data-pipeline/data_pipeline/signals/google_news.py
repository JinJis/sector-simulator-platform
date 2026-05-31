"""Google News RSS adapter — keyword-driven news search.

Replaces the per-ticker-page approach (Yahoo / Finviz / Naver) for
capability-relevant news. The per-ticker pages return mostly
investor-relations noise (analyst notes, stock-price articles) that
match the ticker but not the capability the operator cares about.

Google News exposes a per-query RSS feed at
`https://news.google.com/rss/search?q=<keywords>&hl=en-US&gl=US&ceid=US:en`.
No API key, no rate-limit, returns the same articles that show up in
the Google News UI for that query.

Lifecycle per call:
  1. Build OR-joined query from the capability's keyword list.
  2. Fetch RSS XML via httpx (no Playwright — server-rendered).
  3. Parse <item> entries: title, link (Google redirect URL), pubDate,
     <source>. Keep entries within `since`.
  4. Emit one RawSignal per entry. We don't fetch the article body —
     SignalExtractor scores from title alone; the Google redirect URL
     is what the downstream UI links to.

Source kind = "news".
"""

from __future__ import annotations

import logging
import re
from datetime import UTC, datetime
from email.utils import parsedate_to_datetime
from urllib.parse import quote_plus
from xml.etree import ElementTree as ET

import httpx

from data_pipeline.signals.base import RawSignal

log = logging.getLogger(__name__)


_RSS_ENDPOINT = "https://news.google.com/rss/search"
_DEFAULT_HL = "en-US"
_DEFAULT_GL = "US"
_DEFAULT_CEID = "US:en"

# Strip nested HTML/markup that Google sometimes embeds inside <description>.
_TAG_RE = re.compile(r"<[^>]+>")


def _build_query(keywords: list[str]) -> str:
    """OR-join the keyword list. Unquoted phrases allow Google News to
    perform broad term matching, which yields much better coverage for
    specialised capability keywords than strict exact-phrase quotes."""
    parts = [kw.strip() for kw in keywords if kw.strip()]
    return " OR ".join(parts)


def _parse_pubdate(text: str | None) -> datetime | None:
    if not text:
        return None
    try:
        dt = parsedate_to_datetime(text)
    except (TypeError, ValueError):
        return None
    if dt.tzinfo is None:
        # Google's pubDate is always RFC 822 with a TZ, but be defensive.
        dt = dt.replace(tzinfo=UTC)
    return dt.astimezone(UTC)


def _strip_tags(text: str | None) -> str | None:
    if not text:
        return None
    return _TAG_RE.sub("", text).strip() or None


class GoogleNewsSource:
    """Google News RSS reader. Returns at most `max_results` RawSignals
    per (vision × capability) call. Tolerates HTTP / parse failures
    by returning [] + logging."""

    source_kind: str = "news"
    name: str = "google-news"

    def __init__(
        self,
        *,
        timeout_seconds: float = 15.0,
        hl: str = _DEFAULT_HL,
        gl: str = _DEFAULT_GL,
        ceid: str = _DEFAULT_CEID,
    ) -> None:
        self._timeout = timeout_seconds
        self._hl = hl
        self._gl = gl
        self._ceid = ceid

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
        url = (
            f"{_RSS_ENDPOINT}?q={quote_plus(query)}"
            f"&hl={self._hl}&gl={self._gl}&ceid={self._ceid}"
        )
        tag = f"[google-news|{sector_slug}|{capability_key}]"
        try:
            async with httpx.AsyncClient(
                timeout=self._timeout, follow_redirects=True
            ) as client:
                resp = await client.get(url)
                resp.raise_for_status()
                xml_text = resp.text
        except (httpx.HTTPError, httpx.TimeoutException) as exc:
            log.warning("%s fetch failed: %s", tag, exc)
            return []

        try:
            root = ET.fromstring(xml_text)
        except ET.ParseError as exc:
            log.warning("%s XML parse failed: %s", tag, exc)
            return []

        # Items live at <rss><channel><item>...</item></channel>.
        items = root.findall(".//item")
        if not items:
            log.info("%s 0 items in feed", tag)
            return []

        results: list[RawSignal] = []
        # Ensure `since` is comparable to parsed pubdates (both aware UTC).
        since_utc = since.astimezone(UTC) if since.tzinfo else since.replace(tzinfo=UTC)
        for item in items[: max_results * 3]:  # over-fetch; cull by date
            link_el = item.find("link")
            title_el = item.find("title")
            pub_el = item.find("pubDate")
            desc_el = item.find("description")
            href = (link_el.text or "").strip() if link_el is not None else ""
            title = (title_el.text or "").strip() if title_el is not None else ""
            pubdate = _parse_pubdate(pub_el.text if pub_el is not None else None)
            summary = _strip_tags(desc_el.text if desc_el is not None else None)
            if not href or not title or pubdate is None:
                continue
            if pubdate < since_utc:
                continue
            results.append(
                RawSignal(
                    sector_slug=sector_slug,
                    capability_key=capability_key,
                    source_kind=self.source_kind,
                    source_url=href,
                    source_id_ext=None,
                    title=title,
                    summary=summary,
                    published_at=pubdate,
                )
            )
            if len(results) >= max_results:
                break
        log.info(
            "%s → %d signals (raw items=%d, since=%s)",
            tag,
            len(results),
            len(items),
            since_utc.isoformat(timespec="seconds"),
        )
        return results
