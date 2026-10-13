# API: calling-voice (CALL)

Base `/v2/calling`, session auth; ids are uuids; every route needs the plan feature `waba_calling`. Reads and calls need `call.calls.use`;
switching a number needs `call.calling.manage` (Owner, Admin and Manager by default). Types are in `@crm/contracts` (`calling-voice`).

| Method and path                    | What                                                                                                   | Notes                                                                                                  |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------ |
| `GET /numbers`                     | the WhatsApp numbers with their calling switch                                                         |                                                                                                        |
| `POST /numbers/:id/toggle`         | `{ enable }` switch calling on Meta, then locally                                                      | 422 `CALL_COEXISTENCE_UNSUPPORTED` (no Meta call), `CALL_META_REFUSED` (Meta's reason in words)        |
| `GET /eligibility?conversationId=` | whether the Call button shows, the number to use, the customer's permission and whether it is `usable` |                                                                                                        |
| `POST /permission-request`         | `{ numberId, to, body? }` ask the customer for permission                                              | `{ alreadyPermitted: true }` when Meta says the business may already call                              |
| `POST /calls/dial`                 | `{ numberId, to, sdpOffer, contactId?, conversationId? }` place a call                                 | 422 `CALL_PERMISSION_REQUESTED` (a request was sent, no call), `CALL_NOT_ENABLED`, `CALL_META_REFUSED` |
| `GET /calls/:id/progress`          | `{ status, sdpAnswer, ended, endReason }`                                                              | the answer only once the call is active and the SDP is an answer                                       |
| `GET /calls/pending`               | calls ringing now (inbound, last two minutes, five at most)                                            | `sdpOffer` for the browser to answer; `aiHandled`                                                      |
| `POST /calls/:id/accept`           | `{ sdpAnswer }`                                                                                        | 204; 409 `CALL_STATE_CONFLICT` when a teammate took it                                                 |
| `POST /calls/:id/reject`           | `{ reason? }`                                                                                          | 204; 409 unless ringing                                                                                |
| `POST /calls/:id/terminate`        | hang up or cancel                                                                                      | 204; the row closes on Meta's terminate event                                                          |
| `POST /calls/:id/recording`        | multipart `recording`, up to 50 MB                                                                     | `{ url }`; 422 `CALL_RECORDING_FAILED`                                                                 |
| `GET /calls/:id/recording`         | the file (range requests work)                                                                         | workspace only; 404 when there is none                                                                 |

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
