from __future__ import annotations

from agent_tools.cost import CostMeter, model_price, price_call


def test_known_model_pricing_matches_published_rates() -> None:
    # opus tier — gemini-3.1-pro-preview (post-F9).
    opus = model_price("gemini-3.1-pro-preview")
    assert opus.input_per_million_usd == 1.25
    assert opus.output_per_million_usd == 10.00
    # sonnet / haiku — Gemini flash family.
    sonnet = model_price("gemini-3.5-flash")
    assert sonnet.input_per_million_usd == 0.50
    assert sonnet.output_per_million_usd == 3.00
    haiku = model_price("gemini-3.5-flash-lite")
    assert haiku.input_per_million_usd == 0.25
    assert haiku.output_per_million_usd == 1.50
    # Cache multipliers default to Gemini's `cachedContent` economics
    # (0.25× discount on cache reads; no write premium).
    assert opus.cache_read_multiplier == 0.25
    assert opus.cache_write_multiplier == 1.0


def test_unknown_model_falls_back_to_cheapest_price() -> None:
    """An unfamiliar model should price at the cheapest entry, not raise —
    so a routing typo surfaces as a small cost bump rather than a crash."""
    p = model_price("gemini-banana-9-9")
    assert p.input_per_million_usd == 0.25  # flash-lite


def test_price_call_applies_gemini_cache_discount() -> None:
    """1M raw input + 1M output + 1M cache-read on
    gemini-3.1-pro-preview — verifies the 0.25× cache_read multiplier
    (the Gemini `cachedContent` discount) and that
    cache_creation_input_tokens (always 0 for Gemini today) bills at
    the base input rate when non-zero."""
    p = price_call(
        model="gemini-3.1-pro-preview",
        input_tokens=1_000_000,
        output_tokens=1_000_000,
        cache_creation_input_tokens=1_000_000,
        cache_read_input_tokens=1_000_000,
    )
    # Input:       1M * $1.25 = 1.25
    # Cache write: 1M * $1.25 * 1.00 = 1.25 (no Gemini premium today)
    # Cache read:  1M * $1.25 * 0.25 = 0.3125
    # Output:      1M * $10.00 = 10.00
    # Total = 12.8125
    assert abs(p.cost_usd - 12.8125) < 1e-6
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
    meter.record(
        price_call(model="gemini-3.1-pro-preview", input_tokens=1000, output_tokens=500)
    )
    summary = meter.summary()
    # round-trips through JSON cleanly — important for audit logs.
    encoded = json.dumps(summary)
    decoded = json.loads(encoded)
    assert decoded["calls"] == 1
    assert decoded["tokens"]["input"] == 1000
    assert decoded["tokens"]["output"] == 500
