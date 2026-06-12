import "dotenv/config";
import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(4000),
  HOST: z.string().default("0.0.0.0"),
  DATABASE_URL: z.string().url(),
  CORS_ORIGIN: z.string().default("*"),
  GEMINI_API_KEY: z.string().optional(),
  GEMINI_MODEL: z.string().default("gemini-3.5-flash"),
  EMAIL_VERIFIER_PROVIDER: z.enum(["local", "hunter"]).default("local"),
  HUNTER_API_KEY: z.string().optional(),
  GMAIL_CLIENT_ID: z.string().optional(),
  GMAIL_CLIENT_SECRET: z.string().optional(),
  GMAIL_REFRESH_TOKEN: z.string().optional(),
  GMAIL_MONITOR_ENABLED: z.coerce.boolean().default(false),
  ENABLE_AI_PATTERN_DISCOVERY: z.preprocess((val) => val === "true" || val === "1" || val === true, z.boolean()).default(false),
  DEFAULT_RESUME_LINK: z.string().url().default("https://drive.google.com/file/d/1VV_oE3081TrsNd1CrKfzyEBZZBzKng20/view?usp=sharing")
});

export const env = envSchema.parse(process.env);
