# Privacy: data requests (rights service)

Product extension (no reference screen). Spec: [privacy-and-data-governance.md](../specs/privacy-and-data-governance.md) section 4.5. Runbook:
[../privacy/dsar-runbook.md](../privacy/dsar-runbook.md). Register of what is erased and exported:
[../threadwise-port/wiring/privacy-and-data.md](../threadwise-port/wiring/privacy-and-data.md).

All routes are `/v2/privacy/...`, user tokens only. Nothing returns a person's name, number or address: a subject is a **masked label**.

| Method and path                                | Permission              | What                                                                                                                                                                           |
| ---------------------------------------------- | ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `GET /settings`, `PATCH /settings`             | read / manage           | `slaDays` (1 to 90, default 30); `legalHoldRequesterNotice` (the workspace's wording of the answer to a held person, or null)                                                  |
| `GET /subjects?q=`                             | manage                  | find a contact or lead by name, phone or email; phone and email masked                                                                                                         |
| `GET /requests`, `POST /requests`              | read / manage           | list (status, requestType, overdue, restricted, cursor) / log a request (Idempotency-Key)                                                                                      |
| `GET /requests/:id`                            | read                    | request, events, exports                                                                                                                                                       |
| `POST /requests/:id/verify`                    | manage                  | `outcome` pending / verified (needs `method`, optional `evidenceRef` id) / not_verified (rejects)                                                                              |
| `POST /requests/:id/hold`                      | manage                  | `{held:true, reason}` or `{held:false}`; a held request refuses erasure                                                                                                        |
| `POST /requests/:id/reject`, `/complete`       | manage                  | close without erasure                                                                                                                                                          |
| `POST /requests/:id/export` (202)              | manage                  | worker builds the ZIP (queue `privacy-export`); one at a time per request                                                                                                      |
| `GET /requests/:id/exports/:exportId/download` | manage                  | the ZIP, 7 days; audited; delivers an access / export / portability request                                                                                                    |
| `POST /requests/:id/erase`                     | `privacy.erase.execute` | `{dryRun:true}` preview, or `{dryRun:false, confirmation:"ERASE DSR-XXXXXXXX"}`; 409 `LEGAL_HOLD_ACTIVE` when the person is held (the confirmation is kept, nothing is erased) |

Roles: Owner and Admin everything; Manager `privacy.requests.read`.

Status machine: `received -> verifying -> in_progress -> completed`, or `rejected` / `expired` (open and unverified past due date plus 30 days).
Errors: `PRIVACY_REQUEST_NOT_FOUND` 404, `PRIVACY_SUBJECT_NOT_FOUND` 404, `PRIVACY_REQUEST_STATE_INVALID` 409, `PRIVACY_IDENTITY_NOT_VERIFIED` 409,
`PRIVACY_LEGAL_HOLD` 409 (the one request is on hold), `PRIVACY_CONFIRMATION_REQUIRED` 422, `PRIVACY_EXPORT_IN_PROGRESS` / `_NOT_READY` 409, `PRIVACY_EXPORT_NOT_FOUND` 404,
`LEGAL_HOLD_ACTIVE` 409 (the person or workspace is under a legal hold), `LEGAL_HOLD_EXISTS` 409, `LEGAL_HOLD_NOT_FOUND` 404, `LEGAL_HOLD_NOT_ACTIVE` 409.

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

## Derived copies (revenue exports, company briefs)

A derived copy is a file or summary built FROM the records of truth. It has no retention duty of its own, so it must not outlive an erasure
(GDPR Art. 17(1); the Art. 17(3)(b) exemption for a legal obligation covers the invoice and the payment, not a copy made from them; the DPDP
Act and the storage-limitation principle read the same way). The records of truth keep their own rules: invoices and payments are kept for the
statutory period with the buyer replaced (`sales.invoices`), and `audit_log` rows are not touched by any of this (kept for security and legal
obligations, pseudonymised by the existing rules). Two registered holders (`manifests/derived.ts`, tier `core`, disposition `delete`):

| Holder (table)                               | Retention rule                                                                                                                                    | Staff member erased                                                                                                              | Contact erased (CRM delete or data request)                                                                                                            |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `revenue.exports` (`revenue_report_exports`) | Temporary: the file is unavailable after **7 days** (`REVENUE_EXPORT_TTL_DAYS`) and the daily sweep (03:23) empties it within 24 hours after that | Every row they requested **or that was mailed to their address** (`emailed_to`), with its file; the foreign key cascades as well | If the contact is a buyer (an invoice or payment points at them by id, address or number): **every unexpired export of the workspace**; otherwise none |
| `companies.briefs` (`company_briefs`)        | Cache: reused for a day, overwritten when regenerated                                                                                             | Every brief they generated; the foreign key cascades as well                                                                     | The briefs of the companies the contact is linked to (`contacts.company_id`), whoever generated them                                                   |

- **Where an export file lives.** In the row itself: `file_gz` holds the gzipped CSV or PDF. There is no object-store copy and nothing in the
  purge queue, so deleting the row deletes the file. The email only carries a link. After the 7 days the sweep sets the row to `expired` and
  empties `file_gz`; the row (window, filters, and the address the mail went to) stays as the record that an export was made, until its
  requester is erased. An export is therefore gone well inside the one-month "without undue delay" period of GDPR Art. 12(3).
- **Why every unexpired export on a buyer's erasure.** The row records the window, grouping and owner/team/currency filters, not the buyers a
  file lists, so there is no exact set to delete. The files are regenerable, so the workspace loses a click, not a record. Exports being built
  (`queued`, `running`) are removed too: a worker that already read the buyer's rows then finds no row and stores no file. Expired and failed
  rows hold no file and stay. A contact with no invoice or payment cannot appear in any export and purges none.
- **Why a contact's brief goes with the contact.** A brief is written by an AI model from counts, dates, amounts and short masked texts (a
  company name, deal and task titles, company property values; emails and long numbers are masked before anything is sent; no contact name,
  email, phone or message text is read). Titles and property values are typed by people and can name one, and the model can repeat what it is
  given, so `content` is registered as personal. The brief regenerates from the records that remain, without the erased person.
