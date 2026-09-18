---
type: 'Page'
title: Plan
aliases: null
description: null
icon: null
createdAt: '2026-09-16T14:33:33.606Z'
lastUpdated: '2026-09-16T14:33:40.019Z'
tags: []
coverImage: null
---

## 🏗️ Phase 1: Foundation, Infrastructure & Core Security

### Task 1.1: Project Setup & Environment Configuration

-  **Action Items**:

    - Initialize NestJS project with TypeScript strict mode enabled.

    - Configure environment configuration management using NestJS Config module.

    - Set up environment validation for database URL, Redis host/port, JWT secrets, and encryption master keys.

    - Configure global exception filters, request logging interceptors, and standard response transformers.

-  **Deliverables & Criteria**:

    - Clean project directory structure.

    - Server starts reliably on configured port with environment validation.

### Task 1.2: PostgreSQL & Prisma Single-Tenant Database Setup

-  **Action Items**:

    - Initialize Prisma with PostgreSQL datasource.

    - Model single-tenant entities (Users, Domains, Mailboxes, Leads, LeadLists, Campaigns, Sequences, Variants, EmailLogs, InboundReplies, SuppressionList, AnalyticsRollups).

    - Configure database indexes on high-frequency lookup fields (email, status, message-ID, scheduled timestamps).

    - Run initial database migration.

-  **Deliverables & Criteria**:

    - Database schema generated and verified via database GUI.

    - Prisma client available across all NestJS modules.

### Task 1.3: Internal Authentication & Team RBAC Module

-  **Action Items**:

    - Implement team user registration and secure login endpoints.

    - Implement password hashing using bcrypt with secure salt rounds.

    - Configure JWT access token issuance and long-lived refresh token rotation.

    - Build authentication guards (`JwtAuthGuard`) and role-based guards (`RolesGuard`) supporting `Admin`, `Member`, and `Viewer` roles.

-  **Deliverables & Criteria**:

    - Team members can register, log in, refresh tokens, and access protected endpoints according to their role.

### Task 1.4: Credential Encryption Vault Service

-  **Action Items**:

    - Build a symmetric encryption utility service using `AES-256-GCM`.

    - Implement token/password encryption producing an encrypted payload, initialization vector (IV), and authentication tag.

    - Implement decryption logic with error handling for tampered or corrupt payloads.

    - Ensure zero credential exposure in application logs and error traces.

-  **Deliverables & Criteria**:

    - Encryption service encrypts and decrypts OAuth tokens and SMTP credentials reliably in memory.

---

## 🌐 Phase 2: Domain, Mailbox & Lead Management

### Task 2.1: Secondary Domain Management & DNS Health Checker

-  **Action Items**:

    - Create domain portfolio management endpoints (Add, List, Update redirect URL, Delete).

    - Build an automated DNS auditor using Node's asynchronous DNS resolver.

    - Check SPF (`v=spf1`), DKIM selector records (`google._domainkey`), DMARC (`_dmarc`), and MX records.

    - Validate Custom Tracking Domain (CTD) CNAME records.

    - Expose an on-demand DNS verification endpoint and a scheduled daily health audit job.

-  **Deliverables & Criteria**:

    - Domain records show real-time DNS pass/fail statuses for SPF, DKIM, DMARC, MX, and CTD.

### Task 2.2: Mailbox Connection & OAuth2 Integration

-  **Action Items**:

    - Implement OAuth2 authorization flows for Google Workspace and Microsoft 365.

    - Implement OAuth callback handler to exchange authorization codes for access and refresh tokens.

    - Store tokens in the database using the Encryption Vault service.

    - Implement custom SMTP and IMAP connection validator and credential saver.

    - Build an automatic token refresh helper to update expired access tokens before use.

-  **Deliverables & Criteria**:

    - Team can connect Google, Microsoft, or custom SMTP/IMAP inboxes without storing plaintext passwords.

### Task 2.3: Mailbox Pool, Rotation & Warm-up State Engine

-  **Action Items**:

    - Implement mailbox configuration controls (daily sending limit, warmup daily limit, min delay interval).

    - Create a mailbox state tracker (`Active`, `Warming`, `Paused`, `Auth_Failed`).

    - Implement daily sent counter reset job running at midnight UTC.

    - Implement mailbox rotation logic to evenly distribute sending volume across healthy inboxes.

-  **Deliverables & Criteria**:

    - Mailboxes transition across warmup/active states and maintain accurate daily send counts.

### Task 2.4: Lead Management & Bulk CSV Import Pipeline

-  **Action Items**:

    - Create Lead List and Lead CRUD endpoints.

    - Build a streaming CSV import parser supporting large lead files without memory bottlenecks.

    - Implement column mapping (First Name, Last Name, Email, Company, Job Title, Website, LinkedIn, City, Country).

    - Implement dynamic custom variables extraction into JSON fields (e.g., tech stack, funding stage, icebreakers).

    - Implement automatic company-wide email deduplication upon import.

