from __future__ import annotations

from agent_tools.cost import CostMeter, model_price, price_call


def test_known_model_pricing_matches_published_rates() -> None:
    # opus tier — Claude (post-M35).
    opus = model_price("claude-opus-4-7")
    assert opus.input_per_million_usd == 15.00
    assert opus.output_per_million_usd == 75.00
    # Cache multipliers are Anthropic-specific.
    assert opus.cache_read_multiplier == 0.1
    assert opus.cache_write_multiplier == 1.25
    # sonnet / haiku — Gemini flash family.
    sonnet = model_price("gemini-3.5-flash")
    assert sonnet.input_per_million_usd == 0.50
    assert sonnet.output_per_million_usd == 3.00
    haiku = model_price("gemini-3.5-flash-lite")
    assert haiku.input_per_million_usd == 0.25
    assert haiku.output_per_million_usd == 1.50


def test_unknown_model_falls_back_to_cheapest_price() -> None:
    """An unfamiliar model should price at the cheapest entry, not raise —
    so a routing typo surfaces as a small cost bump rather than a crash."""
    p = model_price("gemini-banana-9-9")
    assert p.input_per_million_usd == 0.25  # flash-lite


def test_price_call_includes_cache_discounts_and_premium_for_claude_opus() -> None:
    """1M raw input + 1M output on claude-opus-4-7 with 1M cache read +
    1M cache write — verifies the Anthropic multipliers (0.1× read,
    1.25× write)."""
    p = price_call(
        model="claude-opus-4-7",
        input_tokens=1_000_000,
        output_tokens=1_000_000,
        cache_creation_input_tokens=1_000_000,
        cache_read_input_tokens=1_000_000,
    )
    # Input:       1M * $15 = 15
    # Cache write: 1M * $15 * 1.25 = 18.75
    # Cache read:  1M * $15 * 0.1  = 1.50
    # Output:      1M * $75 = 75
    # Total = 110.25
    assert abs(p.cost_usd - 110.25) < 1e-6
    assert p.total_input_tokens == 3_000_000


def test_cost_meter_accumulates_across_calls() -> None:
    meter = CostMeter()
    meter.record(
        price_call(model="gemini-3.5-flash-lite", input_tokens=100_000, output_tokens=10_000)
    )
    meter.record(
        price_call(model="gemini-3.5-flash", input_tokens=50_000, output_tokens=5_000)
    )

    # flash-lite: 100k * $0.25/1M + 10k * $1.50/1M = 0.025 + 0.015 = 0.040
    # flash:      50k * $0.50/1M + 5k  * $3/1M    = 0.025 + 0.015 = 0.040
    # Total: 0.080
    assert abs(meter.total_usd - 0.080) < 1e-6
    by_model = meter.by_model()
    assert abs(by_model["gemini-3.5-flash-lite"] - 0.040) < 1e-6
    assert abs(by_model["gemini-3.5-flash"] - 0.040) < 1e-6


def test_cost_meter_summary_is_json_serializable() -> None:
    import json

    meter = CostMeter()
    meter.record(price_call(model="claude-opus-4-7", input_tokens=1000, output_tokens=500))
    summary = meter.summary()
    # round-trips through JSON cleanly — important for audit logs.
    encoded = json.dumps(summary)
    decoded = json.loads(encoded)
    assert decoded["calls"] == 1
    assert decoded["tokens"]["input"] == 1000
    assert decoded["tokens"]["output"] == 500
