# Broadcasts API (BCAST)

WhatsApp broadcasts: one template sent to a list of contacts. Port of WaDesk's `POST /broadcasts` (WD-BCAST-009, 010, 011,
012, 013, 014, 015). Parity notes and what is stubbed: [parity/broadcasts.md](../wadesk-port/parity/broadcasts.md).

All routes are under `/v2`, need a signed-in staff user, and use problem+json errors with a stable `code`.

## `POST /v2/broadcasts`

Permission `bcast.broadcasts.create` (granted to the locked Admin role). Requires an `Idempotency-Key` header.

```json
// request
{
  "name": "Diwali offer",
  "templateId": "7c6f…",                // wa_templates uuid, required
  "templateOverrides": {                 // optional send-time edits; see below. All blank stores null
    "header": { "mode": "text", "text": "Hi {{first_name}}" },   // or { "mode": "media", "mediaUrl": "https://..." }
    "body": ["VIP", ""],                  // positional slots; a blank slot keeps the template value
    "buttons": [{ "index": 0, "subType": "url", "value": "https://shop.example.com/{{first_name}}" }]
  },
  "contactIds": ["…"],                   // contacts, groups and tags are merged, first occurrence wins
  "groupIds": ["…"],
  "tagIds": ["…"],
  "senderKeys": ["baileys:4ce2…", "waba:9b1c…"],   // "<engine>:<uuid>"; none = one sender-less broadcast
  "senderShare": { "baileys:4ce2…": 7, "waba:9b1c…": 3 },  // weights 0..1000, missing or <= 0 means 1
  "scheduleType": "now",                 // or "later" with sendDate (YYYY-MM-DD) and sendTime (HH:mm)
  "sendDate": "2026-10-05",
  "sendTime": "09:00",
  "timezone": "Asia/Kolkata"             // IANA zone the date and time are read in; default UTC
}
// 201
{
  "devicesCount": 2,
  "broadcasts": [
    { "id": "…", "name": "Diwali offer · Phone A", "status": "processing", "provider": "baileys",
      "senderKey": "baileys:4ce2…", "templateId": "7c6f…", "timezone": "Asia/Kolkata",
      "scheduledAt": "2026-10-05T03:30:00.000Z", "completedAt": null, "totalRecipients": 3,
      "successCount": 0, "deliveredCount": 0, "readCount": 0, "clickedCount": 0, "failCount": 0,
      "rowVersion": 1, "createdAt": "…", "updatedAt": "…" }
  ]
}
```

One broadcast row is created per picked sender, all in one transaction (both or neither). The audience is split across
them by weight: each sender gets the floor of its share and the leftover goes to the largest fractions, so slices differ
from the ideal by at most one. A slice that would be empty (fewer contacts than senders) is not created. Each row starts
with one `pending` recipient per contact, status `processing` for `now` and `scheduled` for `later`.

### Order of checks (stops at the first refusal, as WaDesk)

| #   | Check                                                                 | Refusal                                                             |
| --- | --------------------------------------------------------------------- | ------------------------------------------------------------------- |
| 1   | Plan feature `broadcast` (not in the plan catalogue yet)              | 422 `PLAN_FEATURE_LOCKED` (shim: always allowed for now)            |
| 2   | Plan cap `broadcasts`: live row count of the organization             | 422 `PLAN_LIMIT_REACHED`                                            |
| 3   | Body validation                                                       | 422 `VALIDATION_FAILED` with `errors[{path,message}]`               |
| 4   | Audience has at least one sendable contact                            | 422 `BCAST_NO_RECIPIENTS`                                           |
| 5   | Emergency halt and content screen (`SendPolicyService`)               | 4xx from the send policy (`AUTH_SEND_HALTED` / `AUTH_SEND_BLOCKED`) |
| 6   | Wallet precheck                                                       | 422 `BCAST_SEND_BLOCKED` (shim: always allowed for now)             |
| 7   | Template exists in this organization                                  | 422 `BCAST_TEMPLATE_NOT_FOUND`                                      |
| 8   | Template can be broadcast (not OTP; reachable media; Meta guardrails) | 422 `BCAST_TEMPLATE_NOT_ALLOWED`                                    |
| 9   | Warmer holds for warming numbers                                      | 422 `BCAST_WARMER_HOLD` (shim: never holds for now)                 |

