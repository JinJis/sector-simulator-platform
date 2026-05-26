-- Drop the v1 stock-prediction game tables.
--
-- Lineage: introduced M32 as the community-prediction surface. Pivoted
-- away from with M36 (Vision Feasibility Monitor); PredictionV2 (M46b,
-- `predictions_v2` table) is the live successor with auto-tiered scoring
-- + the new resolver (data_pipeline/jobs/resolve_predictions_v2.py).
--
-- Resolver cron + Python writer were deleted in the data-pipeline merger
-- (commit 4/6, 2026-05-26): `resolve_predictions.py`, `prediction_repo.py`,
-- + the `/jobs/resolve-predictions` endpoint and `resolve_predictions_daily`
-- APScheduler arming are gone. No live callers grep-clean across the
-- TypeScript + Python tree; this migration finally drops the tables that
-- the deleted code wrote into.
--
-- Dependency order: prediction_results → predictions (FK), then
-- user_scores (FK only to users, no cross-prediction dep). CASCADE on
-- DROP TABLE handles the indexes Prisma generated alongside.

DROP TABLE "prediction_results";
DROP TABLE "predictions";
DROP TABLE "user_scores";
