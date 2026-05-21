-- Phase 2 epic, milestone 10d: balance sheet items on EquityFinancial

ALTER TABLE "equity_financials"
    ADD COLUMN "total_assets_usd" DOUBLE PRECISION,
    ADD COLUMN "total_liabilities_usd" DOUBLE PRECISION,
    ADD COLUMN "total_equity_usd" DOUBLE PRECISION;
