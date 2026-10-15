---
domain: channel-line
code: LINE
title: LINE channel (Official Account, inbox, token rotation, broadcasts, rich menus, insights)
threadwise_version: '1.7.0'
sources_read: 22
---

# LINE channel

## Overview

A workspace connects one or more LINE Official Accounts (Messaging API channels) by pasting a **Channel access token** and a
**Channel secret** from the LINE Developers Console. Each channel gets its own signed callback URL (`/api/line/inbound/{token}`).
Messages the account receives become `channel = line` conversations in the team inbox (`raw_jid = line:<channelRowId>:<userId>`), the
sender becomes a CRM contact, files are downloaded into our storage, and the inbox replies through the same account, free through the
event's reply token while it is fresh and by push otherwise. LINE ships its own broadcasts because an Official Account cannot message a
phone number or anyone who has not added it as a friend: the audience is the account's existing 1:1 threads, and sending is done one push
per person, a batch at a time, driven from the browser. A channel may optionally rotate its token (a v2.1 token issued from an
Assertion Signing Key). Rich menus and an insights dashboard are part of the product too.

Plan gates: `access_line` (the channel), `line_broadcasts` (the broadcast screens), `line_channels_limit` (declared on the plan, never
enforced). Flows of type `line` run on the Node runtime.

Connects to: team-inbox-conversations (threads, replies), contacts-attributes-tags (contact per sender), message-templates (LINE
templates and buttons), flow-builder-editor and flow-runtime-engine (flows of type `line`), plans-subscriptions-trials (feature
flags), node-bridge-runtime (flow runtime), contact-consent (broadcast audience), platform-settings-branding-storage (media).

## Feature index

| Id          | Feature                                                                | Status      | Priority | Effort | Depends on                 |
| ----------- | ---------------------------------------------------------------------- | ----------- | -------- | ------ | -------------------------- |
| TW-LINE-001 | LINE hub page: connect form, channels, setup guide                     | implemented | P0       | M      | TW-LINE-002, TW-LINE-004   |
| TW-LINE-002 | Connect a channel from a pasted token and secret                       | implemented | P0       | M      | TW-LINE-018                |
| TW-LINE-003 | Re-hook: register the webhook again                                    | implemented | P0       | S      | TW-LINE-002                |
| TW-LINE-004 | Pause, enable and remove a channel                                     | implemented | P0       | S      | TW-LINE-002                |
| TW-LINE-005 | Token rotation (v2.1 assertion key)                                    | implemented | P1       | M      | TW-LINE-002                |
| TW-LINE-006 | Per-channel inbound webhook: routing token, signature, always 200      | implemented | P0       | M      | TW-LINE-002                |
| TW-LINE-007 | Inbound event to inbox thread, contact, media and automation           | implemented | P0       | L      | TW-LINE-006                |
| TW-LINE-008 | Outbound inbox reply: free reply token, else push                      | implemented | P0       | M      | TW-LINE-007                |
| TW-LINE-009 | Template buttons as LINE message objects                               | implemented | P1       | S      | TW-LINE-008                |
| TW-LINE-010 | Reachable audience: the 1:1 threads a channel carried                  | implemented | P0       | S      | TW-LINE-007                |
| TW-LINE-011 | Broadcast list with KPI cards and live progress                        | implemented | P0       | M      | TW-LINE-012                |
| TW-LINE-012 | Broadcast compose: channel, audience, message, template, attachment    | implemented | P0       | M      | TW-LINE-010                |
| TW-LINE-013 | Broadcast sending: batches, push per person, blocked vs failed, mirror | implemented | P0       | L      | TW-LINE-012                |
| TW-LINE-014 | Broadcast start, pause, retry failed, delete                           | implemented | P0       | M      | TW-LINE-013                |
| TW-LINE-015 | Flow runtime hand-off and the two Node callbacks (flow-log, flow-node) | implemented | P1       | L      | flow-runtime-engine        |
| TW-LINE-016 | Rich menus: layouts, image, cell actions, default menu                 | implemented | P1       | L      | TW-LINE-002                |
| TW-LINE-017 | Insights: push quota, followers, delivery, demographics                | implemented | P2       | M      | TW-LINE-002                |
| TW-LINE-018 | Plan gates and the `line` engine                                       | partial     | P0       | S      | plans-subscriptions-trials |
| TW-LINE-019 | Unused Messaging API client surface (multicast, narrowcast, flex, ...) | dead-code   | P2       | S      | none                       |

## Features

### TW-LINE-001 — LINE hub page: connect form, channels, setup guide

- **Status:** implemented
- **Priority:** P0
- **Effort:** M
- **Depends on:** TW-LINE-002, TW-LINE-004
- **Summary:** `/line` is where a workspace connects and manages its LINE channels and reads the setup guide.
- **Actors & access:** workspace members on a plan with `access_line`. No workspace role guard on the route.
- **UX & screens:** `resources/views/user/line/index.blade.php`. Header "LINE Official Account" with a one-line description and, once a
  channel exists, three pills: Rich menus, Insights and Broadcasts. A "Connect a channel" card: a Channel access token text area, a Channel
  secret field and "Connect LINE". A "Connected channels" list with a count: green avatar, display name, basic id, "Active" or "Paused" and
  the last error in red, the webhook address, a collapsible "Token rotation (v2.1)" panel (an "on" badge when enabled, key id field, private
  key text area, "Enable rotation" or "Re-issue / update", and when it renews), and the buttons "Re-hook", "Pause" or "Enable", and "Remove"
  (confirm "Remove this LINE channel?"). An aside "How to connect" with five numbered steps, a note that the webhook must be public HTTPS and
  that both values are encrypted and never shown again, and "Good to know" with three bullets. Flash messages (status, error, validation).
- **Endpoints:**

| Method uri | Route name      | Controller@action           | Middleware                  | Request fields | Response                           |
| ---------- | --------------- | --------------------------- | --------------------------- | -------------- | ---------------------------------- |
| GET line   | user.line.index | LineConnectController@index | web, auth, plan:access_line | none           | view with the workspace's channels |

- **Data:** reads `line_channels` of the workspace, oldest first.
- **Rules & edge cases:**
  1. Channels are listed for the active workspace only.
  2. A channel shows "Paused" when `active` is false and its `last_error` in red when set.
  3. The two secrets and the rotation key are never rendered (model `hidden`); the rotation key box is always blank.
  4. The Rich menus, Insights and Broadcasts pills show only when at least one channel exists (Broadcasts only if its route exists).
