import { prisma } from "../lib/prisma.js";
import type { VerificationStatus } from "../types/emailIntelligence.js";

export async function updateAlgorithmFromVerification(companyId: string, algorithmId: string, status: VerificationStatus) {
  const update = getVerificationUpdate(status);

  if (!update) {
    return;
  }

  await prisma.companyEmailAlgorithm.update({
    where: {
      companyId_algorithmId: {
        companyId,
        algorithmId
      }
    },
    data: {
      ...update,
      lastVerifiedAt: new Date()
    }
  });
}

function getVerificationUpdate(status: VerificationStatus) {
  switch (status) {
    case "valid":
      return {
        verificationSuccessCount: { increment: 1 },
        confidenceScore: { increment: 8 }
      };
    case "domain_valid":
      return {
        confidenceScore: { increment: 1 }
      };
    case "invalid":
      return {
        missCount: { increment: 1 },
        confidenceScore: { decrement: 8 }
      };
    case "accept_all":
    case "catch_all":
    case "risky":
      return {
        confidenceScore: { decrement: 1 }
      };
    case "unknown":
      return null;
  }
}