- **Audit.** Each purge writes one `audit_log` row (module = the table, action `delete`, `delta.rows` = the count, `delta.cause` =
  `staff_erased`, `contact_deleted` or `rights_request`). It holds a count, never a value. A dry run writes nothing.
- **A person's own export.** A contact's export never lists these tables (`exportLink` is the staff link only), so it cannot expose another
  member's export rows or briefs. A staff member's export (the registry entry point for the staff subject) lists their own rows without the file.
- **Staff entry point.** `PersonalDataErasureService.eraseStaff(tx, orgId, userIds)` runs the staff-linked derived tables. Account deletion
  (`DELETE FROM users`) already removes the same rows through the foreign keys (both are `ON DELETE CASCADE`), which
  `test/integration/privacy/derived-copies-erasure.spec.ts` proves; the rest of the staff subject (login, sessions) is the BL-143 follow-up.
- A leaver who is deactivated, not deleted, keeps their user row, so their briefs stay until the account is deleted; their export files still
  expire after 7 days.
- Backups keep a purged copy until they expire (14 days local, up to 12 months off-site), like every other erased row.

Counsel should confirm the wording of the retention statement and the buyer rule before they are quoted to customers.

## Contact delete (behaviour change)

`DELETE /v2/contacts/:id` and `POST /v2/contacts/bulk/delete` now erase the contact's **conversation history** (conversations, messages, media,
files, recordings, call logs, flow runs, AI call logs) with the contact. `?eraseHistory=false` (bulk body `eraseHistory:false`) keeps the
conversations and call logs without the person's identity (link, name, number, text and media removed). Leads, deals, tasks and invoices are
not touched by a plain delete (they are anonymised only by a data request). The Developer REST `DELETE /v1/contacts/:id` follows the default.

