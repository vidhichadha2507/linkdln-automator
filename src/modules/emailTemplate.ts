import type { ParsedName } from "./nameParser.js";
import { normalizeDomain } from "./companyNormalizer.js";

export type TemplateContext = ParsedName & {
  domain: string;
};

function normalizeToken(value: string | undefined): string {
  return (value ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

export function renderEmailTemplate(patternTemplate: string, context: TemplateContext): string | null {
  const first = normalizeToken(context.firstName);
  const middle = normalizeToken(context.middleName);
  const last = normalizeToken(context.lastName);
  const domain = normalizeDomain(context.domain);
  const values: Record<string, string> = {
    first,
    middle,
    last,
    first_initial: first.slice(0, 1),
    middle_initial: middle.slice(0, 1),
    last_initial: last.slice(0, 1),
    first_two: first.slice(0, 2),
    last_two: last.slice(0, 2),
    first_three: first.slice(0, 3),
    last_three: last.slice(0, 3),
    domain
  };

  const rendered = patternTemplate.replace(/\{([a-z_]+)\}/g, (_, token: string) => values[token] ?? "");

  if (rendered.includes("{}") || rendered.startsWith("@") || rendered.includes("..")) {
    return null;
  }

  const localPart = rendered.split("@")[0] ?? "";
  if (!localPart || !domain) {
    return null;
  }

  return rendered;
}

