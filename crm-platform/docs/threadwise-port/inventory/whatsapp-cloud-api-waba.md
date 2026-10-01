---
domain: whatsapp-cloud-api-waba
code: WABA
title: WhatsApp Cloud API / WABA (embedded signup, numbers, webhooks, coexistence)
threadwise_version: '1.7.0'
sources_read: 58
---

# WhatsApp Cloud API / WABA

## Overview

This domain is everything Reference does with **Meta's WhatsApp Business Cloud API (WABA)** as a channel: how a workspace connects a Cloud API number (Embedded Signup, coexistence with the WhatsApp Business app, or pasting credentials), how the platform keeps that number healthy (Cloud API registration, webhook subscription with a callback override, token renewal, quality/limit diagnostics, business username), how Meta's webhooks are authenticated and turned into inbox messages, delivery statuses, template/group/username/coexistence updates, how inbound media is fetched, and how replies are sent back through the Cloud API. It also carries three loosely related items the brief assigned here: the Node-bridge inbound mirror endpoint, the WABA credentials endpoint for Node, and the saved-customer-profile screen (see Open questions).

**Actors.** Platform super-admin (one Meta app: App ID, Secret, Embedded Signup Config ID, webhook verify token, Graph version, coexistence toggle, webhook-field self-check); workspace admin (connects numbers, renews tokens, fixes inbound, claims a username); workspace manager (coexistence history sync from the inbox); Meta (webhooks, signed with the app secret); the Node bridge (internal endpoints authenticated by a shared `X-Node-Token`); the end customer (inbound messages, taps, orders).

**Main flow end to end.**

