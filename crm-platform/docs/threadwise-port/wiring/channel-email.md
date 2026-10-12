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

`mail_mailboxes` (owned; RLS enabled + forced; sealed tokens, `history_id`, `last_error`, `channel_uuid` -> `channels (org_id, uuid)`),
`channels` (kind `email`, through `ExternalChannelIngest.sync`; external id = mailbox uuid), `conversations` / `messages` / `message_ledger` (through
`ExternalChannelIngest.inbound`; ledger key = Gmail message id), `contacts` (linked by email identity through the same call), `audit_log` (module
`mail_mailboxes`), `event_outbox`, `org_plan_state` / `plans` (feature `email_channel`, limit `email_mailboxes`), `platform_settings` (group
`googleMail`, secret `clientSecret`). Files go to the chat object store (`chat/<org>/...` keys), never to Postgres.
No SECURITY DEFINER lookup: the public callback carries workspace and admin in its signed state.

## Settings and environment read

| Setting                                                                    | Where                                 | Reader                                  |
| -------------------------------------------------------------------------- | ------------------------------------- | --------------------------------------- |
| `googleMail` `{enabled, clientId, redirectUri}` + secret `clientSecret`    | platform settings (operator console)  | `GoogleMailConfig` (env fallback below) |
| `GOOGLE_MAIL_CLIENT_ID/SECRET/REDIRECT_URI`                                | environment                           | `GoogleMailConfig` fallback             |
| `GOOGLE_OAUTH_*`, `GMAIL_API_URL`, `GOOGLE_MAIL_HTTP_TIMEOUT_MS`, `MAIL_*` | `config/domains/channel-email.env.ts` | provider clients, sync, ingest          |
| plan feature `email_channel`, limit `email_mailboxes`                      | plan catalogue                        | `@RequirePlanFeature`, `MailPlan`       |

## Queues and workers

Queue `mail-sync` (`QUEUES.MAIL_SYNC`): one job per mailbox, job id `mail-sync-<mailbox uuid>` (never queued twice), 3 attempts with 15 s exponential
backoff, removed on completion. Producers: `MailSyncPublisher` (the sweep, the connect callback, Sync now). Consumer: `MailSyncProcessor`
(concurrency 4), registered only by `ChannelEmailWorkerModule` (imported by `WorkersModule`). `MailSyncSweep` runs every 60 s in the worker: connected
mailboxes (and `error` ones after 5 minutes) of workspaces that own `email_channel`, and only while the platform has a Google client.

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
- Marketplace app `email` and the `googleMail` settings group are the add-on packaging's.
