# Menu (the Account tab)

Laid out like the reference mobile app's menu: the person at the top, then one flat list in four sections. Every row opens something
real; a row with nothing behind it yet is left out and recorded below.

| Section     | Row                      | What it does                                                                                                                                                                                                                                                                                        |
| ----------- | ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Workspace   | Dashboard ▾              | opens Summary, Agent, Bot; each lands on that view of the Dashboard tab (`view` route parameter)                                                                                                                                                                                                    |
|             | Inbox                    | the Inbox tab                                                                                                                                                                                                                                                                                       |
|             | Contacts ▾               | All contacts (the Contacts tab) and New contact (`/contact/new`, needs `record.contacts.create`)                                                                                                                                                                                                    |
|             | Settings ›               | opens the Settings page (`/settings`, a list of icon rows, as in the Geta app): Saved replies (`inbox.savedreply.manage`), Labels (`inbox.tag.manage`), Business hours and Auto-assignment (`inbox.settings.read`), Team members and Teams (everyone); the rest is in `features/settings/README.md` |
|             | Tasks                    | the task list (the add button is on that screen)                                                                                                                                                                                                                                                    |
| Account     | Manage profile           | `/profile`: edit full name, display name and phone (`GET`/`PATCH /v2/account/profile`); email and time zone are read-only                                                                                                                                                                           |
| Preferences | Appearance               | `/appearance`: Light mode, Dark mode or Use device settings, saved to the account (`PATCH /v2/account/profile`, field `theme`); see below                                                                                                                                                           |
|             | Notification preferences | `/notification-preferences`: which kinds of notification reach the bell, pop up, play a sound or push (`GET`/`PUT /v2/notifications/preferences`); see `features/notifications/README.md`                                                                                                           |
|             | Device permissions       | opens this app's page in the phone's settings                                                                                                                                                                                                                                                       |
| About       | Help Center              | opens the web app's Help center (`/help` on `EXPO_PUBLIC_WEB_URL`) in the browser; faded, and says so, when the web address is not set (the web help asks for a sign-in there)                                                                                                                      |
|             | Data & Security          | opens `/data-security`: Terms of Use and Privacy Policy (open in the browser at the addresses the administrator set; faded when none can be opened) and Request for Account Deletion (`/delete-account`: phrase + current password, `DELETE /v2/account`, then the phone signs out)                 |
|             | Check for updates        | looks for an over-the-air update; says so when this build does not receive updates (`updates.enabled` needs an EAS project)                                                                                                                                                                         |
|             | Sign out                 | asks first, then signs out                                                                                                                                                                                                                                                                          |

A module the person may not read stays in the list, faded, and explains itself when pressed.

## Appearance

The account keeps a theme of `paper`, `bright` or `dark`; the web counts paper and bright as light. Light mode saves `bright`, Dark
mode saves `dark`, and Use device settings saves `paper`. An account that has not chosen (`paper`, what everyone starts with) keeps
following the phone's own light/dark setting, so nobody's look changes until they pick one; the tick is on Use device settings for
it, and the tick follows what is saved on the account. `ThemeSync` (mounted in the signed-in layout) puts the saved theme on the app
with `Appearance.setColorScheme`, and gives the choice back to the phone when the person signs out. Pressing a row changes the
session in the cache first, so the app switches at once; if the server refuses, the old theme returns and a message says so.

Known limits: the saved theme arrives with the session, so a person who chose Dark on a light-mode phone can see a moment of light
at start-up until the session has loaded (keeping it on the phone would need new local storage, ADR 0023). Choosing any of the three here
also changes the account's theme on the web, where a choice made in a browser still wins over it. Use device settings saves `paper`,
which on the web is its default Paper look, so it replaces a Bright or Dark theme chosen there.

## Help Center, Terms and Privacy need a web address

The Terms and Privacy addresses are set by an administrator (default `/legal/terms` and `/legal/privacy`, site paths). A site path is
joined to `EXPO_PUBLIC_WEB_URL`; when that is not set (it is empty in `.env`), or the address is plain `http` in a store build, the row
on the Data & Security page is faded and says it is not available. The Help Center row opens `EXPO_PUBLIC_WEB_URL` + `/help` in the
browser the same way. Set `EXPO_PUBLIC_WEB_URL` (for example `https://app.example.com`) and rebuild to get them.

## In the reference menu, not built here (recorded, not dropped)

| Reference row                    | Why it waits                                                                                        |
| -------------------------------- | --------------------------------------------------------------------------------------------------- |
| "Set yourself as Away" + the dot | the API has no route to set an agent's availability (it only lists it in `GET /v2/inbox/assignees`) |
| The rest of Settings             | The Auto-assignment rule editor is not built yet (`features/settings/README.md`)                    |
| Photo upload on the profile      | needs an image picker (`mobile-native-capability` review)                                           |
