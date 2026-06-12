import type { EmailAlgorithm } from "@prisma/client";
import { env } from "../config/env.js";
import { prisma } from "../lib/prisma.js";
import { normalizeCompanyName, cleanCompanyName } from "../modules/companyNormalizer.js";
import { resolveCompanyDomain } from "../modules/domainResolver.js";
import { renderEmailTemplate } from "../modules/emailTemplate.js";
import { hasValidMx, isSyntaxValidEmail } from "../modules/emailValidation.js";
import { parseName } from "../modules/nameParser.js";
import { scoreAlgorithm } from "../modules/algorithmRanking.js";
import { getAlgorithmSuggestions } from "./algorithmEnrichmentService.js";
import { verifyEmail } from "./emailVerifierService.js";
import { updateAlgorithmFromVerification } from "./learningService.js";
import { selectBestCandidate } from "./candidateSelectionService.js";
import type { AlgorithmSuggestion } from "../types/emailIntelligence.js";
import { checkSuppression } from "./suppressionService.js";
import { startCampaign, processCampaignQueue, runBackgroundBounceChecker } from "./campaignService.js";
import { callGeminiWithFallback } from "../lib/gemini.js";
import { getSystemSetting } from "./settingsService.js";

export type GenerateCandidatesInput = {
  fullName: string;
  companyName: string;
  domain?: string;
  linkedinUrl?: string;
  headline?: string;
  source?: string;
};

