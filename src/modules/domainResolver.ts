import { resolveMx } from "node:dns/promises";
import { normalizeCompanyName, normalizeDomain } from "./companyNormalizer.js";
import type { DomainResolution } from "../types/emailIntelligence.js";
import { env } from "../config/env.js";
import { callGeminiWithFallback } from "../lib/gemini.js";

const knownCompanyDomains = new Map<string, string>([
  ["google", "google.com"],
  ["alphabet", "abc.xyz"],
  ["microsoft", "microsoft.com"],
  ["openai", "openai.com"],
  ["meta", "meta.com"],
  ["amazon", "amazon.com"],
  ["apple", "apple.com"],
  ["netflix", "netflix.com"],
  ["tesla", "tesla.com"],
  ["zeta", "zeta.tech"],
  ["example", "example.com"]
]);

export async function resolveCompanyDomain(companyName: string, providedDomain?: string): Promise<DomainResolution> {
  if (providedDomain) {
    return {
      domain: normalizeDomain(providedDomain),
      confidence: 100,
      source: "user_input"
    };
  }

  const normalizedCompany = normalizeCompanyName(companyName);
  const knownDomain = knownCompanyDomains.get(normalizedCompany);
  if (knownDomain) {
    return {
      domain: knownDomain,
      confidence: 85,
      source: "known_company_map"
    };
  }

  // 1. Try Gemini domain discovery
  if (env.GEMINI_API_KEY && process.env.NODE_ENV !== "test" && !process.env.VITEST) {
    console.log(`🔮 [Domain Resolver] Querying Gemini for official web domains for "${companyName}"...`);
    try {
      const domains = await getDomainsFromGemini(companyName);
      console.log(`   Gemini suggested domain options:`, domains);

      for (const d of domains) {
        const cleanD = normalizeDomain(d);
        const hasMx = await domainHasMx(cleanD);
        if (hasMx) {
          console.log(`   ✅ Gemini Resolved Active Domain: "${cleanD}" (MX records confirmed)`);
          return {
            domain: cleanD,
            confidence: 90,
            source: "gemini_mx_confirmed"
          };
        } else {
          console.log(`   ❌ Option "${cleanD}" has no active MX records. Checking next option...`);
        }
      }
    } catch (geminiDomainError: any) {
      console.error(`⚠️  Gemini domain discovery failed:`, geminiDomainError.message || geminiDomainError);
    }
  }

  // 2. Fallback to company name guess if Gemini failed
  const guessedDomain = `${normalizedCompany.replace(/\s+/g, "")}.com`;
  const hasMx = await domainHasMx(guessedDomain);

  return {
    domain: guessedDomain,
    confidence: hasMx ? 55 : 25,
    source: hasMx ? "company_name_guess_mx_confirmed" : "company_name_guess"
  };
}

async function getDomainsFromGemini(companyName: string): Promise<string[]> {
  const prompt = [
    "Identify possible official email/web domain names (e.g. company.tech, company.com, company.io) for the following corporate entity.",
    `Company Name: ${companyName}`,
    "Return a raw JSON array of strings listing these domains in order of likelihood.",
    "Return ONLY the raw JSON array (do not wrap in markdown or backticks). Example: [\"zeta.tech\", \"zeta.com\", \"zeta.io\"]"
  ].join("\n");

  try {
    const text = await callGeminiWithFallback(prompt);
    let cleanText = text.trim();
    if (cleanText.startsWith("```")) {
      cleanText = cleanText.replace(/^```(json)?/gi, "").replace(/```$/g, "").trim();
    }
    const parsed = JSON.parse(cleanText);
    if (Array.isArray(parsed)) {
      return parsed.map((item: any) => String(item).trim());
    }
  } catch (err: any) {
    console.error("[Gemini Domain Discovery Error] Failed to parse output:", err.message || err);
  }

  return [];
}

async function domainHasMx(domain: string): Promise<boolean> {
  try {
    const records = await resolveMx(normalizeDomain(domain));
    return records.length > 0;
  } catch {
    return false;
  }
}

