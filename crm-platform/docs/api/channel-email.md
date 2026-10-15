# Email channel API (Gmail)

Everything is under `/v2`, signed in as a user. A mailbox is addressed by its uuid. No response ever carries a token, a scope list or the sync
cursor. Email is the paid first-party Marketplace **integration** **Email (Gmail)** (kind `integration`, category Messaging and email; plan feature `email_channel`, limit `email_mailboxes`; its tile is in Settings > Channels); the platform operator
gives the platform a Google OAuth client first ([runbooks/google-mail-setup.md](../runbooks/google-mail-setup.md)).

Gates, in this order on every mailbox route: sign-in, the permission, the plan feature `email_channel` (422 `PLAN_FEATURE_LOCKED` on every route,
reads included), then the body is validated. The public OAuth callback and the attachment download are the two exceptions (below).

## Mailboxes (TW-MAIL-019 to 023, 028)

| Method and path                      | Permission              | What it does                                                                                                |
| ------------------------------------ | ----------------------- | ----------------------------------------------------------------------------------------------------------- |
| `GET /email/mailboxes`               | `mail.mailboxes.read`   | The workspace's mailboxes (disconnected ones included), the plan limit, use and `providerReady`             |
| `GET /email/providers`               | `mail.mailboxes.read`   | The providers a mailbox can be connected with: `[{ provider, label, kind, ready, notReadyReason }]`         |
| `POST /email/mailboxes/connect`      | `mail.mailboxes.manage` | Start a sign-in consent (`provider`, default `google`; `scope` `shared`/`personal`). `{ authorizeUrl }`     |
| `POST /email/mailboxes/connect-imap` | `mail.mailboxes.manage` | Connect an IMAP/SMTP mailbox by settings and password (verified first; the password is never returned). 201 |
| `GET /public/email/google/callback`  | public (signed state)   | Google's redirect. Always a 302 to the web app with `?email=<outcome>`                                      |
| `PATCH /email/mailboxes/:id`         | `mail.mailboxes.manage` | Rename `{ displayName, sendLimitPerHour?, rowVersion }`; 409 `ROW_VERSION_CONFLICT` on a stale version      |
| `POST /email/mailboxes/:id/sync`     | `mail.mailboxes.manage` | Queue a sync now. 202 with the mailbox. 409 `MAIL_MAILBOX_UNAVAILABLE` if disconnected / needs reauth       |
| `DELETE /email/mailboxes/:id`        | `mail.mailboxes.manage` | Disconnect (revoke at Google, wipe tokens, keep the conversations). 204, idempotent                         |

Idempotency-Key is required on `PATCH` and `DELETE`.

### A mailbox

```json
{
  "id": "0d2c0d58-6f1c-4a0c-a0a8-8f3d5f0a8e11",
  "provider": "google",
  "address": "support@acme.com",
  "displayName": "Acme Support",
  "status": "connected",
  "scope": "shared",
  "ownerUserId": null,
  "ownerName": null,
  "hasSignature": false,
  "pushActive": false,
  "sendLimitPerHour": null,
  "imap": null,
  "channelId": "7a6b0a3e-1d6e-4f4f-9f7a-5e1b2a9c4d22",
  "connectedAt": "2026-10-12T09:30:00.000Z",
  "lastSyncedAt": "2026-10-12T09:41:03.000Z",
  "lastError": null,
  "conversationCount": 42,
  "rowVersion": 3
}
```

`status`: `connected`, `needs_reauth` (Google refuses the grant: Reconnect), `error` (the last sync failed; it retries by itself, `lastError` says why
in our words), `disconnected` (kept for its conversations; connecting the same address again reattaches it). `channelId` is the inbox channel of
the mailbox (kind `email`): filter the inbox by it.

### List

```http
GET /v2/email/mailboxes
```

```json
{
  "data": [
    { "id": "0d2c0d58-...", "address": "support@acme.com", "status": "connected", "...": "..." }
  ],
  "limit": 3,
  "used": 1,
  "providerReady": true
}
```

`limit` is the plan's `email_mailboxes` (0 = unlimited); `used` counts every mailbox that is not disconnected. `providerReady: false` means the
platform has no Google client yet: Connect would answer `MAIL_NOT_CONFIGURED`.

