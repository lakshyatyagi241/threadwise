# channel-email build plan (Gmail, multi-mailbox, as a Marketplace integration)

Spec: `inventory/channel-email.md` (TW-MAIL-019..030 are what this build delivers; 001..018 are Reference's MailTrixy bridge, NOT ported) and
`docs/specs/email-channel-and-social-leads.md`. Contracts already written and built: `packages/contracts/src/channel-email/{mailbox,email-meta}.ts`,
`CHANNEL_KINDS` has `'email'`, error codes `MAIL_*`.

## Scope of this build

Gmail / Google Workspace only (OAuth popup, Gmail API). Several mailboxes per workspace (plan limit `email_mailboxes`, default 3). Each mailbox is one inbox
channel (`kind='email'`, one per mailbox) so the inbox shows several inboxes through its existing channel list/filter. Shipped as a paid first-party Marketplace
**integration** (kind `integration`, category Messaging and email, connector type `client`; the Forms billing model; decision changed from "add-on" by the owner after the first build, migration `20261119120000_mkt_email_integration`): plan feature `email_channel` (default false), listing slug `email`.
Built in a second pass on the same driver port (see 'Phase 2 seams (as built)'): IMAP/SMTP (031), Microsoft 365 (034), Gmail push (033), personal mailboxes (035), outbound attachments, signatures and rich composer (027), bounces and rate limits (032). NOT built: the MailTrixy bridge (Reference only).

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
   web: the Settings tile is in Settings > Integrations with `gates: { permission: 'mail.mailboxes.read', planFeature: 'email_channel' }` (visible but locked with the upgrade mark without the feature, like Shopify and WooCommerce) and a hidden nav entry (`inMenu: false`) so `/email` shows the plan paywall. Permissions `mail.mailboxes.read` / `mail.mailboxes.manage` (replying uses the existing inbox reply permission).

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

1. inbox seams (api, chat-conversations + contracts message/channels) 2. channel-email module + db + provider (api) 3. integration packaging (plan catalogue, marketplace listing,
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

## Phase 2 seams (as built)

Phase A (this section's author) made the module provider-agnostic and landed every shared schema, contract and permission change. The six
Phase 2 builds (IMAP 031, Microsoft 034, Gmail push 033, personal mailboxes 035, attachments + signatures + composer 027, bounces + rate limits 032) code against THIS section only and must not add a migration or a contract of their own (if one is missing, stop and ask the owner).
Paths are relative to `crm-platform/`; `api/` = `apps/api/src`. Decisions: Gmail's `history_id` column became `sync_cursor`; the send limit
counters are Redis (no table); a personal mailbox dies with its owner (FK CASCADE); signatures resolve user -> mailbox (below).

### 1. The driver port (`api/modules/channel-email/drivers/`)

`mail-driver.ts` holds the types; nothing outside a driver branches on a provider name (sync, ingest, adapter, connect, tokens, sweep, disconnect
all go through `MailDriverRegistry`). Types of data live in `api/infra/providers/channel-email/mail-types.ts`.

- `MailDriver = OAuthMailDriver | PasswordMailDriver` (discriminant `authKind: 'oauth' | 'password'`; guards `isOAuthDriver`, `isPasswordDriver`).
- Common (`MailDriverBase`): `provider: MailProvider`, `authKind`, `label` (hub text), `readiness(): Promise<{ ready; notReadyReason }>`
  (platform setup; password providers are always ready), `sync(ctx, cursor, opts): Promise<MailSyncBatch>`,
  `send(ctx, mail: OutgoingMail): Promise<MailSendResult>`, `health(ctx): Promise<{ displayName }>`, optional `push?: MailPushSupport`.
- `MailDriverContext = { orgId; mailbox: MailboxRow; access: MailAccess }`, `MailAccess = { kind: 'oauth'; accessToken } | { kind: 'password'; connection: PasswordConnection }`.
  The token service opens the access; a driver never reads `*_enc` columns.
- `OAuthMailDriver`: `requiredScopes: readonly string[]`, `authorizeUrl({state, loginHint}): Promise<string>` (throws `MailDriverError('not_configured')`),
  `exchange(code): Promise<MailOAuthGrant>` (`{accessToken, refreshToken|null, expiresInSeconds, scopes: string[], extras?}`; `extras` is sealed into
  `connection_enc.extras`), `refresh(refreshToken): Promise<{accessToken, expiresInSeconds}>` (dead grant -> `MailDriverError('reauth')`),
  `revoke(token)`, `profile(accessToken): Promise<MailAccountProfile>` (`{address, sub|null, name|null}`).
- `PasswordMailDriver`: `verify(connection: PasswordConnection): Promise<MailAccountProfile>`; proves BOTH logins before anything is stored.
  Refused password -> `MailDriverError('auth_failed', msg, { providerCode: 'imap' | 'smtp' })`; unreachable / TLS -> `'unreachable'`.
- `MailSyncOptions`: `{ maxMessages, maxPages, backfillDays, isKnown(providerMessageId), knownThreadKeys(messageIds) }` (ledger check, and
  Message-ID -> stored thread key for header threading; env: `MAIL_SYNC_MAX_MESSAGES`, `MAIL_SYNC_MAX_PAGES`, `MAIL_BACKFILL_DAYS`).
- `MailSyncBatch`: `{ messages: NormalisedMail[] (NEW only, OLDEST first), nextCursor: MailCursor | null (null = keep the stored cursor), hasMore, mode:
'backfill'|'repair'|'history', quiet, duplicates, skipped, failed }`. The driver owns cursor meaning, quiet backfill, repair, batch cap and
  skipping what `isKnown` has. The service stores `nextCursor` after the ingest loop (`mail_mailboxes.sync_cursor`, jsonb).
  Cursors: Gmail `{ historyId }`; IMAP suggested `{ uidValidity, lastUid }` per folder; Graph `{ deltaLink }`.
- `send`: when `mail.attempt > 1` first look for `mail.messageId` (an earlier try may have reached the provider) and answer with that message.
- `MailPushSupport` (optional `push` on a driver): `available()`, `start(ctx): Promise<MailPushState | null>` (state is stored in `mail_mailboxes.push_state`
  via `MailboxesRepository.savePushState`), `stop(ctx)`. `MailPushState = { kind; id|null; expiresAt (ISO); ...extra }`. Disconnect already calls `push.stop`.
- `MailDriverError(kind, message, { retryable?, providerCode?, status?, needsReauth? })`, kinds: `reauth | auth_failed | token_rejected | not_configured |
forbidden | missing_scope | rate_limit | transient | unreachable | bad_request | too_large | not_found`. `message` is OUR wording (it is stored in
  `last_error` and shown in the hub): never provider text, never a host or password. Getters `retryable`, `needsReauth`, `providerCode`, `status`.
  Behaviour: sync `reauth` / `auth_failed` -> mailbox `needs_reauth`; retryable -> job retried; otherwise recorded, job ends. `token_rejected` -> the token
  service refreshes once and calls again. Send: retryable -> `ChannelError MAIL_SEND_FAILED`, else `MAIL_SEND_REFUSED` (with `needsReauth`).
- `MailDriverRegistry` (`mail-driver.registry.ts`): `register(driver)`, `has(p)`, `find(p)`, `get(p)` (422 `MAIL_PROVIDER_UNSUPPORTED`), `oauth(p)`, `password(p)`, `list()` (hub order google, microsoft, imap).
  A driver registers itself in its own `onModuleInit` (see `GoogleMailDriver`). To add a provider: write `drivers/<x>-mail.driver.ts`, add its classes to the
  provider's block in `drivers/driver-providers.ts` (`MAIL_DRIVER_PROVIDERS`), nothing else in the module. Unit-test a driver by constructing it with fakes and
  `new MailDriverRegistry()`.
- `GoogleMailDriver` (`google-mail.driver.ts`) is the reference implementation (wraps `GmailClient`, `GoogleMailOAuthClient`, `GoogleMailConfig`; thread key = Gmail `threadId`).
  It already builds the reply with `buildMime` honouring `OutgoingMail.html` and `attachments[].bytes`.

### 2. Data shapes (`api/infra/providers/channel-email/mail-types.ts`, exported from the barrel)

- `NormalisedMail`: `providerMessageId` (ledger key), `threadKey` (<= 128; conversation `peer_key = 't:' + threadKey`, also `meta.email.threadId`), `messageId`, `inReplyTo`,
  `references` (oldest first, no brackets), `from`, `replyTo`, `to`, `cc`, `bcc` (`MailAddress = {name|null, address}`), `subject`, `text`, `html` (RAW, the ingest sanitises),
  `attachments: NormalisedAttachment[]`, `sentAt`, `labels`, `flags`, `automated`, `rawHeaders` (lower-cased subset `RAW_HEADER_KEYS`), `skip: 'draft'|'spam'|'trash'|'sent'|null`.
- `NormalisedAttachment`: `{ partId, name, mime, size, contentId, inline, data: Buffer|null, fetch: (() => Promise<Buffer>)|null }` (bytes inline or lazy; the ingest calls `fetch`, a failure notes the file as not stored).
- `OutgoingMail`: `{ messageId, from: MailAddress, to, cc, bcc, subject, text, html|null, inReplyTo, references, threadKey|null, attachments: OutgoingAttachment[], headers, attempt }`;
  signature already merged; `OutgoingAttachment = { name, mime, bytes: Buffer|null, objectKey: string|null }` (the preparer resolves `objectKey` to `bytes`; drivers read `bytes`).
- `MailAccountProfile`, `PasswordConnection = { imap: MailServerLogin, smtp: MailServerLogin }`, `MailServerLogin = { host, port, security: 'ssl'|'starttls'|'none', username, password }`.
- `resolveThreadKey(input, known?)` (`thread-key.ts`, pure, unit tests `test/unit/channel-email/thread-key.spec.ts`): provider thread id verbatim -> Graph `conversationId` as `c:<id>` (hashed if long) ->
  known ancestor's key (`known` = Message-ID -> stored key) -> `m:<sha256(root Message-ID)[0..40]>` with root = `References[0] ?? In-Reply-To ?? Message-ID`. Subjects never merge threads.
  IMAP: call it with the headers; ask `opts.knownThreadKeys` only for a reply that has `In-Reply-To` but no `References`. Graph: pass `conversationId`.
- `gmail-normalise.ts` (`normaliseGmailMessage`) and `mime-build.ts` (`buildMime`, now with `html` and `attachments`) are reusable by other drivers (IMAP: build the same MIME and send it with SMTP).

### 3. Module wiring (what changed, who edits what)

- `mail-tokens.service.ts`: `MailTokens.withAccess(orgId, uuid, fn(access, mailbox))` replaces `withToken`; also opens password connections (`mail-connection.ts`:
  `sealConnection`, `openConnection`, `publicSummaryOf`; `connection_enc` JSON `{v:1, login?: PasswordConnection, extras?}`). `markNeedsReauth(orgId, mailbox, reason, message?)`.
- `mail-sync.service.ts`: `driver.sync` then `MailIngestService.store(orgId, mailbox, mail: NormalisedMail, { quiet })`. `mail-sync-rules.ts` keeps Gmail's rules; `planDriverFailure(err)`.
- `mail-connect.service.ts`: `start(input)` (sign-in providers; `provider` + `scope`), `callback(query, routeProvider)`, `connectWithPassword(input: ConnectImapMailboxInput)` (verifies via
  `MailDriverRegistry.password('imap')`, then the shared private `persist`: plan limit, account check, shared/personal rule, audit, event). A personal start/connect needs `mail_workspace_settings.personal_mailboxes_enabled`
  (else 422 `MAIL_PERSONAL_DISABLED`); who may connect (permission `mail.mailboxes.manage_personal`, policy `who_may_connect_personal`, admins reading) is TW-MAIL-035's to finish.
- Routes added: `GET /v2/email/providers` (`MailProvidersController`, `mail.mailboxes.read`), `POST /v2/email/mailboxes/connect-imap` (`mail.mailboxes.manage`, 201 -> `MailboxResponse`),
  `GET /v2/public/email/microsoft/callback` (answers `failed` until a Microsoft driver registers). `PATCH /v2/email/mailboxes/:id` accepts `sendLimitPerHour`.
  `MAIL_GOOGLE_PUSH_PATH` / `MAIL_MICROSOFT_PUSH_PATH` / `MAIL_MICROSOFT_CALLBACK_PATH` constants exist in contracts; the push controllers are 033's / 034's.
- `module-parts.ts`: `MAIL_EXTRA_CONTROLLERS`, `MAIL_EXTRA_PROVIDERS`, `MAIL_EXTRA_EXPORTS`, `MAIL_WORKER_PROVIDERS` (worker only): each feature appends to its own commented block. Driver classes go in
  `drivers/driver-providers.ts`. Nobody else edits `channel-email.module.ts` / `channel-email-worker.module.ts`.
- Three pass-through extension points, each owned by exactly one build (default implementations change nothing; replace the class body, keep the name and signatures):
  `mail-outbound.preparer.ts` `MailOutboundPreparer.prepare({orgId, mailbox, email}, mail) / sent(...)` (027: signature merge, attachment bytes), `mail-send.guard.ts`
  `MailSendGuard.assertAllowed(orgId, mailbox) / recordSent(...)` (032: Redis hourly counter, `MAIL_RATE_LIMITED`), `mail-bounce.handler.ts` `MailBounceHandler.inspect(orgId, mailbox, mail): 'pass'|'consumed'`
  (032: runs in the ingest before a mail is stored). `EmailChannelAdapter.send` calls guard -> build `OutgoingMail` -> preparer -> driver -> guard.recordSent -> preparer.sent.
- Reply extras reach the adapter: `EmailReplyExtras` (`attachmentIds?`, `signatureId?`, `signature?`) -> stored in `messages.meta.emailReply` (`StoredEmailReply`) -> `OutboundEmail`
  (`attachmentIds?`, `signatureId?`, `signature?`, `sentBy?` = the writing user's internal id) in `outboundEmailSchema` (`infra/providers/chat-conversations/channel.port.ts`), built in
  `chat-conversations/outbound-envelope.ts` (`emailEnvelopeOf(..., sentBy)`). Nothing in the inbox core needs to change for 027.
- `MailboxesRepository` (`mailboxes.repository.ts`): `MailboxRow` now has `connectionEnc`, `connectionPublic`, `syncCursor`, `pushState`, `sendLimitPerHour` (no `historyId`); `list()` returns `MailboxListRow`
  (+ `ownerUuid`, `ownerName`, `hasSignature`); new `savePushState(tx, orgId, id, state|null)`, `workspaceSettings(tx, orgId)`, `threadKeysOf(tx, orgId, channelUuid, ids)`; `saveSync({ cursor, ... })`;
  `ConnectInput` carries `provider`, `scope`, `ownerUserId`, `connectionEnc`, `connectionPublic`; `dueEverywhere` also returns `provider`. The sweep skips mailboxes whose provider is not `ready`.
- Ownership of new files by build: 031 `infra/providers/channel-email/imap/*`, `drivers/imap-mail.driver.ts`; 034 `drivers/microsoft-mail.driver.ts` + its client + the `microsoftMail` settings group;
  033 `push` member of `GoogleMailDriver` (it owns that file after Phase A), the public push controller, a renewal sweep; 035 settings service/controller, personal-mailbox rules, the web policy screen;
  027 signatures + upload services/controllers, `MailOutboundPreparer`; 032 `MailSendGuard`, `MailBounceHandler`.

### 4. Schema (migrations `20261119090000_mail_phase2_schema.sql`, `20261119090100_mail_phase2_permissions.sql`; Drizzle `packages/db/src/schema/channel-email/tables.ts`)

- `mail_mailboxes` (altered): `provider IN ('google','microsoft','imap')`; new `connection_enc text` (sealed, `^v[0-9]+:`), `connection_public jsonb` (non-secret summary: `{host, port, security, username, smtpHost, smtpPort, smtpSecurity}`),
  `sync_cursor jsonb` (replaces and drops `history_id`; existing values migrated to `{historyId}`), `push_state jsonb`, `send_limit_per_hour int NULL` (1..10000, NULL = platform default);
  CHECK `scope = 'shared' OR owner_user_id IS NOT NULL`; owner FK now `ON DELETE CASCADE`; indexes `idx_mail_mailboxes_personal (org_id, owner_user_id) WHERE scope = 'personal'`, `idx_mail_mailboxes_push (provider) WHERE push_state IS NOT NULL`.
  Address stays unique per workspace across providers and scopes.
- `mail_workspace_settings` (`org_id` PK, one row per workspace, created on first write; no row = contract defaults `DEFAULT_MAIL_WORKSPACE_SETTINGS`): `personal_mailboxes_enabled bool false`, `who_may_connect_personal 'admins'|'agents' 'admins'`,
  `admins_can_read_personal bool false`, `updated_by`, `row_version` (touch trigger), RLS forced.
- `mail_signatures` (`org_id, id, uuid`): `scope 'mailbox'|'user'` with exactly one of `mailbox_id` (composite FK to `mail_mailboxes`, CASCADE) / `user_id` (composite FK to `users`, CASCADE); `name` (<= 80),
  `body_html` (<= 20000, sanitised on write), `body_text` (<= 5000), `is_default`, `created_by`, `row_version`. Unique default per mailbox and per user. NO workspace-wide signature. Resolution at send time:
  `signatureId` on the reply -> else the replying user's default `user` signature -> else the mailbox's default `mailbox` signature -> else none; `signature: false` sends none.
- `mail_outbound_attachments` (`org_id, id, uuid`): `uploaded_by`, `conversation_id` (composite FK, CASCADE), `name`, `mime`, `size > 0`, `object_key` (object store via `ChatMediaStore`, org-prefixed), `used_at`, `created_at`, `expires_at`;
  index on `expires_at WHERE used_at IS NULL` for the cleanup sweep. Rows expire after `MAIL_OUTBOUND_ATTACHMENT_TTL_HOURS` (24).
- Rate limit counters: Redis only (key suggestion `mail:rl:{orgId}:{mailboxUuid}:{yyyymmddhh}`), no table. Bounces: no table (state on the sent message's `meta.email.delivery` / `bounce`).
- Permissions (`plan_feature = 'email_channel'`): `mail.mailboxes.manage_personal` (Admin, Manager, Agent), `mail.signatures.manage` (Admin, Manager, Agent), `mail.settings.manage` (Admin only; Owner/Admin
  presets also get every key through the permission trigger). Existing: `mail.mailboxes.read`, `mail.mailboxes.manage`. `roles_version` bumped. Tests: `test/integration/channel-email/mail-phase2-schema.spec.ts`.

### 5. Contracts (`packages/contracts/src/channel-email/`, all additive; rebuild with `pnpm turbo run build --filter=@crm/contracts...`)

- `mailbox.ts`: `MAIL_PROVIDERS = ['google','microsoft','imap']`, `mailAuthKindSchema` (`'oauth'|'password'`), `mailScopeSchema` (`'shared'|'personal'`), `mailTlsModeSchema` (`'ssl'|'starttls'|'none'`), `imapSummarySchema`,
  `MailboxResponse` + `{ scope, ownerUserId (user uuid|null), ownerName, hasSignature, pushActive, sendLimitPerHour, imap: ImapSummary|null }`, `mailProviderInfoSchema` / `mailProviderListResponseSchema`
  (`GET /v2/email/providers` -> `{ data: [{ provider, label, kind, ready, notReadyReason }] }`), `startMailboxConnectSchema` + `{ provider (default 'google'), scope (default 'shared') }`,
  `connectImapMailboxSchema` (`{ scope, address, displayName, imap: {host, port, security, username, password}, smtp: {host, port, security, username?, password?}, mailboxId? }`),
  `updateMailboxSchema` + `sendLimitPerHour?: number | null`, `MAIL_SEND_LIMIT_MAX`, `MAIL_MICROSOFT_CALLBACK_PATH`, `MAIL_GOOGLE_PUSH_PATH`, `MAIL_MICROSOFT_PUSH_PATH`.
- `settings.ts`: `mailWorkspaceSettingsSchema` (`{ personalMailboxesEnabled, whoMayConnectPersonal, adminsCanReadPersonal, rowVersion }`), `updateMailWorkspaceSettingsSchema` (all optional + `rowVersion`, 0 when never saved),
  `DEFAULT_MAIL_WORKSPACE_SETTINGS`. Planned routes (035): `GET /v2/email/settings` (`mail.mailboxes.read`), `PATCH /v2/email/settings` (`mail.settings.manage`).
- `signature.ts`: `mailSignatureResponseSchema`, `mailSignatureListResponseSchema`, `listMailSignaturesQuerySchema` (`mailboxId?`, `scope?`), `createMailSignatureSchema` (`scope`, `mailboxId` iff scope mailbox, `name`, `bodyHtml`,
  `bodyText`, `isDefault`), `updateMailSignatureSchema` (+ `rowVersion`). Planned routes (027) `/v2/email/signatures` (`GET`, `POST`, `PATCH :id`, `DELETE :id`), `mail.signatures.manage` (+ `mail.mailboxes.manage` for a shared mailbox's signature); reading is `mail.mailboxes.read`.
- `outbound-attachment.ts`: `mailOutboundAttachmentSchema` (`{ id (uuid), name, mime, size, expiresAt }`), `uploadMailAttachmentFieldsSchema` (`conversationId?`), `MAIL_OUTBOUND_ATTACHMENT_TTL_HOURS`.
  Planned route (027) `POST /v2/email/attachments/upload` (multipart, field `file`; permission `inbox.conversation.reply`).
- `email-meta.ts`: `EmailMeta` + optional `bounce: { kind: 'hard'|'soft', reason, failedRecipient }` and `delivery: 'sent'|'failed'|'bounced'` (`emailBounceSchema`, `emailDeliverySchema`, `EMAIL_DELIVERY_STATES`);
  `EmailReplyExtras` + optional `attachmentIds` (uuid[], <= `MAIL_ATTACHMENTS_MAX_COUNT` 10), `signatureId`, `signature` (`false` = none). Limits: `MAIL_ATTACHMENT_MAX_BYTES` 10 MB each, `MAIL_ATTACHMENTS_TOTAL_MAX_BYTES` 20 MB.
- Error codes (`common/errors.ts`): `MAIL_PROVIDER_UNSUPPORTED`, `MAIL_IMAP_AUTH_FAILED`, `MAIL_SMTP_AUTH_FAILED`, `MAIL_IMAP_CONNECT_FAILED`, `MAIL_PERSONAL_DISABLED`, `MAIL_PERSONAL_NOT_ALLOWED`, `MAIL_RATE_LIMITED`,
  `MAIL_ATTACHMENT_TOO_LARGE`, `MAIL_TOO_MANY_ATTACHMENTS`, `MAIL_ATTACHMENT_NOT_FOUND`, `MAIL_SIGNATURE_NOT_FOUND` (adapter-level codes such as `MAIL_SEND_FAILED` / `MAIL_NO_THREAD` stay `ChannelError` strings).
  Web: add each to `apps/web/src/features/channel-email/lib/api-errors.ts` and the 21 locales when the screen that shows it is built.

### 6. Tests already in place

Unit `test/unit/channel-email/{thread-key,mail-driver.registry,mail-connection,mail-sync.service}.spec.ts` (the sync spec runs the real `GoogleMailDriver` against a fake Gmail), integration
`test/integration/channel-email/mail-phase2-schema.spec.ts` (RLS, composite keys, constraints, keys), e2e `test/e2e/channel-email/*` (unchanged behaviour; the cursor assertions read `sync_cursor`).

### 6. TW-MAIL-027 as built (outbound attachments, signatures, rich body)

- Bytes: `MailOutboundPreparer.prepare` fills `OutgoingMail.attachments[].bytes` (read from the object store, capped), `html` (sanitised composer body plus signature) and `text`; every driver reads those. Reusable contract check: `test/unit/channel-email/driver-send-contract.ts`.
- Additive seams: `OutboundEmail.bodyHtml` / `StoredEmailReply.bodyHtml` (contract field `email.bodyHtml` was added by the web build), `SendResult.meta` (merged into the sent message's `meta` by `markSent`; kept in the dispatcher's idempotent result),
  `MailOutboundPreparer.sent(ctx, mail, result)` now takes the sent mail and returns the `meta.email` block, `EmailMessageAccess.conversationReadable`. No migration, no other contract change.
- Env: `MAIL_OUTBOUND_ATTACHMENT_MAX_BYTES`, `MAIL_OUTBOUND_ATTACHMENTS_TOTAL_MAX_BYTES`, `MAIL_OUTBOUND_ATTACHMENTS_MAX_COUNT`, `MAIL_OUTBOUND_ATTACHMENT_TTL_HOURS`, `MAIL_OUTBOUND_ATTACHMENT_ALLOW_MIME`, `MAIL_OUTBOUND_ATTACHMENT_DENY_MIME`.
- Auto-Submitted for automation is set by the adapter (TW-MAIL-032), not the preparer.
