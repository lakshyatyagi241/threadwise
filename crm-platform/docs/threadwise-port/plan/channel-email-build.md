# channel-email build plan (Gmail, multi-mailbox, as an add-on)

Spec: `inventory/channel-email.md` (TW-MAIL-019..030 are what this build delivers; 001..018 are Reference's MailTrixy bridge, NOT ported) and
`docs/specs/email-channel-and-social-leads.md`. Contracts already written and built: `packages/contracts/src/channel-email/{mailbox,email-meta}.ts`,
`CHANNEL_KINDS` has `'email'`, error codes `MAIL_*`.

## Scope of this build
Gmail / Google Workspace only (OAuth popup, Gmail API). Several mailboxes per workspace (plan limit `email_mailboxes`, default 3). Each mailbox is one inbox
channel (`kind='email'`, one per mailbox) so the inbox shows several inboxes through its existing channel list/filter. Shipped as a paid first-party Marketplace
add-on (the Forms model): plan feature `email_channel` (default false), listing slug `email`.
NOT in this build: IMAP/SMTP (TW-MAIL-031), Microsoft (034), personal mailboxes (035), Gmail push (033), outbound attachments, signatures, MailTrixy bridge.

## Decisions
1. Native Gmail, no MailTrixy client. `workspace_email_accounts` is left untouched; new table `mail_mailboxes`.
2. One conversation per Gmail thread: `peer_key = 't:' + gmail threadId`; conversation title = first subject (never overwritten); contact linked by the sender's email
   identity (shared seam below). A reply on a resolved thread reopens it (existing inbound behaviour).
3. Sync: a sweep every 60 s enqueues one BullMQ job per connected mailbox; Gmail `users.history.list` from the stored `history_id`, fall back to `messages.list`
   (newer_than:7d, labels INBOX) on 404/no history. Initial backfill of 7 days is stored quietly (`history`), no notifications. Idempotent on the Gmail message id
   (ledger). Spam/trash/drafts and our own sent mail are skipped; `Auto-Submitted`/`Precedence: bulk|list` mail is stored with `automated: true`.
4. Send: reply built as RFC 5322 with nodemailer's MailComposer (`In-Reply-To`, `References`, subject `Re: ...`, cc/bcc), sent with Gmail `users.messages.send`
   with `threadId`. Idempotent on `clientReference`.
5. Credentials: platform settings group `googleMail` (clientId, redirectUri, sealed clientSecret, enabled) with env fallback `GOOGLE_MAIL_CLIENT_ID/SECRET/REDIRECT_URI`;
   a separate Google OAuth client from Calendar because the Gmail restricted scopes need Google verification. Scopes: `openid email gmail.readonly gmail.send`.
   Signed OAuth state with its own purpose string (copy the Calendar pattern; extract a shared helper only if it stays small). Tokens sealed with CryptoService.
6. Disconnect keeps the conversations (channel -> disconnected, read-only), a reconnect of the same address reattaches (deviation from Reference, recorded).
7. Emails are not metered against the message cap/wallet (`metered:false`); own limit `email_mailboxes`.
8. Gating: controllers `@RequirePlanFeature('email_channel')`; adapter send and the sync job also refuse when the feature is lost (lapse keeps data, closes sending/sync);
   web `gates.app = 'email_channel'`. Permissions `mail.mailboxes.read` / `mail.mailboxes.manage` (replying uses the existing inbox reply permission).

## Shared seam contract (inbox core, owned by agent "inbox seams"; the mail module and the web are written against it)
- `NormalisedInbound` gains optional `title?: string` (conversation title on create only) and `contactIdentity?: { kind: 'email'; value: string; name?: string }`
  (link/create the contact by email identity; `linkContact` uses it instead of `identityOfPeer(peerKey)`); `meta.email` (EmailMeta) is accepted through
  `CHANNEL_META_KEYS` with the meta cap raised for email only. `peer-key.ts`: kind `email` keeps the key as given (`t:<threadId>`), no phone rules.
- `message.ts` send schema gains optional `email: emailReplyExtrasSchema`; `openConversationFor` still refuses email (a thread starts from a customer mail).
- Outbound: `outboundEnvelopeSchema` text variant gains optional `email?: { to: string[]; cc: string[]; bcc: string[]; subject: string; inReplyTo: string|null;
  references: string[]; threadId: string }`, built in message-dispatch `prepare()` from the conversation + the newest inbound message's `meta.email` + the reply extras.
  Outbound text limit for email raised (4096 -> 100000 for kind email only). The adapter gets body text; HTML is the escaped text with `<br>`.
- Attachments inbound: stored in the object store, listed in `meta.email.attachments`, downloaded through `GET /v2/email/attachments/:conversationId/:messageId/:attachmentId`
  (permission = can read the conversation). No new message kinds.
- Lifecycle/visibility/notifications work unchanged (sender name from `peer_name` = sender display name or address).

## API surface (module `channel-email`, all `@RequirePlanFeature('email_channel')`)
- `GET /v2/email/mailboxes` -> MailboxListResponse (`mail.mailboxes.read`)
- `POST /v2/email/mailboxes/connect` (startMailboxConnectSchema) -> `{authorizeUrl}` (`mail.mailboxes.manage`)
- `GET /v2/public/email/google/callback` (public, redirects to `<web>/<returnTo>?email=<MailConnectOutcome>`)
- `PATCH /v2/email/mailboxes/:id` (updateMailboxSchema), `POST /v2/email/mailboxes/:id/sync` (sync now, 202), `DELETE /v2/email/mailboxes/:id`
- Operator: `googleMail` settings group in the console (no custom controller).

## Work split
1. inbox seams (api, chat-conversations + contracts message/channels) 2. channel-email module + db + provider (api) 3. add-on packaging (plan catalogue, marketplace listing,
   permissions migration, settings group, seed, runbook) 4. web (hub /email, tile, inbox rendering + composer extras, i18n 21, help).
