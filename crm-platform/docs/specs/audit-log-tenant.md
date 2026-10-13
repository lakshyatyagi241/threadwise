# Audit log for the workspace (tenant-facing) and the full Notifications page

Status: built on branch `lakshya/next/auditlog` (server, web, tests). Owner sign-off pending on the decisions in section 12.
Reference ids: TW-NOTIF-007, 008 (Notifications page), TW-NOTIF-029, 030, 031 (Activity Log, detail, CSV), TW-NOTIF-035 (retention).
Wiring: [wiring/notifications-activity-audit.md](../threadwise-port/wiring/notifications-activity-audit.md) (WIRE-NOTIF-030 to 047).
API: [api/audit-log.md](../api/audit-log.md), [api/notifications.md](../api/notifications.md).

## 1. What it is

`audit_log` has been written by about 250 call sites (every service that changes a record calls `AuditService.record` inside the
business transaction) and by a trigger that stamps rows written during a platform support (act-as) session. Until now nothing a
customer could open read it: only the operator console read `security_events`. This feature gives the workspace its own trail.

- **Settings, Security, Audit log** (`/activity-log`, Reference's route and tile id): a filterable table, an entry panel with the
  field changes from old to new, a CSV export, and a note on how long entries are kept.
- **Platform support is visible.** A row written while an operator acted as a workspace user is flagged "Platform support (acting as
  Name)" with the reason the operator gave. This closes the gap that the workspace was never told.
- **`/notifications`**: the full page behind the bell's "View all", planned since the first menu. It is the person's own list.

It is also the audit evidence that a privacy and data governance design needs ("who looked at or changed personal data"). That design
(`docs/specs/privacy-and-data-governance.md`) was not on `origin/main` when this was built, so nothing here depends on it.

## 2. Who sees what

| Key | What it opens | Owner | Admin | Manager | Others |
| --- | --- | --- | --- | --- | --- |
| `audit.log.read` | the screen, the list, one entry, the facets | yes | yes | **no** | no |
| `audit.log.export` | prepare and download a CSV | yes | yes | **no** | no |
| `org.owner_settings.manage` (existing, Owner only) | see personal values unmasked in an entry | yes | no | no | no |

The trail names every person and every change, so it is not a Manager default; a workspace can give the keys to a custom role.
The migration seeds the keys, gives them to the Owner and Admin presets (and to presets of workspaces created later through
`workspace_preset_baseline`), and bumps `roles_version` so cached grants refresh.

## 3. Data and reads

Table `audit_log` is unchanged (partitioned monthly on `(id, at)`; columns `org_id, actor_id, actor_type, module, record_id, action,
delta, request_id, at`). Every statement names `org_id` and an `at` range, with forced RLS underneath.

- **Window.** Every read and export is bounded by `from` / `to` (default the last 30 days, at most 400 days, else 422
  `AUDIT_RANGE_INVALID`). The bound prunes partitions: `EXPLAIN` on 6,000 rows over five partitions shows `Subplans Removed`.
- **Index.** Migration `20261126090000_audit_log_tenant_view` adds `idx_audit_org_at (org_id, at DESC, id DESC)` and
  `idx_audit_org_request (org_id, request_id, at DESC) WHERE request_id IS NOT NULL` on the parent (each partition gets its own).
  Without the first, the unfiltered list read the whole window and sorted it (seq scan + top-N sort); with it the list is a merge
  append of ordered index scans that reads only the rows of the page (`LIMIT 51`). The existing `(org_id, module, record_id, at)` and
  `(org_id, actor_id, at)` indexes serve the record and actor filters.
- **Paging.** Keyset on `(at, id)`; the cursor and the entry id carry `at` as Postgres prints it (microseconds), so a round trip never
  skips or repeats a row. The entry id is opaque and also gives the detail query its partition bound.
- **Filters.** `from`, `to`, `actorId` (a user uuid), `actorType`, `module`, `action`, `recordId`, `requestId`, `q`, `actAs`.
  `q` matches the **module and the action only**, substring, with `%` and `_` literal. It never reads `delta`.
- **Facets.** `GET /v2/audit-log/facets` returns the modules, actions and people present in the window (for the dropdowns).
- **Record links.** A row links to its record when the type has a screen and the record still exists (contacts, companies, deals,
  broadcasts), by a batched lookup of the record's uuid. The audited record number is shown as stored.
