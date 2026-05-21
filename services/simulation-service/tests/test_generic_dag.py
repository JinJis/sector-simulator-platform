"""Tests for the M22b GenericDagSim runtime.

Covers topological evaluation, edge-weight propagation, series outputs,
unknown-driver rejection, cycle detection, and graceful failure
(formula errors yield NaN, not 500s).
"""

from __future__ import annotations

import math

import pytest
from platform_sdk import Driver, EdgeWeights

from simulation_service.generic_dag import (
    GenericDagSpec,
    _Formula,
    make_generic_dag_class,
)


def _spec(
    *,
    intermediates: list[_Formula] | None = None,
    outputs: list[_Formula] | None = None,
    drivers: dict[str, Driver] | None = None,
    edges: list[tuple[str, str, str]] | None = None,
    horizon_years: int = 5,
) -> GenericDagSpec:
    return GenericDagSpec(
        slug="test-sector",
        name="Test sector",
        description="",
        horizon_years=horizon_years,
        drivers=drivers
        or {
            "a": Driver(default=10, range=(1, 100), unit=""),
            "b": Driver(default=20, range=(1, 100), unit=""),
        },
        intermediates=intermediates or [],
        outputs=outputs or [],
        edges=edges or [],
    )


def _build(spec: GenericDagSpec, weights: EdgeWeights | None = None):
    return make_generic_dag_class(spec)(spec, edge_weights=weights)


# ---- Basic evaluation ----------------------------------------------------


def test_scalar_output_evaluates_formula() -> None:
    spec = _spec(
        outputs=[
            _Formula(
                name="total",
                formula="a + b",
                kind="scalar",
                depends_on=("a", "b"),
            )
        ],
        edges=[("a", "total", "+"), ("b", "total", "+")],
    )
    sim = _build(spec)
    out = sim.simulate()
    assert out["total"].scalar == 30  # 10 + 20 defaults


def test_intermediate_feeds_output() -> None:
    spec = _spec(
        intermediates=[
            _Formula(
                name="product",
                formula="a * b",
                kind="intermediate",
                depends_on=("a", "b"),
            )
        ],
        outputs=[
            _Formula(
                name="doubled",
                formula="product * 2",
                kind="scalar",
                depends_on=("product",),
            )
        ],
        edges=[
            ("a", "product", "×"),
            ("b", "product", "×"),
            ("product", "doubled", "×2"),
        ],
    )
    sim = _build(spec)
    out = sim.simulate()
    assert out["doubled"].scalar == 400  # (10 * 20) * 2


def test_driver_override_changes_output() -> None:
    spec = _spec(
        outputs=[
            _Formula(name="sum", formula="a + b", kind="scalar", depends_on=("a", "b"))
        ],
    )
    sim = _build(spec)
    out = sim.simulate(a=50, b=50)
    assert out["sum"].scalar == 100


def test_unknown_driver_raises() -> None:
    spec = _spec(
        outputs=[
            _Formula(name="sum", formula="a + b", kind="scalar", depends_on=("a", "b"))
        ],
    )
    sim = _build(spec)
    with pytest.raises(ValueError, match="unknown driver"):
        sim.simulate(a=1, zzz=42)


# ---- Series outputs ------------------------------------------------------


def test_series_output_indexed_by_t() -> None:
    spec = _spec(
        horizon_years=4,
        outputs=[
            _Formula(
                name="ramp",
                formula="a * (1 + t * 0.1)",
                kind="series",
                depends_on=("a",),
            )
        ],
    )
    sim = _build(spec)
    out = sim.simulate()
    assert out["ramp"].series == pytest.approx([10.0, 11.0, 12.0, 13.0])


def test_series_can_use_T_horizon() -> None:
    spec = _spec(
        horizon_years=4,
        outputs=[
            _Formula(
                name="fraction",
                formula="t / T",
                kind="series",
                depends_on=(),
            )
        ],
    )
    sim = _build(spec)
    out = sim.simulate()
    assert out["fraction"].series == pytest.approx([0.0, 0.25, 0.5, 0.75])


# ---- Edge weights propagate through formulas -----------------------------


def test_edge_weight_doubles_contribution() -> None:
    spec = _spec(
        outputs=[
            _Formula(
                name="weighted_sum",
                formula="a + b",
                kind="scalar",
                depends_on=("a", "b"),
            )
        ],
        edges=[("a", "weighted_sum", ""), ("b", "weighted_sum", "")],
    )
    # Default a=10, b=20. Weight `a → weighted_sum` doubled to 2.0.
    sim = _build(
        spec,
        EdgeWeights({("a", "weighted_sum"): 2.0}),
    )
    out = sim.simulate()
    assert out["weighted_sum"].scalar == 20 + 20  # 10*2 + 20


