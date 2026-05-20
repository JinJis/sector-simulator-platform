-- CreateTable
CREATE TABLE "sectors" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "source_module" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sectors_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "scenarios" (
    "id" TEXT NOT NULL,
    "sector_slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "notes" TEXT,
    "driver_overrides" JSONB NOT NULL,
    "author_label" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "scenarios_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "sectors_slug_key" ON "sectors"("slug");

-- CreateIndex
CREATE INDEX "scenarios_sector_slug_idx" ON "scenarios"("sector_slug");

-- AddForeignKey
ALTER TABLE "scenarios" ADD CONSTRAINT "scenarios_sector_slug_fkey" FOREIGN KEY ("sector_slug") REFERENCES "sectors"("slug") ON DELETE CASCADE ON UPDATE CASCADE;
