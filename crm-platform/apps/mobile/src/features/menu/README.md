# Menu (the Account tab)

Laid out like the reference mobile app's menu: the person at the top, then one flat list in four sections. Every row opens something
real; a row with nothing behind it yet is left out and recorded below.

| Section     | Row                | What it does                                                                                                                |
| ----------- | ------------------ | --------------------------------------------------------------------------------------------------------------------------- |
| Workspace   | Dashboard ▾        | opens Summary, Agent, Bot; each lands on that view of the Dashboard tab (`view` route parameter)                            |
|             | Inbox              | the Inbox tab                                                                                                               |
|             | Contacts ▾         | All contacts (the Contacts tab) and New contact (`/contact/new`, needs `record.contacts.create`)                            |
|             | Tasks              | the task list (the add button is on that screen)                                                                            |
| Account     | Manage profile     | `/profile`: edit full name, display name and phone (`GET`/`PATCH /v2/account/profile`); email and time zone are read-only   |
| Preferences | Device permissions | opens this app's page in the phone's settings                                                                               |
| About       | Data & Security    | opens the privacy policy; only there when it has an address the app may open (see below)                                    |
|             | Check for updates  | looks for an over-the-air update; says so when this build does not receive updates (`updates.enabled` needs an EAS project) |
|             | Sign out           | asks first, then signs out                                                                                                  |

A module the person may not read stays in the list, faded, and explains itself when pressed.

## Data & Security needs a web address

The privacy address is set by an administrator (default `/legal/privacy`, a site path). A site path is joined to
`EXPO_PUBLIC_WEB_URL`; when that is not set (it is empty in `.env`), or the address is plain `http` in a store build, the row is not
shown. Set `EXPO_PUBLIC_WEB_URL` (for example `https://app.example.com`) and rebuild to get it.

## In the reference menu, not built here (recorded, not dropped)

| Reference row                    | Why it waits                                                                                                                                                                      |
| -------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| "Set yourself as Away" + the dot | the API has no route to set an agent's availability (it only lists it in `GET /v2/inbox/assignees`)                                                                               |
| Appearance                       | a theme choice must be kept somewhere: new local storage needs an ADR (0023), and the account theme (paper / bright / dark) does not match the app's light / dark. Owner decision |
| Settings                         | the app has no settings screen yet                                                                                                                                                |
| Help Center                      | the web help center (`/help`) is behind sign-in; there is no public address for the app to open                                                                                   |
| Photo upload on the profile      | needs an image picker (`mobile-native-capability` review)                                                                                                                         |
