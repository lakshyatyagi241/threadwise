# Chat conversations (CHAT): data model

The conversation core of the team inbox: channels, conversations, messages, the idempotency ledger and the message event log.
Plan: [plan-inbox-chat.md](../threadwise-port/plan-inbox-chat.md) (sections 3.3 and 3.4). Contracts:
`packages/contracts/src/chat-conversations/` (`channels.ts`, `conversation.ts`, `message.ts`, `enums.ts`). Drizzle mirror:
`packages/db/src/schema/chat-conversations/`. This file holds the data-model part; the routes and the pipelines are added with the API.

Migrations, in order (all forced RLS; tenant tables use composite foreign keys, the streams have none; applied after the channel registry):

| Migration                                           | What it does                                                                                                                                               |
| --------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `20261014090000_chat_channels`                      | `channels` (the channel registry, see its own migration header).                                                                                           |
| `20261014100000_chat_conversation_reshape`          | Reshapes `conversations` (below). Discards pre-reshape development rows.                                                                                   |
| `20261014100100_chat_messages_fold`                 | Folds Reference's `messages` and `inbox_messages` into one monthly partitioned `messages`. Drops `inbox_messages`.                                         |
| `20261014100200_chat_ledger_events`                 | `message_ledger` (idempotency, receipt routing) and `message_events` (partitioned event log).                                                              |
| `20261014100300_tib1_saved_replies_shortcut_unique` | One saved reply per shortcut per owner (`NULLS NOT DISTINCT`: one shared reply per shortcut).                                                              |
| `20261014100400_tib2_agent_last_assigned_at`        | `agent_statuses.last_assigned_at`, the round-robin clock.                                                                                                  |
| `20261014100500_chat_channel_fks`                   | Composite foreign keys from `conversations` and `message_ledger` to `channels` (`RESTRICT` and `CASCADE`).                                                 |
| `20261014100600_chat_messages_no_fks`               | Drops the four foreign keys the fold gave `messages` (a stream has none, schema-invariants) and adds the trigger that deletes a thread's messages with it. |

No new permission keys: `inbox.conversation.*` and the routing, SLA and saved-reply keys came with the workspace presets
(`20261013100000_rbac_workspace_presets`), and `inbox.channel.manage` with the channel registry. Plan catalogue keys added for the area:
features `inbox_sla`, `inbox_routing`, `inbox_kanban`, `team_performance`; limits `saved_replies`, `routing_rules`.

## `conversations`

One perpetual thread per `(channel, peer)`. A thread exists before, or without, a contact.

