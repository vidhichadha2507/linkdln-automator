import type { FastifyInstance } from "fastify";
import { prisma } from "../lib/prisma.js";

export async function registerHealthRoutes(app: FastifyInstance) {
  app.get("/health", async () => {
    await prisma.$queryRaw`SELECT 1`;

    let cwdFiles: string[] = [];
    let publicFiles: string[] = [];
    let cwdError: string | null = null;
    let publicError: string | null = null;

    try {
      const fs = await import("fs");
      cwdFiles = fs.readdirSync(process.cwd());
    } catch (e: any) {
      cwdError = e.message;
    }

    try {
      const fs = await import("fs");
      const path = await import("path");
      const pubPath = path.resolve(process.cwd(), "public");
      publicFiles = fs.readdirSync(pubPath);
    } catch (e: any) {
      publicError = e.message;
    }

    return {
      ok: true,
      service: "linkedin-email-automator",
      timestamp: new Date().toISOString(),
      diagnostics: {
        cwd: process.cwd(),
        cwdFiles,
        cwdError,
        publicFiles,
        publicError
      }
    };
  });
}

