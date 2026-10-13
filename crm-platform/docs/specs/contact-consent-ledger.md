# Contact consent ledger, STOP / START keywords and the opt-out line

Status: in build (branch `lakshya/contacts/consent-ledger`). Not a Reference feature: the reference only has a per-contact
`is_unsubscribed` flag and a callback; this is a product extension, every difference is in
`docs/threadwise-port/parity/product-extensions.md`.

## 1. Problem

- We can say that a contact is opted out, but not who consented, when, to what wording, or why they were opted out.
- A STOP typed by a customer is only honoured when an outside engine reports it through the campaign callback. Our own inbound
  ingest never looks at the text, so a STOP to a broadcast, a flow or a plain chat does nothing.
- The keyword list is not configurable and nothing tells the recipient they can type STOP.

## 2. What the reference does (kept)

- `contacts.is_unsubscribed` / `unsubscribed_at`; toggle on the contact form and in the REST API (`is_unsubscribed`); webhook
  `contact_opt_in` (`opted_in`, `action`, `source`).
- Broadcasts and campaigns drop opted-out contacts before sending (BroadcastsController, QueueController, WaCampaignsController).
- Node bridge (`node/services/campaignService.js trackCampaignResponse`): the WHOLE trimmed message, lower-cased, must equal
  `unsubscribe`; only for a contact that is in a live campaign held in the bridge's memory. It then calls
  `POST /api/campaigns/unsubscribe`, which stamps the recipient row (`status = unsubscribed`), flips the contact flag and emits
  `contact_opt_in` only on a real change.
  The reference documentation says "STOP or UNSUB"; the code only matches `unsubscribe`. Our default list is a superset, so
  nothing is lost; the docs claim becomes true.
- No auto reply, no START keyword, no footer, no ledger.

All of that keeps working unchanged. `contacts.is_unsubscribed` stays the field every existing filter reads.

## 3. Ledger model

`contact_consent_events` (append-only, tenant table, forced RLS, composite FKs):

| column                    | notes                                                                                                                                                                                     |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| contact_id                | composite FK to contacts, `ON DELETE SET NULL (contact_id)`: erasing a contact anonymises its events, never edits them                                                                    |
| channel                   | `whatsapp` (cloud API and QR number are the same phone, one consent), `sms`, `telegram`, `email`, `facebook`, `instagram`, `webchat`; text validated in contracts                         |
| purpose                   | `marketing` (enforced) or `utility` (reserved, recorded, not enforced)                                                                                                                    |
| action                    | `granted` or `withdrawn`                                                                                                                                                                  |
| source                    | `form`, `keyword`, `manual`, `import`, `api`, `flow`, `inbound_message`, `contact_request`, `legacy`                                                                                      |
| evidence                  | jsonb object, at most 4 KB. Allowed keys per source, see 3.2                                                                                                                              |
| actor_user_id             | user id when a person did it, FK `SET NULL`                                                                                                                                               |
| note                      | at most 500 chars, required for a manual grant                                                                                                                                            |
| occurred_at / recorded_at | when it happened (may be reported late) / when we stored it                                                                                                                               |
| idempotency_key           | unique per org, built from the source event (`keyword:<message uuid>`, `form:<submission uuid>`, `import:<job uuid>:<contact id>`, `api:<Idempotency-Key>`); a redelivery inserts nothing |

Append-only: a trigger rejects UPDATE and DELETE. The only permitted UPDATEs are the database's own `SET NULL` of
`contact_id` / `actor_user_id`; DELETE is allowed to a privileged session and to the org cascade (`pg_trigger_depth() > 1`).

### 3.1 Current state

`contact_consent_state (org_id, contact_id, channel, purpose) -> state granted|withdrawn, last_event_id, last_occurred_at`,
written in the SAME transaction as the event. A late event (older `occurred_at` than the state's) is stored but does not change
the state. No row = `unknown` ("No consent recorded"). We never invent consent: the backfill writes only `withdrawn / legacy`
events for contacts that are already `is_unsubscribed`; everyone else stays `unknown`.

`contacts.is_unsubscribed` / `unsubscribed_at` are a roll-up, written in the same transaction: true when ANY channel's marketing state
is `withdrawn`, false when none is. A grant clears it only when no other channel is still withdrawn. (Err on the side of not
messaging.) The legacy toggle on the contact form and REST `is_unsubscribed` go through the same service, so they write events too
(`manual` / `api`).

### 3.2 Evidence (privacy)

Stored: consent text shown and its version / sha-256 (form), submission uuid, inbound message uuid and the matched keyword, import file
name, API key id, flow id. NEVER stored: IP address, user agent, the free text of the customer's message (only the matched
keyword, which is a configured word), phone number. The ledger therefore holds nothing that identifies a person except `contact_id`,
which is removed by erasure.

