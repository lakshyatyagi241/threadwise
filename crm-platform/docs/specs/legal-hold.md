# Legal hold: erasure is not absolute

Status: built (BL-295 backend, BL-296 screens), awaiting sign-off; counsel to confirm the wording. Not a Reference feature: a product extension of the rights service
([privacy-and-data-governance.md](privacy-and-data-governance.md) section 4.5, 4.6; API [../api/privacy.md](../api/privacy.md)).

> **Not legal advice.** The framework below is the engineer's reading of the rules named in section 1. Counsel must confirm the
> wording of every notice (section 10) and the periods, before a workspace relies on it. All texts are configurable keys, so counsel's
> words can replace ours without a code change.

## 1. Problem and legal frame

A person asks for erasure, but the business has to keep some of the data: a tax or accounting duty, a dispute, a regulator's request, an
internal investigation. Today the rights service can only refuse (`PRIVACY_LEGAL_HOLD` on one request, flag on the request row) and the
sweeps and delete paths do not know about the duty at all, so a nightly job or a bulk delete can destroy the evidence the business must keep.

| Rule                                            | What it says (summary)                                                                                                                     | What we build                                                                                       |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------- |
| GDPR Art. 17(3)(b), (e)                         | Erasure does not apply where processing is necessary for a legal obligation, or for the establishment, exercise or defence of legal claims | reason categories `legal_obligation`, `legal_claim`                                                 |
| GDPR Art. 18                                    | The person may obtain **restriction** of processing (data kept, not otherwise processed) while a claim or objection is open                | the held record is **restricted**: kept and locked, not erased                                      |
| GDPR Art. 12(3), (4)                            | Answer within one month; if no action is taken, say why and tell the person of the right to complain                                       | the requester response text (10), and the clock keeps running                                       |
| India DPDP Act s.8(7), s.17                     | Erase when the purpose is served unless retention is **necessary for compliance with a law**; s.17 exempts legal claims and investigations | reason categories `regulator_request`, `internal_investigation`                                     |
| Tax and accounting retention (country specific) | Invoices and payment records are kept for a statutory period                                                                               | already in the registry (`legalHold: financial_record`, ADR-0028); this feature does not replace it |

Three principles follow, and every decision below is checked against them:

1. **Erasure is not absolute, and a hold is not a refusal.** The request stays open and is _restricted_; when the duty ends, the erasure resumes.
2. **Restricted means kept and locked**: no marketing, no AI processing, no exports except to authorised legal users, every access logged.
   Normal service to the customer is not stopped (staff can still answer them and use the record for the purpose it was collected for).
3. **One guard, every purge path.** A hold that one nightly job forgets is no hold. All purges ask the same function.

## 2. Model

### 2.1 What a hold covers (scope)

| Scope       | Subject                                                                                     | Effect                                                                                                           |
| ----------- | ------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `contact`   | one contact and everything linked to them (their leads, conversations, calls, files, forms) | the person's records are restricted; the rest of the workspace is unaffected                                     |
| `lead`      | one lead that is not (yet) a contact                                                        | same, for the lead                                                                                               |
| `workspace` | the whole record set of the workspace                                                       | every subject in the workspace counts as held (a regulator order for "all records"); wholesale wipes are blocked |

A lead tied to a held contact is held with it, and a contact whose lead is held is held with it (one person).

### 2.2 Table `legal_holds` (tenant table, forced RLS)

