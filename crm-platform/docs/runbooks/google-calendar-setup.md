# Google Calendar: creating the OAuth client

For the platform operator. Once per platform (not per workspace): every workspace connects its own Google account through this one
client. Without it, workspaces see Google Calendar as "not set up for this platform" and bookings carry on without a calendar.

What the product does with the connection is in [docs/api/appointments-booking.md](../api/appointments-booking.md#google-calendar-wd-appt-012-028-029-d-08).

## 1. Google Cloud project and API

1. In [Google Cloud Console](https://console.cloud.google.com/) create (or pick) a project owned by the company, not by a person's
   personal account.
2. _APIs and Services, Library_: enable **Google Calendar API**.

## 2. Consent screen

_APIs and Services, OAuth consent screen_ (in newer consoles: _Google Auth Platform_):

1. User type **External** (workspaces use their own Google accounts, Gmail or Workspace).
2. App name, support email, the app's home page, privacy policy and terms links, and the authorised domain (the platform's own domain).
3. Scopes to add. These are exactly what the product asks for; add nothing else:

   | Scope                                                            | Why                                            |
   | ---------------------------------------------------------------- | ---------------------------------------------- |
   | `openid`, `.../auth/userinfo.email`                              | show which Google account is connected         |
   | `https://www.googleapis.com/auth/calendar.events`                | write, move and delete booking events, Meet    |
   | `https://www.googleapis.com/auth/calendar.freebusy`              | read busy time so booked slots are not offered |
   | `https://www.googleapis.com/auth/calendar.calendarlist.readonly` | let an admin pick which calendar to use        |

4. **Publish the app** (_Publishing status: In production_). This is the step that is easiest to miss: while the app is in **Testing**,
   Google ends every grant after **7 days** and only listed test users can connect, so every workspace would fall to "needs reconnecting"
   a week after connecting. For these (sensitive, not restricted) scopes Google asks for verification before the app is shown without a
   warning screen; until it is verified, people see "Google hasn't verified this app" and can continue under _Advanced_, up to the
   100-user cap of an unverified app. Start the verification early: it needs the privacy policy, a demo video of the consent flow and a
   justification for each scope.

## 3. The OAuth client

_APIs and Services, Credentials, Create credentials, OAuth client ID_:

1. Application type **Web application**.
2. **Authorised redirect URIs**: add exactly the address the console shows (_Admin, Settings, Google Calendar_, "Redirect URI"). By default
   it is

   ```
   <APP_URL>/v2/public/appointments/calendar/google/callback
   ```

   for example `https://desk.example.com/v2/public/appointments/calendar/google/callback`. It must match character for character
   (scheme, host, path, no trailing slash), or Google stops at `redirect_uri_mismatch`. Register one per environment (staging,
   production); a local run can use `http://localhost:3000/v2/public/appointments/calendar/google/callback`.

3. No "Authorised JavaScript origins" are needed (the flow is server side).
4. Copy the **client ID** and the **client secret**.

## 4. Give them to the platform

Either (they are read in this order, a field left empty falls through to the next):

- **Console:** _Admin, Settings, Google Calendar_: paste the client ID and the client secret, leave _Allow workspaces to connect Google
  Calendar_ on, save. The secret is stored encrypted and is never shown again; leaving the field blank on a later save keeps it.
- **Environment:** `GOOGLE_CALENDAR_CLIENT_ID` and `GOOGLE_CALENDAR_CLIENT_SECRET` on the API and the worker (and optionally
  `GOOGLE_CALENDAR_REDIRECT_URI`). Restart the processes.

The console's switch turns Google Calendar off for every workspace without deleting the client: bookings go on, nothing is written to or
read from any calendar, and cards show "not available". Turning it back on resumes (existing connections are kept).

## Check it works

On a staging workspace, with a Google account that is a test user (or after publishing):

1. _Appointments, Settings, Google Calendar_: **Connect**. Google shows the consent screen listing the calendar permissions; accept all.
   You land back on the settings page with "Google Calendar connected", the account email and "Your main calendar".
2. **Choose calendar** lists the calendars the account can edit; pick one and save.
3. Make a booking type with _Create a Google Meet link_ (or location _virtual_) and book it. Within a few seconds the event is in that
   calendar with the customer as guest and a Meet link, and the appointment shows the link. Move it: the same event moves. Cancel it: the
   event is deleted.
4. Add a busy event to that calendar over a bookable time: that slot disappears from the booking page (allow for the 30 second cache).
5. In the Google account's _Security, Third-party access_ remove the app, then open the settings page: it shows **Needs reconnecting**
   once a booking or a slot lookup has tried the calendar; **Reconnect** restores it and keeps the chosen calendar.

None of this has been run against a real Google account yet (the repository's tests use a local stand-in written from Google's
documentation), so treat this checklist as the first real acceptance run and report anything that differs.

## Problems

| What you see                                                    | Cause and fix                                                                                                                                              |
| --------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Google page says `redirect_uri_mismatch`                        | the redirect URI on the client differs from the one the console shows (APP_URL, scheme, trailing slash)                                                    |
| Google page says `access_blocked` / "app not verified"          | the app is in Testing and the person is not a test user, or it is unverified past the 100-user cap                                                         |
| Back on the page with "Connecting did not finish"               | the code exchange failed: wrong client secret, or the API cannot reach `oauth2.googleapis.com`. The API log has `Google Calendar connect failed`           |
| "Google did not give every calendar permission"                 | the person unticked a permission on the consent screen. Connect again and keep all boxes ticked                                                            |
| Every workspace "Needs reconnecting" about a week after connect | the app is still in Testing: publish it (section 2, step 4)                                                                                                |
| One workspace "Needs reconnecting"                              | that person revoked access, changed the Google password with session reset, or the grant went unused for 6 months: they reconnect                          |
| Slots ignore the calendar's busy time                           | Google was unreachable or the calendar was not found: the API log has `calendar free/busy failed: offering slots without it`                               |
| Bookings are missing from the calendar                          | the connection needed reconnecting while they were made (they are not back-filled), or the outbox is backed up: see [outbox-backlog.md](outbox-backlog.md) |
