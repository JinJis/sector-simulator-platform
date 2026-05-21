-- M25a: pricing tier on users + authorship on sectors.

ALTER TABLE "users" ADD COLUMN "tier" TEXT NOT NULL DEFAULT 'free';

ALTER TABLE "sectors" ADD COLUMN "created_by_user_id" TEXT;

CREATE INDEX "sectors_created_by_user_id_idx"
    ON "sectors"("created_by_user_id");

ALTER TABLE "sectors" ADD CONSTRAINT "sectors_created_by_user_id_fkey"
    FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
