# Wiring map: meeting video conferencing and calendar entries (BL-360 to BL-369)

An owner-requested extension (Freshsales' Add meeting drawer: video conferencing row, footer "Connect Google Calendar / Office 365"), not a Reference port. Reference has no video link on a contact's
meeting. API and rules: [docs/api/meeting-conferencing.md](../../api/meeting-conferencing.md); operator setup: [video-conferencing-setup.md](../../runbooks/video-conferencing-setup.md). This file is
the inventory and the wiring map in one.

| What             | Where                                                                                                                                                                                                                                                                                                                                        |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Route (web)      | `/settings/video-meetings` (Settings tile `video-meetings`, section Integrations, shown on the Marketplace Integrations tab; gate `record.contacts.update`); the video and calendar fields inside the contact's **Schedule meeting** row (`meetings-section.tsx`, also the compose box); the status line and Join button on each meeting row |
| Route (API)      | `/v2/conferencing/*`, `/v2/public/conferencing/:provider/callback`, `/v2/contacts/:contactId/meetings/:id/conferencing/retry`; the meeting create/update bodies gain `conferencing`                                                                                                                                                          |
| Permissions      | none new. Everything is `record.contacts.update` (the key the form needs); installing is the Marketplace's `market.apps.install`; the public callback is authenticated by its signed state                                                                                                                                                   |
| Plan             | none of its own. The Marketplace is plan-gated (`marketplace`, installed-apps cap), so Zoom/Teams inherit that; Meet and the calendar entry need only the calendar connection the appointments app already has                                                                                                                               |
| Tables           | `conferencing_connections` (a person's grant per provider, RLS, sealed tokens), `contact_meeting_conferencing` (one row per meeting: request, provider ids, problem codes, RLS); `contact_meetings.join_url` (existing) holds the address; `workspace_app_installations` / `marketplace_apps` are read to know a listing is installed        |
| Settings         | env only: `ZOOM_CLIENT_ID`, `ZOOM_CLIENT_SECRET`, `ZOOM_REDIRECT_URI`, `TEAMS_CLIENT_ID/_SECRET/_TENANT/_REDIRECT_URI` (else the console's Microsoft Calendar app), `CONFERENCING_HTTP_TIMEOUT_MS`, `_RETRIES`, `_RETRY_BASE_MS`, `_RETRY_AFTER_CAP_SECONDS`, `CONFERENCING_FAKE` (development only). No console page yet (BL-368)           |
| Upstream feeders | the Marketplace installation; the operator's Zoom app and Entra app; the workspace's connected Google Calendar / Outlook (appointments); the contact's email for an invitation                                                                                                                                                               |
| Downstream       | the provider rooms and calendar events; audit module `conferencing_connection`; outbox `conferencing.*` and `contact_meeting.conferencing_release`; privacy registry (`contact_meeting_conferencing` under `contacts.*`, `conferencing_connections` allow-listed as staff data)                                                              |

## Every consumer

| Consumer                                                           | Here                                                                                                                                                                 |
| ------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Add / Edit meeting form (contact Meetings tab and the compose box) | `MeetingConferencingFields`: video chips, "Add to my calendar (account, calendar)", "Send a calendar invitation"; offered only from `GET /conferencing/capabilities` |
| Meetings list / timeline row                                       | `MeetingVideoStatus`: provider chip, **Join** button, problem sentence + **Try again**, "On your calendar"                                                           |
| Settings, Integrations                                             | tile **Video meetings** and its page (cards for Zoom and Teams: connect, reconnect, disconnect)                                                                      |
| Marketplace                                                        | listings `zoom`, `microsoft-teams` (category Calendar and meetings, connector `client`, scope `meetings.write`); `APP_HOME` opens the Video meetings page            |
| Appointments calendar                                              | `MeetingCalendarGateway` (exported seam) over `CalendarProviders`: same connection, tokens, refresh and health; meeting events are not reconciled (BL-366)           |
| Outbox worker                                                      | `ConferencingReleaseConsumer` removes rooms and events after a delete, a change of provider or taking the meeting off the calendar                                   |
| Persona vocabulary                                                 | the three UI prefixes `meeting-conferencing.form                                                                                                                     | row | page` are bound surfaces (default nouns meeting, contact) |
| Help                                                               | guide `video-meetings`; `contact-meetings` gains a section                                                                                                           |

## Decisions

1. **Install first, then connect.** The Marketplace installation is the workspace's consent and availability switch; the connection is per person because the room is hosted by the scheduler.
2. **`client` connector type, listings in draft.** Nothing non-functional reaches a workspace; the operator publishes after registering the OAuth apps.
3. **crm owns the meeting; a global module binds the port.** The crm module cannot import the module that uses the appointments calendar (which imports crm), so crm declares `MEETING_CONFERENCING` and the
   meeting-conferencing module binds it. Without the module a meeting is saved exactly as before.
4. **Provider calls after the commit, never inside the transaction;** deletes and drops go through the outbox with the ids captured in the same transaction.
5. **Calendar = the workspace's calendar.** The repo has one Google and one Outlook connection per workspace, not per person. The brief said "the user's calendar"; reusing the existing connection was the
   explicit rule, so a per-person calendar is a follow-up (BL-367).
6. **Teams has two routes:** the person's own Teams account (Graph online meetings), or, when they have none, the Microsoft calendar's `isOnlineMeeting`. Once a room is made its route is fixed (`video_via`).
7. **Teams reuses the operator's Microsoft calendar Entra app** (extra delegated permission, extra redirect URI) unless `TEAMS_CLIENT_*` is set.

## Not built, recorded

BL-361/362 follow-ups: see the backlog entries BL-360 to BL-369.
