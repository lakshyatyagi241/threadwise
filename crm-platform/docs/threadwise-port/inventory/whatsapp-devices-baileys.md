---
domain: whatsapp-devices-baileys
code: WADEV
title: WhatsApp Devices, Baileys (QR) Engine, Multi-Engine Resolution & Per-Number Proxy Isolation
threadwise_version: '1.7.0'
sources_read: 92
---

# WhatsApp Devices, Baileys (QR) Engine, Multi-Engine Resolution & Per-Number Proxy Isolation

## Overview

This domain makes a WhatsApp number usable inside a workspace. Reference sends WhatsApp through three interchangeable "engines": the **Unofficial API** (internal slug `baileys`: a phone linked like WhatsApp Web through the bundled Node bridge), the **Meta Cloud API** (`waba`, owned by the `whatsapp-cloud-api-waba` domain) and **Twilio WhatsApp** (`twilio`). This file owns everything that decides which engine a workspace may use, the Baileys device lifecycle (add number, QR or 8-character pairing code, status, disconnect, delete, reconnect, session persistence), the per-number proxy (IP isolation) feature, the Twilio connect/remove path, the send-time engine resolver, and the admin device console. The WABA-specific screens and endpoints that live in the same `DevicesController` (`devices/waba/*`, health, username, QR-codes), the Instagram/Email mirror endpoints (`devices/instagram/*`, `devices/email/*`) and the billing-mode endpoint (`devices/billing-mode`) are deliberately left to WABA, IG, MAIL and BSP; they are listed under Open questions so nothing is orphaned.

Who uses it:

- **Platform super-admin** picks which engines are enabled platform-wide and which one is the default, sets the Node bridge URL and the shared `X-Node-Token`, and has a platform-wide device console (list, filter, export, force-disconnect, re-sync, delete).
- **Workspace owner / admin** (workspace role `admin` or above; agents, managers and viewers are redirected away) opens `/devices` ("Omni channels" hub), adds a number, pairs it by QR or pairing code, edits it, sets an optional per-number proxy (plan-gated), disconnects or deletes it, and connects a Twilio sender.
- **The Node bridge** (machine caller, authenticated with the shared secret) holds one Baileys socket per paired number, persists auth files, pushes status changes, sends a 30-second heartbeat, fetches a device's proxy at connect time, and forwards inbound/phone-sent messages.
- **Every other domain** consumes devices as senders (campaigns, broadcasts, chat, team inbox, flows, auto-reply, scheduled, warmer) through the sender-key and engine-resolution services described here.

Main flow end to end (Baileys): admin sets Node URL + token and enables the "Unofficial API" engine -> workspace admin clicks Add device, enters name, phone (country code + national number), optional assignee and "activate after pairing" -> a `devices` row is created with `status=disconnected, active=false` after the plan cap and a per-workspace duplicate-phone check -> the modal asks Laravel for a QR; Laravel terminates any stale Node session for that number, then asks Node to initialize the client; Node builds a fresh Baileys socket, waits up to 30 s for the first QR string and returns it; the browser renders the QR locally and polls `connection-status` every 1.5-2 s -> once the phone scans, Node reaches connection `open`, checks that the linked account number equals the number on the row, marks its in-memory client ready and reports "Ready" -> Laravel's next poll flips the row to `connected` (and `active=true` when "activate after pairing" was on) -> from then on the 30-second Node heartbeat, the browser's 10-second `/devices/check` loop and Node's own reconnect/backoff/health watchdog keep the state honest, with notifications on transitions.

Plan tiers: `device_limit` (default 1 on the package table; NULL/0 = unlimited) caps the UNIFIED number count across Baileys devices plus WABA and Twilio rows; `access_proxy_isolation` (default off) gates the proxy panel and both proxy endpoints. The platform admin's enabled-engine set and each workspace's optional `enabled_engines` subset gate which connect cards render.

Connections to other domains: `platform-settings-branding-storage` (SET: `system_settings` keys such as `allowed_send_methods`, `baileys_server_url`), `node-bridge-runtime` (NODE: the bridge process and its HTTP surface; this file documents the device/session slice), `whatsapp-cloud-api-waba` (WABA: `wa_provider_configs` provider=waba rows, Embedded Signup, health), `channel-sms` / `channel-instagram` / `channel-email` / `channel-facebook` (rows woven into the hub table), `bsp-billing-engine` (BSP: `devices/billing-mode`), `notifications-activity-audit` (NOTIF: `device_connected`/`device_disconnected` events, audit observer), `plans-subscriptions-trials` (PLAN: `PlanLimitGuard`, `device_limit`, `access_proxy_isolation`), `workspaces-teams-tenancy` (WSP: `workspaces.enabled_engines`/`default_engine`, impersonation), `roles-permissions` (RBAC: `EnsureWorkspaceRole`), `chat-conversations` / `team-inbox-conversations` (CHAT/TIB1: `conversations.device_id`, status pill), `broadcasts` / `campaigns` / `scheduled-queue-warmer` / `flow-runtime-engine` / `auto-reply-keywords` (sender pickers and the warmer columns on `devices`), `mobile-app-api` (MOB: `api/app/devices*` mirror), `developer-rest-api-v1` (API: `api/v1/devices`), `chrome-extension-sheets-addon` (EXT: `api/get-devices`), `admin-console-shell` (ASHELL: connect-device popover, hub tiles).

Important truths a rebuilder must not miss (details in the features and in Open questions):

1. Baileys numbers live in the `devices` table (name, country code and phone encrypted at rest); WABA/Twilio/SMS numbers live in `wa_provider_configs`. A "baileys" `wa_provider_configs` row exists only when the legacy `/connect` wizard endpoint was used, and the Node status callback `POST api/update-status` only knows how to find THAT row, so for numbers paired from `/devices` the callback is effectively a no-op and status is learned by polling (TW-WADEV-019).
2. `devices.sent_24h` / `failed_24h` are never incremented by any code; every "Sent 24h" cell and KPI for Baileys numbers reads seeded values (0 in practice).
3. `devices.status` values `needs_pair` and `failed` have no live producer except the legacy status callback and the (unreachable from the UI) status field on the update endpoint.
4. The per-workspace `enabled_engines` / `default_engine` columns are read by the engine resolver but nothing in the app writes them.
5. Sessions are keyed in Node by digits-only phone alone (folder `session_<digits>`), not by workspace, so two workspaces pairing the same number collide.

## Feature index

| Id           | Feature                                                                         | Status      | Priority | Effort | Depends on                               |
| ------------ | ------------------------------------------------------------------------------- | ----------- | -------- | ------ | ---------------------------------------- |
| TW-WADEV-001 | Multi-engine model and per-workspace engine resolution                          | implemented | P0       | M      | -                                        |
| TW-WADEV-002 | Admin: enabled engines and default engine                                       | implemented | P0       | M      | TW-WADEV-001                             |
| TW-WADEV-003 | Admin: Node bridge URL, shared token, test connection                           | implemented | P0       | M      | -                                        |
| TW-WADEV-004 | Unified device cap (plan `device_limit`)                                        | implemented | P0       | S      | TW-WADEV-001                             |
| TW-WADEV-005 | Channels hub page (`/devices`)                                                  | implemented | P0       | L      | TW-WADEV-001, TW-WADEV-024               |
| TW-WADEV-006 | Add a Baileys device                                                            | implemented | P0       | M      | TW-WADEV-004, TW-WADEV-024               |
| TW-WADEV-007 | QR pairing flow                                                                 | implemented | P0       | L      | TW-WADEV-006, TW-WADEV-021, TW-WADEV-023 |
| TW-WADEV-008 | Pairing-code flow                                                               | implemented | P1       | M      | TW-WADEV-006, TW-WADEV-021               |
| TW-WADEV-009 | Connection status polling and manual mark-connected                             | implemented | P0       | S      | TW-WADEV-007                             |
| TW-WADEV-010 | Edit device details                                                             | implemented | P1       | S      | TW-WADEV-006                             |
| TW-WADEV-011 | Toggle device active flag                                                       | implemented | P2       | S      | TW-WADEV-006                             |
| TW-WADEV-012 | Disconnect (kill session)                                                       | implemented | P0       | S      | TW-WADEV-023                             |
| TW-WADEV-013 | Delete device                                                                   | implemented | P0       | S      | TW-WADEV-012                             |
| TW-WADEV-014 | Manual and background status check with grace window                            | implemented | P0       | M      | TW-WADEV-023                             |
| TW-WADEV-015 | Device status change fan-out (notification, webhook, audit, broadcast)          | partial     | P1       | M      | TW-WADEV-014, TW-WADEV-019               |
| TW-WADEV-016 | Per-number proxy: save (plan-gated)                                             | implemented | P1       | M      | TW-WADEV-006                             |
| TW-WADEV-017 | Per-number proxy: test                                                          | implemented | P1       | S      | TW-WADEV-016                             |
| TW-WADEV-018 | Node proxy resolution, fail-closed preflight and result callback                | implemented | P1       | M      | TW-WADEV-016, TW-WADEV-021               |
| TW-WADEV-019 | Node status callback (`api/update-status`)                                      | partial     | P0       | M      | TW-WADEV-021                             |
| TW-WADEV-020 | Node heartbeat: liveness, stale sweep, idle logout                              | implemented | P0       | M      | TW-WADEV-021                             |
| TW-WADEV-021 | Baileys session lifecycle in the Node bridge                                    | implemented | P0       | XL     | -                                        |
| TW-WADEV-022 | Session persistence, auto-restore and graceful shutdown                         | implemented | P0       | M      | TW-WADEV-021                             |
| TW-WADEV-023 | Node bridge client-control API and API auth guard                               | implemented | P0       | M      | TW-WADEV-021                             |
| TW-WADEV-024 | Device visibility scoping and lookup by phone                                   | implemented | P0       | M      | -                                        |
| TW-WADEV-025 | Twilio WhatsApp connect                                                         | implemented | P1       | M      | TW-WADEV-004                             |
| TW-WADEV-026 | Twilio remove                                                                   | implemented | P1       | S      | TW-WADEV-025                             |
| TW-WADEV-027 | Legacy wizard: Baileys pointer connect, polling and disconnect                  | partial     | P2       | M      | TW-WADEV-021                             |
| TW-WADEV-028 | Connect pages (`/connect`, wizard shell, unused provider views)                 | partial     | P2       | S      | TW-WADEV-027                             |
| TW-WADEV-029 | Send-time engine (provider) resolution                                          | implemented | P0       | L      | TW-WADEV-001                             |
| TW-WADEV-030 | Baileys dispatch through the Node bridge                                        | implemented | P0       | M      | TW-WADEV-029, TW-WADEV-021               |
| TW-WADEV-031 | Baileys-only message actions (react, pin, star)                                 | implemented | P2       | S      | TW-WADEV-030                             |
| TW-WADEV-032 | Unified sender keys and picker resolution                                       | implemented | P0       | M      | TW-WADEV-001, TW-WADEV-024               |
| TW-WADEV-033 | Inbound and phone-sent message capture from linked sessions                     | implemented | P0       | L      | TW-WADEV-021                             |
| TW-WADEV-034 | Delivery-receipt forwarding from linked sessions                                | implemented | P1       | S      | TW-WADEV-021                             |
| TW-WADEV-035 | Device detail and analytics page                                                | implemented | P1       | M      | TW-WADEV-024                             |
| TW-WADEV-036 | Connect-device popover embed mode                                               | implemented | P2       | S      | TW-WADEV-005                             |
| TW-WADEV-037 | Admin platform devices list                                                     | implemented | P1       | M      | TW-WADEV-024                             |
| TW-WADEV-038 | Admin device detail and analytics                                               | implemented | P2       | M      | TW-WADEV-037                             |
| TW-WADEV-039 | Admin force-disconnect                                                          | implemented | P1       | S      | TW-WADEV-023                             |
| TW-WADEV-040 | Admin re-sync and bulk re-sync                                                  | implemented | P2       | S      | TW-WADEV-023                             |
| TW-WADEV-041 | Admin CSV export                                                                | implemented | P2       | S      | TW-WADEV-037                             |
| TW-WADEV-042 | Admin remove device                                                             | implemented | P1       | S      | TW-WADEV-039                             |
| TW-WADEV-043 | No-bridge demo mode                                                             | implemented | P2       | S      | TW-WADEV-007                             |
| TW-WADEV-044 | Staff permission keys `devices.*`                                               | dead-code   | P2       | S      | -                                        |
| TW-WADEV-045 | Docs-only and hidden claims (device balancing, transfer ownership, region rail) | docs-only   | P2       | S      | -                                        |
| TW-WADEV-046 | Demo device seeder                                                              | implemented | P2       | S      | -                                        |

## Features

### TW-WADEV-001 — Multi-engine model and per-workspace engine resolution

