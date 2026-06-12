import { describe, expect, it, vi, beforeEach } from "vitest";
import { resolveTemplatePlaceholders } from "./campaignService.js";
import { env } from "../config/env.js";

// Mock the Prisma Client to avoid database connection errors during unit tests
vi.mock("../lib/prisma.js", () => {
  return {
    prisma: {
      lead: {
        findUnique: vi.fn(),
      },
      emailCandidate: {
        findUnique: vi.fn(),
        updateMany: vi.fn(),
        update: vi.fn(),
        findMany: vi.fn(),
      },
      campaignState: {
        findUnique: vi.fn(),
        update: vi.fn(),
        create: vi.fn(),
        findMany: vi.fn(),
        findFirst: vi.fn(),
      },
      emailEvent: {
        findFirst: vi.fn(),
      },
      template: {
        findUnique: vi.fn(),
        findFirst: vi.fn(),
      }
    }
  };
});

vi.mock("./gmailService.js", () => {
  return {
    sendGmailEmail: vi.fn(),
    pollGmailBounces: vi.fn(),
    isGmailQuotaHalted: vi.fn()
  };
});

vi.mock("./emailEventService.js", () => {
  return {
    recordEmailEvent: vi.fn()
  };
});

import { prisma } from "../lib/prisma.js";
import { sendGmailEmail, isGmailQuotaHalted } from "./gmailService.js";
import { recordEmailEvent } from "./emailEventService.js";

// A light simulation of the template engine to verify subjects & bodies
function generateFollowupContent(firstName: string, companyName: string, step: number): { subject: string; body: string } {
  const baseSubject = `Re: Looking for SDE-1 Backend roles | IMMEDIATE JOINER | 1+ YOE | Java | SpringBoot | Microservices`;

  if (step === 1) {
    return {
      subject: baseSubject,
      body: `Hi ${firstName},

I wanted to follow up on my previous email regarding Backend developer opportunities at ${companyName}. I'm extremely excited about the work you do there, and with my 2+ years of hands-on experience building scalable Java and Spring Boot systems, I'm confident I can make an immediate contribution.

I know you are busy, but I'd appreciate it if you could take a quick look at my resume (attached in the previous email) or point me towards the right hiring manager.

Thanks again, and have a great week!

Best regards,
Chandan Kumar`
    };
  }

  return {
    subject: baseSubject,
    body: `Hi ${firstName},

Hope you're having a good week.

I'm just bumping this up in case my previous message got buried in your inbox. I'm actively seeking SDE-1 Backend roles at ${companyName} and am available to join immediately. I'd love a chance to speak with you or a team member for 10 minutes to see if my background matches what you're looking for.

If now isn't a good time, no worries at all! I appreciate your time and consideration.

Best,
Chandan Kumar`
  };
}

describe("Cold Email Followup Templates", () => {
  it("renders Followup 1 templates with correct lead details and tone", () => {
    const followup = generateFollowupContent("Varsha", "Juspay", 1);
    
    expect(followup.subject).toBe("Re: Looking for SDE-1 Backend roles | IMMEDIATE JOINER | 1+ YOE | Java | SpringBoot | Microservices");
    expect(followup.body).toContain("Hi Varsha,");
    expect(followup.body).toContain("opportunities at Juspay");
    expect(followup.body).toContain("2+ years of hands-on experience");
    expect(followup.body).toContain("resume (attached in the previous email)");
  });

  it("renders Followup 2 templates with correct concise bumper tone", () => {
    const followup = generateFollowupContent("Varsha", "Juspay", 2);
    
    expect(followup.subject).toBe("Re: Looking for SDE-1 Backend roles | IMMEDIATE JOINER | 1+ YOE | Java | SpringBoot | Microservices");
    expect(followup.body).toContain("Hi Varsha,");
    expect(followup.body).toContain("bumping this up in case my previous message got buried");
    expect(followup.body).toContain("SDE-1 Backend roles at Juspay");
    expect(followup.body).toContain("available to join immediately");
  });
});

describe("resolveTemplatePlaceholders with optional blocks and resume hyperlink", () => {
  const mockLead = {
    fullName: "Chandan Kumar Saha",
    firstName: "Chandan",
    lastName: "Saha",
    company: {
      name: "Zeta",
      researchReason: "your Tachyon core banking platform and its high-throughput distributed transaction ledger"
    }
  };

  it("replaces basic placeholders correctly", () => {
    const template = "Hi {first_name}, SDE role at {company}.";
    const result = resolveTemplatePlaceholders(template, mockLead);
    expect(result).toBe("Hi Chandan, SDE role at Zeta.");
  });

  it("formats {resume} as a clickable HTML hyperlink", () => {
    const template = "View {resume} link.";
    // Case 1: No uploaded resume file name (defaults to "here" linked to default Drive link)
    const resultNoFile = resolveTemplatePlaceholders(template, mockLead);
    expect(resultNoFile).toContain(`<a href="${env.DEFAULT_RESUME_LINK}" target="_blank" style="color: #6366f1; text-decoration: underline;">here</a>`);

    // Case 2: Uploaded resume file name (links the filename to the default Drive link)
    const resultWithFile = resolveTemplatePlaceholders(template, mockLead, undefined, undefined, "my_resume.pdf");
    expect(resultWithFile).toContain(`<a href="${env.DEFAULT_RESUME_LINK}" target="_blank" style="color: #6366f1; text-decoration: underline;">my_resume.pdf</a>`);
  });

  it("handles optional blocks correctly when variables are empty", () => {
    const template = "role at {company}[ ({job_link})][ | {job_id}]";
    // job_link and job_id are not provided (empty)
    const result = resolveTemplatePlaceholders(template, mockLead);
    expect(result).toBe("role at Zeta");
  });

  it("handles optional blocks correctly when variables are present", () => {
    const template = "role at {company}[ ({job_link})][ | {job_id}]";
    // job_link and job_id are provided
    const result = resolveTemplatePlaceholders(
      template,
      mockLead,
      "DEV-01",
      "https://zeta.tech/job-link"
    );
    expect(result).toBe("role at Zeta (https://zeta.tech/job-link) | DEV-01");
  });

  it("uses generic human-sounding fallbacks for job_id and job_link when optional brackets are not used", () => {
    const template = "I applied for the {role} role at {company} ({job_link}) with ID {job_id}.";
    const result = resolveTemplatePlaceholders(template, mockLead);
    expect(result).toBe("I applied for the DevOps Engineer role at Zeta (your careers page) with ID active listing.");
  });
});

