import { env } from "../config/env.js";
import { defaultAlgorithmSuggestions } from "../modules/algorithmCatalog.js";
import type { AlgorithmSuggestion } from "../types/emailIntelligence.js";
import { callGeminiWithFallback } from "../lib/gemini.js";
import { getSystemSetting } from "./settingsService.js";

const allowedTemplatePattern = /^[a-z0-9{}@._-]+$/;

export async function getAlgorithmSuggestions(companyName: string, domain: string): Promise<AlgorithmSuggestion[]> {
  const enableAi = await getSystemSetting("enableAiPatternDiscovery");
  if (!enableAi) {
    console.log(`🤖 [Gemini Enrichment] AI pattern discovery is disabled via settings. Using catalog fallbacks.`);
    return mergeSuggestions(defaultAlgorithmSuggestions);
  }
  const geminiSuggestions = await getGeminiSuggestions(companyName, domain);
  return mergeSuggestions([...geminiSuggestions, ...defaultAlgorithmSuggestions]);
}

async function getGeminiSuggestions(companyName: string, domain: string): Promise<AlgorithmSuggestion[]> {
  if (!env.GEMINI_API_KEY) {
    return [];
  }

  const promptText = [
    "Return likely corporate email pattern templates as a raw JSON block (do not wrap in markdown or backticks).",
    "Use only tokens {first}, {last}, {first_initial}, {last_initial}, {middle}, {middle_initial}, and {domain}.",
    `Company: ${companyName}`,
    `Domain: ${domain}`,
    "Return shape: {\"algorithms\":[{\"key\":\"first_dot_last\",\"patternTemplate\":\"{first}.{last}@{domain}\",\"description\":\"...\",\"example\":\"...\",\"confidenceScore\":60}]}"
  ].join("\n");

  try {
    const text = await callGeminiWithFallback(promptText);
    let cleanText = text.trim();
    // Strip markdown code block wrapper if Gemini wraps the JSON output
    if (cleanText.startsWith("```")) {
      cleanText = cleanText.replace(/^```(json)?/gi, "").replace(/```$/g, "").trim();
    }
    const parsed = JSON.parse(cleanText) as { algorithms?: Array<Partial<AlgorithmSuggestion>> };
    return (parsed.algorithms ?? [])
      .map((algorithm) => ({
        key: sanitizeKey(algorithm.key ?? algorithm.patternTemplate ?? ""),
        patternTemplate: algorithm.patternTemplate ?? "",
        description: algorithm.description ?? "Gemini suggested email pattern",
        example: algorithm.example ?? "",
        confidenceScore: clampScore(algorithm.confidenceScore ?? 30),
        source: "gemini"
      }))
      .filter(isValidSuggestion);
  } catch (err: any) {
    console.error("[Gemini Enrichment Error] Failed to generate suggestions:", err.message || err);
    return [];
  }
}

export function mergeSuggestions(suggestions: AlgorithmSuggestion[]): AlgorithmSuggestion[] {
  const byTemplate = new Map<string, AlgorithmSuggestion>();

  for (const suggestion of suggestions.filter(isValidSuggestion)) {
    const existing = byTemplate.get(suggestion.patternTemplate);
    if (!existing || suggestion.confidenceScore > existing.confidenceScore) {
      byTemplate.set(suggestion.patternTemplate, {
        ...suggestion,
        key: sanitizeKey(suggestion.key),
        confidenceScore: clampScore(suggestion.confidenceScore)
      });
    }
  }

  return [...byTemplate.values()];
}

function isValidSuggestion(suggestion: AlgorithmSuggestion): boolean {
  return (
    suggestion.key.length > 0 &&
    suggestion.patternTemplate.includes("@{domain}") &&
    allowedTemplatePattern.test(suggestion.patternTemplate)
  );
}

function sanitizeKey(value: string): string {
  return value
    .toLowerCase()
    .replace(/\{first\}/g, "first")
    .replace(/\{last\}/g, "last")
    .replace(/\{domain\}/g, "domain")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 80);
}

function clampScore(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}
