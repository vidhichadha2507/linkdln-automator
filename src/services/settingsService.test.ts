import { describe, expect, it, vi, beforeEach } from "vitest";

// Mock prisma and env
const mockEnv = vi.hoisted(() => {
  return {
    DEFAULT_RESUME_LINK: "https://drive.google.com/test",
    EMAIL_VERIFIER_PROVIDER: "local",
    ENABLE_AI_PATTERN_DISCOVERY: false,
    GMAIL_MONITOR_ENABLED: false
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
      systemSetting: {
        findUnique: vi.fn(),
        upsert: vi.fn()
      }
    }
  };
});

import { prisma } from "../lib/prisma.js";
import { getSystemSetting, getAllSystemSettings, updateSystemSettings, DEFAULT_SETTINGS } from "./settingsService.js";

describe("settingsService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("getSystemSetting", () => {
    it("falls back to DEFAULT_SETTINGS when database record does not exist", async () => {
      vi.mocked(prisma.systemSetting.findUnique).mockResolvedValue(null);

      const respectTiming = await getSystemSetting("respectTiming");
      expect(respectTiming).toBe(false);

      const defaultResume = await getSystemSetting("defaultResumeLink");
      expect(defaultResume).toBe("https://drive.google.com/test");
    });

    it("parses boolean settings correctly when present in the database", async () => {
      vi.mocked(prisma.systemSetting.findUnique).mockResolvedValue({
        key: "respectTiming",
        value: "true",
        createdAt: new Date(),
        updatedAt: new Date()
      } as any);

      const respectTiming = await getSystemSetting("respectTiming");
      expect(respectTiming).toBe(true);
    });

    it("parses number settings correctly when present in the database", async () => {
      vi.mocked(prisma.systemSetting.findUnique).mockResolvedValue({
        key: "followupIntervalMinutes",
        value: "95",
        createdAt: new Date(),
        updatedAt: new Date()
      } as any);

      const followupInterval = await getSystemSetting("followupIntervalMinutes");
      expect(followupInterval).toBe(95);
    });

    it("parses string settings correctly when present in the database", async () => {
      vi.mocked(prisma.systemSetting.findUnique).mockResolvedValue({
        key: "defaultResumeLink",
        value: "https://drive.google.com/custom",
        createdAt: new Date(),
        updatedAt: new Date()
      } as any);

      const resumeLink = await getSystemSetting("defaultResumeLink");
      expect(resumeLink).toBe("https://drive.google.com/custom");
    });
  });

  describe("getAllSystemSettings", () => {
    it("returns all configurations in an object", async () => {
      vi.mocked(prisma.systemSetting.findUnique).mockResolvedValue(null);

      const all = await getAllSystemSettings();
      expect(all).toEqual({
        respectTiming: false,
        skipWeekends: true,
        timingStartHour: 9,
        timingEndHour: 17,
        followupIntervalMinutes: 70,
        maxFollowups: 3,
        defaultResumeLink: "https://drive.google.com/test",
        emailVerifierProvider: "local",
        enableAiPatternDiscovery: false,
        gmailMonitorEnabled: false,
        jobSearchEnabled: false,
        jobSearchQuery: "DevOps Engineer",
        jobSearchLocations: "Bengaluru, Noida, Gurugram, Pune",
        jobSearchWorkplaceTypes: "Hybrid, Remote",
        jobSearchKeywords: "5 days",
        jobSearchInterval: 10,
        jobSearchTimeRange: "r604800",
        timezone: "Asia/Kolkata"
      });
    });
  });

  describe("updateSystemSettings", () => {
    it("upserts modified settings to database", async () => {
      vi.mocked(prisma.systemSetting.upsert).mockResolvedValue({} as any);
      vi.mocked(prisma.systemSetting.findUnique).mockResolvedValue(null);

      const updated = await updateSystemSettings({
        respectTiming: true,
        maxFollowups: 5
      });

      expect(prisma.systemSetting.upsert).toHaveBeenCalledTimes(2);
      expect(prisma.systemSetting.upsert).toHaveBeenCalledWith({
        where: { key: "respectTiming" },
        update: { value: "true" },
        create: { key: "respectTiming", value: "true" }
      });
      expect(prisma.systemSetting.upsert).toHaveBeenCalledWith({
        where: { key: "maxFollowups" },
        update: { value: "5" },
        create: { key: "maxFollowups", value: "5" }
      });
    });

    it("throws a Zod validation error for invalid settings payloads", async () => {
      await expect(
        updateSystemSettings({
          maxFollowups: -2 // invalid: must be non-negative
        })
      ).rejects.toThrow();

      await expect(
        updateSystemSettings({
          defaultResumeLink: "not-a-url" // invalid url
        })
      ).rejects.toThrow();
    });
  });
});
