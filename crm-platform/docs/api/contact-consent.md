# Contact consent API

Product extension (spec [contact-consent-ledger.md](../specs/contact-consent-ledger.md)). Errors are problem+json with a stable `code`.

## Workspace API (`/v2/contact-consent`, session or bearer user)

| Route                                            | Permission                | Notes                                                                                                                                                                                                                                      |
| ------------------------------------------------ | ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `GET /settings`                                  | `settings.consent.manage` | Defaults when never saved: detection on, auto reply on, policy off                                                                                                                                                                         |
| `PATCH /settings`                                | `settings.consent.manage` | Whole document; `rowVersion` absent on the first save. 409 `ROW_VERSION_CONFLICT`, 422 `CONSENT_SETTINGS_INVALID`                                                                                                                          |
| `POST /settings/test`                            | `settings.consent.manage` | `{ text, optOutKeywords?, optInKeywords? }` gives `{ match, keyword, lang, reply, outcome }`; changes and sends nothing                                                                                                                    |
| `GET /composer-config`                           | any composer permission   | Footer text, its default, the policy switch                                                                                                                                                                                                |
| `GET /events?limit&cursor&channel&action&source` | `contacts.consent.read`   | Newest recorded first                                                                                                                                                                                                                      |
| `GET /contacts/:uuid`                            | `contacts.consent.read`   | `{ contactId, optedOut, states[], events[] }`                                                                                                                                                                                              |
| `POST /contacts/:uuid/events`                    | `contacts.consent.manage` | `{ action: granted or withdrawn, channel, purpose, note, evidence }`. A grant needs `note` (422 `CONSENT_NOTE_REQUIRED`). `Idempotency-Key` makes a repeat record nothing (409 `CONSENT_IDEMPOTENCY_MISMATCH` if reused for another event) |
| `GET /contacts/:uuid/export`, `GET /export`      | read / manage             | CSV with formula-safe cells; the workspace export is capped at 50,000 rows (`X-Export-Truncated: true`)                                                                                                                                    |
| `POST /exports`                                  | `contacts.consent.manage` | Prepares the whole ledger in the background (202, `Idempotency-Key`). One at a time: 409 `CONSENT_EXPORT_IN_PROGRESS`. The requester is emailed when it is ready                                                                           |
| `GET /exports`                                   | `contacts.consent.manage` | `{ data[], ledgerRows, needsAsync }`: the latest 20 (status `queued`, `running`, `ready`, `failed`, `expired`) and whether the ledger is larger than the direct download                                                                   |
| `GET /exports/:id/download`                      | `contacts.consent.manage` | The finished CSV (same lines as `GET /export`), kept 7 days. 404 `CONSENT_EXPORT_NOT_FOUND`, 409 `CONSENT_EXPORT_NOT_READY`                                                                                                                |

## Customer REST API v1

`GET /api/v1/contacts/{id}/consent` (scope `contacts:read`) and `POST /api/v1/contacts/{id}/consent` (scope `contacts:write`, the
source is stored as `api`). The existing `is_unsubscribed` field keeps working and now also writes the ledger.

## Events

`contact.consent.granted`, `contact.consent.withdrawn` (payload: contactId, channel, purpose, source, eventId),
`contact.consent.settings_changed`.

## Contact import

`POST /v2/contacts/import` and `/preview` accept a column mapped to the field `consent` (yes / no per row). With
`consentConfirmed: true` only the rows that say yes get a `granted` event (source `import`); the preview answers
`consent { granted, notGranted, unrecognised, unrecognisedSamples }`. Without the confirmation the column is ignored.

## Inbox

A STOP / START that changes the state adds a `system` message to the thread; the message carries
`systemEvent { event: "consent", action: "withdrawn" | "granted", keyword }` (see the messages contract).

## Purposes (`GET /v2/consent/purposes`)

Needs one of `bcast.broadcasts.create`, `camp.campaigns.create`, `settings.consent.manage`. Returns `{ requireConsentForMarketing,
purposes[] }`; each purpose has `id`, `lawfulBasis`, `consentMandatory`, `ledgerPurpose` (`marketing`, `utility` or null), `modalities`,
`channels` (list or `*`), `defaultRetention[]`, `evidenceRequired[]`, `noticeKey`, `noticeRequired`, `labelKey` and `descriptionKey` (locale
keys in `contact-consent.purposes.<id>`), and `enforcedAsGrant` (the gate refuses a send without a recorded grant in this workspace now).
The `purpose` of `POST /contacts/:uuid/events` is still `marketing` or `utility`.

## Email unsubscribe (public, no login)

| Route                                        | Notes                                                                                                                                                                                      |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `GET /v2/public/consent/unsubscribe/:token`  | `{ valid: true, unsubscribed }`; 404 `CONSENT_UNSUBSCRIBE_LINK_INVALID` for an altered or unknown token. 60 per minute per IP                                                              |
| `POST /v2/public/consent/unsubscribe/:token` | Writes `withdrawn` (channel `email`, purpose `marketing`, source `contact_request`, evidence `reference`). Idempotent per day. 20 per minute per IP. This is the RFC 8058 one-click target |

