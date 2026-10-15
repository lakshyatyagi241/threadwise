---
domain: channel-viber
code: VIB
title: Viber channel (Public Account connect, inbox, receipts, broadcasts, insights)
threadwise_version: '1.7.0'
sources_read: 22
---

# Viber channel

Written from the Reference source (`routes/viber.php`, the five controllers, `ViberClient`, `ViberChats`, `ViberFlowBridge`, `InboxDispatcher::dispatchViber`, the three models, the two migrations, the four Blade views, `user-viber-broadcasts.js`) and `Documentation/pages/channels/viber.html`. Where the running Reference, its source and its documentation disagree, the source wins and the difference is listed under the feature.

## Overview

A workspace connects one or more Viber Public Accounts (bots) by pasting the account's authentication token. The token is checked with Viber's `get_account_info`, which also returns the bot's name, address (`uri`) and icon; it is stored encrypted, and our own webhook is registered with Viber's `set_webhook`, so nothing is pasted back into Viber. Each channel has one signed callback URL. What Viber pushes (`message`, `subscribed`, `conversation_started`, `unsubscribed`, `delivered`, `seen`, `failed`) becomes `channel = viber` conversations in the shared team inbox (thread key `viber:<channelRowId>:<viberUserId>`), a contact keyed by the Viber user id, and receipts on the replies that were sent. The inbox replies through the same account. Viber has no 24 hour window: a person who has subscribed can be written to at any time; one who only opened the chat cannot.

Viber broadcasts use Viber's own `broadcast_message`: one call carries up to 300 subscribed user ids, the answer's `failed_list` names the users Viber refused, and the audience is the inbox threads the channel already has. Reference drives the batches from the open browser tab. An Insights page computes seven days of volume and receipt rates from the inbox's own messages.

Plan gates: `access_viber` (the channel, connect and insights) and `viber_broadcasts` (the broadcast screens). Neither has a platform on/off switch or an account limit. Connects to: team-inbox-conversations (threads, replies, receipts), contacts-attributes-tags (a contact per user), message-templates (templates whose channel is `viber`), flow-builder-editor and flow-runtime-engine (flows of type `viber`), plans-subscriptions-trials (feature flags), node-bridge-runtime (the flow engine).

## Feature index

| Id         | Feature                                                                | Status      | Priority | Effort | Depends on                 |
| ---------- | ---------------------------------------------------------------------- | ----------- | -------- | ------ | -------------------------- |
| TW-VIB-001 | Viber hub page: connect form, connected channels, setup guide          | implemented | P0       | M      | TW-VIB-002, TW-VIB-007     |
| TW-VIB-002 | Connect a channel from a pasted auth token                             | implemented | P0       | M      | TW-VIB-015                 |
| TW-VIB-003 | Per-channel inbound webhook: routing token, signature, always-200      | implemented | P0       | M      | TW-VIB-002                 |
| TW-VIB-004 | Inbound message to inbox thread, contact and media                     | implemented | P0       | L      | TW-VIB-003                 |
| TW-VIB-005 | subscribed, conversation_started and unsubscribed                      | implemented | P1       | S      | TW-VIB-004                 |
| TW-VIB-006 | delivered, seen and failed receipts                                    | implemented | P1       | M      | TW-VIB-008, TW-VIB-013     |
| TW-VIB-007 | Channel management: re-hook, pause and enable, remove                  | implemented | P0       | M      | TW-VIB-002                 |
| TW-VIB-008 | Outbound inbox reply through the channel                               | implemented | P0       | M      | TW-VIB-004                 |
| TW-VIB-009 | Template buttons as a Viber keyboard, files as picture, video or file  | implemented | P1       | S      | TW-VIB-008                 |
| TW-VIB-010 | Reachable audience: the threads a channel carries                      | implemented | P0       | S      | TW-VIB-004                 |
| TW-VIB-011 | Broadcast list with tiles and live progress                            | implemented | P0       | M      | TW-VIB-012                 |
| TW-VIB-012 | Broadcast compose: channel, audience, message, template, attachment    | implemented | P0       | M      | TW-VIB-010                 |
| TW-VIB-013 | Broadcast sending: 300 per call, failed_list, inbox mirror             | implemented | P0       | L      | TW-VIB-012                 |
| TW-VIB-014 | Broadcast start, pause, retry failed, delete                           | implemented | P0       | M      | TW-VIB-013                 |
| TW-VIB-015 | Plan gates and permission keys                                         | partial     | P0       | S      | plans-subscriptions-trials |
| TW-VIB-016 | Insights: seven days of volume, active users and receipt rates         | implemented | P1       | S      | TW-VIB-004, TW-VIB-006     |
| TW-VIB-017 | Flow runtime hand-off and the two Node callbacks (flow-log, flow-node) | blocked     | P1       | L      | flow-runtime-engine        |

