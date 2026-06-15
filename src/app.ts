import cors from "@fastify/cors";
import Fastify from "fastify";
import path from "node:path";
import fs from "node:fs";
import { env } from "./config/env.js";
import { registerAdminRoutes } from "./routes/admin.js";
import { registerAuthRoutes } from "./routes/auth.js";
import { registerHealthRoutes } from "./routes/health.js";
import { registerLeadRoutes } from "./routes/leads.js";
import { registerSuppressionRoutes } from "./routes/suppressions.js";
import { registerWebhookRoutes } from "./routes/webhooks.js";
import { startCampaignScheduler, processCampaignQueue } from "./services/campaignService.js";
import { registerJobSearchRoutes } from "./routes/jobSearch.js";
import { pollGmailBounces } from "./services/gmailService.js";

// Resolve public directory relative to CWD (Vercel: /var/task, local: project root)
const publicDir = path.resolve(process.cwd(), "public");

// Keep track of recent request URLs for serverless routing diagnostics
export const recentUrls: string[] = [];

export async function buildApp() {
  const app = Fastify({
    logger: true,
    disableRequestLogging: false
  });

  app.addHook("onRequest", async (request, _reply) => {
    recentUrls.push(`${request.method} ${request.url}`);
    if (recentUrls.length > 30) {
      recentUrls.shift();
    }
  });

  await app.register(cors, {
    origin: (origin, cb) => {
      // Allow requests with no origin (server-to-server, curl, etc.)
      if (!origin) return cb(null, true);
      // Always allow chrome-extension:// origins so the browser extension can call the API
      if (origin.startsWith("chrome-extension://")) return cb(null, true);
      // If CORS_ORIGIN is wildcard, allow everything
      if (env.CORS_ORIGIN === "*") return cb(null, true);
      // Otherwise only allow the configured origin
      if (origin === env.CORS_ORIGIN) return cb(null, true);
      cb(new Error("Not allowed by CORS"), false);
    },
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"]
  });

  // --- In-memory static file serving (Vercel serverless compatible) ---
  // Files are read once at cold-start. If any file is missing, we log the error
  // but continue so other routes still work.
  const staticFiles = [
    { route: "/",            file: "index.html", type: "text/html; charset=utf-8" },
    { route: "/index.html",  file: "index.html", type: "text/html; charset=utf-8" },
    { route: "/admin.html",  file: "admin.html", type: "text/html; charset=utf-8" },
    { route: "/admin.css",   file: "admin.css",  type: "text/css; charset=utf-8" },
    { route: "/admin.js",    file: "admin.js",   type: "application/javascript; charset=utf-8" },
    { route: "/app.js",      file: "app.js",     type: "application/javascript; charset=utf-8" }
  ];

  // Debug route — safe to expose (no secrets), helps diagnose serverless path issues
  app.get("/debug/fs", async (_request, reply) => {
    const cwd = process.cwd();
    let files: string[] = [];
    try { files = fs.readdirSync(publicDir); } catch { files = []; }
    return reply.send({
      cwd,
      publicDir,
      publicFiles: files,
      nodeVersion: process.version,
      env: process.env.NODE_ENV,
      vercel: !!process.env.VERCEL
    });
  });

  for (const item of staticFiles) {
    const filePath = path.join(publicDir, item.file);
    let content: Buffer | null = null;
    try {
      content = fs.readFileSync(filePath);
      app.log.info(`✅ Loaded static file: ${filePath} (${content.length} bytes)`);
    } catch (err: any) {
      app.log.error(`❌ Cannot read static file ${filePath}: ${err.message}`);
    }

    // Always register the route; if content is null, return a meaningful 503
    const capturedContent = content;
    const capturedItem = item;
    app.get(item.route, async (_request, reply) => {
      if (!capturedContent) {
        return reply.status(503).send(
          `Static file "${capturedItem.file}" could not be loaded from ${publicDir}. ` +
          `Check /debug/fs to inspect the serverless filesystem.`
        );
      }
      return reply.type(capturedItem.type).send(capturedContent);
    });
  }

  await registerHealthRoutes(app);
  await registerLeadRoutes(app);
  await registerSuppressionRoutes(app);
  await registerWebhookRoutes(app);
  await registerAuthRoutes(app);
  await registerAdminRoutes(app);
  await registerJobSearchRoutes(app);

  // Manual tick route for campaign processing (suitable for serverless environments like Vercel)
  app.route({
    method: ["GET", "POST"],
    url: "/api/campaigns/tick",
    handler: async (request, reply) => {
      try {
        const bounceResult = await pollGmailBounces();
        const queueResult = await processCampaignQueue();
        return {
          success: true,
          bounceResult,
          queueResult
        };
      } catch (err: any) {
        request.log.error(err);
        return reply.status(500).send({
          error: "Failed to process campaign queue tick",
          message: err.message
        });
      }
    }
  });

  // Boot automated queue scheduler tick (only if not running in a serverless environment like Vercel)
  if (!process.env.VERCEL) {
    startCampaignScheduler();
  }

  app.setErrorHandler((error, request, reply) => {
    request.log.error(error);

    const message = error instanceof Error ? error.message : "Unknown error";

    return reply.status(500).send({
      error: "Internal server error",
      message: env.NODE_ENV === "production" ? undefined : message
    });
  });

  return app;
}
