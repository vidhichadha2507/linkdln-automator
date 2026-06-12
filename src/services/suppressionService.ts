import { prisma } from "../lib/prisma.js";
import { normalizeDomain } from "../modules/companyNormalizer.js";

export type SuppressionCheck = {
  suppressed: boolean;
  reason?: string;
  source?: string;
};

export async function checkSuppression(email: string): Promise<SuppressionCheck> {
  const domain = email.split("@")[1];
  const normalizedEmail = email.trim().toLowerCase();
  const normalizedDomain = domain ? normalizeDomain(domain) : undefined;

  const entry = await prisma.suppressionEntry.findFirst({
    where: {
      OR: [
        { email: normalizedEmail },
        ...(normalizedDomain ? [{ domain: normalizedDomain }] : [])
      ]
    },
    orderBy: { createdAt: "desc" }
  });

  if (!entry) {
    return { suppressed: false };
  }

  return {
    suppressed: true,
    reason: entry.reason,
    source: entry.source
  };
}

export async function addSuppression(input: {
  email?: string;
  domain?: string;
  reason: string;
  source: string;
}) {
  const email = input.email?.trim().toLowerCase() || undefined;
  const domain = input.domain ? normalizeDomain(input.domain) : undefined;

  if (!email && !domain) {
    throw new Error("Either email or domain is required");
  }

  return prisma.suppressionEntry.create({
    data: {
      email,
      domain,
      reason: input.reason,
      source: input.source
    }
  });
}

