-- CreateTable
CREATE TABLE "campaign_states" (
    "id" TEXT NOT NULL,
    "lead_id" TEXT NOT NULL,
    "candidate_id" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "job_link" TEXT,
    "job_id" TEXT,
    "resume_path" TEXT,
    "resume_name" TEXT,
    "scheduled_for" TIMESTAMP(3),
    "last_sent_at" TIMESTAMP(3),
    "followup_count" INTEGER NOT NULL DEFAULT 0,
    "subject" TEXT,
    "body" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "campaign_states_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "campaign_states_lead_id_key" ON "campaign_states"("lead_id");

-- AddForeignKey
ALTER TABLE "campaign_states" ADD CONSTRAINT "campaign_states_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "leads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaign_states" ADD CONSTRAINT "campaign_states_candidate_id_fkey" FOREIGN KEY ("candidate_id") REFERENCES "email_candidates"("id") ON DELETE CASCADE ON UPDATE CASCADE;