## 4. Matching rule (STOP / START)

The WHOLE inbound text, after: Unicode NFKC, remove zero-width and bidi controls, remove Arabic diacritics and tatweel, fold alef
variants to bare alef, case-fold, trim surrounding punctuation / symbols / emoji, turn inner punctuation into a space, collapse
spaces, must equal a normalised keyword. A text longer than 64 characters is never a keyword. If a word is in both lists, opt-out wins.

| inbound text                                                   | result                                       |
| -------------------------------------------------------------- | -------------------------------------------- |
| `STOP` / `stop` / `Stop.` / `STOP!!` / `🛑 stop`               | opt-out                                      |
| `opt-out`, `OPT OUT`                                           | opt-out                                      |
| `إيقاف`, `ايقاف`, `الغاء الاشتراك`, `إلغاء الاشتراك`           | opt-out (ar)                                 |
| `START`, `Unstop`, `اشتراك`, `ابدأ`                            | opt-in                                       |
| `don't stop`, `stop sending me invoices please`, `please stop` | nothing                                      |
| `stop stop`                                                    | nothing (not a keyword)                      |
| a quoted reply whose body is `> stop`                          | nothing (the quoted text is not the message) |
| non-text (image, reaction)                                     | nothing                                      |

## 5. Settings (per workspace, Settings > Compliance)

Master switch "Detect STOP and START replies" (default ON); per-language opt-out and opt-in keyword lists with the defaults above;
auto reply ON/OFF, text per language with `{{name}}`; the opt-out footer text per language; the policy switch "Require recorded
consent for marketing sends" (default OFF); a "test a message" box (server side, same matcher). Permission `settings.consent.manage`.

## 6. Flow of an inbound message

1. The shared ingest stores the message and runs `InboundMessageHooks` (worker). A new listener `consent-keyword` runs FIRST
   (before flows) and reads the workspace's compiled keyword set from a 60 s per-process cache (invalidated on save): no query on
   the hot path for a message that is not a keyword. A message that is not a short text is skipped before the cache is read.
2. On a match: ledger event (`source = keyword`, key `keyword:<message uuid>`, evidence `{messageUuid, keyword}`), state, contact
   flag, outbox `contact.consent.withdrawn|granted`, in one transaction. Then one auto reply through the normal outbound path
   (free-form inside the 24 h window, `clientMessageId = consent-<message uuid>`, so a redelivery cannot send twice; sender bot,
   not a campaign, no usage tag for marketing). The listener returns `consumed: true` so no flow, FAQ or AI answers the STOP.
3. The message stays in the inbox. Agents see a system line "Opted out of marketing by replying STOP" (see 9).

Not applied: groups (no contact), email channels (not a chat), suspended workspaces (hooks already skip), a thread without a contact
(`contactId = null`: the unknown-number case; nothing to opt out; no reply).

## 7. Policy and sending

Withdrawn is always skipped (as today). With the policy switch ON, only `granted` marketing contacts on the send's channel are
sent; the audience step reports `skippedOptedOut` and `skippedNoConsent`. The check lives in one SQL predicate shared by broadcasts
and campaigns (`consentSendableSql`). Template sends are marketing when the template category is marketing; utility templates are
not blocked by the switch (purpose `utility` is reserved, not enforced).

## 8. Telling recipients (the owner's second question)

- Footer line (default "Reply STOP to unsubscribe", per language) appended to marketing TEXT sends by the composer checkbox
  "Add the opt-out line" (default ON), with a warning when a marketing message has no opt-out instruction. For templates: warning only,
  plus the suggested footer in the template editor. Approved templates are never changed.
- The START and STOP confirmation replies say how to flip back.
- Help guide for admins and a plain-language preview of what the recipient sees.

## 9. Threats and abuse