The token is `base64url("1.<org>.<contact>").<HMAC-SHA256>`: two numbers, no name, address or phone, no expiry (a mail is opened years
later). The key is derived from `CREDENTIALS_ENCRYPTION_KEY` and its previous keys, so a rotation keeps old links valid. The web page is
`/u/<token>` (en, ar and the 19 other locales; it asks first and unsubscribes on the button, so a mail scanner opening the link changes
nothing). A marketing email (`email.marketing: true` on the outbound envelope) is sent with the link in the text and the headers
`List-Unsubscribe: <https://<api>/v2/public/consent/unsubscribe/<token>>` and `List-Unsubscribe-Post: List-Unsubscribe=One-Click`; it is
refused (`MAIL_SEND_REFUSED`) when the recipient is not a contact, so there is always a way out.

## ConsentGate: where it is asked

Errors a refused send returns: 422 `CONSENT_OPTED_OUT` (the contact withdrew) or 422 `CONSENT_SEND_DENIED` (the strict switch is on and
there is no recorded grant). There is no override.

| Send path (file)                                                                              | Purpose                                                                             | Before                 | Now                                                                   |
| --------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- | ---------------------- | --------------------------------------------------------------------- |
| Dispatcher `chat-conversations/channel-dispatcher.service.ts` (every chat channel)            | caller's purpose, required on every request                                         | none                   | queue time and send time; deny stops the send                         |
| Inbox manual send `outbound.service.ts`, `message-dispatch.service.ts`                        | reply or utility template: service; MARKETING template: marketing                   | none                   | marketing template to a withdrawn contact refused, no row stored      |
| Developer REST send `message-send.service.ts` (text, files via the inbox; pin via dispatcher) | service; template send by category                                                  | none                   | same path as the inbox                                                |
| FAQ / AI auto-reply `faq-knowledge/faq-answer.service.ts` (via the inbox queue)               | service (reply)                                                                     | none                   | allowed after STOP (service), gate on the dispatcher                  |
| Flow send nodes `flow-sender.service.ts`                                                      | template: category; plain: marketing for business-started runs, service for replies | none                   | withdrawn contact skipped and noted in the run log                    |
| Flow copy-to-number `number-sender.service.ts`                                                | service                                                                             | none                   | passes through the gate                                               |
| Flow schedule triggers `triggers/schedule.sweeper.ts`                                         | marketing                                                                           | flag in SQL            | gate `checkMany` on top of the SQL filter                             |
| Scheduled messages `scheduled-run.service.ts`, `audience/schedule-audience.service.ts`        | marketing (utility/auth template: service)                                          | flag at save time only | gate at save time and again per batch at send time                    |
| Appointment confirmations and reminders `appointment-message.consumer.ts`                     | service                                                                             | none                   | allowed after STOP; refused only if service was withdrawn             |
| SMS `channel-sms/sms-engine.sender.ts`                                                        | marketing                                                                           | flag + Twilio 21610    | gate on the contact (flag, sms ledger, switch); 21610 kept            |
| Broadcasts `broadcasts.service.ts`                                                            | marketing                                                                           | private predicate      | `checkMany` (whatsapp)                                                |
| Campaigns `campaign-dispatch.service.ts`                                                      | marketing                                                                           | private predicate      | `checkMany` (whatsapp) after the flag and duplicate screen            |
| Outbound dial `calling-voice/call-actions.service.ts`                                         | service, voice modality                                                             | none                   | refused only if the contact withdrew service; no campaign calls exist |
| Email reply `channel-email/email-channel.adapter.ts`                                          | service; marketing when `email.marketing`                                           | none                   | link and RFC 8058 headers on marketing mail                           |
| Growth pilot digests `growth-pilot`                                                           | none (creates tasks and notes, sends nothing)                                       | n/a                    | the flows it starts are gated by the flow sender                      |
| Web push                                                                                      | staff-facing                                                                        | n/a                    | not gated (registry entry `push_notifications` only)                  |

Notice-first purposes (`call_recording`, `voice_ai_conversation`) answer `needs_notice` until the caller passes `options.noticeEvidence = { delivered, consent? }`. With the
evidence: a consent-based purpose (`call_recording`) is `allow` (`consent_evidence_recorded`) only when `consent` is `granted` and `deny` (`consent_declined`) when it is `declined`; a
notice-only purpose is `allow` (`notice_delivered`). `options.purposeEnabled = false` answers `deny` / `purpose_not_enabled` first (the workspace switch; call recording is off by
default). The adopter is `calling-voice/call-recording-consent.service.ts` (BL-144).

Not yet on the gate (allow-list entries marked KNOWN GAP): Telegram, Facebook and Instagram broadcasts, commerce (Shopify / WooCommerce)
broadcasts, the send-time re-check inside the broadcast dispatcher, the campaign wizard preview counts, `ai_content_processing` and
`third_party_sharing` as workspace switches, quiet hours and calling windows.