### Connect

```http
POST /v2/email/mailboxes/connect
{ "returnTo": "/email" }
```

```json
{
  "authorizeUrl": "https://accounts.google.com/o/oauth2/v2/auth?client_id=...&scope=openid%20email%20https%3A%2F%2Fwww.googleapis.com%2Fauth%2Fgmail.readonly%20https%3A%2F%2Fwww.googleapis.com%2Fauth%2Fgmail.send&access_type=offline&prompt=consent&state=eyJ..."
}
```

`returnTo` is a same-site path (default `/email`). Send `mailboxId` to **reconnect** that mailbox (the consent is pre-filled with its address and
only that Google account is accepted). The browser opens `authorizeUrl` in a popup; Google then calls the callback, which redirects to
`<web>/<returnTo>?email=<outcome>`:

| Outcome          | Meaning                                                                                                        |
| ---------------- | -------------------------------------------------------------------------------------------------------------- |
| `connected`      | Stored (new mailbox or the same address reconnected). The first sync is queued.                                |
| `denied`         | The person pressed Cancel on Google's screen.                                                                  |
| `missing_scope`  | They unticked read or send access. The grant is withdrawn, nothing stored.                                     |
| `limit`          | The plan's mailbox limit is reached. The grant is withdrawn.                                                   |
| `not_configured` | The platform has no Google client (switched off meanwhile).                                                    |
| `wrong_account`  | Reconnecting a mailbox but signed in with another Google account. Nothing changes.                             |
| `failed`         | Anything else: a state that does not verify or has expired (10 minutes), no refresh token, integration lapsed. |

Errors of the start route: 422 `MAIL_NOT_CONFIGURED`, 422 `MAIL_MAILBOX_LIMIT`, 404 for a `mailboxId` of another workspace.

The callback is unauthenticated by design; the signed `state` (HMAC, workspace + admin + mailbox, purpose `email.google-mail.connect`, its own key)
is the credential and is verified before Google is called. The response is never cached and sends no referrer.

### Sync, rename, disconnect

```http
POST /v2/email/mailboxes/0d2c0d58-.../sync            -> 202 { ...mailbox }
PATCH /v2/email/mailboxes/0d2c0d58-...                { "displayName": "Acme Sales", "rowVersion": 3 }
DELETE /v2/email/mailboxes/0d2c0d58-...               -> 204
```

The worker also syncs every connected mailbox once a minute. Disconnect revokes the grant at Google first and carries on if Google cannot be
reached; the mailbox's channel becomes read-only (`disconnected`) and its conversations stay.

## Attachments (TW-MAIL-026)

```http
GET /v2/email/attachments/:conversationId/:messageId/:attachmentId
```

Permission `inbox.conversation.read` plus the inbox's own visibility rule for the conversation. The message must be in that conversation and the
attachment must be listed in its `meta.email.attachments` (the id is never trusted as a key). Every refusal is the same 404; a lapsed integration does
not close it (what arrived stays readable). Served with `X-Content-Type-Options: nosniff`, `Content-Security-Policy: default-src 'none'; sandbox`,
`Cross-Origin-Resource-Policy: same-origin`, `Cache-Control: private, max-age=300`, range requests supported. Images the HTML refers to
(`<img src="cid:<attachment id>">`) are served `inline`, everything else as a download.

## What an email message looks like in the inbox

