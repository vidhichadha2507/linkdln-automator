import { describe, expect, it, vi, beforeEach } from "vitest";

// Mock prisma and suppression service
vi.mock("../lib/prisma.js", () => {
  return {
    prisma: {
      emailCandidate: {
        updateMany: vi.fn(),
        update: vi.fn(),
      }
    }
  };
});

vi.mock("./suppressionService.js", () => {
  return {
    checkSuppression: vi.fn().mockResolvedValue({ suppressed: false })
  };
});

import { prisma } from "../lib/prisma.js";
import { checkSuppression } from "./suppressionService.js";
import { selectBestCandidate } from "./candidateSelectionService.js";

describe("selectBestCandidate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(checkSuppression).mockResolvedValue({ suppressed: false });
  });

  it("returns null if there are no candidates", async () => {
    const result = await selectBestCandidate("lead_123", []);
    expect(result).toBeNull();
  });

  it("returns null if all candidates are suppressed", async () => {
    vi.mocked(checkSuppression).mockResolvedValue({ suppressed: true, reason: "Opted out", source: "CSV" });
    const candidates = [
      { id: "cand_1", email: "test1@comp.com", score: 80, syntaxValid: true, mxValid: true, verifierStatus: "valid" }
    ] as any;

    const result = await selectBestCandidate("lead_123", candidates);
    expect(result).toBeNull();
  });

  it("returns null if candidates have invalid syntax or are verifier invalid", async () => {
    const candidates = [
      { id: "cand_1", email: "test1@comp.com", score: 80, syntaxValid: false, mxValid: true, verifierStatus: "valid" },
      { id: "cand_2", email: "test2@comp.com", score: 80, syntaxValid: true, mxValid: true, verifierStatus: "invalid" }
    ] as any;

    const result = await selectBestCandidate("lead_123", candidates);
    expect(result).toBeNull();
  });

  it("selects the best candidate based on calculated selectionScore, resets others, and marks winner as selected", async () => {
    const candidates = [
      {
        id: "cand_low",
        email: "low@comp.com",
        score: 10,
        syntaxValid: true,
        mxValid: true,
        verifierScore: 20,
        verifierStatus: "unknown",
        isCatchAll: false
      },
      {
        id: "cand_high",
        email: "high@comp.com",
        score: 80,
        syntaxValid: true,
        mxValid: true,
        verifierScore: 90,
        verifierStatus: "valid",
        isCatchAll: false
      },
      {
        id: "cand_catchall",
        email: "catchall@comp.com",
        score: 80,
        syntaxValid: true,
        mxValid: true,
        verifierScore: 90,
        verifierStatus: "valid",
        isCatchAll: true
      }
    ] as any;

    const mockUpdatedCandidate = { id: "cand_high", selected: true };
    vi.mocked(prisma.emailCandidate.update).mockResolvedValue(mockUpdatedCandidate as any);

    const result = await selectBestCandidate("lead_123", candidates);

    // Verify it deselected other candidates first
    expect(prisma.emailCandidate.updateMany).toHaveBeenCalledWith({
      where: { leadId: "lead_123" },
      data: { selected: false }
    });

    // Verify it updated the high candidate to selected: true
    expect(prisma.emailCandidate.update).toHaveBeenCalledWith({
      where: { id: "cand_high" },
      data: { selected: true }
    });

    expect(result).toBe(mockUpdatedCandidate);
  });
});
