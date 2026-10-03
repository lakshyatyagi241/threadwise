# Wiring map: channel-telegram (TG)

Generated from the controllers, repositories and web routes on branch `punya/punyafix`; the shim notes are hand-written. Update it in the same change as any new route, table, queue or consumer.

## API routes

| Method | Path                                  | Permission             |
| ------ | ------------------------------------- | ---------------------- |
| GET    | `/v2/telegram/bots`                   | `tg.bots.read`         |
| POST   | `/v2/telegram/bots`                   | `tg.bots.manage`       |
| POST   | `/v2/telegram/bots/:id/retry-webhook` | `tg.bots.manage`       |
| POST   | `/v2/telegram/bots/:id/toggle`        | `tg.bots.manage`       |
| PUT    | `/v2/telegram/bots/:id/payments`      | `tg.bots.manage`       |
| DELETE | `/v2/telegram/bots/:id`               | `tg.bots.manage`       |
| GET    | `/v2/telegram/bots/:id/chats`         | `tg.broadcasts.read`   |
| GET    | `/v2/telegram/broadcasts/compose`     | `tg.broadcasts.read`   |
| GET    | `/v2/telegram/broadcasts`             | `tg.broadcasts.read`   |
| POST   | `/v2/telegram/broadcasts`             | `tg.broadcasts.manage` |
| POST   | `/v2/telegram/broadcasts/:id/start`   | `tg.broadcasts.manage` |
| POST   | `/v2/telegram/broadcasts/:id/pause`   | `tg.broadcasts.manage` |
| POST   | `/v2/telegram/broadcasts/:id/retry`   | `tg.broadcasts.manage` |
| DELETE | `/v2/telegram/broadcasts/:id`         | `tg.broadcasts.manage` |
| POST   | `/v2/telegram/inbound/:token`         | public                 |

## Web screens

- `/telegram/broadcasts/create`
- `/telegram/broadcasts`
- `/telegram`

## Tables read or written

`channels`, `contacts`, `conversations`, `messages`, `picked`, `telegram_bots`, `telegram_broadcast_recipients`, `telegram_broadcasts`, `tg_bot_lookup`, `wa_templates`

## Queues and workers

`TG_BROADCAST`

## Outbox events emitted

`telegram.bot.connected`, `telegram.bot.disconnected`, `telegram.broadcast.created`, `telegram.broadcast.deleted`, `telegram.broadcast.paused`, `telegram.broadcast.retry_requested`, `telegram.broadcast.started`

## Shims, owners and blocked consumers

- `OpenTelegramPlanGate`: no Telegram keys in the plan catalogue (only the numeric cap).
- `NoInboundHooks`: no flow runtime, routing or auto-reply, so nothing consumes a message.
- `StorageMediaStore`: real (workspace object storage); local disk saves nothing. `ChatInboxIngest`: real, over chat-conversations.
