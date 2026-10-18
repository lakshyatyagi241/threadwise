# Privacy: data requests (rights service)

Product extension (no reference screen). Spec: [privacy-and-data-governance.md](../specs/privacy-and-data-governance.md) section 4.5. Runbook:
[../privacy/dsar-runbook.md](../privacy/dsar-runbook.md). Register of what is erased and exported:
[../threadwise-port/wiring/privacy-and-data.md](../threadwise-port/wiring/privacy-and-data.md).

All routes are `/v2/privacy/...`, user tokens only. Nothing returns a person's name, number or address: a subject is a **masked label**.

| Method and path                                  | Permission               | What                                                                                             |
| ------------------------------------------------ | ------------------------ | ------------------------------------------------------------------------------------------------ |
| `GET /settings`, `PATCH /settings`               | read / manage            | `slaDays` (1 to 90, default 30)                                                                  |
| `GET /subjects?q=`                               | manage                   | find a contact or lead by name, phone or email; phone and email masked                          |
| `GET /requests`, `POST /requests`                | read / manage            | list (status, requestType, overdue, cursor) / log a request (Idempotency-Key)                   |
| `GET /requests/:id`                              | read                     | request, events, exports                                                                         |
| `POST /requests/:id/verify`                      | manage                   | `outcome` pending / verified (needs `method`, optional `evidenceRef` id) / not_verified (rejects) |
| `POST /requests/:id/hold`                        | manage                   | `{held:true, reason}` or `{held:false}`; a held request refuses erasure                          |
| `POST /requests/:id/reject`, `/complete`         | manage                   | close without erasure                                                                            |
| `POST /requests/:id/export` (202)                | manage                   | worker builds the ZIP (queue `privacy-export`); one at a time per request                       |
| `GET /requests/:id/exports/:exportId/download`   | manage                   | the ZIP, 7 days; audited; delivers an access / export / portability request                      |
| `POST /requests/:id/erase`                       | `privacy.erase.execute`  | `{dryRun:true}` preview, or `{dryRun:false, confirmation:"ERASE DSR-XXXXXXXX"}`                  |

Roles: Owner and Admin everything; Manager `privacy.requests.read`.

Status machine: `received -> verifying -> in_progress -> completed`, or `rejected` / `expired` (open and unverified past due date plus 30 days).
Errors: `PRIVACY_REQUEST_NOT_FOUND` 404, `PRIVACY_SUBJECT_NOT_FOUND` 404, `PRIVACY_REQUEST_STATE_INVALID` 409, `PRIVACY_IDENTITY_NOT_VERIFIED` 409,
`PRIVACY_LEGAL_HOLD` 409, `PRIVACY_CONFIRMATION_REQUIRED` 422, `PRIVACY_EXPORT_IN_PROGRESS` / `_NOT_READY` 409, `PRIVACY_EXPORT_NOT_FOUND` 404.

## Export

ZIP: `README.txt`, `index.json` (every registered holder with its row counts), `data/<holder>/<table>.json`, `messages.csv` (plain language,
formula-safe), `files.json` (stored files; chat media gets a sealed link good for 7 days for the admin who requested it). Secrets, hashes and
internal ids are left out. **Nothing is emailed to the person**; the workspace admin downloads it.

## Erase

1. Preview (`dryRun:true`): counts per table (deleted / anonymised / cascaded / retained / unlinked) and the number of stored files. Changes nothing.
2. Execute: needs a preview of the same request from the last 24 hours and the typed phrase. In one transaction the counts are taken again and
   must equal the preview, then the registry runs in order; any mismatch rolls everything back. Files are written to `privacy_erasure_files` and
   handed to the platform purge queue by the worker (about a minute).
3. Proof on the request: counts per table, files, registry digest, notes about what is not reached (backups, vendors), SHA-256. No personal value.

Semantics: conversations and messages are **deleted** (request option `historyMode: "anonymise"` keeps them without identity); contact files,
recordings and media are deleted; leads, deals, tasks, projects, forms, appointments, call logs and AI call logs keep the row with names, numbers
and text replaced by `[erased]` or NULL; invoices, payments, quotes and orders are kept for the statutory period (`FINANCIAL_RECORD_RETENTION_YEARS`)
with the buyer identity replaced (amounts, numbers, tax facts, dates stay); consent events stay as proof with no link to the person.

Call logging (`call_log_entries`, `telephony_click_calls`): a call log entry keeps the call (time, direction, outcome, duration) and loses the
customer's number, the workspace number, the notes, the provider call id and the recording reference. A click-to-call placement still waiting for
the provider's callback is **deleted**, found by contact id or by number. `telephony_connections` (the workspace's own provider numbers and a sealed
signing secret) and `call_logging_settings` hold no person's data and are not registered; the registry test does not flag them.

An appointment's `title` is "booking type, dash, invitee name" and the column is NOT NULL, so an erasure writes `[erased]` over it (the same for
the invitee's name, e-mail and phone, notes, answers, location, cancel reason, the e-mail last pushed to the calendar event and the manage link).
The event already written to the connected Google or Outlook calendar is not rewritten by an erasure; delete it there (see "not reached" in the proof).
`test/integration/privacy/appointments-erasure.spec.ts` books a person, erases them and reads each booking back as text to prove no trace is left.

## Contact delete (behaviour change)

`DELETE /v2/contacts/:id` and `POST /v2/contacts/bulk/delete` now erase the contact's **conversation history** (conversations, messages, media,
files, recordings, call logs, flow runs, AI call logs) with the contact. `?eraseHistory=false` (bulk body `eraseHistory:false`) keeps the
conversations and call logs without the person's identity (link, name, number, text and media removed). Leads, deals, tasks and invoices are
not touched by a plain delete (they are anonymised only by a data request). The Developer REST `DELETE /v1/contacts/:id` follows the default.
