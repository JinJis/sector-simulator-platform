# Prompts

Versioned system prompts for every agent / workflow on the platform.
Filenames map to the agent role (kebab-case for legacy, snake_case for
post-pivot). Each prompt is plain markdown so it diff-reviews well
in PRs.

Agent / workflow inventory + role per prompt:
[`docs/agent-capabilities.md`](../docs/agent-capabilities.md).

## File shape

Each prompt is a markdown file with a YAML-ish **front-matter** block
followed by the prompt body:

```markdown
---
role: Vision Decomposition Agent
tier: deep
inputs: VisionDecompositionRequest
outputs: VisionDecomposition
version: 1
---

# Vision Decomposition Agent

...prompt body...
```

**Front-matter keys** (all required):

| Key       | Meaning                                                              |
| --------- | -------------------------------------------------------------------- |
| `role`    | Human-readable agent role.                                           |
| `tier`    | Model tier — one of `fast`, `balanced`, `deep`.                       |
| `inputs`  | Pydantic model name the orchestrator passes (string, not imported).  |
| `outputs` | Pydantic model name the agent must return (structured output).       |
| `version` | Integer. Bump on every behavioral change — never silently overwrite. |

The parser (`agent_orchestration/prompts.py`) is intentionally tiny:
line-oriented `key: value`, no nesting, no quoting tricks. Keep the
format narrow so it stays diff-friendly.

**`load_prompt(name)` returns the body only** — the front-matter is
stripped before the markdown reaches the LLM as a system prompt. Adding
or editing front-matter therefore does NOT invalidate the prompt cache.

## Bundled prompts

### Vision Builder track (M41 — primary entry)

| Name                    | Tier   | Outputs                | Workflow |
| ----------------------- | ------ | ---------------------- | -------- |
| `prompt_validator`      | fast  | `PromptValidation`     | `PromptValidatorWorkflow` |
| `research`              | balanced | `ResearchBrief`        | `ResearchWorkflow` (shared with legacy) |
| `vision_decomposition`  | deep   | `VisionDecomposition`  | `VisionDecompositionWorkflow` |
| `data_source_selector`  | balanced | `DataSourceSelection`  | `DataSourceSelectorWorkflow` |

### Signal pipeline (M39 + M40)

| Name                    | Tier   | Outputs                  | Workflow |
| ----------------------- | ------ | ------------------------ | -------- |
| `signal_extractor`      | fast  | `SignalScoring`          | `SignalExtractorWorkflow` |
| `score_updater`         | balanced | `CapabilityScoreUpdate`  | `CapabilityScoreUpdaterWorkflow` |

### Growth / distribution

| Name                    | Tier   | Outputs                  | Workflow |
| ----------------------- | ------ | ------------------------ | -------- |
| `marketing_content`     | balanced | `MarketingPostSet`       | `MarketingContentWorkflow` |

`marketing_content` turns a live vision snapshot (binding constraint +
notable signal + lead actor) into bilingual (ko + en) Threads + Instagram
copy. Assembled + triggered by the data-pipeline `marketing_digest` cron
(cost-gated, default-off); product-led CTA to the public vision page.

### Legacy sim-builder track (pre-pivot, retained)

| Name              | Tier    | Outputs                 | Workflow |
| ----------------- | ------- | ----------------------- | -------- |
| `decomposition`   | deep    | `Decomposition`         | `DecompositionWorkflow` |
| `edge-inference`  | deep    | `EdgeInferenceResult`   | `EdgeInferenceWorkflow` |
| `driver-inference`| balanced  | `DriverInferenceResult` | `DriverInferenceWorkflow` |
| `code-gen`        | balanced  | `CodeGenResult`         | `CodeGenWorkflow` |
| `code-review`     | balanced  | `CodeReviewResult`      | `CodeReviewWorkflow` |

The sim-builder chain still powers agent-generated `Sector` rows
(legacy `/propose` flow), now consumed by the Playground sub-tab.

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

## Provider notes

Post-F9, every tier routes through Google Gemini via the `google-genai`
SDK (Vertex AI in prod, AI Studio in dev):
- `deep` → Gemini 3.1 Pro Preview
- `balanced` → Gemini 3.5 Flash
- `fast` → Gemini 3.5 Flash Lite

Pydantic structured-output validation runs on every call — schema
mismatches surface as a typed exception, not silent drift. See
[CLAUDE.md "LLM auth + tier routing"](../CLAUDE.md#llm-auth--tier-routing-f9--gemini-only).