## Features

### TW-VIB-001 — Viber hub page: connect form, connected channels, setup guide

- **Status:** implemented
- **Summary:** `/viber` is where a workspace connects and manages its channels. It carries the connect form, the list of connected channels and two side cards.
- **Actors & access:** workspace members on a plan with `access_viber`. No workspace-role guard.
- **UX & screens:** `resources/views/user/viber/index.blade.php`. Header "Viber Public Account" with buttons "Insights" and "Broadcasts" (shown once a channel exists). A "Connect a channel" card with one "Auth token" field and a "Connect Viber" button. A "Connected channels" list with a count: for each channel a purple "V" mark, the bot name with `viber.com/<uri>`, "Active" or "Paused" and the last error, the webhook URL, and the buttons "Re-hook", "Pause" or "Enable", and "Remove" (confirm). Side cards "Where to get the token" (three steps) and "Good to know" (five bullets).
- **Endpoints:** `GET viber` (`user.viber.index`, middleware `web, auth, plan:access_viber`).
- **Data:** reads `viber_channels` of the workspace, oldest first. The token is hidden on the model.
- **Rules & edge cases:** the token is never rendered. A channel shows its `last_error`. Paused is `active = false`.
- **Acceptance criteria:**
  - Given a workspace with two channels, When `/viber` opens, Then both are listed with their state and webhook URL and no token is in the page.
  - Given a plan without `access_viber`, When the page is requested, Then the plan gate refuses.
- **Source refs:** `ViberConnectController@index`, `resources/views/user/viber/index.blade.php`, `routes/viber.php`.
- **Port notes:** the connect form stays on the page (Reference has no dialog here). Reference's "Broadcasts" button depends on the route existing; ours on the broadcasts read permission.

### TW-VIB-002 — Connect a channel from a pasted auth token

- **Status:** implemented
- **Summary:** The operator pastes the token. We validate it with Viber, store it encrypted, create the routing token and register the webhook.
- **Endpoints:** `POST viber/connect` (`user.viber.connect`, `web, auth, plan:access_viber`), field `auth_token` (required, 20 to 255 characters).
- **Data:** writes `viber_channels`: `workspace_id`, `connected_by`, `auth_token` (encrypted), `viber_id`, `bot_name` (default "Viber"), `bot_uri`, `bot_avatar`, `webhook_token` (48 random), `active = true`, `connected_at`, `last_error = null`.
- **Rules & edge cases:**
  1. `get_account_info` must succeed ("Viber rejected that auth token: …"); nothing is saved otherwise.
  2. The same Viber account id in the same workspace updates its existing row: the routing token is kept, the token replaced, `active` set true and the error cleared.
  3. The webhook is registered after the row exists, for the events message, subscribed, unsubscribed, conversation_started, delivered, seen and failed, with `send_name` and `send_photo` on.
  4. When Viber refuses the webhook the channel stays saved with `last_error` (255 characters) and the message says the URL must be public HTTPS with a valid CA certificate (a local or IP address is rejected).
  5. The webhook URL is forced to https.
  6. Every send carries the bot's `sender` object (name, and avatar when it has one).
