import { env } from "../config/env.js";
import { getSystemSetting } from "./settingsService.js";
import type { EmailVerificationResult, VerificationStatus } from "../types/emailIntelligence.js";

type VerifyInput = {
  email: string;
  syntaxValid: boolean;
  mxValid: boolean;
};

type HunterResponse = {
  data?: {
    status?: string;
    score?: number;
    result?: string;
    accept_all?: boolean;
  };
};

export async function verifyEmail(input: VerifyInput): Promise<EmailVerificationResult> {
  const provider = await getSystemSetting("emailVerifierProvider");
  if (provider === "hunter" && env.HUNTER_API_KEY) {
    return verifyWithHunter(input);
  }

  return verifyLocally(input);
}

function verifyLocally(input: VerifyInput): EmailVerificationResult {
  if (!input.syntaxValid) {
    return {
      email: input.email,
      provider: "local",
      status: "invalid",
      score: 0,
      isCatchAll: false
    };
  }

  if (!input.mxValid) {
    return {
      email: input.email,
      provider: "local",
      status: "unknown",
      score: 20,
      isCatchAll: false
    };
  }

  return {
    email: input.email,
    provider: "local",
    status: "domain_valid",
    score: 55,
    isCatchAll: false
  };
}

async function verifyWithHunter(input: VerifyInput): Promise<EmailVerificationResult> {
  if (!input.syntaxValid) {
    return verifyLocally(input);
  }

  const url = new URL("https://api.hunter.io/v2/email-verifier");
  url.searchParams.set("email", input.email);
  url.searchParams.set("api_key", env.HUNTER_API_KEY ?? "");

  const response = await fetch(url);
  if (!response.ok) {
    return verifyLocally(input);
  }

  const body = (await response.json()) as HunterResponse;
  const data = body.data;
  const isCatchAll = Boolean(data?.accept_all);
  const status = mapHunterStatus(data?.status, data?.result, isCatchAll);

  return {
    email: input.email,
    provider: "hunter",
    status,
    score: Math.max(0, Math.min(100, Math.round(data?.score ?? 0))),
    isCatchAll,
    raw: body
  };
}

function mapHunterStatus(status: string | undefined, result: string | undefined, isCatchAll: boolean): VerificationStatus {
  if (isCatchAll) {
    return "accept_all";
  }

  const normalized = (status ?? result ?? "").toLowerCase();
  if (normalized.includes("valid")) {
    return "valid";
  }
  if (normalized.includes("invalid")) {
    return "invalid";
  }
  if (normalized.includes("accept")) {
    return "accept_all";
  }
  if (normalized.includes("risky") || normalized.includes("webmail") || normalized.includes("disposable")) {
    return "risky";
  }
  return "unknown";
}

