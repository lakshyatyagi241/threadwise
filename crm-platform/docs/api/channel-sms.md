# SMS channel API (send-only)

Everything is under `/v2`, signed in as a user, with an `Idempotency-Key` header on every write. A sender is addressed by its uuid.
No response ever carries an Account SID, an auth token or an MSG91 key. SMS is **send-only**: there is no receive route, no inbox
thread and no reply. Providers: Twilio (any country) and MSG91 (India, DLT).

Gates, in this order on every route: sign-in, the permission, the plan feature `sms` (422 `PLAN_FEATURE_LOCKED` on every route, reads
included), then the body is validated. The platform switch `sms_enabled` (a `platform_settings` row, default off) only hides entry
points: the list reports it as `platformEnabled`, the broadcast composer returns nothing for `?channel=sms` while it is off, and
a sender that already exists keeps sending. The delivery-report webhook is never plan-gated, so a downgraded workspace's late
reports still land.

## Platform switch (operator console, TW-SMS-025)

Platform operator token (`/v2/platform/...`, IP allowlist and MFA from the operator guard). Every operator may read; only a super
admin changes it (support gets 403, a workspace token 401), exactly like the unofficial WhatsApp switch.

| Method and path     | Who         | What it does                                                                                      |
| ------------------- | ----------- | ------------------------------------------------------------------------------------------------- |
| `GET /platform/sms` | operator    | `{ enabled }`; `false` when the `sms_enabled` row is missing.                                     |
| `PUT /platform/sms` | super admin | `{ enabled }` -> `{ enabled }`. Upserts the `sms_enabled` row; 422 for a non-boolean. Idempotent. |

The write drops the platform-settings snapshot, so `GET /sms/senders` (`platformEnabled`) and `GET /broadcasts/compose?channel=sms`
(the broadcast and campaign sender list) change on the next request. Nothing a workspace owns is deleted either way. Audited as
`platform.sms_updated { before: { enabled }, after: { enabled } }`, also when the state did not change. The console page is
`/admin/sms` (WhatsApp hub, after Node bridge).

## Senders (TW-SMS-001 to 008)

| Method and path           | Permission           | What it does                                                           |
| ------------------------- | -------------------- | ---------------------------------------------------------------------- |
| `GET /sms/senders`        | `sms.senders.read`   | The workspace's senders, oldest first, and the report address.         |
| `POST /sms/senders`       | `sms.senders.manage` | Verify the keys with the provider, then connect (or update). 201.      |
| `PATCH /sms/senders/:id`  | `sms.senders.manage` | Activate or deactivate; 409 `ROW_VERSION_CONFLICT` on a stale version. |
| `DELETE /sms/senders/:id` | `sms.senders.manage` | Remove the sender and its keys. 204, even for an unknown id.           |
| `POST /sms/lookup`        | `sms.senders.read`   | Is this number a mobile, a landline or invalid (Twilio Lookup)?        |

Stored in `wa_provider_configs` (`provider = 'sms'`, never primary), so the broadcast and campaign sender pickers read the same row.
Keys are encrypted JSON `{account_sid, auth_token, from_number}`; the rest is `meta_json`.

### A sender

```json
{
  "id": "5b0c0e0e-8f0e-4a55-9a8b-2f5a6c1d7e11",
  "senderKey": "sms:5b0c0e0e-8f0e-4a55-9a8b-2f5a6c1d7e11",
  "provider": "twilio",
  "label": "SMS · Twilio",
  "fromNumber": "+17372508034",
  "alphanumeric": false,
  "active": true,
  "senderId": "",
  "dltTemplateId": "",
  "ratePerSegment": "0.0075",
  "currency": "USD",
  "lastError": null,
  "deliveryReportUrl": null,
  "connectedAt": "2026-10-11T09:30:00.000Z",
  "rowVersion": 1
}
```

`senderKey` is what a broadcast (`senderKeys`) or campaign (`senderKey`) names. `alphanumeric` is true when `fromNumber` has a letter
(a one-way sender id). `lastError` is why the provider refused the key at send time; the sender is then switched off (`active: false`).
`deliveryReportUrl` is MSG91 only: its own address, with a secret in the path, to paste into the MSG91 panel.

### List

`GET /sms/senders`:

```json
{
  "data": [{ "...": "senders, oldest first" }],
  "deliveryReportUrl": "https://app.example.com/v2/sms/status",
  "platformEnabled": true
}
```

`deliveryReportUrl` is Twilio's address (Twilio is told it per message, nothing to paste). Always https.

### Connect

`POST /sms/senders`

```json
{
  "provider": "twilio",
  "fromNumber": "+17372508034",
  "accountSid": "ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
  "authToken": "••••••••",
  "ratePerSegment": "0.0075",
  "currency": "usd"
}
```

