# Wiring map: channel-email (Gmail mailboxes in the team inbox)

Hand-written from the controllers, repositories and seams of the email backend. Update it in the same change as any new route, table, queue or consumer.
Plan: [plan/channel-email-build.md](../plan/channel-email-build.md). Inventory: [inventory/channel-email.md](../inventory/channel-email.md) (TW-MAIL-019 to 030).

## API routes

| Method | Path                                    | Permission                | Notes                                                              |
| ------ | --------------------------------------- | ------------------------- | ------------------------------------------------------------------ |
| GET    | `/v2/email/mailboxes`                   | `mail.mailboxes.read`     | plan feature `email_channel` on the whole controller               |
| POST   | `/v2/email/mailboxes/connect`           | `mail.mailboxes.manage`   | consent URL with a signed state; `mailboxId` = reconnect           |
| GET    | `/v2/public/email/google/callback`      | public                    | signed state is the credential; 302 to `<web>/<returnTo>?email=`   |
| PATCH  | `/v2/email/mailboxes/:id`               | `mail.mailboxes.manage`   | `{displayName, rowVersion}`, idempotent                            |
| POST   | `/v2/email/mailboxes/:id/sync`          | `mail.mailboxes.manage`   | 202; queues a `mail-sync` job                                      |
| DELETE | `/v2/email/mailboxes/:id`               | `mail.mailboxes.manage`   | disconnect, 204, idempotent                                        |
| GET    | `/v2/email/attachments/:conv/:msg/:att` | `inbox.conversation.read` | visibility through `EmailMessageAccess`; not plan-gated            |
| POST   | `/v2/inbox/conversations/:id/messages`  | existing inbox reply      | seam (agent "inbox"): `email: {cc,bcc,subject}`; the adapter sends |

## Tables read or written

`mail_mailboxes` (owned; RLS enabled + forced; sealed tokens, `sync_cursor` (jsonb; Gmail `{historyId}`), `connection_enc`, `push_state`, `last_error`, `channel_uuid` -> `channels (org_id, uuid)`),
`channels` (kind `email`, through `ExternalChannelIngest.sync`; external id = mailbox uuid), `conversations` / `messages` / `message_ledger` (through
`ExternalChannelIngest.inbound`; ledger key = Gmail message id), `contacts` (linked by email identity through the same call), `audit_log` (module
`mail_mailboxes`), `event_outbox`, `org_plan_state` / `plans` (feature `email_channel`, limit `email_mailboxes`), `platform_settings` (group
`googleMail`, secret `clientSecret`). Files go to the chat object store (`chat/<org>/...` keys), never to Postgres.
No SECURITY DEFINER lookup: the public callback carries workspace and admin in its signed state.

## Settings and environment read

| Setting                                                                            | Where                                 | Reader                                                  |
| ---------------------------------------------------------------------------------- | ------------------------------------- | ------------------------------------------------------- |
| `googleMail` `{enabled, clientId, redirectUri}` + secret `clientSecret`            | platform settings (operator console)  | `GoogleMailConfig` (env fallback below)                 |
| `microsoftMail` `{enabled, clientId, tenant, redirectUri}` + secret `clientSecret` | platform settings (operator console)  | `MicrosoftMailConfig` (env `MICROSOFT_MAIL_*` fallback) |
| `GOOGLE_MAIL_CLIENT_ID/SECRET/REDIRECT_URI`                                        | environment                           | `GoogleMailConfig` fallback                             |
| `GOOGLE_OAUTH_*`, `GMAIL_API_URL`, `GOOGLE_MAIL_HTTP_TIMEOUT_MS`, `MAIL_*`         | `config/domains/channel-email.env.ts` | provider clients, sync, ingest                          |
| plan feature `email_channel`, limit `email_mailboxes`                              | plan catalogue                        | `@RequirePlanFeature`, `MailPlan`                       |

## Queues and workers

Queue `mail-sync` (`QUEUES.MAIL_SYNC`): one job per mailbox, job id `mail-sync-<mailbox uuid>` (never queued twice), 3 attempts with 15 s exponential
backoff, removed on completion. Producers: `MailSyncPublisher` (the sweep, the connect callback, Sync now). Consumer: `MailSyncProcessor`
(concurrency 4), registered only by `ChannelEmailWorkerModule` (imported by `WorkersModule`). `MailSyncSweep` runs every 60 s in the worker: connected
mailboxes (and `error` ones after 5 minutes) of workspaces that own `email_channel`, and only for providers the platform has set up (`MailDriverRegistry`, see "Phase 2 seams" in plan/channel-email-build.md).

