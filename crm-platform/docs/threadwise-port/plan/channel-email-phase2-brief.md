# channel-email phase 2: shared brief for the parallel builders

Repo `crm-platform/` (branch `lakshya/mail/gmail-email-channel`; NestJS api `apps/api`, Next.js `apps/web`, deps installed; rebuild contracts with
`pnpm turbo run build --filter=@crm/contracts...`; docker is available, e2e uses testcontainers). The Gmail channel is built and committed. Phase A made it
provider-agnostic and landed ALL shared schema, contracts and permissions.

## Rules for every builder

- Read first: `plan/channel-email-build.md` (especially "## Phase 2 seams (as built)": code against it; do NOT add migrations or change shared contracts unless your
  task says so; if something is truly missing add the smallest additive change and say so in your report), `inventory/channel-email.md` (TW-MAIL-027, 031..035),
  `docs/specs/email-channel-and-social-leads.md`, `docs/api/channel-email.md`, the wiring and parity docs, `CLAUDE.md`, `CONTRIBUTING.md`, `PORTING_RULES.md`, and the skills in
  `../.claude/skills` that apply (provider-adapter, worker-job, outbox-event, rbac-permission, threadwise-e2e-tests, i18n-translate-sync, help-docs-sync, frontend-api-call).
- SEVEN OTHER AGENTS work IN PARALLEL in the same checkout on neighbouring files. Never revert or reformat their changes; Read a file right before editing it; edit only what you
  need; add your classes only to your own block in `drivers/driver-providers.ts` and `module-parts.ts`; rebuild contracts when you change them. Do NOT commit.
- Nothing can be tested against real Google, Microsoft or IMAP servers here: use real local servers where feasible (a GreenMail-style mail-server testcontainer for IMAP and
  SMTP) or faithful fakes, and say clearly what was not run live.
- For every feature: unit and e2e tests under `apps/api/test/{unit,e2e}/channel-email`, update `docs/api/channel-email.md` and the wiring/parity docs (deviations from Reference
  are intentional: Reference only bridges to MailTrixy), runbook notes, and (web) text in all 21 locales with real translations plus help guide updates.
- Finish with: tsc (api and web), eslint and prettier on touched files, `pnpm arch:check`, the channel-email unit and e2e suites you affect. Report: files, test results, what was not
  run, deviations, open issues, any seam you had to add.

## Tasks (you are told your number)

### 1. IMAP + SMTP provider (TW-MAIL-031)

`drivers/imap-mail.driver.ts` (a PasswordMailDriver) with imapflow (add the dependency to apps/api; mailparser or postal-mime for MIME if needed) and nodemailer SMTP for send.
verify() logs in to BOTH IMAP and SMTP before anything is stored (MailDriverError auth_failed with providerCode imap|smtp, or unreachable); TLS modes ssl/starttls/none with
certificate validation on (no insecure option); SSRF guard (refuse private, loopback, link-local and metadata addresses unless an env flag allows it for tests or self-hosted);
timeouts. Sync by UID per folder (INBOX; cursor `{uidValidity,lastUid}`; a UIDVALIDITY change triggers a repair resync; quiet backfill of the last N days; batch caps; skip
spam, trash and drafts via SPECIAL-USE; NormalisedMail with threadKey from resolveThreadKey, lazy attachments, automated detection). Send via SMTP with the OutgoingMail MIME (reuse
buildMime). Health. Register in the MAIL_DRIVER_PROVIDERS block. The route `POST /v2/email/mailboxes/connect-imap` already exists from Phase A: wire its service path (verify, seal
into connection_enc, create mailbox and channel, honour limit, permissions and the personal policy as the seams say). e2e against a real IMAP/SMTP server (GreenMail testcontainer
image `greenmail/standalone`, or a tiny in-process IMAP server if the image cannot be pulled): good and bad credentials (which of IMAP/SMTP failed), a two-mail thread into one
conversation, reply threads correctly, redelivery idempotent, UIDVALIDITY change, SSRF refusal.

### 2. Microsoft 365 / Outlook via Microsoft Graph (TW-MAIL-034)