- **External systems:** Viber REST Bot API (`https://chatapi.viber.com/pa`), header `X-Viber-Auth-Token`. Success is the body's `status == 0`; the client never throws.
- **Acceptance criteria:**
  - Given a valid token, When connected, Then a channel exists with an encrypted token, a routing token and a registered webhook.
  - Given the same account pasted twice, When connected again, Then there is one channel and its webhook path is unchanged.
  - Given Viber rejects the token, When submitted, Then nothing is saved and the reason is shown.
  - Given Viber refuses the webhook, When connected, Then the channel is saved with the error shown on the hub.
- **Source refs:** `ViberConnectController@connect`, `ViberClient::getAccountInfo`, `setWebhook`, `ViberChannel`.
- **Port notes:** table `viber_channels`. Encrypt with `CryptoService`. Calls go through the `VIBER_API` provider port so tests use a fake. Emit `viber.channel.connected`.

### TW-VIB-003 — Per-channel inbound webhook: routing token, signature, always-200

- **Status:** implemented
- **Summary:** Viber pushes events to one URL per channel. The token in the URL finds the channel and the `X-Viber-Content-Signature` header (hex HMAC-SHA256 of the raw body with the auth token) proves the caller.
- **Endpoints:** `POST api/viber/inbound/{token}` (`viber.inbound`, `api, throttle:240,1`), alphanumeric token.
- **Rules & edge cases:**
  1. An unknown token is acknowledged `{status:0}` with 200.
  2. A wrong or missing signature answers 403 `{status:1, status_message:"bad signature"}`.
  3. Viber's validation ping (`event = webhook`) is acknowledged; a paused channel acknowledges and does nothing.
  4. A valid event sets `last_inbound_at` and clears `last_error`; a failure while handling is logged and still answers 200.
  5. QUIRK: the signature is checked only after the channel is found, so an unknown token never reaches the check.
- **Source refs:** `ViberWebhookController@ingest`, `ViberClient::verifySignature`.

### TW-VIB-004 — Inbound message to inbox thread, contact and media

- **Status:** implemented
- **Summary:** A user's message becomes a `viber` conversation, a message and a contact, then runs the shared automation (flow first, then routing, AI agent or keyword reply).
- **Rules & edge cases:**
  1. Thread key `viber:<channelRowId>:<userId>`; the title is the user's name, "Viber" until Viber gives one and replaced once it does.
  2. The contact is keyed by the Viber user id (source "Source: Viber") with the user's name and picture.
  3. What is shown (`extract`): text as sent; a picture its caption else "[image]"; a video "[video]"; a file its file name else "[file]"; a location "[location]" with latitude and longitude; a contact "[contact] name phone"; a sticker "[sticker]"; a url its address; anything else "[type]". A file is downloaded from the public address (it lives about an hour) into storage.
  4. `meta.viber` keeps `user_id`, `message_token`, `msg_type` and `sticker_id`.
  5. The thread's last message and last inbound times move, a resolved thread reopens and the unread count rises.
- **Source refs:** `ViberWebhookController@onMessage`, `extract`, `thread`, `storeMedia`, `Contact::forSocialSender`.
- **Port notes:** through `ExternalChannelIngest` (ledger dedup on the message token, sequence, unread, reopen, realtime). A 64 bit token is kept as text. The file download is guarded to Viber's own hosts.

### TW-VIB-005 — subscribed, conversation_started and unsubscribed

- **Status:** implemented
- **Rules & edge cases:**
  1. `subscribed` and `conversation_started` find or create the thread and the contact. Only a confirmed `subscribed` fires the welcome auto-responder; a bare `conversation_started` does not (the user has not subscribed, so a proactive send would be refused).
  2. `unsubscribed` is only logged. QUIRK: the documentation says unsubscribed users are skipped on the next broadcast; the source does not do it, Viber refuses the send and the user fails.
- **Source refs:** `onSubscribe`, `onUnsubscribe`.

### TW-VIB-006 — delivered, seen and failed receipts

- **Status:** implemented
- **Summary:** Viber reports each reply: `delivered`, `seen` and `failed` with the message token.
- **Rules & edge cases:**
  1. A receipt is matched to the outbound inbox message whose `meta.viber.message_token` equals the token; `delivered` stamps delivered, `seen` stamps read (and delivered), `failed` marks the message failed with Viber's `desc`.
  2. QUIRK: a broadcast's mirrored copy carries no token, so its receipts never matched anything and the broadcast's delivered and seen never moved.
