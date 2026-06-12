import { env } from "../config/env.js";
import { prisma } from "../lib/prisma.js";
import { recordEmailEvent } from "./emailEventService.js";
import { getSystemSetting } from "./settingsService.js";
import { randomUUID } from "crypto";


type GmailMessageSummary = {
  id: string;
  threadId: string;
};

type GmailMessageListResponse = {
  messages?: GmailMessageSummary[];
  nextPageToken?: string;
  resultSizeEstimate?: number;
};

type GmailMessageDetail = {
  id: string;
  threadId: string;
  snippet: string;
  payload: {
    headers: { name: string; value: string }[];
    body?: { size: number; data?: string };
    parts?: any[];
  };
};

export type PollResult = {
  success: boolean;
  message: string;
  processedCount: number;
  bouncesFound: string[];
};

let isEnvTokenExpired = false;

export function getIsEnvTokenExpired(): boolean {
  return isEnvTokenExpired;
}

export function setIsEnvTokenExpired(val: boolean): void {
  isEnvTokenExpired = val;
}

/**
 * Refreshes the Google OAuth2 access token.
 */
async function getAccessToken(): Promise<string> {
  const { GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET, GMAIL_REFRESH_TOKEN } = env;

  if (!GMAIL_CLIENT_ID || !GMAIL_CLIENT_SECRET) {
    throw new Error("GMAIL_CLIENT_ID and GMAIL_CLIENT_SECRET must be configured in env.");
  }

  // 1. Attempt to fetch refresh token from the database
  let refreshToken: string | undefined = undefined;
  let hasDbRecord = false;
  try {
    const creds = await prisma.googleCredentials.findUnique({
      where: { key: "gmail_outreach" }
    });
    if (creds) {
      hasDbRecord = true;
      if (creds.refreshToken && creds.refreshToken !== "disconnected") {
        refreshToken = creds.refreshToken;
      }
    }
  } catch (dbError) {
    console.error("Failed to query GoogleCredentials from database:", dbError);
  }

  // 2. Fall back to environment variable refresh token if database token is missing and no database record was explicitly created
  if (!refreshToken && !hasDbRecord) {
    refreshToken = GMAIL_REFRESH_TOKEN;
  }

  if (!refreshToken) {
    throw new Error("Gmail OAuth credentials are not fully configured. Please sign in via Google first.");
  }

  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      client_id: GMAIL_CLIENT_ID,
      client_secret: GMAIL_CLIENT_SECRET,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    const isAuthError = response.status === 400 || response.status === 401 || errorText.includes("invalid_grant");
    if (isAuthError) {
      if (hasDbRecord) {
        console.warn("⚠️ Google OAuth Refresh Token has expired or been revoked. Disconnecting database credentials.");
        try {
          await prisma.googleCredentials.update({
            where: { key: "gmail_outreach" },
            data: { refreshToken: "disconnected" }
          });
        } catch (dbErr) {
          console.error("Failed to disconnect GoogleCredentials on invalid grant:", dbErr);
        }
      } else {
        console.warn("⚠️ Google OAuth Environment Refresh Token has expired or been revoked.");
        isEnvTokenExpired = true;
      }
    }
    throw new Error(`Failed to refresh Google access token: ${response.status} - ${errorText}`);
  }

  if (!hasDbRecord) {
    isEnvTokenExpired = false;
  }

  const data = (await response.json()) as { access_token: string };
  return data.access_token;
}

/**
 * Recursively decodes and extracts all text content from the Gmail message payload.
 */
function extractTextFromPayload(payload: any): string {
  let text = "";

  // Extract body data if present
  if (payload.body?.data) {
    try {
      const base64 = payload.body.data.replace(/-/g, "+").replace(/_/g, "/");
      text += Buffer.from(base64, "base64").toString("utf-8") + "\n";
    } catch (e) {
      // Ignore parsing errors
    }
  }

  // Extract parts recursively
  if (payload.parts && Array.isArray(payload.parts)) {
    for (const part of payload.parts) {
      text += extractTextFromPayload(part) + "\n";
    }
  }

  return text;
}

