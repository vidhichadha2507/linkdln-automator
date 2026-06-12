-- CreateTable
CREATE TABLE "companies" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "normalized_name" TEXT NOT NULL,
    "domain" TEXT,
    "domain_confidence" INTEGER NOT NULL DEFAULT 0,
    "domain_source" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "companies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "email_algorithms" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "pattern_template" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "example" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "email_algorithms_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "company_email_algorithms" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "algorithm_id" TEXT NOT NULL,
    "hit_count" INTEGER NOT NULL DEFAULT 0,
    "miss_count" INTEGER NOT NULL DEFAULT 0,
    "verification_success_count" INTEGER NOT NULL DEFAULT 0,
    "bounce_count" INTEGER NOT NULL DEFAULT 0,
    "confidence_score" INTEGER NOT NULL DEFAULT 20,
    "last_verified_at" TIMESTAMP(3),
    "rank" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "company_email_algorithms_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "leads" (
    "id" TEXT NOT NULL,
    "full_name" TEXT NOT NULL,
    "first_name" TEXT NOT NULL,
    "middle_name" TEXT,
    "last_name" TEXT,
    "company_id" TEXT NOT NULL,
    "linkedin_url" TEXT,
    "headline" TEXT,
    "source" TEXT NOT NULL DEFAULT 'api',
    "status" TEXT NOT NULL DEFAULT 'new',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "leads_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "email_candidates" (
    "id" TEXT NOT NULL,
    "lead_id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "algorithm_id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "syntax_valid" BOOLEAN NOT NULL DEFAULT false,
    "mx_valid" BOOLEAN NOT NULL DEFAULT false,
    "verifier_provider" TEXT,
    "verifier_status" TEXT,
    "verifier_score" INTEGER,
    "is_catch_all" BOOLEAN NOT NULL DEFAULT false,
    "selected" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "email_candidates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "email_events" (
    "id" TEXT NOT NULL,
    "candidate_id" TEXT NOT NULL,
    "event_type" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "raw_payload" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "email_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "suppression_entries" (
    "id" TEXT NOT NULL,
    "email" TEXT,
    "domain" TEXT,
    "reason" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "suppression_entries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "companies_normalized_name_key" ON "companies"("normalized_name");

-- CreateIndex
CREATE UNIQUE INDEX "email_algorithms_key_key" ON "email_algorithms"("key");

-- CreateIndex
CREATE UNIQUE INDEX "email_algorithms_pattern_template_key" ON "email_algorithms"("pattern_template");

-- CreateIndex
CREATE INDEX "company_email_algorithms_company_id_rank_idx" ON "company_email_algorithms"("company_id", "rank");

-- CreateIndex
CREATE UNIQUE INDEX "company_email_algorithms_company_id_algorithm_id_key" ON "company_email_algorithms"("company_id", "algorithm_id");

-- CreateIndex
CREATE INDEX "leads_company_id_idx" ON "leads"("company_id");

-- CreateIndex
CREATE INDEX "email_candidates_company_id_idx" ON "email_candidates"("company_id");

-- CreateIndex
CREATE INDEX "email_candidates_algorithm_id_idx" ON "email_candidates"("algorithm_id");

-- CreateIndex
CREATE UNIQUE INDEX "email_candidates_lead_id_email_key" ON "email_candidates"("lead_id", "email");

-- CreateIndex
CREATE INDEX "email_events_candidate_id_idx" ON "email_events"("candidate_id");

-- CreateIndex
CREATE INDEX "suppression_entries_email_idx" ON "suppression_entries"("email");

-- CreateIndex
CREATE INDEX "suppression_entries_domain_idx" ON "suppression_entries"("domain");

-- AddForeignKey
ALTER TABLE "company_email_algorithms" ADD CONSTRAINT "company_email_algorithms_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "company_email_algorithms" ADD CONSTRAINT "company_email_algorithms_algorithm_id_fkey" FOREIGN KEY ("algorithm_id") REFERENCES "email_algorithms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leads" ADD CONSTRAINT "leads_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "email_candidates" ADD CONSTRAINT "email_candidates_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "leads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "email_candidates" ADD CONSTRAINT "email_candidates_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "email_candidates" ADD CONSTRAINT "email_candidates_algorithm_id_fkey" FOREIGN KEY ("algorithm_id") REFERENCES "email_algorithms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "email_events" ADD CONSTRAINT "email_events_candidate_id_fkey" FOREIGN KEY ("candidate_id") REFERENCES "email_candidates"("id") ON DELETE CASCADE ON UPDATE CASCADE;
