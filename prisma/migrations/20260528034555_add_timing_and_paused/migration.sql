-- AlterTable
ALTER TABLE "campaign_states" ADD COLUMN     "is_paused" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "respect_timing" BOOLEAN NOT NULL DEFAULT false;
