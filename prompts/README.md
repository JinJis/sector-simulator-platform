# Prompts

Versioned system prompts for each Phase 2 agent. Filenames map to the
agent role (kebab-case). Each prompt is plain markdown so it
diff-reviews well in PRs.

## File shape

Each prompt is a markdown file with a YAML-ish **front-matter** block
followed by the prompt body:

```markdown
---
role: Decomposition Agent
tier: opus
inputs: DecompositionRequest
outputs: Decomposition
version: 1
---

# Decomposition Agent

...prompt body...
```

**Front-matter keys** (all required):

| Key       | Meaning                                                              |
| --------- | -------------------------------------------------------------------- |
| `role`    | Human-readable agent role.                                           |
| `tier`    | Model tier — one of `haiku`, `sonnet`, `opus`.                       |
| `inputs`  | Pydantic model name the orchestrator passes (string, not imported).  |
| `outputs` | Pydantic model name the agent must return (structured output).       |
| `version` | Integer. Bump on every behavioral change — never silently overwrite. |

The parser (`agent_orchestration/prompts.py`) is intentionally tiny:
line-oriented `key: value`, no nesting, no quoting tricks. Keep the
format narrow so it stays diff-friendly.

**`load_prompt(name)` returns the body only** — the front-matter is
stripped before the markdown reaches Claude as a system prompt. Adding
or editing front-matter therefore does NOT invalidate the prompt cache.

## Bundled prompts

| Name              | Tier    | Outputs                | Purpose                                          |
| ----------------- | ------- | ---------------------- | ------------------------------------------------ |
| `research`        | sonnet  | `ResearchBrief`        | Numeric anchors + citations for Decomposition.   |
| `decomposition`   | opus    | `Decomposition`        | Sector concept → drivers / intermediates / outputs.|
| `driver-inference`| sonnet  | `DriverInferenceResult`| Calibrated defaults, ranges, history, sources.   |
| `edge-inference`  | opus    | `EdgeInferenceResult`  | Causal DAG: formulas, edges, assumptions.        |
| `code-gen`        | sonnet  | `CodeGenResult`        | Generates the `SimulationBase` `.py` file.       |
| `code-review`     | sonnet  | `CodeReviewResult`     | Gates the file for deployment.                   |

Only `decomposition` is currently wired to a `Workflow` class — the
other five prompts are ready inputs for future workflow slices.

## When to bump `version`

- New behavioral expectation (e.g. tightened anti-patterns, new
  required output field).
- A model migration produced different behavior on the same prompt and
  the prompt was rewritten to compensate.
- An agent-eval case caught a regression; the rewrite that fixed it
  bumps `version`.

Cosmetic edits (typos, formatting) do not bump `version` — the
catalog uses `version` to gate deployments, not to track edits.

## Cache stability

`LLMClient.call(..., system=<body>, cache_system=True)` marks the last
text block with `cache_control: ephemeral`. The prompt body must
therefore stay byte-stable across runs — interpolating dates, request
IDs, or per-tenant data into the prompt body breaks the cache prefix.
Volatile context belongs in the `user` turn (the orchestrator handles
this).