## Legal holds (BL-295)

Erasure is not absolute: a legal hold freezes erasure and every purge for a contact, a lead or the whole workspace, and **restricts** the data (kept and
locked). Spec and the legal frame (GDPR Art. 17(3), Art. 18; DPDP s.8(7), s.17; counsel must confirm wording): [../specs/legal-hold.md](../specs/legal-hold.md).
No new permission key: placing, extending, reviewing and releasing is `privacy.requests.manage` (Owner, Admin); reading the register and a person's
status is `privacy.requests.read` (Owner, Admin, Manager).

| Method and path                       | Permission | What                                                                                                   |
| ------------------------------------- | ---------- | ------------------------------------------------------------------------------------------------------ |
| `POST /legal-holds` (Idempotency-Key) | manage     | `{scope: contact                                                                                       | lead | workspace, subjectId?, reasonCategory, caseRef, note?, reviewAt?, expiresAt?}`; 409 `LEGAL_HOLD_EXISTS` |
| `GET /legal-holds`                    | read       | register, newest first: `status`, `reasonCategory`, `scope`, `reviewDue`, `q` (case reference), cursor |
| `GET /legal-holds/status?kind=&id=`   | read       | `{held, hold, viaWorkspace}` for a contact or lead (the contact banner)                                |
| `GET /legal-holds/:id`                | read       | the hold and its history (audit rows, never the note)                                                  |
| `POST /legal-holds/:id/extend`        | manage     | `reviewAt`, `expiresAt` (null clears), `addCaseRef`, `note`                                            |
| `POST /legal-holds/:id/review`        | manage     | records reviewer and time, optional `nextReviewAt`                                                     |
| `POST /legal-holds/:id/release`       | manage     | `{reason?}`; answers `casesLifted` and `erasuresResuming`                                              |
| `GET /legal-holds/export`             | read       | the register as CSV for auditors (same filters); audited as an export                                  |

Reason categories: `legal_obligation`, `legal_claim`, `regulator_request`, `internal_investigation`. One active hold per subject. A subject is a masked
label; the note is PII-light by rule (the screen says so) and never travels in an audit delta or an event.

**What a hold does.** Every purge path asks one question (`is_subject_held` in the database, `LegalHoldGuard` in code): the rights erasure, the CRM's contact
delete (single and bulk, `409 LEGAL_HOLD_ACTIVE`), a merge that would delete a held duplicate, the retention sweeps of call recordings, call-log recording
references, lead payloads, form answers, the AI scoring log and chat digests, export-file expiry under a workspace hold, the plan-lapse wipe and the workspace
lifecycle (the hold wins). A database trigger refuses a direct delete of a held contact or lead as the net under all of them. An import row that would overwrite a
held contact is rejected with the reason `legal_hold`. The ConsentGate refuses marketing, third-party sharing, profiling and AI purposes with the reason
`legal_hold` (a neutral text: "processing of this contact is restricted"); company briefs, the copilot's contact search and AI lead scoring leave a held contact
out; the contact CSV export leaves held contacts out unless the caller has `privacy.requests.manage`; opening a held contact writes an audit row. Service messages and
normal editing go on.

**A rights erasure under a hold.** The case is `restricted` (status stays `in_progress`; `restricted`, `restrictedAt` and `restrictionNotice` on the request) from the
moment the hold is placed or the request is made. Executing the erasure records the confirmation and answers `409 LEGAL_HOLD_ACTIVE` with `errors[restricted=true]`
after committing; nothing is erased. When the hold is released or expires, the case leaves the restriction (`restriction_lifted`); an erasure someone confirmed is
executed by the worker within a minute on fresh counts and the proof carries `resumedAfterHold: true`. The clock keeps running.

Events (outbox): `legal_hold.placed`, `.extended`, `.reviewed`, `.released`, `.expired`, `privacy_request.restricted`, `.resumed`, `.resumed_erased`. Audit module
`legal_holds`; a refused purge writes `action = read` with `delta.blocked`.
