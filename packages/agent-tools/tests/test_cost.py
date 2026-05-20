from __future__ import annotations

from agent_tools.cost import CostMeter, model_price, price_call


def test_known_model_pricing_matches_published_rates() -> None:
    opus = model_price("claude-opus-4-7")
    assert opus.input_per_million_usd == 5.00
    assert opus.output_per_million_usd == 25.00
    sonnet = model_price("claude-sonnet-4-6")
    assert sonnet.output_per_million_usd == 15.00
    haiku = model_price("claude-haiku-4-5")
    assert haiku.input_per_million_usd == 1.00


def test_unknown_model_falls_back_to_haiku_price() -> None:
    """An unfamiliar model should price at the cheapest entry, not raise —
    so a routing typo surfaces as a small cost bump rather than a crash."""
    p = model_price("claude-banana-9-9")
    assert p.input_per_million_usd == 1.00


def test_price_call_includes_cache_discounts_and_premium() -> None:
    """1M raw input + 1M output on Opus 4.7 with 1M cache read + 1M cache
    write — verifies the multipliers are applied correctly (0.1× read,
    1.25× write)."""
    p = price_call(
        model="claude-opus-4-7",
        input_tokens=1_000_000,
        output_tokens=1_000_000,
        cache_creation_input_tokens=1_000_000,
        cache_read_input_tokens=1_000_000,
    )
    # Input: 5 + cache_write 5 * 1.25 + cache_read 5 * 0.1 = 5 + 6.25 + 0.5 = 11.75
    # Output: 25
    # Total: 36.75
    assert abs(p.cost_usd - 36.75) < 1e-6
    assert p.total_input_tokens == 3_000_000


def test_cost_meter_accumulates_across_calls() -> None:
    meter = CostMeter()
    meter.record(price_call(model="claude-haiku-4-5", input_tokens=100_000, output_tokens=10_000))
    meter.record(price_call(model="claude-sonnet-4-6", input_tokens=50_000, output_tokens=5_000))

    # Haiku: 100k * $1/1M + 10k * $5/1M = 0.10 + 0.05 = 0.15
    # Sonnet: 50k * $3/1M + 5k * $15/1M = 0.15 + 0.075 = 0.225
    # Total: 0.375
    assert abs(meter.total_usd - 0.375) < 1e-6
    by_model = meter.by_model()
    assert abs(by_model["claude-haiku-4-5"] - 0.15) < 1e-6
    assert abs(by_model["claude-sonnet-4-6"] - 0.225) < 1e-6


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
