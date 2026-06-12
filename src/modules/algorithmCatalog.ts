import type { AlgorithmSuggestion } from "../types/emailIntelligence.js";

export const defaultAlgorithmSuggestions: AlgorithmSuggestion[] = [
  {
    key: "first_dot_last",
    patternTemplate: "{first}.{last}@{domain}",
    description: "First name dot last name",
    example: "ada.lovelace@example.com",
    confidenceScore: 20,
    source: "default_catalog"
  },
  {
    key: "first_last",
    patternTemplate: "{first}{last}@{domain}",
    description: "First name followed by last name",
    example: "adalovelace@example.com",
    confidenceScore: 20,
    source: "default_catalog"
  },
  {
    key: "first_initial_last",
    patternTemplate: "{first_initial}{last}@{domain}",
    description: "First initial followed by last name",
    example: "alovelace@example.com",
    confidenceScore: 20,
    source: "default_catalog"
  },
  {
    key: "first",
    patternTemplate: "{first}@{domain}",
    description: "First name only",
    example: "ada@example.com",
    confidenceScore: 20,
    source: "default_catalog"
  },
  {
    key: "last",
    patternTemplate: "{last}@{domain}",
    description: "Last name only",
    example: "lovelace@example.com",
    confidenceScore: 20,
    source: "default_catalog"
  },
  {
    key: "first_underscore_last",
    patternTemplate: "{first}_{last}@{domain}",
    description: "First name underscore last name",
    example: "ada_lovelace@example.com",
    confidenceScore: 20,
    source: "default_catalog"
  },
  {
    key: "first_dash_last",
    patternTemplate: "{first}-{last}@{domain}",
    description: "First name dash last name",
    example: "ada-lovelace@example.com",
    confidenceScore: 20,
    source: "default_catalog"
  },
  {
    key: "first_last_initial",
    patternTemplate: "{first}{last_initial}@{domain}",
    description: "First name followed by last initial",
    example: "adal@example.com",
    confidenceScore: 20,
    source: "default_catalog"
  }
  // {
  //   key: "first_last_two",
  //   patternTemplate: "{first}{last_two}@{domain}",
  //   description: "First name followed by first two letters of last name",
  //   example: "adalo@example.com",
  //   confidenceScore: 20,
  //   source: "default_catalog"
  // }
];

