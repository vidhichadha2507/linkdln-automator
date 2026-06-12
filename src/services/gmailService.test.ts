import { describe, expect, it, vi, beforeEach } from "vitest";

const mockEnv = vi.hoisted(() => {
  return {
    GMAIL_MONITOR_ENABLED: false,
    GMAIL_CLIENT_ID: "",
    GMAIL_CLIENT_SECRET: "",
    GMAIL_REFRESH_TOKEN: "",
    DATABASE_URL: "postgresql://localhost:5432",
    NODE_ENV: "test"
  };
});

vi.mock("../config/env.js", () => {
  return {
    env: mockEnv
  };
});

vi.mock("../lib/prisma.js", () => {
  return {
    prisma: {
      emailCandidate: {
        findMany: vi.fn(),
      },
      googleCredentials: {
        findUnique: vi.fn(),
        upsert: vi.fn(),
        update: vi.fn(),
        delete: vi.fn()
      }
    }
  };
});

vi.mock("./emailEventService.js", () => {
  return {
    recordEmailEvent: vi.fn()
  };
});

import { prisma } from "../lib/prisma.js";
import { recordEmailEvent } from "./emailEventService.js";
import { pollGmailBounces, simulateGmailBounce, getIsEnvTokenExpired, setIsEnvTokenExpired, isGmailQuotaError, isGmailQuotaHalted, setGmailQuotaHalted, sendGmailEmail } from "./gmailService.js";

describe("gmailService initialization and error boundaries", () => {
  beforeEach(() => {
    mockEnv.GMAIL_MONITOR_ENABLED = false;
    mockEnv.GMAIL_CLIENT_ID = "";
    mockEnv.GMAIL_CLIENT_SECRET = "";
    mockEnv.GMAIL_REFRESH_TOKEN = "";
    vi.clearAllMocks();
  });

  it("gracefully declines polling when credentials are empty or disabled", async () => {
    const result = await pollGmailBounces();
    expect(result).toMatchObject({
      success: false
    });
    expect(result.message).toContain("monitoring");
  });

  it("fails simulation when candidate email does not exist in local database", async () => {
    vi.mocked(prisma.emailCandidate.findMany).mockResolvedValue([]);

    const result = await simulateGmailBounce("non-existent-candidate-email-999@test.com");
    expect(result).toMatchObject({
      success: false
    });
    expect(result.message).toContain("No candidate found");
  });
});