export async function generateCandidates(input: GenerateCandidatesInput) {
  console.log(`\n=== 🚀 STARTING EMAIL CANDIDATE GENERATION ===`);
  console.log(`[Step 1] Parsing candidate full name: "${input.fullName}"`);
  const parsedName = parseName(input.fullName);
  console.log(`         Parsed Result -> First: "${parsedName.firstName}", Middle: "${parsedName.middleName}", Last: "${parsedName.lastName}"`);

  console.log(`[Step 2] Normalizing and cleaning company name: "${input.companyName}"`);
  const cleanedCompanyBrand = cleanCompanyName(input.companyName);
  const normalizedCompanyName = normalizeCompanyName(input.companyName);
  console.log(`         Cleaned Brand: "${cleanedCompanyBrand}", Normalized Key: "${normalizedCompanyName}"`);

  console.log(`[Step 3] Resolving corporate email domain...`);
  const domainResolution = await resolveCompanyDomain(input.companyName, input.domain);
  console.log(`         Resolved Domain: "${domainResolution.domain}" (Confidence: ${domainResolution.confidence}%, Source: "${domainResolution.source}")`);

  console.log(`[Step 4] Validating mail server (MX records) for "${domainResolution.domain}"...`);
  const mxValid = await hasValidMx(domainResolution.domain);
  if (!mxValid) {
    const errorMsg = `[MX GATE FAILURE] The resolved domain "${domainResolution.domain}" for company "${cleanedCompanyBrand}" has no active mail server (MX records). Candidate generation halted to prevent random/invalid emails.`;
    console.error(`❌ ${errorMsg}`);
    throw new Error(`The resolved domain "${domainResolution.domain}" for company "${cleanedCompanyBrand}" has no active mail server (MX records). We cannot generate candidate emails safely.`);
  }
  console.log(`         ✅ MX Verification Successful! Active mail servers confirmed.`);

  console.log(`[Step 5] Synching company record in Database...`);
  const company = await prisma.company.upsert({
    where: { normalizedName: normalizedCompanyName },
    update: {
      name: cleanedCompanyBrand,
      domain: domainResolution.domain,
      domainConfidence: domainResolution.confidence,
      domainSource: domainResolution.source
    },
    create: {
      name: cleanedCompanyBrand,
      normalizedName: normalizedCompanyName,
      domain: domainResolution.domain,
      domainConfidence: domainResolution.confidence,
      domainSource: domainResolution.source
    }
  });
  console.log(`         Synced Company ID: ${company.id}`);

  // Trigger company-specific Gemini value-add research asynchronously in the background
  syncCompanyResearch(company.id, company.name, company.domain || undefined).catch((err: any) => {
    console.error(`⚠️ Failed to sync company research asynchronously:`, err.message || err);
  });

  console.log(`[Step 6] Running Gemini pattern intelligence enrichment...`);
  let algorithmSuggestions: AlgorithmSuggestion[] = [];
  try {
    algorithmSuggestions = await getAlgorithmSuggestions(cleanedCompanyBrand, domainResolution.domain);
    console.log(`         Gemini enrichment successfully returned ${algorithmSuggestions.length} custom algorithms.`);
  } catch (geminiError: any) {
    console.error(`⚠️  Gemini enrichment failed: ${geminiError.message || geminiError}`);
  }
  await ensureCompanyAlgorithms(company.id, algorithmSuggestions);

  console.log(`[Step 7] Synchronizing lead record in Database...`);
  const lead = await prisma.lead.create({
    data: {
      fullName: parsedName.fullName,
      firstName: parsedName.firstName,
      middleName: parsedName.middleName,
      lastName: parsedName.lastName,
      companyId: company.id,
      linkedinUrl: input.linkedinUrl,
      headline: input.headline,
      source: input.source ?? "api"
    }
  });
  console.log(`         Synced Lead ID: ${lead.id}`);

  console.log(`[Step 8] Ranking email candidate templates...`);
  const companyAlgorithms = await prisma.companyEmailAlgorithm.findMany({
    where: { companyId: company.id },
    include: { algorithm: true }
  });

  const rankedAlgorithms = companyAlgorithms
    .map((companyAlgorithm) => ({
      companyAlgorithm,
      score: scoreAlgorithm(companyAlgorithm)
    }))
    .sort((left, right) => right.score - left.score);

  console.log(`[Step 9] Rendering & generating candidates...`);
  const seenEmails = new Set<string>();
  const candidateInputs = rankedAlgorithms
    .map(({ companyAlgorithm, score }) => {
      const email = renderEmailTemplate(companyAlgorithm.algorithm.patternTemplate, {
        ...parsedName,
        domain: domainResolution.domain
      });

      if (!email || seenEmails.has(email)) {
        return null;
      }

      seenEmails.add(email);
      return {
        leadId: lead.id,
        companyId: company.id,
        algorithmId: companyAlgorithm.algorithmId,
        email,
        syntaxValid: isSyntaxValidEmail(email),
        mxValid,
        selected: false,
        score,
        algorithm: companyAlgorithm.algorithm
      };
    })
    .filter((candidate): candidate is NonNullable<typeof candidate> => candidate !== null);

  const storedCandidates = [];
  for (const candidate of candidateInputs) {
    console.log(`         Verifying Candidate: "${candidate.email}" (Pattern: "${candidate.algorithm.patternTemplate}")`);
    const verification = await verifyEmail({
      email: candidate.email,
      syntaxValid: candidate.syntaxValid,
      mxValid: candidate.mxValid
    });
    const suppression = await checkSuppression(candidate.email);
    console.log(`         Verification Result -> Status: "${verification.status}", Score: ${verification.score || candidate.score}, Catch-All: ${verification.isCatchAll}`);

    const stored = await prisma.emailCandidate.create({
      data: {
        leadId: candidate.leadId,
        companyId: candidate.companyId,
        algorithmId: candidate.algorithmId,
        email: candidate.email,
        syntaxValid: candidate.syntaxValid,
        mxValid: candidate.mxValid,
        verifierProvider: verification.provider,
        verifierStatus: verification.status,
        verifierScore: verification.provider === "local" ? candidate.score : verification.score,
        isCatchAll: verification.isCatchAll,
        selected: false
      }
    });

    await updateAlgorithmFromVerification(company.id, candidate.algorithmId, verification.status);

    storedCandidates.push({
      ...stored,
      score: candidate.score,
      algorithm: summarizeAlgorithm(candidate.algorithm),
      suppression
    });
  }

  console.log(`[Step 10] Selecting best candidate email...`);
  const selectedCandidate = await selectBestCandidate(lead.id, storedCandidates);
  if (selectedCandidate) {
    console.log(`         🏆 SELECTED OUTREACH TARGET: "${selectedCandidate.email}"`);

    // Automatically start campaign and dispatch initial email immediately!
    console.log(`[Step 11] Auto-starting campaign and dispatching initial email...`);
    try {
      await startCampaign({
        leadId: lead.id,
        candidateId: selectedCandidate.id,
        autoFollowup: true,
        followupIntervalHours: 72
      });
      console.log(`         Campaign auto-started for candidate: "${selectedCandidate.email}"`);

      console.log(`[Step 12] Triggering outbox queue dispatcher for immediate delivery...`);
      const queueResult = await processCampaignQueue();
      console.log(`         Queue dispatch complete. Sent count: ${queueResult.sentCount}`);

      // [Step 13] Asynchronously trigger self-healing background bounce monitor
      runBackgroundBounceChecker(lead.id, selectedCandidate.id).catch((err) => {
        console.error(`⚠️ Background bounce checker error:`, err);
      });
    } catch (campaignError: any) {
      console.error(`⚠️  Failed to auto-start campaign: ${campaignError.message || campaignError}`);
    }
  } else {
    console.log(`         ⚠️ WARNING: No verified candidate email could be selected.`);
  }

  const refreshedCandidates = await prisma.emailCandidate.findMany({
    where: { leadId: lead.id },
    include: { algorithm: true },
    orderBy: [{ selected: "desc" }, { createdAt: "asc" }]
  });

  console.log(`=== 🏆 CANDIDATE GENERATION SEQUENCE COMPLETED ===\n`);

  return {
    lead,
    company,
    selectedCandidate,
    candidates: refreshedCandidates.map((candidate) => ({
      ...candidate,
      algorithm: summarizeAlgorithm(candidate.algorithm)
    }))
  };
}

