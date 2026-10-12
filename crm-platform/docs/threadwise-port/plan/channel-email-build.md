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

## Seam signatures (as built)

All in `apps/api` unless noted. Import from the module barrels (`modules/chat-conversations`, `infra/providers/chat-conversations`).

**Adapter port** (`infra/providers/chat-conversations/channel.port.ts`)

- `NormalisedInbound` gains `title?: string` (conversation title on create only, trimmed to 200, never overwritten) and
  `contactIdentity?: { kind: 'email'; value: string; name?: string }` (value is lower-cased by the contacts service; `name` wins over `peerName` for the new contact).
  Both are also in `channelIngestJob`'s zod schema (`channel-ingest.job.ts`), so they survive the queue.
- Email messages: `peerKey = 't:<threadId>'` (kept exactly as given, <= 128, no lower-casing); `peerName` = sender display name or address; `kind: 'text'`;
  `body` = plain text; `meta: { email: EmailMeta }`; `providerMessageId` = the Gmail message id (the ledger key, so redelivery is a no-op).
- `outboundEnvelopeSchema` text variant gains `email?: OutboundEmail` where
  `OutboundEmail = { to: string[] (1..20); cc: string[]; bcc: string[]; subject: string; inReplyTo: string | null; references: string[]; threadId: string }`
  (`outboundEmailSchema` / `type OutboundEmail`). `envelope.to` stays the peer key (`t:<threadId>`): the recipients are `envelope.email.to`.
  Body limit: `OUTBOUND_TEXT_MAX_EMAIL = 100_000`, `outboundTextMaxFor(kind)`. The dispatcher refuses a longer body on any other kind (VALIDATION_FAILED, path `body`),
  refuses `envelope.email` on a non-email channel (CHANNEL_CAPABILITY_UNSUPPORTED), and in `send()` refuses an email text envelope that has no `email` block
  (a thread with no mail to answer: VALIDATION_FAILED, non-retryable).
- The adapter must report `windowHours: null` (then `windowInfo` = `windowFromLastInbound(null, ...)`, always open), `templates: false`, `media: []`, `reactions: false`,
  `receipts: ['sent']`. `normalizeSettings('email', ...)` forces `{ metered: false }` whatever is stored, so no monthly cap or wallet applies.
- The adapter gets the REPLY BODY as typed (plain text, `envelope.body`); building the HTML (escaped text + `<br>`) is the adapter's job.

**Message meta** (`modules/chat-conversations/message-rules.ts`)

- `channelMetaOf(meta, kind?)`: the `email` key is accepted only when `kind === 'email'` (ingest passes the channel kind); it is validated with `emailMetaSchema`
  (unknown keys stripped, malformed block dropped), budgeted at `EMAIL_META_MAX_BYTES = 131_072` characters of JSON on its own, trimmed in steps when over
  (html first -> `html: null, htmlTruncated: true`, then address/reference lists to 20, then attachments to 20, else dropped). Other keys keep the 16K cap.
  `emailMetaOf(raw): EmailMeta | null` is exported for the module.
- `MessageResponse.email` (contracts, already added) is filled from `meta.email` on read.

**Send** (contracts `chat-conversations/message.ts`)

- `sendMessageSchema` text variant: `email?: EmailReplyExtras`; body max is `MESSAGE_BODY_MAX_EMAIL = 100_000` in the schema, `messageBodyMaxFor(kind)` is the per-kind rule.
  Server rules: `email` extras on a non-email conversation -> 422 `CHANNEL_CAPABILITY_UNSUPPORTED` (path `email`; 422 like every other capability refusal, not 400);
  body over 4096 on a non-email conversation -> 422 `VALIDATION_FAILED` (as before).
- `OutboundContent` text: `{ kind: 'text'; body: string; email?: EmailReplyExtras }`. The extras are stored on the queued message at `meta.emailReply = { cc, bcc, subject? }`
  (only when something is set), so a retry / the recovery sweep re-send the same cc, bcc and subject.
- `message-dispatch.service prepare()` builds the `email` block for channels of kind `email` (text messages) with `emailEnvelopeOf(newestInboundEmailMeta, meta.emailReply, threadIdOfPeerKey(peerKey))`
  (`outbound-envelope.ts`): `to = [from.address]` of the newest PERSON-sent mail (automated mail only if there is no other), `subject = extras.subject ?? 'Re: ' + original` (no double `Re:`),
  `inReplyTo = that mail's messageId`, `references = its references + its messageId` (deduped, capped at 100 keeping the first), `threadId = meta.email.threadId`.
  Repository: `MessagesRepository.latestInboundEmailMeta(tx, orgId, conversationId)`.
- Idempotency is unchanged: `clientReference = clientMessageId`, the dispatcher's 24 h Redis answer + the `client_id` ledger.

**Hooks** (`inbound-hooks.ts`)

- `InboundMessageListener.runsOnEmail?: true`: on a channel of kind `email` a listener is SKIPPED unless it sets this (flows, FAQ, concierge, commerce never run on email).
  Set on `team-inbox-routing` and `i18n-translation`. A message whose `meta.email.automated === true` reaches no listener at all (`run` returns `{ consumed: true }`).
  `isAutomatedEmail(event)` is exported.

**Attachment download seam** (`email-message-access.service.ts`, exported from the barrel)

- `EmailMessageAccess.readable(conversationUuid, messageUuid, actor?: { orgId; userId }): Promise<EmailMessageRef | null>` where
  `EmailMessageRef = { email: EmailMeta; conversationId; conversationUuid; channelId; messageId; messageUuid; messageCreatedAt }`.
  Defaults the actor to the request context. Null (answer 404) when the message is not in that conversation, has no valid `meta.email`, or the actor cannot see the conversation
  (`conversationVisible` with `inbox.conversation.read`). Provided and exported by `ChatConversationsModule`.

**Other kind switches**: `openConversationFor` on an email channel -> `CHANNEL_CAPABILITY_UNSUPPORTED` "An email conversation starts from a customer email...";
`defaultTitle('email', ...)` = sender name else `(no subject)`; notification sender name uses `peer_name` (no change needed); no routing-sla label switch exists in the api.
Test fake: `test/e2e/chat-conversations/fake-email-adapter.ts` (`FakeEmailAdapter`, register with `app.get(ChannelAdapterRegistry).register(adapter)`).
