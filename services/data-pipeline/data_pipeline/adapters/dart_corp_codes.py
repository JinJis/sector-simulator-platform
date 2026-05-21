"""DART corpCode.xml auto-discovery — milestone 10d.

`https://opendart.fss.or.kr/api/corpCode.xml` returns a ZIP archive
containing one `CORPCODE.xml` file with every Korean listed company's
`corp_code` (DART's 8-digit identifier) ↔ `corp_name` ↔ `stock_code`
(KOSPI/KOSDAQ ticker, blank for unlisted).

We download it once per process, parse into a `stock_code → corp_code`
dict, and cache. The hand-curated `KR_CORP_CODES` map in
`dart_source.py` stays as a first-look fallback so the 22 well-known
tickers don't pay the cold-start fetch cost.

For tests we expose a parsing helper that takes raw XML bytes — no
network. Production code calls `fetch_corp_code_map(api_key)`.
"""

from __future__ import annotations

import io
import logging
import zipfile
from xml.etree import ElementTree as ET

import httpx

log = logging.getLogger(__name__)

DART_CORPCODE_URL = "https://opendart.fss.or.kr/api/corpCode.xml"


def parse_corpcode_xml(xml_bytes: bytes) -> dict[str, str]:
    """Parse a CORPCODE.xml payload into `{stock_code: corp_code}`.

    Unlisted companies (those with an empty `stock_code`) are skipped —
    we only care about traded tickers. Whitespace around stock codes
    is stripped; KR stock codes are 6 digits. Non-conforming entries
    are silently dropped (defensive against schema drift).
    """
    root = ET.fromstring(xml_bytes)
    out: dict[str, str] = {}
    for entry in root.iter("list"):
        stock_code = (entry.findtext("stock_code") or "").strip()
        corp_code = (entry.findtext("corp_code") or "").strip()
        if not stock_code or not corp_code:
            continue
        if len(stock_code) != 6 or not stock_code.isdigit():
            # KR stock codes are exactly 6 digits. Anything else
            # (foreign tickers, malformed entries) is ignored.
            continue
        if len(corp_code) != 8 or not corp_code.isdigit():
            continue
        out[stock_code] = corp_code
    return out


def extract_corpcode_xml_from_zip(zip_bytes: bytes) -> bytes:
    """The DART endpoint returns a ZIP containing one `CORPCODE.xml`.
    Pull it out as raw bytes so the parser remains pure."""
    with zipfile.ZipFile(io.BytesIO(zip_bytes)) as zf:
        # The archive always contains exactly one file named CORPCODE.xml.
        # We look it up case-insensitively to be safe.
        names = zf.namelist()
        target = next(
            (n for n in names if n.lower().endswith("corpcode.xml")),
            None,
        )
        if target is None:
            raise ValueError(
                f"corpCode.xml not found in DART zip; archive contains: {names}",
            )
        return zf.read(target)


async def fetch_corp_code_map(
    api_key: str,
    *,
    timeout_s: float = 60.0,
) -> dict[str, str]:
    """Network path — download + unzip + parse. Returns the
    `{stock_code: corp_code}` map. Raises on network / HTTP errors;
    the caller is expected to log and fall back to the hand-curated map.
    """
    if not api_key:
        raise ValueError("fetch_corp_code_map requires DART_API_KEY")
    async with httpx.AsyncClient(timeout=timeout_s) as client:
        r = await client.get(DART_CORPCODE_URL, params={"crtfc_key": api_key})
        r.raise_for_status()
        zip_bytes = r.content
    xml_bytes = extract_corpcode_xml_from_zip(zip_bytes)
    return parse_corpcode_xml(xml_bytes)
