import fs from "node:fs/promises";
import path from "node:path";
import { prisma } from "../lib/prisma.js";

const BACKUPS_DIR = path.resolve(process.cwd(), "backups");

// Helper to recursively convert ISO date strings to Date objects
function parseDates(obj: any): any {
  if (obj === null || obj === undefined) return obj;
  if (typeof obj === "string") {
    // Matches standard ISO-8601 strings (e.g. 2026-06-06T08:50:32.000Z)
    if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(obj)) {
      return new Date(obj);
    }
    return obj;
  }
  if (Array.isArray(obj)) {
    return obj.map(item => parseDates(item));
  }
  if (typeof obj === "object") {
    const parsed: any = {};
    for (const key of Object.keys(obj)) {
      if (key === "rawPayload") {
        // Bypass custom JSON payloads
        parsed[key] = obj[key];
      } else {
        parsed[key] = parseDates(obj[key]);
      }
    }
    return parsed;
  }
  return obj;
}

export async function createBackupSnapshot(): Promise<{ filename: string; size: number }> {
  const [
    emailAlgorithms,
    companies,
    companyEmailAlgorithms,
    leads,
    emailCandidates,
    campaignStates,
    emailEvents,
    suppressionEntries,
    googleCredentials,
    applications,
    templates
  ] = await Promise.all([
    prisma.emailAlgorithm.findMany(),
    prisma.company.findMany(),
    prisma.companyEmailAlgorithm.findMany(),
    prisma.lead.findMany(),
    prisma.emailCandidate.findMany(),
    prisma.campaignState.findMany(),
    prisma.emailEvent.findMany(),
    prisma.suppressionEntry.findMany(),
    prisma.googleCredentials.findMany(),
    prisma.application.findMany(),
    prisma.template.findMany()
  ]);

  const payload = {
    version: "1.0",
    timestamp: new Date().toISOString(),
    data: {
      emailAlgorithms,
      companies,
      companyEmailAlgorithms,
      leads,
      emailCandidates,
      campaignStates,
      emailEvents,
      suppressionEntries,
      googleCredentials,
      applications,
      templates
    }
  };

  await fs.mkdir(BACKUPS_DIR, { recursive: true });
  const filename = `backup_${Date.now()}.json`;
  const fileContent = JSON.stringify(payload, null, 2);
  await fs.writeFile(path.join(BACKUPS_DIR, filename), fileContent, "utf-8");

  return {
    filename,
    size: Buffer.byteLength(fileContent, "utf-8")
  };
}

export async function listBackupSnapshots(): Promise<Array<{ filename: string; size: number; createdAt: string }>> {
  try {
    await fs.mkdir(BACKUPS_DIR, { recursive: true });
    const files = await fs.readdir(BACKUPS_DIR);
    const backups = [];

    for (const file of files) {
      if (file.startsWith("backup_") && file.endsWith(".json")) {
        const filePath = path.join(BACKUPS_DIR, file);
        const stat = await fs.stat(filePath);
        backups.push({
          filename: file,
          size: stat.size,
          createdAt: stat.mtime.toISOString()
        });
      }
    }

    // Sort newest modification time first
    return backups.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  } catch (error) {
    console.error("Failed to list backup snapshots:", error);
    return [];
  }
}