- **Status:** implemented (the per-workspace `enabled_engines` subset and `default_engine` columns are honoured when present but have no UI or API that writes them)
- **Priority:** P0 (product unusable without)
- **Effort:** M
- **Depends on:** -
- **Summary:** One service (`WorkspaceEngine`) is the single answer to "which engines may this workspace use, which is its default, and which connected senders exist". A workspace can run any subset of `baileys`, `waba`, `twilio` at once; non-WhatsApp channels (Instagram, Facebook, Telegram, LINE, WeChat, Viber, SMS, Email) reuse the same sender-key vocabulary but are never WhatsApp engines.
- **Actors & access:** internal service used by every page and send path; no direct endpoint. Platform scope for the allowed set, workspace scope for the resolution.
- **UX & screens:** no screen of its own. Drives which connect cards and tables the `/devices` hub renders (TW-WADEV-005) and which engine badges (`Unofficial API` / `Meta` / `Twilio`) appear. Engine descriptors: `waba` = channel meta, label "Meta", code W; `twilio` = "Twilio", T; `baileys` (and any unknown value) = "Unofficial API", code U; the side channels have their own labels (Instagram I, Facebook F, Telegram T, LINE L, WeChat W, Viber V, SMS S, Email E).
- **Endpoints:** none.
- **Data:** reads `system_settings.allowed_send_methods` (JSON array of provider keys), `default_send_method`, `workspaces.enabled_engines` (JSON array or null), `workspaces.default_engine` (string or null, currently never read), `wa_provider_configs` (provider, status, is_primary, connected_at) and `devices` (existence per workspace).
- **Rules & edge cases:**
  1. Vocabulary: engine keys are `waba`, `baileys`, `twilio`; the admin UI uses different slugs (`business-api` = waba, `wa-api` = baileys, `twilio`) mapped on save (TW-WADEV-002). Legacy platform codes `W` (baileys), `WB` (waba), `T` (twilio) survive on scheduled/legacy records (`WaProvider::fromLegacyCode`; any other code falls back to baileys).
  2. Allowed set = `allowed_send_methods`; when the setting is missing the resolver defaults to `['baileys']` while the /devices controller and the dispatcher default to `['waba','baileys','twilio']` (inconsistent defaults; QUIRK, see Open questions). An empty array is treated as `['baileys']`.
  3. `for(workspace)` (the workspace's DEFAULT engine): (a) no workspace -> platform default (`default_send_method`, fallback baileys); (b) the workspace's `is_primary` provider row whose provider is in the allowed set and is not `meta_ads`; (c) else the most recently connected allowed provider row; (d) else the platform default. Result cached per request; `flush()` clears the caches and MUST be called after any primary/config change in the same request.
  4. `provider=meta_ads` rows are Click-to-WhatsApp ad credentials, never engines; every resolver query excludes them.
  5. `enginesFor(workspace)` = engines the workspace can send through NOW: intersection of the allowed set, the workspace's connected provider rows (a baileys engine also counts as connected when the workspace owns any `devices` row, or, for a legacy install with zero connected provider rows, when a NULL-workspace device exists) and the optional `enabled_engines` subset; default engine first; never empty (falls back to the default engine).
  6. `availableFor(workspace)` = allowed set intersected with the workspace subset WHETHER OR NOT connected (so a first connection can be started); default first; never empty; used to decide which connect cards `/devices` renders. The controller then adds any engine the workspace has already connected (waba/twilio) even if not allowed, for display and management only.
  7. `isEngineAllowed`, `allowedEngineLabels` ("WABA", "Unofficial API", "Twilio") and `allowedEnginesSentence` ("A, B or C") supply UI copy; only admin-enabled engines are ever named.
  8. `ownsSender(model, workspace)` is the authorization twin of the listing rule: a model is owned when its `workspace_id` equals the workspace, or (Device only, `workspace_id` NULL) when the current user is its pairer and the session is not an impersonation.
  9. `senderDeviceQuery` returns the Baileys device query only when the default engine is baileys, else null.
  10. `allEngines()` is the ungated full vocabulary (baileys, waba, twilio, instagram, facebook, telegram, line, wechat, viber, sms, email); each branch of `senders()` applies its own platform toggle and connected check.
- **Async & events:** none. Per-request static caches only.
- **External systems:** none.
- **Settings:** `allowed_send_methods`, `default_send_method`, `active_engine_slug` (UI back-compat), `workspaces.enabled_engines`, `workspaces.default_engine`.
- **Acceptance criteria:**
  - Given the platform allows only `["waba"]` and a workspace has a connected Baileys device, When `enginesFor` runs, Then baileys is excluded and the result is the default engine only.
  - Given a workspace has a primary Twilio row and a connected WABA row, When `for` runs, Then it returns `twilio` (primary wins); When the Twilio row is removed, Then it returns `waba`.
  - Given a `meta_ads` row is the only connected row, When `for` runs, Then it returns the platform default, never `meta_ads`.
  - Given `enabled_engines = ["baileys"]` on a workspace, When `availableFor` runs, Then waba and twilio are absent even if the platform allows them.
- **Source refs:** app/Services/WorkspaceEngine.php, app/Enums/WaProvider.php, app/Models/Workspace.php (enabled_engines, default_engine), database/migrations/2026_06_15_120000_add_multi_engine_to_workspaces.php, Documentation/pages/getting-started/multi-engine.html, Documentation/pages/developer-guide/engines.html.
- **Port notes:** new module `apps/api/src/modules/channels` (engine registry + resolver) on top of the existing `apps/api/src/infra/providers/whatsapp/whatsapp.port.ts`; model an engine as a `provider` enum on a `channel_accounts` row instead of two tables, keep `is_primary` as a partial unique index per org, and give the workspace-level subset/default a real settings endpoint (Reference has none). Replace the per-request static caches with request-scoped memoization. Fix the inconsistent default of the allowed set (pick one, seed it).

### TW-WADEV-002 — Admin: enabled engines and default engine

- **Status:** implemented
- **Priority:** P0 (product unusable without)
- **Effort:** M
- **Depends on:** TW-WADEV-001
- **Summary:** The super-admin chooses which WhatsApp engines are enabled for the whole platform (any non-empty subset of Unofficial API, Meta Business API, Twilio) and which one is the platform default for sends that do not pin a sender.
- **Actors & access:** platform admin; middleware Authenticate + EnsureUserIsAdmin + IPAllowlist. Platform scope.
- **UX & screens:** the "Sending providers"/WhatsApp section of `resources/views/admin/settings/channel-setting.blade.php` (Channels hub; owned with SET): three engine cards with an enable checkbox each plus a radio for the default; a hidden `_return_section` field returns the admin to the channel detail page (`whatsapp`, `facebook`, `telegram`, `line`, `wechat`, `viber`, `tiktok`, `sms`, `email`) or the hub landing. The same POST also carries Meta app fields, Twilio defaults, the other channel toggles, sender pacing and registration-OTP knobs; those belong to WABA/SET/NODE/SCHED/AUTH and are only referenced here.
- **Endpoints:**
  | METHOD uri                    | route name                      | Controller@action                            | middleware                                   | request fields                                                                                                                                                                                                                                           | response                                                                                                                            |
  | ----------------------------- | ------------------------------- | -------------------------------------------- | -------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
  | POST admin/settings/providers | admin.settings.providers.update | AdminPagesController@settingsProvidersUpdate | Authenticate, EnsureUserIsAdmin, IPAllowlist | `allowed_send_methods` array required min 1, each in `twilio`,`wa-api`,`business-api`; `default_engine` nullable in the same set; `baileys_server_url` nullable url max 191; `node_webhook_token` nullable string max 191; plus the other channel fields | redirect to `admin.settings.channel-setting` (with `section` when `_return_section` is valid) with flash "Provider settings saved." |
- **Data:** writes `system_settings`: `allowed_send_methods` (json list of provider keys), `default_send_method` (string provider key), `active_engine_slug` (the UI slug of the default), `baileys_server_url`, and the other keys; audit only via generic settings logging.
- **Rules & edge cases:**
  1. Slug map on save: `twilio` -> `twilio`, `wa-api` -> `baileys`, `business-api` -> `waba`. The enabled list is de-duplicated preserving order.
  2. The default must be one of the enabled providers; when the posted default is absent or not enabled, the first enabled provider becomes the default (silent correction).
  3. Turning an engine off hides it from every picker immediately; existing connected rows are kept but are ignored by `WorkspaceEngine` (they cannot be resolved as the workspace engine).
  4. Secrets (`waba_app_secret`, `twilio_auth_token`, `node_webhook_token`, `telegram_api_hash`, ...) are only overwritten when a non-empty value is posted; a blank secret keeps the stored one.
  5. After saving, Laravel best-effort asks the Node bridge to re-pull its settings (`GET /api/refresh-settings`) and flushes all per-phone caches (`POST /api/cache-bust`); failures never block the save. `baileys_server_url` is also mirrored into the app `.env` as `SERVER_URL`, and the token into `NODE_WEBHOOK_TOKEN` (`EnvWriter`).
  6. The whole form is one POST: a partial save of only the engine cards still rewrites every other field it carries (booleans use "checkbox present" semantics).
- **Async & events:** `NodeCacheBuster::refreshNodeSettings()` and `bustAll()` HTTP calls to the bridge (timeouts 4 s / 2 s).
- **External systems:** Node bridge admin endpoints (`/api/refresh-settings`, `/api/cache-bust`) with `X-Node-Token`.
- **Settings:** listed under Data. Seeded reference DB has `allowed_send_methods=["waba"]`, `default_send_method=waba`, `active_engine_slug=business-api`.
- **Acceptance criteria:**
  - Given the admin ticks Unofficial API and Twilio and picks Twilio as default, When they save, Then `allowed_send_methods=["baileys","twilio"]`, `default_send_method="twilio"` and the success flash appears.
  - Given the admin posts only `wa-api` enabled but `default_engine=twilio`, When saved, Then the default is corrected to `baileys`.
  - Given the admin posts an empty `allowed_send_methods`, When saved, Then validation fails and nothing changes.
  - Given a blank `twilio_auth_token`, When saved, Then the stored token is unchanged.
- **Source refs:** app/Http/Controllers/AdminPagesController.php (settingsProvidersUpdate, ~lines 1529-1780), resources/views/admin/settings/channel-setting.blade.php, app/Services/NodeCacheBuster.php, Documentation/pages/getting-started/channel-settings.html.
- **Port notes:** platform settings live in `system_settings`-style table owned by SET; expose a typed `PlatformEngineSettings` (enabled engines, default) via `apps/api/src/modules/admin`. Drop the `.env` mirroring (no runtime `.env` writes; keep the bridge URL/token in the secret store). Emit a `settings.engines_changed` outbox event and let the bridge subscribe instead of being pinged.

### TW-WADEV-003 — Admin: Node bridge URL, shared token, test connection

- **Status:** implemented
- **Priority:** P0 (product unusable without)
- **Effort:** M
- **Depends on:** -
- **Summary:** The admin stores the Node bridge base URL and the shared secret used in both directions (`X-Node-Token`), can test reachability plus token acceptance before saving, and Laravel then tells the bridge to reload its settings.
- **Actors & access:** platform admin (Authenticate, EnsureUserIsAdmin, IPAllowlist).
- **UX & screens:** Channels hub landing panel in `admin/settings/channel-setting.blade.php`: "Server URL" input, "Node webhook token" masked input (blank keeps the stored value), "Test connection" button (AJAX) and Save. Test result is a one-line message: success "Connected — bridge reachable and token accepted."; token rejected (HTTP 401/403) "Reached the bridge but the token was rejected (code)..."; other HTTP status message; unreachable "Could not reach the bridge — check the URL and that the Node service is running."; invalid URL 422 "Enter a valid Server URL (http:// or https://) first.".
- **Endpoints:**
  | METHOD uri                                    | route name                 | Controller@action                             | middleware                                   | request fields                                                                          | response                                                        |
  | --------------------------------------------- | -------------------------- | --------------------------------------------- | -------------------------------------------- | --------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
  | POST admin/settings/channel-setting/node      | admin.settings.node.update | AdminPagesController@settingsNodeBridgeUpdate | Authenticate, EnsureUserIsAdmin, IPAllowlist | `baileys_server_url` nullable url max 191; `node_webhook_token` nullable string max 191 | redirect to channel-setting with flash "Node bridge saved."     |
  | POST admin/settings/channel-setting/node/test | admin.settings.node.test   | AdminPagesController@testNodeBridge           | same                                         | `baileys_server_url` (required http/https), `node_webhook_token` (blank = use stored)   | JSON `{ok, message}` (HTTP 200 except the 422 invalid-URL case) |
- **Data:** `system_settings.baileys_server_url` (string) and `node_webhook_token` (encrypted at rest; legacy key `baileys_callback_token` is read as a fallback); also `.env` `SERVER_URL` and `NODE_WEBHOOK_TOKEN` mirrored by `EnvWriter`.
- **Rules & edge cases:**
  1. Resolution order used everywhere: URL = `system_settings.baileys_server_url` else `.env SERVER_URL` (trailing slash stripped, `tw_node_url()`); token = `node_webhook_token` else legacy `baileys_callback_token` else `.env NODE_WEBHOOK_TOKEN` (`node_token()`).
  2. The token typed here must equal the bridge's own `node/.env NODE_WEBHOOK_TOKEN`; a mismatch fails closed and silently (bridge calls to Laravel get 403; Laravel-to-bridge calls get 401 when the bridge runs in token mode).
  3. The test hits `GET {url}/api/refresh-settings` with a 5 s timeout, which also makes the bridge re-pull its settings as a side effect.
  4. The token is saved only when the admin typed one.
  5. Saving triggers `NodeCacheBuster::refreshNodeSettings()` (best effort, 4 s).
  6. Per-workspace or per-request server URL override exists only in the legacy wizard (`server_url` field, TW-WADEV-027).
- **Async & events:** HTTP ping to the bridge; nothing queued.
- **External systems:** Node bridge (`GET /api/refresh-settings`).
- **Settings:** `baileys_server_url`, `node_webhook_token`, `.env SERVER_URL`, `.env NODE_WEBHOOK_TOKEN`, bridge-side `NODE_WEBHOOK_TOKEN`, `APP_DOMAIN_NAME`, `PORT`, `NODE_API_AUTH`.
- **Acceptance criteria:**
  - Given a reachable bridge and matching token, When the admin clicks Test connection, Then the panel shows the connected message and nothing is saved.
  - Given a wrong token in token-mode, When tested, Then the message says the token was rejected.
  - Given the admin saves with a blank token field, When the form posts, Then the stored token is unchanged and the URL updates.
  - Given a non-http URL, When tested, Then a 422 with the invalid-URL message is returned.
- **Source refs:** app/Http/Controllers/AdminPagesController.php (settingsNodeBridgeUpdate, testNodeBridge), app/Support/fc_helpers.php (node_token, tw_node_url), app/Services/NodeCacheBuster.php, Documentation/pages/getting-started/channel-settings.html, Documentation/pages/getting-started/connect-channel.html.
- **Port notes:** the port's bridge is a separate worker service (`apps/baileys-bridge` or a queue-driven worker under ADR-0010); replace the shared-secret HTTP with mutual auth (signed JWT or mTLS) and per-org bridge routing. Keep a "test connection" endpoint that verifies both reachability and credential acceptance.

### TW-WADEV-004 — Unified device cap (plan `device_limit`)

- **Status:** implemented
- **Priority:** P0 (product unusable without)
- **Effort:** S
- **Depends on:** TW-WADEV-001
- **Summary:** The plan's `device_limit` ("WhatsApp numbers") caps the total of Baileys devices plus WABA and Twilio numbers a workspace may hold; a Baileys add, a Twilio connect and the legacy wizard are refused once the cap is reached.
- **Actors & access:** anyone who can add a number; enforced server-side by `PlanLimitGuard::check`. Platform admins (Spatie role Super Admin/Admin or legacy `users.role` admin) bypass every plan limit.
- **UX & screens:** the hub footer shows "Plan limit: used / limit numbers" (limit 0/unset renders an infinity sign). A client-side capture-phase click gate on every add trigger (chooser button, WABA connect, Twilio connect, add-device) shows the toast "Your plan allows N WhatsApp number(s). Remove one or upgrade to add another." (title "Plan limit reached") instead of opening any modal when used >= limit; the server error banner text is "You've reached your plan's limit of N devices. Upgrade your plan to add more, or delete an existing one to free up space."
- **Endpoints:** enforced inside `POST devices` (TW-WADEV-006), `POST connect/wa-store/twilio` (TW-WADEV-025), `POST connect/wa-store/baileys` (TW-WADEV-027); no own route.
- **Data:** reads `packages.device_limit` (int, default 1) through `workspace->effectiveLimit('device_limit')` (per-workspace overrides win), counts `devices` (via `Device::forWorkspace(ws, user)` including legacy NULL-workspace devices of the current user) plus `wa_provider_configs` where provider in (`waba`,`twilio`).
- **Rules & edge cases:**
  1. Check is `used >= limit` before creating row N+1; NULL, 0 or negative limit = unlimited.
  2. The count deliberately excludes baileys config rows (a Baileys number is represented by its `devices` row) and SMS rows on the device path; the SMS connect path counts `waba`,`twilio`,`sms` instead (TW-WADEV-025 note); the legacy Baileys wizard counts devices + waba/twilio.
  3. For Twilio and the wizard the check only runs when the config row is NEW (`firstOrNew` returned an unsaved row); reconnecting or rotating an existing row is exempt.
  4. Failure renders as JSON 422 `{ok:false,error:"plan_limit_reached",reason,key,used,limit,message}` for JSON/API requests, else redirect back with `error` flash. The mobile add endpoint converts it to HTTP 402 `{success:false,error:"plan_limit",message}`.
  5. The client gate reads `data-device-used` = the hub's `totals.total` (Baileys rows in the table + connected provider rows + IG + Facebook accounts) which does NOT equal the server count (QUIRK: an Instagram or Facebook account counts toward the browser gate but not the server cap).
- **Async & events:** none.
- **External systems:** none.
- **Settings:** package column `device_limit`; per-workspace plan overrides.
- **Acceptance criteria:**
  - Given a plan with `device_limit=1` and one existing Baileys device, When the admin posts a second device, Then a 422/redirect error with the limit message is returned and no row is created.
  - Given one WABA number and `device_limit=1`, When adding a Baileys device, Then it is refused (cap is unified across engines).
  - Given `device_limit` NULL, When adding any number of devices, Then none is refused.
  - Given an existing Twilio row, When the workspace re-saves Twilio credentials at the cap, Then it succeeds.
- **Source refs:** app/Services/PlanLimitGuard.php, app/Exceptions/PlanLimitReachedException.php, app/Http/Controllers/DevicesController.php (unifiedDeviceCount, store), app/Http/Controllers/WaConnectController.php, resources/js/charts/user-devices-index.js (wireDeviceLimitGate), app/Models/Package.php.
- **Port notes:** enforce inside the channel-account create use-case in one transaction with a row lock on the org's channel count (Reference counts without a lock, so two parallel adds can both pass). Count the same set the UI shows and reuse the count for both the gate and the footer.

### TW-WADEV-005 — Channels hub page (`/devices`)

- **Status:** implemented
- **Priority:** P0 (product unusable without)
- **Effort:** L
- **Depends on:** TW-WADEV-001, TW-WADEV-024
- **Summary:** "Omni channels" is the single hub where a workspace sees and manages every connected number/channel: Baileys devices in a filterable, searchable, paginated table, plus connected WABA/Twilio/Instagram/Facebook/TikTok/SMS/Email channels woven in as rows, KPI cards, and the connect entry points.
- **Actors & access:** workspace role `admin` or above (`workspace.role:admin` middleware; platform admins bypass). Lower roles are redirected to `/team-inbox` (agent/viewer) or get 403.
- **UX & screens:** `resources/views/user/devices/index.blade.php` with partials `_table` (Baileys rows), `_channel_rows` (all other channel rows), `_twilio_section`, `_waba_section`, `_waba_modals`, `_sms_form`, `_inbound_badge`. Header: workspace name, title "Omni channels", subtitle about routing every conversation into one inbox, "N live" pill, "N attention" pill when 24h failures > 0, "Check status" button, and either one "Connect channel" button (opens the chooser modal) when several engines or any side channel is available, or the single per-engine button ("Add WABA account"/"Continue with Facebook", "Add device"). KPI cards (4): Channels live, Accounts (connected/total), Routed 24h (messages), Health % (connected/total, "healthy" at >= 90 else "attention"). Then "Manage & details": in single-engine mode the engine section (WABA cards or Twilio account card) renders above the table with an engine label; in multi-engine mode one unified table titled "Connected channels". Table toolbar: status tabs All / Connected / Disconnected (always) and Needs re-pair / Failed (only when their count > 0) each with a count, a search box ("Search by name, number, or user…", 220 ms debounce), list/grid toggle. Columns: checkbox (bulk-select scaffold with no bulk action), Device (avatar, name, meta line "region · active" or "Spare line", optional "Unofficial API" tag in multi-engine), Mobile number (shown in full; masking is disabled product-wide), User (assignee avatar + name or "Unassigned"), Last active (relative + clock time, or "live"/"disconnected"), Sent 24h (number or dash), Status pill (Connected green, Disconnected grey, Needs re-pair amber, Failed coral) and Actions. Row actions: analytics link, connect/re-pair (QR modal), edit (goes to detail page), toggle active (only when `active`), disconnect (only when `active`), delete (confirm dialog "Delete "<name>"? This can't be undone."). Footer: "Showing X of Y" and "Plan limit: used / limit numbers". Below the table three static help cards (What is a device? / How do I keep it online? / When should I re-pair?) render when Baileys is enabled. Empty state (no Baileys rows, single-engine): "No devices match the current filters. Try clearing filters or pair a new device." with an Add device button. Session errors render a coral banner "WhatsApp connection could not be completed" listing validation errors with a tip about Meta Business Suite; `status` flash renders a mint banner.
- **Endpoints:**
  | METHOD uri  | route name         | Controller@action       | middleware                              | request fields                                                                                                | response                                                                                                                   |
  | ----------- | ------------------ | ----------------------- | --------------------------------------- | ------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
  | GET devices | user.devices.index | DevicesController@index | Authenticate, EnsureWorkspaceRole:admin | `status` (all/connected/disconnected/needs_pair/failed), `region`, `q`, `page`, `partial=1` or `Accept: json` | full page, or JSON `{cards (rendered table + channel rows), counts, regionCounts, totals, pagination, shown, total, page}` |
- **Data:** `devices` (workspace scope, order `active` desc then `id` desc, in-memory search, 12 per page via a collection paginator), `wa_provider_configs` (primary-first WABA list, one Twilio row, sms rows when `sms_enabled`), plus other channel tables (`workspace_ig_accounts`/`instagram_accounts`, `facebook_pages`, `tiktok_accounts`, `workspace_email_accounts`). Counts: `counts` (all/connected/disconnected/needs_pair/failed by status), `regionCounts` (Baileys only), `totals` (total, connected, sent_24h, failed_24h).
- **Rules & edge cases:**
  1. Engine sections: `enabledEngines = availableFor(ws)` plus any connected waba/twilio provider; `multiEngine = count > 1`; `hasBaileys` = baileys in the set. A workspace with connected/disconnected WABA rows still shows the WABA section even if WABA is not "enabled" (so a disconnected number never vanishes).
  2. Counts scope: if more than one engine is enabled the status tabs and totals span all engines; single-engine Baileys scopes them to the devices table; provider rows only count when `connected` (disconnected ghosts are not listed and not counted). Instagram (native add-on or Instaflow mirror rows) and Facebook Pages count as connected channels.
  3. Search matches lower-cased device name or phone number substring in memory (fields are encrypted). Status filter and region filter are SQL.
  4. `connectedChannels` (multi-engine) = `WorkspaceEngine::senders(ws, engines)`: connected, default-first.
  5. Partial JSON re-renders both `_table` and `_channel_rows` because the browser replaces `#devices-list` wholesale; `shown`/`total` add the non-Baileys channel counts.
  6. Two background loops: a 15-second silent `partial` refresh (skipped while the connect modal is open, the tab is hidden, or the search box has focus) and a 10-second silent `POST /devices/check` followed by a refresh (TW-WADEV-014); both resume on tab focus.
  7. The admin-facing region filter rail markup exists but is wrapped in a permanently false condition (hidden), so region is only usable via URL (`?region=IN`).
  8. Available-engine copy names only admin-enabled engines; the chooser cards depend on per-channel admin toggles (`instagram_enabled` or an Instaflow bridge, `facebook_enabled`, `tiktok_enabled`, `telegram_enabled`, `sms_enabled`, `line_enabled`, `wechat_enabled`, `viber_enabled`, `email_enabled` + configured MailTrixy).
  9. The page also runs cache-gated token-health sweepers for Facebook and TikTok on load (owned by those channel domains).
- **Async & events:** the two client polling loops; no server push (the `DeviceStatusChanged` broadcast has no subscriber, TW-WADEV-015).
- **External systems:** none directly (status check goes through TW-WADEV-014).
- **Settings:** `allowed_send_methods`, per-channel `*_enabled` toggles, `waba_config_id` + `waba_app_id` (Embedded Signup ready when both set), `twilio_account_sid` / `twilio_whatsapp_number` (shown as admin defaults), `instaflow_url`, plan `device_limit`.
- **Acceptance criteria:**
  - Given a workspace admin with 3 Baileys devices (2 connected), When they open `/devices?status=connected`, Then only the 2 connected rows render, the tab counts read All 3 / Connected 2 / Disconnected 1, and the URL keeps `status=connected` after a refresh.
  - Given the search box contains "sales", When the user types, Then after ~220 ms the table shows only rows whose name or number contains "sales" with the counts unchanged.
  - Given a workspace agent, When they GET `/devices`, Then they are redirected to `/team-inbox` with a warning.
  - Given two engines enabled and one connected Twilio number, When the hub loads, Then one unified "Connected channels" table lists the Twilio row with an engine badge and the footer counts include it.
  - Given the workspace is at its device cap, When the user clicks Connect channel, Then a toast blocks the modal (TW-WADEV-004).
- **Source refs:** app/Http/Controllers/DevicesController.php (index, counts, regionCounts, totals, countEngines, instagramConnectedCount, facebookConnectedCount), resources/views/user/devices/index.blade.php, _table.blade.php, _channel_rows.blade.php, resources/js/charts/user-devices-index.js, Documentation/pages/channels/whatsapp.html, Documentation/pages/getting-started/connect-channel.html.
- **Port notes:** `apps/web/app/(app)/channels` page + `GET /channels` list endpoint returning a typed union of channel rows; paginate in SQL with a blind-index search column instead of hydrating and filtering encrypted rows in memory. Replace the 15 s/10 s polling with SSE/websocket status events from the bridge (keep polling as fallback). Compute counts server-side in one query per source.

### TW-WADEV-006 — Add a Baileys device

- **Status:** implemented
- **Priority:** P0 (product unusable without)
- **Effort:** M
- **Depends on:** TW-WADEV-004, TW-WADEV-024
- **Summary:** A workspace admin registers a phone number as a device (name, country code, national number, region, assignee, "activate after pairing") before pairing it.
- **Actors & access:** workspace role `admin`+; plan `device_limit` gate.
- **UX & screens:** "Pair a WhatsApp number" modal (`device-modal`, two columns) in `user/devices/index.blade.php`: left "1. Device details" with Device name (required, min 2), Mobile number (international tel input with flags and search, default country from the platform meta `default-country-iso`, placeholder "Your number without country code"), Assign to (select: you first, then workspace members "name · email"), "Activate after pairing" toggle (default on; hint "Routes new sends to this device immediately."); right "2. Scan QR" placeholder ("Connect to see the QR"), a three-step how-to and a "Pairing troubleshooting" link. Primary button "Connect & show QR" (becomes "Connecting…", then "Scan the QR →"). After a successful save the left fields lock read-only beside the QR so the details stay visible. The hidden country code field is kept in sync with the picker (`+91`, the dial code shown separately from the input); the national number typed in the box is posted as `phone_number`.
- **Endpoints:**
  | METHOD uri   | route name         | Controller@action       | middleware                              | request fields                                                                                                                                                                                                                               | response                                                                                                                                                                                          |
  | ------------ | ------------------ | ----------------------- | --------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
  | POST devices | user.devices.store | DevicesController@store | Authenticate, EnsureWorkspaceRole:admin | `device_name` required string 2-191; `country_code` required string max 8; `phone_number` required string 5-32; `region` nullable string max 16; `assigned_user_id` nullable integer exists users; `activate_after_pairing` nullable boolean | AJAX/JSON: `{ok:true, device_id, phone (digits), qr_url, status_url}` or 422 `{ok:false, message:"A device with that phone number already exists.", existing_id}`; non-AJAX: redirect (see QUIRK) |
- **Data:** creates `devices` row: `user_id` = creator, `assigned_user_id` = posted or creator, `workspace_id` = current workspace, `device_name`, `country_code` (bare digits), `phone_number` (bare local digits), `region` (posted or guessed), `status='disconnected'`, `active=false`, `activate_after_pairing` (bool, default true). Name, country code and phone are encrypted at rest.
- **Rules & edge cases:**
  1. Phone normalization (`splitPhone`): strip all non-digits from both fields; if the local part starts with the country code AND removing it still leaves at least 9 digits, strip the prefix once. So `+91` + `+91 7690059356` -> (`91`,`7690059356`) but a 10-digit Indian number that happens to begin with `91` is left intact.
  2. Duplicate check is per workspace (via the visibility scope, TW-WADEV-024): digits of `country_code + phone_number` compared in PHP because the columns are encrypted (no unique index possible). The check does not span workspaces, but the Node session folder is keyed by phone only, so the same number in two workspaces collides at the bridge (QUIRK).
  3. Region guess when none posted: `91` IN, `1` US, `44` GB, `971` AE, `49` DE, `39` IT, `82` KR, `234` NG, else `XX`. The intl-tel-input also auto-fills the region field with the picker's ISO-2 unless the user typed one.
  4. `assigned_user_id` is validated to exist as a user but NOT to be a member of the workspace (QUIRK); it is display-only (list column "User") plus a fallback owner for storefront carts.
  5. The Add flow never creates a `wa_provider_configs` baileys row.
  6. Non-AJAX success does `redirect()->route('user.devices')`, a route name that does not exist (the hub route is `user.devices.index`), so a plain form post would fail after creating the row; the UI always posts via fetch (QUIRK).
  7. Row created before pairing succeeds: an abandoned add leaves a `disconnected` device that counts toward the cap until deleted.
- **Async & events:** none at creation (the Device model observer writes an audit row `device.created`, TW-WADEV-015).
- **External systems:** none until pairing.
- **Settings:** `device_limit`; platform default country.
- **Acceptance criteria:**
  - Given valid input and room under the plan cap, When the admin submits via the modal, Then a `disconnected`, `active=false` device is created in the current workspace and the response carries `device_id`, `qr_url` and `status_url`.
  - Given a device with the same digits already exists in the workspace, When adding again, Then 422 "A device with that phone number already exists." with `existing_id`.
  - Given country code "+91" and phone "+91 76900 59356", When saved, Then stored country code is `91` and phone `7690059356`.
  - Given `device_name` of 1 character, When submitted, Then validation fails.
- **Source refs:** app/Http/Controllers/DevicesController.php (store, splitPhone, guessRegion), app/Models/Device.php, resources/views/user/devices/index.blade.php (device-modal), resources/js/charts/user-devices-index.js (wireCountryPicker, wireAddModal), database/migrations/2026_05_05_000005_create_devices_table.php, database/migrations/2026_05_08_140000_add_assigned_user_to_devices.php.
- **Port notes:** `channel_accounts` (org_id, provider='baileys', display_name, e164 phone, blind-index hash for uniqueness scoped to org AND globally unique among active bridge sessions). Store `region` and E.164 in one canonical column. Validate assignee membership. Make the bridge session key `channel_account_id`, not phone.

### TW-WADEV-007 — QR pairing flow

- **Status:** implemented
- **Priority:** P0 (product unusable without)
- **Effort:** L
- **Depends on:** TW-WADEV-006, TW-WADEV-021, TW-WADEV-023
- **Summary:** The user gets a scannable WhatsApp QR for a device, sees progress (QR generated, scanned/syncing, ready) and the device flips to connected when the phone links.
- **Actors & access:** workspace role `admin`+.
- **UX & screens:** two entry points share the endpoints. (a) Add modal: after Save, the right slot shows a spinner "Connecting device…" then "Generating QR…" then the QR image (48-unit square) with "Scan with WhatsApp" and the hint "Open WhatsApp → Settings → Linked devices → Link a device"; on success a green check "Connected ✓" plus the phone, then the page reloads after 1.5 s (or, when embedded in an iframe, posts `threadwise:device-connected` to the parent). (b) Row "Connect" button opens `connect-device-modal` ("Connect device", title = device name): step 1 picks "Scan QR code" or "Use pairing code"; QR panel shows the image with three instructions and an error line; a progress strip shows the label (raw status text), a percent and a bar plus three steps "1 · Code generated / 2 · Scanned / 3 · Ready"; Back and Cancel buttons; Escape or backdrop click closes and stops polling. The QR string is rendered to a PNG data URL in the browser (`qrcode` library, 320 px, margin 2, error correction M); the server never renders the image.
- **Endpoints:**
  | METHOD uri               | route name           | Controller@action        | middleware                              | request fields | response                                                                                                                                                                                                                                      |
  | ------------------------ | -------------------- | ------------------------ | --------------------------------------- | -------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
  | GET devices/{id}/qr-code | user.devices.qr-code | DevicesController@qrCode | Authenticate, EnsureWorkspaceRole:admin | path id        | JSON `{success, qr (raw pairing string or null), status ("qr_ready"/"connected"/"pending"), message}` with the bridge's HTTP status; 502 `{success:false,error}` when the bridge is unreachable; demo shape when no bridge URL (TW-WADEV-043) |
- **Data:** reads `devices` (workspace scope); no write in this endpoint.
- **Rules & edge cases:**
  1. If the device is NOT currently `connected`, Laravel first calls the bridge `GET /api/terminate-client/{digits}` (8 s, best effort) so the bridge discards any stale manager; then `GET /api/initialize-client/{digits}` (15 s). A fresh socket per request is deliberate: reusing a dead manager produced un-scannable QRs.
  2. `terminate-client` performs a real WhatsApp logout and wipes the session folder (TW-WADEV-023), so requesting a QR always starts a from-scratch pairing.
  3. A connected device asked for a QR returns `status: "connected"` without terminating (the row "Show QR / re-pair" button on an active row therefore just marks it connected; to re-pair the user must disconnect first).
  4. The bridge waits up to 30 s for its first QR; Laravel's 15 s HTTP timeout is shorter, so a slow first QR surfaces as a 502 for that tick.
  5. The add-modal poller calls the QR endpoint every 2 s until a QR is loaded (each call repeats terminate+initialize), then switches to `connection-status` and re-renders the QR whenever the status response carries a fresh `qr`; gives up after 60 attempts (~2 min) with "Timed out waiting for pair. Check that the Node bridge is running, then try again."; after 10 failures before any QR it aborts with the error text.
  6. QR rotates about every 20 s inside the bridge; the bridge ignores QR events closer than 5 s apart; a pair attempt with no scan for 90 s from the first QR is aborted and its session folder deleted (TW-WADEV-021).
  7. Row-modal statuses: `progress` = 100 when the bridge says ready, 30 for `qr_ready`, else 50; label shows the raw bridge status word; step highlighting only advances on words containing "sync"/"scan"/"generated" or exactly "ready"/"connected" (a QR-ready status leaves the strip idle).
  8. When status becomes ready the UI posts `POST devices/{id}/connection {status:1}` (TW-WADEV-009), toasts "Device connected.", closes after 0.7 s and refreshes the list.
- **Async & events:** browser polling only; bridge reports via `api/update-status` (TW-WADEV-019).
- **External systems:** Node bridge (`terminate-client`, `initialize-client`) with header `X-Node-Token`; bridge server URL from `baileys_server_url`/`SERVER_URL`.
- **Settings:** bridge URL/token (TW-WADEV-003).
- **Acceptance criteria:**
  - Given a disconnected device and a running bridge, When the user clicks Connect -> Scan QR, Then a QR renders within ~30 s and the progress strip starts polling every 1.5 s.
  - Given the phone scans the QR of the same number, When the bridge reports Ready, Then the row becomes `connected` with `last_seen_at` set and the modal closes.
  - Given the QR is not scanned for 90 s, When the stall timer fires, Then the session folder is deleted and the status becomes "Pair failed: QR timeout".
  - Given a QR scanned by a phone logged in as a different number, When the socket opens, Then the bridge logs out, wipes the session and reports "Mismatch", and the row does not become connected.
- **Source refs:** app/Http/Controllers/DevicesController.php (qrCode, resolveNodeUrl), node/controllers/clientController.js (initializeClient), node/classes/BaileysClientManager.js, resources/js/charts/user-devices-index.js (startQrFlow, startQrPoll, renderQrDataUrl), resources/views/user/devices/index.blade.php (connect-device-modal), Documentation/pages/getting-started/connect-channel.html.
- **Port notes:** stream the QR to the browser over SSE from the bridge worker instead of polling a request that blocks for up to 30 s; make "re-pair" an explicit action that requests a new session, not an implicit side effect of "get QR". Keep client-side QR rendering (no third-party image service).

### TW-WADEV-008 — Pairing-code flow

- **Status:** implemented
- **Priority:** P1 (expected by customers)
- **Effort:** M
- **Depends on:** TW-WADEV-006, TW-WADEV-021
- **Summary:** Alternative to QR: the bridge requests a random 8-character pairing code for the number; the user types it in WhatsApp (Linked devices -> Link with phone number).
- **Actors & access:** workspace role `admin`+.
- **UX & screens:** in `connect-device-modal` step 1 choose "Use pairing code"; panel "Pairing code" shows the code big (rendered as `ABCD-EFGH`, grouped by 4), the instruction "Open WhatsApp → Linked devices → Link with phone number, then enter this code.", an error line, plus the same progress strip. Error text "Pairing code failed: ...". "Already connected." toast when the bridge says the number is already linked.
- **Endpoints:**
  | METHOD uri                    | route name                | Controller@action             | middleware                              | request fields | response                                                                                                                                                         |
  | ----------------------------- | ------------------------- | ----------------------------- | --------------------------------------- | -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
  | GET devices/{id}/pairing-code | user.devices.pairing-code | DevicesController@pairingCode | Authenticate, EnsureWorkspaceRole:admin | path id        | bridge JSON passthrough `{success, code, message, expires_in}` or `{success:false, already_connected:true}`; 502 on bridge failure; demo code when no bridge URL |
- **Data:** reads `devices`; none written.
- **Rules & edge cases:**
  1. Laravel calls `GET /api/get-pairing-code/{digits}` with a 50 s timeout (the bridge waits up to 45 s).
  2. The bridge requires digits-only phone INCLUDING the country code and rejects numbers shorter than 8 digits ("Invalid phone number for pairing code").
  3. Codes are generated by the bridge itself: 8 characters from the alphabet `123456789ABCDEFGHJKLMNPQRSTVWXYZ` (no 0, I, O, U), from 5 random bytes, because the fork's default code was a constant shared by every number.
  4. Idempotent: if a socket is already pairing and holds a code younger than 120 s, the same code is returned (regenerating mid-entry makes WhatsApp reject the link). Otherwise a stale unfinished socket is torn down and a fresh pairing socket is started; `expires_in` is reported as 180 s.
  5. The bridge holds a per-number connection lock (429 "Connection in progress. Please wait." within 60 s of an earlier request), cleared on success/failure/terminate and by a 5-minute sweeper.
  6. Unlike the QR endpoint, Laravel does not terminate the session first.
  7. If the pairing code cannot be produced within 45 s the bridge ends the socket and returns 408 "Pairing code generation timeout".
  8. Status reported to Laravel during this flow: "Code generated", then "Connecting"/"Syncing data"/"Ready"; a failure to request the code reports "Pairing failed: <message>" (note this wording is not matched by the callback's "pair failed" bucket, see TW-WADEV-019).
- **Async & events:** as TW-WADEV-007.
- **External systems:** Node bridge `get-pairing-code`.
- **Settings:** bridge URL/token.
- **Acceptance criteria:**
  - Given a disconnected device, When the user requests a pairing code, Then an 8-character code is shown in `XXXX-XXXX` form and progress polling starts.
  - Given the user re-requests within 120 s of the first code, When the endpoint is called again, Then the same code is returned.
  - Given the number is already connected, When requesting a code, Then the UI toasts "Already connected." and closes the modal.
  - Given a number with fewer than 8 digits, When requesting, Then the bridge fails and the UI shows "Pairing code failed".
- **Source refs:** app/Http/Controllers/DevicesController.php (pairingCode), node/controllers/clientController.js (getPairingCode), node/classes/BaileysClientManager.js (startWithPairingCode, randomPairingCode), resources/js/charts/user-devices-index.js (startCodeFlow).
- **Port notes:** generate codes through the Baileys `requestPairingCode` call with the same alphabet rule; expose idempotency (return the live code) in the bridge; return structured errors instead of raw passthrough.

### TW-WADEV-009 — Connection status polling and manual mark-connected

- **Status:** implemented
- **Priority:** P0 (product unusable without)
- **Effort:** S
- **Depends on:** TW-WADEV-007
- **Summary:** While the pairing modal is open the UI polls the device's live bridge state; Laravel mirrors a `connected` answer into the row; the UI can also explicitly mark a device on/off.
- **Actors & access:** workspace role `admin`+.
- **UX & screens:** the progress strip and QR slot updates described in TW-WADEV-007/008.
- **Endpoints:**
  | METHOD uri                         | route name                     | Controller@action                    | middleware                              | request fields               | response                                                                                                                               |
  | ---------------------------------- | ------------------------------ | ------------------------------------ | --------------------------------------- | ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
  | GET devices/{id}/connection-status | user.devices.connection-status | DevicesController@connectionStatus   | Authenticate, EnsureWorkspaceRole:admin | path id                      | `{success, status, progress, qr, phone}` (bridge HTTP code; 502 `{success:false,error}` on failure); demo state machine when no bridge |
  | POST devices/{id}/connection       | user.devices.update-status     | DevicesController@updateDeviceStatus | Authenticate, EnsureWorkspaceRole:admin | `status` required in `0`,`1` | `{status:200, success:true, data:{id,active,status}, meta:counts}`                                                                     |
- **Data:** `devices.status`, `active`, `last_seen_at`.
- **Rules & edge cases:**
  1. `connection-status` calls `GET /api/client-status/{digits}` (8 s). Bridge statuses: `connected` (socket ready), `qr_ready` (returns the current QR), `code_ready` (returns the code), `disconnected`.
  2. When the bridge says `connected` and the row is not, Laravel sets `status='connected'`, `last_seen_at=now()` and `active=true` only if `activate_after_pairing`; otherwise `active` is left as is.
  3. `progress` = 100 when the bridge `isReady`, else 30 for `qr_ready`, else 50.
  4. `POST devices/{id}/connection` with `1` sets `active=true, status='connected', last_seen_at=now`; with `0` sets `active=false, status='disconnected'`. It ignores `activate_after_pairing` and does not consult the bridge, so any admin can force-mark a device connected (the detail page also offers "Mark connected").
  5. `client-status` on the bridge is unauthenticated for loopback callers and needs the token otherwise; Laravel sends the token.
  6. Every `save()` fires the Device audit observer and, on status change, the `device_status_updated` webhook (TW-WADEV-015).
- **Async & events:** polled every 1.5 s (row modal) or 2 s (add modal).
- **External systems:** Node bridge `client-status`.
- **Settings:** none.
- **Acceptance criteria:**
  - Given the bridge reports connected, When `connection-status` is polled, Then the device row becomes `connected`, `last_seen_at` is set and the response `progress` is 100.
  - Given `activate_after_pairing=false`, When the bridge reports connected, Then `status=connected` but `active` remains false.
  - Given POST `connection` with `status=0`, When called, Then `active=false, status=disconnected`.
  - Given an invalid `status` value, When posted, Then validation fails.
- **Source refs:** app/Http/Controllers/DevicesController.php (connectionStatus, updateDeviceStatus, demoStatusFor), node/controllers/clientController.js (getClientStatus), resources/js/charts/user-devices-index.js (pollConnectionStatus, markConnected).
- **Port notes:** replace with a status stream; treat the bridge as the source of truth and remove the client-driven "mark connected" write (a browser should never be able to assert connection state).

### TW-WADEV-010 — Edit device details

- **Status:** implemented
- **Priority:** P1 (expected by customers)
- **Effort:** S
- **Depends on:** TW-WADEV-006
- **Summary:** The device detail page has an "Edit device" form to rename a device or change its dial code, number or region.
- **Actors & access:** workspace role `admin`+.
- **UX & screens:** `user/devices/detail.blade.php` first section: fields Device name (required, max 191), Country code (max 8, placeholder +91), Phone number (max 32), Region (optional, max 16, placeholder "e.g. IN"), Save changes; note "Updates this device only. Connection status is managed by pairing, not here." Validation errors render under the form.
- **Endpoints:**
  | METHOD uri       | route name          | Controller@action        | middleware                              | request fields                                                                                                                                                                                                                 | response                               |
  | ---------------- | ------------------- | ------------------------ | --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------- |
  | PUT devices/{id} | user.devices.update | DevicesController@update | Authenticate, EnsureWorkspaceRole:admin | `device_name` sometimes string 2-191; `country_code` sometimes string max 8; `phone_number` sometimes string 5-32; `region` sometimes nullable string max 16; `status` sometimes in `connected,disconnected,needs_pair,failed` | redirect back, flash "Device updated." |
- **Data:** `devices` row (workspace scope, 404 otherwise).
- **Rules & edge cases:**
  1. If either `country_code` or `phone_number` is sent, both are re-run through `splitPhone` (fallback to the stored value for the missing one) so the double-country-code bug cannot return.
  2. No duplicate-phone check on update (QUIRK): two devices can end up with the same number after an edit.
  3. Changing the number does not terminate or move the live bridge session, which stays keyed by the OLD digits; the row and the session diverge until the device is re-paired.
  4. The `status` field is accepted by the endpoint (and sets `active = status==='connected'`) but the form does not expose it; it is the only path that can write `needs_pair`/`failed` from the UI layer.
  5. Model events fire (audit `device.updated`; `device_status_updated` webhook if status changed).
- **Async & events:** audit row; optional webhook.
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given a device, When the admin changes only `device_name`, Then only that column changes.
  - Given phone "+91 7690059356" with cc "91", When saved, Then the stored local part is `7690059356`.
  - Given a device of another workspace, When PUT, Then 404.
  - Given `region` longer than 16, When submitted, Then validation fails.
- **Source refs:** app/Http/Controllers/DevicesController.php (update), resources/views/user/devices/detail.blade.php.
- **Port notes:** forbid editing the number of a paired device (or force re-pair); add uniqueness validation; drop the client-writable `status`.

### TW-WADEV-011 — Toggle device active flag

- **Status:** implemented
- **Priority:** P2 (nice to have)
- **Effort:** S
- **Depends on:** TW-WADEV-006
- **Summary:** A one-click switch flips a device between `connected/active` and `disconnected/inactive` in the database without contacting the bridge.
- **Actors & access:** workspace role `admin`+.
- **UX & screens:** row action "Toggle active" (only shown on active rows) in `_table.blade.php`; on the detail page the header button reads "Refresh session" when the device is active and "Mark connected" when not, and posts to the same endpoint.
- **Endpoints:**
  | METHOD uri               | route name          | Controller@action        | middleware                              | request fields | response                                                                                                                                                  |
  | ------------------------ | ------------------- | ------------------------ | --------------------------------------- | -------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
  | POST devices/{id}/toggle | user.devices.toggle | DevicesController@toggle | Authenticate, EnsureWorkspaceRole:admin | none           | JSON `{data:{id,active,status}, meta:counts}` for `Accept: json`; otherwise redirect back with flash "Device marked connected." or "Device disconnected." |
- **Data:** `devices.active` inverted; `status` = `connected` when now active else `disconnected`; `last_seen_at` = now when turning active, unchanged when turning off.
- **Rules & edge cases:**
  1. No bridge call: turning a device "on" that is not actually linked shows it green until the next liveness check finds the socket not ready and the 120-second grace window (measured from the `last_seen_at` just written) expires (TW-WADEV-014).
  2. QUIRK: the detail-page button labelled "Refresh session" on an ACTIVE device toggles it OFF (marks disconnected) rather than refreshing anything.
  3. Whether `active` gates sending: the send path picks devices by `status='connected'`, not `active`; `active` is consumed by dashboards ("online" = connected AND active), the mobile/group default-device pick, the auto-reply device query, the KPI "connected" total and the idle-logout sweeper.
  4. Model events fire (audit row, status webhook).
- **Async & events:** audit `device.updated`; `device_status_updated` webhook when status changes.
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given an active connected device, When toggled, Then `active=false`, `status=disconnected`, `last_seen_at` unchanged.
  - Given an inactive device, When toggled, Then `active=true`, `status=connected`, `last_seen_at` = now.
  - Given `Accept: application/json`, When toggled, Then the JSON body carries the new state and refreshed counts.
- **Source refs:** app/Http/Controllers/DevicesController.php (toggle), resources/views/user/devices/_table.blade.php, resources/views/user/devices/detail.blade.php, resources/js/charts/user-devices-index.js (toggleDevice).
- **Port notes:** replace the raw flag with an explicit `routing_enabled` boolean independent of connection state, and stop the UI from asserting connection state.

### TW-WADEV-012 — Disconnect (kill session)

- **Status:** implemented
- **Priority:** P0 (product unusable without)
- **Effort:** S
- **Depends on:** TW-WADEV-023
- **Summary:** The admin ends a device's WhatsApp session: the bridge logs the number out of WhatsApp and wipes its saved session, and the row becomes disconnected/inactive so the next connect re-pairs from scratch.
- **Actors & access:** workspace role `admin`+.
- **UX & screens:** row action "Disconnect" (active rows only) which toasts "Device disconnected" and refreshes; detail page header "Disconnect" form button (redirect back with flash "Device disconnected.").
- **Endpoints:**
  | METHOD uri                     | route name                | Controller@action             | middleware                              | request fields | response                                                                                                                   |
  | ------------------------------ | ------------------------- | ----------------------------- | --------------------------------------- | -------------- | -------------------------------------------------------------------------------------------------------------------------- |
  | POST devices/{id}/kill-session | user.devices.kill-session | DevicesController@killSession | Authenticate, EnsureWorkspaceRole:admin | none           | JSON `{status:200, success:true, bridge:bool, data:{id,active:false,status:'disconnected'}, meta:counts}` or redirect back |
- **Data:** `devices.active=false`, `status='disconnected'`.
- **Rules & edge cases:**
  1. Calls bridge `GET /api/terminate-client/{digits}` (8 s, `X-Node-Token`); the bridge performs a WhatsApp logout (the phone shows the linked device removed), clears the number's flow sessions/cooldowns and deletes the session folder, then drops its manager.
  2. The local row is flipped regardless of the bridge result (idempotent, safe to repeat); `bridge` reports whether the call succeeded. A comment in the code records that an earlier version called a non-existent bridge route so the socket stayed alive and the status poll flipped the row back within seconds.
  3. Blank phone digits: bridge call skipped.
  4. Docs say terminate is a "soft-disconnect (session preserved)" but the code wipes the session (docs-only claim; the soft path exists only for shutdown, TW-WADEV-022).
  5. Model events fire (audit row + status webhook).
- **Async & events:** webhook `device_status_updated`; no notification (notifications only come from the status sweep).
- **External systems:** Node bridge `terminate-client`.
- **Settings:** none.
- **Acceptance criteria:**
  - Given a connected device and a reachable bridge, When disconnect is called, Then the bridge session is terminated, the row is `disconnected/inactive` and `bridge=true`.
  - Given the bridge is down, When called, Then the row is still flipped and `bridge=false`.
  - Given a non-JSON request from the detail page, When called, Then it redirects back with "Device disconnected.".
- **Source refs:** app/Http/Controllers/DevicesController.php (killSession), node/controllers/clientController.js (terminateClient), node/classes/BaileysClientManager.js (logout).
- **Port notes:** a `POST /channels/:id/disconnect` that enqueues a bridge command and waits for the ack; record the reason (user disconnect vs remote unlink vs ban).

### TW-WADEV-013 — Delete device

- **Status:** implemented
- **Priority:** P0 (product unusable without)
- **Effort:** S
- **Depends on:** TW-WADEV-012
- **Summary:** The admin permanently removes a Baileys device from the workspace; its open conversations are closed so they leave the active inbox queue while history stays readable.
- **Actors & access:** workspace role `admin`+.
- **UX & screens:** trash icon on the row with a confirm dialog ("Delete "<name>"? This can't be undone."); no success toast (the row disappearing is the feedback).
- **Endpoints:**
  | METHOD uri          | route name           | Controller@action         | middleware                              | request fields | response                        |
  | ------------------- | -------------------- | ------------------------- | --------------------------------------- | -------------- | ------------------------------- |
  | DELETE devices/{id} | user.devices.destroy | DevicesController@destroy | Authenticate, EnsureWorkspaceRole:admin | none           | JSON `{data:{id}, meta:counts}` |
- **Data:** hard-deletes the `devices` row (no soft delete, no FK cascade); updates `conversations` where `device_id = id` and `inbox_status in (open, pending, snoozed)` to `closed` with `resolved_at = now`.
- **Rules & edge cases:**
  1. QUIRK: unlike the admin delete (TW-WADEV-042) and the mobile delete, this path does NOT tell the bridge to terminate the session; the Node socket and the `baileys_auth/session_<digits>` folder stay alive and the bridge keeps listing the number in its heartbeat and forwarding messages that then fail with `device_not_found`.
  2. Other tables that store `device_id` (campaigns, scheduled messages, broadcasts, storefronts, flows) are left dangling; the activity view on the detail page handles orphaned campaigns.
  3. Conversations keep their `device_id`; `Conversation::scopeDeviceAlive` hides threads whose device row is gone (the data is not removed and would reappear only if a device with that id existed again, which never happens with auto-increment ids).
  4. Deleting frees a slot under the plan cap immediately.
  5. Audit observer writes `device.deleted`.
- **Async & events:** audit row.
- **External systems:** none (bug: should reach the bridge).
- **Settings:** none.
- **Acceptance criteria:**
  - Given a device with two open and one resolved conversation, When deleted, Then the two open conversations become `closed` with `resolved_at` set and the resolved one is unchanged.
  - Given a device of another workspace, When DELETE, Then 404.
  - Given a delete, When counts are re-read, Then the plan-limit footer shows one fewer number.
- **Source refs:** app/Http/Controllers/DevicesController.php (destroy), app/Models/Conversation.php (scopeDeviceAlive), resources/js/charts/user-devices-index.js (deleteDevice).
- **Port notes:** deleting a channel account must first enqueue a bridge logout and only then remove the row (or soft-delete and reap), cascade or null the FK on conversations/campaigns, and write an audit row with the actor (ADR-0009 hard delete with audit).

### TW-WADEV-014 — Manual and background status check with grace window

- **Status:** implemented
- **Priority:** P0 (product unusable without)
- **Effort:** M
- **Depends on:** TW-WADEV-023
- **Summary:** "Check status" (and a silent 10-second loop while the hub is open) reconciles every device of the workspace with the bridge's live state, flips dead ones offline only after a grace window, promotes ones that reconnected and raises connect/disconnect notifications.
- **Actors & access:** workspace role `admin`+.
- **UX & screens:** "Check status" button in the hub header shows a sticky "Checking devices…" toast then one of: "All devices reachable"; warning "Bridge offline — N device(s) marked disconnected"; warning with the reason when nothing reset ("SERVER_URL not configured", "Bridge unreachable"); error "Check failed: HTTP n". The silent loop runs on load and every 10 s while the tab is visible and no connect modal is open, then re-fetches the table.
- **Endpoints:**
  | METHOD uri         | route name         | Controller@action       | middleware                              | request fields | response                    |
  | ------------------ | ------------------ | ----------------------- | --------------------------------------- | -------------- | --------------------------- |
  | POST devices/check | user.devices.check | DevicesController@check | Authenticate, EnsureWorkspaceRole:admin | none           | JSON `{ok, reset, reason?}` |
- **Data:** `devices.status`, `active`, `last_seen_at` for the workspace's devices.
- **Rules & edge cases:**
  1. No bridge URL: `{ok:false, reason:'SERVER_URL not configured', reset:0}`.
  2. Grace window: 120 seconds. Baileys legitimately reports not-ready for seconds on every transient reconnect (515 post-pair restart, keepalive miss, network blip, WhatsApp 500), and the bridge recovers on its own, so a single not-ready reading must not flip a live device.
  3. Bridge probe: `GET {bridge}/` (5 s) expecting JSON `status == 200`, tried twice with a 0.8 s pause. If down: all `active` devices of the workspace whose `last_seen_at` is NULL or older than the cutoff are mass-updated to `active=false, status=disconnected` (no per-device notification, webhook or audit because it is a bulk update); response `{ok:false, reset:n, reason:'bridge unreachable'}`.
  4. If up: for each workspace device (skipping blank phones) call `GET /api/client-status/{digits}` (4 s, token) sequentially; live = status `connected` AND `isReady`. Live: `status=connected`, `last_seen_at=now` on EVERY poll (this is what drives the grace clock), `active` set true only if `activate_after_pairing`; if the row was not connected before, raise the "Device connected" notification. Not live and (status connected or active): if `last_seen_at` is NULL seed it with now (no flip on the first miss); if older than the cutoff set `disconnected/inactive`, `reset++`, raise "Device disconnected"; otherwise do nothing.
  5. Per-device failures are swallowed; the loop is sequential with up to 4 s per device (QUIRK: N devices x 4 s worst case per tab per 10 s cycle, multiplied by open tabs).
  6. The endpoint checks only the caller's workspace (visibility scope), while the Node heartbeat sweeps the whole platform (TW-WADEV-020).
  7. Live devices are saved through Eloquent every poll, so an audit row `device.updated` is likely written every 10 s per device per open tab because `last_seen_at` changes (verify in port; the audit observer records any changed column other than `updated_at`).
- **Async & events:** notifications via TW-WADEV-015; the sweep is driven by the browser, not a scheduler (no notification is raised for a workspace nobody has open).
- **External systems:** Node bridge `GET /` and `GET /api/client-status/{digits}`.
- **Settings:** grace window 120 s hard-coded.
- **Acceptance criteria:**
  - Given a device with `last_seen_at` 30 s ago and a bridge that reports not-ready, When check runs, Then the device stays connected (within grace).
  - Given the same device with `last_seen_at` 200 s ago, When check runs, Then it becomes `disconnected/inactive`, `reset` counts it and a disconnect notification is raised.
  - Given the bridge is unreachable twice, When check runs, Then only stale/never-seen active devices are reset and `reason='bridge unreachable'`.
  - Given a previously disconnected device the bridge reports ready, When check runs, Then it is promoted to connected and the "Device connected" notification fires.
- **Source refs:** app/Http/Controllers/DevicesController.php (check, notifyDeviceState), resources/js/charts/user-devices-index.js (checkStatus, silentStatusRefresh, startBackgroundStatusLoop), Documentation/pages/channels/whatsapp.html.
- **Port notes:** move liveness to the bridge worker: it emits `channel.status_changed` events (BullMQ/outbox) and a server-side sweeper handles missed heartbeats with the same 120 s rule; the browser only reads state.

### TW-WADEV-015 — Device status change fan-out (notification, webhook, audit, broadcast)

- **Status:** partial (notifications fire only from the browser-driven sweep; the realtime broadcast has no subscriber or channel authorization)
- **Priority:** P1 (expected by customers)
- **Effort:** M
- **Depends on:** TW-WADEV-014, TW-WADEV-019
- **Summary:** State changes on a device are announced four ways: an in-app/email notification to the workspace owner, an outbound `device_status_updated` webhook, an audit-log row, and a websocket broadcast.
- **Actors & access:** system.
- **UX & screens:** notification bell rows titled "Device connected" (message ":name is back online and ready to send.") and "Device disconnected" (":name went offline. Reconnect it to keep messages flowing."); link goes to the devices index.
- **Endpoints:** none.
- **Data:** notification rows (NOTIF), `audit_logs` (`device.created|updated|deleted` via the model observer, plus explicit `devices.proxy_saved`, `devices.waba_*`, `devices.twilio_remove`, `admin.device.*`), webhook deliveries (INTG).
- **Rules & edge cases:**
  1. Notification (`notifyDeviceState`): event key `device_connected` / `device_disconnected`, category `device`, severity info/warning, recipient = the workspace owner (`workspaces.owner_user_id`), stamped with the device's `workspace_id` (devices with NULL workspace never notify), source = the device, action URL = devices index. De-duplicated with a cache key `notify_device_state:{device}:{event}` for 5 minutes (coalesces poll bursts and multiple tabs). Email is sent only when the workspace opted that event into the email channel (default: email on for `device_disconnected`).
  2. Only the `check()` sweep raises notifications (connected-after-offline, and offline-after-grace). The heartbeat stale sweep and the status callback do not, so nothing is sent unless somebody has `/devices` open (QUIRK).
  3. Webhook: the Device model `updated` hook emits `device_status_updated` only when `status` actually changed on an Eloquent save, with payload `{workspace_id, user_id, device_id, device_name, phone_number (digits or null), status, previous_status, timestamp}`; the emit is deferred and guarded so it cannot break the save. Mass updates (bridge-down reset in `check`, status-callback device mirror, heartbeat `last_seen_at` touch) bypass it; the heartbeat stale sweep deliberately uses per-instance updates so it fires.
  4. Broadcast: `DeviceStatusChanged` (`ShouldBroadcastNow`) on private channel `workspace.{id}.devices`, event name `device.status`, payload `{phone, status, raw_status, at}`, fired `->toOthers()` from the status callback only. No entry for that channel exists in `routes/channels.php` and no JS subscribes (the team inbox uses its own polling), so it is effectively dead (QUIRK).
  5. `Device` is attached to `AuditableObserver` (created/updated/deleted rows with the changed columns, long strings compacted), so any Eloquent save is audited.
- **Async & events:** webhook emit (deferred), broadcast (immediate), audit writes (synchronous).
- **External systems:** Pusher/Echo broadcast driver (unused), outbound webhook endpoints of the workspace.
- **Settings:** workspace notification prefs `device_connected` / `device_disconnected` (in-app, email, Slack), webhook subscription to `device_status_updated`.
- **Acceptance criteria:**
  - Given a workspace owner opted into email for `device_disconnected`, When the sweep flips a device offline, Then a bell row and an email are created once, and a second flip within 5 minutes creates neither.
  - Given a webhook subscribed to `device_status_updated`, When a device row's status changes via an Eloquent save, Then a payload with `previous_status` and `status` is delivered.
  - Given a bulk update by the bridge-down reset, When rows change, Then no webhook is emitted (documented limitation).
- **Source refs:** app/Http/Controllers/DevicesController.php (notifyDeviceState), app/Models/Device.php (booted), app/Events/DeviceStatusChanged.php, app/Observers/AuditableObserver.php, app/Providers/AppServiceProvider.php, routes/channels.php, app/Services/WebhookService.php.
- **Port notes:** emit one `channel.status_changed` domain event through the transactional outbox (ADR-0005) from the single place that changes status, and fan out from it to notification, webhook, audit and websocket consumers; authorize the org-scoped websocket channel; notify all admins, not only the owner.

### TW-WADEV-016 — Per-number proxy: save (plan-gated)

- **Status:** implemented
- **Priority:** P1 (expected by customers)
- **Effort:** M
- **Depends on:** TW-WADEV-006
- **Summary:** Each Baileys number can be assigned its own HTTP or SOCKS5 proxy so it egresses from a dedicated IP instead of the shared server IP (lowers the bulk-ban correlation risk). The setting is stored per device and applied the next time the number connects.
- **Actors & access:** workspace role `admin`+; plan feature `access_proxy_isolation` (default off; docs call it a feature flag, off by default). Only for the Unofficial API engine.
- **UX & screens:** "Proxy / dedicated IP" section of `user/devices/detail.blade.php`. Without the plan feature: a card "Available on a higher plan" / "Upgrade your plan to assign a dedicated proxy IP per number." (decided client-side from the workspace's effective limit, without the admin bypass). With it: checkbox "Send this number through a proxy", Type select (HTTP / HTTPS or SOCKS5), Port number (1-65535, placeholder 1080), Host / IP, optional Username, optional Password (placeholder "•••••• (leave blank to keep)" when one is stored), a status line ("Verified · egress IP x.x.x.x", "Last check: unreachable" or "Not tested yet"), Test and Save proxy buttons, plus the note that the number must be re-paired/reconnected and that an unreachable proxy leaves it disconnected instead of falling back to the server IP. Save and Test are AJAX and show the returned message in the status line.
- **Endpoints:**
  | METHOD uri              | route name              | Controller@action           | middleware                              | request fields                                                                                                                                                                                                               | response                                                                                                                                                 |
  | ----------------------- | ----------------------- | --------------------------- | --------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
  | POST devices/{id}/proxy | user.devices.proxy.save | DevicesController@saveProxy | Authenticate, EnsureWorkspaceRole:admin | `proxy_enabled` sometimes boolean; `proxy_type` nullable in `http,socks5`; `proxy_host` nullable string max 255; `proxy_port` nullable integer 1-65535; `proxy_username` nullable max 255; `proxy_password` nullable max 255 | JSON `{success:true, message}`; 422 `{success:false, message:'Host and port are required to enable a proxy.'}`; plan gate failure 422 (feature_disabled) |
- **Data:** `devices.proxy_enabled` (bool), `proxy_type` (`http`|`socks5`, default written `http`), `proxy_host`, `proxy_port` (smallint unsigned), `proxy_username` and `proxy_password` (both encrypted at rest), `proxy_status` (`ok`|`unreachable`|null), `proxy_egress_ip`, `proxy_checked_at`.
- **Rules & edge cases:**
  1. Gate first: `PlanLimitGuard::feature(workspace, 'access_proxy_isolation')`; refusal message "This feature isn't available on your current plan. Upgrade to unlock it."
  2. Enabling requires non-empty host and port (422 otherwise).
  3. Password handling: a non-empty posted password replaces the stored one; blank while enabled keeps the stored one; blank while disabling clears it.
  4. Disabling also clears `proxy_status` and `proxy_egress_ip`; host/port/username are kept as posted.
  5. Success messages: enabled "Proxy saved. Reconnect the number to route it through the proxy IP."; disabled "Proxy disabled — the number will use the server IP.".
  6. Audit event `devices.proxy_saved` with `{device_id, enabled, type, host}` (never the credentials).
  7. The change takes effect only at the next bridge `start()` (QR or pairing request creates a fresh manager and fetches the proxy again); a live socket keeps its old egress until then.
  8. Packages column `access_proxy_isolation` was declared on the model before the DB column existed (a later migration added it, default false); the admin package form has the toggle.
- **Async & events:** audit write.
- **External systems:** none (test and connect use the proxy, TW-WADEV-017/018).
- **Settings:** plan feature `access_proxy_isolation`; per-workspace plan overrides.
- **Acceptance criteria:**
  - Given a plan without the feature, When POST proxy, Then 422 with the upgrade message and no column changes.
  - Given enabled with host and port, When saved, Then `proxy_enabled=true`, values stored, password encrypted, and the audit row exists.
  - Given enabled with no port, When saved, Then 422 "Host and port are required to enable a proxy.".
  - Given a stored password and a blank password field, When saved enabled, Then the password is unchanged; When saved disabled, Then it is cleared.
- **Source refs:** app/Http/Controllers/DevicesController.php (saveProxy), app/Models/Device.php, database/migrations/2026_06_28_120000_add_proxy_isolation_to_devices.php, database/migrations/2026_07_01_120000_add_proxy_isolation_flag_to_packages.php, resources/views/user/devices/detail.blade.php, Documentation/pages/getting-started/proxy-isolation.html.
- **Port notes:** store proxy credentials in the secrets envelope (not the device row), validate host against private/loopback ranges (SSRF), and version the proxy config so the bridge can detect drift and reconnect automatically instead of asking the user to re-pair.

### TW-WADEV-017 — Per-number proxy: test

- **Status:** implemented
- **Priority:** P1 (expected by customers)
- **Effort:** S
- **Depends on:** TW-WADEV-016
- **Summary:** Before linking, the admin can probe a proxy (posted values or the saved ones) and see the egress IP it presents.
- **Actors & access:** workspace role `admin`+; plan feature `access_proxy_isolation`.
- **UX & screens:** "Test" button beside Save in the proxy section; the result replaces the status line ("Proxy works — egress IP x.x.x.x" or "Proxy unreachable: reason").
- **Endpoints:**
  | METHOD uri                   | route name              | Controller@action           | middleware                              | request fields                                                                                                                                                  | response                                                                                                                                                 |
  | ---------------------------- | ----------------------- | --------------------------- | --------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
  | POST devices/{id}/proxy/test | user.devices.proxy.test | DevicesController@testProxy | Authenticate, EnsureWorkspaceRole:admin | optional `proxy_type`, `proxy_host`, `proxy_port`, `proxy_username`, `proxy_password` (fall back to the saved device values; blank password uses the saved one) | 200 `{success:true, ip, message}`; 422 `{success:false, message:'Host and port are required.'}`; 502 `{success:false, message:'Proxy unreachable: ...'}` |
- **Data:** writes `proxy_status` (`ok`/`unreachable`), `proxy_egress_ip` (on success) and `proxy_checked_at` on the device, even when the tested values were not saved.
- **Rules & edge cases:**
  1. Proxy URL is built as `http://` or `socks5://` (any type other than `socks5` means http), with URL-encoded user:password when a username exists.
  2. Probe: GET `https://api.ipify.org?format=json` through the proxy, 15 s; success requires a 2xx and a non-empty `ip`.
  3. Because the probe runs server-side to a user-supplied host, it can be aimed at internal hosts (SSRF risk to address in the port).
  4. Test results for unsaved values are persisted on the row and may show "Verified" for a proxy that was never saved (QUIRK).
- **Async & events:** none.
- **External systems:** api.ipify.org; the user's proxy.
- **Settings:** plan feature.
- **Acceptance criteria:**
  - Given a working proxy, When tested, Then `ip` is returned, `proxy_status='ok'` and the status line shows the IP.
  - Given an unreachable proxy, When tested, Then 502, `proxy_status='unreachable'`, `proxy_checked_at` set.
  - Given no host or port anywhere, When tested, Then 422 "Host and port are required.".
- **Source refs:** app/Http/Controllers/DevicesController.php (testProxy), resources/views/user/devices/detail.blade.php (inline script).
- **Port notes:** run the probe from the bridge worker (the same network path the socket will use) rather than the API server, with an allow-list of public IP ranges.

### TW-WADEV-018 — Node proxy resolution, fail-closed preflight and result callback

- **Status:** implemented
- **Priority:** P1 (expected by customers)
- **Effort:** M
- **Depends on:** TW-WADEV-016, TW-WADEV-021
- **Summary:** Whenever the bridge starts a number's socket it fetches that number's proxy from Laravel, verifies the egress IP through it, and refuses to connect if the proxy is bad (never falling back to the server's IP); it reports proxy health back.
- **Actors & access:** machine-to-machine, `X-Node-Token`.
- **UX & screens:** results surface as the proxy status line on the device detail page (TW-WADEV-016).
- **Endpoints:**
  | METHOD uri                           | route name                | Controller@action               | middleware | request fields                                                                                                                            | response                                                                                                                                                                                                                                                    |
  | ------------------------------------ | ------------------------- | ------------------------------- | ---------- | ----------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
  | GET api/devices/proxy-config/{phone} | baileys.node.proxy-config | WaConnectController@proxyConfig | api        | header `X-Node-Token`                                                                                                                     | 403 `{ok:false,message:'forbidden'}` on token mismatch or empty configured token; else `{ok:true, proxy:{enabled:false}}` or `{ok:true, proxy:{enabled:true,type,host,port,username,password}}` (credentials decrypted, plaintext over the trusted channel) |
  | POST api/devices/proxy-result        | baileys.node.proxy-result | WaConnectController@proxyResult | api        | `phone_number` required max 32, `proxy_status` required max 16, `proxy_egress_ip` nullable max 64, `error` nullable max 255; header token | `{ok:true}`; `{ok:false,message:'no device'}` (HTTP 200) when no device matches                                                                                                                                                                             |
- **Data:** reads proxy columns; writes `proxy_status`, `proxy_egress_ip` (only when provided), `proxy_checked_at` via a bulk update (no model events).
- **Rules & edge cases:**
  1. Device lookup is by digits-only `country_code + phone_number`, scanning ALL devices platform-wide and taking the first match (no workspace scope; QUIRK if two workspaces hold the same number).
  2. The token comparison uses `hash_equals` and an empty configured token is refused (never a free pass).
  3. Bridge behavior in `start()`/`startWithPairingCode()`: (a) `loadProxy` fetches the config (10 s) and caches it to `<sessionFolder>/proxy.json` (plaintext credentials on disk, QUIRK); if Laravel is unreachable it falls back to the cached file; (b) `applyProxyAgent` builds an HTTP(S) proxy agent (type `http`) or a SOCKS agent (type `socks5`) from `scheme://user:pass@host:port` with URL-encoded credentials, then probes `https://api.ipify.org?format=json` THROUGH it (15 s); success reports status `ok` with the egress IP and the agent is passed to the socket as both WebSocket `agent` and media `fetchAgent`; (c) a bad config or unreachable proxy reports `unreachable` (with the error) and throws, aborting `start()` (fail-closed).
  4. After an aborted start the bridge re-tries every 5 s up to 50 times (`connectionRetries < maxRetries`) and then stays down; the row shows disconnected.
  5. No proxy configured (or disabled) -> direct connection, unchanged behavior.
  6. The check runs at (re)connect only; there is no continuous egress verification.
- **Async & events:** bridge -> Laravel calls at each start.
- **External systems:** api.ipify.org; the proxy.
- **Settings:** none beyond the device columns; bridge dependencies `https-proxy-agent`, `socks-proxy-agent`.
- **Acceptance criteria:**
  - Given a device with an enabled working proxy, When the bridge starts it, Then it fetches the proxy, the ipify probe returns the proxy IP, the report stores `proxy_status='ok'` + IP and the socket connects through the agent.
  - Given an enabled proxy that is down, When the bridge starts, Then no socket is created, `proxy_status='unreachable'` is reported and the number stays disconnected.
  - Given a wrong or missing `X-Node-Token`, When either endpoint is called, Then 403.
  - Given the proxy is disabled, When the bridge fetches, Then `proxy.enabled=false` and it connects directly.
- **Source refs:** app/Http/Controllers/WaConnectController.php (proxyConfig, proxyResult, deviceByPhoneDigits), node/classes/BaileysClientManager.js (buildProxyAgent, setProxy, loadProxy, applyProxyAgent, reportProxyResult), Documentation/pages/getting-started/proxy-isolation.html.
- **Port notes:** the worker should read the proxy from the secret store keyed by channel account id (no HTTP hop, no on-disk plaintext), keep fail-closed semantics, and surface `proxy_status` through the same status event stream. Keep both the WebSocket and the media-fetch clients on the agent.

### TW-WADEV-019 — Node status callback (`api/update-status`)

- **Status:** partial (works only for numbers that have a legacy Baileys pointer row; for numbers added from `/devices` it is a no-op)
- **Priority:** P0 (product unusable without)
- **Effort:** M
- **Depends on:** TW-WADEV-021
- **Summary:** The Node bridge pushes each lifecycle step of a number (QR generated, code sent, connecting, syncing, ready, logged out, pair failed, mismatch) to Laravel, which buckets it into connected / disconnected / pending, updates the provider row, mirrors the state into matching device rows and broadcasts it.
- **Actors & access:** machine caller; header `X-Node-Token` compared with `hash_equals` against `node_token()`; an empty configured token is refused (403 `{ok:false,message:'forbidden'}`).
- **UX & screens:** indirect only (legacy wizard status, team-inbox device pill).
- **Endpoints:**
  | METHOD uri             | route name            | Controller@action                      | middleware | request fields                                                                                                                                         | response                                                                                                                          |
  | ---------------------- | --------------------- | -------------------------------------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------- |
  | POST api/update-status | baileys.node.callback | WaConnectController@nodeStatusCallback | api        | `wid` required string max 32 (the phone digits); `status` required string max 64; `qr` nullable string; `progress` nullable numeric (accepted, unused) | `{ok:true, derived_status}`; `{ok:false, message:'no matching config for <digits>'}` (HTTP 200) when no baileys config row exists |
- **Data:** finds the FIRST `wa_provider_configs` row with provider `baileys` whose `phone_number` equals the digits or `+digits` (platform-wide, not scoped by workspace); writes its `credentials_json` (encrypted; `qr_data` = posted qr or previous, `last_status_msg`, `last_status_at`), `status`, `connected_at` (first time connected), `last_health_at`; then bulk-updates matching `devices` rows.
- **Rules & edge cases:**
  1. Bucketing on the lower-cased status: connected when exactly `ready`, `connected`, `paired` or `open`; disconnected when it CONTAINS `logged out`, `logged_out`, `disconnected`, `connection failed`, `connection_failed`, `pair failed` or `mismatch`; everything else (Qr generated, Code generated, Connecting, Syncing data, Reconnecting) = pending. QUIRK: the bridge's "Pairing failed: ..." wording (code-request failure) does not contain "pair failed" and lands in pending.
  2. Device mirror: derive `connected` / `disconnected` / `needs_pair` (pending); candidates are devices in the config's workspace OR with NULL `workspace_id` whose digits (country code + phone) equal the number; each is patched with `status` and `last_seen_at=now`, `active=true` when connected, and legacy NULL-workspace rows are claimed by the config's workspace. `active` is never set to false here.
  3. Because only `saveBaileys` (legacy wizard, TW-WADEV-027) creates a baileys config row, the `/devices` add flow leaves nothing to match: the whole callback returns "no matching config" and the device row is not updated. State for those devices comes from polling (TW-WADEV-009, TW-WADEV-014) and the heartbeat (TW-WADEV-020).
  4. The bridge truncates status text to 32 chars (`Pair failed: <reason>` becomes `...`), although Laravel would accept 64.
  5. Bridge status vocabulary and percents: "Qr generated" 0, "Code generated" 0, "Connecting" 25, "Syncing data" 75 (after a 515 restart), "Reconnecting" 50 (or 30 after a failed restart), "Ready" 100, "Logged Out", "Disconnected", "Connection Failed", "Mismatch", "Pair failed: QR timeout", "Pair failed: <decoded reason>", "Pairing failed: <message>".
  6. Broadcasts `DeviceStatusChanged(workspace, phone, derived, raw)` to others; failures logged only.
  7. Logs a structured line with raw and derived status and the number of device rows updated.
- **Async & events:** broadcast (TW-WADEV-015); no webhook because updates are bulk.
- **External systems:** Node bridge (caller).
- **Settings:** `node_webhook_token`.
- **Acceptance criteria:**
  - Given a baileys config row for the number, When the bridge posts `Ready`, Then the config becomes connected with `connected_at` set and matching device rows become `connected/active`.
  - Given the bridge posts "Logged Out", When processed, Then config and device rows become disconnected.
  - Given the bridge posts "Connecting", When processed, Then the config is pending and devices become `needs_pair`.
  - Given no config row for the number, When any status is posted, Then the response is `{ok:false, message:'no matching config for ...'}` and no device changes.
  - Given a wrong token, When posted, Then 403.
- **Source refs:** app/Http/Controllers/WaConnectController.php (nodeStatusCallback), app/Events/DeviceStatusChanged.php, node/utils/helpers.js (updateStatusInLaravel), node/classes/BaileysClientManager.js (status strings).
- **Port notes:** this is the endpoint a rebuild should get right: key the callback on the channel-account id (or its session id), update the channel row directly, and emit the status event through the outbox. Do not depend on a pointer row.

### TW-WADEV-020 — Node heartbeat: liveness, stale sweep, idle logout

- **Status:** implemented
- **Priority:** P0 (product unusable without)
- **Effort:** M
- **Depends on:** TW-WADEV-021
- **Summary:** Every 30 s the bridge posts the list of sockets it considers live; Laravel refreshes `last_seen_at` on those devices, flips connected devices that have not been heard from for over 90 s to disconnected, optionally logs out long-idle devices, and (in Reference) also uses the tick as its only scheduler for many unrelated sweeps.
- **Actors & access:** machine caller with `X-Node-Token` (403 on mismatch or empty token).
- **UX & screens:** none; makes "Last active" and the device pill accurate.
- **Endpoints:**
  | METHOD uri              | route name             | Controller@action                 | middleware | request fields                                                                                              | response                                                                                                                                           |
  | ----------------------- | ---------------------- | --------------------------------- | ---------- | ----------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
  | POST api/node-heartbeat | baileys.node.heartbeat | WaConnectController@nodeHeartbeat | api        | `devices` required array; `devices.*.wid` required string max 32; `devices.*.status` nullable string max 64 | `{ok, touched, marked_stale, campaigns_fired, campaigns_active, scheduled_retried, broadcasts_retried, deal_tasks_reminded, stock_holds_released}` |
- **Data:** `devices.last_seen_at`, `status`, `active`.
- **Rules & edge cases:**
  1. Live list: digits of each `wid`; an empty resulting list returns `{ok:true, touched:0}` without any sweep. (An empty `devices` array fails the `required` rule with 422, but the bridge never posts an empty list.)
  2. Touch: scans ALL devices platform-wide, comparing digits of `country_code + phone_number` in PHP, and bulk-updates `last_seen_at=now` for those live (no events).
  3. Stale sweep: devices with `status='connected'` and `last_seen_at` older than 90 s (NULL `last_seen_at` is NOT stale) are updated per instance to `status='disconnected'` (so the webhook and audit fire); `active` is left true (QUIRK: an "offline" device still counts as active in dashboards).
  4. Different windows: heartbeat stale = 90 s; the browser `check` grace = 120 s.
  5. Idle logout: security policy `device_logout_on_inactive_days` (0 = off), evaluated at most hourly (cache lock `device-idle-logout-lock`): `active` devices with `last_seen_at` older than N days get `active=false, status=disconnected` per instance. It does NOT terminate the bridge session.
  6. If the bridge has no ready client it sends no heartbeat at all (`skip — no clients registered` / `none ready`), so the stale sweep and every piggy-backed sweep stop running (documented consequence: scheduled campaigns do not fire when no device is live).
  7. Piggy-backed work (Reference has no Laravel scheduler): due scheduled/recurring campaign sweep (skipped while cache key `campaign-drain-loop-alive` exists because Node's dedicated campaign drain loop owns it), scheduled-message retry sweep (2-min throttle), broadcast retry sweep (2-min throttle), appointment lifecycle sweep, invoice delivery sweep (own 5-min gate), `workspaces:wipe-expired` once a day, deal-task reminder sweep (2-min lock), stock-hold release (60 s lock). Each is wrapped so a failure never fails the heartbeat. These belong to CAMP, SCHED, BCAST, APPT, INV, WSP, DEAL, CHK respectively; the port must schedule them as BullMQ repeatable jobs in those domains, not from the device heartbeat.
  8. `campaigns_active` tells Node whether a campaign is mid-run (the field is now unused by Node, which has its own drain loop).
- **Async & events:** the bridge timer (30 s, 90 s request timeout, errors logged with token diagnostics; 404 ignored, 401/403 logged with a "token mismatch" hint).
- **External systems:** Node bridge (caller).
- **Settings:** `security.device_logout_on_inactive_days` (SecurityPolicy, default 0); bridge `NODE_WEBHOOK_TOKEN`.
- **Acceptance criteria:**
  - Given the bridge lists two live numbers, When the heartbeat is posted, Then those devices' `last_seen_at` is now and `touched=2`.
  - Given a connected device not in the list whose `last_seen_at` is 100 s old, When the heartbeat is posted, Then it becomes `disconnected` and `marked_stale` counts it.
  - Given `device_logout_on_inactive_days=7`, When an active device was last seen 8 days ago and an hour has passed since the last run, Then it becomes inactive/disconnected.
  - Given no live devices, When the bridge timer fires, Then no request is sent.
- **Source refs:** app/Http/Controllers/WaConnectController.php (nodeHeartbeat), node/index.js (startDeviceHeartbeat, startCampaignDrainLoop), app/Support/SecurityPolicy.php.
- **Port notes:** the worker heartbeat should be a Redis key with TTL per channel account (live = key present) plus a repeatable sweeper; keep 90/120 s consistent; never couple unrelated domain sweeps to it.

### TW-WADEV-021 — Baileys session lifecycle in the Node bridge

- **Status:** implemented
- **Priority:** P0 (product unusable without)
- **Effort:** XL
- **Depends on:** -
- **Summary:** For every paired number the bridge keeps one long-lived WhatsApp Web (multi-device) socket built with the `@itsukichan/baileys` fork: it produces QR codes or pairing codes, persists credentials, validates the linked account, reconnects with backoff, self-heals, and reports state to Laravel.
- **Actors & access:** the Node process; controlled only through the client-control API (TW-WADEV-023) and the boot restore (TW-WADEV-022).
- **UX & screens:** none (state shows up in TW-WADEV-005/007).
- **Endpoints:** none of Laravel's; the bridge's own are in TW-WADEV-023.
- **Data:** per-number auth folder `node/baileys_auth/session_<digits>/` (Baileys multi-file auth state: creds and sender/pre-key/app-state files), `baileys_store.json` (in-memory chat/contact store dumped every 10 s), optional `proxy.json`. In-memory maps: `clients` (socket by phone), `client_ready`, `clientManagers`, `connectionLocks`.
- **Rules & edge cases:**
  1. One `BaileysClientManager` per digits-only phone. Socket options: browser identity macOS Desktop; WhatsApp Web version fetched from the latest published version (cached 1 h, fallback to the fork's bundled version); connect timeout 60 s; QR timeout 60 s; keepalive 15 s (30 s on the pairing-code socket); default query timeout 120 s (raised from 30 s at operator request; Laravel's send timeout must be at least this or slow-but-successful sends are marked failed and retried into duplicates, see TW-WADEV-030); retry request delay 3 s; max message retries 5; no full-history sync, no history-sync callback; `markOnlineOnConnect=false`; `getMessage` returns null (a placeholder body made WhatsApp re-decrypt in a loop); own events not emitted; link previews off; `printQRInTerminal=false` but a terminal QR is still printed to the console.
  2. Sends are serialized per device: `sock.sendMessage` is wrapped in a promise chain so concurrent flow/keyword replies cannot race the Signal handshake; a failure never blocks the next send.
  3. QR handling: `qr` events closer than 5 s to the previous are ignored; each stores the string on the manager, marks connecting, and reports "Qr generated"; the FIRST QR timestamp starts a stall clock.
  4. Stall watchdog (5 s interval): if no `open` within 90 s of the first QR, abort: end the socket, delete the session folder, drop the manager and the connection lock, set `shouldStayConnected=false` and report "Pair failed: QR timeout". The first `creds.update` after a scan cancels the stall timer so the post-scan 515 restart is not killed.
  5. Credentials: every `creds.update` is saved immediately (not debounced) because skipping any leaves an incomplete folder that cannot be restored; after `open` it waits 2 s, saves again and logs the file count, warning loudly when the folder is empty.
  6. Account match guard: on `open` the linked JID's digits must equal the number the manager was created for; if not, report "Mismatch", log out, wipe files, drop manager and client and stop (the QR scanned by the wrong phone never leaves creds behind).
  7. On `open`: ready flag true, retries reset, QR cleared, pending reconnect timer cancelled, first group directory sync scheduled 7 s later (WFL), report "Ready" 100.
  8. Close handling (decoded reasons): 401 unauthorized (device unlinked on the phone), 403 forbidden (account flagged/version too old/region), 408 timeout, 428 connection replaced, 440 session conflict, 500 internal, 515 stream restart (expected after every successful scan), plus Baileys reasons loggedOut, badSession, connectionClosed/Lost, restartRequired, multideviceMismatch; a message containing "couldn't link" is attributed to the 4-linked-devices limit.
  9. Failed FIRST pair: if the socket never reached `open` and the close is not a transient 515/500, stop hard: no retry, delete session, drop manager and lock, report `Pair failed: <decoded reason>` (truncated to 32 chars). 515 and 500 are treated as transient.
  10. 401 after having connected: stop reconnecting, logout, delete session, report "Logged Out". loggedOut/403: same via the terminal branch (report "Logged Out"). badSession: delete the session folder and retry.
  11. Reconnect policy ("stay connected until logout"): every other close retries forever; delay = min(base x min(1.5^retries, 10) + jitter(0-1500 ms), 30 s) with base by code: 515 2 s, 500 4 s, 408 6 s, 440 6 s, 428 4 s, other 3 s; `maxRetries=50` only shapes the curve on this path. A 515 reports "Syncing data" 75 and saves creds; other unknown closes report "Reconnecting" 50. Orphaned timers are cleared before arming a new one so two quick closes cannot cause two concurrent starts; if the retry's `start()` throws it re-arms after 15 s and reports "Reconnecting" 30.
  12. Health watchdog (60 s interval, created once): if not shutting down, meant to stay connected, not connected/connecting/reconnecting, no timer pending, and not mid-first-pairing (QR shown but never connected) then call `start()` again.
  13. The pairing-code socket has its own connection handler with a terminal retry cap (`connectionRetries >= maxRetries` stops) and reconnects through the regular `start()`; it has no stall or health watchdog of its own.
  14. `logout()` = user intent: WhatsApp unlink, drop client/ready, clear this number's flow sessions and cooldowns, delete session files. `softDisconnect()` = shutdown intent: close the websocket, keep the files, flush the store file.
  15. Group directory: on connect and on participant/group changes (debounced 5-7 s) the bridge pushes group metadata (jid, subject, size, participants with phone digits and admin flag) to Laravel `api/groups/sync` (WFL).
  16. Inbound and receipt handlers are attached to the same socket (TW-WADEV-033, TW-WADEV-034).
- **Async & events:** timers (stall 5 s, health 60 s, store dump 10 s, reconnect backoff), status callbacks to Laravel (TW-WADEV-019).
- **External systems:** WhatsApp Web servers via Baileys; optional proxy (TW-WADEV-018).
- **Settings:** bridge env `BAILEYS_LOG_LEVEL` (default warn), `THREADWISE_LOGS`, `PORT`, `APP_DOMAIN_NAME`, `NODE_WEBHOOK_TOKEN`.
- **Acceptance criteria:**
  - Given a fresh number, When a QR is requested and scanned by the same number, Then creds are saved, the mismatch guard passes, the manager becomes ready and "Ready" is reported.
  - Given the socket closes with 515 right after the scan, When the handler runs, Then a reconnect is scheduled in about 2 s plus jitter and the pairing is not aborted.
  - Given the socket closes with 401 after connection, When the handler runs, Then the session folder is removed and "Logged Out" is reported and no reconnect is attempted.
  - Given a network drop, When the socket closes with code 408, Then reconnect attempts continue indefinitely with the capped 30 s backoff until logout.
  - Given two closes within 100 ms, When both schedule reconnects, Then only one reconnect timer survives.
- **Source refs:** node/classes/BaileysClientManager.js (constructor, start, startWithPairingCode, handleConnectionUpdate, handleConnectionUpdateWithPairing, resetForFreshAuth, decodeCloseReason, deleteSessionFiles, logout, softDisconnect, syncGroups), node/utils/sendSafety.js (serializeSocketSends), node/package.json, Documentation/pages/developer-guide/node-bridge.html.
- **Port notes:** implement as the `apps/baileys-bridge` worker (Baileys or WhiskeySockets/baileys, pinned): one session actor per channel account id, auth state in encrypted object storage or Postgres (not a local folder) so it survives host loss and can be sharded; keep the exact reconnect matrix, the mismatch guard, the QR stall abort and the per-device send queue. Emit typed events (`qr`, `code`, `connecting`, `open`, `logged_out`, `pair_failed{reason}`) instead of magic status strings. Only one bridge instance may own a session at a time (lease in Redis).

### TW-WADEV-022 — Session persistence, auto-restore and graceful shutdown

- **Status:** implemented
- **Priority:** P0 (product unusable without)
- **Effort:** M
- **Depends on:** TW-WADEV-021
- **Summary:** When the bridge process restarts, every healthy saved session reconnects by itself (no QR), and a normal stop preserves the pairing.
- **Actors & access:** the Node process.
- **UX & screens:** none; the hub shows devices reconnecting via status polling.
- **Endpoints:** none.
- **Data:** `node/baileys_auth/session_*` folders.
- **Rules & edge cases:**
  1. Boot order: fetch WhatsApp settings and message settings from Laravel (`/api/whatsapp-settings`, `/api/whatsapp-message-settings`, 50 s timeout) -> `restoreSessions()` -> re-sync campaign schedules and scheduled messages from Laravel (in-memory schedules are lost on restart) -> start the 5-min per-phone settings refresh loop, the 30-s device heartbeat and the campaign drain loop.
  2. `restoreSessions`: lists `session_*` folders; a folder with fewer than 3 files is "incomplete" (pairing never finished or logged out) and is NOT restored: the bridge reports "Disconnected" for it; healthy folders are restored one by one with a 2 s stagger (`new BaileysClientManager(...).start()`), which reuses the saved creds (no QR) and applies the proxy rules. After restore it pre-warms the per-phone settings cache for each restored number.
  3. Restore does not verify with Laravel that a device row still exists.
  4. Graceful shutdown (SIGINT/SIGTERM): each client is soft-disconnected (socket closed, files kept, store flushed), its flow sessions and scheduled jobs are dropped from memory, then `process.exit(0)`; the pairing survives. `uncaughtException`/`unhandledRejection` are logged and the process keeps running.
  5. Periodic housekeeping: connection locks older than 5 min are dropped every 5 min; inactive flow sessions every 30 min; expired cooldowns every 10 min; all settings re-fetched hourly.
  6. Deploy variants: `app.cjs` and `server.cjs` are CommonJS launchers that dynamic-import the ESM `index.js` for cPanel/LiteSpeed/Passenger style hosts; `index-cpanel.js` is a copy of `index.js` that additionally strips a leading `/node` path prefix from every request. `BaileysClientManager.backup.js` and `node/config/.git` are dead artefacts.
- **Async & events:** startup sequence and timers.
- **External systems:** Laravel `/api/whatsapp-settings`, `/api/whatsapp-message-settings`.
- **Settings:** `PORT`, `DOMAIN_NAME`, `APP_DOMAIN_NAME`, `ALLOWED_ORIGINS` (dynamic CORS; default allow-all).
- **Acceptance criteria:**
  - Given three saved sessions with more than 3 files each, When the bridge starts, Then all three reconnect within about 6 s of stagger without any QR.
  - Given a saved folder with 2 files, When the bridge starts, Then it is not restored and "Disconnected" is posted for that number.
  - Given SIGTERM, When the bridge stops, Then session files remain and the next start restores them.
- **Source refs:** node/index.js (restoreSessions, gracefulShutdown, startSettingsRefreshLoop, startDeviceHeartbeat, timers), node/index-cpanel.js, node/app.cjs, node/server.cjs, node/utils/cleanup.js (performClientCleanup), node/log-gate.js.
- **Port notes:** with sessions stored centrally, "restore" becomes "worker claims unowned sessions via a lease"; shutdown must release leases and flush auth state before exit; sequence restores with concurrency control.

### TW-WADEV-023 — Node bridge client-control API and API auth guard

- **Status:** implemented
- **Priority:** P0 (product unusable without)
- **Effort:** M
- **Depends on:** TW-WADEV-021
- **Summary:** The bridge exposes a small HTTP surface for device lifecycle that Laravel (web, admin, mobile) calls, protected by a shared secret with a loopback exemption.
- **Actors & access:** Laravel server; `NODE_API_AUTH` mode `loopback` (default: token OR loopback peer), `token` (token always) or `off`. The secret may arrive in header `X-Node-Token` or body `node_token`; comparison is constant-time. `/api/cache-bust` and the `/api/groups/*` routes require the token strictly. `GET /` (server info) and `GET /health` are outside the guard.
- **UX & screens:** none.
- **Endpoints:** none on Laravel; the bridge-side surface (owned with NODE, listed for reference) is:
  | METHOD uri                        | purpose                                                                                          |
  | --------------------------------- | ------------------------------------------------------------------------------------------------ |
  | GET /api/initialize-client/:phone | start or re-start a session and return the first QR                                              |
  | GET /api/client-status/:phone     | live state (`connected`/`qr_ready`/`code_ready`/`disconnected`, `isReady`, `qr`, `code`, `user`) |
  | GET /api/terminate-client/:phone  | user-intent logout, wipe files, drop manager                                                     |
  | GET /api/check-connection/:phone  | liveness probe with destructive cleanup when not ready                                           |
  | GET /api/get-contacts/:phone      | contacts from the in-memory store (used by the mobile app)                                       |
  | GET /api/get-pairing-code/:phone  | 8-char pairing code                                                                              |
  | POST /api/cache-bust              | flush per-phone settings cache (`{phone?}`)                                                      |
  | GET /api/refresh-settings         | re-pull global settings from Laravel                                                             |
  | GET / , GET /health               | server info, health with ready-device counts                                                     |
- **Data:** in-memory maps only.
- **Rules & edge cases:**
  1. `initialize-client`: if already ready return `{status:'connected', qr:null}`; if a connection lock younger than 60 s exists return 429 "Connection in progress. Please wait."; set the lock; if a manager exists but the socket is not ready, discard it completely (reset auth state, clear its timers, delete manager/client/ready flag) and build a fresh one; `start()` then poll the manager every 500 ms up to 30 s for a QR (returns `{qr, status:'qr_ready'}`), returning `connected` if the socket became ready meanwhile, else 500 "Failed to initialize client" with details. The lock is NOT released on success (only by terminate, error, the 5-min sweeper or a fresh-QR flow).
  2. `client-status`: `connected` when a socket exists and is ready (returns `user`), `qr_ready` with the current QR, `code_ready` with the current code, else `disconnected`.
  3. `terminate-client`: manager present -> `logout()`, delete manager and lock, return `{status:'terminated'}`; absent -> `{status:'not_found'}` (200 either way).
  4. `check-connection` (QUIRK, destructive and unused by Laravel): when the number is not ready it sets `shouldStayConnected=false`, logs the socket out, deletes the session files, drops all in-memory state, clears the number's flow sessions/cooldowns and reports "Disconnected" to Laravel; when no manager exists it deletes the session folder from disk. Any monitoring probe hitting it would wipe pairings, so a port must not reproduce it as a GET.
  5. Docs (`developer-guide/node-bridge.html`) describe `terminate-client` as "soft-disconnect (session preserved)": wrong in code.
  6. Laravel callers: web endpoints send `X-Node-Token`; the legacy wizard, the mobile add/QR/disconnect/delete and the dispatcher's send calls do not (they rely on the loopback exemption; QUIRK: a bridge on a separate host with `NODE_API_AUTH=token` returns 401 to them).
  7. CORS is dynamic: no `ALLOWED_ORIGINS` (or `*`) = allow all origins; otherwise only the app domain, listed origins, localhost and browser-extension origins.
- **Async & events:** none.
- **External systems:** Laravel callbacks (TW-WADEV-019/020).
- **Settings:** `NODE_API_AUTH`, `NODE_WEBHOOK_TOKEN`, `ALLOWED_ORIGINS`.
- **Acceptance criteria:**
  - Given a request from a non-loopback IP without the token in default mode, When calling any `/api` route, Then 401 `{ok:false,error:'unauthorized'}`.
  - Given a second `initialize-client` within 60 s of the first while a lock is held and the socket is not ready, When called, Then 429.
  - Given `terminate-client` on an unknown number, When called, Then `{status:'not_found'}`.
  - Given a valid token from a remote host, When calling `client-status`, Then the live state JSON is returned.
- **Source refs:** node/routes/index.js, node/controllers/clientController.js, node/index.js (root/health routes, CORS), node/utils/helpers.js (timingSafeEqualStr, laravelHeaders), Documentation/pages/developer-guide/node-bridge.html.
- **Port notes:** replace GET-with-side-effects with `POST /sessions/:id/start|stop|logout`; authenticate every call with a per-environment credential; do not port `check-connection`; make lock semantics explicit (lease per session id).

### TW-WADEV-024 — Device visibility scoping and lookup by phone

- **Status:** implemented
- **Priority:** P0 (product unusable without)
- **Effort:** M
- **Depends on:** -
- **Summary:** Devices belong to the workspace: every member of workspace X sees X's phones. Legacy rows and the encrypted phone columns add special rules that every reader must reproduce.
- **Actors & access:** all device readers.
- **UX & screens:** none.
- **Endpoints:** none.
- **Data:** `devices.workspace_id` (nullable FK to workspaces, `ON DELETE SET NULL`), `user_id`, `assigned_user_id` (`ON DELETE SET NULL`), encrypted `device_name`, `country_code`, `phone_number` (TEXT ciphertext), plain `region` (varchar 16, indexed).
- **Rules & edge cases:**
  1. `forCurrentWorkspace`: `workspace_id = current workspace`, OR (`workspace_id IS NULL` AND `user_id = current user`) so pre-migration devices stay visible to their pairer. While a platform admin impersonates a workspace (session `impersonation_session_id`; auth stays the admin, only `current_workspace_id` changes) the orphan fallback is dropped so the admin's own orphan devices do not leak into the client's list.
  2. `forWorkspace(workspaceId, fallbackUserId)`: same rule for queue/service contexts with no authenticated user; with neither argument it returns nothing.
  3. Ownership checks for mutations use `WorkspaceEngine::ownsSender` so "listed" and "allowed" agree (a NULL-workspace device listed via the fallback must be editable by its pairer).
  4. The name, country code and phone are encrypted at rest, so SQL cannot filter by them: uniqueness, search, phone lookups from the bridge, inbound routing and sender resolution all hydrate rows and compare digits of `country_code + phone_number` in PHP. Legacy rows store the phone with the country code already included; `display_phone` returns the phone as-is when it already starts with the country code, else `cc + " " + phone`.
  5. Phone masking (`mask_phone`) is intentionally disabled product-wide; numbers render in full everywhere.
  6. `Device::STATUSES` = `connected`, `disconnected`, `needs_pair`, `failed`; `region` is an ISO-2 style code or `XX`.
  7. Legacy NULL-workspace rows are backfilled with a workspace when the status callback or a first save recognises them (TW-WADEV-019).
  8. Other consumers rely on: `conversations.device_id` (for waba/twilio conversations it holds the `wa_provider_configs.id`, not a device id), `Conversation::scopeDeviceAlive`, the team-inbox `device_status` (`cloud` for waba/twilio threads, else the device status), `NodeCacheBuster` (all phones of a workspace), inbound routing (`WaInboundController` resolves a device by the bridge's `device_phone`, falling back to a waba/twilio config, else 404 `device_not_found`).
- **Async & events:** none.
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given workspace A and B each with a device, When a member of A lists devices, Then only A's appear.
  - Given a NULL-workspace device paired by user U, When U (not impersonating) lists devices, Then it appears; When an admin impersonates a workspace, Then the admin's own NULL-workspace devices do not.
  - Given a device stored with cc `91` and phone `7690059356`, When the bridge posts an inbound with `device_phone=917690059356`, Then the device is resolved.
- **Source refs:** app/Models/Device.php, app/Services/WorkspaceEngine.php (ownsSender, orphanPairerUserId), app/Http/Controllers/WaInboundController.php, app/Models/Conversation.php, app/Http/Controllers/TeamInboxController.php (device_status), app/Support/security_helpers.php (mask_phone), database/migrations/2026_05_19_120000_add_workspace_id_to_legacy_tables.php.
- **Port notes:** RLS on `channel_accounts` by `org_id` (ADR-0002); add a deterministic blind index (HMAC of normalized E.164) column for lookups and a unique index `(org_id, phone_hash)`; drop the NULL-workspace fallback by migrating legacy rows.

### TW-WADEV-025 — Twilio WhatsApp connect

- **Status:** implemented
- **Priority:** P1 (expected by customers)
- **Effort:** M
- **Depends on:** TW-WADEV-004
- **Summary:** A workspace admin connects a Twilio WhatsApp sender (Account SID, Auth Token, From number, sandbox or production). Credentials are verified against Twilio before being stored encrypted; the platform admin may supply default credentials so the workspace can leave the fields blank.
- **Actors & access:** route middleware is only `Authenticate` (any signed-in user with a current workspace; the hub that hosts the form requires workspace role `admin`+, the endpoint itself does not); plan cap (TW-WADEV-004) when creating a new row.
- **UX & screens:** `user/devices/_twilio_form.blade.php` (form; embedded in `_twilio_section.blade.php` in single-engine mode or in the `twilio-connect-modal` in multi-engine mode; also the chooser card "Twilio · Twilio WhatsApp sender"): hidden `return_to=/devices`; Account SID (max 64, placeholder `AC...`, hint "Found at twilio.com/console"), Auth Token (password, max 128, "Encrypted at rest"), WhatsApp From number (max 32, +E.164, sandbox default +14155238886), "Use Twilio Sandbox" checkbox (default checked; required while the number is in sandbox), submit "Verify + connect Twilio". When the platform admin saved default Twilio credentials a banner says the fields can be left blank to use them. `_twilio_section` when connected shows a card: Sandbox/Production pill, "connected", From number, Account SID masked (first 8 chars, ellipsis, last 4), "Connected at" relative time, a "Reconnect / rotate" button with confirm "Replace these credentials with new ones?" and the note that all broadcasts, campaigns, scheduled sends, auto-replies and inbox replies use this account and that inbound arrives through the Twilio webhook. Empty state in multi-engine: 'No Twilio sender connected yet. Click "Add device" above, then choose Twilio.'
- **Endpoints:**
  | METHOD uri                   | route name                   | Controller@action              | middleware   | request fields                                                                                                                                               | response                                                                                                                                                                  |
  | ---------------------------- | ---------------------------- | ------------------------------ | ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
  | POST connect/wa-store/twilio | user.connect.wa-store.twilio | WaConnectController@saveTwilio | Authenticate | `account_sid` nullable max 64; `auth_token` nullable max 128; `from_number` nullable max 32; `sandbox` nullable in `0,1`; `return_to` optional relative path | redirect to `return_to` (only paths starting with a single `/`; else `/devices`) with flash "Twilio connected. You can start sending now."; errors back with field errors |
- **Data:** upserts ONE `wa_provider_configs` row per (workspace, provider=`twilio`): `status=connected`, `phone_number` = from number, `display_label` = "Twilio · Sandbox" or "Twilio · Production", `connected_at=now`, `is_primary=true`, `meta_json={sandbox}`, `credentials_json` (encrypted) = `{account_sid, auth_token, from_number, sandbox}`. Also demotes every other provider row of the workspace to `is_primary=false`, creates the workspace storefront row if absent (`wa_storefronts`, enabled, default theme; a side effect owned by STORE), and busts the bridge's per-phone settings cache for the workspace.
- **Rules & edge cases:**
  1. Blank SID/token/from fall back to the admin defaults `system_settings.twilio_account_sid`, `twilio_auth_token`, `twilio_whatsapp_number`; if any of the three is still empty the error is "Account SID, auth token and from-number are all required." (on field `account_sid`). No workspace: "Pick or create a workspace first." (field `from_number`).
  2. Verification: `GET https://api.twilio.com/2010-04-01/Accounts/{sid}.json` with HTTP basic auth, 8 s. A non-2xx response returns "Twilio rejected those credentials: <Twilio message or HTTP status>"; a network failure returns "Could not reach Twilio: <error>". The from number is NOT verified against Twilio and is not normalized.
  3. Multi-engine safe: the row is keyed on (workspace, twilio), so a Twilio connect never overwrites a Baileys/WABA row. QUIRK: it does demote the primary flag on ALL other rows (including WABA), so Twilio silently becomes the workspace default engine (TW-WADEV-001) even in a multi-engine workspace.
  4. Only one Twilio account per workspace; re-submitting rotates the credentials in place (exempt from the plan cap).
  5. `WorkspaceEngine::flush()` is called so the new default applies immediately within the request.
  6. Sandbox flag: at send time a sandbox connection forces the From to the shared sandbox sender `+14155238886` regardless of the stored number (TW-WADEV-029).
  7. Twilio's inbound webhook and delivery-status callback are configured on the Twilio side (docs) and handled by other domains (`api/twilio/status` is WALLET/WABA).
- **Async & events:** cache-bust call to the bridge; engine cache flush.
- **External systems:** Twilio REST API (credential check).
- **Settings:** admin defaults `twilio_account_sid`, `twilio_auth_token`, `twilio_whatsapp_number`; plan `device_limit`.
- **Acceptance criteria:**
  - Given valid credentials, When submitted, Then a connected primary Twilio row is stored encrypted and the user lands on `/devices` with the success flash.
  - Given wrong credentials, When submitted, Then nothing is stored and the error "Twilio rejected those credentials: ..." is shown.
  - Given blank fields and admin defaults present, When submitted, Then the defaults are used.
  - Given `return_to=//evil.com`, When submitted, Then the redirect goes to `/devices`.
  - Given a workspace at its device cap with no Twilio row, When submitted, Then the plan-limit error is shown; with an existing Twilio row, Then rotation succeeds.
- **Source refs:** app/Http/Controllers/WaConnectController.php (saveTwilio, ensureStorefront), resources/views/user/devices/_twilio_form.blade.php, _twilio_section.blade.php, app/Models/WaProviderConfig.php, Documentation/pages/getting-started/connect-channel.html.
- **Port notes:** channel account `provider='twilio'` with credentials in the secret store, verification done via a dedicated provider adapter (`infra/providers/twilio`), and an explicit "make default" action rather than an implicit demotion. Require `channels.manage` permission on the endpoint (Reference's is open to any authenticated user).

### TW-WADEV-026 — Twilio remove

- **Status:** implemented
- **Priority:** P1 (expected by customers)
- **Effort:** S
- **Depends on:** TW-WADEV-025
- **Summary:** The admin deletes the workspace's Twilio account row so it disappears from the channel list; it can be re-added later.
- **Actors & access:** workspace role `admin`+.
- **UX & screens:** trash icon on the Twilio row in `_channel_rows.blade.php` (form DELETE with confirm "Remove this Twilio account from the workspace? This permanently deletes it — you can re-add it later."), and a "Manage" gear that reopens the Twilio modal.
- **Endpoints:**
  | METHOD uri                        | route name                 | Controller@action              | middleware                              | request fields | response                                      |
  | --------------------------------- | -------------------------- | ------------------------------ | --------------------------------------- | -------------- | --------------------------------------------- |
  | DELETE devices/twilio/{id}/remove | user.devices.twilio.remove | DevicesController@twilioRemove | Authenticate, EnsureWorkspaceRole:admin | path id        | redirect back with flash `"<label>" removed.` |
- **Data:** hard-deletes the `wa_provider_configs` row (no soft delete) where id, workspace and provider=`twilio` match (404 otherwise); if it was primary, the next connected Twilio row (none in practice) becomes primary.
- **Rules & edge cases:**
  1. Label = display label, else phone, else "Twilio account".
  2. The workspace's engine resolver then falls through to another connected engine or the platform default; no other row is promoted (a workspace can be left without any primary row).
  3. Audit event `devices.twilio_remove` with the phone.
  4. Existing conversations/campaigns that referenced the Twilio row id keep a dangling id.
- **Async & events:** audit write; no bridge cache bust (bug: the send-path caches may still treat the number as Twilio for up to 5 minutes).
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given a Twilio row, When removed, Then it no longer lists in the hub and the flash names it.
  - Given a Twilio row of another workspace, When DELETE, Then 404.
  - Given the removed row was the workspace's default engine, When the resolver runs, Then it falls back to the next engine.
- **Source refs:** app/Http/Controllers/DevicesController.php (twilioRemove), resources/views/user/devices/_channel_rows.blade.php.
- **Port notes:** soft-delete with a reaper job for credentials; re-elect the default engine explicitly and bust the engine cache.

### TW-WADEV-027 — Legacy wizard: Baileys pointer connect, polling and disconnect

- **Status:** partial (backend works up to an undefined route name; no live screen calls it)
- **Priority:** P2 (nice to have)
- **Effort:** M
- **Depends on:** TW-WADEV-021
- **Summary:** An older connect flow creates a per-workspace "baileys" provider row (server URL + phone), asks the bridge for a QR, and lets the browser poll the row for the QR and paired state; a companion endpoint disconnects the workspace's primary provider. Only the unused provider-picker views reference it.
- **Actors & access:** middleware `Authenticate` only (no workspace-role gate).
- **UX & screens:** `user/connect/providers/baileys.blade.php` and `user/partials/connect-providers.blade.php` (unused by any live page; see TW-WADEV-028): "Pair your phone" with QR slot, WhatsApp number (intl-tel input), optional Device label, optional Node bridge URL override, "Generate QR", a status banner, connected banner "You're connected ✓" with a "Go to store" link. JS `wireBaileys` in `user-connect-wa-store.js` polls every 2 s up to 60 times; on paired it redirects to `/store` after 1.2 s.
- **Endpoints:**
  | METHOD uri                        | route name                       | Controller@action               | middleware   | request fields                                                                                                                       | response                                                                                                                                                                |
  | --------------------------------- | -------------------------------- | ------------------------------- | ------------ | ------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
  | POST connect/wa-store/baileys     | user.connect.wa-store.baileys    | WaConnectController@saveBaileys | Authenticate | `phone_number` required string 6-32; `country_code` nullable max 8; `device_name` nullable max 64; `server_url` nullable url max 191 | JSON `{ok:true, config_id, phone_number, qr_poll_url, status_poll_url}` (see rule 5) or `{ok:false,message}` (422 no workspace / no server URL; 200 bridge unreachable) |
  | GET api/baileys/qr/{configId}     | user.baileys.qr.poll             | WaConnectController@pollQr      | Authenticate | path id (workspace-scoped, 404 otherwise)                                                                                            | `{ok, qr_data, status, paired, phone}`                                                                                                                                  |
  | GET api/baileys/status/{configId} | user.baileys.status.poll         | WaConnectController@pollStatus  | Authenticate | path id                                                                                                                              | same as above                                                                                                                                                           |
  | POST connect/wa-store/disconnect  | user.connect.wa-store.disconnect | WaConnectController@disconnect  | Authenticate | none                                                                                                                                 | redirect back with "Disconnected. Reconnect any time from this page." or "No active connection."                                                                        |
- **Data:** `wa_provider_configs` provider `baileys`, one row per (workspace, provider): `status` pending -> connected, `phone_number`, `display_label` (device label or "Baileys · <phone>"), `is_primary=true`, `meta_json={server_url, phone}`, `credentials_json` (encrypted) `{server_url, phone_number, qr_data, last_status_msg, last_status_at}`; the live QR string is stored (encrypted) in the credentials while pairing.
- **Rules & edge cases:**
  1. Server URL = posted value, else `system_settings.baileys_server_url`, else `.env SERVER_URL`; none -> 422 "Set the Baileys Node server URL in /admin/settings first.". This is the only place a per-connection server URL override exists; the dispatcher later prefers `credentials.server_url` of the primary row.
  2. Phone = digits; if a country code is posted and the local part does not already start with it, `cc + local` (a simpler rule than `splitPhone`, it can double a code).
  3. Plan cap: new row only; counts devices + waba + twilio.
  4. Demotes all other rows' `is_primary` (so a legacy Baileys connect steals the default engine); flushes the engine cache; busts the bridge cache; ensures the workspace storefront row exists.
  5. QUIRK: the success response builds URLs with `route('baileys.qr.poll')` and `route('baileys.status.poll')`, but the registered names are `user.baileys.qr.poll` / `user.baileys.status.poll`, so a successful call throws a route-not-found error after the row and bridge session were already created.
  6. The bridge call is `GET /api/initialize-client/{phone}` (15 s) WITHOUT a token header (loopback exemption).
  7. `pollQr` refreshes the row from `GET /api/client-status/{phone}` (6 s): stores the QR, sets `connected` (and `connected_at` once) when the bridge says connected, stamps `last_health_at`; returns `paired = isConnected()`.
  8. `disconnect` acts on the workspace's PRIMARY provider row of any type: for baileys it asks the bridge to terminate (8 s, no token), then sets `status=disconnected` (credentials kept). For WABA/Twilio it only flips the status.
  9. This endpoint is the only creator of a baileys config row, which is the only thing `api/update-status` can match (TW-WADEV-019).
- **Async & events:** bridge status callbacks target this row.
- **External systems:** Node bridge.
- **Settings:** `baileys_server_url`, `.env SERVER_URL`.
- **Acceptance criteria:**
  - Given no server URL configured anywhere, When POSTed, Then 422 with the admin-settings message.
  - Given a bridge that answers with a QR, When POSTed, Then the config row is pending with `qr_data` stored and other rows lose primary (the route-name defect must not be ported).
  - Given a foreign workspace's config id, When polled, Then 404.
  - Given the primary row is baileys, When disconnect is called, Then the bridge is asked to terminate and the row becomes disconnected.
- **Source refs:** app/Http/Controllers/WaConnectController.php (saveBaileys, disconnect, pollQr, pollStatus), resources/views/user/connect/providers/baileys.blade.php, resources/views/user/partials/connect-providers.blade.php, resources/js/charts/user-connect-wa-store.js (wireBaileys).
- **Port notes:** do not port; the `/devices` flow replaces it. Keep the idea of a per-channel server URL only if the bridge fleet is sharded (then it becomes a `bridge_node_id` on the channel account).

### TW-WADEV-028 — Connect pages (`/connect`, wizard shell, unused provider views)

- **Status:** partial (generic page is a client-side prototype; wizard belongs to STORE)
- **Priority:** P2 (nice to have)
- **Effort:** S
- **Depends on:** TW-WADEV-027
- **Summary:** `GET /connect` serves two things: `?platform=wa-store` renders the WhatsApp Store onboarding wizard (owned functionally by the storefront domain), and any other value renders a generic "Connect Integration" prototype page. Three provider-picker views and a picker partial (Official WABA / Unofficial API QR / Twilio) exist but no live route renders them.
- **Actors & access:** middleware `Authenticate` only.
- **UX & screens:** `user/connect/index.blade.php`: left rail (platform tile, status chip "Not connected", setup steps, help card), title "Connect <platform>", form "Store credentials" (Store URL required + per-platform credential fields), "Test connection" and "Save & connect" buttons, a setup guide column. Platforms defined in JS: shopify (Admin API access token), woocommerce (consumer key + secret), wa-catalog (catalog id + Cloud API token), wa-store (commerce account id + token), gsheets (sheet URL + Google OAuth). QUIRK: nothing is persisted; "Test connection" always shows a fake success after 0.9 s and "Save & connect" only redirects after 0.8 s (to `/shopify`, `/woocommerce` or `/integrations?just_connected=<platform>`). `user/connect/wa-store.blade.php`: wizard shell described by STORE (modes list/add/edit; shop details, public URL, sending device radio list of the workspace's CONNECTED Baileys devices plus the primary connected WABA number, share modal, delete modal). `providers/waba.blade.php`, `providers/twilio.blade.php`, `providers/baileys.blade.php` and `partials/connect-providers.blade.php`: dead provider picker (three cards, per-provider forms, disconnect form posting to `connect/wa-store/disconnect`).
- **Endpoints:**
  | METHOD uri  | route name   | Controller@action           | middleware   | request fields                                                            | response                                                                                                                                                                                                                                                                                                                            |
  | ----------- | ------------ | --------------------------- | ------------ | ------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
  | GET connect | user.connect | UserPagesController@connect | Authenticate | `platform` (`wa-store` or other), wa-store: `action` (`add`), `shop` (id) | wa-store view with `mode` (`edit` when a shop id matches, `add` for `?action=add` or when the workspace has no shop, else `list`), shops, connectedDevices (workspace devices with `status=connected`, ordered active then last seen), primary provider config, `hasWaba`, subdomain settings; otherwise the generic prototype view |
- **Data:** reads `devices`, `wa_provider_configs`, `wa_storefronts`, workspace.
- **Rules & edge cases:**
  1. The wizard's device picker lists only devices with `status='connected'`; the "official number" option appears whenever the workspace's primary provider row is connected (QUIRK: the flag is true for any connected primary row, including a Twilio or legacy Baileys pointer row, not only WABA).
  2. `/connect?platform=<id>&mode=manage` is linked from the integrations page for integrations without a dedicated screen.
  3. Storefront-side behavior (save/reset/waba complete) is not claimed here: `connect/wa-store/save`, `reset`, `waba` belong to STORE/WABA.
- **Async & events:** none.
- **External systems:** none.
- **Settings:** `config/storefront.php` subdomain host (wizard).
- **Acceptance criteria:**
  - Given `?platform=wa-store` and a workspace with no shops, When opened, Then the wizard renders in `add` mode.
  - Given `?platform=shopify`, When opened, Then the prototype form renders and saving redirects to `/shopify` without persisting anything.
- **Source refs:** app/Http/Controllers/UserPagesController.php (connect), resources/views/user/connect/index.blade.php, wa-store.blade.php, providers/baileys.blade.php, providers/twilio.blade.php, providers/waba.blade.php, resources/views/user/partials/connect-providers.blade.php, resources/js/charts/user-connect-index.js, resources/js/charts/user-connect-wa-store.js.
- **Port notes:** do not port the prototype or the picker; the storefront wizard is rebuilt in STORE reading `channel_accounts` for its sender dropdown.

### TW-WADEV-029 — Send-time engine (provider) resolution

- **Status:** implemented
- **Priority:** P0 (product unusable without)
- **Effort:** L
- **Depends on:** TW-WADEV-001
- **Summary:** Every outbound message (chat, campaign, broadcast, scheduled, flow, auto-reply, inbox replies) goes through `WhatsAppDispatcher`, which decides the engine for that message and hands it to the Node bridge or to Twilio.
- **Actors & access:** internal.
- **UX & screens:** none; results appear as message status/error text and the `local_only` state.
- **Endpoints:** none.
- **Data:** reads workspace resolution inputs, `system_settings.allowed_send_methods` / `default_send_method`, `wa_provider_configs`; stamps `messages.provider` when empty.
- **Rules & edge cases:**
  1. Entry points: `send(msg, platform='W')` (guards the monthly message quota first), `schedule(msg, platform)`, `sendRaw(params)` (transient message, no `messages`/`conversations` rows; used by campaigns, scheduled and broadcasts that own their logs; `provider` from the caller pins the engine), and the Baileys-only actions (TW-WADEV-031).
  2. Pre-dispatch gates: (a) platform emergency halt (`SendGate::halted`) refuses with `{ok:false, platform:'halted', local_only:true, error:'Platform emergency halt is engaged...'}`; (b) admin security guardrails (`SendGate::screen`: rate caps and content filters, monitor or enforce) refuse with platform `blocked`; (c) monthly quota with wallet overflow (`OverflowBilling::consumeOne`, WALLET/PLAN) runs in `send` only, not `schedule`.
  3. Workspace resolution for the message: `msg.workspace_id`, else the conversation's, else the sender user's `current_workspace_id`, else the authenticated user's.
  4. Provider resolution order (`resolveProvider`): (1) per-record pin `msg.provider` wins if it is in the admin-allowed set even when that engine is currently disconnected (a Baileys-picked send must never silently reroute through another engine's credentials; if the pinned engine is down the send fails as that engine); (2) the workspace's primary provider row, if connected and allowed; (3) a legacy platform hint other than `W` (`WB` = waba, `T` = twilio) if allowed; (4) `default_send_method` (default baileys); if that is not allowed, the first allowed engine.
  5. The resolved engine is stamped on `messages.provider` when the column is empty, then aligned in memory for the dispatch only and RESTORED afterwards (a `finally` block) so a later save never overwrites the operator's stored pin with a fallback.
  6. Routing: `twilio` -> direct PHP call to Twilio REST; `baileys` and `waba` -> the Node bridge (`dispatchNode`), which reads the per-phone settings from Laravel (`/api/whatsapp-settings`, cached 5 min per workspace+phone) and either uses its Baileys socket or calls Meta's Graph API itself. A complete PHP-only Meta path (`dispatchMetaCloud`) exists but is intentionally unreachable (dead-code kept as a fallback reference).
  7. Twilio path: credentials from the workspace's connected Twilio row, else admin defaults, else env; missing -> local-only result; sandbox forces From `+14155238886`; To/From use `whatsapp:+<digits>`; a `StatusCallback` of `{APP_URL}/api/twilio/status` is attached; when the message's template has a `twilio_content_sid` it is sent via ContentSid + ContentVariables, else as Body (details with TPL/WABA).
  8. Result shape: `{ok, provider_id, platform ('W'|'WB'|'T'|'halted'|'blocked'), local_only, error, hint?}`; `local_only=true` means saved but not sent (no credentials, scheduled Cloud sends, halt) and counts as saved, not delivered.
  9. Engine defaults inconsistency: dispatcher default allowed set `[baileys, waba, twilio]` vs `WorkspaceEngine` default `[baileys]` (QUIRK).
  10. QUIRK: a workspace with only Baileys devices (no config rows) and no pin falls to step 3/4; if the platform default is `waba` (as in the seeded DB) such a send is stamped `waba` and Node then finds no WABA config for the phone and falls back to Baileys, so the stored provider can disagree with the real engine.
- **Async & events:** none of its own; callers run inside their queue jobs/requests.
- **External systems:** Node bridge, Twilio, (Meta via Node).
- **Settings:** `allowed_send_methods`, `default_send_method`, `platform.emergency_send_halt`, security guardrails, monthly quota settings.
- **Acceptance criteria:**
  - Given a message pinned `provider=baileys` while a Twilio primary row exists, When dispatched, Then it goes through Node as baileys and never uses Twilio credentials.
  - Given no pin and a primary connected WABA row, When dispatched, Then engine `waba` is used.
  - Given the platform allows only `baileys`, When a stale Twilio primary row exists, Then it is ignored and baileys is chosen.
  - Given the emergency halt is on, When any send is attempted, Then it returns `ok=false, platform='halted'` without any provider call.
  - Given a pinned engine that is disconnected, When dispatched, Then the send fails as that engine (no reroute).
- **Source refs:** app/Services/WhatsAppDispatcher.php (send, schedule, sendRaw, dispatch, resolveProvider, dispatchTwilio, dispatchMetaCloud, localOnly, guardMonthlyMessagesLimit), app/Support/SendGate.php, app/Services/OverflowBilling.php, Documentation/pages/developer-guide/engines.html.
- **Port notes:** a `MessageDispatcher` in the outbound module using the provider port (`infra/providers/whatsapp/whatsapp.port.ts`) with adapters `baileys-bridge`, `meta-cloud`, `twilio`; pin the channel account on the message row at enqueue time (never infer later); run gates in the BullMQ send job; treat `local_only` as an explicit `not_sent` state.

### TW-WADEV-030 — Baileys dispatch through the Node bridge

- **Status:** implemented
- **Priority:** P0 (product unusable without)
- **Effort:** M
- **Depends on:** TW-WADEV-029, TW-WADEV-021
- **Summary:** For baileys (and waba) sends the dispatcher resolves the bridge URL and the sending number, picks the right bridge endpoint for the message shape, and posts it.
- **Actors & access:** internal.
- **UX & screens:** errors surface in chat/inbox as the failure reason (for example "No connected device — pair one at /devices first.").
- **Endpoints:** none of Laravel's. Bridge endpoints called: `POST /api/send-message/:from` (text, optional buttons/footer/title/carousel), `/api/send-media-message/:from` (media + caption), `/api/send-media-only/:from`, `/api/send-location/:from`, `/api/schedule-message/:from` (single scheduled send).
- **Data:** reads primary `wa_provider_configs` creds (`server_url`, `phone_number`), `devices`, `system_settings.baileys_server_url`.
- **Rules & edge cases:**
  1. Bridge URL: primary config `credentials.server_url`, else `baileys_server_url`, else `.env SERVER_URL`; empty -> local-only result "SERVER_URL not set and workspace has no Baileys config".
  2. Sending number (`from`): the message's own `from_number` (multi-device sends pin it per row), else the primary config's phone only when that config is itself Baileys (so a multi-engine workspace never leaks a Twilio/WABA number into a Baileys send, which the bridge would answer "CLIENT NOT FOUND"), else the most recent connected device of the workspace (`Device::forWorkspace(ws, user)`, `status='connected'`, highest id). None -> `{ok:false, error:'No connected device — pair one at /devices first.'}`.
  3. Endpoint choice: scheduled (with `scheduled_at`) -> schedule endpoint with the wall-clock time in the conversation's scheduled timezone, else the workspace timezone, else app timezone, plus the timezone name; a pure location pin (lat/lon, no buttons) -> send-location; media (not a carousel) -> media endpoints with the file INLINED as base64, the real mime type and the original file name (recovered from the `random__original-name` storage key); a media URL that maps back to our own storage is inlined too (so a private-IP install passes the bridge's SSRF guard), a genuinely external URL is passed as a link; voice notes (`meta.ptt`) set `ptt/voice` and force `audio/ogg; codecs=opus`; otherwise text. Group replies carry `targetJid` (the raw `@g.us` or LID jid) so the bridge does not fabricate a user JID. Buttons, footer and header title from `meta` are merged for interactive messages.
     3b. The resolved provider is forwarded as `payload.provider` when set so Node routes explicitly.
  4. HTTP timeouts: 40 s text / 90 s media (raised from 20 s). QUIRK: the bridge's own default query timeout is 120 s, so a slow-but-successful send can be reported as failed at 40 s and retried into a duplicate; the port must keep client timeout >= bridge timeout or use idempotency keys.
  5. Success: `provider_id` = `messageId` or `scheduleId` or `id` from the bridge JSON; failure: error from `error`/`details`/`message`/HTTP status, or the thrown exception text.
  6. Sends are also queued per device inside the bridge (TW-WADEV-021 rule 2).
- **Async & events:** none.
- **External systems:** Node bridge.
- **Settings:** `baileys_server_url`, `SERVER_URL`.
- **Acceptance criteria:**
  - Given a message with `from_number=9198...` and a connected session, When dispatched, Then the bridge receives it on `/api/send-message/9198...`.
  - Given a media message with a caption, When dispatched, Then it goes to `send-media-message` with base64 content, the correct mime type and the original file name.
  - Given no connected device and no from number, When dispatched, Then `ok=false` with the pair-a-device message.
  - Given a scheduled message in timezone Asia/Kolkata, When dispatched, Then `scheduleDateTime` is the wall-clock time in that timezone.
- **Source refs:** app/Services/WhatsAppDispatcher.php (dispatchNode, buildNodeRequest, mergeButtonsFooter, resolveMessageType), node/routes/index.js, Documentation/pages/developer-guide/engines.html.
- **Port notes:** the send job calls the bridge over an authenticated internal API with an idempotency key (`message.id`), sends media by signed URL fetched by the bridge (or a blob handle), and never infers the sender from "latest connected device" — the channel account id is on the message.

### TW-WADEV-031 — Baileys-only message actions (react, pin, star)

- **Status:** implemented
- **Priority:** P2 (nice to have)
- **Effort:** S
- **Depends on:** TW-WADEV-030
- **Summary:** Emoji reactions, pin/unpin (with duration) and star/unstar of an existing WhatsApp message are sent through the bridge; Meta Cloud and Twilio messages silently no-op.
- **Actors & access:** invoked by chat/inbox controllers (CHAT/TIB1).
- **UX & screens:** reaction/pin/star menu items in the chat and team-inbox message actions (documented there).
- **Endpoints:** bridge: `POST /api/send-reaction/:from`, `/api/pin-message/:from`, `/api/star-message/:from`.
- **Data:** needs `messages.meta.wa_message_id` and optionally `meta.target_jid`.
- **Rules & edge cases:**
  1. Provider check first: any non-Baileys resolution returns `{ok:true, local_only:true}` without a call.
  2. Sender phone: primary config phone if Baileys, else the outbound message's own `from_number`, else the conversation's device, else the newest connected device of the workspace; server URL as TW-WADEV-030. Missing -> `{ok:false, error:'No connected device or server url'}`.
  3. Payload: `targetPhoneNumber` (customer number: `from_number` for inbound messages, `to_number` for outbound), `targetJid`, `targetMessageId`, `fromMe` (true for outbound), plus `emoji` (empty string clears the reaction), `pin` + `duration` seconds (WhatsApp-required 24 h / 7 d / 30 d; default 86400), or `star`.
  4. Pin/star without a stored WhatsApp id fail with "This message was saved before WhatsApp-id tracking was enabled. Receive a new message and try again."; reaction sends without an id let the bridge default to the latest fromMe message.
  5. 10 s timeout, errors returned as text; star does not notify the recipient (chat-modify sync only).
- **Async & events:** none.
- **External systems:** Node bridge.
- **Settings:** none.
- **Acceptance criteria:**
  - Given an inbound Baileys message with a stored `wa_message_id`, When the operator reacts with an emoji, Then the bridge gets `fromMe=false` and the customer's number as target.
  - Given a WABA-provider message, When pin is requested, Then the result is `local_only` with no bridge call.
  - Given no `wa_message_id`, When pin is requested, Then the error above is returned.
- **Source refs:** app/Services/WhatsAppDispatcher.php (reaction, pin, star, messageAction), node/routes/index.js.
- **Port notes:** part of the outbound module; capability flag `supportsReactions/pin/star` on the provider port so the UI hides them for other engines.

### TW-WADEV-032 — Unified sender keys and picker resolution

- **Status:** implemented
- **Priority:** P0 (product unusable without)
- **Effort:** M
- **Depends on:** TW-WADEV-001, TW-WADEV-024
- **Summary:** All sender pickers (campaigns, broadcasts, scheduled, flows, chat composer, auto-reply, mobile app) get the same list of connected senders across engines and channels, each with a composite key `engine:id`, and forms submit that key.
- **Actors & access:** internal, used by many controllers.
- **UX & screens:** grouped sender dropdowns labelled by engine; the "Connect new device" link (`_connect-device-link` partial) opens the connect popover (TW-WADEV-036).
- **Endpoints:** none of its own.
- **Data:** reads `devices`, `wa_provider_configs`, `facebook_pages`, `telegram_bots`, `line_channels`, `we_chat_channels`, `viber_channels`, `workspace_email_accounts`, `workspace_ig_accounts`.
- **Rules & edge cases:**
  1. Sender entry: `{key, engine, id, phone, label, descriptor, is_default}`; keys are `baileys:<devices.id>`, `waba:<config id>`, `twilio:<config id>`, `sms:<config id>`, `instagram:<Instaflow account id>`, `facebook|telegram|line|wechat|viber|email:<local row id>`. Composite keys are needed because `devices.id` and `wa_provider_configs.id` overlap.
  2. Only CONNECTED senders are listed: Baileys `devices.status='connected'` (workspace devices plus the current pairer's legacy NULL-workspace devices, none while impersonating), provider rows `status=connected`; side channels also require their platform toggle and at least one connected account (email additionally the plan flag `access_email` and a live bridge).
  3. Default-engine senders sort first; label falls back to "<engine label> · <phone>".
  4. `senders(ws, engines)`: `engines` null = the workspace's `enginesFor` set (WhatsApp engines only); explicit sets can add side channels; the `/devices` hub passes the merged set.
  5. Coexistence dedupe (`dedupePreferWaba`, used by campaigns): the same physical number can be connected as WABA and as a Baileys device; senders with the same phone are collapsed keeping the most official (waba, twilio, sms, baileys) so a recipient is not messaged twice; side channels and blank phones are never collapsed.
  6. `parseSenderKey`: `engine:id` (id > 0, engine in the known list) else null; a bare integer is accepted for back-compat and its engine inferred from the workspace default.
  7. `senderForKey` validates a submitted key against the workspace's live senders (forged or stale keys return null); it always includes the key's own engine in the set so an Instagram key is resolvable.
  8. `validDeviceIds`/`validDeviceIdsForEngine` return sender ids valid for server-side validation (Baileys: workspace + own orphans; waba/twilio: connected rows; for the single-engine variant waba/twilio rows are not filtered by status).
- **Async & events:** none.
- **External systems:** none.
- **Settings:** per-channel toggles; `access_email` plan feature.
- **Acceptance criteria:**
  - Given one connected Baileys device and one connected WABA number, When `senders` runs, Then two entries with keys `baileys:<id>` and `waba:<id>` are returned with the default engine first.
  - Given a WABA and a Baileys sender with the same phone and `dedupePreferWaba`, When run, Then only the WABA sender remains.
  - Given the key `baileys:9999` of another workspace, When `senderForKey` runs, Then null.
  - Given the key `12`, When parsed, Then the engine is the workspace default and the id 12.
- **Source refs:** app/Services/WorkspaceEngine.php (senders, parseSenderKey, senderForKey, validDeviceIds, validDeviceIdsForEngine, descriptor, allEngines), resources/views/user/partials/_connect-device-link.blade.php.
- **Port notes:** a single `GET /channels/senders?purpose=campaign|chat|flow` endpoint returning channel accounts (`id` is a uuid, so composite keys disappear) with `provider` and `capabilities`; keep the coexistence dedupe as an explicit `dedupe=prefer_official` option.

### TW-WADEV-033 — Inbound and phone-sent message capture from linked sessions

- **Status:** implemented
- **Priority:** P0 (product unusable without)
- **Effort:** L
- **Depends on:** TW-WADEV-021
- **Summary:** Each Baileys socket turns WhatsApp events into calls to Laravel `POST api/inbound-message`: customer messages (which then drive routing, keyword replies, flows and the AI agent), replies the operator types on the phone, mirrored replies sent by automations, reactions and group messages. The Laravel handler and the downstream pipelines belong to CHAT/TIB1/AR/FLR; this entry records what the device layer captures and filters.
- **Actors & access:** machine caller with `X-Node-Token` (Laravel returns 401 `unauthorized` on mismatch or an empty configured token).
- **UX & screens:** results appear in the team inbox and chat.
- **Endpoints:** Laravel `POST api/inbound-message` (route `baileys.inbound`, `WaInboundController@baileys`, claimed by CHAT); required fields `device_phone` and `sender_phone`, plus body, media (base64/url/mime/filename), buttons/header/footer, `is_lid`/`raw_jid`/`lid_jid`, `group_subject`, contact-card fields, forwarded metadata, location fields, `timestamp`, `direction` (`in` default, `out` for phone-sent), `wa_message_id`, `reaction_emoji`/`reaction_target`.
- **Data:** none written by the bridge; Laravel resolves the device by digits of `device_phone` (TW-WADEV-024), falling back to a waba/twilio config, else 404 `{ok:false,error:'device_not_found'}` and the message is dropped.
- **Rules & edge cases:**
  1. Only `messages.upsert` events of type `notify` (new) and `append` (includes the socket's own sends) are processed.
  2. `fromMe` messages (operator typing on the phone, another linked device, or the bot's own flow/AI reply) go to the outbound-mirror path: skip groups, status, newsletters and broadcast lists; skip empty protocol/receipt events; skip anything older than 600 s (history replay on reconnect must not re-flood the inbox); recipient = customer digits from the alt/remote JID; media downloaded (two attempts, 1.5 s apart, with re-upload request) and inlined as base64 only if at most 16 MB; location and contact cards mapped to explicit fields; posted with `direction=out` (30 s timeout with media, else 10 s; 32 MB body cap).
  3. Inbound customer messages: ignore non-notify batches; ignore replays older than 600 s (a reconnect must not re-run a day-old flow); ignore `status@broadcast`, newsletters and broadcast lists; group messages (`@g.us`) take a narrow path that only stores the message so the thread is readable and repliable (no flows, keyword replies or AI, to avoid fan-out in 800-member groups).
  4. Sender identity: prefers `senderPn`, `participantPn`, `remoteJidAlt` (real phone); a chat known only by a linked-device id (`@lid`) uses the LID digits and is flagged `is_lid`; the raw JID is forwarded so replies target the right chat.
  5. Text extraction order: plain conversation, extended text, legacy button reply (display text then id), list reply (title then row id), template button reply, native-flow interactive response (`display_text` or `id` from its params JSON). Media types recognised: image, video, audio, document, location (with coordinates, name, address), contact cards, reactions (forwarded as a reaction-only event, no bubble).
  6. Reactions: `reactionMessage` becomes a reaction event carrying the emoji (empty clears) and the target message id.
  7. Own automation replies are mirrored into the inbox (`mirrorOwnAutoReply`, `mirrorOwnMediaReply`) so the thread shows both sides.
  8. Keyword replies and flows are resolved by the bridge through Laravel (`GET api/keyword-replies?keyword=&mobile=&phone=`, `GET api/flows/{id}`); those belong to AR/FLR/NODE.
- **Async & events:** per-message HTTP calls; errors are logged and swallowed (a failed forward loses the message).
- **External systems:** Laravel inbound endpoint.
- **Settings:** token; none else.
- **Acceptance criteria:**
  - Given a customer DM, When it arrives on a connected number, Then one inbound call with `device_phone`, `sender_phone`, body and `wa_message_id` is made.
  - Given an operator reply typed on the phone, When it arrives as `fromMe`, Then it is forwarded with `direction=out`.
  - Given a message older than 10 minutes delivered after reconnect, When processed, Then it is skipped.
  - Given a group message, When processed, Then only the store path runs (no flow/AI/keyword reply).
- **Source refs:** node/classes/BaileysClientManager.js (handleMessages, syncOutboundFromPhone, forwardGroupInbound, mirrorOwnAutoReply, mirrorOwnMediaReply), app/Http/Controllers/WaInboundController.php.
- **Port notes:** the bridge worker publishes normalized inbound events to a BullMQ queue (or the API's webhook-style ingest) with a stable idempotency key `(channel_account_id, wa_message_id)`; do not lose messages on a failed HTTP call; keep the 600 s replay guard configurable.

### TW-WADEV-034 — Delivery-receipt forwarding from linked sessions

- **Status:** implemented
- **Priority:** P1 (expected by customers)
- **Effort:** S
- **Depends on:** TW-WADEV-021
- **Summary:** Baileys message-status updates for messages the number sent are pushed to Laravel so campaign, broadcast, scheduled and chat messages progress from sent to delivered to read.
- **Actors & access:** machine caller with token.
- **UX & screens:** tick states in chat/inbox and delivery counters in broadcasts/campaigns.
- **Endpoints:** Laravel `POST api/update-message-status` (broadcast/campaign contacts) and `POST api/chat/message-status` (chat/inbox rows matched by `messages.meta.wa_message_id`); claimed by BCAST/CAMP/CHAT.
- **Data:** none by the bridge.
- **Rules & edge cases:**
  1. Baileys statuses: 2 server-ack and 1 pending are ignored (they would demote a "sent" row); 3 = delivered (`delivered_at`), 4 = read (`read_at`), 5 = played is treated as read.
  2. If the message id belongs to a broadcast tracked in the bridge's in-memory `scheduledMessages.sentMessages` map the receipt goes to `update-message-status` with `broadcast_id`, `contact_id`, `status`, `whatsapp_message_id` and the timestamp; otherwise it goes to `chat/message-status`. Because the map is in memory, receipts that arrive after a bridge restart fall through to the chat endpoint.
  3. Campaign responses and receipts also feed `handleCampaignMessageUpdate` / `trackCampaignResponse` in the campaign service (CAMP).
  4. Failures are logged per receipt and never retried.
  5. Wallet settlement for delivered messages is driven from these receipts (WALLET).
- **Async & events:** one HTTP call per receipt.
- **External systems:** Laravel.
- **Settings:** token.
- **Acceptance criteria:**
  - Given a chat message sent from the number, When WhatsApp reports status 4, Then `chat/message-status` receives `status=read` and `read_at`.
  - Given a broadcast message, When status 3 arrives, Then `update-message-status` receives `status=delivered`.
  - Given status 2, When it arrives, Then nothing is forwarded.
- **Source refs:** node/classes/BaileysClientManager.js (handleMessageStatusUpdate), node/services/campaignService.js.
- **Port notes:** publish `message.status` events keyed by provider message id; make the ordering rule "status only moves forward" the receiver's responsibility (see the inbox README ordering note).

### TW-WADEV-035 — Device detail and analytics page

- **Status:** implemented
- **Priority:** P1 (expected by customers)
- **Effort:** M
- **Depends on:** TW-WADEV-024
- **Summary:** Per-device page combining the Edit form, the proxy panel, connection status, 7-day delivery analytics, recent failures, a live send feed, per-source counts and a searchable message history for that number.
- **Actors & access:** workspace role `admin`+ (device must be in the current workspace scope, else 404).
- **UX & screens:** `user/devices/detail.blade.php` ("Device Analytics"), with `js/charts/user-devices-detail.js` (ApexCharts). Sections in order: header bar (back to devices, "Devices / <number>", "<name> analytics", buttons Disconnect (active) or Re-pair (link to the hub anchor), and "Refresh session" / "Mark connected" (toggle, see TW-WADEV-011)); flash banner; Edit device form (TW-WADEV-010); Proxy / dedicated IP (TW-WADEV-016/017); device summary (status pill, region, dial code, "Last sync <relative>" or "Never connected", "Added <relative>"); five KPI tiles (Sent 7d, Delivered %, Sent 24h, Failed, Status); "Sent vs failed (7d)" stacked bar chart; "Delivery breakdown" donut with Delivered / Failed / Total sent; "Top recipients" (top 5 by outbound count over the last 200 messages, number shown in full, link to chat) and "Recent failed sends" (last 8, time/recipient/reason/action); "Recent sends from this device" live feed (last 50 across sources) with tiles Chat sends / Campaign sends / Scheduled sends / Message templates, refreshed every 5 s; "All messages for this device" history with source chips, direction filter All/Sent/Received/Failed, search box "Search body / phone / contact…", 25 per page with numbered pager; "Health checks" (Bridge online / Not connected, delivery rate healthy at >= 95% else slipping) and a "Linked sessions" card (region, dial code, status, added).
- **Endpoints:**
  | METHOD uri       | route name          | Controller@action      | middleware                              | request fields                                                                                                                        | response  |
  | ---------------- | ------------------- | ---------------------- | --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- | --------- |
  | GET devices/{id} | user.devices.detail | DevicesController@show | Authenticate, EnsureWorkspaceRole:admin | `sources[]` subset of `inbox,auto_reply,campaign,scheduled,legacy` (default all five); `dir` in `in,out,fail` (else all); `q`; `page` | HTML page |
- **Data:** reads `devices`; `messages` via `conversations.device_id` (outbound, last 7 days); `wp_campaign_contacts` via `wpcampaigns.device_id` OR orphaned campaigns (created by the current user whose `device_id` is not among the workspace's current devices, so re-pairing the same phone does not lose history); `scheduled_messages` by `device_id` when the table exists; `wa_templates` count for the workspace; unified stream (`UnifiedMessageStream::paginateForDevice` + `countsForDevice`, owned by the message-history feature).
- **Rules & edge cases:**
  1. Activity rows normalized to `{ts, status, kind, to, body}`; per-day buckets for 7 days ending today; "sent" = status not in failed/pending/queued/scheduled; "failed" = `failed`. `delivered7d = max(0, sent7d - failed7d)` (QUIRK: failed rows are already excluded from sent, so delivered is undercounted and the delivery % is understated).
  2. QUIRK: the chart's x-axis labels are hard-coded Mon..Sun while the data is "6 days ago .. today", so the labels are wrong except by coincidence.
  3. Messages are attributed to a device only through `conversations.device_id` because `messages.from_number` is encrypted.
  4. The 5-second auto-refresh refetches the whole page and swaps only the two feed tbodies when their content changed; it pauses while the tab is hidden.
  5. Page-level queries are unbounded in code (the blade reloads the last 200 messages a second time for the top-recipient and failure panels).
- **Async & events:** 5 s polling.
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given a device with sends in the last 7 days, When the page loads, Then the KPI tiles, charts and feed reflect them with the failed count matching `status=failed` rows.
  - Given `?dir=fail&q=555`, When loaded, Then the history lists only failed messages matching "555" and keeps the filters across pages.
  - Given a device of another workspace, When requested, Then 404.
- **Source refs:** app/Http/Controllers/DevicesController.php (show), resources/views/user/devices/detail.blade.php, resources/js/charts/user-devices-detail.js, app/Services/UnifiedMessageStream.php.
- **Port notes:** `GET /channels/:id/stats?range=` returning aggregates computed in SQL (delivered = delivered+read), keep the history as a paginated messages query filtered by `channel_account_id`.

### TW-WADEV-036 — Connect-device popover embed mode

- **Status:** implemented
- **Priority:** P2 (nice to have)
- **Effort:** S
- **Depends on:** TW-WADEV-005
- **Summary:** Any campaign/broadcast/scheduled/chat form can offer "Connect new device" that opens a popover iframing `/devices?embed=1`, so a number can be connected without losing the half-filled form; on success the sender picker refreshes in place.
- **Actors & access:** signed-in users (popover shell `x-user.connect-device-sheet`, owned by ASHELL); the embedded page still needs workspace role `admin`+.
- **UX & screens:** `?embed=1` hides the app chrome (header, main, trial bar, paywall), forces the channel chooser to render permanently as the base layer, and on a server-side `status` flash tells the parent a device connected. The popover (`resources/views/components/user/connect-device-sheet.blade.php`) is a full-screen sheet with title "Add a WhatsApp device", a spinner and the iframe; `Escape`, overlay or close button dismiss it. The trigger partial `_connect-device-link` renders a "Connect new device" text button (`data-connect-device`).
- **Endpoints:** reuses `GET devices` (TW-WADEV-005) with `embed=1`.
- **Data:** none.
- **Rules & edge cases:**
  1. The iframe `src` is set lazily on first open and removed on close, which tears down the QR poller.
  2. The iframe posts `threadwise:device-connected` (after QR success, after a native Twilio/WABA redirect with a status flash) and `threadwise:connect-close` (chooser cancel) to the parent; the parent dispatches a `device:connected` DOM event, toasts "Device connected.", closes, and after 0.5 s refetches the current page and swaps only `[data-device-picker]` nodes (falling back to reload) then fires `device:pickers-refreshed`.
  3. The parent's message listener does not verify `event.origin` and the child posts with target `*` (tighten in the port).
- **Async & events:** postMessage.
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given a campaign form with a picker, When the user connects a device in the popover, Then the picker shows the new number without a page reload and the entered form values remain.
  - Given the popover is closed mid-QR, When closed, Then the iframe source is cleared and polling stops.
- **Source refs:** resources/views/user/devices/index.blade.php (embed block), resources/views/components/user/connect-device-sheet.blade.php, resources/views/user/partials/_connect-device-link.blade.php, resources/js/app.js (initConnectDevice).
- **Port notes:** build as a dialog component using the same channel-connect components (no iframe); emit a client event and invalidate the senders query.

### TW-WADEV-037 — Admin platform devices list

- **Status:** implemented
- **Priority:** P1 (expected by customers)
- **Effort:** M
- **Depends on:** TW-WADEV-024
- **Summary:** The super-admin console lists every Baileys device across all workspaces with KPIs, status tabs, search and row actions.
- **Actors & access:** platform admin (Authenticate, EnsureUserIsAdmin, IPAllowlist).
- **UX & screens:** `resources/views/admin/devices/index.blade.php` ("Admin · Platform devices", "All devices"): header badge "N connected", "Bulk re-sync" (confirm "Re-sync every device from the bridge? This pulls the live connection status for all numbers."), "Export CSV"; KPI cards Total devices ("+N this week", "across N wks" = distinct workspaces), Connected ("healthy"), Needs re-pair ("action req", "expired QR"), Disconnected ("offline"), Sent (24h) ("live", sum of the stored column); status tabs All / Connected / Needs re-pair / Disconnected (a `failed` filter is valid via URL but has no tab); search "Search name, number, owner…" with Search and Clear; table columns Device & number, Workspace, Owner, Last sync, Sent 24h, Status pill (Connected, Re-pair, Failed, Disconnected); per-row three-dot menu: open detail, Re-sync, Force disconnect (only when connected; confirm "Force-disconnect this device? Its live WhatsApp session will be terminated."), Remove (confirm "Remove this device permanently? This cannot be undone."); pager with "Showing a-b of n devices"; empty states "No devices have been paired on the platform yet." / "No devices match this filter.". `js/charts/devices-index.js` wires the menu (global `toggleDevMenu`, closes on outside click, Escape and scroll). Header copy also promises "transfer ownership" and force re-pair which do not exist (TW-WADEV-045).
- **Endpoints:**
  | METHOD uri        | route name          | Controller@action            | middleware                                   | request fields                                                       | response |
  | ----------------- | ------------------- | ---------------------------- | -------------------------------------------- | -------------------------------------------------------------------- | -------- |
  | GET admin/devices | admin.devices.index | AdminPagesController@devices | Authenticate, EnsureUserIsAdmin, IPAllowlist | `status` (all/connected/disconnected/needs_pair/failed), `q`, `page` | HTML     |
- **Data:** all `devices` with `user` and `workspace` relations; KPI counts computed before the status filter so they always describe the platform; order `id` desc; 20 per page via an in-memory paginator.
- **Rules & edge cases:**
  1. Search (case-insensitive substring) runs in PHP over device name, phone digits (`country_code + phone_number`), owner name, owner email and workspace name; a query containing `+`, spaces or dashes will not match the digits-only phone.
  2. "Sent (24h)" reads `devices.sent_24h`, which no code updates (QUIRK: always the seeded/0 value).
  3. No workspace scope (deliberate: platform console).
  4. Legacy NULL-workspace devices show "—" as workspace.
- **Async & events:** none.
- **External systems:** none.
- **Settings:** admin IP allowlist.
- **Acceptance criteria:**
  - Given 30 devices, When the admin opens the page, Then 20 render with the pager and KPI counts describe all 30.
  - Given `?q=acme`, When loaded, Then rows whose workspace, owner or device name contain "acme" show and the KPIs are unchanged.
  - Given a non-admin user, When requesting the route, Then access is denied by the admin middleware.
- **Source refs:** app/Http/Controllers/AdminPagesController.php (devices), resources/views/admin/devices/index.blade.php, resources/js/charts/devices-index.js.
- **Port notes:** `apps/api/src/modules/admin/channels` behind the platform-admin pool (ADR-0007) reading through a read model that bypasses tenant RLS with an explicit admin role; paginate and search in SQL using the blind index and joined names.

### TW-WADEV-038 — Admin device detail and analytics

- **Status:** implemented
- **Priority:** P2 (nice to have)
- **Effort:** M
- **Depends on:** TW-WADEV-037
- **Summary:** Platform-admin view of one device with lifetime KPIs, range-selectable charts, an hour-of-day heatmap and its audit/session log.
- **Actors & access:** platform admin (Authenticate, EnsureUserIsAdmin, IPAllowlist).
- **UX & screens:** `resources/views/admin/devices/detail.blade.php` ("Admin · Device analytics"): breadcrumb Admin / Devices / <name · workspace>; range select (Last 24 hours / Last 7 days / Last 30 days); buttons Re-sync session, Force disconnect (connected only), Export CSV, Remove device; header with device id, status, owner, "Paired <relative>"; KPI cards Sent (24h), Delivered, Read rate, Failed (all time), Total sent (all time); "Sent vs failed · <range>" bar chart; "Delivery breakdown" donut (Read, Delivered, Pending, Failed); "Hour-of-day heatmap" (last 7 days, labelled "IST" although computed in the app timezone); "Session log" table (When, Event, Detail, actor or "system", empty text "No recorded events for this device yet.") and an "Action log" list ("No admin actions recorded for this device yet."), paginated 15; `js/charts/devices-detail.js` draws the three ApexCharts from `data-*` attributes.
- **Endpoints:**
  | METHOD uri             | route name           | Controller@action                 | middleware                                   | request fields                               | response |
  | ---------------------- | -------------------- | --------------------------------- | -------------------------------------------- | -------------------------------------------- | -------- |
  | GET admin/devices/{id} | admin.devices.detail | AdminPagesController@deviceDetail | Authenticate, EnsureUserIsAdmin, IPAllowlist | `range` in `24h,7d,30d` (default 7d), `page` | HTML     |
- **Data:** `devices` + user + workspace; `audit_logs` where `subject_type='device'` and `subject_id=id` ordered newest first, 15 per page; `messages` (outbound, via `conversations.device_id`) for analytics.
- **Rules & edge cases:**
  1. Buckets: 24 hourly buckets for 24h, 30 daily for 30d, 7 daily otherwise; "sent" counts non-failed, "failed" counts failed; status donut buckets read / delivered / failed / (pending, scheduled, sent) pending.
  2. Heatmap is always 7 x 24 on non-failed outbound rows.
  3. Lifetime KPIs come from a status group-by over all outbound messages of the device.
  4. Returns honest zeros when the messages/conversations tables are missing or the device has no traffic.
  5. Events are read straight from the audit log; there is no separate device-events table.
- **Async & events:** none.
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given `?range=24h`, When loaded, Then the volume chart has 24 hourly buckets while the heatmap still spans 7 days.
  - Given a device with no messages, When loaded, Then all charts render empty and KPIs are 0.
  - Given admin actions on the device, When loaded, Then they appear in the action log with the admin's name.
- **Source refs:** app/Http/Controllers/AdminPagesController.php (deviceDetail, deviceAnalytics), resources/views/admin/devices/detail.blade.php, resources/js/charts/devices-detail.js.
- **Port notes:** analytics from SQL aggregates keyed by `channel_account_id`; use the tenant timezone for the heatmap and label it accordingly.

### TW-WADEV-039 — Admin force-disconnect

- **Status:** implemented
- **Priority:** P1 (expected by customers)
- **Effort:** S
- **Depends on:** TW-WADEV-023
- **Summary:** The platform admin terminates any device's live WhatsApp session across tenants and marks it disconnected.
- **Actors & access:** platform admin.
- **UX & screens:** row menu and detail button "Force disconnect" (confirm); flash "Device disconnected and its session terminated." or "Device marked disconnected (the bridge did not confirm — it may already be offline).".
- **Endpoints:**
  | METHOD uri                         | route name               | Controller@action                     | middleware                                   | request fields | response                        |
  | ---------------------------------- | ------------------------ | ------------------------------------- | -------------------------------------------- | -------------- | ------------------------------- |
  | POST admin/devices/{id}/disconnect | admin.devices.disconnect | AdminPagesController@deviceDisconnect | Authenticate, EnsureUserIsAdmin, IPAllowlist | path id        | redirect back with status flash |
- **Data:** `devices.active=false`, `status='disconnected'`; audit `admin.device.disconnect` with `subject_type='device'`, `subject_id`, meta `{bridge, workspace_id}`.
- **Rules & edge cases:**
  1. Same bridge call as TW-WADEV-012 (`terminate-client`, 8 s, token); not workspace-scoped; local flip happens regardless of the bridge outcome.
  2. No notification to the workspace owner (QUIRK: silent for the tenant).
- **Async & events:** audit.
- **External systems:** Node bridge.
- **Settings:** none.
- **Acceptance criteria:**
  - Given a connected device in any workspace, When force-disconnected, Then the bridge is called, the row is disconnected and an audit row with the admin as actor exists.
  - Given the bridge is down, When called, Then the row is still updated and the "did not confirm" flash shows.
- **Source refs:** app/Http/Controllers/AdminPagesController.php (deviceDisconnect).
- **Port notes:** publish the same domain event as a user disconnect with `actor_type='platform_admin'` so the tenant is notified.

### TW-WADEV-040 — Admin re-sync and bulk re-sync

- **Status:** implemented
- **Priority:** P2 (nice to have)
- **Effort:** S
- **Depends on:** TW-WADEV-023
- **Summary:** The admin pulls the live connection state from the bridge for one device or for every device on the platform and writes it to the rows.
- **Actors & access:** platform admin.
- **UX & screens:** "Re-sync" in the row menu, "Re-sync session" on the detail page, "Bulk re-sync" on the list (with confirm). Flashes: "Device re-synced — status is now <status>." / "Could not reach the bridge; the device status is unchanged." / ":n of :t devices re-synced from the bridge." / "No devices could be reached on the bridge.".
- **Endpoints:**
  | METHOD uri                     | route name                | Controller@action                      | middleware                                   | request fields | response                 |
  | ------------------------------ | ------------------------- | -------------------------------------- | -------------------------------------------- | -------------- | ------------------------ |
  | POST admin/devices/{id}/resync | admin.devices.resync      | AdminPagesController@deviceResync      | Authenticate, EnsureUserIsAdmin, IPAllowlist | path id        | redirect back with flash |
  | POST admin/devices/bulk-resync | admin.devices.bulk-resync | AdminPagesController@devicesBulkResync | same                                         | none           | redirect back with flash |
- **Data:** `devices.status`, `active`, `last_seen_at`; audit `admin.device.resync` (meta bridge/status/workspace) and `admin.device.bulk_resync` (meta total/synced).
- **Rules & edge cases:**
  1. `GET /api/client-status/{digits}` (8 s, token). Only bridge statuses that are valid device statuses (`connected`, `disconnected`, `needs_pair`, `failed`) are written; the bridge's `qr_ready` and `code_ready` are ignored so the row is left unchanged, but `last_seen_at` is still set to now on ANY answer (QUIRK: a disconnected device looks "seen just now").
  2. When the status is not `connected`, `active` is set false; when connected `active` is kept as is (not set true).
  3. Bulk runs sequentially over every device on the platform (up to 8 s each; a long request that can exceed web timeouts) and reports how many answered.
  4. Blank phones or no bridge URL count as unreachable.
- **Async & events:** audit.
- **External systems:** Node bridge.
- **Settings:** none.
- **Acceptance criteria:**
  - Given the bridge says connected for a device shown disconnected, When re-synced, Then it becomes connected with `last_seen_at` now.
  - Given the bridge is unreachable, When re-synced, Then the status is unchanged and the flash says so.
  - Given 10 devices of which 7 answer, When bulk re-sync runs, Then the flash reads "7 of 10 devices re-synced from the bridge.".
- **Source refs:** app/Http/Controllers/AdminPagesController.php (syncDeviceFromBridge, deviceResync, devicesBulkResync).
- **Port notes:** make bulk re-sync an async job with progress, and never touch `last_seen_at` from a status read.

### TW-WADEV-041 — Admin CSV export

- **Status:** implemented
- **Priority:** P2 (nice to have)
- **Effort:** S
- **Depends on:** TW-WADEV-037
- **Summary:** Downloads the device roster as CSV honouring the list's status and search filters.
- **Actors & access:** platform admin.
- **UX & screens:** "Export CSV" button on the list (carries current `status` and `q`) and on the detail page (unfiltered).
- **Endpoints:**
  | METHOD uri               | route name           | Controller@action                  | middleware                                   | request fields | response                                                |
  | ------------------------ | -------------------- | ---------------------------------- | -------------------------------------------- | -------------- | ------------------------------------------------------- |
  | GET admin/devices/export | admin.devices.export | AdminPagesController@devicesExport | Authenticate, EnsureUserIsAdmin, IPAllowlist | `status`, `q`  | streamed CSV `devices-YYYYMMDD-HHMMSS.csv` (`text/csv`) |
- **Data:** same query as the list, all rows (no paging).
- **Rules & edge cases:**
  1. Columns: Device, Number ("<country code> <phone>"), Workspace, Owner, Owner email, Status, Sent 24h, Last sync (`Y-m-d H:i:s` or empty).
  2. Formula-injection guard: any text cell starting with `=`, `+`, `-` or `@` is prefixed with a single quote (same guard as the audit-log export); missing names/owners render as an em dash; device with no name renders `#<id>`.
  3. Numbers are exported in full (no masking).
- **Async & events:** none.
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given `?status=connected`, When exported, Then only connected devices are in the file.
  - Given a device named `=cmd`, When exported, Then the cell is `'=cmd`.
- **Source refs:** app/Http/Controllers/AdminPagesController.php (devicesExport).
- **Port notes:** stream from a cursor; add an `audit` row for exports of personal data.

### TW-WADEV-042 — Admin remove device

- **Status:** implemented
- **Priority:** P1 (expected by customers)
- **Effort:** S
- **Depends on:** TW-WADEV-039
- **Summary:** The platform admin permanently deletes a device row after best-effort terminating its bridge session.
- **Actors & access:** platform admin.
- **UX & screens:** "Remove" in the row menu and "Remove device" on the detail page (danger confirm "Remove this device permanently? This cannot be undone."); flash `Device ":name" removed.`, redirect to the list.
- **Endpoints:**
  | METHOD uri                | route name            | Controller@action                  | middleware                                   | request fields | response                          |
  | ------------------------- | --------------------- | ---------------------------------- | -------------------------------------------- | -------------- | --------------------------------- |
  | DELETE admin/devices/{id} | admin.devices.destroy | AdminPagesController@deviceDestroy | Authenticate, EnsureUserIsAdmin, IPAllowlist | path id        | redirect to `admin.devices.index` |
- **Data:** hard-deletes the row; audit `admin.device.destroy` (subject id, workspace id).
- **Rules & edge cases:**
  1. Terminates the bridge session first (8 s, token, failure ignored) so no orphan socket remains.
  2. Unlike the workspace delete (TW-WADEV-013) it does NOT close the device's open conversations (QUIRK).
  3. Device Eloquent delete also writes the observer's `device.deleted` audit row.
- **Async & events:** audit.
- **External systems:** Node bridge.
- **Settings:** none.
- **Acceptance criteria:**
  - Given any device, When removed by the admin, Then the row is gone, the bridge session is terminated when reachable and an audit row exists.
  - Given the bridge is down, When removed, Then the row is deleted anyway.
- **Source refs:** app/Http/Controllers/AdminPagesController.php (deviceDestroy).
- **Port notes:** share one `ChannelAccountService.remove()` between tenant and admin paths so conversation closing and bridge logout always happen.

### TW-WADEV-043 — No-bridge demo mode

- **Status:** implemented
- **Priority:** P2 (nice to have)
- **Effort:** S
- **Depends on:** TW-WADEV-007
- **Summary:** When no Node bridge URL is configured anywhere, the pairing endpoints return deterministic placeholder data so the UI can be exercised without a bridge.
- **Actors & access:** dev/demo installs.
- **UX & screens:** the QR slot shows a small SVG with "DEMO #<device id>"; the pairing code panel shows a fixed 8-digit numeric code derived from the device id; the progress strip walks Qr generated (25%) -> Syncing data (60%, 85%) -> Ready (100%) by the age of the row's `updated_at` (under 3 s, under 7 s, under 12 s, else ready).
- **Endpoints:** the same `qr-code`, `pairing-code`, `connection-status` endpoints; responses carry `demo:true`.
- **Data:** none written by the demo branch (the UI then posts `connection` which marks the device connected).
- **Rules & edge cases:**
  1. `check` returns `{ok:false, reason:'SERVER_URL not configured', reset:0}` in this state.
  2. QUIRK: a production install with a missing URL silently shows a fake QR instead of an error, and the fake "Ready" state lets a user mark a device connected that was never paired. The port should replace this with an explicit "bridge not configured" error outside development.
- **Async & events:** none.
- **External systems:** none.
- **Settings:** absence of `baileys_server_url` and `SERVER_URL`.
- **Acceptance criteria:**
  - Given no bridge URL, When a QR is requested, Then a placeholder data-URL SVG with the device id is returned with `demo:true`.
  - Given the same, When status is polled 13 s after the row's last update, Then status "Ready" progress 100.
- **Source refs:** app/Http/Controllers/DevicesController.php (qrCode, pairingCode, connectionStatus, demoQrDataUrl, demoStatusFor, check).
- **Port notes:** keep only as a `NODE_ENV=development` fake bridge adapter for tests.

### TW-WADEV-044 — Staff permission keys `devices.*`

- **Status:** dead-code
- **Priority:** P2 (nice to have)
- **Effort:** S
- **Depends on:** -
- **Summary:** Six permission keys are seeded for staff roles but no route, middleware, policy or view checks them.
- **Actors & access:** none effective.
- **UX & screens:** appear as toggles in the role/permission admin screens (RBAC).
- **Endpoints:** none (`/devices` uses the workspace-role middleware; `/admin/devices*` uses the admin-only middleware, never a permission key).
- **Data:** `permissions` rows `devices.view`, `devices.create`, `devices.edit`, `devices.delete`, `devices.pair`, `devices.disconnect` created by `RolePermissionSeeder`.
- **Rules & edge cases:**
  1. Granting or revoking these keys changes nothing in v1.7.0; access is decided by `EnsureWorkspaceRole:admin` (workspace roles owner/admin) and platform-admin middleware.
  2. Effective mapping to preserve when rebuilding: view = see `/devices` and analytics, create = add device/connect Twilio, edit = edit/proxy, delete = delete, pair = QR/pairing code, disconnect = kill-session; the port should enforce these keys for workspace members (with owner/admin default) via the RBAC middleware (ADR-0006).
- **Async & events:** none.
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given a role without `devices.pair`, When the port's `GET /channels/:id/qr` is called, Then it returns 403 (new behavior, not in Reference).
  - Given the seeded permission list, When RBAC lists keys, Then the six `devices.*` keys exist.
- **Source refs:** database/seeders/RolePermissionSeeder.php.
- **Port notes:** register `channels.view|create|edit|delete|pair|disconnect|proxy` in the permission catalogue with the `rbac-permission` skill and guard each endpoint.

### TW-WADEV-045 — Docs-only and hidden claims (device balancing, transfer ownership, region rail)

- **Status:** docs-only
- **Priority:** P2 (nice to have)
- **Effort:** S
- **Depends on:** -
- **Summary:** Several statements in the marketing docs and UI copy describe behavior that has no working code path in v1.7.0; recorded so the port does not promise them by accident.
- **Actors & access:** n/a.
- **UX & screens:** hidden or copy-only elements listed below.
- **Endpoints:** none.
- **Data:** none.
- **Rules & edge cases:**
  1. "Reference balances sends across every active device" (docs connect-channel, and a help card in the hidden `/devices` sidebar): the sender is fixed per message (`from_number`); the only automatic choice is "newest connected device" as a last-resort fallback. There is no round-robin or health-based load balancing and no failover when a device drops.
  2. Admin devices header promises "Force re-pair, disconnect, or transfer ownership"; only disconnect exists (TW-WADEV-039); no transfer-ownership or force-re-pair route.
  3. The `/devices` left rail (status filters + region filter + pairing tip) is wrapped in a permanently false condition; region counts are computed and the region filter works via URL but has no UI. The header checkbox and per-row checkboxes have no bulk action.
  4. Docs say one channel is active platform-wide (`connect-channel`, "Active messaging engine") and per-workspace single engine; superseded by multi-engine (v1.1) in code; the multi-engine and channels pages are the accurate ones.
  5. Docs describe `terminate-client` as preserving the session and describe an `auth/` folder; the code wipes the session and the folder is `baileys_auth/`.
  6. Docs list "Reactions, pin/star, edit/delete for Unofficial API only": accurate, but edit/delete callers live in the team-inbox dispatcher (`InboxDispatcher`, owned by TIB1), while the chat `WhatsAppDispatcher` documented here exposes only react/pin/star (TW-WADEV-031).
  7. Docs advise the 14-day "phone must open WhatsApp" rule and per-number warm-up; those are user guidance, not enforced (the warmer is SCHED).
- **Async & events:** none.
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given the port's parity checklist, When reviewing device features, Then items 1-3 are marked "not implemented in Reference" and are tracked as new features if wanted.
  - Given a code search for a transfer-ownership route, When run against v1.7.0, Then none exists.
- **Source refs:** Documentation/pages/getting-started/connect-channel.html, Documentation/pages/channels/whatsapp.html, Documentation/pages/faqs/whatsapp-bans.html, Documentation/pages/developer-guide/node-bridge.html, resources/views/admin/devices/index.blade.php, resources/views/user/devices/index.blade.php.
- **Port notes:** if load balancing is desired, design it as a routing policy on a sender pool (round-robin over connected accounts with per-account rate caps) in the outbound module.

### TW-WADEV-046 — Demo device seeder

- **Status:** implemented
- **Priority:** P2 (nice to have)
- **Effort:** S
- **Depends on:** -
- **Summary:** `DeviceSeeder` (called by `DatabaseSeeder`) deletes ALL devices and inserts five demo Baileys devices so `/devices` and the admin list render content before anything is paired.
- **Actors & access:** developers running seeders.
- **UX & screens:** none.
- **Endpoints:** none.
- **Data:** five rows: Bloomly Support (+91, connected, active, 3210 sent, 12 failed, seen 8 min ago), Bloomly Sales (+91, connected, active, 2840, 19, 4 min), Bloomly Ops (+91, disconnected, inactive, no last seen), Bloomly US (+1, needs_pair, 411, 3, 120 min), Bloomly UAE concierge (+971, connected, 582, 1, 2 min); regions IN/IN/IN/US/AE; `user_id` and `workspace_id` NULL.
- **Rules & edge cases:**
  1. Destructive: it first deletes every existing device row, so running it against a real database wipes all paired devices.
  2. The seeded phone numbers embed the country code twice (cc + local, then stored under a country-code column too), i.e. the legacy shape that `display_phone` tolerates.
  3. NULL workspace/user means the rows are invisible to every workspace except through the platform admin list.
  4. These are the only rows where `needs_pair` and non-zero `sent_24h/failed_24h` appear. A second demo seeder (`DemoGapSeeder::seedChannels`, owned by the demo-data tooling) creates one workspace-scoped connected US device with a warmer config plus demo WABA, Twilio and SMS provider rows.
- **Async & events:** none.
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given a fresh database, When `DeviceSeeder` runs, Then five devices exist with the statuses above.
  - Given existing devices, When it runs, Then they are removed first.
- **Source refs:** database/seeders/DeviceSeeder.php, database/seeders/DatabaseSeeder.php.
- **Port notes:** a dev-only fixture with workspace-scoped rows and idempotent upserts; never delete in a shared environment.

## Data model

### `devices` (Baileys / Unofficial-API numbers)

Purpose: one row per WhatsApp number paired through the Node bridge (plus seed/demo rows). Read/written by TW-WADEV-005 to 015, 016 to 020, 024, 030, 032, 035, 037 to 042, 046. Volume: tens per workspace, low thousands per platform; hot-read by the 10 s status loop and the 30 s heartbeat (both currently scan all rows in PHP because of the encryption).

| Column                 | Type / null / default                                                     | Behavior                                                                                                                                                 |
| ---------------------- | ------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| id                     | bigint unsigned PK                                                        | Also the `baileys:<id>` sender key and `conversations.device_id` for Baileys threads                                                                     |
| user_id                | bigint unsigned null                                                      | Who paired it (visibility fallback for legacy NULL-workspace rows); no FK                                                                                |
| assigned_user_id       | bigint unsigned null, FK users ON DELETE SET NULL                         | Display-only owner; no membership validation                                                                                                             |
| workspace_id           | bigint unsigned null, FK workspaces ON DELETE SET NULL, indexed           | Tenant key; NULL only for legacy/seeded rows                                                                                                             |
| device_name            | text NOT NULL, encrypted cast                                             | Label (2-191 chars on input)                                                                                                                             |
| country_code           | text null, encrypted cast                                                 | Bare digits (`91`)                                                                                                                                       |
| phone_number           | text NOT NULL, encrypted cast                                             | Bare local digits; legacy rows may embed the country code                                                                                                |
| region                 | varchar(16) null, indexed                                                 | ISO-2 style or `XX`; filterable, plain text                                                                                                              |
| active                 | tinyint(1) NOT NULL default 0, indexed; composite index (user_id, active) | Manual "routing enabled" flag used by dashboards, mobile default-device pick and auto-reply, set by pairing/toggle/heartbeat                             |
| activate_after_pairing | tinyint(1) NOT NULL default 1                                             | Decides whether a successful pair sets `active=true` (status poll and `check`); the callback and mark-connected ignore it                                |
| status                 | varchar(16) NOT NULL default `disconnected`, indexed                      | Enum `connected` \| `disconnected` \| `needs_pair` \| `failed` (`Device::STATUSES`); `needs_pair` only from the legacy callback, `failed` never produced |
| proxy_enabled          | tinyint(1) NOT NULL default 0                                             | TW-WADEV-016                                                                                                                                             |
| proxy_type             | varchar(8) null                                                           | `http` \| `socks5`                                                                                                                                       |
| proxy_host             | varchar(255) null                                                         |                                                                                                                                                          |
| proxy_port             | smallint unsigned null                                                    | 1-65535                                                                                                                                                  |
| proxy_username         | text null, encrypted cast                                                 |                                                                                                                                                          |
| proxy_password         | text null, encrypted cast                                                 | Never returned to the browser                                                                                                                            |
| proxy_status           | varchar(16) null                                                          | `ok` \| `unreachable` \| null                                                                                                                            |
| proxy_egress_ip        | varchar(64) null                                                          | Last verified egress IP                                                                                                                                  |
| proxy_checked_at       | timestamp null                                                            |                                                                                                                                                          |
| sent_24h               | int unsigned NOT NULL default 0                                           | Never incremented by code (seed-only); surfaced in lists/KPIs                                                                                            |
| failed_24h             | int unsigned NOT NULL default 0                                           | Same                                                                                                                                                     |
| warmer_config          | longtext JSON null                                                        | Warmer ramp profile (owned by SCHED): `enabled, daily_base, step_pct, max_daily, gap_min, gap_max, active_start, active_end, started_at`                 |
| warm_day               | date null (model cast date; demo seed writes an integer)                  | Warmer (SCHED)                                                                                                                                           |
| warm_day_count         | int unsigned NOT NULL default 0                                           | Warmer (SCHED)                                                                                                                                           |
| last_seen_at           | timestamp null                                                            | Heartbeat/grace clock: written by check (every live poll), heartbeat touch, toggle, status poll                                                          |
| created_at, updated_at | timestamp null                                                            |                                                                                                                                                          |

Indexes: PK; `(user_id, active)`; `user_id`; `region`; `active`; `status`; `assigned_user_id`; `workspace_id`. No unique index on phone (encrypted). Model events: `updated` emits the `device_status_updated` webhook on status change; `AuditableObserver` writes `device.created|updated|deleted`. Hard delete only (no soft delete, no FK cascade to conversations/campaigns).

### `wa_provider_configs` (per-workspace provider rows; shared with WABA)

Purpose: one row per connected provider sender: `waba` (many per workspace), `twilio` (one), `sms` (many), `meta_ads` (ad credentials, not a sender), and legacy `baileys` pointer rows. Read by engine resolution, dispatcher, hub, senders. Written here by TW-WADEV-025, 026, 027, 019; by WABA/SMS/MetaAds elsewhere.

| Column                                                    | Type / null / default                                     | Behavior                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| --------------------------------------------------------- | --------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| id                                                        | bigint unsigned PK                                        | Sender key id for `waba:`/`twilio:`/`sms:`                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| workspace_id                                              | bigint unsigned NOT NULL, FK workspaces ON DELETE CASCADE | The unique(workspace_id) constraint was dropped (multi-engine)                                                                                                                                                                                                                                                                                                                                                                                                                     |
| provider                                                  | varchar(16) NOT NULL                                      | `waba` \| `baileys` \| `twilio` \| `sms` \| `meta_ads` (enum `WaProvider` covers the first three)                                                                                                                                                                                                                                                                                                                                                                                  |
| status                                                    | varchar(16) NOT NULL default `pending`                    | `pending` \| `connected` \| `disconnected` \| `failed`                                                                                                                                                                                                                                                                                                                                                                                                                             |
| credentials_json                                          | text null, encrypted with the app key (Laravel `Crypt`)   | Shape per provider: baileys `{server_url, phone_number, qr_data, last_status_msg, last_status_at}`; twilio `{account_sid, auth_token, from_number, sandbox}`; waba `{app_id, app_secret, waba_id, business_id, phone_number_id, access_token, webhook_verify_token, catalog_id, register_pin}`; sms `{account_sid, auth_token, from_number}`. Column was once too short and truncated the ciphertext (a fix migration widened it); a failed decrypt is logged and treated as empty |
| meta_json                                                 | longtext JSON null                                        | baileys `{server_url, phone}`; twilio `{sandbox}`; waba health/platform fields (`platform_type`, `quality_rating`, `display_phone_number`, ...); sms `{sms_provider, sender_id, dlt_template_id, rate_per_segment, currency}`                                                                                                                                                                                                                                                      |
| phone_number                                              | varchar(32) null                                          | Sender phone (digits or `+E.164`); matching strips `+` and spaces                                                                                                                                                                                                                                                                                                                                                                                                                  |
| display_label                                             | varchar(64) null                                          | UI label (e.g. "Twilio · Sandbox")                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| is_primary                                                | tinyint(1) NOT NULL default 0                             | Workspace default engine row; `setAsPrimary()` demotes siblings in a transaction                                                                                                                                                                                                                                                                                                                                                                                                   |
| connected_at                                              | timestamp null                                            | Set first time connected                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| last_health_at                                            | timestamp null                                            | Last status/health touch                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| calling_enabled, calling_enabled_at, calling_enabled_meta | tinyint / timestamp / JSON                                | WABA voice calling (CALL)                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| warmer_config, warm_day, warm_day_count                   | JSON / date / int                                         | Warmer profile shared with `devices` (SCHED)                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| created_at, updated_at                                    | timestamp null                                            |                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |

Indexes: PK; `(provider, status)`; `(workspace_id, is_primary)`. Scopes: `forWorkspace`, `connected`, `primaryForWorkspace` (excludes `meta_ads`; orders is_primary desc, connected_at desc, id desc), `matchingPhoneNumber`. Hard delete only.

### Other storage touched (not owned)

- Filesystem `node/baileys_auth/session_<digits>/` (Baileys multi-file auth, `baileys_store.json`, `proxy.json`): the session of record; folders with fewer than 3 files are treated as incomplete.
- `system_settings` keys used here: `allowed_send_methods`, `default_send_method`, `active_engine_slug`, `baileys_server_url`, `node_webhook_token` (encrypted), `baileys_callback_token` (legacy), `twilio_account_sid`, `twilio_auth_token`, `twilio_whatsapp_number`, `waba_config_id`, `waba_app_id`, per-channel `*_enabled` toggles, `msg_gap`, `batches_gap`, `bw_msg_gap`, `enable_batches`.
- `workspaces.enabled_engines` (JSON, null) and `default_engine` (varchar 16, null): read by the resolver, never written by the app; `workspaces.bill_to_platform_credit` (BSP).
- `packages.device_limit` (int default 1), `packages.access_proxy_isolation` (bool default 0), `packages.multipledevice` (bool; consumed by the chat compose modal).
- `messages.provider`, `conversations.device_id`, `conversations.provider`: stamped/consumed by the dispatcher and inbox (device_id points to `devices.id` for Baileys and to `wa_provider_configs.id` for waba/twilio).
- Not owned: `flow_connected_devices` (FLB), `user_device_tokens` (MOB push tokens; a different meaning of "device").

## Cross-domain contracts

- **Consumes NODE (`node-bridge-runtime`):** the bridge process and its HTTP surface; this domain documents only the device/session slice (BaileysClientManager, client controller, heartbeat, restore). NODE owns the send/schedule/broadcast/campaign/flow controllers, `api/whatsapp-settings` and `api/whatsapp-message-settings` (per-phone engine credentials and pacing, not claimed here) and the shared-secret scheme.
- **Exposes to NODE:** `POST api/update-status`, `POST api/node-heartbeat`, `GET api/devices/proxy-config/{phone}`, `POST api/devices/proxy-result`; the device identity rule (digits of country code + phone).
- **Consumes WABA (`whatsapp-cloud-api-waba`):** `wa_provider_configs` provider=waba rows and every `devices/waba/*` endpoint plus the WABA section/modals/health views on `/devices` (WABA owns behavior; this file lists the view files only as hub composition). Exposes: engine resolution, sender keys, unified device cap, `NodeCacheBuster`.
- **Consumes PLAN (`plans-subscriptions-trials`):** `PlanLimitGuard::check/feature`, `effectiveLimit('device_limit')`, `effectiveLimit('access_proxy_isolation')`, `access_sms`, `access_email`. Exposes: the unified count definition.
- **Consumes SET (`platform-settings-branding-storage`):** `system_settings` storage and encryption-at-rest of secrets; the Channels hub landing page. Exposes: the engine settings keys.
- **Consumes NOTIF (`notifications-activity-audit`):** `NotificationHelper::toUser`, `Audit::log`, `AuditableObserver`; event keys `device_connected`, `device_disconnected`. Exposes: those events and audit action names `devices.proxy_saved`, `devices.twilio_remove`, `admin.device.disconnect|resync|bulk_resync|destroy`.
- **Consumes INTG (`integrations-hubspot-slack-trello-google-webhooks`):** `WebhookService::emit('device_status_updated', ...)`. Exposes: the payload shape in TW-WADEV-015.
- **Consumes CHAT/TIB1:** inbound ingest `POST api/inbound-message` (resolves a device by phone digits), `conversations.device_id`, `Conversation::scopeDeviceAlive`, the team-inbox `device_status` pill (`cloud` for waba/twilio), `InboxDispatcher` (same bridge endpoints; edit/delete). Exposes: `Device` lookup by digits, `WhatsAppDispatcher`, sender keys.
- **Consumes WALLET/PLAN:** `OverflowBilling::consumeOne` and the monthly message quota inside `WhatsAppDispatcher::send`; delivery receipts feed wallet settlement.
- **Consumes/Exposes SCHED (`scheduled-queue-warmer`):** the warmer reads/writes `devices.warmer_config`, `warm_day`, `warm_day_count`; the scheduled-message retry sweep and broadcast/campaign sweeps are currently triggered by the heartbeat and must move to jobs in their own domains.
- **Consumes WSP (`workspaces-teams-tenancy`):** `workspaces.enabled_engines/default_engine`, `owner_user_id` (notification recipient), impersonation session flag, `current_workspace_id`.
- **Consumes RBAC (`roles-permissions`):** `EnsureWorkspaceRole:admin` (owner 100, admin 80, manager 60, agent 40, viewer 20; platform admins bypass) and platform-admin middleware; the seeded but unused `devices.*` keys.
- **Consumes ASHELL:** the global "Connect device" popover shell and the settings hub tiles (they link to the flows described here).
- **Exposes to MOB/API/EXT (routes claimed elsewhere):** `Api\App\DeviceController` (mirrors add/QR/pair-code/status/disconnect/delete/connect-Twilio/connect-WABA/contacts) uses the same `Device` model and bridge endpoints but differs: it strips the country-code prefix unconditionally (no 9-digit guard), leaves `region` null when not sent, returns HTTP 402 `plan_limit` on the cap, calls the bridge without `X-Node-Token`, and its delete closes open conversations; `Api\V1\DeviceController` lists `devices` (engine always `baileys` -> public label `unofficial`) plus waba/twilio rows as `cfg_<id>` (`whatsapp_cloud`/`twilio`), `status` connected/disconnected, `last_seen_at` = `connected_at`; `Api\ExtensionApiController@devices` (EXT) lists devices for the Chrome extension.
- **Exposes to WFL/STORE/ECOM/MADS:** the workspace sending-device picker data (`connectedDevices`), `ensureStorefront` side effect on Twilio/wizard connects, and the `devices` rows referenced by storefront `device_id`.

## Open questions & quirks

1. QUIRK (critical): `api/update-status` matches only a `wa_provider_configs` row of provider `baileys`, and only the legacy wizard creates one; numbers added through `/devices` therefore never receive pushed status, and the broadcast and "needs_pair" mapping are dead for them. The port must key the callback on the channel-account identity.
2. QUIRK: `devices.sent_24h` / `failed_24h` are never updated, so every "Sent 24h" cell, the "Routed 24h" KPI (Baileys share) and admin KPI show seeded/zero values. Reference's provider-row KPIs compute 24 h from `messages.provider`; Baileys does not.
3. QUIRK: `devices.status = failed` is never produced by any code path; `needs_pair` only by the legacy callback or the unreachable `status` field on `PUT devices/{id}`.
4. QUIRK: two undefined route names: `route('user.devices')` (non-AJAX `POST devices` success redirect) and `route('baileys.qr.poll')` / `route('baileys.status.poll')` (legacy wizard success payload). The intended names are `user.devices.index` and `user.baileys.*`.
5. QUIRK: the delete paths differ: workspace `DELETE devices/{id}` closes conversations but does not terminate the bridge session; admin delete terminates but does not close conversations; mobile delete does both.
6. QUIRK: sessions are keyed by phone digits only; two workspaces can hold the same number (duplicate check is per workspace) and would share one bridge session and auth folder. Bridge status callbacks, proxy lookup and inbound routing all resolve the FIRST matching device platform-wide.
7. QUIRK: inconsistent default of the allowed engine set (`[baileys]` in the resolver, `[waba,baileys,twilio]` in the dispatcher and hub, `["waba"]` in the seeded reference database with default `waba`).
8. QUIRK: `workspaces.enabled_engines` / `default_engine` are read but nothing writes them (no admin UI or API); `default_engine` is not read at all (the default engine is derived from primary rows).
9. QUIRK: `toggle` and `POST devices/{id}/connection` let an admin assert connected state without contacting the bridge; the detail page labels the toggle "Refresh session" on an active device.
10. QUIRK: `check()` runs sequential 4 s bridge calls per device on every 10 s browser tick per open tab, saves `last_seen_at` through Eloquent each time (likely one audit row per device per poll) and is the only source of connect/disconnect notifications.
11. QUIRK: heartbeat stale sweep leaves `active=true` on devices it marks disconnected; devices with NULL `last_seen_at` are never swept; no heartbeat is sent when the bridge has zero ready sockets, so nothing sweeps in that state.
12. QUIRK: `terminate-client` = full WhatsApp logout + session wipe (docs say soft disconnect); `GET check-connection` wipes sessions when a device is not ready.
13. QUIRK: Laravel send timeout (40 s text / 90 s media) is below the bridge query timeout (120 s), inviting duplicate sends on slow-but-successful attempts; a code comment in the bridge says Laravel's timeout must be at least 120 s.
14. QUIRK: bridge callers other than the web controllers omit `X-Node-Token` and rely on the loopback exemption; with `NODE_API_AUTH=token` or a remote bridge they fail with 401.
15. QUIRK: proxy plaintext credentials are cached in `proxy.json` in the session folder; the proxy test runs from the API server against a user-supplied host (SSRF); proxy test persists results for unsaved values.
16. QUIRK (cosmetic): the add-device modal's country-picker submit hook rewrites the phone input with a regex that strips an entire E.164 value; because the AJAX handler reads the form first the posted value is fine, but the visible phone field can end up empty next to the QR.
17. QUIRK: `_table.blade.php` reads a `assignedUser` relation that the `Device` model does not define, so it falls back to `User::find` per row (N+1).
18. QUIRK: detail-page delivery % double-subtracts failures; chart day labels are hard-coded Mon..Sun; admin heatmap says "IST" but uses the app timezone; admin bulk re-sync can outlast web timeouts.
19. QUIRK: `DeviceStatusChanged` broadcasts on a private channel that is never authorized nor subscribed to.
20. QUIRK: Twilio and legacy-wizard connects demote `is_primary` on every other provider row (including WABA), silently changing the workspace default engine.
21. Docs vs code: see TW-WADEV-045 (no load balancing, no transfer ownership/force re-pair, region rail hidden, single-active-channel wording outdated, terminate wording, `auth/` folder name).
22. Routes in `DevicesController`/`WaConnectController` deliberately NOT claimed here (so other writers can pick them up): `devices/waba/*` (connect manual/embedded, verify/exchange token, primary, disconnect, remove, register, resubscribe, sync-history, health, health.json, webhook-check, set-token, token-refresh, username claim/delete, qr-codes create/delete) -> WABA; `devices/instagram/*` -> IG; `devices/email/*` -> MAIL; `devices/billing-mode` -> BSP (already claimed there); `api/whatsapp-settings`, `api/whatsapp-message-settings` -> NODE; `connect/wa-store/sms` -> SMS; `connect/wa-store/save|reset|waba` -> STORE/WABA; `admin/settings/channel-setting/pacing|check-webhooks|subscribe-webhooks|otp-template` and the `GET admin/settings/channel-setting/{section?}` hub page -> SET/NODE/WABA/AUTH; `POST api/inbound-message` -> CHAT; `api/update-message-status`, `api/chat/message-status` -> BCAST/CHAT; `api/groups/sync` -> WFL; `api/twilio/status` -> WALLET/WABA; `api/app/devices*`, `api/app/device-*` -> MOB; `api/v1/devices*` -> API; `api/get-devices` -> EXT; `api/app/device-tokens/*` -> MOB/NOTIF; `flows/api/connect|disconnect` -> FLB.
23. The hint listed "DeviceController (12 routes)" for this domain; those 12 are `Api\App\DeviceController` and belong to MOB per the boundary rule. Its device semantics are captured under Cross-domain contracts.
24. Unclear: `Package.multipledevice` is a plan toggle consumed only by the chat compose modal (device_ids[] mode); its exact behavior belongs to CHAT.
25. Unclear: `node/.env` is present in the node file manifest (installer output); it is not read here. `node/classes/BaileysClientManager.backup.js` is a stale copy (excluded from audit).
26. Unclear: `SendGate::screen` is documented as fail-open but its catch turns any thrown exception into a "blocked" result; behavior of the guardrail internals belongs to the admin security domain.

## Coverage

```json threadwise-coverage
{
  "routes": [
    "POST admin/settings/providers",
    "POST admin/settings/channel-setting/node",
    "POST admin/settings/channel-setting/node/test",
    "GET devices",
    "POST devices",
    "GET devices/{id}/qr-code",
    "GET devices/{id}/pairing-code",
    "GET devices/{id}/connection-status",
    "POST devices/{id}/connection",
    "PUT devices/{id}",
    "POST devices/{id}/toggle",
    "POST devices/{id}/kill-session",
    "DELETE devices/{id}",
    "POST devices/check",
    "POST devices/{id}/proxy",
    "POST devices/{id}/proxy/test",
    "GET api/devices/proxy-config/{phone}",
    "POST api/devices/proxy-result",
    "POST api/update-status",
    "POST api/node-heartbeat",
    "POST connect/wa-store/twilio",
    "DELETE devices/twilio/{id}/remove",
    "POST connect/wa-store/baileys",
    "GET api/baileys/qr/{configId}",
    "GET api/baileys/status/{configId}",
    "POST connect/wa-store/disconnect",
    "GET connect",
    "GET devices/{id}",
    "GET admin/devices",
    "GET admin/devices/{id}",
    "POST admin/devices/{id}/disconnect",
    "POST admin/devices/{id}/resync",
    "POST admin/devices/bulk-resync",
    "GET admin/devices/export",
    "DELETE admin/devices/{id}"
  ],
  "controllers": [
    "app/Http/Controllers/DevicesController.php",
    "app/Http/Controllers/WaConnectController.php"
  ],
  "services": [
    "app/Services/WhatsAppDispatcher.php",
    "app/Services/WorkspaceEngine.php",
    "app/Services/NodeCacheBuster.php"
  ],
  "models": ["Device", "WaProviderConfig"],
  "tables": ["devices", "wa_provider_configs"],
  "views": [
    "resources/views/admin/devices/detail.blade.php",
    "resources/views/admin/devices/index.blade.php",
    "resources/views/user/connect/index.blade.php",
    "resources/views/user/connect/providers/baileys.blade.php",
    "resources/views/user/connect/providers/twilio.blade.php",
    "resources/views/user/connect/providers/waba.blade.php",
    "resources/views/user/connect/wa-store.blade.php",
    "resources/views/user/devices/_channel_rows.blade.php",
    "resources/views/user/devices/_inbound_badge.blade.php",
    "resources/views/user/devices/_sms_form.blade.php",
    "resources/views/user/devices/_table.blade.php",
    "resources/views/user/devices/_twilio_form.blade.php",
    "resources/views/user/devices/_twilio_section.blade.php",
    "resources/views/user/devices/_waba_modals.blade.php",
    "resources/views/user/devices/_waba_section.blade.php",
    "resources/views/user/devices/detail.blade.php",
    "resources/views/user/devices/index.blade.php",
    "resources/views/user/devices/waba-health.blade.php",
    "resources/views/user/partials/connect-providers.blade.php"
  ],
  "commands": [],
  "permissions": [
    "devices.create",
    "devices.delete",
    "devices.disconnect",
    "devices.edit",
    "devices.pair",
    "devices.view"
  ],
  "middleware": [],
  "node_files": [
    "node/classes/BaileysClientManager.js",
    "node/controllers/clientController.js",
    "node/utils/cleanup.js",
    "node/utils/sendSafety.js",
    "node/utils/helpers.js",
    "node/routes/index.js",
    "node/index.js",
    "node/index-cpanel.js",
    "node/app.cjs",
    "node/server.cjs",
    "node/log-gate.js",
    "node/config/config.js",
    "node/package.json"
  ],
  "js_assets": [
    "resources/js/charts/devices-detail.js",
    "resources/js/charts/devices-index.js",
    "resources/js/charts/user-connect-index.js",
    "resources/js/charts/user-connect-wa-store.js",
    "resources/js/charts/user-devices-detail.js",
    "resources/js/charts/user-devices-index.js"
  ],
  "misc_files": ["app/Enums/WaProvider.php", "app/Events/DeviceStatusChanged.php"],
  "config_files": [],
  "doc_pages": [
    "Documentation/pages/channels/whatsapp.html",
    "Documentation/pages/getting-started/connect-channel.html",
    "Documentation/pages/getting-started/multi-engine.html",
    "Documentation/pages/getting-started/proxy-isolation.html",
    "Documentation/pages/getting-started/channel-settings.html",
    "Documentation/pages/faqs/whatsapp-bans.html",
    "Documentation/pages/developer-guide/engines.html",
    "Documentation/pages/developer-guide/node-bridge.html"
  ],
  "feature_map": {
    "TW-WADEV-002": ["POST admin/settings/providers"],
    "TW-WADEV-003": [
      "POST admin/settings/channel-setting/node",
      "POST admin/settings/channel-setting/node/test"
    ],
    "TW-WADEV-005": ["GET devices"],
    "TW-WADEV-006": ["POST devices"],
    "TW-WADEV-007": ["GET devices/{id}/qr-code"],
    "TW-WADEV-008": ["GET devices/{id}/pairing-code"],
    "TW-WADEV-009": ["GET devices/{id}/connection-status", "POST devices/{id}/connection"],
    "TW-WADEV-010": ["PUT devices/{id}"],
    "TW-WADEV-011": ["POST devices/{id}/toggle"],
    "TW-WADEV-012": ["POST devices/{id}/kill-session"],
    "TW-WADEV-013": ["DELETE devices/{id}"],
    "TW-WADEV-014": ["POST devices/check"],
    "TW-WADEV-016": ["POST devices/{id}/proxy"],
    "TW-WADEV-017": ["POST devices/{id}/proxy/test"],
    "TW-WADEV-018": ["GET api/devices/proxy-config/{phone}", "POST api/devices/proxy-result"],
    "TW-WADEV-019": ["POST api/update-status"],
    "TW-WADEV-020": ["POST api/node-heartbeat"],
    "TW-WADEV-025": ["POST connect/wa-store/twilio"],
    "TW-WADEV-026": ["DELETE devices/twilio/{id}/remove"],
    "TW-WADEV-027": [
      "POST connect/wa-store/baileys",
      "GET api/baileys/qr/{configId}",
      "GET api/baileys/status/{configId}",
      "POST connect/wa-store/disconnect"
    ],
    "TW-WADEV-028": ["GET connect"],
    "TW-WADEV-035": ["GET devices/{id}"],
    "TW-WADEV-037": ["GET admin/devices"],
    "TW-WADEV-038": ["GET admin/devices/{id}"],
    "TW-WADEV-039": ["POST admin/devices/{id}/disconnect"],
    "TW-WADEV-040": ["POST admin/devices/{id}/resync", "POST admin/devices/bulk-resync"],
    "TW-WADEV-041": ["GET admin/devices/export"],
    "TW-WADEV-042": ["DELETE admin/devices/{id}"]
  }
}
```
