# LinkedIn Email Automator — Deep Architecture & Component Reference

> Generated: 2026-06-01. Read-only documentation. No source code was modified to produce this file.
> Companion file: [KNOWLEDGE_GRAPH.md](./KNOWLEDGE_GRAPH.md)

This document describes every meaningful component in the repository, what it *actually* does at runtime (not what the README claims), how the components are wired, and where the implementation diverges from the stated product plan or contains dead / inefficient / risky code.

---

## 1. High-Level Purpose

A locally-runnable system that, given a person's name + company (typically captured from a LinkedIn profile via a Chrome extension or a CSV / manual entry), will:

1. Resolve the company's email domain (deterministic map → Gemini → guess).
2. Generate ranked candidate work emails from pattern templates (default catalog + Gemini-enriched + recursive Gemini "alternative" patterns on bounce).
3. Verify each candidate (local syntax + MX, optionally Hunter).
4. Persist all candidates and pick the best one.
5. **Immediately auto-start a Gmail-API-driven cold outreach campaign** with N follow-ups, attachments, threading, and bounce-driven auto-rotation.
6. Learn from per-candidate events (delivery, bounce, reply, complaint, unsubscribe) by updating per-company-per-algorithm confidence/hit/miss/bounce counters, and suppress further sends to bounced/complained/unsubscribed addresses.

The system is opinionated: the cold-email body is hard-coded to *Chandan Kumar Saha — SDE Backend* outreach (see §6.4).

---

## 2. Tech Stack

| Layer | Choice |
|---|---|
| Runtime | Node.js 24 (Alpine in Docker), ESM (`"type": "module"`) |
| Language | TypeScript 5.9, `NodeNext` modules, `strict: true` |
| Web framework | Fastify 5 with `@fastify/cors` and `@fastify/static` |
| Validation | Zod 4 |
| ORM / DB | Prisma 6 + PostgreSQL 16 |
| Dev runner | `tsx watch` |
| Tests | Vitest 4 (`src/**/*.test.ts`) |
| LLM | Google Gemini REST (`v1/{model}:generateContent`, `X-goog-api-key` header) |
| Email sending | Gmail REST API via OAuth2 refresh token (`users/me/messages/send`) |
| Email verification (optional) | Hunter.io |
| Front-ends | (a) Vanilla JS SPA at [src/public/index.html](../src/public/index.html); (b) legacy admin at [src/public/admin.html](../src/public/admin.html); (c) MV3 Chrome extension under [extension/](../extension/) |
| Container | Docker Compose: `db` always, `api` under `--profile app` |

Entrypoint: [src/server.ts](../src/server.ts) → [`buildApp`](../src/app.ts) → registers all routes and starts `startCampaignScheduler()` (a 20s `setInterval`).

---

## 3. Configuration & Secrets

[src/config/env.ts](../src/config/env.ts) parses `process.env` with Zod. Keys:

| Key | Default | Purpose |
|---|---|---|
| `NODE_ENV` | `development` | Standard env switch |
| `PORT` / `HOST` | `4000` / `0.0.0.0` | Fastify listen |
| `DATABASE_URL` | (required) | Postgres connection (host port `55432` in Compose) |
| `CORS_ORIGIN` | `*` | If `*`, passes `true` to `@fastify/cors` |
| `GEMINI_API_KEY` | optional | Enables LLM enrichment for domains, patterns, alt patterns, and per-company "research reason" |
| `GEMINI_MODEL` | `gemini-3.5-flash` | Model id; README suggests `gemini-flash-latest` |
| `EMAIL_VERIFIER_PROVIDER` | `local` | `local` or `hunter` |
| `HUNTER_API_KEY` | optional | Required when provider=hunter |
| `GMAIL_CLIENT_ID` / `GMAIL_CLIENT_SECRET` / `GMAIL_REFRESH_TOKEN` | optional | OAuth2 refresh-token flow for both polling bounces **and** sending real outbound mail |
| `GMAIL_MONITOR_ENABLED` | `false` | **Master switch**: gates both bounce polling AND real email sending in `sendGmailEmail`. When false → mock send to console. |

A real Google OAuth client JSON file (`client_secret_813864107905-…json`) is committed at the repo root. See §10 Security Concerns.

---

## 4. Database Model

Source of truth: [prisma/schema.prisma](../prisma/schema.prisma). Migrations are applied in chronological order (`prisma/migrations/2026052716…` → `…20260601015140`). The latest schema:

### 4.1 Tables