## Outbox events emitted

`mail.mailbox.connected`, `mail.mailbox.reconnected`, `mail.mailbox.disconnected`, `mail.mailbox.needs_reauth` (aggregate module `mail_mailboxes`,
payload `{uuid, provider, address}`). Individual mails are messages (their own log), not outbox events.

## Provider boundary

`infra/providers/channel-email`: `GoogleMailOAuthClient` (authorize URL, code exchange, refresh, revoke, userinfo), `GmailClient` (profile,
`history.list`, `messages.list/get(full)`, `attachments.get`, `messages.send`, find by `rfc822msgid`), `parseGmailMessage` (headers, text and HTML
parts, attachments, `cid`, automated detection), `sanitizeEmailHtml`, `buildMime` (nodemailer MailComposer). Plain `fetch`, typed `GoogleMailError`,
no tenant, no secret of its own.

## Seams in other domains

- chat-conversations (agent 1): `ChannelAdapterRegistry.register` (the `EmailChannelAdapter`), `ExternalChannelIngest.sync/inbound`, `NormalisedInbound.title` /
  `contactIdentity` / `meta.email` / `history`, `outboundEnvelope.email` (`to`, `cc`, `bcc`, `subject`, `inReplyTo`, `references`, `threadId`),
  `EmailMessageAccess.readable` (attachment visibility).
- infra/queue: the `MAIL_SYNC` queue. tools/auth-audit: the callback in `public-routes.json`.
- Marketplace app `email` and the `googleMail` settings group are the integration packaging's (a Marketplace integration, Settings > Integrations tile gated by `mail.mailboxes.read` + plan feature `email_channel`, hidden `/email` nav entry for the plan paywall).

## TW-MAIL-032 wiring (bounces and limits)

- Ingest: `MailIngestService.store` -> `MailBounceHandler.inspect` (`infra/providers/channel-email/bounce-detect.ts` is the pure detector; Gmail fills `NormalisedMail.report`
  with the delivery-status part and the returned headers, other drivers may leave it out) -> `EmailDeliveryService.recordBounce` in `chat-conversations` (marks `meta.email.delivery/bounce`,
  system line `meta.event = 'email_bounce'`, outbox `email.message_bounced`, realtime) -> `EmailBounceNotificationConsumer` (notifications, type `email_bounced`, legacy type list).
- Send: `EmailChannelAdapter.send` -> `MailSendGuard.assertAllowed/recordSent` (`MailLimits`, Redis). Env `MAIL_SEND_LIMIT_PER_HOUR`, `MAIL_RECIPIENT_BURST_*`, `MAIL_INBOUND_FLOOD_*`, `MAIL_BOUNCE_BLOCK_DAYS`.
- Redis keys: `mail:rl:<org>:<mailbox>`, `mail:rr:<org>:<mailbox>:<address>`, `mail:fl:<org>:<mailbox>:<sender>`, `mail:bounced:<org>:<address>`.
- Web (task 8 owns the thread rendering): reads `meta.email.delivery`, `meta.email.bounce`, system line `meta.event = 'email_bounce'`, failure code `MAIL_RATE_LIMITED` / `MAIL_RECIPIENT_BOUNCED`.

## TW-MAIL-031 wiring (IMAP / SMTP)

- Route: `POST /v2/email/mailboxes/connect-imap` -> `MailConnectService.connectWithPassword` -> `MailDriverRegistry.password('imap')` -> `ImapMailDriver.verify` (IMAP login + INBOX, then SMTP login) -> `persist` (limit, personal rule, audit, outbox) -> `MailChannelSync` + first `MAIL_SYNC` job.
- Driver: `modules/channel-email/drivers/imap-mail.driver.ts` (registered in the `imap` block of `driver-providers.ts`); infra `infra/providers/channel-email/imap/` (`host-guard.ts` SSRF, `imap-mail.client.ts` imapflow, `smtp-mail.client.ts` nodemailer, `imap-normalise.ts` mailparser -> `NormalisedMail`).
- Credentials: `mail_mailboxes.connection_enc` (sealed `{ v:1, login: { imap, smtp } }`), `connection_public` summary; cursor in `sync_cursor`. `MailTokens.withAccess` hands the driver `{ kind: 'password', connection }`.
- Env: `MAIL_IMAP_ALLOW_PRIVATE_HOSTS`, `MAIL_IMAP_TIMEOUT_MS`, `MAIL_IMAP_MAX_MESSAGE_BYTES` (`config/domains/channel-email.env.ts`). Dependencies added to `apps/api`: `imapflow`, `mailparser`, `@types/mailparser`.

