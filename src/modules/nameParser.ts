export type ParsedName = {
  fullName: string;
  firstName: string;
  middleName?: string;
  lastName?: string;
};

const removableSuffixes = new Set(["jr", "sr", "ii", "iii", "iv", "phd", "mba", "md"]);

export function parseName(fullName: string): ParsedName {
  const cleaned = fullName
    .trim()
    .replace(/\s+/g, " ")
    .replace(/[.,]+$/g, "");

  if (!cleaned) {
    throw new Error("Full name is required");
  }

  const parts = cleaned
    .split(" ")
    .map((part) => part.replace(/[.,]/g, ""))
    .filter((part) => part.length > 0)
    .filter((part) => !removableSuffixes.has(part.toLowerCase()));

  const [firstName, ...remaining] = parts;

  if (!firstName) {
    throw new Error("First name could not be parsed");
  }

  if (remaining.length === 0) {
    return { fullName: cleaned, firstName };
  }

  const lastName = remaining[remaining.length - 1];
  const middleName = remaining.slice(0, -1).join(" ") || undefined;

  return { fullName: cleaned, firstName, middleName, lastName };
}

