import { describe, expect, it, vi, beforeEach } from "vitest";

const mockEnv = vi.hoisted(() => {
  return {
    EMAIL_VERIFIER_PROVIDER: "local",
    HUNTER_API_KEY: ""
  };
});

vi.mock("../config/env.js", () => {
  return {
    env: mockEnv
  };
});

vi.mock("./settingsService.js", () => {
  return {
    getSystemSetting: vi.fn().mockImplementation((key) => {
      if (key === "emailVerifierProvider") {
        return mockEnv.EMAIL_VERIFIER_PROVIDER;
      }
      return null;
    })
  };
});

import { verifyEmail } from "./emailVerifierService.js";

describe("verifyEmail local provider", () => {
  beforeEach(() => {
    mockEnv.EMAIL_VERIFIER_PROVIDER = "local";
    mockEnv.HUNTER_API_KEY = "";
    vi.restoreAllMocks();
  });

  it("marks invalid syntax as invalid", async () => {
    await expect(
      verifyEmail({
        email: "not-an-email",
        syntaxValid: false,
        mxValid: true
      })
    ).resolves.toMatchObject({
      provider: "local",
      status: "invalid",
      score: 0
    });
  });

  it("marks syntax plus MX as domain_valid without claiming mailbox validity", async () => {
    await expect(
      verifyEmail({
        email: "ada@example.com",
        syntaxValid: true,
        mxValid: true
      })
    ).resolves.toMatchObject({
      provider: "local",
      status: "domain_valid",
      score: 55
    });
  });
});

describe("verifyEmail Hunter provider", () => {
  beforeEach(() => {
    mockEnv.EMAIL_VERIFIER_PROVIDER = "hunter";
    mockEnv.HUNTER_API_KEY = "test-api-key";
    vi.restoreAllMocks();
  });

  it("calls Hunter API and maps 'valid' status correctly", async () => {
    const mockHunterResponse = {
      data: {
        status: "valid",
        score: 95,
        result: "deliverable",
        accept_all: false
      }
    };

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => mockHunterResponse
    });
    global.fetch = mockFetch as any;

    const result = await verifyEmail({
      email: "test@company.com",
      syntaxValid: true,
      mxValid: true
    });

    expect(mockFetch).toHaveBeenCalled();
    expect(result).toEqual({
      email: "test@company.com",
      provider: "hunter",
      status: "valid",
      score: 95,
      isCatchAll: false,
      raw: mockHunterResponse
    });
  });

  it("maps accept_all/catch_all status correctly when accept_all is true", async () => {
    const mockHunterResponse = {
      data: {
        status: "accept_all",
        score: 70,
        result: "risky",
        accept_all: true
      }
    };

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => mockHunterResponse
    });
    global.fetch = mockFetch as any;

    const result = await verifyEmail({
      email: "catchall@company.com",
      syntaxValid: true,
      mxValid: true
    });

    expect(result).toMatchObject({
      provider: "hunter",
      status: "accept_all",
      isCatchAll: true
    });
  });

  it("falls back to local verification when Hunter API request fails (non-ok response)", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: false
    });
    global.fetch = mockFetch as any;

    const result = await verifyEmail({
      email: "test@company.com",
      syntaxValid: true,
      mxValid: true
    });

    expect(result).toEqual({
      email: "test@company.com",
      provider: "local",
      status: "domain_valid",
      score: 55,
      isCatchAll: false
    });
  });

  it("falls back to local verification when syntax is invalid before calling Hunter", async () => {
    const mockFetch = vi.fn();
    global.fetch = mockFetch as any;

    const result = await verifyEmail({
      email: "invalid-syntax",
      syntaxValid: false,
      mxValid: true
    });

    expect(mockFetch).not.toHaveBeenCalled();
    expect(result.provider).toBe("local");
    expect(result.status).toBe("invalid");
  });
});
