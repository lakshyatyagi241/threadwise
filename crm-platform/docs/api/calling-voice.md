# API: calling-voice (CALL)

Base `/v2/calling`, session auth; ids are uuids; every route needs the plan feature `waba_calling`. Reads and calls need `call.calls.use`;
switching a number needs `call.calling.manage` (Owner, Admin and Manager by default). Types are in `@crm/contracts` (`calling-voice`).

| Method and path | What | Notes |
| --- | --- | --- |
| `GET /numbers` | the WhatsApp numbers with their calling switch | |
| `POST /numbers/:id/toggle` | `{ enable }` switch calling on Meta, then locally | 422 `CALL_COEXISTENCE_UNSUPPORTED` (no Meta call), `CALL_META_REFUSED` (Meta's reason in words) |
| `GET /eligibility?conversationId=` | whether the Call button shows, the number to use, the customer's permission and whether it is `usable` | |
| `POST /permission-request` | `{ numberId, to, body? }` ask the customer for permission | `{ alreadyPermitted: true }` when Meta says the business may already call |
| `POST /calls/dial` | `{ numberId, to, sdpOffer, contactId?, conversationId? }` place a call | 422 `CALL_PERMISSION_REQUESTED` (a request was sent, no call), `CALL_NOT_ENABLED`, `CALL_META_REFUSED` |
| `GET /calls/:id/progress` | `{ status, sdpAnswer, ended, endReason }` | the answer only once the call is active and the SDP is an answer |
| `GET /calls/pending` | calls ringing now (inbound, last two minutes, five at most) | `sdpOffer` for the browser to answer; `aiHandled` |
| `POST /calls/:id/accept` | `{ sdpAnswer }` | 204; 409 `CALL_STATE_CONFLICT` when a teammate took it |
| `POST /calls/:id/reject` | `{ reason? }` | 204; 409 unless ringing |
| `POST /calls/:id/terminate` | hang up or cancel | 204; the row closes on Meta's terminate event |
| `POST /calls/:id/recording` | multipart `recording`, up to 50 MB | `{ url }`; 422 `CALL_RECORDING_FAILED` |
| `GET /calls/:id/recording` | the file (range requests work) | workspace only; 404 when there is none |

Public: `GET/POST /v2/public/webhooks/wa-calling`, the same callback as `/v2/public/webhooks/whatsapp` (Meta allows one per app).

Call statuses: `ringing`, `connecting` (an operator claimed it), `active`, `ended`, `failed`. The ledger of everything that happens to a call is
the table `wa_call_events` (connect, dial_sent, pre_accept_sent, accept_sent, reject_sent, terminate_sent, terminate, recording_stored, dial_failed,
accept_failed); it has no endpoint.