/**
 * Polls recent bounce emails from the configured Gmail account,
 * parses recipient addresses, and registers bounce events.
 */
export async function pollGmailBounces(): Promise<PollResult> {
  const isEnabled = await getSystemSetting("gmailMonitorEnabled");

  if (!isEnabled) {
    return {
      success: false,
      message: "Gmail monitoring is not enabled in settings.",
      processedCount: 0,
      bouncesFound: [],
    };
  }

  if (!env.GMAIL_CLIENT_ID || !env.GMAIL_CLIENT_SECRET) {
    return {
      success: false,
      message: "Gmail client ID and client secret are not configured.",
      processedCount: 0,
      bouncesFound: [],
    };
  }

  // Check refresh token existence (database or env)
  let hasToken = false;
  let hasDbRecord = false;
  try {
    const dbCreds = await prisma.googleCredentials.findUnique({
      where: { key: "gmail_outreach" }
    });
    if (dbCreds) {
      hasDbRecord = true;
      if (dbCreds.refreshToken && dbCreds.refreshToken !== "disconnected") {
        hasToken = true;
      }
    }
  } catch (dbErr) {
    console.error("Failed to query GoogleCredentials status:", dbErr);
  }

  if (!hasToken && !hasDbRecord && env.GMAIL_REFRESH_TOKEN) {
    hasToken = true;
  }

  if (!hasToken) {
    return {
      success: false,
      message: "Gmail connection is not active. Please sign in via Google first.",
      processedCount: 0,
      bouncesFound: [],
    };
  }

  try {
    const accessToken = await getAccessToken();

    // Query for messages from mailer-daemon or delivery status notification failures
    const query = 'from:mailer-daemon OR subject:failure OR subject:failed OR subject:undelivered OR "delivery status notification"';
    const listUrl = new URL("https://gmail.googleapis.com/gmail/v1/users/me/messages");
    listUrl.searchParams.set("q", query);
    listUrl.searchParams.set("maxResults", "30"); // process top 30 recent matches

    const listRes = await fetch(listUrl.toString(), {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (!listRes.ok) {
      throw new Error(`Failed to list messages: ${listRes.status} - ${await listRes.text()}`);
    }

    const listData = (await listRes.json()) as GmailMessageListResponse;
    const messages = listData.messages || [];

    if (messages.length === 0) {
      return {
        success: true,
        message: "No new bounce emails found in Gmail.",
        processedCount: 0,
        bouncesFound: [],
      };
    }

    let processedCount = 0;
    const bouncesFound: string[] = [];

    for (const msgSummary of messages) {
      const detailUrl = `https://gmail.googleapis.com/gmail/v1/users/me/messages/${msgSummary.id}`;
      const detailRes = await fetch(detailUrl, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });

      if (!detailRes.ok) {
        continue; // skip this message on error
      }

      const msg = (await detailRes.json()) as GmailMessageDetail;

      // Extract all text content (snippet + headers + decoded body)
      const headerText = msg.payload.headers.map((h) => `${h.name}: ${h.value}`).join("\n");
      const decodedBody = extractTextFromPayload(msg.payload);
      const fullContent = `${msg.snippet}\n${headerText}\n${decodedBody}`;

      // Extract all email-like patterns
      const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
      const candidatesInMail = fullContent.match(emailRegex) || [];

      if (candidatesInMail.length === 0) {
        continue;
      }

      // Deduplicate found email strings
      const uniqueEmails = Array.from(new Set(candidatesInMail.map((e) => e.toLowerCase().trim())));

      for (const email of uniqueEmails) {
        // Query database to see if we have this email as a generated candidate
        const candidates = await prisma.emailCandidate.findMany({
          where: { email },
          include: { events: true },
        });

        for (const candidate of candidates) {
          // Check if we have already recorded this specific Gmail message ID as a bounce event
          const alreadyProcessed = candidate.events.some(
            (e) => e.eventType === "bounce" && (e.rawPayload as any)?.messageId === msg.id
          );

          if (alreadyProcessed) {
            continue;
          }

          // Record a bounce event for this candidate
          await recordEmailEvent({
            candidateId: candidate.id,
            email: candidate.email,
            eventType: "bounce",
            provider: "gmail",
            rawPayload: {
              messageId: msg.id,
              threadId: msg.threadId,
              snippet: msg.snippet,
              gmailTimestamp: new Date().toISOString(),
            },
          });

          if (!bouncesFound.includes(email)) {
            bouncesFound.push(email);
          }
        }
      }

      processedCount++;
    }

    return {
      success: true,
      message: `Successfully polled Gmail. Processed ${processedCount} bounce messages.`,
      processedCount,
      bouncesFound,
    };
  } catch (error) {
    return {
      success: false,
      message: error instanceof Error ? error.message : "An unknown error occurred during Gmail polling.",
      processedCount: 0,
      bouncesFound: [],
    };
  }
}

/**
 * Simulates a Gmail bounce event for a given email address.
 * Extremely helpful for local testing without real OAuth credentials.
 */
export async function simulateGmailBounce(email: string): Promise<PollResult> {
  const trimmed = email.toLowerCase().trim();
  const candidates = await prisma.emailCandidate.findMany({
    where: { email: trimmed },
  });

  if (candidates.length === 0) {
    return {
      success: false,
      message: `No candidate found with email "${email}" in the local database.`,
      processedCount: 0,
      bouncesFound: [],
    };
  }

  const mockMsgId = `mock_gmail_msg_${Date.now()}`;

  for (const candidate of candidates) {
    await recordEmailEvent({
      candidateId: candidate.id,
      email: candidate.email,
      eventType: "bounce",
      provider: "gmail_simulator",
      rawPayload: {
        messageId: mockMsgId,
        snippet: "Delivery Status Notification (Failure) - Simulated",
        simulatedAt: new Date().toISOString(),
      },
    });
  }

  return {
    success: true,
    message: `Simulated a Gmail bounce for "${email}". Candidate status and algorithm scoring updated.`,
    processedCount: 1,
    bouncesFound: [trimmed],
  };
}

/**
 * Retrieves the real SMTP Message-ID header (RFC 5322) of a sent Gmail message.
 * Implements exponential backoff retries in case Gmail's indexer is briefly lagging.
 */
async function getSentMessageIdHeader(gmailMessageId: string): Promise<string> {
  const accessToken = await getAccessToken();
  const url = new URL(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${gmailMessageId}`);
  url.searchParams.set("format", "metadata");
  url.searchParams.set("metadataHeaders", "Message-ID");

  let delay = 300;
  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      const res = await fetch(url.toString(), {
        headers: { Authorization: `Bearer ${accessToken}` },
      });

      if (res.ok) {
        const data = (await res.json()) as { payload?: { headers?: { name: string; value: string }[] } };
        const headers = data.payload?.headers || [];
        const messageIdHeader = headers.find((h) => h.name.toLowerCase() === "message-id")?.value;

        if (messageIdHeader) {
          // Standard Message-ID header value usually includes angle brackets e.g. <abc@def.com>.
          // We strip them so that our database and event logs store the clean string (we add them back in MIME).
          const cleaned = messageIdHeader.trim().replace(/^</, "").replace(/>$/, "");
          return cleaned;
        }
      }
    } catch (err) {
      console.warn(`[getSentMessageIdHeader] Attempt ${attempt} failed to retrieve Message-ID:`, err);
    }

    if (attempt < 4) {
      console.log(`[getSentMessageIdHeader] Message-ID header not indexed yet. Retrying in ${delay}ms...`);
      await new Promise((resolve) => setTimeout(resolve, delay));
      delay *= 2;
    }
  }

  throw new Error(`Failed to retrieve SMTP Message-ID header for Gmail message: ${gmailMessageId}`);
}

/**
 * Helper to check if a Gmail API error is related to rate/daily limits.
 */
export function isGmailQuotaError(errorText: string, status: number): boolean {
  const lowerText = errorText.toLowerCase();
  
  if (status === 403 || status === 429) {
    if (
      lowerText.includes("dailylimitexceeded") ||
      lowerText.includes("quotaexceeded") ||
      lowerText.includes("sending limit exceeded") ||
      lowerText.includes("daily limit exceeded") ||
      lowerText.includes("rate limit exceeded") ||
      lowerText.includes("userratelimitexceeded")
    ) {
      return true;
    }
  }
  return false;
}

function getLocalDateString(): string {
  const d = new Date();
  const offset = d.getTimezoneOffset();
  const localDate = new Date(d.getTime() - (offset * 60 * 1000));
  return localDate.toISOString().split("T")[0];
}

/**
 * Checks if Gmail API sends are halted today due to quota breach.
 */
export async function isGmailQuotaHalted(): Promise<boolean> {
  try {
    const haltRecord = await prisma.googleCredentials.findUnique({
      where: { key: "gmail_quota_halt" }
    });

    if (!haltRecord) {
      return false;
    }

    const todayStr = getLocalDateString();
    if (haltRecord.refreshToken === todayStr) {
      return true;
    }

    // If it's a different day, the halt has expired. Let's clean it up.
    await prisma.googleCredentials.delete({
      where: { key: "gmail_quota_halt" }
    }).catch(() => {});
    
    return false;
  } catch (err) {
    console.error("Failed to check gmail quota halt state:", err);
    return false;
  }
}

/**
 * Sets the Gmail quota halt state for today.
 */
export async function setGmailQuotaHalted(halted: boolean): Promise<void> {
  try {
    if (halted) {
      const todayStr = getLocalDateString();
      await prisma.googleCredentials.upsert({
        where: { key: "gmail_quota_halt" },
        update: { refreshToken: todayStr },
        create: { key: "gmail_quota_halt", refreshToken: todayStr }
      });
      console.log(`⚠️ Gmail quota halt activated for today: ${todayStr}`);
    } else {
      await prisma.googleCredentials.delete({
        where: { key: "gmail_quota_halt" }
      }).catch(() => {});
      console.log("✅ Gmail quota halt deactivated.");
    }
  } catch (err) {
    console.error("Failed to update gmail quota halt state:", err);
  }
}

/**
 * Sends a real outreach email via Google's Gmail API, using a multipart MIME format
 * if a base64 PDF resume is attached. Falls back to a local console log if unconfigured.
 */
export async function sendGmailEmail(
  to: string,
  subject: string,
  body: string,
  attachment?: { name: string; type: string; contentBase64: string },
  threadId?: string,
  parentMessageId?: string
): Promise<{ success: boolean; messageId?: string; threadId?: string; error?: string; isNetworkError?: boolean }> {
  const isEnabled = await getSystemSetting("gmailMonitorEnabled");

  let hasToken = false;
  let hasDbRecord = false;
  try {
    const dbCreds = await prisma.googleCredentials.findUnique({
      where: { key: "gmail_outreach" }
    });
    if (dbCreds) {
      hasDbRecord = true;
      if (dbCreds.refreshToken && dbCreds.refreshToken !== "disconnected") {
        hasToken = true;
      }
    }
  } catch (dbErr) {
    console.error("Failed to query GoogleCredentials status for send:", dbErr);
  }

  if (!hasToken && !hasDbRecord && env.GMAIL_REFRESH_TOKEN) {
    hasToken = true;
  }

  const hasCreds = !!(env.GMAIL_CLIENT_ID && env.GMAIL_CLIENT_SECRET && hasToken);
  const myMessageId = `${randomUUID()}@linkedin-email-automator.local`;

  if (!isEnabled || !hasCreds) {
    console.log(`\n=================== [MOCK OUTBOUND OUTREACH SEND] ===================`);
    console.log(`To: ${to}`);
    console.log(`Subject: ${subject}`);
    console.log(`Message-ID: <${myMessageId}>`);
    if (threadId) {
      console.log(`Thread ID: ${threadId} | Parent Message ID: <${parentMessageId}>`);
    }
    console.log(`Body:\n${body}`);
    if (attachment) {
      console.log(`Attachment: "${attachment.name}" (${attachment.type}, ${attachment.contentBase64.length} bytes base64)`);
    }
    console.log(`=====================================================================\n`);
    return {
      success: true,
      messageId: myMessageId,
      threadId: threadId || `mock_thread_${Date.now()}`
    };
  }

  try {
    const accessToken = await getAccessToken();
    const boundary = `----=_Part_${Date.now()}_${Math.random().toString(36).substring(2)}`;

    const encodedSubject = `=?UTF-8?B?${Buffer.from(subject).toString("base64")}?=`;
    let mime = "";
    mime += `To: ${to}\n`;
    mime += `Subject: ${encodedSubject}\n`;
    mime += `Message-ID: <${myMessageId}>\n`;
    if (threadId && parentMessageId) {
      mime += `In-Reply-To: <${parentMessageId}>\n`;
      mime += `References: <${parentMessageId}>\n`;
    }
    mime += `MIME-Version: 1.0\n`;

    if (attachment) {
      mime += `Content-Type: multipart/mixed; boundary="${boundary}"\n\n`;

      mime += `--${boundary}\n`;
      mime += `Content-Type: text/html; charset="UTF-8"\n`;
      mime += `Content-Transfer-Encoding: 8bit\n\n`;
      mime += `${body}\n\n`;

      mime += `--${boundary}\n`;
      mime += `Content-Type: ${attachment.type}; name="${attachment.name}"\n`;
      mime += `Content-Disposition: attachment; filename="${attachment.name}"\n`;
      mime += `Content-Transfer-Encoding: base64\n\n`;
      mime += `${attachment.contentBase64}\n`;
      mime += `--${boundary}--`;
    } else {
      mime += `Content-Type: text/html; charset="UTF-8"\n`;
      mime += `Content-Transfer-Encoding: 8bit\n\n`;
      mime += body;
    }

    // Convert MIME email string to base64url (no trailing padding, replace + with - and / with _)
    const encodedRaw = Buffer.from(mime)
      .toString("base64")
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");

    const sendRes = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        raw: encodedRaw,
        ...(threadId ? { threadId } : {})
      }),
    });

    if (!sendRes.ok) {
      const errText = await sendRes.text();
      if (isGmailQuotaError(errText, sendRes.status)) {
        await setGmailQuotaHalted(true);
      }
      throw new Error(`Gmail API send failed: ${sendRes.status} - ${errText}`);
    }

    const data = (await sendRes.json()) as { id: string; threadId: string };
    
    // Fetch the actual SMTP Message-ID header generated by Gmail's servers
    let messageId = myMessageId; // fallback if fetching fails
    try {
      const realMessageId = await getSentMessageIdHeader(data.id);
      if (realMessageId) {
        messageId = realMessageId;
        console.log(`   [Gmail Threading] Retrieved real SMTP Message-ID: <${messageId}>`);
      }
    } catch (err: any) {
      console.warn(`⚠️ Failed to retrieve real SMTP Message-ID, falling back to mock UUID:`, err.message || err);
    }

    return { success: true, messageId, threadId: data.threadId };
  } catch (error: any) {
    console.error("Failed to send real Gmail outreach:", error);
    const isNetwork = error instanceof TypeError || error.message?.includes("fetch failed") || !error.message?.includes("Gmail API send failed");
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown send error",
      isNetworkError: isNetwork
    };
  }
}