## TW-MAIL-033 Gmail push (built)

Intentional deviation from Reference (Reference only bridges to MailTrixy; no push). Route `POST /v2/public/email/google/push` (public, OIDC-verified; added to
`tools/auth-audit/baseline/public-routes.json`). Code: `modules/channel-email/mail-push.{controller,service,repository,sweep}.ts`, `mail-push-rules.ts`,
`infra/providers/channel-email/google-oidc.verifier.ts`, `GoogleMailDriver.push`, `GmailClient.watch/stopWatch`, `GoogleMailConfig.push()`, `MailSyncSweep` reconcile skip.
Tables: `mail_mailboxes.push_state` (no migration; the cross-workspace address lookup runs privileged). Settings: `googleMail.pubsubTopic|pushAudience|pushServiceAccount`
(operator console, 21 locales). Tests: `test/unit/channel-email/google-oidc.verifier.spec.ts`, `mail-push-rules.spec.ts`, `test/e2e/channel-email/mail-push.e2e.spec.ts`.

## TW-MAIL-027 backend wiring (attachments, signatures, rich body)

Files `apps/api/src/modules/channel-email/{mail-outbound.preparer,mail-outbound-attachments.{controller,service,repository,sweep},mail-signatures.{controller,service,repository},mail-attachment-scanner,mail-outbound-errors}.ts`,
`infra/providers/channel-email/outbound-html.ts`, `EmailMessageAccess.conversationReadable` (upload visibility). Tables `mail_outbound_attachments`, `mail_signatures` (RLS, Phase A). Flow: composer upload -> staged row + object
store key -> reply `email.{attachmentIds, bodyHtml, signatureId, signature}` -> stored in `messages.meta.emailReply` -> `OutboundEmail` -> `MailOutboundPreparer.prepare` (sanitise, signature, bytes) -> driver -> `sent()` marks files used and
returns the `meta.email` block (`SendResult.meta`, merged by `MessagesRepository.markSent`) -> thread shows the files and the existing attachment route serves them. Env: `MAIL_OUTBOUND_ATTACHMENT_*`, `MAIL_OUTBOUND_ATTACHMENTS_*`.
Deviation from Reference (which only bridges to MailTrixy): native outbound files, signatures and a rich body. Runbook: staged files live in the object store under `chat/<org>/...`; the worker sweep removes expired ones; for malware scanning implement `MailAttachmentScanner`.

## TW-MAIL-027 web wiring (composer)

- Files: `apps/web/src/features/channel-email/{components/{rich-editor,attachment-tray,signature-picker,signatures-panel,composer-notes}.tsx, lib/{rich-text,staged-attachments,use-staged-attachments,signature-view,composer-errors,bounce-view}.ts, api/composer.ts}`; used by `team-inbox-conversations/components/{composer,thread-pane,message-bubble}.tsx` and mounted on the hub (`SignaturesPanel`).
- Calls: `POST /v2/email/attachments/upload`, `DELETE /v2/email/attachments/:id`, `GET/POST/PATCH/DELETE /v2/email/signatures`, reply `POST /v2/inbox/conversations/:id/messages` with `email.{bodyHtml, attachmentIds, signatureId, signature}`; reads `meta.email.{attachments, delivery, bounce}`.
- Permissions: `mail.signatures.manage` (panel), `mail.mailboxes.manage` (shared signatures), `inbox.conversation.reply` (composer).

## Microsoft 365 / Outlook (TW-MAIL-034)

`drivers/microsoft-mail.driver.ts` (`MicrosoftMailDriver`, OAuth) + `infra/providers/channel-email/{microsoft-mail-oauth.client,graph-mail.client,graph-normalise,microsoft-http,microsoft-mail.errors}.ts`;
platform credentials `MicrosoftMailConfig`; callback `GET /v2/public/email/microsoft/callback` (`MailCallbackController`, shared `MailConnectService.callback`); settings group `microsoftMail`
(contracts `groups.ts`, web `fields.ts` slug `microsoft-mail`, console keywords and layout, 21 locales). Seams touched: `MailOAuthRefreshed.refreshToken` (rotation, stored by `MailTokens`
through `MailboxesRepository.saveAccessToken`), `MailDriverError.retryAfterSeconds`. Runbook: `docs/runbooks/microsoft-mail-setup.md`.