describe("pollGmailBounces active polling and processing", () => {
  beforeEach(() => {
    mockEnv.GMAIL_MONITOR_ENABLED = true;
    mockEnv.GMAIL_CLIENT_ID = "client_id";
    mockEnv.GMAIL_CLIENT_SECRET = "client_secret";
    mockEnv.GMAIL_REFRESH_TOKEN = "refresh_token";
    vi.clearAllMocks();
  });

  it("refreshes token, polls mailer-daemon emails, extracts bounced emails, and records events in DB", async () => {
    // Arrange
    const mockTokenResponse = { access_token: "mock_access_token" };
    const mockListResponse = {
      messages: [{ id: "msg_1", threadId: "th_1" }]
    };
    const mockDetailResponse = {
      id: "msg_1",
      threadId: "th_1",
      snippet: "Delivery Status Notification (Failure)",
      payload: {
        headers: [
          { name: "Subject", value: "Delivery Status Notification" },
          { name: "From", value: "mailer-daemon@googlemail.com" }
        ],
        body: {
          size: 100,
          data: Buffer.from("The email address john@bounced-target.com was undeliverable.").toString("base64")
        }
      }
    };

    const mockFetch = vi.fn().mockImplementation(async (url: string) => {
      if (url.includes("oauth2.googleapis.com")) {
        return { ok: true, json: async () => mockTokenResponse };
      }
      if (url.includes("users/me/messages") && !url.includes("msg_1")) {
        return { ok: true, json: async () => mockListResponse };
      }
      if (url.includes("users/me/messages/msg_1")) {
        return { ok: true, json: async () => mockDetailResponse };
      }
      return { ok: false };
    });
    global.fetch = mockFetch as any;

    const mockCandidate = { id: "cand_bounced", email: "john@bounced-target.com", events: [] };
    vi.mocked(prisma.emailCandidate.findMany).mockImplementation(async (args: any) => {
      if (args?.where?.email === "john@bounced-target.com") {
        return [mockCandidate] as any;
      }
      return [];
    });

    // Act
    const result = await pollGmailBounces();

    // Assert
    expect(mockFetch).toHaveBeenCalledTimes(3); // OAuth refresh + list messages + get detail
    expect(prisma.emailCandidate.findMany).toHaveBeenCalledWith({
      where: { email: "john@bounced-target.com" },
      include: { events: true }
    });
    expect(recordEmailEvent).toHaveBeenCalledWith({
      candidateId: "cand_bounced",
      email: "john@bounced-target.com",
      eventType: "bounce",
      provider: "gmail",
      rawPayload: expect.objectContaining({
        messageId: "msg_1",
        threadId: "th_1"
      })
    });

    expect(result).toEqual({
      success: true,
      message: "Successfully polled Gmail. Processed 1 bounce messages.",
      processedCount: 1,
      bouncesFound: ["john@bounced-target.com"]
    });
  });

  it("does not record double bounces for already processed Gmail message IDs", async () => {
    // Arrange
    const mockTokenResponse = { access_token: "mock_access_token" };
    const mockListResponse = { messages: [{ id: "msg_1", threadId: "th_1" }] };
    const mockDetailResponse = {
      id: "msg_1",
      threadId: "th_1",
      snippet: "Delivery Status Notification (Failure)",
      payload: {
        headers: [],
        body: {
          size: 100,
          data: Buffer.from("The email address john@bounced-target.com was undeliverable.").toString("base64")
        }
      }
    };

    const mockFetch = vi.fn().mockImplementation(async (url: string) => {
      if (url.includes("oauth2.googleapis.com")) {
        return { ok: true, json: async () => mockTokenResponse };
      }
      if (url.includes("users/me/messages") && !url.includes("msg_1")) {
        return { ok: true, json: async () => mockListResponse };
      }
      if (url.includes("users/me/messages/msg_1")) {
        return { ok: true, json: async () => mockDetailResponse };
      }
      return { ok: false };
    });
    global.fetch = mockFetch as any;

    const mockCandidate = {
      id: "cand_bounced",
      email: "john@bounced-target.com",
      events: [
        { eventType: "bounce", rawPayload: { messageId: "msg_1" } } // Already processed msg_1
      ]
    };
    vi.mocked(prisma.emailCandidate.findMany).mockImplementation(async (args: any) => {
      if (args?.where?.email === "john@bounced-target.com") {
        return [mockCandidate] as any;
      }
      return [];
    });

    // Act
    const result = await pollGmailBounces();

    // Assert
    expect(recordEmailEvent).not.toHaveBeenCalled();
    expect(result.bouncesFound).toEqual([]);
  });
});

