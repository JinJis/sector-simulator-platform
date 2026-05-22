from __future__ import annotations

from agent_tools.cost import CostMeter, model_price, price_call


def test_known_model_pricing_matches_published_rates() -> None:
    # opus tier (post-2026-05 swap from gemini-3.1-pro-preview):
    opus = model_price("gemini-3.5-flash")
    assert opus.input_per_million_usd == 0.50
    assert opus.output_per_million_usd == 3.00
    flash = model_price("gemini-3-flash-preview")
    assert flash.output_per_million_usd == 3.00
    lite = model_price("gemini-3.1-flash-lite")
    assert lite.input_per_million_usd == 0.25


def test_unknown_model_falls_back_to_cheapest_price() -> None:
    """An unfamiliar model should price at the cheapest entry, not raise —
    so a routing typo surfaces as a small cost bump rather than a crash."""
    p = model_price("gemini-banana-9-9")
    assert p.input_per_million_usd == 0.25  # flash-lite


def test_price_call_includes_cache_discounts_and_premium() -> None:
    """1M raw input + 1M output on the opus-tier model (gemini-3.5-flash)
    with 1M cache read + 1M cache write — verifies the multipliers
    (0.25× read, 1× write for Gemini)."""
    p = price_call(
        model="gemini-3.5-flash",
        input_tokens=1_000_000,
        output_tokens=1_000_000,
        cache_creation_input_tokens=1_000_000,
        cache_read_input_tokens=1_000_000,
    )
    # Input: 0.5 + cache_write 0.5 * 1.0 + cache_read 0.5 * 0.25
    #      = 0.5 + 0.5 + 0.125 = 1.125
    # Output: 3.00
    # Total: 4.125
    assert abs(p.cost_usd - 4.125) < 1e-6
    assert p.total_input_tokens == 3_000_000


def test_cost_meter_accumulates_across_calls() -> None:
    meter = CostMeter()
    meter.record(
        price_call(model="gemini-3.1-flash-lite", input_tokens=100_000, output_tokens=10_000)
    )
    meter.record(
        price_call(model="gemini-3-flash-preview", input_tokens=50_000, output_tokens=5_000)
    )

    # flash-lite: 100k * $0.25/1M + 10k * $1.50/1M = 0.025 + 0.015 = 0.040
    # flash: 50k * $0.50/1M + 5k * $3/1M = 0.025 + 0.015 = 0.040
    # Total: 0.080
    assert abs(meter.total_usd - 0.080) < 1e-6
    by_model = meter.by_model()
    assert abs(by_model["gemini-3.1-flash-lite"] - 0.040) < 1e-6
    assert abs(by_model["gemini-3-flash-preview"] - 0.040) < 1e-6


def test_cost_meter_summary_is_json_serializable() -> None:
    import json

    meter = CostMeter()
    meter.record(price_call(model="gemini-3.5-flash", input_tokens=1000, output_tokens=500))
    summary = meter.summary()
    # round-trips through JSON cleanly — important for audit logs.
    encoded = json.dumps(summary)
    decoded = json.loads(encoded)
    assert decoded["calls"] == 1
    assert decoded["tokens"]["input"] == 1000
    assert decoded["tokens"]["output"] == 500
