import { describe, expect, it } from "vitest";

// Simulate MIME generation for threading
function generateThreadedMime(
  to: string,
  subject: string,
  body: string,
  threadId?: string,
  parentMessageId?: string
): string {
  let mime = "";
  mime += `To: ${to}\n`;
  mime += `Subject: ${subject}\n`;
  if (threadId && parentMessageId) {
    mime += `In-Reply-To: <${parentMessageId}>\n`;
    mime += `References: <${parentMessageId}>\n`;
  }
  mime += `MIME-Version: 1.0\n`;
  mime += `Content-Type: text/html; charset="UTF-8"\n`;
  mime += `Content-Transfer-Encoding: 7bit\n\n`;
  mime += body;
  return mime;
}

describe("Gmail Email Threading", () => {
  it("includes In-Reply-To and References headers when replying to a thread", () => {
    const mime = generateThreadedMime(
      "lead@company.com",
      "Re: Job Application",
      "Hello, following up on my application.",
      "thread_12345",
      "msg_67890@linkedin-email-automator.local"
    );

    expect(mime).toContain("In-Reply-To: <msg_67890@linkedin-email-automator.local>");
    expect(mime).toContain("References: <msg_67890@linkedin-email-automator.local>");
    expect(mime).toContain("To: lead@company.com");
    expect(mime).toContain("Subject: Re: Job Application");
  });

  it("omits threading headers when starting a new thread", () => {
    const mime = generateThreadedMime(
      "lead@company.com",
      "Job Application",
      "Hello, this is my application."
    );

    expect(mime).not.toContain("In-Reply-To");
    expect(mime).not.toContain("References");
    expect(mime).toContain("To: lead@company.com");
    expect(mime).toContain("Subject: Job Application");
  });
});
