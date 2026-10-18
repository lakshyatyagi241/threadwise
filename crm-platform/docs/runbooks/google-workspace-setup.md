# Google account (Calendar, Sheets, Docs, Forms): Google Cloud setup

For the platform operator. Once per platform, not per workspace: every workspace connects its own Google account through this one OAuth client, from
**Settings, Integrations, Google account** (`/google-account`). One connection per workspace is shared by the appointments calendar and by the Google steps of the
flow builder (Google Sheets, Check Google Sheet field, Save contact from Google Sheet, Google Docs, Google Form, Google Meet).

This is the same client the calendar always used; it now carries more permissions, which a workspace admin ticks one by one. Two other Google setups are separate on
purpose: the Gmail client ([google-mail-setup.md](google-mail-setup.md), restricted Gmail scopes, its own verification) and the Google Sheets add-on, which is an Apps
Script project ([google-sheets-addon-marketplace.md](google-sheets-addon-marketplace.md), its own consent screen). The calendar-only click path is kept in
[google-calendar-setup.md](google-calendar-setup.md); where the two differ, this page is the newer.

What the product does with the connection: [docs/api/google-account.md](../api/google-account.md). The plan, the decisions and the checklist for the first real Google
account: [google-workspace-build.md](../threadwise-port/plan/google-workspace-build.md).

None of this has been run against a live Google account in this repository: the tests use a local stand-in written from Google's documentation. Treat section 8 as the
first real acceptance run and report anything that differs.

## 1. Google Cloud project

