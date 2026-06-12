import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { generateCandidates } from "../services/candidateService.js";
import { prisma } from "../lib/prisma.js";

const generateCandidatesSchema = z.object({
  fullName: z.string().trim().min(1, "Full name is required."),
  companyName: z.string().trim().min(1, "Company name is required."),
  domain: z.string().trim().min(1).optional(),
  linkedinUrl: z.string().url("Please enter a valid LinkedIn URL.").optional(),
  headline: z.string().trim().optional(),
  source: z.string().trim().optional()
});

export async function registerLeadRoutes(app: FastifyInstance) {
  app.post("/leads/generate-candidates", async (request, reply) => {
    const parsed = generateCandidatesSchema.safeParse(request.body);

    if (!parsed.success) {
      const messages = parsed.error.issues.map(issue => issue.message).join(" ");
      return reply.status(400).send({
        success: false,
        message: messages || "Validation failed."
      });
    }

    const result = await generateCandidates(parsed.data);
    return reply.status(201).send(result);
  });

  // ── CSV Preview (dry-run duplicate check, no DB writes) ──────────────────
  app.post("/leads/csv-preview", async (request, reply) => {
    const csvRowSchema = z.object({
      firstName: z.string().trim().min(1, "First name is required."),
      lastName: z.string().trim().optional().nullable(),
      email: z.string().trim().email("Invalid email."),
      company: z.string().trim().min(1, "Company name is required.")
    });

    const parsed = z.array(csvRowSchema).safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ success: false, message: "Invalid rows payload." });
    }

    const rows = parsed.data;
    const seenEmails = new Map<string, number>(); // email → first seen row index
    const results: Array<{
      firstName: string;
      lastName: string | null;
      email: string;
      company: string;
      status: "new" | "duplicate_csv" | "duplicate_db";
      duplicateOf?: string;
    }> = [];

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const email = row.email.toLowerCase().trim();

      // Check within-CSV duplicate
      if (seenEmails.has(email)) {
        results.push({
          ...row,
          lastName: row.lastName || null,
          email,
          status: "duplicate_csv",
          duplicateOf: `Row ${seenEmails.get(email)! + 2}` // +2 for header + 1-indexed
        });
        continue;
      }
      seenEmails.set(email, i);

      // Check DB duplicate
      const existing = await prisma.emailCandidate.findFirst({
        where: { email },
        include: { lead: true }
      });

      if (existing) {
        results.push({
          ...row,
          lastName: row.lastName || null,
          email,
          status: "duplicate_db",
          duplicateOf: existing.lead.fullName
        });
      } else {
        results.push({
          ...row,
          lastName: row.lastName || null,
          email,
          status: "new"
        });
      }
    }

    return { success: true, rows: results };
  });

  // ── Bulk CSV Import (actual write) ────────────────────────────────────────
  app.post("/leads/bulk-csv", async (request, reply) => {
    const csvRowSchema = z.object({
      firstName: z.string().trim().min(1, "First name is required."),
      lastName: z.string().trim().optional().nullable(),
      email: z.string().trim().email("Please enter a valid email address."),
      company: z.string().trim().min(1, "Company name is required."),
      preVerified: z.boolean().optional()
    });

    const parsed = z.array(csvRowSchema).safeParse(request.body);
    if (!parsed.success) {
      const isBulk = parsed.error.issues.some(iss => typeof iss.path[0] === "number" && (iss.path[0] as number) > 0);
      const messages = parsed.error.issues
        .map(issue => {
          const rowNum = (typeof issue.path[0] === "number" && isBulk) ? `Row ${issue.path[0] + 1}: ` : "";
          return `${rowNum}${issue.message}`;
        })
        .join(" ");

      return reply.status(400).send({
        success: false,
        message: messages || "Validation failed."
      });
    }

    const { cleanCompanyName, normalizeCompanyName } = await import("../modules/companyNormalizer.js");
    let count = 0;
    const errors: string[] = [];
    
    for (const row of parsed.data) {
      try {
        const candidateEmail = row.email.toLowerCase().trim();

        // Validate email-level uniqueness across the entire system
        const globalCandidate = await prisma.emailCandidate.findFirst({
          where: { email: candidateEmail },
          include: { lead: true }
        });

        if (globalCandidate) {
          throw new Error(`Email '${candidateEmail}' is already in use by lead '${globalCandidate.lead.fullName}'.`);
        }

        const cleanedCompanyBrand = cleanCompanyName(row.company);
        const normalizedCompanyName = normalizeCompanyName(row.company);
        const domain = row.email.split("@")[1]?.toLowerCase().trim() || "";

        // Sync Company
        const company = await prisma.company.upsert({
          where: { normalizedName: normalizedCompanyName },
          update: {
            name: cleanedCompanyBrand
          },
          create: {
            name: cleanedCompanyBrand,
            normalizedName: normalizedCompanyName,
            domain
          }
        });

        // Trigger company-specific Gemini value-add research asynchronously in the background
        (async () => {
          try {
            const { syncCompanyResearch } = await import("../services/candidateService.js");
            await syncCompanyResearch(company.id, company.name, company.domain || undefined);
          } catch (err: any) {
            console.error(`⚠️ Failed to sync company research asynchronously:`, err.message || err);
          }
        })();

        const fullName = `${row.firstName} ${row.lastName || ""}`.trim();

        // Check if lead already exists
        let lead = await prisma.lead.findFirst({
          where: {
            fullName,
            companyId: company.id
          }
        });

        if (!lead) {
          lead = await prisma.lead.create({
            data: {
              fullName,
              firstName: row.firstName,
              lastName: row.lastName || null,
              companyId: company.id,
              source: "csv"
            }
          });
        }

        // Ensure direct_email algo is seeded
        let directAlgo = await prisma.emailAlgorithm.findUnique({
          where: { key: "direct_email" }
        });
        if (!directAlgo) {
          directAlgo = await prisma.emailAlgorithm.create({
            data: {
              key: "direct_email",
              patternTemplate: "{csv_direct}@{domain}",
              description: "Direct email from CSV",
              example: "john@example.com"
            }
          });
        }

        // Link algorithm to company
        await prisma.companyEmailAlgorithm.upsert({
          where: {
            companyId_algorithmId: {
              companyId: company.id,
              algorithmId: directAlgo.id
            }
          },
          update: {},
          create: {
            companyId: company.id,
            algorithmId: directAlgo.id,
            confidenceScore: 100
          }
        });

        // Sync direct candidate since uniqueness is validated
        await prisma.emailCandidate.create({
          data: {
            leadId: lead.id,
            companyId: company.id,
            algorithmId: directAlgo.id,
            email: candidateEmail,
            syntaxValid: true,
            mxValid: true,
            verifierStatus: row.preVerified ? "pre_verified" : "verified",
            verifierScore: 100,
            isCatchAll: false,
            selected: true
          }
        });

        count++;
      } catch (err: any) {
        console.error(`❌ Failed to process CSV row for "${row.firstName}":`, err.message || err);
        errors.push(`${row.firstName}: ${err.message || "Unknown error"}`);
      }
    }

    if (errors.length > 0) {
      if (parsed.data.length === 1) {
        return reply.status(400).send({
          success: false,
          message: errors.join(" ")
        });
      }
      return reply.status(400).send({
        success: false,
        message: `Processed ${count} rows. Errors: ${errors.join(" | ")}`,
        count
      });
    }

    return { success: true, count };
  });

  // ── Extension Lead Sync Endpoint ──────────────────────────────────────────
  const extensionImportSchema = z.object({
    fullName: z.string().trim().min(1, "Full name is required."),
    email: z.string().trim().email("Please enter a valid email address."),
    companyName: z.string().trim().min(1, "Company name is required."),
    headline: z.string().trim().optional().nullable(),
    linkedinUrl: z.string().url("Please enter a valid LinkedIn URL.").optional().nullable(),
    status: z.string().trim().optional().nullable(),
    skipBounceMonitor: z.boolean().optional().nullable(),
    tags: z.array(z.string()).optional()
  });

  app.post("/leads/extension-import", async (request, reply) => {
    const parsed = extensionImportSchema.safeParse(request.body);
    if (!parsed.success) {
      const messages = parsed.error.issues.map(issue => issue.message).join(" ");
      return reply.status(400).send({
        success: false,
        message: messages || "Validation failed."
      });
    }

    try {
      const data = parsed.data;
      const { cleanCompanyName, normalizeCompanyName } = await import("../modules/companyNormalizer.js");
      const cleanedCompanyBrand = cleanCompanyName(data.companyName);
      const normalizedCompanyName = normalizeCompanyName(data.companyName);
      const domain = data.email.split("@")[1]?.toLowerCase().trim() || "";

      // Upsert Company
      const company = await prisma.company.upsert({
        where: { normalizedName: normalizedCompanyName },
        update: {
          name: cleanedCompanyBrand
        },
        create: {
          name: cleanedCompanyBrand,
          normalizedName: normalizedCompanyName,
          domain
        }
      });

      // Split full name into first and last name
      const nameParts = data.fullName.trim().split(/\s+/);
      const firstName = nameParts[0] || "Unknown";
      const lastName = nameParts.length > 1 ? nameParts.slice(1).join(" ") : null;

      // Check if lead already exists
      let lead = await prisma.lead.findFirst({
        where: {
          fullName: data.fullName,
          companyId: company.id
        }
      });

      if (!lead) {
        lead = await prisma.lead.create({
          data: {
            fullName: data.fullName,
            firstName,
            lastName,
            companyId: company.id,
            linkedinUrl: data.linkedinUrl || null,
            headline: data.headline || null,
            source: "extension",
            tags: data.tags || []
          }
        });
      } else {
        // Update linkedinUrl and headline if they were missing, and tags if provided
        const updateData: Record<string, any> = {};
        if (!lead.linkedinUrl && data.linkedinUrl) updateData.linkedinUrl = data.linkedinUrl;
        if (!lead.headline && data.headline) updateData.headline = data.headline;
        if (data.tags) updateData.tags = data.tags;
        if (Object.keys(updateData).length > 0) {
          lead = await prisma.lead.update({
            where: { id: lead.id },
            data: updateData
          });
        }
      }

      // Ensure direct_email algorithm is seeded
      let directAlgo = await prisma.emailAlgorithm.findUnique({
        where: { key: "direct_email" }
      });
      if (!directAlgo) {
        directAlgo = await prisma.emailAlgorithm.create({
          data: {
            key: "direct_email",
            patternTemplate: "{csv_direct}@{domain}",
            description: "Direct email from CSV",
            example: "john@example.com"
          }
        });
      }

      // Link algorithm to company
      await prisma.companyEmailAlgorithm.upsert({
        where: {
          companyId_algorithmId: {
            companyId: company.id,
            algorithmId: directAlgo.id
          }
        },
        update: {},
        create: {
          companyId: company.id,
          algorithmId: directAlgo.id,
          confidenceScore: 100
        }
      });

      const candidateEmail = data.email.toLowerCase().trim();

      // Upsert Email Candidate
      const existingCandidate = await prisma.emailCandidate.findUnique({
        where: {
          leadId_email: {
            leadId: lead.id,
            email: candidateEmail
          }
        }
      });

      let candidateId: string;
      if (!existingCandidate) {
        const candidate = await prisma.emailCandidate.create({
          data: {
            leadId: lead.id,
            companyId: company.id,
            algorithmId: directAlgo.id,
            email: candidateEmail,
            syntaxValid: true,
            mxValid: true,
            verifierStatus: data.status === "verified" || !data.status ? "pre_verified" : data.status,
            verifierScore: 100,
            selected: true
          }
        });
        candidateId = candidate.id;
      } else {
        candidateId = existingCandidate.id;
        await prisma.emailCandidate.update({
          where: { id: candidateId },
          data: {
            selected: true,
            verifierStatus: data.status === "verified" || !data.status ? "pre_verified" : data.status
          }
        });
      }

      return reply.status(201).send({ success: true, leadId: lead.id });
    } catch (err: any) {
      console.error("Failed to import lead from extension:", err.message || err);
      return reply.status(500).send({
        success: false,
        message: err.message || "Failed to import lead."
      });
    }
  });
}
