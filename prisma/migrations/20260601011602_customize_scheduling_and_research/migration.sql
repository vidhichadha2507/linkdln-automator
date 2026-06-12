/*
  Warnings:

  - You are about to drop the column `followup_interval_hours` on the `campaign_states` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "campaign_states" DROP COLUMN "followup_interval_hours",
ADD COLUMN     "followup_interval_minutes" INTEGER NOT NULL DEFAULT 70,
ADD COLUMN     "max_followups" INTEGER NOT NULL DEFAULT 3;

-- AlterTable
ALTER TABLE "companies" ADD COLUMN     "research_reason" TEXT;
