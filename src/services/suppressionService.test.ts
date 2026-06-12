import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("../lib/prisma.js", () => {
  return {
    prisma: {
      suppressionEntry: {
        findFirst: vi.fn(),
        create: vi.fn()
      }
    }
  };
});

import { prisma } from "../lib/prisma.js";
import { checkSuppression, addSuppression } from "./suppressionService.js";

describe("suppressionService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("checkSuppression", () => {
    it("returns suppressed false if no entry is found", async () => {
      vi.mocked(prisma.suppressionEntry.findFirst).mockResolvedValue(null);

      const result = await checkSuppression("test@example.com");
      expect(result).toEqual({ suppressed: false });
      expect(prisma.suppressionEntry.findFirst).toHaveBeenCalledWith({
        where: {
          OR: [
            { email: "test@example.com" },
            { domain: "example.com" }
          ]
        },
        orderBy: { createdAt: "desc" }
      });
    });

    it("returns suppressed true with reason and source if match is found", async () => {
      const mockEntry = {
        id: "supp_1",
        email: "test@example.com",
        domain: null,
        reason: "unsubscribed",
        source: "outbox",
        createdAt: new Date()
      };
      vi.mocked(prisma.suppressionEntry.findFirst).mockResolvedValue(mockEntry);

      const result = await checkSuppression("test@example.com");
      expect(result).toEqual({
        suppressed: true,
        reason: "unsubscribed",
        source: "outbox"
      });
    });
  });

  describe("addSuppression", () => {
    it("throws an error if both email and domain are omitted", async () => {
      await expect(
        addSuppression({ reason: "optout", source: "api" })
      ).rejects.toThrow("Either email or domain is required");
    });

    it("creates a suppression entry with normalized email", async () => {
      const mockEntry = {
        id: "supp_1",
        email: "test@example.com",
        domain: null,
        reason: "optout",
        source: "api"
      };
      vi.mocked(prisma.suppressionEntry.create).mockResolvedValue(mockEntry as any);

      const result = await addSuppression({
        email: " TEST@EXAMPLE.COM  ",
        reason: "optout",
        source: "api"
      });

      expect(prisma.suppressionEntry.create).toHaveBeenCalledWith({
        data: {
          email: "test@example.com",
          domain: undefined,
          reason: "optout",
          source: "api"
        }
      });
      expect(result).toEqual(mockEntry);
    });

    it("creates a suppression entry with normalized domain", async () => {
      const mockEntry = {
        id: "supp_2",
        email: null,
        domain: "example.com",
        reason: "blocklist",
        source: "admin"
      };
      vi.mocked(prisma.suppressionEntry.create).mockResolvedValue(mockEntry as any);

      await addSuppression({
        domain: "WWW.EXAMPLE.COM",
        reason: "blocklist",
        source: "admin"
      });

      expect(prisma.suppressionEntry.create).toHaveBeenCalledWith({
        data: {
          email: undefined,
          domain: "example.com",
          reason: "blocklist",
          source: "admin"
        }
      });
    });
  });
});
