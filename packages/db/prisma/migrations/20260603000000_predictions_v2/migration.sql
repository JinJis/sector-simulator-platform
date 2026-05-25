-- CreateTable
CREATE TABLE "predictions_v2" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "equity_id" TEXT NOT NULL,
    "horizon" TEXT NOT NULL,
    "expected_price_min" DOUBLE PRECISION NOT NULL,
    "expected_price_max" DOUBLE PRECISION NOT NULL,
    "anchor_price" DOUBLE PRECISION NOT NULL,
    "anchor_date" TIMESTAMP(3) NOT NULL,
    "tier" TEXT NOT NULL,
    "tier_explanation" TEXT,
    "placed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolves_at" TIMESTAMP(3) NOT NULL,
    "resolved_at" TIMESTAMP(3),
    "actual_price" DOUBLE PRECISION,
    "score" DOUBLE PRECISION,
    "reward_points" INTEGER,
    "status" TEXT NOT NULL DEFAULT 'open',
    "rationale" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "predictions_v2_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "predictions_v2_user_id_placed_at_idx" ON "predictions_v2"("user_id", "placed_at" DESC);

-- CreateIndex
CREATE INDEX "predictions_v2_status_resolves_at_idx" ON "predictions_v2"("status", "resolves_at");

-- CreateIndex
CREATE INDEX "predictions_v2_equity_id_placed_at_idx" ON "predictions_v2"("equity_id", "placed_at" DESC);

-- CreateIndex
CREATE INDEX "predictions_v2_status_reward_points_idx" ON "predictions_v2"("status", "reward_points" DESC);

-- AddForeignKey
ALTER TABLE "predictions_v2" ADD CONSTRAINT "predictions_v2_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "predictions_v2" ADD CONSTRAINT "predictions_v2_equity_id_fkey" FOREIGN KEY ("equity_id") REFERENCES "sector_equities"("id") ON DELETE CASCADE ON UPDATE CASCADE;