| Column                                       | Notes                                                                                                                                                                                                                                             |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `org_id`, `id`, `uuid`                       | composite primary key, `UNIQUE (org_id, uuid)`                                                                                                                                                                                                    |
| `scope`                                      | `contact`, `lead`, `workspace`                                                                                                                                                                                                                    |
| `contact_id`, `lead_id`                      | composite FK to `contacts` / `leads`, `ON DELETE SET NULL`: a released hold survives the erasure it delayed, without a link to the person; an active one cannot lose its subject (trigger, 5.3). Exactly the column of the scope is set (`CHECK`) |
| `subject_label`                              | masked label at placement (`R•••• · ••••4821`), `Whole workspace`; never the name or number                                                                                                                                                       |
| `reason_category`                            | `legal_obligation`, `legal_claim`, `regulator_request`, `internal_investigation`                                                                                                                                                                  |
| `case_ref`                                   | the business's own reference (court file, ticket, regulator letter), 1 to 120 chars, required                                                                                                                                                     |
| `note`                                       | optional, up to 500 chars, **PII-light by rule**: the form says "do not write names, numbers or details of the matter"                                                                                                                            |
| `review_at`                                  | optional date by which the hold must be reviewed (a list filter and a badge show overdue ones)                                                                                                                                                    |
| `expires_at`                                 | optional end; a worker releases the hold then, exactly as a person would (`status = expired`)                                                                                                                                                     |
| `status`                                     | `active`, `released`, `expired`                                                                                                                                                                                                                   |
| `placed_by`, `placed_at`                     | who and when                                                                                                                                                                                                                                      |
| `last_reviewed_by`, `last_reviewed_at`       | the last review                                                                                                                                                                                                                                   |
| `released_by`, `released_at`, `release_note` | who ended it and why (optional text)                                                                                                                                                                                                              |
| `created_at`, `updated_at`, `row_version`    | `touch_row` trigger                                                                                                                                                                                                                               |

**One active hold per subject**: partial unique indexes on `(org_id, contact_id)`, `(org_id, lead_id)` and on `org_id` for the workspace scope, all
`WHERE status = 'active'`. A second hold for the same subject is `409 LEGAL_HOLD_EXISTS`; the second matter's reference goes into the
existing hold with _extend_ (one hold, several case references separated by `;`).

A hold is **active** when `status = 'active'` and `expires_at` is null or in the future. The worker moves an expired one to `expired` so the
unique index frees up; the function below does not trust the status alone.

### 2.3 Database helpers

