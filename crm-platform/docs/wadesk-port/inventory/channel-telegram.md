---
domain: channel-telegram
code: TG
title: Telegram channel (bots, inbox, payments, broadcasts, @BotFather account)
wadesk_version: '1.7.0'
sources_read: 24
---

# Telegram channel

## Overview

A workspace connects one or more Telegram bots by pasting a @BotFather token. Each bot gets its own signed callback URL
(`/api/telegram/inbound/{token}`). Messages the bot receives become `channel = telegram` conversations in the team inbox
(`raw_jid = tg:<botId>:<chatId>`), the sender becomes a CRM contact, media is downloaded into our storage, and the inbox
replies through the same bot. Inline-button taps and native Telegram payments are handled; flows run on the Node runtime.
Telegram ships its own broadcasts because a bot cannot message a phone number or anyone who has not written first: the
audience is the bot's existing threads, and sending is done a batch at a time. An optional MTProto user login (phone code, 2FA
or QR) lets the workspace create bots through @BotFather without leaving the app.

Plan gates: `access_telegram` (the channel), `telegram_broadcasts` (the broadcast screens), `telegram_bots_limit` (declared on the
plan, never enforced). Platform switch: setting `telegram_enabled` hides the menu item. MTProto needs `telegram_api_id` and
`telegram_api_hash` (admin Channel Settings, or the Node env) and the Node bridge URL.

Connects to: team-inbox-conversations (threads, replies), contacts-attributes-tags (contact per sender), message-templates
(Telegram templates and buttons), flow-builder-editor and flow-runtime-engine (flows of type `telegram`), plans-subscriptions-trials
(feature flags), node-bridge-runtime (MTProto and flow runtime), platform-settings-branding-storage (API id/hash, media storage).

## Feature index

| Id        | Feature                                                                  | Status      | Priority | Effort | Depends on                 |
| --------- | ------------------------------------------------------------------------ | ----------- | -------- | ------ | -------------------------- |
| WD-TG-001 | Telegram hub page: bots, status, setup guide                             | implemented | P0       | M      | WD-TG-002, WD-TG-007       |
| WD-TG-002 | Connect a bot from a pasted token                                        | implemented | P0       | M      | WD-TG-019                  |
| WD-TG-003 | Per-bot inbound webhook: routing token, secret header, always-200        | implemented | P0       | M      | WD-TG-002                  |
| WD-TG-004 | Inbound message to inbox thread, contact, media and automation           | implemented | P0       | L      | WD-TG-003                  |
| WD-TG-005 | Inline-button taps and quick-reply replay                                | implemented | P1       | S      | WD-TG-004                  |
| WD-TG-006 | Payments: pre-checkout approval and payment record                       | implemented | P1       | M      | WD-TG-003                  |
| WD-TG-007 | Bot management: pause, resume, fix webhook, disconnect, payment settings | implemented | P0       | M      | WD-TG-002                  |
| WD-TG-008 | Outbound inbox reply through the bot                                     | implemented | P0       | M      | WD-TG-004                  |
| WD-TG-009 | Template buttons as a Telegram keyboard                                  | implemented | P1       | S      | WD-TG-008                  |
| WD-TG-010 | Reachable audience: the chats a bot carried                              | implemented | P0       | S      | WD-TG-004                  |
| WD-TG-011 | Broadcast list with KPI cards and live progress                          | implemented | P0       | M      | WD-TG-012                  |
| WD-TG-012 | Broadcast compose: bot, audience, message, template, attachment          | implemented | P0       | M      | WD-TG-010                  |
| WD-TG-013 | Broadcast sending: batches, file reuse, blocked vs failed, inbox mirror  | implemented | P0       | L      | WD-TG-012                  |
| WD-TG-014 | Broadcast start, pause, retry failed, delete                             | implemented | P0       | M      | WD-TG-013                  |
| WD-TG-015 | Connect a Telegram user account (phone code, 2FA, QR)                    | implemented | P2       | L      | node bridge                |
| WD-TG-016 | Check and log out a Telegram account                                     | implemented | P2       | S      | WD-TG-015                  |
| WD-TG-017 | Create a bot through @BotFather and check a username                     | implemented | P2       | M      | WD-TG-015, WD-TG-002       |
| WD-TG-018 | Flow runtime hand-off and the two Node callbacks (flow-log, flow-node)   | implemented | P1       | L      | flow-runtime-engine        |
| WD-TG-019 | Plan gates, platform switch and the telegram engine                      | partial     | P0       | S      | plans-subscriptions-trials |

## Features

### WD-TG-001 — Telegram hub page: bots, status, setup guide

- **Status:** implemented
- **Priority:** P0
- **Effort:** M
- **Depends on:** WD-TG-002, WD-TG-007
- **Summary:** `/telegram` is where a workspace connects and manages its bots and, optionally, its Telegram user account. It also carries the setup guide.
- **Actors & access:** workspace members on a plan with `access_telegram`; the menu entry is hidden unless the platform setting `telegram_enabled` is on. The route has no `workspace.role` guard (unlike broadcasts, which require admin).
- **UX & screens:** `resources/views/user/telegram/index.blade.php`. Header "Telegram Connect" with buttons to Team inbox, Flows and Broadcasts. A connection card with a "Connected"/"Not Connected" pill and a "Connect Bot" button that opens a modal (token field and a three-step how-to). A Telegram account card (state pill, "Connect Account" modal with phone and QR, a "Create a new bot" form once connected, "Test session" and "Log out"). A "Connected bots" list per bot: state (Live, Paused, Needs attention with the last error), last message time, a Payments panel, the shortened webhook URL, "Fix inbound (re-register webhook)", Resume or pause, Disconnect (with confirm). A guide: prerequisites, four connection steps, what is unlocked, and a warning never to share the token and to press "Fix inbound" after a tunnel restarts. Script `resources/js/charts/user-telegram-index.js`.
- **Endpoints:**

| Method uri   | Route name          | Controller@action               | Middleware                      | Request fields | Response                            |
| ------------ | ------------------- | ------------------------------- | ------------------------------- | -------------- | ----------------------------------- |
| GET telegram | user.telegram.index | TelegramConnectController@index | web, auth, plan:access_telegram | none           | view with the bots and the accounts |

- **Data:** reads `telegram_bots` and `telegram_accounts` of the workspace, oldest first.
- **Rules & edge cases:**
  1. Bots and accounts are listed for the active workspace only.
  2. The account card treats an account as connected only when it holds a session.
  3. A bot shows "Needs attention" when `last_error` is set and "Paused" when `active` is false.
  4. The token, secret and payment token are never rendered (model `hidden`); a saved payment token shows only as "saved".
- **Async & events:** none.
- **External systems:** none on load.
- **Settings:** `telegram_enabled` (menu), plan feature `access_telegram`.
- **Acceptance criteria:**
  - Given a workspace with two bots, When `/telegram` opens, Then both are listed with their state and last-message time and no token is in the page.
  - Given a plan without `access_telegram`, When the page is requested, Then the plan gate refuses.
  - Given a bot with a `last_error`, When listed, Then it reads "Needs attention" with the error.
- **Source refs:** `app/Http/Controllers/Telegram/TelegramConnectController.php`, `resources/views/user/telegram/index.blade.php`, `resources/js/charts/user-telegram-index.js`, `routes/telegram.php`, `app/Support/UserNav.php`.
- **Port notes:** home `apps/api/src/modules/channel-telegram/` and `apps/web/src/features/channel-telegram/`. Add the permission keys at port time (there are none in WaDesk, workspace role only). The menu item comes from the feature's `nav.ts` (group `channels`), replacing the planned "Telegram" entry.

### WD-TG-002 — Connect a bot from a pasted token

