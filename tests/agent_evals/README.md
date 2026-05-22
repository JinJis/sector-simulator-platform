# Agent evals

> Lives at `tests/agent_evals/` (underscore) so the directory imports
> cleanly as a Python package. CLAUDE.md's `tests/agent-evals/`
> spelling is the conceptual name; the filesystem uses an underscore.

Structured eval harness for the Phase 2 agent layer. Two tiers:

- **Tier 1 — prompt sanity** (`test_prompt_sanity.py`). Parameterized
  over every prompt in `prompts/`. Verifies the body mentions its
  output schema, lists anti-patterns + principles, and loads
  deterministically. Pure markdown introspection; no API.
- **Tier 2 — workflow behavior** (`test_decomposition.py`,
  later one file per workflow). Runs the actual `Workflow` class
  against fixtures of (input, canned response, assertions). Offline by
  default — flip to live API with `GEMINI_EVAL_LIVE=1`
  (`ANTHROPIC_EVAL_LIVE=1` still accepted as a back-compat alias).

## Running

```bash
# Default — offline, no API calls
.venv/bin/python -m pytest tests/agent-evals -v

# Live mode — real Gemini API. Requires GEMINI_API_KEY. Cost is
# bounded per case (see CostBudget in harness.py); a case that exceeds
# budget fails fast.
GEMINI_EVAL_LIVE=1 .venv/bin/python -m pytest tests/agent-evals -v
```

Live mode is intentionally opt-in — eval cases call paid APIs, and
running them on every push would burn the budget. The recommended
cadence is per-PR-touching-an-agent-prompt, not per-push.

## Adding a case

1. Append a `Case(...)` to the relevant module under `cases/`.
2. Provide a `canned_response` matching what you'd expect a healthy
   agent to return — that's what offline mode replays.
3. Write `assertions` as plain callables over the parsed output.
4. Set `max_cost_usd` to a sensible upper bound. Default is `0.10` —
   raise it for complex Opus prompts, lower it for Haiku.

## Why these aren't unit tests

Unit tests (under each package's `tests/`) verify wiring: did the
workflow call the right model, did the parser handle malformed input,
did the cost meter accumulate. Evals verify *agent behavior*: when given
a realistic sector concept, does the Decomposition Agent produce a
schema that a downstream Code Gen Agent could actually use? The
canned-response mode keeps them fast in CI; the live mode catches
regressions that fakes can't.
