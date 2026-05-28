-- CreateTable
CREATE TABLE "investment_theses" (
    "id" TEXT NOT NULL,
    "sector_slug" TEXT NOT NULL,
    "the_bet" TEXT NOT NULL,
    "bull_case" JSONB NOT NULL,
    "bear_case" JSONB NOT NULL,
    "conviction" TEXT NOT NULL,
    "last_reviewed" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "investment_theses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "catalysts" (
    "id" TEXT NOT NULL,
    "sector_slug" TEXT NOT NULL,
    "expected_at" TIMESTAMPTZ(3) NOT NULL,
    "label" TEXT NOT NULL,
    "capability_key" TEXT,
    "side" TEXT NOT NULL,
    "source_url" TEXT,
    "note" TEXT,
    "sources" JSONB,
    "display_order" INTEGER NOT NULL DEFAULT 100,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "catalysts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "investment_theses_sector_slug_key" ON "investment_theses"("sector_slug");

-- CreateIndex
CREATE INDEX "catalysts_sector_slug_expected_at_idx" ON "catalysts"("sector_slug", "expected_at");

-- AddForeignKey
ALTER TABLE "investment_theses" ADD CONSTRAINT "investment_theses_sector_slug_fkey" FOREIGN KEY ("sector_slug") REFERENCES "sectors"("slug") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "catalysts" ADD CONSTRAINT "catalysts_sector_slug_fkey" FOREIGN KEY ("sector_slug") REFERENCES "sectors"("slug") ON DELETE CASCADE ON UPDATE CASCADE;
