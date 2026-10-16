# Wiring map: channel-viber (VIB)

Hand-written from the controllers, repositories and web routes on branch `lakshya/channels/viber`; update it in the same change as any new route, table, queue or consumer.

## API routes

| Method | Path                                   | Permission                |
| ------ | -------------------------------------- | ------------------------- |
| GET    | `/v2/viber/channels`                   | `viber.channels.read`     |
| POST   | `/v2/viber/channels`                   | `viber.channels.manage`   |
| POST   | `/v2/viber/channels/:id/retry-webhook` | `viber.channels.manage`   |
| POST   | `/v2/viber/channels/:id/toggle`        | `viber.channels.manage`   |
| DELETE | `/v2/viber/channels/:id`               | `viber.channels.manage`   |
| GET    | `/v2/viber/channels/:id/users`         | `viber.broadcasts.read`   |
| GET    | `/v2/viber/insights`                   | `viber.channels.read`     |
| GET    | `/v2/viber/broadcasts/compose`         | `viber.broadcasts.read`   |
| GET    | `/v2/viber/broadcasts`                 | `viber.broadcasts.read`   |
| POST   | `/v2/viber/broadcasts`                 | `viber.broadcasts.manage` |
| POST   | `/v2/viber/broadcasts/:id/start`       | `viber.broadcasts.manage` |
| POST   | `/v2/viber/broadcasts/:id/pause`       | `viber.broadcasts.manage` |
| POST   | `/v2/viber/broadcasts/:id/retry`       | `viber.broadcasts.manage` |
| DELETE | `/v2/viber/broadcasts/:id`             | `viber.broadcasts.manage` |
| POST   | `/v2/viber/inbound/:token`             | public (HMAC signature)   |

Every controller carries `@RequirePlanFeature('extra_channels')`, `@ActorKinds('user')` and a permission; the webhook controller is `@Public()` and listed in `tools/auth-audit/baseline/public-routes.json` and `non-idempotent-post-routes.json`.

## Web screens

- `/viber` (hub: connect form, channels, guide), `/viber/broadcasts`, `/viber/broadcasts/create`, `/viber/insights` (route group `(viber)`, feature `features/channel-viber`).
- Settings > Channels tile `viber` (`features/channel-viber/settings.ts`, gate `viber.channels.read`; the "Soon" placeholder in `settings-planned.ts` is removed).
- Campaigns "Pick a channel" card `viber` (`features/broadcasts/api/channels.ts`, `lib/channel-cards.ts`, `messages/*/broadcasts.json` chooser); links to `/viber/broadcasts`; shown when a channel is active and both read permissions are held.
- Help guide `viber-channel` (`documents: [tile:viber]`); messages `messages/<locale>/viber.json`.

## Tables read or written

`viber_channels`, `viber_broadcasts`, `viber_broadcast_recipients` (additive columns `message_token`, `delivered_at`, `seen_at`; on broadcasts `delivered`, `seen`, `media_size`, migration `20261203090200_vib_receipt_tokens.sql`), `channels` (kind `viber`, mirrored), `conversations`, `messages`, `contacts` (`channel = 'viber'`, `channel_uid` = the Viber user id), `wa_templates` (channel `viber`), `permission_defs`/`role_grants` (migration `20261203090000_vib_permissions.sql`), function `vib_channel_lookup` (`20261203090100_vib_channel_lookup.sql`, granted to `crm_app_user` and `crm_worker_user`). `viber_flow_sessions` was dropped by `20261216090000_drop_dormant_tables.sql` (Reference keeps Viber flow sessions in Node memory and never writes it; flow state is `flow_runs`, TW-FLR-070 wontfix, TW-NODE-050). Pending owner confirmation: punya.

## Queues and workers

`viber-broadcast` (`QUEUES.VIBER_BROADCAST`): one job per start of a broadcast, `VibBroadcastProcessor` in `ChannelViberWorkerModule` (imported only by `WorkersModule`). Delivery receipts go to the existing `webhook-ingest` queue through `ChannelIngestPublisher`.

## Outbox events emitted

`viber.channel.connected`, `viber.channel.disconnected`, `viber.broadcast.created`, `viber.broadcast.started`, `viber.broadcast.paused`, `viber.broadcast.retry_requested`, `viber.broadcast.deleted`.

## Consumers of the channel (what else reads it)

- Inbox: the `viber` `ChannelAdapter` (registered in `ChannelAdapterRegistry`, API and worker) carries replies; threads and unread come from `ExternalChannelIngest`.
- Flow builder: `viber_channels` is read for the channel list of the Trigger node (`flow-builder-editor`); flow runtime launches `viber` flows from stored messages (`launch.service.ts`, `channel-render.ts`).
- Consent: `viber` is a consent channel; the send paths are listed in `consent-gate.allowlist.ts` (the broadcast sender as a known gap).
- Privacy: manifest for `viber_broadcast_recipients` (`modules/privacy/manifests/inbox.ts`); the `viber_flow_sessions` manifest went with the table (`20261216090000_drop_dormant_tables.sql`).
- Provider port: token `VIBER_API` (`infra/providers/channel-viber/viber.port.ts`), client `ViberBotApiFactory`.

## Shims, owners and blocked consumers

- `SqlViberTemplates` reads `wa_templates` where the channel is viber until message-templates exports a channel-aware lookup.
- No plan-gate shim: the plan feature `extra_channels` gates the controllers (Reference's `access_viber` and `viber_broadcasts` are one flag here).
- TW-VIB-017 (flow hand-off, flow-log, flow-node): blocked on flow-runtime-engine; not recreated here.
- Send-time consent check on the broadcast sender: KNOWN GAP, as Telegram's.
