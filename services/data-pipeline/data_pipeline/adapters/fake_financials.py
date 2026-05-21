"""Fake financials source — milestone 10b.

Same role as `fake.py` (FakeSource for quotes): drop-in replacement for
DART / EDGAR in tests. Returns deterministic quarterly walks anchored
on a per-ticker seed so assertions can pin values without snapshotting
real upstream JSON.
"""

from __future__ import annotations

import hashlib
from datetime import date

from data_pipeline.adapters.financials_base import (
    FinancialQuarter,
    FinancialsSource,
)


def _seed(s: str) -> int:
    return int.from_bytes(hashlib.sha256(s.encode("utf-8")).digest()[:4], "big")


def _quarter_end(year: int, q: int) -> date:
    # Calendar quarter ends matching the seed.ts convention so test
    # fixtures align with the mock-seeded data.
    return {1: date(year, 3, 31), 2: date(year, 6, 30), 3: date(year, 9, 30), 4: date(year, 12, 31)}[q]


class FakeFinancialsSource(FinancialsSource):
    """Per-ticker deterministic walks. Same anchor (~$10B annual revenue
    by default) so test assertions don't depend on market_cap_usd —
    callers can override via the `revenue_anchor_usd` kwarg.
    """

    def __init__(self, *, revenue_anchor_usd: float = 10_000_000_000.0) -> None:
        self._anchor = revenue_anchor_usd

    async def fetch_financials(
        self,
        *,
        ticker: str,
        exchange: str,
        country: str,
        quarters: int,
    ) -> list[FinancialQuarter]:
        seed = _seed(f"{ticker}|{exchange}|{country}")
        # Mix per-ticker margin variation so two different tickers don't
        # have identical-looking series.
        gross_margin = 0.25 + (seed % 20) / 100  # 0.25..0.44
        opex_ratio = 0.10 + ((seed >> 8) % 12) / 100  # 0.10..0.21
        capex_ratio = 0.10 + ((seed >> 16) % 20) / 100  # 0.10..0.29
        tax_drag = 0.30 + ((seed >> 24) % 15) / 100  # 0.30..0.44

        # Walk back from "today" (2026Q1).
        end_year, end_quarter = 2026, 1
        # Tag points so we end at the anchor / 4 (≈ quarterly revenue).
        base_q_rev = self._anchor / 4
        growth = 0.024  # ~10%/yr quarterly

        # Generate oldest → newest by walking forwards.
        rows: list[FinancialQuarter] = []
        # Pre-compute (year, quarter) list ending at end_year/Q.
        seq: list[tuple[int, int]] = []
        y, q = end_year, end_quarter
        for _ in range(quarters):
            seq.append((y, q))
            q -= 1
            if q < 1:
                q = 4
                y -= 1
        seq.reverse()

        start = base_q_rev / ((1 + growth) ** (quarters - 1))
        # Balance sheet ratios — also deterministic per ticker. Anchor
        # at "today's" annual revenue scale so the numbers stay sensible.
        annual_rev_today = base_q_rev * 4 * ((1 + growth) ** (quarters - 1))
        assets_ratio = 0.8 + ((seed >> 4) % 60) / 100  # 0.8..1.4 × annual revenue
        leverage = 0.35 + ((seed >> 12) % 30) / 100    # 35..64% of assets are liabilities
        for i, (yy, qq) in enumerate(seq):
            wobble = 1 + ((((seed >> (i % 24)) & 0xFF) - 128) / 128) * 0.03
            revenue = start * ((1 + growth) ** i) * wobble
            gross = revenue * gross_margin
            cogs = revenue - gross
            opex = revenue * opex_ratio
            ebitda = gross - opex
            net = ebitda * (1 - tax_drag)
            capex = revenue * capex_ratio
            # BS items grow with the company; minor independent wobble.
            bs_wobble = 1 + ((((seed >> ((i + 7) % 24)) & 0xFF) - 128) / 128) * 0.02
            total_assets = annual_rev_today * assets_ratio * ((1 + growth) ** (i - (quarters - 1))) * bs_wobble
            total_liabilities = total_assets * leverage
            total_equity = total_assets - total_liabilities
            rows.append(
                FinancialQuarter(
                    fiscal_year=yy,
                    fiscal_quarter=qq,
                    period_end=_quarter_end(yy, qq),
                    revenue_usd=revenue,
                    cogs_usd=cogs,
                    gross_profit_usd=gross,
                    opex_usd=opex,
                    ebitda_usd=ebitda,
                    net_income_usd=net,
                    capex_usd=capex,
                    total_assets_usd=total_assets,
                    total_liabilities_usd=total_liabilities,
                    total_equity_usd=total_equity,
                    source="fake",
                )
            )
        return rows
