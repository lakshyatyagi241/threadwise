# Wiring map: channel-line (LINE)

Written from the controllers, repositories and web routes on branch `lakshya/channels/line`; the shim notes are hand-written. Update it in the same change as any new route, table, queue or consumer.

## API routes

| Method | Path                                  | Permission                                  |
| ------ | ------------------------------------- | ------------------------------------------- |
| GET    | `/v2/line/channels`                   | `line.channels.read`                        |
| POST   | `/v2/line/channels`                   | `line.channels.manage`                      |
| POST   | `/v2/line/channels/:id/retry-webhook` | `line.channels.manage`                      |
| POST   | `/v2/line/channels/:id/toggle`        | `line.channels.manage`                      |
| PUT    | `/v2/line/channels/:id/rotation`      | `line.channels.manage`                      |
| DELETE | `/v2/line/channels/:id`               | `line.channels.manage`                      |
| GET    | `/v2/line/channels/:id/audience`      | `line.broadcasts.read`                      |
| GET    | `/v2/line/broadcasts/compose`         | `line.broadcasts.read`                      |
| GET    | `/v2/line/broadcasts`                 | `line.broadcasts.read`                      |
| POST   | `/v2/line/broadcasts`                 | `line.broadcasts.manage`                    |
| POST   | `/v2/line/broadcasts/:id/start`       | `line.broadcasts.manage`                    |
| POST   | `/v2/line/broadcasts/:id/pause`       | `line.broadcasts.manage`                    |
| POST   | `/v2/line/broadcasts/:id/retry`       | `line.broadcasts.manage`                    |
| DELETE | `/v2/line/broadcasts/:id`             | `line.broadcasts.manage`                    |
| POST   | `/v2/line/inbound/:token`             | public (`X-Line-Signature` on the raw body) |

All but the webhook are gated by the plan feature `extra_channels`.

## Web screens

- `/line` (hub: connect form, channels, token rotation, guide), Settings tile `line` in Channels
- `/line/broadcasts`
- `/line/broadcasts/create`
- Campaigns chooser card `line` (opens `/line/broadcasts`)

## Tables read or written

`line_channels`, `line_broadcasts`, `line_broadcast_recipients`, `line_flow_sessions` (unused until the flow runtime binds it), `line_rich_menus` (unused, see below), plus `channels`, `contacts`, `conversations`, `messages`, `wa_templates` (channel `line`), `organizations` (no write). `line_channel_lookup` is the only function.

## Queues and workers

`LINE_BROADCAST` (`line-broadcast`): one job per started broadcast, processed by `LineBroadcastProcessor` in `ChannelLineWorkerModule` (imported only by `WorkersModule`). The `line` ChannelAdapter is registered by `ChannelLineModule` in both processes.

## Outbox events emitted

`line.channel.connected`, `line.channel.disconnected`, `line.broadcast.created`, `line.broadcast.started`, `line.broadcast.paused`, `line.broadcast.retry_requested`, `line.broadcast.deleted`

## Upstream feeders

- LINE pushes events to `/v2/line/inbound/:token` (signed with the channel secret).
- The team inbox calls the `line` adapter for every reply typed in a LINE thread.
- Message templates with `channel = line` feed the compose page.
- The ConsentGate answers per contact for every broadcast batch.

## Downstream consumers

- Team inbox (threads, contacts, outbound mirror of each broadcast send), contacts (one per LINE user id), Campaigns chooser (`features/broadcasts`), Settings hub tile, the Help center guide `line-channels`.
- Contact consent (the broadcast's audience), message log (outbound rows), audit log and outbox consumers.

## Shims, owners and blocked consumers

- `NoInboundHooks` (`INBOUND_HOOKS`): flow hand-off and routing, AI agent and keyword auto-reply are not bound yet; nothing consumes a message and nothing replies. Owners: flow-runtime-engine, team-inbox-routing-sla, ai-agents-training. `line_flow_sessions` and Reference's two Node callbacks (`flow-log`, `flow-node`) wait on the same owners (TW-LINE-015, blocked).
- `SqlLineTemplates` (`LINE_TEMPLATES`): reads `wa_templates` where the channel is line until message-templates exports a lookup.
- Plan flags `access_line`, `line_broadcasts` and `line_channels_limit` are folded into `extra_channels`; the channel cap is not enforced (Reference never did).
- Rich menus (`line_rich_menus`, TW-LINE-016) and insights (TW-LINE-017) are Reference features that are **blocked / not ported**; no control for them is shown.
