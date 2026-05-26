-- AlterTable
ALTER TABLE "users" ADD COLUMN     "bot_kind" TEXT,
ADD COLUMN     "is_bot" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE INDEX "users_is_bot_idx" ON "users"("is_bot");