- **Status:** implemented
- **Priority:** P0
- **Effort:** M
- **Depends on:** WD-TG-019
- **Summary:** The operator pastes a @BotFather token. We validate it with Telegram, store it encrypted, create the routing and secret tokens and register the webhook.
- **Actors & access:** workspace members with `access_telegram`. Refused with a message when the plan lacks it.
- **UX & screens:** the "Connect Telegram Bot" modal: one field, "How to get a bot token?" help, Cancel and Connect Bot. Success flashes "Telegram connected — @username"; failures show on the field.
- **Endpoints:**

| Method uri            | Route name            | Controller@action                 | Middleware                      | Request fields | Response              |
| --------------------- | --------------------- | --------------------------------- | ------------------------------- | -------------- | --------------------- |
| POST telegram/connect | user.telegram.connect | TelegramConnectController@connect | web, auth, plan:access_telegram | bot_token      | redirect back + flash |

- **Data:** writes `telegram_bots`: `workspace_id`, `connected_by`, `bot_token` (encrypted), `bot_id`, `bot_username`, `bot_name`, `webhook_token` (48 random), `secret_token` (48 random), `active = true`, `connected_at`, `last_error = null`.
- **Rules & edge cases:**
  1. `bot_token` is required and must match `^\d{6,}:[A-Za-z0-9_-]{30,}$`; otherwise "That does not look like a BotFather token…".
  2. `getMe` must succeed ("Telegram rejected that token: …").
  3. No active workspace is refused.
  4. The same Telegram bot id in the same workspace updates the existing row: its routing token is kept, the secret token is regenerated, `active` is set true and the error cleared.
  5. The webhook is registered after the row exists, with the secret token, `drop_pending_updates = true` and the allowed updates message, edited_message, channel_post, edited_channel_post, callback_query, poll_answer, message_reaction, pre_checkout_query, chat_join_request.
  6. When Telegram refuses the webhook the bot stays saved with `last_error` (255 characters) and the message says the URL must be public HTTPS and to use a tunnel locally.
  7. The webhook URL is forced to https.
  8. QUIRK: `telegram_bots_limit` on the plan is never checked, so any number of bots can be connected.
- **Async & events:** none (synchronous Telegram calls, 20 s timeout).
- **External systems:** Telegram Bot API `getMe`, `setWebhook`. Auth: the bot token in the URL. Failures return `ok = false` with Telegram's description; the client never throws.
- **Settings:** plan `access_telegram`.
- **Acceptance criteria:**
  - Given a valid token, When connected, Then a bot row exists with an encrypted token, a routing token and a registered webhook, and the flash names the bot.
  - Given the same token pasted twice, When connected again, Then there is still one bot and its webhook path is unchanged.
  - Given a malformed token, When submitted, Then the field shows the BotFather hint and nothing is saved.
  - Given Telegram rejects the webhook, When connected, Then the bot is saved with the error shown on the hub.
- **Source refs:** `app/Http/Controllers/Telegram/TelegramConnectController.php` (`connect`, `adoptToken`), `app/Services/Telegram/TelegramClient.php`, `app/Models/TelegramBot.php`.
- **Port notes:** table `telegram_bots` exists (`20261001104100_tg_wadesk_schema.sql`). Encrypt the token with the app's `CryptoService`. Run the Telegram calls from a provider adapter (`infra/providers/channel-telegram/`) behind an interface so tests use a fake. Enforce `telegram_bots_limit` (a documented change if you choose to; the reference does not). Emit `telegram.bot.connected` through the outbox.

### WD-TG-003 — Per-bot inbound webhook: routing token, secret header, always-200

- **Status:** implemented
- **Priority:** P0
- **Effort:** M
- **Depends on:** WD-TG-002
- **Summary:** Telegram pushes updates to one URL per bot. The URL token finds the bot and a secret header proves the caller.
- **Actors & access:** Telegram only. No session, no CSRF. Throttled to 120 requests a minute.
- **UX & screens:** none.
- **Endpoints:**

| Method uri                        | Route name       | Controller@action                | Middleware          | Request fields      | Response                      |
| --------------------------------- | ---------------- | -------------------------------- | ------------------- | ------------------- | ----------------------------- |
| POST api/telegram/inbound/{token} | telegram.inbound | TelegramWebhookController@ingest | api, throttle:120,1 | the Telegram update | `{ok:true, note}`, always 200 |

- **Data:** reads `telegram_bots` by `webhook_token`; sets `last_inbound_at`, clears `last_error` on a message.
- **Rules & edge cases:**
  1. `token` must be alphanumeric.
  2. An unknown token, a wrong or missing secret header (compared in constant time when a secret is stored), a paused bot: all answer 200 with a note and do nothing (Telegram retries any other status).
  3. Update kinds: `pre_checkout_query` first, then `callback_query`, then `chat_join_request` and `poll_answer` (acknowledged only; `last_inbound_at` is touched), then the message family (message, channel_post, edited_message, edited_channel_post, first one present).
  4. An update with none of these is acknowledged as "no message".
  5. Errors while storing are logged and the answer is still 200.
- **Async & events:** none.
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given a wrong secret header, When an update arrives, Then the answer is 200 and nothing is written.
  - Given a paused bot, When an update arrives, Then it is acknowledged and ignored.
  - Given a valid text update, When it arrives, Then the bot's `last_inbound_at` is set and a message is stored (WD-TG-004).
- **Source refs:** `app/Http/Controllers/Telegram/TelegramWebhookController.php` (`ingest`), `routes/telegram.php`.
- **Port notes:** a public controller with `@Public()` that resolves the tenant from the token without lifting RLS: a SECURITY DEFINER lookup (same shape as `bcast_link_lookup`) returning the org and bot ids for a routing token, then work under that org. Unique index on `webhook_token` already exists. Flag the lookup function as a reviewer decision in the parity file. Rate limit with the existing throttler.

### WD-TG-004 — Inbound message to inbox thread, contact, media and automation

- **Status:** implemented
- **Priority:** P0
- **Effort:** L
- **Depends on:** WD-TG-003
- **Summary:** A received message appears in the unified inbox as a thread keyed by bot and chat, linked to a contact, with media saved and automation run.
- **Actors & access:** system.
- **UX & screens:** the inbox thread (owned by team-inbox).
- **Endpoints:** none of its own (WD-TG-003).
- **Data:** `conversations` (`channel telegram`, `provider telegram`, `origin telegram`, `raw_jid tg:<botId>:<chatId>`, `status pending`, `inbox_status open`, `last_message_at`, `last_inbound_at`, `preview` 120 characters, `unread_count` +1), `messages` (direction in, body, media path and type, `from_number` the Telegram user id, status received, meta `telegram.{chat_id, message_id, chat_type, chat_title, from_id, username, first_name, last_name, file_id}`), `contacts` (a social contact keyed by Telegram user id), media files `telegram/<workspace>/<random>.<ext>`.
- **Rules & edge cases:**
  1. The thread is found or created per (workspace, channel, raw_jid). A resolved thread reopens on a new inbound.
  2. The thread title is the chat title, else the chat username, else the sender username, else first and last name, else "Telegram".
  3. The sender (user id, else chat id) is linked as a contact with source "Telegram DM"; a brand-new contact in a private chat gets the profile photo as its image, best effort.
  4. Body extraction in order: photo (largest size, caption), video, voice, audio, animation (as video), document, sticker (the emoji, as image), location ("📍 lat, lon"), contact card ("👤 name phone"), text, else a service text ("New member joined", "Member left", "Group updated", "[message]").
  5. Media bytes are downloaded through `getFile` and stored locally; the tokened Telegram URL is never stored.
  6. A `successful_payment` is handled by WD-TG-006 and skips automation.
  7. After storing, a "message received" event fires for the live inbox.
  8. Automation order: a published, active flow of type telegram bound to the bot whose trigger keywords match (`any`, `*`, `.*`, `.+` or a substring, case-insensitive) starts first and, if the Node runtime consumes the message, nothing else replies; otherwise routing rules, then the assigned AI agent, else keyword auto-reply.
  9. Any failure in automation is logged and never blocks the stored message.
