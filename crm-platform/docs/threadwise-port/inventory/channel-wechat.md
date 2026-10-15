---
domain: channel-wechat
code: WECH
title: WeChat channel (Official Account, inbox, broadcasts)
threadwise_version: '1.7.0'
sources_read: 22
---

# WeChat channel

## Overview

A workspace connects one or more WeChat Official Accounts (certified Service Accounts) by pasting the account's AppID, AppSecret and a
server Token it chose in the WeChat console (plus an optional EncodingAESKey and a message mode). The credentials are proved by
fetching an access token, then stored encrypted. WeChat has no API to set the webhook, so the screen shows a per-channel address
(`/api/wechat/inbound/{token}`) and the Token for the person to paste into the console by hand and enable. One address answers both
the console's URL check (GET: echo `echostr` when the signature is right) and the messages (POST: XML). Every request is signed:
`signature` = sha1 of the sorted token, timestamp and nonce. In safe mode the body is AES-encrypted and signed again.

Messages become `channel = wechat` conversations in the team inbox (thread key `wechat:<channelRowId>:<openid>`); the follower becomes a
contact keyed by OpenID with a best-effort profile (nickname, photo). Text, image, voice (with WeChat's speech text), video, short
video, location and link messages are stored, as are the follow event and a custom-menu tap (replayed as the menu key typed as a
message). The webhook always answers `success` and never replies passively: automation answers asynchronously.

Replies from the inbox are customer-service messages, allowed for 48 hours after the follower's last message; outside it Reference
refuses and says a template message is required (its `sendTemplate` client method has no caller). The access token is shared per
account and fetching a new one invalidates the old one, so it is cached on the channel row and refreshed under a lock, and refreshed
once when WeChat answers 40001, 42001 or 40014.

Broadcasts use WeChat's mass send (群发): ONE API call to an audience (all followers, a tag, or a list of at least two OpenIDs picked
from the inbox), text only up to 2000 characters. Reference makes the call inside the Send request, ends the broadcast `done` (with
WeChat's `msg_id`) or `failed`, and copies the text into each picked follower's thread. A Service Account may mass-send about four
times a month; Reference only says so in copy and enforces nothing.

Plan gates: `access_wechat` (the channel and its pages), `wechat_broadcasts` (the broadcast pages), `wechat_channels_limit` (declared,
never enforced). Platform switch: setting `wechat_enabled` (default off) hides the menu entry and the template/devices entries.

Connects to: team-inbox-conversations (threads, replies), contacts-attributes-tags (contact per follower), message-templates (WeChat
templates prefill a broadcast), flow-builder-editor and flow-runtime-engine (flows of type `wechat`, node bridge), plans-subscriptions-trials
(feature flags), node-bridge-runtime (flow engine), contact-consent (send gate).

## Feature index

| Id          | Feature                                                          | Status      | Priority | Effort | Depends on                 |
| ----------- | ---------------------------------------------------------------- | ----------- | -------- | ------ | -------------------------- |
| TW-WECH-001 | WeChat hub page: channels, status, setup guide                   | implemented | P0       | M      | TW-WECH-002, TW-WECH-004   |
| TW-WECH-002 | Connect an Official Account from pasted credentials              | implemented | P0       | M      | TW-WECH-003, TW-WECH-016   |
| TW-WECH-003 | Shared access token: cache, lock, refresh on invalid             | implemented | P0       | M      | TW-WECH-002                |
| TW-WECH-004 | Re-check, pause and enable, remove a channel                     | implemented | P0       | S      | TW-WECH-002                |
| TW-WECH-005 | Webhook: URL check (GET) and signed XML (POST), always `success` | implemented | P0       | M      | TW-WECH-002                |
| TW-WECH-006 | AES safe mode: message signature and decryption                  | partial     | P1       | M      | TW-WECH-005                |
| TW-WECH-007 | Inbound message to inbox thread, contact and message             | implemented | P0       | L      | TW-WECH-005                |
| TW-WECH-008 | Follow, unfollow and menu-tap events                             | implemented | P1       | S      | TW-WECH-007                |
| TW-WECH-009 | Outbound inbox reply with the 48 hour window and media           | implemented | P0       | M      | TW-WECH-003, TW-WECH-007   |
| TW-WECH-010 | Template message to reach a follower outside the window          | dead-code   | P2       | S      | TW-WECH-009                |
| TW-WECH-011 | Reachable audience: the followers a channel carried              | implemented | P0       | S      | TW-WECH-007                |
| TW-WECH-012 | Broadcast list                                                   | implemented | P0       | S      | TW-WECH-013                |
| TW-WECH-013 | Broadcast compose: channel, audience, template, text             | implemented | P0       | M      | TW-WECH-011                |
| TW-WECH-014 | Mass send: one call, done or failed, inbox mirror                | implemented | P0       | M      | TW-WECH-013                |
| TW-WECH-015 | Delete a broadcast                                               | implemented | P1       | S      | TW-WECH-013                |
| TW-WECH-016 | Plan gates and the platform switch                               | partial     | P0       | S      | plans-subscriptions-trials |
| TW-WECH-017 | Custom menu builder (the bottom bar of the account)              | implemented | P1       | M      | TW-WECH-003                |
| TW-WECH-018 | Follower insights (new, cancelled and total per day)             | implemented | P2       | S      | TW-WECH-003                |
| TW-WECH-019 | Flow hand-off and the two Node callbacks (flow-send, flow-node)  | implemented | P1       | L      | flow-runtime-engine        |
| TW-WECH-020 | Client methods with no caller (parametric QR, typing indicator)  | dead-code   | P2       | S      | TW-WECH-003                |

## Features

### TW-WECH-001 — WeChat hub page: channels, status, setup guide

- **Status:** implemented
- **Priority:** P0
- **Effort:** M
- **Depends on:** TW-WECH-002, TW-WECH-004
- **Summary:** `/wechat` lists the workspace's channels with their state and the values to paste into the WeChat console, holds the connect form, and shows a setup guide.
- **Actors & access:** a signed-in workspace user; plan feature `access_wechat`. No role check beyond the workspace.
- **UX & screens:** `resources/views/user/wechat/index.blade.php`. Header "WeChat Official Account" with the intro; when at least one channel exists, buttons Menu, Insights and (when the broadcast route exists) Broadcasts. A "Connect a channel" card with the form (TW-WECH-002). A "Connected channels" card with a count; each row: green "W" badge, account name and the account's wx id, "Active" or "Paused" with the AppID and the last error, a box "Paste into WeChat → Server Config" with the URL and the Token, and the buttons Re-check, Pause or Enable, Remove (browser confirm "Remove this WeChat channel?"). Empty state "No WeChat channels connected yet." A side card "How to connect" (five steps and a note about HTTPS and the IP allowlist) and "Good to know" (four bullets).
- **Endpoints:** `GET /wechat | user.wechat.index | WeChatConnectController@index | web, auth, plan:access_wechat`.
- **Data:** `wechat_channels` of the workspace, ordered by id.
- **Rules & edge cases:** 1. The Token is printed in clear on the page (Reference decrypts it for display). 2. The URL is forced to https. 3. Flash messages carry status and error text.
- **Async & events:** none.
- **External systems:** none.
- **Settings:** `wechat_enabled` (platform) decides whether the menu entry exists.
- **Acceptance criteria:** Given no channel, When the page opens, Then the empty state and the guide show. Given channels, Then each shows its URL, Token, state and last error. Given a paused channel, Then the button reads Enable.
- **Source refs:** `app/Http/Controllers/WeChat/WeChatConnectController.php`, `resources/views/user/wechat/index.blade.php`, `routes/wechat.php`.
- **Port notes:** `apps/web/src/features/channel-wechat` (hub). Menu and Insights buttons are not shown (TW-WECH-017, 018 blocked). The Token is shown only on request to people who manage the channel; the connect form is a modal (decision of the channel port brief).

### TW-WECH-002 — Connect an Official Account from pasted credentials

- **Status:** implemented
- **Priority:** P0
- **Effort:** M
- **Depends on:** TW-WECH-003, TW-WECH-016
- **Summary:** Paste AppID, AppSecret, a Token and optionally an EncodingAESKey and message mode; WeChat proves them; the channel is saved encrypted and its address and Token are shown.
- **Actors & access:** workspace user; plan `access_wechat` (else the error "Your plan does not include WeChat.").
- **UX & screens:** fields: account name (optional, max 191, default "WeChat"), AppID (required, max 64), AppSecret (required, max 128, password), Server Token (required, max 128), EncodingAESKey (optional, exactly 43 characters), Message mode (compatible default, plaintext, safe). Success flash tells the person to paste the URL and Token into Server Config and enable it.
- **Endpoints:** `POST /wechat/connect | user.wechat.connect | WeChatConnectController@connect | web, auth, plan:access_wechat`.
- **Data:** `wechat_channels` (`app_secret`, `encoding_aes_key`, `cached_access_token` encrypted; `webhook_token` 48 random alphanumerics; `connected_by`; `connected_at`; `active = true`; `last_error` cleared).
- **Rules & edge cases:** 1. The credentials are proved by fetching an access token before anything is saved; a refusal returns "WeChat rejected those credentials: <errcode errmsg>" on the AppSecret field and the form is kept. 2. Pasting the same AppID again in the workspace updates the SAME row and keeps its webhook token, so the registered address stays valid. 3. The fetched token and its expiry (at least 60 s, default 7200 s) are cached. 4. No workspace selected: error. 5. QUIRK: choosing safe mode without a key is accepted, then every encrypted message is silently dropped.
- **Async & events:** none (log line only).
- **External systems:** `GET api.weixin.qq.com/cgi-bin/token?grant_type=client_credential&appid&secret`; 15 s timeout; the AppSecret travels in the query string.
- **Settings:** none.
- **Acceptance criteria:** Given valid credentials, When connecting, Then a row exists with encrypted secrets and the address and Token are shown. Given WeChat refuses, Then nothing is saved and the reason is shown. Given the same AppID again, Then one row and the same address.
- **Source refs:** `WeChatConnectController@connect`, `Models/WeChatChannel.php`, `Services/WeChat/WeChatClient.php` (`fetchAccessToken`).
- **Port notes:** `ChannelsService.connect`; safe mode now requires the key (documented fix); the Token is returned only through the manager-gated server-config endpoint.

### TW-WECH-003 — Shared access token: cache, lock, refresh on invalid

- **Status:** implemented
- **Priority:** P0
- **Effort:** M
- **Depends on:** TW-WECH-002
- **Summary:** One access token per account, cached on the channel row and refreshed under a lock; WeChat invalidates the old token whenever a new one is fetched.
- **Actors & access:** system.
- **UX & screens:** none; a failure shows as the channel's last error.
- **Endpoints:** none.
- **Data:** `cached_access_token` (encrypted), `token_expires_at`, `last_error`.
- **Rules & edge cases:** 1. A cached token is used until five minutes before it expires. 2. Otherwise a refresh runs under a 15 s lock (waits up to 10 s); after the wait the row is re-read in case another process refreshed. 3. A refresh failure stores `access_token: <reason>` (200 chars) as the last error and falls back to whatever token is cached. 4. A call that gets errcode 40001, 42001 or 40014 refreshes once and repeats once. 5. No token at all: the call returns "no access_token".
- **Async & events:** none.
- **External systems:** as TW-WECH-002.
- **Settings:** none.
- **Acceptance criteria:** Given two requests racing on an expired token, Then one token is fetched. Given WeChat says the token is invalid, Then the call is retried once with a new token.
- **Source refs:** `Models/WeChatChannel.php` (`activeAccessToken`, `refreshAccessToken`), `WeChatClient@call`.
- **Port notes:** `WechatTokenService` (Redis lock, row cache). The IP allowlist and the shared-token warning of the docs apply to every account.

### TW-WECH-004 — Re-check, pause and enable, remove a channel

- **Status:** implemented
- **Priority:** P0
- **Effort:** S
- **Depends on:** TW-WECH-002
- **Summary:** Three row actions on the hub.
- **Actors & access:** workspace user owning the channel (else 403).
- **UX & screens:** Re-check (refreshes the token; flash "WeChat credentials re-validated." or the refusal), Pause or Enable (flash "WeChat channel enabled." or "WeChat channel paused."), Remove (confirm, then "WeChat channel removed.").
- **Endpoints:** `POST /wechat/{channel}/retry`, `POST /wechat/{channel}/toggle`, `DELETE /wechat/{channel}`.
- **Data:** `wechat_channels.active`, `last_error`; delete removes the row (its broadcasts and flow sessions cascade).
- **Rules & edge cases:** 1. A paused channel still answers the URL check but ignores messages. 2. Removing a channel leaves its inbox threads. 3. Re-check force-expires the cached token first.
- **Async & events:** none.
- **External systems:** token endpoint (re-check).
- **Settings:** none.
- **Acceptance criteria:** Given an active channel, When paused, Then messages are ignored and the button reads Enable. Given a removed channel, Then its threads remain.
- **Source refs:** `WeChatConnectController@retry|toggle|destroy`.
- **Port notes:** `ChannelsService.recheck|toggle|remove`; also mirrors the state into the inbox channel and writes audit and outbox events.

### TW-WECH-005 — Webhook: URL check (GET) and signed XML (POST), always `success`

- **Status:** implemented
- **Priority:** P0
- **Effort:** M
- **Depends on:** TW-WECH-002
- **Summary:** The public address WeChat calls.
- **Actors & access:** WeChat; no session; throttle 240 requests a minute.
- **UX & screens:** none.
- **Endpoints:** `GET|POST /api/wechat/inbound/{token} | wechat.inbound | WeChatWebhookController@handle | api, throttle:240,1`; the token matches `[A-Za-z0-9]+`.
- **Data:** `wechat_channels` by `webhook_token`; `last_inbound_at` and a cleared `last_error` on every accepted POST.
- **Rules & edge cases:** 1. Unknown token: `success`, 200, nothing else. 2. The signature (sha1 of the sorted Token, timestamp and nonce) is checked on GET and POST; a mismatch is a bare 403. 3. GET with a valid signature echoes `echostr` as text/plain. 4. A paused channel answers `success` to a POST without storing. 5. The answer to a stored message is always `success` (no passive reply, because of WeChat's 5 second window). 6. A failure while storing is logged and still answered `success`.
- **Async & events:** the inbox pipeline (TW-WECH-007); a `MessageReceived` event.
- **External systems:** WeChat.
- **Settings:** none.
- **Acceptance criteria:** Given a valid signature, When WeChat checks the address, Then `echostr` comes back. Given a bad signature, Then 403 and nothing stored. Given a redelivery, Then the message is stored once.
- **Source refs:** `WeChatWebhookController@handle`, `Services/WeChat/WeChatCrypto.php`, `routes/wechat.php`.
- **Port notes:** `POST` and `GET /v2/wechat/inbound/:token`; tenant by `wech_channel_lookup`; the XML is read as text before the controller; a redelivery is deduplicated by the MsgId.

### TW-WECH-006 — AES safe mode: message signature and decryption

- **Status:** partial
- **Priority:** P1
- **Effort:** M
- **Depends on:** TW-WECH-005
- **Summary:** In safe mode the POST body carries `<Encrypt>`; its `msg_signature` is checked and it is decrypted with the EncodingAESKey before parsing.
- **Actors & access:** WeChat.
- **UX & screens:** the Message mode select and the key field of the connect form (the select labels safe mode "Phase 2").
- **Endpoints:** as TW-WECH-005.
- **Data:** `enc_mode` (compat default), `encoding_aes_key` (encrypted).
- **Rules & edge cases:** 1. Only when `enc_mode` is `safe` and `<Encrypt>` is present. 2. `msg_signature` = sha1 of the sorted token, timestamp, nonce and the encrypted text; a mismatch is 403. 3. AES-256-CBC, IV the first 16 key bytes; the plaintext is 16 random bytes, a 4 byte length, the XML, the AppID (checked); PKCS7 padding to 32. 4. A decrypt failure is acknowledged and dropped. 5. QUIRK: the GET URL check does not handle the encrypted `echostr` of safe mode, so the console's check would fail in that mode.
- **Async & events:** none.
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:** Given an encrypted body with a valid message signature, Then the message is stored. Given a wrong message signature, Then 403.
- **Source refs:** `WeChatCrypto@decryptSafeMode`, `msgSignatureMatches`.
- **Port notes:** also handles the encrypted echo of the URL check (documented fix). Not verified against a real WeChat account.

### TW-WECH-007 — Inbound message to inbox thread, contact and message

- **Status:** implemented
- **Priority:** P0
- **Effort:** L
- **Depends on:** TW-WECH-005
- **Summary:** A follower's message becomes a conversation, a contact and a message.
- **Actors & access:** system.
- **UX & screens:** the team inbox.
- **Endpoints:** none of its own.
- **Data:** `conversations` (`channel = wechat`, `raw_jid = wechat:<rowId>:<openid>`, title "WeChat" then the nickname), `inbox_messages`/`messages` (provider `wechat`, meta `{openid, msg_id, msg_type, event, event_key}`), `contacts` (channel `wechat`, `channel_uid` OpenID; name "Wechat user" until the nickname is known; avatar filled once).
- **Rules & edge cases:** 1. Text keeps its Content; image `[image]`, voice its speech text or `[voice]`, video and short video `[video]`, location `[location] <label>` with coordinates, link title and URL, any other type `[type]`. 2. Image, voice and video files are downloaded with the account's token into storage. 3. A new thread asks WeChat for the profile (best effort; WeChat's 2021 privacy change often leaves nickname and photo empty). 4. A resolved thread reopens; unread increases. 5. Automation then runs: a published `wechat` flow whose keywords match is started or resumed on the Node runtime (the message is consumed), else routing, the assigned AI agent, or a keyword reply.
- **Async & events:** `MessageReceived`; automation; flow hand-off.
- **External systems:** `GET /cgi-bin/user/info`, `GET /cgi-bin/media/get`.
- **Settings:** none.
- **Acceptance criteria:** Given a first message, Then a thread, a contact and an unread message exist. Given the same MsgId again, Then nothing new. Given an image, Then the file is stored.
- **Source refs:** `WeChatWebhookController@store|thread|extract|storeMedia`.
- **Port notes:** `InboundService`, `ChatInboxIngest` over `ExternalChannelIngest`; the message goes through the shared pipeline (dedup, sequence, unread, reopen, realtime). Automation and flow hand-off are the inbox's listeners (TW-WECH-019).

### TW-WECH-008 — Follow, unfollow and menu-tap events

- **Status:** implemented
- **Priority:** P1
- **Effort:** S
- **Depends on:** TW-WECH-007
- **Summary:** Events other than messages.
- **Actors & access:** WeChat.
- **UX & screens:** none.
- **Endpoints:** as TW-WECH-005.
- **Data:** as TW-WECH-007.
- **Rules & edge cases:** 1. `subscribe` creates the thread with an empty message and lets automation fire a welcome. 2. `unsubscribe` is only logged: no write, no opt-out (a comment says the contact layer owns it). 3. `CLICK` replays its EventKey as the message text. 4. Scans, views, location events and the rest are acknowledged only.
- **Async & events:** as TW-WECH-007.
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:** Given a follow, Then a thread exists. Given an unfollow, Then nothing is written. Given a menu tap, Then its key is a message.
- **Source refs:** `WeChatWebhookController@handleEvent|optOut`.
- **Port notes:** same behaviour (the brief's "unsubscribe becomes an inbox message" is not what Reference does).

### TW-WECH-009 — Outbound inbox reply with the 48 hour window and media

- **Status:** implemented
- **Priority:** P0
- **Effort:** M
- **Depends on:** TW-WECH-003, TW-WECH-007
- **Summary:** A reply typed in the inbox leaves as a customer-service message from the account that carried the thread.
- **Actors & access:** inbox users who can reply.
- **UX & screens:** the inbox composer.
- **Endpoints:** `POST /cgi-bin/message/custom/send` at WeChat.
- **Data:** the message row.
- **Rules & edge cases:** 1. The channel is read from the thread key; a missing channel is "WeChat channel not connected"; a missing OpenID "WeChat recipient missing". 2. A free-form send needs the follower's last inbound message within 48 hours, else "Outside the 48-hour WeChat window — a template message is required." 3. Text is cut to 2048 characters. 4. A file is uploaded as temporary media (image, voice or video; video uses its own id as thumbnail); the caption is sent first as its own text message; a failed upload falls back to the caption or a link as text. 5. The refusal reason of WeChat is returned.
- **Async & events:** the inbox send job.
- **External systems:** `POST /cgi-bin/message/custom/send`, `POST /cgi-bin/media/upload`.
- **Settings:** none.
- **Acceptance criteria:** Given a follower who wrote an hour ago, When an agent replies, Then WeChat gets the text. Given 49 hours, Then the reply is refused.
- **Source refs:** `InboxDispatcher@dispatchWeChat`, `WeChatClient@sendCustomMessage|uploadMedia`.
- **Port notes:** `WechatChannelAdapter` (window 48 h, templates, media image/audio/video); the refusal codes of WeChat are told apart (window closed, not following).

### TW-WECH-010 — Template message to reach a follower outside the window

- **Status:** dead-code
- **Priority:** P2
- **Effort:** S
- **Depends on:** TW-WECH-009
- **Summary:** The client can send a WeChat Template Message (`/cgi-bin/message/template/send`) but nothing calls it; the dispatcher only says a template is required.
- **Actors & access:** none.
- **UX & screens:** none.
- **Endpoints:** none.
- **Data:** none.
- **Rules & edge cases:** the template id comes from the account's own approved templates.
- **Async & events:** none.
- **External systems:** `POST /cgi-bin/message/template/send`.
- **Settings:** none.
- **Acceptance criteria:** none in Reference.
- **Source refs:** `WeChatClient@sendTemplate`.
- **Port notes:** the adapter accepts a template envelope and sends it (name = WeChat template id, variables = keywords, `url` = link). The inbox's template picker lists WhatsApp templates only, so no inbox screen reaches it yet.

### TW-WECH-011 — Reachable audience: the followers a channel carried

- **Status:** implemented
- **Priority:** P0
- **Effort:** S
- **Depends on:** TW-WECH-007
- **Summary:** The audience of a picked-users broadcast is the channel's inbox threads (followers who wrote), newest first, up to 1000.
- **Actors & access:** workspace user.
- **UX & screens:** the recipient list of the compose screen; empty state "No reachable users yet — someone must message this account first."
- **Endpoints:** none of its own (the compose page embeds it).
- **Data:** `conversations` of channel wechat whose key starts with the channel prefix.
- **Rules & edge cases:** 1. Title falls back to "WeChat user". 2. Threads without an OpenID are dropped.
- **Async & events:** none.
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:** Given three followers who wrote, Then three can be picked.
- **Source refs:** `Services/WeChat/WeChatChats.php`.
- **Port notes:** `GET /wechat/channels/:id/chats`.

### TW-WECH-012 — Broadcast list

- **Status:** implemented
- **Priority:** P0
- **Effort:** S
- **Depends on:** TW-WECH-013
- **Summary:** `/wechat/broadcasts`: the 50 newest broadcasts with audience, status and actions.
- **Actors & access:** plan `wechat_broadcasts`.
- **UX & screens:** `broadcasts.blade.php`. Header "WeChat broadcasts" with the monthly-limit sentence; buttons Channels and New broadcast. Without channels: "Connect a WeChat channel first." and a button. A table: name with date and error, audience (All followers, Tag N, N users), status pill (Sent, Failed, Draft), Send (confirm "Send this broadcast now? WeChat counts it against your ~4/month limit.") for anything not done, and a delete icon (confirm "Delete this broadcast?"). Empty: "No broadcasts yet." and "Create your first one".
- **Endpoints:** `GET /wechat/broadcasts | user.wechat.broadcasts.index | WeChatBroadcastController@index | plan:wechat_broadcasts`.
- **Data:** `wechat_broadcasts` with its channel, newest 50.
- **Rules & edge cases:** the `sending` status is declared but never set (the call is synchronous).
- **Async & events:** none.
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:** Given broadcasts, Then the newest 50 show with their status.
- **Source refs:** `WeChatBroadcastController@index`, `broadcasts.blade.php`.
- **Port notes:** polls while a broadcast is sending; adds a `canRetry` flag.

### TW-WECH-013 — Broadcast compose: channel, audience, template, text

- **Status:** implemented
- **Priority:** P0
- **Effort:** M
- **Depends on:** TW-WECH-011
- **Summary:** `/wechat/broadcasts/create` saves a draft.
- **Actors & access:** plan `wechat_broadcasts`.
- **UX & screens:** `broadcasts-create.blade.php`: name (required, 191), channel select, audience radios (All followers, By tag with a tag ID field, Pick from inbox with a checkbox list and "N selected (min 2)"), an optional template select (fills the message only while it is empty), message (required, 2000, hint about plain text and the ~4 a month), Create broadcast.
- **Endpoints:** `GET /wechat/broadcasts/create`, `POST /wechat/broadcasts | store`.
- **Data:** `wechat_broadcasts` (`status = draft`, `audience`, `tag_id`, `total`, encrypted body); `wechat_broadcast_recipients` (openid, title, conversation id; pending) for a picked list.
- **Rules & edge cases:** 1. The channel must belong to the workspace. 2. A picked list keeps only OpenIDs the channel carries, deduplicated; fewer than 2 is "A WeChat OpenID broadcast needs at least 2 recipients from the list." 3. All followers and a tag keep no recipients and total 0. 4. QUIRK: a tag audience with no tag number is accepted and sends to tag 0.
- **Async & events:** none.
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:** Given two picked followers, Then a draft with two recipients exists. Given one, Then the error shows.
- **Source refs:** `WeChatBroadcastController@create|store`, `user-wechat-broadcasts.js`.
- **Port notes:** a tag audience needs its number (documented fix; 0 is allowed).

### TW-WECH-014 — Mass send: one call, done or failed, inbox mirror

- **Status:** implemented
- **Priority:** P0
- **Effort:** M
- **Depends on:** TW-WECH-013
- **Summary:** Send makes the single WeChat mass-send call and ends the broadcast.
- **Actors & access:** plan `wechat_broadcasts`.
- **UX & screens:** the Send button of TW-WECH-012.
- **Endpoints:** `POST /wechat/broadcasts/{broadcast}/send | send`.
- **Data:** `wechat_broadcasts.status`, `mass_msg_id`, `sent`, `started_at`, `finished_at`, `last_error`; recipients to `sent`.
- **Rules & edge cases:** 1. A `done` broadcast cannot be sent again ("This broadcast was already sent."). 2. A missing or paused channel: "The WeChat channel for this broadcast is not connected/active." 3. The body goes as a text message. 4. All followers: `mass/sendall` with `is_to_all`; tag: `sendall` with the tag id; list: `mass/send` with the OpenIDs. 5. A refusal ends `failed` with the reason (255 chars) and leaves the recipients pending; a failed broadcast can be sent again. 6. Success ends `done` with `msg_id`, `sent = total`, started and finished now; for a list each recipient is `sent` and the text is copied into its thread (a failed copy is logged only).
- **Async & events:** none (inline in the request).
- **External systems:** `POST /cgi-bin/message/mass/send`, `/mass/sendall`. WeChat limits a Service Account to about 4 a month; not enforced.
- **Settings:** none.
- **Acceptance criteria:** Given a draft, When sent and WeChat accepts, Then it is `done` with the id. Given a refusal, Then `failed` with the reason and Send works again.
- **Source refs:** `WeChatBroadcastController@send|mirror`, `WeChatClient@massSend|massSendAll`.
- **Port notes:** the call runs in the `wechat-broadcast` queue job; the broadcast id is passed as `clientmsgid` so a retried job cannot send twice; an explicit retry endpoint and a stale-sending recovery exist.

### TW-WECH-015 — Delete a broadcast

- **Status:** implemented
- **Priority:** P1
- **Effort:** S
- **Depends on:** TW-WECH-013
- **Summary:** Removes a broadcast and its recipients in any status.
- **Actors & access:** plan `wechat_broadcasts`.
- **UX & screens:** the bin icon with a confirm.
- **Endpoints:** `DELETE /wechat/broadcasts/{broadcast}`.
- **Data:** both tables.
- **Rules & edge cases:** another workspace's broadcast is 404.
- **Async & events:** none.
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:** Given a broadcast, When deleted, Then it and its recipients are gone.
- **Source refs:** `WeChatBroadcastController@destroy`.
- **Port notes:** audited, with an outbox event.

### TW-WECH-016 — Plan gates and the platform switch

- **Status:** partial
- **Priority:** P0
- **Effort:** S
- **Depends on:** plans-subscriptions-trials
- **Summary:** `access_wechat`, `wechat_broadcasts`, `wechat_channels_limit` on the package; `wechat_enabled` platform switch.
- **Actors & access:** package editors and platform admins.
- **UX & screens:** package editor, admin settings, menu.
- **Endpoints:** admin pages.
- **Data:** package columns, `system_settings`.
- **Rules & edge cases:** the channels limit is never enforced; the platform switch only hides menu entries and the flow-engine channel list.
- **Async & events:** none.
- **External systems:** none.
- **Settings:** `wechat_enabled` (default off).
- **Acceptance criteria:** Given a plan without WeChat, Then connecting is refused.
- **Source refs:** `Models/Package.php`, `Support/UserNav.php`, `AdminPagesController.php`.
- **Port notes:** the three flags map to the one plan feature `extra_channels` (decision of the channel port brief); the channels cap and the platform switch are not enforced here either.

### TW-WECH-017 — Custom menu builder (the bottom bar of the account)

- **Status:** implemented
- **Priority:** P1
- **Effort:** M
- **Depends on:** TW-WECH-003
- **Summary:** `/wechat/menu` builds and pushes the account's one custom menu: up to 3 top buttons, each a leaf (view URL, click key, mini program) or a parent with up to 5 sub-buttons.
- **Actors & access:** plan `access_wechat`.
- **UX & screens:** `menu.blade.php`; channel picker; the current menu read back from WeChat; save and clear.
- **Endpoints:** `GET /wechat/menu`, `POST /wechat/menu`, `POST /wechat/menu/clear`.
- **Data:** none stored (WeChat holds the menu).
- **Rules & edge cases:** names cut to 16 characters; a click button fires its key as an EventKey that keyword rules and flows can match.
- **Async & events:** none.
- **External systems:** `/cgi-bin/menu/create|get|delete`.
- **Settings:** none.
- **Acceptance criteria:** Given a built menu, When saved, Then WeChat has it.
- **Source refs:** `WeChatMenuController.php`, `menu.blade.php`, `user-wechat-menu.js`.
- **Port notes:** BLOCKED, not ported yet (outside the brief of this port).

### TW-WECH-018 — Follower insights (new, cancelled and total per day)

- **Status:** implemented
- **Priority:** P2
- **Effort:** S
- **Depends on:** TW-WECH-003
- **Summary:** `/wechat/insights` shows the last 7 days ending yesterday from WeChat's datacube.
- **Actors & access:** plan `access_wechat`.
- **UX & screens:** `insights.blade.php`; channel picker; rows of new, cancelled and cumulative followers.
- **Endpoints:** `GET /wechat/insights`.
- **Data:** none stored.
- **Rules & edge cases:** WeChat caps a query at 7 days and lags a day.
- **Async & events:** none.
- **External systems:** `/datacube/getusersummary`, `/datacube/getusercumulate`.
- **Settings:** none.
- **Acceptance criteria:** Given a channel, Then 7 days of numbers show.
- **Source refs:** `WeChatInsightsController.php`, `insights.blade.php`.
- **Port notes:** BLOCKED, not ported yet (outside the brief of this port).

### TW-WECH-019 — Flow hand-off and the two Node callbacks (flow-send, flow-node)

- **Status:** implemented
- **Priority:** P1
- **Effort:** L
- **Depends on:** flow-runtime-engine
- **Summary:** An inbound message first goes to the Node flow engine when a published `wechat` flow bound to the channel matches by keyword; Node asks PHP to send each flow message (`/api/wechat/flow-send`, with the managed token, and mirrored into the inbox) and to run AI and webhook nodes (`/api/wechat/flow-node`).
- **Actors & access:** Node, guarded by `X-Node-Token`.
- **UX & screens:** the flow builder.
- **Endpoints:** `POST /api/wechat/flow-send`, `POST /api/wechat/flow-node`.
- **Data:** `wechat_flow_sessions`, `flows`.
- **Rules & edge cases:** flows are stored with type `wechat` and the channel row id as `trigger_device_id`; `any`, `*` and `.*` match everything; a consumed message gets no keyword or AI reply.
- **Async & events:** the Node runtime.
- **External systems:** the Node bridge.
- **Settings:** `baileys_server_url`, the node token.
- **Acceptance criteria:** Given a matching flow, Then the flow answers and nothing else does.
- **Source refs:** `WeChatFlowBridge.php`, `WeChatFlowNodeController.php`.
- **Port notes:** BLOCKED on the flow runtime: the thread is a `wechat` channel, so the inbox's inbound listeners (flow runtime, routing, auto-reply) see every stored message; whether a WeChat flow starts depends on that domain. `wechat_flow_sessions` exists in the schema and is unused here.

### TW-WECH-020 — Client methods with no caller (parametric QR, typing indicator)

- **Status:** dead-code
- **Priority:** P2
- **Effort:** S
- **Depends on:** TW-WECH-003
- **Summary:** `WeChatClient` can create a scene QR code (`/cgi-bin/qrcode/create`) and show a typing indicator (`/cgi-bin/message/custom/typing`); nothing calls them.
- **Actors & access:** none.
- **UX & screens:** none.
- **Endpoints:** none.
- **Data:** none.
- **Rules & edge cases:** none reachable.
- **Async & events:** none.
- **External systems:** WeChat.
- **Settings:** none.
- **Acceptance criteria:** none.
- **Source refs:** `WeChatClient@createQrCode|showTyping`.
- **Port notes:** not ported (nothing reaches them).

## Data model

- `wechat_channels`: one row per connected Official Account. `app_secret`, `verify_token`, `encoding_aes_key`, `cached_access_token` are
  encrypted (Reference encrypts the Token too); `enc_mode` is `plain`, `compat` (default) or `safe`; `webhook_token` is the global-unique
  routing token; `wx_id` is meant to be learnt from the first inbound (Reference never writes it); `active`, `connected_at`,
  `last_inbound_at`, `last_error`.
- `wechat_broadcasts`: `name`, `template_id`, `body` (encrypted), `buttons` (declared, never written), `audience` (`all`, `tag`, `list`),
  `tag_id`, `mass_msg_id`, `status` (`draft`, `sending`, `done`, `failed`), `total`, `sent`, `failed` (never written), `last_error`, `started_at`, `finished_at`.
- `wechat_broadcast_recipients`: only for a list audience: `openid`, `title`, `conversation_id`, `status` (`pending`, `sent`, `failed`), `error`, `sent_at`.
- `wechat_flow_sessions`: the flow engine's per-thread state (TW-WECH-019).

## Cross-domain contracts

- **Consumes:** chat-conversations (`ExternalChannelIngest`, the channel adapter registry, the dispatcher, `recordOutbound`), contacts-attributes-tags (contact upsert on channel and channel uid), message-templates (`wa_templates` rows of channel wechat), plans-subscriptions-trials (`extra_channels`), contact-consent (the send gate), platform infrastructure (body limits, log masking).
- **Exposes:** the `wechat` inbox channel and its adapter, `wechat-broadcast` queue, outbox events `wechat.channel.connected|disconnected` and `wechat.broadcast.created|started|retry_requested|deleted`.

## Open questions & quirks

- Reference shows the Token in clear on the hub page; here only people who manage the channel can reveal it.
- The URL check of safe mode (encrypted `echostr`) is not handled by Reference; a fix is built here and is unverified against WeChat.
- `wx_id`, `buttons` and `failed` are columns Reference declares and never fills.
- WeChat's mass-send allowance (about 4 a month for a Service Account) is only text in Reference; the app enforces nothing it cannot verify.
- The menu and insights pages are separate Reference features that this port has not built yet.

## Coverage

```json threadwise-coverage
{
  "routes": [
    "GET wechat",
    "POST wechat/connect",
    "POST wechat/{channel}/retry",
    "POST wechat/{channel}/toggle",
    "DELETE wechat/{channel}",
    "GET wechat/menu",
    "POST wechat/menu",
    "POST wechat/menu/clear",
    "GET wechat/insights",
    "GET wechat/broadcasts",
    "GET wechat/broadcasts/create",
    "POST wechat/broadcasts",
    "POST wechat/broadcasts/{broadcast}/send",
    "DELETE wechat/broadcasts/{broadcast}",
    "GET api/wechat/inbound/{token}",
    "POST api/wechat/inbound/{token}",
    "POST api/wechat/flow-send",
    "POST api/wechat/flow-node"
  ],
  "controllers": [
    "app/Http/Controllers/WeChat/WeChatBroadcastController.php",
    "app/Http/Controllers/WeChat/WeChatConnectController.php",
    "app/Http/Controllers/WeChat/WeChatFlowNodeController.php",
    "app/Http/Controllers/WeChat/WeChatInsightsController.php",
    "app/Http/Controllers/WeChat/WeChatMenuController.php",
    "app/Http/Controllers/WeChat/WeChatWebhookController.php"
  ],
  "services": [
    "app/Services/WeChat/WeChatChats.php",
    "app/Services/WeChat/WeChatClient.php",
    "app/Services/WeChat/WeChatCrypto.php",
    "app/Services/WeChat/WeChatFlowBridge.php"
  ],
  "models": ["WeChatBroadcast", "WeChatBroadcastRecipient", "WeChatChannel", "WeChatFlowSession"],
  "tables": [
    "wechat_broadcast_recipients",
    "wechat_broadcasts",
    "wechat_channels",
    "wechat_flow_sessions"
  ],
  "views": [
    "resources/views/user/wechat/broadcasts-create.blade.php",
    "resources/views/user/wechat/broadcasts.blade.php",
    "resources/views/user/wechat/index.blade.php",
    "resources/views/user/wechat/insights.blade.php",
    "resources/views/user/wechat/menu.blade.php"
  ],
  "doc_pages": ["Documentation/pages/channels/wechat.html"]
}
```
