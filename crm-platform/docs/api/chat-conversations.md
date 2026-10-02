# Chat conversations (CHAT): data model

The conversation core of the team inbox: channels, conversations, messages, the idempotency ledger and the message event log.
Plan: [plan-inbox-chat.md](../wadesk-port/plan-inbox-chat.md) (sections 3.3 and 3.4). Contracts:
`packages/contracts/src/chat-conversations/` (`channels.ts`, `conversation.ts`, `message.ts`, `enums.ts`). Drizzle mirror:
`packages/db/src/schema/chat-conversations/`. This file holds the data-model part; the routes and the pipelines are added with the API.

Migrations, in order (all forced RLS; tenant tables use composite foreign keys, the streams have none; applied after the channel registry):

| Migration                                           | What it does                                                                                                    |
| --------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `20261014090000_chat_channels`                      | `channels` (the channel registry, see its own migration header).                                                |
| `20261014100000_chat_conversation_reshape`          | Reshapes `conversations` (below). Discards pre-reshape development rows.                                        |
| `20261014100100_chat_messages_fold`                 | Folds WaDesk's `messages` and `inbox_messages` into one monthly partitioned `messages`. Drops `inbox_messages`. |
| `20261014100200_chat_ledger_events`                 | `message_ledger` (idempotency, receipt routing) and `message_events` (partitioned event log).                   |
| `20261014100300_tib1_saved_replies_shortcut_unique` | One saved reply per shortcut per owner (`NULLS NOT DISTINCT`: one shared reply per shortcut).                   |
| `20261014100400_tib2_agent_last_assigned_at`        | `agent_statuses.last_assigned_at`, the round-robin clock.                                                       |
| `20261014100500_chat_channel_fks`                   | Composite foreign keys from `conversations` and `message_ledger` to `channels` (`RESTRICT` and `CASCADE`).      |
| `20261014100600_chat_messages_no_fks`               | Drops the four foreign keys the fold gave `messages` (a stream has none, schema-invariants) and adds the trigger that deletes a thread's messages with it. |

No new permission keys: `inbox.conversation.*` and the routing, SLA and saved-reply keys came with the workspace presets
(`20261013100000_rbac_workspace_presets`), and `inbox.channel.manage` with the channel registry. Plan catalogue keys added for the area:
features `inbox_sla`, `inbox_routing`, `inbox_kanban`, `team_performance`; limits `saved_replies`, `routing_rules`.

## `conversations`

One perpetual thread per `(channel, peer)`. A thread exists before, or without, a contact.

