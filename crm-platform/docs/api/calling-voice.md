# API: calling-voice (CALL)

Base `/v2/calling`, session auth; ids are uuids; every route needs the plan feature `waba_calling`. Reads and calls need `call.calls.use`;
switching a number needs `call.calling.manage` (Owner, Admin and Manager by default). Types are in `@crm/contracts` (`calling-voice`).

| Method and path                    | What                                                                                                   | Notes                                                                                                                                               |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /numbers`                     | the WhatsApp numbers with their calling switch                                                         |                                                                                                                                                     |
| `POST /numbers/:id/toggle`         | `{ enable }` switch calling on Meta, then locally                                                      | 422 `CALL_COEXISTENCE_UNSUPPORTED` (no Meta call), `CALL_META_REFUSED` (Meta's reason in words)                                                     |
| `GET /eligibility?conversationId=` | whether the Call button shows, the number to use, the customer's permission and whether it is `usable` |                                                                                                                                                     |
| `POST /permission-request`         | `{ numberId, to, body? }` ask the customer for permission                                              | `{ alreadyPermitted: true }` when Meta says the business may already call                                                                           |
| `POST /calls/dial`                 | `{ numberId, to, sdpOffer, contactId?, conversationId? }` place a call                                 | 422 `CALL_PERMISSION_REQUESTED` (a request was sent, no call), `CALL_NOT_ENABLED`, `CALL_META_REFUSED`, `CALL_OUTSIDE_WINDOW` (BL-177)              |
| `GET /calls/:id/progress`          | `{ status, sdpAnswer, ended, endReason }`                                                              | the answer only once the call is active and the SDP is an answer                                                                                    |
| `GET /calls/pending`               | calls ringing now (inbound, last two minutes, five at most)                                            | `sdpOffer` for the browser to answer; `aiHandled`                                                                                                   |
| `POST /calls/:id/accept`           | `{ sdpAnswer }`                                                                                        | 204; 409 `CALL_STATE_CONFLICT` when a teammate took it                                                                                              |
| `POST /calls/:id/reject`           | `{ reason? }`                                                                                          | 204; 409 unless ringing                                                                                                                             |
| `POST /calls/:id/terminate`        | hang up or cancel                                                                                      | 204; the row closes on Meta's terminate event                                                                                                       |
| `POST /calls/:id/recording`        | multipart `recording`, up to 50 MB                                                                     | `{ url }`; 422 `CALL_RECORDING_FAILED`, `CALL_RECORDING_DISABLED`, `CALL_RECORDING_CONSENT_REQUIRED` (nothing stored); 409 `CALL_RECORDING_ON_HOLD` |
| `GET /calls/:id/recording`         | the file (range requests work)                                                                         | workspace only; 404 when there is none                                                                                                              |

## Calling readiness (EXT-CALL-007 to 011)

Same base and session auth. Reading needs `call.calls.use`; checking and the setting's write need `call.calling.manage`. Unlike the routes above,
these do **not** answer 422 `PLAN_FEATURE_LOCKED` to a workspace without `waba_calling` on the read routes: the checklist then says
`plan_missing` and Meta is not asked (a write of the setting still needs the plan feature). Types: `@crm/contracts` (`calling-voice/readiness`).

| Method and path                     | What                                                                                 | Notes                                                                                                                                                                                         |
| ----------------------------------- | ------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /readiness`                    | every WhatsApp number with its checklist as of its last check                        | `{ rows: [{ numberId, status, callingEnabled, metaCallingStatus, checks[], checkedAt, source, ... }] }`; no call to Meta                                                                      |
| `GET /numbers/:id/readiness`        | one number's checklist                                                               | 404 `CALL_NUMBER_NOT_FOUND` for a number of another workspace                                                                                                                                 |
| `POST /numbers/:id/readiness/check` | `{ source?: manual \| health \| enable }` look at the number now and keep the result | reads Meta (phone, token, subscribed apps, calling settings) and only reads the platform app's webhook fields; never switches calling on; brings the local switch in line with Meta (audited) |
| `GET /settings`                     | `{ autoEnableOnConnect, rowVersion, updatedAt }`                                     | off until saved                                                                                                                                                                               |
| `PUT /settings`                     | `{ autoEnableOnConnect, rowVersion? }`                                               | needs the plan feature; `rowVersion` required after the first save (409 otherwise); audited (`wa_calling_settings`)                                                                           |

A check is `{ key, state: ok \| warn \| fail, code, params? }` per prerequisite, in this order: `plan_feature`, `connection`, `not_coexistence`,
`number_registered`, `messaging_limit`, `token_scopes`, `webhook_subscribed`, `calls_field`, `calling_enabled`, `turn`, `dialler_permissions`,
`recording_consent`. The server sends the **code** and the web writes the sentence (every code has its words in the 21 languages): nothing is
parsed out of a message. `status` is `blocked` when any row but "calling is off" is a fail, `ready_to_enable` when only that is, `attention` when
calling is on and a row warns, `ready` otherwise, `never_checked` before the first check.

