-- CreateTable
CREATE TABLE "economics_datapoints" (
    "id" TEXT NOT NULL,
    "sector_slug" TEXT NOT NULL,
    "metric_key" TEXT NOT NULL,
    "value" DECIMAL(20,6) NOT NULL,
    "unit" TEXT NOT NULL,
    "as_of" TIMESTAMP(3) NOT NULL,
    "source_url" TEXT NOT NULL,
    "source_kind" TEXT NOT NULL,
    "confidence" DECIMAL(3,2) NOT NULL,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "economics_datapoints_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "economics_datapoints_sector_slug_metric_key_as_of_idx" ON "economics_datapoints"("sector_slug", "metric_key", "as_of" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "economics_datapoints_sector_slug_metric_key_as_of_key" ON "economics_datapoints"("sector_slug", "metric_key", "as_of");

-- AddForeignKey
ALTER TABLE "economics_datapoints" ADD CONSTRAINT "economics_datapoints_sector_slug_fkey" FOREIGN KEY ("sector_slug") REFERENCES "sectors"("slug") ON DELETE CASCADE ON UPDATE CASCADE;
