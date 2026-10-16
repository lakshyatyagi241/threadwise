# Microsoft 365 / Outlook mail: platform setup (TW-MAIL-034)

One Microsoft Entra app serves the whole platform. Workspace admins connect their own Outlook and Microsoft 365 mailboxes from **Email**; they never see the
client id or secret. The platform operator does this once, in the operator console under **Settings > Microsoft 365 email**
(`/admin/settings/microsoft-mail`), or with environment variables.

## 1. Register the app (Microsoft Entra admin center)

1. Entra admin center > **Identity > Applications > App registrations > New registration**.
2. **Supported account types**: pick what your customers use.
   - "Accounts in any organizational directory and personal Microsoft accounts" is the widest and works with tenant `common` (the default).
   - A single-tenant app only signs in people of that directory: set **Tenant** on the console page to that directory's id (or `MICROSOFT_MAIL_TENANT`). Using `common` with a
     single-tenant app fails with AADSTS50194; the mailbox is not touched and the operator sees the cause in the API log.
3. **Redirect URI**: platform **Web**, exactly the address the console page shows under "Redirect URI". By default
   `<APP_URL>/v2/public/email/microsoft/callback`. It must match character for character (a trailing slash counts).
4. Copy the **Application (client) ID** from the Overview page.
5. **Certificates & secrets > New client secret**: copy the **Value** (shown once). Secrets expire (at most 24 months): put the expiry in a calendar. An expired secret
   (AADSTS7000222) stops every Microsoft mailbox from refreshing until a new one is saved; the mailboxes are not marked "needs reconnecting" because it is the platform's fault.

## 2. API permissions (delegated, Microsoft Graph)

`Mail.Read`, `Mail.Send`, `User.Read`, `offline_access` (plus the default `openid` and `email`). Nothing that can modify or delete mail is requested.
Some organizations let only an admin consent to apps: the person then sees "Need admin approval" and an admin of that organization must grant consent
(an admin can use **API permissions > Grant admin consent** in their own tenant, or the admin consent URL). A grant without `Mail.Read` or `Mail.Send` is refused by the
connect flow with `?email=missing_scope`.

## 3. Publisher verification

An unverified multi-tenant app shows "unverified" on the consent screen and many organizations block consent to it. Verify the publisher: **Branding & properties >
Publisher domain**, then add your Microsoft Cloud Partner Program (MPN) id under **Verify**. Do this before onboarding customers outside your own directory.

## 4. Save it in the platform

Console > Settings > **Microsoft 365 email**: paste the client id and secret (the secret is stored encrypted and never shown again), set the tenant if needed, switch **Allow workspaces to
connect Microsoft 365** on. Or set the environment fallbacks (used for a field left empty in the console):

| Variable                                                   | Meaning                                                   |
| ---------------------------------------------------------- | --------------------------------------------------------- |
| `MICROSOFT_MAIL_CLIENT_ID`, `MICROSOFT_MAIL_CLIENT_SECRET` | the app                                                   |
| `MICROSOFT_MAIL_TENANT`                                    | `common` (default), `organizations`, `consumers`, an id   |
| `MICROSOFT_MAIL_REDIRECT_URI`                              | only when the registered address differs from the default |
| `MICROSOFT_LOGIN_URL`, `MICROSOFT_GRAPH_URL`               | sovereign clouds or a test stand-in (defaults are global) |
| `MICROSOFT_MAIL_HTTP_TIMEOUT_MS`                           | per call (default 20000)                                  |

Until both a client id and a secret exist the provider card in Email shows "Ask your platform administrator" and connecting answers `not_configured`.

## 5. Live updates: Graph change notifications (optional, off by default)

Without this, every Microsoft mailbox is read by the one-minute sweep. With it, Microsoft tells the platform when mail arrives and the mailbox is synced within seconds (the sweep then
only reconciles every `MAIL_PUSH_RECONCILE_MINUTES`, default 10). The hub shows the **Live updates** chip on a mailbox that has a subscription.

**What it needs (this is the part that is not in the Entra app):**

1. **A public HTTPS address that Microsoft can reach.** Microsoft's servers POST to it from the internet, so it must be `https://`, on a public host name, with a certificate from a public CA
   (a self-signed or private-CA certificate is refused), and not behind a login, a VPN, an IP allow-list or a WAF challenge. `localhost`, private addresses and `*.local`, `*.internal` or
   `*.test` names can never work; the platform does not even try them.