-  **Deliverables & Criteria**:

    - CSV files import smoothly with custom attributes mapped and duplicates flagged.

---

## 🛡️ Phase 3: Suppression, Compliance & Lead Verification

### Task 3.1: Company-Wide Suppression & Do-Not-Contact (DNC) Engine

-  **Action Items**:

    - Build the centralized Suppression repository covering Unsubscribes, Hard Bounces, Spam Complaints, and DNC entries.

    - Implement manual and bulk DNC CSV import endpoints.

    - Implement domain wildcard matching (e.g., `@competitor.com`, `@clientdomain.com`).

    - Build an unsubscribe link generator with secure signed tokens for email footers and RFC 8058 headers.

-  **Deliverables & Criteria**:

    - Centralized suppression list operational with exact-match and domain-wildcard querying.

### Task 3.2: Pre-Send Suppression Gatekeeper Service

-  **Action Items**:

    - Create a pre-send validation service that intercepts all email preparation pipelines.

    - Check target email addresses against exact suppression records and wildcard domain rules.

    - Automatically drop suppressed emails, update lead status to `SUPPRESSED`, and log the drop event.

-  **Deliverables & Criteria**:

    - Zero emails dispatched to any address or domain present in the suppression repository.

### Task 3.3: Lead Verification Queue & External Provider Integration

-  **Action Items**:

    - Integrate with external verification APIs (MillionVerifier or Bouncer).

    - Create a background verification queue using BullMQ for batch processing.

    - Update lead verification statuses (`Valid`, `Risky`, `Invalid`, `Disposable`, `Catch-All`).

    - Automatically push `Invalid` and `Disposable` emails directly to the Suppression repository.

-  **Deliverables & Criteria**:

    - Bulk lead lists verified asynchronously in the background with invalid leads quarantined.

---

## ✍️ Phase 4: Campaign, Sequence & Spintax Engine

### Task 4.1: Campaign Builder & Configuration Module

-  **Action Items**:

    - Build Campaign CRUD endpoints (Title, Status: `Draft`, `Active`, `Paused`, `Completed`).

    - Configure campaign sending settings: Target Timezone, Daily Sending Window (Start/End time), Active Days (e.g., Mon–Fri), and Max New Leads per day.

    - Implement mailbox pool attachment (assigning one or more inboxes to a campaign).

    - Implement lead list attachment to campaigns.

-  **Deliverables & Criteria**:

    - Team can configure campaigns with customized schedules, assigned mailboxes, and lead lists.

### Task 4.2: Multi-Step Sequence & A/B Testing Variant Manager

-  **Action Items**:

    - Build sequence step manager supporting ordered steps (Step 1, Step 2, Step 3, Step 4).

    - Configure inter-step delays (Days and Hours after previous step delivery).

    - Implement multi-variant support per step (Variant A, Variant B) with percentage distribution weights for A/B testing.

-  **Deliverables & Criteria**:

    - Sequences support multi-stage follow-ups with weighted A/B copy variations.

### Task 4.3: Spintax & Dynamic Variable Personalization Parser

-  **Action Items**:

    - Build a recursive Spintax parser supporting nested syntax options: `{Hi|Hello|Hey}`.

    - Build a variable interpolation engine mapping standard fields (`{{firstName}}`, `{{companyName}}`) and custom attributes (`{{customVariables.techStack}}`).

    - Implement fallback defaults for missing lead variables.

-  **Deliverables & Criteria**:

    - Dynamic templates render unique, personalized copy with random Spintax variations per prospect.

---

## ⏱️ Phase 5: Scheduling, Rate Limiting & Email Dispatcher

### Task 5.1: Timezone-Aware Campaign Scheduler

-  **Action Items**:

    - Build a recurring scheduler job running on a short interval (e.g., every 2–5 minutes).

    - Identify all active campaigns and query eligible leads whose `nextScheduledAt` is due.

    - Verify that the current time falls within the campaign's allowed timezone, working hours, and active days.

    - Automatically defer leads to the next available window if outside sending hours.

-  **Deliverables & Criteria**:

    - Scheduler accurately selects leads ready for dispatch strictly within permitted working hours.

### Task 5.2: Multi-Tier Rate Limiting & Jitter Engine

-  **Action Items**:

    - Validate candidate mailboxes against daily sending caps and warmup stage limits.

    - Rotate across healthy mailboxes assigned to the campaign.

    - Calculate a randomized jitter delay (e.g., 60 to 180 seconds) between consecutive sends from the same mailbox.

    - Respect campaign-level daily maximum new lead limits.

-  **Deliverables & Criteria**:

    - Outgoing email jobs throttled with realistic human-like intervals across multiple inboxes.

### Task 5.3: Email Dispatch Queue & Provider Adapters

-  **Action Items**:

    - Create the primary `email-dispatch-queue` using BullMQ.

    - Build mail provider dispatch adapters:

        - Google Workspace (Gmail API via OAuth).

        - Microsoft 365 (Microsoft Graph API via OAuth).

        - Custom SMTP (Nodemailer relay).

    - Inject unique RFC 2822 `Message-ID` headers and threading headers (`In-Reply-To`, `References`) for follow-up steps.

    - Implement exponential backoff retry logic for transient provider errors (e.g., HTTP 429).

