---
domain: channel-facebook
code: FB
title: Facebook Pages channel (connect, Messenger inbox, comments, broadcasts, setup, posts, insights)
wadesk_version: '1.7.0'
sources_read: 31
---

# Facebook Pages channel

## Overview

A workspace logs in with its Facebook account once (OAuth redirect, the embedded-signup popup, or a pasted Page token) and every
Page that account manages is stored with its own Page access token (encrypted). Meta then calls one app-level webhook
(`/webhooks/facebook`) for Messenger messages, postbacks and feed comments. Messages become `channel = facebook` conversations in
the team inbox (`raw_jid = fb:<pageId>:<psid>` for a DM, `fb:<pageId>:post:<postId>:<commenterId>` for a comment thread); the sender
becomes a CRM contact keyed by PSID; the inbox replies through the Page (Send API for a DM, a public reply for a comment). On top of
the inbox the channel ships Messenger broadcasts (to threads still inside Meta's 24 hour window), Messenger profile setup (Get
Started, greeting, persistent menu, ice breakers), a post composer and scheduler (text, link, photo, multi-photo, video, reel),
a live "my posts" grid and Page insights. Flows of type `facebook` run on the Node runtime.

Plan gates: `access_facebook` (the channel, broadcasts, setup, connect), `facebook_posts` (composer, posts, my posts, insights),
`facebook_inbox`, `facebook_comments`, `facebook_ai_agent` (AI agent replies on a Facebook thread), `facebook_pages_limit` and
`facebook_scheduled_posts_limit` (declared, never enforced). Platform switch: setting `facebook_enabled` hides the menu items. The
Meta app is the WhatsApp one (`waba_app_id`, `waba_app_secret`, `waba_webhook_verify_token`) unless `fb_app_id`, `fb_app_secret`,
`fb_webhook_verify_token`, `fb_config_id`, `fb_graph_version` override it.

Connects to: team-inbox-conversations (threads, replies, 24h window), contacts-attributes-tags (contact per PSID),
message-templates (Facebook templates and buttons), flow-builder-editor and flow-runtime-engine (flows of type `facebook`),
plans-subscriptions-trials (feature flags), node-bridge-runtime (flow runtime), platform-settings-branding-storage (post media,
Meta app settings), notifications and the social calendar (scheduled posts).

## Feature index

| Id        | Feature                                                                       | Status  | Priority | Effort | Depends on                   |
| --------- | ----------------------------------------------------------------------------- | ------- | -------- | ------ | ---------------------------- |
| WD-FB-001 | Facebook hub: connected Pages, status, connect options                        | pending | P0       | M      | WD-FB-002, WD-FB-004         |
| WD-FB-002 | Connect an account: OAuth redirect, embedded popup, pasted Page token         | pending | P0       | L      | WD-FB-022                    |
| WD-FB-003 | Store every Page: scopes, tasks, subscribe, backfill                          | pending | P0       | M      | WD-FB-002                    |
| WD-FB-004 | Manage a Page: refresh profile, fix inbound, disconnect                       | pending | P0       | S      | WD-FB-003                    |
| WD-FB-005 | Token health sweep (hourly, inline) and re-auth prompt                        | pending | P1       | S      | WD-FB-003                    |
| WD-FB-006 | Meta webhook: verify handshake, signature, per-workspace fan-out              | pending | P0       | M      | WD-FB-003                    |
| WD-FB-007 | Inbound Messenger DM to inbox thread, contact, media and automation order     | pending | P0       | L      | WD-FB-006                    |
| WD-FB-008 | Postback taps (Get Started, buttons, ice breakers) hand-off                   | pending | P1       | S      | WD-FB-007                    |
| WD-FB-009 | Feed comments to per-post comment threads                                     | pending | P1       | M      | WD-FB-006                    |
| WD-FB-010 | History backfill of existing Messenger threads                                | pending | P1       | M      | WD-FB-007                    |
| WD-FB-011 | Inbox reply through the Page: DM text, attachment, public comment reply       | pending | P0       | M      | WD-FB-007, WD-FB-009         |
| WD-FB-012 | Messenger broadcasts: audience (24h window), compose, list                    | pending | P0       | M      | WD-FB-007                    |
| WD-FB-013 | Broadcast sending: batches, window re-check, blocked vs failed, inbox mirror  | pending | P0       | L      | WD-FB-012                    |
| WD-FB-014 | Broadcast start, pause, retry failed, delete                                  | pending | P0       | M      | WD-FB-013                    |
| WD-FB-015 | Messenger setup: Get Started, greeting, persistent menu, ice breakers         | pending | P1       | M      | WD-FB-003                    |
| WD-FB-016 | Post composer: text, link, photo, multi-photo, video, reel, schedule          | pending | P1       | L      | WD-FB-003                    |
| WD-FB-017 | Posts list: KPIs, filters, publish now (retry), delete                        | pending | P1       | M      | WD-FB-016                    |
| WD-FB-018 | My posts: live grid of the Page's recent posts                                | pending | P2       | S      | WD-FB-003                    |
| WD-FB-019 | Insights: identity, Graph metrics, local analytics, recent posts              | pending | P2       | M      | WD-FB-007, WD-FB-016         |
| WD-FB-020 | Composer AI tools: caption, repurpose, review, best time, image               | blocked | P2       | M      | ai-keys-usage-admin          |
| WD-FB-021 | Flow hand-off and the two Node callbacks (flow-log, flow-node), comment reply | blocked | P1       | L      | flow-runtime-engine          |
| WD-FB-022 | Plan gates, platform switch, permission keys                                  | partial | P0       | S      | plans-subscriptions-trials   |
| WD-FB-023 | Social calendar feed and scheduling of Facebook posts                         | blocked | P2       | S      | owner of the social calendar |