- **Async & events:** hand-off to the Node flow runtime (WD-TG-018); routing, AI and keyword replies belong to other domains.
- **External systems:** Telegram `getFile`, file download and `getUserProfilePhotos`.
- **Settings:** none.
- **Acceptance criteria:**
  - Given a first message from a new chat, When received, Then a thread, a contact and an inbound message exist and unread is 1.
  - Given a photo with a caption, When received, Then the file is stored locally and the message carries the caption and an image type.
  - Given a message in a resolved thread, When received, Then the thread is open again.
  - Given a keyword flow that consumes the message, When received, Then no keyword auto-reply is sent.
- **Source refs:** `app/Http/Controllers/Telegram/TelegramWebhookController.php` (`store`, `thread`, `extract`, `serviceText`, `storeMedia`, `title`, `resolveTelegramKeywordFlow`), `app/Models/Contact.php` (`forSocialSender`).
- **Port notes:** the inbox owner exports an "ingest inbound message" service; until it exists put a shim behind an interface in `channel-telegram/_shims/` that writes `conversations` and `messages` (tables exist). Contact creation goes through the contacts module's public service. Media goes through the storage service; a stub that returns null (message without media) is acceptable and must be listed. Download media in a queue job, not in the webhook request, so the 200 is fast.

### WD-TG-005 — Inline-button taps and quick-reply replay

- **Status:** implemented
- **Priority:** P1
- **Effort:** S
- **Depends on:** WD-TG-004
- **Summary:** A tap on an inline button is acknowledged so the button stops spinning; a tap on one of our template quick-reply buttons is replayed as if the customer had typed the label.
- **Actors & access:** Telegram.
- **UX & screens:** none.
- **Endpoints:** WD-TG-003.
- **Data:** as WD-TG-004 for the replayed message; `last_inbound_at` on the bot.
- **Rules & edge cases:**
  1. `answerCallbackQuery` is always called.
  2. Only callback data starting with `tqr:` is replayed; the label is the rest of the string (the button was built with at most 60 characters of it).
  3. The replay uses the callback's message chat and sender and goes through the normal store path, so flows and keyword replies fire.
  4. A replay with no chat is ignored. Other callback data is acknowledged and dropped.
- **Async & events:** as WD-TG-004.
- **External systems:** Telegram `answerCallbackQuery`.
- **Settings:** none.
- **Acceptance criteria:**
  - Given a tap on `tqr:Yes`, When received, Then the query is answered and an inbound message "Yes" is stored.
  - Given a tap with other data, When received, Then it is answered and nothing is stored.
- **Source refs:** `TelegramWebhookController@ingest` (callback block), `TelegramClient::answerCallbackQuery`, `templateButtonsMarkup`.
- **Port notes:** keep the `tqr:` prefix and the 60-character cut so already-sent keyboards still work after the switch-over.

### WD-TG-006 — Payments: pre-checkout approval and payment record