Audience rules: another organization's contacts, groups, tags and templates are never used (a foreign id behaves like an
unknown one). Contacts that opted out (`is_unsubscribed`) or are archived are dropped. Sender keys that are unknown,
disconnected, or of a disabled engine are dropped silently.

### Side effects

In the same transaction: one `audit_log` row (`broadcasts` / `insert`) and one outbox event `broadcast.created`
`{ uuid, status, isNow, totalRecipients }` per created broadcast. Nothing is sent by this endpoint; the sender (below) picks the
broadcast up from its row.

### Errors

`VALIDATION_FAILED`, `PLAN_FEATURE_LOCKED`, `PLAN_LIMIT_REACHED`, `BCAST_NO_RECIPIENTS`, `BCAST_SEND_BLOCKED`,
`BCAST_TEMPLATE_NOT_FOUND`, `BCAST_TEMPLATE_NOT_ALLOWED`, `BCAST_WARMER_HOLD`, `FORBIDDEN` (403), `UNAUTHENTICATED` (401).

## The sender (WD-BCAST-016, with 025, 026, 027 in their simplest form)

Runs in the worker process, not in the API. Two parts:

1. **Due-broadcast queueing** (`BroadcastDueService`, every 3 s, privileged because it spans tenants): a broadcast that is
   `processing` or `scheduled`, whose `scheduled_at` has passed and that has no job yet, is added to the BullMQ queue
   `bcast-dispatch` with the broadcast uuid as the job id, and `broadcasts.node_schedule_id` is set to `bullmq:<uuid>`.
   The row is the schedule, so a worker restart loses nothing (WaDesk kept scheduled broadcasts in Node's memory).
2. **Dispatch** (`BroadcastDispatchProcessor`, concurrency 4): resolves the sender, loads the template, then sends each
   `pending` recipient: claim it (`processing`), call the engine adapter, record `sent` with the provider message id or
   `failed` with the reason. Counters are refreshed every 25 recipients and at the end.

Failure states, as WaDesk: no sender, no adapter for the engine, an unreadable template or unreadable credentials mark the
broadcast `failed` and leave the recipients `pending`. A recipient without a usable number is `failed` on its own
(`No usable phone number`).

| Broadcast status        | Meaning                                                                       |
| ----------------------- | ----------------------------------------------------------------------------- |
| `scheduled`             | waiting for `scheduled_at`                                                    |
| `processing`            | queued or being sent                                                          |
| `paused`                | the emergency halt stopped the run; the unsent recipients are `pending` again |
| `completed`             | every recipient is settled and none failed                                    |
| `completed_with_errors` | every recipient is settled and some failed                                    |
| `failed`                | no sender or adapter, or every recipient failed                               |

The terminal status is derived from the recipient rows, not trusted from the worker. `completed_at` keeps the first terminal
time. Recipient statuses only move forward (`pending`, `processing`, `sent`, `delivered`, `read`; `failed` is final, and a
`read` row ignores a late delivered, sent or failed), through one `BroadcastProgressService` that the Meta and Twilio status
webhooks will use too.

Engines: `waba` sends through the Meta Cloud API (`MetaCloudProvider.sendTemplate`, text templates with positional body
variables). `baileys`, `twilio` and `sms` have no adapter yet; register one on `EngineSenderRegistry` when its domain lands.

Safe to run twice: a recipient already claimed is never sent again, a claim older than 10 minutes is failed as
interrupted, and a finished or failed broadcast is skipped.

### Send-time overrides and the per-recipient payload (WD-BCAST-017)

`templateOverrides` is cleaned before it is stored and anything unrecognised is dropped, never stored: a header is `text`
(cut to 1024) or `media` (an http or https URL), `body` and `footer` are lists of slots (trimmed, cut to 1024, all-blank
dropped), and `buttons` need an `index` and a value (`subType` is `url`, `quick_reply` or `copy_code`, anything else
becomes `url`). Nothing usable stores `null`. A filled slot wins over the template's own variable map for that slot only.
`{{tokens}}` typed in a slot resolve per recipient with the same resolver as everywhere else (contact column, contact
attribute, workspace default, `today`, `business_name`), and an unknown token is an empty string, never the braces.

For the `waba` engine the sender builds the Cloud API components for every recipient: body variables in variable-map order,
header text or media, buttons, carousel cards. The rules are Meta's: the parameter count equals what the approved template
declares (padded or cut, none when there is no placeholder); a blank value is back-filled (the template's example, then the
placeholder name, then `-`) because Meta rejects an empty parameter; a button gets a parameter only when it takes one (a
static URL or a phone button does not; a quick reply with no value is left out).

## Reading broadcasts (WD-BCAST-001, 002, 030 to 036)

Permission `bcast.broadcasts.read`. WaDesk rendered the list and the detail page as HTML with some JSON for polling; here each
piece is an endpoint a screen composes.

| Route                                                     | What                                                                                                                                                                                                                                                                                                                                                                    |
| --------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /v2/broadcasts?status&range&q&limit&cursor`          | The list, newest first, 12 per page by default (max 100). `status` is any status string, `range` is `all`, `7d`, `30d` or `90d`, `q` a case-insensitive name substring. Each item carries the template name and the sender key.                                                                                                                                         |
| `GET /v2/broadcasts/summary`                              | The six tiles and the status pill counts for the whole workspace; they ignore the list filter. `stats`: total (broadcasts), recipients, sent, delivered, read, failed, clicked, processing, queued and the three percentages. `statusCounts`: all, scheduled, processing, completed, completed_with_errors, failed, plus any other status present (for example paused). |
| `GET /v2/broadcasts/:id`                                  | The detail page: header `counts` and `pct` (from the recipient rows, with the cascade), `donut`, hourly `deliveryCurve` in the broadcast's own zone, `failureReasons` (top 8 and Other), `template`, `sender` and `events`.                                                                                                                                             |
| `GET /v2/broadcasts/:id/recipients?status&q&limit&cursor` | Recipients newest first with name, number, status, error, timestamps and the clicks on the broadcast's links. `q` matches name, first or last name, or number.                                                                                                                                                                                                          |
| `GET /v2/broadcasts/:id/live`                             | The counters a screen polls while a broadcast moves; `inFlight` turns false when it is over (statuses processing, sending, scheduled, pending, queued are in flight).                                                                                                                                                                                                   |
| `GET /v2/broadcasts/:id/statistics`                       | Sent, delivered, read, failed, processing and queued counts.                                                                                                                                                                                                                                                                                                            |

An id of another organization is a 404, a malformed id a 400. Percentages: delivery is delivered over sent, read is read over
delivered, failed is failed over sent on the tiles; on the detail header sent, delivered and failed are over the audience.

## Actions: delete, retry, export (WD-BCAST-037, 038, 039, 040)

| Route                                  | Permission                | What                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| -------------------------------------- | ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `DELETE /v2/broadcasts/:id`            | `bcast.broadcasts.delete` | 204. Only a `scheduled` or `failed` broadcast; any other status is 422 `BCAST_NOT_DELETABLE` ("Only scheduled or failed broadcasts can be deleted."). Its recipients go with it, a queued job for it is withdrawn, an audit row and `broadcast.deleted` are written.                                                                                                                                                                                         |
| `POST /v2/broadcasts/:id/retry-failed` | `bcast.broadcasts.retry`  | 200 `{ retried, status: "processing" }`. Failed recipients go back to `pending` with the error and provider id cleared, the broadcast becomes due again and the sender sends only those; delivered recipients are never messaged again. 409 `BCAST_NOT_RETRYABLE` while the broadcast is `processing` or `scheduled`; 422 `BCAST_NO_FAILED_RECIPIENTS` when nothing failed. The emergency halt and the wallet are checked again. Needs an `Idempotency-Key`. |
| `GET /v2/broadcasts/:id/export`        | `bcast.broadcasts.export` | The recipients as a streamed CSV, `broadcast-<id>-recipients-<YYYYMMDD-HHMMSS>.csv`. Columns: Recipient, Phone (digits), Status, Clicked, Queued, Sent, Delivered, Read, Failed, Last event, Error. Times are `YYYY-MM-DD HH:mm` in the broadcast's own zone. A name or error that begins with `=`, `+`, `-` or `@` gets a leading apostrophe so a spreadsheet does not run it. Read in pages of 1000, so a broadcast of any size is never held in memory.   |

### The automatic retry sweep

Runs in the worker every 60 seconds (WaDesk ran it from the Node heartbeat, which a workspace with no Baileys socket never
produced). It takes finished broadcasts (`completed`, `completed_with_errors`, `failed`) from the last 7 days that still have
a failed recipient a retry could fix, whose `next_attempt_at` is due and whose `send_attempts` is below the limit. For each it
records the attempt and the wait first, puts the retryable failures back to `pending` and makes the broadcast due again.
The wait before attempt n is `min(3600, base x 2^(n-1))` seconds. Defaults: 3 attempts, base 60 s. Per-organization
overrides: `org_plan_state.overrides` keys `broadcast_retry_attempts` and `broadcast_retry_backoff_sec`. A recipient without a
number and a Meta "undeliverable" (#131026, #131021, #131051) are not retried. A broadcast that has used its attempts is
left for manual review.

## Link tracking (WD-BCAST-018, 042)

Every URL button of a `waba` broadcast that takes a parameter is replaced, per recipient, by a short link
`<APP_URL>/r/<token>` (a 12 character base62 token). A static URL button is never sent as a parameter, so it gets no link.
The same link for the same recipient in the same broadcast reuses its token (a retry never mints a new one and counters never
mix between broadcasts); a link lives `LINK_TRACKING_TTL_DAYS` days (default 90, never below 7). Links that are not http or
https (`tel:`, `mailto:`) and links that are already ours are left alone. `LINK_TRACKING_ENABLED=false` turns wrapping off.
For the engines that send a text body, `LinkTracker.wrapText` replaces every link in a recipient's body the same way.

`GET /r/<token>` is public (no sign-in, not versioned, because the link is printed in messages):

| Result | When                                                                                                                                                                                                                                |
| ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 302    | To the original address. A real visitor is counted; a link-preview crawler or tool (WhatsApp, Facebook, Meta, Slack, Twitter, LinkedIn, Google, Bing, Discord, Embedly, curl, wget, python-requests) is redirected but not counted. |
| 404    | An unknown token, or one that is not a token at all.                                                                                                                                                                                |
| 410    | `BCAST_LINK_EXPIRED`.                                                                                                                                                                                                               |
| 429    | More than 600 hits a minute from one address.                                                                                                                                                                                       |

A counted tap adds one to the link's `clicks`, adds one to `unique_clicks` when the address was not seen on that link in the
last hour, stamps first and last click, address and user agent, and writes the outbox event `broadcast.link_clicked`.
`broadcasts.clicked_count` is the number of **contacts** who clicked: it goes up the first time any of a contact's links in
the broadcast is tapped. The detail shows `counts.clicked` and `pct.clicked` (contacts who clicked over delivered); the
summary tiles show the clicked total; the recipients list shows each contact's clicks and last click.

## Pacing, the daily cap, pause and resume (WD-BCAST-022)

The sender sends to one recipient at a time, the way WaDesk's Node loop did, and paces itself.

- **Gap.** After each message it waits the `msg_gap` setting (default 3 s) plus or minus 20%, so 2.4 to 3.6 s. A warming number
  uses its own range instead (never under 1 s). No wait after the last recipient, and none for a recipient without a number.
- **Batches.** When they are on and the audience is bigger than one batch (default 50), it rests `bw_msg_gap` minutes
  (default 5, plus or minus 20%) after each full batch. A long rest is taken in short beats that keep the sender's lease alive.
- **Daily cap.** On the unofficial engine a number sends at most `baileys_daily_cap` messages per UTC day (default 4000), tallied
  in Redis, so every worker shares it and a restart does not reset it. At the cap the broadcast becomes `paused` with
  `{ reason: "daily_cap", resumeAfter: <next midnight UTC> }`, and nobody is lost: the unsent recipients stay `pending`.
- **One run per sender.** Two broadcasts through the same number would break the gaps its quality depends on, so a second run is
  put back for 15 seconds and tries again. The lease expires by itself if a worker dies.
- **Pause reasons.** `daily_cap`, `halt` (the emergency halt) and `manual`. The detail shows `pause` while paused.
- **Resume.** `POST /v2/broadcasts/:id/resume` (permission `bcast.broadcasts.resume`, `Idempotency-Key`): 200 `{ status: "processing" }`
  for a paused broadcast, 409 `BCAST_NOT_RESUMABLE` for any other. It carries on where it stopped. The worker also resumes by
  itself, every 60 seconds, a daily-cap pause after its `resumeAfter` and a halt pause once the halt is lifted.

The pacing numbers (`msg_gap`, batches, the cap) are WaDesk's defaults until the settings domain exposes them; they sit behind
`PACING_SETTINGS`. The clock and the dice of a run are injectable (`PacingRuntime`), which is how the tests run instantly.

## Delivery receipts (WD-BCAST-024, 027)

`BroadcastReceiptsService.handle(receipt)` (exported from `modules/broadcasts`) applies a delivery report about a sent message to
the broadcast recipient it belongs to. It is called by whatever receives the report, which has already checked who is speaking
(the Cloud API webhook handler and signature, the Twilio status callback and its token, the Baileys adapter): the WABA and
device domains own those routes. It returns `true` when the message belongs to a broadcast and `false` for any other message,
so the caller can fall through to the chat path.

```ts
{ providerMessageId: 'wamid...', status: 'sent' | 'delivered' | 'read' | 'failed', occurredAt: Date, errorMessage?, errorCode? }
```

Mappers for the providers: `mapBaileysAck(3 | 4 | 5)` gives delivered or read (1 and 2 say nothing new), `mapTwilioStatus` gives
sent, delivered, read or failed (queued, accepted and sending say nothing new).

No tenant is needed: the recipient row carries the provider's message id, and `bcast_receipt_lookup(id)` (a SECURITY DEFINER
function returning three ids) names the organization; the receipt is then applied under that organization's context.

One state machine for every source. A recipient only moves forward (pending, sent, delivered, read); `failed` is final; a read
recipient ignores a late delivered, sent or failed; the same report twice changes nothing. Delivered and read stamp their time
once, from the report. A failure keeps the provider's message, or `error_code:<code>`, cut to 512 characters.
The broadcast's counters move by the recipient's change of tier (a read recipient is also delivered and sent), not by a recount,
so a repeat is never applied twice. A failure (or a failure that is later undone) re-derives how a finished broadcast ended,
so `completed` becomes `completed_with_errors`, and `failed` when every recipient failed. A broadcast still running keeps its status.

## Outbound webhook events and bell entries (WD-BCAST-029)

Nothing new over HTTP. The outbox events a broadcast already wrote now carry the finished result for whoever delivers them
(`payload.webhook` is a list of `{ event, data }` with WaDesk's event names and keys; `payload.notification` is a bell entry).
The webhooks module posts `webhook` to the organization's subscribed URLs and adds `workspace_id`; the notifications module
writes `notification`. Ids are public uuids.

| Outbox event               | Webhook events in `payload.webhook`                                                                                                                          | Bell entry                                        |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------- |
| `broadcast.created`        | `broadcast_created`                                                                                                                                          | "Broadcast created: name", links to the broadcast |
| `broadcast.status_changed` | `broadcast_status_updated` (previous_status, success/delivered/read/fail counts)                                                                             | only completed, completed with errors, failed     |
| `broadcast.deleted`        | none                                                                                                                                                         | "Broadcast deleted: name", warning, no link       |
| `broadcast.message_status` | `message_sent/delivered/read/failed` with an `aggregate` block; a provider receipt also `broadcast_message_status_updated` (phone, error_code, error_reason) | none                                              |
| `broadcast.link_clicked`   | `campaign_contact_clicked` (original_url, token, click_at, ip, user_agent)                                                                                   | none                                              |

`broadcast.message_status` is written only while the organization has an active webhook subscribed to the event or to `*`, and
never twice for the same status. The `aggregate` block (`sent, delivered, read, failed, clicked, total`) is exact at the moment of
the event.
