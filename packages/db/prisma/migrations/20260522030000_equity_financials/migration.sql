-- Phase 2 epic, milestone 10: quarterly EquityFinancial fundamentals

-- CreateTable
CREATE TABLE "equity_financials" (
    "equity_id" TEXT NOT NULL,
    "fiscal_year" INTEGER NOT NULL,
    "fiscal_quarter" INTEGER NOT NULL,
    "period_end" DATE NOT NULL,
    "revenue_usd" DOUBLE PRECISION,
    "cogs_usd" DOUBLE PRECISION,
    "gross_profit_usd" DOUBLE PRECISION,
    "opex_usd" DOUBLE PRECISION,
    "ebitda_usd" DOUBLE PRECISION,
    "net_income_usd" DOUBLE PRECISION,
    "capex_usd" DOUBLE PRECISION,
    "source" TEXT NOT NULL DEFAULT 'mock',
    "inserted_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "equity_financials_pkey" PRIMARY KEY ("equity_id", "fiscal_year", "fiscal_quarter")
);

-- CreateIndex
CREATE INDEX "equity_financials_equity_id_period_end_idx" ON "equity_financials"("equity_id", "period_end" DESC);

-- AddForeignKey
ALTER TABLE "equity_financials" ADD CONSTRAINT "equity_financials_equity_id_fkey" FOREIGN KEY ("equity_id") REFERENCES "sector_equities"("id") ON DELETE CASCADE ON UPDATE CASCADE;
