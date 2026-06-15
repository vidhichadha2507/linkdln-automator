import { prisma } from "../lib/prisma.js";
import { sendGmailEmail, pollGmailBounces, isGmailQuotaHalted } from "./gmailService.js";
import { recordEmailEvent } from "./emailEventService.js";
import { env } from "../config/env.js";
import { getSystemSetting } from "./settingsService.js";

export type StartCampaignInput = {
  leadId: string;
  candidateId: string;
  jobLink?: string;
  jobId?: string;
  resumeName?: string;
  resumeBase64?: string; // base64 string
  scheduledFor?: string; // ISO string
  autoFollowup?: boolean;
  followupIntervalHours?: number;
  followupIntervalMinutes?: number;
  respectTiming?: boolean;
  maxFollowups?: number;
  skipBounceMonitor?: boolean;
  roleName?: string;
  templateId?: string;
};

// Helper function to format plain text email bodies to HTML
function formatEmailBody(plainText: string): string {
  return plainText.replace(/\n/g, "<br>");
}

export function getTemplateFollowupIntroduction(step: number): string {
  const introLines = [
    "I wanted to follow up briefly to see if you might have a few minutes.",
    "I am writing to check if you have any feedback on my background.",
    "I wanted to inquire if you had a moment to review my candidacy.",
    "I wanted to check if my DevOps engineering experience aligns with your current hiring needs.",
    "I am reaching out to see if there is any update regarding the recruiting process.",
    "I wanted to check back in regarding the potential opportunities we could discuss.",
    "I wanted to send a quick note to see if we might connect for a brief introduction.",
    "I wanted to check if you might be the right person to speak with regarding engineering roles.",
    "I wanted to ask if you have any updates on your team's expansion plans.",
    "I wanted to follow up to see if you might have a few minutes to connect."
  ];
  return introLines[(step - 1) % introLines.length];
}

function insertFollowupIntro(body: string, intro: string): string {
  // Regex to match a greeting line at the start of the body, e.g., "Hi Name," or "Dear Name," or "Hello Name,"
  const greetingRegex = /^(Hi|Hello|Dear|Greetings|Hey)\s+[^\n\r,]+[,!]/i;
  const match = body.match(greetingRegex);
  if (match) {
    const greeting = match[0]; // e.g. "Hi John,"
    const rest = body.slice(greeting.length).trim();
    return `${greeting}\n\n${intro}\n\n${rest}`;
  }
  return `${intro}\n\n${body.trim()}`;
}

export function generateDynamicTemplateFollowup(
  templateBody: string,
  step: number,
  lead: { fullName: string; firstName: string; lastName: string | null; company: { name: string; researchReason?: string | null } },
  roleName?: string,
  jobId?: string,
  jobLink?: string,
  resumeName?: string,
  defaultResumeLink?: string
): string {
  // Resolve all placeholders first
  const resolvedBody = resolveTemplatePlaceholders(templateBody, lead, jobId, jobLink, resumeName, roleName, defaultResumeLink);
  
  // Get the step-specific intro
  const intro = getTemplateFollowupIntroduction(step);
  
  // Insert the intro right after the greeting, preserving the rest of the template in full
  return insertFollowupIntro(resolvedBody, intro);
}

export function generateSystemTemplateFollowup(
  step: number,
  lead: { firstName: string; company: { name: string; researchReason?: string | null } },
  roleName?: string,
  jobId?: string,
  jobLink?: string,
  hasAttachment?: boolean,
  defaultResumeLink?: string
): string {
  const firstName = lead.firstName;
  const companyName = lead.company.name;
  const researchReason = lead.company.researchReason || null;

  const roleNameVal = roleName && roleName.trim() !== "" ? roleName.trim() : "DevOps Engineer";
  let jobContext = "";
  if (jobLink || jobId) {
    if (jobLink && jobId) {
      jobContext = ` [Job Link: ${jobLink} / Job ID: ${jobId}]`;
    } else if (jobLink) {
      jobContext = ` [Job Link: ${jobLink}]`;
    } else {
      jobContext = ` [Job ID: ${jobId}]`;
    }
  }

  const resolvedReason = researchReason 
    ? researchReason.trim() 
    : "your impressive technology stack, recent software engineering developments, and commitment to building robust distributed systems";

  const finalResumeLink = defaultResumeLink || env.DEFAULT_RESUME_LINK;
  const resumeContext = hasAttachment
    ? "I have also attached my resume to this email for your convenience."
    : `You can view my resume <a href="${finalResumeLink}" target="_blank" style="color: #6366f1; text-decoration: underline;">here</a>.`;

  const resolvedBody = `Hi ${firstName},

I came across the ${roleNameVal} opening at ${companyName}${jobContext} and wanted to reach out directly alongside my application.

I'm a DevOps engineer with 1.5+ years of experience in AWS, Kubernetes, Terraform, and CI/CD pipelines. A few highlights:

• Designed end-to-end monitoring, logging, and alerting systems using Prometheus, Loki, Lambda, and EventBridge
• Implemented custom load-average based autoscaling using AWS Lambda and DynamoDB
• Standardized CI/CD pipelines with Jenkins and ArgoCD, automating service provisioning on EKS

I'm specifically interested in ${companyName} because of ${resolvedReason}.

${resumeContext}

Happy to connect for a quick 15-minute call if there's a fit

Regards,
Vidhi Chadha
8178113237`;

  const intro = getTemplateFollowupIntroduction(step);
  return insertFollowupIntro(resolvedBody, intro);
}