def test_edge_weight_only_applies_to_named_target() -> None:
    spec = _spec(
        intermediates=[
            _Formula(name="inter", formula="a * 2", kind="intermediate", depends_on=("a",))
        ],
        outputs=[
            _Formula(name="o", formula="inter + a", kind="scalar", depends_on=("inter", "a"))
        ],
        edges=[("a", "inter", "×2"), ("inter", "o", "+"), ("a", "o", "+")],
    )
    # Weight only on the inter → o edge.
    sim = _build(
        spec,
        EdgeWeights({("inter", "o"): 3.0}),
    )
    out = sim.simulate()
    # inter = a * 2 = 20 (no weight applied — neutral on (a → inter))
    # o = inter * 3 + a * 1 = 60 + 10 = 70
    assert out["o"].scalar == 70


# ---- Topological correctness --------------------------------------------


def test_topological_sort_handles_chain() -> None:
    spec = _spec(
        intermediates=[
            _Formula(name="x1", formula="a + 1", kind="intermediate", depends_on=("a",)),
            _Formula(name="x2", formula="x1 + 1", kind="intermediate", depends_on=("x1",)),
            _Formula(name="x3", formula="x2 + 1", kind="intermediate", depends_on=("x2",)),
        ],
        outputs=[
            _Formula(name="last", formula="x3 + 1", kind="scalar", depends_on=("x3",))
        ],
    )
    sim = _build(spec)
    out = sim.simulate()
    assert out["last"].scalar == 14  # a=10 → x1=11 → x2=12 → x3=13 → last=14


def test_topological_sort_uses_edges_as_fallback() -> None:
    # depends_on is empty; the topo sort must fall back to the edge
    # table to discover the order.
    spec = _spec(
        intermediates=[
            _Formula(name="inter", formula="a * 2", kind="intermediate", depends_on=()),
        ],
        outputs=[
            _Formula(name="result", formula="inter + 1", kind="scalar", depends_on=()),
        ],
        edges=[("a", "inter", ""), ("inter", "result", "")],
    )
    sim = _build(spec)
    out = sim.simulate()
    assert out["result"].scalar == 21  # (10 * 2) + 1


def test_cycle_raises() -> None:
    spec = _spec(
        intermediates=[
            _Formula(name="x", formula="y + 1", kind="intermediate", depends_on=("y",)),
            _Formula(name="y", formula="x + 1", kind="intermediate", depends_on=("x",)),
        ],
        outputs=[
            _Formula(name="o", formula="x + y", kind="scalar", depends_on=("x", "y"))
        ],
    )
    sim = _build(spec)
    with pytest.raises(ValueError, match="cycle"):
        sim.simulate()


# ---- Graceful failure ----------------------------------------------------


def test_formula_error_produces_nan_not_raise() -> None:
    spec = _spec(
        outputs=[
            _Formula(
                name="bad",
                formula="a / 0",
                kind="scalar",
                depends_on=("a",),
            )
        ],
    )
    sim = _build(spec)
    out = sim.simulate()
    assert math.isnan(out["bad"].scalar)


# ---- Class-level attributes preserved for SDK contract -------------------


def test_dynamic_subclass_exposes_metadata() -> None:
    spec = _spec(
        outputs=[
            _Formula(name="o", formula="a", kind="scalar", depends_on=("a",))
        ],
    )
    cls = make_generic_dag_class(spec)
    assert cls.slug == "test-sector"
    assert cls.name == "Test sector"
    assert cls.horizon_years == 5
    assert "a" in cls.drivers
    # Graph has driver + output nodes + the edge between them in the spec.
    assert len(cls.graph.nodes) == 3  # 2 drivers + 1 output


def test_sensitivity_works_off_generic_dag() -> None:
    # The SDK's default sensitivity() walks `cls.drivers` and sweeps
    # each to min / max. Verify that path runs end-to-end against a
    # generic-dag class — confirms the per-spec subclass is shaped
    # correctly for the SDK contract.
    spec = _spec(
        drivers={
            "x": Driver(default=10, range=(0, 100), unit=""),
        },
        outputs=[
            _Formula(name="scalar_out", formula="x * 2", kind="scalar", depends_on=("x",))
        ],
    )
    sim = _build(spec)
    sens = sim.sensitivity()
    # x sweep 0..100, output = x * 2 → swing 0..200 → range 200.
    assert sens["scalar_out"]["x"] == pytest.approx(200.0)