`drivers/microsoft-mail.driver.ts` (an OAuthMailDriver) plus an infra client (plain fetch). OAuth 2.0 authorization-code flow on the Microsoft identity platform (tenant `common`;
scopes openid, email, offline_access, Mail.Read, Mail.Send, User.Read), profile via /me, delta sync of the Inbox (`/me/mailFolders/inbox/messages/delta`, `deltaLink` cursor, quiet
backfill of N days, skip junk, deleted, drafts, sent), NormalisedMail from Graph messages (conversationId -> thread key via resolveThreadKey, internetMessageId, headers via
internetMessageHeaders, body html/text, lazy attachments including inline contentId), send via /me/sendMail or reply endpoints preserving the thread (In-Reply-To and References
through internetMessageHeaders; idempotent on the generated Message-ID: look in Sent Items before a retry), error mapping (401, invalid_grant, AADSTS codes -> reauth; 429/503 with
Retry-After -> rate_limit or transient). Platform credentials: a NEW operator settings group `microsoftMail` mirroring googleMail exactly (contracts platform-settings groups.ts and
SET_SECRET_FIELDS, web fields.ts, settings.service redirect special-case, console keywords and layout, 21-locale labels, env fallback MICROSOFT_MAIL_CLIENT_ID, _SECRET, _TENANT,
_REDIRECT_URI, readiness() -> not_configured reason). The public callback `GET /v2/public/email/microsoft/callback` is declared in Phase A: implement it through the shared connect
service (signed state with its own purpose) and add it to tools/auth-audit/baseline/public-routes.json if missing. Runbook `docs/runbooks/microsoft-mail-setup.md` (Entra app
registration, redirect URI, permissions, publisher verification). e2e with a fake Graph server (connect, wrong account, sync a thread, reply, reauth, 429).

### 3. Gmail push via Pub/Sub (TW-MAIL-033)

Implement the optional MailPushSupport on GoogleMailDriver: users.watch on the mailbox (labelIds INBOX, topic from platform config), store push_state `{kind:'gmail-watch',
historyId, expiresAt}` via savePushState, a renewal sweep (watches expire after 7 days) and stop on disconnect or lapse. A PUBLIC endpoint `POST /v2/public/email/google/push`
verifies Google's OIDC JWT (Authorization bearer; RS256 against Google's JWKS cached with rotation; check issuer, audience = configured value, email = configured push service
account, email_verified, expiry; reject everything else with 401 and no body), decodes the Pub/Sub envelope (`message.data` base64 `{emailAddress, historyId}`), maps emailAddress to
the connected google mailbox(es) (public route, no tenant context: use a SECURITY DEFINER lookup if the Phase A migrations do not already cover it; if you must add a migration make it
tiny and say so), enqueues the existing MAIL_SYNC job for that mailbox immediately (fixed jobId dedupe, ignore stale historyIds), answers 204 fast. Polling stays as the safety net
(a reconcile at least every 10 minutes for push-active mailboxes). Config: the googleMail settings group gains optional pubsubTopic, pushAudience, pushServiceAccount (additive in
contracts groups.ts and fields.ts plus 21 locales) with env fallback GOOGLE_MAIL_PUBSUB_TOPIC etc.; the hub shows pushActive (contract field exists). Add the route to the auth-audit
public-routes baseline and redact the Authorization header if needed. Runbook section in `docs/runbooks/google-mail-setup.md` (topic, push subscription endpoint, IAM publisher
gmail-api-push@system.gserviceaccount.com, service account). Tests: JWT verification unit tests with a locally generated RSA key and a fake JWKS (valid, wrong audience, expired, wrong
email, bad signature, alg none); e2e: a push syncs exactly the right mailbox, an unknown address is ignored, a replay is ignored, the renewal sweep renews near-expiry watches, a lapse
stops it.

### 4. Personal mailboxes + email sharing policy (TW-MAIL-035)

