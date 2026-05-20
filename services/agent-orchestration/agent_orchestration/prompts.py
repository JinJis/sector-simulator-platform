"""Load + cache the markdown system prompts that ship under `prompts/`.

The repo root holds a `prompts/` directory (see `prompts/README.md`).
This loader resolves it via `PROMPTS_DIR` if set, otherwise walks up
from this file looking for the directory — works under `uv run`, in
docker (`/app/prompts`), and in tests.

Prompts are read once per process. Files are tiny (a few KB each) so we
trade a re-read on edit for cache-friendliness — the loader is hot-path
for every workflow start.
"""

from __future__ import annotations

import os
from functools import lru_cache
from pathlib import Path


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


@lru_cache(maxsize=32)
def load_prompt(name: str) -> str:
    """Return the contents of `prompts/<name>.md`. Cached per process.

    The cache key is the bare name (no extension), so callers ask for
    `load_prompt("decomposition")` rather than constructing paths.
    """
    if "/" in name or name.endswith(".md"):
        raise ValueError(f"prompt name must be a bare slug, got: {name!r}")
    path = _find_prompts_dir() / f"{name}.md"
    if not path.exists():
        raise FileNotFoundError(f"prompt not found: {path}")
    return path.read_text(encoding="utf-8")


def clear_prompt_cache() -> None:
    """Useful in tests + during development. No production caller."""
    load_prompt.cache_clear()
