# Meeting video conferencing and calendar entries (BL-360 to BL-369)

The **Add meeting** form on a contact can add a **Zoom**, **Microsoft Teams** or **Google Meet** link to the meeting and put the meeting on the workspace's connected calendar. Owner rule: Zoom and
Teams are **integrations first**. The workspace installs the Marketplace listing, each person connects their own account, and only then does the form offer the option. Before that the form shows
nothing, or one quiet "Connect video conferencing" link. Wiring map: [meeting-conferencing.md](../threadwise-port/wiring/meeting-conferencing.md). Operator setup:
[video-conferencing-setup.md](../runbooks/video-conferencing-setup.md).

**Not verified against real providers.** No Zoom, Microsoft 365 or Google account was available. The Zoom and Teams adapters were written from the vendors' documentation and are tested against
`fetch` stand-ins and the in-memory fake; the Google Calendar and Outlook paths reuse the appointments' adapters, tested there against local stand-ins. See "What is not verified".

## Where each option comes from

| Option | Marketplace listing           | Whose account                      | How the room is made                                                                   |
| ------ | ----------------------------- | ---------------------------------- | -------------------------------------------------------------------------------------- |
| Zoom   | `zoom` (installed)            | the person's own Zoom account      | Zoom REST `POST /users/me/meetings`                                                    |
| Teams  | `microsoft-teams` (installed) | the person's own Microsoft account | Graph `POST /me/onlineMeetings/createOrGet` (idempotent on the meeting)                |
| Teams  | none                          | the workspace's Microsoft calendar | an Outlook event with `isOnlineMeeting` (only when the person has no Teams connection) |
| Meet   | none                          | the workspace's Google Calendar    | a Google event with `conferenceData` (the same code appointments use)                  |

The listings are seeded as **draft**, free, connector type `client` (like Email): the sign-in and the calls are built into the product, so installing records the workspace's consent (new scope
`meetings.write`) and issues nothing. The operator publishes them once the OAuth apps exist.

## Routes (`/v2`)

| Method and path                                             | Permission               | Notes                                                                                                                                                                                                                                                    |
| ----------------------------------------------------------- | ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /conferencing/capabilities`                            | `record.contacts.update` | What the form may offer THIS person: `video[{provider, via}]` (installed AND connected), `calendar` (workspace calendar: provider, account, calendar name) or null, `canInstall`, `connectable[]` (installed, this person not connected), `installable`. |
| `GET /conferencing/connections`                             | `record.contacts.update` | The person's cards: `status` is `connected`, `needs_reconnect`, `disconnected`, `not_installed` or `unavailable` (no platform OAuth app).                                                                                                                |
| `POST /conferencing/:provider/start`                        | `record.contacts.update` | `{ returnTo? }` -> `{ url, expiresInSeconds }`. `409 CONF_APP_NOT_INSTALLED`, `422 CONF_NOT_CONFIGURED`.                                                                                                                                                 |
| `GET /public/conferencing/:provider/callback`               | the signed `state`       | The provider's redirect. Exchanges nothing; `302` to the connection page with `?video=confirm&provider=&ticket=` or `?video=denied\|failed\|expired\|not_configured`.                                                                                    |
| `POST /conferencing/:provider/confirm`                      | `record.contacts.update` | `{ ticket }`. Exchanges the code, only for the person who pressed Connect in that workspace (`403 CONF_CONFIRM_NOT_YOURS`, `422 CONF_CONFIRM_INVALID`).                                                                                                  |
| `DELETE /conferencing/:provider`                            | `record.contacts.update` | Deletes the stored tokens; idempotent. Rooms already made stay.                                                                                                                                                                                          |
| `POST /contacts/:contactId/meetings/:id/conferencing/retry` | `record.contacts.update` | Runs the failed step again, the caller hosting a room still to be made. Returns the meeting.                                                                                                                                                             |

Meetings (`/contacts/:contactId/meetings`, create and update) accept an optional `conferencing`:

```json
{ "videoProvider": "zoom" | "teams" | "meet" | null, "addToCalendar": true, "sendInvitation": true, "timeZone": "Asia/Kolkata" }
```

Left out, nothing changes (an edit of the title or the time still moves the room and the event). `videoProvider: null` removes the link. A link or a calendar entry needs a start time (`422`, path
`conferencing`). Meet forces `addToCalendar` on. The response gains `conferencing` (`videoProvider`, `videoStatus` `pending|ready|failed`, `videoError`, `calendarProvider`, `calendarStatus`,
`calendarError`, `invited`) and `joinUrl` (the existing field).

## Behaviour

- **Soft failure.** The meeting is saved first. The provider is asked after the meeting's transaction commits (never inside it). A failure never fails the request: the row records a problem code
  (`not_installed`, `not_connected`, `needs_reconnect`, `not_configured`, `calendar_not_connected`, `provider_failed`, `no_start_time`), the form shows it with **Try again**.
- **Host.** Whoever sets or changes the provider hosts the room: it is made in THEIR account. A later edit by someone else moves the room using the host's connection.
- **Move and rename** update the Zoom/Teams room (PATCH) and the calendar event. A room deleted at the provider is made again.
- **Remove, change of provider, delete.** What the meeting held is captured in the same transaction as an outbox event `contact_meeting.conferencing_release`; the worker deletes the room and the
  event, retrying with backoff. A host who is no longer connected cannot be acted for: the room is left and logged.
- **Calendar.** Reuses the appointments' calendar connection, tokens and refresh through `MeetingCalendarGateway` (no new calendar OAuth). The event is keyed by the meeting's uuid. The calendar is the
  WORKSPACE's (one Google or Outlook account per workspace today); the form shows its account and calendar name. `sendInvitation` sets the contact as an attendee, so the provider emails the invitation;
  our own email invitation to attendees is unchanged.
- **Tokens** are sealed with the credentials key (AES-GCM), refreshed a minute before they expire (both providers rotate refresh tokens), and a refused refresh (`invalid_grant`) marks the connection
  `needs_reconnect` once (audit module `conferencing_connection`, event `conferencing.needs_reconnect`). The consent state and ticket are HMAC-signed with a key derived from the credentials key.

## Events and audit

Audit module `conferencing_connection` (`insert` on connect, `update` on needs_reconnect, `delete` on disconnect); outbox `conferencing.connected`, `.needs_reconnect`, `.disconnected` and
`contact_meeting.conferencing_release`. The meeting's own audit and `contact_meeting.*` events are unchanged.

## What is not verified

- Real Zoom (OAuth app review, scopes, the create/update/delete calls), real Microsoft Graph (`createOrGet`, whether `DELETE /me/onlineMeetings/{id}` is allowed in every tenant, the
  `OnlineMeetings.ReadWrite` consent and a tenant's application access policy), real Google Calendar and Outlook for meetings. The e2e uses the in-memory fake for Zoom and Teams and the local
  Google stand-in.
- Teams through the Microsoft calendar has no e2e of its own (it uses the appointments' Outlook adapter, covered by their tests).
- A browser pass was done against the fake adapters only (see the PR).