- **Retention.** The platform policy `security.policy.auditLogRetentionDays` (default 365, 0 = keep) is pruned daily by
  `AuthMaintenanceService`. The screen shows the number, read through a privileged query; the workspace cannot change it.

## 3.1 Act-as rows

The trigger `stamp_audit_impersonation` adds `_impersonatedBy: {old: null, new: {operatorId, sessionId}}` to the delta of every row
written while the operator acts as the owner. The read side:

- removes the stamp from the field changes (it is not a change);
- marks the entry `actAs` and looks up the session by `sessionId` **and the caller's workspace** (the table is platform-only, so it is
  read privileged; the workspace bound keeps another workspace's session out) for the reason, read-only flag and start time;
- shows the actor as the user the operator acted as ("acting as Name") and never names the operator (staff identity stays on the
  platform side);
- keeps showing the flag if the session row is gone (reason unknown).

An act-as request itself is stamped when it opens an entry, and never gets the Owner's reveal right (section 5).

## 4. Reading the log is audited

| Event | Row written | Why |
| --- | --- | --- |
| Open one entry (the detail) | module `audit-log`, action `read`, record = the entry id, delta `{entry: {module, action}, revealed: bool}` | who looked at which entry, and whether they could see unmasked values |
| Ask for an export | module `audit-log-exports`, action `export`, record = the export id, delta = the filters | the file leaves the system |
| List, filter, search, facets, settings | none | a view of names and times only; auditing it would drown the log |

The entry row is written in the same transaction as the read. Rows written by this feature show in the log itself.

## 5. The PII-safe renderer (`audit-pii.ts`)

Values only leave the API through this function, on the detail and in the CSV. The list carries field names, never values.

1. **Secrets are redacted for everyone, always.** A key naming a password, secret, token, API key, credential, private key, access key,
   signing, bearer, authorization, cookie, webhook, OTP or CVV, or any header in the log redaction list
   (`modules/platform-infrastructure/observability/log-redaction.ts`, `SECRET_HEADERS`), shows `[REDACTED]` (an empty value stays
   empty so the trail still shows that something changed). The three key-name lists Reference exempts (`credential_keys_set`,
   `missing_keys`, `changed_keys`) are exempt here too. A token-shaped value under an innocent key (a JWT, `Bearer ...`, a 32+
   character opaque string with letters and digits, not a uuid) is redacted by shape.
2. **Personal data is masked unless the viewer may reveal it.** By key: phone (`+91 ******210`), e-mail (`s***@example.com`), address
   (`[hidden address]`), free text named by its last word (notes, body, text, message, comment, content, caption: `[hidden text]`),
   person names (`full_name`, `first_name`, `contact_name`, ... and a bare `name` only on person records: contacts, users, members,
   candidates, partner agents, leads, customers; a tag's or a role's name is not personal data). By value: an e-mail or a `+` number
   inside any other string is masked.
3. **Who reveals.** The existing Owner-only key `org_settings.manage` family: `org.owner_settings.manage`. No new "reveal" key was
   created: the repository has none, and a second key per sensitive screen is how permission lists rot. Not during an act-as
   session. The export is **always** masked, whoever asks.
4. Long strings are cut at 1,000 characters, arrays at 50 items, objects at depth 6.
5. The screen says what happened ("Personal data is partly hidden", or "Secrets are hidden for everyone" for the Owner).

## 6. Export

`POST /v2/audit-log/exports` (202, `audit.log.export`) records the request with the window fixed at the click, writes the
`audit-log-exports` row, and enqueues a job on queue `audit-log-export`; the worker builds a CSV in keyset pages of 5,000 (UTF-8
BOM, formula-safe cells, masked changes as JSON, the support reason), gzips it onto the `audit_log_exports` row for 7 days, and
mails the requester a link to `/activity-log?export=<id>`. One at a time per workspace (409 `AUDIT_EXPORT_IN_PROGRESS`), at most
1,000,000 entries (the failure mail says to choose a shorter range). A daily sweep (02:47) drops expired files and fails exports
whose worker died. Same machinery and table shape as the consent proof export (`contact_consent_exports`).

## 7. The Notifications page

`/notifications`, in the menu after Analytics. Everything is the caller's own rows (the service pins every query to the person).

