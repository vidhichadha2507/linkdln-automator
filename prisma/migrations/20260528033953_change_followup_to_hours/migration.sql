/*
  Warnings:

  - You are about to drop the column `followup_interval_days` on the `campaign_states` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "campaign_states" DROP COLUMN "followup_interval_days",
ADD COLUMN     "followup_interval_hours" INTEGER NOT NULL DEFAULT 72;
