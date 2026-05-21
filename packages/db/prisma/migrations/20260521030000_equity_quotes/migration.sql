-- CreateTable
CREATE TABLE "equity_quotes" (
    "equity_id" TEXT NOT NULL,
    "trade_date" DATE NOT NULL,
    "close_local" DOUBLE PRECISION NOT NULL,
    "close_usd" DOUBLE PRECISION,
    "volume" DOUBLE PRECISION,
    "source" TEXT NOT NULL DEFAULT 'yfinance',
    "inserted_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "equity_quotes_pkey" PRIMARY KEY ("equity_id", "trade_date")
);

-- CreateIndex
CREATE INDEX "equity_quotes_equity_id_trade_date_idx" ON "equity_quotes"("equity_id", "trade_date" DESC);

-- AddForeignKey
ALTER TABLE "equity_quotes" ADD CONSTRAINT "equity_quotes_equity_id_fkey" FOREIGN KEY ("equity_id") REFERENCES "sector_equities"("id") ON DELETE CASCADE ON UPDATE CASCADE;