## Features

### WD-FB-001 — Facebook hub: connected Pages, status, connect options

- **Status:** pending. **Priority:** P0. **Effort:** M.
- **Summary:** WaDesk lists Facebook Pages on `/devices` (Channels) with Connect, Refresh, Fix inbound and Disconnect. The port gives the channel its own hub `/facebook` with the same controls and the Page cards (picture, name, category, fans, state, last error, data-access expiry).
- **Actors & access:** workspace members on a plan with `access_facebook`; menu entries hidden unless `facebook_enabled`.
- **UX & screens:** the Facebook card on `resources/views/user/devices` and the setup explainer `components/facebook/setup-explainer.blade.php`. A Page shows "Connected", "Reconnect needed" (status `expired`) or the error. Connect buttons: "Continue with Facebook" (redirect), the popup, and a manual-token form.
- **Endpoints:** `GET /facebook/connect`, `GET /facebook/callback`, `POST /facebook/connect/embedded`, `POST /facebook/connect/manual`, `POST /facebook/{id}/refresh`, `POST /facebook/{id}/resubscribe`, `DELETE /facebook/{id}` (middleware web, auth, plan:access_facebook).
- **Data:** `facebook_pages` of the workspace (token never returned).
- **Rules & edge cases:** (1) pages are listed for the active workspace only; (2) `expired` and `error` pages stay listed with a reconnect prompt; (3) the access token is never rendered.
- **Source refs:** `routes/facebook.php`, `FacebookConnectController`, `app/Models/FacebookPage.php`, `UserNav.php`.
- **Port notes:** home `apps/api/src/modules/channel-facebook/`, `apps/web/src/features/channel-facebook/`. Nav group `channels`, replacing the planned entry.

### WD-FB-002 — Connect an account: OAuth redirect, embedded popup, pasted Page token