Phase A added mail_mailboxes.scope and owner_user_id, mail_workspace_settings, and permissions mail.mailboxes.manage_personal and mail.settings.manage. Build: (1) the workspace policy
API `GET/PUT /v2/email/settings` (personal_mailboxes_enabled, who_may_connect_personal admins|agents, admins_can_read_personal; row version; permission mail.settings.manage; audit and
outbox); (2) connecting a personal mailbox through any provider (scope personal, owner = the connecting user, only when the policy enables it and the user holds manage_personal per
who_may_connect_personal; counts toward email_mailboxes; reconnect only by the owner), list rules (an agent sees shared mailboxes plus their own personal ones; admins see personal
ones' content only if admins_can_read_personal, else a summary without content), disconnect rules; (3) THE CRITICAL PART, channel-owner visibility in the inbox core: conversations on a
personal mailbox's channel are visible only to the owner (and admins only when the policy allows). Implement the predicate in BOTH places and keep them in step: the SQL visibility
(visibility-sql.ts or wherever list, counts, search, get, messages, attachments and notes are scoped) and the realtime conversationVisible check, plus notification fan-out, search,
unread counts, the attachment download route (EmailMessageAccess), assignment targets (a personal-mailbox conversation cannot be assigned to someone who cannot see it), routing rules,
exports and any API that returns conversations or messages. Hunt every read path with grep for channel-scoped queries; add a channel -> owner mapping (a join or a flag maintained when
the channel is created or changed: choose and document). Cross-user leakage is a privacy incident: write an e2e matrix proving user B (agent), user C (admin with the policy off and
on) and another tenant cannot read list, detail, messages, search, counts, attachments or realtime events of user A's personal mailbox, and that shared mailboxes are unaffected.
Turning the policy off hides the connect option but never exposes existing personal mailboxes to others.

### 5. Outbound attachments + signatures + composer backend (TW-MAIL-027)

Phase A added tables mail_outbound_attachments and mail_signatures, contracts (outbound-attachment.ts, signature.ts, reply extras attachmentIds, signatureId, signature), permission
mail.signatures.manage, the pass-through stub MailOutboundPreparer and OutboundEmail fields sentBy, attachmentIds, signatureId. Build the real thing: (1) `POST /v2/email/attachments/upload`
(multipart; per-file and per-message caps from env; mime allow/deny list; an antivirus hook point documented; object store key; expiry), delete a staged file, cleanup of expired staged
uploads (worker job); (2) signatures CRUD `/v2/email/signatures` (scope mailbox or user per the contracts; default per scope; sanitize-html on signature HTML; permission
mail.signatures.manage; an agent manages only their own user signatures; row version; audit); (3) MailOutboundPreparer: resolve the signature (named by the composer -> the sender's
default user signature -> the mailbox default -> none; `signature:false` skips), merge into the text and html parts with a standard separator and variables {{name}} {{title}} {{phone}}
resolved from the sending user, validate attachmentIds belong to the org and uploader and are within caps, resolve to OutgoingAttachment bytes (stream-safe, total cap), attach to
the OutgoingMail; after a successful send record the sent attachments on the outbound message's meta.email.attachments so the thread shows them (the download route must serve
outbound attachments too: extend EmailMessageAccess and the attachments controller carefully, same visibility rules); rich text: the composer sends HTML (sanitise server-side with an
email-safe allow-list, derive the text part); (4) all drivers (Google, IMAP, Microsoft) must honour OutgoingMail.html and attachments through buildMime or their own API (Google
already does): confirm in the seams doc that bytes arrive in OutgoingMail.attachments and add a short contract test helper the IMAP and Microsoft builders can reuse. Tests: unit
(signature resolution order, variable merge, sanitisation, caps, MIME with attachments) and e2e (upload -> reply with attachment and signature through the fake Gmail: the MIME has
both, the thread shows them, another user cannot attach someone else's upload, caps refused, expired cleanup, signature scope permissions).

### 6. Bounce handling + rate limits (TW-MAIL-032)

Phase A added the stubs MailBounceHandler (in ingest) and MailSendGuard, the contracts email-meta bounce and delivery fields, error MAIL_RATE_LIMITED, mailbox sendLimitPerHour. Build:
(1) bounce and DSN detection in ingest for every provider: recognise delivery-status notifications (multipart/report with message/delivery-status, report-type=delivery-status, From
MAILER-DAEMON or postmaster, X-Failed-Recipients, the Gmail "Delivery Status Notification" mail, Microsoft "Undeliverable" NDRs with the original headers), parse the failed recipient,
the status code (5.x.x hard, 4.x.x soft) and the reason, link it to the ORIGINAL outbound message (Message-ID in the returned headers or original-message part, or References) and set that
message delivery='bounced' with meta.email.bounce `{kind, reason, failedRecipient}`, emit the realtime message status update and a system note in the thread, notify the sender through
the existing notification pipeline, never create a conversation for the bounce itself and never trigger listeners; after a hard bounce flag the address (use the least invasive existing
contact field, document the choice) and refuse or warn on further sends to it; (2) loop protection: honour Auto-Submitted, Precedence, X-Auto-Response-Suppress and List-Unsubscribe
(never auto-respond; mark meta.email.automated, which exists, and add a reply-suppression guard); our own mail carries Auto-Submitted only when sent by automation (sentBy null) -
add the header in the preparer path; (3) rate limits: MailSendGuard enforces a per-mailbox hourly send limit (mailbox.send_limit_per_hour, default from env, e.g. 100/hour; Gmail's own
daily cap surfaces through the driver error) with Redis sliding-window counters, a per-recipient burst limit, and a per-sender inbound flood limit in ingest (a single sender address
sending over N messages in 10 minutes is stored but flagged, not notified, and throttled), failing with MAIL_RATE_LIMITED (with retryAfter) and surfacing in the composer error;
PATCH /v2/email/mailboxes/:id accepts sendLimitPerHour (the contract field exists) with permission checks; add a jittered retry policy to the sync job if missing. Tests: DSN fixtures
for Gmail, Postfix, Exchange/Outlook NDRs (soft and hard) linking to the original message e2e through the fake Gmail, a bounce never opens a conversation or fires listeners, loop
headers, rate limit unit (window math) and e2e (limit hit -> MAIL_RATE_LIMITED, reset after the window, other mailboxes unaffected), flood limit.

### 7. WEB: hub, providers, IMAP form, personal mailboxes, sharing policy

In `apps/web/src/features/channel-email`: you own hub-screen.tsx, mailbox-card.tsx, channel-options.tsx, the hub api hooks and routes (task 8 owns the composer, thread and signatures).
The email feature is an INTEGRATION: a Settings > Integrations tile gated by planFeature email_channel (see channel-email/settings.ts and nav.ts). Backend contracts exist
(`packages/contracts/src/channel-email`: mailbox.ts, settings.ts, the providers response). Build: provider cards from `GET /v2/email/providers` (Google, Microsoft 365, IMAP/SMTP with
ready and the reason "Ask your platform administrator"); Connect per provider (OAuth providers POST connect `{provider, scope}` then redirect; IMAP opens a form modal: address, display name,
IMAP host, port, security, username, password, SMTP the same with a "same credentials" shortcut, verify-and-connect with errors that say which of IMAP and SMTP failed, the password
never shown again, port and security presets for common hosts); a scope choice (shared or personal) when the workspace policy allows it; mailbox cards with a provider badge, scope
badge (Shared or Personal plus owner), push-active indicator, signature chip, send limit per hour (editable inline for managers), sync health and reconnect (OAuth, or IMAP password
re-entry); an "Email sharing" settings panel (personal mailboxes on or off, who may connect, admins can read personal; permission mail.settings.manage; row version); a personal mailbox
of someone else the viewer may not read shows as a summary row without actions; the usage meter; outcome messages for the Microsoft callback; remove the Soon cards. Text in
`messages/en/channel-email.json` and REAL translations in all 20 other locales, help guide update, vitest and render tests, update `e2e/channel-email/hub.spec.ts` (run it with the
locally installed chromium through a temporary playwright config with launchOptions.executablePath=~/.cache/ms-playwright/chromium-1223/chrome-linux64/chrome if you bring the stack up;
start the API with GOOGLE_MAIL_CLIENT_ID and GOOGLE_MAIL_CLIENT_SECRET env to test connect; delete temp configs afterwards).

### 8. WEB: composer, attachments, signatures, thread bounce display

In `apps/web/src/features/channel-email` and the email parts of team-inbox-conversations (composer.tsx, message-bubble.tsx, email-message.tsx, extras-fields.tsx); task 7 owns
hub-screen.tsx, mailbox-card.tsx and channel-options.tsx. Backend contracts exist (outbound-attachment.ts, signature.ts, email-meta bounce and delivery, reply extras attachmentIds,
signatureId, signature) and the API is built concurrently (`POST /v2/email/attachments/upload` multipart, `/v2/email/signatures` CRUD, replies with attachmentIds and an HTML body).
Build: a rich-text composer on email conversations (bold, italic, underline, lists, links, quote; a small safe editor, prefer one already in the repo, sanitise on output, plain-text
fallback); attach files (button, drag-drop, paste; per-file and total caps from the contract; progress, remove, upload before send, retry); a signature picker (default auto-inserted,
switch or none, preview) with variables; a signatures management panel component `signatures-panel.tsx` (list, create, edit, delete; scope mailbox or user; default toggle; HTML editor
reusing the composer editor; permission mail.signatures.manage; an agent manages only their own user signatures) exported for the hub to mount (add ONE line mounting it into
hub-screen.tsx after re-reading that file); in the thread, outbound messages show their attachments with download links, bounced messages show "Not delivered to <address>: <reason>"
with hard or soft wording and a hint to edit the address, and failed or rate-limited sends (MAIL_RATE_LIMITED with retry-after) show in the composer; Cc, Bcc and subject stay. Text in
channel-email.json en and REAL translations in the other 20 locales, help guide updates, vitest and render tests including XSS-safe rendering of signatures and HTML, Playwright spec
additions (skipped when there is no connected mailbox).