1. Admin stores the platform Meta app (TW-WABA-001) and, for coexistence, subscribes the four webhook fields (TW-WABA-002/003).
2. A workspace admin opens Devices and either runs Embedded Signup (TW-WABA-005/009, or coexistence TW-WABA-010) or pastes a System User token (TW-WABA-006). The server exchanges/validates the token, probes the number, subscribes the app to the WABA **with an override of the callback URL** to `/webhooks/whatsapp/inbound` (TW-WABA-011), saves an encrypted `wa_provider_configs` row (the first WABA becomes primary), registers the number on the Cloud API unless it is a coexistence number (TW-WABA-012) and verifies that inbound is wired (TW-WABA-013).
3. Meta posts webhooks to the single tenant-agnostic URL. The platform verifies the HMAC (platform secret, then the number's own app secret, then any stored secret, then a token-based ownership check, with a status-only rescue) (TW-WABA-029/030), resolves the WABA row, and dispatches each change by field (TW-WABA-031): inbound messages are extracted, de-duplicated, filed into one thread per customer, media is downloaded, and the automation pipeline runs (TW-WABA-032 to 036); delivery statuses advance messages, broadcast and campaign recipients and settle wallet billing once (TW-WABA-037/038); template, group, username, payment, form, call and coexistence events are applied or handed off (TW-WABA-039 to 046).
4. Replies, campaigns and flows go back out through `POST /{phone_number_id}/messages` on the conversation's own number (TW-WABA-049).
5. Operators watch the number on the account-health page and fix problems in place (TW-WABA-014, 015, 019, 020, 021, 022).

**Plan tiers.** No plan feature key gates WABA connection itself. The only plan gates are the unified `device_limit` (Baileys + WABA + Twilio numbers together) on connect, `access_waba_calling` for the calling toggle (CALL) and `access_wa_storefront` for the saved-customer page. Billing mode (Meta pays direct vs reseller wallet) is chosen on the same page and owned by BSP.

**Connections to other domains.** WADEV (shared `wa_provider_configs` table and the Devices hub; Baileys and Twilio engines), BSP (auto-attach of the reseller credit line when a WABA becomes connected; `bill_to_platform_credit`), TPL (template lifecycle, template client, MetaError reuse), BCAST/CAMP/SCHED (delivery status, replies, retry, template click analytics), WALLET (settle on delivered/failed), TIB1/CHAT/TIB2 (conversations, routing, opt-out), AR/FLR/AIAG (keyword replies, flow bridge, AI agent), CALL (calls webhook, calling toggle), WFL (form submissions, `waba_groups`), CHK/CAT/STORE (catalog orders, WhatsApp Pay, saved customers), MADS (CTWA client), NODE (X-Node-Token endpoints), SET (platform settings), NOTIF (audit, push, realtime), PLAN/RBAC (device limit, roles), MOB (mobile connect endpoint).

**What is not in Reference.** No Meta App Review workflow, no per-tenant webhook URL, no queue between webhook receipt and processing, and no automatic token renewal.

## Feature index

| Id          | Feature                                                                                    | Status      | Priority | Effort | Depends on                                                                                |
| ----------- | ------------------------------------------------------------------------------------------ | ----------- | -------- | ------ | ----------------------------------------------------------------------------------------- |
| TW-WABA-001 | Platform Meta app credentials and WABA platform settings                                   | implemented | P0       | M      | TW-SET (platform settings store, encrypted keys), TW-ASHELL                               |
| TW-WABA-002 | Coexistence enablement and webhook-field self-check                                        | implemented | P1       | M      | TW-WABA-001                                                                               |
| TW-WABA-003 | One-click subscribe of coexistence webhook fields                                          | implemented | P1       | S      | TW-WABA-002                                                                               |
| TW-WABA-004 | WABA numbers section on the Devices page                                                   | implemented | P0       | M      | TW-WABA-006, TW-WABA-009, TW-WABA-013, TW-WADEV (Devices hub), TW-BSP-017 (billing cards) |
| TW-WABA-005 | Connect modals and Meta JS SDK launcher (client side)                                      | implemented | P0       | M      | TW-WABA-001, TW-WABA-004                                                                  |
| TW-WABA-006 | Manual connect (paste WABA credentials)                                                    | implemented | P0       | L      | TW-WABA-005, TW-WABA-011, TW-WABA-012, TW-WABA-013, TW-PLAN (device_limit)                |
| TW-WABA-007 | Pre-save token self-check                                                                  | implemented | P1       | S      | TW-WABA-005                                                                               |
| TW-WABA-008 | Short-lived to long-lived token exchange endpoint                                          | partial     | P2       | S      | TW-WABA-001                                                                               |
| TW-WABA-009 | Embedded Signup connect (new number)                                                       | implemented | P0       | L      | TW-WABA-001, TW-WABA-005, TW-WABA-011, TW-WABA-012, TW-WABA-013                           |
| TW-WABA-010 | Coexistence onboarding (Business App number)                                               | implemented | P1       | M      | TW-WABA-002, TW-WABA-009                                                                  |
| TW-WABA-011 | Subscribe the app to a WABA with callback override                                         | implemented | P0       | M      | TW-WABA-001                                                                               |
| TW-WABA-012 | Cloud API number registration (auto and manual with PIN)                                   | implemented | P0       | M      | TW-WABA-006, TW-WABA-009                                                                  |
| TW-WABA-013 | Inbound-wired verification, stamping and badge                                             | implemented | P0       | S      | TW-WABA-011                                                                               |
| TW-WABA-014 | Fix inbound (re-subscribe and verify)                                                      | implemented | P0       | S      | TW-WABA-011, TW-WABA-013                                                                  |
| TW-WABA-015 | Live inbound webhook diagnostic and own-app setup guidance                                 | implemented | P1       | M      | TW-WABA-011                                                                               |
| TW-WABA-016 | Set primary number and primary auto-promotion                                              | implemented | P1       | S      | TW-WABA-004                                                                               |
| TW-WABA-017 | Disconnect a WABA number                                                                   | implemented | P1       | S      | TW-WABA-004, TW-WABA-016                                                                  |
| TW-WABA-018 | Remove a WABA number                                                                       | implemented | P1       | S      | TW-WABA-016                                                                               |
| TW-WABA-019 | Replace access token (verified paste)                                                      | implemented | P1       | S      | TW-WABA-021                                                                               |
| TW-WABA-020 | Renew access token in place                                                                | implemented | P1       | S      | TW-WABA-001                                                                               |
| TW-WABA-021 | Account health dashboard                                                                   | implemented | P0       | L      | TW-WABA-004, TW-WABA-022                                                                  |
| TW-WABA-022 | Health issue derivation and overall status                                                 | implemented | P1       | M      | TW-WABA-021                                                                               |
| TW-WABA-023 | Free service-conversation allowance panel                                                  | partial     | P2       | S      | TW-WABA-021                                                                               |
| TW-WABA-024 | Verified badge checklist and calling toggle on the health page                             | implemented | P2       | S      | TW-WABA-021, TW-CALL (calling toggle endpoint)                                            |
| TW-WABA-025 | Business username claim and release                                                        | implemented | P2       | M      | TW-WABA-021                                                                               |
| TW-WABA-026 | Business username status webhook                                                           | implemented | P2       | S      | TW-WABA-025, TW-WABA-031                                                                  |
| TW-WABA-027 | Message QR codes (click-to-chat)                                                           | partial     | P2       | S      | TW-WABA-021                                                                               |
| TW-WABA-028 | Coexistence chat-history sync trigger                                                      | implemented | P1       | S      | TW-WABA-010, TW-WABA-046                                                                  |
| TW-WABA-029 | Webhook verification handshake (GET)                                                       | implemented | P0       | S      | TW-WABA-001                                                                               |
| TW-WABA-030 | Webhook request authentication (signature, fallbacks, ownership check, status-only rescue) | implemented | P0       | L      | TW-WABA-029, TW-WABA-006                                                                  |
| TW-WABA-031 | Webhook entry routing, config resolution and field dispatch                                | implemented | P0       | M      | TW-WABA-030                                                                               |
| TW-WABA-032 | Inbound message content extraction                                                         | implemented | P0       | M      | TW-WABA-031                                                                               |
| TW-WABA-033 | Inbound de-duplication, self-echo detection and reactions                                  | implemented | P0       | M      | TW-WABA-032                                                                               |
| TW-WABA-034 | Inbound conversation binding, thread creation and contact capture                          | implemented | P0       | L      | TW-WABA-033, TW-TIB1 (conversations), TW-CON (contacts)                                   |
| TW-WABA-035 | Inbound media download and retry                                                           | implemented | P0       | M      | TW-WABA-034                                                                               |
| TW-WABA-036 | Inbound automation pipeline (post-store fan-out)                                           | implemented | P0       | XL     | TW-WABA-034, TW-TIB2, TW-AR, TW-FLR, TW-AIAG, TW-BCAST, TW-CAMP, TW-NOTIF                 |
| TW-WABA-037 | Delivery status ingestion (sent, delivered, read, failed)                                  | implemented | P0       | L      | TW-WABA-031, TW-WALLET, TW-BCAST, TW-CAMP                                                 |
| TW-WABA-038 | Campaign retry on Meta engagement block (131049)                                           | implemented | P1       | M      | TW-WABA-037, TW-CAMP                                                                      |
| TW-WABA-039 | Group message and group status ingestion                                                   | implemented | P2       | M      | TW-WABA-031, TW-WFL (groups)                                                              |
| TW-WABA-040 | Group lifecycle webhooks (waba_groups mirror)                                              | implemented | P2       | M      | TW-WABA-031, TW-WFL                                                                       |
| TW-WABA-041 | Template lifecycle webhooks                                                                | implemented | P0       | M      | TW-WABA-031, TW-TPL                                                                       |
| TW-WABA-042 | Catalog order message ingestion                                                            | implemented | P1       | M      | TW-WABA-031, TW-CHK, TW-CAT                                                               |
| TW-WABA-043 | Webhook hand-offs to forms, WhatsApp Pay and calling                                       | implemented | P1       | S      | TW-WABA-031, TW-WFL, TW-CHK, TW-CALL                                                      |
| TW-WABA-044 | Coexistence: business-app message echoes                                                   | implemented | P1       | M      | TW-WABA-010, TW-WABA-031                                                                  |
| TW-WABA-045 | Coexistence: contact sync from the Business app                                            | implemented | P2       | S      | TW-WABA-010, TW-CON                                                                       |
| TW-WABA-046 | Coexistence: chat history import                                                           | implemented | P1       | M      | TW-WABA-010, TW-WABA-031                                                                  |
| TW-WABA-047 | Twilio inbound on the shared endpoint                                                      | implemented | P1       | M      | TW-WABA-034, TW-WADEV (Twilio connection)                                                 |
| TW-WABA-048 | Node bridge inbound mirror endpoint                                                        | implemented | P1       | L      | TW-NODE, TW-WADEV, TW-TIB1                                                                |
| TW-WABA-049 | Cloud API outbound send adapter                                                            | implemented | P0       | XL     | TW-WABA-006, TW-WABA-051, TW-CHAT, TW-TPL                                                 |
| TW-WABA-050 | WABA credentials for the Node bridge                                                       | implemented | P1       | S      | TW-NODE, TW-WABA-006                                                                      |
| TW-WABA-051 | Meta Graph error translation                                                               | implemented | P1       | S      | none                                                                                      |
| TW-WABA-052 | WABA id backfill                                                                           | implemented | P2       | S      | TW-WABA-006                                                                               |
| TW-WABA-053 | Template button-click analytics sync                                                       | partial     | P2       | M      | TW-WABA-041, TW-TPL, TW-CAMP                                                              |
| TW-WABA-054 | Ads client reuse of WABA identifiers                                                       | implemented | P2       | S      | TW-MADS                                                                                   |
| TW-WABA-055 | Saved customer profiles (list, search and save)                                            | implemented | P2       | S      | TW-CHK, TW-STORE                                                                          |
| TW-WABA-056 | Delete a saved customer (cascade to orders)                                                | implemented | P2       | S      | TW-WABA-055                                                                               |
| TW-WABA-057 | Legacy Embedded Signup callback and connect wizard partial                                 | dead-code   | P2       | S      | TW-WABA-001                                                                               |

## Features

### TW-WABA-001 — Platform Meta app credentials and WABA platform settings

- **Status:** implemented
- **Priority:** P0
- **Effort:** M
- **Depends on:** TW-SET (platform settings store, encrypted keys), TW-ASHELL
- **Summary:** The platform owner stores the one Meta (Facebook) app that every workspace's Embedded Signup, token renewal, webhook signature check and health diagnostics reuse: App ID, App Secret, Embedded Signup Config ID, webhook verify token and Graph API version. Without App ID + Secret nothing in Embedded Signup or token renewal works; without a Config ID workspaces are pushed to the manual-paste flow.
- **Actors & access:** Platform admin only (`EnsureUserIsAdmin` + `IPAllowlist` middleware on `/admin/*`). No permission key and no plan feature key. Platform scope, not workspace scope. The values are read by every tenant-facing WABA feature.
- **UX & screens:** `resources/views/admin/settings/channel-setting.blade.php`, section `whatsapp`, engine pane "Business API (WABA)" (the pane is hidden unless `waba` is in the enabled-engines set). Fields, all on the shared providers form (`threadwise-providers-form`): "Meta App ID" (text, marked required in the UI), "App Secret" (password; placeholder says stored/leave blank to keep when a secret already exists), "Webhook verify token" (free text, hint says any random string), a read-only copy-to-clipboard "Webhook URL" (`{APP_URL}/webhooks/whatsapp/inbound`) with the hint to subscribe the `messages` and `message_status` fields, "Embedded Signup Config ID" (text, hint: empty means workspaces paste a token manually), a read-only copy-to-clipboard "OAuth redirect URI" (`{APP_URL}/connect/wa-store/waba`, hint: paste it into Facebook Login > Valid OAuth redirect URIs), and the Coexistence checkbox (see TW-WABA-002). Also on the same pane, a "Per-workspace WABA routing" card with a "Graph API version" input (placeholder `v23.0`), a read-only "Connected WABAs" count, an Enabled/Disabled toggle for `waba_dispatch_v2_enabled` and, when that toggle is on with zero connected WABAs, an amber warning that outbound sends will fail with "No connected WABA account". A footnote states per-workspace phone number id and token are collected at /devices.
- **Endpoints:** (form target belongs to TW-SET/TW-WADEV; listed here for the fields it persists)
  | Method + URI                                    | Route name                        | Action                                         | Middleware                                   | Request fields                                                                                                                                                                                                                                                                                                                                                        | Response                                                                                     |
  | ----------------------------------------------- | --------------------------------- | ---------------------------------------------- | -------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
  | `POST admin/settings/providers`                 | `admin.settings.providers.update` | `AdminPagesController@settingsProvidersUpdate` | Authenticate, EnsureUserIsAdmin, IPAllowlist | `waba_app_id` string max 64 nullable; `waba_app_secret` string max 128 nullable; `waba_config_id` string max 64 nullable; `waba_coexistence` boolean nullable; `waba_webhook_verify_token` string max 96 nullable; `waba_graph_api_version` nullable regex `^v\d{1,2}\.\d{1,2}$`; `waba_dispatch_v2_enabled` boolean; plus every other channel field on the same form | redirect to the channel-setting section the save came from, flash "Provider settings saved." |
  | `GET admin/settings/channel-setting/{section?}` | `admin.settings.channel-setting`  | `AdminPagesController@settingThreadwiseMessage`    | same                                         | optional `section` = whatsapp/facebook/telegram/line/wechat/viber/tiktok/sms/email/otp/templates/pacing/campaign/node                                                                                                                                                                                                                                                 | the hub / detail view                                                                        |
- **Data:** `system_settings` keys `waba_app_id` (default empty), `waba_app_secret` (encrypted at rest, in `SystemSetting::ENCRYPTED_KEYS`), `waba_config_id`, `waba_coexistence` (bool, default false), `waba_webhook_verify_token` (encrypted at rest; auto-generated on first need), `waba_graph_api_version` (default `v23.0`), `waba_dispatch_v2_enabled` (bool, default false), `waba_verify_by_ownership` (bool, default true, no UI anywhere), plus the admin "allowed engines" set `allowed_send_methods` (slugs `twilio`, `wa-api`, `business-api` map to providers `twilio`, `baileys`, `waba`). `waba_connected_count` shown on the page = count of `wa_provider_configs` rows with provider `waba` and status `connected`.
- **Rules & edge cases:**
  1. The secret is only overwritten when the submitted field is non-empty, so re-saving the page never blanks it. App ID, Config ID and verify token are written on every save (empty string clears them).
  2. Empty `waba_app_id`/`waba_app_secret` disables Embedded Signup with a specific error; empty `waba_config_id` (or empty app id) makes `embeddedSignupReady` false so the Add button opens the manual modal instead.
  3. The verify token can be typed by the admin; if it is still empty when any connect path needs it (`wabaWebhookVerifyToken`, coexistence subscribe, mobile connect) a 40-char random token is generated and persisted, and an existing value is never overwritten because Meta already verified subscriptions against it.
  4. Graph version must match `vNN.N`; blank leaves the previous stored value untouched (the write is skipped when empty). Every Meta call in this domain reads `waba_graph_api_version` (default `v23.0`), except the Node bridge (`env META_GRAPH_VERSION`, default v21.0) and one ownership probe that reads a differently named key (`waba_graph_version`); see Open questions.
  5. `waba_dispatch_v2_enabled` is written and shown but no runtime code reads it (outbound sends always use per-workspace config); treat as dead flag.
  6. Changing App ID/Secret invalidates tokens issued by the old app; docs warn workspaces must reconnect. Saving providers also pushes settings to the Node bridge (`NodeCacheBuster::refreshNodeSettings` + `bustAll`).
- **Async & events:** Saving triggers a best-effort HTTP refresh of the Node bridge's cached settings and flushes its per-phone WABA settings cache. No queue.
- **External systems:** none at save time. Meta app configured out of band: Webhooks product with the callback URL above and the verify token, fields `messages` (+ statuses) subscribed, Facebook Login redirect URI, WhatsApp Embedded Signup configuration (Config ID).
- **Settings:** the keys above. Env: `META_APP_SECRET` is a legacy fallback for the signature secret only (see TW-WABA-030).
- **Acceptance criteria:**
  - Given an admin enters App ID and a secret and saves, When the page reloads, Then the secret is not shown (placeholder says stored) and Embedded Signup verification calls succeed using it.
  - Given a stored secret, When the admin saves the form with the secret field blank, Then the stored secret is unchanged.
  - Given `waba_graph_api_version` is set to `v24.0`, When any WABA Graph call is made from the tenant flows, Then it targets `https://graph.facebook.com/v24.0/...`.
  - Given a graph version `24` (no v/dot), When saving, Then validation rejects it.
  - Given no verify token is stored, When the first workspace connects a number, Then a 40-char token is generated, stored encrypted, and reused by later handshakes.
- **Source refs:** `app/Http/Controllers/AdminPagesController.php` (`settings`, `settingsProvidersUpdate`, `settingThreadwiseMessage` view data), `resources/views/admin/settings/channel-setting.blade.php`, `app/Models/SystemSetting.php` (ENCRYPTED_KEYS), `Documentation/pages/getting-started/channel-settings.html`, `Documentation/pages/channels/whatsapp.html`.
- **Port notes:** Target has `CREDENTIALS_ENCRYPTION_KEY` + `CryptoService` (AES-256-GCM) but no platform settings table yet; store as platform-scope config (super-admin pool, not tenant RLS) in the SET domain and expose a typed `MetaAppConfig` provider to the WABA module. Keep the secret and verify token encrypted; never return the secret over the API (return `secretSet: boolean`). Fold `waba_verify_by_ownership` into an explicit config with a documented security trade-off (see TW-WABA-030).

### TW-WABA-002 — Coexistence enablement and webhook-field self-check

- **Status:** implemented
- **Priority:** P1
- **Effort:** M
- **Depends on:** TW-WABA-001
- **Summary:** An admin switch that adds a "Connect my existing Business App number" option to the connect modal, plus a read-only button that asks Meta which webhook fields the platform app is subscribed to and shows which coexistence fields (`messages`, `smb_message_echoes`, `smb_app_state_sync`, `history`) are missing.
- **Actors & access:** Platform admin (`EnsureUserIsAdmin`, `IPAllowlist`). Platform scope.
- **UX & screens:** Same pane as TW-WABA-001. A checkbox "Enable WhatsApp Coexistence" (explains the number keeps running on the Business App while Cloud API and webhooks run on the same number). Below it a box "One-time Meta App setup for Coexistence" listing three chips (`smb_message_echoes`, `smb_app_state_sync`, `history`), a paragraph that phone-typed replies appear as outbound, app contacts sync into the contact book and past chats backfill, and a note on Meta limits (Business App v2.24.17+, open app at least every 14 days, history import is 1:1 chats from the last 6 months only and no groups, about 5 msg/sec throughput). A "Check webhook subscription" button posts to its own form (full page redirect). Result panel (session flash `coex_check`): error text in an amber box; otherwise a headline (all subscribed, or "Some fields are NOT subscribed"), a list of the four fields with a tick "subscribed" or a cross "MISSING - subscribe it in Meta App > Webhooks", the callback URL Meta holds with active or INACTIVE, and (only when something is missing) the subscribe button of TW-WABA-003.
- **Endpoints:**
  | Method + URI                                         | Route name                         | Action                                          | Middleware                                   | Request | Response                              |
  | ---------------------------------------------------- | ---------------------------------- | ----------------------------------------------- | -------------------------------------------- | ------- | ------------------------------------- |
  | `POST admin/settings/channel-setting/check-webhooks` | `admin.settings.coexistence.check` | `AdminPagesController@checkCoexistenceWebhooks` | Authenticate, EnsureUserIsAdmin, IPAllowlist | none    | redirect back with flash `coex_check` |
- **Data:** Reads `waba_app_id`, `waba_app_secret`, `waba_graph_api_version`. Writes nothing. Flash shape: `ok` bool, `error?`, `callback_url`, `active` bool, `present` map field to bool, `missing` list, `all_fields` list.
- **Rules & edge cases:**
  1. Required set is exactly `messages`, `smb_message_echoes`, `smb_app_state_sync`, `history`.
  2. With no App ID or Secret returns an error telling the admin to set them, save, then retry (no Meta call).
  3. Calls `GET /{app_id}/subscriptions` with the app access token `{app_id}|{app_secret}`, 15s timeout. Non-2xx returns "Meta rejected the check" plus the first 300 chars of Meta's message and a hint to verify App ID/Secret.
  4. If Meta returns no `whatsapp_business_account` object subscription the message says no WhatsApp Business Account webhook is configured and the callback must be set in the app dashboard first.
  5. Field entries may be `{name: ...}` objects or plain strings; both handled.
  6. `ok` is true only when all four fields are present.
  7. Unreachable Meta returns "Could not reach Meta" with the first 200 chars of the exception.
  8. The coexistence checkbox only persists `waba_coexistence`; it is read by the connect modal (TW-WABA-005) to show the second launch button and note.
- **Async & events:** none.
- **External systems:** Meta Graph `GET /{app_id}/subscriptions`, app access token built from the stored secret.
- **Settings:** `waba_coexistence` (default false), `waba_app_id`, `waba_app_secret`, `waba_graph_api_version`.
- **Acceptance criteria:**
  - Given App ID and Secret are stored and the Meta app subscribes only `messages`, When the admin clicks Check, Then the panel shows `messages` subscribed and the other three MISSING and offers the subscribe button.
  - Given no App Secret is stored, When the admin clicks Check, Then an error asks for App ID and Secret and no request is made to Meta.
  - Given all four fields are subscribed, When Check runs, Then the headline says phone-typed replies will sync and no subscribe button is shown.
  - Given `waba_coexistence` is off, When a workspace opens the connect modal, Then the coexistence button is absent.
- **Source refs:** `app/Http/Controllers/AdminPagesController.php` (`checkCoexistenceWebhooks`, `coexSubscriptionStatus`), `resources/views/admin/settings/channel-setting.blade.php`, `routes/admin.php`, `Documentation/pages/getting-started/coexistence.html`.
- **Port notes:** Implement as `GET /platform/meta-app/webhook-status` in a platform admin module returning the same structure; UI in the platform admin Next.js area. Uses the platform Meta app config from TW-WABA-001. No tenant data, no RLS.

### TW-WABA-003 — One-click subscribe of coexistence webhook fields

- **Status:** implemented
- **Priority:** P1
- **Effort:** S
- **Depends on:** TW-WABA-002
- **Summary:** From the self-check result the admin can subscribe the missing fields on the Meta app through the API, keeping every field already subscribed and re-running Meta's callback verification with the stored verify token.
- **Actors & access:** Platform admin (`EnsureUserIsAdmin`, `IPAllowlist`).
- **UX & screens:** Button "Subscribe missing fields now" inside the self-check result (only when `missing` is non-empty) with helper text that it uses the App Secret and verify token above. After success the result panel re-renders with a line "Subscribed successfully - Meta will now deliver phone-typed replies and history." On failure the panel shows the error in amber.
- **Endpoints:**
  | Method + URI                                             | Route name                             | Action                                              | Middleware                                   | Request | Response                              |
  | -------------------------------------------------------- | -------------------------------------- | --------------------------------------------------- | -------------------------------------------- | ------- | ------------------------------------- |
  | `POST admin/settings/channel-setting/subscribe-webhooks` | `admin.settings.coexistence.subscribe` | `AdminPagesController@subscribeCoexistenceWebhooks` | Authenticate, EnsureUserIsAdmin, IPAllowlist | none    | redirect back with flash `coex_check` |
- **Data:** May write `waba_webhook_verify_token` (generated when blank, 24 random chars here versus 40 in the tenant flow). Reads App ID, Secret, graph version.
- **Rules & edge cases:**
  1. Refuses (flash error) when App ID or Secret is missing.
  2. First reads current status (TW-WABA-002). If that read errored and returned no fields, the error is shown and no POST is made.
  3. Callback URL: reuses the callback Meta already has on file; falls back to `{APP_URL}/webhooks/whatsapp/inbound`.
  4. Desired fields = union of already subscribed fields and the four required ones (never drops an existing field).
  5. POST `/{app_id}/subscriptions` form-encoded: `object=whatsapp_business_account`, `callback_url`, `fields` comma list, `verify_token`, `access_token={app_id}|{app_secret}`, 20s timeout. Meta performs the GET handshake against our callback during this call, so the stored verify token must equal what TW-WABA-029 compares.
     5b. Failure (non-ok or `success` false) shows "Meta rejected the subscribe" plus up to 300 chars of Meta's message and the causes (callback URL not reachable, or verify token mismatch), with `ok=false` merged into the fresh status.
  6. After success the status is re-read and `subscribed_now=true` is added when everything is present.
- **Async & events:** Meta calls our verify endpoint synchronously during the subscribe.
- **External systems:** Meta Graph `POST /{app_id}/subscriptions`.
- **Settings:** `waba_webhook_verify_token`, `waba_app_id`, `waba_app_secret`.
- **Acceptance criteria:**
  - Given `smb_message_echoes` is missing, When the admin clicks Subscribe, Then Meta receives the union of existing plus required fields and the panel afterwards shows all four subscribed.
  - Given the callback URL is unreachable from Meta, When the admin clicks Subscribe, Then the panel reports Meta rejected the subscribe with the reachability/verify-token hint and nothing is marked subscribed.
  - Given no verify token is stored, When subscribe runs, Then a token is generated and persisted before the call.
- **Source refs:** `app/Http/Controllers/AdminPagesController.php` (`subscribeCoexistenceWebhooks`), `routes/admin.php`, `app/Http/Controllers/WaWebhookController.php` (`verify`).
- **Port notes:** Same platform-admin module as TW-WABA-002; make it idempotent and audit-log it (`platform.meta_app.webhook_subscribed`). Do the Graph call in the request with a bounded timeout, not a worker.

### TW-WABA-004 — WABA numbers section on the Devices page

- **Status:** implemented
- **Priority:** P0
- **Effort:** M
- **Depends on:** TW-WABA-006, TW-WABA-009, TW-WABA-013, TW-WADEV (Devices hub), TW-BSP-017 (billing cards)
- **Summary:** The workspace's list of connected WhatsApp Business (Cloud API) numbers, one card per number with name, phone, WABA and phone-number ids, quality rating, daily messaging tier, connection state, an "inbound wired" badge, a Coexistence badge and per-number actions (set primary, health, fix inbound, register, open in Meta, disconnect, remove).
- **Actors & access:** Route `GET /devices` is authenticated; every mutating WABA action is `EnsureWorkspaceRole:admin`. No plan feature key gates viewing; adding a number is capped by the unified `device_limit`. The section only renders when the workspace's WABA engine is active or when a connected WABA row exists (connected providers are always merged into the enabled-engine list so a connected number is never hidden).
- **UX & screens:** `resources/views/user/devices/_waba_section.blade.php` (single-engine page) and `resources/views/user/devices/_channel_rows.blade.php` (the multi-engine unified table; WADEV owns the table, WABA rows use the same badge partial). Section blocks:
  - Billing choice card (only if at least one WABA row exists): "How do you want to be billed for messages?" with two form-cards posting `mode=meta_direct` or `mode=reseller` to `user.devices.billing-mode`. The reseller card is disabled with a "Not available yet" pill when the platform credit line is not configured (owned by BSP, TW-BSP-017).
  - Empty state (no rows): single-engine shows a large card "Connect your first WABA number" with a button whose label and target depend on `embeddedSignupReady`: "Continue with Facebook" (opens the embedded modal) or "Add WABA account" (opens the manual modal), plus a "or paste credentials manually" link when embedded is ready. Multi-engine shows only a slim dashed line telling the user to click "Add device" and choose Meta (WABA).
  - Populated state: header "Workspace - WABA accounts" with a count and an Add WABA account button; a two-column card grid; footer text "N WABA account(s) connected" and "Primary number is used as the default sender".
  - Card: primary ribbon, WhatsApp glyph, verified name (fallback display label, then phone, then "Unnamed WABA"), phone (or "+- unknown"), optional "Coexistence" badge, definition list (WABA ID, Phone ID, Quality pill GREEN green/YELLOW amber/RED coral/none "Unrated", Tier as the number after `TIER_` plus "/ day", em dash if unknown), connection dot (Connected green, Disconnected coral) with connected-at relative time, and the inbound badge (only when connected).
  - Action buttons on the card: "Set primary" (only when not primary and connected), "Health" (link to TW-WABA-021 page), "Fix inbound" (only when connected; confirm text about incoming messages not arriving), "Register" (all states, but hidden for coexistence numbers; prompts for an optional two-step PIN), "Meta" (external link to `business.facebook.com/wa/manage/phone-numbers/?waba_id=...` when a WABA id exists), "Disconnect" (only when connected; confirm), "Remove" (always; confirm).
  - Multi-engine unified table row: masked phone (via `mask_phone`), a Connected chip or, when Meta reports `platform_type=ON_PREMISE`, a coral "Not on Cloud API" chip with explanatory copy (retired 23 Oct 2025; verify and register on Cloud API in WhatsApp Manager); inbound badge; icon actions Health, Fix inbound, Manage/reconnect (reopens the connect modal), Disconnect, Remove. The Register action is commented out in the table version (QUIRK: it is hidden there because Meta answers `(#100) Register endpoint is not available for SMB businesses`).
  - Inbound badge partial `_inbound_badge.blade.php`: true = green "Inbound wired" (tooltip: Meta delivers this number's incoming messages here); false = coral "Inbound not wired" (tooltip: click Fix inbound); null = grey "Inbound: check".
- **Endpoints:**
  | Method + URI                                                                                                            | Route name           | Action                    | Middleware   | Request                                                                | Response                       |
  | ----------------------------------------------------------------------------------------------------------------------- | -------------------- | ------------------------- | ------------ | ---------------------------------------------------------------------- | ------------------------------ |
  | `GET devices`                                                                                                           | `user.devices.index` | `DevicesController@index` | Authenticate | filters `status`, `region`, `q`, `page`; JSON partial when `partial=1` | full view or `{cards, counts}` |
  | (actions listed under their own features; `GET devices` is claimed by TW-WADEV, listed here for the WABA payload only.) |
- **Data:** Reads `wa_provider_configs` where `provider='waba'`, ordered primary first (`is_primary` desc, `connected_at` desc, `id` desc; all statuses, not only connected). Reads `meta_json` keys `verified_name`, `waba_id`, `phone_number_id`, `business_id`, `quality_rating`, `messaging_limit_tier`, `coexistence`, `inbound_wired`, `platform_type`. Also builds `wabaInbound` (id to inbound_wired) and `wabaPlatform` (id to upper-case platform_type) maps for the unified table, `embeddedSignupReady` (Config ID and App ID both non-empty) and the `deviceLimit` footer value (`effectiveLimit('device_limit')`).
- **Rules & edge cases:**
  1. Cached fields (quality, tier, verified name) are only as fresh as the last health or connect call; they are refreshed by opening the health page (TW-WABA-021) and by connect. There is no scheduled refresh.
  2. A row can read Connected while Meta has the number on the retired On-Premises API; the unified table trusts `platform_type` over row state and shows "Not on Cloud API". The single-engine card does not (QUIRK: inconsistent).
  3. Disconnected rows remain in the list (credentials wiped) until Remove.
  4. Unified device cap counts Baileys devices plus WABA plus Twilio rows (TW-WABA-006).
  5. Phone shown via `mask_phone` in the table, unmasked on the card.
- **Async & events:** none on render; actions post to their own endpoints and redirect back with flash `status` / `warning` / validation errors under the `waba` key.
- **External systems:** none on render.
- **Settings:** `waba_config_id`, `waba_app_id` (Add button mode); `allowed_send_methods` (whether the engine is enabled); plan `device_limit`.
- **Acceptance criteria:**
  - Given a workspace with two WABA rows, one primary, When it opens /devices, Then the primary card appears first with a Primary ribbon and the other offers "Set primary".
  - Given a row with `platform_type=ON_PREMISE` in a multi-engine workspace, When the table renders, Then it shows "Not on Cloud API" instead of Connected.
  - Given a coexistence row, When the card renders, Then it shows the Coexistence badge and no Register button.
  - Given no WABA rows and embedded signup configured, When the single-engine page renders, Then the empty-state button says "Continue with Facebook".
  - Given a disconnected row, When the card renders, Then Disconnect and Set primary and the inbound badge are hidden and Remove remains.
- **Source refs:** `resources/views/user/devices/_waba_section.blade.php`, `resources/views/user/devices/_inbound_badge.blade.php`, `resources/views/user/devices/_channel_rows.blade.php`, `app/Http/Controllers/DevicesController.php` (`index`), `app/Models/WaProviderConfig.php`, `Documentation/pages/getting-started/connect-channel.html`, `Documentation/pages/channels/whatsapp.html`.
- **Port notes:** Target home `apps/web` Channels page + `GET /channels` in the identity/channels module (a `channels` table is planned but not built). Return quality, tier, coexistence and inboundWired as first-class columns rather than an untyped JSON blob so the list does not need JSON parsing. Cursor-paginate not needed (few rows per tenant).

### TW-WABA-005 — Connect modals and Meta JS SDK launcher (client side)

- **Status:** implemented
- **Priority:** P0
- **Effort:** M
- **Depends on:** TW-WABA-001, TW-WABA-004
- **Summary:** The two modals opened by every "Add WABA account" / "Manage / reconnect" button: a manual credential form and a Meta Embedded Signup launcher ("Continue with Facebook", optionally "Connect my existing Business App number"), driven by client JS that captures Meta's login code and its postMessage session data and then submits a hidden form to the server.
- **Actors & access:** Workspace admin (`EnsureWorkspaceRole:admin` on the POST targets). Coexistence button shown only when `waba_coexistence` is on.
- **UX & screens:** `resources/views/user/devices/_waba_modals.blade.php` + `resources/js/charts/user-devices-index.js` (`wireWabaConnectModals`).
  - Manual modal `#waba-manual-modal` ("Add WABA - manual"): info box linking to Meta Business Suite > WhatsApp Manager > API Setup and stating the token must include `whatsapp_business_messaging` and `whatsapp_business_management`. Fields: Phone Number ID (required, maxlength 40), WABA ID (required, 40), Business Manager ID (optional, 40, "auto-resolved if left blank"), Access Token (password, required, HTML maxlength 500, autocomplete new-password; hint: use a permanent System User token, 24h tokens stop tomorrow), Display label (optional, 120). A live-result box shows the pre-save token check. Footer: "Verify token" button (posts JSON to `/devices/waba/verify-token`, disables itself, shows "Checking..."), "Cancel", "Probe + connect" (submits the form to `/devices/waba/connect/manual`). Results render as rows with a green tick or coral cross and a title plus detail; the header line says either "Token looks good - safe to connect." or "Problems found - fix these before connecting.". Empty token shows "Paste an access token first".
  - Embedded modal `#waba-embedded-modal` (only rendered when `embeddedSignupReady`): explains Meta hands back a token that only lets the platform send messages; primary blue button "Continue with Facebook (new number)" (`#waba-launch-embedded-signup`); if `waba_coexistence` is on, an "or" divider and outlined button "Connect my existing Business App number" (`#waba-launch-embedded-coex`) plus a note (scan the QR Meta shows in its popup from the Business App; about 5 msg/sec cap, no blue tick, companion/linked devices get unlinked while connected); a "Switch to manual mode" link. A hidden form `#waba-embedded-form` posts `code`, `waba_id`, `phone_number_id`, `business_id`, `coexistence` (0/1) to `/devices/waba/connect/embedded`.
  - Both modals close on the X, Cancel or Escape. `[data-waba-connect="manual|embedded"]` opens the matching modal (embedded requested but not ready falls back to nothing).
  - JS launch logic: the Meta SDK (`connect.facebook.net/en_US/sdk.js`) is loaded with the modal and `FB.init({appId, cookie:true, xfbml:true, version: data-graph-version})` runs eagerly on page load (silent) so `FB.login()` executes synchronously inside the click on mobile; a poll of 25 x 200 ms waits for `window.FB`. `FB.login` options: `config_id`, `response_type=code`, `override_default_response_type=true`, `extras={setup:{}, sessionInfoVersion:'3'}` and, for coexistence, `featureType:'whatsapp_business_app_onboarding'`.
  - Two channels are buffered in a `pending` object and submitted once both are present: the login callback's `authResponse.code`, and `window.postMessage` events of type `WA_EMBEDDED_SIGNUP` from any origin ending in `facebook.com`. Handled events: `FINISH` and `FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING` (capture waba_id, phone_number_id, business_id; the second or `is_wa_login_user` true sets coexistence mode), `FINISH_ONLY_WABA` (capture waba_id and business_id; in coexistence mode submits with the WABA alone, in standard mode alerts that no phone number was selected and points to Manual), `CANCEL` (console warning), `ERROR` (alert with Meta's message). Standard mode submits only when `phone_number_id` is also present; coexistence submits on `waba_id` alone. A `submitted` guard prevents double POST. If the code arrived but nothing was submitted after 15 s an alert says Meta did not return a WABA/number (message differs for coexistence).
  - If App ID or Config ID is missing at click time an alert says Embedded Signup is not configured and to ask the platform admin.
- **Endpoints:** (client posts to the endpoints of TW-WABA-006/007/009/010.)
- **Data:** Reads data attributes `data-app-id` (`waba_app_id`), `data-config-id` (`waba_config_id`), `data-graph-version` (`waba_graph_api_version`) from settings; posts form fields only.
- **Rules & edge cases:**
  1. The App Secret never reaches the browser; only App ID and Config ID do.
  2. The Meta SDK URL and the `facebook.com` origin suffix check are hard-coded.
  3. `sessionInfoVersion` must be `'3'` or Meta returns the legacy payload without `waba_id`.
  4. Embedded modal absent when not ready; the "Switch to manual mode" and the empty-state link then rely on the manual modal only.
  5. The pre-save Verify button needs a token but not IDs; the WABA/phone id inputs are optional for the check and add the WABA/template readability checks when filled.
- **Async & events:** postMessage from Meta's popup; `FB.login` callback; form submits with page reload (no AJAX for the connect itself).
- **External systems:** Facebook JS SDK and the Meta Embedded Signup popup (Facebook Login for Business with Config ID).
- **Settings:** `waba_app_id`, `waba_config_id`, `waba_graph_api_version`, `waba_coexistence`.
- **Acceptance criteria:**
  - Given embedded signup is configured, When the user clicks "Continue with Facebook (new number)" and completes the Meta popup returning code + waba_id + phone_number_id, Then exactly one POST to `/devices/waba/connect/embedded` is made with `coexistence=0`.
  - Given coexistence mode and Meta returns only a waba_id, When the FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING event and code are both received, Then the form submits with `coexistence=1` and an empty phone_number_id.
  - Given standard mode and only `FINISH_ONLY_WABA` arrives, Then the user sees an alert to pick a number or use Manual and nothing is posted.
  - Given a code but no session message within 15 s, Then an alert explains Meta did not return a number/WABA.
  - Given an empty access token, When "Verify token" is clicked, Then the result box says to paste a token first and no request is sent.
- **Source refs:** `resources/views/user/devices/_waba_modals.blade.php`, `resources/js/charts/user-devices-index.js`, `app/Http/Controllers/DevicesController.php` (`index` passes `embeddedSignupReady`).
- **Port notes:** Rebuild as a Next.js dialog component using the Facebook JS SDK; post the code and IDs to a single JSON API instead of a form submit so errors render inline. Keep the popup launch synchronous in the click handler and the eager SDK init (mobile popup blocking). Do not send the App Secret to the client.

### TW-WABA-006 — Manual connect (paste WABA credentials)

- **Status:** implemented
- **Priority:** P0
- **Effort:** L
- **Depends on:** TW-WABA-005, TW-WABA-011, TW-WABA-012, TW-WABA-013, TW-PLAN (device_limit)
- **Summary:** A workspace admin pastes Phone Number ID, WABA ID and a System User access token (optionally Business ID, App ID/Secret, label). The platform validates the token by probing the phone number, refuses numbers still on the retired On-Premises API, resolves the Business ID, subscribes the WABA to webhooks with a callback override to this platform, saves or updates the row, registers the number on the Cloud API when eligible, verifies inbound wiring and tells the user whether inbound is live.
- **Actors & access:** Workspace admin (`EnsureWorkspaceRole:admin`). Plan gate: unified `device_limit` (Baileys devices + WABA + Twilio rows); admins with Spatie Super Admin/Admin role bypass. Workspace scope (current workspace of the user).
- **UX & screens:** Manual modal of TW-WABA-005. Outcome is a redirect to `/devices` with either a green status flash, an amber `warning` flash, or validation errors shown under the modal fields (`access_token`, `phone_number_id`, `workspace`).
- **Endpoints:**
  | Method + URI                       | Route name                         | Action                                | Middleware                              | Request                                                                                                                                                                                                                                       | Response                                                         |
  | ---------------------------------- | ---------------------------------- | ------------------------------------- | --------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
  | `POST devices/waba/connect/manual` | `user.devices.waba.connect.manual` | `DevicesController@wabaConnectManual` | Authenticate, EnsureWorkspaceRole:admin | `phone_number_id` required string max 40; `waba_id` required string max 40; `business_id` nullable max 40; `access_token` required string max 1024; `display_label` nullable max 120; `app_id` nullable max 64; `app_secret` nullable max 128 | redirect `user.devices.index` with `status`, `warning` or errors |
- **Data:** Upserts `wa_provider_configs` (see Data model): `workspace_id`, `provider='waba'`, `status='connected'`, `phone_number` (Meta display_phone_number), `display_label` (input label, else Meta verified_name), `connected_at=now`, `last_health_at=now`, `is_primary` (true only for a new row when the workspace had zero WABA rows), `meta_json` = `waba_id`, `phone_number_id`, `business_id`, `verified_name`, `display_phone_number`, `quality_rating`, `messaging_limit_tier`, `code_verification_status`, `name_status`, `account_mode`, `throughput`, `platform_type`, `is_official_business_account`, `is_pin_enabled`, `last_onboarded_time`, `connected_via='manual'`; encrypted `credentials_json` = `access_token` plus `app_id`/`app_secret` when supplied (nulls filtered out). Audit `devices.waba_connect_manual` with phone, waba_id, `inbound_wired`.
- **Rules & edge cases:**
  1. Requires a current workspace, else a validation error "No active workspace. Pick one and try again."
  2. `PlanLimitGuard::check(workspace, 'device_limit', unifiedCount)` runs first, before any Meta call, and counts a reconnect of the same number too (QUIRK: the WABA reconnect of an existing pair is counted against the cap in the web path, whereas the mobile endpoint skips the cap for a reconnect of the same waba_id + phone_number_id). Throws `PlanLimitReachedException` rendered as back-with-error.
  3. Auto-extend: uses the typed App ID/Secret, else the platform's (`waba_app_id`/`waba_app_secret`); when both non-empty, exchanges the pasted token with `grant_type=fb_exchange_token` (15 s). On success the long-lived token replaces the pasted one for probe and save; any failure silently keeps the pasted token. The secret is never stored unless the user typed it.
  4. Probe `GET /{phone_number_id}` with fields `verified_name, display_phone_number, quality_rating, messaging_limit_tier, code_verification_status, name_status, account_mode, throughput, platform_type, is_official_business_account, is_pin_enabled, last_onboarded_time` (15 s). Non-2xx returns an `access_token` field error from the error-translation table (TW-WABA-051); network failure returns "Could not reach Meta: ...". Values are preserved via `withInput`.
  5. `platform_type = ON_PREMISE` is refused with a long `phone_number_id` error: On-Premises API shut down 23 Oct 2025; verify then register on Cloud API in WhatsApp Manager, then connect again; an extra sentence is appended when `code_verification_status` is NOT_VERIFIED. COEXISTENCE and SMB_APP types are accepted.
  6. Business ID: if not supplied, `GET /{waba_id}?fields=owner_business_info{id,name}` (10 s, best effort).
  7. Subscribe with override (TW-WABA-011). Subcode 1349174 (missing `whatsapp_business_management`) aborts with an `access_token` error telling the user to regenerate the System User token with that scope. Any other failure only sets `webhookWired=false` (logged).
  8. Row identity: existing WABA row for the workspace with the same `waba_id` AND `phone_number_id` is updated in place (matched in PHP over `meta_json`), otherwise a new row; existing `is_primary` preserved on update.
  9. After save the number is registered on the Cloud API best-effort (TW-WABA-012; coexistence numbers skipped), then inbound wiring is verified and stamped (TW-WABA-013).
  10. Result copy: if wired is exactly false an amber `warning` explains the number is on the user's own Meta app, gives the callback URL and verify token and tells them to set them in the app's WhatsApp > Configuration then click Fix inbound; otherwise the success flash says two-way messaging is live. Note the flash always says "Connected WABA number" even when register or subscribe partially failed.
  11. `meta_json` matching comments in code say "even when stored encrypted" but the cast is plain JSON (QUIRK; no real encryption of meta_json).
  12. No workspace-level uniqueness on (waba_id, phone_number_id) in the schema; two workspaces can connect the same number (see Open questions).
- **Async & events:** Synchronous, seven or more Graph calls in one request (exchange, probe, owner lookup, subscribe + up to 3 x 1 s retries, register, subscribed_apps read). Auto-attach of the reseller credit line fires from the `WaProviderConfig` saved hook (TW-BSP-008). Audit log. No queue.
- **External systems:** Meta Graph (`/oauth/access_token`, `/{pnid}`, `/{waba}`, `/{waba}/subscribed_apps`, `/{pnid}/register`). Token auth is the user's System User token as bearer. Timeouts 10-15 s. Failures are surfaced, not retried, except subscribe.
- **Settings:** `waba_graph_api_version`, `waba_app_id`, `waba_app_secret`, `waba_webhook_verify_token`, plan `device_limit`.
- **Acceptance criteria:**
  - Given valid credentials for a Cloud API number, When the admin submits, Then a `connected` row exists with the probed quality, tier and platform, the first WABA in the workspace is primary, and the flash says two-way messaging is live.
  - Given credentials for a number with `platform_type=ON_PREMISE`, When submitted, Then no row is created and the error tells the user to migrate the number in WhatsApp Manager.
  - Given the same waba_id and phone_number_id already connected in the workspace, When submitted again, Then the existing row is updated (not duplicated) and keeps its primary flag.
  - Given a token missing `whatsapp_business_management`, When subscribe returns subcode 1349174, Then the form shows a regenerate-token error and nothing is saved.
  - Given the workspace already reached `device_limit`, When submitted, Then the request is rejected before any call to Meta.
  - Given the subscribe override is refused with (#100), When the plain subscribe succeeds but the callback cannot be confirmed, Then the number is saved, sending works, and the user gets the amber own-app webhook instructions.
- **Source refs:** `app/Http/Controllers/DevicesController.php` (`wabaConnectManual`, `wabaErrorMessage`, `unifiedDeviceCount`), `app/Models/WaProviderConfig.php`, `app/Services/PlanLimitGuard.php`, `resources/views/user/devices/_waba_modals.blade.php`, `Documentation/pages/channels/whatsapp.html`.
- **Port notes:** New `whatsapp_connections` (or `channels`) tenant table with `org_id`, RLS forced, unique (org_id, phone_number_id) globally unique per Meta number (Reference lacks this). Store the access token and app secret encrypted with `CryptoService`; store waba_id, phone_number_id, business_id, quality, tier, platform_type as typed columns. Implement as an API command that enqueues a BullMQ `channel-connect` job for the Graph calls and returns a connection id + status polling, or a bounded synchronous call; do not hold a DB transaction across Graph calls. Emit outbox event `whatsapp.connection.connected` (consumed by TW-BSP-008 auto-attach). Enforce `device_limit` through the plans module.

### TW-WABA-007 — Pre-save token self-check

- **Status:** implemented
- **Priority:** P1
- **Effort:** S
- **Depends on:** TW-WABA-005
- **Summary:** Before connecting, the admin can test a pasted token live: validity and expiry, presence of the two required scopes, whether the WABA is readable and whether its templates are readable, each as a ticked or crossed line with a fix hint.
- **Actors & access:** Workspace admin (`EnsureWorkspaceRole:admin`).
- **UX & screens:** "Verify token" button in the manual modal (see TW-WABA-005); results box with rows.
- **Endpoints:**
  | Method + URI                     | Route name                       | Action                              | Middleware                              | Request                                                                                                                  | Response                                         |
  | -------------------------------- | -------------------------------- | ----------------------------------- | --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------ |
  | `POST devices/waba/verify-token` | `user.devices.waba.verify-token` | `DevicesController@wabaVerifyToken` | Authenticate, EnsureWorkspaceRole:admin | `access_token` required string max 1024; `waba_id` nullable max 64; `phone_number_id` nullable max 64 (accepted, unused) | JSON `{ok: bool, checks: [{ok, title, detail}]}` |
- **Data:** none stored.
- **Rules & edge cases:**
  1. Check 1 "Token is valid" calls `GET debug_token?input_token=<token>` authenticated with the token itself (15 s) and reports expiry as "never (permanent System User token)" when `expires_at` is 0, else a formatted local date-time; invalid shows Meta's error message. (QUIRK: Meta's `debug_token` normally needs an app access token; the health service uses `{app_id}|{secret}` for that reason, this endpoint does not, so it can report invalid for a valid token. See Open questions.)
  2. Check 2 requires both scopes `whatsapp_business_messaging` and `whatsapp_business_management`; lists the missing ones and tells the user to regenerate the System User token.
  3. Checks 3 and 4 only run when `waba_id` is given: read the WABA (`fields=name,currency,timezone_id`) then `message_templates?limit=1`. Meta error 10 on the WABA read means the app is not a Tech/Solution Provider for that WABA or it was un-shared; error 3 on templates means the app lacks the `whatsapp_business_management` capability (Advanced Access, needs App Review).
  4. Any exception yields a single failed line "Could not reach Meta" / "Could not read the WABA" with the message.
  5. `ok` is true only when every check passed and at least one check exists.
- **Async & events:** none.
- **External systems:** Meta Graph `debug_token`, `/{waba_id}`, `/{waba_id}/message_templates`.
- **Settings:** `waba_graph_api_version`.
- **Acceptance criteria:**
  - Given a token with both scopes and a readable WABA, When verified, Then all four lines are green and `ok` is true.
  - Given a token missing `whatsapp_business_management`, When verified, Then the second check fails and names the missing scope.
  - Given Meta error 10 on the WABA read, When verified with a waba_id, Then the third line explains the WABA is un-shared or the app is not a provider for it.
  - Given no waba_id, When verified, Then only the two token checks run.
- **Source refs:** `app/Http/Controllers/DevicesController.php` (`wabaVerifyToken`), `resources/js/charts/user-devices-index.js`.
- **Port notes:** `POST /channels/whatsapp/verify-token` returning the same structure; rate-limit per user (each call makes up to 4 Graph calls). Use an app access token for `debug_token` in the target.

### TW-WABA-008 — Short-lived to long-lived token exchange endpoint

- **Status:** partial
- **Priority:** P2
- **Effort:** S
- **Depends on:** TW-WABA-001
- **Summary:** A JSON endpoint that turns a short-lived token into a ~60-day token given the Meta app id and secret. It exists and works but no page calls it (the manual connect and the renew button perform the same exchange server-side).
- **Actors & access:** Workspace admin (`EnsureWorkspaceRole:admin`).
- **UX & screens:** None found in views or JS (dead endpoint).
- **Endpoints:**
  | Method + URI                       | Route name                         | Action                                | Middleware                              | Request                                                                                   | Response                                                                                    |
  | ---------------------------------- | ---------------------------------- | ------------------------------------- | --------------------------------------- | ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
  | `POST devices/waba/exchange-token` | `user.devices.waba.exchange-token` | `DevicesController@wabaExchangeToken` | Authenticate, EnsureWorkspaceRole:admin | `access_token` required max 1024; `app_id` required max 64; `app_secret` required max 128 | `{ok:true, token, days (rounded expiry days or null), never (bool)}` or `{ok:false, error}` |
- **Data:** none stored; the secret is used once and never logged.
- **Rules & edge cases:**
  1. `GET /oauth/access_token?grant_type=fb_exchange_token&client_id&client_secret&fb_exchange_token` (15 s).
  2. `expires_in` 0 means never expires, returned as `never=true`; otherwise days = round(seconds/86400).
  3. Errors return HTTP 200 with `ok:false` and Meta's message, "Meta returned no token." or "Could not reach Meta: ...".
  4. The exchanged token keeps the original scopes; it does not add `whatsapp_business_management`.
  5. Auth is the login session and the workspace admin role only; note the caller supplies the app secret in the request body.
- **Async & events:** none.
- **External systems:** Meta Graph `/oauth/access_token`.
- **Settings:** `waba_graph_api_version`.
- **Acceptance criteria:**
  - Given a valid short-lived token and matching app credentials, When called, Then it returns a token and a days value.
  - Given wrong app credentials, When called, Then it returns `ok:false` with Meta's error message and HTTP 200.
- **Source refs:** `app/Http/Controllers/DevicesController.php` (`wabaExchangeToken`).
- **Port notes:** Optional; do not port unless a UI needs it. If ported, return proper 4xx codes rather than HTTP 200 with `ok:false`.

### TW-WABA-009 — Embedded Signup connect (new number)

- **Status:** implemented
- **Priority:** P0
- **Effort:** L
- **Depends on:** TW-WABA-001, TW-WABA-005, TW-WABA-011, TW-WABA-012, TW-WABA-013
- **Summary:** After the user completes Meta's Embedded Signup popup, the server exchanges the one-time code for a business token, lists or accepts the granted WABA and phone number, probes it, subscribes the platform app with a callback override, saves the number as connected (first one becomes primary), registers it on the Cloud API and verifies inbound wiring. The customer never types a webhook or token.
- **Actors & access:** Workspace admin (`EnsureWorkspaceRole:admin`); same unified `device_limit` gate. Requires platform App ID + Secret (TW-WABA-001).
- **UX & screens:** Embedded modal (TW-WABA-005); after redirect the `/devices` page shows a flash `Connected WABA number "<phone or label>".` Errors appear under the `embedded` key: not configured, token exchange failed, no WABA, no phone number yet, app missing permission.
- **Endpoints:**
  | Method + URI                         | Route name                           | Action                                  | Middleware                              | Request                                                                                                                                                     | Response                                              |
  | ------------------------------------ | ------------------------------------ | --------------------------------------- | --------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------- |
  | `POST devices/waba/connect/embedded` | `user.devices.waba.connect.embedded` | `DevicesController@wabaConnectEmbedded` | Authenticate, EnsureWorkspaceRole:admin | `code` required string max 500; `waba_id` nullable max 40; `phone_number_id` nullable max 40; `business_id` nullable max 40; `coexistence` nullable boolean | redirect `user.devices.index` with `status` or errors |
- **Data:** Same row shape as TW-WABA-006 with `connected_via='embedded'`, `meta_json.token_expires_at` (ISO date from `expires_in`, null if 0), `business_id` from the popup, `meta_json.coexistence` true or null, and `credentials_json` = only `access_token` (no app secret, no register PIN unless registrar adds it). `display_label` is Meta's verified name (no user label). Audit `devices.waba_connect_embedded`.
- **Rules & edge cases:**
  1. Order of checks: workspace present, plan cap, App ID/Secret configured (else `embedded` error telling the user to ask the platform admin to fill them at the channel-setting page), then Meta calls.
  2. Token exchange: `GET /oauth/access_token` with only `client_id`, `client_secret`, `code` (15 s). It must NOT send a redirect_uri (popup codes are in-window; sending one makes Meta apply classic OAuth validation and fail with 100/191). Returns a business token valid about 60 days (no second exchange hop on v23.0+). Failure shows "Meta token exchange failed: " plus the translated error; exception shows "Token exchange threw".
  3. `waba_id` is mandatory: missing yields "Meta did not return a WhatsApp Business Account. Try again, or use Add WABA > Manual."
  4. Missing `phone_number_id`: see TW-WABA-010 resolution via the WABA's `phone_numbers` edge; still missing yields the error that no phone number is registered on the WABA yet and coexistence registration can take a minute.
  5. Probe the phone with the same 12-field set as manual connect (failures ignored, info left empty so the row saves with blank phone/label).
  6. Subscribe + override (TW-WABA-011). Subcode 1349174 aborts with the "your Meta app is missing whatsapp_business_management, submit for App Review" error; other failures are logged only (row still saved).
  7. Upsert by (waba_id, phone_number_id) like manual; new row primary only when workspace had no WABA rows; re-onboarding keeps the existing primary flag. `last_health_at=now`.
  8. Register (auto, coexistence skipped) then verify + stamp inbound wired. No ON_PREMISE refusal in this path (QUIRK: only the manual and mobile paths block On-Premises numbers).
  9. Business ID is taken as given from the popup; it is not auto-resolved.
  10. Verbose `[COEX-EMBED]` log lines are emitted at every stage (start, token, resolution, connected).
- **Async & events:** Synchronous; Graph calls: exchange, optional phone_numbers, probe, subscribe (+ retries), register, subscribed_apps read. Credit-line auto-attach hook (TW-BSP-008). Audit log.
- **External systems:** Meta Embedded Signup (Facebook Login for Business), Graph API as above; auth is the exchanged business token.
- **Settings:** `waba_app_id`, `waba_app_secret`, `waba_config_id`, `waba_graph_api_version`, `waba_webhook_verify_token`, plan `device_limit`.
- **Acceptance criteria:**
  - Given a valid code with waba_id and phone_number_id, When the form posts, Then a connected primary row exists, `connected_via='embedded'`, the token is stored encrypted and the flash names the number.
  - Given App ID or Secret is not configured, When the form posts, Then the user sees the not-configured error and no Meta call is made.
  - Given Meta rejects the code, When posting, Then the user sees "Meta token exchange failed" with the translated reason.
  - Given the same number is onboarded twice, When posting the second time, Then the row is updated, not duplicated.
  - Given subscribe returns subcode 1349174, Then no row is written and the App Review error is shown.
- **Source refs:** `app/Http/Controllers/DevicesController.php` (`wabaConnectEmbedded`), `resources/views/user/devices/_waba_modals.blade.php`, `resources/js/charts/user-devices-index.js`, `Documentation/pages/channels/whatsapp.html`.
- **Port notes:** Persist `token_expires_at` as a column and add a token-expiry job (Reference stores it but nothing reads it). Store no App Secret per connection for the platform-app path; keep per-connection secret only for own-app manual connects. Queue the post-connect steps (register, subscribe verification) so the HTTP response returns after the row is saved and status polls show progress.

### TW-WABA-010 — Coexistence onboarding (Business App number)

- **Status:** implemented
- **Priority:** P1
- **Effort:** M
- **Depends on:** TW-WABA-002, TW-WABA-009
- **Summary:** A workspace links a number that is already live on the WhatsApp Business app: the owner scans a QR in Meta's popup and keeps using the app while the platform gets Cloud API automation on the same number. The server skips Cloud API registration (which would migrate the number off the app) and flags the row `coexistence`, which changes how registration, the Register button, echoes, contact sync and history behave.
- **Actors & access:** Workspace admin; the button is only shown when `waba_coexistence` is on; number eligibility is enforced by Meta.
- **UX & screens:** Second button in the embedded modal (TW-WABA-005). Cards show a "Coexistence" badge. Eligibility copy: docs say the number must currently be active on the Business App and not already on the Cloud API.
- **Endpoints:** shared with TW-WABA-009 (`POST devices/waba/connect/embedded` with `coexistence=1`) and the legacy TW-WABA-057 (`coexistence` boolean).
- **Data:** `wa_provider_configs.meta_json.coexistence=true` set when the request flag is true OR Meta's probed `platform_type` is `COEXISTENCE` or `SMB_APP`; otherwise the key is null. `platform_type` is stored too.
- **Rules & edge cases:**
  1. Coexistence numbers register with the Cloud API asynchronously, so the popup usually returns only `waba_id`. The server then reads `GET /{waba_id}/phone_numbers?fields=id,display_phone_number,platform_type,verified_name` (15 s) and picks the first row whose `platform_type` is `COEXISTENCE` or `SMB_APP`, else the first row. If a number is picked without a supplied phone id and its type is a coexistence type the request is treated as coexistence.
  2. If no phone number exists yet the user gets "Signed in, but no phone number is registered on this WhatsApp Business Account yet. Coexistence registration can take a minute - wait and retry, finish the number step in Meta Business Suite, or use Add WABA > Manual to paste the Phone Number ID."
  3. `WabaNumberRegistrar::register` is always called but skips coexistence rows unless the caller passes `allowCoexistence`; only the explicit Register button does (with a confirm), because registering would remove the number from the Business App.
  4. Coexistence numbers may be `is_primary` like any other; they still need `subscribed_apps` (done by the connect flow) to receive echoes, contact sync and history (TW-WABA-044 to TW-WABA-046).
  5. Meta limits (docs/UI): Business App v2.24.17+, open the app at least every 14 days, history import is 1:1 chats of the last 6 months (no groups), about 5 msg/sec, no blue tick, linked companion devices are unlinked while connected. Availability varies by region.
  6. The Register button is hidden for coexistence rows on the card because Meta rejects `/register` for SMB numbers with (#100) "not available for SMB businesses".
- **Async & events:** As TW-WABA-009. Meta pushes `history`, `smb_app_state_sync`, `smb_message_echoes` webhooks after onboarding.
- **External systems:** Meta Embedded Signup with `featureType=whatsapp_business_app_onboarding`, Graph phone_numbers edge.
- **Settings:** `waba_coexistence`; the Meta app must be approved for WhatsApp Business app onboarding and subscribe the coexistence fields (TW-WABA-002/003).
- **Acceptance criteria:**
  - Given coexistence is enabled and the popup returns only a waba_id, When the form posts with coexistence=1, Then the server resolves the SMB/COEXISTENCE number from the WABA and saves a row with `coexistence=true` and no register call.
  - Given the WABA has no phone number yet, When posting, Then the user gets the "can take a minute" error and no row is saved.
  - Given a coexistence row, When the card renders, Then the Coexistence badge shows and Register is hidden.
  - Given a standard embedded connect whose probed platform is COEXISTENCE, Then the row is still flagged coexistence.
- **Source refs:** `app/Http/Controllers/DevicesController.php` (`wabaConnectEmbedded`), `app/Services/Waba/WabaNumberRegistrar.php`, `resources/views/user/devices/_waba_section.blade.php`, `Documentation/pages/getting-started/coexistence.html`.
- **Port notes:** Model `coexistence boolean` as a column. Gate registration on it in the connect job. Keep the phone-number-resolution retry (poll with backoff for a few minutes via a delayed BullMQ job) instead of failing the user immediately.

### TW-WABA-011 — Subscribe the app to a WABA with callback override

- **Status:** implemented
- **Priority:** P0
- **Effort:** M
- **Depends on:** TW-WABA-001
- **Summary:** The shared routine that makes Meta deliver a WABA's webhooks to this platform: it subscribes the app and, in the same call, overrides the WABA's callback URL with this platform's `/webhooks/whatsapp/inbound` and the verify token. It survives Meta's eventual-consistency race and degrades to a plain subscribe when the token's app is not allowed to override.
- **Actors & access:** Internal to the connect, re-subscribe and history-sync actions (workspace admin).
- **UX & screens:** No screen; outcomes appear in flashes of the calling features.
- **Endpoints:** none (private method `DevicesController::subscribeAndOverrideWaba`).
- **Data:** none; result `{ok, override_applied, error}`.
- **Rules & edge cases:**
  1. Step 1, atomic: `POST /{waba_id}/subscribed_apps` with `override_callback_uri={APP_URL}/webhooks/whatsapp/inbound` and `verify_token` (15 s). Success returns ok with override applied. Meta verifies the callback synchronously through the GET handshake (TW-WABA-029), so success proves the override is live.
  2. If that fails with error subcode 1349174 (missing `whatsapp_business_management`) return a hard failure immediately.
  3. Otherwise fall back to a plain subscribe (empty body). If the plain subscribe fails with 1349174 hard-fail; other failures hard-fail with that error (or a synthesized "Plain subscribe failed (HTTP n)").
  4. If the plain subscribe succeeded, re-try the override up to 3 times with 1 s sleeps (works around Meta's (#100) "app must be subscribed before overriding" propagation race). Success on any retry returns override applied. Subcode 1349174 on a retry hard-fails.
  5. If the override is still refused after retries, return ok=true with `override_applied=false` (NON-FATAL): the app is subscribed, so inbound flows to the app's default callback URL only if that app's own webhook config points here. Callers then rely on the verify step (TW-WABA-013) and the own-app guidance.
  6. Idempotent on Meta's side; safe to call repeatedly.
  7. The historical bug this encodes: doing subscribe and override as two separate calls silently left inbound on the app's default callback.
- **Async & events:** Up to 5 sequential Graph calls and up to 3 s of sleep in the request thread.
- **External systems:** Meta Graph `POST /{waba_id}/subscribed_apps` (bearer = workspace token).
- **Settings:** `waba_webhook_verify_token` (auto-provisioned), `waba_graph_api_version`, APP_URL.
- **Acceptance criteria:**
  - Given a token owned by the platform app, When subscribed, Then the first atomic call succeeds and no fallback is performed.
  - Given Meta returns (#100) for the override but accepts a plain subscribe, When retried three times and all refused, Then the routine returns ok with `override_applied=false`.
  - Given the token lacks `whatsapp_business_management`, When called, Then it returns a failure carrying subcode 1349174 without further calls.
- **Source refs:** `app/Http/Controllers/DevicesController.php` (`subscribeAndOverrideWaba`, `wabaWebhookVerifyToken`), `Documentation/pages/channels/whatsapp.html` (troubleshooting).
- **Port notes:** Put in a `MetaCloudProvider.subscribeWaba()` method under `infra/providers/whatsapp/` and call it from a BullMQ job with retry/backoff instead of `sleep` in a request. The callback URL must be an environment-specific public URL of the tenant-agnostic webhook endpoint.

### TW-WABA-012 — Cloud API number registration (auto and manual with PIN)

- **Status:** implemented
- **Priority:** P0
- **Effort:** M
- **Depends on:** TW-WABA-006, TW-WABA-009
- **Summary:** Registers a connected phone number on the WhatsApp Cloud API so sends stop failing with (#133010) "Account not registered". Runs automatically and silently after manual and embedded connects, and on demand through the "Register" button where the operator may supply the number's two-step-verification PIN and may deliberately register a coexistence number.
- **Actors & access:** Auto path: system. Manual: workspace admin (`EnsureWorkspaceRole:admin`). Audit log entry only for the manual action.
- **UX & screens:** "Register" button on the WABA card (hidden for coexistence rows; absent from the unified table). Clicking opens a prompt "Register on Cloud API" with placeholder "Two-step PIN (optional)"; the digits go into a hidden `pin` field and the form posts. Success flash: `Registered "<label>" on the WhatsApp Cloud API - sending should work now. Send a test message to confirm.` Failure error under `waba`: `Could not register "<label>": <error>`.
- **Endpoints:**
  | Method + URI                      | Route name                   | Action                           | Middleware                              | Request                              | Response                                    |
  | --------------------------------- | ---------------------------- | -------------------------------- | --------------------------------------- | ------------------------------------ | ------------------------------------------- |
  | `POST devices/waba/{id}/register` | `user.devices.waba.register` | `DevicesController@wabaRegister` | Authenticate, EnsureWorkspaceRole:admin | optional `pin` (non-digits stripped) | redirect back with `status` or `waba` error |
- **Data:** On success persists `credentials_json.register_pin` (the PIN that worked) merged into the existing credentials. Reads `meta_json.coexistence`, `meta_json.phone_number_id` (fallback `credentials.phone_number_id`), `credentials.access_token`. Audit `devices.waba_register`.
- **Rules & edge cases:**
  1. Returns `{ok, error, skipped}`. No token or phone id: skipped with "no stored phone-number id / token - reconnect it once".
  2. A coexistence row is skipped ("kept live on the WhatsApp Business app") unless `allowCoexistence=true`, which only the manual button passes (the confirm dialog is the consent).
  3. PIN precedence: supplied PIN, else the stored `register_pin`, else a random 6-digit PIN (`str_pad(random_int(0,999999),6,'0')`). A number that already has two-step verification needs its existing PIN or Meta returns 133005.
  4. `POST /{phone_number_id}/register` with `messaging_product=whatsapp` and `pin` (15 s).
  5. Meta message containing "already" is treated as success.
  6. Hints appended to failures: 133005 "already has a two-step-verification PIN, enter that exact PIN"; 133006 "needs re-verification in Meta Business Suite first"; 133008/133009 "too many attempts, wait a few minutes"; 100 "managed by the WhatsApp Business app (coexistence), finish setup in Meta Business Suite; if sends still fail use Fix inbound or reconnect". The message form is `(#code) message hint`.
  7. Auto path ignores the result entirely (a failure never blocks connect).
  8. The legacy TW-WABA-057 endpoint generates a random PIN and stores it in credentials; the manual and embedded flows store it only after a successful register.
  9. The PIN is stored in plaintext inside the encrypted credentials blob and never shown in the UI.
- **Async & events:** Synchronous; one Graph call.
- **External systems:** Meta Graph `POST /{phone_number_id}/register`.
- **Settings:** `waba_graph_api_version`.
- **Acceptance criteria:**
  - Given a freshly connected non-coexistence number, When connect completes, Then `/register` was called with a 6-digit PIN and the PIN is stored.
  - Given a coexistence number, When connect completes, Then `/register` was NOT called.
  - Given a number with 2FA on, When the operator clicks Register and enters the correct PIN, Then registration succeeds and the PIN is stored for reuse.
  - Given Meta says the number is already registered, When Register is clicked, Then the UI reports success.
  - Given the operator enters a wrong PIN, When Meta answers 133005, Then the error mentions entering the exact PIN.
- **Source refs:** `app/Services/Waba/WabaNumberRegistrar.php`, `app/Http/Controllers/DevicesController.php` (`wabaRegister`), `resources/views/user/devices/_waba_section.blade.php`.
- **Port notes:** `MetaCloudProvider.registerNumber(phoneNumberId, pin)`; store the PIN encrypted; never log it. Do it as a BullMQ job after connect; expose a manual "register" action guarded by `channels.manage`.

### TW-WABA-013 — Inbound-wired verification, stamping and badge

- **Status:** implemented
- **Priority:** P0
- **Effort:** S
- **Depends on:** TW-WABA-011
- **Summary:** A per-number tri-state verdict (true, false, unknown) saying whether Meta actually delivers this number's incoming messages to the platform, computed after connect and re-subscribe from Meta's subscribed-apps list and upgraded to a definite true the first time a real inbound message arrives.
- **Actors & access:** System; visible to all workspace members who can see /devices.
- **UX & screens:** The inbound badge (see TW-WABA-004), the health page row "Inbound to this platform", and the own-app webhook setup panel (TW-WABA-015).
- **Endpoints:** none of its own (used by connect, resubscribe and the webhook receiver).
- **Data:** `wa_provider_configs.meta_json.inbound_wired` (true/false/null) and `inbound_checked_at` (ISO timestamp). Written by connect (TW-WABA-006/009), resubscribe (TW-WABA-014) and the webhook receiver (TW-WABA-031).
- **Rules & edge cases:**
  1. `verifyInboundWired`: needs stored waba_id and token, else null. `GET /{waba_id}/subscribed_apps` (15 s); returns true if any entry's `override_callback_uri` (trailing slash trimmed) equals this platform's inbound URL OR its `whatsapp_business_api_data.id` equals the platform's `waba_app_id`; otherwise null (inconclusive). It never returns false: a definite failure is only visible through the subscribe POST result.
  2. Connect: `wired = verified ?? webhookWired` where `webhookWired` is the subscribe POST outcome (manual path only); a definite `false` (only reachable through that fallback) triggers the amber own-app warning.
  3. Ground truth: in `WaWebhookController`, when a real inbound MESSAGE (not just a status) arrives for a number whose `inbound_wired` is not already true, it is stamped true with a timestamp (done in two places, per entry and per change batch; best effort, errors swallowed). Delivery statuses deliberately do not count because a client can subscribe to statuses without the `messages` field.
  4. The Graph read failing or throwing yields null with a warning log.
  5. Numbers on the customer's own Meta app can never be confirmed by the API (Graph never exposes the app's default callback), so they stay null until the first real inbound message.
- **Async & events:** none extra.
- **External systems:** Meta Graph `GET /{waba_id}/subscribed_apps`.
- **Settings:** `waba_app_id`.
- **Acceptance criteria:**
  - Given the WABA's override URI equals the platform inbound URL, When verified, Then `inbound_wired=true`.
  - Given Meta lists only an unrelated app, When verified, Then the value is null and the badge shows "Inbound: check".
  - Given `inbound_wired` is null, When a real inbound text message arrives, Then it becomes true and the badge flips to "Inbound wired" on next render.
  - Given only a delivery-status webhook arrives, Then `inbound_wired` is unchanged.
- **Source refs:** `app/Http/Controllers/DevicesController.php` (`verifyInboundWired`, `stampInboundWired`), `app/Http/Controllers/WaWebhookController.php` (`receiveMeta`), `resources/views/user/devices/_inbound_badge.blade.php`.
- **Port notes:** Column `inbound_wired boolean null` + `inbound_checked_at`; update through the connection service from the webhook worker, not by re-saving a JSON blob.

### TW-WABA-014 — Fix inbound (re-subscribe and verify)

- **Status:** implemented
- **Priority:** P0
- **Effort:** S
- **Depends on:** TW-WABA-011, TW-WABA-013
- **Summary:** One-click recovery for a connected number that is not receiving incoming messages (domain change, dropped subscription, override lost): re-runs the subscribe-with-override using the stored token, re-verifies and reports whether inbound is wired.
- **Actors & access:** Workspace admin (`EnsureWorkspaceRole:admin`).
- **UX & screens:** "Fix inbound" button on the card and in the table (confirm: re-subscribe this number to inbound webhooks, no re-login needed); "Fix inbound - re-subscribe & verify" on the health page. Success flash `Re-subscribed "<label>" to inbound webhooks - inbound wired. Send it a test message to confirm.`; amber warning when verified false: still NOT wired, subscribed to a different Meta app, reconnect via Add number (Embedded Signup) with this platform's app; errors under `waba`.
- **Endpoints:**
  | Method + URI                         | Route name                      | Action                              | Middleware                              | Request | Response                 |
  | ------------------------------------ | ------------------------------- | ----------------------------------- | --------------------------------------- | ------- | ------------------------ |
  | `POST devices/waba/{id}/resubscribe` | `user.devices.waba.resubscribe` | `DevicesController@wabaResubscribe` | Authenticate, EnsureWorkspaceRole:admin | none    | redirect back with flash |
- **Data:** Reads `meta_json.waba_id`, `credentials.access_token`; writes `meta_json.inbound_wired` and `inbound_checked_at`. Audit `devices.waba_resubscribe` with phone, waba_id and verdict. Row lookup is scoped to the caller's workspace and `provider='waba'`, 404 otherwise.
- **Rules & edge cases:**
  1. Missing waba id or token: error under `waba` telling the user to reconnect from "Add / Manage" to restore credentials.
  2. Failure with subcode 1349174 gives a "stored token is missing whatsapp_business_management, regenerate and reconnect" message; other failures use the Meta-error translation (TW-WABA-051).
  3. Exceptions return "Could not reach Meta: ...".
  4. Does not change row status or credentials.
  5. Available regardless of connection state on the health page; the card only shows it when connected.
- **Async & events:** As TW-WABA-011.
- **External systems:** Meta Graph subscribed_apps.
- **Settings:** `waba_webhook_verify_token`.
- **Acceptance criteria:**
  - Given a connected number whose callback was lost, When the admin clicks Fix inbound, Then the override is re-applied and the badge turns wired.
  - Given a number subscribed only to another app, When clicked, Then the amber warning appears and the badge shows "Inbound not wired" only if verification returned false, else "Inbound: check".
  - Given a row of another workspace, When called, Then 404.
- **Source refs:** `app/Http/Controllers/DevicesController.php` (`wabaResubscribe`, `resolveWabaConfig`), `resources/views/user/devices/waba-health.blade.php`.
- **Port notes:** `POST /channels/:id/resubscribe` guarded by `channels.manage`, tenant lookup via RLS, run as a job with polling status.

### TW-WABA-015 — Live inbound webhook diagnostic and own-app setup guidance

- **Status:** implemented
- **Priority:** P1
- **Effort:** M
- **Depends on:** TW-WABA-011
- **Summary:** A "Check inbound webhook (live)" button on the health page that asks Meta which apps the WABA is subscribed to, what callback URL Meta actually delivers to, and whether this platform can verify the signed POST, then prints a verdict and next steps. A persistent panel lists the callback URL and verify token to paste into the customer's own Meta app when inbound is not confirmed.
- **Actors & access:** Workspace admin (`EnsureWorkspaceRole:admin`).
- **UX & screens:** Health page (`waba-health.blade.php`) section "Delivery & content": rows Webhook subscribed, Inbound to this platform (badge), a "Fix inbound" form, the diagnostic button `#wh-check-btn` (result rendered inline without reload: a coloured box with lines "Subscribed to Meta app: names", "Meta delivers to: <override url or (app default callback)>", "This server: <our url> match/mismatch", "App Secret stored for this number: yes / platform secret / no", then bullet messages), and, whenever `inbound_wired` is not true, a yellow panel "Using your own Meta app? Point its webhook here" with copy buttons for Callback URL and (if set) Verify token.
- **Endpoints:**
  | Method + URI                          | Route name                        | Action                               | Middleware                              | Request | Response                                                                                                                                                                         |
  | ------------------------------------- | --------------------------------- | ------------------------------------ | --------------------------------------- | ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
  | `GET devices/waba/{id}/webhook-check` | `user.devices.waba.webhook-check` | `DevicesController@wabaWebhookCheck` | Authenticate, EnsureWorkspaceRole:admin | none    | JSON `{ok, our_url, subscribed, apps[], override_url, override_matches, app_secret_stored, admin_secret_stored, ownership_verify, verdict, messages[]}` or `{ok:false, message}` |
- **Data:** Read only. `app_secret_stored` = the number's credentials hold `app_secret`; `admin_secret_stored` = platform `waba_app_secret` or env `META_APP_SECRET` non-empty; `ownership_verify` = `waba_verify_by_ownership` (default true).
- **Rules & edge cases:**
  1. Missing waba id or token returns HTTP 422 with "This number has no WABA id / access token stored - reconnect it first."
  2. A Meta non-2xx returns `ok:false` with "Meta rejected the subscribed-apps read: <message>"; network failure returns "Could not reach Meta".
  3. Verdict: `not_subscribed` (no apps), `wrong_url` (override present but differs case-insensitively from our URL), `delivering_here` (override equals ours), else `subscribed_default` (override omitted by Meta).
  4. When subscribed, adds a warning when no per-number secret AND no platform secret AND ownership-verify is off (signed inbound will be rejected with 401), or an info line that ownership-verify will accept unsigned-by-secret payloads; always adds a final-confirmation line telling the operator to message the number and look for the `[WA-webhook] Meta POST received` log line.
  5. App names come from `whatsapp_business_api_data.name` or `name`.
  6. `setup_hint()` helper switches operator-only technical text to a support-facing message for non-admin brandings.
- **Async & events:** none.
- **External systems:** Meta Graph `GET /{waba_id}/subscribed_apps`.
- **Settings:** `waba_verify_by_ownership`, `waba_app_secret`, `waba_webhook_verify_token`.
- **Acceptance criteria:**
  - Given the WABA delivers to another server, When the check runs, Then the verdict is `wrong_url` and the message says to click Fix inbound.
  - Given no per-number and no platform secret and ownership-verify off, When the check runs, Then a warning states signed inbound will be rejected.
  - Given no stored token, When called, Then HTTP 422.
- **Source refs:** `app/Http/Controllers/DevicesController.php` (`wabaWebhookCheck`), `resources/views/user/devices/waba-health.blade.php`, `Documentation/pages/channels/whatsapp.html`.
- **Port notes:** Return a typed verdict enum; keep the copy in the frontend. Provide the callback URL and verify token via a `GET /channels/whatsapp/webhook-config` for the own-app panel.

### TW-WABA-016 — Set primary number and primary auto-promotion

- **Status:** implemented
- **Priority:** P1
- **Effort:** S
- **Depends on:** TW-WABA-004
- **Summary:** A workspace can hold many WABA numbers; the primary one is the default sender for anything that does not pin a sender. The admin can promote any connected number, and the platform re-promotes another connected number automatically when the primary is disconnected or removed.
- **Actors & access:** Workspace admin (`EnsureWorkspaceRole:admin`).
- **UX & screens:** "Set primary" button on non-primary connected cards; primary ribbon. Flash: `"<label>" is now the primary sender.`
- **Endpoints:**
  | Method + URI                     | Route name                  | Action                             | Middleware                              | Request | Response                    |
  | -------------------------------- | --------------------------- | ---------------------------------- | --------------------------------------- | ------- | --------------------------- |
  | `POST devices/waba/{id}/primary` | `user.devices.waba.primary` | `DevicesController@wabaSetPrimary` | Authenticate, EnsureWorkspaceRole:admin | none    | redirect back with `status` |
- **Data:** `wa_provider_configs.is_primary`. `setAsPrimary()` runs in a DB transaction: sets every OTHER row of the workspace (any provider, including Baileys/Twilio rows) to `is_primary=false`, then this row true. Audit `devices.waba_set_primary`.
- **Rules & edge cases:**
  1. The row must belong to the workspace and be `provider='waba'`, else 404. The button is hidden for disconnected rows but the endpoint does not check status.
  2. Demoting also affects rows of other providers (the workspace has one default engine row overall, resolved through `primaryForWorkspace` / `WorkspaceEngine::for`).
  3. On connect the first WABA row of the workspace becomes primary only when the workspace had zero WABA rows; the legacy connect flow (TW-WABA-057) always forces `is_primary=true` and demotes every other row (QUIRK).
  4. Primary resolution order elsewhere: `is_primary` desc, `connected_at` desc, `id` desc, excluding `provider='meta_ads'`.
  5. On disconnect/remove of the primary, the next connected WABA row (`connected_at` desc, `id` desc) is promoted; if none exists nothing is promoted.
- **Async & events:** none; the engine cache is not flushed here (QUIRK: only the legacy connect flow calls `WorkspaceEngine::flush()`).
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given two connected numbers, When the admin sets the non-primary one as primary, Then exactly one row has `is_primary=true` in the workspace.
  - Given the primary is removed, When other connected numbers exist, Then the newest connected one becomes primary.
  - Given a row from another workspace, Then the endpoint returns 404.
- **Source refs:** `app/Http/Controllers/DevicesController.php` (`wabaSetPrimary`), `app/Models/WaProviderConfig.php` (`setAsPrimary`, `scopePrimaryForWorkspace`).
- **Port notes:** Enforce single-primary per (org) with a partial unique index instead of demote-all updates; keep it inside one transaction with the audit + outbox rows.

### TW-WABA-017 — Disconnect a WABA number

- **Status:** implemented
- **Priority:** P1
- **Effort:** S
- **Depends on:** TW-WABA-004, TW-WABA-016
- **Summary:** Stops a number from sending: credentials are wiped and the row is marked disconnected but kept so historical logs still reference it. The user must re-authorize to use it again.
- **Actors & access:** Workspace admin (`EnsureWorkspaceRole:admin`).
- **UX & screens:** "Disconnect" button (connected rows only) with confirm "Disconnect <name>? This stops sends from this number; you'll have to re-authorize to use it again."; flash `"<label>" disconnected.`
- **Endpoints:**
  | Method + URI                          | Route name                     | Action                             | Middleware                              | Request | Response      |
  | ------------------------------------- | ------------------------------ | ---------------------------------- | --------------------------------------- | ------- | ------------- |
  | `DELETE devices/waba/{id}/disconnect` | `user.devices.waba.disconnect` | `DevicesController@wabaDisconnect` | Authenticate, EnsureWorkspaceRole:admin | none    | redirect back |
- **Data:** Updates the row: `status='disconnected'`, `credentials_json=null`, `is_primary=false`, `connected_at=null`. `meta_json` (ids, quality, coexistence, inbound flag) and `phone_number`/`display_label` are kept. Audit `devices.waba_disconnect`.
- **Rules & edge cases:**
  1. If the row was primary the next connected WABA row is promoted.
  2. Nothing is called on Meta: the WABA stays subscribed to the platform app, so webhooks for it still arrive; with credentials wiped, inbound messages are still stored (the receiver resolves the config by id, not status) but token-dependent work (media download, ownership check) fails (QUIRK: a disconnected number keeps ingesting inbound text).
  3. Row is not soft-deleted; re-connecting the same waba_id + phone_number_id reuses this row and re-enables it.
  4. Connected-count on the admin page and the auto-attach and BSP flows only count `connected`.
- **Async & events:** none (no outbox event today).
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given a connected primary number and another connected number, When the admin disconnects the primary, Then its credentials are null, status is disconnected and the other becomes primary.
  - Given a disconnected number, When the card renders, Then it shows Disconnected and no Disconnect button.
  - Given the same number is reconnected, Then the same row id is reused.
- **Source refs:** `app/Http/Controllers/DevicesController.php` (`wabaDisconnect`).
- **Port notes:** Add an explicit `whatsapp.connection.disconnected` outbox event; consider unsubscribing the app from the WABA (`DELETE /{waba}/subscribed_apps`) which Reference never does.

### TW-WABA-018 — Remove a WABA number

- **Status:** implemented
- **Priority:** P1
- **Effort:** S
- **Depends on:** TW-WABA-016
- **Summary:** Permanently deletes the number's `wa_provider_configs` row (no soft delete) so it disappears from the device list, and promotes the next connected WABA row if it was primary.
- **Actors & access:** Workspace admin (`EnsureWorkspaceRole:admin`).
- **UX & screens:** "Remove" button (always shown) with confirm: permanently deletes from the device list, can be re-added later; flash `"<label>" removed.`
- **Endpoints:**
  | Method + URI                      | Route name                 | Action                         | Middleware                              | Request | Response      |
  | --------------------------------- | -------------------------- | ------------------------------ | --------------------------------------- | ------- | ------------- |
  | `DELETE devices/waba/{id}/remove` | `user.devices.waba.remove` | `DevicesController@wabaRemove` | Authenticate, EnsureWorkspaceRole:admin | none    | redirect back |
- **Data:** Hard `DELETE` of the row. Audit `devices.waba_remove` with `subject_id` and phone. Tables referencing it by `provider_config_id` without FK (`wa_templates`, `waba_groups`, conversations' polymorphic `device_id`) are left orphaned; `waba_groups.provider_config_id` has no FK either (only `workspace_id` cascade on the config table).
- **Rules & edge cases:**
  1. Primary re-promotion as TW-WABA-016.
  2. A Twilio equivalent exists (`DELETE devices/twilio/{id}/remove`), owned by WADEV.
  3. After removal, inbound webhooks for that WABA find no config and are handled as "no config" (TW-WABA-031); templates linked to the row lose their owner.
  4. Removing does not unsubscribe on Meta or release the number's username/QR codes.
  5. The health page recommends Remove for a stale WABA link (Meta error #10).
- **Async & events:** none.
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given a connected number, When removed, Then the row no longer exists and the device count decreases.
  - Given the removed row was primary and another is connected, Then that other is promoted.
  - Given another workspace's id, Then 404.
- **Source refs:** `app/Http/Controllers/DevicesController.php` (`wabaRemove`).
- **Port notes:** Prefer archive + cascade rules: FK the templates/groups/conversations to the connection with `ON DELETE SET NULL`/restrict decisions, and emit `whatsapp.connection.removed`.

### TW-WABA-019 — Replace access token (verified paste)

- **Status:** implemented
- **Priority:** P1
- **Effort:** S
- **Depends on:** TW-WABA-021
- **Summary:** A fast remediation on the health page: paste a new Meta access token for an existing number. The token is verified against Meta before it is stored, merged into the existing credentials, and the row is marked connected. Fixes a coexistence connect that left the token empty.
- **Actors & access:** Workspace admin (`EnsureWorkspaceRole:admin`).
- **UX & screens:** On the health page, card "Access & permissions": a masked token field with a "Reveal full token" toggle and character count (a warning that the token is like a password), or the coral text "No token stored - template sync + sending will fail. Paste this number's access token below." when empty. A collapsible "Replace access token" form (open by default when no token) with a password input and "Verify & save" (note: checked against Meta before saving). Errors show under the field; success flash `Access token saved and verified - template sync and sending should work now.`
- **Endpoints:**
  | Method + URI                       | Route name                    | Action                           | Middleware                              | Request                                        | Response                                          |
  | ---------------------------------- | ----------------------------- | -------------------------------- | --------------------------------------- | ---------------------------------------------- | ------------------------------------------------- |
  | `POST devices/waba/{id}/set-token` | `user.devices.waba.set-token` | `DevicesController@setWabaToken` | Authenticate, EnsureWorkspaceRole:admin | `access_token` required string min 20 max 1024 | redirect back with status or `access_token` error |
- **Data:** Merges `access_token` into the decrypted credentials (keeps waba_id/phone_number_id/app_id etc.), sets `status='connected'`, sets `connected_at` when null. Audit `devices.waba_set_token`.
- **Rules & edge cases:**
  1. Probe: `GET /{phone_number_id}?fields=display_phone_number,verified_name` with the new token (15 s), where the phone id comes from `meta_json.phone_number_id` else `credentials.phone_number_id`; when none is stored it falls back to `debug_token`. A non-2xx rejects with "Meta rejected this token: <translated>".
  2. Only proves the token can act for the number, not that it has the management scope.
  3. Setting a token on a disconnected row re-enables it as connected (does not re-subscribe webhooks, does not restore primary).
  4. The health page displays the full stored token to any workspace admin (masked by default, revealable) - a deliberate support feature (QUIRK/security note).
- **Async & events:** none.
- **External systems:** Meta Graph phone-number node or `debug_token`.
- **Settings:** `waba_graph_api_version`.
- **Acceptance criteria:**
  - Given a valid new token, When saved, Then credentials contain it, status is connected and other credential keys are unchanged.
  - Given an invalid token, When saved, Then nothing changes and the field shows the Meta rejection.
  - Given a token shorter than 20 characters, Then validation fails.
- **Source refs:** `app/Http/Controllers/DevicesController.php` (`setWabaToken`), `resources/views/user/devices/waba-health.blade.php`.
- **Port notes:** Encrypt at rest; do not return the token to the UI (return last 4 chars) unless a `channels.reveal_token` permission is granted and audited.

### TW-WABA-020 — Renew access token in place

- **Status:** implemented
- **Priority:** P1
- **Effort:** S
- **Depends on:** TW-WABA-001
- **Summary:** "Fix / renew token" swaps the stored token for a fresh long-lived one via Meta's `fb_exchange_token` (same scopes, same number) without reconnecting. A revoked token cannot be renewed and the user is told to reconnect.
- **Actors & access:** Workspace admin (`EnsureWorkspaceRole:admin`).
- **UX & screens:** Button under the token on the health page ("Fix / renew token", disables itself with "Renewing with Meta..."; note: renews with Meta in place, no reconnect needed). Errors under the `token` key; success flash `Token renewed with Meta - valid ~N more days.` or `a long-lived token`, then "Nothing else to do; sending keeps working".
- **Endpoints:**
  | Method + URI                           | Route name                        | Action                               | Middleware                              | Request | Response      |
  | -------------------------------------- | --------------------------------- | ------------------------------------ | --------------------------------------- | ------- | ------------- |
  | `POST devices/waba/{id}/token-refresh` | `user.devices.waba.token-refresh` | `DevicesController@wabaRefreshToken` | Authenticate, EnsureWorkspaceRole:admin | none    | redirect back |
- **Data:** Updates `credentials_json.access_token`, `status='connected'`, `connected_at` if null. Audit `devices.waba_refresh_token`.
- **Rules & edge cases:**
  1. No stored token: error asking to paste one or reconnect.
  2. App credentials: the number's own `app_id`/`app_secret` if present else the platform `waba_app_id`/`waba_app_secret`; if neither exists the error says to configure them in admin or paste a fresh token (the technical wording is replaced by a support message for non-admin branded installs via `setup_hint`).
  3. `GET /oauth/access_token?grant_type=fb_exchange_token&client_id&client_secret&fb_exchange_token` (15 s). Failure: "Meta could not renew this token: <translated> - if it is expired or revoked you will need to reconnect the number." Empty token in response: "Meta returned no token".
  4. The exchange only succeeds when the app credentials are those of the app that issued the token.
  5. `expires_in` 0 means never expires (message "a long-lived token").
  6. There is no automatic renewal: a token that expires in about 60 days is only detected by the health page (warning when it expires within 7 days).
- **Async & events:** none.
- **External systems:** Meta Graph `/oauth/access_token`.
- **Settings:** `waba_app_id`, `waba_app_secret`, `waba_graph_api_version`.
- **Acceptance criteria:**
  - Given a still-valid token and matching app credentials, When renewed, Then the stored token changes and the flash states the remaining lifetime.
  - Given an expired token, When renewal is attempted, Then the user is told to reconnect and the stored token is unchanged.
  - Given no app credentials anywhere, Then a clear configuration error is shown.
- **Source refs:** `app/Http/Controllers/DevicesController.php` (`wabaRefreshToken`), `resources/views/user/devices/waba-health.blade.php`.
- **Port notes:** Add a scheduled BullMQ job that renews tokens at day ~45 and raises a notification when renewal fails (Reference relies on a manual click).

### TW-WABA-021 — Account health dashboard

- **Status:** implemented
- **Priority:** P0
- **Effort:** L
- **Depends on:** TW-WABA-004, TW-WABA-022
- **Summary:** A live Meta diagnostics page for one connected number: overall status, quality rating, daily messaging limit tier, free conversation allowance, template tally, phone-number details, business-account details, token validity/scopes/expiry, webhook subscription, and a critical-issues list, all fetched fresh from Graph on every load. The number's cached quality/tier/name fields on the Devices card are refreshed as a side effect.
- **Actors & access:** Workspace admin (`EnsureWorkspaceRole:admin`). Row scoped to the caller's workspace and `provider='waba'` (404 otherwise). No plan gate.
- **UX & screens:** `resources/views/user/devices/waba-health.blade.php` (layout `x-layouts.user`, nav key devices, page key `user-devices-waba-health`).
  - Header: breadcrumb "Devices / Meta (WABA) health / checked <relative time>", title (Meta verified name, else label, else phone), subtitle with display phone, status sub-line and "Graph vX"; buttons "Re-check" (a link that reloads the page, not the JSON endpoint) and "Open in Meta" (external).
  - Verified badge card, business username card, calling card (see TW-WABA-024/025), then a KPI row: Overall status (Healthy green "This number can send messages", Attention amber "Some checks need a look", Blocked coral "Sending is blocked or restricted"), Quality rating (Green/Yellow/Red/Unrated with "Meta message quality (last rolling window)"), Messaging limit (`TIER_` stripped, `UNLIMITED` shown as infinity, "/ 24h", "Unique customers you can start per day" plus throughput level), Free this month (TW-WABA-023, only when analytics returned), Message templates (total plus approved vs other).
  - "Issues & blocks (N)" list: only critical issues are shown (warnings and info are hidden by design), each with area, code, title, detail and "Fix: solution".
  - Cards: Phone number (verified name, connection, quality, messaging limit, throughput, number verification `code_verification_status`, display name status, account mode, platform, official business, two-step PIN), Business account (WABA name, account review, business verification, owner business, currency, timezone, country, ownership), Access & permissions (token valid, type, app, expires or "Never (permanent)", masked token with reveal, granted permissions list or "No permissions reported"), Delivery & content (webhook subscribed yes/no with app names, inbound badge, Fix inbound, live check, own-app panel, "Sync chat history (Coexistence)" form with confirm and explanatory note, template status chips, id block Phone ID / WABA ID / Business ID).
  - A final "Could not read some data from Meta" list shows the collected `errors[]`.
- **Endpoints:**
  | Method + URI                        | Route name                      | Action                             | Middleware                              | Request | Response                                         |
  | ----------------------------------- | ------------------------------- | ---------------------------------- | --------------------------------------- | ------- | ------------------------------------------------ |
  | `GET devices/waba/{id}/health`      | `user.devices.waba.health`      | `DevicesController@wabaHealth`     | Authenticate, EnsureWorkspaceRole:admin | none    | HTML page                                        |
  | `GET devices/waba/{id}/health.json` | `user.devices.waba.health.json` | `DevicesController@wabaHealthJson` | same                                    | none    | JSON snapshot (same structure; no view calls it) |
- **Data:** Snapshot structure: `ok`, `version`, `fetched_at`, `ids{phone_number_id,waba_id,business_id}`, `phone{...}`, `waba{...}`, `token{...}`, `webhook{subscribed,apps[]}`, `templates{total,by_status{}}`, `conversations{free_used,free_total,free_left,paid,total,cost}` (optional), `issues[]`, `errors[]`, `overall`. `persistHealth` merges into `meta_json` the phone fields `verified_name, display_phone_number, quality_rating, messaging_limit_tier, code_verification_status, name_status, account_mode, throughput, platform_type, is_official_business_account, is_pin_enabled` (only keys Meta returned) and sets `last_health_at=now`.
- **Rules & edge cases:**
  1. Five Graph reads with the number's own token, each independently try/caught with a 12 s timeout (phone node, WABA node, conversation analytics, subscribed_apps, message_templates summary) plus `debug_token` with an app access token. One failing node never blanks the page.
  2. No stored token: snapshot `ok=false`, one error and one critical issue "No stored access token"; nothing else is called.
  3. Phone fields requested: `verified_name, display_phone_number, quality_rating, messaging_limit_tier, code_verification_status, name_status, status, account_mode, throughput, platform_type, is_official_business_account, is_pin_enabled, last_onboarded_time, health_status`.
  4. WABA node uses progressive field sets: rich (`name, currency, timezone_id, message_template_namespace, account_review_status, business_verification_status, country, ownership_type, primary_funding_id, owner_business_info, on_behalf_of_business_info, health_status`); if that 400s (a single unreadable field fails the whole request) retry with the safe subset, then an isolated best-effort read of `ownership_type, owner_business_info, on_behalf_of_business_info`.
  5. WABA node failing with Meta error 10 means removed or un-shared from the connected Business; the message advises re-running Embedded Signup or clicking Remove to delete the stale link; recorded as a warning issue (hidden from the page list).
  6. Token debug: `GET debug_token?input_token=` authenticated with `{app_id}|{app_secret}` (the number's own app credentials, else the platform's), because Meta rejects the WABA token as the caller. If no app credentials or the call fails, the token is reported valid=true only when the phone or WABA read succeeded (Meta accepted it), scopes/expiry unknown, and an info issue explains that App ID/Secret are needed for diagnostics; `debug_unavailable=true`.
  7. The page shows exactly the critical issues only (`severity==='critical'`), while `overall` considers warnings (see TW-WABA-022).
  8. Every page load calls Meta and writes the row (extra `UPDATE`). No caching, no rate limit on the page.
  9. The health page opens for disconnected rows too (uses whatever token remains; typically none).
  10. Templates tally uses `message_templates?fields=name,status,category&limit=200&summary=true`: `total` from `summary.total_count` else the row count of the first page; per-status counts count only the first 200 rows (QUIRK).
- **Async & events:** none (synchronous, 6 to 7 Graph calls per load).
- **External systems:** Meta Graph phone node, WABA node, `conversation_analytics`, `subscribed_apps`, `message_templates`, `debug_token`.
- **Settings:** `waba_graph_api_version`, `waba_app_id`, `waba_app_secret`.
- **Acceptance criteria:**
  - Given a healthy number, When the page loads, Then Overall shows Healthy, quality and tier are displayed and `last_health_at` and cached quality are updated on the row.
  - Given Meta reports the phone `health_status` BLOCKED with an error, When the page loads, Then Overall is Blocked and the issue appears with its solution.
  - Given one Graph call fails, When the page loads, Then the other cards still render and the failure is listed under "Could not read some data from Meta".
  - Given no token is stored, Then a critical "No stored access token" issue is shown and only that.
  - Given another workspace's id, Then 404.
- **Source refs:** `app/Services/WabaHealthService.php`, `app/Http/Controllers/DevicesController.php` (`wabaHealth`, `wabaHealthJson`, `persistHealth`), `resources/views/user/devices/waba-health.blade.php`.
- **Port notes:** `GET /channels/:id/health` returning the snapshot; run the Graph fan-out in parallel with `Promise.allSettled` and a short timeout; cache 60 s per connection and provide a `refresh=true` override; persist quality/tier back through the connection service. Expose `health.json` only as this same endpoint.

### TW-WABA-022 — Health issue derivation and overall status

- **Status:** implemented
- **Priority:** P1
- **Effort:** M
- **Depends on:** TW-WABA-021
- **Summary:** The rules that turn Meta's raw responses into a sorted list of critical, warning and info issues and one overall word: blocked, attention or healthy.
- **Actors & access:** System (used by TW-WABA-021).
- **UX & screens:** Drives the status KPI and the issues list.
- **Endpoints:** none.
- **Data:** `issues[] = {severity critical|warning|info, area, code, title, detail, solution}`.
- **Rules & edge cases:**
  1. `health_status.entities[]` on the phone and WABA nodes: entity `can_send_message` BLOCKED becomes one critical issue per error (`Blocked: <error_description>`, solution from `possible_solution`) or, with no errors, "<entity> is blocked from sending"; LIMITED becomes a warning "<entity> has messaging limitations" with `additional_info` joined by `;`. Default when absent is AVAILABLE.
  2. Account review: any `account_review_status` other than APPROVED gives warning when PENDING and critical otherwise ("Account review: X").
  3. Business verification: anything other than `verified` (case-insensitive) gives warning "Business verification: ..." explaining it caps messaging limits.
  4. Token: invalid gives critical (code 190); missing `whatsapp_business_messaging` gives critical (200) "cannot send"; missing only `whatsapp_business_management` gives a warning (sending works but template sync/management blocked, and templates show 0); expiring within 7 days gives a warning.
  5. Webhook: zero subscribed apps gives critical "No app subscribed to webhooks - inbound messages and delivery statuses will not reach the system".
  6. Templates: Meta error 3 gives warning "connected app cannot read templates - missing whatsapp_business_management (Advanced Access)" with App Review steps; errors 10/200 give a warning about removed/un-shared or missing scope; others pass through.
  7. Sort: critical, warning, info. Overall: blocked if any critical; attention if any warning; else healthy (info ignored).
  8. Error translation for Graph errors in this service: 190 with subcode 463 "expired", 467 "invalid session", 460 "password changed", else "Meta rejected the token"; 200/1349174 missing management permission; 100 "Bad parameter"; else `Meta error <code>[/<sub>]: <message>`. Solution text: 190 reconnect with a fresh System-User token; 200/1349174 regenerate token with management scope; else "Check the number in Meta Business Suite".
- **Async & events:** none.
- **External systems:** none beyond TW-WABA-021.
- **Settings:** none.
- **Acceptance criteria:**
  - Given `account_review_status=PENDING`, Then a warning is raised and Overall is Attention.
  - Given `account_review_status=REJECTED`, Then a critical issue is raised and Overall is Blocked.
  - Given a token missing only management scope, Then Overall is Attention (not Blocked) and the issue says templates are unreadable.
  - Given a token expiring in 3 days, Then a warning appears.
  - Given no subscribed apps, Then a critical webhook issue appears.
- **Source refs:** `app/Services/WabaHealthService.php` (`absorbHealthStatus`, `absorbWabaStatuses`, `overall`, `translate`, `solution`).
- **Port notes:** Pure function `deriveHealthIssues(snapshot)` with unit tests for each rule; keep severity as an enum; i18n the copy in the frontend using codes.

### TW-WABA-023 — Free service-conversation allowance panel

- **Status:** partial
- **Priority:** P2
- **Effort:** S
- **Depends on:** TW-WABA-021
- **Summary:** A KPI card "Free this month" showing how many of Meta's free monthly service conversations are left, with used and paid counts, computed from Graph conversation analytics for the current calendar month.
- **Actors & access:** Workspace admin.
- **UX & screens:** KPI card on the health page shown only when analytics returned: big number free left, "/ 1,000" total, and "Free service conversations left, N used" with "N paid" when paid > 0.
- **Endpoints:** part of TW-WABA-021.
- **Data:** `conversations{free_used, free_total, free_left, paid, total, cost}`.
- **Rules & edge cases:**
  1. Query: `GET /{waba_id}?fields=conversation_analytics.start(<first of month ts>).end(<now ts>).granularity(MONTHLY).dimensions(["CONVERSATION_TYPE"])`.
  2. A data point counts as free when its `conversation_type` contains `FREE`; everything else is paid; cost is the sum of `cost`, rounded to 2 decimals.
  3. The free allowance is hard-coded to 1000 per month (QUIRK: Meta moved to per-message pricing on 1 July 2025, so conversation-based analytics and this constant may be obsolete; verify).
  4. Any failure or schema change silently omits the card.
- **Async & events:** none.
- **External systems:** Meta Graph conversation_analytics.
- **Settings:** none.
- **Acceptance criteria:**
  - Given 300 free and 40 paid conversations this month, Then the card shows 700 left of 1,000, 300 used, 40 paid.
  - Given the analytics call fails, Then the card is not rendered and no error is shown.
- **Source refs:** `app/Services/WabaHealthService.php` (step 2b), `resources/views/user/devices/waba-health.blade.php`.
- **Port notes:** Decide with product whether to keep; Meta pricing analytics now uses `pricing_analytics`. Mark as optional.

### TW-WABA-024 — Verified badge checklist and calling toggle on the health page

- **Status:** implemented
- **Priority:** P2
- **Effort:** S
- **Depends on:** TW-WABA-021, TW-CALL (calling toggle endpoint)
- **Summary:** Two informational cards: a "Verified badge (blue tick)" card that shows whether the number is an Official Business Account and ticks four prerequisites, and a "WhatsApp calling" card with an enable/disable button that calls the calling module.
- **Actors & access:** Workspace admin. The toggle route `user.wa-calling.toggle` requires `EnsureWorkspaceRole:manager` and plan feature `access_waba_calling`; a 403 shows "Your plan does not include WhatsApp calling.".
- **UX & screens:** Verified card: state "Active - your number shows the verified badge" (blue tick, from `is_official_business_account`) or "Not verified yet"; four checks (Business verified with Meta = `business_verification_status` is verified; Display name approved = `name_status` APPROVED; Message quality not low = quality is not RED; Two-step verification (PIN) on = `is_pin_enabled`); static text that Meta grants the badge manually for brand notability or Meta Verified and there is no in-app apply; a link "Apply on Meta (WhatsApp Manager)". Calling card: shows `wa_provider_configs.calling_enabled`; button "Enable calling" / "Turn off calling" posts to the calling route and reloads.
- **Endpoints:** calling toggle `POST wa-calling/{id}/toggle` belongs to TW-CALL (not claimed here).
- **Data:** reads `phone.*` health fields, `wa_provider_configs.calling_enabled`.
- **Rules & edge cases:** the four checks are informational only, nothing is enforced; badge eligibility cannot be read via API.
- **Async & events:** the toggle is an AJAX call handled by CALL.
- **External systems:** none here.
- **Settings:** none.
- **Acceptance criteria:**
  - Given `is_official_business_account=true`, Then the card says Active with a blue tick.
  - Given `quality_rating=RED`, Then "Message quality not low" is shown as not satisfied.
  - Given the plan lacks calling, When Enable is clicked, Then the 403 message is shown.
- **Source refs:** `resources/views/user/devices/waba-health.blade.php`.
- **Port notes:** Pure frontend from the health snapshot; toggle delegates to the calling module.

### TW-WABA-025 — Business username claim and release

- **Status:** implemented
- **Priority:** P2
- **Effort:** M
- **Depends on:** TW-WABA-021
- **Summary:** Reserve a public WhatsApp Business @username (3-24 chars) for a number through the Cloud API, see whether it is reserved or approved, and release it. Handle suggestions are derived from Meta's reserved name and the brand name.
- **Actors & access:** Workspace admin (`EnsureWorkspaceRole:admin`).
- **UX & screens:** "Business username" card on the health page: explanatory text (a public @handle so customers can find you without your number; claiming does not hide your phone number). With a handle: `@name` plus a badge "Approved - visible to customers" (green) or "Reserved - activates when WhatsApp rolls out usernames" (amber) and a "Release username" button (confirm). Without: an input with a fixed `@` prefix, "Claim" button, up to 5 suggestion chips (each a mini-form with a confirm "Claim @name?"), and the rules line "3-24 characters - lowercase letters, numbers, . and _ - must contain a letter". Errors under `username`; success `Username @:name claimed - :status.`; release flash `Username released.`
- **Endpoints:**
  | Method + URI                        | Route name                          | Action                                 | Middleware                              | Request                                                       | Response      |
  | ----------------------------------- | ----------------------------------- | -------------------------------------- | --------------------------------------- | ------------------------------------------------------------- | ------------- |
  | `POST devices/waba/{id}/username`   | `user.devices.waba.username.claim`  | `DevicesController@claimWabaUsername`  | Authenticate, EnsureWorkspaceRole:admin | `username` required string min 3 max 24 regex `^[a-z0-9._]+$` | redirect back |
  | `DELETE devices/waba/{id}/username` | `user.devices.waba.username.delete` | `DevicesController@deleteWabaUsername` | same                                    | none                                                          | redirect back |
- **Data:** `meta_json.wa_username`, `wa_username_status` (`reserved|approved`), `wa_username_at`.
- **Rules & edge cases:**
  1. The handle is lower-cased and trimmed; local rules mirror Meta's: must contain a letter; no leading/trailing dot or `..`; must not start with `www`; must not end with `.com .org .net .in .co .io .me .info .biz .app .dev .xyz .shop .store .online .site`. Violations return one explanatory message.
  2. Needs a stored token and phone_number_id, else "missing its Meta token or phone-number id - reconnect it first".
  3. `POST /{phone_number_id}/username` form-encoded `username` (20 s). Success status comes from `status` or `username_status`, defaulting to `reserved`; unknown values are stored as `reserved`.
  4. Meta error 100 / "does not exist" / "does not support this operation" is mapped to a message: register the number on the Cloud API first, and usernames are a limited rollout that may not be enabled for the account/region (a Meta limitation, not the handle). Other errors use the translation table.
  5. Suggestions (max 5, deduped, validated): Meta's reserved handle read via `GET /{pnid}?fields=username` (12 s; string or object), then the brand name in three shapes (joined, dot-joined, underscore-joined); failures never break the page.
  6. Release calls `DELETE /{pnid}/username` (errors ignored) and always clears the local record so the UI is never stuck.
- **Async & events:** Status later changes through the `business_username_update` webhook (TW-WABA-026).
- **External systems:** Meta Graph `/{phone_number_id}/username`.
- **Settings:** none.
- **Acceptance criteria:**
  - Given a valid handle, When claimed and Meta returns reserved, Then the row shows the handle with the amber badge.
  - Given `www.brand`, When claimed, Then the rules message is returned without calling Meta.
  - Given Meta answers error 100, When claimed, Then the "register on Cloud API / limited rollout" message appears.
  - Given Meta fails on release, Then the local handle is still cleared.
- **Source refs:** `app/Http/Controllers/DevicesController.php` (`claimWabaUsername`, `deleteWabaUsername`, `wabaUsernameSuggestions`, `isValidWaUsername`), `resources/views/user/devices/waba-health.blade.php`.
- **Port notes:** Store `username` and `username_status` as columns. Suggestion generation belongs in the API so the frontend stays thin.

### TW-WABA-026 — Business username status webhook

- **Status:** implemented
- **Priority:** P2
- **Effort:** S
- **Depends on:** TW-WABA-025, TW-WABA-031
- **Summary:** Meta's `business_username_update` webhook keeps the stored username and its badge current (reserved becoming approved, or a change/delete made in the Business app).
- **Actors & access:** System (webhook).
- **UX & screens:** Health page badge updates on next load.
- **Endpoints:** part of `POST webhooks/whatsapp/inbound` (TW-WABA-031).
- **Data:** `meta_json.wa_username`, `wa_username_status`, `wa_username_at`.
- **Rules & edge cases:**
  1. Username from `username` or `requested_username`; status from `status` or `username_status` (lower-cased).
  2. Status `deleted`, `removed` or `released` clears all three keys; otherwise sets the username when non-empty, the status when `reserved` or `approved` (else keeps the previous or `reserved`) and refreshes the timestamp.
  3. Errors are logged and swallowed.
- **Async & events:** webhook only.
- **External systems:** Meta webhook field `business_username_update`.
- **Settings:** none.
- **Acceptance criteria:**
  - Given a reserved handle, When Meta sends status approved, Then the badge shows Approved.
  - Given status deleted, Then the handle is removed locally.
- **Source refs:** `app/Http/Controllers/WaWebhookController.php` (`applyUsernameUpdate`).
- **Port notes:** Handler in the webhook-ingest worker keyed by connection id.

### TW-WABA-027 — Message QR codes (click-to-chat)

- **Status:** partial
- **Priority:** P2
- **Effort:** S
- **Depends on:** TW-WABA-021
- **Summary:** Endpoints to create and delete Meta "message QR + short link" codes with a prefilled message (deep link `wa.me/message/{code}`), plus a private helper that lists them. No page renders or calls any of it.
- **Actors & access:** Workspace admin (`EnsureWorkspaceRole:admin`).
- **UX & screens:** None. `fetchWabaQrCodes` (list) is never called; the forms do not exist in any view or JS (dead UI, live routes).
- **Endpoints:**
  | Method + URI                               | Route name                    | Action                               | Middleware                              | Request                                     | Response                                                        |
  | ------------------------------------------ | ----------------------------- | ------------------------------------ | --------------------------------------- | ------------------------------------------- | --------------------------------------------------------------- |
  | `POST devices/waba/{id}/qr-codes`          | `user.devices.waba.qr.create` | `DevicesController@createWabaQrCode` | Authenticate, EnsureWorkspaceRole:admin | `prefilled_message` required string max 140 | redirect back (`QR code created.` or `prefilled_message` error) |
  | `DELETE devices/waba/{id}/qr-codes/{code}` | `user.devices.waba.qr.delete` | `DevicesController@deleteWabaQrCode` | same; `code` matches `[A-Za-z0-9]+`     | none                                        | redirect back (`QR code deleted.`)                              |
- **Data:** none stored locally.
- **Rules & edge cases:** create posts form-encoded `prefilled_message` and `generate_qr_image=PNG` to `/{pnid}/message_qrdls` (20 s); delete calls `DELETE /{pnid}/message_qrdls/{code}` and ignores failures; list would read `code, prefilled_message, deep_link_url, qr_image_url`. Missing token or pnid returns an error under `prefilled_message`.
- **Async & events:** none.
- **External systems:** Meta Graph `/{phone_number_id}/message_qrdls`.
- **Settings:** none.
- **Acceptance criteria:**
  - Given a message under 140 chars, When posted, Then Meta receives a PNG QR request and the user sees "QR code created.".
  - Given 141 chars, Then validation fails.
- **Source refs:** `app/Http/Controllers/DevicesController.php` (`createWabaQrCode`, `deleteWabaQrCode`, `fetchWabaQrCodes`), `routes/web.php`.
- **Port notes:** Build the UI (list + create + delete with the image) or drop; if kept, list live from Meta with a short cache.

### TW-WABA-028 — Coexistence chat-history sync trigger

- **Status:** implemented
- **Priority:** P1
- **Effort:** S
- **Depends on:** TW-WABA-010, TW-WABA-046
- **Summary:** A manual fallback button that asks Meta to (re)push the coexistence chat history: it re-subscribes the app to the WABA (the only lever Meta offers) and reports how many historical messages have already been imported. Meta has no API to pull history; it only pushes once after onboarding.
- **Actors & access:** Health-page form: workspace admin. Team Inbox form: workspace manager or above (`EnsureWorkspaceRole:manager`).
- **UX & screens:** Health page: "Sync chat history (Coexistence)" form with a confirm (Meta re-pushes the last ~6 months into the Unified Inbox) and a note that standard Cloud API numbers have no history. Team Inbox toolbar: a clock icon (title "Import 6-month chat history from WhatsApp (Coexistence)") shown only when the workspace has a connected WABA row with `coexistence`; the resulting flash renders in a green banner (`status`) or amber (`waba` error) above the search box.
- **Endpoints:**
  | Method + URI                          | Route name                       | Action                              | Middleware                                | Request | Response                                                               |
  | ------------------------------------- | -------------------------------- | ----------------------------------- | ----------------------------------------- | ------- | ---------------------------------------------------------------------- |
  | `POST devices/waba/{id}/sync-history` | `user.devices.waba.sync-history` | `DevicesController@wabaSyncHistory` | Authenticate, EnsureWorkspaceRole:admin   | none    | redirect back                                                          |
  | `POST team-inbox/sync-history`        | `user.team-inbox.sync-history`   | `TeamInboxController@syncHistory`   | Authenticate, EnsureWorkspaceRole:manager | none    | delegates to `wabaSyncHistory` for the first connected coexistence row |
- **Data:** none written. Count = `inbox_messages` with `meta.history_sync=true` in conversations of the workspace.
- **Rules & edge cases:**
  1. Needs stored waba_id and token, else error "no stored WABA id / token - reconnect it once".
  2. Runs the subscribe-with-override routine (TW-WABA-011); failures are surfaced.
  3. Status text: if imported > 0 "Requested a fresh history sync from Meta. N historical message(s) already imported ... Meta pushes more over the next few minutes", else a generic requested message.
  4. Team Inbox variant picks the first connected WABA row with `meta_json.coexistence` (no primary preference); none gives the error "No WhatsApp Business (Cloud API) number with Coexistence is connected, so there is no phone-app history to import."
  5. Meta only delivers history within a short window after onboarding and only once; re-subscribing does not guarantee a second push (docs advise it may arrive gradually).
- **Async & events:** Meta may push `history` webhooks afterwards (TW-WABA-046).
- **External systems:** Meta Graph subscribed_apps.
- **Settings:** none.
- **Acceptance criteria:**
  - Given a connected coexistence number, When a manager clicks the inbox button, Then Meta is re-subscribed and a status banner reports the imported count.
  - Given the workspace has no coexistence number, When the endpoint is posted directly, Then the error banner explains there is no history to import.
  - Given a token-less number, Then the error asks to reconnect.
- **Source refs:** `app/Http/Controllers/DevicesController.php` (`wabaSyncHistory`), `app/Http/Controllers/TeamInboxController.php` (`syncHistory`), `resources/views/user/team-inbox/index.blade.php`, `resources/views/user/devices/waba-health.blade.php`, `routes/web.php`.
- **Port notes:** The Team Inbox route belongs to TIB1; keep as a thin alias in the channels module.

### TW-WABA-029 — Webhook verification handshake (GET)

- **Status:** implemented
- **Priority:** P0
- **Effort:** S
- **Depends on:** TW-WABA-001
- **Summary:** Meta's subscription handshake: Meta calls the platform's single inbound URL with a challenge and the verify token; the platform echoes the challenge only if the token matches the stored one.
- **Actors & access:** Public (Meta). No authentication middleware; the verify token is the only check. CSRF-exempt route.
- **UX & screens:** None. The URL is shown read-only on the admin page and on the health page.
- **Endpoints:**
  | Method + URI                    | Route name | Action                       | Middleware                    | Request                                                                                                                  | Response                                                     |
  | ------------------------------- | ---------- | ---------------------------- | ----------------------------- | ------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------ |
  | `GET webhooks/whatsapp/inbound` | (none)     | `WaWebhookController@verify` | none (web group, no throttle) | query `hub.mode` (also `hub_mode`), `hub.verify_token` (also `hub_verify_token`), `hub.challenge` (also `hub_challenge`) | 200 with the challenge as the plain body, or 403 `forbidden` |
- **Data:** Reads `waba_webhook_verify_token`.
- **Rules & edge cases:**
  1. Passes only when `hub.mode==='subscribe'`, the stored token is non-empty and `hash_equals(stored, given)`.
  2. Both dotted and underscored query names are accepted (PHP rewrites dots in query keys).
  3. An empty stored token always fails (no way to verify).
  4. The same token verifies the calling webhook (`GET webhooks/wa-calling`, CALL) and the override subscriptions; changing it in admin breaks re-verification for future subscriptions but existing ones keep working.
  5. No rate limiting on the route.
- **Async & events:** none.
- **External systems:** Meta Webhooks.
- **Settings:** `waba_webhook_verify_token`.
- **Acceptance criteria:**
  - Given the stored token `abc`, When Meta calls with `hub.mode=subscribe&hub.verify_token=abc&hub.challenge=123`, Then the response is 200 with body `123`.
  - Given a wrong token, Then 403.
  - Given no stored token, Then 403 for any request.
- **Source refs:** `app/Http/Controllers/WaWebhookController.php` (`verify`), `routes/web.php` line 300, `bootstrap/app.php` (CSRF exemption).
- **Port notes:** Already partly present: `MetaCloudProvider` webhook verify in `infra/providers/whatsapp/`. Route `GET /public/webhooks/whatsapp` (unauthenticated, tenant-agnostic); compare with `timingSafeEqual`. The verify token is platform-level (not per tenant).

### TW-WABA-030 — Webhook request authentication (signature, fallbacks, ownership check, status-only rescue)

- **Status:** implemented
- **Priority:** P0
- **Effort:** L
- **Depends on:** TW-WABA-029, TW-WABA-006
- **Summary:** Authenticates every Meta POST with the `X-Hub-Signature-256` HMAC over the raw body. It tries the platform app secret, then the matching number's own app secret, then every stored secret, then optionally proves number ownership with the workspace token, and finally rescues status-only payloads; anything else is rejected with 401.
- **Actors & access:** Public (Meta). CSRF-exempt. Fail closed.
- **UX & screens:** none (log lines only; the health page reports secret presence, see TW-WABA-015).
- **Endpoints:**
  | Method + URI                     | Route name | Action                                         | Middleware | Request                                                                                     | Response                                                                                              |
  | -------------------------------- | ---------- | ---------------------------------------------- | ---------- | ------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
  | `POST webhooks/whatsapp/inbound` | (none)     | `WaWebhookController@receive` -> `receiveMeta` | none       | raw JSON body, header `X-Hub-Signature-256: sha256=<hex>`, `Content-Type: application/json` | `{ok:true}` (200), `{ok:true, note:'status-only'}` (200), or `{ok:false,error:'bad signature'}` (401) |
- **Data:** Reads `waba_app_secret` (else env `META_APP_SECRET`), all `wa_provider_configs` rows with provider `waba` (credentials `app_secret`, `meta_json` ids), `waba_verify_by_ownership`. Cache key `waba:own:{configId}:{phoneNumberId}` (1 hour) for the ownership probe.
- **Rules & edge cases:**
  1. Content-type routing: JSON goes to the Meta handler, everything else to the Twilio handler (TW-WABA-047).
  2. HMAC check is `hash_equals('sha256=' . HMAC_SHA256(raw body, secret), header)` and requires a non-empty secret.
  3. Order: (a) platform secret; (b) the config matched by `entry.0.id` (waba id) OR `entry.0.changes.0.value.metadata.phone_number_id` in `meta_json`, using its own `credentials.app_secret` (own-app / override-routed WABAs are signed by the customer's app); (c) scan every stored WABA `app_secret` different from the platform secret (HMAC must still verify, proving the sender holds that app's secret).
  4. Ownership fallback (only when still unverified, a known config exists and `waba_verify_by_ownership` is on, default true): `GET /{phone_number_id}?fields=id` with the config's token (8 s) must return the same id; the result is cached for one hour and network errors fail closed. This is weaker than a signature (proves the number is ours, not that Meta sent the body) and is a deliberate trade-off for numbers whose signing secret is unknown; a warning is logged when it accepts. (The probe reads the Graph version from the setting `waba_graph_version`, which differs from the setting name used everywhere else, so it effectively always uses `v23.0`.)
  5. Status-only rescue: when still unverified but the payload contains delivery statuses and NO inbound `messages`, statuses are applied by wamid (they match only wamids the platform generated) using the known config's workspace or 0, and the response is 200 `status-only`. Anything containing an inbound message is rejected 401. One bad status never breaks the batch.
  6. Diagnostics: a log line for every Meta POST (field, has_messages, has_statuses, status, error code/title, from, text, phone_number_id, signature present) and, on mismatch, secret presence/length, signature prefixes (never secret values), whether creds decrypt, count of available secrets.
  7. Meta expects 2xx; a 401 causes Meta to retry and eventually disable the subscription, so misconfigured secrets are a real outage risk.
  8. The route has no throttle middleware.
  9. Body is parsed twice (`json_decode` of raw content plus `$request->all()`).
- **Async & events:** none (synchronous processing inside the request; there is no queue between receipt and DB writes).
- **External systems:** Meta signed webhooks; Meta Graph ownership probe.
- **Settings:** `waba_app_secret`, `META_APP_SECRET` env fallback, `waba_verify_by_ownership`, per-config `app_secret`.
- **Acceptance criteria:**
  - Given a payload signed with the platform secret, When posted, Then it is processed.
  - Given a payload for an own-app WABA signed with that config's stored `app_secret`, When posted, Then it is processed via the config secret.
  - Given no secret matches but ownership-verify is on and the token confirms the phone number id, When an inbound message arrives, Then it is accepted and a warning is logged.
  - Given an invalid signature, no ownership proof and a payload with an inbound message, Then 401 and nothing is written.
  - Given an invalid signature and a payload with only delivery statuses, Then statuses are applied by wamid and the response is 200 `status-only`.
- **Source refs:** `app/Http/Controllers/WaWebhookController.php` (`receive`, `receiveMeta`, `confirmsOwnership`), `bootstrap/app.php`, `Documentation/pages/channels/whatsapp.html`.
- **Port notes:** Target `MetaCloudProvider` already verifies the platform signature on the raw body (Nest `rawBody:true`); extend to a `WebhookSecretResolver` (platform secret then per-connection secret keyed by waba id) and make the ownership fallback a config flag default OFF and document why (it lets an attacker who knows a live phone_number_id inject messages). Ack fast: verify, write the raw event to a `webhook_events` table/queue (`WEBHOOK_INGEST`) and process in a worker (Reference processes inline and can cause Meta retries on slow requests).

### TW-WABA-031 — Webhook entry routing, config resolution and field dispatch

- **Status:** implemented
- **Priority:** P0
- **Effort:** M
- **Depends on:** TW-WABA-030
- **Summary:** After authentication, each `entry` is matched to a connected WABA row, and each `change` is dispatched by its `field` (messages and statuses, templates, groups, username, calls, coexistence echoes/contacts/history).
- **Actors & access:** System.
- **UX & screens:** none.
- **Endpoints:** same POST as TW-WABA-030.
- **Data:** Reads `wa_provider_configs`; writes depend on the field (see later features).
- **Rules & edge cases:**
  1. Config resolution per `entry`: first `provider='waba'` and `meta_json.waba_id` JSON-contains the entry id; if not found, re-match in PHP over all WABA rows by waba id OR the payload's `metadata.phone_number_id` (JSON containment is type-strict and used to miss numeric ids). The connection status is NOT checked (disconnected rows still receive).
  2. No config: inbound messages are dropped (logged with waba id, phone id, statuses kept); delivery statuses are still applied by wamid using `workspaceIdForWamid` (recovered from `wp_campaign_contacts` then `scheduled_message_contacts` to their parent campaign/broadcast; 0 when unknown), because campaign/broadcast rows are matched by wamid alone.
  3. Field dispatch order per change (first match wins, each `continue`s): `message_template_status_update`, `message_template_quality_update`, `template_category_update`, `message_template_components_update` -> TW-WABA-041; `group_lifecycle_update`, `group_participants_update`, `group_settings_update`, `group_status_update` -> TW-WABA-040; `business_username_update` -> TW-WABA-026; `calls` -> forwarded to the calling controller's `ingestCallsValue` (TW-WABA-043); `smb_message_echoes` -> TW-WABA-044; `smb_app_state_sync` -> TW-WABA-045; `history` -> TW-WABA-046. Anything else is treated as a `messages` change: each `value.messages[]` (TW-WABA-032 to 036), then `value.statuses[]` (TW-WABA-037, groups TW-WABA-039), then a WhatsApp Pay check (TW-WABA-043).
  4. `inbound_wired` stamping happens when a real inbound message is in the entry (TW-WABA-013).
  5. Every handler is wrapped so one failure never returns 5xx to Meta (Meta would retry the whole batch and duplicate siblings). Only truly unexpected exceptions outside handlers can still 500.
  6. The workspace is always `config.workspace_id`; a payload can never choose its workspace.
  7. The same `messages`/`statuses` payload shape is reused by the Twilio handler after translation.
- **Async & events:** synchronous.
- **External systems:** Meta webhook fields.
- **Settings:** none.
- **Acceptance criteria:**
  - Given a payload for a waba id with no config and a status entry for a campaign wamid, Then the message is dropped but the campaign recipient status still advances.
  - Given a `message_template_status_update` change, Then it is routed to the template handler and not to message parsing.
  - Given a payload with two entries for two workspaces, Then each entry is processed under its own workspace.
- **Source refs:** `app/Http/Controllers/WaWebhookController.php` (`receiveMeta`, `workspaceIdForWamid`).
- **Port notes:** In the worker, resolve `channel_connection` by `waba_id` (unique index) or `phone_number_id` under a privileged (RLS-bypassing) lookup, then run the handler inside `RequestContextStore.run` for that org. Route by `field` with a typed handler map.

### TW-WABA-032 — Inbound message content extraction

- **Status:** implemented
- **Priority:** P0
- **Effort:** M
- **Depends on:** TW-WABA-031
- **Summary:** Converts every Cloud API message shape into a body string, a media type and a metadata bag so the team inbox can render WhatsApp inbound like any other channel, including interactive replies, buttons, locations, contacts, orders, templates echoed from the business app and unsupported placeholders.
- **Actors & access:** System.
- **UX & screens:** Determines what the inbox bubble shows (text, media, location pin, contact card, order summary, buttons row).
- **Endpoints:** none.
- **Data:** Produces `inbox_messages.body`, `media_type`, and `meta` keys: `wa_message_id`, `waba_media_id`, `waba_mime_type`, `waba_filename`, `voice`, `location_latitude/longitude/name/address`, `contacts`, `reaction_to`, `button_payload`, `button_id`, `list_row_id`, `list_row_description`, `flow_response`, `flow_name`, `footer`, `header`, `buttons[]`, `order_catalog_id`, `order_product_items`, `system_type`, `system_wa_id`.
- **Rules & edge cases:**
  1. `text` -> body. `image|video|audio|document|sticker` -> media_type (sticker becomes `image`), body = caption, meta media id / mime / filename / voice flag.
  2. `location` -> media_type `location`, body = name plus newline + address, lat/lng floats.
  3. `contacts` -> media_type `contact`, body = first formatted name, full contacts array kept.
  4. `reaction` -> media_type `reaction`, body = emoji, `reaction_to` = target message id (handled specially, TW-WABA-033).
  5. `button` (template quick reply) -> body = button text, `button_payload`.
  6. `interactive`: `button_reply` -> title (fallback id) + `button_id`; `list_reply` -> title (fallback description then id) + row id/description; `nfm_reply` -> body "Form submitted" default or nfm body + `flow_response` and `flow_name` (routed to forms, TW-WABA-043); other interactive types (a business-sent echo: button, list, cta_url, product, flow) -> body text, footer, header text or header media (image/video/document by media id), quick-reply buttons from `action.buttons`, list rows as buttons, `cta_url` as a `url` button with display text (body falls back to the label), `flow` action as a button labelled `flow_cta`; if still empty `[Interactive · <subtype>]` and a diagnostic log with the first 1500 chars.
  7. `template` echo -> body/header/footer/buttons from components; fallback `[Template · name]` or `[Template message]`.
  8. `order` -> media_type `order`, body = order text or "Order · N item(s)", catalog id and items.
  9. `system` -> body = system body or "System update".
  10. `unsupported` (Meta error 131051) -> body "[Unsupported message - the customer sent something the WhatsApp Business API can't display]"; any other unknown type -> `[<Type> message]`; empty type `[Message]`; raw snippet logged.
  11. Content-less `unsupported`, `system` and `call` messages are not stored at all (TW-WABA-034 rule).
- **Async & events:** none.
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given a `list_reply` with title "Small", Then body is "Small" and `list_row_id` is set.
  - Given a sticker, Then media_type is `image` with a media id in meta.
  - Given an unknown type `poll`, Then the bubble reads "[Poll message]".
  - Given an interactive `cta_url` echo, Then the body shows the label and a url button.
- **Source refs:** `app/Http/Controllers/WaWebhookController.php` (`extractMetaInboundContent`).
- **Port notes:** Implement as a pure function in `infra/providers/whatsapp/` returning a normalized `InboundContent` (type enum + body + attachments + interactive payload) with fixture tests for every type above; keep raw payload on the message for later re-parse.

### TW-WABA-033 — Inbound de-duplication, self-echo detection and reactions

- **Status:** implemented
- **Priority:** P0
- **Effort:** M
- **Depends on:** TW-WABA-032
- **Summary:** Makes inbound processing idempotent per WhatsApp message id, recognises messages typed by the business itself, and applies emoji reactions to the target message instead of creating a bubble.
- **Actors & access:** System.
- **UX & screens:** Reaction pip on the target bubble; operator-typed messages appear as outbound.
- **Endpoints:** none.
- **Data:** Reads `inbox_messages.meta.wa_message_id` joined to conversations of the workspace; writes `inbox_messages.reaction`.
- **Rules & edge cases:**
  1. Dedup: per message, if an `inbox_messages` row with `meta.wa_message_id = wamid` exists in a conversation of the same workspace, skip (logged). No unique index backs this, so concurrent retries can still double insert (QUIRK; JSON contains query, no lock).
  2. Group messages (`msg.group_id` present) branch to TW-WABA-039 before anything else.
  3. `type=order` goes to TW-WABA-042; `interactive.nfm_reply` to the forms service; everything else to `captureInboundMessage`.
  4. Self-echo: if the sender number's digits equal any `wa_provider_configs.phone_number` digits in the workspace (all providers) or the payload's `metadata.display_phone_number`, the message is re-routed as an outbound echo (TW-WABA-044) because a business-app-typed message can arrive in `messages[]` with `from` = our own number (coexistence).
  5. Reaction: media type `reaction` with a target id finds the newest `inbox_messages` in the workspace whose `meta.wa_message_id` equals the target and sets `reaction` to the emoji (empty emoji clears it). No bubble, no unread bump, no automation. If the target is unknown nothing happens.
- **Async & events:** none.
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given Meta redelivers the same wamid, When processed twice, Then only one inbox message exists.
  - Given `from` equals the workspace's WABA display number, Then an outbound row is created and unread is not incremented.
  - Given a reaction with an empty emoji to a reacted message, Then the pip is cleared.
- **Source refs:** `app/Http/Controllers/WaWebhookController.php` (`receiveMeta`, `captureInboundMessage`).
- **Port notes:** Add a unique partial index on `(org_id, channel_connection_id, provider_message_id)` and use `INSERT ... ON CONFLICT DO NOTHING`; that fixes the race and makes retries safe. Reactions should be their own table/row (message_reactions) keyed by target and actor.

### TW-WABA-034 — Inbound conversation binding, thread creation and contact capture

- **Status:** implemented
- **Priority:** P0
- **Effort:** L
- **Depends on:** TW-WABA-033, TW-TIB1 (conversations), TW-CON (contacts)
- **Summary:** Files each inbound message into exactly one conversation per customer number (per business number on multi-number workspaces), creates the thread when new, titles it "Name - +number", keeps the receiving WABA number as the thread's sender so replies leave from the same number, and auto-creates a Contact for a new sender.
- **Actors & access:** System (workspace derived from the WABA config).
- **UX & screens:** Team Inbox thread list/title/preview/unread badge.
- **Endpoints:** none.
- **Data:** Writes `conversations` (`workspace_id`, `user_id`, `device_id` = the receiving number's `wa_provider_configs.id` (polymorphic), `title`, `raw_jid` = customer digits, `preview` (max 191), `status='pending'`, `platform='W'`, `provider='waba'`, `origin='inbox'`, `recipients_count=1`, `last_message_at`, `last_inbound_at`, `unread_count`, `inbox_status`, `contact_id`, `routing_meta.wa_username`), `inbox_messages` (`direction='in'`, `from_number`, `body`, `media_type`, `latitude`, `longitude`, `meta`, `status='received'`, `sent_at` from Meta's `timestamp` in the app timezone, `delivered_at=now`), legacy `messages` row (`direction='in'`, `status='sent'`, `user_id` null) and `contacts` via `Contact::rememberPhone`.
- **Rules & edge cases:**
  1. Sender name comes from `contacts[0].profile.name`; if empty, the workspace's saved contact name for that phone (`Contact::nameForPhone`). Title = "Name - +digits" or "+digits". Existing threads get the title healed (name-only becomes "Name - +number"; bare number plus a newly learned name is upgraded).
  2. Receiving-number resolution: match `metadata.display_phone_number` digits against the workspace's Baileys `devices` (exact, or one is a country-code-suffix of the other); else against WABA/Twilio `wa_provider_configs.phone_number` (same suffix rule), returning a stand-in object whose id is the config id; else fall back to the workspace's first active device. `phone_number` is empty for many coexistence rows, so the display number in the webhook is the reliable key.
  3. Thread lookup: `ConversationResolver::find(workspace, customerDigits, receivingDeviceId)` matches by digits across all stored JID shapes; one thread per customer per workspace; on workspaces with two or more connected numbers it is partitioned per receiving number. Oldest thread wins. No row lock (`findForUpdate` is not used) so two simultaneous first messages can create two threads (QUIRK).
  4. An existing thread with empty `device_id` is backfilled with the receiving number's id.
  5. Sender contact: `Contact::rememberPhone(workspace, ownerId, digits, name)` dedupes by phone hash; `conversations.contact_id` is set when empty and the column exists (schema-drift guard).
  6. Customer `@username` (Meta 2026 rollout, `contacts[0].username`) is stored in `conversations.routing_meta.wa_username` when it changed.
  7. Preview is body, else "Location" pin text for locations, else a paperclip + media type, truncated to 191.
  8. Content-less `unsupported`, `system` and `call` payloads are skipped after thread resolution (no bubble; the thread and contact may already have been created/updated).
  9. `inbox_status` after an inbound: `'open'`, except workspaces in Meta Business Agent mode `meta_agent_only` where it is `'closed'` (Meta owns the conversation; thread still captured); `meta_agent_then_handoff` and default give `'open'`. Unread count is incremented by one per stored message. `last_inbound_at` starts the 24-hour customer-service window used by the inbox composer.
  10. A "referred product" (`context.referred_product`) tags the newest thread by `raw_jid`/`alt_jid` with `interested_sku`, `interested_product_id`, `interested_seen_at`.
- **Async & events:** After the writes, the `MessageReceived` realtime event is broadcast (`toOthers`), FCM push is deferred to `app()->terminating`, outbound webhooks `conversation.created` (new thread) and `conversation.received` are fired, and `message_received` is emitted through `WebhookService` (TW-WABA-036).
- **External systems:** none.
- **Settings:** workspace `meta_agent_enabled` + `ai_responder_mode` (`threadwise_only|meta_agent_only|meta_agent_then_handoff`), app timezone.
- **Acceptance criteria:**
  - Given a new customer messages the number, Then one conversation and one contact are created and the title includes the profile name and +number.
  - Given the customer messages again, Then the same conversation receives the message and `unread_count` increments.
  - Given a workspace with two WABA numbers, When the same customer messages both, Then two threads exist, each bound to its receiving number.
  - Given the workspace runs `meta_agent_only`, Then the thread's inbox_status is `closed`.
  - Given an `unsupported` message, Then no bubble is created.
- **Source refs:** `app/Http/Controllers/WaWebhookController.php` (`captureInboundMessage`, `resolveDeviceForReceivingNumber`, `tagConversationWithReferredProduct`, `conversationsHaveContactId`), `app/Services/Inbox/ConversationResolver.php`, `app/Models/Workspace.php` (`inboundInboxStatus`).
- **Port notes:** Belongs to the inbox module (TIB1/CHAT); the WABA module only supplies `(orgId, connectionId, customerWaId, profileName, normalizedContent)` to an `InboundMessageService.ingest()` that owns thread resolution with a unique index `(org_id, channel_connection_id, contact_id)` and advisory-lock upsert. `messages` (legacy duplicate table) should not be ported.

### TW-WABA-035 — Inbound media download and retry

- **Status:** implemented
- **Priority:** P0
- **Effort:** M
- **Depends on:** TW-WABA-034
- **Summary:** Meta sends only a media id, so the platform fetches the file with the workspace token (two authenticated hops) at receive time and stores it, so the inbox can play voice notes and show images, and AI/flows can use it. An inbox "Retry download" button re-fetches a failed media (Meta keeps ids about 30 days).
- **Actors & access:** Ingest: system. Retry: authenticated workspace member on the inbox (`POST team-inbox/api/messages/{id}/retry-media`, owned by TIB1).
- **UX & screens:** Inbox bubble shows the media, or "media could not be downloaded" with a retry control (`data-retry-media`), which shows "..." while running, "Failed" for 1.8 s on failure and reopens the conversation on success.
- **Endpoints:** `POST team-inbox/api/messages/{id}/retry-media` (`TeamInboxController@retryMedia`, JSON `{ok, media_url}` or `{ok:false,error: no_workspace|not_found|no_media_id|download_failed}` with 403/404/422/502) is claimed by TIB1; documented here for the fetch contract.
- **Data:** Writes `inbox_messages.media_path` (`chat-media/<24 random>.<ext>` on the configured media disk). Reads `meta.waba_media_id`, `meta.waba_mime_type`.
- **Rules & edge cases:**
  1. Only for `provider=waba` and media types `image`, `audio`, `video`, `document` with a media id; done before AI/flow triggers so vision/voice work.
  2. Token source: the workspace's primary provider config, else the newest connected WABA row (NOT the receiving number's own token: QUIRK on multi-number workspaces).
  3. Hop 1: `GET /{version}/{media_id}` with bearer -> `{url, mime_type, file_size}` (connect timeout 8 s, total 15 s, 2 retries, 600 ms). Refuses a `file_size` over 16 MB. Hop 2: `GET <url>` with the same bearer (30 s, 2 retries); empty body or over 16 MB returns null.
  4. Extension from MIME with parameters stripped: png, webp, gif, jpg; `audio/ogg|opus` -> ogg (voice notes), mp3, m4a (mp4/aac/x-m4a), amr, mp4, 3gp, pdf; unknown image/audio/video fall back to jpg/ogg/mp4 and everything else `bin`. Defaulting everything to jpg once broke voice playback, hence the map.
  5. Any failure returns null and leaves `media_path` empty; the operator can retry. The retry endpoint returns the existing URL if `media_path` is already set.
  6. Storage disk is the configured `media_storage()` (local or cloud).
  7. The same MIME-to-extension mapper (`extFor`) is reused by the flow media-store endpoint.
- **Async & events:** synchronous in the webhook request (up to ~60 s worst case, can push the webhook past Meta's timeout).
- **External systems:** Meta Graph media node and Meta CDN download URL (short-lived, about 5 minutes).
- **Settings:** `waba_graph_api_version`, storage settings (SET).
- **Acceptance criteria:**
  - Given an inbound voice note, When received, Then `media_path` ends with `.ogg` and the file exists.
  - Given a 20 MB document, Then it is not downloaded and the bubble offers retry.
  - Given a bubble without media_path but with a media id, When retry is clicked and Meta returns the file, Then media_path is set and the media renders.
  - Given no media id in meta, Then retry returns 422 `no_media_id`.
- **Source refs:** `app/Services/Waba/WabaMediaFetcher.php`, `app/Http/Controllers/WaWebhookController.php` (`downloadWabaMediaToDisk`), `app/Http/Controllers/TeamInboxController.php` (`retryMedia`), `resources/js/charts/user-team-inbox-index.js`, `routes/api.php` (`flow.store-media`).
- **Port notes:** Do the download in a worker job (`media-fetch`) triggered after the message is stored; store in the S3/MinIO `crm-media` bucket with content-type; use the receiving connection's token. Keep the 16 MB cap and the extension map; virus-scan hook optional.

### TW-WABA-036 — Inbound automation pipeline (post-store fan-out)

- **Status:** implemented
- **Priority:** P0
- **Effort:** XL
- **Depends on:** TW-WABA-034, TW-TIB2, TW-AR, TW-FLR, TW-AIAG, TW-BCAST, TW-CAMP, TW-NOTIF
- **Summary:** Everything that happens after an inbound message is stored, in a fixed order: campaign reply attribution, unread/preview updates, realtime broadcast, mobile push, outbound webhooks, routing rules, STOP/START opt-out, AI staff copilot gate, the flow engine bridge, keyword auto-reply, and the AI agent. Later steps are skipped when an earlier one consumed the message.
- **Actors & access:** System.
- **UX & screens:** Effects appear as auto-replies, assignment, tags, campaign "Replied"/"Clicked" counters and notifications.
- **Endpoints:** Node call `POST {baileys_server_url or SERVER_URL}/api/flow/provider-inbound` (header `X-Node-Token`, 12 s).
- **Data:** Writes `wp_campaign_contacts` (`responded_at`, `response` max 500, `status='responded'`, `clicked`, `clicked_at`), `wpcampaigns` aggregates via `recomputeAggregates`, `conversations` (`preview`, `last_message_at`, `last_inbound_at`, `inbox_status`, `unread_count`), legacy `messages`.
- **Rules & edge cases:** in order:
  1. Media download (TW-WABA-035).
  2. Campaign reply/tap attribution: find the recipient row by the message's `context.id` (customer tapped reply on the campaign message; matches `wa.whatsapp_message_id`), else, if the thread has a contact, the same contact's rows sent within 7 days, newest first. A plain reply requires the row not yet responded; a button tap (type `button`, or interactive `button_reply`/`list_reply`) credits `clicked` once even if already replied. Static URL buttons cannot be tracked. Recompute campaign aggregates.
  3. Update thread preview (191 chars), `last_message_at`, `last_inbound_at`, `inbox_status` (TW-WABA-034) and `unread_count += 1`; store `wa_username`.
  4. Realtime: broadcast `MessageReceived(messageId, conversationId, workspaceId, 'in')` to others; failures logged.
  5. FCM push (deferred after response): title "Name - +number" (or "New message"), body = text or paperclip + type, extras `message_id`, `sender`, `is_group`, `channel=whatsapp`.
  6. `WebhookService::emit('message_received', {workspace_id, user_id, message_id, conversation_id, from_number, body, media_type, wamid, provider, timestamp})`; legacy `messages` row created; `OutboundWebhookDispatcher::fire('conversation.created')` for new threads and always `'conversation.received'`.
  7. Routing rules: `RoutingEngine::applyToInbound(conversation, {message_text, contact_phone}, isFollowUp)`.
  8. Opt-out: `OptOutService::handle(conversation, body, digits)`; when it returns true the message was a STOP/START instruction, fully handled, and the pipeline returns immediately (before flows, keywords and AI).
  9. AI CRM copilot: `WaCopilotRouter::maybeHandle` may treat a staff member's message as a CRM command and set `flowConsumed` (skips flow, keyword and AI).
  10. Meta Business Agent gate: when the workspace `suppressesOurAutoReply()` (agent enabled and mode `meta_agent_only` or `meta_agent_then_handoff`), the flow bridge is skipped (logged) so the customer never gets two replies; the keyword dispatcher, AI agent, routing engine and flow-enrollment service each check the same `suppressesOurAutoReply()` gate themselves.
  11. Flow bridge (Node): needs the receiving number digits (`metadata.display_phone_number`, else the device number) and a Node base URL; skipped for non-content events (no body, no button/list id, no media except reactions, or type `unsupported`/`system`) so a flow parked at an AI node is not woken with empty input. Payload: `deviceNumber`, `customerPhone`, `workspaceId`, `provider='waba'`, `text` (a Google Maps link `https://www.google.com/maps?q=lat,lng` for shared locations, appended after any text), `replyId` (button_reply id, list_reply id or `button.payload`), `pushName`, `mediaUrl` (absolute URL of the stored media), `mediaType`. Response `consumed:true` means a flow handled it.
  12. Keyword auto-reply (`KeywordReplyDispatcher::maybeDispatch(conversation, body, digits, selfNumber)`) only when no flow consumed.
  13. AI agent (`AiAgentService::respondIfAssigned`) only when no flow consumed, and not for an audio-only message with no transcript (prevents hallucinated replies).
  14. Every step is wrapped in try/catch and logged; none may raise.
- **Async & events:** inline in the request except the deferred push; the flow bridge is a synchronous HTTP call with a 12 s timeout inside the webhook request.
- **External systems:** Node bridge (`/api/flow/provider-inbound`), FCM, customers' outbound webhook URLs.
- **Settings:** `baileys_server_url` (or env `SERVER_URL`), node token (`node_webhook_token`), workspace Business Agent fields.
- **Acceptance criteria:**
  - Given a customer replies to a campaign message, Then the recipient row is marked responded and campaign Replied increments.
  - Given a customer taps a quick-reply button on a campaign template, Then `clicked` is credited once.
  - Given the customer sends STOP, Then no flow, keyword or AI reply is triggered.
  - Given a flow is active for the keyword, Then the keyword auto-reply and AI agent do not also answer.
  - Given a reaction-only or `unsupported` message, Then the flow bridge is not called.
- **Source refs:** `app/Http/Controllers/WaWebhookController.php` (`captureInboundMessage`), `app/Services/Inbox/*` (OptOutService, RoutingEngine, KeywordReplyDispatcher), `app/Services/AiAgentService.php`, `Documentation/pages/messaging/team-inbox.html`.
- **Port notes:** Orchestrate as an outbox event `message.received` consumed by independent subscribers (attribution, notifications, routing, opt-out, flow runtime, keyword, AI) with an explicit precedence chain object rather than inline code; the Node flow bridge is replaced by the FLR module. Do not block ingestion on the Node HTTP call.

### TW-WABA-037 — Delivery status ingestion (sent, delivered, read, failed)

- **Status:** implemented
- **Priority:** P0
- **Effort:** L
- **Depends on:** TW-WABA-031, TW-WALLET, TW-BCAST, TW-CAMP
- **Summary:** Applies Meta status callbacks to every local record carrying the same wamid: chat messages, team-inbox bubbles, broadcast recipients (new and legacy tables), campaign recipients and order messages, enforcing forward-only status, recording failure reasons and pricing, recomputing aggregates, firing outbound webhooks and settling wallet billing exactly once.
- **Actors & access:** System.
- **UX & screens:** Ticks in the inbox, delivered/read/failed counts on campaigns and broadcasts, failure reasons on bubbles.
- **Endpoints:** part of the POST in TW-WABA-030.
- **Data:** Writes `messages` (status, delivered_at, read_at, failure_reason, meta.error_code/pricing/conversation), `inbox_messages` (status, delivered_at, read_at, failure_reason max 191 formatted `#<code> - <message>`, meta.error_code/error_message max 512), `scheduled_message_contacts`, `broadcast_contacts`, `broadcasts` (`success_count`, `delivered_count`, `read_count`, `fail_count`), `wp_campaign_contacts` (status, delivered_at, read_at, failed_at, error_message max 512, `send_attempts`, `next_attempt_at`), `wpcampaigns` aggregates, `wa_orders.updated_at`.
- **Rules & edge cases:**
  1. Only statuses `sent|delivered|read|failed` are processed; other values ignored. Every status is logged with full raw payload and error fields.
  2. Billing first: `MessageBillingService::settleDelivered(workspace, wamid, recipient_id, category, 'waba')` on delivered/read (category = `pricing.category` else `conversation.origin.type`), `settleFailed` on failed; idempotent per wamid so sent/delivered/read charges once; workspace recovered from the wamid when 0; never throws.
  3. State machine `shouldAdvance(current, incoming)`: ranks '' 0, pending/queued 1, sent 2, delivered 3, read 4, failed 5; a failed row is never overwritten by a non-failed status; a read row ignores later delivered, sent AND failed; otherwise incoming rank must be >= current.
  4. Branches (each independent): (1) `messages` rows for the workspace with provider waba or null where `meta.wa_message_id` or `meta.wamid` contains the wamid; stores `error_code`, `pricing`, `conversation` in meta, fires outbound webhook events `message_sent|message_delivered|message_read|message_failed` (payload: workspace, user, message id, wamid, recipient, status, timestamp, error_code, error_title, error_reason, pricing, conversation). (2) `scheduled_message_contacts` by `wa_message_id`; recompute `broadcasts` counters from those rows (success = sent+delivered+read; delivered = delivered+read; read; failed) and fire `broadcast_message_status_updated` with an aggregate block. (3a) `wp_campaign_contacts` by `whatsapp_message_id` (log of matches); patch status/timestamps/error; recompute campaign aggregates; emit `campaign_contact_status_updated`. (3b) `wa_orders` by `wa_message_id` (only touches `updated_at`). (3c) `inbox_messages` by `meta.wa_message_id`: status advances under the same guard, read implies delivered_at, failure detail is stored even if the status cannot advance. (4) legacy `broadcast_contacts` by `whatsapp_message_id`, skipped for broadcasts already handled by branch 2, recompute via `Broadcast::recomputeAggregates`, fire the broadcast webhook with a stub row.
  5. Patches are filtered to columns that exist (`patchForTable` introspects `Schema::getColumnListing` per request) because installs inherited different schema lineages; the port does not need this.
  6. A workspace of 0 (unknown wamid owner) still runs the wamid-only branches.
  7. Error details: code, title, message, `error_data.details` are all kept in logs; the first error's `message` is stored on recipients.
  8. A delivered/read callback may arrive out of order or without `delivered`; read stamps `delivered_at` on inbox rows.
  9. `sent` and `failed` also arrive for group sends with `recipient_type=group` (TW-WABA-039).
- **Async & events:** synchronous; outbound webhooks are dispatched through `WebhookService::dispatch`; billing settle; campaign re-arm (TW-WABA-038).
- **External systems:** Meta status webhooks.
- **Settings:** none beyond the shared ones.
- **Acceptance criteria:**
  - Given a `sent` then `delivered` then `read` sequence, Then the bubble ends on read with delivered_at and read_at set and billing charged once.
  - Given `read` arrives before `delivered`, Then the later `delivered` does not downgrade it.
  - Given `failed` with code 131026, Then failure_reason is `#131026 - <message>`, wallet settle-failed is invoked and `message_failed` webhook is sent.
  - Given a status for a broadcast recipient, Then broadcast counters are recomputed and `broadcast_message_status_updated` fires.
  - Given a status for an unknown wamid, Then nothing is written and 200 is returned.
- **Source refs:** `app/Http/Controllers/WaWebhookController.php` (`applyStatus`, `shouldAdvance`, `recomputeBroadcastAggregates*`, `fireMessageWebhook`, `fireBroadcastWebhook`, `patchForTable`), `app/Services/MessageBillingService.php` (WALLET), `app/Models/Broadcast.php`, `app/Models/WpCampaign.php`.
- **Port notes:** A single `message_delivery_events` ingest that updates `messages.status` with a monotonic SQL (`UPDATE ... WHERE rank(new) > rank(current)`), then emits outbox events `message.delivered|read|failed` that BCAST/CAMP/WALLET consume; drop the multi-table wamid fan-out by giving every outbound send a `provider_message_id` on one `messages` table. Billing settle stays idempotent on `(org_id, provider_message_id)`.

### TW-WABA-038 — Campaign retry on Meta engagement block (131049)

- **Status:** implemented
- **Priority:** P1
- **Effort:** M
- **Depends on:** TW-WABA-037, TW-CAMP
- **Summary:** When a template send was accepted but Meta later reports the failure "not delivered to maintain healthy ecosystem engagement" (131049), the failed campaign recipient is scheduled for a patient retry with exponential hour-scale backoff and the campaign is re-armed so the sweeper resends it.
- **Actors & access:** System.
- **UX & screens:** Campaign shows the recipient failed then re-queued; campaign status returns to scheduled.
- **Endpoints:** none.
- **Data:** `wp_campaign_contacts.send_attempts`, `next_attempt_at`; `wpcampaigns.status='scheduled'`, `schedule_type='scheduled'`, `send_date`, `send_time`.
- **Rules & edge cases:**
  1. Retryable only when the code is `131049` or the message contains "healthy ecosystem" (deliberately narrow: opt-outs 131050, undeliverable 131026 and experiment exclusions 130472 are terminal).
  2. Requires both retry columns to exist on the table.
  3. `attempts = send_attempts + 1`; max = `campaign_retry_attempts` (default 3, min 1). While `attempts < max` the retry time is now + min(24, `waba_meta_block_retry_backoff_hours` (default 2, min 1) x 2^(attempts-1)) hours (2h, 4h, 8h ... capped at 24h); at the limit `next_attempt_at` is cleared (terminal).
  4. Re-arm only when the campaign status is completed, running, scheduled or failed (never cancelled, paused or draft): sets it to `scheduled` with `send_date`/`send_time` = the earliest pending `next_attempt_at` among its failed rows.
  5. Delivered/read for the row later is unaffected.
- **Async & events:** relies on the campaign sweeper (`CampaignScheduleSweeper`, CAMP/SCHED) to resend; log `[WABA-status] campaign re-armed`.
- **External systems:** Meta status webhook.
- **Settings:** `campaign_retry_attempts` (default 3), `waba_meta_block_retry_backoff_hours` (default 2; no admin UI).
- **Acceptance criteria:**
  - Given a 131049 failure on attempt 1 of 3, Then `send_attempts=1`, `next_attempt_at` is about 2 hours out and the campaign is set to scheduled.
  - Given a 131050 opt-out failure, Then the recipient stays failed with no retry time.
  - Given attempts reach the maximum, Then `next_attempt_at` is null.
  - Given the campaign is cancelled, Then it is not resurrected.
- **Source refs:** `app/Http/Controllers/WaWebhookController.php` (`applyStatus` step 3a, `isRetryableMetaBlock`, `campaignRetryColumnsExist`), `app/Services/CampaignScheduleSweeper.php`.
- **Port notes:** Model as a `campaign_recipients.next_attempt_at` + attempts columns and a BullMQ delayed job per recipient instead of re-arming the whole campaign schedule.

### TW-WABA-039 — Group message and group status ingestion

- **Status:** implemented
- **Priority:** P2
- **Effort:** M
- **Depends on:** TW-WABA-031, TW-WFL (groups)
- **Summary:** Messages posted in WhatsApp Cloud API groups are stored in a dedicated thread per group without any automation, and per-participant delivery statuses of messages sent to a group are folded into one bubble with a billable-vs-free tally.
- **Actors & access:** System.
- **UX & screens:** A group thread in the Team Inbox titled with the group subject; bubbles carry the participant and name in meta.
- **Endpoints:** part of the POST in TW-WABA-030.
- **Data:** `conversations` (`raw_jid` = Meta group id, `title` = `waba_groups.subject` or "WhatsApp group", `device_id` = config id, `provider='waba'`, `status='received'`, `inbox_status='open'`), `inbox_messages` (`direction='in'`, `from_number` = participant digits, `meta.group_id`, `participant`, `sender_name`, `wa_message_id`), `meta.group_delivery` on outbound bubbles.
- **Rules & edge cases:**
  1. Group messages are recognised by `msg.group_id`; they never run flows, keyword replies, AI, routing, opt-out or contact capture (a 500-member group would bill per participant). Storage only.
  2. Supported content: text, image/video/document (caption), audio, sticker; anything else uses `text.body`; a message with no body and no media (reactions, receipts, system) is dropped.
  3. Thread key is the opaque group id in `raw_jid` (not a phone); inbound updates preview (120 chars), `last_message_at`, `last_inbound_at`, increments unread and reopens a resolved thread.
  4. Group statuses (`recipient_type=group`): looked up by wamid in the workspace's inbox messages; one entry per `recipient_participant_id` is kept in `meta.group_delivery.participants` (status only moves forward, billable flag preserved), plus `category`, `delivered_to`, `billable_count`, `free_count`. A delivery is free when `pricing.type=free_group_customer_service` or `billable=false`. Bubble status only advances (failed -1, sent 1, delivered 2, read 3); `delivered_at`/`read_at` stamped once.
  5. All handlers swallow errors so a batch is never retried.
  6. Media for group messages is not downloaded (no media id handling in this path).
- **Async & events:** none extra; group sends are made by the groups module (WFL).
- **External systems:** Meta Groups API webhooks.
- **Settings:** none.
- **Acceptance criteria:**
  - Given a group message, Then it is stored in the group's thread with the participant number and no auto-reply fires.
  - Given three participant status rows for one send, Then one bubble shows delivered_to=3 and correct billable/free counts.
  - Given an out-of-order `sent` after `read`, Then the bubble stays read.
- **Source refs:** `app/Http/Controllers/WaWebhookController.php` (`ingestWabaGroupMessage`, `applyGroupStatus`, `groupStatusRank`), `app/Models/WabaGroup.php`.
- **Port notes:** Model group threads as `conversation_kind='group'` with a `provider_group_id` column; delivery ledger as a child table `message_delivery_participants`.

### TW-WABA-040 — Group lifecycle webhooks (waba_groups mirror)

- **Status:** implemented
- **Priority:** P2
- **Effort:** M
- **Depends on:** TW-WABA-031, TW-WFL
- **Summary:** The four Groups webhook fields keep the `waba_groups` table in sync so the UI never calls Graph just to render a list; the invite link arrives only through this webhook.
- **Actors & access:** System. Table owned by WFL; the webhook handler is here.
- **UX & screens:** Groups admin page (WFL).
- **Endpoints:** part of the POST in TW-WABA-030.
- **Data:** `waba_groups` keyed by unique `(provider_config_id, group_id)`: `workspace_id`, `subject`, `description`, `invite_link`, `join_approval_mode`, `participant_count`, `suspended`, `creation_timestamp`, `synced_at`, `meta_json` (`last_error`, `join_requests{id:{wa_id,created_at}}`, `failed_participants`, `picture_update`, `suspended_at`, `last_event{field,type,at}`).
- **Rules & edge cases:**
  1. Event `type=group_delete` deletes the row.
  2. `group_lifecycle_update`: sets subject, description, invite_link, join_approval_mode when present and `creation_timestamp` once; stores `errors[0]` as `last_error` (a failed creation is not silently healthy).
  3. `group_participants_update`: on `group_participants_add` count += max(1, added) and on `group_participants_remove` count -= max(1, removed), clamped at 0; join requests are tracked in `meta_json.join_requests` (created adds, revoked removes); `failed_participants` kept.
  4. `group_settings_update`: subject/description updated only when their `update_successful` flag is true; picture update result kept.
  5. `group_status_update`: `suspended = (type==='group_suspend')`.
  6. The row is created on first event (`firstOrNew`), scoped to the config.
- **Async & events:** none.
- **External systems:** Meta Groups webhooks.
- **Settings:** none.
- **Acceptance criteria:**
  - Given a lifecycle event with an invite link, Then the row stores it.
  - Given `group_participants_remove` with two removed, Then count decreases by 2 (min 0).
  - Given `group_delete`, Then the row is removed.
- **Source refs:** `app/Http/Controllers/WaWebhookController.php` (`applyGroupUpdate`), `app/Models/WabaGroup.php`.
- **Port notes:** Owned by the groups module; the WABA webhook worker only routes the event.

### TW-WABA-041 — Template lifecycle webhooks

- **Status:** implemented
- **Priority:** P0
- **Effort:** M
- **Depends on:** TW-WABA-031, TW-TPL
- **Summary:** Mirrors Meta's template status, quality, category and component change webhooks onto the local `wa_templates` row so the template page reflects approval, rejection, pausing and quality without waiting for the poll.
- **Actors & access:** System. Table owned by TPL.
- **UX & screens:** Template list/detail status chips (TPL).
- **Endpoints:** part of the POST in TW-WABA-030.
- **Data:** `wa_templates` scoped to the WABA row (`provider_config_id`): `meta_status`, `status` (mirror), `rejection_reason_code`, `paused_until`, `approved_at`, `quality_score`, `meta_category`, `meta_template_id`, `last_synced_at`.
- **Rules & edge cases:**
  1. Identify by `message_template_id` first; else by name + language across the WABA's templates in PHP (name is encrypted so it cannot be queried), case-insensitive name and language with region drift tolerated (`en` matches `en_US`). A row matched by name without a Meta id is backfilled with the id.
  2. Scoping to `provider_config_id` prevents a spoofed waba id from touching another workspace.
  3. `message_template_status_update`: `meta_status` = upper-cased `event`; `rejection_reason_code` = reason or `NONE` when REJECTED else null; PAUSED sets `paused_until` to now + 1 day; local `status` mirrors APPROVED -> approved, REJECTED -> rejected, PENDING/IN_APPEAL -> pending, others unchanged; `approved_at` set once on first approval.
  4. `message_template_quality_update`: score via `TemplateSyncSweeper::normalizeQualityScore(new_quality_score | quality_score, current)`; when not UNKNOWN stored; RED on a non-auth template also pauses for 24 hours.
  5. `template_category_update`: `meta_category` = new category upper-cased.
  6. `message_template_components_update`: only logged; the local copy is not overwritten.
  7. No match: info log only.
  8. Always sets `last_synced_at`.
- **Async & events:** none.
- **External systems:** Meta template webhooks.
- **Settings:** none here (`waba_template_polling_min` etc. are TPL settings).
- **Acceptance criteria:**
  - Given an APPROVED event for a known template id, Then meta_status APPROVED, status approved, approved_at set.
  - Given a RED quality update on a marketing template, Then quality_score RED and paused_until is 24 h ahead.
  - Given an event for a template on another WABA, Then no row is changed.
- **Source refs:** `app/Http/Controllers/WaWebhookController.php` (`applyTemplateUpdate`), `app/Services/Waba/TemplateSyncSweeper.php`, `app/Models/WaTemplate.php`.
- **Port notes:** TPL owns the template aggregate; expose `TemplateService.applyMetaEvent(connectionId, event)`.

### TW-WABA-042 — Catalog order message ingestion

- **Status:** implemented
- **Priority:** P1
- **Effort:** M
- **Depends on:** TW-WABA-031, TW-CHK, TW-CAT
- **Summary:** A cart sent from a WhatsApp catalog (`type=order`) becomes a `wa_orders` row with line items, resumes any paused commerce flow and acknowledges the order to the buyer (or sends a WhatsApp Pay charge).
- **Actors & access:** System (customer).
- **UX & screens:** Store orders list (CHK), buyer acknowledgment message.
- **Endpoints:** part of the POST in TW-WABA-030.
- **Data:** `wa_orders` (`source='waba'`, `customer_phone`, `customer_name` from profile, `items_json`, `total_minor`, `currency_code` default INR, `status='new'`, `wa_message_id`, `notes`, `meta_json{catalog_id, product_text}`) and `wa_order_items` (`retailer_id` or `wsn-unknown-N`, `product_id`, `name`, `image_url`, `quantity`, `price_minor`, `currency_code`, `meta_json.raw`), in one DB transaction.
- **Rules & edge cases:**
  1. Products resolved in one query by `meta_retailer_id` or `sku` within the workspace.
  2. Meta's `item_price` is a decimal in major units; converted to integer minor units with `round(price*100)`; total = sum(price x quantity); currency taken from the last line (default INR).
  3. Then `FlowSessionResolver::resumeFromWabaCatalogOrderByPhone` advances a paused flow through `purchased` (phone-based because Meta does not echo opaque data on inbound orders); failures swallowed.
  4. Acknowledge: `WhatsAppPayService::maybeAutoCharge(order)` first (opt-in native in-chat charge); if not charged, `CatalogOrderService::acknowledge(order)` sends the summary + total + optional pay link.
  5. The message never goes through normal thread capture (no bubble, no automation).
  6. Dedup uses the generic wamid check only for the inbox table, so an order redelivered is deduped only if a bubble exists (it does not) (QUIRK: order messages can be double-ingested on Meta retries).
- **Async & events:** synchronous; sends messages through the outbound path.
- **External systems:** Meta catalog order webhook; WhatsApp Pay via TW-CHK.
- **Settings:** plan `access_whatsapp_pay` (CHK).
- **Acceptance criteria:**
  - Given an order with two lines of 10.99 x 2 and 5.00 x 1, Then `total_minor` is 2698 and two items are stored.
  - Given a paused commerce flow for the buyer, Then it advances through `purchased`.
  - Given an unknown retailer id, Then the item name falls back to the retailer id.
- **Source refs:** `app/Http/Controllers/WaWebhookController.php` (`captureOrderFromWaba`), `app/Services/WhatsAppCatalog/CatalogOrderService.php`, `app/Services/Commerce/FlowSessionResolver.php`.
- **Port notes:** CHK owns orders; provide `OrdersService.createFromWhatsAppCart` and dedup on `(org_id, provider_message_id)`.

### TW-WABA-043 — Webhook hand-offs to forms, WhatsApp Pay and calling

- **Status:** implemented
- **Priority:** P1
- **Effort:** S
- **Depends on:** TW-WABA-031, TW-WFL, TW-CHK, TW-CALL
- **Summary:** Three event families that arrive on the same callback are handed to their owning services without further processing here: WhatsApp Flow (form) submissions, WhatsApp Pay payment statuses and Business Calling events.
- **Actors & access:** System.
- **UX & screens:** none here.
- **Endpoints:** part of the POST in TW-WABA-030 (calling also has its own dedicated URL `webhooks/wa-calling`, CALL).
- **Data:** none written here.
- **Rules & edge cases:**
  1. `interactive.nfm_reply` -> `WaFormSubmissionService::ingest(workspace, msg, value)` (writes `wa_form_submissions` and resumes the paused flow on Node); wrapped so it never makes Meta retry.
  2. Any `statuses[]` entry with `type='payment'` (or a `value.payment` block) -> `WhatsAppPayService::applyPaymentWebhook(workspace, value)`, which confirms through Payment Lookup rather than trusting the webhook and then settles the order; wrapped.
  3. Field `calls` -> `WaCallingWebhookController::ingestCallsValue(value, waba id)` so permission grants are recorded (otherwise every call click re-sends a permission request and hits Meta's limit 138009); wrapped.
  4. Ordering: the calls field returns before message handling; payment handling runs after messages and statuses of the same change.
- **Async & events:** as owned by target services.
- **External systems:** Meta.
- **Settings:** none.
- **Acceptance criteria:**
  - Given a `nfm_reply` message, Then a form submission is created and no ordinary inbox bubble is produced.
  - Given a payment status, Then the pay service is invoked after normal status handling.
  - Given a `calls` change, Then it is forwarded and not parsed as messages.
- **Source refs:** `app/Http/Controllers/WaWebhookController.php` (`receiveMeta`), `app/Services/Forms/WaFormSubmissionService.php`, `app/Services/Waba/WhatsAppPayService.php`, `app/Http/Controllers/WaCallingWebhookController.php`.
- **Port notes:** Router in the WABA webhook worker publishes typed events (`whatsapp.form.submitted`, `whatsapp.payment.updated`, `whatsapp.call.event`) for the owning modules.

### TW-WABA-044 — Coexistence: business-app message echoes

- **Status:** implemented
- **Priority:** P1
- **Effort:** M
- **Depends on:** TW-WABA-010, TW-WABA-031
- **Summary:** Messages the business types on the WhatsApp Business app are mirrored into the team inbox as outbound bubbles (via `smb_message_echoes`, or via `messages[]` when `from` is the business's own number), without unread bumps, routing or AI, and they auto-create the contact when the business messaged a new number first.
- **Actors & access:** System.
- **UX & screens:** Outbound bubble marked phone-typed; live in other operators' inboxes.
- **Endpoints:** part of the POST in TW-WABA-030.
- **Data:** `inbox_messages` (`direction='out'`, `from_number`=own, `to_number`=customer, `status='sent'`, `meta.phone_sync=true`, `wa_message_id`, media meta, `media_path` after download); `conversations` (`last_message_at`, `last_outbound_at`, preview 191); `contacts`.
- **Rules & edge cases:**
  1. Customer number = `msg.to`, else `recipient_id`, else `context.from`; none found means skip with a warning.
  2. Thread: `ConversationResolver::find(workspace, customerDigits)` (no receiving-number partition here) else create with `status='sent'`, `provider`, `origin='inbox'`, title = digits, device = the workspace's first active Baileys device (not the WABA number) (QUIRK: echo threads may bind to a different device id than inbound threads).
  3. Dedup by `meta.wa_message_id` across the workspace.
  4. NO unread bump, NO `inbox_status` flip, NO routing, NO AI, NO `conversation.received`; DOES update `last_message_at` + `last_outbound_at`, broadcast `MessageReceived(..., 'out')` to other operators, and fire the `conversation.outbound_synced` outbound webhook with `source='mobile'`.
  5. Media (image/audio/video/document) is downloaded for `provider=waba` like inbound.
  6. Recipient contact auto-created via `rememberPhone` with the profile name when present.
- **Async & events:** realtime broadcast; outbound webhook; log `[OUTBOUND-ECHO]`.
- **External systems:** Meta `smb_message_echoes` webhook (requires the field subscription, TW-WABA-002/003).
- **Settings:** none.
- **Acceptance criteria:**
  - Given the owner types a reply in the Business app, Then within seconds an outbound bubble appears in the inbox and unread is unchanged.
  - Given the same echo is delivered twice, Then one bubble exists.
  - Given the owner messages a brand-new number first, Then a conversation and contact are created.
- **Source refs:** `app/Http/Controllers/WaWebhookController.php` (`captureOutboundEcho`), `Documentation/pages/getting-started/coexistence.html`.
- **Port notes:** Model `messages.source = 'business_app'`; unify with the outbound message table so echoes reconcile with sends by provider_message_id.

### TW-WABA-045 — Coexistence: contact sync from the Business app

- **Status:** implemented
- **Priority:** P2
- **Effort:** S
- **Depends on:** TW-WABA-010, TW-CON
- **Summary:** The `smb_app_state_sync` webhook mirrors the business's app contacts into the workspace contact book: adds new ones, fills blank names on existing ones, and never deletes.
- **Actors & access:** System.
- **UX & screens:** Contacts list gains rows with note "Synced from WhatsApp Business app (Coexistence)."
- **Endpoints:** part of the POST in TW-WABA-030.
- **Data:** `contacts` (`user_id`=owner of first device, `workspace_id`, `name` (full_name string or `{name}` or first+last, else the phone), `mobile` = full E.164 as sent, `msg` note).
- **Rules & edge cases:**
  1. Items of type other than `contact` are skipped; action `remove` is logged (masked phone) and never applied.
  2. Existing contacts matched by digits of `mobile` (all workspace contacts loaded once; mobile is encrypted so SQL cannot match). A blank existing name is filled; a curated name is never overwritten. Duplicates inside one batch are prevented.
  3. Model events are suppressed for the whole sync (`Contact::withoutEvents`) so importing an address book does not trigger flow-enrollment messages or notifications to every contact.
  4. Counts logged (added, updated).
  5. Contact `country_code` is left null; the full number is in `mobile`.
- **Async & events:** none.
- **External systems:** Meta `smb_app_state_sync` webhook.
- **Settings:** none.
- **Acceptance criteria:**
  - Given a new phone in the sync, Then a contact is created without triggering any flow or notification.
  - Given an existing contact with a name, Then it is untouched.
  - Given an action remove, Then the contact remains.
- **Source refs:** `app/Http/Controllers/WaWebhookController.php` (`applyAppStateSync`).
- **Port notes:** Bulk upsert through the contacts module with events suppressed (import mode); dedupe on normalized E.164 identity in `contact_identities`.

### TW-WABA-046 — Coexistence: chat history import

- **Status:** implemented
- **Priority:** P1
- **Effort:** M
- **Depends on:** TW-WABA-010, TW-WABA-031
- **Summary:** The one-time `history` webhook Meta pushes after onboarding is backfilled quietly into the inbox: deduped by message id, backdated to the true send time, capped at 2,000 messages per delivery, with no routing, AI, auto-reply or outbound webhooks.
- **Actors & access:** System.
- **UX & screens:** Past chats appear in the inbox in chronological order; imported threads are unarchived.
- **Endpoints:** part of the POST in TW-WABA-030.
- **Data:** `inbox_messages` (`meta.history_sync=true`, `meta.wa_message_id`, `status='sent'`, `direction` in/out, `sent_at` and `created_at` backdated with timestamps disabled), `conversations` (created with `status='sent'`, `provider='waba'`; `last_message_at` never moved past a newer live message; `last_inbound_at` advanced for inbound history so the 24-hour window is right; `archived` reset to false).
- **Rules & edge cases:**
  1. Payload: `history[].threads[].messages[]`; thread id or `to`/`from` gives the customer number; own numbers = all `wa_provider_configs.phone_number` digits of the workspace (direction out when `from` is own).
  2. Cap 2,000 messages per webhook delivery (excess skipped with a warning; Meta pushes in chunks).
  3. Receiving device resolved like live inbound (TW-WABA-034), falling back to the first Baileys device.
  4. Content via the same extractor; media is not downloaded.
  5. Thread lookup via `ConversationResolver::find(workspace, customer)`.
  6. Unarchives a previously archived thread, fixing the "322 shown / 0 in list" mismatch.
  7. No contact creation, no unread bump.
  8. Only 1:1 chats from the last ~6 months are delivered by Meta (no groups).
- **Async & events:** none.
- **External systems:** Meta `history` webhook.
- **Settings:** none.
- **Acceptance criteria:**
  - Given a history push of 50 messages, Then 50 messages are stored in order with original timestamps and no auto-replies are sent.
  - Given the same push twice, Then no duplicates.
  - Given a push of 2,500 messages, Then 2,000 are stored and a warning is logged.
- **Source refs:** `app/Http/Controllers/WaWebhookController.php` (`applyHistorySync`, `insertHistoricalMessage`).
- **Port notes:** Run as a bulk job with idempotency on provider message id; keep the cap per event but allow multiple events; import must bypass automation by a flag on the ingest command.

### TW-WABA-047 — Twilio inbound on the shared endpoint

- **Status:** implemented
- **Priority:** P1
- **Effort:** M
- **Depends on:** TW-WABA-034, TW-WADEV (Twilio connection)
- **Summary:** The same `POST /webhooks/whatsapp/inbound` also accepts Twilio WhatsApp webhooks (form-encoded): the signature is verified with the workspace's own Twilio auth token, the payload is translated into Meta's message shape and fed through the same inbound pipeline, so conversations, automation and billing behave identically to WABA.
- **Actors & access:** Public (Twilio). Fail closed when no auth token is resolvable.
- **UX & screens:** none.
- **Endpoints:** shared with TW-WABA-030 (any content type not containing `application/json`).
- **Data:** Reads connected `wa_provider_configs` of provider twilio (ordered `is_primary` desc, `connected_at` desc, `id`); writes as TW-WABA-034 with `provider='twilio'`.
- **Rules & edge cases:**
  1. Number match: strip `whatsapp:` from `To`; exact match on `phone_number`, else digits-only equality; only connected rows; deterministic winner (primary, newest, lowest id) with a warning if several workspaces share the number (Twilio sandbox number is shared by all trial accounts).
  2. Token: config `auth_token`, else admin `twilio_auth_token`, else env `TWILIO_AUTH_TOKEN`; none means HTTP 500 `server misconfigured` (logged).
  3. Signature: `base64(HMAC-SHA1(fullUrl + sorted key+value pairs, token))` must equal `X-Twilio-Signature`, else 401. Selecting the candidate config by the unverified `To` is safe because the signature must match that config's secret.
  4. No config for the `To` number: 200 `{ok:true}` with a warning (avoids a retry storm).
  5. Translation to Meta shape: id = `MessageSid` (or random `twi.<hex>`), `from`, `to`, current timestamp; `ButtonText`/`ButtonPayload` become a `button`; `ListId` becomes `interactive.list_reply`; `Latitude`/`Longitude` a `location`; `NumMedia>0` an image/video/audio/document by the first `MediaContentType0` with `link=MediaUrl0`; `Body` a `text`; an empty payload is acked without action. Profile name from `ProfileName`.
  6. Calls `captureInboundMessage(..., 'twilio')`: the thread is stamped `provider='twilio'`; the Twilio media URL is not downloaded (WABA-only download).
  7. Twilio delivery status callbacks use a different route (`TwilioStatusController`, WADEV).
- **Async & events:** as TW-WABA-036.
- **External systems:** Twilio webhooks.
- **Settings:** `twilio_auth_token`, per-config `auth_token`.
- **Acceptance criteria:**
  - Given a correctly signed Twilio POST for a connected number, Then a conversation with provider twilio and an inbound bubble exist.
  - Given a wrong signature, Then 401.
  - Given an unknown `To` number, Then 200 and nothing stored.
- **Source refs:** `app/Http/Controllers/WaWebhookController.php` (`receiveTwilio`, `twilioConfigForNumber`).
- **Port notes:** Belongs with the Twilio provider adapter (WADEV); the WABA module only shares the shared ingest service.

### TW-WABA-048 — Node bridge inbound mirror endpoint

- **Status:** implemented
- **Priority:** P1
- **Effort:** L
- **Depends on:** TW-NODE, TW-WADEV, TW-TIB1
- **Summary:** The internal endpoint the Node bridge calls for every Baileys inbound message and for every flow/auto-reply/phone-typed outbound it wants mirrored into the Team Inbox. It also serves WABA and Twilio numbers by resolving the device number from `wa_provider_configs` so automated replies sent by Node over the Cloud API still appear in the correct thread.
- **Actors & access:** Node bridge only: header `X-Node-Token` must equal the configured shared token (constant-time), else 401. No user auth.
- **UX & screens:** none (creates inbox bubbles).
- **Endpoints:**
  | Method + URI               | Route name        | Action                        | Middleware | Request                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | Response |
  | -------------------------- | ----------------- | ----------------------------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
  | `POST api/inbound-message` | `baileys.inbound` | `WaInboundController@baileys` | api        | `device_phone` required max 32; `sender_phone` required max 32; `sender_name` max 191; `body` max 8192; `media_url` max 1024; `media_type` max 32; `media_mime` max 191; `media_filename` max 255; `media_base64`; `wa_message_id` max 191; `buttons` array; `header`, `footer` max 191; `is_lid` bool; `raw_jid`, `lid_jid`, `group_subject` max 191; `timestamp` int; `contact_vcard` max 8192; `contact_name` max 191; `contact_phone` max 64; `is_forwarded` bool; `forward_score` int 0-1000; `reaction_emoji` max 32; `reaction_target` max 191; `location_latitude` -90..90; `location_longitude` -180..180; `location_name` max 191; `location_address` max 255; `direction` in `in | out`     | `{ok, conversation_id, routing_actions{flow_id?}}`, `{ok, kind: reaction | dedup | outbound_sync | opt_out | ai_crm_copilot}`, 404 `device_not_found`, 401 |
- **Data:** Writes `conversations`, `inbox_messages` (`status='delivered'`, `meta` with `wa_message_id`, `contact{name,phone,vcard}`, `forwarded`, `frequently_forwarded` (score >= 5), `forward_score`, `location_*`, `phone_sync` on outbound, `buttons`/`header`/`footer`), media to `chat-media/<random>__<name>` (base64 decoded, no size cap here beyond upstream 16 MB), `contacts` via `rememberPhone` (not for LID-only chats).
- **Rules & edge cases:**
  1. Reaction payloads (`reaction_emoji` or `reaction_target`) only stamp the target bubble's `reaction`; unknown target returns ok with `message_id:null` (accepted so the bridge does not retry).
  2. Device resolution: Baileys `devices` by digits of `country_code + phone_number` (encrypted so scanned in PHP); if none, `wa_provider_configs` rows with provider waba/twilio by digits of `phone_number` (stand-in with id = config id, owner = config user or workspace owner; the thread provider becomes that config's provider so the mirror lands on the WABA webhook's thread, not a `baileys` twin). None found: 404 with a warning and the message dropped.
  3. LID handling: LID only from explicit signals (`is_lid`, `@lid` suffix on raw/lid jid, or no phone digits), never from digit length. Title "Name - +phone" or for LID chats "Name"/"WhatsApp contact"; group threads use `group_subject`.
  4. Thread resolution and healing as TW-WABA-034 (ConversationResolver with receiving device id, alt_jid/LID upgrade, `stampChannel`).
  5. Idempotency by `wa_message_id`: last 80 inbox messages of the conversation, then last 80 legacy `messages` rows.
  6. Direction `out` (phone-typed or automation mirror): swap from/to, no unread bump, no automation; billing: when the id starts with `flow_out_` and the thread has a workspace, `MessageBillingService::settleDelivered(..., 'baileys', 'flow')` charges once.
  7. Inbound `in`: preview, `last_inbound_at`, `inbox_status='open'`, unread +1; realtime broadcast; FCM push (deferred); outbound webhooks `conversation.created`/`conversation.received`; then in order: Shopify COD reply, Shopify stock opt-in, WooCommerce COD reply, Woo stock opt-in, Woo concierge, WhatsApp catalog concierge, AI CRM copilot gate (may return `kind=ai_crm_copilot`), routing engine, opt-out (returns `kind=opt_out`), AI agent (assigned agent; audio-with-voice-reply path via `VoiceReplyDeferred` running after the response), voice assistant from `routing_meta.voice_assistant_id`, outside-business-hours template auto-reply (with `AutoReplyGuard` cooldown), and `routing_actions.flow_id` returned when routing set `pending_flow_id` (consumed once); a voice/photo with no text and no pending order starts the workspace's published+active order flow (identified by the string `/api/flow-node/order-parse` in its flow data).
  8. Heals conversations with null `workspace_id` from the device workspace before the workspace-scoped steps.
  9. Note (QUIRK): this path runs the e-commerce concierges and outside-hours reply which the WABA webhook path (TW-WABA-036) does not, so a WABA customer never gets Shopify/Woo COD confirmations or concierge replies (parity gap).
- **Async & events:** realtime, FCM, outbound webhooks, Node routing action; billing settle.
- **External systems:** Node bridge (caller), Meta not involved.
- **Settings:** `node_webhook_token`, workspace `business_hours` (outside-hours action `template` with `outside_template_id`).
- **Acceptance criteria:**
  - Given a wrong or missing token, Then 401.
  - Given an outbound flow reply sent via WABA by Node, When mirrored with `direction=out`, Then it appears in the WABA thread (no `baileys` twin) and billing is settled for `flow_out_` ids.
  - Given the same `wa_message_id` twice, Then the second returns `kind=dedup`.
  - Given an unknown device phone, Then 404 `device_not_found`.
  - Given an inbound outside business hours with a configured template, Then one template reply is sent subject to the cooldown.
- **Source refs:** `app/Http/Controllers/WaInboundController.php`, `routes/api.php`, `app/Services/Inbox/ConversationResolver.php`.
- **Port notes:** NODE/WADEV own the Baileys side; in the target this becomes the generic `POST /internal/channels/inbound` used by the bridge process with a service token. The e-commerce concierge and COD reply hooks should subscribe to the `message.received` event for all channels to remove the WABA parity gap.

### TW-WABA-049 — Cloud API outbound send adapter

- **Status:** implemented
- **Priority:** P0
- **Effort:** XL
- **Depends on:** TW-WABA-006, TW-WABA-051, TW-CHAT, TW-TPL
- **Summary:** How the platform sends messages through Meta's Cloud API for the Team Inbox and for chat/campaign/broadcast dispatch: resolves the correct WABA number, builds the right payload (text, media by uploaded media id, template, interactive buttons, location, reaction, group), transcodes browser voice notes to ogg/opus, and returns the Meta message id or a typed error hint.
- **Actors & access:** System on behalf of any sender (agent, campaign, flow, AI).
- **UX & screens:** Send failures show Meta's exact reason on the bubble.
- **Endpoints:** none (services).
- **Data:** Reads `wa_provider_configs` (`credentials.access_token`, `meta_json.phone_number_id`, `phone_number`), conversation `device_id`/`provider`/`raw_jid`, message `meta` (`template_id`, `template_send_vars`, `buttons`, `header`, `footer`, `ptt`, `reply_to_wamid`, `reaction_target_wamid`, `preview_url`). Writes the returned wamid to the message (`provider_id` in the result; the caller stores `meta.wa_message_id`).
- **Rules & edge cases:**
  1. Number resolution (Team Inbox, `InboxDispatcher`): the conversation's own number (`conversation.provider='waba'` and `device_id` = config id in the workspace); else primary for the workspace; else newest connected WABA. Chat/campaign path (`WhatsAppDispatcher`): the connected WABA row whose phone matches the message `from_number` (digits), else the workspace primary connected WABA row. No connected config returns a local-only failure telling the user to connect a WABA at /devices; missing token/phone id returns an error to reconnect. No `.env` fallback.
  2. Endpoint `POST /{version}/{phone_number_id}/messages` with bearer token; inbox timeout 25 s with one retry (500 ms), chat path 10 s no retry.
  3. Payload envelope `{messaging_product:'whatsapp', recipient_type: individual|group, to, type, ...}`. Group send: when the conversation is WABA and `raw_jid` is non-numeric the `to` is the group id verbatim and `recipient_type=group`.
  4. Template path: when `meta.template_id` is set, `TemplatePayloadBuilder::buildSend(template, sendVars)` builds the `template` object (header, buttons, padded parameters) so templates work from the inbox exactly as from campaigns (Meta 131047 re-engagement errors otherwise; the older hand-rolled branch dropped header/buttons).
  5. Media: file is first uploaded to `POST /{phone_number_id}/media` (multipart, 60 s) and sent by `id`; falls back to a public `link` if the upload fails. Caption on non-audio media; document `filename`. Voice notes flagged `ptt` are uploaded as `audio/ogg`.
  6. Audio compatibility: extensions ogg/oga/mp3/m4a/aac/amr/mp4 pass through; webm (browser recorder) is remuxed to ogg/opus by the pure-PHP `WebmOpusToOgg` (no ffmpeg), then ffmpeg (`ffmpeg_path` setting or PATH probe; libopus 32k mono 48 kHz) as fallback; if neither works the message fails with a clear error (no document fallback) because Meta accepts webm on upload but silently fails delivery.
  7. Interactive: up to 3 quick-reply buttons (id max 256, title max 20), body max 1024, header text max 60, footer text max 60. Chat path also supports location payloads, reaction (`reaction_target_wamid`) and `context.message_id` reply threading (`reply_to_wamid`) and text `preview_url`.
  8. Reaction from the inbox: `POST /messages` type `reaction` to the customer's number (20 s, 2 retries) requires the target message's `meta.wa_message_id`.
  9. Errors: the chat path returns `MetaError::describe(error)` (Meta's own user message + code/subcode + fbtrace id) and typed hints `requires_template` (131047, 24-hour window closed), `template_missing` (132001), `rate_limited` (130429, 80007), `pair_throttled` (131056), `undeliverable` (131026); the inbox path returns `error.message` or `HTTP <status>`.
  10. Provider selection honours a pinned per-record provider when admin-allowed, then the workspace primary if connected and allowed, then the legacy hint, then the admin default `default_send_method`.
  11. Monthly message plan cap (`guardMonthlyMessagesLimit`) applies to the chat path.
  12. Delivery is confirmed only by the status webhook (TW-WABA-037); a 200 with a wamid only means Meta accepted it.
- **Async & events:** synchronous HTTP; retries as above.
- **External systems:** Meta Graph `/{phone_number_id}/messages` and `/media`.
- **Settings:** `waba_graph_api_version`, `allowed_send_methods`, `default_send_method`, `ffmpeg_path`.
- **Acceptance criteria:**
  - Given a conversation bound to WABA number B on a two-number workspace, When an agent replies, Then the request uses B's token and phone number id.
  - Given a browser-recorded webm voice note, When sent, Then Meta receives an ogg upload and the message is a voice note.
  - Given the 24-hour window is closed and no template is chosen, Then the error carries hint `requires_template`.
  - Given a template with header and buttons chosen in the inbox, Then the payload includes header and button components.
  - Given a media upload failure, Then the send falls back to a link.
- **Source refs:** `app/Services/InboxDispatcher.php` (`dispatchMetaCloud`, `buildCloudPayload`, `uploadMediaToMeta`, `prepareWabaAudio`, `resolveWabaConfig`, `wabaReaction`), `app/Services/WhatsAppDispatcher.php` (`dispatchMetaCloud`, `buildCloudPayload`, `resolveWabaConfig`, `resolveProvider`), `app/Support/Audio/WebmOpusToOgg.php`, `app/Services/Waba/TemplatePayloadBuilder.php`, `app/Services/Waba/MetaError.php`.
- **Port notes:** Implement `MetaCloudProvider.sendText/sendMedia/sendTemplate/sendInteractive` (currently throwing "not implemented") behind the existing `WhatsAppProvider` port, consumed by a `message-dispatch` BullMQ worker; media upload to Meta from the S3 object. Keep the number-resolution rule (conversation's connection wins) and the ogg/opus requirement (ffmpeg in the worker image).

### TW-WABA-050 — WABA credentials for the Node bridge

- **Status:** implemented
- **Priority:** P1
- **Effort:** S
- **Depends on:** TW-NODE, TW-WABA-006
- **Summary:** Internal endpoint that hands the Node bridge a workspace's WABA access token, phone number id and WABA id so flow nodes (forms, templates, calling) can call Meta directly.
- **Actors & access:** Node bridge (`X-Node-Token`, constant-time compare, else 401).
- **UX & screens:** none.
- **Endpoints:**
  | Method + URI         | Route name       | Action                                | Middleware | Request                         | Response                                                                              |
  | -------------------- | ---------------- | ------------------------------------- | ---------- | ------------------------------- | ------------------------------------------------------------------------------------- |
  | `GET api/waba-creds` | `api.waba-creds` | `FlowNodeActionsController@wabaCreds` | api        | `workspace_id` required integer | `{ok, access_token, phone_number_id, waba_id, graph_version}` or 404 `no_waba_config` |
- **Data:** Reads `wa_provider_configs` (provider waba).
- **Rules & edge cases:**
  1. Candidate order: connected first, then primary, then most recently connected; returns the first row that actually has both an access token and a phone number id; else the first row.
  2. Phone number id and waba id are read from credentials first and `meta_json` second (Embedded Signup stores ids in `meta_json` and the token in credentials).
  3. `graph_version` = env `META_GRAPH_VERSION` default `v21.0` (QUIRK: not the admin `waba_graph_api_version` setting; installer writes v23.0 into env).
  4. The response exposes the raw access token; log line records only token length and sources.
  5. Not tied to a specific phone: a multi-WABA workspace always gets one number regardless of which number received the message.
- **Async & events:** none.
- **External systems:** none (caller is Node).
- **Settings:** env `META_GRAPH_VERSION`, node token.
- **Acceptance criteria:**
  - Given a workspace with a stale empty row and a real connected row, Then the connected row's credentials are returned.
  - Given no WABA row, Then 404 `no_waba_config`.
  - Given a bad token header, Then 401.
- **Source refs:** `app/Http/Controllers/FlowNodeActionsController.php` (`wabaCreds`, `authed`), `routes/api.php`.
- **Port notes:** Replace with a service-to-service call from the flow runtime to the WABA module (`ConnectionCredentialsService`), never over public HTTP; add a `connectionId` parameter.

### TW-WABA-051 — Meta Graph error translation

- **Status:** implemented
- **Priority:** P1
- **Effort:** S
- **Depends on:** none
- **Summary:** Turns Meta's `error` objects into readable messages: a family of per-service translators used by connect, renewal and health, and `MetaError::describe`, which prefers Meta's own specific words and appends the code and trace id.
- **Actors & access:** Internal.
- **UX & screens:** Text in flashes, inbox failure reasons and health issues.
- **Endpoints:** none.
- **Data:** none.
- **Rules & edge cases:**
  1. `wabaErrorMessage` (connect and token actions): 190/463 "token has expired, generate a new permanent System User token"; 190/467 "session invalid, re-authorize"; 190/460 "Facebook password changed, re-authorize"; other 190 "Meta rejected the token: <message>"; 200/1349174 missing `whatsapp_business_management` (regenerate with both scopes); 100 "bad parameter" with a hint that Embedded Signup redirect_uri must match; else `Meta error <code>[/<sub>]: <message>`.
  2. `MetaError::describe`: primary = `error_user_msg`, else `error_data.details`, else `message`, else "Unknown Meta error"; prefixed with `error_user_title - ` when the title adds information; suffix ` (code N[/sub], trace <fbtrace_id>)`. The same rule is mirrored in Node.
  3. `WabaHealthService::translate/solution` has a near-copy with slightly different wording (TW-WABA-022).
  4. Template client errors use additional hints owned by TPL.
- **Async & events:** none.
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given an error with `error_user_msg`, Then that text leads and the code and trace are appended.
  - Given code 190 subcode 463, Then the message says the token expired.
- **Source refs:** `app/Services/Waba/MetaError.php`, `app/Http/Controllers/DevicesController.php` (`wabaErrorMessage`), `app/Services/WabaHealthService.php`, `node/utils/helpers.js`.
- **Port notes:** One `MetaGraphError` class in `infra/providers/whatsapp/` mapping to problem+json codes plus a typed `retryable` flag; keep the English default copy but return codes for i18n.

### TW-WABA-052 — WABA id backfill

- **Status:** implemented
- **Priority:** P2
- **Effort:** S
- **Depends on:** TW-WABA-006
- **Summary:** Recovers a missing `waba_id` on a connection that has a token, phone number id and business id, by listing the business's owned and client WABAs and finding the one that contains the phone number, then persists it. Used by the template client so template sync works on numbers connected by older partial flows.
- **Actors & access:** Internal (called from `TemplateClient` construction).
- **UX & screens:** none.
- **Endpoints:** none.
- **Data:** writes `meta_json.waba_id`.
- **Rules & edge cases:** returns the stored id if present (meta then credentials); needs token + phone id + business id else null; lists `GET /{business}/owned_whatsapp_business_accounts` and `client_whatsapp_business_accounts` (`fields=id&limit=100`, 12 s each), dedups; then for each WABA `GET /{waba}/phone_numbers?fields=id&limit=100` and takes the WABA whose numbers include the phone id (always verified even when only one WABA exists); errors return null; no pagination beyond 100.
- **Async & events:** log `[WABA-BACKFILL]`.
- **External systems:** Meta Graph business edges.
- **Settings:** `waba_graph_api_version`.
- **Acceptance criteria:**
  - Given a row with token, phone id and business id but no waba id, When template sync starts, Then the waba id is discovered and stored.
  - Given no business id, Then null and the caller shows a reconnect error.
- **Source refs:** `app/Services/Waba/WabaIdBackfiller.php`, `app/Services/Waba/TemplateClient.php`.
- **Port notes:** Not needed if `waba_id` is a required column at connect time; keep as a repair job.

### TW-WABA-053 — Template button-click analytics sync

- **Status:** partial
- **Priority:** P2
- **Effort:** M
- **Depends on:** TW-WABA-041, TW-TPL, TW-CAMP
- **Summary:** An artisan command that pulls button-click counts for recent WABA template campaigns from Meta's `template_analytics` and stores them on the campaign as `meta_clicked_count`, because Meta sends no click webhook. It is not scheduled anywhere.
- **Actors & access:** Operator/cron (CLI). No HTTP entry.
- **UX & screens:** Campaign analytics show max(redirect clicks, Meta clicks).
- **Endpoints:** none. Command `php artisan waba:sync-template-clicks {--days=14} {--campaign=}`.
- **Data:** writes `wpcampaigns.meta_clicked_count` and `meta_analytics_synced_at`; reads `wa_templates` (`meta_template_id`, `provider_config_id`), campaigns with `provider='waba'`.
- **Rules & edge cases:**
  1. Default selects WABA campaigns created within `--days` (min 1) newest first in chunks of 100; `--campaign` syncs one id.
  2. A campaign counts templates `template_id`, `template_id_a`, `template_id_b` (A/B). Only templates with a Meta id and a provider config are used; none returns null (skipped).
  3. Window from the campaign creation day start (capped at 89 days back) to tomorrow's day start; groups templates by WABA and calls `TemplateClient::templateAnalytics(ids, start, end)` once per WABA.
  4. `sumClicks` sums every button `count` in each `clicked` array across all day buckets for the requested template ids.
  5. When the call fails and the message hints insights are disabled, it enables template insights once (`enableInsights`) and retries.
  6. Attribution is per template and window, so two campaigns sharing a template on overlapping days double count (documented limitation).
  7. Per-campaign failures are warned and the run continues; output "Synced N WABA campaign(s)."
  8. Not in the scheduler (`schedule.txt` empty; comment in `routes/console.php` says sync is handled elsewhere): only manual/cron.
- **Async & events:** none.
- **External systems:** Meta Graph `template_analytics`.
- **Settings:** none.
- **Acceptance criteria:**
  - Given a 5-day-old WABA campaign with template clicks 12 in Meta, When the command runs, Then `meta_clicked_count=12`.
  - Given `--campaign=42`, Then only that campaign is synced.
  - Given insights disabled, Then the command enables them and retries.
- **Source refs:** `app/Console/Commands/SyncWabaTemplateClicks.php`, `app/Services/Waba/MetaTemplateAnalyticsService.php`, `app/Services/Waba/TemplateClient.php`.
- **Port notes:** CAMP/TPL own the columns; implement as a BullMQ repeatable job (daily) `campaign.sync-meta-clicks`.

### TW-WABA-054 — Ads client reuse of WABA identifiers

- **Status:** implemented
- **Priority:** P2
- **Effort:** S
- **Depends on:** TW-MADS
- **Summary:** The Meta Ads (Click-to-WhatsApp) Graph client fills its missing WABA id, phone number id and phone digits from the workspace's own primary WABA row, then from admin-level Meta Ads keys, so a workspace with WhatsApp connected does not re-enter them for CTWA ads. The rest of `MetaGraphClient` is the ads pipeline (MADS).
- **Actors & access:** Internal.
- **UX & screens:** Meta Ads connect page pre-fills.
- **Endpoints:** none.
- **Data:** reads `wa_provider_configs` (waba, `is_primary` desc, `id` desc; credentials waba_id/phone_number_id, `meta_json.display_phone_number`, `phone_number`).
- **Rules & edge cases:** gap-fill only (values on the ads row always win); order is workspace WABA fallback then admin `meta_ads.*` keys; the WABA row is chosen without a status filter (a disconnected primary is still used).
- **Async & events:** none.
- **External systems:** Meta Marketing API (MADS).
- **Settings:** `meta_ads.*` admin keys, `meta_ads_graph_api_version`.
- **Acceptance criteria:**
  - Given a workspace ads config without a waba id and a connected WABA row, Then the client uses the WABA row's ids.
- **Source refs:** `app/Services/MetaGraphClient.php` (`__construct`, `applyWorkspaceWabaFallback`, `applyAdminFallback`).
- **Port notes:** MADS consumes `ConnectionsService.getPrimaryWhatsApp(orgId)`; exclude disconnected rows.

### TW-WABA-055 — Saved customer profiles (list, search and save)

- **Status:** implemented
- **Priority:** P2
- **Effort:** S
- **Depends on:** TW-CHK, TW-STORE
- **Summary:** A shop-dashboard page where a merchant pre-sets a customer's name, company and delivery address by phone, so the WhatsApp ordering flow shows it and the customer just replies YES. Assigned to this domain by the brief; functionally it belongs to commerce (see Open questions).
- **Actors & access:** Workspace admin (`EnsureWorkspaceRole:admin`). Plan-gated by the `store` path (`access_wa_storefront`) through the path paywall in `config/plan_gates.php` (page renders behind an upgrade sheet; the route itself carries no `EnforcePlanFeature`).
- **UX & screens:** `resources/views/user/store/customers/index.blade.php` ("Store / Customers", title "Saved customers"): intro text; form "Add a customer" with Phone (required, "Number with country code"), Name, Company (optional), Full delivery address (textarea) and "Save customer"; an Edit action fills the form (title "Edit customer", a "Clear" button appears); search input (name, phone or company); table columns Customer (name, company, phone), Address, Actions (Edit, Delete with confirm "Remove this customer?"); empty state "No saved customers yet. Add one above."; pagination links. Flash messages success/error.
- **Endpoints:**
  | Method + URI           | Route name                   | Action                              | Middleware                              | Request                                                                                                          | Response                 |
  | ---------------------- | ---------------------------- | ----------------------------------- | --------------------------------------- | ---------------------------------------------------------------------------------------------------------------- | ------------------------ |
  | `GET store/customers`  | `user.store.customers.index` | `WaCustomerProfileController@index` | Authenticate, EnsureWorkspaceRole:admin | `q`                                                                                                              | view                     |
  | `POST store/customers` | `user.store.customers.store` | `WaCustomerProfileController@store` | same                                    | `phone` required string max 32; `name` nullable max 191; `company` nullable max 191; `address` nullable max 2000 | redirect back with flash |
- **Data:** `wa_customer_profiles` (`workspace_id`, `phone` digits-only, `name`, `company`, `address`; unique `(workspace_id, phone)`), read by `OrderingService::shippingFor` (pre-set profile wins over the last order's address, and is used only if it has an address or a name).
- **Rules & edge cases:**
  1. Phone is reduced to digits; empty result gives error "Enter a valid phone number (with country code)."; the save is an upsert keyed by (workspace, digits), so the same form creates or updates.
  2. Blank name/company/address are stored as NULL after trim.
  3. Search: escapes `\`, `%`, `_` then `LIKE %q%` on name, phone and company; order name then phone; 20 per page with query string preserved.
  4. Success flash: "Customer saved. Their address will auto-fill when they order on WhatsApp."
  5. The phone stored is digits only, matching orders compared by digits.
- **Async & events:** none.
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given a new phone, When saved, Then a row exists with digits-only phone and the flash confirms.
  - Given the same phone saved again with a new address, Then the row is updated, not duplicated.
  - Given search "acme", Then only rows whose name/phone/company contain it are listed.
  - Given phone "+91 98xx", Then it is stored as digits.
- **Source refs:** `app/Http/Controllers/WaCustomerProfileController.php`, `app/Models/WaCustomerProfile.php`, `resources/views/user/store/customers/index.blade.php`, `app/Services/Ordering/OrderingService.php`.
- **Port notes:** Move to the commerce/store module; table with `org_id`, RLS, unique `(org_id, phone_e164)`; better to fold into contacts custom fields (address) than a separate table.

### TW-WABA-056 — Delete a saved customer (cascade to orders)

- **Status:** implemented
- **Priority:** P2
- **Effort:** S
- **Depends on:** TW-WABA-055
- **Summary:** Deleting a saved customer also deletes that customer's orders so the Orders list stops showing them.
- **Actors & access:** Workspace admin (`EnsureWorkspaceRole:admin`).
- **UX & screens:** Delete action with confirm; flash "Customer and their orders removed." (or "Customer removed." when the row is already gone).
- **Endpoints:**
  | Method + URI                  | Route name                     | Action                                | Middleware                              | Request | Response      |
  | ----------------------------- | ------------------------------ | ------------------------------------- | --------------------------------------- | ------- | ------------- |
  | `DELETE store/customers/{id}` | `user.store.customers.destroy` | `WaCustomerProfileController@destroy` | Authenticate, EnsureWorkspaceRole:admin | none    | redirect back |
- **Data:** deletes the profile and `wa_orders` of the workspace whose `customer_phone` digits equal the profile digits (line items cascade via `wa_order_items.order_id`).
- **Rules & edge cases:** orders link to customers only by phone (no FK); prefilter with `LIKE %<last 9 digits>` then confirm exact digit equality in PHP before deleting each order; an unknown id shows the success flash anyway; this is a hard delete of financial records with no confirmation beyond the browser confirm (QUIRK: order history destruction).
- **Async & events:** none (no audit entry).
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given a customer with two orders, When deleted, Then the profile and both orders are gone and other customers' orders remain.
  - Given an id from another workspace, Then nothing is deleted and the success flash still shows.
- **Source refs:** `app/Http/Controllers/WaCustomerProfileController.php` (`destroy`).
- **Port notes:** Do not cascade-delete orders; delete only the profile (or soft-delete) and keep orders for accounting.

### TW-WABA-057 — Legacy Embedded Signup callback and connect wizard partial

- **Status:** dead-code
- **Priority:** P2
- **Effort:** S
- **Depends on:** TW-WABA-001
- **Summary:** An older Embedded Signup flow: a JSON endpoint that exchanges the code, subscribes the WABA (plain subscribe, no callback override), registers the phone with a random PIN, reads the display number, finds or creates a Meta catalog, writes the row and creates the workspace storefront. Its only callers are buttons in views that no page includes, so users cannot reach it; the admin page still shows its URL as the "OAuth redirect URI".
- **Actors & access:** Authenticated user (route middleware is `Authenticate` only, no workspace role, no plan cap, no `device_limit` check).
- **UX & screens:** `resources/views/user/connect/providers/waba.blade.php` (heading "Connect with Meta", amber "Meta App not configured" card when App ID or Config ID missing, an Embedded Signup card with a blue "Continue with Meta" button `#waba-signup-btn`, three step cards (Webhook, Register phone, Catalog), a connected banner linking to /store) and the same button inside `resources/views/user/partials/connect-providers.blade.php`; the JS is `wireWaba` in `resources/js/charts/user-connect-wa-store.js` (status line "Opening Meta dialog...", "Provisioning on Meta...", "Connected ... Redirecting", prompts for missing ids). Neither view is included by any other view or controller.
- **Endpoints:**
  | Method + URI                 | Route name                   | Action                             | Middleware   | Request                                                                                                                                                      | Response                                                                                     |
  | ---------------------------- | ---------------------------- | ---------------------------------- | ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------- |
  | `POST connect/wa-store/waba` | `user.connect.wa-store.waba` | `WaConnectWabaController@complete` | Authenticate | `code` required string max 1024; `phone_number_id` required max 64; `waba_id` required max 64; `business_id` nullable max 64; `coexistence` nullable boolean | JSON `{ok, errors{}, phone, catalog_id, redirect: /devices}` or 422/500 `{ok:false,message}` |
- **Data:** Upserts `wa_provider_configs` (matched by workspace + provider waba + `meta_json.phone_number_id`): `status` connected only when no step errored else `failed`, `phone_number`, `display_label='WABA - <phone or id>'`, `is_primary=true` (and demotes every other row of the workspace), `meta_json{waba_id, phone_number_id, business_id, catalog_id, coexistence, errors}` (nulls filtered), credentials `{access_token, phone_number_id, waba_id, business_id, register_pin, catalog_id, webhook_verify_token}`; creates `wa_storefronts` (`theme_key` default) when missing; flushes `WorkspaceEngine` cache.
- **Rules & edge cases:**
  1. Fails 422 when platform App ID/Secret are not configured, when the token exchange fails, or with no active workspace.
  2. Steps: exchange (10 s), plain `subscribed_apps` POST, register with a random 6-digit PIN unless `coexistence`, phone info read for the display number, catalog list then create (`{app_name} auto - {Y-m-d}`, vertical `commerce`) via the business id and link, then persist; each failure is collected in `errors` and the row is stored as `failed` when any exists.
  3. Never blocks on the plan device cap and never does the callback override, so inbound can silently fail for it (QUIRK: superseded by `DevicesController` flow).
  4. The redirect URI shown in admin (`/connect/wa-store/waba`) is not used by the modern popup flow (code exchange takes no redirect_uri).
  5. Graph version from setting, default v23.0 (its own comment notes it drifted from a hard-coded v22.0 earlier).
- **Async & events:** synchronous, no audit log.
- **External systems:** Meta Graph (`/oauth/access_token`, `/{waba}/subscribed_apps`, `/{pnid}/register`, `/{pnid}`, `/{waba}/product_catalogs`, `/{business}/owned_product_catalogs`).
- **Settings:** `waba_app_id`, `waba_app_secret`, `waba_graph_api_version`, `waba_webhook_verify_token`.
- **Acceptance criteria:**
  - (only if kept) Given a code and ids, When posted, Then a row is stored connected with catalog id and the response redirects to /devices.
  - Given no App ID configured, Then 422 "Meta App credentials not configured."
- **Source refs:** `app/Http/Controllers/WaConnectWabaController.php`, `resources/views/user/connect/providers/waba.blade.php`, `resources/views/user/partials/connect-providers.blade.php`, `resources/js/charts/user-connect-wa-store.js`, `routes/web.php`.
- **Port notes:** Do not port the endpoint. Port only the useful idea of auto-creating or linking a Meta product catalog at connect into the catalog module (CAT) as an explicit "Link catalog" action.

## Data model

### `wa_provider_configs` (owned jointly with TW-WADEV; one row per connected sender)

Purpose: one row per connected WhatsApp sender of any engine (`waba`, `baileys` pointer, `twilio`) plus a `meta_ads` credential row. This domain owns every `provider='waba'` row. There is NO unique constraint on `workspace_id` (dropped 2026-05-29); a workspace holds many rows. Row volume: a handful per workspace (tens of thousands platform-wide at most). Not soft-deleted (hard delete on Remove).

| Column                                                          | Type                       | Null / default                                 | Behavior                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| --------------------------------------------------------------- | -------------------------- | ---------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`                                                            | bigint unsigned PK         | auto                                           | Also used as `conversations.device_id` (polymorphic with the Baileys `devices.id`) and `wa_templates.provider_config_id`.                                                                                                                                                                                                                                                                                                                                                              |
| `workspace_id`                                                  | bigint unsigned            | NOT NULL, FK `workspaces.id` ON DELETE CASCADE | Tenant key.                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `provider`                                                      | varchar(16)                | NOT NULL                                       | `waba`, `baileys`, `twilio`, `meta_ads` (enum `App\Enums\WaProvider` has the first three).                                                                                                                                                                                                                                                                                                                                                                                             |
| `status`                                                        | varchar(16)                | NOT NULL default `pending`                     | `pending`, `connected`, `disconnected`, `failed` (constants on the model). Disconnect sets `disconnected`; the legacy connect sets `failed` when any provisioning step errored.                                                                                                                                                                                                                                                                                                        |
| `credentials_json`                                              | text                       | NULL                                           | Laravel `Crypt::encrypt` of a JSON object; read through `creds()` which returns `[]` on decrypt failure (logged, indistinguishable from "no creds" for callers). WABA shape: `access_token`, `app_id`, `app_secret`, `waba_id`, `business_id`, `phone_number_id`, `register_pin`, `catalog_id`, `webhook_verify_token` (the modern flows store only `access_token` plus optional `app_id`/`app_secret` and later `register_pin`).                                                      |
| `meta_json`                                                     | longtext JSON              | NULL                                           | Plain JSON (cast array, NOT encrypted). WABA keys: `waba_id`, `phone_number_id`, `business_id`, `verified_name`, `display_phone_number`, `quality_rating` (GREEN/YELLOW/RED), `messaging_limit_tier` (`TIER_50`.. `TIER_UNLIMITED`), `code_verification_status`, `name_status`, `account_mode`, `throughput{level}`, `platform_type` (CLOUD_API, ON_PREMISE, COEXISTENCE, SMB_APP), `is_official_business_account`, `is_pin_enabled`, `last_onboarded_time`, `connected_via` (`manual` | `embedded`), `token_expires_at`, `coexistence` (true or absent), `inbound_wired` (true/false/null), `inbound_checked_at`, `wa_username`, `wa_username_status` (`reserved | approved`), `wa_username_at`, `catalog_id`, `errors`. |
| `phone_number`                                                  | varchar(32)                | NULL                                           | Display number as reported by Meta (may carry formatting; often empty for coexistence). Matching always strips to digits.                                                                                                                                                                                                                                                                                                                                                              |
| `display_label`                                                 | varchar(64)                | NULL                                           | Manual label or Meta verified name. QUIRK: the form allows 120 chars but the column holds 64.                                                                                                                                                                                                                                                                                                                                                                                          |
| `is_primary`                                                    | tinyint(1)                 | NOT NULL default 0                             | Default sender of the workspace across all providers.                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `connected_at`                                                  | timestamp                  | NULL                                           | Set at connect; cleared on disconnect.                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `last_health_at`                                                | timestamp                  | NULL                                           | Set at connect and on every health page load.                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `calling_enabled`, `calling_enabled_at`, `calling_enabled_meta` | tinyint / timestamp / JSON | default 0 / NULL                               | Owned by TW-CALL.                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `warmer_config`, `warm_day`, `warm_day_count`                   | JSON / date / int          | NULL / NULL / 0                                | Owned by TW-SCHED (warmer).                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `created_at`, `updated_at`                                      | timestamp                  | NULL                                           | Standard.                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |

Indexes: PK `id`; `(provider, status)`; `(workspace_id, is_primary)`; FK on `workspace_id`. Missing (port must add): unique `(phone_number_id)` and unique `(waba_id, phone_number_id)`, index `waba_id`. Written by TW-WABA-006, 009, 010, 012, 013, 014, 016 to 020, 021, 025, 026, 057; read by everything else. Enums: status above; `platform_type` from Meta.

### `wa_customer_profiles` (assigned by brief; commerce data)

Columns: `id`, `workspace_id` (bigint, no FK), `phone` varchar(32) digits-only, `name` varchar(255) null, `company` varchar(255) null, `address` text null, timestamps. Unique `(workspace_id, phone)`; indexes on `workspace_id`, `phone`. Written by TW-WABA-055/056; read by `OrderingService::shippingFor`.

### `waba_groups` (owned by TW-WFL; written by TW-WABA-040)

`provider_config_id` + `group_id` unique, `workspace_id`, `subject`, `description`, `invite_link`, `join_approval_mode`, `participant_count`, `suspended`, `creation_timestamp`, `synced_at`, `meta_json`. No FK to `wa_provider_configs`.

### Platform settings used (`system_settings`, key/value, some encrypted)

`waba_app_id`, `waba_app_secret` (encrypted), `waba_config_id`, `waba_coexistence`, `waba_webhook_verify_token` (encrypted), `waba_graph_api_version` (default `v23.0`), `waba_verify_by_ownership` (default true), `waba_dispatch_v2_enabled` (dead), `allowed_send_methods` (default all three), `default_send_method`, `campaign_retry_attempts` (3), `waba_meta_block_retry_backoff_hours` (2), `ffmpeg_path`, `baileys_server_url`, `node_webhook_token` (encrypted), `twilio_auth_token` (encrypted), `meta_ads_graph_api_version`, `meta_ads.*`. Env: `META_APP_SECRET` (legacy), `META_GRAPH_VERSION` (used by Node-facing endpoints and other controllers, default v21.0; installer writes v23.0), `SERVER_URL`.

### Tables written by webhook handlers but owned elsewhere

`conversations`, `inbox_messages`, `messages` (legacy), `contacts` (TIB1/CHAT/CON); `wp_campaign_contacts`, `wpcampaigns` (CAMP); `scheduled_message_contacts`, `broadcast_contacts`, `broadcasts` (BCAST); `wa_templates` (TPL); `wa_orders`, `wa_order_items`, `wa_products` (CHK/CAT); `wa_form_submissions` (WFL); `wa_calls` etc. (CALL); `waba_groups` (WFL). Only the columns listed in each feature are touched.

## Cross-domain contracts

**Consumes**

- TW-SET: platform settings store and its encrypted-keys list; the admin channel-setting page shell and the `admin/settings/providers` form/route (fields listed in TW-WABA-001).
- TW-WSP: workspaces (`current_workspace_id`, owner user id, `meta_agent_enabled`, `ai_responder_mode`, `business_hours`, `bill_to_platform_credit`, `currency`).
- TW-PLAN: `device_limit` through `PlanLimitGuard::check` (unified count across Baileys devices + WABA + Twilio rows), path paywall `plan_gates.php`, feature `access_wa_storefront`, `access_waba_calling`.
- TW-RBAC: workspace roles `admin` and `manager` via `EnsureWorkspaceRole`; platform `EnsureUserIsAdmin` + `IPAllowlist`.
- TW-NOTIF: `Audit::log` entries (`devices.waba_connect_manual`, `devices.waba_connect_embedded`, `devices.waba_set_primary`, `devices.waba_disconnect`, `devices.waba_remove`, `devices.waba_resubscribe`, `devices.waba_register`, `devices.waba_set_token`, `devices.waba_refresh_token`); FCM push `InboxPushNotifier`; realtime `MessageReceived` broadcast.
- TW-TIB1/CHAT/TIB2/AR/FLR/AIAG/CON: `ConversationResolver`, `Contact::rememberPhone`, `RoutingEngine`, `OptOutService`, `KeywordReplyDispatcher`, `AiAgentService`, `WaCopilotRouter`, Node `/api/flow/provider-inbound`.
- TW-BCAST/CAMP/WALLET: recipient tables and aggregates; `MessageBillingService::settleDelivered|settleFailed`; `WebhookService` outbound events.
- TW-TPL: `TemplatePayloadBuilder`, `TemplateClient`, `TemplateSyncSweeper::normalizeQualityScore`, `wa_templates`.
- TW-WFL: `WaFormSubmissionService`, `waba_groups`; TW-CHK: `WhatsAppPayService`, `CatalogOrderService`, `FlowSessionResolver`; TW-CALL: `WaCallingWebhookController::ingestCallsValue`.
- TW-NODE: `X-Node-Token` auth (`node_token()`), Node URL, `NodeCacheBuster`.

**Exposes**

- To all channel consumers: `wa_provider_configs` rows (credentials via `creds()`, ids via `meta_json`), `WaProviderConfig::primaryForWorkspace`, `scopeConnected`, `scopeMatchingPhoneNumber`, `setAsPrimary`.
- To TW-BSP: the `WaProviderConfig` saved hook (auto-attach of the credit line when a row becomes `connected`, TW-BSP-008); `wa_provider_configs.provider='waba' AND status='connected'` as the WABA picker source; `waba_id` inside credentials/meta.
- To TW-TPL/BCAST/CAMP/CHAT/FLR: `WabaMediaFetcher::downloadToDisk` and `extFor`, `MetaError::describe`, `WabaNumberRegistrar`, `WabaIdBackfiller::resolve`, the outbound send adapter behavior (TW-WABA-049).
- To TW-MADS: WABA identifiers (TW-WABA-054).
- To TW-NODE: `GET api/waba-creds` (TW-WABA-050) and the inbound mirror `POST api/inbound-message` (TW-WABA-048); `GET api/whatsapp-settings` (`WaConnectController@nodeSettings`, owned by WADEV/NODE) also returns the decrypted WABA token per phone.
- Webhook event contract (target): `whatsapp.connection.connected|disconnected|removed`, `message.received`, `message.delivery.updated`, `whatsapp.template.status_changed`, `whatsapp.form.submitted`, `whatsapp.payment.updated`, `whatsapp.call.event`.

## Open questions & quirks

Ownership and boundary notes

- `WaCustomerProfileController` + `WaCustomerProfile` + `user/store/customers/index.blade.php` were assigned to this domain by the brief but are commerce/storefront features (TW-CHK/STORE); documented as TW-WABA-055/056 so nothing is orphaned. Recommend moving on the next inventory pass.
- `MetaGraphClient` is the Meta Ads (Click-to-WhatsApp) Graph client, not WABA (TW-MADS); only the WABA-identifier fallback is documented here (TW-WABA-054). The brief listed it under WABA services.
- `DevicesController` mixes Baileys, Twilio, Instagram, Facebook and email actions with the WABA actions; this domain claims the `devices/waba/*` routes and the WABA code paths only. `GET devices`, `POST devices/billing-mode` (BSP), the unified table (`_channel_rows`) and the Baileys table belong to WADEV/BSP.
- `POST admin/settings/providers` (all channel fields in one form), `GET admin/settings/channel-setting/{section?}`, `GET api/whatsapp-settings` and `GET api/whatsapp-message-settings` are shared catch-all routes left to SET/WADEV/NODE; their WABA fields are documented in TW-WABA-001.
- `POST api/app/devices/connect-waba` (MOB) duplicates manual connect (TW-WABA-006) with differences: same validation, but the device cap is skipped for a reconnect of the same waba_id + phone_number_id; the subscribe step is a re-implemented simpler variant (one atomic override; on error 100 it plain-subscribes, sleeps 0.7 s and retries once, with no further retries); `connected_via='manual_app'`; the throughput, `is_pin_enabled`, `is_official_business_account` and `last_onboarded_time` fields are not stored; no audit entry; inbound wiring is returned in the response (`inbound_wired`) but not stamped or verified through `subscribed_apps`; it registers best-effort and flushes the engine and Node caches (`WorkspaceEngine::flush`, `NodeCacheBuster::bustWorkspace`), which the web path does not.
- `POST team-inbox/api/messages/{id}/retry-media` is claimed by TIB1; contract documented in TW-WABA-035. `POST team-inbox/sync-history` is claimed here (TW-WABA-028).
- Routes touching WABA that are deliberately left to other domains: `POST api/app/devices/connect-waba` (MOB); `POST api/commerce/waba-send-products` (FLR/CHK); `GET|POST api/waba-call/*` and `GET|POST webhooks/wa-calling` (CALL/NODE); `GET api/whatsapp-settings`, `GET api/whatsapp-message-settings` (NODE/WADEV); `GET|POST|DELETE waba-groups*` (WFL); `POST store/orders/{id}/whatsapp-pay` (CHK); `POST team-inbox/api/messages/{id}/retry-media` (TIB1); `POST admin/settings/providers` and `GET admin/settings/channel-setting/{section?}` (SET/WADEV shared forms); `GET devices`, `POST devices/billing-mode` (WADEV/BSP).
- The generic parts of the inbound pipeline (thread resolver, routing, opt-out, keyword, AI, flows) are described only at the call-order level in TW-WABA-034/036; their behavior belongs to TIB1/TIB2/AR/FLR/AIAG.
- Twilio inbound (`receiveTwilio`) lives in the same controller and URL (TW-WABA-047); Twilio provisioning belongs to WADEV.

Behavior worth flagging

- Two setting names for the Graph version: `waba_graph_api_version` (used everywhere) and `waba_graph_version` (used only by the ownership probe, so it always falls back to `v23.0`). The Node-facing endpoint uses env `META_GRAPH_VERSION` (default `v21.0`).
- `POST devices/waba/verify-token` calls `debug_token` with the WABA token itself as the caller; Meta usually requires an app access token, so a valid token may be reported invalid (the health page uses the app token for this reason).
- `token_expires_at` is stored for embedded connects but nothing reads it and there is no renewal job; the only expiry warning is the health page (7 days).
- `waba_dispatch_v2_enabled` is read by no code; the admin UI implies it switches routing. Treat as dead.
- Conversation analytics (free 1,000 service conversations/month) reflects Meta's pre-July-2025 pricing; verify before porting (TW-WABA-023).
- `display_label` validation allows 120 characters but the column is `varchar(64)`; a long label or verified name will error in strict MySQL mode.
- No uniqueness on `(waba_id, phone_number_id)` across workspaces: two workspaces can hold the same Meta number; the webhook resolver takes the first match, which can misroute inbound between tenants.
- The webhook receiver processes everything inline (media download up to ~60 s, a 12 s Node call) which risks exceeding Meta's timeout and triggering retries; retries are only partially idempotent (inbox dedup is a JSON lookup without a unique index; catalog order messages are not deduped).
- Media download uses the workspace primary/newest connected WABA token, not the receiving number's own token.
- `smb_message_echoes` threads are bound to the workspace's first Baileys device rather than the receiving WABA number, unlike live inbound.
- The WABA webhook path does not run the Shopify/WooCommerce COD reply, back-in-stock opt-in, WooCommerce concierge, catalog concierge or outside-business-hours reply that the Node mirror endpoint (TW-WABA-048) runs; WABA customers therefore miss those features (parity gap).
- Disconnect wipes credentials but never unsubscribes the app from the WABA or releases usernames/QR codes; webhooks keep arriving and inbound text is still stored.
- The health page shows the full access token to any workspace admin (masked by default); the docs' warning is the only control.
- The Register button is hidden in the unified multi-engine table (kept as a commented block) but shown on the single-engine card; coexistence rows never show it.
- `POST devices/waba/exchange-token`, `GET devices/waba/{id}/health.json` and the QR-code endpoints (TW-WABA-008/021/027) have no UI callers; `user/partials/connect-providers.blade.php` and `user/connect/providers/waba.blade.php` are included by nothing (TW-WABA-057).
- The admin hint tells operators to subscribe a `message_status` field; the code and Meta's WhatsApp Business Account webhook use the `messages` field for both messages and statuses. Treat `message_status` as a docs/UI inaccuracy.
- Docs page `getting-started/connect-channel.html` still describes a single active channel platform-wide; the code supports several engines per workspace (docs `channels/whatsapp.html` and `getting-started/multi-engine.html` are current).
- Docs claim manual connect works only with an App ID/Secret "so Reference can verify signatures"; the code treats them as optional and falls back to the platform secret or ownership verification.
- `meta_json` comments mention encryption (matching in PHP "even when stored encrypted") but the column is plain JSON.
- Status webhooks arrive from Meta only for messages sent with the same app/token subscription; messages sent through the customer's own app are signed by that app (hence the multi-secret verification).
- Audit entries exist for WABA device actions but not for the username, QR, sync-history and customer-profile actions.
- There is no rate limit on any webhook or diagnostic endpoint.
- Not read for this inventory: `app/Services/Waba/TemplateClient|TemplateImporter|TemplateLinter|TemplatePayloadBuilder|TemplateSender|TemplateSyncSweeper|LinkTracker|GroupClient|WhatsAppPayService` (assigned to TPL/WFL/CHK by content); only their WABA-domain touchpoints are described.

## Coverage

```json threadwise-coverage
{
  "routes": [
    "POST admin/settings/channel-setting/check-webhooks",
    "POST admin/settings/channel-setting/subscribe-webhooks",
    "POST devices/waba/connect/manual",
    "POST devices/waba/connect/embedded",
    "POST devices/waba/verify-token",
    "POST devices/waba/exchange-token",
    "POST devices/waba/{id}/register",
    "POST devices/waba/{id}/resubscribe",
    "GET devices/waba/{id}/webhook-check",
    "POST devices/waba/{id}/primary",
    "DELETE devices/waba/{id}/disconnect",
    "DELETE devices/waba/{id}/remove",
    "POST devices/waba/{id}/set-token",
    "POST devices/waba/{id}/token-refresh",
    "GET devices/waba/{id}/health",
    "GET devices/waba/{id}/health.json",
    "POST devices/waba/{id}/username",
    "DELETE devices/waba/{id}/username",
    "POST devices/waba/{id}/qr-codes",
    "DELETE devices/waba/{id}/qr-codes/{code}",
    "POST devices/waba/{id}/sync-history",
    "POST team-inbox/sync-history",
    "GET webhooks/whatsapp/inbound",
    "POST webhooks/whatsapp/inbound",
    "POST api/inbound-message",
    "GET api/waba-creds",
    "GET store/customers",
    "POST store/customers",
    "DELETE store/customers/{id}",
    "POST connect/wa-store/waba"
  ],
  "controllers": [
    "app/Http/Controllers/WaConnectWabaController.php",
    "app/Http/Controllers/WaWebhookController.php",
    "app/Http/Controllers/WaInboundController.php",
    "app/Http/Controllers/WaCustomerProfileController.php",
    "app/Http/Controllers/DevicesController.php"
  ],
  "services": [
    "app/Services/WabaHealthService.php",
    "app/Services/Waba/MetaError.php",
    "app/Services/Waba/WabaIdBackfiller.php",
    "app/Services/Waba/WabaMediaFetcher.php",
    "app/Services/Waba/WabaNumberRegistrar.php",
    "app/Services/Waba/MetaTemplateAnalyticsService.php",
    "app/Services/MetaGraphClient.php",
    "app/Services/InboxDispatcher.php",
    "app/Services/WhatsAppDispatcher.php",
    "app/Support/Audio/WebmOpusToOgg.php"
  ],
  "models": ["WaProviderConfig", "WaCustomerProfile", "WabaGroup"],
  "tables": ["wa_provider_configs", "wa_customer_profiles", "waba_groups"],
  "views": [
    "resources/views/user/devices/_waba_section.blade.php",
    "resources/views/user/devices/_waba_modals.blade.php",
    "resources/views/user/devices/_inbound_badge.blade.php",
    "resources/views/user/devices/waba-health.blade.php",
    "resources/views/user/devices/_channel_rows.blade.php",
    "resources/views/user/connect/providers/waba.blade.php",
    "resources/views/user/partials/connect-providers.blade.php",
    "resources/views/user/store/customers/index.blade.php",
    "resources/views/admin/settings/channel-setting.blade.php"
  ],
  "commands": ["waba:sync-template-clicks"],
  "permissions": [],
  "middleware": [],
  "node_files": [],
  "js_assets": [
    "resources/js/charts/user-devices-index.js",
    "resources/js/charts/user-connect-wa-store.js"
  ],
  "misc_files": [],
  "config_files": [],
  "doc_pages": [
    "Documentation/pages/getting-started/coexistence.html",
    "Documentation/pages/channels/whatsapp.html",
    "Documentation/pages/bsp-billing/meta-setup.html",
    "Documentation/pages/getting-started/connect-channel.html",
    "Documentation/pages/getting-started/channel-settings.html"
  ],
  "feature_map": {
    "TW-WABA-001": [],
    "TW-WABA-002": ["POST admin/settings/channel-setting/check-webhooks"],
    "TW-WABA-003": ["POST admin/settings/channel-setting/subscribe-webhooks"],
    "TW-WABA-004": [],
    "TW-WABA-005": [],
    "TW-WABA-006": ["POST devices/waba/connect/manual"],
    "TW-WABA-007": ["POST devices/waba/verify-token"],
    "TW-WABA-008": ["POST devices/waba/exchange-token"],
    "TW-WABA-009": ["POST devices/waba/connect/embedded"],
    "TW-WABA-010": ["POST devices/waba/connect/embedded"],
    "TW-WABA-011": [],
    "TW-WABA-012": ["POST devices/waba/{id}/register"],
    "TW-WABA-013": [],
    "TW-WABA-014": ["POST devices/waba/{id}/resubscribe"],
    "TW-WABA-015": ["GET devices/waba/{id}/webhook-check"],
    "TW-WABA-016": ["POST devices/waba/{id}/primary"],
    "TW-WABA-017": ["DELETE devices/waba/{id}/disconnect"],
    "TW-WABA-018": ["DELETE devices/waba/{id}/remove"],
    "TW-WABA-019": ["POST devices/waba/{id}/set-token"],
    "TW-WABA-020": ["POST devices/waba/{id}/token-refresh"],
    "TW-WABA-021": ["GET devices/waba/{id}/health", "GET devices/waba/{id}/health.json"],
    "TW-WABA-022": [],
    "TW-WABA-023": [],
    "TW-WABA-024": [],
    "TW-WABA-025": ["POST devices/waba/{id}/username", "DELETE devices/waba/{id}/username"],
    "TW-WABA-026": ["POST webhooks/whatsapp/inbound"],
    "TW-WABA-027": ["POST devices/waba/{id}/qr-codes", "DELETE devices/waba/{id}/qr-codes/{code}"],
    "TW-WABA-028": ["POST devices/waba/{id}/sync-history", "POST team-inbox/sync-history"],
    "TW-WABA-029": ["GET webhooks/whatsapp/inbound"],
    "TW-WABA-030": ["POST webhooks/whatsapp/inbound"],
    "TW-WABA-031": ["POST webhooks/whatsapp/inbound"],
    "TW-WABA-032": [],
    "TW-WABA-033": [],
    "TW-WABA-034": [],
    "TW-WABA-035": [],
    "TW-WABA-036": [],
    "TW-WABA-037": ["POST webhooks/whatsapp/inbound"],
    "TW-WABA-038": [],
    "TW-WABA-039": [],
    "TW-WABA-040": [],
    "TW-WABA-041": [],
    "TW-WABA-042": [],
    "TW-WABA-043": [],
    "TW-WABA-044": [],
    "TW-WABA-045": [],
    "TW-WABA-046": [],
    "TW-WABA-047": ["POST webhooks/whatsapp/inbound"],
    "TW-WABA-048": ["POST api/inbound-message"],
    "TW-WABA-049": [],
    "TW-WABA-050": ["GET api/waba-creds"],
    "TW-WABA-051": [],
    "TW-WABA-052": [],
    "TW-WABA-053": [],
    "TW-WABA-054": [],
    "TW-WABA-055": ["GET store/customers", "POST store/customers"],
    "TW-WABA-056": ["DELETE store/customers/{id}"],
    "TW-WABA-057": ["POST connect/wa-store/waba"]
  }
}
```