- **Status:** pending. **Priority:** P0. **Effort:** L.
- **Summary:** Three ways to connect. OAuth redirect: `start` sends the user to `facebook.com/<v>/dialog/oauth` with scopes `pages_show_list, pages_read_engagement, pages_manage_posts, pages_manage_engagement, pages_read_user_content, pages_manage_metadata, pages_messaging, read_insights, business_management` (or a Login-for-Business `config_id` with `override_default_response_type=true`); `callback` exchanges the code. Embedded: the Facebook JS SDK popup posts a server-side `code` (exchanged without a redirect uri). Manual: paste a Page access token (20 to 1000 characters).
- **Rules & edge cases:**
  1. `start` and `callback` re-check `access_facebook` in code (a write on GET is not blocked by route middleware); no Meta app id means "Facebook is not configured".
  2. The OAuth `state` is the session CSRF token and must round-trip unchanged (login-CSRF guard); a mismatch is refused.
  3. A provider `error` on the callback is shown to the user. Missing code or workspace is refused.
  4. The code is exchanged for a short user token, upgraded to a long-lived one BEFORE `/me/accounts` (a failed upgrade falls back to the short token with a warning), then every Page is listed (follows `paging.next`, up to 10 pages of 100).
  5. Manual: the token must resolve through `/me` to a Page id, otherwise "That token did not resolve to a Facebook Page."
  6. Embedded needs both `fb_app_id` and the secret, else 422 with a message.
  7. QUIRK: `facebook_pages_limit` is never checked.
- **External systems:** Graph `oauth/access_token` (code and `fb_exchange_token`), `me/accounts`, `me`, `debug_token` (app token `id|secret`).
- **Acceptance criteria:** Given a valid code, When the callback runs, Then each managed Page exists with its own token. Given a wrong `state`, Then nothing is stored. Given a token that is not a Page's, Then manual connect says so.
- **Source refs:** `FacebookConnectController` (`start`, `callback`, `connectEmbedded`, `connectManual`, `longLived`), `FacebookPageClient` (`exchangeCode`, `extendUserToken`, `listPages`, `pageFromToken`).
- **Port notes:** Graph calls behind a `FacebookGraph` port (`infra/providers/channel-facebook/`) so tests use a fake. State is a signed, short-lived value tied to org and user (no PHP session here). Encrypt tokens with `CryptoService`.

### WD-FB-003 — Store every Page: scopes, tasks, subscribe, backfill

- **Status:** pending. **Priority:** P0. **Effort:** M.
- **Summary:** For each Page returned, upsert a `facebook_pages` row on (workspace, page id): name, category, username, picture, encrypted Page token, `tasks`, granted `scopes` and `data_access_expires_at` read from `debug_token` (falling back to the requested scopes), `status = connected`, `connect_method`, `fan_count`, `last_error = null`, `token_expires_at = null` (Page tokens from a long-lived user token do not expire). It then subscribes the Page to webhooks and queues a history backfill.
- **Rules & edge cases:** (1) a Page missing id or token is skipped; none usable is an error "Meta returned no usable Page tokens"; (2) no Pages at all: "No Facebook Pages were found on this account…"; (3) the subscribe call is best effort (failure is logged, the Page stays connected); (4) the backfill runs after the response and never throws; (5) one message summarises: one Page by name, several as a count and the first five names.
- **External systems:** Graph `POST {page}/subscribed_apps` with `feed,mention,messages,messaging_postbacks,message_reactions,messaging_optins,messaging_referrals`.
- **Source refs:** `FacebookConnectController::storePages`, `upsertPage`, `FacebookPageClient::subscribeWebhooks`.
- **Port notes:** the backfill is a BullMQ job (`fb-backfill`), not a response hook.

### WD-FB-004 — Manage a Page: refresh profile, fix inbound, disconnect

- **Status:** pending. **Priority:** P0. **Effort:** S.
- **Summary:** Refresh re-reads `id,name,category,username,fan_count,followers_count,picture` and updates the row (failure: "Could not refresh (the Page token may need re-auth)"). Fix inbound re-runs the webhook subscription. Disconnect unsubscribes (errors ignored) and deletes the row.
- **Rules & edge cases:** all three are scoped to the workspace; a missing Page answers "Page not found."; disconnect removes the Page's broadcasts and posts by cascade here (WaDesk left orphans); inbox threads stay.
- **Source refs:** `FacebookConnectController` (`refresh`, `resubscribe`, `disconnect`), `FacebookPageClient` (`getProfile`, `subscribeWebhooks`, `unsubscribeWebhooks`).

### WD-FB-005 — Token health sweep (hourly, inline) and re-auth prompt