async function ensureCompanyAlgorithms(companyId: string, suggestions: AlgorithmSuggestion[]) {
  for (const [index, suggestion] of suggestions.entries()) {
    const algorithm = await upsertAlgorithmSuggestion(suggestion);

    await prisma.companyEmailAlgorithm.upsert({
      where: {
        companyId_algorithmId: {
          companyId,
          algorithmId: algorithm.id
        }
      },
      update: {},
      create: {
        companyId,
        algorithmId: algorithm.id,
        confidenceScore: suggestion.confidenceScore,
        rank: index
      }
    });
  }
}

async function upsertAlgorithmSuggestion(suggestion: AlgorithmSuggestion) {
  const existing = await prisma.emailAlgorithm.findUnique({
    where: { patternTemplate: suggestion.patternTemplate }
  });

  if (existing) {
    return prisma.emailAlgorithm.update({
      where: { id: existing.id },
      data: {
        description: suggestion.description,
        example: suggestion.example
      }
    });
  }

  return prisma.emailAlgorithm.create({
    data: {
      key: await buildUniqueAlgorithmKey(suggestion.key),
      patternTemplate: suggestion.patternTemplate,
      description: suggestion.description,
      example: suggestion.example
    }
  });
}

async function buildUniqueAlgorithmKey(baseKey: string) {
  const normalizedBaseKey = baseKey || "custom_algorithm";
  const existing = await prisma.emailAlgorithm.findUnique({
    where: { key: normalizedBaseKey }
  });

  if (!existing) {
    return normalizedBaseKey;
  }

  for (let index = 2; index < 100; index += 1) {
    const candidate = `${normalizedBaseKey}_${index}`;
    const match = await prisma.emailAlgorithm.findUnique({
      where: { key: candidate }
    });

    if (!match) {
      return candidate;
    }
  }

  return `${normalizedBaseKey}_${Date.now()}`;
}

function summarizeAlgorithm(algorithm: EmailAlgorithm) {
  return {
    id: algorithm.id,
    key: algorithm.key,
    patternTemplate: algorithm.patternTemplate,
    description: algorithm.description
  };
}

const activeResearchPromises = new Map<string, Promise<string | null>>();

