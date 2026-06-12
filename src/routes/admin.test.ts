import { describe, expect, it, vi, beforeEach } from "vitest";
import fastify from "fastify";

// Mock prisma and campaignService
vi.mock("../lib/prisma.js", () => {
  return {
    prisma: {
      campaignState: {
        findMany: vi.fn(),
        update: vi.fn(),
        updateMany: vi.fn()
      },
      application: {
        findMany: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
        delete: vi.fn(),
        findFirst: vi.fn()
      },
      lead: {
        findUnique: vi.fn(),
        findFirst: vi.fn(),
        findMany: vi.fn(),
        update: vi.fn(),
        delete: vi.fn()
      },
      emailCandidate: {
        findFirst: vi.fn(),
        update: vi.fn(),
        updateMany: vi.fn(),
        delete: vi.fn(),
        create: vi.fn()
      },
      company: {
        findUnique: vi.fn(),
        findFirst: vi.fn(),
        upsert: vi.fn(),
        delete: vi.fn()
      },
      emailAlgorithm: {
        findUnique: vi.fn(),
        create: vi.fn()
      },
      companyEmailAlgorithm: {
        upsert: vi.fn()
      }
    }
  };
});

vi.mock("../services/campaignService.js", () => {
  return {
    processCampaignQueue: vi.fn()
  };
});

// Mock gmailService
vi.mock("../services/gmailService.js", () => {
  return {
    pollGmailBounces: vi.fn(),
    simulateGmailBounce: vi.fn()
  };
});

// Mock settingsService
vi.mock("../services/settingsService.js", () => {
  return {
    getSystemSetting: vi.fn().mockResolvedValue("https://drive.google.com/test-resume"),
    getAllSystemSettings: vi.fn().mockResolvedValue({
      respectTiming: true,
      timingStartHour: 9,
      timingEndHour: 17,
      followupIntervalMinutes: 80,
      maxFollowups: 5,
      defaultResumeLink: "https://drive.google.com/test-resume",
      emailVerifierProvider: "local",
      enableAiPatternDiscovery: false,
      gmailMonitorEnabled: false
    }),
    updateSystemSettings: vi.fn().mockImplementation((payload) => Promise.resolve({
      respectTiming: true,
      timingStartHour: 9,
      timingEndHour: 17,
      followupIntervalMinutes: 80,
      maxFollowups: 5,
      defaultResumeLink: "https://drive.google.com/test-resume",
      emailVerifierProvider: "local",
      enableAiPatternDiscovery: false,
      gmailMonitorEnabled: false,
      ...payload
    }))
  };
});

import { prisma } from "../lib/prisma.js";
import { processCampaignQueue } from "../services/campaignService.js";
import { registerAdminRoutes } from "./admin.js";
import { env } from "../config/env.js";

