"""GenericDagSim — execute an agent-generated sector at runtime.

The in-code sims (memory_semi / sofc / space_data_center) define their
math in hand-written Python. Agent-generated sectors land in the
database as a node schema (Decomposition) + a causal DAG with formulas
(EdgeInferenceResult). This module turns that DB state into a runnable
SimulationBase subclass — `simulate(**driver_values)` returns the same
shape as any other sim, so every downstream consumer (FastAPI route,
sensitivity sweep, report builder, equity impact score) works
unchanged.

Pipeline at `simulate()` time:

  1. Bind driver names → caller-supplied values.
  2. Topologically sort intermediates + outputs against the parsed
     `depends_on` (and the explicit `edges` table as a fallback).
  3. Evaluate each non-driver node's formula via the safe evaluator,
     scaling variable references by their edge weight to the current
     target (so a user editing edge weights in the graph view moves
     outputs in real time, same as M9 hybrid-weights for in-code sims).
  4. Series outputs evaluate once per year (`t` and `T` bound on each
     iteration) and return a list; scalars evaluate once and return a
     float.

Series support today is intentionally narrow — agent formulas can
reference a free variable `t` (current year, 0-indexed) and `T`
(horizon). Cross-year dependencies (`x[t-1]` style) are deferred to a
follow-up slice; the agent prompts don't reliably produce that shape
yet.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass

from platform_sdk import (
    Driver,
    EdgeWeights,
    GraphEdge,
    GraphNode,
    Output,
    SimGraph,
    SimulationBase,
)

from simulation_service.evaluator import FormulaError, evaluate_formula

log = logging.getLogger("simulation_service.generic_dag")


@dataclass(frozen=True)
class _Formula:
    """One non-driver node's evaluation spec."""

    name: str
    formula: str
    kind: str  # "intermediate" | "scalar" | "series"
    depends_on: tuple[str, ...]
    unit: str = ""
    description: str = ""


@dataclass(frozen=True)
class GenericDagSpec:
    """Everything `GenericDagSim` needs at construction time. Mirrors
    the shape sector-service hands back when it reads the DB; isolating
    the schema here means the DB loader can evolve without touching the
    runtime."""

    slug: str
    name: str
    description: str
    horizon_years: int
    drivers: dict[str, Driver]
    """Driver name → SDK Driver. Includes range so the existing
    sensitivity sweep and admin UI work unchanged."""
    intermediates: list[_Formula]
    outputs: list[_Formula]
    edges: list[tuple[str, str, str]]
    """List of `(source_key, target_key, label)` rows from `graph_edges`."""


def _topological_sort(
    drivers: set[str],
    intermediates: list[_Formula],
    outputs: list[_Formula],
    edges: list[tuple[str, str, str]],
) -> list[_Formula]:
    """Return intermediates + outputs in evaluation order.

    Dependencies are gathered from two sources:

    - Each formula's explicit `depends_on` (agent provides this for
      outputs; we synthesize it for intermediates from the edges
      table).
    - The `edges` table itself — an edge `src → tgt` means `tgt`
      depends on `src`. Used as a fallback when an intermediate's
      `depends_on` is empty.

    Raises `ValueError` on cycles. Agent-generated edge sets aren't
    guaranteed to be acyclic — the prompt forbids it, but a wrong
    answer would deadlock the topo sort, so we fail loudly here so
    the activation path can surface a clear error.
    """
    by_name: dict[str, _Formula] = {}
    for n in intermediates + outputs:
        by_name[n.name] = n
    if not by_name:
        return []

    # Build adjacency lists. A "dep" is a node that must run before `n`.
    deps_of: dict[str, set[str]] = {n: set() for n in by_name}
    for n in by_name.values():
        for d in n.depends_on:
            if d in by_name:
                deps_of[n.name].add(d)
            elif d in drivers:
                # Drivers don't need scheduling — they're set up front.
                continue
            else:
                # Unknown reference; ignore at schedule time. The
                # evaluator will surface NameError at run time so the
                # admin sees what's broken.
                continue
    for src, tgt, _label in edges:
        if tgt in by_name and src != tgt:
            if src in by_name:
                deps_of[tgt].add(src)

    # Kahn's algorithm — preserves input order for ties so the trace
    # is stable across runs.
    in_degree = {n: len(deps_of[n]) for n in by_name}
    ready = [n for n in by_name if in_degree[n] == 0]
    result: list[str] = []
    while ready:
        ready.sort()  # stable per-pass order
        current = ready.pop(0)
        result.append(current)
        for n in by_name:
            if current in deps_of[n]:
                deps_of[n].remove(current)
                if not deps_of[n]:
                    ready.append(n)
    if len(result) != len(by_name):
        unresolved = [n for n in by_name if n not in result]
        raise ValueError(
            f"cycle in generic-dag graph; could not order: {unresolved}"
        )
    return [by_name[n] for n in result]