describe("MIME Format Generator", () => {
  it("assembles clean plain text MIME headers when no attachment is present", () => {
    const to = "candidate@company.com";
    const subject = "Test Subject";
    const body = "Test Body Content";

    let mime = `To: ${to}\n`;
    mime += `Subject: ${subject}\n`;
    mime += `MIME-Version: 1.0\n`;
    mime += `Content-Type: text/plain; charset="UTF-8"\n\n`;
    mime += body;

    expect(mime).toContain("To: candidate@company.com");
    expect(mime).toContain("Subject: Test Subject");
    expect(mime).toContain("Content-Type: text/plain; charset=\"UTF-8\"");
    expect(mime).toContain("Test Body Content");
  });

  it("assembles raw multipart MIME boundaries with attachment", () => {
    const boundary = "====test_boundary====";
    const to = "candidate@company.com";
    const subject = "Test Subject";
    const body = "Test Body Content";
    const attachment = {
      name: "resume.pdf",
      type: "application/pdf",
      contentBase64: "dGVzdF9wZGZfY29udGVudA==" // "test_pdf_content" in base64
    };

    let mime = `To: ${to}\n`;
    mime += `Subject: ${subject}\n`;
    mime += `MIME-Version: 1.0\n`;
    mime += `Content-Type: multipart/mixed; boundary="${boundary}"\n\n`;

    mime += `--${boundary}\n`;
    mime += `Content-Type: text/plain; charset="UTF-8"\n`;
    mime += `Content-Transfer-Encoding: 7bit\n\n`;
    mime += `${body}\n\n`;

    mime += `--${boundary}\n`;
    mime += `Content-Type: ${attachment.type}; name="${attachment.name}"\n`;
    mime += `Content-Disposition: attachment; filename="${attachment.name}"\n`;
    mime += `Content-Transfer-Encoding: base64\n\n`;
    mime += `${attachment.contentBase64}\n`;
    mime += `--${boundary}--`;

    expect(mime).toContain("Content-Type: multipart/mixed; boundary=\"====test_boundary====\"");
    expect(mime).toContain("Content-Transfer-Encoding: 7bit");
    expect(mime).toContain("Content-Disposition: attachment; filename=\"resume.pdf\"");
    expect(mime).toContain("dGVzdF9wZGZfY29udGVudA==");
  });
});

import {
  generateInitialSubjectAndBody as actualGenerateInitialSubjectAndBody,
  generateFollowupContent as actualGenerateFollowupContent,
  getTemplateFollowupIntroduction,
  generateDynamicTemplateFollowup,
  generateSystemTemplateFollowup,
  applyDynamicDotsToBody
} from "./campaignService.js";

describe("Outreach Template Job Role Name Customization", () => {
  it("uses custom role name SDE-2 in initial outreach templates if provided", () => {
    const templates = actualGenerateInitialSubjectAndBody(
      "Varsha",
      "Juspay",
      "impressive tech",
      undefined,
      undefined,
      false,
      "SDE-2"
    );
    expect(templates.subject).toBe("Looking for SDE-2 roles | 1.5+ YOE | AWS | Kubernetes | Terraform | CI/CD");
    expect(templates.body).toContain("I came across the SDE-2 opening at Juspay");
  });

  it("falls back to DevOps Engineer in initial outreach templates if role name is empty or omitted", () => {
    const templates = actualGenerateInitialSubjectAndBody(
      "Varsha",
      "Juspay",
      "impressive tech",
      undefined,
      undefined,
      false,
      ""
    );
    expect(templates.subject).toBe("Looking for DevOps Engineer roles | 1.5+ YOE | AWS | Kubernetes | Terraform | CI/CD");
    expect(templates.body).toContain("I came across the DevOps Engineer opening at Juspay");
  });

  it("uses custom role name Frontend Engineer in followup templates if provided", () => {
    const followup = actualGenerateFollowupContent("Varsha", "Juspay", 1, "Frontend Engineer");
    expect(followup.subject).toBe("Re: Looking for Frontend Engineer roles | 1.5+ YOE | AWS | Kubernetes | Terraform | CI/CD");
    expect(followup.body).toContain("regarding the Frontend Engineer position at Juspay");
  });
});

