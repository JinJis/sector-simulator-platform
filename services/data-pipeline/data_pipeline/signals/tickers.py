"""Shared `VisionTickers` value type used by the crawl4ai news adapters.

The actual per-vision ticker lineup is read from the DB
(`actors.ticker` joined through `vision_actors` — see
`SignalRepository.list_vision_tickers`). This module used to hold a
hardcoded `VISION_TICKERS` map as a zero-config fallback; that map is
deleted because the data is now fully Vision-Builder + Actor-managed.
"""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True, slots=True)
class VisionTickers:
    us: tuple[str, ...]
    kr: tuple[str, ...]


__all__ = ["VisionTickers"]
