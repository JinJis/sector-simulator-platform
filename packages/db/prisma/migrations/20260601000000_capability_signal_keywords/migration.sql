-- M41 (Vision Builder agent) — store per-capability signal keywords
-- on the capability row so agent-generated visions don't need a
-- cross-service filesystem write. Existing JSON files in
-- services/data-pipeline/.../signals/keywords/<slug>.json remain
-- the override path for admin-curated reference visions.

ALTER TABLE "capabilities"
  ADD COLUMN "signal_keywords" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
