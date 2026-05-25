-- CreateTable
CREATE TABLE "crawl_runs" (
    "id" TEXT NOT NULL,
    "vision_slug" TEXT NOT NULL,
    "fetcher_kind" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "plan" JSONB NOT NULL,
    "result_summary" JSONB,
    "cost_usd" DECIMAL(10,4),
    "signals_written" INTEGER NOT NULL DEFAULT 0,
    "proposals_written" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ended_at" TIMESTAMP(3),

    CONSTRAINT "crawl_runs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "crawl_runs_vision_slug_started_at_idx" ON "crawl_runs"("vision_slug", "started_at" DESC);

-- CreateIndex
CREATE INDEX "crawl_runs_fetcher_kind_started_at_idx" ON "crawl_runs"("fetcher_kind", "started_at" DESC);

-- CreateIndex
CREATE INDEX "crawl_runs_status_started_at_idx" ON "crawl_runs"("status", "started_at" DESC);
