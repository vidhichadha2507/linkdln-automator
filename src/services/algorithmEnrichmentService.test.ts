import { describe, expect, it } from "vitest";
import { mergeSuggestions } from "./algorithmEnrichmentService.js";

describe("mergeSuggestions", () => {
  it("keeps the highest-confidence suggestion for duplicate templates", () => {
    const suggestions = mergeSuggestions([
      {
        key: "low",
        patternTemplate: "{first}.{last}@{domain}",
        description: "Low confidence",
        example: "ada.lovelace@example.com",
        confidenceScore: 15,
        source: "test"
      },
      {
        key: "high",
        patternTemplate: "{first}.{last}@{domain}",
        description: "High confidence",
        example: "grace.hopper@example.com",
        confidenceScore: 80,
        source: "test"
      }
    ]);

    expect(suggestions).toHaveLength(1);
    expect(suggestions[0]?.key).toBe("high");
    expect(suggestions[0]?.confidenceScore).toBe(80);
  });

  it("rejects unsafe or unusable templates", () => {
    const suggestions = mergeSuggestions([
      {
        key: "safe",
        patternTemplate: "{first}@{domain}",
        description: "Safe template",
        example: "ada@example.com",
        confidenceScore: 40,
        source: "test"
      },
      {
        key: "unsafe",
        patternTemplate: "{first};DROP@{domain}",
        description: "Unsafe template",
        example: "bad@example.com",
        confidenceScore: 90,
        source: "test"
      },
      {
        key: "missing_domain",
        patternTemplate: "{first}.{last}",
        description: "Missing domain",
        example: "bad",
        confidenceScore: 90,
        source: "test"
      }
    ]);

    expect(suggestions.map((suggestion) => suggestion.key)).toEqual(["safe"]);
  });
});

