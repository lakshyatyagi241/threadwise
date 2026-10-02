# Telegram channel API

Everything is under `/v2`, signed in as a user, with an `Idempotency-Key` header on every write. A bot is addressed by its uuid.
No response ever carries a bot token, the webhook secret or the payment provider token.

## Bots (WD-TG-001, 002, 007)

| Method and path                         | Permission       | What it does                                                      |
| --------------------------------------- | ---------------- | ----------------------------------------------------------------- |
| `GET /telegram/bots`                    | `tg.bots.read`   | The workspace's bots, oldest first.                               |
| `POST /telegram/bots`                   | `tg.bots.manage` | Connect a bot from a pasted @BotFather token. 201.                |
| `POST /telegram/bots/:id/retry-webhook` | `tg.bots.manage` | Register the webhook again ("Fix inbound").                       |
| `POST /telegram/bots/:id/toggle`        | `tg.bots.manage` | Pause or resume the bot.                                          |
| `PUT /telegram/bots/:id/payments`       | `tg.bots.manage` | Payment provider token and name.                                  |
| `DELETE /telegram/bots/:id`             | `tg.bots.manage` | Delete Telegram's webhook, then the bot. Inbox threads stay. 204. |

A bot is `{ id, botId, username, name, active, connectedAt, lastInboundAt, lastError, hasPaymentToken, paymentProvider, webhookUrl, rowVersion }`.
`webhookUrl` is the address Telegram pushes to, always https: `<APP_URL>/v2/telegram/inbound/<routing token>`.

### Connect

Body `{ botToken }`; the token must read like `123456789:AAH…` (digits, a colon, 30 or more letters, digits, `_` or `-`), else
422 `VALIDATION_FAILED` with the BotFather hint. Telegram's `getMe` must accept it, else 422 `TG_TOKEN_REJECTED` and nothing is saved.
The bot is saved with the token and the header secret encrypted. The same Telegram bot pasted again updates the same row: its
routing token stays, the secret is renewed, it becomes active and its error clears.
The webhook is registered after the row exists (secret header, pending updates dropped, allowed updates message, edited_message,
channel_post, edited_channel_post, callback_query, poll_answer, message_reaction, pre_checkout_query, chat_join_request).
If Telegram refuses it the bot stays saved with `lastError`, and the response carries `webhookError` (public HTTPS needed, use a
tunnel locally). Events: `telegram.bot.connected { uuid, username, reconnected }`.

### Manage

- Retry returns the bot plus `webhookError` (null on success, which also activates the bot and clears the error).
- Toggle: a paused bot still receives pushes but ignores them and cannot start a broadcast.
- Payments: a blank `paymentProviderToken` keeps the saved token, a value replaces it, `clearPaymentToken: true` removes it;
  `paymentProvider` is stored trimmed or null.
- Delete: Telegram's `deleteWebhook` errors are ignored. Event: `telegram.bot.disconnected { uuid, username }`.
- Another workspace's bot answers 404 for every action.

Not enforced yet: the plan flags `access_telegram`, `telegram_broadcasts` and the bot cap (see the parity file).
