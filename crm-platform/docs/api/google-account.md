# Google account (TW-GACC)

The workspace's one Google account, shared by the appointments calendar and by the flow builder's Google nodes. An admin connects it through Google's consent screen,
choosing which **capabilities** it may be used for; the platform operator supplies the OAuth client once ([runbook](../runbooks/google-workspace-setup.md)). Plan and decisions:
[google-workspace-build.md](../threadwise-port/plan/google-workspace-build.md).

## Capabilities and scopes

| Capability      | Scopes asked of Google (plus `openid` and `email` always)                | Restricted by Google | Used by                                                          |
| --------------- | ------------------------------------------------------------------------ | -------------------- | ---------------------------------------------------------------- |
| `calendar`      | `calendar.events`, `calendar.freebusy`, `calendar.calendarlist.readonly` | no                   | booking calendar, Book appointment, Google Meet step             |
| `sheets`        | `spreadsheets`                                                           | no                   | Google Sheets, Check Google Sheet field, Save contact from Sheet |
| `docs`          | `documents`, `drive`                                                     | yes (`drive`)        | Google Docs step                                                 |
| `forms`         | `forms.body.readonly`                                                    | no                   | Google Form step                                                 |
| `drive_listing` | `drive.metadata.readonly`                                                | yes                  | the sheet, document and form pickers of the flow builder         |

A capability is **granted** only when the grant covers all of its scopes (full `drive` also covers the file list). The tables live in `packages/contracts/src/google-account/capabilities.ts`.
Reference asked for everything in one consent and failed later, quietly, when something was missing.

The consent URL carries `access_type=offline`, `prompt=consent` (a refresh token on every consent), `include_granted_scopes=true` (asking for one more capability keeps what the account
already gave: the token that comes back covers the union) and `login_hint` of the connected account.

## Routes (`/v2`)

