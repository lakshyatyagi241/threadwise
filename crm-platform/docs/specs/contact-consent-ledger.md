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

Forms "WhatsApp opt-in" wording helper; per-purpose utility consent enforcement; double opt-in link; preference center; DSAR export;
email unsubscribe link when the email channel sends marketing.

## 12. As built (differences from the plan above, for the record)

- The settings tile sits under the existing **Security** section (a new Settings section would need its own copy in 21 locales).
- Detection is skipped for email channels (the hook already keeps answering listeners away from mail), groups and threads with no
  contact. The inbound listener returns `halt`: listeners that answer the customer are skipped, routing and translation still run, so
  a STOP that opens a new thread is still routed like any message.
- The composer shows a warning and a one-click button instead of silently adding the line, and the tick box reflects whether the line
  is in the text. The line is part of the saved message. The setting "Warn when a marketing text has no opt-out line" is stored as
  `footerDefaultOn`.
- The consent switch is applied to the `sendableIds` check of broadcasts, to the audience count of the campaign wizard and to the
  campaign dispatch (`screenRecipients` marks the rows `skipped`, "no recorded consent"). The wizard's materialised recipient list is
  not filtered at creation (BL-103).
- Workspace export is synchronous and capped at 50,000 rows; async export is BL-103.
- The inbox system line for an opt-out is not built (BL-103); the message itself is visible as usual.
- The import consent step is a tick box; a yes/no column is BL-103.
- Roll-up flag: a grant clears `is_unsubscribed` only when it reverses a withdrawal the ledger holds and no other channel is
  withdrawn, so a legacy flag with no ledger row is never cleared by an unrelated grant.
- The keyword cache lives in each process for 60 seconds; a save invalidates the saving process at once.