2. **The route is `POST /v2/public/email/microsoft/push`** on the API (public by design: it is authenticated by the `clientState` each subscription carries). By default the address is the
   origin of the **Redirect URI** above plus that path, for example `https://api.example.com/v2/public/email/microsoft/push`, so a platform whose sign-in callback already works usually needs
   nothing more. If a reverse proxy or a tunnel (staging) fronts the API differently, set `MICROSOFT_MAIL_NOTIFICATION_URL` to the full address. The proxy must pass the POST body **and the
   query string** (Microsoft's validation request is `POST ...?validationToken=...`) and answer within Microsoft's limits: the validation within 10 seconds, notifications within 3 seconds
   (the route answers `202` at once and queues the sync).
3. **No new Graph permission.** A subscription on `me/mailFolders('inbox')/messages` with a delegated token needs `Mail.Read`, which the app already has. Nothing in the Entra app changes.
4. **Switch it on:** `MAIL_GRAPH_PUSH_ENABLED=true` on the API **and** the worker, then restart both. Until then the route answers `404` and no subscription is created.

| Variable                          | Meaning                                                                                                          |
| --------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `MAIL_GRAPH_PUSH_ENABLED`         | `true` to use change notifications (default `false`)                                                             |
| `MICROSOFT_MAIL_NOTIFICATION_URL` | the full public address, when it is not the redirect URI's origin plus `/v2/public/email/microsoft/push`         |
| `MAIL_PUSH_RENEW_BEFORE_HOURS`    | renew a subscription when less than this is left (default 24; never later than half its lifetime, about 35 hours) |
| `MAIL_PUSH_RECONCILE_MINUTES`     | a mailbox with a live subscription is still polled at least this often (default 10): the net behind a lost event |

**How it works.** Every two minutes the push sweep (worker) creates a subscription for each connected Microsoft mailbox that has none, renews the ones near their end (Graph keeps a mail
subscription under three days; we ask for 70 hours), and recreates one that Graph no longer has. Creating a subscription makes Microsoft call the address with `?validationToken=` and expect the
token back as plain text; if that fails the create is refused (`400 ValidationError`), the mailbox simply stays polled and the sweep tries again two minutes later (the API log says "mail push
could not be started or renewed"). A notification carries the subscription id and a `clientState` that names the workspace and mailbox and is signed (HMAC) with a key derived from
`CREDENTIALS_ENCRYPTION_KEY`; a notification whose signature or subscription id does not match what the mailbox stores is dropped without a sound. A valid one queues the normal sync job (one job
per mailbox, a burst collapses) and the sync reads the Inbox through the delta cursor. The notification's own message id is **not** used to fetch the mail: Graph sends mutable ids while our ledger
key is the immutable id, and reading around the cursor could store a message twice or out of order.

Lifecycle events go to the same address: `reauthorizationRequired` flags the subscription for renewal (the sweep does it within two minutes) and syncs; `subscriptionRemoved` forgets it (the sweep
makes a new one) and syncs; `missed` syncs. Disconnecting a mailbox deletes its subscription at Microsoft; a notification that still arrives for it is ignored.

**Rotating `CREDENTIALS_ENCRYPTION_KEY`** changes the `clientState` key: the notifications of existing subscriptions no longer verify, so those mailboxes fall back to polling until their
subscriptions are recreated (clear `push_state` of the Microsoft mailboxes after the rotation, or wait for the 70-hour subscriptions to lapse).

| What you see                                      | Cause and fix                                                                                                                              |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| No **Live updates** chip on a Microsoft mailbox   | push is off (`MAIL_GRAPH_PUSH_ENABLED`), the address is not public https, or Microsoft could not validate it (see the log)                 |
| Log: "mail push could not be started or renewed"  | usually the validation: the address is unreachable from the internet, the certificate is not from a public CA, or the proxy drops the query string |
| The chip is there but mail still takes a minute   | notifications are not arriving (firewall, WAF); the reconcile poll and the sweep still deliver the mail                                    |
| A notification never syncs anything               | the mailbox is not connected, its add-on lapsed, or the subscription id it stores is not the one Microsoft sent (it was replaced)          |

## How it behaves (what to tell support)

- **Sync**: the Inbox is read with Graph delta queries (`/me/mailFolders/inbox/messages/delta`), once a minute by the sweep. The first run reads the last `MAIL_BACKFILL_DAYS`
  days quietly (no unread, no alerts). Junk, Deleted Items, Sent Items and drafts are never stored. A delta token Graph drops (HTTP 410) is repaired by a new quiet read.
- **Threads**: one conversation per Graph `conversationId`.
- **Send**: a reply is a Graph draft created with `createReply` on the stored original (Exchange then writes In-Reply-To and References), filled with our body, recipients and
  Message-ID, and sent. Graph refuses non-`x-` headers on a new message, so a mail whose original was deleted goes out as a new message without threading headers, and
  extra headers such as `Auto-Submitted` are not sent through Graph. A retry looks in Sent Items for the same Message-ID before sending again. Attachments up to 3 MB are
  inline, larger ones use an upload session.
- **Refresh tokens rotate**: every refresh stores the new token; a mailbox unused for 90 days needs reconnecting (AADSTS700082). A password change, revoked consent or a
  conditional-access policy ends the grant the same way: the mailbox shows "Reconnect".
- **Throttling**: HTTP 429 / 503 with `Retry-After` is retried by the queue; the wait is carried on the error. Microsoft throttles about 10,000 requests per 10 minutes per mailbox.
- **Disconnect** forgets the tokens here. Microsoft has no endpoint that withdraws a single refresh token, so the person removes the app at
  myapps.microsoft.com (work or school) or account.microsoft.com/privacy/app-access (personal) if they want it gone there too.
- **No Exchange Online mailbox** (no licence, on-premises Exchange, guest account): Graph answers `MailboxNotEnabledForRESTAPI`; the mailbox shows "no Exchange Online mailbox".

## Not verified here

Everything was built from Microsoft's documentation and run against a local stand-in; nothing has been run against a real Entra tenant. That includes change notifications
(section 5): the subscription calls, the validation handshake, the lifecycle events and the `clientState` check were run against `fake-graph.ts` only. Before the first customer,
connect one work account and one personal Outlook.com account and check: consent, first sync, a threaded reply (does Outlook show the thread?), an attachment above 3 MB, and a reconnect.
Then switch push on in staging (it needs the public https address of section 5), connect a mailbox, confirm the **Live updates** chip, send a mail to it and watch it arrive within
seconds, and let a subscription pass its renewal point.
Assumptions to confirm live: that Graph accepts `internetMessageId` on a draft PATCH and keeps it on send, that the immutable id of a sent draft stays the same, that a delegated
subscription's notifications carry the `clientState` we set, that `lifecycleNotificationUrl` may equal `notificationUrl`, and that Graph accepts the 70-hour lifetime.