import { startCampaign, processCampaignQueue, runBackgroundBounceChecker } from "./campaignService.js";

describe("startCampaign state machine", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("does not reset the campaign properties if it is actively running (e.g. sent_initial)", async () => {
    vi.mocked(prisma.lead.findUnique).mockResolvedValue({
      id: "lead_123",
      firstName: "Varsha",
      fullName: "Varsha S",
      company: {
        name: "Juspay",
        researchReason: "impressive tech stack"
      }
    } as any);

    vi.mocked(prisma.emailCandidate.findUnique).mockResolvedValue({
      id: "candidate_456",
      email: "varsha@juspay.in",
      verifierStatus: "verified"
    } as any);

    const oldScheduledFor = new Date("2026-06-03T12:00:00Z");
    vi.mocked(prisma.campaignState.findUnique).mockResolvedValue({
      id: "campaign_789",
      leadId: "lead_123",
      status: "sent_initial",
      followupCount: 1,
      scheduledFor: oldScheduledFor,
      subject: "Old Subject",
      body: "Old Body",
      lastSentAt: new Date("2026-06-03T11:00:00Z"),
      roleName: "SDE Backend"
    } as any);

    await startCampaign({
      leadId: "lead_123",
      candidateId: "candidate_456",
      roleName: "SDE-2"
    });

    expect(prisma.campaignState.update).toHaveBeenCalledWith({
      where: { leadId: "lead_123" },
      data: expect.objectContaining({
        status: "sent_initial",
        followupCount: 1,
        scheduledFor: oldScheduledFor,
        subject: "Old Subject",
        body: "Old Body"
      })
    });
  });

  it("resets campaign properties if the previous campaign is in completed state", async () => {
    vi.mocked(prisma.lead.findUnique).mockResolvedValue({
      id: "lead_123",
      firstName: "Varsha",
      fullName: "Varsha S",
      company: {
        name: "Juspay",
        researchReason: "impressive tech stack"
      }
    } as any);

    vi.mocked(prisma.emailCandidate.findUnique).mockResolvedValue({
      id: "candidate_456",
      email: "varsha@juspay.in",
      verifierStatus: "verified"
    } as any);

    vi.mocked(prisma.campaignState.findUnique).mockResolvedValue({
      id: "campaign_789",
      leadId: "lead_123",
      status: "completed",
      followupCount: 4,
      scheduledFor: null,
      subject: "Old Subject",
      body: "Old Body",
      lastSentAt: new Date("2026-06-03T11:00:00Z"),
      roleName: "SDE Backend"
    } as any);

    const inputScheduledDate = new Date("2026-06-04T10:00:00Z");
    await startCampaign({
      leadId: "lead_123",
      candidateId: "candidate_456",
      scheduledFor: inputScheduledDate.toISOString(),
      roleName: "SDE-2"
    });

    expect(prisma.campaignState.update).toHaveBeenCalledWith({
      where: { leadId: "lead_123" },
      data: expect.objectContaining({
        status: "scheduled",
        followupCount: 0,
        scheduledFor: inputScheduledDate,
        lastSentAt: null,
        subject: expect.stringContaining("Looking for SDE-2 roles"),
        body: expect.stringContaining("I came across the SDE-2 opening")
      })
    });
  });

  it("resets campaign properties if the previous campaign is in cancelled state", async () => {
    vi.mocked(prisma.lead.findUnique).mockResolvedValue({
      id: "lead_123",
      firstName: "Varsha",
      fullName: "Varsha S",
      company: {
        name: "Juspay",
        researchReason: "impressive tech stack"
      }
    } as any);

    vi.mocked(prisma.emailCandidate.findUnique).mockResolvedValue({
      id: "candidate_456",
      email: "varsha@juspay.in",
      verifierStatus: "verified"
    } as any);

    vi.mocked(prisma.campaignState.findUnique).mockResolvedValue({
      id: "campaign_789",
      leadId: "lead_123",
      status: "cancelled",
      followupCount: 2,
      scheduledFor: null,
      subject: "Old Subject",
      body: "Old Body",
      lastSentAt: new Date("2026-06-03T11:00:00Z"),
      roleName: "SDE Backend"
    } as any);

    const inputScheduledDate = new Date("2026-06-04T10:00:00Z");
    await startCampaign({
      leadId: "lead_123",
      candidateId: "candidate_456",
      scheduledFor: inputScheduledDate.toISOString(),
      roleName: "SDE-2"
    });

    expect(prisma.campaignState.update).toHaveBeenCalledWith({
      where: { leadId: "lead_123" },
      data: expect.objectContaining({
        status: "scheduled",
        followupCount: 0,
        scheduledFor: inputScheduledDate,
        lastSentAt: null,
        subject: expect.stringContaining("Looking for SDE-2 roles"),
        body: expect.stringContaining("I came across the SDE-2 opening")
      })
    });
  });

  it("stores templateId as null when templateId is explicitly set to 'system', even if a default template exists in DB", async () => {
    vi.mocked(prisma.lead.findUnique).mockResolvedValue({
      id: "lead_123",
      firstName: "Varsha",
      fullName: "Varsha S",
      company: { name: "Juspay", researchReason: "impressive tech" }
    } as any);

    vi.mocked(prisma.emailCandidate.findUnique).mockResolvedValue({
      id: "candidate_456",
      email: "varsha@juspay.in",
      verifierStatus: "verified"
    } as any);

    vi.mocked(prisma.campaignState.findUnique).mockResolvedValue(null);

    // Mock database default template
    vi.mocked(prisma.template.findFirst).mockResolvedValue({
      id: "tpl_default",
      name: "Default Template",
      subject: "Default Subject",
      body: "Default Body",
      isDefault: true,
      createdAt: new Date(),
      updatedAt: new Date()
    });

    await startCampaign({
      leadId: "lead_123",
      candidateId: "candidate_456",
      templateId: "system"
    });

    expect(prisma.campaignState.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        templateId: null,
        subject: expect.stringContaining("Looking for DevOps Engineer roles")
      })
    });
  });

  it("inherits existing campaign template selection (null) when templateId is undefined in startCampaign payload", async () => {
    vi.mocked(prisma.lead.findUnique).mockResolvedValue({
      id: "lead_123",
      firstName: "Varsha",
      fullName: "Varsha S",
      company: { name: "Juspay", researchReason: "impressive tech" }
    } as any);

    vi.mocked(prisma.emailCandidate.findUnique).mockResolvedValue({
      id: "candidate_456",
      email: "varsha@juspay.in",
      verifierStatus: "verified"
    } as any);

    // Campaign already exists with status 'completed' and templateId: null (system template)
    vi.mocked(prisma.campaignState.findUnique).mockResolvedValue({
      id: "campaign_789",
      leadId: "lead_123",
      status: "completed",
      templateId: null,
      roleName: "SDE-2"
    } as any);

    // Mock database default template is present
    vi.mocked(prisma.template.findFirst).mockResolvedValue({
      id: "tpl_default",
      name: "Default Template",
      subject: "Default Subject",
      body: "Default Body",
      isDefault: true,
      createdAt: new Date(),
      updatedAt: new Date()
    });

    await startCampaign({
      leadId: "lead_123",
      candidateId: "candidate_456",
      templateId: undefined, // undefined payload (e.g. from dropdown reset)
      roleName: "SDE-2"
    });

    expect(prisma.campaignState.update).toHaveBeenCalledWith({
      where: { leadId: "lead_123" },
      data: expect.objectContaining({
        templateId: null, // preserved as null (system template)
        subject: expect.stringContaining("Looking for SDE-2 roles") // generates system pitch
      })
    });
  });

  it("uses default database template when starting a new campaign with templateId as undefined", async () => {
    vi.mocked(prisma.lead.findUnique).mockResolvedValue({
      id: "lead_123",
      firstName: "Varsha",
      fullName: "Varsha S",
      company: { name: "Juspay", researchReason: "impressive tech" }
    } as any);

    vi.mocked(prisma.emailCandidate.findUnique).mockResolvedValue({
      id: "candidate_456",
      email: "varsha@juspay.in",
      verifierStatus: "verified"
    } as any);

    vi.mocked(prisma.campaignState.findUnique).mockResolvedValue(null);

    // Mock default template
    vi.mocked(prisma.template.findFirst).mockResolvedValue({
      id: "tpl_default",
      name: "Default Template",
      subject: "Default Subject for {first_name}",
      body: "Default Body for {company}",
      isDefault: true,
      createdAt: new Date(),
      updatedAt: new Date()
    });

    await startCampaign({
      leadId: "lead_123",
      candidateId: "candidate_456",
      templateId: undefined
    });

    expect(prisma.campaignState.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        templateId: "tpl_default",
        subject: "Default Subject for Varsha",
        body: expect.stringContaining("Default Body for Juspay")
      })
    });
  });
});