- **Status:** implemented
- **Priority:** P1
- **Effort:** M
- **Depends on:** WD-TG-003
- **Summary:** Telegram's native in-chat payments: the pre-checkout query is approved immediately and the successful payment is recorded in the thread; a flow parked on a Payment node is resumed.
- **Actors & access:** Telegram.
- **UX & screens:** a "Payment received: CUR amount" row in the thread.
- **Endpoints:** WD-TG-003.
- **Data:** `messages` row (direction in, body `Payment received: <currency> <amount>`, meta `telegram.event = successful_payment` and `payment.{currency, total_amount, amount_display, invoice_payload, telegram_payment_charge_id, provider_payment_charge_id, order_info}`), thread preview and counters as WD-TG-004.
- **Rules & edge cases:**
  1. A `pre_checkout_query` is answered `ok = true` within the 10 seconds Telegram allows, before anything else. There is no stock or price re-validation (the invoice was built by us).
  2. Amounts arrive in the smallest unit; JPY, KRW, VND, CLP, PYG, UGX, RWF, XOF, XAF and IDR are shown whole, others divided by 100 with two decimals.
  3. A payment never triggers flows or keyword replies (Telegram's own receipt is the confirmation).
  4. The Node runtime is told (`__tg_paid__` with amount, currency, charge id, payload) so a block-until-paid Payment node continues; nothing happens when no flow is parked.
- **Async & events:** hand-off to Node.
- **External systems:** Telegram `answerPreCheckoutQuery`; payments need the bot's provider token (WD-TG-007).
- **Settings:** per-bot `payment_provider_token`, `payment_provider`.
- **Acceptance criteria:**
  - Given a pre-checkout query, When received, Then it is approved at once.
  - Given a successful payment of 4999 USD cents, When received, Then the thread shows "Payment received: USD 49.99" and no automation runs.
  - Given a payment in JPY 500, Then the row reads "JPY 500".
- **Source refs:** `TelegramWebhookController@ingest`, `@storePayment`, `TelegramClient::answerPreCheckoutQuery`, `TgFlowBridge::resumePaid`.
- **Port notes:** the approval must not wait on the database write: answer first, record after. Keep the zero-decimal list as data in one module.

### WD-TG-007 — Bot management: pause, resume, fix webhook, disconnect, payment settings

- **Status:** implemented
- **Priority:** P0
- **Effort:** M
- **Depends on:** WD-TG-002
- **Summary:** Day-to-day control of a connected bot.
- **Actors & access:** workspace members with `access_telegram`; actions are scoped to bots of the active workspace (another workspace's id answers "Bot not found").
- **UX & screens:** the per-bot panel on the hub (WD-TG-001): "Fix inbound (re-register webhook)", pause or "Resume", "Disconnect" (confirm: "its inbox threads stay, but it stops sending/receiving"), and a Payments form (provider token with "saved — leave blank to keep", provider name, "Remove token", Save).
- **Endpoints:**

| Method uri                   | Route name             | Controller@action                      | Middleware                      | Request fields                                                                   | Response         |
| ---------------------------- | ---------------------- | -------------------------------------- | ------------------------------- | -------------------------------------------------------------------------------- | ---------------- |
| POST telegram/{bot}/retry    | user.telegram.retry    | TelegramConnectController@retry        | web, auth, plan:access_telegram | none                                                                             | redirect + flash |
| POST telegram/{bot}/toggle   | user.telegram.toggle   | TelegramConnectController@toggle       | same                            | none                                                                             | redirect + flash |
| POST telegram/{bot}/payments | user.telegram.payments | TelegramConnectController@savePayments | same                            | payment_provider_token (max 191), payment_provider (max 32), clear_payment_token | redirect + flash |
| DELETE telegram/{bot}        | user.telegram.destroy  | TelegramConnectController@destroy      | same                            | none                                                                             | redirect + flash |

- **Data:** `telegram_bots.active`, `last_error`, `payment_provider`, `payment_provider_token` (encrypted).
- **Rules & edge cases:**
  1. Retry calls `setWebhook` with the stored URL and secret; success sets `active = true` and clears the error, failure stores the error (255 characters).
  2. Toggle flips `active`; a paused bot still receives pushes but ignores them (WD-TG-003) and cannot start a broadcast (WD-TG-014).
  3. Payments: a blank token field keeps the saved token; a new value replaces it; "Remove token" clears it. The provider name is stored trimmed or null.
  4. Disconnect calls `deleteWebhook` (errors ignored) and deletes the bot. Its threads stay.
  5. QUIRK: deleting a bot leaves its broadcasts and flow sessions pointing at a missing bot; broadcasts then refuse to start ("no longer connected").
- **Async & events:** none.
- **External systems:** Telegram `setWebhook`, `deleteWebhook`.
- **Settings:** none.
- **Acceptance criteria:**
  - Given a bot whose webhook was lost, When "Fix inbound" runs and Telegram accepts, Then the bot is live and the error is gone.
  - Given a saved payment token, When Save is pressed with the field blank, Then the token is unchanged.
  - Given another workspace's bot id, When any action is posted, Then "Bot not found".
  - Given a disconnect, Then the Telegram webhook is deleted and the bot row is gone but its threads remain.
- **Source refs:** `TelegramConnectController` (`retry`, `toggle`, `savePayments`, `destroy`), `resources/views/user/telegram/index.blade.php`.
- **Port notes:** payment token encrypted like the bot token and never returned by the API (return only `hasPaymentToken`). Emit `telegram.bot.disconnected`. Decide what happens to in-flight broadcasts of a deleted bot (reference: stuck); safest port is to fail them with a reason, documented as a difference.

### WD-TG-008 — Outbound inbox reply through the bot

- **Status:** implemented
- **Priority:** P0
- **Effort:** M
- **Depends on:** WD-TG-004
- **Summary:** An agent's reply in a Telegram thread is sent by the bot that carried the thread: text, or media with a caption, or a template with its keyboard.
- **Actors & access:** inbox agents (team-inbox permissions).
- **UX & screens:** the inbox composer (owned by team-inbox).
- **Endpoints:** none here; called by the inbox dispatcher.
- **Data:** the outbound `messages` row is updated with the provider message id and status.
- **Rules & edge cases:**
  1. The bot is found from `raw_jid` (`tg:<botId>:<chatId>`; an older `tg:<chatId>` falls back to the workspace's first active bot). A disconnected bot answers "Telegram bot not connected".
  2. Text is cut to 4096 characters, captions to 1024 (the cut leaves an ellipsis).
  3. `parse_mode` is off by default; if a mode is rejected the message is resent unparsed.
  4. Media is uploaded from our storage when the file is local, else sent by URL.
  5. A template send builds the keyboard from the template's buttons (WD-TG-009).
  6. Never throws; a Telegram refusal returns `ok = false` with the description.
- **Async & events:** none.
- **External systems:** Telegram `sendMessage`, `sendPhoto`, `sendVideo`, `sendAudio`, `sendVoice`, `sendDocument`, `sendSticker`, `sendAnimation`, `sendVideoNote`.
- **Settings:** none.
- **Acceptance criteria:**
  - Given a thread carried by bot 7, When an agent replies, Then bot 7's token sends it to the chat id.
  - Given a thread whose bot was disconnected, When a reply is sent, Then it fails with "Telegram bot not connected".
  - Given a 5000 character text, When sent, Then 4096 characters (ending in an ellipsis) go out.
- **Source refs:** `app/Services/InboxDispatcher.php` (`dispatchTelegram`, `readTelegramLocal`), `app/Services/Telegram/TelegramClient.php`, `app/Models/TelegramBot.php` (`forConversation`).
- **Port notes:** the dispatcher belongs to team-inbox; this domain exports `TelegramSender.send(conversation, message)` and the inbox calls it (provider port, like the WhatsApp adapter). Telegram's per-chat and global rate limits (about 30 messages a second, 20 a minute into one group) should be a limiter in the adapter.

### WD-TG-009 — Template buttons as a Telegram keyboard

- **Status:** implemented
- **Priority:** P1
- **Effort:** S
- **Depends on:** WD-TG-008
- **Summary:** A Telegram template's buttons become tappable buttons.
- **Actors & access:** system.
- **UX & screens:** buttons under the message in Telegram; chips in the broadcast and inbox previews.
- **Endpoints:** none.
- **Data:** template `buttons` JSON (`type`, `text`/`title`, `url`, `phone_number`/`phone`).
- **Rules & edge cases:**
  1. Telegram allows one markup per message, so: if any URL button exists use an inline keyboard (URL buttons as links, quick replies as callback buttons `tqr:<label>`); otherwise, if there are quick replies, a one-time reply keyboard whose taps send the label back; otherwise none.
  2. Phone buttons cannot be real buttons: they are appended to the text as "📞 label: number".
  3. Button text is cut to 64 characters, callback data to 60; buttons without text are skipped; a URL button without a URL is treated as a quick reply.
- **Async & events:** none.
- **External systems:** Telegram `reply_markup`.
- **Settings:** none.
- **Acceptance criteria:**
  - Given a URL button and a quick reply, When rendered, Then an inline keyboard with a link and a `tqr:` callback is produced.
  - Given only quick replies, Then a one-time reply keyboard is produced.
  - Given a phone button, Then its number is appended to the text.
- **Source refs:** `TelegramClient::templateButtonsMarkup`.
- **Port notes:** a pure function with a unit test of the three branches.

### WD-TG-010 — Reachable audience: the chats a bot carried

- **Status:** implemented
- **Priority:** P0
- **Effort:** S
- **Depends on:** WD-TG-004
- **Summary:** A bot can only message chats that wrote to it first, so the audience is its existing threads, including groups and channels it was added to.
- **Actors & access:** broadcast composer.
- **UX & screens:** the recipient list in WD-TG-012.
- **Endpoints:** none (embedded in the compose page).
- **Data:** `conversations` of the workspace, channel telegram, `raw_jid` starting with `tg:<botId>:`, newest first, at most 500; the type comes from recent inbound messages.
- **Rules & edge cases:**
  1. The chat id is the last colon segment of the jid. A negative id is a room.
  2. A positive id is `private`. For a room the type comes from the latest inbound message's `chat_type`; if unknown, `group` when a message carries a sender and `channel` otherwise; `supergroup` is shown as `group`.
  3. A failure to read returns an empty list (logged).
  4. A chat id belongs to ONE bot.
- **Async & events:** none.
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given a bot with 3 threads and another bot with 2, When the first bot's audience is read, Then 3 chats are returned.
  - Given a thread whose chat id starts with `-` and whose messages have a sender, Then it is a group.
- **Source refs:** `app/Services/Telegram/TelegramChats.php`, `TelegramMedia::chatIdFromJid`.
- **Port notes:** the 500 cap is a WaDesk limit; keep it and note it. Reading threads goes through an inbox read interface (shim).

### WD-TG-011 — Broadcast list with KPI cards and live progress

- **Status:** implemented
- **Priority:** P0
- **Effort:** M
- **Depends on:** WD-TG-012
- **Summary:** `/telegram/broadcasts` lists the workspace's Telegram broadcasts with totals and per-row progress.
- **Actors & access:** workspace members whose plan has `access_telegram` and `telegram_broadcasts`.
- **UX & screens:** `resources/views/user/telegram/broadcasts.blade.php`. Header with Bots and New broadcast (hidden with no bot). With no bot an empty state "Connect a Telegram bot first". Five KPI cards (Sent with the broadcast count, Audience, Failed, Blocked, Sending). A table: name and created date, bot username, recipients, progress bar with sent, failed and blocked counts, status pill (Draft, Sending, Done, Failed), and actions (Start or Resume sending, Retry, delete). Empty row "No broadcasts yet."
- **Endpoints:**

| Method uri              | Route name               | Controller@action                 | Middleware                                                | Request fields | Response |
| ----------------------- | ------------------------ | --------------------------------- | --------------------------------------------------------- | -------------- | -------- |
| GET telegram/broadcasts | user.telegram.broadcasts | TelegramBroadcastController@index | web, auth, plan:access_telegram, plan:telegram_broadcasts | none           | view     |

- **Data:** latest 50 `telegram_broadcasts` of the workspace with their bot; one aggregate row for the cards.
- **Rules & edge cases:**
  1. Progress is `round((sent + failed + blocked) / max(1, total) × 100)`; blocked counts as done.
  2. "Sending" card counts only the 50 listed rows.
  3. Retry shows when the status is failed or any failed or blocked recipient exists, and the broadcast is not draft or sending.
- **Async & events:** the page script drives the send loop (WD-TG-013).
- **External systems:** none.
- **Settings:** plan gates.
- **Acceptance criteria:**
  - Given 3 broadcasts, When the page opens, Then the cards sum their sent, failed, blocked and audience.
  - Given a broadcast at 80 of 100, Then its bar reads 80%.
  - Given no bot, Then the connect prompt shows and New broadcast is hidden.
- **Source refs:** `TelegramBroadcastController@index`, `resources/views/user/telegram/broadcasts.blade.php`, `resources/js/charts/user-telegram-broadcasts.js`.
- **Port notes:** list endpoint with the aggregate; the "Sending" card should count all rows, not only the 50 (a documented fix of a quirk). Use the same list and tile layout as the WhatsApp broadcasts screen.

### WD-TG-012 — Broadcast compose: bot, audience, message, template, attachment

- **Status:** implemented
- **Priority:** P0
- **Effort:** M
- **Depends on:** WD-TG-010
- **Summary:** Choose a bot, tick recipients, write the message (or pick a Telegram template), optionally attach a file, and save a draft with a frozen recipient list.
- **Actors & access:** as WD-TG-011.
- **UX & screens:** `broadcasts-create.blade.php`: name, bot picker (the recipient list swaps with the bot), recipient list with select-all and a count, template picker (Telegram templates only; picking one fills an empty body and shows its buttons), message box with a live preview where `{name}` previews as "there", an attachment (jpg, jpeg, png, gif, webp, mp4, mov, pdf, doc, docx, mp3, ogg; up to 50 MB) shown as a chip in the preview.
- **Endpoints:**

| Method uri                     | Route name                      | Controller@action                  | Middleware   | Request fields                                                                                           | Response                                 |
| ------------------------------ | ------------------------------- | ---------------------------------- | ------------ | -------------------------------------------------------------------------------------------------------- | ---------------------------------------- |
| GET telegram/broadcasts/create | user.telegram.broadcasts.create | TelegramBroadcastController@create | as WD-TG-011 | none                                                                                                     | view with bots, per-bot chats, templates |
| POST telegram/broadcasts       | user.telegram.broadcasts.store  | TelegramBroadcastController@store  | as WD-TG-011 | name (max 191), telegram_bot_id, template_id?, body? (max 4096), chat_ids[] (min 1, each max 32), media? | redirect to the list + flash             |

- **Data:** `telegram_broadcasts` (status draft, `total`, `body` encrypted, `buttons` encrypted array, `media_path`, `media_kind`) and one `telegram_broadcast_recipients` row per chat (`chat_id`, `title` 191, `kind` private or group, `conversation_id`, status pending), inserted in chunks of 500.
- **Rules & edge cases:**
  1. The bot must belong to the workspace ("Pick a Telegram bot that belongs to this workspace.").
  2. A template counts only if it belongs to the workspace and targets Telegram; it fills an empty body and supplies the buttons.
  3. A message, a file or both is required ("A broadcast needs a message, a file, or both.").
  4. Posted chat ids are intersected with the bot's real audience; forged ids are dropped; none left is refused ("None of those chats belong to this bot…").
  5. The recipient list is snapshotted at creation so a later arrival is never added mid-send.
  6. Media kind from the extension: image (jpg, jpeg, png, webp), animation (gif), video (mp4, mov), audio (mp3, ogg), else document.
  7. Success: "Broadcast created with N recipients. Press Start sending when ready."
- **Async & events:** none.
- **External systems:** none.
- **Settings:** plan gates.
- **Acceptance criteria:**
  - Given 3 ticked chats of the bot and 1 forged id, When saved, Then 3 recipient rows exist and the total is 3.
  - Given no text and no file, When saved, Then it is refused.
  - Given a template with buttons and an empty body, When saved, Then the body is the template body and the buttons are stored.
- **Source refs:** `TelegramBroadcastController@create`, `@store`, `@storeMedia`, `resources/views/user/telegram/broadcasts-create.blade.php`, `resources/js/charts/user-telegram-broadcasts.js`.
- **Port notes:** the attachment goes through the storage service (blocked on storage; keep the field and refuse files with a clear message until it exists, recorded as `blocked`). Telegram templates are rows of `wa_templates` with channel telegram, owned by message-templates.

### WD-TG-013 — Broadcast sending: batches, file reuse, blocked vs failed, inbox mirror

- **Status:** implemented
- **Priority:** P0
- **Effort:** L
- **Depends on:** WD-TG-012
- **Summary:** Sends the message to each pending recipient, records the outcome per recipient, and keeps the broadcast's counters.
- **Actors & access:** the page script (browser-driven loop) in WaDesk.
- **UX & screens:** progress bar and counters update in place while the page is open; closing the tab pauses (pending rows stay pending).
- **Endpoints:**

| Method uri                                 | Route name                     | Controller@action                     | Middleware   | Request fields | Response                                                      |
| ------------------------------------------ | ------------------------------ | ------------------------------------- | ------------ | -------------- | ------------------------------------------------------------- |
| POST telegram/broadcasts/{broadcast}/batch | user.telegram.broadcasts.batch | TelegramBroadcastController@sendBatch | as WD-TG-011 | none           | `{ok, pending, sent, failed, blocked, progress, done}` or 422 |

- **Data:** recipient rows (status sent, failed or blocked, `provider_message_id`, `error` 255, `sent_at`), broadcast counters `sent`, `failed`, `blocked`, `media_file_id`, `finished_at`; an outbound inbox message and thread timestamps per success.
- **Rules & edge cases:**
  1. Only a broadcast in status sending can run (else 422 "This broadcast is not sending."). A missing or paused bot ends the broadcast as failed with the reason recorded once on the broadcast.
  2. A batch is 25 pending recipients in id order (sized under Telegram's ~30 messages a second ceiling; the page paces the calls).
  3. `{{name}}` and `{{ name }}` are replaced by the chat's title; nothing else is merged.
  4. Template buttons become a keyboard (WD-TG-009); phone buttons are appended to the text.
  5. No attachment: plain message. With an attachment: by Telegram `file_id` once known, else upload of the local bytes (read once per batch), else by URL. The `file_id` of the first success (largest size for photos) is stored and reused for everyone after.
  6. A caption is limited to 1024 characters; a longer text sends the remainder as a follow-up message.
  7. A refusal containing "bot was blocked", "user is deactivated", "chat not found", "peer_id_invalid", "bot was kicked", "have no rights", "not enough rights" or "user is deleted" marks the recipient blocked; any other refusal marks it failed.
  8. When nothing is pending the broadcast becomes done with `finished_at`.
  9. A successful send is copied into the recipient's thread as an outbound message with source `telegram_broadcast`; a failure to copy never fails the send.
  10. QUIRK: counters are incremented per row, not recomputed, and the loop is driven by an open browser tab; a slow or killed request can leave a row sent but uncounted.
- **Async & events:** a loop of batch calls (WaDesk has no queue workers for this).
- **External systems:** Telegram send methods; ~30 messages a second overall, ~20 a minute into one group; 429 locks the bot out for a while.
- **Settings:** none.
- **Acceptance criteria:**
  - Given 60 pending recipients, When batches run, Then 25, 25 and 10 are sent in order and the broadcast ends done.
  - Given a recipient who blocked the bot, Then it is `blocked` and the blocked counter rises, not failed.
  - Given a photo attachment, Then it is uploaded once and every later recipient is sent by `file_id`.
  - Given a 1500 character text with a photo, Then the caption holds 1024 characters and the rest follows as a text message.
- **Source refs:** `TelegramBroadcastController` (`sendBatch`, `sendOne`, `fileIdFrom`, `personalise`, `mirror`, `stop`), `TelegramBroadcastRecipient::isUnreachable`, `TelegramMedia::readLocalMedia`.
- **Port notes:** replace the browser loop with a BullMQ job (`tg-broadcast`, job id the broadcast uuid) that claims pending recipients with `FOR UPDATE SKIP LOCKED`, applies a rate limiter well under 30 a second and recomputes counters from the rows (same pattern as `broadcasts`: `BroadcastProgressService`). A closed browser must no longer pause it; Pause remains an explicit action. List the loop change as an intended difference. Mirror into the inbox through the shim used by WD-BCAST-028.

### WD-TG-014 — Broadcast start, pause, retry failed, delete

- **Status:** implemented
- **Priority:** P0
- **Effort:** M
- **Depends on:** WD-TG-013
- **Summary:** The operator controls a broadcast's life.
- **Actors & access:** as WD-TG-011; every action is scoped to the workspace's own broadcasts (404 otherwise).
- **UX & screens:** row actions on the list.
- **Endpoints:**

| Method uri                                 | Route name                       | Controller@action                   | Request fields | Response         |
| ------------------------------------------ | -------------------------------- | ----------------------------------- | -------------- | ---------------- |
| POST telegram/broadcasts/{broadcast}/start | user.telegram.broadcasts.start   | TelegramBroadcastController@start   | none           | redirect + flash |
| POST telegram/broadcasts/{broadcast}/pause | user.telegram.broadcasts.pause   | TelegramBroadcastController@pause   | none           | redirect + flash |
| POST telegram/broadcasts/{broadcast}/retry | user.telegram.broadcasts.retry   | TelegramBroadcastController@retry   | none           | redirect + flash |
| DELETE telegram/broadcasts/{broadcast}     | user.telegram.broadcasts.destroy | TelegramBroadcastController@destroy | none           | redirect + flash |

- **Data:** broadcast status, counters, `started_at`, `finished_at`, `last_error`; recipient statuses.
- **Rules & edge cases:**
  1. Start needs at least one pending recipient, a connected bot and an active bot; it sets sending and the first `started_at`.
  2. Pause sets the status back to draft; pending rows stay pending.
  3. Retry moves only `failed` recipients back to pending (blocked ones are left: retrying a block is the same refusal), lowers the failed counter by that many, sets draft and clears `finished_at` and the error; nothing to retry is refused.
  4. Delete removes the recipients and the broadcast in any status, including sending.
- **Async & events:** none.
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given a draft with pending recipients, When started, Then it is sending.
  - Given 4 failed and 2 blocked, When retried, Then 4 are pending, failed drops by 4 and blocked is unchanged.
  - Given a paused bot, When start is pressed, Then it is refused with the bot's name.
- **Source refs:** `TelegramBroadcastController` (`start`, `pause`, `retry`, `destroy`, `authorizeBroadcast`).
- **Port notes:** delete of a sending broadcast should withdraw its queue job (same as `broadcasts`). Emit `telegram.broadcast.*` outbox events and audit rows.

### WD-TG-015 — Connect a Telegram user account (phone code, 2FA, QR)

- **Status:** implemented
- **Priority:** P2
- **Effort:** L
- **Depends on:** the Node bridge
- **Summary:** A real Telegram user login, used only to talk to @BotFather. It is the most sensitive credential in the app.
- **Actors & access:** workspace members with `access_telegram`. Needs the Telegram API id and hash and the Node service URL.
- **UX & screens:** "Connect Telegram Account" modal: a QR (scan-to-link) and a phone path (number with country code, then code, then the two-step password when asked). Cancel.
- **Endpoints:**

| Method uri                      | Route name                      | Controller@action                  | Middleware       | Request fields               | Response                 |
| ------------------------------- | ------------------------------- | ---------------------------------- | ---------------- | ---------------------------- | ------------------------ |
| POST telegram/account/send-code | user.telegram.account.send-code | TelegramAccountController@sendCode | plan gate        | phone (`+?\d{6,15}`, max 24) | redirect + flash         |
| POST telegram/account/sign-in   | user.telegram.account.sign-in   | @signIn                            | plan gate        | code (max 16), password?     | redirect + flash         |
| POST telegram/account/qr-start  | user.telegram.account.qr-start  | @qrStart                           | throttle 20/min  | none                         | JSON status or signed_in |
| POST telegram/account/qr-poll   | user.telegram.account.qr-poll   | @qrPoll                            | throttle 120/min | password?                    | JSON waiting/signed_in   |
| POST telegram/account/cancel    | user.telegram.account.cancel    | @cancel                            | plan gate        | none                         | redirect + flash         |

- **Data:** `telegram_accounts` (`session` encrypted and hidden, `tg_user_id`, `username`, `first_name`, `phone`, `connected_by`, `connected_at`); the in-flight login handle in the session.
- **Rules & edge cases:**
  1. Laravel holds only an opaque `loginId` between steps; the code and the password are never stored or logged. On "needs password" the operator re-enters the code with it.
  2. A login handle expires after 10 minutes on the Node side ("That login expired. Start again.").
  3. Code login stores the account per workspace (one account); QR login stores per person (`tg_user_id` unique per workspace), so several accounts can exist and a re-scan by the same person replaces the dead session.
  4. A QR confirmation can arrive on `qr-start` (code refresh) as well as `qr-poll`; both save the account (an earlier version lost it).
  5. A missing session in the reply is refused ("Telegram returned no session").
  6. Messages say whether the code went to the Telegram app or by SMS.
  7. Node unreachable, bad token, unreadable reply and a missing service URL each give a readable message; a non-admin sees "Telegram setup is currently unavailable. Please contact support".
- **Async & events:** Node holds a live MTProto socket.
- **External systems:** Node `/api/telegram-account/{send-code, sign-in, qr-start, qr-poll, status, log-out, create-bot, check-username}` with `X-Node-Token`; Telegram MTProto with the admin's API id and hash.
- **Settings:** `telegram_api_id`, `telegram_api_hash` (or env), `baileys_server_url` or `SERVER_URL`, the Node token.
- **Acceptance criteria:**
  - Given a correct code and no 2FA, When signed in, Then an account row with an encrypted session exists and nothing secret is logged.
  - Given an account with 2FA, When the code is sent alone, Then the password field appears.
  - Given a QR confirmed between two polls, When the next call returns, Then the account is saved.
- **Source refs:** `TelegramAccountController`, `TelegramAccountBridge`, `node/services/telegramAccountService.js`, `app/Models/TelegramAccount.php`.
- **Port notes:** depends on the node-bridge-runtime domain; the bridge is a provider port with a fake for tests. Encrypt the session and never serialize it (return only `label`, `username`, `connectedAt`). This feature is P2: build it after the bot flow and list it as `blocked on node bridge` if the bridge is not there.

### WD-TG-016 — Check and log out a Telegram account

- **Status:** implemented
- **Priority:** P2
- **Effort:** S
- **Depends on:** WD-TG-015
- **Summary:** Test that a stored session still works, or remove it.
- **Actors & access:** as WD-TG-015; the account id is scoped to the workspace.
- **UX & screens:** "Test session" and "Log out" on the account card.
- **Endpoints:**

| Method uri                         | Route name                       | Controller@action | Request fields | Response         |
| ---------------------------------- | -------------------------------- | ----------------- | -------------- | ---------------- |
| POST telegram/account/check        | user.telegram.account.check      | @check            | none           | redirect + flash |
| DELETE telegram/account/{account?} | user.telegram.account.disconnect | @disconnect       | account_id?    | redirect + flash |

- **Data:** `telegram_accounts.last_checked_at`, `last_error`; the row is deleted on log out.
- **Rules & edge cases:**
  1. Check records the time and the error (255 characters).
  2. Log out always deletes the row even when Telegram refuses; then the operator is told to also remove the device under Telegram → Settings → Devices. Bots already created keep working.
- **Async & events:** none.
- **External systems:** Node `status`, `log-out`.
- **Settings:** none.
- **Acceptance criteria:**
  - Given a dead session, When checked, Then the error shows and `last_error` is set.
  - Given Telegram refuses the logout, When logging out, Then the row is gone and the message names the manual step.
  - Given another workspace's account id, Then it is "not connected".
- **Source refs:** `TelegramAccountController@check`, `@disconnect`, `TelegramAccountBridge@status`, `@logOut`.
- **Port notes:** delete in the same transaction as the audit row.

### WD-TG-017 — Create a bot through @BotFather and check a username

- **Status:** implemented
- **Priority:** P2
- **Effort:** M
- **Depends on:** WD-TG-015, WD-TG-002
- **Summary:** With an account connected, create a bot from the hub: the Node bridge talks to @BotFather, and the new token is adopted exactly like a pasted one.
- **Actors & access:** as WD-TG-015.
- **UX & screens:** the "Create a new bot" form (name, username "must end in bot", an account picker when several) with a live availability check.
- **Endpoints:**

| Method uri                           | Route name                           | Controller@action | Middleware      | Request fields                                                                           | Response         |
| ------------------------------------ | ------------------------------------ | ----------------- | --------------- | ---------------------------------------------------------------------------------------- | ---------------- |
| POST telegram/account/create-bot     | user.telegram.account.create-bot     | @createBot        | throttle 10/min | name (max 64), username (5 to 32, letters, digits, underscore, ends in bot), account_id? | redirect + flash |
| POST telegram/account/check-username | user.telegram.account.check-username | @checkUsername    | throttle 20/min | username (max 32)                                                                        | JSON             |

- **Data:** a `telegram_bots` row via WD-TG-002.
- **Rules & edge cases:**
  1. The chosen account must belong to the workspace and hold a session ("Connect a Telegram account first.").
  2. A rejected username (taken or invalid) shows on the username field with @BotFather's own sentence and the form is kept.
  3. The token is never shown: it goes straight into the adopt path (getMe and setWebhook).
  4. If creation succeeded but adoption failed, the message says the bot exists on Telegram and to connect it by pasting its token, so the operator does not create a second one.
  5. The availability check starts /newbot and cancels it (there is no read-only check).
- **Async & events:** none.
- **External systems:** Node `create-bot` (90 s timeout), `check-username`.
- **Settings:** as WD-TG-015.
- **Acceptance criteria:**
  - Given a free username, When created, Then the bot is connected and the flash names it.
  - Given a taken username, Then the form stays with BotFather's reason on the username.
  - Given adoption fails after creation, Then the message explains the bot exists.
- **Source refs:** `TelegramAccountController@createBot`, `@checkUsername`, `node/services/telegramBotFatherService.js`.
- **Port notes:** reuse `adoptToken` as one service method called by both paths.

### WD-TG-018 — Flow runtime hand-off and the two Node callbacks (flow-log, flow-node)

- **Status:** implemented
- **Priority:** P1
- **Effort:** L
- **Depends on:** flow-runtime-engine
- **Summary:** Telegram flows run on the Node runtime. Laravel hands each inbound message over and Node answers whether a flow consumed it; Node calls back to mirror what it sent and to resolve AI and webhook nodes.
- **Actors & access:** system. Node callbacks are guarded by `X-Node-Token`.
- **UX & screens:** none (flows are built in the flow editor, type telegram, bound to a bot through `trigger_device_id`).
- **Endpoints:**

| Method uri                  | Route name | Controller@action               | Middleware   | Request fields                                               | Response                           |
| --------------------------- | ---------- | ------------------------------- | ------------ | ------------------------------------------------------------ | ---------------------------------- |
| POST api/telegram/flow-log  | none       | TelegramFlowNodeController@log  | X-Node-Token | botId, chatId, body, direction, mid, source, buttons         | `{ok:true}` or 401                 |
| POST api/telegram/flow-node | none       | TelegramFlowNodeController@node | X-Node-Token | action or type (ai, tg_ai, webhook), node, vars, workspaceId | `{ok, type, reply?, vars?}` or 401 |

- **Data:** `messages` and `conversations` (flow-log); `telegram_flow_sessions` (flow state, written by Node: status running, waiting, sleeping, done or failed, awaited variable, options, encrypted variables, expiry, poll id, invoice payload, payment link and reference).
- **Rules & edge cases:**
  1. Hand-off posts bot id, workspace id, chat id, text, the bot token and payment token, the flow data to start (omitted to resume), the flow id, variables and the app domain; a failure or timeout (15 s) means "not consumed".
  2. Resume after payment sends the text `__tg_paid__` with the paid amount, currency, charge id and payload.
  3. flow-log creates the thread if missing and writes an in or out message with source (default `flow`) and the buttons; empty body is ignored; always answers ok.
  4. flow-node `ai`: the model name picks the provider (claude → anthropic, gemini → gemini, mistral family → mistral, else openai; default model gpt-4o-mini); the system prompt defaults to a short Telegram assistant text; an optional knowledge base is appended; `{{var}}` is substituted in prompts; the reply is returned and optionally saved to a named variable (default 350 tokens, temperature 0.7).
  5. flow-node `webhook`: URL, headers and body are substituted; only public http or https hosts are allowed (every resolved address must be public; no redirects; 15 s timeout); methods GET, POST, PUT, PATCH, DELETE, HEAD; the response is saved as a variable and, if JSON, flattened to dotted variables.
  6. Unknown node types answer ok with empty text.
- **Async & events:** the runtime is Node; flow sessions have expiry.
- **External systems:** the Node service; AI providers; arbitrary customer URLs (SSRF guard).
- **Settings:** the Node token and service URL.
- **Acceptance criteria:**
  - Given a keyword flow that consumes the message, Then the hand-off answers `consumed = true`.
  - Given a webhook node to a private address, Then no request is made and `ok = false`.
  - Given a flow-log without the token, Then 401.
- **Source refs:** `app/Services/Telegram/TgFlowBridge.php`, `app/Http/Controllers/Telegram/TelegramFlowNodeController.php`, `node/services/telegramFlowService.js`, `app/Models/TelegramFlowSession.php`.
- **Port notes:** belongs with flow-runtime-engine; this domain provides the channel adapter (send message, buttons, poll, invoice) and the inbound hook, behind interfaces, with a fake. Until the runtime exists the hook returns "not consumed". Reuse the webhook SSRF guard from the flows domain.

### WD-TG-019 — Plan gates, platform switch and the telegram engine

- **Status:** partial
- **Priority:** P0
- **Effort:** S
- **Depends on:** plans-subscriptions-trials
- **Summary:** Who may use Telegram and how it appears across the app.
- **Actors & access:** platform admin (switch, API id and hash), plan owner (features).
- **UX & screens:** menu item "Telegram" (admin tier, `telegram_enabled`); plan editor features "Telegram (bots, inbox, flows, broadcasts)", the broadcasts sub-feature and the bots limit; admin Channel Settings fields for the MTProto API id and hash.
- **Endpoints:** none of its own.
- **Data:** `packages.access_telegram`, `packages.telegram_broadcasts`, `packages.telegram_bots_limit` (already in `plans`); system settings `telegram_enabled`, `telegram_api_id`, `telegram_api_hash`.
- **Rules & edge cases:**
  1. The channel routes need `access_telegram`; the broadcast routes need `access_telegram` and `telegram_broadcasts`.
  2. The menu entry disappears when `telegram_enabled` is off; the routes themselves are not blocked by that switch.
  3. A workspace sender list includes Telegram bots only when the caller asks for the `telegram` engine and `telegram_enabled` is on and a bot is connected; keys are `telegram:<bot row id>`.
  4. QUIRK: `telegram_bots_limit` is stored and shown in the plan editor but never enforced.
- **Async & events:** none.
- **External systems:** none.
- **Settings:** as above.
- **Acceptance criteria:**
  - Given a plan with the channel but not broadcasts, Then the hub opens and the broadcast screens are refused.
  - Given `telegram_enabled` off, Then the menu item is hidden.
- **Source refs:** `routes/telegram.php`, `app/Models/Package.php`, `app/Support/UserNav.php`, `app/Services/WorkspaceEngine.php`, `app/Models/SystemSetting.php`.
- **Port notes:** use `PlanEntitlementService` for the features; the plan columns and catalogue entries exist or are added by the PLAN domain (record any missing flag as `blocked on PLAN`). Enforcing the bot limit is a deliberate difference to decide with the reviewer.

## Data model

- **`telegram_bots`**: one connected bot. `bot_token` (encrypted), `bot_id` (Telegram's own id, unique per workspace for re-paste), `bot_username`, `bot_name`, `webhook_token` (unique routing token, 48 characters), `secret_token` (verified against the header), `active`, `connected_at`, `last_inbound_at`, `last_error` (255), `payment_provider_token` (encrypted), `payment_provider`, `connected_by`. Read by every feature; written by 002, 003, 007.
- **`telegram_accounts`**: a Telegram user login. `session` (encrypted, hidden), `tg_user_id` (unique per workspace), `username`, `first_name`, `phone`, `last_error`, `last_checked_at`, `connected_at`. Features 015 to 017.
- **`telegram_broadcasts`**: `name`, `template_id`, `body` (encrypted), `buttons` (encrypted array), `media_path`, `media_kind`, `media_file_id`, `status` (draft, sending, done, failed), `total`, `sent`, `failed`, `blocked`, `last_error`, `started_at`, `finished_at`. Features 011 to 014.
- **`telegram_broadcast_recipients`**: `chat_id` (plain, indexed), `title`, `kind` (private, group), `conversation_id`, `status` (pending, sent, failed, blocked), `provider_message_id`, `error`, `sent_at`; index on (broadcast, status). Features 012 to 014.
- **`telegram_flow_sessions`**: one live session per conversation: flow, node, status, awaited variable and options, encrypted variables, expiry, last message id, poll id, invoice payload, payment link and reference. Written by the Node runtime (018).
- Reused: `conversations`, `messages` (inbox), `contacts`, `wa_templates` (channel telegram), plan columns.

## Cross-domain contracts

- **Consumes:** team-inbox-conversations (write inbound, mirror broadcast sends, read threads for the audience, dispatch replies); contacts-attributes-tags (social contact per Telegram user); message-templates (Telegram templates and their buttons); flow-runtime-engine and node-bridge-runtime (flow hand-off, MTProto bridge, AI and webhook nodes); plans-subscriptions-trials (feature flags); platform-settings-branding-storage (API id and hash, media storage and URLs); notifications-activity-audit (audit rows).
- **Exposes:** `TelegramSender` (send text, media and keyboards through a bot) to team-inbox and flows; `telegram` engine entries for sender lists; outbox events `telegram.bot.connected`, `telegram.bot.disconnected`, `telegram.broadcast.*`; the public webhook route.

## Open questions & quirks

- `telegram_bots_limit` is declared and editable but never enforced (WD-TG-002, WD-TG-019).
- Broadcasts have no queue: sending is driven by an open browser tab; closing it pauses (WD-TG-013).
- Deleting a bot leaves broadcasts and flow sessions pointing at nothing (WD-TG-007).
- The "Sending" KPI counts only the latest 50 broadcasts (WD-TG-011).
- `chat_join_request` and `poll_answer` are accepted and acknowledged by the webhook but handled only inside the Node flow runtime, if at all (WD-TG-003); the comment in the code calls them "Phase 2".
- The hub route has no workspace-role guard while broadcast routes in other channels require admin.
- Telegram groups and channels appear in the audience even though a channel post has no sender; the type is guessed from messages (WD-TG-010).
- The setup text says Telegram "is Bot API, no OAuth/review" yet MTProto login is offered as an optional extra that depends on admin-supplied credentials.

## Coverage

```json wadesk-coverage
{
  "routes": [
    "GET telegram",
    "POST telegram/connect",
    "GET telegram/broadcasts",
    "GET telegram/broadcasts/create",
    "POST telegram/broadcasts",
    "POST telegram/broadcasts/{broadcast}/start",
    "POST telegram/broadcasts/{broadcast}/pause",
    "POST telegram/broadcasts/{broadcast}/retry",
    "POST telegram/broadcasts/{broadcast}/batch",
    "DELETE telegram/broadcasts/{broadcast}",
    "POST telegram/{bot}/payments",
    "POST telegram/{bot}/retry",
    "POST telegram/{bot}/toggle",
    "DELETE telegram/{bot}",
    "POST telegram/account/send-code",
    "POST telegram/account/sign-in",
    "POST telegram/account/qr-start",
    "POST telegram/account/qr-poll",
    "POST telegram/account/cancel",
    "POST telegram/account/check",
    "DELETE telegram/account/{account?}",
    "POST telegram/account/create-bot",
    "POST telegram/account/check-username",
    "POST api/telegram/inbound/{token}",
    "POST api/telegram/flow-log",
    "POST api/telegram/flow-node"
  ],
  "controllers": [
    "app/Http/Controllers/Telegram/TelegramAccountController.php",
    "app/Http/Controllers/Telegram/TelegramBroadcastController.php",
    "app/Http/Controllers/Telegram/TelegramConnectController.php",
    "app/Http/Controllers/Telegram/TelegramFlowNodeController.php",
    "app/Http/Controllers/Telegram/TelegramWebhookController.php"
  ],
  "services": [
    "app/Services/Telegram/TelegramAccountBridge.php",
    "app/Services/Telegram/TelegramChats.php",
    "app/Services/Telegram/TelegramClient.php",
    "app/Services/Telegram/TelegramMedia.php",
    "app/Services/Telegram/TgFlowBridge.php"
  ],
  "models": [
    "TelegramAccount",
    "TelegramBot",
    "TelegramBroadcast",
    "TelegramBroadcastRecipient",
    "TelegramFlowSession"
  ],
  "tables": [
    "telegram_accounts",
    "telegram_bots",
    "telegram_broadcast_recipients",
    "telegram_broadcasts",
    "telegram_flow_sessions"
  ],
  "views": [
    "resources/views/user/telegram/broadcasts-create.blade.php",
    "resources/views/user/telegram/broadcasts.blade.php",
    "resources/views/user/telegram/index.blade.php"
  ],
  "node_files": [
    "node/services/telegramAccountService.js",
    "node/services/telegramBotFatherService.js",
    "node/services/telegramFlowService.js"
  ],
  "js_assets": [
    "resources/js/charts/user-telegram-broadcasts.js",
    "resources/js/charts/user-telegram-index.js"
  ],
  "misc_files": ["routes/telegram.php"],
  "feature_map": {
    "WD-TG-001": ["GET telegram"],
    "WD-TG-002": ["POST telegram/connect"],
    "WD-TG-003": ["POST api/telegram/inbound/{token}"],
    "WD-TG-007": [
      "POST telegram/{bot}/payments",
      "POST telegram/{bot}/retry",
      "POST telegram/{bot}/toggle",
      "DELETE telegram/{bot}"
    ],
    "WD-TG-011": ["GET telegram/broadcasts"],
    "WD-TG-012": ["GET telegram/broadcasts/create", "POST telegram/broadcasts"],
    "WD-TG-013": ["POST telegram/broadcasts/{broadcast}/batch"],
    "WD-TG-014": [
      "POST telegram/broadcasts/{broadcast}/start",
      "POST telegram/broadcasts/{broadcast}/pause",
      "POST telegram/broadcasts/{broadcast}/retry",
      "DELETE telegram/broadcasts/{broadcast}"
    ],
    "WD-TG-015": [
      "POST telegram/account/send-code",
      "POST telegram/account/sign-in",
      "POST telegram/account/qr-start",
      "POST telegram/account/qr-poll",
      "POST telegram/account/cancel"
    ],
    "WD-TG-016": ["POST telegram/account/check", "DELETE telegram/account/{account?}"],
    "WD-TG-017": ["POST telegram/account/create-bot", "POST telegram/account/check-username"],
    "WD-TG-018": ["POST api/telegram/flow-log", "POST api/telegram/flow-node"]
  }
}
```
