const legalSuffixPattern =
  /\b(incorporated|inc|llc|ltd|limited|corp|corporation|company|co|pvt|private|plc|gmbh|ag|sa|sas|bv|llp)\b\.?/gi;

export function cleanCompanyName(name: string): string {
  if (!name) return "";

  // Split by common separators (·, •, newlines)
  let parts = name.split(/[·•\n]/);
  let segment = parts[0] || "";

  // Handle title/company splits like "Infosys - Full-time" or "Software Engineer - Google"
  if (segment.includes(" - ")) {
    const hyphenParts = segment.split(" - ");
    segment = hyphenParts[0] || "";
  }

  // Remove common LinkedIn titles, roles, locations and experience details
  const junkPatterns = [
    /\b(power programmer|programmer|developer|engineer|analyst|manager|consultant|director|lead|senior|junior|sde|intern|associate|specialist|head|chief|vp|president|founder)\b/gi,
    /\b(full time|part time|full-time|part-time|contract|freelance|internship|temporary|on-site|remote|hybrid)\b/gi
  ];

  let cleaned = segment;
  for (const pattern of junkPatterns) {
    cleaned = cleaned.replace(pattern, "");
  }

  cleaned = cleaned.replace(/\s+/g, " ").trim();

  // Fallback to segment if we cleaned it down to nothing
  if (!cleaned) {
    cleaned = segment.trim();
  }

  return cleaned;
}

export function normalizeCompanyName(companyName: string): string {
  const cleaned = cleanCompanyName(companyName);
  return cleaned
    .trim()
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(legalSuffixPattern, "")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function normalizeDomain(domain: string): string {
  return domain
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .split("/")[0]
    .replace(/\.$/, "");
}

