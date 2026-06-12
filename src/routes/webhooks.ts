import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { normalizeProviderEventType, recordEmailEvent } from "../services/emailEventService.js";

const webhookEventSchema = z.object({
  candidateId: z.string().optional(),
  email: z.string().email().optional(),
  eventType: z.string().trim().min(1),
  provider: z.string().trim().min(1).default("generic"),
  rawPayload: z.unknown().optional()
});

export async function registerWebhookRoutes(app: FastifyInstance) {
  app.post("/webhooks/email-events", async (request, reply) => {
    const parsed = webhookEventSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        error: "Invalid request body",
        details: parsed.error.flatten()
      });
    }

    const result = await recordEmailEvent({
      candidateId: parsed.data.candidateId,
      email: parsed.data.email,
      eventType: normalizeProviderEventType(parsed.data.eventType),
      provider: parsed.data.provider,
      rawPayload: parsed.data.rawPayload ?? parsed.data
    });

    return reply.status(result.recorded ? 201 : 202).send(result);
  });
}