export function applyDynamicDotsToBody(body: string, step: number): string {
  const cycle = [1, 2, 3, 4, 5, 4, 3, 2, 1, 0];
  const idx = (step - 1) % cycle.length;
  const dotsCount = cycle[idx];
  const dots = ".".repeat(dotsCount);

  const targetSentence = "Happy to connect for a quick 15-minute call if there's a fit";
  const regex = /Happy\s+to\s+connect\s+for\s+a\s+quick\s+15-minute\s+call\s+if\s+there's\s+a\s+fit[ \t\.]*/i;

  if (regex.test(body)) {
    return body.replace(regex, `${targetSentence}${dots}`);
  }

  // If not found in body, split by paragraph to inject before the sign-off paragraph
  const paragraphs = body.split(/\r?\n\s*\r?\n/).map(p => p.trim()).filter(p => p.length > 0);
  if (paragraphs.length >= 2) {
    const signOff = paragraphs[paragraphs.length - 1];
    const signOffKeywords = /^(best|regards|sincerely|thanks|thank you|warmly|yours|kindly|cheers|respectfully)/i;
    
    if (signOffKeywords.test(signOff)) {
      const front = paragraphs.slice(0, paragraphs.length - 1).join("\n\n");
      return `${front}\n\n${targetSentence}${dots}\n\n${signOff}`;
    }
  }

  return `${body.trim()}\n\n${targetSentence}${dots}`;
}

// Resolves placeholder variables in a custom template subject/body text
export function resolveTemplatePlaceholders(
  text: string,
  lead: { fullName: string; firstName: string; lastName: string | null; company: { name: string; researchReason?: string | null } },
  jobId?: string,
  jobLink?: string,
  resumeName?: string,
  roleName?: string,
  defaultResumeLink?: string
): string {
  const role = roleName && roleName.trim() !== "" ? roleName.trim() : "DevOps Engineer";
  const reason = lead.company.researchReason && lead.company.researchReason.trim() !== ""
    ? lead.company.researchReason.trim()
    : "your work and scaling trajectory";

  const finalResumeLink = defaultResumeLink || env.DEFAULT_RESUME_LINK;
  const resumeLinkHtml = resumeName && resumeName.trim() !== ""
    ? `<a href="${finalResumeLink}" target="_blank" style="color: #6366f1; text-decoration: underline;">${resumeName.trim()}</a>`
    : `<a href="${finalResumeLink}" target="_blank" style="color: #6366f1; text-decoration: underline;">here</a>`;

  // Raw values (for checking if empty in optional blocks)
  const rawValues: Record<string, string> = {
    name: lead.fullName,
    first_name: lead.firstName,
    last_name: lead.lastName || "",
    company: lead.company.name,
    role: role,
    job_id: jobId && jobId.trim() !== "" ? jobId.trim() : "",
    job_link: jobLink && jobLink.trim() !== "" ? jobLink.trim() : "",
    resume: resumeLinkHtml,
    reason: reason
  };

  // Final replacement values (with generic fallbacks for placeholders)
  const finalValues: Record<string, string> = {
    ...rawValues,
    job_id: rawValues.job_id !== "" ? rawValues.job_id : "active listing",
    job_link: rawValues.job_link !== "" ? rawValues.job_link : "your careers page"
  };

  let resolvedText = text;

  // Resolve optional blocks first: [ ... {key} ... ]
  // We match [ ... ] and check if it contains any placeholders. If any placeholder raw value is empty, the entire block is removed.
  resolvedText = resolvedText.replace(/\[([^\]]*?)\]/g, (match, blockContent) => {
    const placeholdersInBlock = blockContent.match(/\{([a-zA-Z0-9_]+)\}/gi);
    if (!placeholdersInBlock) {
      return blockContent;
    }
    
    let shouldRemoveBlock = false;
    for (const ph of placeholdersInBlock) {
      const key = ph.replace(/[\{\}]/g, "").toLowerCase();
      if (rawValues[key] === undefined || rawValues[key] === "") {
        shouldRemoveBlock = true;
        break;
      }
    }
    
    if (shouldRemoveBlock) {
      return "";
    } else {
      return blockContent;
    }
  });

  // Now replace all individual placeholders with finalValues
  Object.keys(finalValues).forEach(key => {
    const regex = new RegExp(`{${key}}`, "gi");
    resolvedText = resolvedText.replace(regex, finalValues[key]);
  });

  return resolvedText;
}

// Generates personalized outreach using the premium template and custom/default role name
export function generateInitialSubjectAndBody(
  firstName: string,
  companyName: string,
  researchReason: string | null,
  jobLink?: string,
  jobId?: string,
  hasAttachment?: boolean,
  roleNameInput?: string,
  defaultResumeLink?: string
): { subject: string; body: string } {
  const roleName = roleNameInput && roleNameInput.trim() !== "" ? roleNameInput.trim() : "DevOps Engineer";
  const subject = `Looking for ${roleName} roles | 1.5+ YOE | AWS | Kubernetes | Terraform | CI/CD`;

  // Format job context sentence
  let jobContext = "";
  if (jobLink || jobId) {
    if (jobLink && jobId) {
      jobContext = ` [Job Link: ${jobLink} / Job ID: ${jobId}]`;
    } else if (jobLink) {
      jobContext = ` [Job Link: ${jobLink}]`;
    } else {
      jobContext = ` [Job ID: ${jobId}]`;
    }
  }

  // Format research reason sentence
  const resolvedReason = researchReason 
    ? researchReason.trim() 
    : "your impressive technology stack, recent software engineering developments, and commitment to building robust distributed systems";

  // Resume context
  const finalResumeLink = defaultResumeLink || env.DEFAULT_RESUME_LINK;
  const resumeContext = hasAttachment
    ? "I have also attached my resume to this email for your convenience."
    : `You can view my resume <a href="${finalResumeLink}" target="_blank" style="color: #6366f1; text-decoration: underline;">here</a>.`;

  const body = `Hi ${firstName},

I came across the ${roleName} opening at ${companyName}${jobContext} and wanted to reach out directly alongside my application.

I'm a DevOps engineer with 1.5+ years of experience in AWS, Kubernetes, Terraform, and CI/CD pipelines. A few highlights:

• Designed end-to-end monitoring, logging, and alerting systems using Prometheus, Loki, Lambda, and EventBridge
• Implemented custom load-average based autoscaling using AWS Lambda and DynamoDB
• Standardized CI/CD pipelines with Jenkins and ArgoCD, automating service provisioning on EKS

I'm specifically interested in ${companyName} because of ${resolvedReason}.

${resumeContext}

Happy to share more if useful.

Vidhi Chadha
8178113237`;

  return { subject, body: formatEmailBody(body) };
}