-  **Deliverables & Criteria**:

    - Emails dispatched smoothly through the appropriate provider with full delivery logs created.

### Task 5.4: Custom Tracking Domain, Pixel & Link Proxy

-  **Action Items**:

    - Build tracking controller endpoints for opens and clicks over custom CNAME domains.

    - **Open Tracking**: Inject 1x1 transparent PNG pixel (`GET /tracking/open/:logId`), updating `openedAt` and `openCount` with `no-cache` headers.

    - **Click Tracking**: Rewrite sequence links to proxy endpoint (`GET /tracking/click/:logId?url=...`), logging click timestamp and issuing a 302 redirect.

    - Provide campaign-level toggles to enable/disable open or click tracking.

-  **Deliverables & Criteria**:

    - Opens and clicks tracked accurately without triggering spam filters on generic tracking domains.

---

## 📥 Phase 6: Inbound Unibox, Bounce Handling & Circuit Breaker

### Task 6.1: Inbound Mail Sync & Thread Correlation

-  **Action Items**:

    - Build an asynchronous IMAP synchronization worker for connected mailboxes.

    - Parse inbound message headers, matching `In-Reply-To` and `References` against outbound `EmailLog.messageId`.

    - Match sender email to the active lead record.

    - Transition lead status to `REPLIED` and automatically halt all pending follow-up steps.

    - Store inbound reply in the database for the unified inbox.

-  **Deliverables & Criteria**:

    - Inbound replies detected in real time, stopping follow-ups instantly and linking to the conversation thread.

### Task 6.2: Automated Bounce Parser & Failure Handler

-  **Action Items**:

    - Parse inbound Delivery Status Notifications (DSNs) and Non-Delivery Reports (NDRs).

    - Classify bounce events into:

        - **Hard Bounce (5xx codes)**: Mark lead as `BOUNCED`, cancel sequence, and push email immediately to Suppression.

        - **Soft Bounce (4xx codes)**: Mark lead as `SOFT_BOUNCED`, allow up to 2 retry attempts with exponential backoff before marking `FAILED`.

    - Handle pre-send provider rejections and update lead failure state.

-  **Deliverables & Criteria**:

    - Bounces classified accurately with hard bounces automatically quarantined in the suppression list.

### Task 6.3: Campaign Safety Circuit Breaker

-  **Action Items**:

    - Implement a rolling 24-hour bounce rate monitoring service per campaign.

    - If a campaign's bounce rate exceeds 3%, automatically transition campaign status to `PAUSED`.

    - Trigger an urgent in-app notification and email alert to the admin team detailing the pause reason.

-  **Deliverables & Criteria**:

    - Campaigns auto-pause immediately upon high bounce spikes, protecting domain health.

### Task 6.4: Centralized Unibox Management

-  **Action Items**:

    - Build Unibox API endpoints to retrieve, filter, and paginate conversation threads across all company inboxes.

    - Implement reply categorization (Interested, Follow-up Later, Not Interested, Out of Office, Unsubscribe).

    - Build a direct manual reply sender endpoint from inside the Unibox using the original thread headers.

-  **Deliverables & Criteria**:

    - Team can view and reply to all inbound prospect responses from a single unified hub.

---

## 📊 Phase 7: Analytics, Telemetry & Reporting Engine

### Task 7.1: Full-Funnel Metric Aggregation Engine

-  **Action Items**:

    - Build telemetry aggregation jobs summarizing events:

        - Sent, Delivered, Failed, Bounced (Hard/Soft), Opened, Clicked, Replied, Positive Replies, Unsubscribed.

    - Implement daily rollup cron jobs writing pre-computed statistics to summary tables for instant dashboard loading.

-  **Deliverables & Criteria**:

    - Metrics aggregated reliably across all funnel stages without expensive ad-hoc table scans.

### Task 7.2: Campaign & Sequence Performance Reporting

-  **Action Items**:

    - Create Campaign Performance endpoints showing conversion rates, deliverability health, and funnel drop-offs.

    - Build Step-by-Step breakdown reports showing performance per sequence step (Step 1 vs Step 2 vs Step 3).

    - Build A/B Variant comparison reports showing open, click, and reply rates for Variant A vs Variant B.

-  **Deliverables & Criteria**:

    - Team can evaluate exact campaign ROI, drop-off stages, and winning A/B copy variants.

### Task 7.3: Mailbox & Domain Health Dashboard

-  **Action Items**:

    - Build Mailbox & Domain Health endpoints displaying daily volume utilization, deliverability score, bounce percentage, and warmup trajectory.

    - Flag any mailbox approaching daily limits or showing elevated bounce rates.

-  **Deliverables & Criteria**:

    - Real-time visibility into the health and reputation of all sending domains and inboxes.