1. Open [Google Cloud Console](https://console.cloud.google.com/). Create a project owned by the company (not by a person's personal account), or pick the one that
   already holds the calendar client.
2. Note the project name: Google's "API not enabled" errors name the project number, and the product shows them as `GOOGLE_API_NOT_ENABLED`.

## 2. Enable the APIs

_APIs and Services, Library_: search each name and press **Enable**.

| API (Library name)  | Needed by                                            | If it is missing                                       |
| ------------------- | ---------------------------------------------------- | ------------------------------------------------------ |
| Google Calendar API | booking events, free/busy, Google Meet step          | `GOOGLE_API_NOT_ENABLED` on bookings and the Meet step |
| Google Sheets API   | Google Sheets, Check sheet field, Save contact steps | the same code on those steps                           |
| Google Docs API     | Google Docs step (fill placeholders)                 | the same code on that step                             |
| Google Drive API    | Google Docs step (copy, share), the file pickers     | the same code on that step and on the pickers          |
| Google Forms API    | Google Form step (read the form's public link)       | the same code on that step                             |

A permission only works when its API is enabled here. The Google account page shows the problem as "the last problem Google reported", and the run log of the flow says
`[GOOGLE_API_NOT_ENABLED]`.

## 3. Consent screen

_APIs and Services, OAuth consent screen_ (newer consoles call it **Google Auth Platform**: Branding, Audience, Data Access).

1. **Audience / User type: External** (workspaces use their own Google accounts, Gmail or Google Workspace).
2. **Branding**: app name, support email, logo, the app's home page, the privacy policy and terms links, and the authorised domain (the platform's own domain).
   The privacy policy must say which Google data is read and written: calendar events and busy time, rows of sheets a flow names, documents it copies, forms it links.
3. **Data Access, Add or remove scopes.** These are exactly the scopes the product asks for, and nothing else. A workspace only ever asks Google for the ones it ticks.

   | Capability on the page | Scope                                                               | Class          | Why                                                                                     |
   | ---------------------- | ------------------------------------------------------------------- | -------------- | --------------------------------------------------------------------------------------- |
   | always                 | `openid`, `.../auth/userinfo.email`                                 | non-sensitive  | show which Google account is connected                                                  |
   | Calendar               | `.../auth/calendar.events`                                          | sensitive      | write, move and delete booking events, create Meet links                                |
   | Calendar               | `.../auth/calendar.freebusy`                                        | sensitive      | read busy time so booked slots are not offered                                          |
   | Calendar               | `.../auth/calendar.calendarlist.readonly`                           | sensitive      | let an admin pick which calendar to use                                                 |
   | Sheets                 | `.../auth/spreadsheets`                                             | sensitive      | read a row, append a row, read headers of a sheet a flow names                          |
   | Forms                  | `.../auth/forms.body.readonly`, `.../auth/forms.responses.readonly` | sensitive      | read a form's responder link and its answers (the flow resumes when the form is filled) |
   | Docs and Drive         | `.../auth/documents`                                                | sensitive      | fill placeholders in the copy                                                           |
   | Docs and Drive         | `.../auth/drive`                                                    | **restricted** | copy a template the user owns, share the copy by link                                   |
   | Drive file list        | `.../auth/drive.metadata.readonly`                                  | **restricted** | list sheets, documents and forms by name in the pickers                                 |

   The product never asks for the full `calendar` scope, Gmail, Contacts, or any admin scope.

4. **Publish the app** (_Publishing status: In production_). This is the step that is easiest to miss: while the app is in **Testing**, Google ends every grant after
   **7 days** and only listed test users (up to 100) can connect, so every workspace falls to "Needs reconnecting" a week after connecting.
5. **Until Google verifies the app, only test users can connect.** An app that asks for sensitive or restricted scopes and is not verified is limited to the test users you list
   (Audience, Test users; up to 100) while it is in Testing, and to 100 users overall once it is In production, and everybody else sees "Google hasn't verified this app" or
   `access_blocked`. The product does not hide or block anything because of this: every capability is on the Google account page, the restricted ones (**Docs and Drive**,
   **Drive file list**) simply start **unticked** and any admin may tick them. What stops a customer is Google, not the code. So before you invite real customers,
   either complete section 9 (verification) or tell them plainly that their Google account must be added as a test user first.
6. **Verification** is a Google review, submitted from _Google Auth Platform, Verification Center_. It takes weeks (sensitive scopes) to months (restricted scopes). The exact
   submission pack is in **section 9**. How to stage it: submit Calendar, Sheets and Forms first (sensitive only); submit **Docs and Drive** and **Drive file list** (restricted)
   together, after those are approved, because they add the security assessment. Meanwhile the flow builder falls back to "paste the link or id" when the file list is not
   allowed, which works.

## 4. The OAuth client

_APIs and Services, Credentials, Create credentials, OAuth client ID_:

1. Application type **Web application**.
2. **Authorised redirect URIs**: add exactly the address the console shows (_Admin, Settings, Google Calendar_, "Redirect URI"). By default it is

   ```
   <APP_URL>/v2/public/appointments/calendar/google/callback
   ```

   for example `https://api.example.com/v2/public/appointments/calendar/google/callback`. It must match character for character (scheme, host, path, no trailing
   slash), or Google stops at `redirect_uri_mismatch`. The path still says "appointments" because the operator already registered it for the calendar; the same
   address completes every consent (calendar, Sheets, Docs, Forms). Register one per environment (staging, production); a local run can use
   `http://localhost:3000/v2/public/appointments/calendar/google/callback`.

3. No "Authorised JavaScript origins" are needed (the flow is server side).
4. Copy the **client ID** and the **client secret**.

## 5. Give them to the platform

Read in this order; a field left empty falls through to the next.

- **Console:** _Admin, Settings, Google Calendar_ (settings group `googleCalendar`; the page is named for the calendar it started with and now serves every Google
  permission): paste the client ID and the client secret, leave **Allow workspaces to connect Google** on, save. The secret is stored encrypted and never shown again;
  leaving it blank on a later save keeps it.
- **Environment** (API and worker; restart them): `GOOGLE_CALENDAR_CLIENT_ID`, `GOOGLE_CALENDAR_CLIENT_SECRET`, and optionally `GOOGLE_CALENDAR_REDIRECT_URI`.

The console's switch turns Google off for every workspace without deleting the client: bookings go on, nothing is read from or written to Google, the Google steps of
Google steps of flows **fail visibly** with `GOOGLE_ACCOUNT_NOT_CONFIGURED` (the run is marked failed at that step, and the run log and run view say what to do), and the page says "Not set up". Turning it back on resumes (stored connections are kept).

Tokens are sealed with the credentials key (`CREDENTIALS_ENCRYPTION_KEY`; rotate with [key-rotation.md](key-rotation.md)). Rotating the **client secret** at Google needs the
new value in the console; existing refresh tokens keep working. Changing the **client ID** invalidates every stored grant: every workspace shows **Needs reconnecting**. Do not
change it casually.

Tuning and test hooks (all optional, read at call time, defaults are Google's own):

| Variable                                                                                                                  | Default  | Meaning                                                                                        |
| ------------------------------------------------------------------------------------------------------------------------- | -------- | ---------------------------------------------------------------------------------------------- |
| `GOOGLE_HTTP_TIMEOUT_MS`                                                                                                  | 8000     | ceiling for one call to Google                                                                 |
| `GOOGLE_RETRIES`                                                                                                          | 2        | extra attempts after a 429, 5xx, timeout or network error, for calls that are safe to repeat   |
| `GOOGLE_RETRY_BASE_MS`                                                                                                    | 300      | the wait before attempt n is a random time up to base x 2^n (full jitter)                      |
| `GOOGLE_RETRY_AFTER_CAP_SECONDS`                                                                                          | 5        | a `Retry-After` longer than this is not slept on: the outbox or the flow run tries again later |
| `GOOGLE_BUSY_CACHE_SECONDS`, `GOOGLE_BUSY_BACKOFF_SECONDS`                                                                | 30, 20   | booking-page busy-time cache and the pause after a failed lookup                               |
| `GOOGLE_OAUTH_AUTH_URL`, `_TOKEN_URL`, `_REVOKE_URL`, `GOOGLE_USERINFO_URL`                                               | Google's | exist so a test can aim the app at a stand-in                                                  |
| `GOOGLE_CALENDAR_API_URL`, `GOOGLE_SHEETS_API_URL`, `GOOGLE_DRIVE_API_URL`, `GOOGLE_DOCS_API_URL`, `GOOGLE_FORMS_API_URL` | Google's | the same                                                                                       |

## 6. Operating it

- **Which calls are repeated.** Reads, refreshes, patches, deletes and the event insert (it carries a fixed id, so a repeat is a 409 and becomes an update) are
  repeated on 429, 5xx, timeout and network errors with random jitter. A sheet row append and a document copy are repeated only after a 429 (Google refused them before doing
  anything): a 5xx may have happened after the work, and a second row or copy would be wrong. The busy-time lookup a visitor waits on is never repeated inside the call.
- **Quotas.** Published defaults at the time of writing (check the Quotas page of each API in your project): Sheets API about 300 read and 300 write requests a minute per
  project and 60 a minute per user; Calendar API a per-minute per-user limit; Drive API 12,000 queries a minute. One workspace's flows share its single account, so a busy
  workspace meets its per-user limit first. `rateLimitExceeded` shows as `GOOGLE_RATE_LIMITED`; short waits are slept, long `Retry-After` values are handed back.
- **Needs reconnecting** means Google refuses the grant (`invalid_grant`): the person removed the app at myaccount.google.com, changed their password with the app's
  access revoked, the 7-day Testing limit, six months without use, or a Google Workspace admin blocked the app. The workspace admin presses **Reconnect Google**; the
  calendar choice is kept. It is recorded once (audit entry `appointment_calendar` update, outbox event `appointment_calendar.needs_reconnect`).
- **Workspace admins** of a customer's Google Workspace may need to allow the app (Admin console, Security, API controls) before their users can connect.
- **Last used and last problem** are shown on the Google account page; they are stored on the connection (`last_used_at`, `last_error_code`, `last_error_at`), written at
  most once a minute and only when the problem changes.
- **One Google account, two workspaces.** Connecting the same Google account in two workspaces gives each its own refresh token. Whether Google withdraws one workspace's token when another's consent
  is cancelled is not verified (acceptance run, section 8); a first consent that comes back short is withdrawn at Google.
- **Connecting is confirmed in the app.** Google's redirect lands on the API, which cannot see anyone's session, so it only parks what Google returned (sealed, ten minutes at
  most, single use) and sends the browser to `/google-account/confirm`. The same signed-in admin reads "Connect <google email> to <workspace> for <permissions>?" and presses
  **Confirm**; only then is the grant stored. A consent link forwarded to somebody else ends on a page that refuses it, withdraws the parked grant at Google and stores nothing.
  Cancel, an expired or an already-used link store nothing either. Records that nobody finished are withdrawn and forgotten by the worker's sweep (about once a minute).
- **Calendar drift is looked for, never auto-applied.** The calendar is still written one way (bookings go to Google, busy time is read when a slot list is built), and Google is
  not the source of truth. A bounded reconcile in the worker (queue `calendar-reconcile`, one workspace per job, at most 10 workspaces a minute, a Redis lock per workspace, an
  hour between passes, 100 appointments per pass, each read about once an hour, 150 ms between event reads, only confirmed appointments starting in the next 60 days that have a Google event id; no watch
  channels, no sync tokens) reads each event once and compares it with **what the product last wrote to it**. It flags an event that was deleted or cancelled, is missing (404),
  was moved, or whose guests changed; our own writes, a guest answering and Google filling in the Meet link are not drift. A flagged appointment shows **Calendar out of sync** with the
  reason, the owner gets one in-app notification (not repeated), and people who may update appointments choose **Push our time back to Google** or **Accept Google's change** (a moved
  event reschedules, a deleted one cancels, both through the usual appointment rules and customer messages). If Google refuses ONE event (forbidden, bad request) that appointment is marked looked-at and unreadable (no notification) and the pass goes on. If Google cannot be asked at all (an outage, quota, a grant that died
  during the pass) the pass stops and claims nothing; if the calendar itself is gone the connection shows `GOOGLE_NOT_FOUND` and no appointment is flagged; a looked-at appointment is not read again for 50 minutes, and a look never changes the appointment's version; the workspace is tried again after 5, 10, 20 ... minutes, up to six hours. It costs about one Calendar read per upcoming
  appointment per hour, well inside the per-user quota.

## 7. Errors, in plain words

| Code                             | Where you see it                           | Cause and fix                                                                                         |
| -------------------------------- | ------------------------------------------ | ----------------------------------------------------------------------------------------------------- |
| `GOOGLE_ACCOUNT_NOT_CONFIGURED`  | page "Not set up", run log, 422 on connect | no client id/secret, or the console switch is off: sections 4 and 5                                   |
| `GOOGLE_ACCOUNT_NOT_CONNECTED`   | run log, 409                               | the workspace never connected: an admin presses **Connect Google account**                            |
| `GOOGLE_ACCOUNT_NEEDS_RECONNECT` | page, run log, 409                         | Google refuses the grant: **Reconnect Google**                                                        |
| `GOOGLE_SCOPE_MISSING`           | run log, picker, page                      | the account was not given that permission: tick it and **Add permissions**                            |
| `GOOGLE_API_NOT_ENABLED`         | run log, page                              | enable the API in the project (section 2)                                                             |
| `GOOGLE_RATE_LIMITED`            | run log, page                              | quota; see section 6                                                                                  |
| `GOOGLE_NOT_FOUND`               | run log                                    | wrong sheet, document or form id, or the connected account cannot open it                             |
| `GOOGLE_ACCESS_DENIED`           | run log                                    | the account may not write there: share the file with it as an editor                                  |
| `GOOGLE_BAD_REQUEST`             | run log                                    | Google rejected the request: a tab name that does not exist, a malformed range                        |
| `GOOGLE_UNAVAILABLE`             | run log, page                              | Google did not answer in time                                                                         |
| `GOOGLE_CONSENT_NOT_YOURS`       | confirmation page, 403                     | someone other than the person who pressed Connect opened the link: they must connect again themselves |
| `GOOGLE_CONSENT_EXPIRED`         | confirmation page, 410                     | the confirmation took more than ten minutes: press Connect again                                      |
| `GOOGLE_CONSENT_USED`            | confirmation page, 409                     | already confirmed, cancelled or refused: press Connect again if still needed                          |
| `GOOGLE_CONSENT_NOT_FOUND`       | confirmation page, 404                     | no such confirmation in this workspace                                                                |
| `GOOGLE_SYNC_NOT_DRIFTED`        | appointments, 409                          | the Google event already matches (or someone settled it): reload the appointment                      |

Other Google-page problems: `redirect_uri_mismatch` (the URI differs from the console's, section 4), `access_blocked` or "app not verified" (Testing mode and not a test user, or
past the 100-user cap), "Connecting did not finish" (wrong client secret, or the API cannot reach `oauth2.googleapis.com`; the log has `Google Calendar connect failed`), "Google did
not give every permission" (a box was unticked; what was already allowed keeps working).

## 8. First real acceptance run (Google test user, staging workspace)

Do these in order and write down what differs. The expected results are what Google's documentation promises; none of it has been observed against live Google here.

1. Operator: sections 1 to 5 done, app in **Testing** with your account as a test user.
2. Workspace admin: **Settings, Integrations, Google account**. With Calendar, Sheets and Forms ticked press **Connect Google account**. Expect Google's consent screen
   (with the unverified-app warning in Testing: _Advanced, Go to ... (unsafe)_) listing those permissions. Accept all. You land on the app's confirmation page, "Connect
   <your google email> to <workspace> for Calendar, Sheets and Forms?"; press **Confirm**. You land back with "Google account connected." and the three permissions shown as
   Allowed. Repeat once and press **Cancel**: nothing is connected, and the grant disappears from myaccount.google.com, Third-party access. Repeat once more, copy the
   confirmation address into a browser signed in as another workspace member: it must refuse.
3. Tick **Docs and Drive** and press **Add permissions**. Expect Google to ask only for the new permissions, and the earlier three to stay Allowed.
4. Make a test sheet with headers `Name`, `Phone`, `Plan` and a test document containing `{{name}}`; share nothing else. Build a flow: keyword trigger, **Google Sheets**
   (write `{{name}}`, `{{phone}}`), **Google Docs** (the template, new title `For {{name}}`), **Google Meet**, **Google Form**; run it from a simulator or test contact.
   Expect a new row, a copy of the document with the name filled and shared by link, a Meet link message, and the form link.
5. Expect the run log of each step free of `[GOOGLE_...]` codes. Then remove the app at myaccount.google.com, run the flow again, and expect `[GOOGLE_ACCOUNT_NEEDS_RECONNECT]`,
   the page showing **Needs reconnecting**, and no further Google calls on later runs.
6. Disconnect, run again: `[GOOGLE_ACCOUNT_NOT_CONNECTED]`. Reconnect: the calendar choice is kept for the same account.
7. Drift. Book an appointment (Calendar connected, a confirmed booking): its event appears in Google. In Google Calendar move the event by an hour, then wait for the next pass
   (up to an hour; the worker log says `[GACC] calendar reconcile`), or ask the developer to run it. Expect **Calendar out of sync** on the appointment with "moved to another
   time", one notification for the owner, and the appointment unchanged. Press **Push our time back to Google** and expect the event back at the booked time; move it again
   and press **Accept Google's change**: the appointment moves and the customer is told. Delete an event in Google: expect "deleted" and, on Accept, a cancellation. Add a
   guest in Google: expect "guests changed".

## 9. Verification submission checklist

Prepare once, submit from _Google Auth Platform, Verification Center_. Google reviews the consent screen, the scopes, the demo videos and the privacy policy together, and
answers by email to the project's support address; reply to every question in the same thread. Use the product's real wording.

**A. Before you submit**

- [ ] The app is **In production**, the domain is verified in Google Search Console and is an authorised domain on the consent screen, and the app home page is public and
      describes the product (not a login wall).
- [ ] A **privacy policy** at a public URL on that domain that: names the app and the company; lists the Google data used (calendar events and busy time, rows of sheets a
      workspace's flow names, documents a flow copies, forms a flow links, file names for pickers, the Google account's email address); says why each is used and that it is
      used only to provide those features; says Google user data is **not sold, not used for advertising and not used to train generalised AI models**; says who it is shared with
      (nobody beyond the processors that run the service, listed); says how long it is kept (the grant is deleted on disconnect and on workspace erasure; tokens are stored encrypted);
      says how a person revokes access (the Disconnect button and myaccount.google.com, Third-party access); has a contact for deletion requests. It must include Google's Limited Use
      statement: "The use of information received from Google APIs will adhere to the Google API Services User Data Policy, including the Limited Use requirements."
- [ ] Terms of service at a public URL on the same domain.
- [ ] Only the scopes in section 3 are declared on the consent screen (no unused scope: Google rejects those).
- [ ] A test account with sample data (a calendar with an event, a sheet, a document, a form) and written steps that a reviewer can follow.

**B. Per-scope justification** (paste into the scope's "How will the scopes be used?" box; adapt the product name)

| Scope                                  | Justification                                                                                                                                                                                                                                                                                                                                                            |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `userinfo.email`, `openid`             | Shows the workspace administrator which Google account is connected, so they do not connect the wrong one.                                                                                                                                                                                                                                                               |
| `calendar.events`                      | When a customer books an appointment, the app creates, moves and deletes that appointment's event on the calendar the workspace administrator chose, and adds a Google Meet link when the service is virtual. It only touches events it created (marked with the appointment id). It does not read other events except to detect that one of its own events was changed. |
| `calendar.freebusy`                    | The booking page must not offer a time the business is already busy. The app asks Google only for free/busy intervals of the chosen calendar, never event titles or details of other events.                                                                                                                                                                             |
| `calendar.calendarlist.readonly`       | Lets the administrator pick which of their calendars bookings go to. Only the list of calendar names the account can write to is read.                                                                                                                                                                                                                                   |
| `spreadsheets`                         | A workspace builds an automation step that appends a row, reads a row, or checks a cell in a spreadsheet **the administrator names by link or id**. The app reads and writes only the spreadsheets and tabs the automation names. (A narrower scope does not exist for choosing an arbitrary existing spreadsheet.)                                                      |
| `forms.body.readonly`                  | An automation step needs the public responder link of a form the administrator names, to send it to the customer. Only the form's link is read; answers and questions are not stored.                                                                                                                                                                                    |
| `documents`                            | An automation step fills placeholders such as the customer's name in the **copy** of a template document that the same step created.                                                                                                                                                                                                                                     |
| `drive` (restricted)                   | An automation step copies a template document the administrator owns, titles the copy, and shares the copy by link so the customer can open it. The app does not browse, read or change any other file. A narrower scope (`drive.file`) cannot copy a template the app did not create, which is the product's core use.                                                  |
| `drive.metadata.readonly` (restricted) | The automation builder lists the administrator's spreadsheets, documents and forms **by name** so they can pick one instead of pasting a link. Only names and ids are read, in the browser session of the administrator, and are not stored.                                                                                                                             |

**C. Demo video outline** (one video per consent screen is accepted; unlisted YouTube, English narration or captions, the Google consent screen must show the **OAuth client ID** in
the address bar, and each scope must be seen in use)

1. State the app, the company and the domain. Open the app and sign in as a workspace administrator (about 20 s).
2. **Settings, Integrations, Google account**. Tick the permissions and press **Connect Google account**. Show Google's consent screen in full, with the client id visible in the
   address bar, and read out the listed permissions. Accept. Show the app's confirmation page ("Connect ... to ... for ...?") and press **Confirm**.
3. Calendar: set the booking calendar, book an appointment from the booking page, show the event appear in Google Calendar (events, Meet link), reschedule it and show the same event move,
   cancel it and show it removed. Show a busy slot disappear from the booking page (free/busy). Show the calendar chooser (calendar list).
4. Sheets: build the flow step, run it, show the row appear in the sheet.
5. Forms: run the step, show the form link sent to the contact.
6. Docs and Drive: run the step, show the template copy created, placeholders filled and the share link; show that no other file is touched.
7. Drive file list: open the picker, show the file names listed, pick one.
8. Show **Disconnect** and then myaccount.google.com, Third-party access, with the app gone.
9. Show the privacy policy page that carries the Limited Use statement (about 15 s).

**D. Restricted scopes (`drive`, `drive.metadata.readonly`): security assessment**

- Because the app stores data obtained from restricted scopes on a server (file ids, names and the copies' ids; tokens), Google requires an annual **Cloud Application Security
  Assessment (CASA)** by an authorised assessor (Tier 2 or 3 as Google assigns; you receive a Letter of Validation). Budget weeks and an assessor fee; start it when Google asks, but gather
  the evidence now: encrypted token storage (sealed with the credentials key), tenant isolation (row-level security), audit of connect and disconnect, access control by permission key,
  dependency and static-analysis reports (`pnpm audit:tenancy`, `audit:authz`, `audit:auth`, `audit:sast`), a data retention and deletion statement, and an incident response contact.
- If the assessment is not wanted yet, leave the two restricted scopes out of the consent screen. The code does not need changing: the capabilities stay on the page, and a
  workspace that ticks one before it is declared gets Google's own refusal, which the page reports as "Google did not give every permission".
- Re-submit for any new scope; do not add scopes to the client without it.