// Generates 10 diverse, highly-converting followup sequences using the custom/default role name
export function generateFollowupContent(firstName: string, companyName: string, step: number, roleNameInput?: string): { subject: string; body: string } {
  const roleName = roleNameInput && roleNameInput.trim() !== "" ? roleNameInput.trim() : "DevOps Engineer";
  const baseSubject = `Re: Looking for ${roleName} roles | 1.5+ YOE | AWS | Kubernetes | Terraform | CI/CD`;
  let body = "";

  switch (step) {
    case 1:
      body = `Hi ${firstName},

I wanted to follow up briefly on my previous email regarding the ${roleName} position at ${companyName}. I remain highly interested in this opportunity and would welcome the chance to discuss how my background aligns with your requirements.

As a brief summary, I have 1.5+ years of experience specialized in DevOps, AWS, Kubernetes, Terraform, and CI/CD pipelines. At Paytm, I successfully designed end-to-end monitoring and logging with Prometheus and Loki, and implemented custom autoscaling using Lambda and DynamoDB.

Could you kindly direct me to the appropriate hiring manager or recruitment contact for this role?

Thank you for your time and consideration.

Best regards,
Vidhi Chadha`;
      break;
    case 2:
      body = `Hi ${firstName},

I am checking back to see if you have had an opportunity to review my background. I am actively seeking a ${roleName} position and am available to transition immediately. I would welcome a brief conversation to discuss how my hands-on experience in cloud infrastructure, Kubernetes, and CI/CD automation can support your team's objectives.

Thank you once again for your time and consideration.

Best regards,
Vidhi Chadha`;
      break;
    case 3:
      body = `Hi ${firstName},

I am writing to express my strong interest in the engineering initiatives at ${companyName}. Your team's work in scaling infrastructure resonates deeply with my experience in infrastructure automation, observability, and managing EKS workloads at scale.

If there is a suitable opening on the engineering or platform side, I would be very grateful to be considered. My default resume is available for your review <a href="${env.DEFAULT_RESUME_LINK}" target="_blank" style="color: #6366f1; text-decoration: underline;">here</a>.

Thank you for your time.

Best regards,
Vidhi Chadha`;
      break;
    case 4:
      body = `Hi ${firstName},

I wanted to follow up on my previous messages regarding potential ${roleName} opportunities at ${companyName}. With 1.5+ years of experience specialized in AWS, Kubernetes, Terraform, and CI/CD pipelines, I have a proven track record of designing end-to-end monitoring and implementing custom autoscaling solutions. I am confident I could integrate quickly and contribute to your team's success.

Please let me know if you might have availability for a brief introductory call in the coming days.

Best regards,
Vidhi Chadha`;
      break;
    case 5:
      body = `Hi ${firstName},

I wanted to provide a quick update regarding my current job search candidacy. I am currently in discussions with a few organizations for DevOps and infrastructure roles, but ${companyName} remains my top choice due to your team's high engineering standards and impressive scale of operations.

If you are not the direct point of contact for engineering recruitment, I would be very grateful if you could forward my details to the appropriate hiring manager or recruitment team member.

Thank you very much for your time and assistance.

Best regards,
Vidhi Chadha`;
      break;
    case 6:
      body = `Hi ${firstName},

I wanted to inquire if your team at ${companyName} is currently looking to add experienced ${roleName} engineers. I bring strong expertise in designing observability systems, automating deployments with Jenkins/ArgoCD, and managing containerized workloads on EKS. I would be glad to support your current engineering initiatives.

Please let me know if we can schedule a brief conversation to explore this further.

Best regards,
Vidhi Chadha`;
      break;
    case 7:
      body = `Hi ${firstName},

I hope your week is off to a great start. I wanted to follow up on my profile and express my continued interest in the engineering team at ${companyName}. I am eager to learn more about your technical roadmap and discuss how my expertise in cloud infrastructure can add value to your projects.

If you have availability for a brief conversation this week or next, please let me know.

Thank you for your valuable time and consideration.

Best regards,
Vidhi Chadha`;
      break;
    case 8:
      body = `Hi ${firstName},

I am writing to reiterate my interest in contributing to the systems at ${companyName}. If you have any active or upcoming openings for ${roleName} positions, I would be very interested in connecting.

Thank you for your consideration.

Best regards,
Vidhi Chadha
Phone: 8178113237`;
      break;
    case 9:
      body = `Hi ${firstName},

I wanted to send a final note to check if my DevOps experience aligns with your hiring needs. I specialize in infrastructure automation and am prepared to transition into a new role immediately.

If the timing is not suitable, I completely understand and wish you and your team continued success.

Thank you for your consideration.

Best regards,
Vidhi Chadha`;
      break;
    case 10:
      body = `Hi ${firstName},

Since I haven't heard back, I wanted to leave my contact details in case requirements change. Should your hiring needs change in the future, or if you require an engineer with strong expertise in AWS, Kubernetes, Terraform, and CI/CD pipelines, please feel free to contact me at 8178113237.

I wish you and your team all the best.

Sincerely,
Vidhi Chadha`;
      break;
    default:
      body = `Hi ${firstName},

I wanted to check if there are any updates regarding the ${roleName} positions at ${companyName}. I would be pleased to connect and share more about my background.

Best regards,
Vidhi Chadha`;
      break;
  }

  return { subject: baseSubject, body: formatEmailBody(applyDynamicDotsToBody(body, step)) };
}

