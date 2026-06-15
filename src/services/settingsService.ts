import { prisma } from "../lib/prisma.js";
import { env } from "../config/env.js";
import { z } from "zod";

export interface SystemSettings {
  respectTiming: boolean;
  skipWeekends: boolean;
  timingStartHour: number;
  timingEndHour: number;
  followupIntervalMinutes: number;
  maxFollowups: number;
  defaultResumeLink: string;
  emailVerifierProvider: "local" | "hunter";
  enableAiPatternDiscovery: boolean;
  gmailMonitorEnabled: boolean;
  jobSearchEnabled: boolean;
  jobSearchQuery: string;
  jobSearchLocations: string;
  jobSearchWorkplaceTypes: string;
  jobSearchKeywords: string;
  jobSearchInterval: number;
  jobSearchTimeRange: string;
  timezone: string;
}

export const settingsSchema = z.object({
  respectTiming: z.boolean(),
  skipWeekends: z.boolean(),
  timingStartHour: z.number().int().min(0).max(23),
  timingEndHour: z.number().int().min(0).max(23),
  followupIntervalMinutes: z.number().int().positive(),
  maxFollowups: z.number().int().nonnegative(),
  defaultResumeLink: z.string().url(),
  emailVerifierProvider: z.enum(["local", "hunter"]),
  enableAiPatternDiscovery: z.boolean(),
  gmailMonitorEnabled: z.boolean(),
  jobSearchEnabled: z.boolean(),
  jobSearchQuery: z.string().trim().min(1),
  jobSearchLocations: z.string().trim(),
  jobSearchWorkplaceTypes: z.string().trim(),
  jobSearchKeywords: z.string().trim(),
  jobSearchInterval: z.number().int().positive(),
  jobSearchTimeRange: z.string().trim().min(1),
  timezone: z.string().trim().min(1),
});

export const DEFAULT_SETTINGS: SystemSettings = {
  get respectTiming(): boolean { return false; },
  get skipWeekends(): boolean { return true; },
  get timingStartHour(): number { return 9; },
  get timingEndHour(): number { return 17; },
  get followupIntervalMinutes(): number { return 70; },
  get maxFollowups(): number { return 3; },
  get defaultResumeLink(): string { return env.DEFAULT_RESUME_LINK; },
  get emailVerifierProvider(): "local" | "hunter" { return env.EMAIL_VERIFIER_PROVIDER as "local" | "hunter"; },
  get enableAiPatternDiscovery(): boolean { return env.ENABLE_AI_PATTERN_DISCOVERY; },
  get gmailMonitorEnabled(): boolean { return env.GMAIL_MONITOR_ENABLED; },
  get jobSearchEnabled(): boolean { return false; },
  get jobSearchQuery(): string { return "DevOps Engineer"; },
  get jobSearchLocations(): string { return "Bengaluru, Noida, Gurugram, Pune"; },
  get jobSearchWorkplaceTypes(): string { return "Hybrid, Remote"; },
  get jobSearchKeywords(): string { return "5 days"; },
  get jobSearchInterval(): number { return 10; },
  get jobSearchTimeRange(): string { return "r604800"; },
  get timezone(): string { return "Asia/Kolkata"; }
};

export async function getSystemSetting<T extends keyof SystemSettings>(key: T): Promise<SystemSettings[T]> {
  try {
    if (!prisma.systemSetting) {
      return DEFAULT_SETTINGS[key];
    }
    const setting = await prisma.systemSetting.findUnique({
      where: { key }
    });
    if (!setting) {
      return DEFAULT_SETTINGS[key];
    }
    const val = setting.value;
    const defaultVal = DEFAULT_SETTINGS[key];

    if (typeof defaultVal === "boolean") {
      return (val === "true" || val === "1") as unknown as SystemSettings[T];
    }
    if (typeof defaultVal === "number") {
      const parsed = Number(val);
      return (isNaN(parsed) ? defaultVal : parsed) as unknown as SystemSettings[T];
    }
    return val as unknown as SystemSettings[T];
  } catch (err) {
    if (process.env.NODE_ENV !== "test") {
      console.error(`Failed to get system setting ${key}:`, err);
    }
    return DEFAULT_SETTINGS[key];
  }
}

export async function getAllSystemSettings(): Promise<SystemSettings> {
  const settings: Partial<SystemSettings> = {};
  const keys = Object.keys(DEFAULT_SETTINGS) as (keyof SystemSettings)[];
  for (const key of keys) {
    settings[key] = await getSystemSetting(key) as any;
  }
  return settings as SystemSettings;
}

export async function updateSystemSettings(newSettings: Partial<SystemSettings>): Promise<SystemSettings> {
  const parsed = settingsSchema.partial().parse(newSettings);

  for (const [key, value] of Object.entries(parsed)) {
    if (value !== undefined) {
      await prisma.systemSetting.upsert({
        where: { key },
        update: { value: String(value) },
        create: { key, value: String(value) }
      });
    }
  }

  return getAllSystemSettings();
}
