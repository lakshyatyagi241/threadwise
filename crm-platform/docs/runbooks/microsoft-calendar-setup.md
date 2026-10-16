# Outlook / Microsoft 365 calendar: registering the Entra app

For the platform operator. Once per platform (not per workspace): every workspace connects its own Microsoft account through this one app
registration. Without it, workspaces see Outlook as "not set up for this platform" and bookings carry on without it (Google, when connected, is
unaffected).

What the product does with the connection is in [docs/api/appointments-booking.md](../api/appointments-booking.md#outlook--microsoft-365-calendar-bl-035).
This page is the part only the platform owner can do: nothing in the repository can create the app registration, and **nothing here has been
run against a real Microsoft tenant** (the tests use a local stand-in written from Microsoft's documentation), so section "Check it works" is
the first real acceptance run.

You need a Microsoft account that can sign in to the [Microsoft Entra admin center](https://entra.microsoft.com/) (a free Azure account is
enough; the registration is free).

## 1. Register the application

_Entra ID, App registrations, New registration_:

1. **Name**: the product name your customers will see on the consent screen.
2. **Supported account types**: _Accounts in any organizational directory and personal Microsoft accounts_ (multitenant + personal). This is
   what lets a customer connect a Microsoft 365 work or school mailbox **and** an outlook.com / hotmail.com one. Choosing a narrower option
   locks Outlook to those accounts, and `common` in the console below then fails with `AADSTS50194`.
3. **Redirect URI**: platform _Web_, and exactly the address the console shows (_Admin, Settings, Microsoft Calendar_, "Redirect URI"). By
   default it is

   ```
   <APP_URL>/v2/public/appointments/calendar/microsoft/callback
   ```

   for example `https://desk.example.com/v2/public/appointments/calendar/microsoft/callback`. It must match character for character (scheme,
   host, path, no trailing slash) or Microsoft stops at `AADSTS50011`. Add one redirect URI per environment (staging, production); a local run
   can use `http://localhost:3000/v2/public/appointments/calendar/microsoft/callback`.

4. Register. Copy the **Application (client) ID** from the overview page.

## 2. API permissions

_API permissions, Add a permission, Microsoft Graph, **Delegated permissions**_ (not Application): add exactly these, and nothing else (the
product asks for no mail, files or contacts):

| Permission            | Why                                                                         | Admin consent needed |
| --------------------- | --------------------------------------------------------------------------- | -------------------- |
| `openid`, `email`     | show which Microsoft account is connected                                   | no                   |
| `offline_access`      | keep working when the person is away (the refresh token)                    | no                   |
| `User.Read`           | read the account's id and address                                           | no                   |
| `Calendars.ReadWrite` | read busy time, write, move and delete booking events, list their calendars | no (user consent)    |

A customer's tenant administrator may still block user consent for apps; the person then sees "Need admin approval" on Microsoft's screen and
their administrator can approve it once for the organization. That is the customer's policy, not a fault of the app.

## 3. Client secret

_Certificates and secrets, New client secret_. Choose the longest lifetime your policy allows (Microsoft caps it at 24 months), and copy the
**Value** now (it is shown once). **Put the expiry date in the team calendar:** when it passes, every workspace's refresh fails with an
`invalid_client` error (`AADSTS7000222`), the settings cards stay as they were, and no event is written or read until a new secret is saved
here. A secret expiring is not the workspaces' fault and they cannot fix it.

## 4. Publisher verification (before real customers)

An unverified multitenant app shows a "unverified" warning on the consent screen and is blocked in tenants that require verified publishers.
In _Branding & properties_ set the publisher domain and the privacy statement and terms links, then complete **publisher verification** with
the company's Microsoft Partner Network (MPN) account. Start early; it is the long pole. Until it is done, test with accounts in your own tenant.

## 5. Give it to the platform

Either (read in this order; a field left empty falls through to the next):

- **Console:** _Admin, Settings, Microsoft Calendar_: paste the client ID and the client secret value, leave **Tenant** as `common` (or set
  `organizations` for work and school accounts only, `consumers` for personal only, or one directory id for a single-tenant app), leave
  _Allow workspaces to connect Outlook_ on, save. The secret is stored encrypted and never shown again; leaving the field blank on a later
  save keeps it.
- **Environment:** `MICROSOFT_CALENDAR_CLIENT_ID`, `MICROSOFT_CALENDAR_CLIENT_SECRET`, `MICROSOFT_CALENDAR_TENANT` on the API and the worker
  (and optionally `MICROSOFT_CALENDAR_REDIRECT_URI`). Restart the processes.

One app can serve both this and the Email channel's Microsoft 365 provider (paste the same client ID and secret in both console pages, add both
redirect URIs, and add the mail permissions there). They are separate settings on purpose: a leaked or expired mail secret then does not take
calendars down, and the permissions the two ask for are different.

The console's switch turns Outlook off for every workspace without deleting the app: bookings go on, nothing is written to or read from any
Outlook calendar, and cards show "not available". Turning it back on resumes (existing connections are kept).

Tuning variables (all optional): `MICROSOFT_CALENDAR_LOGIN_URL` (default `https://login.microsoftonline.com`, change it for a sovereign cloud),
`MICROSOFT_CALENDAR_GRAPH_URL` (default `https://graph.microsoft.com/v1.0`), `MICROSOFT_CALENDAR_HTTP_TIMEOUT_MS` (8000),
`MICROSOFT_CALENDAR_RETRIES` (2), `MICROSOFT_CALENDAR_RETRY_BASE_MS` (300), `MICROSOFT_CALENDAR_RETRY_AFTER_CAP_SECONDS` (5),
`MICROSOFT_CALENDAR_BUSY_CACHE_SECONDS` (30), `MICROSOFT_CALENDAR_BUSY_BACKOFF_SECONDS` (20).

## Check it works

On a staging workspace, with a Microsoft 365 work account and then an outlook.com account:

1. _Appointments, Settings, Calendars_: **Connect Outlook**. Microsoft shows the consent screen listing the permissions above; accept. You land
   back on the settings page with a **Confirm** panel ("Connect this Microsoft account to <workspace>"); confirm it. The card shows the account
   and "Your main calendar".
2. **Choose calendar** lists the calendars the account can edit; pick one and save.
3. Make a booking type with location _virtual_ and book it. Within a few seconds the event is in that calendar with the customer as guest.
   A **work or school** account also gets a **Teams meeting link** on the appointment; a **personal** account gets the event without a link
   (Microsoft does not give it a Teams room through this call): confirm both, and report the personal-account result.
4. Move the appointment: the same event moves. Cancel it: the event is deleted and the guest gets Microsoft's cancellation.
5. Add a busy event to that calendar over a bookable time: that slot disappears from the booking page (allow for the 30 second cache).
6. Connect Google as well: the card shows both, bookings go to Google unless you choose **Send bookings to Outlook**; busy time from both
   closes slots. Choose Outlook and change a booking: the event leaves Google and appears in Outlook.
7. Press **Reconnect** after removing the app at <https://myaccount.microsoft.com/> (_My apps / Organizations, Manage_): the card shows
   **Needs reconnecting** once a booking or slot lookup has tried the calendar.

Things to look at because they come from documentation, not from a run: the `transactionId` on event creation returning the event a repeated
POST already made; filtering a calendar view by our private extended property (`crmManaged`) when removing our own events from a group
type's busy time; the Teams room on creation; and the response times being UTC under `Prefer: outlook.timezone="UTC"`.

## Problems

| What you see                                           | Cause and fix                                                                                                                                                                                                |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Microsoft page says `AADSTS50011` (reply URL mismatch) | the redirect URI on the app differs from the one the console shows (APP_URL, scheme, trailing slash)                                                                                                         |
| `AADSTS50194` / "not configured as a multi-tenant app" | the app is single-tenant but the console tenant is `common`: change the app's account type (section 1) or set the tenant to the directory id                                                                 |
| `AADSTS7000215` / `AADSTS7000222` in the API log       | the client secret is wrong or has expired: create a new one (section 3) and save it in the console. Workspaces are not affected until then                                                                   |
| "Need admin approval" on Microsoft's screen            | the customer's tenant blocks user consent: their administrator approves the app once                                                                                                                         |
| Back on the page with "Connecting did not finish"      | the code exchange failed: wrong secret, the API cannot reach `login.microsoftonline.com`, or the confirm took longer than five minutes. Press Connect again                                                  |
| "Microsoft did not give the calendar permission"       | the person unticked a permission, or a policy removed it. Connect again and keep all boxes ticked                                                                                                            |
| One workspace "Needs reconnecting"                     | that person revoked access, changed the password with session reset, a conditional-access rule wants a fresh sign-in, or the grant went unused for 90 days                                                   |
| Events carry no Teams link for one workspace           | a personal Microsoft account, or a work account without Teams: the event is written without the link                                                                                                         |
| Slots ignore the calendar's busy time                  | Microsoft was unreachable or the calendar was not found: the API log has `one calendar could not be read` or `calendar free/busy failed`                                                                     |
| Bookings are missing from the calendar                 | the connection needed reconnecting while they were made: a reconnect back-fills the upcoming ones (docs/api/appointments-booking.md), or the outbox is backed up: see [outbox-backlog.md](outbox-backlog.md) |
