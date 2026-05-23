-- M45a — Actor domain.
--
-- Adds 3 new tables (actors, vision_actors, capability_actors) + adds
-- actor_id FK column on signals. All additive — no destructive changes.
--
-- See docs/PIVOT.md §5.1 + §11.5 for why we add a fresh Actor model
-- rather than repurposing the deprecated SectorEquity table.

-- ---------------------------------------------------------------------
-- actors — global company/lab/govt entities
-- ---------------------------------------------------------------------

CREATE TABLE "actors" (
  "id"              TEXT NOT NULL,
  "key"             TEXT NOT NULL,
  "name"            TEXT NOT NULL,
  "short_name"      TEXT,
  "name_local"      TEXT,
  "iso_country"     TEXT NOT NULL,
  "category"        TEXT NOT NULL,
  "ticker"          TEXT,
  "exchange"        TEXT,
  "blurb"           TEXT NOT NULL,
  "description"     TEXT,
  "stage"           TEXT NOT NULL,
  "logo_url"        TEXT,
  "website"         TEXT,
  "signal_keywords" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "created_at"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"      TIMESTAMP(3) NOT NULL,
  CONSTRAINT "actors_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "actors_key_key" ON "actors"("key");
CREATE INDEX "actors_category_idx" ON "actors"("category");
CREATE INDEX "actors_iso_country_idx" ON "actors"("iso_country");

-- ---------------------------------------------------------------------
-- vision_actors — many-to-many between Sector (Vision) and Actor
-- ---------------------------------------------------------------------

CREATE TABLE "vision_actors" (
  "id"            TEXT NOT NULL,
  "actor_id"      TEXT NOT NULL,
  "sector_slug"   TEXT NOT NULL,
  "relevance"     DOUBLE PRECISION,
  "rationale"     TEXT,
  "display_order" INTEGER NOT NULL DEFAULT 100,
  "created_at"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"    TIMESTAMP(3) NOT NULL,
  CONSTRAINT "vision_actors_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "vision_actors_actor_id_sector_slug_key" ON "vision_actors"("actor_id", "sector_slug");
CREATE INDEX "vision_actors_sector_slug_idx" ON "vision_actors"("sector_slug");
CREATE INDEX "vision_actors_sector_slug_relevance_idx" ON "vision_actors"("sector_slug", "relevance" DESC);

ALTER TABLE "vision_actors"
  ADD CONSTRAINT "vision_actors_actor_id_fkey"
  FOREIGN KEY ("actor_id") REFERENCES "actors"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "vision_actors"
  ADD CONSTRAINT "vision_actors_sector_slug_fkey"
  FOREIGN KEY ("sector_slug") REFERENCES "sectors"("slug")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- ---------------------------------------------------------------------
-- capability_actors — per-Capability actor wiring with role
-- ---------------------------------------------------------------------

CREATE TABLE "capability_actors" (
  "id"            TEXT NOT NULL,
  "capability_id" TEXT NOT NULL,
  "actor_id"      TEXT NOT NULL,
  "role"          TEXT NOT NULL DEFAULT 'competitor',
  "stage"         TEXT,
  "rationale"     TEXT,
  "created_at"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"    TIMESTAMP(3) NOT NULL,
  CONSTRAINT "capability_actors_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "capability_actors_capability_id_actor_id_key" ON "capability_actors"("capability_id", "actor_id");
CREATE INDEX "capability_actors_capability_id_idx" ON "capability_actors"("capability_id");
CREATE INDEX "capability_actors_capability_id_role_idx" ON "capability_actors"("capability_id", "role");

ALTER TABLE "capability_actors"
  ADD CONSTRAINT "capability_actors_capability_id_fkey"
  FOREIGN KEY ("capability_id") REFERENCES "capabilities"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "capability_actors"
  ADD CONSTRAINT "capability_actors_actor_id_fkey"
  FOREIGN KEY ("actor_id") REFERENCES "actors"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- ---------------------------------------------------------------------
-- signals.actor_id — extractor-tagged actor mention
-- ---------------------------------------------------------------------

ALTER TABLE "signals" ADD COLUMN "actor_id" TEXT;

CREATE INDEX "signals_actor_id_published_at_idx" ON "signals"("actor_id", "published_at" DESC);

ALTER TABLE "signals"
  ADD CONSTRAINT "signals_actor_id_fkey"
  FOREIGN KEY ("actor_id") REFERENCES "actors"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
