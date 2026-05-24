"""Pure-Python validation gate for the Vision Builder pipeline.

Pydantic enforces single-field bounds at the schema layer (regex, enum
literals, min/max). This module enforces *relational* integrity that
Pydantic can't express:

- DAG-shape of capability dependencies (no cycles, no self-loops, all
  endpoints reference existing capabilities)
- Key uniqueness across capabilities / actors / risks
- FK integrity: capability_actors[].capability_key + actor_key both
  resolve; risks[].affected_capability_keys all resolve;
  initial_feasibility.binding_capability_key resolves; dependencies
  endpoints both resolve
- Capability weight sum: must be in [0.90, 1.10] — agent-generated
  drafts are normalized to exactly 1.0 with a warning if outside this
  band
- Slug duplication against `existing_vision_slugs`
- Signal-keyword coverage: every capability should have a matching
  keyword set in the DataSourceConfigDraft (warning, not error —
  M41 may skip stage 4)

Returns a `ValidationGateResult` with errors (block persistence) and
warnings (surface in admin UI but allow override).
"""

from __future__ import annotations

from dataclasses import dataclass, field

from agent_orchestration.schemas import (
    DataSourceConfigDraft,
    VisionDecompositionResult,
)


# Capability weights must sum to ~1.0. Outside this band → error.
# Inside [0.9, 1.1] but outside [0.98, 1.02] → warning + normalize.
# Bounds widened by 1e-6 to absorb float-add epsilon at the edges
# (e.g. 0.3 + 0.3 + 0.3 = 0.8999999999999999 in float).
_FLOAT_EPS = 1e-6
_WEIGHT_SUM_HARD_MIN = 0.90 - _FLOAT_EPS
_WEIGHT_SUM_HARD_MAX = 1.10 + _FLOAT_EPS
_WEIGHT_SUM_SOFT_MIN = 0.98 - _FLOAT_EPS
_WEIGHT_SUM_SOFT_MAX = 1.02 + _FLOAT_EPS


@dataclass
class ValidationGateResult:
    """What the gate produces.

    `ok` is True iff `errors` is empty. `normalized_draft` is the input
    draft with weight normalization applied (if needed); callers should
    persist this one, not the agent's raw output."""

    ok: bool
    errors: list[str] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)
    normalized_draft: VisionDecompositionResult | None = None


