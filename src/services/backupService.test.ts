import { describe, expect, it, vi, beforeEach } from "vitest";
import fs from "node:fs/promises";

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
      $transaction: vi.fn((actions) => Promise.all(actions))
    }
  };
});

// Mock fs/promises
vi.mock("node:fs/promises", () => {
  return {
    default: {
      mkdir: vi.fn(),
      writeFile: vi.fn(),
      readFile: vi.fn(),
      readdir: vi.fn(),
      stat: vi.fn(),
      unlink: vi.fn(),
      access: vi.fn()
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
    it("queries all tables and writes a backup snapshot file", async () => {
      vi.mocked(prisma.company.findMany).mockResolvedValue([{ id: "comp_1", name: "Zeta" }] as any);
      vi.mocked(prisma.lead.findMany).mockResolvedValue([{ id: "lead_1", fullName: "Chandan Kumar" }] as any);
      vi.mocked(fs.writeFile).mockResolvedValue(undefined);

      const result = await createBackupSnapshot();

      expect(prisma.company.findMany).toHaveBeenCalled();
      expect(prisma.lead.findMany).toHaveBeenCalled();
      expect(fs.mkdir).toHaveBeenCalled();
      expect(fs.writeFile).toHaveBeenCalled();
      expect(result.filename).toContain("backup_");
    });
  });

  describe("listBackupSnapshots", () => {
    it("returns sorted lists of backup files from the backups folder", async () => {
      vi.mocked(fs.readdir).mockResolvedValue(["backup_1.json", "backup_2.json"] as any);
      vi.mocked(fs.stat).mockImplementation(async (filePath: any) => {
        if (filePath.endsWith("backup_1.json")) {
          return { size: 100, mtime: new Date("2026-06-06T09:00:00.000Z") } as any;
        }
        return { size: 200, mtime: new Date("2026-06-06T10:00:00.000Z") } as any;
      });

      const list = await listBackupSnapshots();

      expect(list.length).toBe(2);
      // Sorted desc by time: backup_2 first
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

      vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify(mockBackupData));
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

      vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify(mockBackupData));
      
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
    it("safely unlinks the snapshot file if it exists and path is valid", async () => {
      vi.mocked(fs.access).mockResolvedValue(undefined);
      vi.mocked(fs.unlink).mockResolvedValue(undefined);

      const result = await deleteBackupSnapshot("backup_1.json");

      expect(fs.access).toHaveBeenCalled();
      expect(fs.unlink).toHaveBeenCalled();
      expect(result.success).toBe(true);
    });

    it("prevents directory traversal and returns false for invalid paths", async () => {
      const result = await deleteBackupSnapshot("../malicious_file.json");

      expect(fs.unlink).not.toHaveBeenCalled();
      expect(result.success).toBe(false);
      expect(result.message).toBe("Invalid backup file path.");
    });

    it("returns success false if file access or unlink fails", async () => {
      vi.mocked(fs.access).mockRejectedValue(new Error("File not found"));

      const result = await deleteBackupSnapshot("backup_nonexistent.json");

      expect(fs.unlink).not.toHaveBeenCalled();
      expect(result.success).toBe(false);
    });
  });
});