- **Source refs:** `onReceipt`, `InboxDispatcher::dispatchViber`.

### TW-VIB-007 — Channel management: re-hook, pause and enable, remove

- **Status:** implemented
- **Endpoints:** `POST viber/{channel}/retry`, `POST viber/{channel}/toggle`, `DELETE viber/{channel}` (all `web, auth, plan:access_viber`; the channel must belong to the workspace, else 403).
- **Rules & edge cases:** re-hook registers the webhook again and sets or clears `last_error`; toggle flips `active`; remove calls `set_webhook` with an empty address (errors ignored) and deletes the row, the threads stay.
- **Source refs:** `ViberConnectController@retry, toggle, destroy`.

### TW-VIB-008 — Outbound inbox reply through the channel

- **Status:** implemented
- **Rules & edge cases:**
  1. The channel is read from the thread key; none connected is "Viber channel not connected"; a thread without a user id is "Viber recipient missing". A paused channel still sends.
  2. Text goes as a text message (a single space when empty). A media reply is a picture (the text is its caption), a video, or a file; for a video or file the text goes first as its own message. Viber pulls the public address.
  3. The answer's `message_token` is the provider id and is kept for receipts.
  4. Viber status 6 reads "The Viber user must open a chat with you before you can message them."
- **Source refs:** `InboxDispatcher::dispatchViber`.
- **Port notes:** a `ChannelAdapter` of kind `viber`, no window, receipts sent, delivered and read. A video or file is sent with its real size (Reference sent 1).

### TW-VIB-009 — Template buttons as a Viber keyboard, files as picture, video or file

- **Status:** implemented
- **Rules & edge cases:** a template's buttons become an inline keyboard (up to 24, `min_api_version` 3, purple): a real link is an open-url button, a phone is a `tel:` link, everything else a reply button whose text comes back as a message. Button text is HTML-escaped. A body of nothing is one space.
- **Source refs:** `ViberClient::withKeyboard`, `templateToMessages`.

### TW-VIB-010 — Reachable audience: the threads a channel carried

- **Status:** implemented
- **Rules & edge cases:** the audience is the channel's own conversations, newest first, at most 1000 (`ViberChats::forChannel`); each carries the title and the user id. A user who only subscribed is included because the thread exists.
- **Source refs:** `app/Services/Viber/ViberChats.php`.

### TW-VIB-011 — Broadcast list with tiles and live progress

- **Status:** implemented
- **UX & screens:** `broadcasts.blade.php`. Four tiles (Sent, Audience, Failed, Sending), a table (Broadcast, Recipients, Progress, Status, Actions) with a progress bar and "x sent · y failed", status pills (Sending, Done, Failed, Draft), Start (Resume while sending), Retry when failed users remain, Delete. "Connect a channel" empty state.
- **Endpoints:** `GET viber/broadcasts` (`web, auth, plan:viber_broadcasts`), the 50 newest.
- **Rules & edge cases:** QUIRK: the "Sending" tile counts only the 50 listed rows. Progress is (sent + failed) of total.
- **Source refs:** `ViberBroadcastController@index`.

### TW-VIB-012 — Broadcast compose: channel, audience, message, template, attachment

- **Status:** implemented
- **Endpoints:** `GET viber/broadcasts/create`, `POST viber/broadcasts` with `name` (191), `viber_channel_id`, `template_id`, `body` (7000), `user_ids[]` (at least one, 64 characters each), `media` (jpg, jpeg, png, gif or mp4, 26 MB).
- **Rules & edge cases:**
  1. The channel must belong to the workspace; a template counts only when its channel is `viber`; its body fills an empty message and its buttons come along.
  2. A message, a file, or both ("A broadcast needs a message, a file, or both.").
  3. Forged ids are dropped; none left is "None of those users belong to this channel."
  4. The recipient list is frozen at creation; body and buttons are stored encrypted. An mp4 is a video, any other file a picture.
  5. There is no personalisation (one message goes to everyone). The documentation also promises a live preview; the screen has none.