| case                                     | decision                                                                                                                                                                                            |
| ---------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| number maps to several contacts          | the ingest already resolves one contact per (channel, peer) thread; only that contact is opted out. The campaign callback opts out the contact matched by phone (first match, as the reference)     |
| group message                            | skipped (no contact)                                                                                                                                                                                |
| STOP in a quoted reply / forward         | only the message body counts; a body that is not the whole keyword does not match                                                                                                                   |
| STOP from an unknown number              | thread without contact: stored, no ledger (nothing to attach), no reply                                                                                                                             |
| keyword flood                            | idempotent per message uuid; the auto reply is sent at most once per contact per 10 minutes (state change only: a STOP from an already withdrawn contact writes no second event and sends no reply) |
| race between STOP and a send in flight   | the send re-reads `is_unsubscribed` at the audience query; a message already handed to Meta cannot be recalled (documented, not a defect)                                                           |
| someone replies START for another person | only the sender's own thread is affected                                                                                                                                                            |
| forged callback                          | the callback keeps its bridge-token guard                                                                                                                                                           |

## 10. Files

Contracts `packages/contracts/src/contact-consent/`; migration `20261121090000_consent_ledger.sql` and `..._permissions.sql`; API module
`apps/api/src/modules/contact-consent/`; edits in campaigns callbacks, broadcasts, campaign audience, forms submit, contact import,
contacts service, REST API v1; web `apps/web/src/features/contact-consent/`; help guide; `docs/api/contact-consent.md`.

## 11. Follow-ups (backlog)

Built in the follow-up pass (section 13): the inbox system line, the asynchronous export, the import consent column, the wizard's
recipient list, the Forms WhatsApp wording helper. Still specified-next (designs below, nothing built): per-purpose utility consent
enforcement; double opt-in link; preference center; DSAR export; email unsubscribe link when the email channel sends marketing.

### 11.1 Double opt-in link (design)

For a source we do not trust to prove the person owns the number (an import, a manual grant, a form with no verification), the grant
is recorded as `pending` and a one-tap confirmation is sent: a WhatsApp template (or an email) carrying a signed link
`/c/<token>` (HMAC of org, contact, channel and purpose, 7 days, single use). Opening the link records `granted` with source
`double_opt_in` and evidence `{ messageId }`; until then the contact counts as `unknown` for the send policy. Needs a new state
`pending` in `contact_consent_state`, a public route (no session, rate limited, constant-time token check) and a template category
decision. The ledger never changes shape: `pending` is a state, the history stays events.

### 11.2 Preference center (design)

A public page reached from a footer link `/p/<token>` (same token family) where the contact chooses channels and purposes
(marketing, utility), each choice one ledger event with source `preference_center`. The page shows the workspace name and the
current state per channel, never other contacts' data. Needs the public route, the token, a per-workspace page title and logo setting,
and one help guide.

### 11.3 DSAR export (design)

`GET /v2/contact-consent/contacts/:uuid/dsar` (permission `contacts.consent.manage`): the contact's full ledger plus the contact card
and message counts as one ZIP, built by the same worker queue as the proof export (`consent-export`, a `kind` column on
`contact_consent_exports`), kept 7 days, audited. Erasure keeps working as today: the events are anonymised, never deleted.

The platform-wide privacy plan that generalises this ledger (purposes registry, ConsentGate for every channel and modality, voice, rights requests, retention) is [privacy-and-data-governance.md](privacy-and-data-governance.md); backlog BL-140 to BL-153. Double opt-in, the preference center and the DSAR export above are tasks there (BL-143, BL-145).

## 12. As built (differences from the plan above, for the record)

- The settings tile sits under the existing **Security** section (a new Settings section would need its own copy in 21 locales).
- Detection is skipped for email channels (the hook already keeps answering listeners away from mail), groups and threads with no
  contact. The inbound listener returns `halt`: listeners that answer the customer are skipped, routing and translation still run, so
  a STOP that opens a new thread is still routed like any message.
- The composer shows a warning and a one-click button instead of silently adding the line, and the tick box reflects whether the line
  is in the text. The line is part of the saved message. The setting "Warn when a marketing text has no opt-out line" is stored as
  `footerDefaultOn`.