- **Async & events:** none.
- **External systems:** none on load.
- **Settings:** plan feature `access_line`.
- **Acceptance criteria:**
  - Given a workspace with two channels, When `/line` opens, Then both are listed with their state and no token or secret is in the page.
  - Given a plan without `access_line`, When the page is requested, Then the plan gate refuses.
  - Given a channel with a `last_error`, When listed, Then the error shows under its name.
- **Source refs:** `app/Http/Controllers/Line/LineConnectController.php`, `resources/views/user/line/index.blade.php`, `routes/line.php`.
- **Port notes:** home `apps/api/src/modules/channel-line/` and `apps/web/src/features/channel-line/`. The Rich menus and Insights pills are
  not shown until TW-LINE-016 and TW-LINE-017 exist (no dead buttons). The tile replaces the planned "LINE" settings tile.

### TW-LINE-002 — Connect a channel from a pasted token and secret

- **Status:** implemented
- **Priority:** P0
- **Effort:** M
- **Depends on:** TW-LINE-018
- **Summary:** The operator pastes a Channel access token and a Channel secret. We validate the token with LINE, store both encrypted, create the routing token and register the webhook.
- **Actors & access:** workspace members with `access_line`. Refused with a message when the plan lacks it.
- **UX & screens:** the "Connect a channel" card of the hub. Success flashes "LINE connected — <name>"; failures show on the token field.
- **Endpoints:**

| Method uri        | Route name        | Controller@action             | Middleware                  | Request fields                       | Response              |
| ----------------- | ----------------- | ----------------------------- | --------------------------- | ------------------------------------ | --------------------- |
| POST line/connect | user.line.connect | LineConnectController@connect | web, auth, plan:access_line | channel_access_token, channel_secret | redirect back + flash |

- **Data:** writes `line_channels`: `workspace_id`, `connected_by`, `channel_access_token` and `channel_secret` (encrypted), `line_channel_id`
  (the bot user id from bot info), `basic_id`, `display_name` (default "LINE"), `picture_url`, `webhook_token` (48 random), `active = true`,
  `connected_at`, `last_error = null`.
- **Rules & edge cases:**
  1. The token is required, 20 to 1000 characters; the secret is required, 16 to 255; both are trimmed.
  2. `GET /v2/bot/info` must succeed ("LINE rejected that channel access token: ...").
  3. No active workspace is refused.
  4. The same basic id in the same workspace updates the existing row: its routing token is kept, `active` is set true, the error cleared.
  5. The webhook is registered after the row exists (`PUT /v2/bot/channel/webhook/endpoint`).
  6. When LINE refuses the webhook the channel stays saved with `last_error` (255 characters) and the message says the URL must be public HTTPS and to use a tunnel locally.
  7. The webhook URL is forced to https.
  8. QUIRK: `line_channels_limit` on the plan is never checked, so any number of channels can be connected.
  9. QUIRK: the channel secret is not verified at connect; a wrong secret only shows as refused deliveries later.
- **Async & events:** none (synchronous LINE calls, 20 s timeout).
- **External systems:** LINE Messaging API bot info and webhook endpoint. Auth: the channel access token as a Bearer header. Failures return `ok = false` with LINE's message; the client never throws.
- **Settings:** plan `access_line`.
- **Acceptance criteria:**
  - Given a valid pair, When connected, Then a channel row exists with encrypted secrets, a routing token and a registered webhook, and the flash names the account.
  - Given the same account pasted twice, When connected again, Then there is still one channel and its webhook path is unchanged.
  - Given LINE rejects the token, When submitted, Then the field shows the reason and nothing is saved.
  - Given LINE rejects the webhook, When connected, Then the channel is saved with the error shown on the hub.
- **Source refs:** `app/Http/Controllers/Line/LineConnectController.php` (`connect`, `adoptToken`), `app/Services/Line/LineClient.php`, `app/Models/LineChannel.php`.
- **Port notes:** table `line_channels` exists (`20261001104200_line_threadwise_schema.sql`). Encrypt with the app's `CryptoService`. The LINE calls run from a provider adapter (`infra/providers/channel-line/`) behind `LINE_API`.

### TW-LINE-003 — Re-hook: register the webhook again

- **Status:** implemented
- **Priority:** P0
- **Effort:** S
- **Depends on:** TW-LINE-002
- **Summary:** The operator re-registers the webhook of a saved channel, for instance after a tunnel address changed.
- **Actors & access:** workspace members with `access_line`; the channel must belong to the active workspace (403 otherwise).
- **UX & screens:** the "Re-hook" button on a channel row; flash "Webhook re-registered." or "LINE refused the webhook: ...".
- **Endpoints:**

| Method uri                | Route name      | Controller@action           | Middleware                  | Request fields | Response              |
| ------------------------- | --------------- | --------------------------- | --------------------------- | -------------- | --------------------- |
| POST line/{channel}/retry | user.line.retry | LineConnectController@retry | web, auth, plan:access_line | none           | redirect back + flash |

- **Data:** writes `line_channels.last_error` (cleared on success, set on refusal).
- **Rules & edge cases:**
  1. The call uses the active token (the rotated one when rotation is on).
  2. A refusal keeps the channel and records the reason (255 characters).
- **Async & events:** none.
- **External systems:** LINE webhook endpoint.
- **Settings:** plan `access_line`.
- **Acceptance criteria:**
  - Given a channel with an error, When re-hooked and LINE accepts, Then the error is cleared.
  - Given LINE refuses, When re-hooked, Then the reason shows on the channel.
- **Source refs:** `app/Http/Controllers/Line/LineConnectController.php` (`retry`).
- **Port notes:** `POST /v2/line/channels/:id/retry-webhook`.

### TW-LINE-004 — Pause, enable and remove a channel

- **Status:** implemented
- **Priority:** P0
- **Effort:** S
- **Depends on:** TW-LINE-002
- **Summary:** A paused channel still receives LINE's pushes but ignores them and cannot start a broadcast. Removing deletes the channel.
- **Actors & access:** workspace members with `access_line`; the channel must belong to the active workspace (403 otherwise).
- **UX & screens:** "Pause" or "Enable" and "Remove" (with confirm) on a channel row.
- **Endpoints:**

| Method uri                 | Route name        | Controller@action             | Middleware                  | Request fields | Response              |
| -------------------------- | ----------------- | ----------------------------- | --------------------------- | -------------- | --------------------- |
| POST line/{channel}/toggle | user.line.toggle  | LineConnectController@toggle  | web, auth, plan:access_line | none           | redirect back + flash |
| DELETE line/{channel}      | user.line.destroy | LineConnectController@destroy | web, auth, plan:access_line | none           | redirect back + flash |

