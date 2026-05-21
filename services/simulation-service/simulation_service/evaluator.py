"""Safe formula evaluation for agent-generated sims.

The EdgeInference agent produces formulas like
`compute_demand_pflops / chip_pflops_per_kw` or
`industry_revenue * market_share`. We need to evaluate those against a
variable binding dict at runtime, without enabling code execution.

`simpleeval` gives us exactly that: arithmetic + comparisons + function
calls (whitelist) + ternary, but **no** imports, attribute access,
comprehensions, lambdas, or dunder methods. The blast radius of a
malicious formula is therefore bounded to "burn some CPU".

We additionally:

- Whitelist a small set of math functions agents tend to reach for
  (`min`, `max`, `abs`, `sum`, `exp`, `log`, `sqrt`, `pow`, `round`).
- Apply per-source **edge weights** at variable resolution time —
  every reference to `<src>` inside the formula of node `<tgt>` is
  multiplied by `edge_weights.w(src, tgt)`. Default weight 1.0 means
  formulas reproduce the agent's stated math verbatim.

If a formula raises (`NameError`, `ZeroDivisionError`,
`OverflowError`, parse errors) we surface a `FormulaError` so callers
can decide whether to fall back to NaN / 0 / re-raise.
"""

from __future__ import annotations

import math
from typing import Any

from platform_sdk import EdgeWeights
from simpleeval import (
    AttributeDoesNotExist,
    EvalWithCompoundTypes,
    FeatureNotAvailable,
    InvalidExpression,
    NameNotDefined,
)


class FormulaError(ValueError):
    """Raised when a formula fails to evaluate. The message names the
    failing node + the underlying cause so logs are debuggable."""


_SAFE_FUNCTIONS: dict[str, Any] = {
    "min": min,
    "max": max,
    "abs": abs,
    "sum": sum,
    "round": round,
    "exp": math.exp,
    "log": math.log,
    "log10": math.log10,
    "sqrt": math.sqrt,
    "pow": pow,
    "floor": math.floor,
    "ceil": math.ceil,
}

_SAFE_CONSTANTS: dict[str, Any] = {
    "pi": math.pi,
    "e": math.e,
    # Engineering shortcuts agents reach for in revenue / energy math.
    "MWh_per_MMBtu": 0.293071,
    "MMBtu_per_MWh": 3.41214,
}


def _build_names(
    variables: dict[str, float],
    edge_weights: EdgeWeights,
    target: str,
) -> dict[str, Any]:
    """Variables are resolved through this mapping; we multiply each
    `var` by its `(var → target)` edge weight at resolution time.

    For neutral graphs (every edge w=1.0) this returns `variables`
    unchanged, so formulas reproduce the agent's stated math.
    """
    bound: dict[str, Any] = dict(_SAFE_CONSTANTS)
    for name, value in variables.items():
        w = edge_weights.w(name, target)
        bound[name] = value * w if w != 1.0 else value
    return bound


def evaluate_formula(
    *,
    formula: str,
    variables: dict[str, float],
    edge_weights: EdgeWeights,
    target: str,
) -> float:
    """Evaluate `formula` against `variables`. Each variable reference
    is scaled by its incoming edge weight to `target`.

    Returns a float. Raises `FormulaError` with a node-prefixed message
    on any evaluation failure.
    """
    names = _build_names(variables, edge_weights, target)
    evaluator = EvalWithCompoundTypes(
        functions=_SAFE_FUNCTIONS,
        names=names,
    )
    try:
        result = evaluator.eval(formula)
    except NameNotDefined as e:
        raise FormulaError(
            f"{target}: unknown name in formula `{formula}` — {e}"
        ) from e
    except AttributeDoesNotExist as e:
        raise FormulaError(
            f"{target}: attribute access not allowed in formula `{formula}` — {e}"
        ) from e
    except FeatureNotAvailable as e:
        raise FormulaError(
            f"{target}: feature not allowed in formula `{formula}` — {e}"
        ) from e
    except InvalidExpression as e:
        raise FormulaError(
            f"{target}: invalid expression `{formula}` — {e}"
        ) from e
    except ZeroDivisionError as e:
        raise FormulaError(
            f"{target}: division by zero in `{formula}` — {e}"
        ) from e
    except (TypeError, ValueError, OverflowError) as e:
        raise FormulaError(
            f"{target}: {type(e).__name__} in `{formula}` — {e}"
        ) from e

    if isinstance(result, bool):
        # Python bool is a subclass of int. A formula that evaluates to
        # `True` is almost certainly an authoring mistake (`==` instead
        # of `=`); coerce to int 0/1 silently — surprising boolean
        # outputs in time series tend to confuse readers more than they
        # help.
        return float(int(result))
    if isinstance(result, (int, float)):
        if not math.isfinite(float(result)):
            raise FormulaError(
                f"{target}: non-finite result {result} from `{formula}`"
            )
        return float(result)
    raise FormulaError(
        f"{target}: formula `{formula}` produced non-numeric result {result!r}"
    )