- The consent switch is applied to the `sendableIds` check of broadcasts, to the audience count, the sample and the written recipient
  list of the campaign wizard (section 13.4) and to the campaign dispatch (`screenRecipients` marks the rows `skipped`, "no recorded
  consent", as a safety net).
- Workspace export: the direct download is capped at 50,000 rows; a larger ledger is exported asynchronously (section 13.2).
- The inbox system line for an opt-out is built (section 13.1).
- The import consent step is a tick box; a yes/no column is built (section 13.3).
- Roll-up flag: a grant clears `is_unsubscribed` only when it reverses a withdrawal the ledger holds and no other channel is
  withdrawn, so a legacy flag with no ledger row is never cleared by an unrelated grant.
- The keyword cache lives in each process for 60 seconds; a save invalidates the saving process at once.

## 13. Follow-up pass (BL-103), as built

### 13.1 The inbox system line

When a keyword really changes the state (a repeated STOP does not), the listener writes ONE `system` message into the thread through
`ConversationsFacade.recordOutbound` (the same door as the call bubbles): direction `in` (the customer's side), provider id
`consent:<message uuid>` (a redelivery writes one line), meta `{ event: 'consent', consentAction, consentKeyword }`. It touches only the
thread's sequence, last message and preview: never `unread_count`, the wait clock, assignment or a notification. The message
contract carries `systemEvent { event, action, keyword }` so the web app words the line in the reader's language (`Contact replied
STOP: unsubscribed from marketing`); the stored `body` is the English text for exports and older clients. It is a record of a ledger
fact, so it is written even when the auto reply is switched off.

### 13.2 Asynchronous export of the proof

Above 50,000 events the direct CSV would be cut short, so the screen offers **Prepare the full proof file**: `POST
/v2/contact-consent/exports` (202) inserts a `contact_consent_exports` row (`queued`), audits it and enqueues a job on the
`consent-export` queue; the worker (`ConsentExportRunner`, concurrency 1) claims the row, reads the ledger in keyset pages of 5,000
(one short transaction each, newest first) into gzip members and stores the file on the row for 7 days (`CONSENT_EXPORT_TTL_DAYS`),
then emails the requester a link to `/contact-consent?export=<id>`; a failure is written on the row and mailed, never retried. One
export at a time per workspace (409 `CONSENT_EXPORT_IN_PROGRESS`). The file is the same CSV as the direct download (`proofCsvLine`).
`GET /exports` lists the latest 20 and says whether the ledger is larger than the direct download (`needsAsync`); `GET
/exports/:id/download` streams it while it lives (409 `CONSENT_EXPORT_NOT_READY` once expired). A daily sweep (02:41) deletes expired
files and fails an export `running` for over an hour. Ceiling 5,000,000 events per file. All three routes need `contacts.consent.manage`.

### 13.3 The import consent column

`consent` is an import field (auto-detected from headers such as `consent`, `opt in`, `subscribed`, `marketing consent`). Each cell is
read by `parseImportConsent`: yes / y / true / 1 / granted / opted in / subscribed / the Arabic and other yes words are **granted**; no /
false / 0 / unsubscribed / withdrawn / the Arabic and other no words and a blank cell are **not granted**; anything else is
**unrecognised** (also not granted, and the preview lists a few). The confirmation tick box is still required: with it unticked the
column does nothing at all (the preview says so); with it ticked, only the rows that say yes get a `granted / import` event (the file
name as evidence, an opt-out is never overridden). A column that is not mapped keeps the old meaning: the tick box covers every
contact. A "no" never writes a withdrawal: a person who wants to opt contacts out marks them unsubscribed, a CSV cell is not proof.
For a number repeated in the file the later non-blank cell wins.

### 13.4 The wizard's recipient list

With the switch ON `WizardAudienceService.recipientIds` and `sample` add the recorded-grant condition, so the list written at launch is
exactly the set the count shows and nobody is written just to be skipped at dispatch. Bug fixed on the way: the count added numbers of
an uploaded CSV that are not contacts yet to `recipients`, although they have no consent and would all be skipped; they now count as
`noConsent`, and are left out of the wallet estimate.

### 13.5 Forms: WhatsApp opt-in wording

With "Marketing opt-in" on, the Forms settings show a button that fills the consent text with a ready sentence ("I agree to receive
updates and offers on WhatsApp. I can reply STOP at any time to unsubscribe.") in the editor's language, through the same
version-bumping path as typing, so the wording version and the stored proof stay honest.

Platform-wide follow-up: the consent gate, purposes beyond marketing/utility, voice and email unsubscribe are designed in [privacy-and-data-governance.md](privacy-and-data-governance.md) (BL-140, BL-141, BL-145, BL-148).