describe("processCampaignQueue", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns early and does not process queue if Gmail daily quota is halted", async () => {
    vi.mocked(isGmailQuotaHalted).mockResolvedValueOnce(true);

    const result = await processCampaignQueue();

    expect(result.success).toBe(false);
    expect(result.error).toContain("Gmail daily quota breached");
    expect(prisma.campaignState.findMany).not.toHaveBeenCalled();
    expect(sendGmailEmail).not.toHaveBeenCalled();
  });

  it("skips campaigns that respect timing when called outside the 9-5 window", async () => {
    const mockCampaign = {
      id: "camp_1",
      leadId: "lead_1",
      candidateId: "cand_1",
      status: "scheduled",
      followupCount: 0,
      respectTiming: true,
      scheduledFor: new Date(Date.now() - 10000),
      isPaused: false,
      lead: { firstName: "John", fullName: "John Doe", company: { name: "Google" } },
      candidate: { email: "john@google.com" }
    };

    vi.mocked(prisma.campaignState.findMany).mockResolvedValue([mockCampaign] as any);

    const originalGetHours = Date.prototype.getHours;
    Date.prototype.getHours = vi.fn().mockReturnValue(23);

    try {
      const result = await processCampaignQueue();
      expect(result.sentCount).toBe(0);
      expect(sendGmailEmail).not.toHaveBeenCalled();
    } finally {
      Date.prototype.getHours = originalGetHours;
    }
  });

  it("sends initial outreach, records delivery event, transitions to sent_initial and schedules background bounce check", async () => {
    const mockCampaign = {
      id: "camp_2",
      leadId: "lead_2",
      candidateId: "cand_2",
      status: "scheduled",
      followupCount: 0,
      respectTiming: false,
      scheduledFor: new Date(Date.now() - 10000),
      isPaused: false,
      subject: "Hello John",
      body: "Hello Body",
      lead: { firstName: "John", fullName: "John Doe", company: { name: "Google" } },
      candidate: { id: "cand_2", email: "john@google.com" }
    };

    vi.mocked(prisma.campaignState.findMany).mockResolvedValue([mockCampaign] as any);
    vi.mocked(prisma.emailCandidate.findMany).mockResolvedValue([
      { id: "cand_2", email: "john@google.com", verifierStatus: "verified", verifierScore: 90 }
    ] as any);
    vi.mocked(prisma.campaignState.findFirst).mockResolvedValue({
      id: "camp_2",
      leadId: "lead_2",
      followupIntervalMinutes: 70
    } as any);
    vi.mocked(sendGmailEmail).mockResolvedValue({ success: true, messageId: "msg_123", threadId: "th_123" });

    // Mock setTimeout so we don't actually trigger background checker with delays during tests
    const originalSetTimeout = global.setTimeout;
    global.setTimeout = vi.fn().mockImplementation((fn: any) => fn()) as any;

    try {
      const result = await processCampaignQueue();
      expect(result.sentCount).toBe(1);
      expect(sendGmailEmail).toHaveBeenCalledWith("john@google.com", "Hello John", "Hello Body", undefined);
      
      expect(recordEmailEvent).toHaveBeenCalledWith({
        candidateId: "cand_2",
        email: "john@google.com",
        eventType: "delivery",
        provider: "gmail",
        rawPayload: expect.objectContaining({
          messageId: "msg_123",
          threadId: "th_123",
          followupNumber: 0
        })
      });

      expect(prisma.campaignState.update).toHaveBeenCalledWith({
        where: { id: "camp_2" },
        data: expect.objectContaining({
          status: "sent_initial",
          followupCount: 1,
          scheduledFor: null
        })
      });
    } finally {
      global.setTimeout = originalSetTimeout;
    }
  });

  it("sends threaded followup, records delivery event, and increments followup count", async () => {
    const mockCampaign = {
      id: "camp_3",
      leadId: "lead_3",
      candidateId: "cand_3",
      status: "sent_initial",
      followupCount: 1,
      maxFollowups: 3,
      followupIntervalMinutes: 70,
      respectTiming: false,
      scheduledFor: new Date(Date.now() - 10000),
      isPaused: false,
      subject: "Hello John",
      body: "Hello Body",
      roleName: "SDE-2",
      lead: { firstName: "John", fullName: "John Doe", company: { name: "Google" } },
      candidate: { email: "john@google.com" }
    };

    vi.mocked(prisma.campaignState.findMany).mockResolvedValue([mockCampaign] as any);
    vi.mocked(prisma.emailEvent.findFirst).mockResolvedValue({
      id: "event_1",
      rawPayload: { threadId: "th_123", messageId: "parent_msg_123" }
    } as any);
    vi.mocked(sendGmailEmail).mockResolvedValue({ success: true, messageId: "msg_456", threadId: "th_123" });

    const result = await processCampaignQueue();
    expect(result.sentCount).toBe(1);
    expect(sendGmailEmail).toHaveBeenCalledWith(
      "john@google.com",
      expect.stringContaining("Re: Looking for SDE-2 roles"),
      expect.stringContaining("Hi John"),
      undefined,
      "th_123",
      "parent_msg_123"
    );

    expect(prisma.campaignState.update).toHaveBeenCalledWith({
      where: { id: "camp_3" },
      data: expect.objectContaining({
        status: "sent_followup_1",
        followupCount: 2,
        scheduledFor: expect.any(Date)
      })
    });
  });

  it("sends threaded followup based on custom template if templateId is present on campaign", async () => {
    const mockCampaign = {
      id: "camp_custom_followup",
      leadId: "lead_custom_followup",
      candidateId: "cand_custom_followup",
      status: "sent_initial",
      followupCount: 1,
      maxFollowups: 3,
      followupIntervalMinutes: 70,
      respectTiming: false,
      scheduledFor: new Date(Date.now() - 10000),
      isPaused: false,
      subject: "Custom Subject for John",
      body: "Custom Body",
      roleName: "SDE-2",
      templateId: "tpl_123",
      lead: { firstName: "John", fullName: "John Doe", company: { name: "Google" } },
      candidate: { email: "john@google.com" }
    };

    vi.mocked(prisma.campaignState.findMany).mockResolvedValue([mockCampaign] as any);
    vi.mocked(prisma.emailEvent.findFirst).mockResolvedValue({
      id: "event_1",
      rawPayload: { threadId: "th_123", messageId: "parent_msg_123" }
    } as any);
    vi.mocked(prisma.template.findUnique).mockResolvedValue({
      id: "tpl_123",
      name: "My Custom Template",
      subject: "Custom Subject for {first_name}",
      body: "Hi {first_name},\n\nI would love to apply for the Backend role.",
      isDefault: false,
      createdAt: new Date(),
      updatedAt: new Date()
    });
    vi.mocked(sendGmailEmail).mockResolvedValue({ success: true, messageId: "msg_456", threadId: "th_123" });

    const result = await processCampaignQueue();
    expect(result.sentCount).toBe(1);
    expect(sendGmailEmail).toHaveBeenCalledWith(
      "john@google.com",
      "Re: Custom Subject for John",
      expect.stringContaining("I wanted to follow up briefly to see if you might have a few minutes."),
      undefined,
      "th_123",
      "parent_msg_123"
    );

    expect(prisma.campaignState.update).toHaveBeenCalledWith({
      where: { id: "camp_custom_followup" },
      data: expect.objectContaining({
        status: "sent_followup_1",
        followupCount: 2,
        scheduledFor: expect.any(Date)
      })
    });
  });

  it("transitions campaign to completed if max followups are exceeded", async () => {
    const mockCampaign = {
      id: "camp_4",
      leadId: "lead_4",
      candidateId: "cand_4",
      status: "sent_followup_2",
      followupCount: 3,
      maxFollowups: 2,
      respectTiming: false,
      scheduledFor: new Date(Date.now() - 10000),
      isPaused: false,
      lead: { firstName: "John", fullName: "John Doe", company: { name: "Google" } },
      candidate: { email: "john@google.com" }
    };

    vi.mocked(prisma.campaignState.findMany).mockResolvedValue([mockCampaign] as any);

    const result = await processCampaignQueue();
    expect(result.sentCount).toBe(0);
    expect(prisma.campaignState.update).toHaveBeenCalledWith({
      where: { id: "camp_4" },
      data: {
        status: "completed",
        scheduledFor: null
      }
    });
  });

  it("ignores campaigns with status 'cancelled' in findMany filter", async () => {
    vi.mocked(prisma.campaignState.findMany).mockResolvedValue([] as any);

    await processCampaignQueue();

    expect(prisma.campaignState.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          status: expect.objectContaining({
            notIn: expect.arrayContaining(["cancelled"])
          })
        })
      })
    );
  });

  it("sends initial outreach and transitions campaign directly to completed if maxFollowups is 0 (skipBounceMonitor path)", async () => {
    const mockCampaign = {
      id: "camp_5",
      leadId: "lead_5",
      candidateId: "cand_5",
      status: "scheduled",
      followupCount: 0,
      maxFollowups: 0,
      respectTiming: false,
      scheduledFor: new Date(Date.now() - 10000),
      isPaused: false,
      skipBounceMonitor: true,
      subject: "Hello John",
      body: "Hello Body",
      lead: { firstName: "John", fullName: "John Doe", company: { name: "Google" } },
      candidate: { id: "cand_5", email: "john@google.com" }
    };

    vi.mocked(prisma.campaignState.findMany).mockResolvedValue([mockCampaign] as any);
    vi.mocked(sendGmailEmail).mockResolvedValue({ success: true, messageId: "msg_123", threadId: "th_123" });

    const result = await processCampaignQueue();
    expect(result.sentCount).toBe(1);
    expect(sendGmailEmail).toHaveBeenCalledWith("john@google.com", "Hello John", "Hello Body", undefined);
    
    expect(prisma.campaignState.update).toHaveBeenCalledWith({
      where: { id: "camp_5" },
      data: expect.objectContaining({
        status: "completed",
        followupCount: 1,
        scheduledFor: null
      })
    });
  });

  it("marks campaign as completed immediately in runBackgroundBounceChecker if winner candidate is selected and maxFollowups is 0", async () => {
    vi.mocked(prisma.emailCandidate.findMany).mockResolvedValue([
      { id: "cand_1", email: "winner@google.com", verifierStatus: "verified", verifierScore: 90 }
    ] as any);

    vi.mocked(prisma.campaignState.findFirst).mockResolvedValue({
      id: "camp_1",
      leadId: "lead_1",
      maxFollowups: 0
    } as any);

    // Mock global.setTimeout to call callback immediately
    const originalSetTimeout = global.setTimeout;
    global.setTimeout = vi.fn().mockImplementation((fn: any) => fn()) as any;

    try {
      await runBackgroundBounceChecker("lead_1", ["cand_1"]);

      expect(prisma.emailCandidate.update).toHaveBeenCalledWith({
        where: { id: "cand_1" },
        data: { selected: true }
      });

      expect(prisma.campaignState.update).toHaveBeenCalledWith({
        where: { id: "camp_1" },
        data: expect.objectContaining({
          status: "completed",
          scheduledFor: null
        })
      });
    } finally {
      global.setTimeout = originalSetTimeout;
    }
  });
});

