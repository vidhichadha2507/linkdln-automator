import type { FastifyInstance } from "fastify";
import { prisma } from "../lib/prisma.js";

export async function registerHealthRoutes(app: FastifyInstance) {
  app.get("/health", async () => {
    await prisma.$queryRaw`SELECT 1`;

    return {
      ok: true,
      service: "linkedin-email-automator",
      timestamp: new Date().toISOString()
    };
  });
}