## TW-MAIL-035 wiring (personal mailboxes, sharing policy, visibility)

Files `apps/api/src/modules/channel-email/{mail-settings.{controller,service,repository},mail-access.service,mail-personal-policy}.ts`; `realtime/audience/{channel-owner,conversation-visibility,member-directory.service,conversation-record.loader}.ts`;
`team-inbox-conversations/{visibility-sql,inbox-access.service,conversations.repository}.ts`; `chat-conversations/{conversations.repository,messages.repository,channel-registry.service,channels.repository}.ts`;
`team-inbox-routing-sla/{assignment.service,routing-engine.service}.ts`; `notifications/{conversation-notification.consumer,waiting-nudge.service}.ts`; `dashboards-analytics-charts/{dash-widgets,dash-panels}.repository.ts`;
`developer-rest-api-v1/resources/messaging/messaging.repository.ts`; `admin-console-shell/workspace-export.service.ts`. Tables `mail_workspace_settings`, `mail_mailboxes.scope/owner_user_id` (Phase A, no new migration). Permissions
`mail.mailboxes.manage_personal`, `mail.settings.manage`. Contract addition: optional `MailboxResponse.contentHidden`. Every consumer of "who may see a conversation" now takes the channel owner (required field).
Deviation from Reference: Reference has no personal mailboxes. Runbook: if a workspace asks "why can't I see my teammate's email", it is by design; an admin only reads personal mail when the Email sharing policy says so.

## Campaign engine (TW-CAMP-028, email half)

`EmailEngineSender` (`channel-email/email-engine.sender.ts`, pure rules `email-engine.rules.ts`) is the `email` engine of `EngineSenderRegistry`: campaigns send through a mailbox (`email:<uuid>`) with the mailbox's own `MailTokens.withAccess`, `MailDriverRegistry`, `MailSendGuard` (bounce list, hourly cap and burst) and the consent gate / unsubscribe link. New seams: `ChannelEmailModule` imports `BroadcastsModule` (the registry); `MailPlan.monthlyLimit` (plan limit `email_monthly`); `MailboxesRepository.byId`, `sentSince`, `contactUuid`. No new table or permission. See wiring/campaigns.md (Email campaigns).

## E-19 wiring (mail on the contact timeline)

- Writer: `MailTimeline` (`channel-email/mail-timeline.service.ts`; pure rules `mail-timeline-rules.ts`, data access `mail-timeline.repository.ts`). It is NOT in `crm/contact-activities`; it inserts through the CRM barrel (`ContactActivitiesRepository.insert`, `ContactsRepository.bumpLastActivity`), so `ChannelEmailModule` imports `CrmModule`.
- Inbound: `MailIngestService.store` -> `ExternalChannelIngest.inbound` returns `stored` -> `MailTimeline.recordInbound` (also for the quiet backfill/repair; a thread with no contact is skipped). Outbound: `EmailChannelAdapter.send`, after the provider accepted -> `MailTimeline.recordOutbound` (thread = `t:<threadId>` on the channel).
- Table `mail_timeline_entries` (owned; RLS enabled + forced; migration `20261225090000`): ledger `(org_id, dedupe_key)` unique, FK `(org_id, activity_id)` -> `contact_activities` ON DELETE CASCADE. Key = `<mailbox uuid>:in:<provider message id>` / `<mailbox uuid>:out:<Message-ID>`; one advisory lock per key makes check-then-write atomic. Holds no personal data (ids only; no privacy-registry entry needed).
- Rows written: `contact_activities` with `activity_type` `email_received` (source `system`) or `email_sent` (source `user` + actor, or `bot` for an automation), title "Email received from X: subject" / "Email sent to X (+N): subject", body = first 240 characters of the text without quoted earlier mail, `occurred_at` = when the mail was sent. `contacts.last_activity_at` is bumped.
- Rules: shared mailboxes only (a personal mailbox leaves nothing: the timeline is read by everyone who may read the contact); `automated` mail (auto-reply, list, flood-limited) excluded; bounce reports never get here (consumed first); never throws (a failure is logged and the mail is unaffected). No audit row and no outbox event per mail (the mail is itself the log; same as the speed-to-lead and form-submission timeline writers).
- Read: unchanged and the CRM's: `GET /v2/contacts/:id/activities` applies the caller's `record.contacts.read` scope. Web: the contact detail Timeline already renders title and body, so no web change.
- Not covered: campaign mail (`EmailEngineSender` records its own recipient rows), mail of the quiet first import when the thread had no contact yet, deep link from an entry to its conversation (BL-227).
- Tests: `test/unit/channel-email/mail-timeline-rules.spec.ts`, `test/e2e/channel-email/mail-timeline.e2e.spec.ts`.

