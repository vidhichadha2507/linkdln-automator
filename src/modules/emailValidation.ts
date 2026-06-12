import { resolveMx } from "node:dns/promises";
import { normalizeDomain } from "./companyNormalizer.js";

const basicEmailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const bannedLocalParts = new Set([
  "cs", "hr", "it", "pr", "ad", "hq", "no", "go", "to", "by", "ok", "sales", "support",
  "jobs", "career", "careers", "hello", "info", "admin", "team", "contact", "office"
]);

export function isSyntaxValidEmail(email: string): boolean {
  if (!basicEmailPattern.test(email)) {
    return false;
  }
  
  const localPart = email.split("@")[0]?.toLowerCase() || "";
  
  // Reject extremely short corporate local parts (less than 3 characters) or known group roles
  if (localPart.length < 3 || bannedLocalParts.has(localPart)) {
    return false;
  }
  
  return true;
}

export async function hasValidMx(domain: string): Promise<boolean> {
  try {
    const records = await resolveMx(normalizeDomain(domain));
    return records.length > 0;
  } catch {
    return false;
  }
}

