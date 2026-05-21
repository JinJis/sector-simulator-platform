-- CreateTable
CREATE TABLE "sector_equities" (
    "id" TEXT NOT NULL,
    "sector_slug" TEXT NOT NULL,
    "ticker" TEXT NOT NULL,
    "exchange" TEXT NOT NULL,
    "iso_country" TEXT NOT NULL,
    "company_name" TEXT NOT NULL,
    "company_name_local" TEXT,
    "sector_exposure_pct" DOUBLE PRECISION NOT NULL,
    "rationale" TEXT,
    "currency" TEXT,
    "last_close_local" DOUBLE PRECISION,
    "last_close_usd" DOUBLE PRECISION,
    "last_close_date" TIMESTAMP(3),
    "market_cap_usd" DOUBLE PRECISION,
    "driver_links" JSONB NOT NULL DEFAULT '[]',
    "display_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sector_equities_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "sector_equities_sector_slug_ticker_exchange_key" ON "sector_equities"("sector_slug", "ticker", "exchange");

-- CreateIndex
CREATE INDEX "sector_equities_sector_slug_idx" ON "sector_equities"("sector_slug");

-- CreateIndex
CREATE INDEX "sector_equities_iso_country_idx" ON "sector_equities"("iso_country");

-- AddForeignKey
ALTER TABLE "sector_equities" ADD CONSTRAINT "sector_equities_sector_slug_fkey" FOREIGN KEY ("sector_slug") REFERENCES "sectors"("slug") ON DELETE CASCADE ON UPDATE CASCADE;
