import type { EmailCandidate } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import { checkSuppression } from "./suppressionService.js";

type ScoredCandidate = EmailCandidate & {
  score: number;
};

const statusWeights: Record<string, number> = {
  valid: 100,
  domain_valid: 30,
  accept_all: 5,
  catch_all: 5,
  risky: -15,
  unknown: 0,
  invalid: -100
};

export async function selectBestCandidate(leadId: string, candidates: ScoredCandidate[]) {
  const scoredCandidates = [];
  for (const candidate of candidates) {
    const suppression = await checkSuppression(candidate.email);
    scoredCandidates.push({
      candidate,
      suppressed: suppression.suppressed,
      selectionScore:
        candidate.score +
        (candidate.syntaxValid ? 10 : -50) +
        (candidate.mxValid ? 10 : -25) +
        (candidate.verifierScore ?? 0) +
        (statusWeights[candidate.verifierStatus ?? "unknown"] ?? 0) -
        (candidate.isCatchAll ? 25 : 0)
    });
  }

  const eligible = scoredCandidates
    .filter(({ candidate, suppressed }) => !suppressed && candidate.syntaxValid && candidate.verifierStatus !== "invalid")
    .sort((left, right) => right.selectionScore - left.selectionScore);

  const best = eligible[0]?.candidate;
  if (!best) {
    return null;
  }

  await prisma.emailCandidate.updateMany({
    where: { leadId },
    data: { selected: false }
  });

  return prisma.emailCandidate.update({
    where: { id: best.id },
    data: { selected: true }
  });
}
