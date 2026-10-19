# API: call logging (calls that are not WhatsApp calls)

Spec: [specs/call-logging.md](../specs/call-logging.md) (the model, the sources, the mobile contract, privacy). Types are in `@crm/contracts`
(`calling-voice/call-logging`, `calling-voice/logs`). Session auth, ids are uuids. The WhatsApp calling routes are in [calling-voice.md](calling-voice.md).

Keys: `call.logs.create` (log, edit your own, check, click-to-call, ingest), `call.logging.manage` (settings, telephony connections, any manual entry),
`call.logs.read` (existing; its record scope says whose calls a person sees, by who handled them). These routes are **not plan-gated**, and neither are the
Call logs routes below (BL-257): a workspace without the plan feature `waba_calling` reads the calls it logged. Only what is WhatsApp's keeps the gate (see
"What `waba_calling` still gates").

## Log a call

Base `/v2/calls`.

| Method and path         | Key                                         | What                                                                                                                                                                  | Notes                                                                                                                                                                                                        |
| ----------------------- | ------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `POST /log`             | `call.logs.create`                          | `{ contactId? , customerPhone?, direction, outcome, startedAt?, durationSec?, notes?, ourPhone?, numberLabel?, source?, externalId?, followUp?, suggestStageNudge? }` | 201 `{ entry, created, matchedByPhone, followUpTaskId, nudges[] }`. `Idempotency-Key` honoured. Never refused by a consent rule                                                                              |
| `PATCH /log/:id`        | `call.logs.create`                          | `{ outcome?, direction?, startedAt?, durationSec?, notes? (null clears), rowVersion }`                                                                                | Own manual entry inside the edit window, or `call.logging.manage`. 409 on a stale `rowVersion`                                                                                                               |
| `DELETE /log/:id`       | `call.logs.create`                          | 204; removes the entry and its timeline line (a follow-up task stays)                                                                                                 | Same rule as PATCH                                                                                                                                                                                           |
| `POST /ingest`          | `call.logs.create`                          | the mobile app's batch (below)                                                                                                                                        | 200 with a result per entry                                                                                                                                                                                  |
| `POST /check`           | `call.logs.create`                          | `{ contactId? , customerPhone?, purpose: 'service' \| 'marketing' }` -> `{ decision, reason }`                                                                        | Places nothing. `deny` + `on_dnc_list` for a marketing call to a Do-Not-Call number                                                                                                                          |
| `POST /click-to-call`   | `call.logs.create`                          | `{ connectionId, contactId? , customerPhone?, agentPhone?, purpose }` -> `{ callRef, contactId }`                                                                     | `Idempotency-Key` honoured. 422 `CONSENT_OPTED_OUT` (`errors[0] = { path: 'reason', message: 'on_dnc_list' }`), `TELEPHONY_CLICK_UNSUPPORTED`, `TELEPHONY_CALL_FAILED`; 404 `TELEPHONY_CONNECTION_NOT_FOUND` |
| `GET /logging-settings` | `call.logs.create` or `call.logging.manage` | `{ createContactsFromUnknownCallers, editWindowHours, rowVersion, updatedAt }`                                                                                        | Defaults: off, 24 hours, `rowVersion: null` until saved                                                                                                                                                      |
| `PUT /logging-settings` | `call.logging.manage`                       | same fields + `rowVersion` (omit on the first save)                                                                                                                   | 409 on a stale or missing `rowVersion`; audited (`call_logging_settings`); event `call.logging.settings_changed`                                                                                             |

`direction` is `inbound | outbound`; `outcome` is `connected | no_answer | busy | left_voicemail | wrong_number | declined | failed`; `source` on `POST /log` is `manual`
(default) or `web_click_to_call` (the "did you call? log it" prompt). `durationSec` 0 to 86,400; `notes` up to 2,000 characters; `startedAt` defaults to now minus the
duration and may not be more than 5 minutes ahead or older than 400 days (422 `CALL_LOG_TIME_INVALID`). A call needs a contact or a readable number (422
`CALL_LOG_CONTACT_REQUIRED`, with `errors[].path` = `contactId`, `customerPhone` or `ourPhone`). `followUp: { dueAt, title?, assigneeId? }` makes a task for the contact in the same
transaction (422 `CALL_LOG_FOLLOW_UP_NEEDS_CONTACT` without one; needs `record.tasks.create`; the assignee must be an active teammate the person may assign). A
named `contactId` must be readable by the person (404 / 403 otherwise); a number is matched only among readable contacts. The answer's `entry.editable` says whether this person may
change it now.