export async function startCampaign(input: StartCampaignInput) {
  const lead = await prisma.lead.findUnique({
    where: { id: input.leadId },
    include: { company: true }
  });

  if (!lead) {
    throw new Error("Lead not found");
  }

  const candidate = await prisma.emailCandidate.findUnique({
    where: { id: input.candidateId }
  });

  if (!candidate) {
    throw new Error("Target email candidate not found");
  }

  // Pre-select this candidate in the lead's list
  await prisma.emailCandidate.updateMany({
    where: { leadId: input.leadId },
    data: { selected: false }
  });
  await prisma.emailCandidate.update({
    where: { id: input.candidateId },
    data: { selected: true }
  });

  const defaultResumeLink = await getSystemSetting("defaultResumeLink");
  const defaultRespectTiming = await getSystemSetting("respectTiming");
  const defaultFollowupIntervalMinutes = await getSystemSetting("followupIntervalMinutes");
  const defaultMaxFollowups = await getSystemSetting("maxFollowups");

  // Parse scheduling inputs
  let followupIntervalMinutes = defaultFollowupIntervalMinutes;
  if (input.followupIntervalMinutes !== undefined) {
    followupIntervalMinutes = input.followupIntervalMinutes;
  } else if (input.followupIntervalHours !== undefined) {
    followupIntervalMinutes = input.followupIntervalHours * 60;
  }

  const maxFollowups = input.maxFollowups !== undefined ? input.maxFollowups : defaultMaxFollowups;
  const hasAttachment = !!(input.resumeName && input.resumeBase64);

  // Query for an existing campaign state for this lead
  const existingCampaign = await prisma.campaignState.findUnique({
    where: { leadId: input.leadId }
  });

  // Determine requestTemplateId: if not provided and campaign exists, default to current template ID (or "system" if null)
  const requestTemplateId = input.templateId === undefined && existingCampaign
    ? (existingCampaign.templateId === null ? "system" : existingCampaign.templateId)
    : input.templateId;

  // Generate subject and body from custom templates (or fallback to default initial outreach)
  let subject = "";
  let body = "";
  let resolvedTemplateId: string | null = null;

  if (requestTemplateId && requestTemplateId !== "system") {
    const template = await prisma.template.findUnique({
      where: { id: requestTemplateId }
    });
    if (template) {
      subject = resolveTemplatePlaceholders(template.subject, lead, input.jobId, input.jobLink, input.resumeName, input.roleName, defaultResumeLink);
      body = formatEmailBody(resolveTemplatePlaceholders(template.body, lead, input.jobId, input.jobLink, input.resumeName, input.roleName, defaultResumeLink));
      resolvedTemplateId = template.id;
    }
  }

  if (requestTemplateId !== "system" && (!subject || !body)) {
    const defaultTemplate = await prisma.template.findFirst({
      where: { isDefault: true }
    });
    if (defaultTemplate) {
      subject = resolveTemplatePlaceholders(defaultTemplate.subject, lead, input.jobId, input.jobLink, input.resumeName, input.roleName, defaultResumeLink);
      body = formatEmailBody(resolveTemplatePlaceholders(defaultTemplate.body, lead, input.jobId, input.jobLink, input.resumeName, input.roleName, defaultResumeLink));
      resolvedTemplateId = defaultTemplate.id;
    }
  }

  if (!subject || !body) {
    const { subject: defaultSub, body: defaultBody } = generateInitialSubjectAndBody(
      lead.firstName,
      lead.company.name,
      lead.company.researchReason,
      input.jobLink,
      input.jobId,
      hasAttachment,
      input.roleName,
      defaultResumeLink
    );
    subject = defaultSub;
    body = defaultBody;
    resolvedTemplateId = null;
  }

  const scheduledDate = input.scheduledFor ? new Date(input.scheduledFor) : new Date();

  // Check if the campaign is actively running (i.e. status is not draft, scheduled, completed, bounced, replied, or cancelled)
  const isActivelyRunning = existingCampaign && 
    !["draft", "scheduled", "completed", "bounced", "replied", "cancelled"].includes(existingCampaign.status);

  const targetStatus = isActivelyRunning ? existingCampaign.status : "scheduled";
  const targetFollowupCount = isActivelyRunning ? existingCampaign.followupCount : 0;
  const targetScheduledFor = isActivelyRunning ? existingCampaign.scheduledFor : scheduledDate;
  const targetLastSentAt = isActivelyRunning ? existingCampaign.lastSentAt : null;
  const targetSubject = isActivelyRunning ? existingCampaign.subject : subject;
  const targetBody = isActivelyRunning ? existingCampaign.body : body;
  const targetTemplateId = isActivelyRunning ? existingCampaign.templateId : (requestTemplateId === "system" ? null : (resolvedTemplateId || (existingCampaign ? existingCampaign.templateId : null) || null));

  let campaign;
  if (existingCampaign) {
    campaign = await prisma.campaignState.update({
      where: { leadId: input.leadId },
      data: {
        candidateId: input.candidateId,
        status: targetStatus,
        jobLink: input.jobLink || null,
        jobId: input.jobId || null,
        resumeName: input.resumeName || null,
        resumePath: input.resumeBase64 || null,
        scheduledFor: targetScheduledFor,
        lastSentAt: targetLastSentAt,
        followupCount: targetFollowupCount,
        followupIntervalMinutes,
        maxFollowups,
        subject: targetSubject,
        body: targetBody,
        respectTiming: input.respectTiming ?? defaultRespectTiming,
        skipBounceMonitor: input.skipBounceMonitor ?? (candidate.verifierStatus === "pre_verified"),
        roleName: input.roleName || existingCampaign.roleName || null,
        isPaused: false,
        templateId: targetTemplateId
      }
    });
  } else {
    campaign = await prisma.campaignState.create({
      data: {
        leadId: input.leadId,
        candidateId: input.candidateId,
        status: "scheduled",
        jobLink: input.jobLink || null,
        jobId: input.jobId || null,
        resumeName: input.resumeName || null,
        resumePath: input.resumeBase64 || null,
        scheduledFor: scheduledDate,
        followupCount: 0,
        followupIntervalMinutes,
        maxFollowups,
        subject,
        body,
        respectTiming: input.respectTiming ?? defaultRespectTiming,
        skipBounceMonitor: input.skipBounceMonitor ?? (candidate.verifierStatus === "pre_verified"),
        roleName: input.roleName || null,
        isPaused: false,
        templateId: resolvedTemplateId
      }
    });
  }

  return campaign;
}

