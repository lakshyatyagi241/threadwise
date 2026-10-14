# Wiring map: contact consent (CONSENT), a product extension

Not a reference feature; spec [contact-consent-ledger.md](../../specs/contact-consent-ledger.md), differences in
[product-extensions.md](../parity/product-extensions.md). Update it in the same change as any new route, table or consumer.

## Tables (migrations 20261121090000, 20261121090100)

| Table                                         | What                                                  | Notes                                                                                                                                                    |
| --------------------------------------------- | ----------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `contact_consent_events`                      | append-only history                                   | forced RLS, composite FKs, trigger rejects UPDATE/DELETE (only `contact_id` / `actor_user_id` going NULL is allowed), unique `(org_id, idempotency_key)` |
| `contact_consent_state`                       | current state per (contact, channel, purpose)         | written with the event in one transaction                                                                                                                |
| `contact_consent_settings`                    | one row per workspace                                 | keywords, replies, footer, switches                                                                                                                      |
| `contact_consent_exports`                     | asynchronous proof exports (migration 20261122090000) | forced RLS, composite FK to users; the gzip file lives on the row for 7 days; one `queued`/`running` row per workspace                                   |
| `contacts.is_unsubscribed`, `unsubscribed_at` | roll-up                                               | any marketing channel withdrawn                                                                                                                          |

## API routes (all `/v2/contact-consent`)

| Method     | Path                                        | Permission                                                                        |
| ---------- | ------------------------------------------- | --------------------------------------------------------------------------------- |
| GET, PATCH | `/settings`                                 | `settings.consent.manage`                                                         |
| POST       | `/settings/test`                            | `settings.consent.manage`                                                         |
| GET        | `/composer-config`                          | `bcast.broadcasts.create` or `camp.campaigns.create` or `settings.consent.manage` |
| GET        | `/events`                                   | `contacts.consent.read`                                                           |
| GET        | `/export`                                   | `contacts.consent.manage`                                                         |
| POST, GET  | `/exports`, `/exports/:id/download`         | `contacts.consent.manage` (POST takes an Idempotency-Key)                         |
| GET        | `/contacts/:uuid`, `/contacts/:uuid/export` | `contacts.consent.read`                                                           |
| POST       | `/contacts/:uuid/events`                    | `contacts.consent.manage` (Idempotency-Key)                                       |
| GET, POST  | `/api/v1/contacts/{id}/consent`             | API scopes `contacts:read`, `contacts:write`                                      |

## Who writes the ledger (every consumer)

| Writer                                                                               | Source            | Channel              |
| ------------------------------------------------------------------------------------ | ----------------- | -------------------- |
| `ConsentKeywordListener` (inbound hooks, worker, runs first)                         | `keyword`         | the thread's channel |
| `POST /v2/campaigns/node/unsubscribe` (`CampaignCallbacksService.unsubscribe`)       | `keyword`         | whatsapp             |
| SMS provider STOP (`SmsEngineSender.flagOptedOut`, Twilio 21610)                     | `keyword`         | sms                  |
| `ContactsService.create/update` (`isUnsubscribed`, also the REST v1 contacts routes) | `manual` or `api` | whatsapp             |
| Consent card / `POST /contact-consent/contacts/:uuid/events`                         | `manual`          | chosen               |
| Contact import engine (`consentConfirmed`, per-row with a mapped `consent` column)   | `import`          | whatsapp             |
| Form submit with a ticked marketing consent box                                      | `form`            | whatsapp and email   |

## Who reads it

Broadcast audience (`BroadcastsRepository.sendableIds`), campaign dispatch (`CampaignsRepository.screenRecipients`) and the wizard
count (`WizardAudienceService.count`) read the switch through `ConsentPolicyService` and the state through `hasGrantedConsentSql`.
Everything else still reads `contacts.is_unsubscribed`.

Worker: queue `consent-export` (`ConsentExportProcessor`, `ConsentExportRunner`) and a daily `ConsentExportSweepService`, both in
`ContactConsentWorkerModule`. The keyword listener also writes the thread's system line (`recordOutbound`, kind `system`).
The campaign wizard reads the switch for the count, the sample and the written recipient list (`WizardAudienceService`).

## Events

Outbox: `contact.consent.granted`, `contact.consent.withdrawn`, `contact.consent.settings_changed`; the existing `contact.opt_in` is
still emitted (flows' `opt_in` trigger and the `contact_opt_in` webhook), including for a keyword opt-out.

## Web

Settings tile `consent` (Security) -> `/contact-consent`; Consent card in `contact-detail.tsx`; opt-out line in the campaign builder
(`step-compose.tsx`) and a template hint in the broadcast composer; consent box and column summary in `import-modal.tsx`; proof exports panel in the settings screen (`proof-export.tsx`); the consent system line in `message-bubble.tsx`; the WhatsApp wording button in the Forms settings; count row in the wizard
`count-panel.tsx`. Help guide `contact-consent`.

## ConsentGate, purpose registry and email unsubscribe (BL-140, BL-141)

| Piece                 | Where                                                                                                                                                                                                                              |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Registry              | `packages/contracts/src/privacy/purposes.ts`; `GET /v2/consent/purposes` (`consent-purposes.controller.ts`)                                                                                                                        |
| Gate                  | `ConsentGate` (`consent-gate.service.ts`), rule `consent-gate.rules.ts`; exported by `ContactConsentModule`                                                                                                                        |
| Unsubscribe           | `consent-unsubscribe.{tokens,service,controller}.ts`; web `/u/[token]`, relay `/api/public/consent/*`; no new table, no migration                                                                                                  |
| Guard                 | `consent-gate.allowlist.ts` + `test/unit/contact-consent/consent-gate-guard.spec.ts`                                                                                                                                               |
| Consumers of the gate | chat-conversations (dispatcher, outbound, message dispatch), flow-runtime-engine (sender, schedule sweeper), scheduled-queue-warmer, appointments-booking worker, channel-sms, broadcasts, campaigns, calling-voice, channel-email |
| Error codes           | `CONSENT_OPTED_OUT`, `CONSENT_SEND_DENIED`, `CONSENT_UNSUBSCRIBE_LINK_INVALID`                                                                                                                                                     |
| Purposes used         | `marketing_messaging` (broadcasts, campaigns, schedules, SMS, MARKETING templates, business-started flows), `service_messaging` (replies, notices, dial)                                                                           |
