# Spec: Email channel and Social leads channel

|                |                                                                                                                                                                                                                                      |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Status**     | Draft for owner review                                                                                                                                                                                                               |
| **Author**     | Drafted with Claude Code from the owner's brief and a read-only survey of the repo (13 Oct 2026 tree)                                                                                                                                |
| **References** | Bigin by Zoho, Settings > Channels > Email and Settings > Channels > Social > Ads (owner screenshots). Used as inspiration for the shape of the screens, not as a template to copy.                                                  |
| **Related**    | `docs/threadwise-port/plan-inbox-chat.md`, `docs/api/whatsapp-providers.md` (admin-configurable provider precedent), `docs/runbooks/google-calendar-setup.md` (OAuth precedent), `docs/threadwise-port/parity/product-extensions.md` |

Two features, one spec, because they share the same Settings > Channels home, the same "operator configures the platform, workspace admin connects the account" pattern, and the same inbox and CRM plumbing. They ship independently (see [Phasing](#8-phased-delivery-plan)).

---

## 1. Problem statement

**Email.** Small businesses run support and sales out of a shared mailbox (support@, sales@) and individual inboxes. Today our team inbox handles WhatsApp, Telegram, Facebook, Instagram and web chat, but not email, so an agent has to leave the product to answer a customer who wrote by email, and the conversation is invisible to the CRM, to assignment and to reporting. Competing bundled tools (Bigin, Freshdesk, Zoho Desk, HubSpot) all offer "connect Gmail, Microsoft 365, Outlook or any IMAP mailbox". Reference itself only bridges to an external product (MailTrixy), which we do not want to depend on.

**Social leads.** Paid social campaigns produce leads inside the ad platform's own lead forms (Meta, LinkedIn, TikTok). Owners export CSVs or copy leads by hand, so first contact happens hours or days late and the source of each lead is lost. Bigin solves this with a LeadChain connector behind a "Setup Now" button. We have no lead-ad ingestion at all: the Facebook module has no `leadgen` subscription, the Meta Ads and forms domains are schema-only, and the one public lead endpoint (`POST /public/v1/leads`) needs API-key plus HMAC auth that Zapier-style senders cannot easily call.

**Cost of not solving.** Customers who write by email are answered slower or not tracked; ad spend is wasted on leads that are contacted late; the "one bundled tool" promise to small businesses has two visible holes.

## 2. Goals

1. A workspace can connect a **shared support mailbox** in under 5 minutes and answer customers from the unified inbox, with replies leaving from that address and staying in one email thread.
2. A workspace can optionally let **each agent connect a personal mailbox**, with clear privacy rules (an agent's personal mail is not visible to colleagues).
3. New leads from **Meta lead forms (Facebook and Instagram placements)** and from **any tool that can send a webhook** appear as CRM contacts (and optionally deals) within one minute, deduplicated, with source attribution and an owner assigned.
4. The platform operator controls, from the admin console, which providers exist and their credentials (Google, Microsoft, Meta, TikTok, LinkedIn), the same way the WhatsApp provider registry works. Workspace admins never see platform secrets.
5. Nothing weakens tenant isolation or secret handling: all credentials sealed, write-only in the UI, every table under forced RLS.

**Success looks like** (targets in [section 7](#7-success-metrics)): setup completion, speed-to-first-response on email, speed-to-first-contact on leads, share of leads with attribution.

## 3. Non-goals

| Not in scope (v1)                                                                                                       | Why                                                                                                                        |
| ----------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| Email marketing or bulk email campaigns, open/click tracking                                                            | A separate product area (the old "Email Broadcast" phase plan). Support inbox first.                                       |
| Being an email service provider (sub-accounts, domain verification, sending on behalf of customers through our own MTA) | The legacy audit lists it, but it is a compliance and deliverability business. We send through the customer's own mailbox. |
| Zoho Mail as a connect option                                                                                           | Explicitly excluded by the owner.                                                                                          |
| Calendar-from-email, email parsing into tasks or deals ("Signals" in Bigin)                                             | Possible later on top of the thread model.                                                                                 |
| Native LinkedIn, TikTok and Google Ads connectors in the first release                                                  | Each needs partner or app approval with long lead times. Covered in v1 by the generic webhook; native in a later phase.    |
| X (Twitter) Profile tab                                                                                                 | The API is paid and the value for lead capture is low. Parked.                                                             |
| Ad creation or campaign management (the `meta-ads` domain)                                                              | Lead ingestion only. Campaign sync and ROI reporting come later.                                                           |
| Replacing the existing WhatsApp click-to-chat referral attribution                                                      | Reused as one more attribution source, not changed.                                                                        |

---

## 4. Users and user stories

Personas: **Workspace admin** (owner of a small business, sets things up), **Agent** (answers customers), **Sales rep** (works leads), **Platform operator** (our staff, console).

### Email

1. As a **workspace admin**, I want to connect our support@ Gmail or Microsoft 365 mailbox with a sign-in popup, so that my team can answer email without sharing a password.
2. As a **workspace admin** with a hosting-provider mailbox, I want to connect any mailbox with IMAP/SMTP details, so that I am not forced onto Google or Microsoft.
3. As a **workspace admin**, I want to choose whether a mailbox is **shared with the team** or **personal to one agent**, so that private mail stays private.
4. As an **agent**, I want customer emails to appear in the inbox as conversations I can assign, note, tag, snooze and resolve like any other channel.
5. As an **agent**, I want my reply to leave from the mailbox the customer wrote to (or my own address on a personal mailbox) with the right subject, cc and threading, so that the customer sees one continuous thread in their mail app.
6. As an **agent**, I want my signature, saved replies and attachments available when I reply.
7. As a **workspace admin**, I want to see when a mailbox stops working (token revoked, password changed) and reconnect it with one click, so that mail is not silently lost.
8. As a **platform operator**, I want to enable providers and enter the Google and Microsoft app credentials once for the whole platform, so that workspace admins can connect without any developer setup.

### Social leads

9. As a **workspace admin** running Facebook or Instagram lead ads, I want to connect my Page and pick the lead forms to sync, so that every new lead lands in the CRM automatically.
10. As a **workspace admin**, I want to map each form question to a contact field (name, email, phone, a custom field) once, so that leads arrive clean.
11. As a **sales rep**, I want a new lead to be assigned to me (or to the next rep in line), to notify me instantly, and to start a deal in the right pipeline stage, so that I can call within minutes.
12. As a **sales rep**, I want to see where each contact came from (platform, campaign, ad, form) on the contact, so that I know what to say and what to measure.
13. As a **workspace admin** using LinkedIn, TikTok, Google Ads or a landing-page tool, I want a webhook URL with a copyable token and a Zapier/Make template, so that I can connect it without a developer.
14. As a **workspace admin**, I want repeat submissions from the same person to update the existing contact instead of creating duplicates.
15. As a **platform operator**, I want to switch a lead source on or off for all workspaces, and enter its app credentials, from the console.

---

## 5. Product decisions

These resolve the owner's open questions. Each has a recommendation; the ones that need the owner's final word are repeated in [section 9](#9-open-questions).

### 5.1 Shared mailbox or every agent's own? Support both, default to shared

|                    | Shared team mailbox (support@)                                                     | Personal mailbox (one agent)                                  |
| ------------------ | ---------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| Who connects       | Workspace admin                                                                    | Any agent with permission, for themselves                     |
| Visibility         | Everyone with inbox access, subject to existing scope rules (`all`, `team`, `own`) | The owner, plus admins only if the workspace policy allows it |
| Replies leave from | The mailbox address                                                                | The agent's own address                                       |
| Typical use        | Support, sales inquiries                                                           | Account managers who want customer mail in the CRM            |
| Plan limit         | Counts toward `email_mailboxes`                                                    | Counts too                                                    |

**Recommendation:** ship shared mailboxes first (P0), because that is what a small team needs and it needs no new visibility rule. Design the data model so a mailbox has `scope = shared | personal` and an `owner_user_id` from day one, then ship personal mailboxes (P1) once the channel-level visibility rule below exists. Today visibility is decided only by who the conversation is assigned to (`visibility-sql.ts`); a personal mailbox needs a "channel owner" predicate added in both the SQL visibility and the realtime `conversationVisible` check, kept in step.

### 5.2 Thread model: one conversation per email thread

The inbox today keeps **one perpetual conversation per (channel, contact)**, which is right for chat and wrong for email, where each subject is its own thread and a closed ticket should not be reopened by an unrelated message.

**Recommendation:** one conversation per **email thread** (resolved from `Message-ID`, `In-Reply-To` and `References`, falling back to normalised subject plus sender within a window). The conversation's peer key becomes a stable thread key instead of the sender address; the **contact is linked by the sender's email** through `contact_identities` (the contact service already supports email identities; only `identityOfPeer` blocks it). A new reply on a resolved thread reopens it; a new subject opens a new conversation.

### 5.3 Message shape

The message contract has no subject, cc, bcc, HTML body, message-id or multi-attachment support, and bodies are capped at 4096 characters. Email needs:

- an `email` block in message `meta` (subject, from, to, cc, bcc, message-id, in-reply-to, references), added to the `CHANNEL_META_KEYS` allow-list;
- a plain-text body for search and previews, and a **sanitised HTML** body stored alongside it (Reference caps this at 64 KB; we do the same and link "view full message" beyond it; `sanitize-html` is already a dependency);
- attachments as separate stored files linked to the message (the message row has a single `media_key` today, so either one message per attachment or a small attachments table; decide in design, see open questions);
- an email variant of the outbound envelope (subject, cc, bcc, html, attachments, thread headers).

### 5.4 Providers

| Provider                              | Connection                                               | Inbound                                            | Outbound       | Notes                                                                                                                                                    |
| ------------------------------------- | -------------------------------------------------------- | -------------------------------------------------- | -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Google (Gmail / Google Workspace)** | OAuth 2.0 popup                                          | Gmail API history polling (push via Pub/Sub later) | Gmail API send | Needs the Gmail **restricted scope**; Google's app verification and a security assessment are required for public launch. This is the longest-lead item. |
| **Microsoft 365 / Outlook.com**       | OAuth 2.0 (Microsoft identity platform)                  | Graph delta polling (change notifications later)   | Graph send     | App registration and publisher verification. No Microsoft code exists in the repo today.                                                                 |
| **Other mail (IMAP + SMTP)**          | Host, port, security, username, password or app password | IMAP polling (IDLE where available)                | SMTP           | Works with any host and needs **no vendor approval**, so it ships first. Unlocks Gmail users through an app password in the interim.                     |
| ~~Zoho Mail~~                         |                                                          |                                                    |                | Excluded by the owner.                                                                                                                                   |

**Admin-configurable like the WhatsApp provider registry.** The operator console has an "Email providers" page: enable or disable Google, Microsoft and IMAP, enter the OAuth client id and sealed client secret (a console settings group with environment fallback, exactly as `googleCalendar` and `whatsapp` work today), see a status and a test button. Workspace admins only see "Connect" for providers that are enabled and configured. A provider that is off for the platform shows "Ask your platform administrator" rather than a broken button.

### 5.5 Social leads: one pipeline, several doors

The Bigin screenshot hides the work behind a third-party connector. We split it in two:

- **A native lead pipeline** (the same for every source): receive -> store the raw event (idempotent) -> normalise -> map fields -> deduplicate -> create or update the contact with attribution -> optionally create a deal -> assign -> notify -> optionally trigger an automation.
- **Doors into it:** the generic webhook (P0, covers LinkedIn, TikTok, Google Ads and any landing-page tool through Zapier, Make or native webhooks), **Meta Lead Ads** (P0, reusing the Facebook Page connection and the shared Meta app), then native **TikTok** and **LinkedIn** connectors (P1, after their approvals) and **X profile** (parked).

**Recommendation on the LeadChain approach:** do not depend on a third-party aggregator in v1; build Meta natively (highest volume for our users, and the Page connection already exists) plus the generic webhook, and revisit an aggregator only if native TikTok/LinkedIn approvals stall. This is a build-versus-buy question for the owner, listed in [section 9](#9-open-questions).

**Instagram lead ads** are served by the Facebook Page lead-form webhook (Instagram placements use Facebook lead forms), so no separate Instagram integration is needed. (The Instagram channel in this repo runs through an external bridge and has no native Meta path.)

### 5.6 Where it lives in the product

- **Settings > Channels > Email** replaces the planned "Soon" tile (`email`, route `/email`). Tabs, modelled on Bigin and trimmed to what we build: **Connect** (provider cards: Gmail, Microsoft 365, Outlook, Other mail), **Organization emails** (shared mailboxes with their default assignee/team), **Email sharing** (who may connect personal mailboxes, whether admins may see them, send-as rules), **Signatures and templates**, **Health** (sync status, last error, deliverability tips). P0 ships Connect and Organization emails; the rest follow.
- **Settings > Channels > Social leads** (new tile `lead-sources`, route `/lead-sources`), tabs: **Ads** (provider cards: Meta lead forms, LinkedIn, TikTok, Google Ads, Webhook), **Webhook** (token, URL, sample payload, test event, recent events), **Rules** (mapping defaults, deal pipeline/stage, assignment, notifications), **X profile** (hidden until built).
- Both tiles use `shortcutFrom` so the gear appears on the inbox (email) and on contacts and deals (leads) for roles that may manage them.

---

## 6. Requirements

### 6.1 Email channel

#### P0 (cannot ship without)

**E-01 Email channel kind.** `email` is a first-class channel kind in the inbox (adapter, capability set with no 24-hour window and no template concept, badge in the conversation list and thread, filter in the channel dropdown).

- Given a connected mailbox, when a customer emails it, then a conversation appears in the inbox tagged with the email channel within the poll interval.
- Given an email conversation, then it supports assign, note, tag, priority, snooze, resolve like any channel.

**E-02 Connect an IMAP/SMTP mailbox (shared).** An admin enters host, port, security (SSL/TLS/STARTTLS), username and password; the system verifies IMAP login and SMTP auth before saving.

- Given wrong credentials, then nothing is saved and the error says which of IMAP or SMTP failed and why.
- Given correct credentials, then the mailbox is saved with credentials **sealed** (never returned by the API, only "set, ends in ####") and an initial backfill of the last 7 days is queued as quiet history (no notifications).

**E-03 Inbound sync.** A worker polls each active mailbox on a schedule, parses MIME (text, HTML, attachments, inline images), and ingests through the existing idempotent ingest (ledger key = `Message-ID`).

- Given the same email delivered twice or re-read, then exactly one message exists.
- Given an email with attachments up to the size cap, then they are stored and downloadable; over the cap, then the message shows a "attachment too large" note instead of failing.
- Given a mailbox outage, then the channel shows `error` with the reason and retries with backoff; messages are not lost when it recovers.

**E-04 Threading.** Conversations follow email threads as described in 5.2.

- Given a reply to an existing thread (matching `In-Reply-To`/`References`), then it lands in that conversation, and reopens it if it was resolved.
- Given a new subject from the same sender, then a new conversation is created and linked to the same contact.

**E-05 Contact linking.** The sender is matched to a contact by email identity, or created (respecting the plan's contact quota: on quota reached the message is still stored, linked to no contact, and flagged).

**E-06 Reply from the inbox.** The composer on an email conversation supports rich text, cc and bcc, attachments, and sends through the mailbox's SMTP (or provider API); subject is `Re: ...`, headers carry `In-Reply-To` and `References`.

- Given a shared mailbox, then the message leaves from the mailbox address with the agent's display name.
- Given a send failure, then the message shows `failed` with the reason and a retry; an accepted send is idempotent on the client reference and the generated `Message-ID` (a retry never sends twice).

**E-07 Connect Google and Microsoft by OAuth.** Admin presses Connect, signs in, picks the mailbox; refresh token stored sealed; `invalid_grant` / revoked access marks the channel `needs_reauth` and surfaces a Reconnect action (the same handling the Google Calendar adapter uses).

- Gated by operator enablement and configured credentials (5.4).
- Given the platform has no Google credentials, then the card says who must configure it.

**E-08 Operator console.** "Email providers" page: enable per provider, client id, sealed client secret, redirect URI, test.

**E-09 Permissions and plan.** New permission keys `mail.mailboxes.read` and `mail.mailboxes.manage` (admin role granted by migration, per the repo's permission skill); replying reuses `inbox.conversation.reply`. A plan feature `channel_email` and a limit `email_mailboxes`; over limit shows the upgrade lock.

**E-10 Security.** Credentials and tokens sealed with the existing vault; OAuth `state` signed and bound to org and user; HTML sanitised before storage and display (no scripts, remote images blocked by default with a "load images" action); inbound size and rate limits; audit rows and outbox events for connect, disconnect and reconnect; forced RLS and composite FKs on every new table.

**E-11 Mailbox health.** Channel health shows last successful sync, last error, queue lag; the settings screen shows the same.

#### P1 (fast follow)

- **E-12 Personal mailboxes** with the channel-owner visibility rule (5.1), an "Email sharing" policy tab (who may connect, whether admins can see), and send-as rules.
- **E-13 Signatures** per mailbox and per agent, inserted automatically, with a variable set (name, title, phone).
- **E-14 Saved replies and the email templates feature** usable in the composer (the planned `email-templates` nav item); variable substitution from the contact.
- **E-15 Default routing for a mailbox:** default assignee or team, optional auto-assign (depends on the routing engine, which today is manual only).
- **E-16 SLA:** first-response and resolution clocks on email conversations (depends on the SLA engine, tables exist but the engine is not built).
- **E-17 Gmail push / Graph change notifications** to replace polling and cut latency from minutes to seconds.
- **E-18 Bounce and "undeliverable" detection** shown on the message; **auto-reply and out-of-office detection** so they do not open tickets.
- **E-19 Contact timeline:** emails appear on the contact's activity timeline.

#### P2 (design for, do not build now)

- Email aliases ("send as support@, sales@") and multiple signatures per alias; shared-inbox delegation; email-to-deal rules; read receipts; scheduled send; undo send; per-mailbox business hours; analytics (first response time by mailbox).

### 6.2 Social leads channel

#### P0

**L-01 Lead pipeline core.** A service that accepts a normalised lead (`source`, `external_id`, `received_at`, `fields{}`, `attribution{platform, campaign, adset, ad, form}`, `raw`), and is the only writer of lead-originated contacts.

- Given the same `(source, external_id)` twice, then the second is ignored (unique key, as in the lead-finder precedent).
- Given a lead with neither a usable email nor a phone, then it is stored as "needs review", not discarded and not turned into an empty contact.

**L-02 Contact creation and dedupe.** Uses the existing identity-first resolver (`resolveOrCreateByIdentity` by email or phone, then normalised matches), applies the workspace's default lifecycle stage, and **updates** an existing contact rather than duplicating.

- Given a lead whose phone matches an existing contact, then that contact is updated (new source added to its history, no duplicate).
- Given the plan's contact quota is reached, then the lead is stored and shown in "Needs attention" with an upgrade prompt; nothing is silently dropped.

**L-03 Source attribution.** Today `contacts.source` is a free-text column. Add structured attribution on the contact (first-touch and latest-touch: platform, campaign, ad set, ad, form, captured at) so it can be shown, filtered and reported. Existing free-text `source` keeps working and is filled with the platform label.

**L-04 Generic webhook door.** Per workspace, one or more webhook endpoints (`POST /v2/public/lead-hooks/:token`, token shown once, only its hash stored, rotatable) that accept JSON and form-encoded bodies, with an optional shared-secret header. A sample-payload tester shows how the incoming fields map. (The ported `incoming_webhooks` and `incoming_webhook_events` tables are the natural home; Reference's `/hooks/in/{token}` is the behavioural reference.)

- Given any sender that can POST, then no API key or HMAC is required, only the token.
- Given abuse, then per-token and per-IP rate limits apply and the response never reveals whether a contact existed.

**L-05 Field mapping.** Per source (and per Meta form), the admin maps incoming fields to contact fields and custom fields, with sensible defaults (`full_name`, `email`, `phone_number`), phone normalisation with a workspace default country code, and a preview using the last real payload.

**L-06 Meta Lead Ads door.** Using the existing Facebook Page connection and shared Meta app: subscribe the Page to `leadgen`, receive the webhook (signature-verified like the existing Facebook webhook), fetch the lead by id, list forms for the form picker, and ingest through L-01.

- Requires adding the leads permission scopes and re-consent for already-connected Pages: pages connected before this feature show "Grant lead access" rather than silently failing.
- A **reconciliation sweep** re-reads recent leads from the Page so a missed webhook never loses a lead (Meta keeps leads about 90 days).
- Given a lead-ads form on an Instagram placement, then it arrives through the same Page webhook.

**L-07 Assignment.** Each source or form picks an owner rule: a fixed user, a team round-robin, or "unassigned". (Contacts and deals have no auto-assignment today; this adds the minimum needed, reusing the inbox assignment design where possible.)

**L-08 Deal creation (optional per source).** Choose a pipeline and stage; a deal is created with a new deal source value `lead_ad` (the existing list has `form` reserved but not the ad case), linked to the contact, owned by the assignee.

**L-09 Notification.** New notification type `new_lead` (Reference has the equivalent) to the assignee and, optionally, the admin, in-app and via the existing notification consumers, deduplicated on the lead id.

**L-10 Automation hook.** Lead creation emits the existing `contact.created` event with the lead source in the payload, so flows (the flow runtime is in progress on another branch) and auto-replies can react; no new automation engine here.

**L-11 Settings UI.** The Social leads screen as in 5.6 with provider cards, per-source status, last event time, recent events with accept/ignore reason, and a "send test lead" button.

**L-12 Permissions, plan, operator.** Keys `leads.sources.read` and `leads.sources.manage`; plan feature `lead_sources` and limit `lead_sources`; operator console toggles and credentials for each provider (Meta app already exists; TikTok and LinkedIn credentials added when those doors are built). Raw payloads retained for a limited period (default 30 days) then purged; PII access audited.

#### P1

- **L-13 TikTok Lead Generation** native connector (OAuth plus webhook or polling), once the TikTok app is approved. Reference's TikTok lead webhook is a reference, but its payload shape was flagged unverified there, so verify against current docs.
- **L-14 LinkedIn Lead Gen Forms** native connector (Marketing API access is partner-gated; until then LinkedIn uses the webhook door through Zapier/Make).
- **L-15 Google Ads lead form extensions** through the webhook door template, native later.
- **L-16 Speed-to-lead:** optional automatic first message (WhatsApp template or email) on new lead, using existing send paths and quota rules.
- **L-17 Lead inbox view:** a list of recent lead events with status (created, updated, duplicate, needs review, failed) and one-click retry.
- **L-18 Backfill on connect** (last N days) and a manual "sync now".
- **L-19 Zapier/Make ready-made templates** and a documented sample payload in the docs.

#### P2

- X (Twitter) profile tab; campaign and ad name enrichment from the future `meta-ads` sync (ROI per campaign); offline conversion upload back to Meta (CAPI) for optimisation; lead scoring from ad signals; duplicate-merge suggestions across sources; per-source cost tracking.

---

## 7. Success metrics

**Email**

| Type    | Metric                                                                    | Target (first 60 days after P0)                                          |
| ------- | ------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| Leading | Setup completion: admins who start Connect and end with a working mailbox | >= 80% (IMAP), >= 90% (OAuth)                                            |
| Leading | Median time from "Connect" to first synced email                          | < 5 minutes                                                              |
| Leading | Share of inbound emails ingested within the sync interval                 | >= 99%                                                                   |
| Leading | Duplicate or lost messages (reconciled against a test mailbox)            | 0                                                                        |
| Lagging | Workspaces using email as an active channel (>= 20 emails a week)         | 25% of active workspaces                                                 |
| Lagging | Median first response time on email conversations                         | Better than on the customer's previous setup (baseline gathered in beta) |
| Lagging | Support tickets about "email not syncing"                                 | < 2 per 100 mailboxes a month                                            |

**Social leads**

| Type    | Metric                                                                          | Target                                                           |
| ------- | ------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| Leading | Median time from lead submission to contact in CRM                              | < 1 minute (webhook), < 5 minutes worst case with reconciliation |
| Leading | Lead capture success rate (events received vs leads created or deduplicated)    | >= 99.5%                                                         |
| Leading | Share of lead-created contacts with full attribution (platform, campaign, form) | >= 90% for Meta, 100% for webhook when fields are sent           |
| Leading | Duplicate contacts created from repeat leads                                    | < 1%                                                             |
| Lagging | Workspaces with at least one lead source connected                              | 30% of workspaces running ads                                    |
| Lagging | Median time from lead to first contact by a rep                                 | Down 50% versus pre-connector (beta baseline)                    |
| Lagging | Lead-to-deal conversion visible per source                                      | Reported in the contacts and deals views                         |

Measurement: product analytics events on connect funnels, plus a nightly reconciliation job comparing provider counts with ingested counts. Evaluate at 2 weeks, 8 weeks and one quarter.

---

## 8. Phased delivery plan

Sizes are rough (S = days, M = 1-2 weeks, L = 3-5 weeks, XL = longer); they assume the existing domains stay as they are.

| Phase                                                           | Scope                                                                                                                                                                                                                                                                                                                                                                                                                                                           | Size                                   | Depends on                  |
| --------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------- | --------------------------- |
| **0. Foundations**                                              | Inventory entries and wiring maps (the `mail` domain has a zone but no inventory page yet); decisions in section 9; contract changes: `email` channel kind, `meta.email` allow-list, thread peer key, `DEAL_SOURCES` `lead_ad`, `new_lead` notification type; permission and plan-key migrations; rows in `product-extensions.md` (both features are owner-requested deviations: Reference email is an external bridge and Reference has no lead-ads ingestion) | M                                      | none                        |
| **L1. Lead pipeline + webhook**                                 | L-01..L-05, L-07..L-12 with the generic webhook door                                                                                                                                                                                                                                                                                                                                                                                                            | L                                      | Phase 0                     |
| **E1. Shared mailbox over IMAP/SMTP**                           | E-01..E-06, E-08..E-11 (provider list shows Google/Microsoft as "coming" until E2)                                                                                                                                                                                                                                                                                                                                                                              | XL                                     | Phase 0                     |
| **L2. Meta lead ads**                                           | L-06, reconciliation, re-consent for existing Pages, Meta app review submission                                                                                                                                                                                                                                                                                                                                                                                 | L (review time is outside our control) | L1, Facebook module         |
| **E2. Google and Microsoft OAuth**                              | E-07 for both providers; Google verification and security assessment started at the beginning of E1 because it is the long pole                                                                                                                                                                                                                                                                                                                                 | L plus approval wait                   | E1                          |
| **E3. Personal mailboxes, signatures, templates, routing, SLA** | E-12..E-16                                                                                                                                                                                                                                                                                                                                                                                                                                                      | L                                      | E1; the routing/SLA engines |
| **L3. TikTok, LinkedIn native, speed-to-lead, lead inbox**      | L-13..L-19                                                                                                                                                                                                                                                                                                                                                                                                                                                      | L                                      | L1 and provider approvals   |
| **E4. Push sync, bounces, timeline**                            | E-17..E-19                                                                                                                                                                                                                                                                                                                                                                                                                                                      | M                                      | E2                          |

**Suggested order:** Phase 0, then L1 and E1 in parallel (different people, different areas), L2 as soon as L1 lands, E2 as approvals arrive. Start the Google and Meta review paperwork in week 1 so approval time overlaps development.

**Hard dependencies and watch items**

- Google restricted-scope verification (and the security assessment it can trigger) for Gmail; Meta app review for lead retrieval; Microsoft publisher verification; TikTok and LinkedIn partner access.
- The routing and SLA engines are not built (tables exist only); E-15 and E-16 wait for them, or ship a thin default assignee in the meantime.
- The flow runtime is being built on another branch; L-10 relies only on the existing `contact.created` event so it does not block on it.
- The repo's rules: every feature gets its Reference parity run where Reference has an equivalent (it has none for lead ads and only the MailTrixy bridge for email), so deviations are recorded rather than compared.

---

## 9. Open questions

**Blocking (answer before Phase 0 closes)**

| #   | Question                                                                                                                                                                                                                                                          | Owner                |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------- |
| 1   | **Visibility policy for personal mailboxes:** can workspace admins read an agent's personal mailbox by default, never, or only if the workspace turns it on? (Recommendation: never by default; a workspace-level switch.)                                        | Product / owner      |
| 2   | **Thread model:** confirm one conversation per email thread (5.2) rather than one perpetual thread per sender like chat. (Recommendation: per thread.)                                                                                                            | Product, Engineering |
| 3   | **Google verification:** are we willing to take on Google's restricted-scope verification and security assessment for Gmail, or launch Google via IMAP with an app password first and OAuth later? (Recommendation: start the assessment now, launch IMAP first.) | Owner, Legal         |
| 4   | **Lead sources build-versus-buy:** native Meta plus generic webhook, with TikTok and LinkedIn later (recommended), or a third-party aggregator like Bigin's LeadChain from day one?                                                                               | Owner                |
| 5   | **Who owns the work:** the `mail` domain is assigned to Punya and the integrations domain to Lakshya in `ownership.json`; lead sources span the `facebook`, `integrations` and CRM areas. Confirm owners and zones before building.                               | Team                 |

**Non-blocking**

| #   | Question                                                                                                                                                                                     | Owner       |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------- |
| 6   | Attachments: one stored file per attachment in a small attachments table, or one message per attachment? (Recommendation: attachments table, since email attachments belong to one message.) | Engineering |
| 7   | Do emails count toward the plan's monthly message cap or wallet? (Recommendation: no, metered false like other external channels, with its own `email_mailboxes` limit.)                     | Product     |
| 8   | Poll interval and latency promise for IMAP and Gmail before push is built (e.g. 60 s, 15 s on an active conversation)?                                                                       | Engineering |
| 9   | Retention for stored raw lead payloads and email bodies (default 30 days for raw lead payloads, indefinite for messages)?                                                                    | Legal, Data |
| 10  | Remote-image blocking default in the email view, and whether to proxy images?                                                                                                                | Security    |
| 11  | Should deal creation default to on for ad leads, or off until the admin picks a pipeline?                                                                                                    | Product     |
| 12  | What country-code default does phone normalisation use per workspace, and what happens to numbers that cannot be normalised?                                                                 | Product     |
| 13  | Is the legacy `workspace_email_accounts` table (a MailTrixy mirror) removed, repurposed or left alone? (Recommendation: leave, add a new mailbox table.)                                     | Engineering |

---

## 10. What already exists (so the plan fits)

- **Inbox:** `channels` table with sealed credentials and a `ChannelAdapter` port; a new kind needs an adapter, a contract enum entry, a badge, and a decision on `peer-key.ts` (phone-only identity today). Message ledger (`message_ledger`) gives idempotency on provider message id. Conversations have assignee, team, SLA columns and statuses; assignment is manual-only; SLA and routing engines are tables only.
- **Email today:** platform-wide outbound SMTP (nodemailer) for system mail only, a console `mail` group; no IMAP, no MIME parsing library, no Gmail/Microsoft code; the Settings tile `email` and the nav item `email-templates` are "Soon" placeholders; a `mail` ownership zone exists with no inventory page.
- **OAuth precedent:** the Google Calendar adapter (signed state, sealed refresh tokens, `invalid_grant` -> needs reconnect, console credentials with env fallback), which this spec reuses as the pattern.
- **Admin-configurable precedent:** the WhatsApp provider registry and the console settings groups.
- **Facebook:** Page connect, webhook with signature verification, sealed Page tokens; subscribed fields have no `leadgen`; no lead-retrieval scope. Instagram runs through an external bridge. Meta Ads, forms (WhatsApp Flow forms, not lead forms) and integrations are schema-only. TikTok is schema-only.
- **CRM:** contacts with identity-first dedupe, a free-text `source`, default stages, quota service; deals with a source list that has no ad case; notifications with only task types; `contact.created` consumed by flows. `incoming_webhooks` / `incoming_webhook_events` tables are ported but unused; the public `/public/v1/leads` endpoint needs API-key plus HMAC and no key-issuing UI exists.
- **Reference reference:** email is a bridge to an external product (MailTrixy: inbound webhook with a shared secret, per-user mailbox matching, subject and HTML stored in message meta with a 64 KB cap); lead capture is the generic incoming webhook (maps phone, name, email, tags "Lead", can enrol a flow, notifies) and a TikTok lead webhook; Reference does **not** ingest Meta lead ads. Both of our features therefore go beyond Reference and are recorded as deviations.

## 11. Risks

| Risk                                                                    | Impact                         | Mitigation                                                                                                                              |
| ----------------------------------------------------------------------- | ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------- |
| Gmail restricted-scope approval takes months                            | Google OAuth blocked at launch | IMAP first; start verification in week 1; app-password guidance                                                                         |
| Meta lead retrieval needs app review and re-consent from existing Pages | Delay and support load         | Submit review early; clear "Grant lead access" state; reconciliation sweep                                                              |
| Email threading mistakes (wrong thread, reopened tickets)               | Agents lose trust              | Header-first matching, conservative subject fallback, a test corpus of real threads                                                     |
| Private mailboxes leaking through the shared inbox                      | Privacy incident               | Channel-owner visibility predicate in both SQL and realtime, tested for cross-user access; ship personal mailboxes only after it exists |
| Credentials in logs or API responses                                    | Security incident              | Sealed vault, write-only fields, redaction tests (same as the provider registry)                                                        |
| Inbox flooding from a loop (auto-reply wars, bounce storms)             | Noise and cost                 | Auto-reply and bounce detection, per-sender rate limits, `Auto-Submitted` header handling                                               |
| Duplicate contacts and double notifications from retried leads          | CRM pollution                  | Unique `(source, external_id)`, identity-first dedupe, notification dedupe key                                                          |
| Large attachments and HTML bombs                                        | Storage and rendering abuse    | Size caps, sanitisation, remote image blocking                                                                                          |
| Scope creep into email marketing and ad management                      | Delays                         | Non-goals above; revisit after P0 ships                                                                                                 |
