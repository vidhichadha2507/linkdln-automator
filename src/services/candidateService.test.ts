import { describe, expect, it, vi, beforeEach } from "vitest";

const mockEnv = vi.hoisted(() => {
  return {
    ENABLE_AI_PATTERN_DISCOVERY: true,
    NODE_ENV: "test"
  };
});

vi.mock("../config/env.js", () => {
  return {
    env: mockEnv
  };
});

// Set up mocks
vi.mock("../lib/prisma.js", () => {
  return {
    prisma: {
      company: {
        upsert: vi.fn(),
        findUnique: vi.fn(),
        update: vi.fn()
      },
      lead: {
        create: vi.fn(),
        findUnique: vi.fn()
      },
      emailAlgorithm: {
        findUnique: vi.fn(),
        create: vi.fn(),
        update: vi.fn()
      },
      companyEmailAlgorithm: {
        findMany: vi.fn(),
        upsert: vi.fn(),
        update: vi.fn()
      },
      emailCandidate: {
        create: vi.fn(),
        findUnique: vi.fn(),
        update: vi.fn(),
        findMany: vi.fn()
      },
      campaignState: {
        findFirst: vi.fn(),
        update: vi.fn()
      },
      suppressionEntry: {
        findFirst: vi.fn(),
        create: vi.fn()
      }
    }
  };
});

vi.mock("../lib/gemini.js", () => {
  return {
    callGeminiWithFallback: vi.fn()
  };
});

vi.mock("../modules/domainResolver.js", () => {
  return {
    resolveCompanyDomain: vi.fn().mockResolvedValue({ domain: "google.com", confidence: 100, source: "mock" })
  };
});

vi.mock("../modules/emailValidation.js", () => {
  return {
    hasValidMx: vi.fn().mockResolvedValue(true),
    isSyntaxValidEmail: vi.fn().mockReturnValue(true)
  };
});

vi.mock("./emailVerifierService.js", () => {
  return {
    verifyEmail: vi.fn().mockResolvedValue({ status: "valid", score: 90, provider: "local" })
  };
});

vi.mock("./candidateSelectionService.js", () => {
  return {
    selectBestCandidate: vi.fn()
  };
});

vi.mock("./campaignService.js", () => {
  return {
    startCampaign: vi.fn(),
    processCampaignQueue: vi.fn().mockResolvedValue({ sentCount: 1 }),
    runBackgroundBounceChecker: vi.fn().mockResolvedValue(null)
  };
});

vi.mock("./algorithmEnrichmentService.js", () => {
  return {
    getAlgorithmSuggestions: vi.fn().mockResolvedValue([])
  };
});

import { prisma } from "../lib/prisma.js";
import { callGeminiWithFallback } from "../lib/gemini.js";
import { resolveCompanyDomain } from "../modules/domainResolver.js";
import { hasValidMx } from "../modules/emailValidation.js";
import { selectBestCandidate } from "./candidateSelectionService.js";
import { startCampaign } from "./campaignService.js";
import { generateCandidates, discoverAlternativeCandidates } from "./candidateService.js";

