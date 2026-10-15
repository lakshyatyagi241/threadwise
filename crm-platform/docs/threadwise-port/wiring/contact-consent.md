# Wiring map: contact consent (CONSENT), a product extension

Not a reference feature; spec [contact-consent-ledger.md](../../specs/contact-consent-ledger.md), differences in
[product-extensions.md](../parity/product-extensions.md). Update it in the same change as any new route, table or consumer.

## Tables (migrations 20261121090000, 20261121090100)

| Table                                         | What                                                                                | Notes                                                                                                                                                                                                                                                     |
| --------------------------------------------- | ----------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `contact_consent_events`                      | append-only history                                                                 | forced RLS, composite FKs, trigger rejects UPDATE/DELETE (only `contact_id` / `actor_user_id` going NULL is allowed), unique `(org_id, idempotency_key)`                                                                                                  |
| `contact_consent_state`                       | current state per (contact, channel, purpose)                                       | written with the event in one transaction                                                                                                                                                                                                                 |
| `contact_consent_settings`                    | one row per workspace                                                               | keywords, replies, footer, switches                                                                                                                                                                                                                       |
| `contact_consent_exports`                     | asynchronous proof exports (migration 20261122090000)                               | forced RLS, composite FK to users; the gzip file lives on the row for 7 days; one `queued`/`running` row per workspace                                                                                                                                    |
| `contacts.is_unsubscribed`, `unsubscribed_at` | roll-up                                                                             | any marketing channel withdrawn                                                                                                                                                                                                                           |
| `contact_privacy_events`                      | append-only history of the contact privacy flags (migration 20261216090000, BL-180) | forced RLS, composite FKs, trigger rejects UPDATE/DELETE (only `contact_id` / `actor_user_id` going NULL), unique `(org_id, idempotency_key)`; kinds `minor`, `guardian_consent`, `sale_share_opt_out`; sources `manual`, `api`, `contact_request`, `gpc` |
| `contact_privacy_flags`                       | current value of each flag per contact (same migration)                             | PK `(org_id, contact_id)`, cascades with the contact; written with the event in one transaction; the gate reads it with one primary-key lookup                                                                                                            |
| `consent_notices`                             | versioned consent wording per intake point (migration 20261203090000, BL-167)       | forced RLS, composite FK to users, append-only trigger; scope `widget` / `booking` / `commerce` + ref; no personal data; the migration also adds the sources `widget`, `booking`, `commerce` to `ck_consent_events_source`                                |

## API routes (all `/v2/contact-consent`)

| Method     | Path                                        | Permission                                                                                                                                       |
| ---------- | ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| GET, PATCH | `/settings`                                 | `settings.consent.manage`                                                                                                                        |
| POST       | `/settings/test`                            | `settings.consent.manage`                                                                                                                        |
| GET        | `/composer-config`                          | `bcast.broadcasts.create` or `camp.campaigns.create` or `settings.consent.manage`                                                                |
| GET        | `/events`                                   | `contacts.consent.read`                                                                                                                          |
| GET        | `/export`                                   | `contacts.consent.manage`                                                                                                                        |
| POST, GET  | `/exports`, `/exports/:id/download`         | `contacts.consent.manage` (POST takes an Idempotency-Key)                                                                                        |
| GET        | `/contacts/:uuid`, `/contacts/:uuid/export` | `contacts.consent.read`                                                                                                                          |
| POST       | `/contacts/:uuid/events`                    | `contacts.consent.manage` (Idempotency-Key)                                                                                                      |
| GET, POST  | `/api/v1/contacts/{id}/consent`             | API scopes `contacts:read`, `contacts:write`                                                                                                     |
| POST       | `/contacts/:uuid/privacy-events`            | `contacts.consent.manage` (Idempotency-Key): minor, guardian consent, Do Not Sell or Share (BL-180)                                              |
| GET, PUT   | `/notices/:scope/:ref`                      | `settings.consent.manage` (scope `widget`, `booking`, `commerce`; ref = widget or booking type uuid, or `shopify:<uuid>` / `woocommerce:<uuid>`) |

## Who writes the ledger (every consumer)