| Column                                                                                          | Meaning                                                                                                                                             |
| ----------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `channel_id`                                                                                    | The channel the thread sits on (composite FK to `channels`, `RESTRICT`). Replaces Reference's `device_id` + `provider` + `platform` + `channel`.    |
| `peer_key`, `peer_name`                                                                         | The peer on that channel: normalised digits for phone channels, the channel's own thread id otherwise. **Unique `(org_id, channel_id, peer_key)`.** |
| `contact_id`                                                                                    | Nullable link to `contacts` (`ON DELETE SET NULL`). `needs_contact` marks a thread created while the contact quota was reached.                     |
| `status`                                                                                        | One lifecycle: `open`, `pending`, `snoozed`, `resolved`, `closed`, `spam` (Reference's `inbox_status`; `status` and `is_spam` are gone).            |
| `priority`                                                                                      | `low`, `normal`, `high`, `urgent`.                                                                                                                  |
| `msg_seq`                                                                                       | Highest `messages.seq` handed out. Allocated by `UPDATE ... SET msg_seq = msg_seq + 1 RETURNING` under the row lock.                                |
| `last_message_id`, `last_message_at`, `preview`                                                 | The latest message (internal id), its time and a plain-text preview.                                                                                |
| `last_inbound_at`, `last_outbound_at`, `unread_count`                                           | Activity stamps and the unread counter (never negative).                                                                                            |
| `window_expires_at`                                                                             | Free-form replies are allowed until this instant (inbound time + the channel's `windowHours`); NULL = no window rule.                               |
| `waiting_since`                                                                                 | Start of the current wait for a human answer: set by the first unanswered inbound, cleared by a reply. The SLA anchor.                              |
| `assignee_user_id`, `assignee_team_id`, `assignee_agent_id`                                     | Assignment. Written only by the assignment service (team-inbox-routing-sla).                                                                        |
| `first_response_at`, `resolved_at/by`, `snoozed_until`, `sla_*`, `escalation_*`, `routing_meta` | Lifecycle, SLA and routing state, as Reference's.                                                                                                   |
| `customer_language`                                                                             | Pinned once by translation.                                                                                                                         |
| `archived`, `pinned_at`, `muted_at`                                                             | List flags.                                                                                                                                         |

Dropped from Reference: `user_id`, `device_id`, `contact_group_id`, `raw_jid`, `alt_jid`, `contact_digits`, `platform`, `provider`,
`origin`, `channel`, `recipients_count`, `scheduled_at`, `scheduled_timezone`, `interested_*`, `inbox_status`, `is_spam`.

Indexes: the list (`org_id, status, archived, pinned_at DESC NULLS LAST, last_message_at DESC, id DESC`), assignee user and team, unread
(partial), contact, and four partial **sweep** indexes (`snoozed_until`, `escalation_due_at`, `sla_first_response_due`,
`sla_resolution_due`) that deliberately do not start with `org_id`: the sweeps run privileged across workspaces.

## `messages` (the one stream)

Monthly `RANGE (created_at)` partitions with a `_default` catch-all, primary key `(id, created_at)`; partition maintenance discovers the
parent by itself. Bodies are plain text under RLS (owner decision 9), with a trigram GIN index on `body`.

| Column                                                                              | Meaning                                                                                                                                    |
| ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `uuid`                                                                              | The id on the wire. Not globally unique by constraint (partitioned); lookups use `(org_id, uuid)`.                                         |
| `conversation_id`, `seq`                                                            | Thread and position in it (positive, gap-free per thread). `(org_id, conversation_id, seq)` is the thread index.                           |
| `direction`                                                                         | `in` or `out`.                                                                                                                             |
| `kind`                                                                              | `text`, `image`, `video`, `audio`, `voice`, `document`, `sticker`, `location`, `contact`, `template`, `reaction`, `interactive`, `system`. |
| `sender_kind`, `sender_user_id`, `sender_agent_id`                                  | `customer`, `agent`, `bot`, `system`, `broadcast`; the staff user or AI agent (plain references: no foreign key on a stream).              |
| `body`, `translated_body`, `detected_language`, `is_translated`                     | Text and the translation columns (names unchanged so the translation shim only changed a table name).                                      |
| `media_key`, `media_mime`, `media_size`, `media_name`, `media_sha256`               | Media reference into the media store. The key is stored, never a URL.                                                                      |
| `latitude`, `longitude`                                                             | Location messages.                                                                                                                         |
| `status`                                                                            | `received` (inbound only, enforced), then `queued`, `sent`, `delivered`, `read`, `failed`. Rank rule below.                                |
| `failure_code`, `failure_reason`                                                    | Why a send failed (`SIM_REJECTED`, a Meta error code, a platform code).                                                                    |
| `client_message_id`, `provider_message_id`                                          | The sender's id for an outbound message; the channel's id. Lookups and uniqueness go through the ledger.                                   |
| `reply_to_message_uuid`, `reaction`, `starred`, `pinned`, `edited_at`, `deleted_at` | Reply link (a `uuid`, nothing joins on it) and the message actions.                                                                        |
| `template_id`                                                                       | `wa_templates` (plain reference).                                                                                                          |
| `meta`                                                                              | Channel-specific leftovers (template name and buttons, `forwarded`, contact card ...). `jsonb`, default `{}`.                              |
| `provider_ts`, `sent_at`, `delivered_at`, `read_at`, `created_at`                   | Provider time of the event, the receipt times, the row time (partition key).                                                               |

Constraints worth knowing: `(direction = 'in') = (status = 'received')`; `kind`, `sender_kind`, `status` are CHECK lists mirrored in
`@crm/contracts` (`chat-conversations/enums.ts`); the stream has no foreign keys (schema-invariants), so a `BEFORE DELETE` trigger on `conversations` deletes a thread's messages with it.

Dropped from Reference: `to_number`, `from_number`, `media_path`, `media_type`, `agent_id`, `contact_id`, `user_id`, `provider`,
`scheduled_at`, `quality_*`, `voice_transcript*`, `ai_processed_at`, `ai_reply_id`.

### Receipts are monotonic

`queued (0) < sent (1) < delivered (2) < read (3)`. A receipt updates the row only when it moves forward; `failed` is reachable only from
`queued` or `sent` and never replaces `delivered` or `read`; nothing leaves `failed` except a retry (a new `queued` attempt). The same
rule as a pure function: `canAdvanceMessageStatus` in `@crm/contracts`, which the web uses too. Every receipt is appended to
`message_events` even when it does not change the row.

## `message_ledger`

Flat, not partitioned. Exists because a partitioned table cannot enforce a unique key that omits the partition column.

- **Unique `(org_id, channel_id, kind, key)`** with `kind` = `provider_id` (the channel's message id) or `client_id` (the sender's own id).
- Inbound: `INSERT ... ON CONFLICT DO NOTHING RETURNING id` first; no row back means a duplicate delivery and the pipeline stops.
- Receipts: the provider id in a receipt finds `message_id` + `message_created_at` here (a primary-key lookup in one partition).
- The message does not exist yet when the ledger row is written, so the pipeline allocates the id and timestamp first in the same
  transaction: `nextval('messages_id_seq')` and `statement_timestamp()`, then inserts the message with them.
- Swept after about 60 days (`created_at` index). Cascades with the conversation and with the channel.

## `message_events`

Monthly partitioned stream (`queued`, `attempt`, `retry`, `sent`, `delivered`, `read`, `failed`) with `detail jsonb`; `created_at` is
the time the event happened. Retention about 180 days (a sweep is not built yet). No foreign keys, like `conversation_events`.

## Writers other than the pipeline

The message pipelines (see "Message pipelines" below) are the writers of the stream for the inbox. Three shims still write the folded
tables directly and take the next `msg_seq` the same way (`UPDATE conversations SET msg_seq = msg_seq + 1 ... RETURNING`, then insert the
message): the chatbot widget gateway (`modules/chatbot-widget/_shims/sql-inbox-gateway.ts`, which also creates one `webchat` channel per
widget), the broadcast inbox mirror (`modules/broadcasts/broadcast-inbox-mirror.service.ts`; it can move to
`ConversationsFacade.recordOutbound`, which does the same under the ledger) and, read-only plus the translation columns, the translation
store (`modules/localization-translation/conversation-message-store.ts`). The dashboards repository reads `messages`.

---

# Chat conversations (CHAT): channels

The channel registry, the channel port, the dispatcher, the dev simulator and the public webhook door (plan-inbox-chat.md Phase 0,
sections 3.2 and 3.4). Base path `/v2`. Errors are `application/problem+json` with a stable `code`; the codes this part adds are the
`CHANNEL_*` entries in `@crm/contracts` (`chat-conversations/channel-errors.ts`). Shapes: `packages/contracts/src/chat-conversations/channels.ts`.
Code: `apps/api/src/modules/chat-conversations/` (registry, controllers, dispatcher) and `apps/api/src/infra/providers/chat-conversations/` (the port
and the adapters). Every id on the wire is a uuid.

## What a channel is

One connected way of talking to customers: a WhatsApp Cloud number, the web chat widget of one site, the dev simulator. A conversation names
exactly one channel (`conversations.channel_id`); a send and a webhook name one too. This replaces Reference's `device_id` plus `provider` pin
(its `devices.id` and `wa_provider_configs.id` collide, so every query had to carry the provider).

Table `channels` (migration `20261014090000_chat_channels`, forced RLS, composite FKs, `row_version`):

| Column                                | Meaning                                                                                                                               |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `kind`                                | The adapter: `simulator`, `whatsapp_cloud`, `webchat`. A plain token in the database, so a new channel type is code, not a migration. |
| `status`                              | `connected` (may send), `disconnected` (stored, silent), `error` (the provider refused our credentials; set by the system only).      |
| `external_id`, `display_address`      | The provider's handle (WhatsApp phone number id) and what a person recognises it by. Unique `(org_id, kind, external_id)`.            |
| `credentials_enc`, `credential_hints` | One sealed JSON document (AES-GCM, `CryptoService`) and the last four characters of each secret inside it. A CHECK refuses plaintext. |
| `webhook_token_hash`                  | SHA-256 of the verify token the provider's challenge echoes. The token itself is shown once and never stored.                         |
| `capabilities`                        | Per-channel overrides of what the adapter reports (a number that cannot send templates). `{}` = the adapter's own report.             |
| `settings`                            | `{ metered, simulator? }`, see below.                                                                                                 |
| `last_event_at`                       | Bookkeeping for the pipeline (a message came in or went out).                                                                         |

A channel with conversations cannot be deleted: the foreign key from `conversations` is `RESTRICT` (`CHANNEL_IN_USE`).

## Secrets

- Credentials are sealed by `ChannelVault` before they are written and opened only where a send or a webhook needs them
  (`ChannelRegistryService.runtime`). The read queries never select `credentials_enc` or `webhook_token_hash`, so no list or read can leak
  them; responses carry `hasCredentials` and `credentialHints` (last four characters) only.
- The webhook verify token is returned once, by create and by rotate, and kept as a hash. `create` and `rotate` are therefore **not**
  `@Idempotent`: the idempotency store would keep the response.
- Audit rows and outbox events never contain a secret (a credentials change is audited as `[rotated]`).
- Another workspace's channel is `404` on every route, and its secrets are not selectable even by id (forced RLS; tested as the app role).

## Capabilities

| Key                       | Scope | Grants                                                                                                                    |
| ------------------------- | ----- | ------------------------------------------------------------------------------------------------------------------------- |
| `inbox.conversation.read` | yes   | list and read channels (no secrets): the inbox shows which channels exist. Existing key.                                  |
| `inbox.channel.manage`    | no    | connect, edit, rotate, remove, and use the dev simulator routes. New (`20261014090100`); Owner and Admin presets hold it. |

## Routes

| Method and path                            | Capability                | Purpose                                                                                                                                                                                                                                                                                                              |
| ------------------------------------------ | ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /channels`                            | `inbox.conversation.read` | The workspace's channels with capabilities, settings, hints, webhook URL. A row whose kind has no adapter here is left out.                                                                                                                                                                                          |
| `GET /channels/:id`                        | `inbox.conversation.read` | One channel.                                                                                                                                                                                                                                                                                                         |
| `POST /channels`                           | `inbox.channel.manage`    | Connect a provider account (`kind: whatsapp_cloud` with `credentials`). Stored `disconnected`. The answer carries `webhookVerifyToken` once. `409 CHANNEL_ALREADY_CONNECTED` for the same account.                                                                                                                   |
| `POST /channels/simulator`                 | `inbox.channel.manage`    | Create the dev simulator channel. `403 CHANNEL_SIMULATOR_DISABLED` unless the flag is on and the environment is not production. _Idempotent._                                                                                                                                                                        |
| `PATCH /channels/:id`                      | `inbox.channel.manage`    | `rowVersion` plus any of `name`, `status` (`connected` or `disconnected`), `settings` (partial), `credentials` (only the keys sent are replaced; the channel goes back to `disconnected`), `displayAddress`. `409 ROW_VERSION_CONFLICT`; `422 CHANNEL_KIND_UNAVAILABLE` when connecting a kind that cannot send yet. |
| `POST /channels/:id/webhook-token`         | `inbox.channel.manage`    | New verify token (shown once); the old one stops working. `422` for a kind with no webhook.                                                                                                                                                                                                                          |
| `DELETE /channels/:id`                     | `inbox.channel.manage`    | Remove a channel with no conversations (`204`), else `409 CHANNEL_IN_USE`.                                                                                                                                                                                                                                           |
| `GET /webhooks/channels/:channelUuid`      | public                    | Provider subscription challenge (`hub.mode=subscribe`, `hub.verify_token`, `hub.challenge`): echoes the challenge for the right token.                                                                                                                                                                               |
| `POST /webhooks/channels/:channelUuid`     | public (signature)        | A provider delivery. See below.                                                                                                                                                                                                                                                                                      |
| `POST /dev/simulator/channels/:id/inbound` | `inbox.channel.manage`    | The pretend customer sends text, media or a location (`202`). `404` unless the simulator is on.                                                                                                                                                                                                                      |
| `POST /dev/simulator/channels/:id/receipt` | `inbox.channel.manage`    | Force a delivery step (`sent`, `delivered`, `read`, `failed`) for a message, with an optional delay, in any order (`202`).                                                                                                                                                                                           |

Writes leave one audit row (`module = channels`) and one outbox event (`channel.created`, `channel.updated`, `channel.deleted`) in the same transaction.

## The channel port

`ChannelAdapter` (`infra/providers/chat-conversations/channel.port.ts`): `capabilities`, `windowInfo` (the 24 hour rule), `send` (text, media,
template, reaction, location, as one `OutboundEnvelope`), `verifyInbound` (raw body, never skipped), `parseInbound` (messages and receipts, normalised;
never throws on an unknown shape), `externalIdOf`, optional `fetchMedia`, plus `live` (can it send yet), `publicWebhook` and the credentials schema.
A failed send throws `ChannelError { code, retryable }`: retryable goes back to the queue, permanent marks the message failed.

| Adapter                   | State                                                                                                                                                                                                                                                  |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `SimulatorAdapter`        | Live, dev and test only (below).                                                                                                                                                                                                                       |
| `MetaCloudChannelAdapter` | **Skeleton.** Capabilities, window, signature verification (delegated to `MetaCloudProvider`) and payload normalisation are real; `send` refuses (`CHANNEL_NOT_LIVE`). A Cloud channel is stored `disconnected` and cannot be connected until Phase 2. |
| `WebchatChannelAdapter`   | **Skeleton.** Lists the widget domain's channels with web chat capabilities (no window, no templates); `send` refuses until Phase 2.                                                                                                                   |

## The dispatcher

`ChannelDispatcher` is the one place a message passes before an adapter, so no adapter can forget a check.

- `assertCanQueue(request, { monthlyUsed? })`, when the agent presses send (nothing is stored yet): channel `connected` (`CHANNEL_DISCONNECTED`),
  the channel can carry that kind (`CHANNEL_CAPABILITY_UNSUPPORTED`), the 24 hour window is open for anything but a template
  (`SERVICE_WINDOW_CLOSED`), and for a metered channel the plan's `monthly_messages` has room (`PLAN_LIMIT_REACHED`; the caller supplies the count, it owns
  the message table).
- `send(request)`, in the worker: the same channel and window checks again, then `OUTBOUND_SEND_GUARD.beforeSend` (the auth domain's
  `SendPolicyService` and `EmergencyHaltService`, so the halt stops what is already queued), then the adapter, once per `clientReference`: a send that
  succeeded is remembered 24 hours in Redis, so a retry returns the stored answer and a concurrent duplicate gets a retryable `DISPATCH_IN_FLIGHT`.
  A failure stores nothing. Residual risk (the process dies after the provider accepted, before the answer is stored) is documented in the plan, 3.4.
  `send` plans the simulator's receipts but does not queue them: the caller runs `scheduleReceipts(channel, result)` once the provider id is stored
  (the plan is part of the remembered answer, so a retry after a crash can still schedule it).
- `ChannelIngestPublisher` puts normalised inbound messages and receipts on `webhook-ingest` (job name `channel.ingest`; the job shape is
  `channelIngestJobSchema`). The ingest processor (below) consumes them.

## The dev simulator

`kind: simulator`: WhatsApp-like (24 hour window, templates, media, reactions, all three receipts), never metered, no credentials, no webhook.

- Switched on by `CHANNEL_SIMULATOR_ENABLED=true`. **Never in production**: the constructor refuses to build there, the provider module binds
  it only outside production with the flag on, a production process that sets the flag **fails to boot**, and the policy is checked on every call
  (create is `403`, the dev routes are `404`).
- Inbound goes through the adapter's own `parseInbound` and onto the same ingest queue a real webhook feeds. `/dup <text>` (or `fault: "dup"`) delivers the
  message three times under one provider id.
- Outbound faults by a prefix on the body (or media caption): `/fail` permanent refusal (`SIM_REJECTED`), `/flaky` retryable error on attempts 1 and 2,
  `/slow` answers after 10 s, `/ooo` receipts arrive read, delivered, sent.
- Receipts after an accepted send: `sent` (0 ms), `delivered` (1 s), `read` (3 s), configurable in `settings.simulator.latencyMs`; queued as delayed jobs
  by the dispatch worker AFTER it stored the provider id (a receipt finds its message through that id).
- Window toggle: `settings.simulator.window` is `auto` (24 hours from the last inbound), `open` or `closed`.

## The public webhook door

`POST /webhooks/channels/:channelUuid` is `@Public()`: the signature is the only authentication. The channel is found through the
`chat_channel_lookup(uuid)` SECURITY DEFINER function (two ids, nothing else; there is no tenant yet), then the raw body is verified with that
channel's own secret (WhatsApp Cloud: `X-Hub-Signature-256` with the app secret in the sealed credentials). A verified delivery is normalised,
queued and answered `200 { received: true }` at once; a bad or missing signature, an empty body, or a kind with no public webhook is `401 SIGNATURE_INVALID`
with no detail; a uuid that is not a channel is `404`. A disconnected channel still takes deliveries. Rate limit 600 requests a minute per channel and address.

## For other domains

`ChannelsFacade` (barrel `modules/chat-conversations`): `list`, `findByUuid`, `findById`, all taking the caller's transaction, read-only and
secret-free. `ConversationsFacade` (token `CONVERSATIONS_FACADE`) is the door to threads and messages: see "The facade" below.

---

# Chat conversations (CHAT): message pipelines

Inbound ingest, delivery receipts, outbound enqueue and dispatch (plan-inbox-chat.md Phase 1, section 3.4). Code:
`apps/api/src/modules/chat-conversations/`. Workers: `ChatConversationsWorkerModule`, imported by `WorkersModule` only (the HTTP app stores
and enqueues, it never picks up a job).

```
simulator route / signed webhook                      agent presses send (team-inbox route -> ConversationsFacade.enqueueOutbound)
   | parseInbound (adapter)                              |  guards, queued row, ledger client_id          (one transaction)
   v                                                     v
queue webhook-ingest --channel.ingest--> ChannelIngestProcessor      queue message-dispatch --message.send--> MessageDispatchProcessor
   | inbound: InboundIngestService (one transaction per message)        | MessageDispatchService -> ChannelDispatcher.send -> adapter
   | receipt: ReceiptsService (ledger lookup, rank rule, event log)     | queued -> sent (+ ledger provider_id) -> receipts -> read
   v                                                                    v
after commit: realtime (conv room, user rooms)                      after commit: schedule simulator receipts, realtime
```

## Queues and jobs

| Queue              | Job                  | Payload                                                               | Producer                                                       | Consumer                                    | Retry                                                                                                                                                                                     |
| ------------------ | -------------------- | --------------------------------------------------------------------- | -------------------------------------------------------------- | ------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `webhook-ingest`   | `channel.ingest`     | `channelIngestJobSchema`: one inbound message or receipt (normalised) | `ChannelIngestPublisher` (webhook door, simulator, dispatcher) | `ChannelIngestProcessor` (concurrency 8)    | Queue default (5 attempts, exponential 2 s). A receipt that finds no message is retried through that backoff (it may have beaten the send's commit), then dropped.                        |
| `message-dispatch` | `message.send`       | `{ orgId, messageUuid, generation }` (ids only)                       | `OutboundService` after the commit; the recovery sweep         | `MessageDispatchProcessor` (concurrency 8)  | 8 attempts, exponential 2 s (`MESSAGE_SEND_JOB_OPTIONS`): the wait before the last attempt (about 4 minutes) outlasts a killed worker's 60 s send lock. Job id `msg-<uuid>-<generation>`. |
| `msg-log-export`   | `message-log.export` | `{ orgId, exportUuid }` (ids only)                                    | `MessageLogService.requestExport` after the commit             | `MessageLogExportProcessor` (concurrency 1) | One attempt (`MESSAGE_LOG_EXPORT_JOB_OPTIONS`): the runner records its own failure on the export row. Job id `msglog-export-<uuid>`.                                                      |

No queue was added: the health probe and the dashboards queue list are unchanged. One interval job in the worker: `QueuedMessageRecoveryService` (below).

## Inbound ingest (`InboundIngestService`)

One provider message becomes one stored message on the right thread, once, in whatever order and however often it is delivered. One transaction per message:

1. The thread is found or created under an advisory lock on (workspace, channel, peer) (`peer_key` is normalised by `normalizePeerKey`: digits for phone
   channels through the contacts canonicaliser, the channel's thread id otherwise), then its row is locked for the rest of the transaction. A new thread
   resolves its contact first (below).
2. A message id (`nextval('messages_id_seq')`) and row time (`statement_timestamp()` as text, microseconds included) are allocated BEFORE the ledger row,
   because the ledger carries both.
3. `message_ledger INSERT ... ON CONFLICT DO NOTHING`: no row back = a duplicate delivery; the transaction ends with nothing stored (outcome `duplicate`).
   The queue's job id is a shortcut, and a probe before the file download skips the common redelivery; the unique key is the authority.
4. `msg_seq` is taken from the locked row (`msg_seq + 1`, so 50 messages at once give 50 distinct gap-free numbers), the message is inserted (`status
received`, `provider_ts` = the customer's time clamped to the arrival), and the thread is updated: `last_message_*`, `preview`, `unread_count + 1`,
   `last_inbound_at` (only forward: a late older message never shortens the window), `window_expires_at` = that time + the channel's `windowHours` (null:
   no window rule), `waiting_since` (set when nobody is already waiting: the SLA anchor, the oldest unanswered message).
5. A resolved, closed or snoozed thread is reopened by the message (`pending` returns to `open`; `spam` stays `spam`): `resolved_at` / `snoozed_until`
   cleared, a `reopened` event and the outbox event `conversation.reopened`. A new thread writes a `created` event, an audit row (`conversations` insert)
   and `conversation.created`.

Contact resolution is `ContactsService.resolveOrCreateByIdentity(tx, orgId, { kind, value, name, source })` (crm barrel; the one edit outside this domain's
folders): the phone goes through the one canonicaliser and is looked up by identity (`contact_identities`), then by the stored number (a contact that predates
identities is healed with one), else created with the workspace's default stage and status, an identity, an audit row and `contact.created`, under the
contact quota (`ContactQuotaService`). It never throws for the cap: the outcome is `quota_reached` and the thread is created without a contact,
`needs_contact = true`; the next message tries again. The step runs in a savepoint, so a failure inside it costs only the contact, not the message.
**An inbound message is never dropped for a business reason.**

Media: the file is fetched (`adapter.fetchMedia`) and stored through `ChatMediaStore.storeInbound` before the transaction (no connection is held across a
network call; an orphan is removed if the transaction loses). A file the upload policy refuses leaves the message without it (`meta.mediaError =
rejected`); a download that keeps failing does the same on the queue's last attempt, so the text is never lost. Reactions decorate the message they answer
(`messages.reaction`) instead of adding a bubble; their redelivery is still a no-op through the ledger.

## Delivery receipts (`ReceiptsService`)

The provider id in a receipt finds the message (and its partition) through the ledger (per workspace and channel: another workspace cannot reach a message by
guessing an id). The status moves in one conditional UPDATE: `queued < sent < delivered < read` only forward, `failed` only from queued or sent and never over a
delivery, nothing leaves `failed`. A receipt the rule refuses still fills its time column (`delivered` after `read` tells when) and is still appended to
`message_events` (`detail.applied` says which), so the log is complete when the arrival order was not. An id nobody has is `unknown` and changes nothing. After
the commit: `inbox.message.status` to the thread's room.

A receipt names the provider id it is about, and a message whose Retry produced a new send has a new one: a late receipt of an EARLIER send of the same message
is `ignored` (its event is still logged, `applied: false`) and cannot fail or deliver the message that now belongs to the later send.

## Outbound (`OutboundService`, `MessageDispatchService`)

`enqueueOutbound` (the agent's send): one transaction holds the thread's row lock, the client-id ledger row (a repeated `clientMessageId` returns the first
message with `replayed: true`: no second row, no second send; another thread's id is `409 IDEMPOTENCY_KEY_REUSED`), the guards (below), the next `seq`, the
`queued` message and its event. After the commit the job is enqueued and the thread told (`inbox.message.new`, `inbox.conversation.upsert`). If the enqueue is
lost the message stays `queued` and the recovery sweep queues it.

Guards at enqueue (`ChannelDispatcher.assertCanQueue`; nothing is stored when one fails): `CHANNEL_DISCONNECTED`, `CHANNEL_CAPABILITY_UNSUPPORTED`,
`SERVICE_WINDOW_CLOSED` (free-form text or media more than `windowHours` after the customer's last message; a template is allowed), `PLAN_LIMIT_REACHED`
(`monthly_messages`: outbound messages of metered channels this month that did not fail, counted only for a workspace whose plan has a cap; the simulator is
never metered). At send time (the worker, `ChannelDispatcher.send`): the channel and window again, then the emergency halt and content screen
(`OUTBOUND_SEND_GUARD`), so a halt stops what is already queued.

The worker's `dispatch`: re-read the message (a job carries ids only); skip it unless `queued`; write an `attempt` event BEFORE the provider is called; send
through the dispatcher (one provider call per client reference, answered from Redis for 24 h after a success); on success one transaction moves
`queued -> sent`, writes the provider id to the ledger and the `sent` event, sets `last_outbound_at`, ends the customer's wait (`waiting_since = NULL`) and, for
a staff reply, stamps `first_response_at` once (a `first_response` event). **First response is stamped only when the provider accepted the message** (Reference
stamped it when the agent pressed send, even if the send then failed). Then the simulator's receipts are queued and the thread told (`inbox.message.status`).

Failures: a retryable `ChannelError` goes back to the queue (backoff; a message another worker is sending is delayed without using an attempt); on the last
attempt, or for a permanent refusal (`ChannelError` not retryable) or a guard (`AppError`: `AUTH_SEND_HALTED`, `AUTH_SEND_BLOCKED`, window, channel off), the
message ends `failed` with `failure_code` / `failure_reason`, no first response, the customer still waiting. `retryOutbound` puts the same message back to
`queued` (new dispatch generation, same `seq`, same row) after the same guards; only a failed outbound message qualifies. **A Retry of a message the provider
had already accepted** (it then reported a failure in a receipt, e.g. Meta 131049) first forgets the dispatcher's stored answer for that client reference
(`ChannelDispatcher.forget`) and writes `previousProviderMessageId` on the `retry` event: otherwise the worker would replay the first answer, never call the
provider, and put the message back to `sent` with its failure wiped. A message that never reached the provider has no stored answer, so nothing changes for it.

Kill-safety: the message row exists before the job, and the worker never creates one, so a worker killed anywhere cannot duplicate a message. The retry finds
it `queued` and asks the dispatcher again, which answers from the stored result if the provider had already accepted. **Residual risk, as in the plan (3.4):**
if the process dies after the provider accepted and before its answer is stored, the retry can call the provider a second time (the Cloud API has no
idempotency key). The log shows the attempt that has no outcome. A killed worker's send lock lasts 60 s.

`QueuedMessageRecoveryService` (worker, every 30 s, privileged): `queued` outbound messages older than a minute and younger than 24 h are put back on the queue
(a finished or failed job still holding the id is removed first). Safe on every worker and to repeat.

## Realtime (after commit, best effort, never inside a transaction)

| Event                       | When                                                            | Goes to                                                                                                                                                                               |
| --------------------------- | --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `inbox.message.new`         | a message was stored (inbound, queued reply, recorded outbound) | the thread's room `conv:<uuid>`: the message without a media link (`media.url` is `''`; the client fetches the page after `seq - 1` for a link made for it)                           |
| `inbox.message.status`      | sent, delivered, read, failed, queued again                     | the thread's room                                                                                                                                                                     |
| `inbox.conversation.upsert` | any stored message; first response; reopened; read              | the people who may see the thread (`AudienceResolver`, per scope); a signal: `changed` lists `lastMessage`, `unread`, `created`, `status`, `lastOutbound`, `waiting`, `firstResponse` |
| `inbox.unread`              | inbound; mark read                                              | the same audience: `{ conversationId, unread }`                                                                                                                                       |
| `rt.resync`                 | an inbound reaction                                             | the thread's room                                                                                                                                                                     |

A person whose scope does not include the thread is told nothing (tested). Outbox events (same transaction, `aggregateModule: conversations`):
`conversation.created`, `conversation.reopened`; `contact.created` when the pipeline created the contact. Messages and receipts are not outbox events.

## The facade (`ConversationsFacade`)

Token `CONVERSATIONS_FACADE`, barrel `modules/chat-conversations`. Runs under the ambient request context, own transactions, uuids on the wire. **It does not know
read scopes: the caller checks `conversationVisible` before calling** (team-inbox-conversations does).

| Method                                                                                      | Does                                                                                                                                                                                                                                                                                                                   |
| ------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `enqueueOutbound({ conversationId, clientMessageId, content, replyToMessageId?, sender? })` | The agent's send (above). `content`: `text`; `media` (a file already stored by `ChatMediaStore.store`: key, mime, size, name, sha256); `template` (name, language, variables and the text the thread shows: the TPL domain resolves it). Returns `{ message, replayed }`: the `queued` message (answer `202`).         |
| `retryOutbound(messageId)`                                                                  | Retry of a failed message. `MESSAGE_NOT_FOUND`, `MESSAGE_NOT_RETRYABLE`.                                                                                                                                                                                                                                               |
| `listMessages(conversationId, { limit, before?, afterSeq? })`                               | A thread page ascending by `seq` with `hasMoreBefore` / `hasMoreAfter`; each file is a link minted for the caller.                                                                                                                                                                                                     |
| `markRead(conversationId, upToSeq)`                                                         | `unread_count` becomes the number of customer messages after `upToSeq` (never increases); tells the audience.                                                                                                                                                                                                          |
| `openConversationFor(contactId, channelId)`                                                 | The perpetual thread of a contact on a phone channel (created when missing).                                                                                                                                                                                                                                           |
| `findThread(channelId, peerKey)`                                                            | The thread of (channel, peer), the peer normalised.                                                                                                                                                                                                                                                                    |
| `recordOutbound({ channelId, peerKey, source, body, providerMessageId?, template? })`       | A message another domain sent (a broadcast, a flow) written into the thread as `sent`; the same provider id twice is a no-op. With `template: { templateId?, name, language?, variables? }` it is stored as a `template` message (meta and template link as an inbox send), `body` staying the text the customer read. |

## Media access

`MessageMediaAccessPolicy` is bound to the media route (`MEDIA_ACCESS_POLICY`, in `app.module`): a link works only while its holder may still see the conversation
the file belongs to (`conversationVisible`, current grants), looked up through `idx_messages_media_key` (migration `20261015100000_chat_messages_media_key_idx`). A
key on no message yet (an upload waiting in the composer) passes: the link was minted by code that had authorised the person. The worker registers the same
`ChatMediaModule` as the HTTP app, because inbound files are stored by the ingest job.

## The message log (delivery log, archive, export)

`message_events` is the exact log of every message: `queued`, each `attempt`, `sent` (the pipeline: the provider accepted it), the provider's own `sent` /
`delivered` / `read` / `failed` receipts (`detail.providerAt` marks these), `retry` (the queue's own, or an agent's: `manual`, `by`). Nothing is dropped, including a
receipt that did not move the status (`applied: false`).

- **Read one message's log**: `GET /v1/inbox/messages/:id/log` (`inbox.conversation.read`, same visibility as the thread) returns the status now, the failure, and every event
  oldest first (`messageLogResponseSchema`): `source` (`system` or `provider`), provider id, `errorCode` / `errorMessage` (the two writers' keys read the same), attempt,
  who retried, `applied`, `replayed`. Events older than 90 days come from the archive (`fromArchive`); a message past the retention has `expired: true`.
- **Archive** (`MessageLogArchiveService`, worker, daily 02:17): every workspace's events of a UTC day older than `MESSAGE_LOG_HOT_DAYS` (90) are written as one gzip NDJSON object
  into `message_event_archives` (`bytea`, one row per workspace and day) and deleted from `message_events` in the SAME transaction, so an event is always in exactly one place; a
  count mismatch rolls the day back. Resumable (at most 45 days a run, oldest first), idempotent (a second run finds nothing; a stray late event is appended as another gzip member).
  The same run deletes archive days older than `MESSAGE_LOG_RETENTION_DAYS` (365), deletes the file of an export past its 7 days (status `expired`), and fails an export that has been
  `running` for an hour (its worker died). Why Postgres and not a bucket: the bucket is optional in this stack and a local disk is not shared by the API and the worker.
- **Export** (`inbox.logs.export`, the locked Admin preset has it): `POST /v1/inbox/message-logs/exports` `{ from, to, messageStatus? }` (UTC days, `to` not in the future, `from` not older than
  365 days; `422 MESSAGE_LOG_EXPORT_RANGE_INVALID`) records the request and enqueues `msg-log-export` (`202`); one active export per workspace (`409 MESSAGE_LOG_EXPORT_IN_PROGRESS`).
  The worker (`MessageLogExportRunner`) claims the row, reads each day's archive object and live rows oldest first, puts the recipient, channel, template and status now next to each event
  (a message that no longer exists leaves them blank), writes a formula-safe CSV (stops at 2,000,000 lines: `failed` with the reason), stores it gzipped on the row for 7 days and
  emails the requester a link to `/inbox/message-logs?export=<id>` (the file itself is never attached or linked without a session). `GET .../exports` lists, `GET .../exports/:id/download`
  streams the CSV (`409 MESSAGE_LOG_EXPORT_NOT_READY` when queued, failed or expired). A mail that cannot be sent never fails the export.
- Dev simulator: a message starting `/bounce` is accepted and then reported failed by a receipt (`ECOSYSTEM_ENGAGEMENT_BLOCKED`, as Meta 131049), and every Retry of it is a new send.

## Errors

`SERVICE_WINDOW_CLOSED`, `CHANNEL_DISCONNECTED`, `CHANNEL_CAPABILITY_UNSUPPORTED`, `PLAN_LIMIT_REACHED` (all `422`, at enqueue); `CONVERSATION_NOT_FOUND`,
`MESSAGE_NOT_FOUND` (`404`, also for another workspace's ids); `MESSAGE_NOT_RETRYABLE`, `IDEMPOTENCY_KEY_REUSED`, `MESSAGE_LOG_EXPORT_IN_PROGRESS`, `MESSAGE_LOG_EXPORT_NOT_READY` (`409`); `MESSAGE_LOG_EXPORT_RANGE_INVALID` (`422`); `MESSAGE_LOG_EXPORT_NOT_FOUND` (`404`). At send time the message ends `failed` with
`AUTH_SEND_HALTED` / `AUTH_SEND_BLOCKED` (the guard), `SIM_REJECTED` (the simulator), `CHANNEL_NOT_LIVE` (an adapter that cannot send yet), a provider's own code, or
`DISPATCH_ERROR` (retries exhausted on an unclassified error).

## Not built here

The ledger sweep (60 days) is not scheduled yet; the message-event log is kept and archived by the message log (below); routing, auto-reply and opt-out stages of the ingest (plan 3.4 step 6, Phase 2+);
inbound reactions are stored on the target message only (no reaction send); an inbound `contact` card carries no card; the web chat widget's own inbound still goes
through its shim.

## Tests

Unit (`apps/api/test/unit/chat-conversations/`): peer-key normalisation, receipt rank and arrival orders, window computation, previews and kinds, the wire mapper, the
processors' retry and delay decisions, the dispatcher, the simulator faults. Integration (`test/integration/chat-conversations/message-pipeline-sql.spec.ts`, real Postgres as the
restricted role): 50 parallel inbound on a thread that does not exist yet give one thread and 50 gap-free numbers, 20 duplicate deliveries store one message, the ledger names a
message to the microsecond, every receipt order ends at `read`, `failed` rules, unread, and isolation of every repository call between two workspaces. E2E
(`apps/api/test/e2e/chat-conversations/`; `pipeline-support.ts` runs the worker processors inside the test app): `message-ingest.e2e.spec.ts` (inbound, contact, reopen,
duplicates 20x and 3x, 50 in parallel through the queue, the contact cap, realtime audience, the signed webhook, unknown receipts), `message-send.e2e.spec.ts` (send to
`read`, idempotency, `/fail` and Retry, `/flaky`, `/ooo`, forced receipts, window, channel, monthly cap, emergency halt, a crash before the commit, a worker really killed
mid-call and finished by another, the recovery sweep, cross-tenant) and `message-log.e2e.spec.ts` (Retry after an accepted-then-failed send really resends and a late receipt of the first send is ignored, the log of a message, the archive sweep moves events once and the log still reads them, an export of live plus archived events, range refusals) and `conversations-facade.e2e.spec.ts` (thread paging, mark read, thread lookups, `recordOutbound`, the media
access rule, joining a room).
