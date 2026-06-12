import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";

const harvestedJobSchema = z.object({
  jobId: z.string().trim().min(1),
  title: z.string().trim().min(1),
  companyName: z.string().trim().min(1),
  location: z.string().trim().min(1),
  workplaceType: z.string().trim().optional(),
  jobLink: z.string().url().optional(),
  screenedOut: z.boolean().optional(),
  screenOutReason: z.string().optional()
});

const harvestPayloadSchema = z.array(harvestedJobSchema);

export async function registerJobSearchRoutes(app: FastifyInstance) {
  app.post("/job-search/harvest-jobs", async (request, reply) => {
    const parsed = harvestPayloadSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        success: false,
        message: "Invalid jobs payload validation failed."
      });
    }

    const { cleanCompanyName, normalizeCompanyName } = await import("../modules/companyNormalizer.js");
    let addedJobsCount = 0;
    let addedCompaniesCount = 0;

    for (const job of parsed.data) {
      try {
        const cleanedCompanyBrand = cleanCompanyName(job.companyName);
        const normalizedCompanyName = normalizeCompanyName(job.companyName);

        // 1. Check if company exists, if not, create it
        let company = await prisma.company.findUnique({
          where: { normalizedName: normalizedCompanyName }
        });

        if (!company) {
          company = await prisma.company.create({
            data: {
              name: cleanedCompanyBrand,
              normalizedName: normalizedCompanyName
            }
          });
          addedCompaniesCount++;

          // Trigger company-specific Gemini value-add research asynchronously in the background
          (async () => {
            try {
              const { syncCompanyResearch } = await import("../services/candidateService.js");
              await syncCompanyResearch(company.id, company.name, undefined);
            } catch (err: any) {
              console.error(`⚠️ Failed to sync company research asynchronously:`, err.message || err);
            }
          })();
        }

        // 2. Check if job application already exists in job tracker
        const existingApp = await prisma.application.findFirst({
          where: {
            OR: [
              { jobId: job.jobId },
              { jobLink: job.jobLink || undefined }
            ]
          }
        });

        if (!existingApp) {
          await prisma.application.create({
            data: {
              companyName: cleanedCompanyBrand,
              role: job.title,
              jobLink: job.jobLink || null,
              jobId: job.jobId,
              status: job.screenedOut ? "Screen out" : "Not Applied",
              screenOutReason: job.screenedOut ? (job.screenOutReason || "Filtered out by auto-screen") : null
            }
          });
          addedJobsCount++;
        }
      } catch (err: any) {
        console.error(`❌ Failed to process harvested job "${job.title}" at "${job.companyName}":`, err.message || err);
      }
    }

    return {
      success: true,
      addedJobsCount,
      addedCompaniesCount
    };
  });
}