describe("candidateService", () => {
  beforeEach(() => {
    mockEnv.ENABLE_AI_PATTERN_DISCOVERY = true;
    vi.clearAllMocks();
  });

  describe("generateCandidates", () => {
    it("runs successfully from name parsing to auto-dispatching campaign", async () => {
      // Arrange
      const mockCompany = { id: "comp_1", name: "Google", domain: "google.com", researchReason: "some reason" };
      const mockLead = { id: "lead_1", fullName: "John Doe", firstName: "John", lastName: "Doe", companyId: "comp_1" };
      const mockAlgo = { id: "algo_1", key: "first_last", patternTemplate: "{first}.{last}@{domain}", description: "" };
      const mockCandidate = { id: "cand_1", email: "john.doe@google.com", verifierStatus: "valid", algorithm: mockAlgo };

      vi.mocked(prisma.company.upsert).mockResolvedValue(mockCompany as any);
      vi.mocked(prisma.company.findUnique).mockResolvedValue(mockCompany as any);
      vi.mocked(prisma.lead.create).mockResolvedValue(mockLead as any);
      vi.mocked(prisma.companyEmailAlgorithm.findMany).mockResolvedValue([
        { companyId: "comp_1", algorithmId: "algo_1", algorithm: mockAlgo }
      ] as any);
      vi.mocked(prisma.emailCandidate.create).mockResolvedValue(mockCandidate as any);
      vi.mocked(selectBestCandidate).mockResolvedValue(mockCandidate as any);
      vi.mocked(prisma.emailCandidate.findMany).mockResolvedValue([mockCandidate] as any);

      // Act
      const result = await generateCandidates({
        fullName: "John Doe",
        companyName: "Google",
        domain: "google.com"
      });

      // Assert
      expect(resolveCompanyDomain).toHaveBeenCalledWith("Google", "google.com");
      expect(hasValidMx).toHaveBeenCalledWith("google.com");
      expect(prisma.company.upsert).toHaveBeenCalled();
      expect(prisma.lead.create).toHaveBeenCalled();
      expect(prisma.emailCandidate.create).toHaveBeenCalled();
      expect(selectBestCandidate).toHaveBeenCalled();
      expect(startCampaign).toHaveBeenCalledWith({
        leadId: "lead_1",
        candidateId: "cand_1",
        autoFollowup: true,
        followupIntervalHours: 72
      });

      expect(result.lead).toEqual(mockLead);
      expect(result.selectedCandidate).toEqual(mockCandidate);
    });

    it("throws error if domain has no active mail server (MX records)", async () => {
      vi.mocked(hasValidMx).mockResolvedValue(false);

      await expect(
        generateCandidates({
          fullName: "John Doe",
          companyName: "NoMx Corp"
        })
      ).rejects.toThrow("has no active mail server");
    });
  });

  describe("discoverAlternativeCandidates", () => {
    it("returns false if lead or company is missing", async () => {
      vi.mocked(prisma.lead.findUnique).mockResolvedValue(null);

      const result = await discoverAlternativeCandidates("lead_null", ["old@google.com"]);
      expect(result).toBe(false);
    });

    it("queries Gemini, registers alternative candidate, and updates campaign on success", async () => {
      // Arrange
      const mockLead = {
        id: "lead_1",
        fullName: "John Doe",
        firstName: "John",
        companyId: "comp_1",
        company: { id: "comp_1", name: "Google", domain: "google.com" }
      };

      const geminiResponse = {
        algorithms: [
          {
            key: "alt_key",
            patternTemplate: "{first}{last_initial}@{domain}",
            description: "alt desc",
            example: "alt ex",
            confidenceScore: 80
          }
        ]
      };

      vi.mocked(prisma.lead.findUnique).mockResolvedValue(mockLead as any);
      vi.mocked(callGeminiWithFallback).mockResolvedValue(JSON.stringify(geminiResponse));
      vi.mocked(prisma.emailAlgorithm.findUnique).mockResolvedValue(null);
      vi.mocked(prisma.emailAlgorithm.create).mockResolvedValue({ id: "algo_alt", key: "alt_alt_key", patternTemplate: "{first}{last_initial}@{domain}" } as any);
      vi.mocked(prisma.companyEmailAlgorithm.upsert).mockResolvedValue({} as any);

      const mockCandidate = { id: "cand_alt", email: "johnd@google.com", verifierScore: 85 };
      vi.mocked(prisma.emailCandidate.create).mockResolvedValue(mockCandidate as any);
      
      const mockCampaign = { id: "camp_1", leadId: "lead_1" };
      vi.mocked(prisma.campaignState.findFirst).mockResolvedValue(mockCampaign as any);

      // Act
      const result = await discoverAlternativeCandidates("lead_1", ["john.doe@google.com"]);

      // Assert
      expect(result).toBe(true);
      expect(callGeminiWithFallback).toHaveBeenCalled();
      expect(prisma.emailCandidate.create).toHaveBeenCalled();
      expect(prisma.campaignState.update).toHaveBeenCalledWith({
        where: { id: "camp_1" },
        data: expect.objectContaining({
          candidateId: "cand_alt",
          status: "scheduled",
          followupCount: 0
        })
      });
    });

    it("returns false and marks campaign as bounced early if ENABLE_AI_PATTERN_DISCOVERY is false", async () => {
      // Arrange
      mockEnv.ENABLE_AI_PATTERN_DISCOVERY = false;
      const mockCampaign = { id: "camp_1", leadId: "lead_1" };
      vi.mocked(prisma.campaignState.findFirst).mockResolvedValue(mockCampaign as any);

      // Act
      const result = await discoverAlternativeCandidates("lead_1", ["john.doe@google.com"]);

      // Assert
      expect(result).toBe(false);
      expect(prisma.campaignState.update).toHaveBeenCalledWith({
        where: { id: "camp_1" },
        data: {
          status: "bounced",
          scheduledFor: null
        }
      });
    });
  });
});
