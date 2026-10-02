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

## Inbound webhook (WD-TG-003 to 006)

`POST /v2/telegram/inbound/:token` is where Telegram pushes (public, no sign-in, not in the API docs). `:token` is the bot's
routing token (the last part of its `webhookUrl`); the secret set on `setWebhook` must come back in the
`X-Telegram-Bot-Api-Secret-Token` header. It always answers 200 `{ ok: true, note }` so Telegram never retries: an unknown token
(`unknown bot`), a wrong or missing secret (`bad secret`, compared in constant time) and a paused bot (`bot disabled`) are
acknowledged and ignored. Only more than 120 requests a minute for one token answers 429.

The tenant is found with `tg_bot_lookup(token)`, a SECURITY DEFINER function that returns two ids and nothing else; everything
after runs under that organization.

What an update does, in this order:

1. **Payment check** (`pre_checkout_query`): approved at once, before anything is written (`pre_checkout_query`).
2. **Button tap** (`callback_query`): answered so the button stops spinning; a tap whose data is `tqr:<label>` is replayed as a
   typed message with that label.
3. **`chat_join_request`, `poll_answer`**: acknowledged only (the bot's last-inbound time moves).
4. **A message** (`message`, `channel_post`, `edited_message`, `edited_channel_post`): written into the inbox. A bot is a chat channel of kind `telegram` (one `channels` row per bot, `external_id` = the bot's row id, created on its first thread) and each Telegram chat is the peer (`peer_key` = chat id) of one thread on it; messages take the thread's next `msg_seq`.
   - Thread `channel = telegram`, key `tg:<bot row id>:<chat id>` (one per bot and chat, serialised so two updates at once make one).
     Title: chat title, chat username, sender username, first and last name, else "Telegram". Unread goes up by one, a resolved
     thread reopens, the preview is the first 120 characters.
   - The sender is one contact per organization keyed by the Telegram user id (the chat id for a channel post), source "Telegram DM".
   - Text and media: photo (largest size), video, voice, audio, animation (as video), document, sticker (its emoji as an image),
     place (`📍 lat, lon`), contact card (`👤 name phone`), text, else a service line ("New member joined", "Member left",
     "Group updated", `[message]`). The file id is kept in the message's `meta.telegram.file_id`.
   - A `successful_payment` is its own row, `Payment received: <CUR> <amount>` (zero-decimal currencies whole, others over 100),
     with `meta.payment`; it runs no flow or auto-reply.
   - After the message is stored, automation runs: a flow first and, only when no flow consumed it, routing, the assigned AI agent
     or a keyword reply. A failure there is logged and never blocks the stored message.

Not yet: downloading media into our storage (the message keeps its caption and file id, no file) and the flow, routing and
auto-reply hooks, which are stand-ins until their owners export them (see the parity file).

## Replying in a thread (WD-TG-008, 009)

Not an HTTP route: the team inbox calls `TelegramSenderService.reply(orgId, { rawJid, text, media?, buttons? })` (exported from
`modules/channel-telegram`). It sends through the bot named in the thread key `tg:<bot row id>:<chat id>` (an older `tg:<chat id>`
key is answered by the workspace's first active bot) and returns `{ ok, providerMessageId, fileId, error }`. It never throws: a
disconnected bot (`Telegram bot not connected`), a key that is not a Telegram thread, an unreachable file or a Telegram refusal
come back as `ok = false` with the reason.

- Text is cut to 4096 characters, a caption to 1024; the rest of a longer caption follows as its own text message.
- `parse_mode` is off; when a mode is asked for and Telegram cannot parse it, the text is sent again plain.
- Media goes by Telegram file id, by address, or as an upload of the bytes (preferred for our own stored files: no public
  address needed). Text is the caption (none for stickers and video notes).
- A Telegram template's `buttons` become the keyboard: any link makes an inline keyboard (links as link buttons, quick replies as
  `tqr:<label>` callbacks, labels cut to 64 and callback data to 60); only quick replies make a one-time reply keyboard; a phone
  button is appended to the text as `📞 label: number`.

## Broadcasts (WD-TG-010 to 014)

Permissions: `tg.broadcasts.read` for the GETs, `tg.broadcasts.manage` for the rest. A bot can only message chats that wrote to it first,
so the audience is the chats it carries.

| Method and path                       | What it does                                                                                             |
| ------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `GET /telegram/bots/:id/chats`        | The bot's chats, newest 500: `{ chatId, title, type (private, group, channel), lastMessageAt, unread }`. |
| `GET /telegram/broadcasts/compose`    | `{ bots, templates }` for the compose page (Telegram templates only).                                    |
| `GET /telegram/broadcasts`            | The 50 newest broadcasts and `stats` (total, sent, failed, blocked, audience, sending) over all of them. |
| `POST /telegram/broadcasts`           | Draft: `{ name, botId, templateId?, body?, chatIds[], mediaUrl? }`. 201. Recipients are frozen here.     |
| `POST /telegram/broadcasts/:id/start` | Draft to sending and queues the `tg-broadcast` job. Already sending is returned as it is.                |
| `POST /telegram/broadcasts/:id/pause` | Back to draft; unsent chats stay pending; the job stops at its next batch.                               |
| `POST /telegram/broadcasts/:id/retry` | Failed chats back to pending (blocked stay blocked); broadcast back to draft. `{ retried }`.             |
| `DELETE /telegram/broadcasts/:id`     | Removes the broadcast and its recipients in any status. 204.                                             |

Rules: forged chat ids are dropped (422 `TG_NO_RECIPIENTS` when none remain); a broadcast needs a message, a file or both (422
`TG_BROADCAST_EMPTY`); an empty body takes the template's body and buttons; `{{name}}` becomes the chat's title. Start refuses a
missing or paused bot (422 `TG_BOT_UNAVAILABLE`) and nobody pending (422 `TG_NOTHING_TO_SEND`); retry refuses none failed (422
`TG_NOTHING_TO_RETRY`) and a running broadcast (409). Another workspace's broadcast or bot is 404.

Sending: the worker claims 25 pending chats at a time (`FOR UPDATE SKIP LOCKED`), sends one by one 50 ms apart, writes each outcome
at once and recomputes the counters from the rows. Refusals that mean the person cannot be reached ("bot was blocked", "chat not
found", ...) mark the chat `blocked`, any other `failed`. A file is sent by address or upload once; Telegram's file id is then reused
for everyone after. A sent message is copied into the chat's thread as an outbound message (`source: telegram_broadcast`). Events:
`telegram.broadcast.created|started|paused|retry_requested|deleted`.