- **`companies`** — one row per normalized company name. Tracks `domain`, `domainConfidence` (0–100), `domainSource` (e.g. `user_input`, `known_company_map`, `gemini_mx_confirmed`, `company_name_guess(_mx_confirmed)`), and a cached `researchReason` clause used inside the outreach body.
- **`email_algorithms`** — global catalog of pattern templates (`{first}.{last}@{domain}`, etc.). `key` and `patternTemplate` are both unique.
- **`company_email_algorithms`** — N:N join with **ranking signals**: `hitCount`, `missCount`, `verificationSuccessCount`, `bounceCount`, `confidenceScore` (default 20), `rank`, `lastVerifiedAt`. Unique on `(companyId, algorithmId)`.
- **`leads`** — captured prospects (name parts + linkedin_url + headline + source + status). Unique 1:1 with `campaign_states` via `lead_id`.
- **`email_candidates`** — generated emails per lead, with verifier provider/status/score, MX/syntax flags, `isCatchAll`, `selected` boolean. Unique on `(lead_id, email)`.
- **`campaign_states`** — per-lead outreach state machine. See §6.1.
- **`email_events`** — audit log of every webhook / send / poll-derived event keyed to `candidate_id` with `event_type`, `provider`, `raw_payload` (JSONB).
- **`suppression_entries`** — block list by `email` or `domain`, with `reason` + `source`.

### 4.2 `campaign_states` columns (full list)

`id, leadId(uniq), candidateId, status, jobLink, jobId, resumePath (base64 PDF), resumeName, scheduledFor, lastSentAt, followupCount, followupIntervalMinutes(70), maxFollowups(3), subject, body, respectTiming(false), isPaused(false), skipBounceMonitor(false), createdAt, updatedAt`.

`status` is a string enum used by the queue: `draft | scheduled | sent_initial | sent_followup_1..N | completed | bounced | replied`.

### 4.3 Cascading

All FKs are `ON DELETE CASCADE`. Deleting a lead removes its candidates, events, and campaign state.

### 4.4 Seed

[prisma/seed.ts](../prisma/seed.ts) upserts the 8 templates exported by [src/modules/algorithmCatalog.ts](../src/modules/algorithmCatalog.ts) into `email_algorithms`. (A 9th template, `first_last_two`, is commented out — dead code.)

---

## 5. Module Reference (pure helpers, no DB)

### 5.1 [src/modules/nameParser.ts](../src/modules/nameParser.ts)
`parseName(fullName)` strips suffixes (`jr, sr, ii, iii, iv, phd, mba, md`), splits on whitespace, returns `{ fullName, firstName, middleName?, lastName? }`. Throws if name is empty.

### 5.2 [src/modules/companyNormalizer.ts](../src/modules/companyNormalizer.ts)
- `cleanCompanyName` — strips LinkedIn experience junk (`Power Programmer`, `Full-time`, etc.), separators `· • newline`, `Title - Company` hyphen splits.
- `normalizeCompanyName` — lowercase, remove legal suffixes (Inc, LLC, GmbH…), collapse to alphanumeric+space — used as the unique DB key.
- `normalizeDomain` — strips protocol, `www.`, path, trailing dot.

### 5.3 [src/modules/domainResolver.ts](../src/modules/domainResolver.ts)
`resolveCompanyDomain(name, providedDomain?)`. Resolution order:
1. User-provided domain → confidence 100, `source=user_input`.
2. Built-in `knownCompanyDomains` map (only 11 entries: google, alphabet, microsoft, openai, meta, amazon, apple, netflix, tesla, zeta, example) → confidence 85.
3. **If `GEMINI_API_KEY` set AND not in vitest**: ask Gemini for a ranked JSON array of likely domains; first one with live MX records wins → confidence 90, `source=gemini_mx_confirmed`.
4. Fallback `${normalized}.com`. MX-confirmed → 55, else 25.

### 5.4 [src/modules/emailTemplate.ts](../src/modules/emailTemplate.ts)
`renderEmailTemplate(template, ctx)` normalises name tokens (NFKD, strip diacritics, strip non `[a-z0-9]`), substitutes `{first|middle|last|first_initial|middle_initial|last_initial|first_two|last_two|first_three|last_three|domain}`. Rejects results that contain `{}` placeholder leftovers, start with `@`, or contain `..`, or have empty local part.

### 5.5 [src/modules/emailValidation.ts](../src/modules/emailValidation.ts)
- `isSyntaxValidEmail` — basic regex `^[^\s@]+@[^\s@]+\.[^\s@]+$` plus rejects local parts < 3 chars or in a blocklist of role addresses (`cs, hr, it, pr, ad, hq, no, go, to, by, ok, sales, support, jobs, career, careers, hello, info, admin, team, contact, office`).
- `hasValidMx` — `dns.promises.resolveMx` on the normalised domain.

### 5.6 [src/modules/algorithmRanking.ts](../src/modules/algorithmRanking.ts)
Single `scoreAlgorithm`:

```
score = confidenceScore
      + verificationSuccessCount * 5
      + hitCount * 10
      - missCount * 2
      - bounceCount * 15
      - rank
```

### 5.7 [src/modules/algorithmCatalog.ts](../src/modules/algorithmCatalog.ts)
The 8 default `AlgorithmSuggestion`s shipped in the seed (all `confidenceScore: 20`, `source: "default_catalog"`).