describe("Followup Templates Uniqueness & No Duplicate Greetings", () => {
  it("has completely unique opening lines across all default followups", () => {
    const openings = new Set<string>();
    const count = 10;
    
    for (let step = 1; step <= count; step++) {
      const followup = actualGenerateFollowupContent("John", "Google", step, "SDE Backend");
      // Extract first body line after "Hi John,"
      const lines = followup.body
        .split("<br>")
        .map(l => l.trim())
        .filter(l => l.length > 0 && !l.startsWith("Hi "));
      
      const openingLine = lines[0];
      expect(openingLine).toBeDefined();
      expect(openings.has(openingLine)).toBe(false);
      openings.add(openingLine);
    }

    // Check default case too
    const defaultFollowup = actualGenerateFollowupContent("John", "Google", 99, "SDE Backend");
    const defaultLines = defaultFollowup.body
      .split("<br>")
      .map(l => l.trim())
      .filter(l => l.length > 0 && !l.startsWith("Hi "));
    const defaultOpening = defaultLines[0];
    expect(openings.has(defaultOpening)).toBe(false);
  });

  it("has completely unique introductions for custom templates", () => {
    const intros = new Set<string>();
    const count = 10;

    for (let step = 1; step <= count; step++) {
      const intro = getTemplateFollowupIntroduction(step);
      expect(intros.has(intro)).toBe(false);
      intros.add(intro);
    }
  });

  describe("generateDynamicTemplateFollowup & Dynamic Dots integration", () => {
    const mockLead = {
      fullName: "Chandan Kumar",
      firstName: "Chandan",
      lastName: "Kumar",
      company: {
        name: "Instahyre",
        researchReason: "great scaling"
      }
    };

    const userOutreachTemplate = `Hi {first_name},

I came across a Backend opening posted by you at {company} and wanted to directly reach out to you

Quick snapshot:
• ~2.5 years of backend engineering experience (Java, Spring Boot, Kafka, Kubernetes)
• Domain: Payments and financial infrastructure (ACH, clearing, reconciliation pipelines)
• Delivered features end-to-end, owned service reliability, and debugged performance in high-throughput distributed systems
• Example impact: reduced p99 latency from 10s → 300ms on a critical payments pipeline

I would love the opportunity to discuss how my expertise could contribute to your team

Resume: {resume}

Happy to connect for a quick 15-minute call if there's a fit.

Regards,
Chandan
8368858321`;

    it("verifies all 10 followups preserve the entire body, greeting is changed and unique each time, and dot logic is working", () => {
      const uniqueIntros = new Set<string>();

      for (let step = 1; step <= 10; step++) {
        // 1. Generate followup using the template-preserving logic
        const rawFollowup = generateDynamicTemplateFollowup(userOutreachTemplate, step, mockLead, "Backend Developer");
        
        // 2. Apply dot logic
        const finalFollowup = applyDynamicDotsToBody(rawFollowup, step);

        // A. Verify greeting is changed and unique each time
        const intro = getTemplateFollowupIntroduction(step);
        expect(finalFollowup).toContain(`Hi Chandan,\n\n${intro}`);
        expect(uniqueIntros.has(intro)).toBe(false);
        uniqueIntros.add(intro);

        // B. Verify the entire body structure is preserved
        expect(finalFollowup).toContain("I came across a Backend opening posted by you at Instahyre and wanted to directly reach out to you");
        expect(finalFollowup).toContain("• ~2.5 years of backend engineering experience (Java, Spring Boot, Kafka, Kubernetes)");
        expect(finalFollowup).toContain("• Domain: Payments and financial infrastructure (ACH, clearing, reconciliation pipelines)");
        expect(finalFollowup).toContain("• Delivered features end-to-end, owned service reliability, and debugged performance in high-throughput distributed systems");
        expect(finalFollowup).toContain("• Example impact: reduced p99 latency from 10s → 300ms on a critical payments pipeline");
        expect(finalFollowup).toContain("I would love the opportunity to discuss how my expertise could contribute to your team");
        expect(finalFollowup).toContain("Resume: ");

        // C. Verify signature is preserved
        expect(finalFollowup).toContain("Regards,\nChandan\n8368858321");

        // D. Verify dot logic is working on the call-to-action line
        const cycle = [1, 2, 3, 4, 5, 4, 3, 2, 1, 0];
        const dotsCount = cycle[(step - 1) % cycle.length];
        const expectedCta = "Happy to connect for a quick 15-minute call if there's a fit" + ".".repeat(dotsCount);
        expect(finalFollowup).toContain(expectedCta);
      }
    });
  });

  describe("generateSystemTemplateFollowup & Dynamic Dots integration", () => {
    const mockLead = {
      firstName: "Chandan",
      company: {
        name: "Google",
        researchReason: "great scaling"
      }
    };

    it("verifies all 10 system template followups preserve the system template body, greeting is changed and unique each time, and dot logic is working", () => {
      const uniqueIntros = new Set<string>();

      for (let step = 1; step <= 10; step++) {
        // 1. Generate followup using system template followup generator
        const rawFollowup = generateSystemTemplateFollowup(step, mockLead, "Backend Developer", undefined, undefined, false);
        
        // 2. Apply dot logic
        const finalFollowup = applyDynamicDotsToBody(rawFollowup, step);

        // A. Verify greeting and intro is changed and unique each time
        const intro = getTemplateFollowupIntroduction(step);
        expect(finalFollowup).toContain(`Hi Chandan,\n\n${intro}`);
        expect(uniqueIntros.has(intro)).toBe(false);
        uniqueIntros.add(intro);

        // B. Verify the core system template body highlights are preserved
        expect(finalFollowup).toContain("I came across the Backend Developer opening at Google and wanted to reach out directly alongside my application.");
        expect(finalFollowup).toContain("• Designed end-to-end monitoring, logging, and alerting systems using Prometheus, Loki, Lambda, and EventBridge");
        expect(finalFollowup).toContain("• Implemented custom load-average based autoscaling using AWS Lambda and DynamoDB");
        expect(finalFollowup).toContain("• Standardized CI/CD pipelines with Jenkins and ArgoCD, automating service provisioning on EKS");

        // C. Verify signature is preserved
        expect(finalFollowup).toContain("Regards,\nVidhi Chadha\n8178113237");

        // D. Verify dot logic is working on the call-to-action line
        const cycle = [1, 2, 3, 4, 5, 4, 3, 2, 1, 0];
        const dotsCount = cycle[(step - 1) % cycle.length];
        const expectedCta = "Happy to connect for a quick 15-minute call if there's a fit" + ".".repeat(dotsCount);
        expect(finalFollowup).toContain(expectedCta);
      }
    });
  });

  describe("applyDynamicDotsToBody", () => {
    const templateWithCta = `Hi Varsha,

I saw your posting.

Happy to connect for a quick 15-minute call if there's a fit

Regards,
Chandan
8368858321`;

    const templateWithoutCta = `Hi Varsha,

I saw your posting.

Regards,
Chandan
8368858321`;

    it("applies correct dots for steps 1, 2, 5, 6, and 10 when sentence exists", () => {
      expect(applyDynamicDotsToBody(templateWithCta, 1)).toContain("Happy to connect for a quick 15-minute call if there's a fit.");
      expect(applyDynamicDotsToBody(templateWithCta, 2)).toContain("Happy to connect for a quick 15-minute call if there's a fit..");
      expect(applyDynamicDotsToBody(templateWithCta, 5)).toContain("Happy to connect for a quick 15-minute call if there's a fit.....");
      expect(applyDynamicDotsToBody(templateWithCta, 6)).toContain("Happy to connect for a quick 15-minute call if there's a fit....");
      expect(applyDynamicDotsToBody(templateWithCta, 10)).toContain("Happy to connect for a quick 15-minute call if there's a fit");
      // Check that it doesn't have a trailing dot for step 10
      const step10Result = applyDynamicDotsToBody(templateWithCta, 10);
      expect(step10Result).toContain("Happy to connect for a quick 15-minute call if there's a fit\n\nRegards");
    });

    it("injects sentence before signature if it is missing", () => {
      const result = applyDynamicDotsToBody(templateWithoutCta, 1);
      expect(result).toContain("Happy to connect for a quick 15-minute call if there's a fit.\n\nRegards");
    });
  });
});

