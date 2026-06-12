import { prisma } from "../lib/prisma.js";
import { addSuppression } from "./suppressionService.js";

export type NormalizedEmailEventType =
  | "bounce"
  | "complaint"
  | "delivery"
  | "open"
  | "reply"
  | "unsubscribe"
  | "unknown";

export type RecordEmailEventInput = {
  candidateId?: string;
  email?: string;
  eventType: NormalizedEmailEventType;
  provider: string;
  rawPayload: unknown;
};

export async function recordEmailEvent(input: RecordEmailEventInput) {
  const candidate = await findCandidate(input);
  if (!candidate) {
    return {
      recorded: false,
      reason: "candidate_not_found"
    };
  }

  const event = await prisma.emailEvent.create({
    data: {
      candidateId: candidate.id,
      eventType: input.eventType,
      provider: input.provider,
      rawPayload: toJsonPayload(input.rawPayload)
    }
  });

  await applyEventLearning(candidate, input.eventType, input.provider);

  return {
    recorded: true,
    event
  };
}

async function findCandidate(input: RecordEmailEventInput) {
  if (input.candidateId) {
    return prisma.emailCandidate.findUnique({
      where: { id: input.candidateId }
    });
  }

  if (input.email) {
    return prisma.emailCandidate.findFirst({
      where: { email: input.email.trim().toLowerCase() },
      orderBy: { createdAt: "desc" }
    });
  }

  return null;
}

async function applyEventLearning(
  candidate: any,
  eventType: NormalizedEmailEventType,
  provider: string
) {
  const normalizedEmail = candidate.email.trim().toLowerCase();
  const { companyId, algorithmId } = candidate;

  if (eventType === "bounce") {
    console.log(`\n🚨 [BOUNCE SIGNAL RECEIVED] Email delivery failed for: "${normalizedEmail}"`);
    
    // 1. Decrement confidence score of the failed algorithm template
    await prisma.companyEmailAlgorithm.update({
      where: { companyId_algorithmId: { companyId, algorithmId } },
      data: {
        bounceCount: { increment: 1 },
        confidenceScore: { decrement: 15 },
        lastVerifiedAt: new Date()
      }
    });

    // 2. Blacklist/Suppress the failed email address
    await addSuppression({
      email: candidate.email,
      reason: "bounce",
      source: provider
    });

    // 3. Mark candidate as bounced & unselected in the DB
    await prisma.emailCandidate.update({
      where: { id: candidate.id },
      data: {
        verifierStatus: "bounced",
        selected: false
      }
    });

    // 4. Check if there's an active campaign running for this lead
    const campaign = await prisma.campaignState.findFirst({
      where: { leadId: candidate.leadId }
    });

    if (campaign) {
      // If the campaign is in 'sent_initial' state, it is currently running in a parallel dispatch/monitor loop.
      // We skip individual rotator actions so that all parallel variations are checked at the end of the 2-minute monitor loop.
      if (campaign.status === "sent_initial" && !campaign.skipBounceMonitor) {
        console.log(`   ℹ️  Parallel verification active. Skipping individual auto-rotation.`);
        return;
      }

      // 5. Look for the next best valid candidate for this lead
      const nextCandidates = await prisma.emailCandidate.findMany({
        where: {
          leadId: candidate.leadId,
          id: { not: candidate.id },
          verifierStatus: { notIn: ["bounced", "invalid_email"] },
          mxValid: true,
          syntaxValid: true
        },
        orderBy: { verifierScore: "desc" }
      });

      if (nextCandidates.length > 0) {
        const nextBest = nextCandidates[0];
        console.log(`♻️  [AUTO-ROTATOR] Bounced address detected! Auto-rotating target to next best pattern: "${nextBest.email}"`);

        // Select the next candidate
        await prisma.emailCandidate.update({
          where: { id: nextBest.id },
          data: { selected: true }
        });

        // Re-schedule the campaign to send immediately to the next candidate
        await prisma.campaignState.update({
          where: { id: campaign.id },
          data: {
            candidateId: nextBest.id,
            status: "scheduled",
            scheduledFor: new Date(), // send immediately
            followupCount: 0
          }
        });
        console.log(`   Campaign updated and re-scheduled. Outbox will attempt send to next candidate instantly.`);
      } else {
        console.log(`❌ [AUTO-ROTATOR] Bounced address detected! No remaining standard candidate email patterns exist for this lead.`);
        
        // Retrieve all tried emails for this lead to send to Gemini
        const allCandidates = await prisma.emailCandidate.findMany({
          where: { leadId: candidate.leadId }
        });
        const triedEmails = allCandidates.map((c) => c.email.toLowerCase().trim());

        console.log(`🧠 [AUTO-ROTATOR] Initiating recursive alternative pattern discovery loop...`);
        try {
          // Dynamic import to prevent circular dependency resolution issues in Node ES modules
          const { discoverAlternativeCandidates } = await import("./candidateService.js");
          const foundAlternative = await discoverAlternativeCandidates(candidate.leadId, triedEmails);
          
          if (!foundAlternative) {
            console.log(`❌ [AUTO-ROTATOR] No new creative alternative patterns discovered. Finalizing halt.`);
            await prisma.campaignState.update({
              where: { id: campaign.id },
              data: {
                status: "bounced",
                scheduledFor: null
              }
            });
          }
        } catch (discoverError: any) {
          console.error(`⚠️ Error triggering alternative discovery:`, discoverError.message || discoverError);
          await prisma.campaignState.update({
            where: { id: campaign.id },
            data: {
              status: "bounced",
              scheduledFor: null
            }
          });
        }
      }
    }
    return;
  }

  if (eventType === "complaint" || eventType === "unsubscribe") {
    await addSuppression({
      email: candidate.email,
      reason: eventType,
      source: provider
    });
    return;
  }

  if (eventType === "delivery" || eventType === "reply") {
    await prisma.companyEmailAlgorithm.update({
      where: { companyId_algorithmId: { companyId, algorithmId } },
      data: {
        hitCount: { increment: 1 },
        confidenceScore: { increment: eventType === "reply" ? 10 : 5 },
        lastVerifiedAt: new Date()
      }
    });

    // Halt active campaign due to successful reply from lead
    if (eventType === "reply") {
      console.log(`🎉 [LEAD REPLY SIGNAL] Lead replied! halting further followups for: "${normalizedEmail}"`);
      await prisma.campaignState.updateMany({
        where: { candidate: { email: normalizedEmail } },
        data: { status: "replied", scheduledFor: null }
      });
    }
  }
}

function toJsonPayload(value: unknown) {
  return JSON.parse(JSON.stringify(value ?? {}));
}

export function normalizeProviderEventType(value: string): NormalizedEmailEventType {
  const normalized = value.trim().toLowerCase();

  if (normalized.includes("bounce")) return "bounce";
  if (normalized.includes("complaint") || normalized.includes("spam")) return "complaint";
  if (normalized.includes("delivery") || normalized.includes("delivered")) return "delivery";
  if (normalized.includes("open")) return "open";
  if (normalized.includes("reply")) return "reply";
  if (normalized.includes("unsubscribe")) return "unsubscribe";

  return "unknown";
}