- **Data:** flips `line_channels.active`, or deletes the row (its broadcasts, recipients, flow sessions and rich menus go with it).
- **Rules & edge cases:**
  1. A paused channel answers LINE with 200 and writes nothing (after the signature check).
  2. The inbox threads stay when a channel is removed. LINE's webhook setting is not touched.
- **Async & events:** none.
- **External systems:** none.
- **Settings:** plan `access_line`.
- **Acceptance criteria:**
  - Given an active channel, When paused, Then a signed delivery is acknowledged and stores nothing.
  - Given a channel with broadcasts, When removed, Then the broadcasts go too and the inbox threads stay.
- **Source refs:** `app/Http/Controllers/Line/LineConnectController.php` (`toggle`, `destroy`).
- **Port notes:** the inbox channel is kept in step (connected or disconnected). Events `line.channel.disconnected`.

### TW-LINE-005 — Token rotation (v2.1 assertion key)

- **Status:** implemented
- **Priority:** P1
- **Effort:** M
- **Depends on:** TW-LINE-002
- **Summary:** Optionally the operator pastes the RSA private key and key id (kid) of an Assertion Signing Key registered in the LINE console; the app then issues short-lived, revocable v2.1 tokens itself and renews them before they lapse.
- **Actors & access:** workspace members with `access_line`; the channel must belong to the active workspace.
- **UX & screens:** the collapsible "Token rotation (v2.1)" panel on a channel row: kid field, private key text area, "Enable rotation" or "Re-issue / update", and "renews <relative time>".
- **Endpoints:**

| Method uri                   | Route name         | Controller@action              | Middleware                  | Request fields                       | Response              |
| ---------------------------- | ------------------ | ------------------------------ | --------------------------- | ------------------------------------ | --------------------- |
| POST line/{channel}/rotation | user.line.rotation | LineConnectController@rotation | web, auth, plan:access_line | assertion_kid, assertion_private_key | redirect back + flash |

- **Data:** writes `assertion_kid`, `assertion_private_key` (encrypted), `rotating_token` (encrypted), `rotating_token_key_id`, `rotating_token_expires_at`.
- **Rules & edge cases:**
  1. A blank kid or key clears rotation and goes back to the pasted token ("Token rotation disabled").
  2. The first token is minted at once, so a wrong key shows before the operator leaves the page.
  3. Every LINE call asks for the active token: the cached rotated one while it has more than a day left, else a new one is minted on the spot; a failed mint falls back to the cached or long-lived token and records the reason on the channel.
  4. The assertion is an RS256 JWT: iss and sub the Channel ID, aud `https://api.line.me/`, exp 30 minutes, token_exp up to 30 days.
  5. QUIRK: Reference signs with `line_channel_id`, which connect fills with the bot's user id (U...), not the numeric Channel ID the console shows; LINE refuses it, so rotation cannot work as shipped.
- **Async & events:** none (minted lazily).
- **External systems:** LINE `POST /oauth2/v2.1/token` with a client assertion.
- **Settings:** plan `access_line`.
- **Acceptance criteria:**
  - Given a valid key, When rotation is enabled, Then a v2.1 token is issued and the next send uses it.
  - Given blank fields, When saved, Then rotation is off and sends use the pasted token.
  - Given a rotated token with less than a day left, When a send happens, Then a new token is minted first.
- **Source refs:** `app/Http/Controllers/Line/LineConnectController.php` (`rotation`), `app/Models/LineChannel.php` (`activeAccessToken`, `rotateToken`), `app/Services/Line/LineClient.php` (`issueChannelAccessTokenV21`, `buildAssertionJwt`), migration `2026_08_27_100400_add_line_token_rotation_columns.php`.
- **Port notes:** deviation (documented bug fix): the rotation form asks for the numeric Channel ID once. `PUT /v2/line/channels/:id/rotation`.

### TW-LINE-006 — Per-channel inbound webhook: routing token, signature, always 200

- **Status:** implemented
- **Priority:** P0
- **Effort:** M
- **Depends on:** TW-LINE-002
- **Summary:** LINE pushes events to one URL per channel. The URL token finds the channel and `X-Line-Signature` over the raw body proves the caller.
- **Actors & access:** LINE only. No session, no CSRF. Throttled to 240 requests a minute.
- **UX & screens:** none.
- **Endpoints:**

| Method uri                    | Route name   | Controller@action            | Middleware    | Request fields                  | Response                                     |
| ----------------------------- | ------------ | ---------------------------- | ------------- | ------------------------------- | -------------------------------------------- |
| POST api/line/inbound/{token} | line.inbound | LineWebhookController@ingest | api, throttle | raw JSON body, X-Line-Signature | `{ok, note}` 200, or 401 `{ok:false, error}` |

- **Data:** reads `line_channels` by `webhook_token`; writes `last_inbound_at` and clears `last_error` on a verified delivery.
- **Rules & edge cases:**
  1. The token must match `[A-Za-z0-9]+`; an unknown token answers 200 "unknown channel".
  2. The signature is `base64(HMAC-SHA256(rawBody, channel_secret))`, compared in constant time on the unparsed body. A missing secret, a missing header or a mismatch is 401 "bad signature".
  3. After the signature a paused channel answers 200 "channel disabled" and does nothing.
  4. Every event is handled on its own; one failing never stops the others, and the answer is still 200 "ok".
  5. LINE's console "Verify" sends a signed delivery with no events: 200.
- **Async & events:** none (events are handled inline).
- **External systems:** LINE.
- **Settings:** none.
- **Acceptance criteria:**
  - Given a wrong or missing signature, When posted, Then the answer is 401 and nothing is stored.
  - Given an unknown token, When posted, Then the answer is 200 and nothing is stored.
  - Given a valid delivery for a paused channel, When posted, Then nothing is stored.
- **Source refs:** `app/Http/Controllers/Line/LineWebhookController.php` (`ingest`), `routes/line.php`.
- **Port notes:** `POST /v2/line/inbound/:token`, tenant resolved by the SECURITY DEFINER function `line_channel_lookup`. Never skip the signature.

### TW-LINE-007 — Inbound event to inbox thread, contact, media and automation

