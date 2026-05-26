/*
  Warnings:

  - You are about to drop the `sector_suggestion_votes` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `sector_suggestions` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE "sector_suggestion_votes" DROP CONSTRAINT "sector_suggestion_votes_suggestion_id_fkey";

-- DropForeignKey
ALTER TABLE "sector_suggestion_votes" DROP CONSTRAINT "sector_suggestion_votes_user_id_fkey";

-- DropForeignKey
ALTER TABLE "sector_suggestions" DROP CONSTRAINT "sector_suggestions_user_id_fkey";

-- DropTable
DROP TABLE "sector_suggestion_votes";

-- DropTable
DROP TABLE "sector_suggestions";