def run_validation_gate(
    *,
    draft: VisionDecompositionResult,
    signal_config: DataSourceConfigDraft | None,
    existing_vision_slugs: list[str] | None = None,
    existing_actor_keys: list[str] | None = None,
) -> ValidationGateResult:
    """Run all relational checks and normalize weights.

    `existing_actor_keys` should be the full set of Actor.key values
    already in the DB — capability_actors[].actor_key may reference
    either a NEW actor (in draft.actors[]) or an EXISTING one.
    """
    errors: list[str] = []
    warnings: list[str] = []
    existing_vision_slugs = existing_vision_slugs or []
    existing_actor_keys = existing_actor_keys or []

    # 1. Slug duplication ------------------------------------------------
    if draft.slug in existing_vision_slugs:
        errors.append(
            f"Vision slug '{draft.slug}' already exists. "
            "PromptValidator should have caught this — investigate."
        )

    # 2. Key uniqueness within draft -------------------------------------
    cap_keys = [c.key for c in draft.capabilities]
    dup_caps = _duplicates(cap_keys)
    if dup_caps:
        errors.append(
            f"Duplicate capability keys: {sorted(dup_caps)}. "
            "Each capability MUST have a unique snake_case key."
        )

    actor_keys = [a.key for a in draft.actors]
    dup_actors = _duplicates(actor_keys)
    if dup_actors:
        errors.append(
            f"Duplicate actor keys in draft: {sorted(dup_actors)}."
        )

    risk_keys = [r.key for r in draft.risks]
    dup_risks = _duplicates(risk_keys)
    if dup_risks:
        errors.append(
            f"Duplicate risk keys: {sorted(dup_risks)}."
        )

    # Build resolved sets for downstream FK checks. Use 'set' once
    # uniqueness has been complained about; downstream checks should
    # not double-report missing keys.
    cap_key_set = set(cap_keys)
    # New actor keys + existing global keys both resolve.
    actor_key_set = set(actor_keys) | set(existing_actor_keys)

    # 3. Capability-actor FK integrity -----------------------------------
    for ca in draft.capability_actors:
        if ca.capability_key not in cap_key_set:
            errors.append(
                f"capability_actors references unknown capability "
                f"'{ca.capability_key}'."
            )
        if ca.actor_key not in actor_key_set:
            errors.append(
                f"capability_actors references unknown actor "
                f"'{ca.actor_key}' (not in draft.actors and not in "
                "existing global actors)."
            )

    # 4. Dependency edge integrity + DAG check ---------------------------
    for dep in draft.dependencies:
        if dep.source_key not in cap_key_set:
            errors.append(
                f"dependency source_key '{dep.source_key}' is not one"
                " of the declared capabilities."
            )
        if dep.target_key not in cap_key_set:
            errors.append(
                f"dependency target_key '{dep.target_key}' is not one"
                " of the declared capabilities."
            )
        if dep.source_key == dep.target_key:
            errors.append(
                f"dependency has identical source + target "
                f"'{dep.source_key}' (self-loop forbidden)."
            )

    cycle = _detect_cycle(
        nodes=cap_key_set,
        edges=[(d.source_key, d.target_key) for d in draft.dependencies
               if d.source_key in cap_key_set
               and d.target_key in cap_key_set],
    )
    if cycle is not None:
        errors.append(
            f"capability dependencies contain a cycle: {' → '.join(cycle)} → {cycle[0]}."
            " The graph MUST be a DAG."
        )

    # 5. Risk → capability FK integrity ----------------------------------
    for r in draft.risks:
        unknown = [k for k in r.affected_capability_keys if k not in cap_key_set]
        if unknown:
            errors.append(
                f"risk '{r.key}' references unknown capabilities: {unknown}."
            )

    # 6. Initial feasibility binding-capability FK -----------------------
    if draft.initial_feasibility.binding_capability_key not in cap_key_set:
        errors.append(
            "initial_feasibility.binding_capability_key "
            f"'{draft.initial_feasibility.binding_capability_key}'"
            " is not one of the declared capabilities."
        )

    # 7. Weight sum + normalization --------------------------------------
    weight_sum = sum(c.weight for c in draft.capabilities)
    normalized_draft = draft
    if weight_sum < _WEIGHT_SUM_HARD_MIN or weight_sum > _WEIGHT_SUM_HARD_MAX:
        errors.append(
            f"capability weights sum to {weight_sum:.3f} — outside "
            f"hard band [{_WEIGHT_SUM_HARD_MIN}, {_WEIGHT_SUM_HARD_MAX}]."
            " Draft is unusable; regenerate."
        )
    elif weight_sum < _WEIGHT_SUM_SOFT_MIN or weight_sum > _WEIGHT_SUM_SOFT_MAX:
        warnings.append(
            f"capability weights sum to {weight_sum:.3f}; normalized to 1.0."
        )
        normalized_caps = [
            c.model_copy(update={"weight": round(c.weight / weight_sum, 4)})
            for c in draft.capabilities
        ]
        normalized_draft = draft.model_copy(
            update={"capabilities": normalized_caps}
        )

    # 8. Signal-keyword coverage (warning only) --------------------------
    if signal_config is not None:
        keyword_cap_keys = {
            kws.capability_key for kws in signal_config.keywords_by_capability
        }
        missing = sorted(cap_key_set - keyword_cap_keys)
        if missing:
            warnings.append(
                f"signal_config missing keyword sets for capabilities:"
                f" {missing}. Those capabilities will have no automated"
                " signal flow until an admin curates keywords."
            )
        extra = sorted(keyword_cap_keys - cap_key_set)
        if extra:
            # This should have been dropped by DataSourceSelectorWorkflow's
            # defensive guard — if we see it here, the guard failed.
            errors.append(
                f"signal_config has keyword sets for unknown capabilities:"
                f" {extra}."
            )

    # 9. capability_actors coverage (warning) ----------------------------
    capped = {ca.capability_key for ca in draft.capability_actors}
    uncovered = sorted(cap_key_set - capped)
    if uncovered:
        warnings.append(
            f"capabilities with no actor assignment: {uncovered}."
            " They will render with empty 'Active actors' on the hero."
        )

    # 10. Sanity: weights non-zero --------------------------------------
    zero_weight = [c.key for c in draft.capabilities if c.weight <= 0]
    if zero_weight:
        errors.append(
            f"capabilities have non-positive weight: {zero_weight}."
        )

    return ValidationGateResult(
        ok=not errors,
        errors=errors,
        warnings=warnings,
        normalized_draft=normalized_draft if not errors else None,
    )


# ---- helpers --------------------------------------------------------------


def _duplicates(items: list[str]) -> set[str]:
    seen: set[str] = set()
    dups: set[str] = set()
    for x in items:
        if x in seen:
            dups.add(x)
        seen.add(x)
    return dups


def _detect_cycle(
    *, nodes: set[str], edges: list[tuple[str, str]]
) -> list[str] | None:
    """Kahn's algorithm — returns the cycle nodes if any, else None.

    On cycle detection, walks the residual graph to surface a concrete
    cycle for the admin error message."""
    incoming: dict[str, int] = {n: 0 for n in nodes}
    adj: dict[str, list[str]] = {n: [] for n in nodes}
    for s, t in edges:
        adj[s].append(t)
        incoming[t] += 1
    ready = [n for n, c in incoming.items() if c == 0]
    visited = 0
    while ready:
        n = ready.pop()
        visited += 1
        for m in adj[n]:
            incoming[m] -= 1
            if incoming[m] == 0:
                ready.append(m)
    if visited == len(nodes):
        return None
    # Build a residual graph and DFS for a concrete cycle to surface.
    residual_nodes = {n for n, c in incoming.items() if c > 0}
    return _find_cycle_dfs(adj, residual_nodes)


def _find_cycle_dfs(
    adj: dict[str, list[str]], nodes: set[str]
) -> list[str]:
    """DFS in the residual graph to surface one concrete cycle."""
    visited: set[str] = set()
    stack: list[str] = []

    def walk(node: str) -> list[str] | None:
        if node in stack:
            i = stack.index(node)
            return stack[i:]
        if node in visited:
            return None
        visited.add(node)
        stack.append(node)
        for nxt in adj.get(node, []):
            if nxt not in nodes:
                continue
            result = walk(nxt)
            if result is not None:
                return result
        stack.pop()
        return None

    for start in nodes:
        out = walk(start)
        if out:
            return out
    return list(nodes)  # fallback — shouldn't reach here
