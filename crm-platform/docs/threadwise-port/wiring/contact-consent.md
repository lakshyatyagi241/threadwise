# Wiring map: contact consent (CONSENT), a product extension

Not a reference feature; spec [contact-consent-ledger.md](../../specs/contact-consent-ledger.md), differences in
[product-extensions.md](../parity/product-extensions.md). Update it in the same change as any new route, table or consumer.

## Tables (migrations 20261121090000, 20261121090100)

| Table                                         | What                                          | Notes                                                                                                                                                    |
| --------------------------------------------- | --------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `contact_consent_events`                      | append-only history                           | forced RLS, composite FKs, trigger rejects UPDATE/DELETE (only `contact_id` / `actor_user_id` going NULL is allowed), unique `(org_id, idempotency_key)` |
| `contact_consent_state`                       | current state per (contact, channel, purpose) | written with the event in one transaction                                                                                                                |
| `contact_consent_settings`                    | one row per workspace                         | keywords, replies, footer, switches                                                                                                                      |
| `contacts.is_unsubscribed`, `unsubscribed_at` | roll-up                                       | any marketing channel withdrawn                                                                                                                          |

## API routes (all `/v2/contact-consent`)

| Method     | Path                                        | Permission                                                                        |
| ---------- | ------------------------------------------- | --------------------------------------------------------------------------------- |
| GET, PATCH | `/settings`                                 | `settings.consent.manage`                                                         |
| POST       | `/settings/test`                            | `settings.consent.manage`                                                         |
| GET        | `/composer-config`                          | `bcast.broadcasts.create` or `camp.campaigns.create` or `settings.consent.manage` |
| GET        | `/events`                                   | `contacts.consent.read`                                                           |
| GET        | `/export`                                   | `contacts.consent.manage`                                                         |
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
| Contact import engine (`consentConfirmed`)                                           | `import`          | whatsapp             |
| Form submit with a ticked marketing consent box                                      | `form`            | whatsapp and email   |

## Who reads it

Broadcast audience (`BroadcastsRepository.sendableIds`), campaign dispatch (`CampaignsRepository.screenRecipients`) and the wizard
count (`WizardAudienceService.count`) read the switch through `ConsentPolicyService` and the state through `hasGrantedConsentSql`.
Everything else still reads `contacts.is_unsubscribed`.

## Events

Outbox: `contact.consent.granted`, `contact.consent.withdrawn`, `contact.consent.settings_changed`; the existing `contact.opt_in` is
still emitted (flows' `opt_in` trigger and the `contact_opt_in` webhook), including for a keyword opt-out.

## Web

Settings tile `consent` (Security) -> `/contact-consent`; Consent card in `contact-detail.tsx`; opt-out line in the campaign builder
(`step-compose.tsx`) and a template hint in the broadcast composer; consent box in `import-modal.tsx`; count row in the wizard
`count-panel.tsx`. Help guide `contact-consent`.
