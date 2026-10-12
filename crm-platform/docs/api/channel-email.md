# Email channel API (Gmail)

Everything is under `/v2`, signed in as a user. A mailbox is addressed by its uuid. No response ever carries a token, a scope list or the sync
cursor. The Email channel is the paid add-on **Email (Gmail)** (plan feature `email_channel`, limit `email_mailboxes`); the platform operator
gives the platform a Google OAuth client first ([runbooks/google-mail-setup.md](../runbooks/google-mail-setup.md)).

Gates, in this order on every mailbox route: sign-in, the permission, the plan feature `email_channel` (422 `PLAN_FEATURE_LOCKED` on every route,
reads included), then the body is validated. The public OAuth callback and the attachment download are the two exceptions (below).

## Mailboxes (TW-MAIL-019 to 023, 028)

| Method and path                     | Permission              | What it does                                                                                          |
| ----------------------------------- | ----------------------- | ----------------------------------------------------------------------------------------------------- |
| `GET /email/mailboxes`              | `mail.mailboxes.read`   | The workspace's mailboxes (disconnected ones included), the plan limit, use and `providerReady`       |
| `POST /email/mailboxes/connect`     | `mail.mailboxes.manage` | Start the Google consent. Returns `{ authorizeUrl }`. 200                                             |
| `GET /public/email/google/callback` | public (signed state)   | Google's redirect. Always a 302 to the web app with `?email=<outcome>`                                |
| `PATCH /email/mailboxes/:id`        | `mail.mailboxes.manage` | Rename `{ displayName, rowVersion }`; 409 `ROW_VERSION_CONFLICT` on a stale version                   |
| `POST /email/mailboxes/:id/sync`    | `mail.mailboxes.manage` | Queue a sync now. 202 with the mailbox. 409 `MAIL_MAILBOX_UNAVAILABLE` if disconnected / needs reauth |
| `DELETE /email/mailboxes/:id`       | `mail.mailboxes.manage` | Disconnect (revoke at Google, wipe tokens, keep the conversations). 204, idempotent                   |

Idempotency-Key is required on `PATCH` and `DELETE`.

### A mailbox

```json
{
  "id": "0d2c0d58-6f1c-4a0c-a0a8-8f3d5f0a8e11",
  "provider": "google",
  "address": "support@acme.com",
  "displayName": "Acme Support",
  "status": "connected",
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

| Outcome          | Meaning                                                                                                   |
| ---------------- | --------------------------------------------------------------------------------------------------------- |
| `connected`      | Stored (new mailbox or the same address reconnected). The first sync is queued.                           |
| `denied`         | The person pressed Cancel on Google's screen.                                                             |
| `missing_scope`  | They unticked read or send access. The grant is withdrawn, nothing stored.                                |
| `limit`          | The plan's mailbox limit is reached. The grant is withdrawn.                                              |
| `not_configured` | The platform has no Google client (switched off meanwhile).                                               |
| `wrong_account`  | Reconnecting a mailbox but signed in with another Google account. Nothing changes.                        |
| `failed`         | Anything else: a state that does not verify or has expired (10 minutes), no refresh token, add-on lapsed. |

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
attachment must be listed in its `meta.email.attachments` (the id is never trusted as a key). Every refusal is the same 404; a lapsed add-on does
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

A reply is the existing inbox send (`POST /v2/inbox/conversations/:id/messages`) with the optional extras `email: { cc, bcc, subject }`. It leaves through
Gmail as an RFC 5322 message under the mailbox's own address and name, with `In-Reply-To`, `References`, the subject (`Re: <subject>` unless
overridden) and the Gmail thread id. The send is idempotent on the message's `clientMessageId`.
