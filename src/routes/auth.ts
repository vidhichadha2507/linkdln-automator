import type { FastifyInstance } from "fastify";
import { env } from "../config/env.js";
import { prisma } from "../lib/prisma.js";
import { getIsEnvTokenExpired, setIsEnvTokenExpired } from "../services/gmailService.js";

export async function registerAuthRoutes(app: FastifyInstance) {
  // Initiates Google OAuth consent screen redirect
  app.get("/auth/google", async (request, reply) => {
    const { GMAIL_CLIENT_ID } = env;

    if (!GMAIL_CLIENT_ID) {
      return reply.status(400).send("GMAIL_CLIENT_ID is not configured in environment variables.");
    }

    const host = request.headers.host || "localhost:4000";
    const protocol = request.headers["x-forwarded-proto"] || "http";
    const redirectUri = `${protocol}://${host}/auth/google/callback`;

    const rootUrl = "https://accounts.google.com/o/oauth2/v2/auth";
    const options = {
      redirect_uri: redirectUri,
      client_id: GMAIL_CLIENT_ID,
      access_type: "offline",
      response_type: "code",
      prompt: "consent",
      scope: [
        "https://www.googleapis.com/auth/gmail.send",
        "https://www.googleapis.com/auth/gmail.readonly"
      ].join(" ")
    };

    const qs = new URLSearchParams(options).toString();
    return reply.redirect(`${rootUrl}?${qs}`);
  });

  // Handles callback from Google OAuth redirect code exchange
  app.get("/auth/google/callback", async (request, reply) => {
    const { code } = request.query as { code?: string };

    if (!code) {
      return reply.status(400).send("No authorization code provided by Google.");
    }

    const { GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET } = env;

    if (!GMAIL_CLIENT_ID || !GMAIL_CLIENT_SECRET) {
      return reply.status(400).send("Gmail OAuth client ID or client secret is not configured.");
    }

    const host = request.headers.host || "localhost:4000";
    const protocol = request.headers["x-forwarded-proto"] || "http";
    const redirectUri = `${protocol}://${host}/auth/google/callback`;

    try {
      const response = await fetch("https://oauth2.googleapis.com/token", {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({
          code,
          client_id: GMAIL_CLIENT_ID,
          client_secret: GMAIL_CLIENT_SECRET,
          redirect_uri: redirectUri,
          grant_type: "authorization_code",
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Google token exchange failed: ${response.status} - ${errorText}`);
      }

      const data = (await response.json()) as { access_token: string; refresh_token?: string };

      if (!data.refresh_token) {
        const existing = await prisma.googleCredentials.findUnique({
          where: { key: "gmail_outreach" }
        });
        if (!existing) {
          throw new Error("No refresh token returned by Google. Please disconnect this app from your Google account permissions settings and try again to force consent.");
        }
      } else {
        await prisma.googleCredentials.upsert({
          where: { key: "gmail_outreach" },
          update: {
            refreshToken: data.refresh_token,
            updatedAt: new Date()
          },
          create: {
            key: "gmail_outreach",
            refreshToken: data.refresh_token
          }
        });
      }
      
      setIsEnvTokenExpired(false); // Reset token expiration state on successful sign-in

      return reply.redirect("/index.html?google_connected=true");
    } catch (err: any) {
      request.log.error(err);
      return reply.status(500).send(`Authentication failed: ${err.message || err}`);
    }
  });

  // Returns Gmail connection status
  app.get("/admin/google/status", async () => {
    let connected = false;
    let hasDbRecord = false;

    try {
      const creds = await prisma.googleCredentials.findUnique({
        where: { key: "gmail_outreach" }
      });
      if (creds) {
        hasDbRecord = true;
        if (creds.refreshToken && creds.refreshToken !== "disconnected") {
          connected = true;
        }
      }
    } catch (e) {
      // Ignore database error
    }

    if (!hasDbRecord && !connected && env.GMAIL_REFRESH_TOKEN && !getIsEnvTokenExpired()) {
      connected = true;
    }

    return { connected };
  });

  // Disconnects Gmail account by setting refresh token to "disconnected"
  app.post("/admin/google/disconnect", async () => {
    try {
      await prisma.googleCredentials.upsert({
        where: { key: "gmail_outreach" },
        update: {
          refreshToken: "disconnected",
          updatedAt: new Date()
        },
        create: {
          key: "gmail_outreach",
          refreshToken: "disconnected"
        }
      });
      return { success: true };
    } catch (error) {
      return { success: false };
    }
  });
}
