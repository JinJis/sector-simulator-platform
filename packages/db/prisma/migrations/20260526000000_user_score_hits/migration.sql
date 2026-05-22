-- M33b: track lifetime hit count denormalized on user_scores so the
-- resolver's hit_rate_pct stays internally consistent without having to
-- COUNT(*) prediction_results on every write.

ALTER TABLE "user_scores" ADD COLUMN "hits" INTEGER NOT NULL DEFAULT 0;