export async function restoreBackupSnapshot(filename: string, mode: "replace" | "add"): Promise<{ success: boolean; message?: string }> {
  const filePath = path.join(BACKUPS_DIR, filename);
  
  try {
    // Check path resolution security
    if (!filePath.startsWith(BACKUPS_DIR)) {
      return { success: false, message: "Invalid backup file path." };
    }

    const rawData = await fs.readFile(filePath, "utf-8");
    const parsed = parseDates(JSON.parse(rawData));
    
    if (!parsed.data) {
      return { success: false, message: "Invalid backup format: data payload is missing." };
    }

    const {
      emailAlgorithms = [],
      companies = [],
      companyEmailAlgorithms = [],
      leads = [],
      emailCandidates = [],
      campaignStates = [],
      emailEvents = [],
      suppressionEntries = [],
      googleCredentials = [],
      applications = [],
      templates = []
    } = parsed.data;

    if (mode === "replace") {
      // Clear tables in reverse dependency order
      await prisma.$transaction([
        prisma.emailEvent.deleteMany(),
        prisma.campaignState.deleteMany(),
        prisma.emailCandidate.deleteMany(),
        prisma.lead.deleteMany(),
        prisma.companyEmailAlgorithm.deleteMany(),
        prisma.company.deleteMany(),
        prisma.emailAlgorithm.deleteMany(),
        prisma.suppressionEntry.deleteMany(),
        prisma.googleCredentials.deleteMany(),
        prisma.application.deleteMany(),
        prisma.template.deleteMany()
      ]);

      // Insert all records in dependency order
      await prisma.$transaction([
        prisma.emailAlgorithm.createMany({ data: emailAlgorithms }),
        prisma.company.createMany({ data: companies }),
        prisma.companyEmailAlgorithm.createMany({ data: companyEmailAlgorithms }),
        prisma.lead.createMany({ data: leads }),
        prisma.emailCandidate.createMany({ data: emailCandidates }),
        prisma.template.createMany({ data: templates }),
        prisma.campaignState.createMany({ data: campaignStates }),
        prisma.emailEvent.createMany({ data: emailEvents }),
        prisma.suppressionEntry.createMany({ data: suppressionEntries }),
        prisma.googleCredentials.createMany({ data: googleCredentials }),
        prisma.application.createMany({ data: applications })
      ]);
    } else {
      // Logical "Add" merge mode - Deduplicate and map IDs
      const existingAlgorithms = await prisma.emailAlgorithm.findMany();
      const existingCompanies = await prisma.company.findMany();
      const existingLeads = await prisma.lead.findMany();
      const existingCandidates = await prisma.emailCandidate.findMany();
      const existingCampaignStates = await prisma.campaignState.findMany();
      const existingTemplates = await prisma.template.findMany();
      const existingSuppressionEntries = await prisma.suppressionEntry.findMany();
      const existingGoogleCredentials = await prisma.googleCredentials.findMany();
      const existingApplications = await prisma.application.findMany();
      const existingCompanyAlgorithms = await prisma.companyEmailAlgorithm.findMany();

      const algorithmIdMap: Record<string, string> = {};
      const companyIdMap: Record<string, string> = {};
      const leadIdMap: Record<string, string> = {};
      const candidateIdMap: Record<string, string> = {};
      const templateIdMap: Record<string, string> = {};

      // 1. EmailAlgorithm
      for (const sa of emailAlgorithms) {
        const match = existingAlgorithms.find(a => a.key === sa.key || a.patternTemplate === sa.patternTemplate);
        if (match) {
          algorithmIdMap[sa.id] = match.id;
        } else {
          const created = await prisma.emailAlgorithm.create({
            data: {
              key: sa.key,
              patternTemplate: sa.patternTemplate,
              description: sa.description,
              example: sa.example
            }
          });
          algorithmIdMap[sa.id] = created.id;
        }
      }

      // 2. Company
      for (const sc of companies) {
        const match = existingCompanies.find(c => c.normalizedName === sc.normalizedName);
        if (match) {
          companyIdMap[sc.id] = match.id;
        } else {
          const created = await prisma.company.create({
            data: {
              name: sc.name,
              normalizedName: sc.normalizedName,
              domain: sc.domain,
              domainConfidence: sc.domainConfidence,
              domainSource: sc.domainSource,
              researchReason: sc.researchReason
            }
          });
          companyIdMap[sc.id] = created.id;
        }
      }

      // 3. CompanyEmailAlgorithm
      for (const sca of companyEmailAlgorithms) {
        const mappedCompanyId = companyIdMap[sca.companyId];
        const mappedAlgorithmId = algorithmIdMap[sca.algorithmId];
        if (mappedCompanyId && mappedAlgorithmId) {
          const match = existingCompanyAlgorithms.find(ca => ca.companyId === mappedCompanyId && ca.algorithmId === mappedAlgorithmId);
          if (!match) {
            await prisma.companyEmailAlgorithm.create({
              data: {
                companyId: mappedCompanyId,
                algorithmId: mappedAlgorithmId,
                hitCount: sca.hitCount,
                missCount: sca.missCount,
                verificationSuccessCount: sca.verificationSuccessCount,
                bounceCount: sca.bounceCount,
                confidenceScore: sca.confidenceScore,
                lastVerifiedAt: sca.lastVerifiedAt,
                rank: sca.rank
              }
            });
          }
        }
      }

      // 4. Lead
      for (const sl of leads) {
        const companyId = companyIdMap[sl.companyId];
        if (!companyId) continue;

        const match = existingLeads.find(l => 
          (sl.linkedinUrl && l.linkedinUrl === sl.linkedinUrl) ||
          (l.companyId === companyId && l.fullName.toLowerCase() === sl.fullName.toLowerCase())
        );

        if (match) {
          leadIdMap[sl.id] = match.id;
        } else {
          const created = await prisma.lead.create({
            data: {
              fullName: sl.fullName,
              firstName: sl.firstName,
              middleName: sl.middleName,
              lastName: sl.lastName,
              companyId,
              linkedinUrl: sl.linkedinUrl,
              headline: sl.headline,
              source: sl.source,
              status: sl.status
            }
          });
          leadIdMap[sl.id] = created.id;
        }
      }

      // 5. EmailCandidate
      for (const scand of emailCandidates) {
        const leadId = leadIdMap[scand.leadId];
        const companyId = companyIdMap[scand.companyId];
        const algorithmId = algorithmIdMap[scand.algorithmId];

        if (leadId && companyId && algorithmId) {
          const match = existingCandidates.find(c => c.leadId === leadId && c.email.toLowerCase() === scand.email.toLowerCase());
          if (match) {
            candidateIdMap[scand.id] = match.id;
          } else {
            const created = await prisma.emailCandidate.create({
              data: {
                leadId,
                companyId,
                algorithmId,
                email: scand.email,
                syntaxValid: scand.syntaxValid,
                mxValid: scand.mxValid,
                verifierProvider: scand.verifierProvider,
                verifierStatus: scand.verifierStatus,
                verifierScore: scand.verifierScore,
                isCatchAll: scand.isCatchAll,
                selected: scand.selected
              }
            });
            candidateIdMap[scand.id] = created.id;
          }
        }
      }

      // 6. Template
      for (const st of templates) {
        const match = existingTemplates.find(t => t.name.toLowerCase() === st.name.toLowerCase());
        if (match) {
          templateIdMap[st.id] = match.id;
        } else {
          const created = await prisma.template.create({
            data: {
              name: st.name,
              subject: st.subject,
              body: st.body,
              isDefault: st.isDefault
            }
          });
          templateIdMap[st.id] = created.id;
        }
      }

      // 7. CampaignState
      for (const scs of campaignStates) {
        const leadId = leadIdMap[scs.leadId];
        const candidateId = candidateIdMap[scs.candidateId];
        const templateId = scs.templateId ? templateIdMap[scs.templateId] : null;

        if (leadId && candidateId) {
          const match = existingCampaignStates.find(cs => cs.leadId === leadId);
          if (!match) {
            await prisma.campaignState.create({
              data: {
                leadId,
                candidateId,
                status: scs.status,
                jobLink: scs.jobLink,
                jobId: scs.jobId,
                resumePath: scs.resumePath,
                resumeName: scs.resumeName,
                scheduledFor: scs.scheduledFor,
                lastSentAt: scs.lastSentAt,
                followupCount: scs.followupCount,
                followupIntervalMinutes: scs.followupIntervalMinutes,
                maxFollowups: scs.maxFollowups,
                subject: scs.subject,
                body: scs.body,
                respectTiming: scs.respectTiming,
                isPaused: scs.isPaused,
                skipBounceMonitor: scs.skipBounceMonitor,
                roleName: scs.roleName,
                templateId
              }
            });
          }
        }
      }

      // 8. EmailEvent
      for (const se of emailEvents) {
        const candidateId = candidateIdMap[se.candidateId];
        if (candidateId) {
          await prisma.emailEvent.create({
            data: {
              candidateId,
              eventType: se.eventType,
              provider: se.provider,
              rawPayload: se.rawPayload
            }
          });
        }
      }

      // 9. SuppressionEntry
      for (const sse of suppressionEntries) {
        const match = existingSuppressionEntries.find(e => 
          (sse.email && e.email === sse.email) ||
          (sse.domain && e.domain === sse.domain)
        );
        if (!match) {
          await prisma.suppressionEntry.create({
            data: {
              email: sse.email,
              domain: sse.domain,
              reason: sse.reason,
              source: sse.source
            }
          });
        }
      }

      // 10. GoogleCredentials
      for (const sgc of googleCredentials) {
        const match = existingGoogleCredentials.find(c => c.key === sgc.key);
        if (!match) {
          await prisma.googleCredentials.create({
            data: {
              key: sgc.key,
              refreshToken: sgc.refreshToken
            }
          });
        }
      }

      // 11. Application
      for (const sapp of applications) {
        const match = existingApplications.find(a => 
          a.companyName.toLowerCase() === sapp.companyName.toLowerCase() && 
          a.role.toLowerCase() === sapp.role.toLowerCase()
        );
        if (!match) {
          await prisma.application.create({
            data: {
              companyName: sapp.companyName,
              role: sapp.role,
              jobLink: sapp.jobLink,
              jobId: sapp.jobId,
              status: sapp.status
            }
          });
        }
      }
    }

    return { success: true };
  } catch (error) {
    console.error("Failed to restore backup snapshot:", error);
    return {
      success: false,
      message: error instanceof Error ? error.message : "Unknown restore error"
    };
  }
}

export async function deleteBackupSnapshot(filename: string): Promise<{ success: boolean; message?: string }> {
  const filePath = path.join(BACKUPS_DIR, filename);
  try {
    // Check path resolution security
    if (!filePath.startsWith(BACKUPS_DIR)) {
      return { success: false, message: "Invalid backup file path." };
    }

    // Check if file exists
    await fs.access(filePath);
    await fs.unlink(filePath);
    return { success: true };
  } catch (error) {
    console.error("Failed to delete backup snapshot:", error);
    return {
      success: false,
      message: error instanceof Error ? error.message : "Failed to delete backup file"
    };
  }
}