- **Status:** implemented
- **Priority:** P0
- **Effort:** L
- **Depends on:** TW-LINE-006
- **Summary:** A message or postback event becomes an inbound row in a `line` thread, a contact for a 1:1 sender, the file when there is one, and then the automation order a customer expects.
- **Actors & access:** LINE only.
- **UX & screens:** the team inbox.
- **Endpoints:** TW-LINE-006.
- **Data:** writes `conversations` (`raw_jid = line:<rowId>:<sourceId>`, preview, unread, reopened when resolved), `inbox_messages` (provider `line`, `meta.line` with source type and id, message id, reply token and when it was taken, webhook event id), `contacts` (one per user id, name from the LINE profile, source "Source: LINE").
- **Rules & edge cases:**
  1. Message types: text; image, video, audio (file downloaded from the content host and stored in our storage); file (the file name is the text); location ("📍 lat, lng"); sticker (its text or "[sticker]"); anything else "[message]".
  2. A postback is replayed as a typed message with its data, so keywords and flows fire as for typed text.
  3. Follow, unfollow, join, leave and the rest are acknowledged and ignored. QUIRK: the LineChats comment says follow events create a thread; the code does not, so a friend who never writes has no thread.
  4. The thread key is the user id, else the group id, else the room id of the source. QUIRK: a group message by a user whose id LINE sends is keyed by that user id, so it lands in their 1:1 thread.
  5. Only a 1:1 source gets a contact and a profile call (best effort); a group or room is titled "LINE".
  6. The sender's profile is fetched on every message in Reference; only the first one is used.
  7. Automation order: a flow first (1:1 chats only), then routing, then the assigned AI agent, else keyword auto-reply.
  8. A failed file download stores the message without the file. LINE's file is never linked, only copied.
- **Async & events:** `MessageReceived`, realtime.
- **External systems:** LINE profile (`GET /v2/bot/profile/{userId}`) and content (`api-data.line.me`) APIs.
- **Settings:** keyword and auto-reply rules scoped to the channel.
- **Acceptance criteria:**
  - Given a signed text event from a new user, When delivered, Then a thread, a contact and one unread message exist.
  - Given the same event delivered twice, When delivered, Then it is stored once.
  - Given an image event, When delivered, Then the file is downloaded with the channel's token and stored.
- **Source refs:** `app/Http/Controllers/Line/LineWebhookController.php`, `app/Services/Line/LineClient.php` (`getProfile`, `getMessageContent`).
- **Port notes:** through `ExternalChannelIngest`; the peer key keeps the LINE user id's case. Deviation: a group or room is its own thread keyed by its id. Flow and automation hand-off are stand-ins (`INBOUND_HOOKS`) until the flow runtime and routing domains bind the real ones.

### TW-LINE-008 — Outbound inbox reply: free reply token, else push

- **Status:** implemented
- **Priority:** P0
- **Effort:** M
- **Depends on:** TW-LINE-007
- **Summary:** An agent's reply in a LINE thread leaves from the channel that carried the thread. It uses the free reply path when the customer's latest event gave a token less than 55 seconds old, and a billable push otherwise.
- **Actors & access:** anyone who may reply in the inbox.
- **UX & screens:** the inbox composer.
- **Endpoints:** none (called by the inbox dispatcher).
- **Data:** reads the channel and the latest inbound message's `meta.line`; consumes `reply_token`.
- **Rules & edge cases:**
  1. Up to five message objects per send; media goes as a URL-based image, video or audio message (a public https address), the caption first as text; other kinds go as a text link.
  2. The reply token is single use and is cleared when taken, so a second reply in the same turn pushes.
  3. A disconnected channel answers "LINE channel not connected"; a missing recipient "LINE recipient missing".
  4. The docs say an invalid reply token falls back to a push; the code only used the reply when a token was fresh.
- **Async & events:** none.
- **External systems:** LINE reply and push endpoints.
- **Settings:** none.
- **Acceptance criteria:**
  - Given a customer who just wrote, When an agent replies, Then the reply token is used once and the next reply is a push.
  - Given a refusal from LINE, When sent, Then the reason comes back to the inbox.
- **Source refs:** `app/Services/InboxDispatcher.php` (`dispatchLine`), `app/Services/Line/LineClient.php`.
- **Port notes:** `LineChannelAdapter` registered with `ChannelAdapterRegistry` (API and worker); no 24-hour window.

### TW-LINE-009 — Template buttons as LINE message objects

- **Status:** implemented
- **Priority:** P1
- **Effort:** S
- **Depends on:** TW-LINE-008
- **Summary:** A LINE template's buttons become native LINE controls: link and phone buttons a buttons template, reply buttons quick-reply chips.
- **Actors & access:** broadcast senders.
- **UX & screens:** the compose preview shows the buttons.
- **Endpoints:** none.
- **Data:** template `buttons` array.
- **Rules & edge cases:**
  1. A link button (type url or quick_reply_url with an address) and a phone button (phone_number, call, phone with a number, as `tel:`) become actions of a buttons template, at most four; reply buttons ride along as extra actions.
  2. With no link or phone button the body is a text message with the reply buttons as up to 13 quick-reply chips.
  3. A template body is cut to 160 characters; a longer body goes first as its own text bubble and the card says "↓".
  4. A label is cut to 20 characters; a tap on a reply button sends the label back as text.
  5. A text message is cut to 5000 characters; at most five message objects per send.
- **Async & events:** none.
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given a template with a link and a reply button, When sent, Then one buttons template carries both.
  - Given a 200-character body with a link button, When sent, Then the body is a text bubble and the card follows.
- **Source refs:** `app/Services/Line/LineClient.php` (`templateToMessages`, `buttonsTemplate`, `withQuickReplies`).
- **Port notes:** pure builders in `message-builders.ts`.

### TW-LINE-010 — Reachable audience: the 1:1 threads a channel carried

- **Status:** implemented
- **Priority:** P0
- **Effort:** S
- **Depends on:** TW-LINE-007
- **Summary:** The people a channel can broadcast to are the direct threads it already has, newest first.
- **Actors & access:** broadcast senders.
- **UX & screens:** the recipient list of the compose screen.
- **Endpoints:** none of its own (the compose page carries it per channel).
- **Data:** reads `conversations` of the channel whose key starts with `U`.
- **Rules & edge cases:**
  1. Only user ids (start with U) are broadcastable; group (C) and room (R) ids are left out.
  2. The newest 500 by last message time.
  3. A person's name is the thread title, "LINE user" when empty.
- **Async & events:** none.
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given a channel with two users and a group, When the audience is listed, Then only the two users appear, newest first.
- **Source refs:** `app/Services/Line/LineChats.php`.
- **Port notes:** `GET /v2/line/channels/:id/audience`.

### TW-LINE-011 — Broadcast list with KPI cards and live progress

