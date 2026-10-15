# Privacy-by-design checklist for a new feature

For any author adding a table, a column that holds a person's data, an outbound send, a call, an AI use or a third-party call. Copy the
list into the pull request and answer each line (yes, no, not applicable with a reason). Background:
[privacy-and-data-governance.md](../specs/privacy-and-data-governance.md).

## 1. Say what data and why

- [ ] Which data subject (contact, lead, end customer, staff, visitor)? Which categories (identifiers, contact, content, financial,
      voice, location, special-category risk)?
- [ ] Which purpose from the purpose registry? If none fits, propose a new one (name, lawful basis, retention, modalities, evidence).
      The registry is `packages/contracts/src/privacy/purposes.ts` (`GET /v2/consent/purposes`); a new purpose is added there in review.
- [ ] Is each field needed? Drop what you do not use. No free-text fields that invite sensitive data without a reason.
- [ ] Collected from a public form or endpoint? Add a visible notice, a rate limit, no account enumeration, and decide the consent line
      and where its text and version are stored.

## 2. Consent and sending

- [ ] Does the feature send a message, place a call, send an email or push, or process content with AI? Then it asks the ConsentGate
      (`apps/api/src/modules/contact-consent/consent-gate.service.ts`) with the right channel, purpose and modality.
- [ ] Does STOP / opt-out apply? It must. Does the feature need a footer or unsubscribe link? Email always does.
- [ ] Voice or recording involved? Read [voice-bot-consent-requirements.md](voice-bot-consent-requirements.md) first.
- [ ] Is any consent proof stored without IP address, user agent or message text (as the ledger does)?
- [ ] Does the feature collect a person's contact details from a page, an API or a store? A first message or a sign-up never grants marketing consent by itself ([spec 4.3.2](../specs/privacy-and-data-governance.md)): write a grant only when the person ticked a box or said yes, through `ConsentIntakeService`, with the wording, its version and the source as evidence, and create the contact through `ContactsService` (never a raw insert).

## 3. Where it lives

- [ ] New tenant table: forced RLS and composite FKs per [multi-tenancy.md](../architecture/multi-tenancy.md).
- [ ] Contact link uses `ON DELETE SET NULL` or a registered erase handler; say which and why.
- [ ] Files in storage: private prefix, signed access, listed in the purge queue on erase.
- [ ] Columns classified with a `pii` tag once the annotation exists; today, name them in the wiring register
      ([privacy-and-data.md](../threadwise-port/wiring/privacy-and-data.md)).
- [ ] Secrets and tokens encrypted with `apps/api/src/common/crypto/crypto.service.ts`, never stored plain.
- [ ] Retention: what is the default and who can change it? "Forever" needs a reason. Add a sweep or register the class.

## 4. Who sees it and where it goes

- [ ] Permission key for read, for export, for delete; none shared with a broader permission.
- [ ] Sensitive read (recording, export, bulk list) is audited.
- [ ] Logs: no phone numbers, message text, tokens or emails in log lines; check `apps/api/src/modules/platform-infrastructure/observability/log-redaction.ts`.
- [ ] Audit diffs: do they copy PII? Scrub or store field names only.
- [ ] Push or email notifications: no message text in the payload.
- [ ] Outbound webhooks / API responses: minimal fields; documented in the event catalogue.
- [ ] New external host or vendor: add it to [subprocessor-register.md](subprocessor-register.md); AI vendor: workspace switch, notice, and
      the "what leaves the system" statement as in [help-agent-assistant.md](../specs/help-agent-assistant.md).
- [ ] Translation or enrichment of personal data: official vendor only, switch per workspace.

## 5. Rights

- [ ] Export: how does a person's data in this feature come out (CSV/JSON, files)?
- [ ] Erasure: delete or anonymise? Legal-hold exceptions (invoices, consent proof)?
- [ ] Rectification: can the data be corrected from the UI?
- [ ] Wiring register updated (table, subject column, storage prefix, retention, erase, export) in the same change.
- [ ] Test: the DSAR registry test (once built) passes; until then add a test that erasing a contact leaves nothing identifying in the
      feature's tables.

## 6. Children, special categories, abroad

- [ ] Could the feature collect data about minors or health, religion, biometrics, finances? If yes, ask the owner before building.
- [ ] Does data cross a border through a new vendor? Record the region in the sub-processor register.

## 7. Docs and help

- [ ] Help guide says what is stored, for how long, and how to delete it.
- [ ] If the feature changes what the workspace must tell its customers, update the notice templates.
- [ ] If the feature adds a product extension, add it to `docs/threadwise-port/parity/product-extensions.md`.

## How a new module plugs into the ConsentGate

1. Import `ContactConsentModule` and inject `ConsentGate`.
2. One contact: `await gate.check(orgId, { type: 'contact', id }, channelKindOrConsentChannel, 'marketing_messaging' | 'service_messaging', modality?, { replyWindowOpen? })`.
   A whole audience: `await gate.checkMany(orgId, contactIds, channel, purpose, modality?, { tx })`, once, never in a loop. Use
   `result.allowed` and count skips with `result.counts` (closed reasons).
3. Chat channels: do not call an adapter. Go through `ChannelDispatcher`; its request has a required `consent: { purpose, contactId? }`, so
   the compiler reminds you. A template's purpose comes from `dispatcher.purposeFor(...)`.
4. Pick the purpose by what the message IS: a reply, a notice the customer expects, an order or appointment message is
   `service_messaging` (STOP does not stop it); a promotion, a campaign, a drip or a MARKETING template is `marketing_messaging`.
5. Deny means do not send and tell the person why (`CONSENT_OPTED_OUT`, `CONSENT_SEND_DENIED`); there is no override. The gate fails
   closed for marketing and open for service replies, so you add no try/catch of your own.
6. Email marketing: set `email.marketing: true`; the adapter adds the unsubscribe link and the RFC 8058 headers.
7. Run `pnpm --filter @crm/api test -- consent-gate-guard`. A file that uses a send primitive without the gate fails it unless it is in
   `consent-gate.allowlist.ts` with a reason.