- **Status:** pending. **Priority:** P1. **Effort:** S.
- **Summary:** Page tokens do not expire but can be revoked and the 90 day data-access window can lapse. `FacebookTokenRefreshSweeper::run(workspace)` is cache-gated to once an hour per workspace, runs when the Channels page loads, and calls `debug_token` for each Page that is connected, expired or in error. A valid token revives an `expired` Page and clears the error; an invalid one sets `status = expired`, `last_error = "Token is no longer valid — reconnect this Page."`; `data_access_expires_at` is refreshed. Only runs when `facebook_enabled`. A Graph error with code 190 on any send also flags the Page `expired` (`noteGraphError`).
- **Port notes:** a scheduled worker job per organization (hourly) instead of a page-load hook; the 190 flag stays in the Graph adapter's caller.
- **Source refs:** `FacebookTokenRefreshSweeper`, `FacebookPageClient::noteGraphError`.

### WD-FB-006 — Meta webhook: verify handshake, signature, per-workspace fan-out

- **Status:** pending. **Priority:** P0. **Effort:** M.
- **Summary:** `GET /webhooks/facebook` echoes `hub.challenge` as text when `hub.mode = subscribe` and the verify token equals `fb_webhook_verify_token` (else the WhatsApp token); otherwise 403. `POST /webhooks/facebook` verifies `X-Hub-Signature-256` (`sha256=` HMAC of the raw body) against `fb_app_secret` and `waba_app_secret` in constant time.
- **Rules & edge cases:**
  1. A bad signature is 403 only when at least one secret is configured; with none configured the event is accepted (so Meta's "Verify and Save" works before the secret lands). QUIRK kept.
  2. Only `object = page` is processed; everything else answers 200.
  3. Delivery is at least once, unordered, batched: every `entry` and every event is processed; dedup is on the Meta id.
  4. The SAME Page can be connected in several workspaces; one webhook fans out to every workspace that connected it (connected Pages only).
  5. `entry[].messaging[]` goes to the Messenger ingest; `entry[].changes[]` with `field = feed` goes to the comment ingest. A failure in one event is logged and does not stop the rest. Always 200.
- **Port notes:** public route under `/v2/facebook/webhook`; the page-id lookup is a narrow SECURITY DEFINER function returning (org id, page row id) for a Page id (the table is behind RLS), like `tg_bot_lookup`. The signature needs the raw body: enable the raw-body capture for this route. The webhook address in the Meta app must be updated once.
- **Source refs:** `FacebookWebhookController`, `FacebookWebhookSignature`.

### WD-FB-007 — Inbound Messenger DM to inbox thread, contact, media and automation order

- **Status:** pending. **Priority:** P0. **Effort:** L.
- **Summary:** A `messaging` event with a `message` becomes an inbound row on the thread `fb:<pageId>:<psid>`.
- **Rules & edge cases:**
  1. Delivery and read receipts and our own echoes (`is_echo`) are ignored; a missing PSID or `mid` is ignored.
  2. Dedup: a message whose Meta id (`meta.facebook.message_id`) is already stored for that workspace and channel is dropped.
  3. First message creates the thread (`status = pending`, `inbox_status = open`, `provider = origin = facebook`, title "Facebook user" until a name is resolved); the sender profile (name, first and last name, picture) is fetched once, cached six hours, and sets the title and `routing_meta.fb_avatar`.
  4. The sender becomes a contact keyed by (workspace, `facebook`, PSID) with the source note "Source: Facebook DM"; the thread links it.
  5. The first attachment sets `media_type` and `media_path` (Meta's URL). The message time is Meta's `timestamp` (ms) in the app timezone, else now.
  6. The thread is moved: preview (120 characters), `last_message_at`, `last_inbound_at`, `unread_count + 1`, a resolved thread reopens.
  7. Then the "message received" event fires (realtime) and automation runs in this order: flow first (hand-off; consumed stops everything); else routing rules; else, if an AI agent is assigned, the agent replies only when `facebook_ai_agent` is on (never falls through to keywords); else keyword, welcome, away and out-of-hours auto-reply. Comments never run automation.
  8. The flow start matches published, active `facebook` flows bound to the Page whose comma-separated `trigger_keywords` contain the text (case-insensitive contains; `any`, `*`, `.*`, `.+` match everything).
- **Port notes:** thread, contact and message writes through an `InboxIngest` shim (as Telegram); automation behind an `InboundHooks` shim. See the parity file.
- **Source refs:** `FacebookIngestService` (`messengerEvent`, `write`, `resolveFbKeywordFlow`).

### WD-FB-008 — Postback taps (Get Started, buttons, ice breakers) hand-off

- **Status:** pending. **Priority:** P1. **Effort:** S.
- **Summary:** A `postback` event carries no `message`. Its payload (else its title) is handed to the flow runtime before the message guard so a flow parked on a buttons node resumes, or a keyword flow starts when the payload matches a trigger. Nothing is stored in the inbox. A hand-off failure is logged. Blocked on the flow runtime for the hand-off itself (WD-FB-021); the event routing is built.
- **Source refs:** `FacebookIngestService::messengerEvent` (postback branch), `FbFlowBridge::handoff`.

### WD-FB-009 — Feed comments to per-post comment threads

- **Status:** pending. **Priority:** P1. **Effort:** M.
- **Summary:** A `feed` change with `item = comment` and `verb = add` becomes an inbound row on the thread `fb:<pageId>:post:<postId>:<commenterId|anon>` (one thread per post and commenter, so a reply goes to the right person).
- **Rules & edge cases:** (1) a missing comment id or post id is ignored; (2) a comment by the Page itself is ignored; (3) dedup runs BEFORE any Graph call; (4) an empty body is fetched with `GET {comment}` (id, message, from, created_time, parent, attachment), still empty it is stored as "[comment]"; (5) the title is the commenter's name or "Facebook commenter"; (6) comment authors are NOT turned into contacts; (7) no automation runs on a comment; (8) `meta.facebook` carries message id, comment id, post id, parent id, from id and name.
- **Source refs:** `FacebookIngestService::feedComment`.

### WD-FB-010 — History backfill of existing Messenger threads

- **Status:** pending. **Priority:** P1. **Effort:** M.
- **Summary:** After connect, list up to 25 conversations (`id,participants,updated_time`) and up to 25 messages each, newest first from Meta and stored oldest first, through the same writer as the webhook (same thread key, same dedup, so it can be re-run) but WITHOUT the realtime event or any automation.
- **Rules & edge cases:** only the customer's messages are imported (the Page's own past replies are not); the PSID is the participant that is not the Page, else learned from the first customer message; a message with no text and no media is skipped; the time is Meta's `created_time`; a failed message is counted as skipped and logged. Result is `{threads, messages, skipped}`.
- **Source refs:** `FacebookConversationBackfillService`, `FacebookIngestService::backfillMessage`.

### WD-FB-011 — Inbox reply through the Page: DM text, attachment, public comment reply

- **Status:** pending. **Priority:** P0. **Effort:** M.
- **Summary:** `InboxDispatcher::dispatchFacebook` decodes the thread key. A comment thread replies publicly (`POST {id}/comments`) under the latest inbound comment's id, else the post. A DM thread sends through the Send API (`messaging_type = RESPONSE`, text cut to 2000). An outbound attachment goes first through the attachment send (type image, video, audio or file), the caption follows as a text bubble.
- **Rules & edge cases:** the Page named in the key must still be connected in that workspace, else "Facebook Page not connected"; a refusal returns `ok = false` with Meta's message and a code 190 flags the Page `expired`; the result never throws.
- **Source refs:** `app/Services/InboxDispatcher.php::dispatchFacebook`, `FacebookPageClient` (`sendMessage`, `sendAttachment`, `replyComment`).
- **Port notes:** a `FacebookSenderService.reply(orgId, {rawJid, text, media})` exported from the module, like `TelegramSenderService`; the inbox composer that calls it belongs to team-inbox-conversations.

### WD-FB-012 — Messenger broadcasts: audience (24h window), compose, list

- **Status:** pending. **Priority:** P0. **Effort:** M.
- **Summary:** `/facebook/broadcasts` lists the 50 newest broadcasts and carries the compose form. The audience of a Page is its Messenger DM threads (not comment threads) whose `last_inbound_at` is within 24 hours.
- **Rules & edge cases:**
  1. Create validates `name` (required, 191), `facebook_page_id`, optional `template_id`, `body` (max 2000), `psids` (required, at least one, each up to 64).
  2. The Page must be connected in the workspace ("Pick a connected Facebook Page.").
  3. A template applies only if it is a Facebook template of the workspace: its body fills an empty body, its buttons ride along.
  4. An empty message is refused ("A broadcast needs a message.").
  5. The posted PSIDs are resolved against the Page's own eligible audience; a forged id is dropped; none left is refused ("None of those recipients are within the 24-hour window…").
  6. The recipient list is snapshotted at creation (title, thread id) in chunks of 500; `status = draft`, `total = n`. Body and buttons are encrypted.
  7. Compose lists the connected Pages with each audience and the workspace's Facebook templates.
- **Source refs:** `FacebookBroadcastController` (`index`, `store`, `eligibleAudience`), `FacebookBroadcast`, `FacebookBroadcastRecipient`, `views/user/facebook/broadcasts.blade.php`, `resources/js/charts/user-facebook-broadcasts.js`.

### WD-FB-013 — Broadcast sending: batches, window re-check, blocked vs failed, inbox mirror

- **Status:** pending. **Priority:** P0. **Effort:** L.
- **Summary:** WaDesk drove sending from the open browser (25 pending recipients per tick). Per recipient: the 24 hour window is re-checked against the thread's `last_inbound_at` (outside: `blocked`, "Outside the 24-hour messaging window."); `{{name}}` and `{{ name }}` become the recipient's title; with buttons a button template goes out (max 3 buttons mapped from the template: `url` to `web_url`, `phone` to `phone_number`, anything else to a `postback` with payload `tqr:<title>`, titles cut to 20), else a plain message; success stores the message id and mirrors an outbound row into the thread (`meta.source = facebook_broadcast`); a refusal is `blocked` when the error says outside the window, unavailable, no matching user, invalid user id, not an admin or a policy block, else `failed`. When nothing is pending the broadcast is `done`.
- **Port notes:** a BullMQ job (`fb-broadcast`) like Telegram's; counters recomputed from rows. Documented difference: closing the page no longer pauses sending.
- **Source refs:** `FacebookBroadcastController::sendBatch`, `fbButtons`, `personalise`, `mirror`; `FacebookBroadcastRecipient::isUnreachable`; `FacebookPageClient::sendButtonTemplate`.

### WD-FB-014 — Broadcast start, pause, retry failed, delete

- **Status:** pending. **Priority:** P0. **Effort:** M.
- **Summary:** Start needs something pending ("Every recipient in this broadcast has already been handled.") and a live Page ("The Page this broadcast was built for is no longer connected."), sets `sending` and `started_at`. Pause returns to `draft`. Retry puts `failed` rows back to `pending` (blocked stay), lowers the failed counter, refuses with none ("No failed recipients to retry."). Delete removes recipients and the broadcast in any status. If the Page is gone mid-send the broadcast is `failed` with the reason.
- **Source refs:** `FacebookBroadcastController` (`start`, `pause`, `retry`, `destroy`, `stop`).

### WD-FB-015 — Messenger setup: Get Started, greeting, persistent menu, ice breakers

- **Status:** pending. **Priority:** P1. **Effort:** M.
- **Summary:** `/facebook/setup?page=<id>` reads the live Messenger profile (`get_started, greeting, ice_breakers, persistent_menu, whitelisted_domains, account_linking_url, commands, subject_to_new_eu_privacy_rules`) and edits four sections, each saved through the Graph and removable.
- **Rules & edge cases:**
  1. Get Started: a blank payload deletes it.
  2. Greeting: default locale, cut to 160 characters; blank deletes; a Graph version that no longer supports the field returns an `unsupported` error whose own message is shown as is.
  3. Persistent menu: up to 3 top-level items; titles cut to 30; type `web_url` (needs a URL, `webview_height_ratio = full`) or `postback` (blank payload becomes `MENU_<n>`); `composer_input_disabled` flag; a menu requires the Get Started button, so `GET_STARTED` is set first when none exists; no items deletes the menu.
  4. Ice breakers: up to 4; question cut to 80; blank payload becomes `ICE_BREAKER_<n>`; none deletes.
  5. Reading accepts the localized shape (`call_to_actions` per locale) and the legacy flat list.
  6. Every write answers "Facebook rejected the change: <reason>" on failure.
  7. Needs a connected Page (`facebook_page_id`).
- **Source refs:** `FacebookSetupController`, `views/user/facebook/setup.blade.php`, `resources/js/charts/user-facebook-setup.js`, `FacebookPageClient` (`setGetStarted`, `setGreeting`, `setPersistentMenu`, `setIceBreakers`, delete variants).

### WD-FB-016 — Post composer: text, link, photo, multi-photo, video, reel, schedule

- **Status:** pending. **Priority:** P1. **Effort:** L.
- **Summary:** `/facebook/posts/create` composes and publishes or schedules a post on a connected Page with a live mobile preview and AI tools (WD-FB-020).
- **Rules & edge cases:**
  1. Inputs: Page, message (max 60000), link (url), up to 10 photos (8 MB each) and pasted image URLs, a video (mp4 or quicktime, 200 MB) or a public HTTPS video URL, "as reel", schedule flag and time.
  2. Video wins over photos. An upload that PHP dropped is a clear error. Uploaded files must be reachable by Meta over public HTTPS or the post is refused with an explanation; pasted URLs are allowed.
  3. Nothing to post (no message, link or photo) is refused; photos and a link together are refused (Meta rejects it).
  4. Schedule: parsed in the user's timezone, at least 10 minutes and at most 75 days ahead.
  5. Type is `text`, `link`, `photo`, `multi_photo`, `video` or `reel`. A row is created (`draft`, or `scheduled`) BEFORE the Graph call; on success it stores `fb_post_id`, `published` or `scheduled` and `published_at`; on failure `failed` with the error (990 characters) and "Facebook rejected the post: …".
  6. Publishing: one photo goes to `/photos` (caption); several are uploaded unpublished and attached to `/feed`; text and link go to `/feed`; a scheduled post sends `published=false` and `scheduled_publish_time` (Meta holds it; no local sweeper). Video goes to `/videos` with `file_url`; a reel runs start, hosted upload, wait (up to about 40 s, error stops it) and finish (`PUBLISHED` or `SCHEDULED`).
- **Source refs:** `FacebookPostController::store`, `FacebookPageClient` (`publish`, `postVideo`, `postReel`, `postGraph`), `views/user/facebook/create.blade.php`.
- **Port notes:** media upload needs the storage domain (shim: pasted URLs only until then, recorded as blocked in the parity file).

### WD-FB-017 — Posts list: KPIs, filters, publish now (retry), delete

- **Status:** pending. **Priority:** P1. **Effort:** M.
- **Summary:** `/facebook/posts` lists posts with KPI cards (scheduled, published, failed), filters (status, type, range 7d/30d/90d, search over message and link, Page account), 15 per page ordered scheduled, then failed or draft, then the rest. `draft` counts with `failed` (both unpublished and retryable). Publish now retries a draft or failed post (video and reel resend the stored video URL). Delete removes it from Meta when it has a post id (errors ignored) and locally.
- **Source refs:** `FacebookPostController` (`index`, `publishNow`, `destroy`), `views/user/facebook/posts.blade.php`, `resources/js/charts/user-facebook-posts.js`.

### WD-FB-018 — My posts: live grid of the Page's recent posts

- **Status:** pending. **Priority:** P2. **Effort:** S.
- **Summary:** `/facebook/my-posts?page=<id>` reads the Page's 50 latest published posts (`id,message,created_time,permalink_url,full_picture`) straight from Graph; nothing is stored. Never errors: a failure shows an empty grid.
- **Source refs:** `FacebookPostController::grid`, `views/user/facebook/grid.blade.php`.

### WD-FB-019 — Insights: identity, Graph metrics, local analytics, recent posts

- **Status:** pending. **Priority:** P2. **Effort:** M.
- **Summary:** `/facebook/insights?page=<id>` shows the Page identity (live profile, else stored), followers, live 28 day metrics (`page_impressions`, `page_impressions_unique`, `page_post_engagements`, `page_views_total`, `page_fan_adds`; a deprecated metric simply comes back empty), local analytics (threads, open threads, messages in and out over 28 days, posts, published, scheduled), a 14 day in and out trend, a status mix, a content mix by post type, and up to 6 recent posts with impressions and engaged users (live first, local posts as fallback).
- **Source refs:** `FacebookInsightsController`, `views/user/facebook/insights.blade.php`, `resources/js/charts/user-facebook-insights.js`.

### WD-FB-020 — Composer AI tools: caption, repurpose, review, best time, image

- **Status:** blocked (ai-keys-usage-admin). **Priority:** P2. **Effort:** M.
- **Summary:** Five JSON tools under `/facebook/posts/ai/*`, gated by the AI feature plan check inside the controller. Recorded for the AI provider shim; buttons stay in the screen and answer the plan or "not available" state until the AI domain exports a text and image provider.
- **Source refs:** `FacebookComposerAiController`.

### WD-FB-021 — Flow hand-off and the two Node callbacks (flow-log, flow-node), comment reply

- **Status:** blocked (flow-runtime-engine). **Priority:** P1. **Effort:** L.
- **Summary:** Inbound DMs and postbacks are posted to the Node runtime `/api/facebook-flow/inbound` (header `X-Node-Token`, 15 s) with page id, workspace, PSID, text, comment id, the Page's Graph base and token, the flow to start (only to start) and variables; Node answers `consumed` and a consumed message stops all other automation. Node calls back `POST /api/facebook/flow-log` (mirror a flow message into the inbox) and `POST /api/facebook/flow-node` for smart nodes: `fb_reply_comment` (public reply under the triggering comment: this is the comment auto-reply), `fb_lead` (lead and deal), `fb_products` and `fb_gallery` (carousel), `ai` or `fb_ai` (reply from the AI provider and knowledge base), `webhook` (SSRF-guarded call, response flattened to dotted vars), `fb_to_whatsapp` (cross-channel hand-off).
- **Port notes:** the hand-off and both callbacks sit behind a `FlowRuntime` shim until the flow domain exists, like Telegram T7; the event routing in WD-FB-007 and 008 calls the shim and treats "not consumed" as the default.
- **Source refs:** `FbFlowBridge`, `FacebookFlowNodeController`, `node/controllers/facebookFlowController.js`, `node/services/facebookFlowService.js`.

### WD-FB-022 — Plan gates, platform switch, permission keys

- **Status:** partial. **Priority:** P0. **Effort:** S.
- **Summary:** Route gates are `plan:access_facebook` (connect, broadcasts, setup) and `plan:facebook_posts` (posts, my posts, insights, AI tools); the flags `facebook_inbox`, `facebook_comments` and `facebook_ai_agent` are stored on the package, only `facebook_ai_agent` is enforced (WD-FB-007 rule 7). Platform admin toggles `facebook_enabled` on the Message settings page; the menu entries carry the flag.
- **Port notes:** permission keys `fb.pages.read`, `fb.pages.manage`, `fb.broadcasts.read`, `fb.broadcasts.manage`, `fb.setup.manage`, `fb.posts.read`, `fb.posts.manage`, `fb.insights.read` replace the workspace-role guard. The plan flags are a shim (`FacebookPlanGate`) until the plan catalogue carries them.
- **Source refs:** `routes/facebook.php`, `app/Models/Package.php`, `AdminPagesController::settingsProvidersUpdate`, `UserNav.php`.

### WD-FB-023 — Social calendar feed and scheduling of Facebook posts

- **Status:** blocked (owner of the social calendar). **Priority:** P2. **Effort:** S.
- **Summary:** `SocialPostAggregator` merges `facebook_posts` into the cross-channel calendar and `SocialPostsController::scheduleFacebook` creates a scheduled post from the calendar. Recorded; the data is ready (`facebook_posts`), the calendar screen belongs to whoever owns it.
- **Source refs:** `app/Services/Social/SocialPostAggregator.php`, `app/Http/Controllers/SocialPostsController.php`.