- **Status:** implemented
- **Priority:** P0
- **Effort:** M
- **Depends on:** TW-LINE-012
- **Summary:** The list of recent broadcasts with five tiles and a progress bar per broadcast.
- **Actors & access:** workspace members on a plan with `line_broadcasts`.
- **UX & screens:** `resources/views/user/line/broadcasts.blade.php`. Header "LINE broadcasts", pills Channels and New broadcast (hidden with no channel). Five tiles: Sent (with the broadcast count), Audience, Failed, Blocked, Sending. A table: name and date, channel, recipients, progress bar with "sent, failed, blocked", status pill (Sending, Done, Failed, Draft) and the actions. With no channel an empty state "Connect a LINE channel first."; with no broadcast "No broadcasts yet. Create your first one".
- **Endpoints:**

| Method uri          | Route name                 | Controller@action             | Middleware                      | Request fields | Response |
| ------------------- | -------------------------- | ----------------------------- | ------------------------------- | -------------- | -------- |
| GET line/broadcasts | user.line.broadcasts.index | LineBroadcastController@index | web, auth, plan:line_broadcasts | none           | view     |

- **Data:** reads `line_broadcasts` (50 newest) and sums across all of them.
- **Rules & edge cases:**
  1. QUIRK: "Sending" counts only the 50 listed; the other tiles sum every broadcast.
  2. Progress is `(sent + failed + blocked) / total`.
  3. A draft or sending broadcast offers Start (Resume while sending); a failed one, or one with failed or blocked people, offers Retry; every row offers a delete.
- **Async & events:** none.
- **External systems:** none.
- **Settings:** plan `line_broadcasts`.
- **Acceptance criteria:**
  - Given two broadcasts, When the list opens, Then the tiles total both and the newest is first.
- **Source refs:** `app/Http/Controllers/Line/LineBroadcastController.php` (`index`), `resources/views/user/line/broadcasts.blade.php`, `resources/js/charts/user-line-broadcasts.js`.
- **Port notes:** `GET /v2/line/broadcasts`; the list polls every 3 s while one is sending.

### TW-LINE-012 — Broadcast compose: channel, audience, message, template, attachment

- **Status:** implemented
- **Priority:** P0
- **Effort:** M
- **Depends on:** TW-LINE-010
- **Summary:** The operator names a broadcast, picks a channel, optionally a LINE template, writes the message, adds a file and ticks the people. Saving freezes the recipient list.
- **Actors & access:** workspace members on a plan with `line_broadcasts`.
- **UX & screens:** `resources/views/user/line/broadcasts-create.blade.php`. Step "Broadcast setup": name, channel, template (when LINE templates exist), message (5000, "Use {name} to personalise"), attachment (image, video or audio), recipients with "Select all" and a selected count, "Create broadcast". A live preview in LINE's colours with the buttons and the attachment name. The recipient list swaps with the channel.
- **Endpoints:**

| Method uri                 | Route name                  | Controller@action              | Middleware                      | Request fields                                                     | Response         |
| -------------------------- | --------------------------- | ------------------------------ | ------------------------------- | ------------------------------------------------------------------ | ---------------- |
| GET line/broadcasts/create | user.line.broadcasts.create | LineBroadcastController@create | web, auth, plan:line_broadcasts | none                                                               | view             |
| POST line/broadcasts       | user.line.broadcasts.store  | LineBroadcastController@store  | web, auth, plan:line_broadcasts | name, line_channel_id, template_id, body, user_ids[], media (file) | redirect + flash |

- **Data:** writes `line_broadcasts` (draft, body encrypted, `buttons` from the template, media path and kind) and one `line_broadcast_recipients` row per person, status pending.
- **Rules & edge cases:**
  1. Name required (191); at least one user id; media up to 50 MB (jpg, jpeg, png, gif, webp, mp4, mov, m4a, mp3).
  2. The channel must belong to the workspace.
  3. A template (channel line only) fills an empty body and brings its buttons.
  4. A message or a file is required.
  5. Posted ids are matched to the channel's own audience; forged ids are dropped; none left is refused ("None of those users belong to this channel").
  6. The media kind comes from the extension: mp4 and mov video, m4a and mp3 audio, anything else image.
  7. Recipient title is cut to 191 characters.
- **Async & events:** none.
- **External systems:** none.
- **Settings:** plan `line_broadcasts`.
- **Acceptance criteria:**
  - Given three picked users and one forged id, When created, Then the broadcast has three recipients.
  - Given no body and no file, When created, Then it is refused.
- **Source refs:** `app/Http/Controllers/Line/LineBroadcastController.php` (`create`, `store`), `resources/views/user/line/broadcasts-create.blade.php`, `resources/js/charts/user-line-broadcasts.js`.
- **Port notes:** `POST /v2/line/broadcasts`; the attachment is a public address or an upload through `POST /v2/media/marketing`.

### TW-LINE-013 — Broadcast sending: batches, push per person, blocked vs failed, mirror

- **Status:** implemented
- **Priority:** P0
- **Effort:** L
- **Depends on:** TW-LINE-012
- **Summary:** Sending goes through the pending people in batches of 40, one push each (up to five message objects), recording each outcome and copying each send into the person's thread.
- **Actors & access:** the browser of a member with the page open.
- **UX & screens:** the Start button runs the loop; progress updates in place.
- **Endpoints:**

| Method uri                             | Route name                 | Controller@action                 | Middleware                      | Request fields | Response                                            |
| -------------------------------------- | -------------------------- | --------------------------------- | ------------------------------- | -------------- | --------------------------------------------------- |
| POST line/broadcasts/{broadcast}/batch | user.line.broadcasts.batch | LineBroadcastController@sendBatch | web, auth, plan:line_broadcasts | none           | json pending, sent, failed, blocked, progress, done |

- **Data:** updates recipients (status, provider message id, error 255, sent time), the broadcast counters and status, and writes an outbound inbox message per sent person.
- **Rules & edge cases:**
  1. Per person: media bubble first, then the template (or the text) with `{{name}}` replaced by the person's name; at most five objects. A person with nothing to send counts as sent.
  2. A refusal that reads blocked, not a friend, invalid user, forbidden, not found, no longer, or cannot send messages parks the person as `blocked` (retry leaves it); anything else is `failed`.
  3. The channel gone or paused stops the broadcast with status `failed` and a reason.
  4. When no person is pending the broadcast is `done` with a finish time.
  5. A failure copying into the thread never fails the send. The copy shows the body text as an outbound message from the broadcast.
  6. A closed tab pauses the loop; every person is a row, so "Start" picks up where it stopped.