MSG91:

```json
{
  "provider": "msg91",
  "fromNumber": "THRDWS",
  "authToken": "<MSG91 auth key>",
  "senderId": "THRDWS",
  "dltTemplateId": "1107160000000000000"
}
```

- `provider` is `twilio` (default) or `msg91`, else 422 `VALIDATION_FAILED` "The selected sms provider is invalid.". `fromNumber` is
  required, trimmed, at most 32 characters, and kept exactly as typed: `+1 737…` and `1737…` are two senders. `accountSid` at most 64,
  `authToken` at most 255, `senderId` at most 16, `dltTemplateId` at most 64, `ratePerSegment` a number of at least 0 (kept as a
  string), `currency` at most 8 (upper-cased, `USD` when blank).
- Twilio: a blank `accountSid` and/or `authToken` is filled, each on its own, from the workspace's Twilio WhatsApp connection. The SID
  must start with `AC`.
- MSG91: the key is `authToken`; a key typed in `accountSid` is accepted when `authToken` is blank and is stored as the token, never
  in two places. A DLT template id selects MSG91's template ("flow") route, blank the free-text route.
- The provider proves the keys **before anything is stored**: 422 `SMS_CREDENTIALS_REJECTED` with the provider's reason (also in `details`
  on `accountSid`), nothing saved. The DLT sender id and template id are not checked until the first send.
- The same `fromNumber` updates its sender (keys replaced, meta merged key by key, active again, `lastError` cleared); a blank `senderId`
  or `dltTemplateId` overwrites the stored one. The MSG91 report secret is kept across updates.
- A **new** sender must fit the plan's `devices` cap, counted together with the workspace's personal numbers and every Cloud API,
  Twilio and SMS connection: 422 `PLAN_LIMIT_REACHED` "You've reached your plan's limit of N devices. …". Updating one needs no place.
- Audit `sms_senders` insert or update; event `sms.sender.connected { uuid, provider, reconnected }`.

### Activate, deactivate, remove

`PATCH /sms/senders/:id` body `{ "active": false, "rowVersion": 1 }` returns the sender with `rowVersion` bumped. Writing the state it
already has changes nothing. Event `sms.sender.toggled { uuid, active }` (also written with `reason: "bad_credentials"` when a send
shows the provider refused the key). A deactivated sender is in no picker and cannot send; a broadcast or campaign still pointing
at it fails with "No sendable SMS number connected" and does **not** move to another sender.

`DELETE /sms/senders/:id` hard-deletes the sender and its keys; another workspace's id changes nothing. Broadcasts and campaigns that
named it fall back to the workspace's next connected SMS sender at send time (Reference's rule). Audit delete; event
`sms.sender.removed { uuid, provider }`.

### Check a number

`POST /sms/lookup` body `{ "number": "+1 (415) 555-1234" }`, always 200:

```json
{
  "digits": "14155551234",
  "kind": "mobile",
  "carrier": "T-Mobile",
  "message": "Mobile — can receive SMS. Carrier: T-Mobile."
}
```

`kind` is `mobile`, `landline`, `voip`, `invalid` or `unknown` (a valid number whose line type Twilio did not report counts as textable;
so does anything else but landline, voip and invalid). The sender used is the workspace's first **connected Twilio** sender; none gives
`kind: "unknown"` and "Connect a Twilio SMS number first.". A verdict is cached 90 days **per workspace**; a provider failure is not cached.
At most 30 checks a minute per user (429 `RATE_LIMITED`), because each miss is a billed Twilio call.

## Sending (TW-SMS-010 to 021, 024, 026, 030)

There is no send route of its own. SMS is an engine of the broadcast and campaign senders, registered for `sms` in the shared
`EngineSenderRegistry` in **both** the API and the worker, so the same dispatchers, queues, retries and sweepers run it.

- **Compose.** `GET /broadcasts/compose?channel=sms` returns only the SMS senders (`key: "sms:<uuid>"`, `phone` as typed, `engine: "sms"`)
  and the workspace's SMS templates (`wa_templates.channel = 'sms'`, approved); empty while `sms_enabled` is off. The default composer
  never lists an SMS sender or template.
- **Create.** `POST /broadcasts` with `senderKeys: ["sms:<uuid>"]` and `POST /campaigns` with `senderKey: "sms:<uuid>"` need the plan feature
  `sms` (422 `PLAN_FEATURE_LOCKED`) as well as `broadcast` / `campaign`, and are never held by the wallet precheck (SMS is never
  charged to the wallet). A campaign on SMS drops buttons and quick replies. "Send later" is honoured: the broadcast waits for its time.