let isProcessingQueue = false;

export async function processCampaignQueue() {
  if (await isGmailQuotaHalted()) {
    console.log("⚠️ [OUTBOX QUEUE ENGINE] Queue processing is halted because Gmail daily quota has been breached.");
    return { success: false, error: "Gmail daily quota breached", sentCount: 0 };
  }

  if (isProcessingQueue) {
    console.log("⏳ [OUTBOX QUEUE ENGINE] Queue process is already in progress. Skipping concurrent run.");
    return { success: true, sentCount: 0 };
  }

  isProcessingQueue = true;
  const defaultResumeLink = await getSystemSetting("defaultResumeLink");
  const timingStartHour = await getSystemSetting("timingStartHour");
  const timingEndHour = await getSystemSetting("timingEndHour");
  const skipWeekends = await getSystemSetting("skipWeekends");
  const timezone = await getSystemSetting("timezone");

  try {
    const now = new Date();

    // Resolve timezone safely
    let targetTimezone = "Asia/Kolkata";
    try {
      if (timezone) {
        new Intl.DateTimeFormat("en-US", { timeZone: timezone });
        targetTimezone = timezone;
      }
    } catch (e) {
      console.warn(`⚠️ Invalid timezone "${timezone}" configured. Falling back to Asia/Kolkata.`);
    }

    // Find all campaigns that are scheduled or active, and are due to be sent
    const campaigns = await prisma.campaignState.findMany({
      where: {
        status: { notIn: ["completed", "bounced", "replied", "draft", "cancelled"] },
        scheduledFor: { lte: now },
        isPaused: false
      },
      include: {
        lead: { include: { company: true } },
        candidate: true
      }
    });

    if (campaigns.length > 0) {
      console.log(`\n⏰ [OUTBOX QUEUE ENGINE] Processing ${campaigns.length} pending campaigns in timezone ${targetTimezone}...`);
    }

    let sentCount = 0;

    for (const campaign of campaigns) {
      const firstName = campaign.lead.firstName;
      const companyName = campaign.lead.company.name;
      const to = campaign.candidate.email;

      // Skip sending on weekends if the setting is enabled
      if (skipWeekends) {
        const dayOfWeekString = new Intl.DateTimeFormat("en-US", {
          timeZone: targetTimezone,
          weekday: "long"
        }).format(now);
        if (dayOfWeekString === "Saturday" || dayOfWeekString === "Sunday") {
          console.log(`   📅 [Skip Weekends] Today is ${dayOfWeekString} in ${targetTimezone}. Skipping all campaigns (skipWeekends is enabled).`);
          break; // All campaigns share the same date — no point iterating further
        }
      }

      if (campaign.respectTiming) {
        const parts = new Intl.DateTimeFormat("en-US", {
          timeZone: targetTimezone,
          hour: "numeric",
          hour12: false
        }).formatToParts(now);
        const hourVal = parts.find(p => p.type === 'hour')?.value;
        const currentHour = (hourVal ? parseInt(hourVal, 10) : now.getHours()) % 24;

        if (currentHour < timingStartHour || currentHour >= timingEndHour) {
          console.log(`   ⏳ [Respect Timing] Current hour (${currentHour}) in ${targetTimezone} is outside configured window (${timingStartHour}-${timingEndHour}). Skipping candidate: "${to}"`);
          continue;
        }
      }

      console.log(`\n➡️  [Queue Item] Lead: "${campaign.lead.fullName}" (${companyName}) | Email: "${to}"`);
      console.log(`   Current Campaign Status: "${campaign.status}" (Followup Count: ${campaign.followupCount})`);

      let currentSubject = campaign.subject || "";
      let currentBody = campaign.body || "";
      let targetStatus = "completed";
      let nextScheduledTime: Date | null = null;

      if (campaign.status === "scheduled" && campaign.followupCount === 0) {
        if (campaign.skipBounceMonitor) {
          console.log(`   Action: [Skip Bounce Monitor] Preparing to send INITIAL outreach to selected candidate: "${to}"...`);
          
          let attachment = undefined;
          if (campaign.resumeName && campaign.resumePath) {
            console.log(`   Attachment: Adding PDF Resume "${campaign.resumeName}" (${(campaign.resumePath.length * 0.75 / 1024).toFixed(1)} KB)`);
            attachment = {
              name: campaign.resumeName,
              type: "application/pdf",
              contentBase64: campaign.resumePath
            };
          }

          const sendResult = await sendGmailEmail(to, currentSubject, currentBody, attachment);

          if (sendResult.success) {
            console.log(`      ✅ Sent successfully to: "${to}". Message ID: ${sendResult.messageId}`);

            // Clear any stale bounce status
            await prisma.emailCandidate.update({
              where: { id: campaign.candidateId },
              data: { verifierStatus: "deliverable" }
            });

            await recordEmailEvent({
              candidateId: campaign.candidateId,
              email: to,
              eventType: "delivery",
              provider: "gmail",
              rawPayload: {
                messageId: sendResult.messageId || `mock_delivery_${Date.now()}`,
                threadId: sendResult.threadId || `mock_thread_${Date.now()}`,
                followupNumber: 0,
                timestamp: new Date().toISOString()
              }
            });

            // Schedule next follow-up immediately
            if (campaign.maxFollowups === 0) {
              await prisma.campaignState.update({
                where: { id: campaign.id },
                data: {
                  status: "completed",
                  followupCount: 1,
                  lastSentAt: new Date(),
                  scheduledFor: null,
                  subject: currentSubject,
                  body: currentBody
                }
              });
              console.log(`   Campaign has 0 followups. Completing campaign immediately.`);
            } else {
              const nextScheduledTime = new Date(Date.now() + campaign.followupIntervalMinutes * 60 * 1000);
              await prisma.campaignState.update({
                where: { id: campaign.id },
                data: {
                  status: "sent_initial",
                  followupCount: 1,
                  lastSentAt: new Date(),
                  scheduledFor: nextScheduledTime,
                  subject: currentSubject,
                  body: currentBody
                }
              });
              console.log(`   Campaign set to "sent_initial" and successfully scheduled for next follow-up at: ${nextScheduledTime.toISOString()}`);
            }
            sentCount++;
          } else {
            console.error(`      ❌ Send failed to: "${to}":`, sendResult.error || "Rejected");

            if (sendResult.isNetworkError) {
              console.log(`      ℹ️  Network error detected. Keeping campaign scheduled for retry.`);
              await prisma.campaignState.update({
                where: { id: campaign.id },
                data: {
                  scheduledFor: new Date(Date.now() + 5 * 60 * 1000)
                }
              });
              continue;
            }

            await prisma.campaignState.update({
              where: { id: campaign.id },
              data: {
                status: "bounced"
              }
            });

            await recordEmailEvent({
              candidateId: campaign.candidateId,
              email: to,
              eventType: "bounce",
              provider: "gmail",
              rawPayload: {
                error: sendResult.error || "Gmail API rejected request",
                followupNumber: 0,
                timestamp: new Date().toISOString()
              }
            });
          }
          continue;
        }

        console.log(`   Action: Preparing to send INITIAL outreach to the selected candidate: "${to}"...`);

        // Constrain dispatch to ONLY send to the selected candidate variation to prevent spamming multiple identical emails
        const activeCandidates = [campaign.candidate];

        if (activeCandidates.length === 0) {
          console.log(`   ⚠️  No eligible candidates available for parallel dispatch.`);
          const allCandidates = await prisma.emailCandidate.findMany({
            where: { leadId: campaign.leadId }
          });
          const triedEmails = allCandidates.map((c) => c.email.toLowerCase().trim());

          // Dynamic import to prevent circular dependency resolution issues in Node ES modules
          const { discoverAlternativeCandidates } = await import("./candidateService.js");
          await discoverAlternativeCandidates(campaign.leadId, triedEmails);
          continue;
        }

        // Attach resume if present
        let attachment = undefined;
        if (campaign.resumeName && campaign.resumePath) {
          console.log(`   Attachment: Adding PDF Resume "${campaign.resumeName}" (${(campaign.resumePath.length * 0.75 / 1024).toFixed(1)} KB)`);
          attachment = {
            name: campaign.resumeName,
            type: "application/pdf",
            contentBase64: campaign.resumePath
          };
        }

        console.log(`   🚀 [Parallel Outbox Dispatcher] Sending initial outreach to all ${activeCandidates.length} candidates in parallel...`);

        let hasNetworkError = false;
        const sendPromises = activeCandidates.map(async (candidate) => {
          console.log(`      ➡️  Sending parallel outreach to: "${candidate.email}"`);
          const sendResult = await sendGmailEmail(candidate.email, currentSubject, currentBody, attachment);

          if (sendResult.success) {
            console.log(`      ✅ Sent successfully to: "${candidate.email}". Message ID: ${sendResult.messageId}`);

            // Clear any stale bounce status
            await prisma.emailCandidate.update({
              where: { id: candidate.id },
              data: { verifierStatus: "deliverable" }
            });

            await recordEmailEvent({
              candidateId: candidate.id,
              email: candidate.email,
              eventType: "delivery",
              provider: "gmail",
              rawPayload: {
                messageId: sendResult.messageId || `mock_delivery_${Date.now()}`,
                threadId: sendResult.threadId || `mock_thread_${Date.now()}`,
                followupNumber: 0,
                timestamp: new Date().toISOString()
              }
            });
          } else {
            console.error(`      ❌ Send failed to: "${candidate.email}":`, sendResult.error || "Rejected");

            if (sendResult.isNetworkError) {
              console.log(`      ℹ️  Network error detected for "${candidate.email}".`);
              hasNetworkError = true;
              return;
            }

            await recordEmailEvent({
              candidateId: candidate.id,
              email: candidate.email,
              eventType: "bounce",
              provider: "gmail",
              rawPayload: {
                error: sendResult.error || "Gmail API rejected request",
                followupNumber: 0,
                timestamp: new Date().toISOString()
              }
            });
          }
        });

        await Promise.all(sendPromises);

        if (hasNetworkError) {
          console.log(`   ⚠️  Parallel dispatch encountered a network error. Keeping campaign scheduled for retry.`);
          await prisma.campaignState.update({
            where: { id: campaign.id },
            data: {
              scheduledFor: new Date(Date.now() + 5 * 60 * 1000)
            }
          });
          continue;
        }

        // Transition campaign to "sent_initial" and set scheduledFor to null (waiting for bounce monitor verification)
        await prisma.campaignState.update({
          where: { id: campaign.id },
          data: {
            status: "sent_initial",
            followupCount: 1,
            lastSentAt: new Date(),
            scheduledFor: null,
            subject: currentSubject,
            body: currentBody
          }
        });

        sentCount += activeCandidates.length;

        // Start asynchronous parallel background bounce checker (max 2 minutes)
        console.log(`🕵️‍♂️ [Parallel Outbox Dispatcher] Spawning asynchronous background bounce monitor...`);
        setTimeout(() => {
          runBackgroundBounceChecker(campaign.leadId, activeCandidates.map((c) => c.id));
        }, 0);

        continue;
      } else if (campaign.followupCount >= 1) {
        const step = campaign.followupCount;

        // If sequence has already reached the maximum configured count, complete it
        if (step > campaign.maxFollowups) {
          console.log(`   ⏳ Sequence reached maximum follow-up count (${campaign.maxFollowups}). Completing campaign.`);
          await prisma.campaignState.update({
            where: { id: campaign.id },
            data: {
              status: "completed",
              scheduledFor: null
            }
          });
          continue;
        }

        console.log(`   Action: Preparing to send FOLLOWUP ${step} outreach email (Max: ${campaign.maxFollowups})...`);
        
        let followupSubject = "";
        let followupBody = "";

        if (campaign.templateId) {
          const template = await prisma.template.findUnique({
            where: { id: campaign.templateId }
          });
          if (template) {
            const intro = getTemplateFollowupIntroduction(step);
            const resolvedSubject = resolveTemplatePlaceholders(
              template.subject,
              campaign.lead,
              campaign.jobId || undefined,
              campaign.jobLink || undefined,
              campaign.resumeName || undefined,
              campaign.roleName || undefined,
              defaultResumeLink
            );
            const rawFollowupBody = generateDynamicTemplateFollowup(
              template.body,
              step,
              campaign.lead,
              campaign.roleName || undefined,
              campaign.jobId || undefined,
              campaign.jobLink || undefined,
              campaign.resumeName || undefined,
              defaultResumeLink
            );
            
            const rawBodyWithDots = applyDynamicDotsToBody(rawFollowupBody, step);
            followupSubject = resolvedSubject.toLowerCase().startsWith("re:") ? resolvedSubject : `Re: ${resolvedSubject}`;
            followupBody = formatEmailBody(rawBodyWithDots);
          }
        } else {
          const roleName = campaign.roleName || undefined;
          const subjectLine = `Looking for ${roleName && roleName.trim() !== "" ? roleName.trim() : "DevOps Engineer"} roles | 1.5+ YOE | AWS | Kubernetes | Terraform | CI/CD`;
          
          const rawFollowupBody = generateSystemTemplateFollowup(
            step,
            campaign.lead,
            roleName,
            campaign.jobId || undefined,
            campaign.jobLink || undefined,
            !!(campaign.resumeName && campaign.resumePath),
            defaultResumeLink
          );

          const rawBodyWithDots = applyDynamicDotsToBody(rawFollowupBody, step);
          followupSubject = `Re: ${subjectLine}`;
          followupBody = formatEmailBody(rawBodyWithDots);
        }

        currentSubject = followupSubject;
        currentBody = followupBody;

        if (step === campaign.maxFollowups) {
          targetStatus = "completed";
          nextScheduledTime = null;
        } else {
          targetStatus = `sent_followup_${step}`;
          nextScheduledTime = new Date(Date.now() + campaign.followupIntervalMinutes * 60 * 1000);
        }
      } else {
        console.log(`   ⚠️  Unrecognized status/followup state. Skipping...`);
        continue;
      }

      console.log(`   Sending request via Gmail API dispatcher...`);
      
      let threadId: string | undefined = undefined;
      let parentMessageId: string | undefined = undefined;

      if (campaign.followupCount >= 1) {
        const lastDeliveryEvent = await prisma.emailEvent.findFirst({
          where: {
            candidateId: campaign.candidateId,
            eventType: "delivery"
          },
          orderBy: { createdAt: "desc" }
        });

        if (lastDeliveryEvent) {
          const payload = lastDeliveryEvent.rawPayload as any;
          threadId = payload?.threadId;
          parentMessageId = payload?.messageId;
          console.log(`   Threaded Reply: Found parent email event. threadId: "${threadId}", parentMessageId: "${parentMessageId}"`);
        }
      }

      const sendResult = await sendGmailEmail(to, currentSubject, currentBody, undefined, threadId, parentMessageId);

      if (sendResult.success) {
        const nextFollowupCount = campaign.followupCount + 1;
        console.log(`   ✅ SUCCESS: Email successfully sent! Message ID: ${sendResult.messageId}`);

        // Clear any stale bounce status
        await prisma.emailCandidate.update({
          where: { id: campaign.candidateId },
          data: { verifierStatus: "deliverable" }
        });

        console.log(`   Transitioning DB Campaign State -> Status: "${targetStatus}", Next schedule date: ${nextScheduledTime ? nextScheduledTime.toISOString() : "None"}`);

        // Update Campaign State
        await prisma.campaignState.update({
          where: { id: campaign.id },
          data: {
            status: targetStatus,
            followupCount: nextFollowupCount,
            lastSentAt: new Date(),
            scheduledFor: nextScheduledTime,
            subject: currentSubject,
            body: currentBody
          }
        });

        // Record Email Event Log
        await recordEmailEvent({
          candidateId: campaign.candidateId,
          email: to,
          eventType: "delivery",
          provider: "gmail",
          rawPayload: {
            messageId: sendResult.messageId || `mock_delivery_${Date.now()}`,
            threadId: sendResult.threadId || `mock_thread_${Date.now()}`,
            followupNumber: campaign.followupCount,
            timestamp: new Date().toISOString()
          }
        });

        sentCount++;
      } else {
        console.error(`   ❌ FAILURE: Gmail API rejected standard send request! Error:`, sendResult.error || "Unknown reason");

        if (sendResult.isNetworkError) {
          console.log(`   ℹ️  Network error detected during followup send. Keeping campaign scheduled for retry.`);
          await prisma.campaignState.update({
            where: { id: campaign.id },
            data: {
              scheduledFor: new Date(Date.now() + 5 * 60 * 1000)
            }
          });
          continue;
        }

        await prisma.campaignState.update({
          where: { id: campaign.id },
          data: {
            status: "bounced"
          }
        });

        await recordEmailEvent({
          candidateId: campaign.candidateId,
          email: to,
          eventType: "bounce",
          provider: "gmail",
          rawPayload: {
            error: sendResult.error || "Gmail API rejected request",
            followupNumber: campaign.followupCount,
            timestamp: new Date().toISOString()
          }
        });
      }
    }

    if (campaigns.length > 0) {
      console.log(`⏰ [OUTBOX QUEUE ENGINE] Queue run complete. Sent emails count: ${sentCount}.\n`);
    }

    return { success: true, sentCount };
  } finally {
    isProcessingQueue = false;
  }
}