- **Async & events:** none (browser driven).
- **External systems:** LINE push endpoint, `POST /v2/bot/message/push`, billable per message.
- **Settings:** plan `line_broadcasts`.
- **Acceptance criteria:**
  - Given 45 pending people, When sent, Then 40 go in the first batch and 5 in the second and the broadcast is done.
  - Given LINE answers blocked for one person, When sent, Then that person is blocked and the counters say so.
- **Source refs:** `app/Http/Controllers/Line/LineBroadcastController.php` (`sendBatch`, `buildMessages`, `personalise`, `mirror`), `app/Models/LineBroadcastRecipient.php` (`isUnreachable`), `app/Services/Line/LineClient.php` (`push`).
- **Port notes:** a BullMQ job on the `line-broadcast` queue; a decision recorded in the parity doc: Reference's docs and changelog name LINE's narrowcast API, its code sends per-user push, and this port sends per-user push.

### TW-LINE-014 — Broadcast start, pause, retry failed, delete

- **Status:** implemented
- **Priority:** P0
- **Effort:** M
- **Depends on:** TW-LINE-013
- **Summary:** The operator controls a broadcast: start it, pause it, put failed people back, or delete it.
- **Actors & access:** workspace members on a plan with `line_broadcasts`; the broadcast must belong to the workspace (404 otherwise).
- **UX & screens:** the action buttons of the list.
- **Endpoints:**

| Method uri                             | Route name                   | Controller@action               | Middleware                      | Request fields | Response              |
| -------------------------------------- | ---------------------------- | ------------------------------- | ------------------------------- | -------------- | --------------------- |
| POST line/broadcasts/{broadcast}/start | user.line.broadcasts.start   | LineBroadcastController@start   | web, auth, plan:line_broadcasts | none           | redirect back + flash |
| POST line/broadcasts/{broadcast}/pause | user.line.broadcasts.pause   | LineBroadcastController@pause   | web, auth, plan:line_broadcasts | none           | redirect back + flash |
| POST line/broadcasts/{broadcast}/retry | user.line.broadcasts.retry   | LineBroadcastController@retry   | web, auth, plan:line_broadcasts | none           | redirect back + flash |
| DELETE line/broadcasts/{broadcast}     | user.line.broadcasts.destroy | LineBroadcastController@destroy | web, auth, plan:line_broadcasts | none           | redirect back + flash |

- **Data:** broadcast `status`, `started_at`, `finished_at`, `failed`, `last_error`; recipient statuses.
- **Rules & edge cases:**
  1. Start needs someone pending ("Every recipient in this broadcast has already been handled"), a connected channel and an active one ("That LINE channel is paused. Enable it before sending.").
  2. Pause turns it back to draft; the rest stay pending.
  3. Retry puts only `failed` people back to pending (blocked stay), turns the broadcast to draft and clears its finish time; nothing failed is refused ("Nothing to retry — no recipient failed.").
  4. Delete removes the recipients and the broadcast in any status.
- **Async & events:** none.
- **External systems:** none.
- **Settings:** plan `line_broadcasts`.
- **Acceptance criteria:**
  - Given a paused channel, When Start is pressed, Then it is refused with the reason.
  - Given 3 failed and 2 blocked, When Retry is pressed, Then 3 are pending and 2 stay blocked.
- **Source refs:** `app/Http/Controllers/Line/LineBroadcastController.php`.
- **Port notes:** the worker replaces the browser loop, so Pause replaces Resume.

### TW-LINE-015 — Flow runtime hand-off and the two Node callbacks (flow-log, flow-node)

- **Status:** implemented
- **Priority:** P1
- **Effort:** L
- **Depends on:** flow-runtime-engine
- **Summary:** An inbound 1:1 message is first offered to the Node flow runtime; a flow of type `line` whose keywords match, or a running session, consumes it. Node sends flow messages itself and calls back to mirror them into the inbox and to resolve AI and webhook nodes.
- **Actors & access:** the Node runtime (token header); LINE for the inbound.
- **UX & screens:** none here (the flow builder owns the trigger).
- **Endpoints:**

| Method uri              | Route name | Controller@action           | Middleware        | Request fields                                           | Response |
| ----------------------- | ---------- | --------------------------- | ----------------- | -------------------------------------------------------- | -------- |
| POST api/line/flow-log  | none       | LineFlowNodeController@log  | api, X-Node-Token | channelId, userId, body, direction, mid, source, buttons | json     |
| POST api/line/flow-node | none       | LineFlowNodeController@node | api, X-Node-Token | channelId, userId, node data                             | json     |

- **Data:** `line_flow_sessions` (one live session per thread: flow, node, status, awaited variable, vars, expiry), flows with `flow_type = line` and `trigger_device_id` = channel row id.
- **Rules & edge cases:** keyword match is a lower-case substring of the comma separated trigger keywords (`any`, `*` match all); the newest published active flow wins; groups and rooms never start a flow.
- **Async & events:** a synchronous call to Node; Node answers whether it consumed the message.
- **External systems:** the Node bridge.
- **Settings:** `baileys_server_url` or `SERVER_URL`, the Node token.
- **Acceptance criteria:** see the flow-runtime-engine domain.
- **Source refs:** `app/Services/Line/LineFlowBridge.php`, `app/Http/Controllers/Line/LineFlowNodeController.php`, `node/services/lineFlowService.js`, `node/controllers/lineFlowController.js`.
- **Port notes:** **Port status: blocked** on flow-runtime-engine and node-bridge-runtime. The inbound path calls `INBOUND_HOOKS.handoffToFlow` and `automate`, stand-ins that consume nothing until those domains bind the real ones; `line_flow_sessions` exists and is unused.

### TW-LINE-016 — Rich menus: layouts, image, cell actions, default menu

- **Status:** implemented
- **Priority:** P1
- **Effort:** L
- **Depends on:** TW-LINE-002
- **Summary:** The operator builds the tappable image panel pinned to the bottom of a chat: a preset layout, an image of exactly the layout's size, one action per cell, registered with LINE and optionally made the account's default.
- **Actors & access:** workspace members with `access_line`; menus belong to the workspace (404 otherwise).
- **UX & screens:** `resources/views/user/line/rich-menus.blade.php` (the list with channel, layout, default flag and actions) and `rich-menus-create.blade.php` (channel, name up to 300, chat bar text up to 14, layout, image, an action per cell: message, link or postback with value and label up to 20, "set as default").
- **Endpoints:**