- `is_subject_held(org_id bigint, subject_type text, subject_id bigint) returns boolean` (`STABLE`, runs under the caller's RLS):
  true when an active `workspace` hold exists, **or** an active hold names the subject (contact, lead, or the linked contact/lead), **or** the
  operator holds the whole workspace (`organizations.legal_hold`, the platform's own hold, kept as it is). `subject_id` may be null: only a
  workspace hold then answers true.
- `org_has_active_legal_hold(org_id bigint) returns boolean`: any active hold at all in the workspace. Wholesale wipes (a workspace deletion,
  the plan-lapse wipe) ask this one, because they would delete every held record too.

Both are plain SQL, so a sweep that runs one statement over every workspace adds `AND NOT is_subject_held(t.org_id, 'contact', t.contact_id)`
and keeps its batching.

### 2.4 How this relates to the holds that already exist

| Existing                                                                                 | Stays as it is                                                | Relation                                                                                          |
| ---------------------------------------------------------------------------------------- | ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| Call recording hold (`wa_calls.recording_legal_hold`, PR 407, `privacy.requests.manage`) | one recording kept, any contact                               | the retention sweep skips a recording when **either** the call hold or `is_subject_held` says so  |
| Operator workspace hold (`organizations.legal_hold`, `platform.workspace.legal_hold`)    | blocks archive and erase of a whole workspace by the platform | counted by `is_subject_held`; the tenant `workspace` scope is the workspace's own version of it   |
| Hold on one request (`privacy_requests.legal_hold`)                                      | a person pauses **that case** (`PRIVACY_LEGAL_HOLD`)          | unrelated to the subject hold; either one stops the erasure; only the subject hold locks the data |

## 3. What a hold blocks, and what stays allowed

### 3.1 Blocked (stable code `LEGAL_HOLD_ACTIVE`, HTTP 409, neutral message)

| Operation                                                                                                                                                                            | How                                                                                                                                                                                                                        |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Rights erasure (execute)                                                                                                                                                             | not executed; the case becomes **restricted** (4); no data changes                                                                                                                                                         |
| Contact delete (single), bulk delete (all selection modes)                                                                                                                           | refused before anything is touched (the whole bulk request, never a partial delete; the answer does not say how many are held, the audit row of the refusal does)                                                          |
| Contact merge where a **loser** is held                                                                                                                                              | refused (the loser row would be deleted). A held **winner** may absorb a loser                                                                                                                                             |
| Lead delete                                                                                                                                                                          | no lead delete path exists in the API; the database trigger covers any other code                                                                                                                                          |
| Retention sweeps: call recordings, call log recording references, lead event payloads, form answers, lead scoring log and chat digests, the export-file sweeps, contact export files | the row is **skipped**, not deleted, and counted as `skippedHeld` in the sweep's log line                                                                                                                                  |
| Wholesale wipes: plan-lapse wipe, operator workspace erase/archive                                                                                                                   | skipped / refused while `org_has_active_legal_hold`                                                                                                                                                                        |
| Import that would **overwrite** a held contact                                                                                                                                       | that row is rejected with reason `legal_hold` (the rest of the file imports). Creating other contacts is unaffected. Decision: an import is the one bulk path that silently rewrites values, so it cannot rewrite evidence |
| A DELETE from `contacts` or `leads` by any other code                                                                                                                                | database trigger raises (5.3), the net under every path above                                                                                                                                                              |

### 3.2 Restricted processing (the locked data)

| Operation                                                                                                         | Effect on a held subject                                                                                                              |
| ----------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| Marketing sends (broadcast, campaign, flow, automation, scheduled, store marketing, lead first reply)             | ConsentGate answers `deny`, reason **`legal_hold`**; every adopter already honours a deny                                             |
| `third_party_sharing`, `analytics_profiling`, `ai_content_processing`, `staff_ai_assist`, `voice_ai_conversation` | gate answers `deny` / `legal_hold`                                                                                                    |
| Company brief generation                                                                                          | the held contact's counts and conversations are left out of the facts                                                                 |
| AI copilot (`find_contact`, `generate_brief`)                                                                     | held contacts are not returned to the model                                                                                           |
| AI lead scoring                                                                                                   | held leads and contacts are not sent to the model                                                                                     |
| Contact CSV export                                                                                                | held contacts are left out unless the caller has `privacy.requests.manage` ("authorised legal user"); the export is audited as always |
| Reading a held contact (detail)                                                                                   | allowed, and every read writes an audit row (`module = contacts`, `action = read`, `delta.legalHold = true`)                          |

### 3.3 Stays allowed

Normal service: staff answer the customer, send **service/utility** messages (order, appointment, support replies: purpose `service_messaging`),
edit the record (every change is in the audit log with old and new values), add notes, take payments, issue invoices. A hold freezes
_destruction_ and _new kinds of use_, not the relationship. Also allowed: the **access/export request of the data subject** (Art. 15/20 are not
limited by a hold; the export builder does not consult it); archiving a contact (a flag, not a purge); plain operational sweeps that carry no
person (notification retention, push subscription prune, webhook delivery payloads, sessions) except under a `workspace` hold, where
the ones that carry subject data are listed in 6.

## 4. States of an erasure case with a hold

`privacy_requests.status` keeps its values. A case is **restricted** while `restricted_at` is set; the screen then shows the status
**"Restricted: legal hold"** instead of the plain one.

```
received -> verifying -> in_progress --execute--> completed          (no hold)
                              |
                              | hold active (placed before or after the request, or at execute)
                              v
                     in_progress + restricted
                              |  hold released / expired / no other hold covers the person
                              v
          erasure_confirmed?  yes -> resumed automatically by the worker -> completed (proof records "resumed after hold")
                              no  -> back to in_progress, staff run preview and execute as normal
```

- **Hold placed after the request**: every open erasure case of the subject (and, under a workspace hold, of the workspace) is set restricted in
  the same transaction as the hold (event `restricted`). A request logged for an identifier (phone/email) is resolved to the person
  and restricted the same way.
- **Request created for an already held person**: created normally, restricted at once.
- **Execute while held**: nothing is erased. The case is restricted (if not already), the confirmation (who typed `ERASE <ref>`) is recorded
  as `erasure_confirmed_by/at`, and the call answers `409 LEGAL_HOLD_ACTIVE` with `details.restricted = true`. The state change is committed
  before the error is thrown.
- **Preview while held**: allowed (counts only).
- **Release or expiry**: in one transaction the hold ends, every case restricted by it leaves the restriction (event `restriction_lifted`),
  provided no other active hold still covers the person (then it stays restricted by the other hold). A case with a recorded confirmation is
  executed by the worker within a minute **without asking again** (a person already confirmed it; the hold was the only reason it waited); the
  erasure runs on fresh counts, writes the usual proof with `resumedAfterHold: true`, events and audit, and the executing actor is the person
  who confirmed it. A case with no confirmation returns to `in_progress` and staff are told by the case event and the outbox event.
- **The clock** (`due_at`) keeps running. The case shows the requester response text (10) so the answer within the month states retention under a
  legal obligation without saying why. Overdue is still overdue.
- A restricted case can still be **rejected** or **completed manually** (rectification, objection) by staff, as before.

## 5. The guard

### 5.1 One shared service

`LegalHoldGuard` (module `privacy`, exported through the barrel `modules/privacy/index.ts`), all methods take the caller's `tx`:

- `heldContactIds(tx, orgId, ids)`, `heldLeadIds(...)`: the subset that is held.
- `assertContactsNotHeld(tx, orgId, ids)`, `assertSubjectNotHeld(tx, orgId, subject: ResolvedSubject)`: throw `AppError(LEGAL_HOLD_ACTIVE, 409)`.
- `orgHasHold(tx, orgId)`: for wholesale wipes.
- SQL fragments (`sqlNotHeldContact(orgCol, contactCol)`, `sqlNotHeldLead`) for statements that cannot loop over rows.

### 5.2 Race with a hold placed meanwhile

Placing a hold takes `pg_advisory_xact_lock(class, org)` (exclusive); every `assert*` takes `pg_advisory_xact_lock_shared` on the same key before it
reads. A purge in flight finishes first or sees the hold. Purges do not block each other.

### 5.3 Database backstop

`BEFORE DELETE` triggers on `contacts` and `leads` raise `LEGAL_HOLD_ACTIVE` (SQLSTATE `55000`) when `is_subject_held` is true and the delete is direct
(`pg_trigger_depth() <= 1`). A cascade from the workspace deletion (depth > 1) is let through on purpose: the workspace-level paths are
guarded where they decide (6), and the operator's own erase is not a tenant act. The API maps the trigger's error to the same 409.

## 6. Every purge path, and what was done

| Path (file)                                                                                                                                                    | Subject link                  | Change                                                                                                                                                                                      |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Rights erasure `privacy-requests.service.ts` `erase`                                                                                                           | resolved subject              | restricted flow (4)                                                                                                                                                                         |
| `PersonalDataErasureService.eraseContactHistory` (contact delete single and bulk)                                                                              | contact ids                   | `assertContactsNotHeld`                                                                                                                                                                     |
| Contact delete `contacts.service.ts` `remove`, bulk `contact-bulk.service.ts` `delete`                                                                         | contact                       | through `eraseContactHistory`; bulk `nextIds` takes only the batch it locks                                                                                                                 |
| Contact merge `contact-dedupe.service.ts`                                                                                                                      | losers                        | `assertContactsNotHeld(losers)`                                                                                                                                                             |
| Lead delete                                                                                                                                                    | lead                          | no API path exists; the delete trigger on `leads` is the guard                                                                                                                              |
| `call-recording-retention.service.ts` (+ repository)                                                                                                           | `wa_calls.contact_id`         | `AND NOT is_subject_held(...)` in `expired` and `lockExpired`                                                                                                                               |
| `logging/call-log-retention.service.ts`                                                                                                                        | `call_log_entries.contact_id` | skip held; click-to-call placement cleanup is operational (kept)                                                                                                                            |
| `leads/lead-retention-sweep.service.ts`                                                                                                                        | lead / contact                | payload purge skips held                                                                                                                                                                    |
| `forms-builder/form-retention-sweep.service.ts`                                                                                                                | contact on submission         | answers purge skips held                                                                                                                                                                    |
| `lead-scoring/lead-scoring-retention.service.ts`, chat digests                                                                                                 | contact                       | skip held                                                                                                                                                                                   |
| Export file sweeps: `contact-bulk` export files, `consent-export-sweep`, `audit-log-export-sweep`, `revenue-export-sweep`, `privacy-maintenance` export expiry | workspace                     | skipped while the workspace has a `workspace` hold (the files may be evidence); a subject hold does not keep report files                                                                   |
| Archive expiry `data-retention/retention.worker.ts` (`expireArchive`, objects of a closed month per workspace)                                                 | workspace                     | the objects of a workspace with **any** active hold (or the operator's) are kept, with the month manifest; the partition archiver itself only moves data to the archive and deletes nothing |
| `plan-retention.service.ts` wipe                                                                                                                               | workspace                     | not wiped while `org_has_active_legal_hold`; logged `skipped: legal hold`                                                                                                                   |
| `lifecycle.repository.ts` / `lifecycle.service.ts` (archive, erase, owner-deleted)                                                                             | workspace                     | the operator's `legal_hold` flag is OR-ed with `org_has_active_legal_hold`; "the hold wins"                                                                                                 |
| `minor-sweep`, `quiet hours`, other sweeps that only set flags                                                                                                 | -                             | not purges, unchanged                                                                                                                                                                       |
| Retention engine (BL-146, not built)                                                                                                                           | -                             | **must** call the guard; `legal-hold-coverage.spec.ts` lists the files that do and fails when a listed file stops referencing it                                                            |
| Operational sweeps without a person (notifications, push, webhook forward, sessions, flow runs older than N days)                                              | none                          | out of scope; listed so a reviewer can disagree                                                                                                                                             |

## 7. Roles and permissions (no new tenant keys)

`provision_workspace_presets` cannot know a key added later in some deployments, so this feature reuses the keys that exist:

| Action                                                          | Permission                | Presets (existing baseline) |
| --------------------------------------------------------------- | ------------------------- | --------------------------- |
| Place, extend, review, release a hold                           | `privacy.requests.manage` | Owner, Admin                |
| View the register, a contact's hold status, export the register | `privacy.requests.read`   | Owner, Admin, Manager       |
| Run an erasure (including resuming one)                         | `privacy.erase.execute`   | Owner, Admin                |
| Export held contacts (contact CSV)                              | `privacy.requests.manage` | Owner, Admin                |

Anyone else gets no hold information: the contact page does not ask the API about holds for them, a blocked delete says only that the record is
protected, and a marketing skip says only that processing of the contact is restricted. Platform operators have their own hold
(`platform.workspace.legal_hold`), unchanged.

## 8. API (`/v2/privacy/legal-holds`, ActorKinds `user`)

| Method and path                  | Permission | Body / query                                                                                                    | Result                                   |
| -------------------------------- | ---------- | --------------------------------------------------------------------------------------------------------------- | ---------------------------------------- |
| `POST /legal-holds` (Idempotent) | manage     | `scope`, `subjectId` (uuid, not for workspace), `reasonCategory`, `caseRef`, `note?`, `reviewAt?`, `expiresAt?` | 201 hold; 409 `LEGAL_HOLD_EXISTS`        |
| `GET /legal-holds`               | read       | `status`, `reasonCategory`, `scope`, `reviewDue`, `q` (case ref), `limit`, `cursor`                             | page of holds                            |
| `GET /legal-holds/:id`           | read       | -                                                                                                               | hold + history (audit rows)              |
| `POST /legal-holds/:id/extend`   | manage     | `reviewAt?`, `expiresAt?` (null clears), `addCaseRef?`, `note?`                                                 | hold                                     |
| `POST /legal-holds/:id/review`   | manage     | `nextReviewAt?`, `note?`                                                                                        | hold (records reviewer and time)         |
| `POST /legal-holds/:id/release`  | manage     | `reason?`                                                                                                       | hold + `casesResumed`                    |
| `GET /legal-holds/status`        | read       | `kind=contact\|lead`, `id` (uuid)                                                                               | `{ held, hold? }` for the contact banner |
| `GET /legal-holds/export`        | read       | the list filters                                                                                                | CSV for auditors; audited as `export`    |

`PrivacyRequest` gains `restricted`, `restrictedAt` and `restrictionNotice` (the workspace's own response text, null = the default text of the screen). `allowed.erase`
stays true while restricted: executing it records the confirmation (the call answers 409). `GET /privacy/settings` / `PATCH` gain `legalHoldRequesterNotice` (override text, null = default). Errors: `LEGAL_HOLD_ACTIVE` 409,
`LEGAL_HOLD_EXISTS` 409, `LEGAL_HOLD_NOT_FOUND` 404, `LEGAL_HOLD_NOT_ACTIVE` 409.

## 9. Edge cases

| Case                                                             | Decision                                                                                                                                                                                                                                            |
| ---------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Hold placed after an erasure was requested                       | the open cases are restricted in the same transaction (4); an erasure that already started is serialised by the advisory lock: it either completes first (and the hold finds no subject, `409 subject not found`) or sees the hold                  |
| Hold on a person with linked companies, deals, payments          | the hold is on the person; deals, invoices and payments are business records that stay anyway. A company is not held by a contact hold (the company is a business entity); its brief leaves the held contact out                                    |
| Held subject erased by a cascade from another delete             | the trigger blocks a direct delete; the paths that could cascade (company delete, user delete) set `contact_id` to NULL rather than deleting contacts, so no cascade reaches a contact. The workspace-level paths check `org_has_active_legal_hold` |
| Workspace deletion or cancellation while on hold                 | the hold wins: the owner's deletion stays `deleted` (data kept, workspace inaccessible), the platform erase and the plan wipe wait, and the lifecycle log says `legal hold`. Releasing the last hold lets them proceed on their normal schedule     |
| Access request (Art. 15) from a held person                      | answered in full; a hold never limits the person's own access                                                                                                                                                                                       |
| Two holds on one person                                          | not allowed; extend the first (one hold, several references)                                                                                                                                                                                        |
| Hold on a contact that is then merged as a winner                | the hold stays on the winner id; the loser must not be held                                                                                                                                                                                         |
| Hold expires while a case is restricted                          | the worker treats it like a release (system actor), the case resumes                                                                                                                                                                                |
| Duplicate contacts of the same person                            | the rights resolver finds all of them; the case is restricted if **any** is held                                                                                                                                                                    |
| Workspace data restored from a backup                            | holds are rows; they come back with the data. The re-apply-erasure tooling (BL-153) must skip held subjects (noted there)                                                                                                                           |
| A staff member without privacy permission deletes a held contact | 409 `LEGAL_HOLD_ACTIVE`, neutral text; the UI never says "investigation"                                                                                                                                                                            |

## 10. Notice texts (configurable keys)

All in `apps/web/messages/<locale>/privacy-requests.json` (21 locales), one namespace `legalHold`. A workspace may override the requester
response text with `privacy_settings.legal_hold_requester_notice` (one language); counsel's wording replaces the default keys.

| Key                           | Shown to                                  | Default (en)                                                                                                                                                                                                                                                                   |
| ----------------------------- | ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `legalHold.requesterResponse` | staff, as the text to send to the person  | "We have received your request. We are required to keep some of your data to meet a legal obligation, so we cannot erase it now. We have restricted how it is used and will erase it when the obligation ends. You can lodge a complaint with your data protection authority." |
| `legalHold.contactBanner`     | privacy-permission holders on the contact | "Legal hold: erasure and deletion paused"                                                                                                                                                                                                                                      |
| `legalHold.caseStatus`        | the rights case row                       | "Restricted: legal hold"                                                                                                                                                                                                                                                       |
| `legalHold.blockedMessage`    | anyone who hits the 409                   | "This record is protected and cannot be deleted at the moment."                                                                                                                                                                                                                |
| `gate.reasons.legal_hold`     | send reports, skip counters               | "Not sent: processing of this contact is restricted." (neutral: no mention of a hold)                                                                                                                                                                                          |

## 11. Interface (BL-296)

- Contact page: banner (privacy-read holders only) with case reference, category, review date; **More** menu: _Place legal hold_ / _Release hold_
  (manage only). The dialog asks category, case reference, a note with the "no personal details" warning, review date, optional expiry.
- Settings > Privacy > **Legal holds**: register with filters (status, category, scope, review due, case reference), place a hold on a person (found by name, phone or email) or on the workspace,
  extend, review, release, CSV export for auditors.
- Rights case row and detail: status "Restricted: legal hold", the requester response text with a copy button, the events.
- Neutral for everyone else: nothing is shown; plan and persona independent (a workspace without the privacy keys never sees it).
- Help guides in `apps/web/src/features/privacy-requests/help/` (en, ar).

## 12. Audit and events

Every change writes `audit_log` (module `legal_holds`, actions `insert`, `update`, `delete` for release; deltas carry category, case reference, dates and
status, never the note) and an outbox event in the same transaction: `legal_hold.placed`, `legal_hold.extended`, `legal_hold.reviewed`,
`legal_hold.released`, `legal_hold.expired`, `privacy_request.restricted`, `privacy_request.resumed`. Payloads carry ids and the category, not
the subject. A refused purge writes an audit row (`module = legal_holds`, `action = read`, `delta.blocked = <operation>`) so an auditor can see attempts.

## 13. Open decisions for counsel and the owner

1. Wording of the requester response and of every key in 10, per jurisdiction.
2. Whether a hold needs a second approver (four eyes). Not built; the placing user and the register are audited.
3. Maximum duration without review (we show overdue reviews, we do not auto-release on review date).
4. Whether restriction should also block the **service** channel for a person who asked for Art. 18 restriction (this build keeps service).
5. Bulk delete that contains held contacts is refused whole; an option to skip held ones is BL-297.
6. Other exports (segments, reports, API list) that include held contacts: the contact CSV is covered; the rest is BL-297.
7. Notifications to the privacy owner when a review is due (the list filter exists; a notification is BL-297).
8. The ConsentGate reason code `legal_hold` appears in the skip counters of a send report (the text shown for it is neutral). A person who can open send reports can infer that a hold exists. Mapping it to a neutral public code is possible; it is left as it is because the owner asked for this reason in the closed set.

## 14. Tests

Unit: the gate rule (`legal_hold` for marketing and AI purposes, service unaffected), request mapping, error shape. Integration (real Postgres): RLS
and tenant isolation of `legal_holds`, unique active hold, `is_subject_held` for every scope, the trigger backstop, erasure with and without a hold,
release resumes (confirmed and unconfirmed cases), expiry, each sweep skips a held subject, bulk delete refused, merge refused, plan wipe skipped,
permissions on every route, idempotent placement, the registry test with the new table. Browser: place from the contact, banner, release,
register filters, export.
