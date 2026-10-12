# Google Mail (Gmail): creating the OAuth client

For the platform operator. Once per platform (not per workspace): every workspace connects its own Gmail or Google Workspace mailboxes through this
one client. Without it, a workspace's Email hub says Google is not set up for this platform and Connect answers `MAIL_NOT_CONFIGURED`.

This is a **different client from Google Calendar's** ([google-calendar-setup.md](google-calendar-setup.md)) on purpose: the Gmail scopes are
**restricted** and the client needs Google's verification, which a calendar-only client does not. Selling the integration (price, publish) is in
[email-integration-operator-setup.md](email-integration-operator-setup.md); what the product does with the connection is in
[docs/api/channel-email.md](../api/channel-email.md).

## 1. Google Cloud project and API

1. In [Google Cloud Console](https://console.cloud.google.com/) create (or pick) a project owned by the company, not by a person's personal account.
2. _APIs and Services, Library_: enable **Gmail API**.

## 2. Consent screen

_APIs and Services, OAuth consent screen_ (in newer consoles: _Google Auth Platform_):

1. User type **External** (workspaces use their own Google accounts, Gmail or Workspace).
2. App name, support email, the app's home page, privacy policy and terms links, and the authorised domain (the platform's own domain). The privacy policy must
   say what mail is read and stored; Google reviews it.
3. Scopes to add. These are exactly what the product asks for; add nothing else:

   | Scope                                            | Class          | Why                                                                 |
   | ------------------------------------------------ | -------------- | ------------------------------------------------------------------- |
   | `openid`, `.../auth/userinfo.email`              | non-sensitive  | show which Google account is connected                              |
   | `https://www.googleapis.com/auth/gmail.readonly` | **restricted** | read the INBOX into the team inbox (history, messages, attachments) |
   | `https://www.googleapis.com/auth/gmail.send`     | sensitive      | send a reply from the mailbox                                       |

   The product never asks for modify, delete or full-access scopes.

## 3. Testing versus production (read this before inviting customers)

- **Testing** (the default for a new app): only the **test users** you list (up to 100) can connect, they see an "unverified app" warning, and Google ends every
  grant after **7 days**: each mailbox falls to `needs_reauth` and must be reconnected weekly. Fine for development and a pilot; not for customers.
- **In production**: no 7-day limit and no test-user list, but because `gmail.readonly` is restricted, Google requires **app verification** and, for an app that
  stores restricted-scope data on a server, an annual **security assessment** by an approved assessor (CASA, a paid third-party review). Plan weeks, not days:
  submit the verification request (the consent screen, the scope justification, a demo video of the connect flow and of what the app does with the mail, the
  privacy policy), then the assessment. Until it is approved the app keeps working for test users only.
- Add test users under _OAuth consent screen, Test users_ while in Testing. A workspace's admin must use one of those Google accounts.

## 4. The OAuth client

_APIs and Services, Credentials, Create credentials, OAuth client ID_:

1. Application type **Web application**.
2. **Authorised redirect URI**: exactly `<APP_URL>/v2/public/email/google/callback` (for example `https://api.threadwise.example/v2/public/email/google/callback`).
   It must match character for character, including scheme and no trailing slash; a mismatch is Google's `redirect_uri_mismatch` page.
3. Copy the **client ID** and **client secret**.

## 5. Give the platform the credentials

Either (preferred) in the operator console: **Settings, Google mail** (settings group `googleMail`):

| Field         | Value                                                                                                                  |
| ------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Enabled       | On. Off: nobody can connect and no mailbox is read or sent from (what is stored stays)                                 |
| Client ID     | from step 4                                                                                                            |
| Client secret | from step 4 (stored encrypted, never shown again)                                                                      |
| Redirect URI  | leave empty for `<APP_URL>/v2/public/email/google/callback`; set it only when the address registered at Google differs |

or in the environment (used for any field the console leaves empty): `GOOGLE_MAIL_CLIENT_ID`, `GOOGLE_MAIL_CLIENT_SECRET`, `GOOGLE_MAIL_REDIRECT_URI`.
`GOOGLE_OAUTH_AUTH_URL`, `GOOGLE_OAUTH_TOKEN_URL`, `GOOGLE_OAUTH_REVOKE_URL`, `GOOGLE_USERINFO_URL` and `GMAIL_API_URL` default to Google's own addresses and
exist so a test can aim the app at a stand-in.

