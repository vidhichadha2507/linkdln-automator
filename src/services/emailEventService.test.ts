import { describe, expect, it, vi, beforeEach } from "vitest";

// Mocks
vi.mock("../lib/prisma.js", () => {
  return {
    prisma: {
      emailCandidate: {
        findUnique: vi.fn(),
        findFirst: vi.fn(),
        findMany: vi.fn(),
        update: vi.fn(),
      },
      campaignState: {
        findFirst: vi.fn(),
        update: vi.fn(),
      },
      emailEvent: {
        create: vi.fn(),
      },
      companyEmailAlgorithm: {
        update: vi.fn(),
      },
    }
  };
});

vi.mock("./suppressionService.js", () => {
  return {
    addSuppression: vi.fn(),
    checkSuppression: vi.fn(),
  };
});

vi.mock("./candidateService.js", () => {
  return {
    discoverAlternativeCandidates: vi.fn()
  };
});

import { prisma } from "../lib/prisma.js";
import { addSuppression } from "./suppressionService.js";
import { discoverAlternativeCandidates } from "./candidateService.js";
import { normalizeProviderEventType, recordEmailEvent } from "./emailEventService.js";

describe("normalizeProviderEventType", () => {
  it("maps common provider event names to internal event types", () => {
    expect(normalizeProviderEventType("Bounce")).toBe("bounce");
    expect(normalizeProviderEventType("Complaint")).toBe("complaint");
    expect(normalizeProviderEventType("Delivered")).toBe("delivery");
    expect(normalizeProviderEventType("Open")).toBe("open");
    expect(normalizeProviderEventType("Reply")).toBe("reply");
    expect(normalizeProviderEventType("Unsubscribe")).toBe("unsubscribe");
  });

  it("uses unknown for unrecognized provider events", () => {
    expect(normalizeProviderEventType("provider.custom.event")).toBe("unknown");
  });
});

describe("recordEmailEvent and applyEventLearning", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const mockCandidate = {
    id: "cand_1",
    leadId: "lead_1",
    email: "test@example.com",
    companyId: "comp_1",
    algorithmId: "algo_1"
  };

  it("skips auto-rotation for sent_initial campaign if skipBounceMonitor is false", async () => {
    vi.mocked(prisma.emailCandidate.findUnique).mockResolvedValue(mockCandidate);
    vi.mocked(prisma.emailEvent.create).mockResolvedValue({ id: "evt_1" } as any);
    vi.mocked(prisma.campaignState.findFirst).mockResolvedValue({
      id: "camp_1",
      leadId: "lead_1",
      status: "sent_initial",
      skipBounceMonitor: false,
    } as any);

    const result = await recordEmailEvent({
      candidateId: "cand_1",
      eventType: "bounce",
      provider: "gmail",
      rawPayload: {}
    });

    expect(result.recorded).toBe(true);
    expect(prisma.companyEmailAlgorithm.update).toHaveBeenCalled();
    expect(addSuppression).toHaveBeenCalled();
    expect(prisma.emailCandidate.update).toHaveBeenCalledWith({
      where: { id: "cand_1" },
      data: { verifierStatus: "bounced", selected: false }
    });
    expect(prisma.campaignState.findFirst).toHaveBeenCalledWith({
      where: { leadId: "lead_1" }
    });
    // Should return early, so no search for next candidate
    expect(prisma.emailCandidate.findMany).not.toHaveBeenCalled();
    expect(discoverAlternativeCandidates).not.toHaveBeenCalled();
  });

  it("performs auto-rotation for sent_initial campaign if skipBounceMonitor is true and next candidates exist", async () => {
    vi.mocked(prisma.emailCandidate.findUnique).mockResolvedValue(mockCandidate);
    vi.mocked(prisma.emailEvent.create).mockResolvedValue({ id: "evt_1" } as any);
    vi.mocked(prisma.campaignState.findFirst).mockResolvedValue({
      id: "camp_1",
      leadId: "lead_1",
      status: "sent_initial",
      skipBounceMonitor: true,
    } as any);

    const nextCandidate = {
      id: "cand_2",
      email: "next@example.com",
      verifierStatus: "valid",
      selected: false
    };

    vi.mocked(prisma.emailCandidate.findMany).mockResolvedValue([nextCandidate]);

    const result = await recordEmailEvent({
      candidateId: "cand_1",
      eventType: "bounce",
      provider: "gmail",
      rawPayload: {}
    });

    expect(result.recorded).toBe(true);
    expect(prisma.companyEmailAlgorithm.update).toHaveBeenCalled();
    expect(addSuppression).toHaveBeenCalled();
    expect(prisma.emailCandidate.update).toHaveBeenCalledWith({
      where: { id: "cand_1" },
      data: { verifierStatus: "bounced", selected: false }
    });

    // Since skipBounceMonitor is true, it does not skip rotation
    expect(prisma.emailCandidate.findMany).toHaveBeenCalledWith({
      where: {
        leadId: "lead_1",
        id: { not: "cand_1" },
        verifierStatus: { notIn: ["bounced", "invalid_email"] },
        mxValid: true,
        syntaxValid: true
      },
      orderBy: { verifierScore: "desc" }
    });

    // It should select the next candidate and update campaign to schedule it
    expect(prisma.emailCandidate.update).toHaveBeenCalledWith({
      where: { id: "cand_2" },
      data: { selected: true }
    });
    expect(prisma.campaignState.update).toHaveBeenCalledWith({
      where: { id: "camp_1" },
      data: {
        candidateId: "cand_2",
        status: "scheduled",
        scheduledFor: expect.any(Date),
        followupCount: 0
      }
    });
    expect(discoverAlternativeCandidates).not.toHaveBeenCalled();
  });

  it("triggers alternative discovery for sent_initial campaign if skipBounceMonitor is true and no next candidate exists", async () => {
    vi.mocked(prisma.emailCandidate.findUnique).mockResolvedValue(mockCandidate);
    vi.mocked(prisma.emailEvent.create).mockResolvedValue({ id: "evt_1" } as any);
    vi.mocked(prisma.campaignState.findFirst).mockResolvedValue({
      id: "camp_1",
      leadId: "lead_1",
      status: "sent_initial",
      skipBounceMonitor: true,
    } as any);

    // No next candidate found
    vi.mocked(prisma.emailCandidate.findMany)
      .mockResolvedValueOnce([]) // for findMany(nextCandidates)
      .mockResolvedValueOnce([mockCandidate]); // for findMany(allCandidates) to extract triedEmails

    vi.mocked(discoverAlternativeCandidates).mockResolvedValue(false); // returns false, fails discovery

    const result = await recordEmailEvent({
      candidateId: "cand_1",
      eventType: "bounce",
      provider: "gmail",
      rawPayload: {}
    });

    expect(result.recorded).toBe(true);
    expect(prisma.emailCandidate.findMany).toHaveBeenCalledTimes(2);
    expect(discoverAlternativeCandidates).toHaveBeenCalledWith("lead_1", ["test@example.com"]);
    // Since discoverAlternativeCandidates returned false, the campaign should be set to bounced
    expect(prisma.campaignState.update).toHaveBeenCalledWith({
      where: { id: "camp_1" },
      data: {
        status: "bounced",
        scheduledFor: null
      }
    });
  });
});
