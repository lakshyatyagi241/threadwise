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
