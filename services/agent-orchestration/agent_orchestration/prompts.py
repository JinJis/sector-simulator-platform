"""Load + cache the markdown system prompts that ship under `prompts/`.

The repo root holds a `prompts/` directory (see `prompts/README.md`).
This loader resolves it via `PROMPTS_DIR` if set, otherwise walks up
from this file looking for the directory — works under `uv run`, in
docker, and in tests.

Each prompt file is markdown with an optional YAML-ish front-matter
block at the top:

    ---
    role: Decomposition Agent
    tier: opus
    inputs: DecompositionRequest
    outputs: Decomposition
    version: 1
    ---

    # ... body markdown ...

`load_prompt(name)` returns the **body only** — that's what reaches
Claude as the system prompt, so adding metadata won't invalidate the
prompt-cache prefix.

`prompt_metadata(name)` returns the parsed front-matter dict.
`prompt_catalog()` returns every available prompt with its metadata.

Prompts are read once per process via `lru_cache`. Files are tiny
(a few KB each); we trade a re-read on edit for cache-friendliness
since the loader is hot-path for every workflow start.
"""

from __future__ import annotations

import os
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path

# We deliberately do NOT use pyyaml. Front-matter here is line-oriented
# `key: value`, no nesting, no quoting tricks. Keeping the format narrow
# means the parser stays tiny and the format stays diff-friendly.
_FRONT_MATTER_DELIM = "---"


@dataclass(frozen=True)
class PromptMeta:
    """Structured front-matter for a prompt file. Unknown keys flow into
    `extras` so authors can add fields without forcing a parser update."""

    name: str
    role: str
    tier: str  # "haiku" / "sonnet" / "opus"
    inputs: str  # Pydantic model name, e.g. "DecompositionRequest"
    outputs: str  # Pydantic model name, e.g. "Decomposition"
    version: int
    extras: dict[str, str]


_REQUIRED_KEYS = {"role", "tier", "inputs", "outputs", "version"}
_VALID_TIERS = {"haiku", "sonnet", "opus"}


def _find_prompts_dir() -> Path:
    env = os.environ.get("PROMPTS_DIR")
    if env:
        p = Path(env).resolve()
        if not p.is_dir():
            raise RuntimeError(f"PROMPTS_DIR={env} does not exist or is not a directory")
        return p

    # Walk up from this file. The package lives at
    # services/agent-orchestration/agent_orchestration/prompts.py, so the
    # repo root is 4 parents up — but we look up to 8 anyway in case the
    # service moves.
    here = Path(__file__).resolve()
    for parent in [here, *here.parents][:8]:
        candidate = parent / "prompts"
        if candidate.is_dir() and (candidate / "README.md").exists():
            return candidate.resolve()
    raise RuntimeError(
        "could not locate `prompts/` directory; set PROMPTS_DIR explicitly"
    )


def _split_front_matter(text: str) -> tuple[dict[str, str], str]:
    """Return (meta_kv, body). meta_kv is empty when no front-matter is
    present — the loader stays backwards-compatible with prompt files
    that pre-date this convention."""
    lines = text.splitlines()
    if not lines or lines[0].strip() != _FRONT_MATTER_DELIM:
        return {}, text
    meta: dict[str, str] = {}
    end_idx: int | None = None
    for i, raw in enumerate(lines[1:], start=1):
        line = raw.rstrip()
        if line.strip() == _FRONT_MATTER_DELIM:
            end_idx = i
            break
        if not line.strip() or line.lstrip().startswith("#"):
            continue
        if ":" not in line:
            raise ValueError(f"front-matter line missing ':': {line!r}")
        key, _, value = line.partition(":")
        meta[key.strip()] = value.strip()
    if end_idx is None:
        raise ValueError("front-matter block opened with --- but never closed")
    # Body starts after the closing delim. Strip a single leading blank
    # line for cleaner cached prompts.
    body_lines = lines[end_idx + 1 :]
    if body_lines and not body_lines[0].strip():
        body_lines = body_lines[1:]
    return meta, "\n".join(body_lines)


def _build_meta(name: str, kv: dict[str, str]) -> PromptMeta:
    missing = _REQUIRED_KEYS - kv.keys()
    if missing:
        raise ValueError(f"{name}: front-matter missing keys: {sorted(missing)}")
    tier = kv["tier"].strip().lower()
    if tier not in _VALID_TIERS:
        raise ValueError(f"{name}: tier must be one of {_VALID_TIERS}, got {tier!r}")
    try:
        version = int(kv["version"])
    except ValueError as e:
        raise ValueError(f"{name}: version must be an integer, got {kv['version']!r}") from e
    extras = {k: v for k, v in kv.items() if k not in _REQUIRED_KEYS}
    return PromptMeta(
        name=name,
        role=kv["role"],
        tier=tier,
        inputs=kv["inputs"],
        outputs=kv["outputs"],
        version=version,
        extras=extras,
    )


@lru_cache(maxsize=32)
def _read(name: str) -> tuple[PromptMeta | None, str]:
    """Single source of truth for file → (meta, body). Cached per process."""
    if "/" in name or name.endswith(".md"):
        raise ValueError(f"prompt name must be a bare slug, got: {name!r}")
    path = _find_prompts_dir() / f"{name}.md"
    if not path.exists():
        raise FileNotFoundError(f"prompt not found: {path}")
    text = path.read_text(encoding="utf-8")
    kv, body = _split_front_matter(text)
    meta = _build_meta(name, kv) if kv else None
    return meta, body


def load_prompt(name: str) -> str:
    """Return the prompt body (after front-matter). This is what gets sent
    to Claude as the system prompt."""
    _, body = _read(name)
    return body


def prompt_metadata(name: str) -> PromptMeta:
    """Return the parsed front-matter. Raises if the file has none —
    the catalog enforces front-matter on every authored prompt."""
    meta, _ = _read(name)
    if meta is None:
        raise ValueError(f"{name}: missing front-matter")
    return meta


def prompt_catalog() -> dict[str, PromptMeta]:
    """All prompts on disk that have valid front-matter, keyed by name.
    Files without front-matter are skipped — they're either WIP drafts or
    the README, and shouldn't be addressable as agent prompts."""
    out: dict[str, PromptMeta] = {}
    for path in sorted(_find_prompts_dir().glob("*.md")):
        if path.name == "README.md":
            continue
        name = path.stem
        try:
            meta = prompt_metadata(name)
        except (ValueError, FileNotFoundError):
            # Drafts without front-matter live alongside ready prompts;
            # the catalog only surfaces ready ones.
            continue
        out[name] = meta
    return out


def clear_prompt_cache() -> None:
    """Useful in tests + during development. No production caller."""
    _read.cache_clear()
