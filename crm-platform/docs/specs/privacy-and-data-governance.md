# Privacy and data governance: platform-wide design and audit

Status: design + audit (spec). **BL-140 and BL-141 (first slice) are built**: the purpose registry, the extended consent vocabulary and the ConsentGate with its adopters (section 4.3.1 below); no migration came with that slice. **BL-142 (personal-data registry + schema test) and BL-143 (rights service: requests, export, erasure, contact delete) are built** (section 4.5 note below); **BL-165 to BL-167 (consent at intake: policy, grants on contact writes, channel contacts through the contacts service, consent lines for the chat widget, booking page and stores) and BL-168 to BL-171 (round 2: lead capture proof, click-to-WhatsApp referral as evidence, import and wizard CSV notice and per-channel grants, the consent line of web forms) are built** (section 4.3.2); the rest is still design. **BL-172 to BL-181 (Compliance center v1: regime profiles, officer contacts, sub-processor list, terms and privacy
links, quiet hours and calling windows stored, checklist) are section 11.** Backlog: BL-140 to BL-153
([backlog.md](../backlog.md) section O), BL-172 to BL-181 (section Q). Not legal advice: see section 10.

## How to read the evidence

- **implemented** means the code exists on this checkout and the cited file shows it. **partial** means a slice exists. **missing**
  means we looked and found nothing. **inferred** means we did not open the code path and are reasoning from names or from the audit
  summaries: treat it as a question to confirm, not a fact.
- Audit method: five read-only passes (consent and outbound paths; erasure, export, retention; security controls; sub-processors and
  AI; calling, push, team chat, personal WhatsApp, marketplace, and the reference product), then spot checks of the files cited below.
  Where a finding comes from a pass and was not re-opened line by line it is marked `(audit)`.
- The reference product (`reference/`) was read for how it handles privacy: it has little (a per-contact `is_unsubscribed` flag, see
  [contact-consent-ledger.md](contact-consent-ledger.md) section 2). Nothing here is a Reference feature, so under
  [PORTING_RULES.md](../threadwise-port/PORTING_RULES.md) it is a product extension and each shipped piece must be recorded in
  `docs/threadwise-port/parity/product-extensions.md`.

## 1. Problem and goals

The owner asked: _have we thought through privacy and data completely and comprehensively across the modules, and is it scalable: if we
build a voice bot in future we need consent there too._

Answer from the audit: **not yet, and not scalably.** We have one good building block (the consent ledger,
[contact-consent-ledger.md](contact-consent-ledger.md)) and several good local decisions (no message text in web pushes, a masking
notice in the Help assistant, secrets encrypted with AES-GCM, a signed and audited recording player). But:

1. Consent is a **WhatsApp marketing broadcast/campaign feature**, not a platform capability. Most send paths never ask the ledger.
2. Rights (access, erasure, export) exist only for the **workspace** (lifecycle wipe) and for the **consent ledger**. There is no
   per-person erasure or access request, and deleting a contact leaves most of the person's data behind.
3. Every new module decides alone what to log, keep, export and send to a vendor. Nothing makes a new table or a new vendor call
   visible to a privacy review.

Goals:

- One **consent gate** every outbound or processing path calls, for any channel, purpose and modality (text, voice, video, email).
- One **registry** of purposes (what we do with data and on what basis) and one **registry** of personal-data holders (so export and
  erasure are generated, and a test fails when a module forgets to register).
- A **rights service** (DSAR) with identity checks, timers, legal-hold exceptions and proof.
- A **retention engine** unifying the sweeps we already have.
- A **voice bot ready** posture: when a voice bot or AI call assistant ships, disclosure, recording consent, DNC/STOP-by-voice and
  purpose-limited retention are already enforced by the gate, not re-invented.
- Honest scope: we are mostly a **processor** for tenants' customers' data and a **controller** for tenant staff data, billing and
  platform operation (section 9, decision D2). Tenants carry the duty to have a lawful basis for contacting their own contacts; we carry
  the duty to give them the tools and not to undermine them.

Non-goals: certifying anything (section 8.3), writing the legal texts, changing Reference behaviour. Everything below is additive.

## 2. Data inventory

Legend for the last column: I implemented, P partial, M missing. "Sub-processors" are named in
[../privacy/subprocessor-register.md](../privacy/subprocessor-register.md). Tables are in `packages/db/migrations/` and every tenant
table has forced RLS ([architecture/multi-tenancy.md](../architecture/multi-tenancy.md)). The module-by-module register that the DSAR
registry will be generated from is [wiring/privacy-and-data.md](../threadwise-port/wiring/privacy-and-data.md).