- Counts: unread (a button that toggles the unread filter), last 24 hours, last 7 days, kept. `GET /v2/notifications/summary`.
- All / Unread, a type filter (grouped like the preferences screen; a type this build does not know sits under Other), a search over
  title and text (SQL, `%` and `_` literal; Reference searched in memory because its text was encrypted), day sections (today,
  yesterday, earlier this week, older), 20 per page with Load more, rows are the bell's rows (same wording, icon, deep link).
- Mark all read, dismiss one (`DELETE /v2/notifications/:id`, new), Clear all (the shell's existing `DELETE /v2/shell/notifications`,
  after a confirmation), a link to `/account/notifications`.
- Realtime: the page's queries sit under the bell's `['notifications', 'feed']` key, so the live controller's invalidation
  (new row, read on another tab, reconnect) refreshes it; without a socket it polls once a minute like the bell.

## 8. Differences from Reference (recorded, intended)

| Reference | Here | Why |
| --- | --- | --- |
| Activity Log with KPI cards, volume chart, donut, top actors, "My activity / Workspace" scope | table, filters, panel, export; the "Person" filter covers "my activity" | the charts are a dashboard, not an audit trail; recorded as follow-up |
| Search over action, subject type and IP, wildcards active | module and action only, wildcards literal, never the values | privacy; an injection-shaped search is not a feature |
| Payload shown after write-time redaction only | read-time masking of personal data too | the trail is read by more people than the data owners |
| Rows carry IP and user agent | **not stored here** (section 11) | owner decision |
| Cross-workspace rows visible to the actor | never; RLS | recommended by the inventory |
| No workspace falls through to every workspace's rows | impossible (RLS, `org_id` in every statement) | the inventory's own port note |
| Notifications page: workspace-shared rows, fixed 12 per page, in-memory search, Delivery KPI | per-person rows, 20 per page, SQL search, counts tile set | per-recipient rows are how this product stores them |
| Notifications page "Do not disturb" (inert) and the Mentions tab (always empty) | not built | Reference's own quirks (TW-NOTIF-010, 007 rule 6) |

## 9. Tests

- Unit (`apps/api/test/unit/audit-log`): masker, key classification, secrets, the act-as stamp, the filter builder as SQL text and
  parameters, window and cursor, CSV defusing, the act-as flag. Web: URL filters, error keys, day sections.
- Real Postgres end to end (`apps/api/test/e2e/audit-log`, `.../notifications/notifications-page`): list, every filter, paging without
  gaps, window refusal, tenant isolation (list, facets, detail, exports), permission denial per key, act-as visibility (hand-made
  and database-trigger stamps), masked and revealed detail, the audit of reads and exports, the export job end to end, the sweep.
- Web render tests (jsdom, English and Arabic): every state of both screens.

## 10. Not verified

No browser run: the screens were rendered in jsdom, not looked at. The export mail was not delivered (the mail port is optional in the
test harness). Scale was tested to thousands of rows, not millions.

## 11. Privacy fit

`security_events` already stores IP and user agent for sign-in events. `audit_log` does not, and this change does **not** add them.
Adding them is an owner decision: an IP is personal data, makes the export heavier on compliance, and needs a retention statement of
its own. If chosen, add nullable `ip inet, user_agent text` columns written by `AuditService.record` from `RequestContextStore`
(already carrying `ip` and `userAgent`), show them only to the Owner key, and never export them.

## 12. Decisions for the owner

| # | Decision | Taken here | Alternative |
| --- | --- | --- | --- |
| D1 | Who may read | Owner and Admin; Manager no | give Manager `audit.log.read` |
| D2 | Personal data in entries | masked for everyone except the Owner; export always masked | mask for all; or add a dedicated reveal key |
| D3 | Reading is audited | each opened entry and each export; not list or filters | audit every list call |
| D4 | Retention shown | the platform number, read-only for the workspace | a per-workspace retention |
| D5 | IP and user agent | not stored | store, Owner-only |
| D6 | Route and name | `/activity-log` (Reference's), title "Audit log" | rename to `/audit-log` |
| D7 | Names of operators | never shown to the workspace; "Platform support" only | show the operator's name |

## 13. Follow-ups

- A per-record History panel on the contact detail page (the timeline there reads `contact_activities`; audit rows must not reach
  people who lack `audit.log.read`, and the filter needs the record's uuid): a "View history" link visible to `audit.log.read` holders.
- Reference's charts, top actors and categories; a "My activity" shortcut.
- Quiet hours / do-not-disturb for notifications (TW-NOTIF-010), still docs-only in Reference.
