import cors from "@fastify/cors";
import fastifyStatic from "@fastify/static";
import Fastify from "fastify";
import path from "node:path";
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

const publicDir = path.resolve(process.cwd(), "src/public");

export async function buildApp() {
  const app = Fastify({
    logger: true,
    disableRequestLogging: true
  });

  await app.register(cors, {
    origin: env.CORS_ORIGIN === "*" ? true : env.CORS_ORIGIN
  });

  await app.register(fastifyStatic, {
    root: publicDir,
    prefix: "/"
  });

  await registerHealthRoutes(app);
  await registerLeadRoutes(app);
  await registerSuppressionRoutes(app);
  await registerWebhookRoutes(app);
  await registerAuthRoutes(app);
  await registerAdminRoutes(app);
  await registerJobSearchRoutes(app);

  // Manual tick route for campaign processing (suitable for serverless environments like Vercel)
  app.post("/api/campaigns/tick", async (request, reply) => {
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