describe("getAccessToken OAuth resolution logic tests", () => {
  beforeEach(() => {
    mockEnv.GMAIL_MONITOR_ENABLED = true;
    mockEnv.GMAIL_CLIENT_ID = "client_id";
    mockEnv.GMAIL_CLIENT_SECRET = "client_secret";
    mockEnv.GMAIL_REFRESH_TOKEN = "";
    vi.clearAllMocks();
  });

  it("resolves the refresh token from the database if present", async () => {
    // Arrange
    vi.mocked(prisma.googleCredentials.findUnique).mockResolvedValue({
      key: "gmail_outreach",
      refreshToken: "db_token_123",
      createdAt: new Date(),
      updatedAt: new Date()
    } as any);

    let requestedBody: string | null = null;
    const mockFetch = vi.fn().mockImplementation(async (url: string, init?: any) => {
      if (url.includes("oauth2.googleapis.com")) {
        requestedBody = init?.body?.toString() || null;
        return { ok: true, json: async () => ({ access_token: "mocked_db_access_token" }) };
      }
      return { ok: true, json: async () => ({}) };
    });
    global.fetch = mockFetch as any;

    // Act
    await pollGmailBounces();

    // Assert
    expect(prisma.googleCredentials.findUnique).toHaveBeenCalledWith({
      where: { key: "gmail_outreach" }
    });
    expect(requestedBody).toContain("refresh_token=db_token_123");
  });

  it("falls back to env.GMAIL_REFRESH_TOKEN if database credentials are not found", async () => {
    // Arrange
    mockEnv.GMAIL_REFRESH_TOKEN = "env_token_456";
    vi.mocked(prisma.googleCredentials.findUnique).mockResolvedValue(null);

    let requestedBody: string | null = null;
    const mockFetch = vi.fn().mockImplementation(async (url: string, init?: any) => {
      if (url.includes("oauth2.googleapis.com")) {
        requestedBody = init?.body?.toString() || null;
        return { ok: true, json: async () => ({ access_token: "mocked_env_access_token" }) };
      }
      return { ok: true, json: async () => ({}) };
    });
    global.fetch = mockFetch as any;

    // Act
    await pollGmailBounces();

    // Assert
    expect(requestedBody).toContain("refresh_token=env_token_456");
  });

  it("declines polling and returns success false if no token is found in DB or env", async () => {
    // Arrange
    vi.mocked(prisma.googleCredentials.findUnique).mockResolvedValue(null);

    // Act
    const result = await pollGmailBounces();

    // Assert
    expect(result.success).toBe(false);
    expect(result.message).toContain("Gmail connection is not active");
  });

  it("disconnects database credentials if refresh token request fails with invalid_grant", async () => {
    // Arrange
    vi.mocked(prisma.googleCredentials.findUnique).mockResolvedValue({
      key: "gmail_outreach",
      refreshToken: "expired_db_token",
      createdAt: new Date(),
      updatedAt: new Date()
    } as any);
    
    const mockUpdate = vi.fn().mockResolvedValue({} as any);
    vi.mocked(prisma.googleCredentials.update).mockImplementation(mockUpdate);

    const mockFetch = vi.fn().mockImplementation(async (url: string, init?: any) => {
      if (url.includes("oauth2.googleapis.com")) {
        return {
          ok: false,
          status: 400,
          text: async () => JSON.stringify({ error: "invalid_grant", error_description: "Bad Request" })
        };
      }
      return { ok: true, json: async () => ({}) };
    });
    global.fetch = mockFetch as any;

    // Act
    const result = await pollGmailBounces();

    // Assert
    expect(result.success).toBe(false);
    expect(result.message).toContain("Failed to refresh Google access token");
    expect(mockUpdate).toHaveBeenCalledWith({
      where: { key: "gmail_outreach" },
      data: { refreshToken: "disconnected" }
    });
  });

  it("sets isEnvTokenExpired to true if env credentials refresh fails with invalid_grant", async () => {
    // Arrange
    mockEnv.GMAIL_REFRESH_TOKEN = "expired_env_token";
    vi.mocked(prisma.googleCredentials.findUnique).mockResolvedValue(null);
    setIsEnvTokenExpired(false);

    const mockFetch = vi.fn().mockImplementation(async (url: string, init?: any) => {
      if (url.includes("oauth2.googleapis.com")) {
        return {
          ok: false,
          status: 401,
          text: async () => JSON.stringify({ error: "invalid_grant" })
        };
      }
      return { ok: true, json: async () => ({}) };
    });
    global.fetch = mockFetch as any;

    // Act
    const result = await pollGmailBounces();

    // Assert
    expect(result.success).toBe(false);
    expect(result.message).toContain("Failed to refresh Google access token");
    expect(getIsEnvTokenExpired()).toBe(true);
  });
});