Subjects: **C** contact (a tenant's customer), **L** lead, **E** end customer (buyer, patient, booking), **S** staff user of a tenant,
**V** anonymous visitor, **P** platform operator staff.

### 2.1 Contacts, conversations, media

| Data                                                          | Subj | Categories                                | Purpose / basis (tenant is controller, inferred) | Stored                                                                                                                                              | Read by             | Sent to                                                             | Retention today                             | Erasure today                                                                              | Export today                   | Log / audit                                                         | Status |
| ------------------------------------------------------------- | ---- | ----------------------------------------- | ------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------- | ------------------------------------------------------------------- | ------------------------------------------- | ------------------------------------------------------------------------------------------ | ------------------------------ | ------------------------------------------------------------------- | ------ |
| Contact card (name, phone, email, company, custom attributes) | C, L | identifiers, contact data                 | service / contract or consent, tenant's call     | `contacts`, attributes tables (`apps/api/src/modules/crm/contacts`, `apps/api/src/modules/crm/attributes`)                                          | contact permissions | WhatsApp/Meta, SMS and email providers when messaged                | forever (workspace wipe only)               | delete removes the row; messages, files, leads, orders, call logs stay (audit, see gap G2) | CSV export of contacts (audit) | audit row per change (audit)                                        | P      |
| Messages and conversations (text, templates)                  | C, S | content, may contain any special category | service delivery                                 | `messages`, `conversations` (`apps/api/src/modules/team-inbox-conversations`, `apps/api/src/modules/chat-conversations`); plaintext at rest (audit) | inbox permissions   | Meta/WhatsApp, Telegram, Facebook/Instagram, email, SMS, AI vendors | forever; message log archive runbook exists | none per person                                                                            | none per person                | bodies not in logs by design, but no phone/text redaction rule (G7) | P      |
| Media (images, voice notes, documents)                        | C    | content, voice (biometric risk), images   | service delivery                                 | storage bucket via platform storage settings (`apps/api/src/modules/platform-settings-branding-storage`)                                            | inbox permissions   | storage provider; Meta on send                                      | forever                                     | purge queue exists for workspace wipe (audit); not per person                              | none                           | none                                                                | P      |
| Contact files, notes, activities, meetings                    | C    | content                                   | service                                          | `apps/api/src/modules/crm/contact-files`, `contact-notes`, `contact-activities`, `contact-meetings`                                                 | contact permissions | none (inferred)                                                     | forever                                     | follows contact delete only if FK cascades (not verified per table)                        | none                           | audit                                                               | P      |
| Groups (WhatsApp group members)                               | C    | identifiers                               | service                                          | WABA groups tables ([waba-groups-management.md](waba-groups-management.md))                                                                         | inbox permissions   | Meta                                                                | forever                                     | none per person                                                                            | none                           | none                                                                | M      |

### 2.2 Consent, privacy settings

| Data                             | Subj | Categories                         | Purpose / basis                                | Stored                                                                                                                         | Read by                                              | Sent to    | Retention today                                 | Erasure today                                                   | Export today                                                                                          | Log / audit                                      | Status |
| -------------------------------- | ---- | ---------------------------------- | ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------- | ---------- | ----------------------------------------------- | --------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- | ------------------------------------------------ | ------ |
| Consent events and state         | C    | identifiers (contact id), evidence | legal obligation / legitimate interest (proof) | `contact_consent_events`, `contact_consent_state` (`packages/db/migrations/20261121090000_consent_ledger.sql`)                 | `contacts.consent.manage`, `settings.consent.manage` | none       | forever (append-only)                           | contact id set NULL on contact delete, events kept (anonymised) | CSV proof, async above 50,000 rows (`apps/api/src/modules/contact-consent/consent-export.service.ts`) | audited; evidence stores no IP/UA/text by design | I      |
| Consent export files             | S    | none beyond the ledger             | proof                                          | `contact_consent_exports` (`packages/db/migrations/20261122090000_consent_exports.sql`)                                        | requester                                            | email link | 7 days (`CONSENT_EXPORT_TTL_DAYS`), daily sweep | sweep deletes expired                                           | n/a                                                                                                   | audited                                          | I      |
| Web cookie consent choice        | V    | preferences                        | consent (ePrivacy)                             | browser only: first-party cookie and localStorage (`apps/web/src/features/auth-registration-security/guest/cookie-consent.ts`) | the visitor's browser                                | none       | browser                                         | clearing the browser                                            | none                                                                                                  | none, no server proof                            | P      |
| Terms acceptance at registration | S    | evidence of acceptance             | contract / legal obligation                    | not stored (audit)                                                                                                             | n/a                                                  | n/a        | n/a                                             | n/a                                                             | n/a                                                                                                   | n/a                                              | M      |

### 2.3 Calls, voice, recordings

| Data                                | Subj | Categories                                | Purpose / basis                                 | Stored                                                                                                                                                      | Read by                            | Sent to                                                                       | Retention today          | Erasure today                      | Export today | Log / audit                                           | Status |
| ----------------------------------- | ---- | ----------------------------------------- | ----------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------- | ----------------------------------------------------------------------------- | ------------------------ | ---------------------------------- | ------------ | ----------------------------------------------------- | ------ |
| Call log (numbers, times, outcome)  | C, S | identifiers, communications metadata      | service                                         | `packages/db/migrations/20261122090000_call_logs.sql`, `apps/api/src/modules/calling-voice/call-logs.repository.ts`                                         | `call.logs.*` permissions          | WhatsApp calling via Graph API (`apps/api/src/infra/providers/calling-voice`) | forever                  | stays after contact delete (audit) | none         | audited                                               | P      |
| Call recording audio                | C, S | voice (biometric if used for ID), content | quality / dispute; consent is the open question | private storage, signed playback (`apps/api/src/modules/calling-voice/call-recordings.service.ts`); playback audited (backlog BL-108, wiring calling-voice) | `call.logs.*` recording permission | storage provider                                                              | none (no retention rule) | none per person                    | none         | playback audited; **no consent line or announcement** | P      |
| Call permission requests (WhatsApp) | C    | consent-like                              | WhatsApp Business policy                        | `packages/db/migrations/20261019100000_call_permissions.sql`, `apps/api/src/modules/calling-voice/call-permission.service.ts`                               | calling permissions                | Meta                                                                          | forever                  | none                               | none         | audited                                               | P      |
| Transcripts, AI call logs           | C    | content                                   | AI call assistant (future)                      | not built (BL-109)                                                                                                                                          | n/a                                | n/a                                                                           | n/a                      | n/a                                | n/a          | n/a                                                   | M      |

### 2.4 Forms, leads, sales, appointments, support

| Data                                  | Subj | Categories                             | Purpose / basis                  | Stored                                                                                                                                    | Read by           | Sent to                                                | Retention today         | Erasure today                                    | Export today | Log / audit                    | Status |
| ------------------------------------- | ---- | -------------------------------------- | -------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- | ----------------- | ------------------------------------------------------ | ----------------------- | ------------------------------------------------ | ------------ | ------------------------------ | ------ |
| Form submissions and the consent line | L, C | contact data, free text, consent proof | consent / contract               | `packages/db/migrations/20261031100000_forms_core.sql`, `apps/api/src/modules/forms-builder`                                              | forms permissions | tenant integrations, webhooks                          | forever                 | none per person                                  | none         | consent event written (ledger) | P      |
| Leads and attribution (utm, referrer) | L    | contact data, attribution, may hold IP | contract / legitimate interest   | `apps/api/src/modules/leads`, `apps/api/src/modules/lead-scoring`                                                                         | lead permissions  | tenant webhooks; lead scoring (AI, audit)              | forever                 | stays after contact delete (audit)               | none         | audit                          | P      |
| Orders, invoices, payments, taxes     | E    | financial, identifiers                 | contract, legal obligation (tax) | `apps/api/src/modules/checkout-orders-merchant-payments`, `apps/api/src/modules/store-orders-sales`, `apps/api/src/modules/crm/invoicing` | sales permissions | payment gateways (Stripe, Razorpay, others)            | statutory (not encoded) | cannot be erased; must be minimised, not deleted | invoices PDF | audit                          | P      |
| Appointments and reminders            | E, C | contact data, possible health context  | contract                         | `apps/api/src/modules/appointments-booking`                                                                                               | appointment perms | Google Calendar (tenant-connected), WhatsApp reminders | forever                 | none per person                                  | none         | audit                          | P      |
| Support tickets (tenant to platform)  | S    | contact data, content                  | contract                         | `apps/api/src/modules/platform-support-desk`                                                                                              | operator          | email                                                  | forever                 | none                                             | none         | audit                          | P      |
| Storefront visitors and carts         | V, E | identifiers, behaviour                 | contract / consent               | `apps/api/src/modules/storefront-builder`, `apps/api/src/modules/catalog-products`                                                        | store perms       | payment gateways                                       | forever                 | none per person                                  | none         | none                           | P      |

### 2.5 Staff, sessions, audit, operator

| Data                                    | Subj | Categories                        | Purpose / basis                   | Stored                                                                                                                                                  | Read by          | Sent to                                                             | Retention today                             | Erasure today                                             | Export today | Log / audit                                                | Status |
| --------------------------------------- | ---- | --------------------------------- | --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- | ------------------------------------------------------------------- | ------------------------------------------- | --------------------------------------------------------- | ------------ | ---------------------------------------------------------- | ------ |
| Staff users, profiles, 2FA              | S    | identifiers, credentials (hashed) | contract                          | `packages/db/migrations/20261001090000_auth_core.sql`, `apps/api/src/modules/auth`; secrets encrypted by `apps/api/src/common/crypto/crypto.service.ts` | admin, self      | Clerk (`apps/api/src/modules/auth/clerk.service.ts`, inferred role) | while account lives                         | account delete exists (audit), anonymisation not verified | none         | `apps/api/src/modules/auth/security/auth-audit.service.ts` | P      |
| Sessions, login history, IP, user agent | S    | IP address, device                | security / legitimate interest    | auth tables; `ip_address` / `user_agent` columns appear in several migrations (grep `packages/db/migrations`)                                           | admin, self      | none                                                                | not verified                                | none                                                      | none         | itself an audit store                                      | P      |
| Audit log                               | S, C | actions, diffs                    | accountability / legal obligation | `packages/db/migrations/0006_outbox_audit.sql`                                                                                                          | audit permission | none                                                                | not verified (no sweep found)               | PII may sit inside diffs (inferred)                       | none         | n/a                                                        | P      |
| Operator impersonation (act-as)         | P, S | access to tenant data             | support                           | [ADR-0020](../adr/0020-operator-impersonation-act-as-token.md); audited, tenant not notified (audit)                                                    | operator         | none                                                                | audit row                                   | n/a                                                       | none         | audited; no tenant notice                                  | P      |
| Team chat                               | S    | content                           | contract                          | `apps/api/src/modules/team-chat`                                                                                                                        | members          | none (inferred)                                                     | forever                                     | none                                                      | none         | none                                                       | P      |
| Push subscriptions, notifications       | S    | endpoint, device keys, user agent | service                           | `packages/db/migrations/20261108090000_web_push_subscriptions.sql`, `apps/api/src/modules/notifications/push-subscriptions.service.ts`                  | the user         | browser push services (FCM/APNs/Mozilla)                            | prune + `notification-retention.service.ts` | removed with user (inferred)                              | none         | none                                                       | I      |

Push payloads carry no message text (decision in [realtime-notifications.md](realtime-notifications.md), code
`apps/api/src/modules/notifications/push-payload.ts`).

### 2.6 AI, integrations, platform

| Data                                                       | Subj | Categories                   | Purpose / basis       | Stored                                                                                                                                                                                    | Sent to                                                                              | Retention today                    | Erasure / export        | Status                             |
| ---------------------------------------------------------- | ---- | ---------------------------- | --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ | ---------------------------------- | ----------------------- | ---------------------------------- |
| Help assistant page text                                   | S    | page content, may hold PII   | service; notice shown | masking and notice ([help-agent-assistant.md](help-agent-assistant.md)), `apps/api/src/modules/help-agent/help-agent-proxy.service.ts`                                                    | AI vendor via proxy                                                                  | per spec                           | per spec                | I                                  |
| Chatbot widget AI replies, flow AI, campaign AI, growth AI | V, C | message text, prompts        | service               | `apps/api/src/modules/chatbot-widget/widget-ai-reply.service.ts`, `apps/api/src/modules/ai-agents-training`, `apps/api/src/modules/growth-pilot`                                          | OpenAI, Anthropic, Gemini, Mistral, Groq, DeepSeek, OpenRouter (BYO or platform key) | not verified                       | none                    | P (no workspace switch, no notice) |
| AI usage ledger                                            | S    | counts, cost, maybe prompts  | billing               | `apps/api/src/modules/ai-keys-usage-admin`                                                                                                                                                | none                                                                                 | not verified                       | none                    | P                                  |
| Widget visitors                                            | V    | raw IP, user agent, referrer | service / security    | `apps/api/src/modules/chatbot-widget/widget-visitors.repository.ts` (stores `ip`, `user_agent`)                                                                                           | none                                                                                 | none                               | none                    | P                                  |
| Outbound webhook delivery log                              | C, L | whole event payload          | integration           | `apps/api/src/modules/outbound-webhooks/webhooks.repository.ts`; payloads kept indefinitely (audit)                                                                                       | tenant endpoints                                                                     | forever                            | none                    | P                                  |
| Platform webhook forwarding                                | C    | raw Meta webhook bodies      | operator integration  | `apps/api/src/modules/webhook-fanout/webhook-forward-retention.service.ts` (a retention sweep exists), `packages/db/migrations/20261014100000_wfwd_webhook_forwarding.sql`                | operator-chosen targets                                                              | sweep exists (window not verified) | none                    | P                                  |
| Translation of message text                                | C, S | message content              | service               | `apps/api/src/modules/localization-translation`; sends text to translation vendors, unofficial ones unless locked down (audit)                                                            | Google translate endpoints (see register)                                            | none stored (inferred)             | n/a                     | P                                  |
| Integration tokens, API keys, WABA tokens                  | S    | credentials                  | service               | AES-GCM through `apps/api/src/common/crypto/crypto.service.ts`; rotation: [key-rotation.md](../runbooks/key-rotation.md), `apps/api/src/modules/platform-infrastructure/crypto-rotation`  | n/a                                                                                  | until revoked                      | n/a                     | I                                  |
| Marketplace installs                                       | S    | consent to app scopes        | contract              | `apps/api/src/modules/marketplace`                                                                                                                                                        | third-party app developers (per scope)                                               | forever                            | none                    | P                                  |
| Personal WhatsApp (Baileys) risk acknowledgement           | S    | acknowledgement              | risk notice           | [personal-whatsapp-connect.md](personal-whatsapp-connect.md)                                                                                                                              | WhatsApp unofficial protocol                                                         | forever                            | none                    | P                                  |
| Backups                                                    | all  | everything                   | resilience            | [backup-restore.md](../runbooks/backup-restore.md): 14 days local, 30 days daily plus 12 monthly off-site, sealed (`apps/api/src/modules/platform-infrastructure/offsite-backup/seal.ts`) | storage provider                                                                     | 14 d / 12 months                   | not scrubbed on erasure | P                                  |

## 3. Current-state audit

### 3.1 What is solid

- Tenant isolation: forced RLS on every tenant table ([multi-tenancy.md](../architecture/multi-tenancy.md)); a tenant cannot read
  another tenant's personal data through normal queries.
- Consent ledger design: append-only, evidence without IP/UA/text, derived state, STOP/START keyword handling, export.
- Secrets at rest: AES-GCM (`apps/api/src/common/crypto/crypto.service.ts`), rotation tooling, sealed off-site backups.
- Log redaction of credentials and signature headers: `apps/api/src/modules/platform-infrastructure/observability/log-redaction.ts` and
  `redact` in `apps/api/src/app.module.ts`.
- Web Push carries no message text; Help assistant masks and shows a data-sharing notice; recording playback is signed and audited.

### 3.2 Gaps ranked by risk

| #   | Gap                                                                                                                                                                                                                                                                                                                                                                             | Risk     | Evidence                                                                                                                                                   |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| G1  | **No shared consent gate (closed for the paths in 4.3.1; open items listed in the backlog under BL-141).** Only broadcasts, campaigns and the campaign wizard use `consentSendableSql`; flows, AI auto-replies, appointment reminders, manual inbox sends, developer REST send, scheduled messages, SMS and email do not. The strict "require consent" switch is WhatsApp-only. | Critical | spec section 7 of [contact-consent-ledger.md](contact-consent-ledger.md); `apps/api/src/modules/contact-consent/consent-policy.service.ts`; rest `(audit)` |
| G2  | **Contact deletion is not erasure.** Messages, files, recordings, leads, orders, call logs stay; no per-person access/erasure request exists.                                                                                                                                                                                                                                   | Critical | `apps/api/src/modules/crm/contacts` delete path `(audit)`; consent ledger anonymises only its own rows                                                     |
| G3  | **Voice ignores the ledger and has no recording consent.** No announcement or consent line, no retention, no erasure for recordings; STOP does not apply to calls.                                                                                                                                                                                                              | Critical | `apps/api/src/modules/calling-voice/call-recordings.service.ts`; `call-permission.service.ts` is Meta's permission, not the ledger                         |
| G4  | **Email has no unsubscribe mechanism**: no link, no `List-Unsubscribe` header, no public endpoint. Marketing email would be non-compliant in most regimes.                                                                                                                                                                                                                      | High     | [contact-consent-ledger.md](contact-consent-ledger.md) section 11 lists it as not built; `apps/api/src/modules/channel-email` `(audit)`                    |
| G5  | **`utility` purpose is recorded but not enforced**; there is no purpose beyond marketing/utility (no voice, AI, analytics, push).                                                                                                                                                                                                                                               | High     | [contact-consent-ledger.md](contact-consent-ledger.md) section 3                                                                                           |
| G6  | **Backups are not scrubbed** and keep erased data for 14 days local and up to 12 months off-site. Honest disclosure needed, plus a "re-apply erasures after restore" step.                                                                                                                                                                                                      | High     | [backup-restore.md](../runbooks/backup-restore.md) retention lines                                                                                         |
| G7  | **PII in content is plaintext at rest and log redaction has no phone or message-text rule** (only credentials and signature headers).                                                                                                                                                                                                                                           | High     | `apps/api/src/modules/platform-infrastructure/observability/log-redaction.ts` (credential names only)                                                      |
| G8  | **Retention is absent for most personal data.** Only workspace wipe on lapsed paid plans (`apps/api/src/modules/plans-subscriptions-trials/plan-retention.service.ts`, opt-in per plan) and a few sweeps; the inactivity lifecycle is a proposal (ADR-0028) and off by default `(audit)`.                                                                                       | High     | `docs/adr/0028-workspace-inactivity-lifecycle.md` status proposed                                                                                          |
| G9  | **Webhook delivery log keeps payloads forever; platform webhook-fanout forwards raw Meta bodies.** Personal data copied to places with no deletion path.                                                                                                                                                                                                                        | Medium   | `apps/api/src/modules/outbound-webhooks/webhooks.repository.ts`, `apps/api/src/modules/webhook-fanout`                                                     |
| G10 | **Widget visitor raw IP and user agent with no retention.**                                                                                                                                                                                                                                                                                                                     | Medium   | `apps/api/src/modules/chatbot-widget/widget-visitors.repository.ts`                                                                                        |
| G11 | **AI switches inconsistent.** Help assistant has masking and notice; widget AI, flow AI, campaign AI, growth AI and translation have no workspace switch and no notice. Translation may use unofficial providers.                                                                                                                                                               | Medium   | `apps/api/src/modules/chatbot-widget/widget-ai-reply.service.ts`, `apps/api/src/modules/localization-translation` `(audit)`                                |
| G12 | **Consent and terms proof gaps**: registration terms acceptance not stored; cookie choice is client-only, so we cannot prove it.                                                                                                                                                                                                                                                | Medium   | `apps/web/src/features/auth-registration-security/guest/cookie-consent.ts`                                                                                 |
| G13 | **Operator access**: impersonation is audited but the tenant is not told. RLS privileged mode has a known weakness tracked by ADR-0028 (privileged-mode GUC).                                                                                                                                                                                                                   | Medium   | [ADR-0020](../adr/0020-operator-impersonation-act-as-token.md), [ADR-0028](../adr/0028-privileged-mode-must-not-be-a-settable-guc.md)                      |
| G14 | No breach runbook, no sub-processor register or DPA, no data-residency choice, no children's-data policy.                                                                                                                                                                                                                                                                       | Medium   | this folder is new; nothing existed (`docs/privacy/` did not exist)                                                                                        |
| G15 | Team chat, audit diffs, aggregate sessions/IP have no retention or access-logging policy.                                                                                                                                                                                                                                                                                       | Low      | inferred                                                                                                                                                   |

## 4. Target architecture

Everything below extends what exists. Nothing replaces the ledger; every new table follows the usual rules (forced RLS, composite FKs,
audit + outbox in the same transaction).

### 4.1 Purpose and processing registry

A code-defined catalogue in `packages/contracts` (new `privacy` folder), validated at boot, mirrored to a read-only table for the UI.
One entry per purpose:

| field              | meaning                                                                                                                                                                                                                        |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `id`               | `marketing_messaging`, `service_messaging`, `call_recording`, `voice_ai_conversation`, `ai_content_processing`, `analytics_profiling`, `third_party_sharing`, `push_notifications`, `cookies_analytics`, `staff_ai_assist` ... |
| `lawfulBasis`      | `consent`, `contract`, `legitimate_interest`, `legal_obligation` (the default, a tenant may be stricter)                                                                                                                       |
| `consentMandatory` | true when the regime set for the contact requires opt-in (see 4.2 regime hints)                                                                                                                                                |
| `modalities`       | which of `text`, `voice`, `video`, `email` it applies to                                                                                                                                                                       |
| `channels`         | channel list or `*`                                                                                                                                                                                                            |
| `defaultRetention` | per data class (see 4.5)                                                                                                                                                                                                       |
| `evidenceRequired` | keys the ledger must store (consent text hash, prompt version, audio clip hash...)                                                                                                                                             |
| `noticeKey`        | the notice string shown or spoken (versioned)                                                                                                                                                                                  |
| `subProcessors`    | ids from the sub-processor register that may receive data for this purpose                                                                                                                                                     |

A processing path that has no registered purpose cannot call the gate (compile-time type), so a new feature must pick one or add one in
review.

### 4.2 Generalised consent model (extends `contact_consent_events`)

Keep: append-only events, derived state, evidence, idempotency key, `is_unsubscribed` roll-up. Add (all additive columns or lookup
tables, one migration when built):

- `subject_type` (`contact`, `lead`, `visitor`, `call_participant`, `staff`) with `subject_id`; `contact_id` stays for existing rows.
  A visitor or an unknown caller is identified by a keyed hash of the phone/cookie id, never raw.
- `purpose` becomes the registry id (existing `marketing`, `utility` map to `marketing_messaging`, `service_messaging`).
- `modality` (`text`, `voice`, `video`, `email`) and `scope` (per channel, per sender number, per campaign family).
- `regime` hint on the subject or workspace: `gdpr`, `eprivacy`, `tcpa_ctia`, `trai_dlt`, `dpdp`, `uae_pdpl`, `ksa_pdpl`, `wa_business`,
  `none`. A hint selects defaults (opt-in versus opt-out, quiet hours, calling windows); it never lowers what the platform requires.
- `notice_version` + `notice_sha256` for the text shown or spoken; `method` (`checkbox`, `keyword`, `dtmf`, `spoken_yes`, `double_opt_in`,
  `preference_center`, `import_attestation`, `api`).
- **Withdrawal propagation:** a STOP on any channel withdraws `marketing_messaging` for every text modality of that subject by default
  (workspace setting, default on); STOP by voice withdraws voice and text marketing; per-channel opt-outs stay possible.
- **Double opt-in**, **preference center**, **DSAR export of the ledger**: already designed in
  [contact-consent-ledger.md](contact-consent-ledger.md) sections 11.1 to 11.3; they become tasks of this plan.
- **Quiet hours and calling windows**: workspace and regime defaults; evaluated by the gate.
- **Proof export** stays as built.

### 4.3 The consent gate

One injectable service, the only door:

```
ConsentGate.check({ orgId, subject, channel, purpose, modality, context }) -> { decision: 'allow' | 'deny' | 'needs_notice', reason, notice?, auditRef }
```

- `allow`: record nothing for hot paths except a sampled decision counter; `deny`: the caller must not send and records the skip with
  `reason`; `needs_notice`: caller may proceed only after delivering `notice` (for example the recording announcement or AI disclosure).
- Reasons are a closed set (`withdrawn`, `no_consent`, `quiet_hours`, `calling_window`, `dnc`, `regime_requires_optin`,
  `purpose_not_enabled`, `subject_minor`, `legal_hold`), so reports and the UI can explain every skip.
- A batch form `checkMany` returns SQL fragments (generalising `consentSendableSql`) so broadcasts stay one query.
- Enforced by a test that greps for send/process adapters (`WhatsAppPort.send`, SMS and email senders, `CallsGraphPort`, AI provider
  clients, push sender) and fails when a caller outside an allow-list does not import the gate. The allow-list is reviewed, not empty:
  replies inside an open customer-initiated window for service messaging are `allow` by registry definition.

Plug-in map (each is a backlog task):

| Path                                   | Today                               | With the gate                                                                                    |
| -------------------------------------- | ----------------------------------- | ------------------------------------------------------------------------------------------------ |
| Broadcasts, campaigns, wizard          | `consentSendableSql`, WhatsApp only | `checkMany`, all channels                                                                        |
| Flow runtime send nodes                | no check `(audit)`                  | `marketing_messaging` or `service_messaging` by node/template category                           |
| Scheduled messages, automations        | no check `(audit)`                  | gate at send time (not at schedule time)                                                         |
| AI agent auto-replies                  | no check `(audit)`                  | `service_messaging`; plus `ai_content_processing` switch                                         |
| Appointment reminders, order notices   | no check `(audit)`                  | `service_messaging`                                                                              |
| Manual inbox send, developer REST send | no check `(audit)`                  | `service_messaging` allowed in window; marketing-category template requires consent              |
| SMS, email                             | no check `(audit)`                  | per channel; email adds unsubscribe link and header                                              |
| Calls (outbound), voice bot            | ignore the ledger                   | `voice` modality, `call_recording`, `voice_ai_conversation`, calling windows and DNC (section 5) |
| Push                                   | user permission in the browser      | `push_notifications` on the staff subject, registry only (no contact data)                       |
| Sub-processor calls (AI, translation)  | per module                          | `ai_content_processing` / `third_party_sharing` workspace switch                                 |

### 4.3.1 Built: registry, gate and adopters (BL-140, BL-141)

- **Registry:** `packages/contracts/src/privacy/purposes.ts` (ten purposes: `marketing_messaging`, `service_messaging`, `call_recording`,
  `voice_ai_conversation`, `ai_content_processing`, `analytics_profiling`, `third_party_sharing`, `push_notifications`,
  `cookies_analytics`, `staff_ai_assist`). Each has lawful basis, `consentMandatory`, modalities, channels, default retention, required
  evidence, notice key and locale keys. `validatePurposeRegistry()` runs in the unit tests. The two stored ledger values stay valid:
  `marketing` is `marketing_messaging`, `utility` is `service_messaging` (`resolvePurposeId`). `GET /v2/consent/purposes` serves it.
- **Vocabulary:** modality (`text`, `voice`, `video`, `email`), subject type, regime hint and the channels `voice` and `rcs` are in
  `contact-consent/vocabulary.ts`. NO migration: the ledger keeps `marketing`/`utility` and free-text channels. Storing the other
  purposes, modality, scope, subject type, regime and notice version needs the migration of 4.2, still to do (BL-140b).
- **Gate:** `ConsentGate.check(orgId, subject, channel, purpose, modality?, { replyWindowOpen?, tx? })` and
  `checkMany(orgId, contactIds, channel, purpose, ...)` (one statement per 1000 contacts). The rule is the pure function
  `decideConsent` (`consent-gate.rules.ts`); reasons are the closed set `CONSENT_GATE_REASONS`.
- **Rules decided:** (1) a withdrawal (the roll-up flag or the ledger) ALWAYS denies marketing, whatever the switch says; with
  `require_consent_for_marketing` off (default) everyone else is allowed, exactly as before; with it on a recorded grant on the channel is
  needed. (2) **STOP withdraws marketing only.** Service messages (replies, order and appointment notices) still go to a contact who sent
  STOP; only an explicit withdrawal of the service purpose on that channel blocks a business-initiated service message. (3) A reply
  inside the customer-service window is service (`inbound_reply_window`) and is allowed even then. (4) Free-form text and files sent
  to a conversation are service; a template takes its category (MARKETING is marketing, UTILITY and AUTHENTICATION are service). (5) A
  flow started by the business (schedule, date match, campaign, list changes, API) is marketing for its plain messages; a flow answering
  the contact is service. (6) A gate failure fails CLOSED for marketing and consent-based purposes and OPEN for service replies,
  logged once a minute. (7) A purpose with a notice to deliver first (`call_recording`, `voice_ai_conversation`) answers
  `needs_notice` with the notice key.
- **Adopters** (path, purpose, behaviour): see the table in [../api/contact-consent.md](../api/contact-consent.md) section "ConsentGate".
- **Guard:** `test/unit/contact-consent/consent-gate-guard.spec.ts` scans `src/modules` for the send primitives and fails when a file
  uses one without asking the gate and is not in `consent-gate.allowlist.ts` (each entry has a reason; stale entries also fail).
- **Email unsubscribe:** signed no-PII link, `/u/<token>` page, RFC 8058 headers. See the API doc.

### 4.3.2 Policy: how a grant comes to exist (intake) (BL-165 to BL-167)

**Owner-approved policy (14 Oct 2026).**

1. **A first inbound message permits replying only.** It opens the customer-service window (`inbound_reply_window`, service messaging)
   and nothing else. It NEVER creates a marketing grant: the inbound pipeline writes no `granted` event, and a contact created from an
   inbound message has the ledger state `unknown` ("No consent recorded"). The only inbound texts that write to the ledger are the
   contact's own STOP and START keywords (`keyword` source), which are an explicit act, not a first message.
2. **A grant is written only when the person actually agreed**, and the event carries the evidence: the **source** (form, manual, api,
   widget, booking, commerce, import, keyword), the **notice wording and its version** (`consentText` cut to 300 characters, `consentHash`
   of the whole text, `consentVersion`, and where relevant `noticeVersion` and `noticeUrl`), and the **time** (`occurred_at`; a date from a
   caller can be earlier than now, never later, so a grant can never outrank a STOP that arrives first). Never an IP address or a user agent.
3. **A subscription status is a label, not proof.** `whatsappSubscriptionStatus`, `smsSubscriptionStatus` and `emailSubscriptionStatus`
   set to `subscribed` do not by themselves permit marketing. A write that sets one needs proof (a `consent` block with a note or the
   wording) and writes the ledger grant, or it is refused with 422 `CONSENT_NOTE_REQUIRED`. A staff-set grant needs a note, as on the
   Consent card. A grant from an automated source never overrides a withdrawal the person made (`respectWithdrawn`).
4. **The ConsentGate stays the one enforcement point.** Nothing here lets a send path skip the gate; with the workspace switch on, a
   contact with no grant is held back from marketing whatever its status says. The switch stays off by default (existing behaviour).
5. **Contacts created by a channel are created by the contacts service** (`ContactsService.resolveOrCreateByIdentity`), so audit, the plan
   quota and `contact.created` apply to every way a person enters the CRM, and none of them grants consent.

Paths that write an intake grant (all through `ConsentIntakeService`, one idempotency key per source event):

| Path                                                                                                                                          | Source     | Evidence (besides wording and version)                                            |
| --------------------------------------------------------------------------------------------------------------------------------------------- | ---------- | --------------------------------------------------------------------------------- |
| CRM contact create and update (a status set to `subscribed`, or `consent`)                                                                    | `manual`   | actor, note                                                                       |
| Customer REST API v1 contact create and update (`consent`)                                                                                    | `api`      | `apiKeyId`                                                                        |
| Partner agent lead submit (`consent`)                                                                                                         | `api`      | `reference: partner_agent:<id>`                                                   |
| Public lead submit `/public/v1/leads` (`consent`)                                                                                             | `api`      | `apiKeyId`                                                                        |
| Google Sheets add-on contact rows (`consent` yes + `consent_note`)                                                                            | `api`      | `reference: google_sheets`                                                        |
| Website chat widget pre-chat consent line                                                                                                     | `widget`   | `widgetId`, `noticeVersion`                                                       |
| Appointment booking page consent line                                                                                                         | `booking`  | `bookingPageId`, `noticeVersion`                                                  |
| Shopify and WooCommerce customers who accepted marketing in the store                                                                         | `commerce` | `integrationId`, `noticeVersion`, `noticeUrl`                                     |
| Forms with a ticked marketing line (built before this policy; SMS added in round 2 when the form declares its wording covers SMS)             | `form`     | `formId`, `submissionId`                                                          |
| Lead webhook and marketplace connectors that pass a `consent` block with a yes and readable proof (BL-168)                                    | `lead`     | `leadSourceId`, `leadFormId`, `adId`, wording and version                         |
| Contact import with "I have consent" ticked (BL-170): WhatsApp from the consent column or every row, SMS and email only from their own column | `import`   | `fileName`, `reference` (job), the notice wording and version the importer stated |
| Broadcast wizard CSV with the confirmation (BL-170), granted when the broadcast launches                                                      | `import`   | `fileName`, `reference: wizard_csv:<upload>`, the stated notice and version       |
| Forms with a ticked line that is NOT marketing (BL-171): purpose `utility` (service messages), never a marketing grant                        | `form`     | `formId`, `submissionId`, wording and version                                     |

**Evidence that is not a grant (round 2).** A click-to-WhatsApp ad that brought a person to their first message (Meta `referral`: ad id,
link, headline, click id) is kept as an append-only attribution touch on the contact (`contact_attributions`, platform
`click_to_whatsapp`), never in the ledger: clicking an ad is not an agreement (BL-169). An unticked consent box on a web form is not an
agreement either, so it writes nothing to the ledger; the submission keeps the wording shown and that it was left unticked (BL-171).
A subscription label set from proof (a lead or a form) is filled only on a channel that really got a grant.

**Still open:** a native Meta lead-ads connector with its own screen (leads reach the pipeline through the generic webhook and recipes today).

### 4.4 Voice bot and call recording

> **Built for operator calls (BL-144).** Recording off by default, notice and recorded answer before any audio through the ConsentGate (`call_recording`, with `noticeEvidence` and `purposeEnabled` options and the reasons `consent_evidence_recorded`, `consent_declined`, `purpose_not_enabled`, `notice_delivered`), evidence on `wa_calls`, versioned notices, retention sweep, manual delete and legal hold. Migration `20261202090000_call_recording_consent.sql`; API in [../api/calling-voice.md](../api/calling-voice.md). The bot items below are still design.

See section 5 and [../privacy/voice-bot-consent-requirements.md](../privacy/voice-bot-consent-requirements.md).

### 4.5 DSAR and rights service

> **Built (BL-142, BL-143).** Code: `apps/api/src/modules/privacy` (registry in `registry/` and `manifests/`, engine in `engine/`, API in `requests/`), tables in migration `20261129090000_privacy_requests.sql`, permissions `privacy.requests.read|manage` and `privacy.erase.execute`, API doc [../api/privacy.md](../api/privacy.md), runbook [../privacy/dsar-runbook.md](../privacy/dsar-runbook.md). Differences from the design below: the subject types built are contact, lead and a free phone/email (staff `user` subject is allow-listed, handlers are a follow-up); the platform-owned erasure log is not built (the proof lives on the request row); backups, search indexes, AI vendors and the public request form are follow-ups.

- Table `privacy_requests`: type (`access`, `export`, `rectification`, `erasure`, `restriction`, `objection`, `portability`,
  `consent_withdrawal`), subject reference, requester channel, identity-verification state, status, `due_at`, assignee, legal-hold flags,
  result bundle pointer, proof-of-erasure hash. Append-only status history.
- SLA timers by regime: GDPR one month (extendable by two), many US states 45 days, DPDP "as prescribed" (inferred, counsel to
  confirm). Reminders to the assignee at 50, 80, 100 percent.
- **Registry of personal-data holders.** Each module declares `{ table, subjectColumns, storagePrefixes, export(), erase(), retentionClass,
legalHoldRule }` in a typed manifest (a file `privacy.manifest.ts` per module). Handlers run per subject inside one tenant transaction;
  storage and caches are purged by the existing purge queue after commit.
- **The test that makes it enforceable:** a database test reads `information_schema` and the foreign keys; every tenant table with a
  column referencing `contacts`, `leads` or a user must appear in the registry or in an explicit "no personal data" allow-list with a
  reason. The build fails otherwise. The manifest in [wiring/privacy-and-data.md](../threadwise-port/wiring/privacy-and-data.md) is the
  seed for the first registry.
- **Erase vs anonymise:** default is anonymise (keep the row, drop the identifying fields) where the row is a financial or consent
  record; erase where there is no retention duty. **Legal hold:** invoices and payment records are kept for the statutory period
  (decision D9); erasure replaces the name/phone with a token and records `held: tax`.
- **Propagation:** storage objects (media, recordings, contact files) through the purge queue; search/embeddings (FAQ and AI memory);
  caches; **backups** are not scrubbed: we state the 14-day and up-to-12-month windows, keep an erasure log, and re-apply erasures
  after any restore (runbook step in [dsar-runbook.md](../privacy/dsar-runbook.md)); sub-processors and AI vendors by a listed API or an
  email task where they hold data.
- **Proof:** a signed erasure receipt (counts per table, timestamps, no personal data), stored in a platform-owned erasure log as ADR-0028
  describes (survives the workspace).
- Identity checks: a verified contact is one who replies from the same channel identity (WhatsApp number via a one-time code sent to it,
  or an email link); staff-originated requests need `privacy.dsar.manage`.

### 4.6 Retention policy engine

One config (`retention_policies`: class, platform min/max, default, workspace override within bounds, legal hold) and one daily report
that runs every existing sweep as a "retention job" under one contract: plan wipe
(`apps/api/src/modules/plans-subscriptions-trials/plan-retention-sweep.service.ts`), notification retention
(`apps/api/src/modules/notifications/notification-retention.service.ts`), push prune
(`apps/api/src/modules/notifications/push-subscriptions-prune.service.ts`), webhook forward retention
(`apps/api/src/modules/webhook-fanout/webhook-forward-retention.service.ts`), consent export sweep
(`apps/api/src/modules/contact-consent/consent-export-sweep.service.ts`), and new ones (call recordings and transcripts, webhook delivery
log, widget visitors, closed conversations if the tenant chooses, audit rows, sessions). Proposed platform defaults, all workspace
overridable inside the bounds, all subject to decision D4:

| Data class                      | Default                              | Bounds                         |
| ------------------------------- | ------------------------------------ | ------------------------------ |
| Call recordings                 | 90 days after the call               | 7 to 365 days                  |
| Call transcripts / AI call logs | 180 days                             | 30 to 730 days                 |
| Widget visitor IP / UA          | 30 days (then coarsened / null)      | 1 to 90 days                   |
| Webhook delivery payloads       | 30 days (metadata 180)               | 7 to 90 days                   |
| Messages and media              | tenant chooses, default forever      | 30 days to forever             |
| Consent ledger                  | life of relationship + 5 years       | not shortened below proof need |
| Audit log                       | 13 months                            | 6 to 36 months                 |
| Sessions / login IP             | 90 days                              | 30 to 365 days                 |
| Inactive workspace              | per ADR-0028 (archive 90, erase 180) | operator override              |

Legal hold: a flag on a subject or a workspace that makes all retention jobs and erasures skip it and records why. It requires a
distinct permission and is itself audited.

### 4.7 Security controls

1. **PII classification tags.** A `pii` annotation (class: `identifier`, `contact`, `content`, `financial`, `voice`, `location`,
   `special_risk`) on Drizzle columns and on contract fields, read by tooling to drive: log-redaction path generation (closes G7 for
   phone and message text), export handlers, Help-assistant masking, webhook payload minimisation, audit diff scrubbing. A test fails
   when a column named like `phone`, `email`, `body`, `ip`, `address` has no annotation.
2. **Field-level encryption candidates:** call recording storage keys (per-object), contact phone/email only if search needs can be met
   with a blind index (decision D8), webhook secrets (already), integration tokens (already AES-GCM). Message bodies stay plaintext until
   a search design exists; disk/volume encryption and storage-provider server-side encryption are the baseline (to be confirmed with
   infrastructure: inferred).
3. **Access logging for sensitive reads:** recordings (done), consent/DSAR exports, contact exports, impersonation sessions, bulk
   contact lists. A common `SensitiveReadAudit` call.
4. **Permission map:** `privacy.dsar.manage`, `privacy.dsar.read`, `privacy.consent.read` (alias of `contacts.consent.manage` read part),
   `privacy.retention.manage`, `privacy.legalhold.manage`, `privacy.subprocessors.read`, `privacy.recordings.listen`,
   `privacy.export.workspace`. Delivered with the existing roles-permissions module and seeded permissions migration pattern.
5. **Breach response:** [../privacy/breach-response-runbook.md](../privacy/breach-response-runbook.md) (skeleton; 72 hours to a
   European supervisory authority when GDPR applies, CERT-In 6 hours for listed incident types in India, DPDP board notification; all
   `needs counsel`).
6. **Sub-processor register + DPA template:** [../privacy/subprocessor-register.md](../privacy/subprocessor-register.md); DPA text needs counsel.
7. **Data residency:** today a single deployment. Options: region-pinned deployment per tenant region (own stack), or per-tenant storage
   bucket region; start with documenting where the single deployment runs and offering tenants a choice at signup only when a second
   region exists (D3).
8. **Cross-border transfers:** list each vendor's hosting region in the register; SCCs / transfer assessments need counsel.
9. **Children's data:** no age gate exists; the platform is B2B. Policy: tenants must not use it to market to children; the gate adds a
   `subject_minor` deny reason when a tenant tags a contact as a minor; no processing of minors' voice for AI by default.
10. **Operator access:** notify the tenant owner when an operator uses act-as (email + audit entry visible to the tenant), time-box the
    token, and finish ADR-0028's privileged-mode fix.

### 4.8 Tenant-facing Privacy Center

A Settings > Privacy hub (a new tile set under Security; the existing Compliance tile stays and links in), with:

- **Purposes and consent settings:** the registry rendered per workspace (which purposes are on, the regime hint, quiet hours, calling
  windows), the existing STOP/START settings embedded.
- **Retention:** the table in 4.6 with the workspace overrides and a dry-run preview.
- **Requests inbox:** `privacy_requests` list, due dates, actions, proof download.
- **Sub-processors:** read-only list from the register, with change notice date; **DPA download** (the text is the owner's).
- **Cookies:** categories, banner text, server-side recording of the choice (closes G12) per visitor id.
- **Data export / delete workspace:** the full workspace export and the deletion flow (today lifecycle only).
- **AI disclosures:** one switch per AI use (assistant, widget, flows, campaigns, growth, translation), the vendors in use, whether the
  tenant's own key or the platform's key, and the notice templates.
- **Recording notice templates:** announcement text per language and region, the DTMF/spoken consent prompt, versioned.

**End-customer pages (public, rate limited, token-verified):** the preference center `/p/<token>` and the opt-out landing `/c/<token>`
from the ledger spec, plus a **DSAR request form** (workspace-branded, email or WhatsApp verification, no account, captcha, rate limits
per IP and per subject, constant-time token checks). The page never shows other people's data and never confirms whether a number exists
before verification.

### 4.9 Platform and operator level

- Platform terms, privacy policy, DPA, cookie policy: owner's documents (counsel). The app records acceptance of terms with version, time,
  IP-hash (not raw) at registration and at each version change (closes G12).
- Audit evidence: this plan produces records usable in a security questionnaire. **We claim none of SOC 2, ISO 27001, HIPAA, PCI DSS
  certification.** The controls list in section 4.7 maps loosely to SOC 2 CC6/CC7/P-series and ISO 27001 Annex A (access control,
  logging, supplier management, incident management) but a mapping is not a certification. Payment card data is handled by gateways;
  we do not store PANs (inferred from gateway-based design); calls must pause recording during card entry (section 5).

## 5. Voice bot and call recording design

Full requirements: [../privacy/voice-bot-consent-requirements.md](../privacy/voice-bot-consent-requirements.md). Summary of the design
decisions the gate and registry must encode so a voice bot adds a provider, not a compliance project:

1. **Disclosure first.** The first utterance of an AI-handled call states that it is automated and, if applicable, that the call may be
   recorded and transcribed. `ConsentGate.check(..., purpose: 'voice_ai_conversation')` returns `needs_notice` with the versioned
   script; the call engine plays it and the notice id is stored on the call row.
2. **Recording is off by default** and a per-workspace setting. When on, the gate applies the strictest of the regime hints:
   all-party consent where any participant is in an all-party jurisdiction or the region is unknown. Mechanisms: announcement-only
   (continuing after notice, accepted in some jurisdictions, counsel decides per region), DTMF ("press 1 to continue, recorded") or
   spoken yes with the audio clip hash, timestamp, prompt version, and the model confidence stored as evidence.
3. **No consent, no recording; consent refused does not end the call** unless the workspace chose that; the bot continues unrecorded
   or hands to a human.
4. **Opt-out phrases in speech** ("stop calling me", "do not record", "remove my number") are detected and act as `withdrawn` events with
   method `spoken_optout`. STOP by text also withdraws voice marketing (propagation, 4.2).
5. **Outbound dialing gate:** calling windows by regime and destination time zone, DNC / TRAI-style registry checks as a pluggable
   list, STOP applies to voice, and a consent record or an existing relationship before any marketing call. The WhatsApp Business Calling
   permission request already built maps to the ledger as a `granted` event, purpose `service_messaging`/`voice`, method `wa_call_permission`,
   expiry per Meta's rules.
6. **Biometrics:** voiceprints and speaker identification are banned by default; any feature that derives identity from voice needs a
   separate explicit purpose, owner decision D8, and a DPIA.
7. **PCI pause:** recording and transcription pause during payment capture (Twilio Pay or equivalent); transcripts are scanned for card
   patterns and masked (`pii` class `financial`).
8. **Retention and DSAR:** recordings and transcripts follow the table in 4.6; both are registered holders (export returns audio and
   text; erasure deletes objects and transcript rows). Playback and export remain audited.
9. **Minors and special categories:** the bot ends the sensitive-topic flow and hands off; no recording of detected minors by default.
10. **Provider listing:** every voice, speech-to-text, text-to-speech and LLM vendor is a registry entry before use.

## 6. Roadmap

| Phase | Item                                                                                                         | Backlog        | Size | Unblocks                           |
| ----- | ------------------------------------------------------------------------------------------------------------ | -------------- | ---- | ---------------------------------- |
| P0    | Purpose registry + ConsentGate service + first adopters (flows, inbox send, REST send, scheduled, reminders) | BL-140, BL-141 | L    | voice bot, email, everything below |
| P0    | Personal-data registry + manifest + failing test                                                             | BL-142         | M    | DSAR, erasure                      |
| P0    | Contact erasure and export (all modules incl. storage), `privacy_requests` core                              | BL-143         | L    | rights                             |
| P0    | Call recording consent line, announcement, retention, erasure (existing calling module)                      | BL-144         | M    | voice bot                          |
| P1    | Email unsubscribe (link, header, public endpoint) + double opt-in + preference center                        | BL-145         | M    | email marketing                    |
| P1    | Retention engine + report; webhook log, widget visitor, audit retention                                      | BL-146         | L    | storage limitation                 |
| P1    | Privacy Center screens + public DSAR form + cookie proof + terms acceptance                                  | BL-147         | L    | tenant self-service                |
| P1    | Voice bot prerequisites: modality/scopes/regime columns, DNC, calling windows, spoken opt-out                | BL-148         | L    | voice bot                          |
| P1    | AI use switches, notices, vendor allow-list per workspace; translation lock-down                             | BL-149         | M    | AI consent                         |
| P1    | PII annotation + log redaction + audit diff scrub + webhook minimisation                                     | BL-150         | M    | G7, G9                             |
| P1    | Breach runbook finalised, operator-access notice, impersonation time-box                                     | BL-151         | S    | G13, G14                           |
| P2    | Data residency options, region pinning                                                                       | BL-152         | XL   | EU/KSA/UAE sales                   |
| P2    | Field-level encryption (recordings keys, optional contact blind index), backup erasure re-apply tooling      | BL-153         | L    | defence in depth                   |

Order that unblocks the voice bot: BL-140/112 (gate) -> BL-142 (registry) -> BL-144 (recording consent in current calls) -> BL-148
(modality, DNC, windows) -> BL-143 (erasure for audio and transcripts). Sizes are rough (S days, M 1-2 weeks, L 3-5 weeks, XL longer).

## 7. Privacy-by-design for a new feature

Authors follow [../privacy/privacy-by-design-checklist.md](../privacy/privacy-by-design-checklist.md) and add their module's rows to
[wiring/privacy-and-data.md](../threadwise-port/wiring/privacy-and-data.md) in the same change. Until BL-142 exists the review is manual.

## 8. Operating model notes

### 8.1 Controller and processor

For contacts, leads, end customers: the **tenant** decides purposes (controller) and we process (processor), except where we use data for
our own ends (billing, security, abuse) where we are a controller. Staff accounts and billing: we are controller. See D2.

### 8.2 Who sees what at the platform

Operators can act as a tenant owner (ADR-0020). That is "access" to personal data and must appear in the DPA, in the sub-processor
register (our own staff and hosting) and in the tenant-visible notice (4.7 item 10).

### 8.3 What is NOT claimed

No certification (SOC 2, ISO 27001, HIPAA, PCI DSS), no adequacy or transfer mechanism, no statement that any workflow satisfies GDPR,
TCPA, TRAI, DPDP, PDPL or WhatsApp policy. The text states design intent and engineering controls only.

## 9. Decisions for the owner

| #   | Decision                                    | Recommendation                                                                                                                                           |
| --- | ------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1  | Default regimes supported at launch         | GDPR/ePrivacy, India DPDP + TRAI, WhatsApp Business policy, TCPA/CTIA (US), UAE and KSA PDPL as hints; start with strictest default, relax per workspace |
| D2  | Controller or processor in our contracts    | Processor for contact/lead/end-customer data; controller for staff, billing, security; DPA with processor terms                                          |
| D3  | Residency (EU / India / Gulf)               | Document single region now; build region-pinning only after the first regulated customer asks (BL-152)                                                   |
| D4  | Retention defaults                          | Table in 4.6; recordings 90 days; workspaces keep messages unless they set a rule                                                                        |
| D5  | Store IP and user agent                     | Not raw: keep a keyed hash for abuse control, raw only for security events, 30-90 days; widget visitors coarsened after 30 days                          |
| D6  | Allowed AI vendors                          | An allow-list at platform level, per-workspace opt-in, tenant BYO key by default; no vendor that trains on prompts without a signed term                 |
| D7  | Call recording default                      | OFF; on only with notice template + region rule                                                                                                          |
| D8  | Voiceprints / speaker ID                    | Banned; also no contact phone encryption until search needs are designed                                                                                 |
| D9  | Legal-hold periods for invoices and consent | Counsel to set per country; engineer as per-country configuration                                                                                        |
| D10 | Operator access notice                      | Notify tenant owner on every act-as session, time-box 1 hour                                                                                             |
| D11 | Who answers DSARs                           | Tenant answers; we provide the tools and a processor support SLA. Platform-owned data requests go to a privacy contact (name needed)                     |
| D12 | Legal review budget                         | Before P0 ships to tenants: counsel review of notice texts, DPA, regime defaults                                                                         |

## 10. This document is not legal advice

Needs a lawyer before relying on it:

1. Whether and where recording by announcement is enough versus explicit consent (one-party vs all-party US states, EU/UK, India, Gulf).
2. TCPA/CTIA treatment of automated or AI voice calls, and "prior express written consent" wording for marketing.
3. TRAI/DLT registration and DNC duties for India, and CERT-In 6-hour reporting scope.
4. DPDP Act 2023 duties for a processor, consent manager, notice content, children's data, and breach notice to the Board.
5. UAE and KSA PDPL: consent, localisation, transfer approvals.
6. GDPR roles, Art. 28 DPA content, transfer mechanisms (SCCs, adequacy) for each sub-processor, DPIA triggers (AI, voice).
7. Retention periods for invoices, tax and consent proof in each country, and the erasure-versus-retention balance.
8. Whether the personal WhatsApp (unofficial) channel can be offered at all in regulated markets, and what the risk notice must say.
9. Whether translation or AI vendors count as sub-processors needing prior notice to tenants, and the notice period.
10. Cookie law (which categories need prior consent) and the proof standard for cookie and terms acceptance.
11. Backup retention disclosure wording and whether "put beyond use" is accepted for the 12-month off-site copies.
12. Enforceability of the end-customer DSAR verification method.

## 11. Compliance center and regime profiles (BL-172 to BL-181)

Status: **design (this section) and first build (Compliance center v1)**. What is built and what is open is in 11.6, kept in step with the
code. The words in the product are always "tools to help you comply": nothing here is, or says, that a workspace is compliant.

### 11.1 Decision (owner, 15 Oct 2026)

The product is **global with no signup restriction**: anyone, anywhere, can open a workspace. So we do not build per-country versions.
We build one **strict superset baseline** that every workspace gets, and **regime profiles** that switch on the extras a particular law asks
for.

1. **Baseline for every workspace** (11.2): lawful basis and purpose recorded, real consent with easy withdrawal, versioned notices,
   data-subject rights, retention and deletion with legal holds, security and a breach runbook, a sub-processor list and a DPA template,
   a children flag. A workspace in a country with no privacy law still gets all of it.
2. **Regime profiles are workspace settings** (11.3), not code forks. A profile switches on extras (an officer contact, a bilingual notice,
   an opt-out notice, quiet hours, a DND hook) and raises the bar of the checklist. **Several profiles can be on at once, and the strictest
   rule wins** (11.4).
3. **The regime is suggested, never imposed.** The workspace's billing country (the latest paid order) or, when there is none, the country
   given at onboarding suggests profiles; a person with `settings.compliance.manage` accepts, changes or ignores the suggestion. A
   workspace that sells into other countries turns on more profiles by hand.
4. **HIPAA is not claimed and not supported.** We say so in onboarding and in the terms text ("do not store protected health information"),
   and 11.7 lists what would be needed. **SOC 2 and ISO 27001 are out of scope** (section 8.3 stands).
5. The roles of section 8.1 stand: the workspace is the controller (DPDP: data fiduciary) for its contacts, we are the processor. The
   Compliance center helps the workspace carry its duties; it does not carry them for it.

### 11.2 The baseline (every workspace)

| #   | Baseline point                          | What carries it                                                                                                                                                                           |
| --- | --------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| B1  | Lawful basis and purpose recorded       | the purpose registry (4.3.1) and the ledger, which keeps source, wording, version and time of every grant (4.3.2)                                                                         |
| B2  | Real consent, easy withdrawal           | STOP / START keywords, the email unsubscribe link, the switch "require recorded consent" (Settings, Consent); a first inbound message never creates a grant                               |
| B3  | Versioned notices                       | `consent_notices` (append-only versions) for the widget, booking pages, stores and the workspace default notice; the form builder's consent line keeps its version                        |
| B4  | Data-subject rights                     | `privacy_requests` (access, export, erasure, rectification, restriction, objection, portability, withdrawal) with identity check, deadline and proof                                      |
| B5  | Retention and deletion with legal holds | recording retention and hold (BL-144), legal hold on a request; the general retention engine is open (BL-146)                                                                             |
| B6  | Security and a breach runbook           | forced RLS, AES-GCM secrets, audit log; [breach-response-runbook.md](../privacy/breach-response-runbook.md) (skeleton, owner and counsel complete it)                                     |
| B7  | Sub-processor list and DPA template     | the workspace's editable list (Compliance center), the platform register ([subprocessor-register.md](../privacy/subprocessor-register.md)), [dpa-template.md](../privacy/dpa-template.md) |
| B8  | Children flag                           | `children_policy` on the workspace: not answered, "we do not knowingly process minors", or "minors may be included" (which asks for the strictest rules)                                  |
| B9  | A privacy contact and published links   | the DPO / privacy contact block, and the workspace privacy and terms links offered to every consent line                                                                                  |

### 11.3 Regime profiles: what each one switches on

`generic` is the baseline alone. A profile never lowers the baseline. "Needs counsel" applies to every number and obligation in this table:
it states design intent, not legal advice (section 10).

| Profile   | Suggested for        | Extras it switches on in the Compliance center                                                                                                                                                                | Answer time for a person's request | Marketing consent                  | Quiet hours / calling window (defaults offered) | Breach clock (documented, not automated) |
| --------- | -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------- | ---------------------------------- | ----------------------------------------------- | ---------------------------------------- |
| `gdpr_eu` | EU and EEA countries | a DPO or privacy contact is required on the checklist; sub-processor locations are required; the strictest minor age (16; member states 13 to 16) is shown with the children flag                             | 30 days                            | opt-in                             | none statutory                                  | 72 hours to the authority                |
| `uk_gdpr` | United Kingdom       | as `gdpr_eu`, plus PECR (opt-in for electronic marketing); minors under 13                                                                                                                                    | 30 days                            | opt-in                             | none statutory                                  | 72 hours to the ICO                      |
| `dpdp_in` | India                | **grievance officer** (name and contact) required; **notice in English and one Indian language**; **parental consent flag** for minors under 18; **consent manager placeholder** (name, link; no integration) | 30 days (inferred, not fixed)      | opt-in, withdrawable               | none beyond `trai_in`                           | Board and affected persons (CERT-In 6 h) |
| `ccpa_us` | United States        | **Do Not Sell or Share** switch and **opt-out notice** link                                                                                                                                                   | 45 days                            | opt-out (opt-in under 16 for sale) | none                                            | per state law                            |
| `tcpa_us` | United States        | **quiet hours** 21:00 to 08:00 and **calling window** 08:00 to 21:00 (stored; the contact's local time is a follow-up, see 11.5); **DNC registry hook**; recorded opt-in on the checklist                     | n/a                                | opt-in (written)                   | quiet 21:00 to 08:00, calling 08:00 to 21:00    | n/a                                      |
| `trai_in` | India                | **quiet hours** 21:00 to 09:00 and **calling window** 09:00 to 21:00 (stored, see 11.5); **DND (NDNC) hook**; recorded opt-in on the checklist                                                                | n/a                                | opt-in                             | quiet 21:00 to 09:00, calling 09:00 to 21:00    | CERT-In 6 hours                          |
| `lgpd_br` | Brazil               | a DPO (encarregado) contact on the checklist; sub-processor locations; the answer time of 15 days                                                                                                             | 15 days                            | opt-in                             | none statutory                                  | "reasonable time" to the ANPD            |
| `pdpa_sg` | Singapore            | a DPO contact required; Do Not Call registry hook for calls and texts                                                                                                                                         | 30 days                            | opt-in                             | none statutory                                  | 3 days to the PDPC when notifiable       |
| `generic` | every other country  | nothing extra                                                                                                                                                                                                 | 30 days                            | opt-in recommended                 | none                                            | n/a                                      |

Country to suggestion (`suggestRegimes`, pure code in `@crm/contracts`): the 27 EU states and Iceland, Liechtenstein, Norway: `gdpr_eu`;
GB: `uk_gdpr`; IN: `dpdp_in` and `trai_in`; US: `ccpa_us` and `tcpa_us`; BR: `lgpd_br`; SG: `pdpa_sg`; anything else: `generic`.

What a profile does **not** do yet: it does not record cookie consent, show a notice at collection, register DLT templates, check a registry, collect parental-consent evidence
or name a legal basis per purpose. Those belong to the baseline gaps G11 and G12 and to BL-177, BL-180 and BL-181. The Compliance center says only what it checks.

### 11.4 "The strictest wins": how profiles combine

`effectivePolicy(profiles)` (pure, tested) merges the switched-on profiles:

- **Marketing consent**: opt-in as soon as any profile asks for it (every profile above except `ccpa_us` alone). The Compliance center shows
  a hint and a link to the Consent settings; it does **not** flip the workspace switch for you (that would change sending without asking).
- **Answer time for requests**: the smallest number of days. The checklist compares it with the days set in Data requests.
- **Quiet hours and calling window**: the narrowest allowed window (latest start, earliest end) over the profiles that have one.
- **Minimum age** treated as a minor: the highest of the profiles' ages (18 when `dpdp_in` is on).
- **Extras**: the union. A requirement of any profile that is on appears on the checklist.

A profile that is switched off adds nothing, and nothing is switched on without a person confirming the choice (`regimes_confirmed_at`).

### 11.5 Quiet hours, calling windows, DND hooks

Stored per workspace: quiet hours for messages, a calling window and days for calls, the time zone they are read in (default: the
workspace's), and a DND registry choice (`none`, `trai_ndnc`, `us_dnc`, `sg_dnc`, `custom`). **Enforcement is a follow-up (BL-177), on
purpose.** The ConsentGate answers allow or deny for one send; a quiet hour needs a third answer, **defer until the window opens**, and a
dispatcher that holds the message and sends it later. A deny would silently drop a broadcast scheduled for 22:00. Until that exists the
pure helper `isInsideWindow` is tested and the checklist shows "stored, not enforced". Two further limits: the window should be read in
the **contact's** time zone (the ledger has no contact time zone yet), and a DND check needs a registry feed we do not have (the hook is a
setting and a design, no integration).

### 11.6 Built and open

| Id     | Item                                                                                                                                                                                             | State                                              |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------- |
| BL-172 | Regime profiles and the country suggestion; DPO and grievance officer contacts; children flag; DPDP, CCPA and DND settings (`compliance_settings`)                                               | built (v1)                                         |
| BL-173 | Sub-processor list (admin-editable) with an optional public page `/trust/<workspace>`, and the DPA template download                                                                             | built (v1)                                         |
| BL-174 | Compliance checklist: each baseline point and each switched-on profile requirement as built, partial or open, from real workspace data                                                           | built (v1)                                         |
| BL-175 | Privacy and terms links per workspace, offered to the form builder consent block and the consent-notice editor; optional `termsUrl` beside `privacyUrl`                                          | built (v1)                                         |
| BL-176 | Quiet hours and calling windows stored, with the pure window helper                                                                                                                              | built (v1); enforcement is BL-177                  |
| BL-177 | Enforce quiet hours and calling windows (defer, not deny) in the dispatcher, per contact time zone; DND registry check                                                                           | open                                               |
| BL-178 | HIPAA: the "do not store protected health information" notice in onboarding and the Compliance center; [hipaa-not-supported.md](../privacy/hipaa-not-supported.md)                               | built (notice, doc); the terms text is the owner's |
| BL-179 | Workspace default notice in English and one more language (`consent_notices`, scope `workspace`), offered to forms and the notice editor                                                         | built (v1)                                         |
| BL-180 | Contact-level extras: a minor tag per contact (the gate's `subject_minor`), parental-consent evidence, a per-contact "do not sell or share" opt-out, honouring the Global Privacy Control signal | open                                               |
| BL-181 | The integrations the placeholders stand for: a DPDP consent manager, a DNC / NDNC registry feed, a breach-notification workflow, the platform sub-processor register inside the app              | open (needs owner decisions and counsel)           |

### 11.7 HIPAA: not supported

We do not sign a Business Associate Agreement, we do not claim HIPAA, and workspaces must not store protected health information (PHI) in
the product. The notice is shown in onboarding and in the Compliance center, and the owner adds the clause to the terms (suggested wording
in [hipaa-not-supported.md](../privacy/hipaa-not-supported.md), together with what would be needed: a BAA, access controls and minimum
necessary, audit trails, encryption in transit and at rest, breach notification, vendor BAAs).

### 11.8 Decisions for the owner (from this section)

| #   | Decision                                                                                                              | Recommendation                                                 |
| --- | --------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| D13 | Should accepting a regime profile change the Consent switch ("require recorded consent") by itself?                   | No (today a hint and a link); a silent change would stop sends |
| D14 | Enforce quiet hours by deferring, which needs a "held until" state in the dispatcher and a contact time zone (BL-177) | Yes, after the contact time zone exists; never as a deny       |
| D15 | A public `/trust/<workspace>` page for the sub-processor list                                                         | Off by default, a switch per workspace (built so)              |
| D16 | The platform's own sub-processor register in the app (read-only) next to the workspace list                           | Yes once the owner fills the TODO columns of the register      |
| D17 | Add the "no PHI" clause to the platform terms and the signup checkbox text                                            | Yes; the wording in the HIPAA note is a draft for counsel      |
