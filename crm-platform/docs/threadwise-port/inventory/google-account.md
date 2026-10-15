---
domain: google-account
code: GACC
title: The workspace's Google account (connection, permissions, flow nodes behind it, file pickers). Found missing from the inventory while auditing walkthrough item 30.
threadwise_version: '1.7.0'
sources_read: 6
---

# Google account

Reference keeps one Google OAuth grant per workspace (inside `workspaces.appointment_settings.google_oauth`) and uses it for the booking calendar, Google Meet, and the Sheets, Docs and Forms flow
nodes. The page that manages it (`/google-account`) and its endpoints were never inventoried as a feature: the inventory lists their **consumers** (TW-FLB-055 to 059, TW-FLR-044 to 047, TW-TIB1-022) and
says "left to INTG". This file is that record. Build plan, decisions and the manual test: [plan/google-workspace-build.md](../plan/google-workspace-build.md). Wiring:
[wiring/google-account.md](../wiring/google-account.md). Parity: [parity/google-account.md](../parity/google-account.md).

Connects to: `appointments-booking` (the grant is its calendar connection), `flow-runtime-engine` (the six Google nodes), `flow-builder-editor` (pickers, notices, the Apps Script for a form),
`platform-settings-branding-storage` (the operator's OAuth client and master switch), `roles-permissions` (two permission keys), `notifications-activity-audit` (audit, outbox).

## Features

| Id          | Feature                                                                 | Status      | Priority | Effort | Depends on  |
| ----------- | ----------------------------------------------------------------------- | ----------- | -------- | ------ | ----------- |
| TW-GACC-001 | The Google account page                                                 | implemented | P1       | M      |             |
| TW-GACC-002 | Connect with chosen permissions, add permissions later                  | implemented | P1       | M      | TW-GACC-001 |
| TW-GACC-003 | Reconnect, disconnect, last problem and last use                        | implemented | P1       | S      | TW-GACC-002 |
| TW-GACC-004 | The Google nodes run on the account                                     | implemented | P1       | M      | TW-GACC-002 |
| TW-GACC-005 | File pickers for the Sheets, Docs and Forms nodes                       | implemented | P2       | S      | TW-GACC-002 |
| TW-GACC-006 | Warnings above a Google step in the flow inspector                      | implemented | P2       | S      | TW-GACC-001 |
| TW-GACC-007 | Resilient, classified Google calls (retries, quota, stable error codes) | implemented | P1       | M      |             |
| TW-GACC-008 | Inbox composer "Send Meet link"                                         | blocked     | P3       | S      | TW-GACC-004 |
| TW-GACC-009 | Calendar read-back (sync tokens, watch channels)                        | blocked     | P3       | L      | TW-GACC-002 |

### TW-GACC-001 — The Google account page

- **Status:** implemented
- **Priority:** P1
- **Effort:** M
- **Depends on:** none
- **Summary:** `/google-account` shows whether the workspace's Google account is connected, which account, the calendar in use, how many calendars, what permissions were granted, when it was last used and the last problem Google reported.
- **Actors & access:** Reference: workspace admins. Port: `google.account.read` to see, `google.account.manage` to change; both held by the admin presets.
- **UX & screens:** Reference page `user/google-account/index.blade.php`: a left aside (connection state, "used by" list, privacy tip) and a main column (title, connected or not-connected chip, four stat cards, an admin-setup banner, a missing-scope banner, a connection table).
- **Endpoints:** Reference: `GET /google-account`. Port: `GET /v2/google-account`, `GET /v2/google-account/calendars`.
- **Data:** the workspace's one grant row; never a token.
- **Rules & edge cases:**
  1. Without a platform OAuth client (or with the operator switch off) the page says Google is not set up and offers nothing to press.
  2. A grant Google no longer honours shows "needs reconnecting" and the Reconnect action.
  3. A role that may not read it sees a "you cannot open this page" notice.
- **Async & events:** none.
- **External systems:** Google Calendar list (for the calendar count).
- **Settings:** the operator's `googleCalendar` group.
- **Acceptance criteria:**
  - Given no grant, when an admin opens the page, then it shows "Not connected" and the permission list with the Connect button.
  - Given a connected grant, then the account email and the allowed permissions are shown and no token appears in any response.
- **Source refs:** `app/Http/Controllers/GoogleAccountController.php`, `resources/views/user/google-account/index.blade.php`.
- **Port notes:** built as `features/google-account`; the aside's "used by" list is a section of links.

### TW-GACC-002 — Connect with chosen permissions, add permissions later

- **Status:** implemented
- **Priority:** P1
- **Effort:** M
- **Depends on:** TW-GACC-001
- **Summary:** An admin ticks what Google may be used for (Calendar, Sheets, Docs and Drive, Forms, Drive file list) and goes through Google's consent screen; later they can add permissions and Google asks only for the new ones.
- **Actors & access:** Reference: any admin; one consent for every scope. Port: `google.account.manage`; per-capability consent.
- **UX & screens:** the permission list with a tick per permission, "Connect Google account", "Add permissions", "Reconnect Google".
- **Endpoints:** Reference: `POST /appointments/oauth/google/start`, `GET /appointments/oauth/google/callback`. Port: `POST /v2/google-account/connect`, the existing public callback.
- **Data:** the grant row (sealed refresh and access tokens, scopes, account email and id, chosen calendar).
- **Rules & edge cases:**
  1. Offline access and a fresh consent every time, so a refresh token always arrives; `include_granted_scopes` keeps earlier permissions; the connected account is the `login_hint`.
  2. The signed, ten-minute state names the workspace, the admin and the permissions asked for; a forged, altered or expired state stores nothing.
  3. A grant that lacks a permission that was asked for: withdrawn on a first connection; kept on the account that is already stored (it is a superset) with the outcome `missing_scope`.
  4. Another Google account replaces the stored one and the old account's grant is withdrawn.
  5. The return address must be a path inside the app.
- **Async & events:** audit (insert or update, with the permissions before and after) and `appointment_calendar.connected` in the same transaction.
- **External systems:** Google OAuth.
- **Settings:** the operator's client id, secret and redirect URI.
- **Acceptance criteria:**
  - Given an admin who ticks Sheets, then Google is asked for `spreadsheets` and the identity scopes only.
  - Given an account connected for Sheets, when Forms is added, then Google is asked only for the Forms scope and the account ends with both.
- **Source refs:** `GoogleCalendarOAuthController.php`, `GoogleCalendarService.php` (`DEFAULT_SCOPES`, `authorizeUrl`).
- **Port notes:** see parity: Reference asked for `drive` (restricted) from everyone.

### TW-GACC-003 — Reconnect, disconnect, last problem and last use

- **Status:** implemented
- **Priority:** P1
- **Effort:** S
- **Depends on:** TW-GACC-002
- **Summary:** Disconnect revokes the grant at Google and deletes the stored tokens; a grant Google refuses becomes "needs reconnecting" once; the page shows the last account-level problem and the last time the account was used.
- **Actors & access:** `google.account.manage`; a booking editor may end a calendar-only grant from the calendar card, not one that Sheets, Docs, Forms or the file list also use.
- **UX & screens:** Disconnect with a confirmation; the "last problem" and "needs reconnecting" notices.
- **Endpoints:** Reference: `POST /appointments/oauth/google/disconnect`. Port: `POST /v2/google-account/disconnect`.
- **Data:** `status`, `status_reason`, `last_error_code`, `last_error_at`, `last_error_capability`, `last_used_at`.
- **Rules & edge cases:**
  1. An unreachable Google does not stop a disconnect.
  2. A problem is recorded only when it is new and cleared by a success of the same capability; writes at most once a minute.
  3. A missing permission is not recorded as a problem (the page shows it as not allowed).
- **Async & events:** audit and outbox in the same transaction (`appointment_calendar.disconnected`, `.needs_reconnect`).
- **External systems:** Google revoke endpoint.
- **Settings:** none.
- **Acceptance criteria:**
  - Given a revoked grant, when a flow runs, then the account shows "needs reconnecting" once and later runs make no Google calls.
- **Source refs:** `GoogleCalendarOAuthController@disconnect`.
- **Port notes:** the table is `appointment_calendar_connections`.

### TW-GACC-004 — The Google nodes run on the account

- **Status:** implemented
- **Priority:** P1
- **Effort:** M
- **Depends on:** TW-GACC-002
- **Summary:** Google Sheets (write, read), Check Google Sheet field, Save contact from Google Sheet, Google Docs, Google Form and Google Meet use the workspace's Google account; a step that cannot run FAILS with its `GOOGLE_*` code and what to do (run log and run view).
- **Actors & access:** the flow runtime, as the workspace.
- **UX & screens:** the nodes' run-log notes (`[GOOGLE_*]` and what to do).
- **Endpoints:** Reference: `POST /api/flow-node/google/*` called by Node. Port: in-process through `GOOGLE_WORKSPACE`.
- **Data:** none beyond the grant.
- **Rules & edge cases:** see TW-FLR-044 to 047, 080; plus: formulas typed by customers are stored as text, an append and a copy are repeated only after a 429, a Docs fill or share that fails after the copy exists keeps the link, only a Google Document is copied, ids are checked, the Meet event id comes from the flow step.
- **Async & events:** none.
- **External systems:** Sheets, Drive, Docs, Forms, Calendar.
- **Settings:** the operator's master switch.
- **Acceptance criteria:**
  - Given no connected account, then each node writes `[GOOGLE_ACCOUNT_NOT_CONNECTED]` naming "Connect Google" and the flow continues.
- **Source refs:** `GoogleFlowNodeController.php`, `GoogleApiService.php`.
- **Port notes:** see parity.

### TW-GACC-005 — File pickers for the Sheets, Docs and Forms nodes

- **Status:** implemented
- **Priority:** P2
- **Effort:** S
- **Depends on:** TW-GACC-002
- **Summary:** The node forms list the account's sheets, documents and forms by name; without the Drive file list permission the author pastes the link or id.
- **Actors & access:** `flb.flows.read`.
- **UX & screens:** the dropdowns of TW-FLB-055 to 059.
- **Endpoints:** Reference: `GET /api/google/picker/{kind}`. Port: `GET /v2/flows/builder-context/google/:kind`.
- **Data:** none.
- **Rules & edge cases:** 503 `FLB_INTEGRATION_DISABLED` while the platform has no Google client; 409 with a `GOOGLE_*` code otherwise; the builder falls back to a text field on any error.
- **Async & events:** none.
- **External systems:** Drive `files.list`.
- **Settings:** none.
- **Acceptance criteria:**
  - Given the file list permission, then the newest files of the kind are listed (id and name only).
- **Source refs:** `GoogleFlowNodeController@picker`.
- **Port notes:** none.

### TW-GACC-006 — Warnings above a Google step in the flow inspector

- **Status:** implemented
- **Priority:** P2
- **Effort:** S
- **Depends on:** TW-GACC-001
- **Summary:** A yellow note above each Google step's fields says when the account is not set up, not connected, needs reconnecting or lacks that step's permission.
- **Actors & access:** anyone who edits flows (`GET /flows/builder-context/google/status` returns only the state and the permissions, never the account).
- **UX & screens:** the inspector of the six Google nodes. Reference showed a red line under the Sheets node only.
- **Endpoints:** `GET /v2/flows/builder-context/google/status`.
- **Data:** none.
- **Rules & edge cases:** silent while loading and for a role that cannot read it; never blocks saving.
- **Async & events:** none.
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:** the note appears for a missing permission and names it, with a link to the Google account page.
- **Source refs:** `flow-builder` inspector `google_sheets` case.
- **Port notes:** beyond Reference for Docs, Form, Meet, Check field and Save contact.

### TW-GACC-007 — Resilient, classified Google calls

- **Status:** implemented
- **Priority:** P1
- **Effort:** M
- **Depends on:** none
- **Summary:** Every Google call has a timeout, no redirects, bounded retries with jitter, `Retry-After` handling, and failures reduced to stable `GOOGLE_*` codes.
- **Actors & access:** internal.
- **UX & screens:** none (the codes surface in the page, the run log and the API).
- **Endpoints:** none.
- **Data:** none.
- **Rules & edge cases:** see docs/api/google-account.md.
- **Async & events:** none.
- **External systems:** all Google APIs.
- **Settings:** `GOOGLE_RETRIES`, `GOOGLE_RETRY_BASE_MS`, `GOOGLE_RETRY_AFTER_CAP_SECONDS`, `GOOGLE_HTTP_TIMEOUT_MS`.
- **Acceptance criteria:** a 503 then a 200 yields the answer; a long `Retry-After` is handed to the caller; a row append is never repeated after a 5xx.
- **Source refs:** none (Reference had no retry).
- **Port notes:** extension.

### TW-GACC-008 — Inbox composer "Send Meet link"

- **Status:** blocked
- **Priority:** P3
- **Effort:** S
- **Depends on:** TW-GACC-004
- **Summary:** Reference's inbox composer has a button that creates a Google Calendar event with a Meet link and drops a message with the link.
- **Actors & access:** inbox users.
- **UX & screens:** composer modal (TW-TIB1-022).
- **Endpoints:** Reference: `POST team-inbox/api/google-meet`.
- **Data:** none.
- **Rules & edge cases:** see TW-TIB1-022.
- **Async & events:** none.
- **External systems:** Calendar.
- **Settings:** none.
- **Acceptance criteria:** see TW-TIB1-022.
- **Source refs:** `FlowNodeActionsController@googleMeetForInbox`.
- **Port notes:** neither the endpoint nor the button exists in this repo; `GoogleWorkspacePort.createMeet` is ready for it.

### TW-GACC-009 — Calendar read-back

- **Status:** blocked
- **Priority:** P3
- **Effort:** L
- **Depends on:** TW-GACC-002
- **Summary:** Reading the calendar back (sync tokens, push notifications) so an appointment can react to its event being moved or deleted in Google.
- **Actors & access:** internal.
- **UX & screens:** none yet.
- **Endpoints:** none.
- **Data:** none yet.
- **Rules & edge cases:** Reference has none; what an appointment should do is undecided (plan, open decision 1).
- **Async & events:** none yet.
- **External systems:** Calendar `events.list` with sync tokens, `events.watch`.
- **Settings:** none.
- **Acceptance criteria:** to be written with the owner's rule.
- **Source refs:** none.
- **Port notes:** not in Reference; extension, waits for a decision.