Errors specific to editing: 404 `CALL_LOG_ENTRY_NOT_FOUND` (not found, another workspace, or another person's entry), 403 `CALL_LOG_NOT_EDITABLE` (reported by a phone or a provider),
403 `CALL_LOG_EDIT_WINDOW_CLOSED`.

Audit: module `call_log_entries` (insert, update, delete; the delta names the facts: source, direction, outcome, duration, `hasNotes`, never the notes or the number), `call_logging_settings`,
`telephony_connections`, `telephony_click_calls`. Outbox events: `call.logged` (`uuid, source, direction, outcome, durationSec, contactId, handlerId`), `call.log.updated`,
`call.log.deleted`, `call.click_to_call.placed`, `call.logging.settings_changed`, `telephony.connection.created | updated | secret_rotated | deleted`.

## A contact's calls

| Method and path                     | Key              | What                                                                                               | Notes                                                                                                                                                                  |
| ----------------------------------- | ---------------- | -------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /v2/contacts/:contactId/calls` | `call.logs.read` | `{ data: CallLogRow[], page }` newest first; `?limit` (1 to 100, default 25), `?cursor`, `?source` | Needs the right to read the contact (its record scope). The log's record scope says which of its calls are shown. 404 for a contact outside the workspace or the scope |

Each row is the Call logs row (below) with `source`, `outcome` and `notesPreview`.

## The Call logs, with both sources

Base `/v2/calling/call-logs` (needs `call.logs.read`; **no plan feature** for the list, filters, analytics and detail). What changed, all additive:

- `GET /` accepts `source` (`whatsapp | manual | telephony | mobile_app | web_click_to_call`). Rows carry `source` (absent from an older server means `whatsapp`), `outcome` (null for a WhatsApp call)
  and `notesPreview`. `kpis.workspace` and `kpis.selection` count both sources. `numberId` selects WhatsApp numbers, so it leaves logged calls out. `status` reads a logged call as in the spec (connected = `completed`,
  declined = `declined`, failed or wrong number = `failed`, the rest `no-answer`).
- `GET /analytics` accepts `source` and returns `bySource: [{ source, calls, answered, missed }]`.
- `GET /:id` answers for a logged call too: `call.notes`, `call.followUpTaskId`, a one-step `timeline` (`logged`), and `recording.available: false` (a reference on a provider is never returned or played here). `POST /:id/playback` is 404 for it.
- The WhatsApp calls read exactly as before; the integration spec for the existing log runs unchanged.

### What `waba_calling` still gates (BL-257)

Without the plan feature the list, `/filters`, `/analytics` and `/:id` answer 200 for the calls the person may see, whatever their source. Calls already in
`wa_calls` from the time the workspace had the feature are listed and openable too (read only). These keep the existing `422 PLAN_FEATURE_LOCKED` problem:

| Request                                                                                                 | Without the feature                                                        |
| ------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| `GET /` or `GET /analytics` with `numberId`                                                             | `422 PLAN_FEATURE_LOCKED` (a WhatsApp number is a WhatsApp calling filter) |
| `POST /:id/playback`                                                                                    | `422 PLAN_FEATURE_LOCKED` (checked before the call is looked up)           |
| `GET /filters`                                                                                          | 200 with `numbers: []`; `agents` are the teammates of every source         |
| `GET /v2/calling/numbers`, `/readiness`, `/settings`, `/recording-settings`, the dial and answer routes | `422 PLAN_FEATURE_LOCKED`, as before                                       |

`source=whatsapp` is not an error without the feature: it selects nothing. Permission and scope are unchanged: no `call.logs.read` is 403, and a call
outside the person's record scope or in another workspace is 404.

## The mobile app's batch: `POST /v2/calls/ingest`

Bearer token of the signed-in person (the app's normal session). Body: `{ deviceId (<= 64), platform: 'android' | 'ios', entries: [1..100] }`, each entry
`{ deviceCallId, direction, startedAt, durationSec, customerPhone, deviceCallType?, outcome?, ourPhone?, notes?, contactId? }`. Answer (200):

```json
{
  "results": [
    { "index": 0, "status": "created", "id": "<uuid>", "contactId": "<uuid>|null", "reason": null },
    { "index": 1, "status": "ignored", "id": null, "contactId": null, "reason": "unknown_number" }
  ],
  "counts": { "created": 1, "duplicate": 0, "ignored": 1, "rejected": 0 }
}
```

`status`: `created`, `duplicate` (already stored: the first entry's id is returned), `ignored` (`unknown_number`, `blocked`, `contact_limit`: nothing stored by design) or `rejected`
(`unusable_phone`, `invalid_time`, `contact_not_found`, `error`). `outcome` wins over `deviceCallType`. 422 for a batch of 0 or more than 100 entries. 401 without a token, 403 without `call.logs.create`.

## Telephony

Base `/v2/calls/telephony`, key `call.logging.manage`.

| Method and path                       | What                                                                                                                                                                                 |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `GET /providers`                      | `{ rows: [{ key, label, supportsClickToCall }] }`: `generic`, and `fake` outside production                                                                                          |
| `GET /connections`                    | `{ rows: [Connection] }`                                                                                                                                                             |
| `POST /connections`                   | `{ provider, label, numbers?: ['+91...'], playsRecordingNotice? }` -> 201 `{ connection, secret }`; the secret (`tws_` + 64 hex) is shown **once**. 422 `TELEPHONY_PROVIDER_UNKNOWN` |
| `PATCH /connections/:id`              | `{ label?, numbers?, playsRecordingNotice?, status?: 'active' \| 'disabled' }`                                                                                                       |
| `POST /connections/:id/rotate-secret` | a new secret (shown once); the old one stops working at once                                                                                                                         |
| `DELETE /connections/:id`             | 204; the calls it reported stay                                                                                                                                                      |

A `Connection` is `{ id, provider, label, numbers, status, secretHint (last four characters), playsRecordingNotice, lastEventAt, webhookPath, createdAt }`. The secret is stored encrypted and never returned again.

### The status callback: `POST /v2/public/webhooks/telephony/:connectionId`

Public (the signature is the authentication), throttled to 240 a minute per address. Headers `X-Telephony-Timestamp` and `X-Telephony-Signature: v1=<hex HMAC-SHA256("<timestamp>.<raw body>", secret)>`; the
timestamp must be within 5 minutes. Body: see the spec (section 4.3). Answers: `204` once the callback is proven (also for a disabled connection, whose callback is ignored, and for a payload that reports no finished call);
`401` for an unknown connection, a bad signature, a stale timestamp or a missing header (the same answer for all, so connections cannot be probed). The worker (`telephony-ingest` queue) writes the entry; a retry changes nothing.

## Not in this API

No audio is stored or served; no vendor is called by any shipped adapter; the API-key variant of the batch (`/api/v1`) does not exist (BL-253).
