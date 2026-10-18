# Call logging framework (calls that are not WhatsApp calls)

Status: built (API, worker, database, contracts, help guide). The screens for it (the "Log a call" form on the contact page, the
mobile app's sync, the "did you call? log it" prompt) are separate work: see [Open work](#open-work) and BL-250 to BL-258. The Call logs
screen itself is open to a workspace without WhatsApp calling (BL-257, [section 5](#5-permissions-and-plan)).

API reference: [api/call-logging.md](../api/call-logging.md). Wiring map: [threadwise-port/wiring/call-logging.md](../threadwise-port/wiring/call-logging.md).
The WhatsApp calling domain this extends: [api/calling-voice.md](../api/calling-voice.md).

## 1. The problem

Until now only WhatsApp business calls (`wa_calls`, Meta's direction words) were logged. A call made or taken by any other means left
no trace: nobody could log a call they had just had, a telephony or IVR provider's calls were lost, a call placed from the phone's
own dialer by tapping a number in the mobile app was lost, and a click-to-call from the web was lost. The contact's timeline and the
Call logs screen showed one half of a customer's phone history.

## 2. The model

One table, `call_log_entries`, holds every call that is **not** a WhatsApp call. The WhatsApp calls stay in `wa_calls`, untouched
(their ledger, recording consent and retention are unchanged). Both are read together through one read model and told apart by
`source`.

| Source              | Who writes it                                                                                           | What it can know                                                                                                                                                              | What it cannot know                                                                                                                                                             |
| ------------------- | ------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `whatsapp`          | Meta's calls webhook (existing)                                                                         | Everything Meta reports: ring, answer, end, recording of calls placed in the browser                                                                                          | Nothing about calls on other lines                                                                                                                                              |
| `manual`            | A person, with "Log a call" (`POST /v2/calls/log`)                                                      | What the person says: contact, direction, outcome, when, how long, notes; may make a follow-up task                                                                           | Anything they do not type. It is a statement by a person, not a measurement                                                                                                     |
| `mobile_app`        | The mobile app, in the signed-in person's name (`POST /v2/calls/ingest`)                                | Android: direction, start, duration, number and the phone's call type (missed, rejected...) from the call log. iOS: only what the person answers in the prompt after the call | iOS has no call log API, so nothing is seen without the prompt. Neither platform knows the call's outcome beyond what the phone's log or the person says; neither records audio |
| `telephony`         | A telephony provider's signed callback, applied by the worker                                           | Direction, numbers, start, duration, the provider's final status, a reference to a recording                                                                                  | Who answered (unless the call was placed by a click-to-call), notes, the contact (it is matched by number)                                                                      |
| `web_click_to_call` | The bridge: a click-to-call we asked the provider to place; or a person confirming after a `tel:` click | Bridge: the person who clicked, the contact, everything the provider reports. Confirmation: what the person says                                                              | A `tel:` link click is not a call: a browser cannot tell whether it was dialled, answered or how long it lasted                                                                 |

Columns of `call_log_entries` (migration `20261227090000_call_log_entries.sql`): `source`, `direction` (`inbound` | `outbound`), `outcome`
(`connected`, `no_answer`, `busy`, `left_voicemail`, `wrong_number`, `declined`, `failed`), `started_at`, `duration_sec`, `contact_id`,
`customer_phone` (E.164), `our_phone`, `number_label`, `handler_user_id`, `notes` (2,000 characters at most), `external_id`,
`telephony_connection_id`, `recording_ref` and its consent evidence, `follow_up_task_id`, `activity_id` (the timeline line),
`created_by`. Row-level security is enabled and forced; every foreign key is composite with `org_id`.

**Idempotency.** `UNIQUE (org_id, source, external_id)`. The external id is the provider's call id prefixed with the connection
(`<connection uuid>:<provider call id>`), or the device id and the device's call id (`<device id>:<device call id>`), or a client's own id
for a form (`externalId`). The same report again returns the first row untouched. Entries typed by hand have no external id and never
collide.

**The read model.** The Call logs list, its cards, the analytics, the detail and `GET /v2/contacts/:id/calls` read a union of the two
tables, shaped in the WhatsApp vocabulary (Meta's two direction words, a status of `ended` or `failed`, digits for numbers), with the
log status, "answered" and "missed" decided per source:

| Outcome                               | Log status  | Answered | Missed (inbound only) |
| ------------------------------------- | ----------- | -------- | --------------------- |
| `connected`                           | `completed` | yes      | no                    |
| `declined`                            | `declined`  | no       | yes                   |
| `failed`                              | `failed`    | no       | yes                   |
| `wrong_number`                        | `failed`    | no       | yes                   |
| `no_answer`, `busy`, `left_voicemail` | `no-answer` | no       | yes                   |

A logged call that connected is answered even when its length is not known (0 seconds); the average handle time counts only calls with
a length. The WhatsApp rows read as they always did (the integration spec holds the two vocabularies to the same answers).

## 3. Writing a call: one path

Every source goes through `CallLogEntriesService.write`, in one transaction:

1. insert the row (idempotent on source and external id);
2. when the call has a contact, write **one line on the contact's Activity Timeline** (`contact_activities`, type `call_<source>`, so an
   icon can be chosen from the type alone) and move the contact's last activity;
3. audit (`call_log_entries`, facts only) and the outbox event `call.logged` in the same transaction.

The timeline line reads "Outbound call, Connected, 4 min, by Priya" with the first words of the notes as its body. The talk time is left
out of a call that did not connect; "by" is left out when nobody took the call. The line is kept in step when the call is edited and
removed when it is deleted. The text is English on the server today (BL-258).

**Logging records a fact, so no consent rule refuses it.** A call on the Do-Not-Call list, to someone who unsubscribed, or with no
consent recorded is logged. What the framework stores about the call follows its own privacy rules (section 6).

## 4. The four doors

### 4.1 Log a call (manual)

`POST /v2/calls/log`. Needs the contact or a number that can be read as one. When only a number is given, the contact is found by the
canonical phone (`canonicalizeLocalPhone` with the workspace's default country) among the contacts **the person may read**: a number
cannot be used to discover a contact outside their record scope; the call is then logged by number alone. Options:

- a **follow-up task** (`followUp: { dueAt, title?, assigneeId? }`), written in the same transaction through `TasksService.createIn`
  (the assignee rules, the record scope on assignment and the `task.created` event all apply; it needs `record.tasks.create`);
- a **lifecycle suggestion** (`suggestStageNudge: true`): for a connected call to a contact still at the workspace's first lifecycle stage
  the answer carries the next stage. **It is never applied**; the person accepts it with a normal contact update.
- `source: 'web_click_to_call'` when the form was opened by the "did you call? log it" prompt (section 4.4).

A person may **edit or delete their own manual entry** for the workspace's edit window (24 hours by default, 1 to 720, `call.logging.manage`
sets it); `call.logging.manage` may change any manual entry at any time. A call reported by a phone or a provider is a record of what
happened and cannot be edited by anyone. Another person's entry answers 404.

### 4.2 The mobile app

`POST /v2/calls/ingest` is called by the mobile app with the signed-in person's own token (the same bearer token as every other screen), in
batches of up to 100. The contract, for the app's authors:

**Request.** `{ deviceId, platform: 'android' | 'ios', entries: [{ deviceCallId, direction, startedAt, durationSec, customerPhone, deviceCallType?, outcome?, ourPhone?, notes?, contactId? }] }`.

**Android: the call log.** The app asks for the `READ_CALL_LOG` permission (a sensitive permission: the app must declare why in the store
listing, and the user may refuse). It reads the calls since its last sync (`CallLog.Calls`: `_ID`, `TYPE`, `DATE`, `DURATION`, `NUMBER`) and
sends `deviceCallId = _ID`, `deviceCallType` = the phone's type (`incoming`, `outgoing`, `missed`, `rejected`, `blocked`, `voicemail`), `startedAt`,
`durationSec` and `customerPhone`. The server derives the outcome: a missed call or a voicemail is `no_answer`, a rejected one is `declined`, a call
with talk time is `connected`, an outgoing call with none rang out (`no_answer`), a `blocked` call is skipped.

**Tap to call, then confirm (Android and iOS).** When the person starts a call from a contact or a number inside the app, the app opens the
phone's dialer (`tel:`) and remembers the attempt. When the app is foregrounded again it asks "How did the call go?" with the outcomes, the
length (prefilled from the Android log when available) and a note, then sends one entry with an explicit `outcome` and `contactId`. **On iOS
this is the only way** (there is no call log API). `deviceCallId` is a UUID the app made for the attempt, so a retry lands once.

**Rules the server enforces, which the app can rely on:**

- the entry is the signed-in person's: `handler` and `created_by` are them, and they need `call.logs.create`;
- **a number that matches no contact is not stored** (`status: 'ignored'`, `reason: 'unknown_number'`). A work phone is also somebody's
  personal phone: the server never keeps a personal call just because the app sent it. The workspace may switch on **"create contacts from
  unknown callers"** (`call.logging.manage`, off by default); then the caller becomes a contact owned by the person, if they may create contacts;
- the match uses the contacts the person may read; a named `contactId` they may not read is `rejected` (`contact_not_found`);
- idempotent on `(deviceId, deviceCallId)`; a batch sent twice, or half-sent and resent, lands once (`duplicate`);
- bulk-safe: every entry answers on its own (`created`, `duplicate`, `ignored`, `rejected` with a reason), one bad entry does not fail the batch;
- start times in the future (more than 5 minutes) or older than 400 days are `rejected` (`invalid_time`); a number that is not a phone number
  is `rejected` (`unusable_phone`);
- notes are optional, 2,000 characters at most; the app should send none for calls it only read from the phone's log.

**Privacy guidance for the app** (not enforced by the server, but required by this spec): sync only after the person has been told, in plain
words, that call history of known contacts is shared with the workspace; offer an off switch; never send calls whose numbers are not in the
contacts the workspace gave the person (the server drops them anyway, but a call history that left the phone has left it); never send
audio. The app has no access to a call's audio on either platform.

### 4.3 Telephony / IVR providers

A **TELEPHONY port** (`apps/api/src/infra/providers/telephony/telephony.port.ts`) is what the framework asks of a vendor; adapters implement
it and nothing else changes:

```ts
interface TelephonyProvider {
  key;
  label;
  supportsClickToCall;
  verifyWebhook(rawBody, headers, secret, now?): boolean; // constant time, raw bytes, replay window, false on any doubt
  parseWebhook(rawBody): NormalisedCallEvent[]; // never throws; [] for what is not a finished call
  clickToCall(req): Promise<{ ok: true; callId } | { ok: false; error; code? }>; // the outbound bridge
}
```

Two adapters ship, neither calls a vendor: `generic` (any system that can POST JSON and compute an HMAC: a relay in front of a vendor's
webhook, an automation tool, an in-house IVR; it reports calls and cannot bridge one) and `fake` (the generic contract plus a click-to-call that
rings nobody; offered **only outside production**, for development and the tests). No real provider is called and no credential is stored.

**The generic signed callback.** One address per connection: `POST /v2/public/webhooks/telephony/:connectionId`. Headers:
`X-Telephony-Timestamp` (unix seconds) and `X-Telephony-Signature: v1=<hex HMAC-SHA256 of "<timestamp>.<raw body>" keyed with the connection's secret>`. Body:

```json
{
  "id": "evt-123",
  "type": "call.completed",
  "call": {
    "id": "CA9f...",
    "direction": "inbound",
    "status": "completed",
    "from": "+919876543210",
    "to": "+918012345678",
    "startedAt": "2026-10-17T09:50:00Z",
    "durationSec": 125,
    "recordingRef": "optional provider reference"
  }
}
```

`status` is one of `completed`, `no_answer`, `busy`, `failed`, `canceled`, `declined`, `voicemail`. Following the `webhook-handler` skill:

1. **Verify.** The raw bytes are hashed, compared in constant time, inside a 5 minute window. An unknown connection and a bad signature answer the same
   `401` so the address cannot be used to find connections. A disabled connection is acknowledged and ignored.
2. **Ack fast.** Each finished call is put on the `telephony-ingest` queue and the request ends with `204`. Nothing is written in the request.
3. **Idempotent.** The job id carries the provider's event id; the entry is unique on `(source, connection + the provider's call id)`.

The worker (`TelephonyEventsService`) writes the entry. On the business's own line **every call is kept, with or without a contact** (unlike a
personal phone); the "create contacts from unknown callers" switch decides only whether a stranger becomes a contact. The handler is unknown
(the provider does not say who answered) except for a click-to-call.

**Click-to-call (the outbound bridge).** `POST /v2/calls/click-to-call { connectionId, contactId | customerPhone, agentPhone?, purpose }`: the provider rings the person first,
then the customer. The placement is kept (`telephony_click_calls`) so the provider's report of the finished call finds its **handler and contact**; the
entry's source is `web_click_to_call`. The person's own number comes from their profile unless `agentPhone` is given.

**How a real provider plugs in** (Twilio, Exotel, Knowlarity, MyOperator, Ozonetel and the other India-first small-business vendors are all the
same shape): write one class implementing `TelephonyProvider`, register it in `TelephonyProviderRegistry`, and add its tests with a recorded
fixture of the vendor's real callback. `verifyWebhook` is the vendor's own scheme (Twilio: `X-Twilio-Signature`, HMAC-SHA1 over the full URL and the sorted
form fields, see `channel-sms/twilio-signature.ts` for a worked example; Exotel and Knowlarity: a shared token or an IP allow-list plus the
payload's own checks - say so in the adapter's header comment, and never accept a callback with no proof); `parseWebhook` maps the vendor's statuses
to `TelephonyCallStatus` and their numbers to the two sides; `clickToCall` calls the vendor's "connect two numbers" API (Twilio: call the agent with a `<Dial>` to the
customer; Exotel: `Calls/connect`; Knowlarity: click-to-call API) and returns the vendor's call sid. Credentials belong in the connection's encrypted credentials with
`CryptoService` (a column to add in that adapter's migration), never in `call_log_entries`. Indian providers also need DLT/TRAI call-time rules and the
caller-id the vendor has registered for the business: keep those in the adapter, not in the framework. Real-vendor verification needs an
account and is listed as not done (BL-252).

### 4.4 Web click-to-call and the "did you call? log it" nudge

Two cases. **Through a telephony connection** the click-to-call above places the call and the callback logs it. **Through a `tel:` link** the
browser hands the number to the phone or the desktop dialer, and **a click is not detectable as a call**: it cannot be told whether the person dialled, was
answered, or for how long. The contract for the follow-up prompt (the screen is separate work, BL-250):

- the web client remembers the click (`contactId` or the number, `clickedAt`) in its own session storage;
- when the tab becomes visible again after at least `CALL_CLICK_NUDGE.minAwaySeconds` (15) and no more than `maxAgeMinutes` (30) after the click
  (`shouldNudgeCall(awayMs, sinceClickMs)`), it offers "Did you call? Log it" with the form prefilled by `callLogPrefill({ contactId, customerPhone, clickedAt })`
  (`source: 'web_click_to_call'`, `direction: 'outbound'`, `startedAt` = the click);
- nothing is sent to the server until the person saves the form (`POST /v2/calls/log`), so a dismissed prompt leaves no record;
- a click on a masked number (`contacts.phone.reveal` missing) never starts a call, so it never prompts.

## 5. Permissions and plan

| Key                         | Meaning                                                                                                                                       | Presets                                        |
| --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------- |
| `call.logs.create`          | log a call; edit or delete your own manual entry in the window; the mobile app's reports; check and click-to-call                             | Owner, Admin, Manager, Agent                   |
| `call.logging.manage`       | the "create contacts from unknown callers" switch, the edit window, telephony connections, any manual entry                                   | Owner, Admin                                   |
| `call.logs.read` (existing) | read the Call logs and a contact's calls; its **record scope** (`all`, `team`, `own`) says whose calls, by who handled them, for both sources | Owner and Admin `all`; Manager and Agent `own` |

**The plan feature `waba_calling` gates what is WhatsApp's, not the log (BL-257).** The Call logs list, its cards, the filter choices, the
detail and the analytics, the new routes and the contact's calls are **not plan-gated**: they need `call.logs.read` (and its record scope) and
nothing else. A workspace that has no WhatsApp calling and only writes calls down (Log a call, the mobile app, a telephony provider) opens the
same Call logs screen as any other. The decision, element by element:

| Element                                                                                                                | Without `waba_calling`                                                                               | Why                                                                                                                         |
| ---------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| Menu entry `Call logs`, `/call-logs`, `/call-logs/analytics`, `/call-logs/:id`                                         | open (permission `call.logs.read` only); no lock, no paywall                                         | The log holds every source. The paywall reads its gates from the menu list, so one gate removes both                        |
| `GET /calling/call-logs`, `/filters`, `/analytics`, `/:id`                                                             | open; the record scope, RLS and the 404 for what is outside the scope apply as ever                  | Same data the contact's calls already showed without a gate                                                                 |
| The `source` filter                                                                                                    | open; the screen offers the four logged sources and not `whatsapp` (`source=whatsapp` finds nothing) | There is nothing to find                                                                                                    |
| The filter by WhatsApp number (`numberId`) on the list and the analytics                                               | `422 PLAN_FEATURE_LOCKED`; the screen drops it from the address and does not show the picker         | A WhatsApp number is a WhatsApp calling object                                                                              |
| `GET /filters` `numbers`                                                                                               | `[]`; `agents` are those of every source                                                             | The numbers are WhatsApp's; the teammates are not                                                                           |
| Playing a recording (`POST /:id/playback`), the player and the consent and retention card                              | `422 PLAN_FEATURE_LOCKED`; the screen leaves out the whole recording column                          | Only a WhatsApp call has a recording a person can play; a logged call's reference is never returned                         |
| Calls already in `wa_calls` (the workspace had the feature once)                                                       | still listed and openable, read only; their recordings cannot be played                              | They are the workspace's own history, as on the contact's calls; hiding them would hide records the owner can see elsewhere |
| Calling numbers, readiness, calling settings, recording settings, dial and answer routes, the `/calling` Settings tile | unchanged: `422 PLAN_FEATURE_LOCKED` / tile locked                                                   | Recording consent settings govern the operator's browser recording of WhatsApp calls; they belong with WhatsApp calling     |
| Legal hold on a recording (`PUT /:id/recording-hold`)                                                                  | unchanged (not plan-gated, needs `privacy.requests.manage`)                                          | A privacy action on kept data must stay possible after a downgrade                                                          |

With `waba_calling` nothing changes. The screen reads the same plan list the menu reads (`GET /v2/billing/entitlements`); while that list is
unknown it behaves as with the feature, like the rest of the app.

## 6. Privacy

- **Notes** are free text written by a teammate: capped at 2,000 characters, kept out of the audit trail and the outbox event (they carry
  the facts, `hasNotes`), and cleared by an erasure of the contact (the privacy manifest `calls.logs` lists the table).
- **Numbers** are E.164 in the table; the audit trail and events carry none. A number is masked in no response today: the call log shows
  numbers unmasked as it always has (the `contacts.phone.reveal` pass did not cover Calling). BL-254.
- **A recording is only ever a reference** to a recording on the provider's side, never audio. It is stored only when the ConsentGate
  (`call_recording` purpose) allows: the workspace's recording switch is on, **and** the connection's owner attests the notice is played
  (`playsRecordingNotice`) **and** the workspace's mode is `announcement`. Otherwise the call is logged without the reference. The consent evidence is
  stored with it and a database constraint refuses a reference without consent. The reference follows the workspace's recording retention (the daily sweep
  clears it, `call_recording_settings.retention_days`, default 90). The reference itself is never returned by the API, so `call.recordings.play` is not bypassed;
  playing provider-held recordings is BL-255.
- **The Do-Not-Call list and withdrawal** govern PLACING a call, not logging one. `POST /v2/calls/click-to-call` and `POST /v2/calls/check` ask the
  ConsentGate on the voice channel: a `service` call is refused only for a contact who withdrew the service purpose; a `marketing` call is
  refused for a number on the DNC list (`on_dnc_list`), for the Unsubscribed flag or a STOP (`withdrawn`), for a flagged minor under the children setting, and, when the
  workspace requires recorded consent, for a contact with no grant. The refusal is `422 CONSENT_OPTED_OUT` with `errors: [{ path: 'reason', message }]`.
  `/check` lets the mobile app and the web warn before dialling; the phone's own dialer cannot be blocked, and the call, once made, is logged.
- **Personal calls on a work phone**: see 4.2: unknown numbers are dropped, the app has to be opted into, and the workspace's contacts decide.
- **Tenant isolation**: every table has forced row-level security and composite foreign keys; the callback finds its workspace only through a
  `SECURITY DEFINER` lookup on the connection id (`telephony_connection_for_webhook`).

## 7. Reports

The Call logs analytics accept `source` and return `bySource` (calls, answered and missed per source). The list accepts `source`; the cards
(`kpis`) count both sources, in line with "every call you can see".

## 8. Open work

BL-250 (web: the "Log a call" form on the contact page, the source column and filter on Call logs, the "did you call?" prompt), BL-251 (the
mobile app's sync), BL-252 (a real vendor adapter and its verification), BL-253 (API-key ingestion), BL-254 (phone masking across Calling),
BL-255 (playing provider-held recordings, legal hold on entries), BL-256 (interim statuses and agent attribution), BL-258 (a localisable
timeline line). BL-257 (Call logs without WhatsApp calling) is done: [section 5](#5-permissions-and-plan).

## 9. Decisions recorded

- The table is `call_log_entries` in the CALL domain (`modules/calling-voice/logging`), not a new domain: it shares the log, the scope and the
  analytics with `wa_calls`.
- New permission keys follow the existing `call.logs.*` family (`call.logs.create`, `call.logging.manage`) rather than `calls.log.*`.
- The mobile ingestion route is authenticated by the signed-in person's app token. An API-key variant would live on `/api/v1`, which is
  the parity-locked customer API (its scope list and key screen are tied to Reference); it is BL-253, not done here.
- A reported call (phone or provider) is not editable by anyone below `call.logging.manage`: it is a record, not a note.
- A number that matches a contact the person may not read is logged by number alone, so the call is not lost and the contact is not revealed.
- **BL-257: no plan feature of its own.** The open question was whether Call logs needs a new plan feature (`call_logging`) or no gate at all.
  A new flag would be a second thing to sell and to keep in step with `waba_calling` for no gain: logging a call is a basic CRM action that is
  already open to every plan (`POST /v2/calls/log`, the contact's calls, the timeline). The log is therefore gated by the right to read it, and only
  what is WhatsApp's keeps `waba_calling` (table in section 5). A plan-level switch can still be added later without changing the routes.
- The follow-up task is created with source `manual` (a task the person asked for); deleting the call leaves the task.