| Method uri                              | Route name                   | Controller@action                   | Middleware                  | Request fields                                                            | Response              |
| --------------------------------------- | ---------------------------- | ----------------------------------- | --------------------------- | ------------------------------------------------------------------------- | --------------------- |
| GET line/rich-menus                     | user.line.rich-menus.index   | LineRichMenuController@index        | web, auth, plan:access_line | none                                                                      | view                  |
| GET line/rich-menus/create              | user.line.rich-menus.create  | LineRichMenuController@create       | web, auth, plan:access_line | none                                                                      | view                  |
| POST line/rich-menus                    | user.line.rich-menus.store   | LineRichMenuController@store        | web, auth, plan:access_line | line_channel_id, name, chat_bar_text, layout, image, actions, set_default | redirect + flash      |
| POST line/rich-menus/{richMenu}/default | user.line.rich-menus.default | LineRichMenuController@setDefault   | web, auth, plan:access_line | none                                                                      | redirect back + flash |
| POST line/rich-menus/{richMenu}/clear   | user.line.rich-menus.clear   | LineRichMenuController@clearDefault | web, auth, plan:access_line | none                                                                      | redirect back + flash |
| DELETE line/rich-menus/{richMenu}       | user.line.rich-menus.destroy | LineRichMenuController@destroy      | web, auth, plan:access_line | none                                                                      | redirect back + flash |

