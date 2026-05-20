# Prompts

Versioned system prompts for each Phase 2 agent. Filenames map to the
agent role. Each prompt is plain markdown so it diff-reviews well in PRs.

## Convention

- One file per agent role, kebab-case (`decomposition.md`,
  `driver-inference.md`, …).
- Top of the file: a short `## Role`, `## Model tier`, and `## Inputs /
  Outputs` block so the orchestrator's prompt loader can read structured
  metadata at the top of the markdown without parsing the whole file.
- The rest is free-form. Keep the static portion stable — `LLMClient`
  passes the entire file as the cacheable system prompt; any byte change
  invalidates the cache (see `claude-api` skill / `prompt-caching.md`).
- Volatile context (sector slug, prior turn outputs, driver list) does
  NOT belong in this file. The orchestrator interpolates that into the
  `user` turn.

## When to bump

- Add a new agent: new file + entry in `LLMClient`'s registry (when
  added).
- Change behavior: edit the file. Roll forward; we keep history in git.
- Migrate models: update only when the new model behaves differently
  enough that the existing prompt under-/over-triggers. Cite the eval
  case that motivated the change in the commit message.