Check: sign in to a workspace that owns the Email integration, open the Email hub (Settings, Integrations, Email), the "not set up" notice is gone (`providerReady: true`), press **Connect**,
choose a test user, tick both permissions, and the mailbox appears as connected; its mail arrives within a minute.

## 6. Operating it

- Tokens are sealed with the credentials key (`CREDENTIALS_ENCRYPTION_KEY`; rotate with [key-rotation.md](key-rotation.md)). Rotating the **client secret** at Google
  needs the new value in the console; existing refresh tokens keep working.
- Changing the **client ID** invalidates every stored grant: every mailbox answers `invalid_grant` and shows **needs reconnecting**. Do not change it casually.
- A mailbox showing **needs reconnecting** is Google refusing the grant (the user revoked it at myaccount.google.com, changed their password with Gmail scopes
  revoked, the 7-day Testing limit, or a Workspace admin blocked the app). The workspace admin presses Reconnect; nothing is lost.
- **Workspace admins** of a customer's Google Workspace may need to allow the app (Admin console, Security, API controls) before their users can connect.
- Quota: the Gmail API allows 250 quota units per user per second and 1,200,000 per minute per project; a sync of a quiet mailbox costs about 8 units a minute.
  A flood of mailboxes on one project is the first thing to watch (`rateLimitExceeded` shows up as "Google is limiting requests right now" on the hub and is retried).
- The sync is a worker job (queue `mail-sync`); if mail stops arriving for every workspace, check the worker is running and Redis is reachable, then
  `GET /v2/email/mailboxes` for the `lastError` of one mailbox.

## 7. Instant mail with Gmail push (optional, TW-MAIL-033)

Without this the mailboxes are polled every minute. With it Gmail tells us about new mail through Google Pub/Sub and the mailbox is synced within seconds; a
mailbox with a live watch is still polled as a safety net, at least every 10 minutes (`MAIL_PUSH_RECONCILE_MINUTES`, 1 to 10).

1. In the same Google Cloud project, enable the **Cloud Pub/Sub API** and create a topic, for example `gmail-push`. Its full name is `projects/<project>/topics/gmail-push`.
2. On the topic, Permissions, add the principal `gmail-api-push@system.gserviceaccount.com` with the role **Pub/Sub Publisher**. Gmail cannot publish without it.
3. Create (or reuse) a service account, for example `gmail-push@<project>.iam.gserviceaccount.com`. It only signs the push requests; it needs no roles.
4. Create a **push subscription** on the topic: delivery type Push, endpoint URL `<APP_URL>/v2/public/email/google/push`, tick **Enable authentication**, pick that service
   account, and set **Audience** to the same endpoint URL (or any string you then enter as the audience in the console). Acknowledgement deadline 10 seconds is plenty.
5. In the operator console, Gmail email, section **Gmail push**: enter the topic, the audience (empty means the endpoint URL above) and the service account.
   Environment fallback for each empty field: `GOOGLE_MAIL_PUBSUB_TOPIC`, `GOOGLE_MAIL_PUSH_AUDIENCE`, `GOOGLE_MAIL_PUSH_SERVICE_ACCOUNT`.

What happens next: the worker sets a Gmail `watch` on each connected mailbox's INBOX within two minutes (mailboxes connected later get theirs the same way) and the hub shows
**push active**. A watch lasts about 7 days; the worker renews it when less than `MAIL_PUSH_RENEW_BEFORE_HOURS` (24) remain. A watch is withdrawn on disconnect, when the
mailbox needs reconnecting, when push is switched off here, or when renewal kept failing until it ran out; the mailbox is then simply polled again.

The endpoint accepts only requests carrying Google's OIDC token for that audience and that service account (RS256, Google's published keys, issuer, expiry,
`email_verified`); anything else gets 401 with no body. A valid notification is answered 204 at once, also for an unknown address or an already-seen history id.

Troubleshooting: no "push active" -> topic or service account empty, Gmail client off, or `gmail-api-push@system.gserviceaccount.com` missing as Publisher (the watch
call fails and the worker log says "gmail watch could not be started or renewed"). Push active but mail waits minutes -> the subscription is not delivering: check the
subscription's push errors in Google Cloud (a 401 means audience or service account differ from the console), and that the endpoint is reachable from the internet over https.
Not run against live Google in this repository: verify once on a real project.
