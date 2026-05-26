"""EntityDetector (M50).

For one vision, find org-name candidates that appear in recent
untagged signals but don't fuzzy-match any known Actor. These feed
ProposalDrafter, which writes a CommunityProposal authored by the
bot user.

v1 detection is rule-based:
  1. Pull untagged signals for the vision in the lookback window.
  2. Regex-extract capitalized phrases that look like org names
     (`Word [Word]* (Inc|Corp|Ltd|LLC|Co|Holdings|Energy|
     Technologies|Systems|Labs|...)`).
  3. Drop candidates that fuzzy-match any known Actor.name (Jaro-
     Winkler >= 0.92).
  4. Require >= `min_signal_count` distinct signals back the candidate
     within the lookback window.
  5. Sort by signal-count desc, return ExtractedEntity list.

LLM is_org / domain_relevant_to_vision gate is composition.md §5's
follow-up — adds an extractor agent call per candidate to filter
common-noun false positives ("Apple Inc." vs the fruit). Wired in a
later slice once we observe v1 false-positive rates.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta

from crawler.db.discovery_reader import (
    DiscoveryReader,
    KnownActorRow,
    RecentSignalRow,
)

# Common "name token" — capitalized word, optional digits.
_NAME_TOKEN = r"[A-Z][A-Za-z0-9]+"

# Suffixes that confidently mark an org name. Conservative on purpose
# — false positives are worse than false negatives at this stage.
_ORG_SUFFIXES = (
    r"Inc"
    r"|Inc\."
    r"|Corp"
    r"|Corp\."
    r"|Ltd"
    r"|LLC"
    r"|Co"
    r"|Holdings"
    r"|Energy"
    r"|Technologies"
    r"|Technology"
    r"|Systems"
    r"|Labs"
    r"|Laboratories"
    r"|Industries"
    r"|Solutions"
    r"|GmbH"
    r"|AG"
    r"|SA"
    r"|SE"
    r"|Group"
    r"|Capital"
    r"|Ventures"
)

# Match "Word", "Word Word", "Word Word Word" followed by an org suffix.
_ORG_PATTERN = re.compile(rf"\b({_NAME_TOKEN}(?:\s+{_NAME_TOKEN}){{0,3}})\s+({_ORG_SUFFIXES})\b")

# Generic words that often precede "Inc/Corp" without naming an
# actual company we want to track. Skip the whole match if the head
# word is one of these (cheap false-positive filter).
_HEAD_BLOCKLIST = frozenset(
    {
        "The",
        "An",
        "A",
        "This",
        "That",
        "His",
        "Her",
        "Their",
        "Our",
        "Your",
        "My",
    }
)


@dataclass(frozen=True, slots=True)
class ExtractedEntity:
    """One name candidate ready for a CommunityProposal draft."""

    name: str  # e.g. "Starcloud Inc"
    signal_ids: tuple[str, ...]  # distinct supporting signal ids
    signal_titles: tuple[str, ...]  # parallel to signal_ids for evidence
    signal_urls: tuple[str, ...]  # parallel to signal_ids


# --------------------------------------------------------------------------
# Public entry point
# --------------------------------------------------------------------------


async def detect_new_actors(
    *,
    sector_slug: str,
    reader: DiscoveryReader,
    min_signal_count: int = 2,
    lookback_days: int = 7,
    fuzzy_threshold: float = 0.92,
    now: datetime | None = None,
) -> list[ExtractedEntity]:
    """Per-vision new-actor candidate scan. Returns 0..N entities
    that passed every gate (org suffix, ≥`min_signal_count` distinct
    signals in `lookback_days`, no fuzzy-match against existing
    Actor.name)."""
    now = now or datetime.now(UTC)
    since = now - timedelta(days=lookback_days)

    signals = await reader.list_recent_untagged_signals(sector_slug=sector_slug, since=since)
    if not signals:
        return []
    known = await reader.list_known_actor_names()

    # Pass 1: extract candidates per signal.
    by_name: dict[str, list[RecentSignalRow]] = {}
    for sig in signals:
        text = sig.title + ("\n" + sig.summary if sig.summary else "")
        for match in _ORG_PATTERN.finditer(text):
            head, suffix = match.group(1), match.group(2)
            head_first = head.split()[0]
            if head_first in _HEAD_BLOCKLIST:
                continue
            name = f"{head} {suffix}".strip()
            by_name.setdefault(name, [])
            # Dedup per (name, signal) — same name multiple times in one
            # signal counts once.
            if all(s.id != sig.id for s in by_name[name]):
                by_name[name].append(sig)

    if not by_name:
        return []

    # Pass 2: drop names that fuzzy-match anything known.
    candidates: list[ExtractedEntity] = []
    for name, sigs in by_name.items():
        if len(sigs) < min_signal_count:
            continue
        if _matches_known(name, known, threshold=fuzzy_threshold):
            continue
        candidates.append(
            ExtractedEntity(
                name=name,
                signal_ids=tuple(s.id for s in sigs),
                signal_titles=tuple(s.title for s in sigs),
                signal_urls=tuple(s.source_url for s in sigs),
            )
        )

    candidates.sort(key=lambda c: len(c.signal_ids), reverse=True)
    return candidates


# --------------------------------------------------------------------------
# Helpers
# --------------------------------------------------------------------------


def _matches_known(candidate: str, known: list[KnownActorRow], *, threshold: float) -> bool:
    needle = candidate.lower()
    # First an O(N) exact / substring sweep — cheap and catches the
    # common case ("SpaceX" already in actors → "SpaceX Inc" should
    # match).
    for k in known:
        hay = k.name.lower()
        if needle == hay or needle in hay or hay in needle:
            return True
        if k.short_name and (
            needle == k.short_name.lower()
            or needle in k.short_name.lower()
            or k.short_name.lower() in needle
        ):
            return True
    # Then Jaro-Winkler on remaining pairs (also O(N) — small actor sets).
    for k in known:
        if jaro_winkler(candidate.lower(), k.name.lower()) >= threshold:
            return True
        if k.short_name and jaro_winkler(candidate.lower(), k.short_name.lower()) >= threshold:
            return True
    return False


def jaro_winkler(s1: str, s2: str, *, prefix_scale: float = 0.1) -> float:
    """Jaro-Winkler similarity (0..1). Standard formulation; no
    external dep needed for the ~40-actor corpus we run against."""
    if s1 == s2:
        return 1.0
    if not s1 or not s2:
        return 0.0

    len1, len2 = len(s1), len(s2)
    match_distance = max(len1, len2) // 2 - 1
    if match_distance < 0:
        match_distance = 0

    s1_matches = [False] * len1
    s2_matches = [False] * len2

    matches = 0
    for i in range(len1):
        start = max(0, i - match_distance)
        end = min(i + match_distance + 1, len2)
        for j in range(start, end):
            if s2_matches[j]:
                continue
            if s1[i] != s2[j]:
                continue
            s1_matches[i] = True
            s2_matches[j] = True
            matches += 1
            break

    if matches == 0:
        return 0.0

    # Transpositions.
    transpositions = 0
    k = 0
    for i in range(len1):
        if not s1_matches[i]:
            continue
        while not s2_matches[k]:
            k += 1
        if s1[i] != s2[k]:
            transpositions += 1
        k += 1
    transpositions //= 2

    m = float(matches)
    jaro = (m / len1 + m / len2 + (m - transpositions) / m) / 3.0

    # Winkler prefix boost (up to 4-char common prefix).
    prefix = 0
    for i in range(min(4, len1, len2)):
        if s1[i] == s2[i]:
            prefix += 1
        else:
            break
    return jaro + prefix * prefix_scale * (1.0 - jaro)