**Meta's refusals** (`toggle`, `permission-request`, `calls/dial`) are `422 CALL_META_REFUSED` with `errors: [{ path: 'reason', message }]`, the
reason being one of `prerequisites`, `coexistence`, `permission_scope`, `token_expired`, `calling_not_enabled`,
`no_call_permission`, `permission_request_limit`, `receiver_uncallable`, `meta_unreachable`, `unknown`; `message` keeps Meta's
own sentence for logs and for `unknown`. Mapping is by Meta's error code first (141000, 138000, 138001, 138006, 138009, 190, 10, 200 to 299) and only
for the prerequisite and missing-permission refusals by wording together with code 100, in `calling-meta-errors.ts`.

Background: the outbox event `whatsapp.connection.connected` (the WABA domain's own) queues a check about 20 seconds after a connect, in the
`calling-readiness` queue, for workspaces whose plan has calling (the worker's check is also the only one that may add the `calls` field to the platform's Meta app, under a Redis lock); a worker timer takes the numbers that are due every minute, claiming each for 30 minutes in the same statement and giving the claim back if queueing fails (jobs
`calling-readiness-sched-<number>-<window>`). A check after a connect marks the number's automatic switch-on **pending** (`wa_calling_readiness.auto_enable_pending`); every later check, the
schedule's and a person's, keeps trying while it is pending, and a check that cannot read Meta looks again after 1, 5 and 15 minutes. It ends when calling
is on, when the plan or `autoEnableOnConnect` no longer allow it, or when a person turns calling off. Nothing else switches calling on.

Public: `GET/POST /v2/public/webhooks/wa-calling`, the same callback as `/v2/public/webhooks/whatsapp` (Meta allows one per app).

Call statuses: `ringing`, `connecting` (an operator claimed it), `active`, `ended`, `failed`. The ledger of everything that happens to a call is
the table `wa_call_events` (connect, dial_sent, pre_accept_sent, accept_sent, reject_sent, terminate_sent, terminate, recording_stored, dial_failed,
accept_failed); it has no endpoint.

## Call logs and call analytics (TW-CALL-022, 036)

Base `/v2/calling/call-logs`, session auth, every route needs the plan feature `waba_calling` (the same gate as the dial routes) and the key
`call.logs.read`. Its **record scope** says whose calls a person sees, by who handled the call: `all`, `team` (their own and their teammates') or
`own`. A call outside the scope, or in another workspace, is a 404 (never 403), and the totals, the filter choices and the analytics follow the same
scope. Owner and Admin hold the key at `all`; the Manager preset holds it at `own`. Playing a recording also needs `call.recordings.play`.

| Method and path      | What                                                                                                                         | Notes                                                                                                       |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `GET /`              | a page of calls, newest first, with `kpis.workspace` (Reference's four cards) and `kpis.selection` (what the filters select) | query below; 25 to a page, 100 at most                                                                      |
| `GET /filters`       | `{ numbers, agents }` for the filter bar                                                                                     | agents are the teammates who handled a call the person may see                                              |
| `GET /analytics`     | `{ from, to, tz, totals, series, byAgent, heatmap }`                                                                         | `range` (24h, 7d, 30d) or `from`/`to`, `tz`, `numberId`; days are counted in `tz`                           |
| `GET /:id`           | one call: who, when, how long, the reason it failed, the ledger as a `timeline`, whether there is a recording                | the timeline carries only a step's type, time and a short note, never Meta's payload (it holds the SDP)     |
| `POST /:id/playback` | `{ url, expiresAt, mime }`: a link that plays the recording for five minutes, for the person who asked                       | needs `call.recordings.play`; written to the audit trail (`wa_calls`, action `read`) each time; 404 if none |

List query: `range` (`24h`, `7d`, `30d`; default `30d`, counted back from now with no upper bound, as in Reference) **or** `from` and `to` (days,
`YYYY-MM-DD`, in `tz`, both inclusive; `from` alone runs to today, `to` alone starts 29 days earlier; at most 366 days), `status`
(`completed`, `in-progress`, `no-answer`, `declined`, `failed`), `direction` (`inbound`, `outbound`), `numberId`, `agentId`, `q` (digits of a phone
number, or part of the contact's name), `page`, `pageSize`. 422 `CALL_RANGE_INVALID` for a backwards or too wide range or an unknown zone.

How a call reads: `failed` when the call row is failed; `completed` when it ended with talk time; `declined` when it ended with no talk time and
Meta's end reason is `REJECTED` or `DECLINED`; `no-answer` for any other end; `in-progress` while it rings or runs. **Answered** is a call that
ended with talk time. **Missed** is a call the customer placed that ended or failed with no talk time (a call we placed that nobody picked up is
`no-answer` but not missed). **Answered rate** is answered over finished calls. **Average handle time** is the average talk time of answered calls.
`kpis.workspace`: `total`, `last24h`, `minutes24h` (whole minutes), `completed`, `failed` (failed plus no-answer), over every call the person may see.

The recording link is the same sealed media link the inbox uses for a customer's file (`MediaTokenService`): it is minted for one person in one
workspace, it expires after `CALL_PLAYBACK_TTL_SECONDS` (300), and the player reads it through `GET /v2/media/:token`, which still needs the
person's session and answers range requests. A teammate, another workspace or an anonymous caller gets 404 or 401.

Realtime: the `call.changed` push (see TW-CALL-012) is also what refreshes the call log and the analytics screens when a call rings, is answered or
ends. There is no new event.

Dev data: `pnpm --filter @crm/api seed:demo-calls` (`SEED_ORG_ID`, `SEED_CALLS`) writes a month of sample calls with their ledger steps and a few
playable recordings into the private media store of the local disk. It never runs in production and adds nothing when run twice.

## Call recording consent and lifecycle (BL-144)

Not in Reference (it recorded every inbound call from the first second, with no notice and no deletion). Spec:
[privacy-and-data-governance.md](../specs/privacy-and-data-governance.md) section 5; requirements:
[voice-bot-consent-requirements.md](../privacy/voice-bot-consent-requirements.md). Same plan gate (`waba_calling`).

| Method and path                     | Key                       | What                                                                                                                                                                                                                                                                                                                                  |
| ----------------------------------- | ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /recording-settings`           | `call.calls.use`          | `{ enabled, consentMode, retentionDays, noticeText, noticeVersion, rowVersion, updatedAt }`; defaults: off, `confirmed`, 90                                                                                                                                                                                                           |
| `PUT /recording-settings`           | `call.recordings.manage`  | same fields + `rowVersion` (omit on the first save); a changed notice text is a new version; 422 `CALL_RECORDING_SETTINGS_INVALID`; 409 on a stale `rowVersion`                                                                                                                                                                       |
| `GET /calls/:id/recording-gate`     | `call.calls.use`          | the ConsentGate answer for this call (`decision`, `reason`) with the notice text and the evidence so far                                                                                                                                                                                                                              |
| `POST /calls/:id/recording-consent` | `call.calls.use`          | `{ decision: 'granted' \| 'declined', method }`; only on a `connecting` or `active` call; `method` must be the one the workspace mode takes (`spoken_yes` for `confirmed`, `announcement_continue` for `announcement`); 422 `CALL_RECORDING_DISABLED`, `CALL_RECORDING_CONSENT_INVALID`; a decline after a file was stored removes it |
| `DELETE /calls/:id/recording`       | `call.recordings.manage`  | 204; the file goes, the call stays; 409 `CALL_RECORDING_ON_HOLD`; audited                                                                                                                                                                                                                                                             |
| `PUT /call-logs/:id/recording-hold` | `privacy.requests.manage` | `{ hold, reason? }` (a reason is required to place a hold); 204; audited                                                                                                                                                                                                                                                              |

**The rule.** `POST /calls/:id/recording` asks `ConsentGate.check(orgId, subject, 'voice', 'call_recording', 'voice', { purposeEnabled, noticeEvidence })`
and stores nothing unless the answer is `allow`: the workspace switch is on (`purpose_not_enabled` otherwise), the call row holds a recorded notice
version, and the person's answer is `granted` (`consent_declined` / `needs_notice` otherwise). The check is repeated under the call's row lock before
the path is written, so a refusal that arrives while a file is being stored wins and the file is removed. The browser also arms its recorder only
after a granted answer, and discards what it caught on a refusal.

**Evidence kept on the call** (`wa_calls.recording_*`): answer, method, time, teammate, notice version and its sha-256 (the text of every version is
in `call_recording_notice_versions`, append-only). No audio hash, voiceprint, IP address or free text is stored.

**Lifecycle.** `recording_stored_at` starts the retention clock. A daily sweep in the worker (`CallRecordingRetentionService`, 03:23) removes the file and
clears `recording_path` for every recording older than its workspace's `retentionDays` (90 when never chosen; 7 to 365), skipping a legal hold; each
recording is locked and re-checked in its own transaction. `recording_deleted_at` and `recording_deleted_reason` (`retention`, `manual`,
`consent_withdrawn`) say what happened; the call row stays so the log and billing stay correct. An erasure through the rights service clears the path
and queues the file (`calls.logs`, `wa_calls.recording_path`). Recordings made before this migration start their clock when it ran.

The call log detail carries `recording.lifecycle` (consent, storedAt, expiresAt, legalHold, holdReason, deletedAt, deletedReason). New ledger steps:
`recording_consent_granted`, `recording_consent_declined`, `recording_deleted`, `recording_hold_set`, `recording_hold_lifted`.

Outbox: `call.recording.settings_changed`. Audit: module `call_recording_settings` (switch, mode, days, notice version) and `wa_calls` (consent,
delete, hold with reason).
