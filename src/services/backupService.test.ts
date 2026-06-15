import { describe, expect, it, vi, beforeEach } from "vitest";

// Mock the Prisma Client
vi.mock("../lib/prisma.js", () => {
  return {
    prisma: {
      emailAlgorithm: { findMany: vi.fn(), createMany: vi.fn(), create: vi.fn(), deleteMany: vi.fn() },
      company: { findMany: vi.fn(), createMany: vi.fn(), create: vi.fn(), deleteMany: vi.fn() },
      companyEmailAlgorithm: { findMany: vi.fn(), createMany: vi.fn(), create: vi.fn(), deleteMany: vi.fn() },
      lead: { findMany: vi.fn(), createMany: vi.fn(), create: vi.fn(), deleteMany: vi.fn() },
      emailCandidate: { findMany: vi.fn(), createMany: vi.fn(), create: vi.fn(), deleteMany: vi.fn() },
      campaignState: { findMany: vi.fn(), createMany: vi.fn(), create: vi.fn(), deleteMany: vi.fn() },
      emailEvent: { findMany: vi.fn(), createMany: vi.fn(), create: vi.fn(), deleteMany: vi.fn() },
      suppressionEntry: { findMany: vi.fn(), createMany: vi.fn(), create: vi.fn(), deleteMany: vi.fn() },
      googleCredentials: { findMany: vi.fn(), createMany: vi.fn(), create: vi.fn(), deleteMany: vi.fn() },
      application: { findMany: vi.fn(), createMany: vi.fn(), create: vi.fn(), deleteMany: vi.fn() },
      template: { findMany: vi.fn(), createMany: vi.fn(), create: vi.fn(), deleteMany: vi.fn() },
      systemSetting: { findMany: vi.fn(), findUnique: vi.fn(), upsert: vi.fn(), delete: vi.fn() },
      $transaction: vi.fn((actions) => Promise.all(actions))
    }
  };
});

import { prisma } from "../lib/prisma.js";
import { createBackupSnapshot, listBackupSnapshots, restoreBackupSnapshot, deleteBackupSnapshot } from "./backupService.js";

describe("backupService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("createBackupSnapshot", () => {
    it("queries all tables and writes a backup snapshot to the database", async () => {
      vi.mocked(prisma.company.findMany).mockResolvedValue([{ id: "comp_1", name: "Zeta" }] as any);
      vi.mocked(prisma.lead.findMany).mockResolvedValue([{ id: "lead_1", fullName: "Chandan Kumar" }] as any);
      vi.mocked(prisma.systemSetting.upsert).mockResolvedValue({} as any);

      const result = await createBackupSnapshot();

      expect(prisma.company.findMany).toHaveBeenCalled();
      expect(prisma.lead.findMany).toHaveBeenCalled();
      expect(prisma.systemSetting.upsert).toHaveBeenCalled();
      expect(result.filename).toContain("backup_");
    });
  });

  describe("listBackupSnapshots", () => {
    it("returns sorted lists of backup rows from the database", async () => {
      vi.mocked(prisma.systemSetting.findMany).mockResolvedValue([
        { key: "backup_2.json", value: "{}", updatedAt: new Date("2026-06-06T10:00:00.000Z") },
        { key: "backup_1.json", value: "{}", updatedAt: new Date("2026-06-06T09:00:00.000Z") }
      ] as any);

      const list = await listBackupSnapshots();

      expect(list.length).toBe(2);
      expect(list[0].filename).toBe("backup_2.json");
      expect(list[1].filename).toBe("backup_1.json");
    });
  });

  describe("restoreBackupSnapshot - Replace Mode", () => {
    it("wipes tables and inserts snapshot data directly", async () => {
      const mockBackupData = {
        data: {
          companies: [{ id: "comp_1", name: "Zeta", normalizedName: "zeta" }],
          leads: [{ id: "lead_1", fullName: "Chandan Kumar", companyId: "comp_1" }]
        }
      };

      vi.mocked(prisma.systemSetting.findUnique).mockResolvedValue({
        key: "backup_1.json",
        value: JSON.stringify(mockBackupData)
      } as any);
      vi.mocked(prisma.emailEvent.deleteMany).mockResolvedValue({ count: 0 });
      vi.mocked(prisma.company.createMany).mockResolvedValue({ count: 1 });

      const result = await restoreBackupSnapshot("backup_1.json", "replace");

      expect(result.success).toBe(true);
      expect(prisma.company.deleteMany).toHaveBeenCalled();
      expect(prisma.company.createMany).toHaveBeenCalledWith({
        data: mockBackupData.data.companies
      });
    });
  });

  describe("restoreBackupSnapshot - Add Mode", () => {
    it("logically merges non-duplicate data and maps key references", async () => {
      const mockBackupData = {
        data: {
          companies: [
            { id: "comp_1", name: "Zeta", normalizedName: "zeta" },
            { id: "comp_2", name: "NewCorp", normalizedName: "newcorp" }
          ],
          leads: [
            { id: "lead_1", fullName: "Chandan Kumar", companyId: "comp_1", linkedinUrl: "li_1" }
          ]
        }
      };

      vi.mocked(prisma.systemSetting.findUnique).mockResolvedValue({
        key: "backup_1.json",
        value: JSON.stringify(mockBackupData)
      } as any);
      
      // Existing records mock
      vi.mocked(prisma.company.findMany).mockResolvedValue([
        { id: "comp_1_db", name: "Zeta", normalizedName: "zeta" }
      ] as any);
      vi.mocked(prisma.lead.findMany).mockResolvedValue([] as any);

      // Create mocks
      vi.mocked(prisma.company.create).mockResolvedValue({ id: "comp_2_new" } as any);
      vi.mocked(prisma.lead.create).mockResolvedValue({ id: "lead_1_new" } as any);

      const result = await restoreBackupSnapshot("backup_1.json", "add");

      expect(result.success).toBe(true);
      // Zeta already exists in DB so it should skip creating it
      expect(prisma.company.create).toHaveBeenCalledTimes(1); // Only NewCorp created
      expect(prisma.company.create).toHaveBeenCalledWith({
        data: {
          name: "NewCorp",
          normalizedName: "newcorp",
          domain: undefined,
          domainConfidence: undefined,
          domainSource: undefined,
          researchReason: undefined
        }
      });

      // Lead companyId should be mapped to the existing database company id "comp_1_db"
      expect(prisma.lead.create).toHaveBeenCalledWith({
        data: {
          fullName: "Chandan Kumar",
          firstName: undefined,
          middleName: undefined,
          lastName: undefined,
          companyId: "comp_1_db",
          linkedinUrl: "li_1",
          headline: undefined,
          source: undefined,
          status: undefined
        }
      });
    });
  });

  describe("deleteBackupSnapshot", () => {
    it("safely deletes the snapshot from the database if filename is valid", async () => {
      vi.mocked(prisma.systemSetting.delete).mockResolvedValue({} as any);

      const result = await deleteBackupSnapshot("backup_1.json");

      expect(prisma.systemSetting.delete).toHaveBeenCalledWith({
        where: { key: "backup_1.json" }
      });
      expect(result.success).toBe(true);
    });

    it("prevents directory traversal and returns false for invalid paths", async () => {
      const result = await deleteBackupSnapshot("../malicious_file.json");

      expect(prisma.systemSetting.delete).not.toHaveBeenCalled();
      expect(result.success).toBe(false);
      expect(result.message).toBe("Invalid backup filename.");
    });
  });
});