### 5.8 [src/types/emailIntelligence.ts](../src/types/emailIntelligence.ts)
Type definitions: `AlgorithmSuggestion`, `DomainResolution`, `VerificationStatus`, `EmailVerificationResult`. `VerificationStatus` includes `valid | invalid | accept_all | catch_all | risky | unknown | domain_valid` but NOT the values used elsewhere (`pre_verified`, `verified`, `bounced`, `invalid_email`) — these are written to the DB as raw strings.

---

## 6. Services (business logic, DB-touching)

### 6.1 [src/services/campaignService.ts](../src/services/campaignService.ts) — the outreach engine

This file is the centerpiece. ~600 lines. Responsibilities:

- **Templating**
  - `generateInitialSubjectAndBody(firstName, companyName, researchReason, jobLink?, jobId?, hasAttachment?)` — hard-coded SDE Backend pitch signed *Chandan Kumar Saha, 8368858321*. The subject is fixed: `Looking for SDE Backend roles | 2.5+ YOE | Java | SpringBoot | Microservices | AI`. Embeds `companyName`, optional `jobLink`/`jobId`, and the cached `researchReason` (else a generic fallback).
  - `generateFollowupContent(firstName, companyName, step)` — 10 hard-coded follow-up bodies (cases 1–10) and a default. All share subject `Re: Looking for SDE Backend roles…`.
  - `formatEmailBody` — converts `\n` → `<br>` (the MIME is sent as `text/html`).

