"""Unit tests for the DART corpCode.xml parser + ZIP extractor (M10d).

Network path is covered indirectly via test_dart_source's
auto-discovery test using a monkey-patched fetch — here we just hit
the pure parsing helpers.
"""

from __future__ import annotations

import io
import zipfile

import pytest

from data_pipeline.adapters.dart_corp_codes import (
    extract_corpcode_xml_from_zip,
    parse_corpcode_xml,
)


def _zip_with(name: str, body: bytes) -> bytes:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", compression=zipfile.ZIP_DEFLATED) as zf:
        zf.writestr(name, body)
    return buf.getvalue()


def test_parse_returns_stock_to_corp_map() -> None:
    xml = b"""<result>
        <list>
            <corp_code>00126380</corp_code>
            <corp_name>Samsung Electronics</corp_name>
            <stock_code>005930</stock_code>
        </list>
        <list>
            <corp_code>00164779</corp_code>
            <corp_name>SK hynix</corp_name>
            <stock_code>000660</stock_code>
        </list>
    </result>"""
    out = parse_corpcode_xml(xml)
    assert out["005930"] == "00126380"
    assert out["000660"] == "00164779"


def test_parse_skips_unlisted_companies() -> None:
    xml = b"""<result>
        <list>
            <corp_code>00000001</corp_code>
            <corp_name>Unlisted Co</corp_name>
            <stock_code></stock_code>
        </list>
        <list>
            <corp_code>00126380</corp_code>
            <stock_code>005930</stock_code>
        </list>
    </result>"""
    out = parse_corpcode_xml(xml)
    assert out == {"005930": "00126380"}


def test_parse_drops_malformed_codes() -> None:
    xml = b"""<result>
        <list>
            <corp_code>123</corp_code>
            <stock_code>005930</stock_code>
        </list>
        <list>
            <corp_code>00126380</corp_code>
            <stock_code>5930</stock_code>
        </list>
        <list>
            <corp_code>00126380</corp_code>
            <stock_code>0059AB</stock_code>
        </list>
    </result>"""
    out = parse_corpcode_xml(xml)
    assert out == {}


def test_parse_handles_whitespace_around_codes() -> None:
    xml = b"""<result>
        <list>
            <corp_code>  00126380  </corp_code>
            <stock_code>  005930  </stock_code>
        </list>
    </result>"""
    out = parse_corpcode_xml(xml)
    assert out["005930"] == "00126380"


def test_extract_finds_corpcode_xml_in_zip() -> None:
    payload = b"<result><list><corp_code>00126380</corp_code><stock_code>005930</stock_code></list></result>"
    zb = _zip_with("CORPCODE.xml", payload)
    out = extract_corpcode_xml_from_zip(zb)
    assert out == payload


def test_extract_is_case_insensitive() -> None:
    payload = b"<result></result>"
    zb = _zip_with("corpcode.xml", payload)
    assert extract_corpcode_xml_from_zip(zb) == payload


def test_extract_raises_when_xml_missing() -> None:
    zb = _zip_with("not-the-file.txt", b"oops")
    with pytest.raises(ValueError, match="corpCode.xml not found"):
        extract_corpcode_xml_from_zip(zb)
