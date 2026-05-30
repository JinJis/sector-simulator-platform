-- CreateTable
CREATE TABLE "job_configs" (
    "key" VARCHAR(128) NOT NULL,
    "value" VARCHAR(2048) NOT NULL,
    "kind" VARCHAR(32) NOT NULL,
    "group" VARCHAR(64) NOT NULL,
    "description" VARCHAR(512),
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" VARCHAR(128),

    CONSTRAINT "job_configs_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE INDEX "job_configs_group_idx" ON "job_configs"("group");