| Method and path                                     | Permission              | Notes                                                                                                                                                                                                                                                                                                                                                               |
| --------------------------------------------------- | ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /google-account`                               | `google.account.read`   | `{ status, account, connectedAt, capabilities[{ key, granted, restricted }], calendarId, calendarName, lastError { code, at, capability }, lastUsedAt }`. `status`: `unavailable` (no platform client or switched off), `disconnected`, `connected`, `needs_reconnect`. Never a token                                                                               |
| `POST /google-account/connect`                      | `google.account.manage` | `{ capabilities[1..5], returnTo? }` (a path inside the app); 200 `{ url, expiresInSeconds }`. `422 GOOGLE_ACCOUNT_NOT_CONFIGURED` without a client. The signed state (10 minutes, bound to the workspace and admin) carries the capabilities                                                                                                                        |
| `GET /google-account/calendars`                     | `google.account.read`   | calendars the account can write to; `409 APPT_CALENDAR_NOT_CONNECTED` without the calendar permission                                                                                                                                                                                                                                                               |
| `POST /google-account/disconnect`                   | `google.account.manage` | revokes at Google (an unreachable Google does not block it), deletes the tokens; idempotent; returns the account                                                                                                                                                                                                                                                    |
| `GET /public/appointments/calendar/google/callback` | the signed `state`      | Google's redirect, shared with the calendar; claims the consent record once, exchanges the code and **parks** the sealed grant; **302** to `<WEB_APP_URL>/google-account/confirm?request=<uuid>` when there is something to confirm, otherwise to `<returnTo>?calendar=<outcome>` (`denied`, `failed`, `expired`, `not_configured`, `missing_scope`)                |
| `GET /google-account/consent/:id`                   | signed in (no key)      | what is about to be connected: `{ id, googleEmail, workspaceName, requested[], granted[], missing[], replacesAccount, expiresAt, returnTo }`. Only the person who pressed Connect: `403 GOOGLE_CONSENT_NOT_YOURS` (the parked grant is withdrawn), `404 GOOGLE_CONSENT_NOT_FOUND` (also another workspace), `409 GOOGLE_CONSENT_USED`, `410 GOOGLE_CONSENT_EXPIRED` |
| `POST /google-account/consent/:id/confirm`          | signed in (no key)      | stores the grant, once; `{ outcome: connected \| missing_scope, returnTo }`; the page then goes to `returnTo?calendar=<outcome>`                                                                                                                                                                                                                                    |
| `POST /google-account/consent/:id/cancel`           | signed in (no key)      | drops the parked grant (withdrawn at Google unless it could be the stored account's); `{ outcome: cancelled, returnTo }`                                                                                                                                                                                                                                            |
| `GET /flows/builder-context/google/status`          | `flb.flows.read`        | `{ status, granted[] }` only, so a Google step can warn before the flow runs                                                                                                                                                                                                                                                                                        |
| `GET /flows/builder-context/google/:kind`           | `flb.flows.read`        | `sheets` \| `docs` \| `forms`: `{ data: [{ id, name }] }`, newest first. `503 FLB_INTEGRATION_DISABLED` while the platform has no Google client; `409 GOOGLE_ACCOUNT_NOT_CONNECTED`, `GOOGLE_ACCOUNT_NEEDS_RECONNECT` or `GOOGLE_SCOPE_MISSING` (needs `drive_listing`)                                                                                             |

The older calendar routes (`/appointments/calendar/google/*`, permission `record.booking-types.update`) keep working and share the same connection: connecting from the calendar card asks for
the calendar plus whatever the account already held (a reconnect restores everything), and disconnecting there disconnects the whole account (one connection). **When the grant also carries Sheets,
Docs, Forms or the file list, `start` and `disconnect` on those routes additionally need `google.account.manage`** (403 otherwise): a booking editor must not be able to switch off every Google step.

The callback with fewer permissions than asked: on a **first** connection (or another account) the grant is withdrawn at Google and nothing is stored (`missing_scope`); on an account that
is **already connected** the shorter grant is a working superset of what was stored, so it is kept and the outcome is `missing_scope` (what was allowed still works).

## Confirming a connection

Connect creates a record in `google_consent_requests` (user, workspace, capabilities, expiry in 10 minutes; the state's nonce is stored only as a hash). Google's redirect cannot see a session, so the callback only parks the
result (tokens sealed) and sends the browser to the app's confirm page, where the same signed-in admin presses **Confirm** (the grant is stored then, in one transaction with audit and outbox) or **Cancel**. A forwarded
link, an expired or replayed one, another workspace's, and a cancel store nothing. The worker's `GoogleConsentSweepService` withdraws and forgets unfinished records.

## Permissions

`google.account.read` and `google.account.manage` (category `integrations`, no record scope), granted to the admin presets by migration `20261207090000_gacc_google_account.sql`. Reference gated the
page on the workspace admin role. The flow builder routes keep `flb.flows.read`: a member who edits flows needs to see whether Google works, not who connected it.

## Storage

No new table. The grant is `appointment_calendar_connections` (one row per workspace, forced RLS, refresh and access tokens sealed with the credentials key). The migration adds `last_error_code`,
`last_error_at`, `last_error_capability` (only a success of the same capability clears an error) and `last_used_at`. Audit module `appointment_calendar` (insert and update on connect with the capabilities before and after, delete on disconnect), outbox events
`appointment_calendar.connected`, `.calendar_selected`, `.needs_reconnect`, `.disconnected`.

## The flow nodes

`GOOGLE_WORKSPACE` (`infra/providers/flow-runtime-engine/google-workspace.port.ts`) is bound to `HttpGoogleWorkspace` over the workspace's grant by `GoogleAccountModule`. Each call names the capability it needs;
a grant that lacks it fails before any request is made.

| Node                                                 | Calls                                                                                                       | Capability      |
| ---------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- | --------------- |
| Google Sheets, write                                 | `values.append` (`USER_ENTERED`, `INSERT_ROWS`), header read when "match by header" is on                   | `sheets`        |
| Google Sheets, read; Check sheet field; Save contact | `values.get` of the tab (`A:ZZ`)                                                                            | `sheets`        |
| Google Docs                                          | Drive `files.copy`, Docs `batchUpdate` (`{{key}}` and `{key}`), Drive `permissions.create` (anyone, reader) | `docs`          |
| Google Form                                          | Forms `forms.get` (`responderUri`); the submission comes back through the existing Apps Script webhook      | `forms`         |
| Google Meet                                          | Calendar `events.insert` with `conferenceData`, in the workspace's calendar                                 | `calendar`      |
| Pickers                                              | Drive `files.list` by mime type                                                                             | `drive_listing` |

Behaviour that matters:

- A customer-typed cell that Sheets would run as a formula (`=...`, `@...`, `+cmd`, `-2+3`) is written as text (a leading `'`); plain numbers (`-5`, `+919876543210`) stay numbers.
- Sheet, template and form ids are checked against `[A-Za-z0-9_-]{1,256}` before any request. The Docs template's mime type is read first and must be a Google Document: with the full Drive scope the
  account can read any file, and the copy is shared by link.
- Values filled into a Docs placeholder get a zero-width space after each `{`, so a customer's name cannot act as a placeholder for the next fill.
- A sheet row append and a document copy are repeated only after a 429; everything else safe to repeat is repeated on 429, 5xx, timeout and network errors with jitter.
- The Meet event id is derived from the flow step, so a repeated step reads back its own event (409) instead of creating a second meeting.
- A Docs placeholder fill or share that fails after the copy exists is a note in the run log; the link is still sent and the step does not fail (the document exists).
- **A step that cannot run FAILS visibly** (owner decision; Reference went on silently): the node returns a failure with the stable code and what to do (`[GOOGLE_*] ...`); the run is marked failed at that step (none of the Google nodes has an error exit; if one gets one, the run leaves by it), and the run log and run view show both. A step the author left half empty (no sheet, no columns, no template, no form) is noted in the run log and skipped, and a check takes its "no" branch, exactly as in Reference; a lookup that finds no row is an ordinary empty result. A Sheets step writes all its rows (an AI step's records) in ONE `values:append` call, so it is all-or-nothing and a retried step cannot duplicate rows. Docs, Meet and Form still send the customer Reference's apology. Codes: `GOOGLE_ACCOUNT_NOT_CONFIGURED`, `GOOGLE_ACCOUNT_NOT_CONNECTED`,
  `GOOGLE_ACCOUNT_NEEDS_RECONNECT`, `GOOGLE_SCOPE_MISSING`, `GOOGLE_API_NOT_ENABLED`, `GOOGLE_RATE_LIMITED`, `GOOGLE_NOT_FOUND`, `GOOGLE_ACCESS_DENIED`, `GOOGLE_BAD_REQUEST`, `GOOGLE_UNAVAILABLE`.
- Google's own wording and tokens never reach a log line, a run log or a response: only the code and a sentence of ours. A reason taken from a Google body is kept only when it is a short identifier.

## Not verified against real Google

Everything is exercised against `test/e2e/appointments-booking/fake-google.ts`, written from Google's documentation. See the plan's manual checklist.
