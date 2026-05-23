-- M36 — Vision Feasibility Monitor domain.
--
-- Adds 6 new tables (capabilities, capability_scores, capability_dependencies,
-- signals, risks, vision_feasibility) and 2 columns on sectors
-- (vision_question, is_vision_eligible). All additive — no destructive
-- changes. Existing equity / prediction / community schema is untouched
-- but logically deprecated (see docs/PIVOT.md §1.5 + docs/REFACTOR.md §7.1).
--
-- See docs/PIVOT.md for product framing and docs/REFACTOR.md §7 for the
-- per-model disposition.

-- ---------------------------------------------------------------------
-- sectors: add Vision-product framing fields
-- ---------------------------------------------------------------------

ALTER TABLE "sectors"
  ADD COLUMN "vision_question"   TEXT,
  ADD COLUMN "is_vision_eligible" BOOLEAN NOT NULL DEFAULT true;

CREATE INDEX "sectors_is_vision_eligible_idx" ON "sectors"("is_vision_eligible");

-- ---------------------------------------------------------------------
-- capabilities: required tech / econ / regulatory / supply capability
-- ---------------------------------------------------------------------

CREATE TABLE "capabilities" (
  "id"            TEXT NOT NULL,
  "sector_slug"   TEXT NOT NULL,
  "key"           TEXT NOT NULL,
  "name"          TEXT NOT NULL,
  "short_name"    TEXT,
  "description"   TEXT NOT NULL,
  "rationale"     TEXT NOT NULL,
  "display_order" INTEGER NOT NULL DEFAULT 100,
  "weight"        DOUBLE PRECISION NOT NULL DEFAULT 0.1,
  "primary_driver_name" TEXT,
  "created_at"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"    TIMESTAMP(3) NOT NULL,
  CONSTRAINT "capabilities_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "capabilities_sector_slug_key_key" ON "capabilities"("sector_slug", "key");
CREATE INDEX "capabilities_sector_slug_idx" ON "capabilities"("sector_slug");
CREATE INDEX "capabilities_sector_slug_display_order_idx" ON "capabilities"("sector_slug", "display_order");

ALTER TABLE "capabilities"
  ADD CONSTRAINT "capabilities_sector_slug_fkey"
  FOREIGN KEY ("sector_slug") REFERENCES "sectors"("slug")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- ---------------------------------------------------------------------
-- capability_scores: 4-dim score time series per capability
-- ---------------------------------------------------------------------

CREATE TABLE "capability_scores" (
  "id"            TEXT NOT NULL,
  "capability_id" TEXT NOT NULL,
  "technical"     DOUBLE PRECISION,
  "economic"      DOUBLE PRECISION,
  "regulatory"    DOUBLE PRECISION,
  "supply"        DOUBLE PRECISION,
  "composite"     DOUBLE PRECISION,
  "composite_p10" DOUBLE PRECISION,
  "composite_p90" DOUBLE PRECISION,
  "as_of"         TIMESTAMP(3) NOT NULL,
  "is_current"    BOOLEAN NOT NULL DEFAULT false,
  "rationale"     TEXT,
  "created_at"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "capability_scores_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "capability_scores_capability_id_as_of_idx" ON "capability_scores"("capability_id", "as_of" DESC);
CREATE INDEX "capability_scores_capability_id_is_current_idx" ON "capability_scores"("capability_id", "is_current");

ALTER TABLE "capability_scores"
  ADD CONSTRAINT "capability_scores_capability_id_fkey"
  FOREIGN KEY ("capability_id") REFERENCES "capabilities"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- ---------------------------------------------------------------------
-- capability_dependencies: DAG between capabilities
-- ---------------------------------------------------------------------

CREATE TABLE "capability_dependencies" (
  "id"         TEXT NOT NULL,
  "source_id"  TEXT NOT NULL,
  "target_id"  TEXT NOT NULL,
  "rationale"  TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "capability_dependencies_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "capability_dependencies_source_id_target_id_key" ON "capability_dependencies"("source_id", "target_id");
CREATE INDEX "capability_dependencies_target_id_idx" ON "capability_dependencies"("target_id");

ALTER TABLE "capability_dependencies"
  ADD CONSTRAINT "capability_dependencies_source_id_fkey"
  FOREIGN KEY ("source_id") REFERENCES "capabilities"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "capability_dependencies"
  ADD CONSTRAINT "capability_dependencies_target_id_fkey"
  FOREIGN KEY ("target_id") REFERENCES "capabilities"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- ---------------------------------------------------------------------
-- signals: source-grounded events scored per dimension
-- ---------------------------------------------------------------------

CREATE TABLE "signals" (
  "id"              TEXT NOT NULL,
  "sector_slug"     TEXT NOT NULL,
  "capability_id"   TEXT,
  "source_kind"     TEXT NOT NULL,
  "source_url"      TEXT NOT NULL,
  "source_id_ext"   TEXT,
  "title"           TEXT NOT NULL,
  "summary"         TEXT,
  "published_at"    TIMESTAMP(3) NOT NULL,
  "delta_technical"  DOUBLE PRECISION,
  "delta_economic"   DOUBLE PRECISION,
  "delta_regulatory" DOUBLE PRECISION,
  "delta_supply"     DOUBLE PRECISION,
  "is_highlight"    BOOLEAN NOT NULL DEFAULT false,
  "ingested_at"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "signals_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "signals_source_url_capability_id_key" ON "signals"("source_url", "capability_id");
CREATE INDEX "signals_sector_slug_published_at_idx" ON "signals"("sector_slug", "published_at" DESC);
CREATE INDEX "signals_capability_id_published_at_idx" ON "signals"("capability_id", "published_at" DESC);
CREATE INDEX "signals_sector_slug_is_highlight_published_at_idx" ON "signals"("sector_slug", "is_highlight", "published_at" DESC);

ALTER TABLE "signals"
  ADD CONSTRAINT "signals_sector_slug_fkey"
  FOREIGN KEY ("sector_slug") REFERENCES "sectors"("slug")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "signals"
  ADD CONSTRAINT "signals_capability_id_fkey"
  FOREIGN KEY ("capability_id") REFERENCES "capabilities"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- ---------------------------------------------------------------------
-- risks: political / legal / supply / safety / etc. risks
-- ---------------------------------------------------------------------

CREATE TABLE "risks" (
  "id"            TEXT NOT NULL,
  "sector_slug"   TEXT NOT NULL,
  "key"           TEXT NOT NULL,
  "category"      TEXT NOT NULL,
  "name"          TEXT NOT NULL,
  "description"   TEXT NOT NULL,
  "severity"      TEXT NOT NULL,
  "likelihood"    TEXT NOT NULL,
  "time_horizon"  TEXT NOT NULL,
  "mitigations"   TEXT,
  "affected_capability_keys" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "display_order" INTEGER NOT NULL DEFAULT 100,
  "created_at"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"    TIMESTAMP(3) NOT NULL,
  CONSTRAINT "risks_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "risks_sector_slug_key_key" ON "risks"("sector_slug", "key");
CREATE INDEX "risks_sector_slug_idx" ON "risks"("sector_slug");
CREATE INDEX "risks_sector_slug_severity_idx" ON "risks"("sector_slug", "severity");

ALTER TABLE "risks"
  ADD CONSTRAINT "risks_sector_slug_fkey"
  FOREIGN KEY ("sector_slug") REFERENCES "sectors"("slug")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- ---------------------------------------------------------------------
-- vision_feasibility: vision-level composite snapshot time series
-- ---------------------------------------------------------------------

CREATE TABLE "vision_feasibility" (
  "id"                     TEXT NOT NULL,
  "sector_slug"            TEXT NOT NULL,
  "as_of"                  TIMESTAMP(3) NOT NULL,
  "is_current"             BOOLEAN NOT NULL DEFAULT false,
  "composite"              DOUBLE PRECISION NOT NULL,
  "composite_p10"          DOUBLE PRECISION,
  "composite_p90"          DOUBLE PRECISION,
  "binding_capability_key" TEXT,
  "eta_median_years"       DOUBLE PRECISION,
  "eta_p10_years"          DOUBLE PRECISION,
  "eta_p90_years"          DOUBLE PRECISION,
  "delta_90d"              DOUBLE PRECISION,
  "rationale"              TEXT,
  "created_at"             TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "vision_feasibility_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "vision_feasibility_sector_slug_as_of_idx" ON "vision_feasibility"("sector_slug", "as_of" DESC);
CREATE INDEX "vision_feasibility_sector_slug_is_current_idx" ON "vision_feasibility"("sector_slug", "is_current");

ALTER TABLE "vision_feasibility"
  ADD CONSTRAINT "vision_feasibility_sector_slug_fkey"
  FOREIGN KEY ("sector_slug") REFERENCES "sectors"("slug")
  ON DELETE CASCADE ON UPDATE CASCADE;