| Writer                                                                                                                                                                                             | Source            | Channel                                                                                                               |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------- | --------------------------------------------------------------------------------------------------------------------- |
| `ConsentKeywordListener` (inbound hooks, worker, runs first)                                                                                                                                       | `keyword`         | the thread's channel                                                                                                  |
| `POST /v2/campaigns/node/unsubscribe` (`CampaignCallbacksService.unsubscribe`)                                                                                                                     | `keyword`         | whatsapp                                                                                                              |
| SMS provider STOP (`SmsEngineSender.flagOptedOut`, Twilio 21610)                                                                                                                                   | `keyword`         | sms                                                                                                                   |
| `ContactsService.create/update` (`isUnsubscribed`, also the REST v1 contacts routes)                                                                                                               | `manual` or `api` | whatsapp                                                                                                              |
| Consent card / `POST /contact-consent/contacts/:uuid/events`                                                                                                                                       | `manual`          | chosen                                                                                                                |
| Contact import engine (`consentConfirmed`, per-row with a mapped `consent` column)                                                                                                                 | `import`          | whatsapp                                                                                                              |
| Form submit with a ticked consent box                                                                                                                                                              | `form`            | the channels the form's consent line names (`consent.channels`), each only when the form collected its phone or email |
| Website chat widget: the pre-chat consent line ticked (`WidgetPublicService.recordConsent`, BL-167)                                                                                                | `widget`          | the notice's `channels` (default whatsapp and email), each only when the visitor gave its phone or email              |
| Booking page: the consent line ticked (`PublicBookingService.book` -> `ContactLinkService`)                                                                                                        | `booking`         | the notice's `channels` (default whatsapp and email), each only when the invitee gave its phone or email              |
| Shopify / WooCommerce customer sync with the store's own marketing flag, only when the store's consent line is on (`SqlStoreMirror.upsertCustomer`)                                                | `commerce`        | email, sms, whatsapp (if the notice says so)                                                                          |
| `ContactsService.create/update` with a status set to `subscribed` or a `consent` block (CRM form, REST v1, partner and public lead submit, Sheets add-on rows) via `ConsentIntakeService` (BL-165) | `manual` or `api` | whatsapp, sms, email                                                                                                  |

Privacy flags (BL-180) are written by `ContactPrivacyService.changeInTx`: the Consent card and `POST /contacts/:uuid/privacy-events` (`manual`, `api`, `contact_request`), and the Global Privacy Control signal on a public form submission (`FormSubmitService.recordGpc`) and a chat widget message (`WidgetPublicService.recordGpc`), source `gpc`, only when `compliance_settings.regimes` has `ccpa_us`. None of them writes `contact_consent_events`.

The channel choice of the form, widget and booking lines: forms keep `consent.channels` in the form definition (`consentChannels()` in
contracts; absent means the old rule, whatsapp and email, sms with `coversSms`); the widget and booking notices keep it in
`consent_notices.channels` (`noticeGrantChannels()`; empty means whatsapp and email, never sms). The editors write the chosen channels into the
sentence. A form's settings also say which channels the form cannot collect (`formCollects()`).

## Who reads it

Broadcast audience (`BroadcastsRepository.sendableIds`), campaign dispatch (`CampaignsRepository.screenRecipients`) and the wizard
count (`WizardAudienceService.count`) read the switch through `ConsentPolicyService` and the state through `hasGrantedConsentSql`.
Everything else still reads `contacts.is_unsubscribed`. The ConsentGate also reads `contact_privacy_flags` (minor, guardian consent, sale / share opt-out) in the same statement as the ledger state, and `compliance_settings` (children policy, parental consent) through `ConsentPolicyService.minorRule` (cached 60 s, dropped by the Compliance center save).

Worker: queue `consent-export` (`ConsentExportProcessor`, `ConsentExportRunner`) and a daily `ConsentExportSweepService`, both in
`ContactConsentWorkerModule`. The keyword listener also writes the thread's system line (`recordOutbound`, kind `system`).
The campaign wizard reads the switch for the count, the sample and the written recipient list (`WizardAudienceService`).

## Events