let schedulerInterval: NodeJS.Timeout | null = null;
let bounceInterval: NodeJS.Timeout | null = null;

export function startCampaignScheduler() {
  if (schedulerInterval) {
    return;
  }

  // Poll pending campaigns and dispatch queued outreach emails once every 5 seconds for fast response
  schedulerInterval = setInterval(async () => {
    try {
      await processCampaignQueue();
    } catch (e) {
      console.error("Scheduler encountered background queue processing error:", e);
    }
  }, 5000);

  // Poll Gmail bounces once every 30 seconds to respect Google API limits
  bounceInterval = setInterval(async () => {
    try {
      await pollGmailBounces();
    } catch (e) {
      console.error("Scheduler encountered background bounce polling error:", e);
    }
  }, 30000);
}

export async function runBackgroundBounceChecker(leadId: string, candidateIdsInput: string | string[]) {
  try {
    const campaign = await prisma.campaignState.findUnique({
      where: { leadId }
    });
    if (campaign?.skipBounceMonitor) {
      console.log(`\n🕵️‍♂️ [Asynchronous Bounce Monitor] Campaign has skipBounceMonitor enabled for Lead ID: "${leadId}". Skipping background bounce monitor.`);
      return;
    }
  } catch (err: any) {
    console.error("⚠️ Failed to check campaign skipBounceMonitor status in runBackgroundBounceChecker:", err.message || err);
  }

  console.log(`\n🕵️‍♂️ [Asynchronous Bounce Monitor] Initialized parallel background checks for Lead ID: "${leadId}"`);

  const candidateIds = Array.isArray(candidateIdsInput) ? candidateIdsInput : [candidateIdsInput];
  const maxCycles = 5; // 5 * 25 seconds = 125 seconds (~2 minutes maximum check duration)

  for (let cycle = 1; cycle <= maxCycles; cycle++) {
    // Wait 25 seconds for email delivery and bounce back
    console.log(`⏰ [Asynchronous Bounce Monitor] [Cycle ${cycle}/${maxCycles}] Waiting 25 seconds for delivery bounce propagation...`);
    await new Promise((resolve) => setTimeout(resolve, 25000));

    console.log(`   [Cycle ${cycle}/${maxCycles}] Polling Gmail mailbox for real-time delivery failure events...`);
    try {
      await pollGmailBounces();

      const candidates = await prisma.emailCandidate.findMany({
        where: { id: { in: candidateIds } }
      });

      const nonBounced = candidates.filter(
        (c) => c.verifierStatus !== "bounced" && c.verifierStatus !== "invalid_email"
      );

      console.log(`   [Cycle ${cycle}/${maxCycles}] Parallel Stats -> Total: ${candidates.length}, Bounced: ${candidates.length - nonBounced.length}, Stable: ${nonBounced.length}`);

      if (nonBounced.length === 0) {
        console.log(`   🚨 [Cycle ${cycle}/${maxCycles}] All parallel candidates have bounced! Stopping monitor early.`);
        break;
      }
    } catch (pollError: any) {
      console.error(`⚠️  [Asynchronous Bounce Monitor] Background poll failed:`, pollError.message || pollError);
      break;
    }
  }

  // Monitor complete, now select the successful winner!
  console.log(`🕵️‍♂️ [Asynchronous Bounce Monitor] Finalizing parallel validation session for Lead ID: "${leadId}"...`);
  try {
    const candidates = await prisma.emailCandidate.findMany({
      where: { id: { in: candidateIds } }
    });

    const nonBounced = candidates.filter(
      (c) => c.verifierStatus !== "bounced" && c.verifierStatus !== "invalid_email"
    );

    if (nonBounced.length > 0) {
      // Pick the best non-bounced one (highest score/confidence)
      nonBounced.sort((a, b) => (b.verifierScore ?? 0) - (a.verifierScore ?? 0));
      const winner = nonBounced[0];
      console.log(`🏆 [Asynchronous Bounce Monitor] SUCCESS! Winning candidate identified: "${winner.email}"`);

      // Mark winner candidate as selected
      await prisma.emailCandidate.updateMany({
        where: { leadId },
        data: { selected: false }
      });
      await prisma.emailCandidate.update({
        where: { id: winner.id },
        data: { selected: true }
      });

      // Bind to campaign state and schedule the next follow-up
      const activeCampaign = await prisma.campaignState.findFirst({
        where: { leadId }
      });

      if (activeCampaign) {
        if (activeCampaign.maxFollowups === 0) {
          await prisma.campaignState.update({
            where: { id: activeCampaign.id },
            data: {
              candidateId: winner.id,
              status: "completed",
              scheduledFor: null
            }
          });
          console.log(`   Campaign has 0 followups. Completing campaign immediately.`);
        } else {
          const nextScheduledTime = new Date(Date.now() + activeCampaign.followupIntervalMinutes * 60 * 1000);
          await prisma.campaignState.update({
            where: { id: activeCampaign.id },
            data: {
              candidateId: winner.id,
              status: "sent_initial",
              scheduledFor: nextScheduledTime
            }
          });
          console.log(`   Campaign bound to "${winner.email}" and successfully scheduled for next follow-up.`);
        }
      }
    } else {
      console.log(`❌ [Asynchronous Bounce Monitor] All candidate variations bounced. Triggering recursive pattern intelligence...`);

      const allCandidates = await prisma.emailCandidate.findMany({
        where: { leadId }
      });
      const triedEmails = allCandidates.map((c) => c.email.toLowerCase().trim());

      // Dynamic import to prevent circular dependency resolution issues in Node ES modules
      const { discoverAlternativeCandidates } = await import("./candidateService.js");
      await discoverAlternativeCandidates(leadId, triedEmails);
    }
  } catch (err: any) {
    console.error("❌ [Asynchronous Bounce Monitor] Error finalizing checks:", err.message || err);
  }

  console.log(`🕵️‍♂️ [Asynchronous Bounce Monitor] Finished monitoring session for Lead ID: "${leadId}".\n`);
}
