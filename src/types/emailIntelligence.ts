export type AlgorithmSuggestion = {
  key: string;
  patternTemplate: string;
  description: string;
  example: string;
  confidenceScore: number;
  source: string;
};

export type DomainResolution = {
  domain: string;
  confidence: number;
  source: string;
};

export type VerificationStatus =
  | "valid"
  | "invalid"
  | "accept_all"
  | "catch_all"
  | "risky"
  | "unknown"
  | "domain_valid";

export type EmailVerificationResult = {
  email: string;
  provider: string;
  status: VerificationStatus;
  score: number;
  isCatchAll: boolean;
  raw?: unknown;
};