Outbox: `contact.consent.granted`, `contact.consent.withdrawn`, `contact.consent.settings_changed`, `contact.privacy.changed` (BL-180); the existing `contact.opt_in` is
still emitted (flows' `opt_in` trigger and the `contact_opt_in` webhook), including for a keyword opt-out.

## Web

Settings tile `consent` (Security) -> `/contact-consent`; Consent card in `contact-detail.tsx` (with the Privacy flags part, `privacy-flags.tsx`, and the minor / guardian / Do Not Sell or Share badges in the contact header, `privacy-badges.tsx`); opt-out line in the campaign builder
(`step-compose.tsx`) and a template hint in the broadcast composer; consent box and column summary in `import-modal.tsx`; proof exports panel in the settings screen (`proof-export.tsx`); the consent system line in `message-bubble.tsx`; the WhatsApp wording button in the Forms settings; count row in the wizard
`count-panel.tsx`; `ConsentNoticeEditor` (`components/consent-notice-editor.tsx`) is mounted in the chat widget builder (the intake step and the website bot Customize tab), the booking type editor (Messaging step) and the Shopify / WooCommerce Settings tab. Help guide `contact-consent`.

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

## Intake round 2 (BL-168 to BL-171)

| Path                           | Code                                                                                                                                                                | Writes                                                                                                   |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| Lead webhook / connector proof | `leads/lead-consent.ts`, `LeadIngestService.recordConsent`, `recipe-mapper.ts` (`consentOf`), `lead-hooks.service.ts`                                               | ledger grant source `lead` (migration 20261205090000)                                                    |
| Click-to-WhatsApp referral     | `chat-conversations/ad-referral.ts`, `InboundIngestService.store`                                                                                                   | `contact_attributions` touch with `evidence`, `external_ref` (migration 20261205090100); NO ledger event |
| Contact import                 | `contact-import.engine.ts` (`importChannelsOf`), `import-rows.ts`, contract `contact-import.ts`; web `import-consent.tsx`                                           | ledger grants source `import`, channels whatsapp / sms / email                                           |
| Wizard CSV                     | `wizard-csv.service.ts` (`grantConsent`), `wizard-audience.service.ts` (`grantedSql`), `camp_wizard_csv.consent_*` (migration 20261205090200); web `csv-upload.tsx` | ledger grants at launch, source `import`                                                                 |
| Web forms                      | `forms-builder/form-consent.ts`, `form-submit.service.ts` (`subscribe`, `recordServiceAgreement`); builder switch in `settings-tab.tsx`                             | marketing grants (+ sms) or `utility` events, source `form`                                              |
| Consent card                   | `consent-card.tsx` shows `utility` states and events as service agreement, never as a subscription                                                                  | none                                                                                                     |

## Contact privacy flags (BL-180)

| Piece        | Where                                                                                                                                                                                                                                                     |
| ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Contracts    | `packages/contracts/src/contact-consent/privacy.ts` (`recordPrivacyFlagSchema`, `ContactPrivacy`, `minorRuleOf`), `privacy/gate.ts` reasons `subject_minor`, `sale_share_opted_out`, evidence key `guardianConsentRef`, error `CONSENT_PRIVACY_NOT_MINOR` |
| Rules (pure) | `contact-privacy.rules.ts` (`planFlagChange`, `isGpcSignal`), `consent-gate.rules.ts` (`isHeldAsMinor`)                                                                                                                                                   |
| Service, SQL | `contact-privacy.service.ts`, `contact-privacy.repository.ts`; route in `consent.controller.ts`; `ContactConsentService.forContact` returns `privacy`                                                                                                     |
| Gate         | `consent-gate.service.ts` joins `contact_privacy_flags` in `factRows`; `consent-policy.service.ts` `minorRule` / `invalidateMinorRule` (called by `compliance-settings.service.ts` on save)                                                               |
| Public doors | `forms-builder/public-forms.controller.ts` (`gpc` in the request meta) -> `form-submit.service.ts`; `chatbot-widget/widget-public.controller.ts` -> `widget-public.service.ts`; web relay `app/api/public/forms/[...path]/route.ts` forwards `sec-gpc`    |
| Registry     | `privacy/manifests/contacts.ts` holder `consent.ledger`: `contact_privacy_events` (unlinked, kept as proof), `contact_privacy_flags` (cascade)                                                                                                            |
| Tests        | `test/unit/contact-consent/contact-privacy.spec.ts`, `test/e2e/contact-consent/contact-privacy.e2e.spec.ts`, `consent-card.test.tsx`, `messages.test.ts`                                                                                                  |
| Help         | `features/contact-consent/help/contact-consent.md` (+ `.ar.md`), section "Minors, guardian consent and Do Not Sell or Share"; `compliance-center.md` children paragraph                                                                                   |
