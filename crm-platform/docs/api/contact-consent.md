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
| `POST /contacts/:uuid/privacy-events`            | `contacts.consent.manage` | Turn a privacy flag on or off: `{ kind: minor, guardian_consent or sale_share_opt_out, value, note, evidence, source }` (BL-180, below). Answers the contact consent view                                                                  |
| `GET /contacts/:uuid/export`, `GET /export`      | read / manage             | CSV with formula-safe cells; the workspace export is capped at 50,000 rows (`X-Export-Truncated: true`)                                                                                                                                    |
| `POST /exports`                                  | `contacts.consent.manage` | Prepares the whole ledger in the background (202, `Idempotency-Key`). One at a time: 409 `CONSENT_EXPORT_IN_PROGRESS`. The requester is emailed when it is ready                                                                           |
| `GET /exports`                                   | `contacts.consent.manage` | `{ data[], ledgerRows, needsAsync }`: the latest 20 (status `queued`, `running`, `ready`, `failed`, `expired`) and whether the ledger is larger than the direct download                                                                   |
| `GET /exports/:id/download`                      | `contacts.consent.manage` | The finished CSV (same lines as `GET /export`), kept 7 days. 404 `CONSENT_EXPORT_NOT_FOUND`, 409 `CONSENT_EXPORT_NOT_READY`                                                                                                                |

## Customer REST API v1

`GET /api/v1/contacts/{id}/consent` (scope `contacts:read`) and `POST /api/v1/contacts/{id}/consent` (scope `contacts:write`, the
source is stored as `api`). The existing `is_unsubscribed` field keeps working and now also writes the ledger.

## Intake: how a grant is written when a person agrees (BL-165)

POLICY: a first inbound message permits replying only and NEVER creates a marketing grant; a grant is written only when the person
agreed, with source, wording, version and time as evidence ([spec 4.3.2](../specs/privacy-and-data-governance.md)). A subscription
status (`whatsappSubscriptionStatus`, `smsSubscriptionStatus`, `emailSubscriptionStatus`) is a label, not proof.

`consent` block (contracts `consentProofSchema`; accepted by `POST /v2/contacts`, `PATCH /v2/contacts/:id`, the REST v1 contact routes
(snake_case keys, same fields), `POST /v2/partner/leads` and `POST /public/v1/leads`):

| Field      | Meaning                                                                                                                                                                                                     |
| ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `channels` | `whatsapp`, `sms`, `email`. Omitted: the channels whose status this write sets to `subscribed`; else the channels the contact can be reached on (phone: WhatsApp, address: email). SMS only when asked for. |
| `note`     | How the person agreed (what they said or signed, and where). Up to 500 characters.                                                                                                                          |
| `text`     | The wording they were shown (300 characters kept in the evidence, SHA-256 of the whole text beside it).                                                                                                     |
| `version`  | The version of that wording.                                                                                                                                                                                |
| `at`       | When they agreed; clamped to now if it is in the future.                                                                                                                                                    |

Rules: a status set to `subscribed` (and not stored as subscribed already) or a `consent` block is a claim. It needs a `note` or `text`
(else **422 `CONSENT_NOTE_REQUIRED`**, nothing written), it cannot sit beside `isUnsubscribed: true`, it appends one `granted` event per
channel in the same transaction as the contact write, and it never overrides a withdrawal. A `create` that matches an existing contact
records the grant on that contact. Source: `manual` for a staff session, `api` for a key, the partner portal and the Sheets add-on.
Sheets rows use the cells `consent` (yes) and `consent_note`; a yes without a note fails that row; no or blank changes nothing.

### Consent notices (`/v2/contact-consent/notices/:scope/:ref`, BL-167)

Scope `workspace` (BL-179, [compliance.md](compliance.md)) is the workspace's default wording: `ref` is a language code (`en`, `hi`), one notice per language, same versioning.

`GET` and `PUT` (permission `settings.consent.manage`). `scope` is `widget` (ref: the widget id), `booking` (the booking type id) or `commerce`
(`shopify:<integration id>` or `woocommerce:<integration id>`). A notice is `{ enabled, text, url, termsUrl, channels }` (`termsUrl` is the optional terms link next to the privacy link `url`, BL-175; additive, an older client that does not send it stores null); every change to any of them
appends the next numbered **version** (a repeat writes nothing, rows are append-only). An enabled notice needs its wording (422), the link must be
https (422), an unknown widget, booking type or store is 404 `CONSENT_NOTICE_TARGET_NOT_FOUND`, and another workspace's id is the same 404.
`channels: ["whatsapp"]` is for stores only: it makes the store's marketing checkbox count for WhatsApp too.

Where the notice is used:

- **Chat widget**: `GET /widget/<token>/api/config` returns `widget.consent { text, version, url }` only when the line is on and the form asks for a
  phone or an email. `POST /widget/<token>/api/message` takes `consent: true` and `consent_version`. A grant is written (source `widget`, channels
  whatsapp for a phone and email for an address, evidence `widgetId`, `noticeVersion`, `noticeUrl`, the wording and its hash) only when the box was
  ticked, the version is a real version of that widget's notice, and the thread has a contact. A message without the tick grants nothing.
- **Booking page**: `GET /v2/public/booking/:org/:type` returns `service.consent`; `POST .../book` takes `consent { given, version }`. Source
  `booking`, evidence `bookingTypeId`, `noticeVersion`, `noticeUrl`. Booking never needs the tick.
- **Stores**: while syncing customers (import and customer webhooks) the store's own flag is read: Shopify `email_marketing_consent` and
  `sms_marketing_consent` with state `subscribed` (time from `consent_updated_at`), or the older `accepts_marketing` for email; WooCommerce has no
  such flag, so only a checkout plugin's `meta_data` entry `accepts_marketing` or `marketing_consent` is read (email). `pending`, `unsubscribed` and
  `not_subscribed` are not consent. It is recorded only when the store's notice is on; source `commerce`, evidence `integrationId`, `noticeVersion`,
  `noticeUrl`, `storeFlag`; once per customer and wording version. A customer who later unsubscribes in the store is not withdrawn here (follow-up).

## Events

`contact.consent.granted`, `contact.consent.withdrawn` (payload: contactId, channel, purpose, source, eventId),
`contact.consent.settings_changed`, and `contact.privacy.changed` (payload: contactId, kind, value, source, eventId; BL-180).

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

## Intake, round 2 (BL-168 to BL-171)

- **Lead capture (BL-168).** `NormalisedLead.consent` / `ConnectorLead.consent`: `{ given, text, version, at, formId, adId, channels }`.
  The generic lead webhook reads a top-level `consent` object or flat `consent_given`, `consent_text`, `consent_version`, `consent_at`,
  `consent_form_id`, `consent_ad_id`, `consent_channels` keys (nothing deeper is searched, no alias guesses). A marketplace recipe maps it with
  the optional `mapping.consent` block. A grant (source `lead`, evidence `leadSourceId`, `leadFormId`, `adId`, `consentText`,
  `consentHash`, `consentVersion`, time = `at` clamped to now) is written only when the sender says yes AND names wording, version, form or ad.
  Channels: the ones named, else WhatsApp for a phone and email for an address; SMS only when named. A test lead and a person who opted out
  are never granted; the status labels are filled only on a channel that got the grant.
- **Click-to-WhatsApp (BL-169).** The Meta `referral` of a first message is stored as a `contact_attributions` touch (`platform`
  `click_to_whatsapp`, `ad` = the ad id, `evidence` = source type/id/url, headline, body, click id; `external_ref` = `ctwa:<message id>`
  makes a redelivery write one touch). The ledger is untouched.
- **Contact import (BL-170).** Options `consentNoticeText` (2000) and `consentNoticeVersion` (64) go into the evidence of every grant of the
  file. New mappable columns `consentSms` and `consentEmail` (headers like `SMS consent`, `Email opt-in`); the preview returns
  `consentSms` and `consentEmail` counts. Per row, with the confirmation: WhatsApp as before, SMS only from a yes in its column, email only
  from a yes in its column on a row with an address.
- **Broadcast wizard CSV (BL-170).** `POST /v2/broadcast-wizard/csv` takes an `options` JSON field (`consentConfirmed`, `consentNoticeText`,
  `consentNoticeVersion`) stored on the upload (`camp_wizard_csv`); the report returns `consentConfirmed` and `consentNoticeVersion`. At launch
  every contact the file's numbers belong to gets one WhatsApp grant (source `import`, `reference: wizard_csv:<upload>`), never over an opt-out;
  with the workspace switch ON those numbers count as consented before launch.
- **Web forms (BL-171).** `consent.channels` on the form definition (absent: WhatsApp, email, and SMS with `coversSms`). A ticked marketing line grants only the chosen channels the form collected data for.
  A ticked line that is not marketing records purpose `utility` events (source `form`, same evidence), no subscription label, no `contact.opt_in`.
  Unticked: nothing in the ledger.

## Contact privacy flags: minor, guardian consent, Do Not Sell or Share (BL-180)

Spec [privacy-and-data-governance.md](../specs/privacy-and-data-governance.md) section 11.9. `GET /v2/contact-consent/contacts/:uuid` (and
`GET /api/v1/contacts/{id}/consent`) now carry a `privacy` object next to `states` and `events`:

| Field                                                           | Meaning                                                                                                           |
| --------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `isMinor`, `minorSince`, `minorSource`                          | the contact is flagged as a minor, since when, from where (`manual`, `api`, `contact_request`, `gpc`)             |
| `guardianConsent`, `guardianSince`                              | a parent or guardian's consent is on record (evidence only, never a marketing grant)                              |
| `doNotSellShare`, `doNotSellShareSince`, `doNotSellShareSource` | the contact opted out of the sale or sharing of their personal information                                        |
| `ccpaUs`                                                        | the workspace has the `ccpa_us` profile on: the Consent card offers the Do Not Sell or Share switch               |
| `minorRule`                                                     | what the workspace's children setting does with a flagged minor's marketing: `off`, `guardian`, `block`           |
| `events`                                                        | the newest 20 changes: `{ id, kind, value, source, evidence, actor, note, occurredAt, recordedAt }`, newest first |

`POST /contacts/:uuid/privacy-events` body `{ kind, value, source?, note?, evidence?, occurredAt? }` (`source` is `manual` by default, or
`api` or `contact_request`; `evidence` takes the same short keys as the ledger, including `guardianConsentRef`). It appends one event and
updates the flag in the same transaction, with an audit row and the outbox event `contact.privacy.changed` (payload: contactId, kind, value,
source, eventId). Rules: guardian consent needs a note (422 `CONSENT_NOTE_REQUIRED`) and a contact flagged as a minor (422
`CONSENT_PRIVACY_NOT_MINOR`); clearing `minor` also clears guardian consent (two history lines); an `Idempotency-Key` makes a repeat record
nothing (409 `CONSENT_IDEMPOTENCY_MISMATCH` for another change); the history cannot be edited or deleted. The Do Not Sell or Share flag is
accepted for any workspace; the card offers it when `ccpaUs` is true.

### ConsentGate

- `subject_minor` (deny, marketing only): the contact is flagged as a minor and `minorRule` is `block`, or is `guardian` and no guardian
  consent is on record. A withdrawal is still reported as `withdrawn`. Service messages are never held. Nothing is held when the workspace's
  children question is not answered and parental consent is not required (`off`).
- `sale_share_opted_out` (deny): the purpose `third_party_sharing` for a contact who opted out.
- A held marketing send is refused like any other gate denial (422 `CONSENT_SEND_DENIED` on the inbox and REST paths; skipped and counted by
  reason in broadcasts, campaigns, flows and schedules).

### Global Privacy Control

The header `Sec-GPC: 1` (any other value is ignored) on `POST /v2/public/forms/:key/submit` and `POST /widget/:token/api/message` records
the Do Not Sell or Share opt-out of the contact that the submission or thread resolved to, source `gpc`, but only when the workspace has
`ccpa_us` on. The web relay `/api/public/forms/*` forwards the header. Evidence: `formId` and `submissionId` (form) or `widgetId` (widget),
nothing else about the request. Already opted out: nothing more is written. It never changes marketing consent. A widget visitor has a
contact once they give a phone number or an email address.

## How a minor is detected (BL-211, BL-212, BL-190)

Spec: [privacy-and-data-governance.md](../specs/privacy-and-data-governance.md) section 11.10.

- **Date of birth.** `dateOfBirth` (`YYYY-MM-DD`, not in the future) on `POST /v2/contacts` and `PATCH /v2/contacts/:id` (`null` clears it); `GET` returns `dateOfBirth` and `isMinor`. A date under the workspace's minor age flags the contact in the same request: source `dob`, an expiry in `privacy.minorUntil`. The workspace's age is the highest `minorAge` of the Compliance profiles switched on, else 18.
- **Flag sources.** `privacy.minorSource` can now also be `dob`, `import`, `flow` or `declaration`. Only `dob` lapses by itself (the nightly sweep at 03:35); a flag set by a person, the API, an import or a flow stays until a person clears it. A person who clears a `dob` flag while the date still says minor is not overruled until the date changes.
- **Filter and segments.** `GET /v2/contacts?minor=true|false`; segment rule fields `minor` (is_true / is_false), `dateOfBirth` (date operators) and `age` (number operators, whole years, empty without a date). Also in "select all matching" bulk actions.
- **Import.** CSV columns `dateOfBirth` (year first, `2010-05-04`; a day-first date rejects the row as `invalid_date_of_birth`) and `minor` (yes flags the contact with source `import`; no and blank change nothing).
- **Customer API.** `date_of_birth` and `is_minor` on every contact; `GET /v1/contacts/:id/privacy` and `POST /v1/contacts/:id/privacy` (`contacts:read` / `contacts:write`, body as `privacy-events`, source stored as `api`).
- **Gate.** New closed-set reason `on_dnc_list` (see the Compliance API).