describe("Gmail daily quota limit handling", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("isGmailQuotaError identifies quota-related errors correctly", () => {
    expect(isGmailQuotaError("Daily Limit Exceeded", 403)).toBe(true);
    expect(isGmailQuotaError("dailyLimitExceeded", 403)).toBe(true);
    expect(isGmailQuotaError("quotaExceeded", 403)).toBe(true);
    expect(isGmailQuotaError("User Rate Limit Exceeded", 429)).toBe(true);
    expect(isGmailQuotaError("userratelimitexceeded", 429)).toBe(true);
    expect(isGmailQuotaError("Some other error", 403)).toBe(false);
    expect(isGmailQuotaError("Some other error", 500)).toBe(false);
  });

  it("isGmailQuotaHalted returns true if today is halted, false if not halted or halted yesterday (and cleans up)", async () => {
    // 1. Not halted at all
    vi.mocked(prisma.googleCredentials.findUnique).mockResolvedValueOnce(null);
    expect(await isGmailQuotaHalted()).toBe(false);

    // Get today's local date string
    const d = new Date();
    const offset = d.getTimezoneOffset();
    const localDate = new Date(d.getTime() - (offset * 60 * 1000));
    const todayStr = localDate.toISOString().split("T")[0];

    // 2. Halted today
    vi.mocked(prisma.googleCredentials.findUnique).mockResolvedValueOnce({
      key: "gmail_quota_halt",
      refreshToken: todayStr
    } as any);
    expect(await isGmailQuotaHalted()).toBe(true);

    // 3. Halted yesterday (expired) -> should delete and return false
    vi.mocked(prisma.googleCredentials.findUnique).mockResolvedValueOnce({
      key: "gmail_quota_halt",
      refreshToken: "2026-06-08" // yesterday compared to today in test
    } as any);
    vi.mocked(prisma.googleCredentials.delete).mockResolvedValueOnce({} as any);
    
    expect(await isGmailQuotaHalted()).toBe(false);
    expect(prisma.googleCredentials.delete).toHaveBeenCalledWith({
      where: { key: "gmail_quota_halt" }
    });
  });

  it("setGmailQuotaHalted upserts key on true and deletes on false", async () => {
    // Set halt
    vi.mocked(prisma.googleCredentials.upsert).mockResolvedValueOnce({} as any);
    await setGmailQuotaHalted(true);
    expect(prisma.googleCredentials.upsert).toHaveBeenCalledWith({
      where: { key: "gmail_quota_halt" },
      update: expect.any(Object),
      create: expect.any(Object)
    });

    // Reset halt
    vi.mocked(prisma.googleCredentials.delete).mockResolvedValueOnce({} as any);
    await setGmailQuotaHalted(false);
    expect(prisma.googleCredentials.delete).toHaveBeenCalledWith({
      where: { key: "gmail_quota_halt" }
    });
  });

  it("sendGmailEmail automatically sets halt on quota error", async () => {
    mockEnv.GMAIL_MONITOR_ENABLED = true;
    mockEnv.GMAIL_CLIENT_ID = "client_id";
    mockEnv.GMAIL_CLIENT_SECRET = "client_secret";
    mockEnv.GMAIL_REFRESH_TOKEN = "refresh_token";

    // Mock token retrieval success
    const mockTokenResponse = { access_token: "mock_access_token" };
    
    // Mock fetch to return a quota error
    const mockFetch = vi.fn().mockImplementation(async (url: string) => {
      if (url.includes("oauth2.googleapis.com")) {
        return { ok: true, json: async () => mockTokenResponse };
      }
      if (url.includes("gmail.googleapis.com")) {
        return {
          ok: false,
          status: 403,
          text: async () => JSON.stringify({
            error: {
              errors: [{ reason: "dailyLimitExceeded" }],
              code: 403,
              message: "Daily Limit Exceeded"
            }
          })
        };
      }
      return { ok: false };
    });
    global.fetch = mockFetch as any;

    vi.mocked(prisma.googleCredentials.findUnique).mockResolvedValue({
      key: "gmail_outreach",
      refreshToken: "db_token_123"
    } as any);

    vi.mocked(prisma.googleCredentials.upsert).mockResolvedValue({} as any);

    const result = await sendGmailEmail("target@test.com", "Hello", "World");
    
    expect(result.success).toBe(false);
    expect(result.error).toContain("Daily Limit Exceeded");
    expect(prisma.googleCredentials.upsert).toHaveBeenCalledWith({
      where: { key: "gmail_quota_halt" },
      update: expect.any(Object),
      create: expect.any(Object)
    });
  });
});

