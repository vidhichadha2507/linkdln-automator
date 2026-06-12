import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("../lib/prisma.js", () => {
  return {
    prisma: {
      companyEmailAlgorithm: {
        update: vi.fn()
      }
    }
  };
});

import { prisma } from "../lib/prisma.js";
import { updateAlgorithmFromVerification } from "./learningService.js";

describe("learningService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("updates algorithm on status 'valid' by incrementing success count and confidence score (+8)", async () => {
    await updateAlgorithmFromVerification("company_1", "algo_1", "valid");

    expect(prisma.companyEmailAlgorithm.update).toHaveBeenCalledWith({
      where: {
        companyId_algorithmId: {
          companyId: "company_1",
          algorithmId: "algo_1"
        }
      },
      data: {
        verificationSuccessCount: { increment: 1 },
        confidenceScore: { increment: 8 },
        lastVerifiedAt: expect.any(Date)
      }
    });
  });

  it("updates algorithm on status 'domain_valid' by incrementing confidence score (+1)", async () => {
    await updateAlgorithmFromVerification("company_1", "algo_1", "domain_valid");

    expect(prisma.companyEmailAlgorithm.update).toHaveBeenCalledWith({
      where: {
        companyId_algorithmId: {
          companyId: "company_1",
          algorithmId: "algo_1"
        }
      },
      data: {
        confidenceScore: { increment: 1 },
        lastVerifiedAt: expect.any(Date)
      }
    });
  });

  it("updates algorithm on status 'invalid' by incrementing missCount and decrementing confidence score (-8)", async () => {
    await updateAlgorithmFromVerification("company_1", "algo_1", "invalid");

    expect(prisma.companyEmailAlgorithm.update).toHaveBeenCalledWith({
      where: {
        companyId_algorithmId: {
          companyId: "company_1",
          algorithmId: "algo_1"
        }
      },
      data: {
        missCount: { increment: 1 },
        confidenceScore: { decrement: 8 },
        lastVerifiedAt: expect.any(Date)
      }
    });
  });

  it("updates algorithm on status 'accept_all', 'catch_all' or 'risky' by decrementing confidence score (-1)", async () => {
    await updateAlgorithmFromVerification("company_1", "algo_1", "accept_all");
    expect(prisma.companyEmailAlgorithm.update).toHaveBeenCalledWith({
      where: { companyId_algorithmId: { companyId: "company_1", algorithmId: "algo_1" } },
      data: { confidenceScore: { decrement: 1 }, lastVerifiedAt: expect.any(Date) }
    });

    vi.clearAllMocks();

    await updateAlgorithmFromVerification("company_1", "algo_1", "risky");
    expect(prisma.companyEmailAlgorithm.update).toHaveBeenCalledWith({
      where: { companyId_algorithmId: { companyId: "company_1", algorithmId: "algo_1" } },
      data: { confidenceScore: { decrement: 1 }, lastVerifiedAt: expect.any(Date) }
    });
  });

  it("does not update algorithm on status 'unknown'", async () => {
    await updateAlgorithmFromVerification("company_1", "algo_1", "unknown");
    expect(prisma.companyEmailAlgorithm.update).not.toHaveBeenCalled();
  });
});