- **`startCampaign(input)`** — upserts a `campaign_state` for the lead:
  - Forces only the chosen `candidateId` to be `selected=true` (de-selects siblings).
  - Resolves `followupIntervalMinutes` from `…Minutes` or `…Hours * 60` (default 70).
  - Generates subject/body from the initial template (re-uses existing campaign's subject/body if the campaign has already progressed past `draft`/`scheduled`).
  - Defaults `skipBounceMonitor = (candidate.verifierStatus === "pre_verified")`.
  - Creates/updates with `status="scheduled"`.

- **`processCampaignQueue()`** — the worker. Reentrancy-guarded via module-level `isProcessingQueue`. For each due campaign (`scheduledFor <= now`, not paused, status not in `{completed, bounced, replied, draft}`):
  - If `respectTiming` and current hour ∉ [9,17), skip.
  - **Initial send branch** (`status === "scheduled" && followupCount === 0`):
    - **`skipBounceMonitor=true`**: send only to the selected candidate. On success → status `sent_initial`, `followupCount=1`, `scheduledFor = now + interval`. On failure → status `bounced`.
    - **else (normal path)**: "parallel dispatcher" — but the array is hard-coded to `[campaign.candidate]` only (a comment justifies this anti-spam decision), so it is effectively the same as the skip path except `scheduledFor=null` after sending and a `runBackgroundBounceChecker` is fired via `setTimeout(0)`.
  - **Followup branch** (`followupCount >= 1`):
    - If `followupCount > maxFollowups` → mark `completed`.
    - Else render followup with `generateFollowupContent`, attach RFC 5322 threading via the latest `delivery` event's `messageId/threadId`, send, then move to `sent_followup_{step}` (or `completed` if step==max). Schedule next followup at `now + interval`.
  - All sends produce an `email_event` (`delivery` on success, `bounce` on failure) via `recordEmailEvent`.

- **`startCampaignScheduler()`** — every 20 seconds: `pollGmailBounces()` then `processCampaignQueue()`. Single global interval.

- **`runBackgroundBounceChecker(leadId, candidateIds[])`** — up to 5 cycles × 25 s wait. Each cycle polls Gmail and rechecks the DB. If all candidates have `verifierStatus ∈ {bounced, invalid_email}` → stop early and call `discoverAlternativeCandidates`. Otherwise at the end, pick the highest-scoring non-bounced candidate as winner, set it `selected=true`, update the campaign to `status="sent_initial"`, `candidateId=winner.id`, `scheduledFor=now+interval`.

### 6.2 [src/services/candidateService.ts](../src/services/candidateService.ts) — the candidate factory

`generateCandidates(input)` is a 12-step pipeline (logged with emojis):

1. Parse name.
2. Clean + normalize company.
3. Resolve domain (`domainResolver`).
4. **MX gate** — throws if no MX, halting generation.
5. Upsert `companies` row.
6. Fire-and-forget `syncCompanyResearch()` (cached in `activeResearchPromises` map to dedupe concurrent calls; writes `researchReason`).
7. Ask Gemini for company-specific patterns (`getAlgorithmSuggestions`).
8. Upsert algorithms + `company_email_algorithms` mappings.
9. Create `leads` row.
10. Score and rank the company's algorithms; render templates; dedupe by rendered email.
11. For each candidate: `verifyEmail` (local or Hunter) + `checkSuppression`, then persist `email_candidates` row and call `updateAlgorithmFromVerification` (learning hook).
12. `selectBestCandidate` → if found, **auto-start a campaign** with `followupIntervalHours: 72`, immediately call `processCampaignQueue()`, then fire-and-forget `runBackgroundBounceChecker(lead.id, selectedCandidate.id)`.

`discoverAlternativeCandidates(leadId, triedEmails[])` — when all standard patterns bounce, ask Gemini for 3–5 *creative* templates, upsert them as algorithms (key prefixed `alt_`), render, verify, persist, then pick the highest-scoring fresh candidate, attach it to the existing campaign as `status="scheduled" scheduledFor=now followupCount=0`, and re-trigger the queue.

### 6.3 [src/services/candidateSelectionService.ts](../src/services/candidateSelectionService.ts)
`selectBestCandidate(leadId, scoredCandidates[])` computes a `selectionScore`:

```
score (from ranking)
  + (syntaxValid ? 10 : -50)
  + (mxValid ? 10 : -25)
  + verifierScore
  + statusWeights[verifierStatus]   // valid:100, domain_valid:30, accept_all/catch_all:5, risky:-15, unknown:0, invalid:-100
  - (isCatchAll ? 25 : 0)
```

Filters out suppressed, syntax-invalid, and status=`invalid`. Sets `selected=true` on the winner (and false on siblings). Note: status values written elsewhere — `bounced`, `pre_verified`, `verified`, `invalid_email` — are **not in `statusWeights`**, so they contribute 0.

### 6.4 [src/services/algorithmEnrichmentService.ts](../src/services/algorithmEnrichmentService.ts)
- `getAlgorithmSuggestions(company, domain)` — concatenates Gemini suggestions (if API key) with the default catalog and merges by `patternTemplate`, keeping the highest `confidenceScore`.
- `mergeSuggestions` — also rejects templates that don't include `@{domain}` or violate `^[a-z0-9{}@._-]+$`.
- `sanitizeKey` — replaces tokens with words and slugifies.

### 6.5 [src/services/emailVerifierService.ts](../src/services/emailVerifierService.ts)
- `verifyEmail` dispatches to Hunter (if configured) else local.
- **Local**: `invalid` if syntax fails; `unknown` (score 20) if no MX; else `domain_valid` (score 55). Never claims mailbox validity.
- **Hunter**: hits `api.hunter.io/v2/email-verifier`, maps statuses (`valid|invalid|accept|risky/webmail/disposable→risky|else unknown`), honours `accept_all`.

### 6.6 [src/services/learningService.ts](../src/services/learningService.ts)
`updateAlgorithmFromVerification(companyId, algorithmId, status)` adjusts the join row:

| Status | hit/miss/verif change | confidence Δ |
|---|---|---|
| `valid` | verif+1 | +8 |
| `domain_valid` | — | +1 |
| `invalid` | miss+1 | −8 |
| `accept_all` / `catch_all` / `risky` | — | −1 |
| `unknown` | (no update) | 0 |

### 6.7 [src/services/emailEventService.ts](../src/services/emailEventService.ts)
`recordEmailEvent({ candidateId?|email?, eventType, provider, rawPayload })`:

1. Resolve candidate by id or by lower-cased email (most recent).
2. Insert `email_events` row.
3. `applyEventLearning`:
   - **`bounce`**: `bounceCount+=1`, `confidenceScore-=15`; add suppression; mark candidate `verifierStatus="bounced", selected=false`; then if an active campaign exists:
     - If `campaign.status === "sent_initial"`, skip auto-rotation (the parallel monitor will choose).
     - Else find the next best non-bounced/non-invalid_email candidate with valid mx+syntax; if found, mark `selected`, set campaign `{candidateId, status:"scheduled", scheduledFor:now, followupCount:0}`. If none, call `discoverAlternativeCandidates`; if that returns no new patterns, set campaign `status="bounced"`.
   - **`complaint`/`unsubscribe`**: add suppression.
   - **`delivery`/`reply`**: `hitCount+=1`, `confidenceScore +=5 (delivery) or +=10 (reply)`. Reply additionally sets all matching campaigns `status="replied", scheduledFor=null`.
- `normalizeProviderEventType(string)` — substring match → `bounce|complaint|delivery|open|reply|unsubscribe|unknown`.

### 6.8 [src/services/suppressionService.ts](../src/services/suppressionService.ts)
- `checkSuppression(email)` — matches by exact lower-cased email OR by domain (normalized); returns most recent entry.
- `addSuppression({ email?|domain?, reason, source })`.

### 6.9 [src/services/gmailService.ts](../src/services/gmailService.ts)
- `getAccessToken()` — POST to `oauth2.googleapis.com/token` exchanging the refresh token.
- `extractTextFromPayload(payload)` — recursive base64url decode of all Gmail parts.
- `pollGmailBounces()` — gated by `GMAIL_MONITOR_ENABLED && full creds`. Query: `from:mailer-daemon OR subject:failure OR subject:failed OR subject:undelivered OR "delivery status notification"`. Up to 30 most recent. For each message, regex-scan for emails, dedupe, match each against `email_candidates`, record a `bounce` `email_event` (skipping ones already processed for that Gmail message id).
- `simulateGmailBounce(email)` — local-only: looks up `email_candidates` by email, writes a synthetic `bounce` event with `provider="gmail_simulator"`.
- `getSentMessageIdHeader(gmailMessageId)` — fetches metadata header `Message-ID` with exponential backoff (4 attempts × 300/600/1200 ms).
- `sendGmailEmail(to, subject, body, attachment?, threadId?, parentMessageId?)`:
  - **If `GMAIL_MONITOR_ENABLED=false` OR creds missing → mock send**: log to console and return a fabricated UUID `messageId`.
  - Else builds raw RFC 5322 MIME (`text/html` or `multipart/mixed` when attachment), base64url-encodes, POSTs to `gmail.googleapis.com/.../messages/send` with optional `threadId`, then fetches the real SMTP `Message-ID` header.

> ⚠️ Because the same `GMAIL_MONITOR_ENABLED` flag gates **both** polling and sending, you cannot enable real sending without also enabling polling, and vice versa. There is no separate "send live" flag.

---

## 7. HTTP API

Registered by [src/app.ts](../src/app.ts) under no prefix.

### 7.1 [src/routes/health.ts](../src/routes/health.ts)
- `GET /health` — runs `SELECT 1` against Postgres, returns `{ ok, service, timestamp }`.

### 7.2 [src/routes/leads.ts](../src/routes/leads.ts)
- `POST /leads/generate-candidates` — Zod-validated body `{ fullName, companyName, domain?, linkedinUrl?, headline?, source? }`. Runs the full `generateCandidates` pipeline (which auto-starts a campaign). Returns `{ lead, company, selectedCandidate, candidates[] }`.
- `POST /leads/bulk-csv` — Zod-validated array of `{ firstName, lastName?, email, company, preVerified? }`. For each row:
  - Reject if email is already a candidate anywhere.
  - Upsert company by normalized name (domain inferred from email's host).
  - Fire `syncCompanyResearch` in the background.
  - Find-or-create lead by `(fullName, companyId)`.
  - Ensure a special `direct_email` algorithm exists (template `{csv_direct}@{domain}`, which does not actually substitute since `csv_direct` is not a known token).
  - Map algorithm to company with `confidenceScore=100`.
  - Insert a candidate with `verifierStatus = "pre_verified" | "verified"`, score 100, `selected=true`. Does **not** auto-start a campaign — that requires a separate POST to `/admin/campaigns`.

### 7.3 [src/routes/suppressions.ts](../src/routes/suppressions.ts)
- `GET /suppressions` — last 100 entries.
- `POST /suppressions` — Zod body, requires email or domain + reason + optional source.
- `POST /suppressions/check` — Zod body `{ email }` → `{ suppressed, reason?, source? }`.

### 7.4 [src/routes/webhooks.ts](../src/routes/webhooks.ts)
- `POST /webhooks/email-events` — generic provider webhook. Body `{ candidateId?, email?, eventType, provider?, rawPayload? }`. Normalises event type, calls `recordEmailEvent`. Returns 201 if recorded, 202 if candidate not found. **No signature verification** — any caller can inject events.

### 7.5 [src/routes/admin.ts](../src/routes/admin.ts)
All admin/UI APIs (no auth):

| Method + Path | Purpose |
|---|---|
| `GET /admin/summary` | KPI counts (companies, leads, candidates, events, suppressions, active/bounced/replied campaigns, selected candidates) |
| `GET /admin/companies` | Top-50 with `_count` + `startedCampaignCount` derived from leads' campaign states |
| `GET /admin/companies/:id` | Company + algorithms (sorted by confidence/hit/rank) + 25 leads + each lead's candidates |
| `GET /admin/leads` | Top-50 leads with company, campaignState, candidates, candidate events |
| `GET /admin/events` | Top-100 events with candidate→lead/company/algorithm |
| `POST /admin/gmail/poll` | Calls `pollGmailBounces` |
| `POST /admin/gmail/simulate` | Body `{ email }` → `simulateGmailBounce` |
| `POST /admin/campaigns` | Calls `startCampaign`; if no `scheduledFor`, fire-and-forget `processCampaignQueue()` |
| `POST /admin/campaigns/process-queue` | Manual queue tick |
| `POST /admin/companies/:id/bulk-campaign` | Iterates company's leads → `startCampaign` for each (using selected candidate or first). Single immediate `processCampaignQueue` if no `scheduledFor`. |
| `POST /admin/leads/:id/pause` | Set/unset `campaignState.isPaused` |
| `POST /admin/companies/:id/pause` | Bulk pause/unpause |
| `POST /admin/leads/:id/end` | Set `status="completed", scheduledFor=null` |
| `DELETE /admin/leads/:id` | Hard delete (cascades) |

Static assets: `@fastify/static` serves [src/public/](../src/public/) at `/`, so both `/admin.html` and `/index.html` are accessible.

---

## 8. Front-ends

### 8.1 New SPA — [src/public/index.html](../src/public/index.html) + [src/public/app.js](../src/public/app.js)
"Cold Outreach Automator". Three tabs:
- **Leads Console** — CSV upload (parsed client-side; calls `POST /leads/bulk-csv`), manual single-lead form (also via `/leads/bulk-csv`), full leads table with launch/pause/resume/end/delete buttons and a campaign config modal.
- **Gmail & Learning Engine** — `Poll Gmail Bounces` button (`POST /admin/gmail/poll`), bounce simulator (`POST /admin/gmail/simulate`), and a live event timeline (auto-refreshed every 5 s).
- **Company Outreach Hub** — list of companies with pause-all / resume-all / bulk-send controls.

Campaign modal collects `candidateId`, `jobId`, `jobLink`, optional PDF (read as base64), `scheduledFor`, `followupIntervalMinutes` (default 70), `maxFollowups` (default 3), `autoFollowup`, `respectTiming`. POSTs to `/admin/campaigns` or `/admin/companies/:id/bulk-campaign`.

Reactive: `setInterval(updateUI, 5000)` for metrics, leads, and events.

### 8.2 Legacy admin — [src/public/admin.html](../src/public/admin.html) + [src/public/admin.js](../src/public/admin.js)
A simpler, older dashboard that still loads the same `/admin/*` endpoints and the Gmail simulator. Now superseded by the SPA but still served. Both share styles in [src/public/admin.css](../src/public/admin.css).

### 8.3 Chrome extension — [extension/](../extension/)
Manifest V3, permissions: `activeTab`, `scripting`, host `http://localhost:4000/*`. Content script matches `linkedin.com/in/*` and is `run_at: document_idle`.

- [contentScript.js](../extension/contentScript.js): listener for `EXTRACT_LINKEDIN_PROFILE` message. Pulls full name from `main h1`, company from the first `<span class="t-14">` inside the Experience section's first list item (with split-on-`·•‐`), falls back to `/company/` links in top card. Strips tracking query/hash from URL.
- [popup.js](../extension/popup.js): "Extract" button → `chrome.tabs.sendMessage` (auto-injects content script if not yet loaded). Editable form → "Generate" → `POST http://localhost:4000/leads/generate-candidates` → renders selected email + ranked list.

**Important behaviour**: because `generateCandidates` auto-starts a campaign and triggers the queue, **clicking "Generate" in the extension will start sending real outbound emails** if `GMAIL_MONITOR_ENABLED=true`.

---

## 9. Runtime Wiring & Lifecycle

A canonical "click in extension" flow:

```
extension popup → POST /leads/generate-candidates
  → candidateService.generateCandidates
      → nameParser, companyNormalizer, domainResolver (MX gate)
      → prisma.company.upsert
      → syncCompanyResearch (async, Gemini)
      → algorithmEnrichmentService.getAlgorithmSuggestions (Gemini + catalog)
      → ensureCompanyAlgorithms (upserts join rows)
      → prisma.lead.create
      → score + render templates → for each candidate:
            verifyEmail, checkSuppression, prisma.emailCandidate.create,
            learningService.updateAlgorithmFromVerification
      → candidateSelectionService.selectBestCandidate
      → IF selected:
            campaignService.startCampaign (creates campaign_state)
            campaignService.processCampaignQueue
                → for due campaigns: sendGmailEmail (mock or real)
                → recordEmailEvent + bounce auto-rotate on failure
                → setTimeout(0) → runBackgroundBounceChecker
            runBackgroundBounceChecker (also fired here directly)
                → up to 5×25s: pollGmailBounces + recheck DB
                → finalize winner OR discoverAlternativeCandidates
```

Meanwhile, `startCampaignScheduler` ticks every 20 s: `pollGmailBounces()` then `processCampaignQueue()`. The reentrancy guard is `isProcessingQueue` (module-level boolean).

---

## 10. Observations: Inefficient / Underutilized / Risky Components

> No code is modified. These are flagged for your review.

### 10.1 Security & Safety
- **Committed OAuth secret**: `client_secret_813864107905-…json` is present at repo root. Anyone with repo access can use it. Should be ignored and rotated.
- **No auth on `/admin/*` or `/webhooks/*`**: anyone reaching `http://localhost:4000` can list leads/events, start campaigns, simulate bounces, or inject delivery/reply events. The product plan calls out "auth for admin/API routes" as remaining work — still missing.
- **No webhook signature verification**: `POST /webhooks/email-events` accepts any payload as ground-truth, including `reply` (which halts a campaign) and `delivery` (which increments confidence).
- **Auto-send on generation**: `generateCandidates` always calls `startCampaign + processCampaignQueue`. This directly contradicts the project plan's stated "send only when user explicitly allows". Clicking "Generate" in the Chrome extension on a LinkedIn page will, if Gmail is configured, immediately send a cold email to the unverified best guess.
- **Hard-coded personal identity in templates**: name, phone (`8368858321`), and Google Drive resume link are baked into `campaignService.ts`. Not multi-tenant.
- **Single `GMAIL_MONITOR_ENABLED` flag** gates both polling and real sending. Cannot enable real sending without polling, nor monitor only.
- **`/leads/bulk-csv` global-uniqueness check**: rejects if email is already a candidate for any lead anywhere — even legitimate cross-tenant reuse.

### 10.2 Logic Bugs / Inconsistencies
- **Mismatched verifier statuses**: `selectBestCandidate.statusWeights` recognises `valid|invalid|accept_all|catch_all|risky|unknown|domain_valid`, but the codebase also writes `bounced`, `pre_verified`, `verified`, `invalid_email`. These map to weight 0 (the score still wins by other margins, but the intent is unclear).
- **Duplicate background bounce checker**: in the non-`skipBounceMonitor` initial-send path, `processCampaignQueue` already does `setTimeout(0) → runBackgroundBounceChecker`, and then `generateCandidates` (the caller) does it *again* on the same lead+candidate. Two parallel monitors race for the same `campaign_state`.
- **Followup default mismatch**: `generateCandidates` passes `followupIntervalHours: 72` (→ 4320 minutes) when auto-starting a campaign, but the UI default is `70` minutes and the DB default is `70`. The first auto-start therefore has a 3-day cadence, not 70 minutes.
- **`runBackgroundBounceChecker` after `skipBounceMonitor` sends**: when `skipBounceMonitor=true` was set in `startCampaign` (because a candidate is `pre_verified`), the queue path skips spawning the monitor, but `generateCandidates` still spawns one for the same lead immediately after. (Pre-verified candidates only come from `/leads/bulk-csv`, which doesn't call `generateCandidates`, so this only mis-fires for the *generate* path with non-pre-verified candidates — but the auto-trigger from `generateCandidates` is always fired regardless.)
- **`direct_email` algorithm**: pattern `{csv_direct}@{domain}` uses a token `csv_direct` that `renderEmailTemplate` doesn't know, so the rendered output would be `@domain`. The CSV row bypasses rendering entirely (it stores the literal email), so the broken template is never rendered — but anyone re-using that algorithm via the normal pipeline would generate junk.
- **Sloppy prompt array**: in `discoverAlternativeCandidates`, the prompt array literal has `…,,"Return shape:…"` (double comma) which inserts an `undefined` element; `.join("\n")` turns this into a blank line. Harmless, but indicates the file isn't lint-clean.
- **`syncCompanyResearch` cache cleanup race**: it deletes the in-flight promise inside `finally`, so a *second* identical request that arrives after the first one finishes but before the DB write commits could trigger a duplicate Gemini call. Low impact (the DB has a cached `researchReason` after the first write).
- **`callGeminiWithFallback`** name implies multiple model fallbacks, but the `modelsToTry` array contains only the single `env.GEMINI_MODEL`. The "fallback" loop runs exactly once.
- **`activeCandidates`-empty-check is unreachable**: the array is hard-coded to `[campaign.candidate]`, which always has length 1, so the `discoverAlternativeCandidates` branch inside the parallel-dispatch path can never fire from there.
- **`processCampaignQueue` cannot send a re-scheduled followup immediately**: when bounce auto-rotator picks a new candidate it sets `status="scheduled" followupCount=0 scheduledFor=now`. Good. But the followup branch's `targetStatus = "completed"` default is mutated only inside the `if (campaign.followupCount >= 1)` block — readable but easy to break.

### 10.3 Dead / Underutilised Code
- **Commented template** in [algorithmCatalog.ts](../src/modules/algorithmCatalog.ts) (`first_last_two`).
- **Legacy admin UI** ([admin.html](../src/public/admin.html), [admin.js](../src/public/admin.js)) — superseded by the SPA but still loaded into the bundle / served by static.
- **`status` column on `leads`** (default `"new"`) — written once at create, never read or updated by any service.
- **`headline`, `linkedinUrl`, `source` on `leads`** — captured but only displayed in admin UI; never used in selection, scoring, or learning.
- **`open` event type** in `normalizeProviderEventType` — accepted but `applyEventLearning` has no case for it; the event is logged and silently dropped.
- **`research_reason` migration column on `companies`** is consumed only by `generateInitialSubjectAndBody`, and even there it falls back to a generic sentence.
- **`AlgorithmSuggestion.source` field** is set everywhere but never read after persistence (algorithm rows store `key, patternTemplate, description, example` only; the source lineage is lost).
- **Hunter `raw` payload** is attached to the verification result but never persisted.
- **`emailThreading.test.ts`** is a smoke test that reimplements MIME building inline rather than exercising `sendGmailEmail`. The "Cold Email Followup Templates" portion of `campaignService.test.ts` similarly **copies a local stub** of `generateFollowupContent` rather than importing the real one (which is not exported). Tests pass without exercising the actual templates.

### 10.4 Efficiency / Scalability
- **N+1 queries in many places**: `generateCandidates` runs a `verifyEmail + checkSuppression + create + updateAlgorithmFromVerification` loop per candidate (typically 8–12 round trips × 4 ops). For CSV imports of 100 rows, `bulk-csv` similarly does several queries per row sequentially with no batching or transaction.
- **`admin/leads` and `admin/companies/:id` over-fetch**: include candidates + events for top-50 leads with no pagination beyond `take: 50/25`. UI then re-fetches every 5 s.
- **Polling architecture**: 20 s polling for the queue and 5 s polling for the UI. Fine for one user; not horizontally scalable (no DB-level locking, the `isProcessingQueue` guard is per-process).
- **No transactional boundary** around `startCampaign`'s find/update flow (race possible if the same lead is double-clicked).
- **Resume stored as base64 in `campaign_states.resume_path`** — wastes DB bytes (≈33% overhead) and bloats every row read of an active campaign.
- **Gmail message-id retrieval** does up to 4 sequential HTTP calls per send to fetch the `Message-ID` header, adding latency.
- **Recursive Gemini "alt patterns"** can chain: bounce → discover alt → all bounce → discover again. There is no cap on iterations or per-lead spend.

### 10.5 Documentation Drift
- README states default `GEMINI_MODEL=gemini-flash-latest`; `env.ts` defaults to `gemini-3.5-flash`. Compose/Docker comments reference Phase 6/7/8 as "planned" but Phase 6 features (campaigns, MIME sender, scheduler) are clearly *implemented* in code.
- `docs/PROJECT_PLAN.md` marks Phase 6 as "planned (backend foundation implemented, verification in progress)" yet the SPA, queue, threading, attachments, and auto-rotation are all live.

---

## 11. File Map (cheat-sheet)

```
src/
  server.ts             # boot
  app.ts                # Fastify, CORS, static, routes, scheduler
  config/env.ts         # Zod env schema
  lib/
    prisma.ts           # PrismaClient singleton
    gemini.ts           # callGeminiWithFallback (single-model retry)
  modules/              # pure helpers
    nameParser.ts
    companyNormalizer.ts
    domainResolver.ts   # +Gemini +MX
    emailTemplate.ts
    emailValidation.ts
    algorithmRanking.ts
    algorithmCatalog.ts # default 8 templates
  services/             # DB + orchestration
    candidateService.ts        # generateCandidates pipeline + alt discovery
    candidateSelectionService.ts
    algorithmEnrichmentService.ts
    emailVerifierService.ts    # local + Hunter
    learningService.ts         # verification → algorithm stats
    emailEventService.ts       # webhook ingestion + bounce auto-rotation
    suppressionService.ts
    gmailService.ts            # OAuth, poll, simulate, send (MIME), msg-id fetch
    campaignService.ts         # templates, startCampaign, processCampaignQueue, scheduler, bounce monitor
  routes/
    health.ts            # GET /health
    leads.ts             # /leads/generate-candidates, /leads/bulk-csv
    suppressions.ts      # /suppressions, /suppressions/check
    webhooks.ts          # /webhooks/email-events
    admin.ts             # /admin/* (16 endpoints)
  public/                # static front-ends
    index.html, app.js   # SPA
    admin.html, admin.js # legacy
    admin.css            # shared
  types/
    emailIntelligence.ts
prisma/
  schema.prisma
  seed.ts
  migrations/            # 7 migrations: init → campaign_states → followup_intervals → days→hours → minutes+maxFollowups → respect_timing/is_paused → research_reason → skip_bounce_monitor
extension/
  manifest.json, contentScript.js, popup.{html,js,css}, popup.css, README.md
docs/
  PROJECT_PLAN.md        # original plan (somewhat out of date)
  ARCHITECTURE.md        # this file
  KNOWLEDGE_GRAPH.md     # entity + flow graphs
docker-compose.yml       # db (port 55432) + api (profile=app)
Dockerfile               # node:24-alpine, prisma generate, npm run dev
package.json             # scripts: dev, build, test, db:*, docker:*, phase1:setup
tsconfig.json            # ES2022, NodeNext, strict
vitest.config.ts
prisma.config.ts         # tells Prisma where seed lives
client_secret_*.json     # ⚠ committed OAuth secret
```