- **Data:** `line_rich_menus` (LINE's rich menu id, name, chat bar text, layout, size, areas, image path, default flag).
- **Rules & edge cases:** eight layouts (full, 2 columns, 3 columns, 2x2, 2x3 large at 2500x1686; compact full, 2 and 3 columns at 2500x843); the image must be exactly the layout's size (png or jpg, at most 1 MB) or it is refused before any API call; a menu that registers but whose image upload fails is deleted at LINE; only one menu is the default per channel; LINE caps rich menu calls at 100 an hour.
- **Async & events:** none.
- **External systems:** LINE rich menu endpoints (create, delete, content upload, set and cancel default).
- **Settings:** plan `access_line`.
- **Acceptance criteria:**
  - Given an image of the wrong size, When created, Then it is refused without calling LINE.
  - Given a default menu, When another is made default, Then only the new one is flagged.
- **Source refs:** `app/Http/Controllers/Line/LineRichMenuController.php`, `app/Models/LineRichMenu.php`, `resources/views/user/line/rich-menus*.blade.php`.
- **Port notes:** **Port status: blocked, not ported yet** (kept out of the brief's scope). Table `line_rich_menus` exists. Needs the image upload through the storage service and the rich menu calls on the port. No button for it is shown until it exists.

### TW-LINE-017 — Insights: push quota, followers, delivery, demographics

- **Status:** implemented
- **Priority:** P2
- **Effort:** M
- **Depends on:** TW-LINE-002
- **Summary:** A read-only dashboard of a channel's monthly push quota and use, followers, per-day message delivery by kind and friend demographics, read live from LINE.
- **Actors & access:** workspace members with `access_line`.
- **UX & screens:** `resources/views/user/line/insights.blade.php`: a channel switcher when there is more than one, four tiles (Push quota or Unlimited, Used with remaining, Followers with reachable, Blocks), a delivery breakdown and demographics, an error banner "Could not reach LINE".
- **Endpoints:**

| Method uri        | Route name         | Controller@action            | Middleware                  | Request fields | Response |
| ----------------- | ------------------ | ---------------------------- | --------------------------- | -------------- | -------- |
| GET line/insights | user.line.insights | LineInsightsController@index | web, auth, plan:access_line | channel (id)   | view     |

- **Data:** nothing stored.
- **Rules & edge cases:** insight data is for the previous UTC day (today is empty); a quota of type none is "Unlimited"; remaining is `max(0, quota - used)`; followers, delivery and demographics show only when LINE says the data is ready or available.
- **Async & events:** none.
- **External systems:** LINE quota, quota consumption, followers, message delivery and demographic endpoints.
- **Settings:** plan `access_line`.
- **Acceptance criteria:**
  - Given a limited quota of 1000 and 400 used, When opened, Then remaining reads 600.
- **Source refs:** `app/Http/Controllers/Line/LineInsightsController.php`, `resources/views/user/line/insights.blade.php`.
- **Port notes:** **Port status: blocked, not ported yet** (kept out of the brief's scope). No stored data, so only an endpoint and a screen are needed.

### TW-LINE-018 — Plan gates and the `line` engine

- **Status:** partial
- **Priority:** P0
- **Effort:** S
- **Depends on:** plans-subscriptions-trials
- **Summary:** Plan columns `access_line`, `line_broadcasts` and `line_channels_limit` gate the screens; flows and templates use the engine key `line`.
- **Actors & access:** platform admins set the plan; workspaces are gated by it.
- **UX & screens:** the plan editor, the upgrade message "Your plan does not include LINE."
- **Endpoints:** none.
- **Data:** `packages` columns `access_line`, `line_broadcasts`, `line_channels_limit` (default 0).
- **Rules & edge cases:** QUIRK: `line_channels_limit` is never enforced. Connect refuses with a message when the plan lacks `access_line`.
- **Async & events:** none.
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given a plan without `access_line`, When connect is posted, Then it is refused.
- **Source refs:** `routes/line.php`, `app/Http/Controllers/Line/LineConnectController.php` (`planOk`), migration `2026_08_27_100100_add_line_plan_columns_to_packages.php`.
- **Port notes:** the three flags are folded into the plan feature `extra_channels` (the decision shared by every extra channel); every controller carries `@RequirePlanFeature('extra_channels')`. Permissions: `line.channels.read|manage`, `line.broadcasts.read|manage`.

### TW-LINE-019 — Unused Messaging API client surface (multicast, narrowcast, flex, ...)

- **Status:** dead-code
- **Priority:** P2
- **Effort:** S
- **Depends on:** none
- **Summary:** `LineClient` carries methods nothing in Reference calls: multicast, broadcast, narrowcast and its progress, Flex and location message builders, loading indicator, per-user rich menu link, rich menu aliases, the webhook endpoint read and test, v3 stateless tokens and token revoke.
- **Actors & access:** none.
- **UX & screens:** none.
- **Endpoints:** none.
- **Data:** none.
- **Rules & edge cases:** the Reference docs page and changelog advertise "narrowcast broadcasts" and "Flex messages"; the broadcast code sends one push per person and no screen builds a Flex message. QUIRK: docs advertise features the code does not have.
- **Async & events:** none.
- **External systems:** LINE.
- **Settings:** none.
- **Acceptance criteria:** none (nothing to build).
- **Source refs:** `app/Services/Line/LineClient.php`, `Documentation/pages/channels/line.html`, `Documentation/pages/update-details/changelog.html`.
- **Port notes:** not ported; no caller. If a flow node ever needs Flex or a location message it is added with that node. Decision recorded in the parity doc: broadcasts are per-user push.

## Data model

- `line_channels`: one row per connected Official Account. `channel_access_token`, `channel_secret`, `assertion_private_key`, `rotating_token`, `rotating_token_key_id` encrypted; `assertion_kid`, `line_channel_id`, `basic_id`, `display_name`, `picture_url`; unique `webhook_token` (48 random); `active`; `connected_at`, `last_inbound_at`, `last_error` (255). Read and written by TW-LINE-001 to 008. Few rows per workspace.
- `line_flow_sessions`: one live flow session per thread (`conversation_id` unique): channel, user id, flow, node, status (running, waiting, sleeping, done, failed), awaited variable and options, vars (encrypted), last error, expiry, last message id. Written by the Node runtime (TW-LINE-015).
- `line_rich_menus`: LINE's rich menu id, name, chat bar text, layout, size, areas, image path, `is_default`, `active`, last error (TW-LINE-016).
- `line_broadcasts`: name, channel, creating user, template, body (encrypted in Reference), buttons, media path and kind (image, video, audio), status (draft, sending, done, failed), counters total, sent, failed, blocked, last error, started and finished times (TW-LINE-011 to 014).
- `line_broadcast_recipients`: broadcast, LINE user id (plaintext, queryable), title (191), conversation, status (pending, sent, failed, blocked), provider message id, error (255), sent time. Index on (broadcast, status).

## Cross-domain contracts

- Consumes team-inbox-conversations (`ExternalChannelIngest`, `ChannelAdapterRegistry`, `ConversationsFacade.recordOutbound`), contact-consent (`ConsentGate` for broadcast recipients), message-templates (`wa_templates` where channel is line), plans-subscriptions-trials (`extra_channels`).
- Exposes the LINE sender and the adapter for the inbox, and the channel list for the Campaigns chooser.
- Waits on flow-runtime-engine and node-bridge-runtime for TW-LINE-015.

## Open questions & quirks

- Rich menus (TW-LINE-016) and insights (TW-LINE-017) are real features in Reference and are not ported yet.
- Rotation as shipped cannot work (the numeric Channel ID is never captured); the port asks for it.
- The docs describe narrowcast and Flex messages that the code does not use.
- Follow and unfollow events are ignored although a comment says they create a thread.
- `line_channels_limit` is never enforced.

## Coverage

```json threadwise-coverage
{
  "routes": [
    "GET|HEAD line",
    "POST line/connect",
    "POST line/{channel}/retry",
    "POST line/{channel}/rotation",
    "POST line/{channel}/toggle",
    "DELETE line/{channel}",
    "GET|HEAD line/rich-menus",
    "GET|HEAD line/rich-menus/create",
    "POST line/rich-menus",
    "POST line/rich-menus/{richMenu}/default",
    "POST line/rich-menus/{richMenu}/clear",
    "DELETE line/rich-menus/{richMenu}",
    "GET|HEAD line/insights",
    "GET|HEAD line/broadcasts",
    "GET|HEAD line/broadcasts/create",
    "POST line/broadcasts",
    "POST line/broadcasts/{broadcast}/start",
    "POST line/broadcasts/{broadcast}/pause",
    "POST line/broadcasts/{broadcast}/retry",
    "POST line/broadcasts/{broadcast}/batch",
    "DELETE line/broadcasts/{broadcast}",
    "POST api/line/inbound/{token}",
    "POST api/line/flow-log",
    "POST api/line/flow-node"
  ],
  "controllers": [
    "app/Http/Controllers/Line/LineBroadcastController.php",
    "app/Http/Controllers/Line/LineConnectController.php",
    "app/Http/Controllers/Line/LineFlowNodeController.php",
    "app/Http/Controllers/Line/LineInsightsController.php",
    "app/Http/Controllers/Line/LineRichMenuController.php",
    "app/Http/Controllers/Line/LineWebhookController.php"
  ],
  "services": [
    "app/Services/Line/LineChats.php",
    "app/Services/Line/LineClient.php",
    "app/Services/Line/LineFlowBridge.php"
  ],
  "models": [
    "LineBroadcast",
    "LineBroadcastRecipient",
    "LineChannel",
    "LineFlowSession",
    "LineRichMenu"
  ],
  "tables": [
    "line_broadcast_recipients",
    "line_broadcasts",
    "line_channels",
    "line_flow_sessions",
    "line_rich_menus"
  ],
  "views": [
    "resources/views/user/line/broadcasts-create.blade.php",
    "resources/views/user/line/broadcasts.blade.php",
    "resources/views/user/line/index.blade.php",
    "resources/views/user/line/insights.blade.php",
    "resources/views/user/line/rich-menus-create.blade.php",
    "resources/views/user/line/rich-menus.blade.php"
  ],
  "node_files": ["node/controllers/lineFlowController.js", "node/services/lineFlowService.js"],
  "js_assets": ["resources/js/charts/user-line-broadcasts.js"],
  "misc_files": ["routes/line.php"],
  "feature_map": {
    "TW-LINE-001": ["GET|HEAD line"],
    "TW-LINE-002": ["POST line/connect"],
    "TW-LINE-003": ["POST line/{channel}/retry"],
    "TW-LINE-004": ["POST line/{channel}/toggle", "DELETE line/{channel}"],
    "TW-LINE-005": ["POST line/{channel}/rotation"],
    "TW-LINE-006": ["POST api/line/inbound/{token}"],
    "TW-LINE-011": ["GET|HEAD line/broadcasts"],
    "TW-LINE-012": ["GET|HEAD line/broadcasts/create", "POST line/broadcasts"],
    "TW-LINE-013": ["POST line/broadcasts/{broadcast}/batch"],
    "TW-LINE-014": [
      "POST line/broadcasts/{broadcast}/start",
      "POST line/broadcasts/{broadcast}/pause",
      "POST line/broadcasts/{broadcast}/retry",
      "DELETE line/broadcasts/{broadcast}"
    ],
    "TW-LINE-015": ["POST api/line/flow-log", "POST api/line/flow-node"],
    "TW-LINE-016": [
      "GET|HEAD line/rich-menus",
      "GET|HEAD line/rich-menus/create",
      "POST line/rich-menus",
      "POST line/rich-menus/{richMenu}/default",
      "POST line/rich-menus/{richMenu}/clear",
      "DELETE line/rich-menus/{richMenu}"
    ],
    "TW-LINE-017": ["GET|HEAD line/insights"]
  }
}
```