export async function syncCompanyResearch(companyId: string, companyName: string, domain?: string): Promise<string | null> {
  // Check if there is an in-progress promise for this company to prevent concurrent Gemini requests
  if (activeResearchPromises.has(companyId)) {
    console.log(`🤖 [Gemini Research] Deduplicating concurrent research request for "${companyName}".`);
    return activeResearchPromises.get(companyId)!;
  }

  const promise = (async () => {
    const company = await prisma.company.findUnique({
      where: { id: companyId }
    });

    if (company?.researchReason) {
      console.log(`🤖 [Gemini Research] Company "${companyName}" already has cached research reason.`);
      return company.researchReason;
    }

    try {
      const prompt = `Research the company named "${companyName}" (domain: "${domain || "unknown"}"). 
You must output exactly ONE short, highly-focused clause or noun phrase (maximum 12 to 15 words) that completes this sentence naturally, grammatically, and beautifully:
"I'm specifically interested in ${companyName} because of [AI_OUTPUT]."

Your output MUST satisfy these rules:
1. It MUST be written in the direct first-person/second-person perspective (using words like "your", e.g., "your focus on scaling...", "your innovative work on...").
2. It MUST start with a lowercase letter and contain NO punctuation or trailing periods at the end.
3. It MUST be highly specific to ${companyName} (mentioning a real product decision, engineering blog post, known system challenge, or platform). Avoid generic phrases like "your growth".
4. It MUST be extremely concise (maximum 12-15 words) and sound like a human software engineer wrote it.

Example output for "Rubrik": your innovative ATLAS file system designed for immutable data recovery at scale
Example output for "Zeta": your modern cloud-native banking platform and high-throughput transaction ledger API
Example output for "Netflix": your unique open-source contributions to Chaos Engineering and microservice resilience

Output ONLY the raw clause itself, no introduction, no surrounding quotes, no trailing period.`;

      console.log(`🤖 [Gemini Research] Launching async research prompt for "${companyName}"...`);
      const rawReason = await callGeminiWithFallback(prompt);
      let reason = rawReason.trim();
      reason = reason.replace(/^["']|["']$/g, "").trim();

      if (reason) {
        await prisma.company.update({
          where: { id: companyId },
          data: { researchReason: reason }
        });
        console.log(`🤖 [Gemini Research] Successfully cached research reason for "${companyName}": "${reason}"`);
        return reason;
      }
    } catch (err: any) {
      console.error(`⚠️  [Gemini Research] Failed to generate research reason for "${companyName}":`, err.message || err);
    } finally {
      // Clean up the promise from the active list once complete (regardless of success/failure)
      activeResearchPromises.delete(companyId);
    }
    return null;
  })();

  activeResearchPromises.set(companyId, promise);
  return promise;
}

export async function discoverAlternativeCandidates(leadId: string, triedEmails: string[]): Promise<boolean> {
  console.log(`\n🧠 [Recursive Pattern Intelligence] Exhausted standard corporate patterns for Lead ID: "${leadId}".`);
  
  const enableAi = await getSystemSetting("enableAiPatternDiscovery");
  if (!enableAi) {
    console.log(`   [Recursive Pattern Intelligence] Gemini alternative pattern discovery is disabled via settings.`);
    try {
      const campaign = await prisma.campaignState.findFirst({
        where: { leadId }
      });
      if (campaign) {
        await prisma.campaignState.update({
          where: { id: campaign.id },
          data: {
            status: "bounced",
            scheduledFor: null
          }
        });
        console.log(`   [Recursive Pattern Intelligence] Campaign updated and marked as bounced.`);
      }
    } catch (campaignError: any) {
      console.error("⚠️ Failed to update campaign status on disabled AI pattern discovery:", campaignError.message || campaignError);
    }
    return false;
  }

  console.log(`   Initiating Gemini search for creative/alternative patterns...`);

  // 1. Get the Lead and its associated Company
  const lead = await prisma.lead.findUnique({
    where: { id: leadId },
    include: { company: true }
  });

  if (!lead || !lead.company) {
    console.warn(`   ⚠️ Cannot run alternative discovery: Lead or company record missing.`);
    return false;
  }

  // 2. Query Gemini for alternative algorithms
  const promptText = [
    `We are trying to contact a lead named "${lead.fullName}" at the company "${lead.company.name}" (domain: "${lead.company.domain}").`,
    "We have already tried all the standard email address patterns, and the following emails ALL bounced (failed delivery):",
    ...triedEmails.map((e) => `- ${e}`),
    "",
    "Please think of 3 to 5 alternative, creative, or less common corporate email address structures or patterns that this company might be using.",
    "For example: patterns using middle names, double initials, domain prefixing, abbreviated company brands, or alternative naming combinations.",
    "Return the suggestions as a raw JSON block (do not wrap in markdown or backticks).",
    "Use only tokens {first}, {last}, {first_initial}, {last_initial}, {first_two}, {last_two}, {first_three}, {last_three}, {middle}, {middle_initial}, and {domain}.",,
    "Return shape: {\"algorithms\":[{\"key\":\"alternative_key\",\"patternTemplate\":\"{first_initial}{middle_initial}{last}@{domain}\",\"description\":\"...\",\"example\":\"...\",\"confidenceScore\":50}]}"
  ].join("\n");

  try {
    const text = await callGeminiWithFallback(promptText);
    let cleanText = text.trim();
    if (cleanText.startsWith("```")) {
      cleanText = cleanText.replace(/^```(json)?/gi, "").replace(/```$/g, "").trim();
    }
    const parsed = JSON.parse(cleanText) as { algorithms?: Array<Partial<AlgorithmSuggestion>> };
    const suggestions = (parsed.algorithms ?? [])
      .map((algorithm) => ({
        key: algorithm.key || "alt_pattern",
        patternTemplate: algorithm.patternTemplate ?? "",
        description: algorithm.description ?? "Gemini alternative suggested pattern",
        example: algorithm.example ?? "",
        confidenceScore: Math.max(10, Math.min(100, algorithm.confidenceScore ?? 40)),
        source: "gemini_alternative"
      }))
      .filter((s) => s.patternTemplate.includes("{first}") || s.patternTemplate.includes("{last}") || s.patternTemplate.includes("{first_initial}") || s.patternTemplate.includes("{last_initial}"));

    if (suggestions.length === 0) {
      console.log("   ⚠️ Gemini suggested no new alternative patterns.");
      return false;
    }

    console.log(`   Gemini suggested ${suggestions.length} fresh alternative algorithm patterns.`);

    // 3. Register these new algorithms for the company in the database
    const parsedName = {
      fullName: lead.fullName,
      firstName: lead.firstName || "",
      middleName: lead.middleName || "",
      lastName: lead.lastName || ""
    };

    const newCandidates: any[] = [];
    const seenEmails = new Set<string>(triedEmails);

    for (const suggestion of suggestions) {
      // Create/Get the email algorithm definition using upsertAlgorithmSuggestion
      const algorithm = await upsertAlgorithmSuggestion({
        key: `alt_${suggestion.key}`,
        patternTemplate: suggestion.patternTemplate,
        description: suggestion.description,
        example: suggestion.example,
        confidenceScore: suggestion.confidenceScore,
        source: "gemini_alternative"
      });

      // Create company email algorithm mapping
      const companyAlgo = await prisma.companyEmailAlgorithm.upsert({
        where: {
          companyId_algorithmId: {
            companyId: lead.companyId,
            algorithmId: algorithm.id
          }
        },
        update: {
          confidenceScore: suggestion.confidenceScore
        },
        create: {
          companyId: lead.companyId,
          algorithmId: algorithm.id,
          confidenceScore: suggestion.confidenceScore,
          rank: 99
        }
      });

      // Render the candidate email
      const email = renderEmailTemplate(suggestion.patternTemplate, {
        ...parsedName,
        domain: lead.company.domain || ""
      });

      if (email && !seenEmails.has(email.toLowerCase().trim())) {
        seenEmails.add(email.toLowerCase().trim());

        // Perform MX / syntax checks
        const syntaxValid = isSyntaxValidEmail(email);
        const mxValid = syntaxValid ? await hasValidMx(lead.company.domain || "") : false;

        // Perform verifications if local/hunter is enabled
        const verification = await verifyEmail({ email, syntaxValid, mxValid });

        let candidate;
        try {
          candidate = await prisma.emailCandidate.create({
            data: {
              leadId: lead.id,
              companyId: lead.companyId,
              algorithmId: algorithm.id,
              email: email.toLowerCase().trim(),
              syntaxValid,
              mxValid,
              verifierStatus: verification.status,
              verifierScore: verification.score,
              isCatchAll: verification.isCatchAll,
              selected: false
            }
          });
        } catch (dbErr) {
          candidate = await prisma.emailCandidate.findUnique({
            where: {
              leadId_email: {
                leadId: lead.id,
                email: email.toLowerCase().trim()
              }
            }
          });
        }

        if (candidate) {
          newCandidates.push(candidate);
          console.log(`   💡 Registered Alternative Candidate: "${email}" (Score: ${verification.score})`);
        }
      }
    }

    if (newCandidates.length === 0) {
      console.log("   ⚠️ All suggested alternative email formats have already been tried previously.");
      return false;
    }

    // 4. Select the best new candidate from the alternative set
    newCandidates.sort((a, b) => b.verifierScore - a.verifierScore);
    const selected = newCandidates[0];
    
    await prisma.emailCandidate.update({
      where: { id: selected.id },
      data: { selected: true }
    });

    console.log(`   🏆 SELECTED FRESH ALTERNATIVE CANDIDATE: "${selected.email}"`);

    // 5. Update and reschedule the active campaign!
    const campaign = await prisma.campaignState.findFirst({
      where: { leadId: lead.id }
    });

    if (campaign) {
      await prisma.campaignState.update({
        where: { id: campaign.id },
        data: {
          candidateId: selected.id,
          status: "scheduled",
          scheduledFor: new Date(),
          followupCount: 0
        }
      });
      console.log(`   ♻️  Campaign successfully updated and re-scheduled for immediate dispatch.`);
      
      // Dispatch immediately!
      await processCampaignQueue();
    }

    return true;
  } catch (err: any) {
    console.error("❌ Failed to process alternative candidates:", err.message || err);
    return false;
  }
}