class GenericDagSim(SimulationBase):
    """Runtime for an agent-proposed sector.

    Instances are *parameterized* — each registered DB-backed sector
    constructs one of these with its own `_Spec`. We dynamically set
    the class-level `drivers` / `horizon_years` slots on the instance
    so the sensitivity sweep on `SimulationBase` finds them.
    """

    # SimulationBase's class-level slots are filled per-instance during
    # __init__ (see below). The class defaults stay empty so this
    # subclass is itself an inert placeholder.

    # Per-class spec, populated by `make_generic_dag_class()`. The
    # base class leaves it None so a bare `GenericDagSim` (no factory)
    # surfaces a clear error rather than silently no-op'ing.
    _spec: GenericDagSpec | None = None

    def __init__(
        self,
        spec: GenericDagSpec | None = None,
        edge_weights: EdgeWeights | None = None,
    ) -> None:
        super().__init__(edge_weights=edge_weights)
        # Construction order: factory builds a subclass with the spec
        # baked into the class. Callers can also pass spec explicitly
        # for one-off scripts / tests that don't go through the factory.
        resolved_spec = spec if spec is not None else type(self)._spec
        if resolved_spec is None:
            raise RuntimeError(
                "GenericDagSim requires a spec — use make_generic_dag_class() "
                "to build a parameterized subclass or pass spec= to __init__"
            )
        self._spec = resolved_spec

    # ---- SimulationBase contract ----

    def simulate(self, **kwargs: float) -> dict[str, Output]:
        spec = self._spec
        # Resolve drivers: caller overrides win, defaults fill in.
        values: dict[str, float] = {
            name: float(kwargs.get(name, d.default))
            for name, d in spec.drivers.items()
        }
        # Reject unexpected kwargs so a typo doesn't silently sweep
        # nothing — same posture as the in-code sims.
        unknown = [k for k in kwargs if k not in spec.drivers]
        if unknown:
            raise ValueError(
                f"unknown driver(s) for sector {spec.slug}: {unknown}"
            )

        order = _topological_sort(
            drivers=set(spec.drivers),
            intermediates=spec.intermediates,
            outputs=spec.outputs,
            edges=spec.edges,
        )

        # Run pass — accumulate intermediate values, build output dict.
        env: dict[str, float] = dict(values)
        outputs: dict[str, Output] = {}

        for node in order:
            if node.kind == "series":
                series: list[float] = []
                # Series outputs evaluate horizon_years times with the
                # `t` and `T` time variables bound. Earlier-completed
                # series intermediates are *not* indexed by t today —
                # cross-year coupling is out of scope for M22b.
                for t in range(spec.horizon_years):
                    series_env = {**env, "t": float(t), "T": float(spec.horizon_years)}
                    try:
                        value = evaluate_formula(
                            formula=node.formula,
                            variables=series_env,
                            edge_weights=self.edge_weights,
                            target=node.name,
                        )
                    except FormulaError as e:
                        log.warning("generic-dag sim %s/%s: %s", spec.slug, node.name, e)
                        series.append(float("nan"))
                        continue
                    series.append(value)
                outputs[node.name] = Output(
                    series=series, unit=node.unit, description=node.description
                )
                # Series can't feed downstream formulas without t-indexing.
                # Stash the last-year value in `env` as a coarse fallback
                # so dependent scalar outputs can at least reference it.
                env[node.name] = series[-1] if series else 0.0
            else:
                # Intermediate or scalar output — evaluate once.
                try:
                    value = evaluate_formula(
                        formula=node.formula,
                        variables=env,
                        edge_weights=self.edge_weights,
                        target=node.name,
                    )
                except FormulaError as e:
                    log.warning("generic-dag sim %s/%s: %s", spec.slug, node.name, e)
                    value = float("nan")
                env[node.name] = value
                if node.kind == "scalar":
                    outputs[node.name] = Output(
                        scalar=value, unit=node.unit, description=node.description
                    )
                # else intermediate — not surfaced as an output but kept
                # in `env` for downstream nodes.

        return outputs


def make_generic_dag_class(spec: GenericDagSpec) -> type[GenericDagSim]:
    """Build a `SimulationBase` subclass with the spec's metadata
    inlined into class-level slots.

    Why a dynamic subclass rather than just instance attributes: the
    SDK's `sensitivity()` + the `_metadata()` helper in `main.py` read
    `cls.drivers`, `cls.horizon_years`, `cls.graph`, etc. from the
    class, not the instance. Per-spec subclasses keep that contract
    intact without rewriting consumers.
    """
    cls_name = "GenericDagSim_" + "".join(c for c in spec.slug if c.isalnum())
    graph_nodes = tuple(
        GraphNode(
            id=name,
            label=name,
            kind="driver",
            group=d.group,
            unit=d.unit,
            description=d.description,
        )
        for name, d in spec.drivers.items()
    ) + tuple(
        GraphNode(
            id=n.name,
            label=n.name,
            kind=n.kind if n.kind != "intermediate" else "intermediate",
            group="Intermediate"
            if n.kind == "intermediate"
            else "Scalar output"
            if n.kind == "scalar"
            else "Trajectory output",
            unit=n.unit,
            description=n.description,
        )
        # Outputs declared kind = "scalar" / "series"; the SDK kind
        # taxonomy collapses both into "output" for the graph view.
        for n in spec.intermediates + [
            _Formula(
                name=o.name,
                formula=o.formula,
                kind="output",
                depends_on=o.depends_on,
                unit=o.unit,
                description=o.description,
            )
            for o in spec.outputs
        ]
    )
    graph_edges = tuple(
        GraphEdge(source=src, target=tgt, label=label)
        for src, tgt, label in spec.edges
    )

    attrs: dict[str, object] = {
        "slug": spec.slug,
        "name": spec.name,
        "description": spec.description,
        "horizon_years": spec.horizon_years,
        "drivers": dict(spec.drivers),
        "presets": {},
        "provenance": {},
        "graph": SimGraph(nodes=graph_nodes, edges=graph_edges),
        "_spec": spec,
    }
    return type(cls_name, (GenericDagSim,), attrs)
