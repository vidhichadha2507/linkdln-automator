import "dotenv/config";
import { z } from "zod";

// Preprocessor to safely strip surrounding quotes that users often copy-paste from env files
const stripQuotes = (val: unknown) => {
  if (typeof val === "string") {
    return val.replace(/^["']|["']$/g, "").trim();
  }
  return val;
};

const envSchema = z.object({
  NODE_ENV: z.preprocess(stripQuotes, z.enum(["development", "test", "production"])).default("development"),
  PORT: z.preprocess(stripQuotes, z.coerce.number().int().positive()).default(4000),
  HOST: z.preprocess(stripQuotes, z.string()).default("0.0.0.0"),
  DATABASE_URL: z.preprocess(stripQuotes, z.string().url()),
  CORS_ORIGIN: z.preprocess(stripQuotes, z.string()).default("*"),
  GEMINI_API_KEY: z.preprocess(stripQuotes, z.string().optional()),
  GEMINI_MODEL: z.preprocess(stripQuotes, z.string()).default("gemini-3.5-flash"),
  EMAIL_VERIFIER_PROVIDER: z.preprocess(stripQuotes, z.enum(["local", "hunter"])).default("local"),
  HUNTER_API_KEY: z.preprocess(stripQuotes, z.string().optional()),
  GMAIL_CLIENT_ID: z.preprocess(stripQuotes, z.string().optional()),
  GMAIL_CLIENT_SECRET: z.preprocess(stripQuotes, z.string().optional()),
  GMAIL_REFRESH_TOKEN: z.preprocess(stripQuotes, z.string().optional()),
  GMAIL_MONITOR_ENABLED: z.preprocess(stripQuotes, z.coerce.boolean()).default(false),
  // Explicit OAuth redirect URI. Set this to exactly the URI registered in Google Cloud Console.
  // Example: https://linkdln-automator-xxx.vercel.app/auth/google/callback
  GOOGLE_REDIRECT_URI: z.preprocess(stripQuotes, z.string().optional()),
  ENABLE_AI_PATTERN_DISCOVERY: z.preprocess((val) => {
    const stripped = stripQuotes(val);
    return stripped === "true" || stripped === "1" || stripped === true;
  }, z.boolean()).default(false),
  DEFAULT_RESUME_LINK: z.preprocess(stripQuotes, z.string().url()).default("https://drive.google.com/file/d/1VV_oE3081TrsNd1CrKfzyEBZZBzKng20/view?usp=sharing")
});

type EnvType = z.infer<typeof envSchema>;

let parsedEnv: EnvType | null = null;
let validationError: z.ZodError | null = null;

try {
  parsedEnv = envSchema.parse(process.env);
} catch (error) {
  if (error instanceof z.ZodError) {
    validationError = error;
    console.error("❌ Environment validation failed!");
    console.error(JSON.stringify(error.format(), null, 2));
    console.error("👉 Please verify that you have added the required environment variables (especially DATABASE_URL) to your Vercel project configuration.");
  } else {
    throw error;
  }
}

export const env = new Proxy({} as EnvType, {
  get(target, prop) {
    if (validationError) {
      throw new Error(`Environment validation failed. Please check your Vercel project settings. Details: ${JSON.stringify(validationError.format())}`);
    }
    return parsedEnv ? parsedEnv[prop as keyof EnvType] : undefined;
  }
});