An inbound mail is a message with `kind: text` on a conversation keyed by the Gmail thread (`peerKey: "t:<threadId>"`; the conversation title is the first
subject and is never overwritten; the contact is linked by the sender's address). Its text body is the plain text (or the text of the HTML), and
the message carries `meta.email` (`EmailMeta` in `@crm/contracts`):

```json
{
  "subject": "Order question",
  "from": { "name": "Ana Customer", "address": "ana@example.com" },
  "to": [{ "name": null, "address": "support@acme.com" }],
  "cc": [],
  "bcc": [],
  "messageId": "CAF=abc123@mail.example.com",
  "inReplyTo": null,
  "references": [],
  "html": "<p>Where is my <b>order</b>?</p><img data-remote-src=\"https://track.example/p.gif\" />",
  "htmlTruncated": false,
  "threadId": "18f2a7c4d9e0b1a2",
  "attachments": [
    {
      "id": "Y2hhdC8xMi8y...",
      "name": "invoice.pdf",
      "mime": "application/pdf",
      "size": 52113,
      "inline": false,
      "tooLarge": false
    }
  ],
  "automated": false
}
```

- `html` is sanitised (no scripts, styles, forms, frames, event handlers; links open in a new window with no referrer). **Remote images are not loaded**:
  their address is in `data-remote-src` and the screen loads them only when an agent asks.
- `attachments[].tooLarge: true` means the file was **not stored** (over 10 MB, over 25 MB for the mail together, or a file type the upload policy refuses): shown as a note.
- `automated: true` for auto-replies, bounces, newsletters and no-reply senders: stored, never fed to flows, keyword replies or routing.

A reply is the existing inbox send (`POST /v2/inbox/conversations/:id/messages`) with the optional extras `email: { cc, bcc, subject, bodyHtml?, attachmentIds?, signatureId?, signature? }` (`bodyHtml` is the composer's rich body; `body` stays the plain-text reading of it). It leaves through
Gmail as an RFC 5322 message under the mailbox's own address and name, with `In-Reply-To`, `References`, the subject (`Re: <subject>` unless
overridden) and the Gmail thread id. The send is idempotent on the message's `clientMessageId`.

## Bounces, loop protection and send limits (TW-MAIL-032)

Applies to every provider (Gmail, Microsoft 365, IMAP/SMTP): the ingest shows each incoming mail to the bounce handler before it is stored.

**Delivery-status notifications.** A mail is a bounce when it is an RFC 3464 report (`multipart/report; report-type=delivery-status`, a `message/delivery-status`
part), a MAILER-DAEMON / postmaster notice with a readable failure (Postfix, Exim, the Gmail "Delivery Status Notification", the Microsoft "Undeliverable" NDR), or
carries `X-Failed-Recipients`, and a failed recipient can be read from it. The status decides the kind: `5.x.x` or SMTP 5xx is **hard**, `4.x.x`, 4xx or
`Action: delayed` is **soft**. An out-of-office from a person, a newsletter or a no-reply notice is not a bounce (it stays an `automated` mail).

A bounce is **never** a conversation, a message, an unread count or a notification of its own, and no listener (flow, routing, auto answer) sees it. It is
applied to the reply it is about, found by the Message-ID in the returned original (the reply's id is `tw.<client message id>@<domain>`), else the id named in
`In-Reply-To` / `References` (the newest reply of that thread sent within 14 days). A bounce that names no mail of the mailbox is dropped and logged.

On the sent message (`messages.meta.email`): `delivery: 'bounced'` and `bounce: { kind, reason, failedRecipient }` (reason is the server's diagnostic, at most 300
characters). The message `status` stays `sent` (the provider accepted it). The thread also gets a system line ("Not delivered to x: reason", or "Delivery to x is
delayed: reason" for a soft one; `meta.event = 'email_bounce'`), the open thread is told over realtime (`message.new` with the changed message), and the person
who wrote the reply gets a bell notification (type `email_bounced`; outbox event `email.message_bounced`). Redelivery is idempotent per message, recipient and kind.

After a **hard** bounce the address is refused for `MAIL_BOUNCE_BLOCK_DAYS` (7): a reply to it ends `failed` with code `MAIL_RECIPIENT_BOUNCED` (Redis flag
`mail:bounced:<org>:<address>`), and the contact's email identity is set to `verified = false` (the least invasive contact field; no schema change).

**Loop protection.** `automated` (stored on the message) covers `Auto-Submitted` other than `no`, `Precedence: bulk|list|junk|auto_reply`,
`X-Auto-Response-Suppress`, `List-Id` / `List-Unsubscribe`, an empty return path, bounces, daemons and no-reply senders; such mail never reaches a listener. Mail we send
without a person behind it (an automation: no `sentBy`) carries `Auto-Submitted: auto-generated`, so the other side never auto-answers it.

**Send limits** (Redis sliding windows; Redis errors fail open):

| Limit                         | Default                                | Setting                                                            | When over                                                                 |
| ----------------------------- | -------------------------------------- | ------------------------------------------------------------------ | ------------------------------------------------------------------------- |
| Sends per mailbox per hour    | `MAIL_SEND_LIMIT_PER_HOUR` (100)       | `PATCH /v2/email/mailboxes/:id` `sendLimitPerHour` (1..10000/null) | message fails `MAIL_RATE_LIMITED`, reason says how long; **Retry** button |
| Mails to one address (burst)  | 5 per 60 s (`MAIL_RECIPIENT_BURST_*`)  | env                                                                | `MAIL_RATE_LIMITED`, retryable (the send queue waits `retryAfterMs`)      |
| Mails from one sender (flood) | 30 per 10 min (`MAIL_INBOUND_FLOOD_*`) | env                                                                | stored as `automated` and quiet: no unread, no alert, no listener         |

Gmail's own daily cap is not predicted: it comes back from the driver as a refused send. Sync jobs retry with exponential backoff and 50 % jitter.

## IMAP / SMTP mailboxes (TW-MAIL-031)

`POST /email/mailboxes/connect-imap` (`mail.mailboxes.manage`) takes `{ scope, address, displayName, imap: { host, port, security, username, password }, smtp: { host, port, security, username?, password? }, mailboxId? }`
(`security` is `ssl`, `starttls` or `none`; an SMTP username and password left out reuse the IMAP ones; `mailboxId` re-enters the password of an existing mailbox).
**Both logins are proven before anything is stored**: IMAP first (login and open the INBOX), then SMTP. A failure is a 422 and nothing is saved:

| Code                       | Meaning                                                                                                                                                  |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `MAIL_IMAP_AUTH_FAILED`    | the IMAP server refused the username or password                                                                                                         |
| `MAIL_SMTP_AUTH_FAILED`    | IMAP was fine; the SMTP server refused the login                                                                                                         |
| `MAIL_IMAP_CONNECT_FAILED` | a server did not answer, its certificate could not be verified, or the address is not allowed (private network); the message says which of IMAP and SMTP |

The password is sealed in `connection_enc` and never returned or logged; the hub gets the non-secret summary (`imap: { host, port, security, username, smtpHost, ... }`).
TLS certificates are always validated (no insecure option); `starttls` is required, never silently dropped to plain text.

**SSRF guard.** The host is resolved by the platform, every answer is checked (private, loopback, link-local, carrier NAT, metadata `169.254.169.254`, IPv6 unique-local and
IPv4-mapped forms) and the connection goes to the checked IP with the typed name as the TLS server name, so DNS rebinding cannot reach a private address. A self-hosted
install whose mail server is on its private network sets `MAIL_IMAP_ALLOW_PRIVATE_HOSTS=true`.

**Sync.** The worker reads the INBOX by UID (`sync_cursor` = `{ uidValidity, lastUid, quietUntil?, quietMode? }`). The first run reads the last `MAIL_BACKFILL_DAYS` days quietly
(`quietUntil` keeps later batches of the same history quiet); a changed `UIDVALIDITY` triggers a quiet repair resync. Drafts (`\Draft`), deleted (`\Deleted`) and junk
(`$Junk`, `Junk`, `$Spam`) mail is skipped; other folders (Sent, Spam, Trash) are not read. The ledger key of a message is derived from its Message-ID (not its UID), so the repair
after a UIDVALIDITY change, a moved mail or a redelivery never stores a message twice. The thread key comes from `resolveThreadKey` (References root, or the stored ancestor).
Attachments up to 256 KB travel with the batch; bigger ones are downloaded again (a new connection) only when the ingest stores them. A message above `MAIL_IMAP_MAX_MESSAGE_BYTES`
(40 MB) is not downloaded and counted as failed. Env: `MAIL_IMAP_ALLOW_PRIVATE_HOSTS`, `MAIL_IMAP_TIMEOUT_MS` (20 s), `MAIL_IMAP_MAX_MESSAGE_BYTES`.

**Send.** The reply is built with the same MIME as Gmail's (html, attachments, threading headers) and submitted over SMTP; Bcc recipients are in the SMTP envelope only, never in a header.
A retry (`attempt > 1`) first looks for the Message-ID in the server's `\Sent` folder (when it has one) before sending again. The reply is not copied to the server's Sent folder by
the platform (most SMTP servers keep a copy only when the client does it; the thread in the inbox is the record). A refused password at sync time marks the mailbox `needs_reauth`
(hub: "Reconnect", which re-enters the password through `mailboxId`). Not run live against Google, Microsoft or hosted providers; verified against GreenMail (see the e2e).

## Gmail push (TW-MAIL-033)

`POST /v2/public/email/google/push` (public; no tenant; not in OpenAPI). Credential: `Authorization: Bearer <Google OIDC ID token>` from the Pub/Sub push subscription, verified
before the body is read: RS256 against Google's JWKS (cached per `Cache-Control`, re-read at most every 30 s on an unknown `kid`), `iss` accounts.google.com, `aud` = the
configured audience, `email` = the configured service account, `email_verified`, `exp`. Not configured, or anything fails: `401`, empty body. Otherwise `204`, empty body, always
(unknown address, stale history id, malformed envelope are acknowledged and ignored so Pub/Sub does not redeliver).

Body (Pub/Sub envelope): `{ "message": { "data": base64({ "emailAddress", "historyId" }) } }`. Every CONNECTED google mailbox with that address (any workspace holding the
add-on) whose `sync_cursor.historyId` is behind `historyId` gets a `mail-sync` job (job id `mail-sync-<mailboxUuid>`: bursts collapse).

Watches: the worker's push sweep (every 2 minutes) calls `users.watch` (labelIds INBOX) for connected google mailboxes without one and renews those with less than 24 h left,
storing `push_state = { kind: 'gmail-watch', id: null, historyId, expiresAt }`; `MailboxResponse.pushActive` is `push_state != null`. Disconnect calls `users.stop`; a
mailbox that needs reconnecting, push switched off, or a watch that ran out clears the state. Polling skips a push-active mailbox synced within `MAIL_PUSH_RECONCILE_MINUTES`.

Platform settings (`googleMail` group): `pubsubTopic`, `pushAudience` (default `<APP_URL>/v2/public/email/google/push`), `pushServiceAccount`; env fallbacks
`GOOGLE_MAIL_PUBSUB_TOPIC`, `GOOGLE_MAIL_PUSH_AUDIENCE`, `GOOGLE_MAIL_PUSH_SERVICE_ACCOUNT`; `GOOGLE_OIDC_JWKS_URL` (tests). Setup: `docs/runbooks/google-mail-setup.md` section 7.

## Microsoft 365 / Outlook (TW-MAIL-034)

Provider `microsoft` (hub label "Microsoft 365 / Outlook"), through Microsoft Graph v1.0. Setup for the operator: [../runbooks/microsoft-mail-setup.md](../runbooks/microsoft-mail-setup.md).

- Connect: `POST /v2/email/mailboxes/connect` with `{ provider: 'microsoft', scope, returnTo, mailboxId? }` returns `{ authorizeUrl }` on `login.microsoftonline.com/<tenant>/oauth2/v2.0/authorize`
  (scopes `openid email offline_access Mail.Read Mail.Send User.Read`; `prompt=select_account`, or `login_hint` on a reconnect). The browser comes back to the public
  `GET /v2/public/email/microsoft/callback` (signed state that names the provider: a Google state is refused there and the other way round) and is redirected to the page it came from with
  `?email=connected|denied|missing_scope|limit|not_configured|wrong_account|failed`, like Google. The account is read from `/me` (address = `mail`, else the sign-in name; stable id = the directory object id).
- Platform credentials: operator settings group `microsoftMail` (`enabled`, `clientId`, `tenant`, `redirectUri`, secret `clientSecret`), env fallback `MICROSOFT_MAIL_CLIENT_ID`, `_CLIENT_SECRET`, `_TENANT`, `_REDIRECT_URI`.
  `GET /v2/email/providers` shows `ready: false` with a reason until a client id and secret exist.
- Sync: delta query of the Inbox. Cursor `{ deltaLink }`, or `{ nextLink, phase }` while a round has more pages than one run reads. First run: the last `MAIL_BACKFILL_DAYS` days (a `receivedDateTime` filter), quiet. A dead delta token
  (410) repairs quietly. Junk, Deleted Items and Sent Items are not in the Inbox delta; drafts and mail from the mailbox itself are skipped. Thread key = `c:<conversationId>` (hashed when long).
  Message ids are Graph immutable ids. Attachments: metadata first, bytes lazily (`/attachments/{id}/$value`; an attached message is kept as `.eml`, a cloud link has no bytes); inline images carry their `contentId`.
- Send: the preparer's `OutgoingMail` becomes a Graph draft. With `inReplyTo`, `createReply` of the stored original (Exchange writes In-Reply-To and References), then PATCH with our subject, body (html, else text),
  recipients and Message-ID; without an original the draft is a new message (Graph refuses non-`x-` headers, so only `x-*` headers are sent; others such as `Auto-Submitted` cannot be set through Graph).
  Attachments up to 3 MB inline, larger through an upload session; the draft is then sent. On `attempt > 1` Sent Items is searched for the Message-ID first (and a leftover draft removed).
- Errors become `MailDriverError` with our wording: 401 -> token rejected (refresh once); `invalid_grant`, `interaction_required` and the AADSTS families 50173, 70008, 700082, 65001, 50076, 53003 ... -> `reauth`; wrong or expired
  platform secret (AADSTS7000215, 7000222, 700016, 50194) -> `not_configured` (the mailbox is NOT marked needs reauth); 429 / `ApplicationThrottled` -> `rate_limit` carrying `retryAfterSeconds`; 5xx -> transient;
  `MailboxNotEnabledForRESTAPI` -> forbidden ("no Exchange Online mailbox"); 413 -> too large.
- Refresh tokens rotate: `MailOAuthRefreshed.refreshToken` is stored in place of the old one. Disconnect only forgets the tokens (Microsoft has no per-token revoke).
- Tests: `test/unit/channel-email/microsoft-mail.spec.ts`, `test/e2e/channel-email/microsoft-mail.e2e.spec.ts` (a fake Microsoft written from the documentation, `fake-graph.ts`). **Not run against a real tenant.**

## Outbound attachments, signatures and the rich composer (TW-MAIL-027)

- `POST /v2/email/attachments/upload` (multipart field `file`, optional field `conversationId`; `inbox.conversation.reply`, plan feature `email_channel`) stages one file for the uploader and answers 201
  `{ id, name, mime, size, expiresAt }`. The type is decided from the content by the object store's upload policy (never the browser's Content-Type; executables are refused, 422 `AUTH_UPLOAD_REJECTED`); caps
  `MAIL_OUTBOUND_ATTACHMENT_MAX_BYTES` (10 MB; 413 `MAIL_ATTACHMENT_TOO_LARGE`), mime lists `MAIL_OUTBOUND_ATTACHMENT_ALLOW_MIME` / `_DENY_MIME` (comma separated, `type/*`; deny wins); the file expires after
  `MAIL_OUTBOUND_ATTACHMENT_TTL_HOURS` (24). A `conversationId` must be an email conversation the caller may see (404 otherwise). `DELETE /v2/email/attachments/:id` (204) takes back your own unsent file; anyone else's is a 404.
  **Antivirus hook:** `MailAttachmentScanner.scan` runs before the file is stored (default accepts); replace its body with ClamAV or a scanning API. A scanner that throws fails the upload.
- A reply names its files in `email.attachmentIds` (<= `MAIL_OUTBOUND_ATTACHMENTS_MAX_COUNT`, 10) and may carry `bodyHtml` (the composer's HTML). Checked when the reply is SENT (the message ends `failed` with the code and
  our wording, nothing goes out): an id that is not the sender's own unsent, unexpired upload is `MAIL_ATTACHMENT_NOT_FOUND`; too many files `MAIL_TOO_MANY_ATTACHMENTS`; over the per-file or the
  `MAIL_OUTBOUND_ATTACHMENTS_TOTAL_MAX_BYTES` (20 MB) total `MAIL_ATTACHMENT_TOO_LARGE`. A file is sent once (marked used after the provider accepted the mail); a retry of the same message may reuse it.
- Rich body: `bodyHtml` is sanitised server-side with an email allow-list (formatting, lists, quotes, links; no images, styles, scripts, forms, frames, event handlers or `javascript:`), the text part is derived from it.
- Signatures `/v2/email/signatures`: `GET` (`mail.mailboxes.read`; the mailboxes' signatures you can see plus your own user signatures, never another person's; `?mailboxId=&scope=`), `POST` (201), `PATCH :id`
  (`rowVersion`, 409 otherwise), `DELETE :id` (204), all writes `mail.signatures.manage`; a `mailbox` signature also needs `mail.mailboxes.manage` on a shared mailbox (the owner manages a personal one); another
  person's user signature is a 404. HTML sanitised on write, `bodyText` derived when empty, one default per mailbox and per user (making one the default clears the other). Audited (module `mail_signatures`).
- Which signature a reply gets: `signatureId` (must be the mailbox's own or the sender's own, else `MAIL_SIGNATURE_NOT_FOUND`) -> the sender's default user signature -> the mailbox's default -> none; `signature: false` none.
  A send by automation (no sender) only uses the mailbox default. Variables `{{name}}` (profile display name, else full name), `{{title}}` (`users.settings.jobTitle`, empty when unset: the product has no job-title field yet) and
  `{{phone}}` (profile phone) are filled from the sending user. Merge: text after a `-- ` line, HTML in its own block after a `--` line.
- After a successful send the outbound message's `meta.email` records what went out (recipients, final sanitised HTML, attachments as `{id, name, mime, size}`, `delivery: 'sent'`), so the thread shows the files and the
  existing `GET /v2/email/attachments/:conversationId/:messageId/:attachmentId` serves them under the same visibility rule as any message. Mechanism: `SendResult.meta` (new, optional) is merged into the message's `meta` by `markSent`.
- Cleanup: the worker sweep `MailOutboundAttachmentsSweep` (every 15 min) deletes unsent files an hour past their expiry (row and object); used files are kept.
- Driver contract: every driver must send `OutgoingMail.html` and the BYTES of `attachments` (`bytes`, already read by the preparer). Google (buildMime) does; IMAP/SMTP uses `buildMime` too; a JSON API (Graph) maps them itself.
  Reusable check: `test/unit/channel-email/driver-send-contract.ts` (`outgoingWithFiles()`, `expectMimeCarries(raw, mail)`).
- Tests: `test/unit/channel-email/outbound-html.spec.ts`, `mail-outbound-preparer.spec.ts`; `test/e2e/channel-email/outbound-attachments.e2e.spec.ts` (fake Gmail; **not run against real Gmail, IMAP or Graph**).

## Personal mailboxes and the email sharing policy (TW-MAIL-035)

Deviation from Reference (every linked mailbox there is workspace-wide): a member can connect a **personal** mailbox whose conversations only they can see.

- Policy `GET` / `PUT` (`PATCH` accepted, same body) `/v2/email/settings` -> `{ personalMailboxesEnabled, whoMayConnectPersonal: 'admins'|'agents', adminsCanReadPersonal, rowVersion }`. Reading: `mail.mailboxes.read`,
  `mail.mailboxes.manage_personal` or `mail.settings.manage` (the hub needs it to offer Connect). Writing: `mail.settings.manage` (Admin), `rowVersion` required (0 = never saved; 409 `ROW_VERSION_CONFLICT`), audited
  (module `mail_workspace_settings`) and announced (`mail.settings.updated`). Defaults: off, admins, no. Withdrawing `adminsCanReadPersonal` takes admins out of any personal conversation room they had open.
- Connect `scope: 'personal'` (`POST /email/mailboxes/connect`, `/connect-imap`, any provider): 422 `MAIL_PERSONAL_DISABLED` while the policy is off; 403 `MAIL_PERSONAL_NOT_ALLOWED` when `whoMayConnectPersonal` is `admins` and the caller
  is not an admin (holds `mail.settings.manage`), or is `agents` and the caller lacks `mail.mailboxes.manage_personal`. Shared still needs `mail.mailboxes.manage`. The owner is the connecting user; it counts toward `email_mailboxes`
  (a disconnected one does not). The callback re-checks the right (it may have been lost on the provider's screens). An address held by someone else's personal mailbox is never taken over (`wrong_account`).
  Routes accept `mail.mailboxes.manage` OR `mail.mailboxes.manage_personal` (Agents and Managers hold only the second); the service decides by scope.
- List (`GET /email/mailboxes`): shared mailboxes plus your own personal ones. An admin also gets other people's personal mailboxes as **summary rows** (`contentHidden: true`: address, owner, provider, status; no conversation
  count, error text, server settings or inbox filter), or in full while `adminsCanReadPersonal`. Everyone else never learns they exist (404 on its id). `used` is the plan's count, hidden rows included.
- Acting: rename, sync, reconnect = the owner only (and only while they still hold `manage_personal`; reconnect keeps working after the policy is switched off). Disconnect = the owner, or any admin (offboarding; it never
  grants reading). Shared mailboxes: `mail.mailboxes.manage`. A mailbox you may not see is a 404, one you see but may not act on a 403.
- **Inbox visibility (the critical part).** A conversation on a personal mailbox's channel is visible to its owner only (whatever their assignment scope, provided they may read the inbox), and to an admin only while
  `adminsCanReadPersonal` (then by the admin's normal scope). One rule in two forms, kept in step by tests: `conversationVisible` (`realtime/audience/conversation-visibility.ts`, `ConversationRecord.channelOwnerUserId`
  is REQUIRED so a new caller cannot forget it) and `visibleToSql` (`team-inbox-conversations/visibility-sql.ts`). The channel -> owner mapping is a JOIN, not a flag: `channelOwnerSql` /
  `channelRowOwnerSql` (`realtime/audience/channel-owner.ts`) resolve `channels(kind='email', external_id = mailbox uuid)` -> `mail_mailboxes.scope/owner_user_id` at read time, so it cannot drift; an email channel whose mailbox row is
  gone (owner deleted, FK cascade) resolves to owner -1 (fails closed). "Admin" = holds `mail.settings.manage`; the policy bit is read fresh on every decision (`MemberDirectory`, `InboxAccess`), never cached.
- Paths covered: inbox list, counts, search, detail, thread, notes, events, reply, resolve, read (all through `InboxAccess`/`visibleToSql`); the attachment route and media links (`EmailMessageAccess`, `MessageMediaAccessPolicy`);
  realtime room join and every audience (`RoomAccessService`, `AudienceResolver`, `MemberDirectory.viewers`); notifications and the waiting nudge (reader filter); `GET /v2/channels` (a personal channel is not listed);
  assignment (target must be able to open it, 422 otherwise) and routing rules (never route personal mail); the dashboard inbox widgets and top contacts / events panels, the developer REST v1 messaging reads and the
  workspace export (personal mail is excluded outright: they are not people).
- Tests: `test/unit/realtime/conversation-visibility.spec.ts`, `test/unit/channel-email/mail-personal-policy.spec.ts`, and the matrix `test/e2e/channel-email/personal-mailboxes.e2e.spec.ts` (owner, agent, no-permission
  agent, admin with the policy off and on, another workspace, across list, counts, search, detail, messages, notes, events, attachments, channel list, realtime rooms and events, notifications, assignment, owner removal).

## Campaigns by email (TW-CAMP-028, the email half)

A mailbox is also an **engine** for campaigns: a campaign whose `senderKey` is `email:<mailbox uuid>` is sent through the mailbox (Gmail, Microsoft or IMAP/SMTP) by `EmailEngineSender`,
with the mailbox's own limits (`MailSendGuard`: the bounce list and the hourly cap), the consent gate and the signed unsubscribe link, and each mail is written into the mailbox's inbox thread.
The plan limit `email_monthly` (mails sent in a calendar month, replies and campaign mail together, 0 = unlimited) is new. The whole behaviour is documented in [campaigns.md](campaigns.md#email-campaigns).
