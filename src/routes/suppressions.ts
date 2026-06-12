import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { addSuppression, checkSuppression } from "../services/suppressionService.js";

const createSuppressionSchema = z
  .object({
    email: z.string().email().optional(),
    domain: z.string().trim().min(1).optional(),
    reason: z.string().trim().min(1),
    source: z.string().trim().min(1).default("manual")
  })
  .refine((value) => value.email || value.domain, {
    message: "Either email or domain is required"
  });

const checkSuppressionSchema = z.object({
  email: z.string().email()
});

export async function registerSuppressionRoutes(app: FastifyInstance) {
  app.get("/suppressions", async () => {
    return prisma.suppressionEntry.findMany({
      orderBy: { createdAt: "desc" },
      take: 100
    });
  });

  app.post("/suppressions", async (request, reply) => {
    const parsed = createSuppressionSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        error: "Invalid request body",
        details: parsed.error.flatten()
      });
    }

    const suppression = await addSuppression(parsed.data);
    return reply.status(201).send(suppression);
  });

  app.post("/suppressions/check", async (request, reply) => {
    const parsed = checkSuppressionSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        error: "Invalid request body",
        details: parsed.error.flatten()
      });
    }

    return checkSuppression(parsed.data.email);
  });
}

