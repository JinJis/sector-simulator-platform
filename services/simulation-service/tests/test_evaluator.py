"""Tests for the M22b safe formula evaluator.

Covers arithmetic correctness, edge-weight application, safety (no
imports, attribute access, comprehensions), and error surfaces.
"""

from __future__ import annotations

import math

import pytest
from platform_sdk import EdgeWeights

from simulation_service.evaluator import FormulaError, evaluate_formula


# ---- Arithmetic correctness ----------------------------------------------


def test_basic_arithmetic() -> None:
    out = evaluate_formula(
        formula="a + b * 2 - c / 4",
        variables={"a": 10, "b": 3, "c": 8},
        edge_weights=EdgeWeights(),
        target="result",
    )
    assert out == 10 + 6 - 2


def test_power_operator() -> None:
    out = evaluate_formula(
        formula="2 ** depth",
        variables={"depth": 5},
        edge_weights=EdgeWeights(),
        target="x",
    )
    assert out == 32.0


def test_whitelisted_functions() -> None:
    out = evaluate_formula(
        formula="max(a, b) - min(a, b) + sqrt(c)",
        variables={"a": 7, "b": 3, "c": 16},
        edge_weights=EdgeWeights(),
        target="x",
    )
    assert out == pytest.approx(4 + 4)


def test_constants_pi_and_e() -> None:
    out = evaluate_formula(
        formula="pi * r ** 2",
        variables={"r": 2},
        edge_weights=EdgeWeights(),
        target="area",
    )
    assert out == pytest.approx(math.pi * 4)


def test_unit_conversion_constants() -> None:
    out = evaluate_formula(
        formula="mwh * MMBtu_per_MWh",
        variables={"mwh": 10},
        edge_weights=EdgeWeights(),
        target="mmbtu",
    )
    assert out == pytest.approx(34.1214)


# ---- Edge weights --------------------------------------------------------


def test_edge_weights_scale_variable_references() -> None:
    # `a * b`, both edges weighted 2.0 → result quadruples.
    ew = EdgeWeights({("a", "y"): 2.0, ("b", "y"): 2.0})
    out = evaluate_formula(
        formula="a * b",
        variables={"a": 3, "b": 4},
        edge_weights=ew,
        target="y",
    )
    assert out == 48.0  # (3 * 2) * (4 * 2)


def test_edge_weight_neutral_default() -> None:
    out = evaluate_formula(
        formula="a + b",
        variables={"a": 5, "b": 5},
        edge_weights=EdgeWeights(),
        target="y",
    )
    assert out == 10.0


def test_edge_weights_only_apply_to_named_target() -> None:
    # Weight is defined for (a → other_target); shouldn't fire for y.
    ew = EdgeWeights({("a", "other"): 5.0})
    out = evaluate_formula(
        formula="a + 1",
        variables={"a": 10},
        edge_weights=ew,
        target="y",
    )
    assert out == 11.0


def test_negative_weight_inverts_contribution() -> None:
    ew = EdgeWeights({("a", "y"): -1.0})
    out = evaluate_formula(
        formula="a + b",
        variables={"a": 5, "b": 3},
        edge_weights=ew,
        target="y",
    )
    assert out == -5 + 3


# ---- Safety / bounded surface --------------------------------------------


def test_unknown_name_raises_formula_error() -> None:
    with pytest.raises(FormulaError, match="unknown name"):
        evaluate_formula(
            formula="a + undefined_var",
            variables={"a": 1},
            edge_weights=EdgeWeights(),
            target="y",
        )


def test_dunder_attempt_is_blocked() -> None:
    # simpleeval forbids any `__attr__` access — this is the classic
    # Python-sandbox-escape vector and must stay blocked.
    with pytest.raises(FormulaError):
        evaluate_formula(
            formula="(1).__class__",
            variables={},
            edge_weights=EdgeWeights(),
            target="y",
        )


def test_mro_walk_is_blocked() -> None:
    # Defense in depth — even if the agent finds a non-dunder path to
    # __class__ via a chained attr, the FeatureNotAvailable guard
    # catches it.
    with pytest.raises(FormulaError):
        evaluate_formula(
            formula="a.__class__.__mro__",
            variables={"a": 1.0},
            edge_weights=EdgeWeights(),
            target="y",
        )


def test_import_attempt_is_blocked() -> None:
    # `__import__` isn't whitelisted as a function, so this is NameError.
    with pytest.raises(FormulaError):
        evaluate_formula(
            formula="__import__('os')",
            variables={},
            edge_weights=EdgeWeights(),
            target="y",
        )


def test_lambda_blocked() -> None:
    with pytest.raises(FormulaError):
        evaluate_formula(
            formula="(lambda x: x + 1)(5)",
            variables={},
            edge_weights=EdgeWeights(),
            target="y",
        )


# ---- Numeric edge cases --------------------------------------------------


def test_division_by_zero_raises() -> None:
    with pytest.raises(FormulaError, match="division by zero"):
        evaluate_formula(
            formula="a / 0",
            variables={"a": 5},
            edge_weights=EdgeWeights(),
            target="y",
        )


def test_non_finite_result_raises_on_overflow() -> None:
    # Multiplication overflow produces inf, which we reject before
    # handing back to the sim runtime — inf in a series chart is more
    # confusing than an explicit error.
    with pytest.raises(FormulaError, match="non-finite"):
        evaluate_formula(
            formula="huge * huge",
            variables={"huge": 1e200},
            edge_weights=EdgeWeights(),
            target="y",
        )


def test_boolean_result_coerces_to_int() -> None:
    out = evaluate_formula(
        formula="a > b",
        variables={"a": 5, "b": 3},
        edge_weights=EdgeWeights(),
        target="y",
    )
    assert out == 1.0
