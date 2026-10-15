# Wiring map: channel-wechat (WECH)

Hand-written from the controllers, repositories and web routes on branch `lakshya/channels/wechat`. Update it in the same change as any new route, table, queue or consumer.

## API routes

| Method | Path                                    | Permission                 |
| ------ | --------------------------------------- | -------------------------- |
| GET    | `/v2/wechat/channels`                   | `wechat.channels.read`     |
| POST   | `/v2/wechat/channels`                   | `wechat.channels.manage`   |
| GET    | `/v2/wechat/channels/:id/server-config` | `wechat.channels.manage`   |
| POST   | `/v2/wechat/channels/:id/recheck`       | `wechat.channels.manage`   |
| POST   | `/v2/wechat/channels/:id/toggle`        | `wechat.channels.manage`   |
| DELETE | `/v2/wechat/channels/:id`               | `wechat.channels.manage`   |
| GET    | `/v2/wechat/channels/:id/chats`         | `wechat.broadcasts.read`   |
| GET    | `/v2/wechat/broadcasts/compose`         | `wechat.broadcasts.read`   |
| GET    | `/v2/wechat/broadcasts`                 | `wechat.broadcasts.read`   |
| POST   | `/v2/wechat/broadcasts`                 | `wechat.broadcasts.manage` |
| POST   | `/v2/wechat/broadcasts/:id/start`       | `wechat.broadcasts.manage` |
| POST   | `/v2/wechat/broadcasts/:id/retry`       | `wechat.broadcasts.manage` |
| DELETE | `/v2/wechat/broadcasts/:id`             | `wechat.broadcasts.manage` |
| GET    | `/v2/wechat/inbound/:token`             | public (signature)         |
| POST   | `/v2/wechat/inbound/:token`             | public (signature)         |

All behind `@RequirePlanFeature('extra_channels')` except the two public routes.

## Web screens

- `/wechat` (hub, connect modal), Settings > Channels tile `wechat` (permission `wechat.channels.read`)
- `/wechat/broadcasts` (list), `/wechat/broadcasts/create` (compose)
- Campaigns > New broadcast chooser: the WeChat card (`features/broadcasts/api/channels.ts`, `lib/channel-cards.ts`)
- Help guide `wechat-channels` (documents `tile:wechat`)

## Tables read or written

`wechat_channels`, `wechat_broadcasts`, `wechat_broadcast_recipients`; `channels` (kind `wechat`, one per channel row, external id the row id), `conversations`, `messages`, `contacts` (channel `wechat`, channel uid = OpenID), `wa_templates` (channel `wechat`, read); `wech_channel_lookup()` (SECURITY DEFINER). `wechat_flow_sessions` is declared and unused (flow hand-off blocked).

## Queues and workers

`WECHAT_BROADCAST` (`wechat-broadcast`), processor `BroadcastProcessor` in `ChannelWechatWorkerModule` (imported by `WorkersModule` only). The webhook, the adapter and the token upkeep run in the API process and in the worker (the adapter is registered by `ChannelWechatModule`, which the worker module imports).

## Outbox events emitted

`wechat.channel.connected`, `wechat.channel.disconnected`, `wechat.broadcast.created`, `wechat.broadcast.started`, `wechat.broadcast.retry_requested`, `wechat.broadcast.deleted`

## Upstream feeders and consumers

- Feeds: WeChat (webhook, GET and POST); the Campaigns chooser reads `GET /wechat/channels` to show the card.
- Consumers: the team inbox (threads, replies through the adapter), contacts (contact per OpenID), the consent gate (`WECHAT_API` is a send primitive; the adapter runs behind `ChannelDispatcher`), the flow runtime and routing through the inbox's inbound listeners (generic by channel kind).
- Redis: `wechat_hits:<token>:<minute>` (flood limit), `wechat:token:<org>:<channel>` (access-token refresh lock).

## Shims, owners and blocked consumers

- BLOCKED `TW-WECH-017` custom menu builder, `TW-WECH-018` follower insights: Reference pages not built yet (outside the first channel port).
- BLOCKED `TW-WECH-019` Node flow bridge (`flow-send`, `flow-node`) and flow sessions: depends on the flow runtime and the node bridge.
- The inbox's template picker lists WhatsApp templates only: no inbox screen sends a WeChat template message yet (the adapter accepts one).
- The consent gate: `broadcast-sender.service.ts` is a known gap (WeChat resolves the audience of an all-followers or tag send).
- Plan flags `access_wechat`, `wechat_broadcasts`, `wechat_channels_limit` and the platform switch `wechat_enabled` collapse into `extra_channels`; the cap and the switch are not enforced.