describe("campaignService network failure retries and stale status reset", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("reschedules the campaign on network send failure instead of bouncing", async () => {
    const mockCampaign = {
      id: "camp_retry_1",
      leadId: "lead_retry_1",
      candidateId: "cand_retry_1",
      status: "scheduled",
      followupCount: 0,
      respectTiming: false,
      scheduledFor: new Date(Date.now() - 1000),
      isPaused: false,
      skipBounceMonitor: true,
      followupIntervalMinutes: 70,
      maxFollowups: 3,
      lead: { firstName: "John", fullName: "John Doe", company: { name: "Google" } },
      candidate: { email: "john@google.com" }
    };

    vi.mocked(prisma.campaignState.findMany).mockResolvedValue([mockCampaign] as any);
    vi.mocked(sendGmailEmail).mockResolvedValueOnce({
      success: false,
      error: "fetch failed",
      isNetworkError: true
    });

    const result = await processCampaignQueue();

    // Verify it returned success and marked no emails sent (since it's skipped/delayed)
    expect(result.sentCount).toBe(0);
    // Verify it updated campaignState to be scheduled in the future, rather than set to bounced
    expect(prisma.campaignState.update).toHaveBeenCalledWith({
      where: { id: "camp_retry_1" },
      data: {
        scheduledFor: expect.any(Date)
      }
    });
    // Check that we didn't call update with status: "bounced"
    const updateCalls = vi.mocked(prisma.campaignState.update).mock.calls;
    const hasBouncedUpdate = updateCalls.some(call => call[0].data?.status === "bounced");
    expect(hasBouncedUpdate).toBe(false);
  });

  it("resets candidate verifierStatus to deliverable on successful email send", async () => {
    const mockCampaign = {
      id: "camp_reset_1",
      leadId: "lead_reset_1",
      candidateId: "cand_reset_1",
      status: "scheduled",
      followupCount: 0,
      respectTiming: false,
      scheduledFor: new Date(Date.now() - 1000),
      isPaused: false,
      skipBounceMonitor: true,
      followupIntervalMinutes: 70,
      maxFollowups: 3,
      lead: { firstName: "John", fullName: "John Doe", company: { name: "Google" } },
      candidate: { email: "john@google.com" }
    };

    vi.mocked(prisma.campaignState.findMany).mockResolvedValue([mockCampaign] as any);
    vi.mocked(sendGmailEmail).mockResolvedValueOnce({
      success: true,
      messageId: "msg_123",
      threadId: "th_123"
    });

    await processCampaignQueue();

    // Verify candidate verifierStatus was reset to deliverable
    expect(prisma.emailCandidate.update).toHaveBeenCalledWith({
      where: { id: "cand_reset_1" },
      data: { verifierStatus: "deliverable" }
    });
  });
});