- **Per recipient.** The dispatcher has already merged that contact's variables (named variables included). The SMS engine then:
  1. refuses a contact who opted out after the audience was built ("This contact has opted out of messages.");
  2. takes one message from the month's allowance (below);
  3. sends the text only (header, footer, buttons and media are not SMS) through Twilio (`From`, `To` as `+digits`, `Body`, and a
     `StatusCallback` to the report address) or MSG91 (the flow route when the sender has a DLT template id, otherwise the plain route);
  4. returns the provider's message id, stored on the recipient, or throws the operator sentence (stored as the recipient's error).
     There is no pacing gap and no batch cooldown for SMS.
- **Errors, in the operator's words.** Twilio 572006, 21608, 21211, 21606, 21212, 21610 and 21614 and MSG91's auth key, DLT template,
  sender id and credit refusals are translated; any other text is the provider's own, else `HTTP <status>`, else "SMS send failed".
  A Twilio **21610** (the recipient replied STOP at Twilio) also flags the contact `is_unsubscribed` so the next run does not try again.
  A refused key (Twilio 401/403, MSG91 auth) switches the sender off with `lastError`.
- **Monthly allowance.** The plan limit `sms_monthly` (0 = unlimited) counts accepted messages (not segments) in the UTC calendar month
  in `plan_usage` (metric `sms_sent`). A spent month fails the whole run before anything is sent; during a run each message reserves its
  place atomically, so the cap is never overshot, and a message the provider refuses gives its place back. The sentence:
  "You've reached your plan's limit of N SMS messages a month. Upgrade your plan to send more." The usage panel shows it as `sms_monthly`.
- **Segments.** `measureSms` (`@crm/contracts`) says how many segments a text costs: 160 / 153 per segment in GSM-7, 70 / 67 in UCS-2
  (any character outside GSM makes the whole text UCS-2), extension characters cost two units. UCS-2 counts UTF-16 units, so an emoji
  is two (Reference counted one and under-counted).

## Delivery reports (TW-SMS-022, 023)

| Method and path            | Who    | Proof                                         |
| -------------------------- | ------ | --------------------------------------------- |
| `POST /sms/status`         | Twilio | `X-Twilio-Signature`, with the sender's token |
| `POST /sms/status/:secret` | MSG91  | the secret in the path (per sender)           |

Public, not in the API docs, throttled to 240 a minute per address, and `204` for everything except a failed proof (`401`): an unknown
message, a status that says nothing new (`queued`, `sending`, …), a malformed body and an internal error are all a quiet 204, because
the providers retry hard and disable a webhook that keeps failing.

- **Twilio** posts a form: `MessageSid` (or `SmsSid`), `MessageStatus` (or `SmsStatus`), `ErrorCode`, `ErrorMessage`. The tenant is the one
  that owns the recipient row carrying that message id (`bcast_receipt_lookup` / `camp_receipt_lookup`, never the request); the signature
  (HMAC-SHA1 over the public https address plus the fields in name order, base64, compared in constant time) must match the auth token
  of one of **that workspace's** Twilio SMS senders. Another workspace's token cannot speak for it.
- **MSG91** posts JSON to the address on the sender (`deliveryReportUrl`), which the operator pastes into the MSG91 panel. The report may
  be wrapped in `data`, name the message `requestId` or `request_id`, the status `status` or `deliveryStatus`, or carry a `report` string
  or list (`status`, `deliveryStatus`, `desc`). `sms_sender_by_dlr_secret(secret)` (SECURITY DEFINER) names the sender; the report is applied
  only when the message belongs to that sender's workspace. Unknown secret: 401.
- **Mapping** (lower-cased, trimmed): `sent`; `delivered`, `1` or a text containing `deliv` (`DELIVRD`) is delivered; `undelivered`, `failed`,
  the codes `2 5 6 9 13 17 25` or a text containing `fail`, `undeliv`, `reject`, `expire`, `block`, `ndnd` or `ndnc` is failed (checked first,
  so "undelivered" never reads as delivered). `delivery_unknown` and `partially_delivered` say nothing.
- **Effect.** The report goes to the campaign recipient first, then the broadcast recipient, through their own state machines: a recipient
  only moves forward (sent, then delivered or failed), a late `sent` can never undo `delivered`, a repeat changes nothing, the counters move
  by the change, and a failure keeps `<code> <text>` (or "SMS undelivered"). Broadcast recipients now get delivery too (Reference left them
  `sent` forever).

## Not built

Everything that exists only to receive texts (the inbound webhook, inbox threads, STOP capture from replies, automation on inbound texts,
replying from the inbox; TW-SMS-D01 to D08). Also not built yet: a per-message SMS record with segments and cost (TW-SMS-027, 029; the
plan decision is no new table), a recipient-level retry that skips permanent failures, and SMS templates created through the templates API
(that domain's create path is still WhatsApp-only; the composer already reads `channel = 'sms'` rows).
