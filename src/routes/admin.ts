import fs from "node:fs";
import path from "node:path";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { pollGmailBounces, simulateGmailBounce, isGmailQuotaHalted, setGmailQuotaHalted } from "../services/gmailService.js";
import { startCampaign, processCampaignQueue, type StartCampaignInput } from "../services/campaignService.js";
import { syncCompanyResearch } from "../services/candidateService.js";
import { createBackupSnapshot, listBackupSnapshots, restoreBackupSnapshot, deleteBackupSnapshot } from "../services/backupService.js";
import { env } from "../config/env.js";
import { parseName } from "../modules/nameParser.js";
import { cleanCompanyName, normalizeCompanyName } from "../modules/companyNormalizer.js";
import { getSystemSetting, getAllSystemSettings, updateSystemSettings } from "../services/settingsService.js";

export async function registerAdminRoutes(app: FastifyInstance) {
  app.get("/admin/default-resume", async (request, reply) => {
    const resumeLink = await getSystemSetting("defaultResumeLink");
    if (resumeLink.includes("localhost") || resumeLink.includes("127.0.0.1") || resumeLink.includes("/Vidhi_chadha_resume.pdf")) {
      const publicDir = path.resolve(process.cwd(), "public");
      const filePath = path.join(publicDir, "Vidhi_chadha_resume.pdf");
      if (fs.existsSync(filePath)) {
        const stream = fs.createReadStream(filePath);
        return reply
          .header("Content-Type", "application/pdf")
          .header("Content-Disposition", 'attachment; filename="Vidhi_chadha_resume.pdf"')
          .send(stream);
      }
    }
    return reply.redirect(resumeLink);
  });

  app.get("/Vidhi_chadha_resume.pdf", async (request, reply) => {
    const publicDir = path.resolve(process.cwd(), "public");
    const filePath = path.join(publicDir, "Vidhi_chadha_resume.pdf");
    if (fs.existsSync(filePath)) {
      const stream = fs.createReadStream(filePath);
      return reply
        .header("Content-Type", "application/pdf")
        .header("Content-Disposition", 'attachment; filename="Vidhi_chadha_resume.pdf"')
        .send(stream);
    }
    return reply.status(404).send({ error: "Resume file not found" });
  });

  app.get("/admin/settings", async () => {
    return getAllSystemSettings();
  });

  app.patch("/admin/settings", async (request, reply) => {
    try {
      const updated = await updateSystemSettings(request.body as any);
      return updated;
    } catch (error) {
      if (error instanceof z.ZodError) {
        return reply.status(400).send({ error: "Invalid settings data", details: error.issues });
      }
      return reply.status(500).send({ error: "Failed to update settings" });
    }
  });


  app.get("/admin/summary", async () => {
    const [
      companyCount,
      leadCount,
      candidateCount,
      eventCount,
      suppressionCount,
      activeCampaignsCount,
      bouncesCount,
      repliesCount
    ] = await Promise.all([
      prisma.company.count(),
      prisma.lead.count(),
      prisma.emailCandidate.count(),
      prisma.emailEvent.count(),
      prisma.suppressionEntry.count(),
      prisma.campaignState.count({
        where: { status: { in: ["scheduled", "sent_initial", "sent_followup_1"] } }
      }),
      prisma.campaignState.count({
        where: { status: "bounced" }
      }),
      prisma.campaignState.count({
        where: { status: "replied" }
      })
    ]);

    const selectedCandidateCount = await prisma.emailCandidate.count({
      where: { selected: true }
    });

    return {
      companyCount,
      leadCount,
      candidateCount,
      selectedCandidateCount,
      eventCount,
      suppressionCount,
      activeCampaignsCount,
      bouncesCount,
      repliesCount
    };
  });

  app.get("/admin/companies", async () => {
    const companies = await prisma.company.findMany({
      orderBy: { updatedAt: "desc" },
      include: {
        _count: {
          select: {
            leads: true,
            candidates: true,
            algorithms: true
          }
        },
        leads: {
          select: {
            id: true,
            campaignState: {
              select: {
                id: true,
                status: true,
                isPaused: true
              }
            }
          }
        }
      }
    });

    return companies.map((company: any) => {
      const startedCampaigns = company.leads.filter((lead: any) => 
        lead.campaignState !== null && 
        lead.campaignState.status !== "completed" && 
        lead.campaignState.status !== "bounced" && 
        lead.campaignState.status !== "replied" &&
        lead.campaignState.status !== "cancelled"
      );
      const startedCampaignCount = startedCampaigns.length;
      const pausedCampaignCount = startedCampaigns.filter((lead: any) => 
        lead.campaignState !== null && lead.campaignState.isPaused
      ).length;

      // Exclude full leads array from output to keep payload lean
      const { leads, ...rest } = company;
      return {
        ...rest,
        startedCampaignCount,
        pausedCampaignCount
      };
    });
  });

  app.get("/admin/companies/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const company = await prisma.company.findUnique({
      where: { id },
      include: {
        algorithms: {
          include: { algorithm: true },
          orderBy: [{ confidenceScore: "desc" }, { hitCount: "desc" }, { rank: "asc" }]
        },
        leads: {
          orderBy: { createdAt: "desc" },
          take: 25,
          include: {
            candidates: {
              orderBy: [{ selected: "desc" }, { createdAt: "asc" }]
            }
          }
        }
      }
    });

    if (!company) {
      return reply.status(404).send({ error: "Company not found" });
    }

    return company;
  });

  // Rich insights for a single company (for Company Console drill-down)
  app.get("/admin/companies/:id/insights", async (request, reply) => {
    const { id: companyId } = request.params as { id: string };

    const company = await prisma.company.findUnique({
      where: { id: companyId },
      select: {
        id: true,
        name: true,
        domain: true,
        domainConfidence: true,
        domainSource: true,
        researchReason: true,
        createdAt: true,
        _count: {
          select: { leads: true, candidates: true }
        }
      }
    });

    if (!company) {
      return reply.status(404).send({ error: "Company not found" });
    }

    // Lead status breakdown
    const leads = await prisma.lead.findMany({
      where: { companyId },
      select: {
        id: true,
        status: true,
        campaignState: {
          select: { status: true, followupCount: true, lastSentAt: true }
        }
      }
    });

    const leadStatusCounts = leads.reduce<Record<string, number>>((acc, lead) => {
      acc[lead.status] = (acc[lead.status] || 0) + 1;
      return acc;
    }, {});

    const campaignStatusCounts = leads.reduce<Record<string, number>>((acc, lead) => {
      const cs = lead.campaignState?.status;
      if (cs) {
        acc[cs] = (acc[cs] || 0) + 1;
      }
      return acc;
    }, {});

    // Total emails sent = email events for all candidates of this company
    const emailsSentCount = await prisma.emailEvent.count({
      where: {
        candidate: { companyId }
      }
    });

    // Applications matching by company name (case-insensitive)
    const applications = await prisma.application.findMany({
      where: {
        companyName: { contains: company.name, mode: "insensitive" }
      },
      orderBy: { createdAt: "desc" }
    });

    return {
      ...company,
      leadStatusCounts,
      campaignStatusCounts,
      emailsSentCount,
      applications
    };
  });

  // Force retry Gemini research for a company (clears cache and re-runs even if already set)
  app.post("/admin/companies/:id/retry-research", async (request, reply) => {
    const { id: companyId } = request.params as { id: string };

    const company = await prisma.company.findUnique({
      where: { id: companyId },
      select: { id: true, name: true, domain: true }
    });

    if (!company) {
      return reply.status(404).send({ success: false, error: "Company not found" });
    }

    try {
      // Force-clear cached research reason so syncCompanyResearch will re-run
      await prisma.company.update({
        where: { id: companyId },
        data: { researchReason: null }
      });

      const reason = await syncCompanyResearch(companyId, company.name, company.domain ?? undefined);

      return { success: true, researchReason: reason };
    } catch (err) {
      return reply.status(500).send({
        success: false,
        message: err instanceof Error ? err.message : "Failed to retry research"
      });
    }
  });

  app.get("/admin/leads", async () => {
    return prisma.lead.findMany({
      orderBy: { createdAt: "desc" },
      include: {
        company: true,
        campaignState: true,
        candidates: {
          orderBy: [{ selected: "desc" }, { createdAt: "asc" }],
          include: {
            algorithm: true,
            events: {
              orderBy: { createdAt: "desc" }
            }
          }
        }
      }
    });
  });

  app.get("/admin/events", async () => {
    return prisma.emailEvent.findMany({
      orderBy: { createdAt: "desc" },
      take: 100,
      include: {
        candidate: {
          include: {
            lead: true,
            company: true,
            algorithm: true
          }
        }
      }
    });
  });

  app.post("/admin/gmail/poll", async (request, reply) => {
    const result = await pollGmailBounces();
    return reply.status(result.success ? 200 : 400).send(result);
  });

  app.post("/admin/gmail/simulate", async (request, reply) => {
    const { email } = request.body as { email: string };
    if (!email) {
      return reply.status(400).send({ success: false, message: "Email parameter is required." });
    }
    const result = await simulateGmailBounce(email);
    return reply.status(result.success ? 200 : 400).send(result);
  });

  app.get("/admin/gmail/quota-status", async () => {
    const isHalted = await isGmailQuotaHalted();
    const haltRecord = await prisma.googleCredentials.findUnique({
      where: { key: "gmail_quota_halt" }
    });
    return {
      isHalted,
      haltedDate: haltRecord ? haltRecord.refreshToken : null
    };
  });

  app.post("/admin/gmail/reset-quota-halt", async (request, reply) => {
    await setGmailQuotaHalted(false);
    return { success: true };
  });

  app.post("/admin/gmail/simulate-quota-breach", async (request, reply) => {
    await setGmailQuotaHalted(true);
    return { success: true };
  });

  app.post("/admin/campaigns", async (request, reply) => {
    const body = request.body as StartCampaignInput;
    try {
      const campaign = await startCampaign(body);

      // If immediate dispatch is requested (no scheduledFor date), run processCampaignQueue()
      if (!body.scheduledFor) {
        console.log(`🚀 [Admin Route] Triggering outbox queue dispatcher immediately for lead: "${body.leadId}"`);
        processCampaignQueue().catch((err) => {
          console.error("⚠️ Failed to immediately process outbox queue in /admin/campaigns:", err.message || err);
        });
      }

      return { success: true, campaign };
    } catch (error) {
      return reply.status(400).send({ success: false, message: error instanceof Error ? error.message : "Unknown error" });
    }
  });

  app.post("/admin/campaigns/process-queue", async (request, reply) => {
    try {
      const result = await processCampaignQueue();
      return result;
    } catch (error) {
      return reply.status(500).send({ success: false, message: error instanceof Error ? error.message : "Queue process failed" });
    }
  });

  app.post("/admin/campaigns/bulk-by-tag", async (request, reply) => {
    const { tag, jobLink, jobId, resumeName, resumeBase64, followupIntervalMinutes, maxFollowups, scheduledFor, respectTiming, roleName, templateId } = request.body as {
      tag: string;
      jobLink?: string;
      jobId?: string;
      resumeName?: string;
      resumeBase64?: string;
      followupIntervalMinutes?: number;
      maxFollowups?: number;
      scheduledFor?: string;
      respectTiming?: boolean;
      roleName?: string;
      templateId?: string;
    };

    if (!tag || typeof tag !== "string") {
      return reply.status(400).send({ success: false, message: "Tag is required and must be a string." });
    }

    try {
      const leads = await prisma.lead.findMany({
        where: {
          tags: {
            has: tag.trim()
          }
        },
        include: { candidates: true }
      });

      let count = 0;
      for (const lead of leads) {
        const candidate = lead.candidates.find((c) => c.selected) || lead.candidates[0];
        if (candidate) {
          await startCampaign({
            leadId: lead.id,
            candidateId: candidate.id,
            jobLink,
            jobId,
            resumeName,
            resumeBase64,
            followupIntervalMinutes,
            maxFollowups,
            respectTiming,
            scheduledFor,
            roleName,
            templateId
          });
          count++;
        }
      }

      // If immediate dispatch is requested (no scheduledFor date), trigger immediate queue processing ONCE
      if (!scheduledFor && count > 0) {
        console.log(`🚀 [Admin Route] Triggering outbox queue dispatcher ONCE after bulk scheduling ${count} campaigns for tag "${tag}"`);
        processCampaignQueue().catch((err) => {
          console.error("⚠️ Failed to immediately process outbox queue in bulk-by-tag:", err.message || err);
        });
      }

      return { success: true, count };
    } catch (error) {
      return reply.status(500).send({ success: false, message: error instanceof Error ? error.message : "Bulk campaign by tag initiation failed" });
    }
  });

  app.post("/admin/companies/:id/bulk-campaign", async (request, reply) => {
    const { id: companyId } = request.params as { id: string };
    const { jobLink, jobId, resumeName, resumeBase64, followupIntervalMinutes, maxFollowups, scheduledFor, respectTiming, roleName, templateId } = request.body as {
      jobLink?: string;
      jobId?: string;
      resumeName?: string;
      resumeBase64?: string;
      followupIntervalMinutes?: number;
      maxFollowups?: number;
      scheduledFor?: string;
      respectTiming?: boolean;
      roleName?: string;
      templateId?: string;
    };

    try {
      const leads = await prisma.lead.findMany({
        where: { companyId },
        include: { candidates: true }
      });

      let count = 0;
      for (const lead of leads) {
        const candidate = lead.candidates.find((c) => c.selected) || lead.candidates[0];
        if (candidate) {
          await startCampaign({
            leadId: lead.id,
            candidateId: candidate.id,
            jobLink,
            jobId,
            resumeName,
            resumeBase64,
            followupIntervalMinutes,
            maxFollowups,
            respectTiming,
            scheduledFor,
            roleName,
            templateId
          });
          count++;
        }
      }

      // If immediate dispatch is requested (no scheduledFor date), trigger immediate queue processing ONCE after all campaigns are registered
      if (!scheduledFor) {
        console.log(`🚀 [Admin Route] Triggering outbox queue dispatcher ONCE after bulk scheduling ${count} campaigns for company "${companyId}"`);
        processCampaignQueue().catch((err) => {
          console.error("⚠️ Failed to immediately process outbox queue in /bulk-campaign:", err.message || err);
        });
      }

      return { success: true, count };
    } catch (error) {
      return reply.status(500).send({ success: false, message: error instanceof Error ? error.message : "Bulk campaign initiation failed" });
    }
  });

  // Pause / Unpause campaign by person (lead)
  app.post("/admin/leads/:id/pause", async (request, reply) => {
    const { id: leadId } = request.params as { id: string };
    const { isPaused } = request.body as { isPaused: boolean };

    try {
      const campaign = await prisma.campaignState.update({
        where: { leadId },
        data: { isPaused }
      });
      return { success: true, isPaused: campaign.isPaused };
    } catch (error) {
      return reply.status(400).send({ success: false, message: "Campaign state not found or cannot be updated" });
    }
  });

  // Pause / Unpause campaigns by company
  app.post("/admin/companies/:id/pause", async (request, reply) => {
    const { id: companyId } = request.params as { id: string };
    const { isPaused } = request.body as { isPaused: boolean };

    try {
      const leads = await prisma.lead.findMany({
        where: { companyId },
        select: { id: true }
      });
      const leadIds = leads.map(l => l.id);

      await prisma.campaignState.updateMany({
        where: { leadId: { in: leadIds } },
        data: { isPaused }
      });

      return { success: true, isPaused, count: leadIds.length };
    } catch (error) {
      return reply.status(400).send({ success: false, message: error instanceof Error ? error.message : "Unknown error" });
    }
  });

  // End campaign by person (lead)
  app.post("/admin/leads/:id/end", async (request, reply) => {
    const { id: leadId } = request.params as { id: string };
    try {
      const campaign = await prisma.campaignState.update({
        where: { leadId },
        data: {
          status: "completed",
          scheduledFor: null
        }
      });
      return { success: true, campaign };
    } catch (error) {
      return reply.status(400).send({ success: false, message: "Campaign state not found or cannot be ended" });
    }
  });

  // Cancel campaign by person (lead)
  app.post("/admin/leads/:id/cancel", async (request, reply) => {
    const { id: leadId } = request.params as { id: string };
    try {
      const campaign = await prisma.campaignState.update({
        where: { leadId },
        data: {
          status: "cancelled",
          scheduledFor: null
        }
      });
      return { success: true, campaign };
    } catch (error) {
      return reply.status(400).send({ success: false, message: "Campaign state not found or cannot be cancelled" });
    }
  });

  // Cancel campaigns by company
  app.post("/admin/companies/:id/cancel", async (request, reply) => {
    const { id: companyId } = request.params as { id: string };

    try {
      const leads = await prisma.lead.findMany({
        where: { companyId },
        select: { id: true }
      });
      const leadIds = leads.map(l => l.id);

      await prisma.campaignState.updateMany({
        where: {
          leadId: { in: leadIds },
          status: { notIn: ["completed", "bounced", "replied", "draft", "cancelled"] }
        },
        data: {
          status: "cancelled",
          scheduledFor: null
        }
      });

      return { success: true, count: leadIds.length };
    } catch (error) {
      return reply.status(400).send({ success: false, message: error instanceof Error ? error.message : "Unknown error" });
    }
  });

  // Safely delete a company (only if it has 0 leads)
  app.delete("/admin/companies/:id", async (request, reply) => {
    const { id } = request.params as { id: string };

    try {
      const company = await prisma.company.findUnique({
        where: { id },
        include: {
          _count: {
            select: { leads: true }
          }
        }
      });

      if (!company) {
        return reply.status(404).send({ success: false, message: "Company not found" });
      }

      if (company._count.leads > 0) {
        return reply.status(400).send({ success: false, message: "Cannot delete company with active leads" });
      }

      await prisma.company.delete({
        where: { id }
      });

      return { success: true, message: "Company deleted successfully" };
    } catch (error) {
      return reply.status(500).send({ success: false, message: error instanceof Error ? error.message : "Failed to delete company" });
    }
  });

  // Trigger all campaign sequences for a company immediately
  app.post("/admin/companies/:id/trigger-outbox", async (request, reply) => {
    const { id: companyId } = request.params as { id: string };

    try {
      const companyExists = await prisma.company.findUnique({
        where: { id: companyId }
      });
      if (!companyExists) {
        return reply.status(404).send({ success: false, message: "Company not found" });
      }

      const leads = await prisma.lead.findMany({
        where: { companyId },
        select: { id: true }
      });
      const leadIds = leads.map(l => l.id);

      await prisma.campaignState.updateMany({
        where: {
          leadId: { in: leadIds },
          status: { notIn: ["completed", "bounced", "replied", "cancelled", "draft"] }
        },
        data: {
          scheduledFor: new Date(),
          isPaused: false
        }
      });

      const result = await processCampaignQueue();
      return { success: true, count: leadIds.length, sentCount: result.sentCount };
    } catch (error) {
      return reply.status(400).send({ success: false, message: error instanceof Error ? error.message : "Unknown error" });
    }
  });

  // Delete lead by ID (cascades candidates and campaignState)
  app.delete("/admin/leads/:id", async (request, reply) => {
    const { id: leadId } = request.params as { id: string };
    try {
      await prisma.lead.delete({
        where: { id: leadId }
      });
      return { success: true };
    } catch (error) {
      return reply.status(400).send({ success: false, message: error instanceof Error ? error.message : "Failed to delete lead" });
    }
  });

  // Update lead details by ID
  app.patch("/admin/leads/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    
    const updateLeadSchema = z.object({
      fullName: z.string().trim().min(1, "Full name is required."),
      email: z.string().trim().email("Please enter a valid email address."),
      companyName: z.string().trim().min(1, "Company name is required."),
      tags: z.union([z.array(z.string()), z.string()]).optional()
    });

    const parsed = updateLeadSchema.safeParse(request.body);
    if (!parsed.success) {
      const messages = parsed.error.issues.map(i => i.message).join(" ");
      return reply.status(400).send({ success: false, message: messages });
    }

    const { fullName, email, tags, companyName } = parsed.data;
    const candidateEmail = email.toLowerCase().trim();

    try {
      const lead = await prisma.lead.findUnique({
        where: { id },
        include: { candidates: true }
      });

      if (!lead) {
        return reply.status(404).send({ success: false, message: "Lead not found" });
      }

      // Validate global email uniqueness across other leads
      const globalDuplicate = await prisma.emailCandidate.findFirst({
        where: {
          email: candidateEmail,
          leadId: { not: id }
        },
        include: { lead: true }
      });

      if (globalDuplicate) {
        return reply.status(400).send({
          success: false,
          message: `Email '${candidateEmail}' is already in use by lead '${globalDuplicate.lead.fullName}'.`
        });
      }

      // Resolve Company
      const cleanedCompanyBrand = cleanCompanyName(companyName);
      const normalizedCompanyName = normalizeCompanyName(companyName);
      const domain = candidateEmail.split("@")[1]?.toLowerCase().trim() || "";

      const company = await prisma.company.upsert({
        where: { normalizedName: normalizedCompanyName },
        update: {},
        create: {
          name: cleanedCompanyBrand,
          normalizedName: normalizedCompanyName,
          domain
        }
      });

      // Trigger company-specific Gemini value-add research asynchronously in the background
      (async () => {
        try {
          await syncCompanyResearch(company.id, company.name, company.domain || undefined);
        } catch (err: any) {
          console.error(`⚠️ Failed to sync company research asynchronously:`, err.message || err);
        }
      })();

      const parsedName = parseName(fullName);
      const tagsArray = typeof tags === "string"
        ? tags.split(",").map(t => t.trim()).filter(Boolean)
        : (tags || []);

      // 1. Update lead name, company and tags
      await prisma.lead.update({
        where: { id },
        data: {
          fullName: parsedName.fullName,
          firstName: parsedName.firstName,
          middleName: parsedName.middleName || null,
          lastName: parsedName.lastName || null,
          tags: tagsArray,
          companyId: company.id
        }
      });

      // Update companyId for all email candidates under this lead
      await prisma.emailCandidate.updateMany({
        where: { leadId: id },
        data: { companyId: company.id }
      });

      // 2. Handle candidate email update
      let selectedCandidate = lead.candidates.find(c => c.selected);
      if (!selectedCandidate && lead.candidates.length > 0) {
        selectedCandidate = lead.candidates[0];
      }

      if (selectedCandidate) {
        // Check if there is another candidate with this email for the same lead (excluding selectedCandidate itself)
        const sameLeadDuplicate = lead.candidates.find(
          c => c.email.toLowerCase() === candidateEmail && c.id !== selectedCandidate!.id
        );
        if (sameLeadDuplicate) {
          await prisma.emailCandidate.delete({
            where: { id: sameLeadDuplicate.id }
          });
        }

        await prisma.emailCandidate.update({
          where: { id: selectedCandidate.id },
          data: {
            email: candidateEmail,
            selected: true,
            companyId: company.id
          }
        });

        // Ensure other candidates are not selected
        await prisma.emailCandidate.updateMany({
          where: { leadId: id, id: { not: selectedCandidate.id } },
          data: { selected: false }
        });
      } else {
        // No existing candidates, create one
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

        await prisma.emailCandidate.create({
          data: {
            leadId: id,
            companyId: company.id,
            algorithmId: directAlgo.id,
            email: candidateEmail,
            syntaxValid: true,
            mxValid: true,
            verifierStatus: "verified",
            verifierScore: 100,
            isCatchAll: false,
            selected: true
          }
        });
      }

      // Fetch the updated lead to return it
      const updatedLead = await prisma.lead.findUnique({
        where: { id },
        include: {
          company: true,
          campaignState: true,
          candidates: {
            orderBy: [{ selected: "desc" }, { createdAt: "asc" }],
            include: { algorithm: true }
          }
        }
      });

      return { success: true, lead: updatedLead };
    } catch (err) {
      return reply.status(500).send({
        success: false,
        message: err instanceof Error ? err.message : "Failed to update lead"
      });
    }
  });

  // Get active outreach campaigns in the queue
  app.get("/admin/queue", async () => {
    return prisma.campaignState.findMany({
      where: {
        status: { notIn: ["completed", "bounced", "replied", "cancelled", "draft"] }
      },
      include: {
        lead: {
          include: {
            company: true
          }
        },
        candidate: true
      },
      orderBy: {
        scheduledFor: "asc"
      }
    });
  });

  // Trigger a specific campaign sequence immediately
  app.post("/admin/queue/:id/trigger", async (request, reply) => {
    const { id } = request.params as { id: string };
    try {
      await prisma.campaignState.update({
        where: { id },
        data: {
          scheduledFor: new Date(),
          isPaused: false
        }
      });
      const result = await processCampaignQueue();
      return { success: true, sentCount: result.sentCount };
    } catch (error) {
      return reply.status(400).send({ success: false, message: error instanceof Error ? error.message : "Trigger failed" });
    }
  });

  // Applications Console Endpoints
  const createApplicationSchema = z.object({
    companyName: z.string().trim().min(1, "Company name is required."),
    role: z.string().trim().min(1, "Role is required."),
    jobLink: z.string().trim().url("Please enter a valid URL.").or(z.literal("")).optional().nullable(),
    jobId: z.string().trim().optional().nullable(),
  });

  const updateApplicationSchema = z.object({
    status: z.enum([
      "Not Applied",
      "Applied",
      "Screen out",
      "Reached out",
      "Interviewing",
      "Selected",
      "Rejected",
      "Dropped",
      "Application Closed"
    ]).optional(),
    companyName: z.string().trim().min(1).optional(),
    role: z.string().trim().min(1).optional(),
    jobLink: z.string().trim().url().or(z.literal("")).optional().nullable(),
    jobId: z.string().trim().optional().nullable(),
  });

  app.get("/admin/applications", async () => {
    return prisma.application.findMany({
      orderBy: { updatedAt: "desc" }
    });
  });

  app.post("/admin/applications", async (request, reply) => {
    const parsed = createApplicationSchema.safeParse(request.body);
    if (!parsed.success) {
      const messages = parsed.error.issues.map(issue => issue.message).join(" ");
      return reply.status(400).send({
        success: false,
        message: messages || "Validation failed."
      });
    }
    
    const { companyName, role, jobLink, jobId } = parsed.data;
    const application = await prisma.application.create({
      data: {
        companyName,
        role,
        jobLink: jobLink || null,
        jobId: jobId || null,
        status: "Not Applied"
      }
    });
    
    return reply.status(201).send({ success: true, application });
  });

  app.patch("/admin/applications/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const parsed = updateApplicationSchema.safeParse(request.body);
    if (!parsed.success) {
      const messages = parsed.error.issues.map(issue => issue.message).join(" ");
      return reply.status(400).send({
        success: false,
        message: messages || "Validation failed."
      });
    }

    try {
      const application = await prisma.application.update({
        where: { id },
        data: {
          ...parsed.data,
          jobLink: parsed.data.jobLink === "" ? null : parsed.data.jobLink,
          jobId: parsed.data.jobId === "" ? null : parsed.data.jobId
        }
      });
      return { success: true, application };
    } catch (error) {
      return reply.status(404).send({ success: false, message: "Application not found or update failed" });
    }
  });

  app.delete("/admin/applications/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    try {
      await prisma.application.delete({
        where: { id }
      });
      return { success: true };
    } catch (error) {
      return reply.status(400).send({ success: false, message: "Failed to delete application" });
    }
  });

  app.get("/admin/applications/prefill", async (request, reply) => {
    const { companyName } = request.query as { companyName?: string };
    if (!companyName) {
      return reply.status(400).send({ success: false, message: "companyName parameter is required." });
    }
    
    const application = await prisma.application.findFirst({
      where: {
        companyName: {
          equals: companyName,
          mode: "insensitive"
        }
      },
      orderBy: {
        updatedAt: "desc"
      }
    });

    if (!application) {
      return { success: true, match: null };
    }

    return {
      success: true,
      match: {
        role: application.role,
        jobLink: application.jobLink,
        jobId: application.jobId
      }
    };
  });

  // ─── TEMPLATES CRUD ───────────────────────────────────────────────────────

  const templateSchema = z.object({
    name: z.string().trim().min(1, "Template name is required."),
    subject: z.string().trim().min(1, "Subject is required."),
    body: z.string().trim().min(1, "Body is required."),
    isDefault: z.boolean().optional().default(false),
  });

  // List all templates
  app.get("/admin/templates", async () => {
    return prisma.template.findMany({
      orderBy: [{ isDefault: "desc" }, { updatedAt: "desc" }]
    });
  });

  // Create a template
  app.post("/admin/templates", async (request, reply) => {
    const parsed = templateSchema.safeParse(request.body);
    if (!parsed.success) {
      const messages = parsed.error.issues.map(i => i.message).join(" ");
      return reply.status(400).send({ success: false, message: messages });
    }

    const { name, subject, body, isDefault } = parsed.data;

    // If this is the new default, unset all others first
    if (isDefault) {
      await prisma.template.updateMany({ data: { isDefault: false } });
    }

    const template = await prisma.template.create({
      data: { name, subject, body, isDefault: isDefault ?? false }
    });

    return reply.status(201).send({ success: true, template });
  });

  // Get a single template
  app.get("/admin/templates/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const template = await prisma.template.findUnique({ where: { id } });
    if (!template) return reply.status(404).send({ success: false, message: "Template not found" });
    return template;
  });

  // Update a template
  app.put("/admin/templates/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const parsed = templateSchema.safeParse(request.body);
    if (!parsed.success) {
      const messages = parsed.error.issues.map(i => i.message).join(" ");
      return reply.status(400).send({ success: false, message: messages });
    }

    const { name, subject, body, isDefault } = parsed.data;

    // If this is the new default, unset all others first
    if (isDefault) {
      await prisma.template.updateMany({ where: { id: { not: id } }, data: { isDefault: false } });
    }

    try {
      const template = await prisma.template.update({
        where: { id },
        data: { name, subject, body, isDefault: isDefault ?? false }
      });
      return { success: true, template };
    } catch {
      return reply.status(404).send({ success: false, message: "Template not found" });
    }
  });

  // Delete a template
  app.delete("/admin/templates/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    try {
      await prisma.template.delete({ where: { id } });
      return { success: true };
    } catch {
      return reply.status(404).send({ success: false, message: "Template not found" });
    }
  });

  // Set a template as default
  app.patch("/admin/templates/:id/default", async (request, reply) => {
    const { id } = request.params as { id: string };
    try {
      await prisma.template.updateMany({ data: { isDefault: false } });
      const template = await prisma.template.update({
        where: { id },
        data: { isDefault: true }
      });
      return { success: true, template };
    } catch {
      return reply.status(404).send({ success: false, message: "Template not found" });
    }
  });

  // Trigger a new database backup snapshot
  app.post("/admin/backup", async (request, reply) => {
    try {
      const result = await createBackupSnapshot();
      return { success: true, ...result };
    } catch (error) {
      return reply.status(500).send({
        success: false,
        message: error instanceof Error ? error.message : "Failed to create backup"
      });
    }
  });

  // Retrieve list of all available backups
  app.get("/admin/backups", async () => {
    return await listBackupSnapshots();
  });

  // Restore database from a specific snapshot file
  app.post("/admin/restore", async (request, reply) => {
    const restoreSchema = z.object({
      filename: z.string().min(1),
      mode: z.enum(["replace", "add"])
    });

    const parsed = restoreSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        success: false,
        message: "Invalid payload: filename and mode ('replace' or 'add') are required."
      });
    }

    const { filename, mode } = parsed.data;
    const result = await restoreBackupSnapshot(filename, mode);
    if (!result.success) {
      return reply.status(500).send({
        success: false,
        message: result.message || "Failed to restore backup snapshot"
      });
    }

    return { success: true };
  });

  // Delete a specific backup file
  app.delete("/admin/backup/:filename", async (request, reply) => {
    const { filename } = request.params as { filename: string };
    try {
      const result = await deleteBackupSnapshot(filename);
      if (!result.success) {
        return reply.status(404).send({ success: false, message: result.message || "File not found" });
      }
      return { success: true };
    } catch (error) {
      return reply.status(500).send({
        success: false,
        message: error instanceof Error ? error.message : "Failed to delete backup"
      });
    }
  });
}