- **Source refs:** `ViberBroadcastController@create, store`, `broadcasts-create.blade.php`, `user-viber-broadcasts.js`.

### TW-VIB-013 — Broadcast sending: 300 per call, failed_list, inbox mirror

- **Status:** implemented
- **Rules & edge cases:**
  1. Each batch is a single `broadcast_message` call for up to 300 pending ids with one message object.
  2. `failed_list` names the users Viber refused (with `status_message`): they fail, everyone else is sent.
  3. A whole call that Viber rejects fails every user of the batch and the broadcast (`last_error`), and stops.
  4. A sent user's thread gets an outbound copy of the body; a failure there never fails the send.
  5. Done when nobody is pending.
  6. QUIRK: Reference keeps no message token on a recipient, so delivered and seen cannot reach the broadcast.
- **Async & events:** Reference loops from the open browser tab (`POST …/batch` every 500 ms). Here a queue job does.
- **Source refs:** `ViberBroadcastController@sendBatch, buildMessage, mirror`, `ViberClient::broadcast`.

### TW-VIB-014 — Broadcast start, pause, retry failed, delete

- **Status:** implemented
- **Endpoints:** `POST viber/broadcasts/{id}/start`, `/pause`, `/retry`, `DELETE viber/broadcasts/{id}`.
- **Rules & edge cases:** start needs a pending user and an active channel; pause returns to draft with the rest still pending; retry puts failed users back to pending and the broadcast to draft (nothing failed is "Nothing to retry — no recipient failed."); delete removes the broadcast and its recipients in any status.
- **Source refs:** `ViberBroadcastController@start, pause, retry, destroy`.

### TW-VIB-015 — Plan gates and permission keys

- **Status:** partial
- **Rules & edge cases:** `access_viber` gates `/viber`, connect, re-hook, toggle, remove and insights; `viber_broadcasts` gates the broadcast screens. Neither the platform nor the plan has a switch to hide the menu entry.
- **Port notes:** both flags are the one plan feature `extra_channels` here, on every controller. Permission keys `viber.channels.read|manage` and `viber.broadcasts.read|manage` replace the missing workspace-role guard; insights reads with `viber.channels.read`.

### TW-VIB-016 — Insights: seven days of volume, active users and receipt rates

- **Status:** implemented
- **UX & screens:** `insights.blade.php`. A channel picker (with more than one channel), tiles Active users (7d), Received (7d), Sent (7d) with "x% seen · y% delivered", Failed (7d), and a "Daily volume" list of seven bars (received and sent).
- **Endpoints:** `GET viber/insights?channel=` (`web, auth, plan:access_viber`).
- **Rules & edge cases:** computed from the channel's own messages (Viber has no analytics API); active users are threads with a message from the user in the window. QUIRK: the delivered, seen and failed counts are not limited to seven days although their labels say so.
- **Source refs:** `ViberInsightsController`, `insights.blade.php`.

### TW-VIB-017 — Flow runtime hand-off and the two Node callbacks (flow-log, flow-node)

- **Status:** blocked (flow-runtime-engine)
- **Summary:** A message is posted to the Node runtime `/api/viber-flow/inbound` (header `X-Node-Token`, 15 s) with the channel, user, text, the account's auth token and sender, and the flow to start (matched on type `viber`, trigger device = the channel, published and active, by keyword, `any`, `*`, `.*` or `.+`). Node sends directly and answers `consumed`; a consumed message stops routing, the AI agent and keyword replies. Node calls back `POST api/viber/flow-log` (mirror a flow message into the inbox) and `POST api/viber/flow-node` (smart AI and webhook nodes), both `X-Node-Token` guarded.
- **Port notes:** the flow runtime launches by channel kind from the inbox's stored messages (the `viber` entry of its launch map) and sends through the channel adapter, so the two callbacks are not recreated. `viber_flow_sessions` exists unused. Not proven end to end for Viber.
- **Source refs:** `ViberFlowBridge`, `ViberFlowNodeController`, `routes/viber.php`, `node/services/viberFlowService.js`, `node/controllers/viberFlowController.js`.
