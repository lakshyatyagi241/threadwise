# Video conferencing setup (Zoom, Microsoft Teams, Google Meet)

Operator steps so the Add meeting form can offer video links (BL-360 to BL-362). Design: [docs/api/meeting-conferencing.md](../api/meeting-conferencing.md).

**Nothing here was run against a real Zoom, Microsoft or Google account.** Treat the first live run as an acceptance test (BL-369).

## Google Meet

Needs nothing new: Meet rooms are made by the workspace's connected Google Calendar ([google-workspace-setup.md](google-workspace-setup.md)). The form offers **Add Google Meet link** once a workspace
has connected Google Calendar.

## Microsoft Teams

1. Use the Entra app already saved for the calendar (console, Microsoft Calendar page) or register one and set `TEAMS_CLIENT_ID`, `TEAMS_CLIENT_SECRET` (and `TEAMS_TENANT`).
2. In the app registration add the **delegated** Microsoft Graph permission `OnlineMeetings.ReadWrite` (and `User.Read`, `offline_access`). Delegated meeting creation may also need the tenant's
   admin to grant consent and, in some tenants, an application access policy.
3. Add the redirect URI `<APP_URL>/v2/public/conferencing/teams/callback` (or `TEAMS_REDIRECT_URI`) to the registration, next to the calendar's.
4. Switching the Microsoft Calendar integration off in the console switches Teams off with it (unless `TEAMS_CLIENT_*` is set).

## Zoom

1. In the Zoom App Marketplace create an **OAuth** app (General app, user-managed). Redirect URL: `<APP_URL>/v2/public/conferencing/zoom/callback` (or `ZOOM_REDIRECT_URI`).
2. Scopes: create, update and delete meetings for the user, and read the user's profile (`meeting:write`, `meeting:update`, `meeting:delete`, `user:read`, or the granular equivalents your Zoom
   account type shows).
3. Set `ZOOM_CLIENT_ID` and `ZOOM_CLIENT_SECRET` in the API environment. The base addresses (`ZOOM_OAUTH_AUTH_URL`, `ZOOM_OAUTH_TOKEN_URL`, `ZOOM_API_URL`) default to Zoom's and exist so a test can
   aim them at a stand-in.

## Why do I see nothing in the Marketplace?

The Zoom and Microsoft Teams listings are seeded as **drafts** on purpose, so a workspace never sees an integration that cannot connect. Until the operator finishes the steps below, Marketplace shows no Zoom or Teams card, and Settings, Integrations, **Video meetings** says **Not available yet** on each card, with no install button (a person who can install is told to ask the platform operator, not sent to an empty list).

A card changes state as the platform gets ready:

| What a person sees                  | Why                                                                               |
| ----------------------------------- | --------------------------------------------------------------------------------- |
| **Not available yet**               | the listing is not published, or the platform has no OAuth app for the provider   |
| **Not installed** + button          | published and set up: the button opens that listing's own Marketplace page        |
| **Installed**, connect your account | the workspace installed it; each person connects their own account                |
| **Connected as ana@example.com**    | the person's own account is connected                                             |
| **Switched off**                    | it was installed, then the operator removed or switched off the provider's set-up |

The operator sees what is missing without reading this page: open the operator console, **Marketplace**, the **Zoom** or **Microsoft Teams** listing. A read-only **Video meetings setup** checklist sits under the listing's actions. It shows, per provider, whether the client id and secret are set and where they come from (values are never shown), whether the Microsoft Calendar integration is switched off (that switches Teams off), whether the listing is published, and the **exact redirect address to register** at the provider (built from `APP_URL`, or the `ZOOM_REDIRECT_URI` / `TEAMS_REDIRECT_URI` override). The same answer is `GET /v2/platform/conferencing/status` (permission `platform.market.manage` or `platform.market.review`).

Fix, in the order the checklist shows: set the credentials above, register the redirect address, then approve and publish the listing's version (next section).

## Publish the listings

The migration `20270130090200_mkt_video_conferencing_apps` seeds `zoom` and `microsoft-teams` as **draft** listings (category Calendar and meetings, free, connector type `client`). When the
provider's app above is ready, open the operator console, Marketplace, the listing, then approve and publish its version. A published listing appears in each workspace's Marketplace Integrations
tab; a workspace installs it (consent to the scope "Add video links to meetings"), then each person connects their own account from Settings, Integrations, Video meetings.

## Development without accounts

Set `CONFERENCING_FAKE=1` in the API (and worker) environment: Zoom and Teams use an in-memory fake that makes links like `https://zoom.fake.test/j/...` which do not open a call. In the consent
round trip the fake accepts any code; the account shown is the code if it contains `@`. Never set it in production.

## If it does not work

- **"Not set up for this platform"** on a card: the environment values above are missing, or (Teams) the Microsoft Calendar integration is switched off in the console.
- **A meeting says the account needs reconnecting:** the provider refused the stored grant; the person reconnects in Settings, Video meetings.
- **A Teams link fails with a forbidden error:** the tenant has not granted `OnlineMeetings.ReadWrite` or requires an application access policy.