| Column                                                                                          | Meaning                                                                                                                                             |
| ----------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `channel_id`                                                                                    | The channel the thread sits on (composite FK to `channels`, `RESTRICT`). Replaces WaDesk's `device_id` + `provider` + `platform` + `channel`.       |
| `peer_key`, `peer_name`                                                                         | The peer on that channel: normalised digits for phone channels, the channel's own thread id otherwise. **Unique `(org_id, channel_id, peer_key)`.** |
| `contact_id`                                                                                    | Nullable link to `contacts` (`ON DELETE SET NULL`). `needs_contact` marks a thread created while the contact quota was reached.                     |
| `status`                                                                                        | One lifecycle: `open`, `pending`, `snoozed`, `resolved`, `closed`, `spam` (WaDesk's `inbox_status`; `status` and `is_spam` are gone).               |
| `priority`                                                                                      | `low`, `normal`, `high`, `urgent`.                                                                                                                  |
| `msg_seq`                                                                                       | Highest `messages.seq` handed out. Allocated by `UPDATE ... SET msg_seq = msg_seq + 1 RETURNING` under the row lock.                                |
| `last_message_id`, `last_message_at`, `preview`                                                 | The latest message (internal id), its time and a plain-text preview.                                                                                |
| `last_inbound_at`, `last_outbound_at`, `unread_count`                                           | Activity stamps and the unread counter (never negative).                                                                                            |
| `window_expires_at`                                                                             | Free-form replies are allowed until this instant (inbound time + the channel's `windowHours`); NULL = no window rule.                               |
| `waiting_since`                                                                                 | Start of the current wait for a human answer: set by the first unanswered inbound, cleared by a reply. The SLA anchor.                              |
| `assignee_user_id`, `assignee_team_id`, `assignee_agent_id`                                     | Assignment. Written only by the assignment service (team-inbox-routing-sla).                                                                        |
| `first_response_at`, `resolved_at/by`, `snoozed_until`, `sla_*`, `escalation_*`, `routing_meta` | Lifecycle, SLA and routing state, as WaDesk's.                                                                                                      |
| `customer_language`                                                                             | Pinned once by translation.                                                                                                                         |
| `archived`, `pinned_at`, `muted_at`                                                             | List flags.                                                                                                                                         |

Dropped from WaDesk: `user_id`, `device_id`, `contact_group_id`, `raw_jid`, `alt_jid`, `contact_digits`, `platform`, `provider`,
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
| `sender_kind`, `sender_user_id`, `sender_agent_id`                                  | `customer`, `agent`, `bot`, `system`, `broadcast`; the staff user or AI agent (plain references: no foreign key on a stream).                                 |
| `body`, `translated_body`, `detected_language`, `is_translated`                     | Text and the translation columns (names unchanged so the translation shim only changed a table name).                                      |
| `media_key`, `media_mime`, `media_size`, `media_name`, `media_sha256`               | Media reference into the media store. The key is stored, never a URL.                                                                      |
| `latitude`, `longitude`                                                             | Location messages.                                                                                                                         |
| `status`                                                                            | `received` (inbound only, enforced), then `queued`, `sent`, `delivered`, `read`, `failed`. Rank rule below.                                |
| `failure_code`, `failure_reason`                                                    | Why a send failed (`SIM_REJECTED`, a Meta error code, a platform code).                                                                    |
| `client_message_id`, `provider_message_id`                                          | The sender's id for an outbound message; the channel's id. Lookups and uniqueness go through the ledger.                                   |
| `reply_to_message_uuid`, `reaction`, `starred`, `pinned`, `edited_at`, `deleted_at` | Reply link (a `uuid`, nothing joins on it) and the message actions.                                                                        |
| `template_id`                                                                       | `wa_templates` (plain reference).                                                                                                 |
| `meta`                                                                              | Channel-specific leftovers (template name and buttons, `forwarded`, contact card ...). `jsonb`, default `{}`.                              |
| `provider_ts`, `sent_at`, `delivered_at`, `read_at`, `created_at`                   | Provider time of the event, the receipt times, the row time (partition key).                                                               |

Constraints worth knowing: `(direction = 'in') = (status = 'received')`; `kind`, `sender_kind`, `status` are CHECK lists mirrored in
`@crm/contracts` (`chat-conversations/enums.ts`); the stream has no foreign keys (schema-invariants), so a `BEFORE DELETE` trigger on `conversations` deletes a thread's messages with it.

Dropped from WaDesk: `to_number`, `from_number`, `media_path`, `media_type`, `agent_id`, `contact_id`, `user_id`, `provider`,
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

Until the conversation facade exists, three shims write the folded tables directly and take the next `msg_seq` the same way
(`UPDATE conversations SET msg_seq = msg_seq + 1 ... RETURNING`, then insert the message): the chatbot widget gateway
(`modules/chatbot-widget/_shims/sql-inbox-gateway.ts`, which also creates one `webchat` channel per widget), the broadcast inbox mirror
(`modules/broadcasts/broadcast-inbox-mirror.service.ts`) and, read-only plus the translation columns, the translation store
(`modules/localization-translation/conversation-message-store.ts`). The dashboards repository reads `messages`.

---

# Chat conversations (CHAT): channels

The channel registry, the channel port, the dispatcher, the dev simulator and the public webhook door (plan-inbox-chat.md Phase 0,
sections 3.2 and 3.4). Base path `/v2`. Errors are `application/problem+json` with a stable `code`; the codes this part adds are the
`CHANNEL_*` entries in `@crm/contracts` (`chat-conversations/channel-errors.ts`). Shapes: `packages/contracts/src/chat-conversations/channels.ts`.
Code: `apps/api/src/modules/chat-conversations/` (registry, controllers, dispatcher) and `apps/api/src/infra/providers/chat-conversations/` (the port
and the adapters). Every id on the wire is a uuid.

## What a channel is

One connected way of talking to customers: a WhatsApp Cloud number, the web chat widget of one site, the dev simulator. A conversation names
exactly one channel (`conversations.channel_id`); a send and a webhook name one too. This replaces WaDesk's `device_id` plus `provider` pin
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
- `ChannelIngestPublisher` puts normalised inbound messages and receipts on `webhook-ingest` (job name `channel.ingest`; the job shape is
  `channelIngestJobSchema`). The ingest processor is Phase 1; until it exists jobs wait in the queue.

## The dev simulator

`kind: simulator`: WhatsApp-like (24 hour window, templates, media, reactions, all three receipts), never metered, no credentials, no webhook.

- Switched on by `CHANNEL_SIMULATOR_ENABLED=true`. **Never in production**: the constructor refuses to build there, the provider module binds
  it only outside production with the flag on, a production process that sets the flag **fails to boot**, and the policy is checked on every call
  (create is `403`, the dev routes are `404`).
- Inbound goes through the adapter's own `parseInbound` and onto the same ingest queue a real webhook feeds. `/dup <text>` (or `fault: "dup"`) delivers the
  message three times under one provider id.
- Outbound faults by a prefix on the body (or media caption): `/fail` permanent refusal (`SIM_REJECTED`), `/flaky` retryable error on attempts 1 and 2,
  `/slow` answers after 10 s, `/ooo` receipts arrive read, delivered, sent.
- Receipts after an accepted send: `sent` (0 ms), `delivered` (1 s), `read` (3 s), configurable in `settings.simulator.latencyMs`; queued as delayed jobs.
- Window toggle: `settings.simulator.window` is `auto` (24 hours from the last inbound), `open` or `closed`.

## The public webhook door

`POST /webhooks/channels/:channelUuid` is `@Public()`: the signature is the only authentication. The channel is found through the
`chat_channel_lookup(uuid)` SECURITY DEFINER function (two ids, nothing else; there is no tenant yet), then the raw body is verified with that
channel's own secret (WhatsApp Cloud: `X-Hub-Signature-256` with the app secret in the sealed credentials). A verified delivery is normalised,
queued and answered `200 { received: true }` at once; a bad or missing signature, an empty body, or a kind with no public webhook is `401 SIGNATURE_INVALID`
with no detail; a uuid that is not a channel is `404`. A disconnected channel still takes deliveries. Rate limit 600 requests a minute per channel and address.

## For other domains

`ChannelsFacade` (barrel `modules/chat-conversations`): `list`, `findByUuid`, `findById`, all taking the caller's transaction, read-only and
secret-free. `ConversationsFacade` (`recordOutbound`, `openConversationFor`, `findThread`) is declared as a contract and is implemented with the message
pipeline in Phase 1; nothing binds `CONVERSATIONS_FACADE` yet.