describe("admin routes", () => {
  let app: any;

  beforeEach(async () => {
    vi.clearAllMocks();
    app = fastify();
    await registerAdminRoutes(app);
  });

  describe("GET /admin/default-resume", () => {
    it("redirects to the configured default resume link", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/admin/default-resume"
      });

      expect(response.statusCode).toBe(302);
      expect(response.headers.location).toBe("https://drive.google.com/test-resume");
    });

    it("serves the local file directly as attachment if link is localhost", async () => {
      const { getSystemSetting } = await import("../services/settingsService.js");
      vi.mocked(getSystemSetting).mockResolvedValueOnce("http://localhost:4000/Vidhi_chadha_resume.pdf");

      const response = await app.inject({
        method: "GET",
        url: "/admin/default-resume"
      });

      expect(response.statusCode).toBe(200);
      expect(response.headers["content-type"]).toBe("application/pdf");
      expect(response.headers["content-disposition"]).toBe('attachment; filename="Vidhi_chadha_resume.pdf"');
    });
  });

  describe("GET /admin/queue", () => {
    it("returns active campaigns in the outbox queue", async () => {
      const mockCampaigns = [
        {
          id: "camp_1",
          status: "scheduled",
          lead: { fullName: "John Doe", company: { name: "Google" } },
          candidate: { email: "john@google.com" }
        }
      ];

      vi.mocked(prisma.campaignState.findMany).mockResolvedValue(mockCampaigns as any);

      const response = await app.inject({
        method: "GET",
        url: "/admin/queue"
      });

      expect(response.statusCode).toBe(200);
      expect(JSON.parse(response.payload)).toEqual(mockCampaigns);
      expect(prisma.campaignState.findMany).toHaveBeenCalledWith({
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
  });

  describe("POST /admin/queue/:id/trigger", () => {
    it("reschedules campaign and processes campaign queue", async () => {
      vi.mocked(prisma.campaignState.update).mockResolvedValue({ id: "camp_1" } as any);
      vi.mocked(processCampaignQueue).mockResolvedValue({ success: true, sentCount: 1 } as any);

      const response = await app.inject({
        method: "POST",
        url: "/admin/queue/camp_1/trigger"
      });

      expect(response.statusCode).toBe(200);
      expect(JSON.parse(response.payload)).toEqual({ success: true, sentCount: 1 });
      expect(prisma.campaignState.update).toHaveBeenCalledWith({
        where: { id: "camp_1" },
        data: {
          scheduledFor: expect.any(Date),
          isPaused: false
        }
      });
      expect(processCampaignQueue).toHaveBeenCalled();
    });

    it("returns 400 on error", async () => {
      vi.mocked(prisma.campaignState.update).mockRejectedValue(new Error("Campaign not found"));

      const response = await app.inject({
        method: "POST",
        url: "/admin/queue/camp_invalid/trigger"
      });

      expect(response.statusCode).toBe(400);
      expect(JSON.parse(response.payload)).toEqual({
        success: false,
        message: "Campaign not found"
      });
    });
  });

  describe("Applications routes", () => {
    describe("GET /admin/applications", () => {
      it("returns list of applications", async () => {
        const mockApplications = [
          { id: "app_1", companyName: "Google", role: "SDE", jobLink: "https://google.com/jobs", jobId: "JOB123", status: "Not Applied" }
        ];
        vi.mocked(prisma.application.findMany).mockResolvedValue(mockApplications as any);

        const response = await app.inject({
          method: "GET",
          url: "/admin/applications"
        });

        expect(response.statusCode).toBe(200);
        expect(JSON.parse(response.payload)).toEqual(mockApplications);
        expect(prisma.application.findMany).toHaveBeenCalledWith({
          orderBy: { updatedAt: "desc" }
        });
      });
    });

    describe("POST /admin/applications", () => {
      it("creates a new application", async () => {
        const payload = { companyName: "Google", role: "SDE", jobLink: "https://google.com/jobs", jobId: "JOB123" };
        const createdApp = { id: "app_1", ...payload, status: "Not Applied" };
        vi.mocked(prisma.application.create).mockResolvedValue(createdApp as any);

        const response = await app.inject({
          method: "POST",
          url: "/admin/applications",
          payload
        });

        expect(response.statusCode).toBe(201);
        expect(JSON.parse(response.payload)).toEqual({ success: true, application: createdApp });
        expect(prisma.application.create).toHaveBeenCalledWith({
          data: {
            companyName: "Google",
            role: "SDE",
            jobLink: "https://google.com/jobs",
            jobId: "JOB123",
            status: "Not Applied"
          }
        });
      });

      it("returns 400 validation error if companyName is missing", async () => {
        const response = await app.inject({
          method: "POST",
          url: "/admin/applications",
          payload: { role: "SDE" }
        });

        expect(response.statusCode).toBe(400);
        expect(JSON.parse(response.payload).success).toBe(false);
      });
    });

    describe("PATCH /admin/applications/:id", () => {
      it("updates application status", async () => {
        const updatedApp = { id: "app_1", companyName: "Google", role: "SDE", status: "Applied" };
        vi.mocked(prisma.application.update).mockResolvedValue(updatedApp as any);

        const response = await app.inject({
          method: "PATCH",
          url: "/admin/applications/app_1",
          payload: { status: "Applied" }
        });

        expect(response.statusCode).toBe(200);
        expect(JSON.parse(response.payload)).toEqual({ success: true, application: updatedApp });
        expect(prisma.application.update).toHaveBeenCalledWith({
          where: { id: "app_1" },
          data: { status: "Applied" }
        });
      });

      it("returns 400 for invalid status value", async () => {
        const response = await app.inject({
          method: "PATCH",
          url: "/admin/applications/app_1",
          payload: { status: "InvalidStatusValue" }
        });

        expect(response.statusCode).toBe(400);
        expect(JSON.parse(response.payload).success).toBe(false);
      });
    });

    describe("DELETE /admin/applications/:id", () => {
      it("deletes application", async () => {
        vi.mocked(prisma.application.delete).mockResolvedValue({ id: "app_1" } as any);

        const response = await app.inject({
          method: "DELETE",
          url: "/admin/applications/app_1"
        });

        expect(response.statusCode).toBe(200);
        expect(JSON.parse(response.payload)).toEqual({ success: true });
        expect(prisma.application.delete).toHaveBeenCalledWith({
          where: { id: "app_1" }
        });
      });
    });

    describe("GET /admin/applications/prefill", () => {
      it("returns matched application prefill details", async () => {
        const mockApp = { companyName: "Google", role: "Backend Engineer", jobLink: "https://google.com/careers", jobId: "JOB555" };
        vi.mocked(prisma.application.findFirst).mockResolvedValue(mockApp as any);

        const response = await app.inject({
          method: "GET",
          url: "/admin/applications/prefill?companyName=google"
        });

        expect(response.statusCode).toBe(200);
        expect(JSON.parse(response.payload)).toEqual({
          success: true,
          match: {
            role: "Backend Engineer",
            jobLink: "https://google.com/careers",
            jobId: "JOB555"
          }
        });
        expect(prisma.application.findFirst).toHaveBeenCalledWith({
          where: {
            companyName: {
              equals: "google",
              mode: "insensitive"
            }
          },
          orderBy: {
            updatedAt: "desc"
          }
        });
      });

      it("returns null match if no company is found", async () => {
        vi.mocked(prisma.application.findFirst).mockResolvedValue(null);

        const response = await app.inject({
          method: "GET",
          url: "/admin/applications/prefill?companyName=nonexistent"
        });

        expect(response.statusCode).toBe(200);
        expect(JSON.parse(response.payload)).toEqual({
          success: true,
          match: null
        });
      });
    });
  });

  describe("PATCH /admin/leads/:id", () => {
    it("updates lead name, company, tags and candidate email successfully", async () => {
      const mockLead = {
        id: "lead_1",
        fullName: "Old Name",
        companyId: "comp_1",
        candidates: [{ id: "cand_1", email: "old@test.com", selected: true }]
      };
      vi.mocked(prisma.lead.findUnique).mockResolvedValue(mockLead as any);
      vi.mocked(prisma.emailCandidate.findFirst).mockResolvedValue(null);
      vi.mocked(prisma.company.upsert).mockResolvedValue({ id: "comp_2", name: "Google" } as any);
      vi.mocked(prisma.lead.update).mockResolvedValue({} as any);
      vi.mocked(prisma.emailCandidate.update).mockResolvedValue({} as any);
      vi.mocked(prisma.emailCandidate.updateMany).mockResolvedValue({} as any);

      const response = await app.inject({
        method: "PATCH",
        url: "/admin/leads/lead_1",
        payload: {
          fullName: "New Name",
          email: "new@test.com",
          companyName: "Google",
          tags: "tag1, tag2"
        }
      });

      expect(response.statusCode).toBe(200);
      const data = JSON.parse(response.payload);
      expect(data.success).toBe(true);
      expect(prisma.company.upsert).toHaveBeenCalled();
      expect(prisma.lead.update).toHaveBeenCalled();
    });

    it("returns 400 if email is already in use by another lead", async () => {
      const mockLead = {
        id: "lead_1",
        fullName: "Old Name",
        companyId: "comp_1",
        candidates: [{ id: "cand_1", email: "old@test.com", selected: true }]
      };
      vi.mocked(prisma.lead.findUnique).mockResolvedValue(mockLead as any);
      vi.mocked(prisma.emailCandidate.findFirst).mockResolvedValue({
        id: "other_cand",
        email: "new@test.com",
        lead: { fullName: "Other Lead" }
      } as any);

      const response = await app.inject({
        method: "PATCH",
        url: "/admin/leads/lead_1",
        payload: {
          fullName: "New Name",
          email: "new@test.com",
          companyName: "Google",
          tags: ""
        }
      });

      expect(response.statusCode).toBe(400);
      const data = JSON.parse(response.payload);
      expect(data.success).toBe(false);
      expect(data.message).toContain("already in use by lead 'Other Lead'");
    });
  });

  describe("POST /admin/companies/:id/trigger-outbox", () => {
    it("updates all pending campaigns for company leads and triggers queue process", async () => {
      vi.mocked(prisma.company.findUnique).mockResolvedValue({ id: "comp_1", name: "Google" } as any);
      vi.mocked(prisma.lead.findMany).mockResolvedValue([{ id: "lead_1" }, { id: "lead_2" }] as any);
      vi.mocked(prisma.campaignState.updateMany).mockResolvedValue({ count: 2 } as any);
      vi.mocked(processCampaignQueue).mockResolvedValue({ sentCount: 1 } as any);

      const response = await app.inject({
        method: "POST",
        url: "/admin/companies/comp_1/trigger-outbox"
      });

      expect(response.statusCode).toBe(200);
      const data = JSON.parse(response.payload);
      expect(data.success).toBe(true);
      expect(data.count).toBe(2);
      expect(data.sentCount).toBe(1);
      expect(prisma.campaignState.updateMany).toHaveBeenCalledWith({
        where: {
          leadId: { in: ["lead_1", "lead_2"] },
          status: { notIn: ["completed", "bounced", "replied", "cancelled", "draft"] }
        },
        data: {
          scheduledFor: expect.any(Date),
          isPaused: false
        }
      });
      expect(processCampaignQueue).toHaveBeenCalled();
    });
  });

  describe("DELETE /admin/companies/:id", () => {
    it("deletes company successfully if it has 0 leads", async () => {
      vi.mocked(prisma.company.findUnique).mockResolvedValue({
        id: "comp_1",
        name: "Google",
        _count: { leads: 0 }
      } as any);
      vi.mocked(prisma.company.delete).mockResolvedValue({ id: "comp_1" } as any);

      const response = await app.inject({
        method: "DELETE",
        url: "/admin/companies/comp_1"
      });

      expect(response.statusCode).toBe(200);
      const data = JSON.parse(response.payload);
      expect(data.success).toBe(true);
      expect(prisma.company.delete).toHaveBeenCalledWith({
        where: { id: "comp_1" }
      });
    });

    it("returns 400 error if company has active leads", async () => {
      vi.mocked(prisma.company.findUnique).mockResolvedValue({
        id: "comp_1",
        name: "Google",
        _count: { leads: 3 }
      } as any);

      const response = await app.inject({
        method: "DELETE",
        url: "/admin/companies/comp_1"
      });

      expect(response.statusCode).toBe(400);
      const data = JSON.parse(response.payload);
      expect(data.success).toBe(false);
      expect(data.message).toBe("Cannot delete company with active leads");
      expect(prisma.company.delete).not.toHaveBeenCalled();
    });
  });

  describe("GET /admin/settings", () => {
    it("returns current configurations", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/admin/settings"
      });

      expect(response.statusCode).toBe(200);
      const data = JSON.parse(response.payload);
      expect(data).toEqual({
        respectTiming: true,
        timingStartHour: 9,
        timingEndHour: 17,
        followupIntervalMinutes: 80,
        maxFollowups: 5,
        defaultResumeLink: "https://drive.google.com/test-resume",
        emailVerifierProvider: "local",
        enableAiPatternDiscovery: false,
        gmailMonitorEnabled: false
      });
    });
  });

  describe("PATCH /admin/settings", () => {
    it("updates configurations successfully", async () => {
      const payload = {
        respectTiming: false,
        timingStartHour: 10,
        timingEndHour: 16,
        maxFollowups: 2
      };

      const response = await app.inject({
        method: "PATCH",
        url: "/admin/settings",
        payload
      });

      expect(response.statusCode).toBe(200);
      const data = JSON.parse(response.payload);
      expect(data.respectTiming).toBe(false);
      expect(data.timingStartHour).toBe(10);
      expect(data.timingEndHour).toBe(16);
      expect(data.maxFollowups).toBe(2);
    });
  });
});