## E-17 wiring (Microsoft Graph change notifications)

- Route: `POST /v2/public/email/microsoft/push` (`MailGraphPushController`, public, in `tools/auth-audit/baseline/public-routes.json`). `?validationToken=` -> 200 `text/plain` echo (only while push is configured; else 404); a JSON `{value:[...]}` body -> 202 at once, then `MailGraphPushService.handle`.
- Verification: `clientState` = `<orgId>.<mailbox uuid>.<HMAC>` (`graph-push-rules.ts`, key from `CREDENTIALS_ENCRYPTION_KEY` via HKDF with its own label) AND `subscriptionId` equal to `mail_mailboxes.push_state.id` AND mailbox connected AND plan feature `email_channel`; anything else is dropped. A valid change/`missed` -> `MailSyncPublisher.enqueue` (job id per mailbox); `reauthorizationRequired` -> `push_state.renewNow = true`; `subscriptionRemoved` -> `push_state = null`.
- Subscription life: `MicrosoftMailDriver.push` (`MailPushSupport`: `start` renews in place or creates, `stop` deletes) driven by `MailPushService.sweep` (every 2 minutes in the worker, now over `google` and `microsoft`), `GraphMailClient.createSubscription/renewSubscription/deleteSubscription`, `MicrosoftMailConfig.push()`. `MailboxesService.disconnect` already calls `driver.push.stop`. `MailSyncSweep` skips a push-active mailbox synced within `MAIL_PUSH_RECONCILE_MINUTES` (provider-agnostic).
- Settings/env: `MAIL_GRAPH_PUSH_ENABLED` (default off), `MICROSOFT_MAIL_NOTIFICATION_URL` (optional override; otherwise the redirect URI's origin + the path, which must be public https), `MAIL_PUSH_RENEW_BEFORE_HOURS`. No operator-console field, no migration, no new permission. Runbook: `docs/runbooks/microsoft-mail-setup.md` section 5.
- Tests: `test/unit/channel-email/graph-push-rules.spec.ts`, `test/e2e/channel-email/microsoft-push.e2e.spec.ts` against `fake-graph.ts` (`/subscriptions`, validation handshake driven through the real route). Never run against Microsoft.

## E-08 / E-11 wiring (Test credentials, sync lag)

- Routes: `POST /v2/email/mailboxes/test-imap` (settings in the body) and `POST /v2/email/mailboxes/:id/test` (saved login), both `mail.mailboxes.manage` | `mail.mailboxes.manage_personal`, plan feature `email_channel`; the stored one needs the same right as Sync now (`mayAct(..., 'sync')`) and works on `connected`, `error` and `needs_reauth`. Limit 6 runs a minute per workspace (Redis `mail:test:<org>`, 429 `MAIL_RATE_LIMITED`).
- Code: `MailConnectionTester` (`mail-connection-test.service.ts`), `PasswordMailDriver.test` implemented by `ImapMailDriver.test` (both sides always tried; connect, sign in, open the INBOX and read its count; SMTP connect/greet/sign in, nothing sent), pure wording rules `mail-test-rules.ts`, shared connection builder `passwordConnectionOf`. The SSRF guard and certificate rules of connect/sync apply. Answers carry only our sentences and reason codes (never a host, banner or password). No audit row (nothing changes); the run is logged with workspace and user.
- Contract: `testImapMailboxSchema`, `mailConnectionTestResponseSchema` (+ step/reason enums), `MailboxResponse.syncLagSeconds` (seconds since the last successful sync of a connected mailbox; null otherwise and on summary rows).
- Web: `ImapConnectDialog` ("Test credentials", result under the form), `MailboxCard` ("Test connection" on IMAP mailboxes that are not disconnected, "Behind by" row, orange past 10 minutes), `connection-test-result.tsx`, `lib/test-view.ts`, `buildTestInput` in `lib/imap-form.ts`, strings `email.imap.test.*` and `email.card.test|testing|lag*` in 21 languages, help guide `email-mailboxes.md`.
- Tests: `imap-test-credentials.spec.ts`, `mail-test-rules.spec.ts`, `mail-test-credentials.e2e.spec.ts`, web `connection-test.render.test.tsx`, `test-view.test.ts`, `imap-form.test.ts`, `hub-screen.render.test.tsx`.
