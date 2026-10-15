---
domain: calling-voice
code: CALL
title: Calling and Voice (WhatsApp calling, call logs, recordings, AI call assistant)
threadwise_version: '1.7.0'
sources_read: 74
---

# Calling and Voice (WhatsApp calling, call logs, recordings, AI call assistant)

## Overview

This domain covers everything voice in Reference. There are four cooperating layers.

1. **WhatsApp Business Calling over the Cloud API (WABA only).** A workspace admin/manager turns calling on per WABA phone number. Operators then place and answer real WhatsApp voice calls straight from the browser (WebRTC, Opus audio, plain-HTTPS signalling, no websocket). Meta delivers call events (`connect`, `terminate`, `permission_update`) to a dedicated webhook `webhooks/wa-calling` (and, because Meta only allows one callback URL per app, the main WABA webhook forwards its `calls` field into the same handler). A per-contact "call permission" ledger decides whether an outbound call may be placed or a permission-request message must be sent first.
2. **AI Call Assistants (voice agents).** A workspace admin builds assistants with a 5-step wizard (profile, brain, actions, speech, routing/recording). When an inbound WABA call rings and an assistant is resolved for that call, Laravel hands the SDP offer to the Node bridge (`node/services/wabaCallBridge.js`), which answers the call over a server-side WebRTC peer, runs a listen (Deepgram or OpenAI realtime STT) -> think (LLM via Laravel `api/flow-node/ai-call`) -> speak (ElevenLabs or OpenAI TTS) loop, records both sides to disk and streams transcript turns back to Laravel. A workspace may alternatively publish a **Call Flow** (a flow of `flow_type = call`, an IVR-style graph walked by `node/services/callFlowRuntime.js`) which replaces the single-assistant loop. A flow "AI voice call" node can also place an outbound AI call.
3. **Call Logs.** Every call (operator-handled or AI-handled, inbound or outbound) is mirrored from `wa_calls` (source of truth, one row per call) into `ai_call_logs` (flattened, UI-facing) and browsed at `/call-logs` with filters, KPI cards, detail page with transcript, tool-call timeline and three audio players (agent, caller, mixed). Recordings are lazily converted from raw 48 kHz PCM to 16 kHz WAV/MP3 on first playback and served only through a workspace-scoped controller.
4. **Voice-note AI replies and voicemail fallback (Services/Voice + AiFallback).** Independent of live calls: an inbound WhatsApp voice note on a conversation whose assigned AI Agent has `voice_note_enabled` is transcribed (Whisper), answered by the text LLM, synthesised (OpenAI/ElevenLabs TTS as OGG/Opus) and sent back as a push-to-talk voice note. The same TTS/dispatcher stack sends the "sorry we missed your call" voicemail when nobody picks up an inbound call.

**Who uses it.** Super-admin sets the platform secrets (WABA app secret, webhook verify token, Node URL/token, Deepgram/OpenAI/ElevenLabs keys in Admin -> AI Keys, plan flags `access_waba_calling`, `access_ai_voice_agent`, `access_call_recording`). Workspace owner/admin manages assistants and reads call logs (role `admin`). Manager+ operators place/answer calls (role `manager`) inside Team Inbox. End-customers grant calling permission inside WhatsApp and talk to the operator or the AI.

**Plan tiers.** Two plan feature keys gate the surface: `access_waba_calling` (calling routes and call-logs pages) and `access_ai_voice_agent` (assistant CRUD). `access_call_recording` and the monthly minute caps `waba_calling_minutes_monthly` / `ai_voice_minutes_monthly` exist as plan columns but are **not enforced anywhere in code** (recording is always available; see QUIRKs). Voice-note replies check a feature key `ai_voice_reply` that is not a plan column, so it is effectively always on.

**Cross-domain.** WhatsApp connection, `wa_provider_configs`, Meta credentials and the main webhook live in WABA (`whatsapp-cloud-api-waba`); Node runtime plumbing and the shared secret in NODE (`node-bridge-runtime`); the Team Inbox screens that host the Call button, incoming-call toast and on-call panel in TIB1 (`team-inbox-conversations`); flow builder UI for `cf_*` nodes in FLB (`flow-builder-editor`), flow execution in FLR (`flow-runtime-engine`); AI keys and admin AI dashboards in AIADM (`ai-keys-usage-admin`); AI Agents (the chat/voice-note agent entity) in AIAG (`ai-agents-training`); plan mechanics in PLAN; role hierarchy in RBAC; billing of messages in WALLET. Details in "Cross-domain contracts".

## Feature index

<!--INDEX-->

## Features

### TW-CALL-001 — Calling webhook verification handshake

- **Status:** implemented
- **Priority:** P0 (product unusable without)
- **Effort:** S (<=2 dev-days)
- **Depends on:** TW-WABA (webhook subscription), TW-SET (admin verify-token setting)
- **Summary:** Meta's one-time GET handshake to prove ownership of the calling callback URL. Returns Meta's challenge string when the supplied verify token equals the admin-configured token.
- **Actors & access:** Unauthenticated machine caller (Meta). No plan gate, no role. Exempt from CSRF (listed in the CSRF exclusions in `bootstrap/app.php`) and from maintenance-mode blocking (`webhooks/*`).
- **UX & screens:** None. Admin configures the callback URL `https://<domain>/webhooks/wa-calling` in the Meta app, subscribes the WABA to the `calls` field, and enters the verify token in Admin -> Settings -> WhatsApp Message ("Webhook verify token").
- **Endpoints:**

| Endpoint                | Route name                | Controller@action                 | Middleware    | Request fields                                                                                                     | Response                                                                  |
| ----------------------- | ------------------------- | --------------------------------- | ------------- | ------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------- |
| GET webhooks/wa-calling | wa-calling.webhook.verify | WaCallingWebhookController@verify | none (public) | query `hub_mode`, `hub_verify_token`, `hub_challenge` (PHP rewrites Meta's `hub.mode` dotted names to underscores) | 200 with the challenge as plain body, else 403 body "verification failed" |

- **Data:** Reads system setting `waba_webhook_verify_token` only.
- **Rules & edge cases:**
  1. Success requires `hub_mode == "subscribe"`, token strictly equal, and the stored token non-empty. An empty stored token can never verify (no env fallback by design, so a partial setup cannot pass).
  2. The same token also verifies the messages webhook and override subscriptions (see TW-WABA); changing it in admin breaks re-verification of future subscriptions only.
  3. The challenge is echoed verbatim as the response body (Meta expects the raw string).
- **Async & events:** None.
- **External systems:** Meta webhook subscription (Graph). Credentials: admin setting only.
- **Settings:** `waba_webhook_verify_token` (system setting, no default).
- **Acceptance criteria:**
  - Given the admin saved token T, when Meta GETs the URL with mode=subscribe and token=T, then the response is 200 and the body equals the challenge.
  - Given the token differs or the stored token is blank, when the handshake runs, then the response is 403 "verification failed".
  - Given a browser (no auth) calls the URL, then no login redirect happens (the route is public).
- **Source refs:** `app/Http/Controllers/WaCallingWebhookController.php` (verify), `routes/web.php`, `bootstrap/app.php`, `Documentation/pages/ai/wa-calling.html`.
- **Port notes:** Implement as a public NestJS controller outside the auth guard, no CSRF. The WABA module probably already stores the verify token; reuse it. Keep the empty-token rejection. Exempt the path from tenant RLS context (there is no tenant yet).

### TW-CALL-002 — Calling webhook receiver, signature check and event routing

- **Status:** implemented
- **Priority:** P0 (product unusable without)
- **Effort:** M (<=1 week)
- **Depends on:** TW-CALL-001, TW-WABA (main webhook forward), TW-CALL-011, TW-CALL-017, TW-CALL-006
- **Summary:** Receives Meta's `calls` webhook, verifies the HMAC signature, resolves the workspace by the phone-number id, and dispatches each call event (`connect`, `terminate`, `permission_update`) to its handler. The main WABA message webhook forwards its own `calls` change entries into the same code path.
- **Actors & access:** Meta (machine). No session. Security = `X-Hub-Signature-256` HMAC over the raw body using the platform WABA app secret.
- **UX & screens:** None.
- **Endpoints:**

| Endpoint                 | Route name                 | Controller@action                  | Middleware        | Request fields                                                                                                                                                                                                                                                                                               | Response                                                                                                                                                        |
| ------------------------ | -------------------------- | ---------------------------------- | ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| POST webhooks/wa-calling | wa-calling.webhook.receive | WaCallingWebhookController@receive | none, CSRF-exempt | Meta envelope `entry[].id`(WABA id), `entry[].changes[].field=="calls"`, `value.metadata.phone_number_id`, `value.calls[]` with `id, from, to, timestamp, event, direction, session{sdp_type,sdp}, biz_opaque_callback_data, status, start_time, end_time, duration, errors, response, expiration_timestamp` | `{ok:true}` (also `{ok:true,noop:"empty entry"}` when `entry` empty); 500 `{error:"server misconfigured"}` when app secret unset; 401 `{error:"bad signature"}` |

- **Data:** Reads `wa_provider_configs` (provider `waba`) to map `phone_number_id` to a workspace config; writes via the handlers.
- **Rules & edge cases:**
  1. Order: empty payload short-circuits with a noop 200 BEFORE the signature check. Then the app secret (system setting `waba_app_secret`) is required: if blank the endpoint refuses with 500 and logs an error (no dev bypass). Signature is `sha256=` + HMAC-SHA256(raw body, secret), compared with constant-time equality. Mismatch = 401.
  2. Only changes with `field == "calls"` are processed; others are ignored. Every call inside `value.calls[]` is handled independently and each handler is wrapped in try/catch (an exception in one event is logged and swallowed; Meta still gets 200 so it will not retry-storm).
  3. Config lookup: load all `waba` provider configs and match `phone_number_id` from the decrypted credentials or from `meta_json.phone_number_id` (encrypted column cannot be queried). If no config matches the event is dropped with a warning log. If `phone_number_id` is missing the whole value is dropped.
  4. Unknown `event` values are logged and ignored. Handled events: `connect`, `terminate`, `permission_update`.
  5. The handler responds fast; the AI voicemail timer (TW-CALL-032) is registered on the framework's post-response hook so Meta sees a sub-second 200 (Meta retries if a response exceeds ~5 s).
  6. **Forward from the main WABA webhook:** because Meta allows only one callback per app, `WaWebhookController` (messages webhook) detects `field == "calls"` and calls `ingestCallsValue(value, wabaId)` on this controller; signature was already verified upstream so no second check. Without this forward permission updates were dropped and every Call click re-sent a permission request and hit Meta error 138009 (limit).
  7. Trace logging of every calls webhook (events summary) is done at info level.
- **Async & events:** Post-response timer for voicemail fallback; Node bridge HTTP calls; `wa_call_events` rows; inbox message mirror on terminate.
- **External systems:** Meta Cloud API webhooks. Secret: system setting `waba_app_secret` (Admin -> Settings -> WhatsApp Message).
- **Settings:** `waba_app_secret` (required), `waba_webhook_verify_token`.
- **Acceptance criteria:**
  - Given a valid signed `connect` payload for a known phone_number_id, when POSTed, then a `wa_calls` row exists and the response is `{ok:true}`.
  - Given a wrong signature, when POSTed, then 401 and no rows are written.
  - Given `waba_app_secret` is empty, when POSTed with a non-empty entry, then 500 "server misconfigured".
  - Given the main WABA webhook receives a `calls` change, when processed, then the same handlers run and a `permission_update` records a `wa_call_permissions` row.
  - Given one call event throws inside a handler, when a batch of events arrives, then remaining events still process and the response is 200.
- **Source refs:** `app/Http/Controllers/WaCallingWebhookController.php` (receive, ingestCallsValue, routeValue, configByPhoneId), `app/Http/Controllers/WaWebhookController.php` (calls forward), `routes/web.php`.
- **Port notes:** Put in the WABA/webhook ingestion module as a provider adapter: raw-body HMAC guard, then enqueue per-event work (BullMQ job keyed by `call.id`+event) instead of doing HTTP calls inline. Preserve the 5 s ack budget. Phone-number-id to tenant lookup should use an indexed column in the new schema (Reference had to scan and decrypt).

### TW-CALL-003 — Per-number calling status list

- **Status:** implemented
- **Priority:** P0 (product unusable without)
- **Effort:** S (<=2 dev-days)
- **Depends on:** TW-WABA connect flow
- **Summary:** Returns the workspace's WABA numbers with their connection status and whether calling is enabled, used by the Team Inbox dialer to pick the calling-enabled number.
- **Actors & access:** Authenticated workspace member with role `manager` or above; plan feature `access_waba_calling`. A missing feature gives JSON 403 `plan_feature_disabled` for non-safe methods; for this GET the request proceeds but the paywall flag is shared to views (soft gate on safe methods).
- **UX & screens:** No dedicated screen; consumed by the Team Inbox Call button (TW-CALL-007). The docs also describe a "WhatsApp Calling settings list" but the only UI is the toggle card on the WABA health page (TW-CALL-004).
- **Endpoints:**

| Endpoint              | Route name             | Controller@action          | Middleware                                                                        | Request fields | Response                                                                                                                           |
| --------------------- | ---------------------- | -------------------------- | --------------------------------------------------------------------------------- | -------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| GET wa-calling/status | user.wa-calling.status | WaCallingController@status | Authenticate, EnsureWorkspaceRole:manager, EnforcePlanFeature:access_waba_calling | none           | `{ok:true, rows:[{id, phone_number, display_label, connection_status, calling_enabled(bool), calling_enabled_at(ISO8601\|null)}]}` |

- **Data:** Reads `wa_provider_configs` where `workspace_id` = current workspace and `provider = 'waba'`; columns `id, phone_number, display_label, status, calling_enabled, calling_enabled_at`. No ordering specified (insertion order).
- **Rules & edge cases:**
  1. Workspace comes from the user's `current_workspace_id`; there is no cross-workspace access.
  2. The Team Inbox dialer picks the FIRST row with `calling_enabled == true` (no multi-number chooser; comment says a chooser is planned).
  3. Non-WABA configs are never returned.
- **Async & events:** None.
- **External systems:** None (local read).
- **Settings:** None.
- **Acceptance criteria:**
  - Given a workspace with two WABA numbers, one calling-enabled, when GET status, then both rows return with correct flags.
  - Given a workspace with only Baileys devices, when GET status, then `rows` is empty.
  - Given the plan lacks `access_waba_calling`, when a POST-style call is made, then 403 JSON; for this GET the page still returns data but the paywall flag is set.
- **Source refs:** `app/Http/Controllers/WaCallingController.php` (status), `routes/web.php`, `config/plan_gates.php`.
- **Port notes:** Trivial read endpoint. In the new stack fold into the WABA numbers API with a `calling` sub-object; keep first-enabled-number selection or add the chooser.

### TW-CALL-004 — Enable or disable calling on a WABA number

- **Status:** implemented
- **Priority:** P0 (product unusable without)
- **Effort:** M (<=1 week)
- **Depends on:** TW-WABA (connected number with token and phone_number_id), TW-CALL-003
- **Summary:** Flips Meta's per-phone-number calling setting and mirrors it locally, with friendly translations of Meta's common refusal reasons (coexistence numbers, messaging-limit prerequisite).
- **Actors & access:** Role `manager`+ (route group is manager; the doc says "Manager or Admin"); plan `access_waba_calling`. Only rows with `provider = 'waba'` in the caller's workspace (else 404 for foreign ids, 422 "Calling is only available on WABA numbers.").
- **UX & screens:** `resources/views/user/devices/waba-health.blade.php`, section "WHATSAPP CALLING": a card with phone icon, title "WhatsApp calling", status line ("Enabled - the green Call button now shows on this number's chats in the inbox." or "Off - ..."), and a single button "Enable calling" / "Turn off calling" (button disables and dims while the request runs). On success the page reloads; on failure a browser `alert()` shows the server `error`, or "Your plan does not include WhatsApp calling." on HTTP 403, or "Could not change calling (status N)." / "Network error - please try again.". States: enabled, disabled, request in flight.
- **Endpoints:**

| Endpoint                    | Route name             | Controller@action          | Middleware                                                                                        | Request fields            | Response                                                                                     |
| --------------------------- | ---------------------- | -------------------------- | ------------------------------------------------------------------------------------------------- | ------------------------- | -------------------------------------------------------------------------------------------- |
| POST wa-calling/{id}/toggle | user.wa-calling.toggle | WaCallingController@toggle | Authenticate, EnsureWorkspaceRole:manager, EnforcePlanFeature:access_waba_calling; `{id}` numeric | `enable` required boolean | `{ok:true, calling_enabled, calling_enabled_at, meta:<Meta body>}` or 422 `{ok:false,error}` |

- **Data:** Writes `wa_provider_configs.calling_enabled` (bool), `calling_enabled_at` (timestamp, set on enable, null on disable), `calling_enabled_meta` (JSON: Meta's raw response). `{id}` = `wa_provider_configs.id`.
- **Rules & edge cases:**
  1. Meta call: `POST graph.facebook.com/<version>/<phone_number_id>/settings` body `{calling:{status: ENABLED|DISABLED}}` with the number's access token (Bearer), 15 s timeout. Graph version from system setting `waba_graph_api_version`, default `v23.0` (comment in class doc says v21.0 - stale).
  2. `phone_number_id` and `access_token` are read from the decrypted credentials, falling back to `meta_json` keys; if either is missing: error "Missing phone_number_id / access_token on this WABA config."
  3. Enabling on a **Coexistence** number (config `meta_json.coexistence` true or `platform_type` in COEXISTENCE/SMB_APP) is refused BEFORE calling Meta with an explanation that calling needs numbers fully onboarded to Cloud API. Disable is allowed.
  4. Meta error code 141000 ("not a valid Cloud API number") is translated to the same coexistence explanation.
  5. Meta message containing "pre-requisite"/"prerequisite" is translated to a long guidance message: number needs a daily messaging limit of at least 2,000 unique recipients, the app must be subscribed to the WABA and to the `calls` webhook field with `whatsapp_business_messaging` permission; test/sandbox numbers waive the limit.
  6. Any other non-2xx: `Meta refused the call toggle (<http>): <message>`.
  7. Local flags only change after Meta accepts. All failures return HTTP 422 with `error` (validation failures use Laravel's standard 422 shape).
  8. Other errors thrown are caught generically and returned as 422 with the message (no 500s).
- **Async & events:** None. No audit-log entry is written.
- **External systems:** Meta Graph `/{phone_number_id}/settings` (calling). Credentials: workspace WABA config (encrypted access token). Rate limits: Meta's.
- **Settings:** `waba_graph_api_version` (system setting, default v23.0).
- **Acceptance criteria:**
  - Given a connected non-coexistence WABA number meeting Meta prerequisites, when toggled with enable=true, then Meta receives status ENABLED, `calling_enabled` becomes true with a timestamp and the inbox shows the Call button.
  - Given a coexistence number, when enable is requested, then no Meta request is made and the response is 422 with the coexistence explanation.
  - Given Meta answers a "pre-requisite" error, when enabling, then the 422 message mentions the 2,000/day messaging tier.
  - Given `enable=false`, when Meta accepts, then `calling_enabled` false and `calling_enabled_at` null.
  - Given a config id from another workspace, when toggling, then 404.
- **Source refs:** `app/Http/Controllers/WaCallingController.php` (toggle, cfg), `app/Services/WaCalling/WaCallingService.php` (enable, disable, toggleSettings, isCoexistence, resolveCreds), `resources/views/user/devices/waba-health.blade.php`, migration `2026_05_23_040000_add_calling_enabled_to_wa_provider_configs.php`.
- **Port notes:** Put on the WABA number settings module; `calling_enabled*` columns belong on the number/channel table (owned by WABA). Reuse the Meta Graph adapter and encrypted credential store. The card lives on the WABA health page in TW-WABA; the route stays here.

### TW-CALL-005 — Send a call-permission request to a customer

- **Status:** implemented
- **Priority:** P0 (product unusable without)
- **Effort:** S (<=2 dev-days)
- **Depends on:** TW-CALL-004, TW-CALL-006
- **Summary:** Sends the customer an interactive WhatsApp "call permission request" message ("Can we give you a quick call?") through the Cloud API so they can tap Allow or Don't allow. WhatsApp forbids cold-calling, so this must precede any outbound call.
- **Actors & access:** Role `manager`+, plan `access_waba_calling`. WABA number owned by the caller's workspace.
- **UX & screens:** Triggered from the Team Inbox Call button (TW-CALL-007), either by the operator choosing "Cancel" in the confirm dialog, or automatically by the server when a dial is attempted without a usable permission (TW-CALL-008). No standalone screen.
- **Endpoints:**

| Endpoint                           | Route name                         | Controller@action                     | Middleware                                                                        | Request fields                                                                            | Response                                                                                                      |
| ---------------------------------- | ---------------------------------- | ------------------------------------- | --------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| POST wa-calling/permission-request | user.wa-calling.permission-request | WaCallingController@requestPermission | Authenticate, EnsureWorkspaceRole:manager, EnforcePlanFeature:access_waba_calling | `config_id` required integer; `to` required string max 32; `body` nullable string max 160 | `{ok:true, meta:<Graph body>}` or `{ok:true, meta:{already_permitted:true}}`; failures `{ok:false,error}` 422 |

- **Data:** Reads `wa_provider_configs`. Writes `wa_call_permissions` (upsert by `(wa_provider_config_id, contact_phone)`, contact_phone = digits only): after a successful send, status set to `expired` (resets the cache so the UI re-checks after the customer replies); on the "already permitted" case status `granted`, `granted_at` now, `expires_at` null (dial freely).
- **Rules & edge cases:**
  1. Payload to Graph `/<phone_number_id>/messages`: `messaging_product: whatsapp`, `type: interactive`, `interactive.type = call_permission_request`, `interactive.action.name = call_permission_request` (Meta 400s with "missing action" without it), `interactive.body.text = body` (default "Can we give you a quick call?"). Recipient digits only.
  2. Meta error code **138017** ("business can already call this consumer") is NOT a failure: record local permission as granted with no expiry and return `already_permitted: true`; the UI then proceeds to place the call.
  3. Other failures: `Meta refused permission_request (<http>): <message>` (e.g. Meta limit 138009: too many requests to the same user).
  4. The endpoint does not check that calling is enabled on the number nor rate-limit locally.
- **Async & events:** The customer's Allow/Decline arrives later as a `permission_update` webhook (TW-CALL-006). No audit log; no `wa_call_events` row.
- **External systems:** Meta Graph `/{phone_number_id}/messages`. Credentials: workspace WABA config. Version: `waba_graph_api_version`.
- **Settings:** `waba_graph_api_version` (default v23.0).
- **Acceptance criteria:**
  - Given a contact with no permission, when the operator requests permission, then the customer receives the interactive request and the ledger row is `expired`.
  - Given Meta returns 138017, when requesting, then the API returns `ok:true, meta.already_permitted:true` and the ledger row is `granted` with null expiry.
  - Given `body` longer than 160 chars, when posting, then 422 validation error.
  - Given a config id of another workspace, then 404.
- **Source refs:** `app/Http/Controllers/WaCallingController.php` (requestPermission), `app/Services/WaCalling/WaCallingService.php` (requestPermission), `app/Models/WaCallPermission.php`.
- **Port notes:** Provider adapter method on the WABA Graph client. Store the ledger keyed (channel_id, e164). Consider a local cooldown to avoid Meta's 138009 spam limit (Reference relies on the forward of permission_update to avoid re-sending).

### TW-CALL-006 — Call-permission ledger and inbox call eligibility

- **Status:** implemented
- **Priority:** P0 (product unusable without)
- **Effort:** M (<=1 week)
- **Depends on:** TW-CALL-002, TW-CALL-005
- **Summary:** Records the customer's Accept/Decline of a call-permission request from Meta's `permission_update` event and exposes per-conversation calling eligibility flags (`wa_calling_enabled`, `wa_calling_permission`) that the Team Inbox uses to show and behave the Call button.
- **Actors & access:** Webhook (machine) writes; Team Inbox serializers read for any inbox user.
- **UX & screens:** No own screen. Inbox conversation payload flags: `wa_calling_enabled` (bool), `wa_calling_permission` ('granted' | 'expired' | 'declined' | null), `contact_phone` (raw digits for the dialer only; UI text uses a masked copy).
- **Endpoints:** Webhook entry is TW-CALL-002; flags are part of Team Inbox payloads (TeamInboxController serializers, owned by TIB1). No dedicated route.
- **Data:** `wa_call_permissions`: `workspace_id`, `wa_provider_config_id` (nullable FK, set null on config delete), `contact_phone` (digits, varchar 32), `status` enum granted/declined/expired (default granted), `granted_at`, `expires_at`; unique `(wa_provider_config_id, contact_phone)`; index `(workspace_id, status)`.
- **Rules & edge cases:**
  1. `permission_update` handling: requires non-empty `from` and `response`. `response == "accept"` => status `granted`; anything else => `declined`. `expires_at` = Meta's `expiration_timestamp` when present else now + 7 days (granted only); declined rows have null granted_at/expires_at. Upsert on `(config, digits(from))`.
  2. `isUsable()` = status granted AND (expires_at is null OR in the future). A granted row past expiry reads as unusable; the inbox flag becomes the stored status text ('granted' shows only if usable; an expired-in-time granted row shows as 'granted' status text? No: flag = 'granted' if usable else the raw status column, so a lapsed granted row surfaces as the string 'granted' - QUIRK, see below).
  3. No `wa_calls` row exists for permission events, so nothing is written to `wa_call_events`; only a log line.
  4. `wa_calling_enabled` is true only when ALL hold: conversation has a phone-shaped `raw_jid` (either `digits@...` Baileys form or 6-15 bare digits WABA form; campaign template rows with null raw_jid excluded), the workspace has any WABA config with `calling_enabled` (cached per request per workspace; uses the workspace's first WABA config only), and either the conversation's provider is `waba` or the workspace has no Baileys device at all (backfill workaround for conversations wrongly stamped `baileys`).
  5. `contact_phone` derives from `raw_jid` digits, else from the first 6-15 digit run in the (encrypted) conversation title.
  6. The permission lookup uses the workspace's FIRST WABA config (not the calling-enabled one); with several WABA numbers permission may be read from the wrong number. QUIRK.
  7. QUIRK: `wa_calling_permission` returns `'granted'` when usable, otherwise the raw `status` column. A row whose status is `granted` but whose `expires_at` is in the past therefore reports `'granted'` to the client even though the server considers it unusable. The client treats `'granted'` as "no confirm needed", and the server's dial then re-checks and auto-requests permission.
- **Async & events:** Webhook-driven upserts only.
- **External systems:** Meta `calls` webhook (`permission_update`).
- **Settings:** None. Default grant window 7 days when Meta omits expiry.
- **Acceptance criteria:**
  - Given an `accept` permission_update with an expiration timestamp, when processed, then the ledger row is granted with that expiry and the inbox flag for that contact is 'granted'.
  - Given a `decline`, then status declined, granted_at/expires_at null.
  - Given the same contact updates twice, then only one ledger row exists (upsert).
  - Given a Baileys-only workspace, then `wa_calling_enabled` is false for every conversation.
- **Source refs:** `app/Services/WaCalling/WaCallingService.php` (recordPermissionUpdate), `app/Http/Controllers/WaCallingWebhookController.php` (handlePermissionUpdate), `app/Models/WaCallPermission.php`, `app/Http/Controllers/TeamInboxController.php` (serializeListItem, serializeFull, workspaceCallingEnabled, workspaceHasBaileys), migration `2026_05_23_050000_create_wa_calls_tables.php`.
- **Port notes:** New table `call_permissions` under RLS by tenant; key on (channel_id, phone_e164). Fix the "first WABA config" and expired-granted flag quirks (compute `usable` server-side). Expose eligibility from the conversations API instead of recomputing per row.

### TW-CALL-007 — Team Inbox Call button and outbound dial UX

- **Status:** implemented
- **Priority:** P0 (product unusable without)
- **Effort:** M (<=1 week)
- **Depends on:** TW-CALL-003, TW-CALL-005, TW-CALL-006, TW-CALL-008, TW-CALL-009, TW-CALL-018
- **Summary:** The green "Call" button in the conversation header lets an operator start a WhatsApp call to the customer, guiding them through the permission step.
- **Actors & access:** Manager+ operators viewing a conversation in Team Inbox on a calling-enabled WABA number with plan `access_waba_calling`.
- **UX & screens:** `resources/views/user/team-inbox/index.blade.php` (button `#wa-call-btn`, hidden by default, label "Call", tooltip "Start a WhatsApp call") and `resources/js/charts/user-team-inbox-index.js`. Visible only when `c.wa_calling_enabled && c.contact_phone`. Click flow: (1) if not enabled -> toast "Calling is not enabled on this conversation."; (2) digits of contact phone, else toast "No phone number on this contact."; (3) fetch `GET /wa-calling/status` and pick the first `calling_enabled` row, else toast "Calling is not enabled on any WABA number."; (4) if `wa_calling_permission != 'granted'`: a native `confirm()` with two choices - OK = call now anyway, Cancel = send a permission request; on Cancel POST permission-request: `already_permitted` -> success toast "This contact already allows calls - starting the call..." and continue to dial; success -> toast "Permission request sent. They will see Accept/Decline in WhatsApp - try Call again after they respond." and stop; failure -> error toast "Could not send permission request: <error>"; (5) dynamic-import the bridge and `startOutboundCall({configId, to, contactId, conversationId, displayName})`; errors: message containing "permission" -> toast "No active calling permission. Click Call again to send a permission request."; else "Could not start call: <msg>".
- **Endpoints:** Uses TW-CALL-003, TW-CALL-005, TW-CALL-008 endpoints. No new route.
- **Data:** Reads conversation payload flags; nothing written directly.
- **Rules & edge cases:**
  1. Only one call at a time per browser tab: `startOutboundCall` throws "Another call is already active in this tab." if a peer or active call id exists. The busy slot is claimed (`activeCallId = -1`) before dialling so the inbound poll cannot pop a toast over the dial.
  2. QUIRK: the confirm's "call now anyway" option is ineffective when the local ledger is stale, because the server dial endpoint always does its own permission-first check and auto-sends a permission request instead (TW-CALL-008).
  3. The button is shown even to roles that will get HTTP 403 (route needs manager); agents/viewers get redirected/blocked by the status fetch. QUIRK.
- **Async & events:** Browser timers only.
- **External systems:** Browser mic and WebRTC.
- **Settings:** None.
- **Acceptance criteria:**
  - Given a WABA conversation with granted permission, when the operator clicks Call, then no confirm is shown and the dial starts.
  - Given no granted permission and the operator cancels the confirm, then a permission request is sent and no call is placed.
  - Given a conversation on a Baileys number, then the button is hidden.
  - Given a second click during an active call, then an error toast "Another call is already active in this tab." appears.
- **Source refs:** `resources/js/charts/user-team-inbox-index.js` (wa-call-btn handler, openConversation visibility), `resources/views/user/team-inbox/index.blade.php`, `resources/js/calling/incoming-call-bridge.js` (startOutboundCall).
- **Port notes:** Belongs to `apps/web` Team Inbox (TIB1 owns the screen); implement the dial as a hook using the CALL API. Replace the native confirm with a modal. Keep single-active-call guard and busy-slot semantics.

### TW-CALL-008 — Place an outbound call (dial)

- **Status:** implemented
- **Priority:** P0 (product unusable without)
- **Effort:** M (<=1 week)
- **Depends on:** TW-CALL-004, TW-CALL-005, TW-CALL-006, TW-CALL-009
- **Summary:** Receives the browser's SDP offer, enforces permission-first, creates the call row, asks Meta to connect the call and returns the local call id used for all later actions.
- **Actors & access:** Role `manager`+, plan `access_waba_calling`.
- **UX & screens:** Called by the WebRTC peer; see TW-CALL-007/009/018.
- **Endpoints:**

| Endpoint                   | Route name           | Controller@action        | Middleware                                                                        | Request fields                                                                                                                                       | Response                                                                                                                                                                                                                       |
| -------------------------- | -------------------- | ------------------------ | --------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| POST wa-calling/calls/dial | user.wa-calling.dial | WaCallingController@dial | Authenticate, EnsureWorkspaceRole:manager, EnforcePlanFeature:access_waba_calling | `config_id` required int; `to` required string max 32; `sdp_offer` required string min 50; `contact_id` nullable int; `conversation_id` nullable int | 200 `{ok:true, call_id, meta_call_id, correlation}`; 422 `{ok:false, permission_requested:true, error:"No calling permission yet - we've sent them a request. You can call once they tap \"Allow\"."}`; 422 `{ok:false,error}` |

- **Data:** Writes `wa_calls` (direction `BUSINESS_INITIATED`, `status=ringing`, `from_phone` = digits of the config's phone_number, `to_phone` digits, `correlation_id` UUID, `started_at` now, optional `contact_id`/`conversation_id` (not validated for tenant ownership), `provider` auto-stamped from the workspace engine, then `meta_call_id` and `meta_payload` = Meta response) and a `wa_call_events` row `dial_sent`.
- **Rules & edge cases:**
  1. **Permission-first:** find the newest `wa_call_permissions` row for the config where `contact_phone` equals the raw `to`, its digits, or "+"+digits. If none or not `isUsable()`, do NOT place the call: send a permission request (TW-CALL-005) and return 422 with `permission_requested: true` (422 chosen deliberately so the JS `api()` helper throws before opening the ringing popup or reading a null call id). If the permission send itself fails: 422 "Could not send the permission request: <msg>".
  2. When permission is usable the dial goes to Meta `POST /<phone_number_id>/calls` with `action: connect`, `to` (digits), `session {sdp_type: offer, sdp}`, `biz_opaque_callback_data` = correlation id (Meta echoes it in the connect webhook so the row can be matched).
  3. If Meta's error message contains "permission" (e.g. 401 "No approved call permission from the recipient") the controller auto-sends a permission request and returns the same 422 `permission_requested` payload.
  4. The service-level permission assert is a SOFT check (logs only) because the local cache may be stale; in practice it is unreachable behind rule 1.
  5. The endpoint does NOT verify `calling_enabled` on the config (only `provider = waba` and workspace ownership; else 404/422 "Calling is only available on WABA numbers.").
  6. QUIRK: when the Meta connect fails after the row is created (non-permission error), the `wa_calls` row stays `ringing` with no `meta_call_id` forever; it never mirrors to call logs because mirroring happens on the connect webhook.
  7. Meta media constraint: the SDP offer must advertise only Opus (+telephone-event); the browser peer enforces this (TW-CALL-009).
  8. Meta call timeout: the customer's phone rings up to about 60 s (the JS wait window).
- **Async & events:** Customer pickup arrives via `connect` webhook (TW-CALL-011); Meta ends via `terminate` (TW-CALL-017). Event `dial_sent`.
- **External systems:** Meta Graph `/{phone_number_id}/calls`. 15 s HTTP timeout.
- **Settings:** `waba_graph_api_version`.
- **Acceptance criteria:**
  - Given usable permission and a valid offer, when dialled, then a `wa_calls` row (ringing, BUSINESS_INITIATED) is created with Meta's call id and the response contains `call_id`.
  - Given no usable permission, when dialled, then no `wa_calls` row is created, a permission message is sent and the response is 422 with `permission_requested`.
  - Given an `sdp_offer` shorter than 50 chars, then 422 validation error.
  - Given a config of another workspace, then 404.
- **Source refs:** `app/Http/Controllers/WaCallingController.php` (dial), `app/Services/WaCalling/WaCallingService.php` (dialOutbound, postCallsAction, assertPermission), `app/Models/WaCall.php`.
- **Port notes:** Create the call row inside the same transaction as the Meta call or use an outbox job; add `calling_enabled` verification; clean up orphan `ringing` rows with a sweeper (Reference has none). Enforce tenant ownership of `contact_id`/`conversation_id` via RLS.

### TW-CALL-009 — Browser WebRTC call peer

- **Status:** implemented
- **Priority:** P0 (product unusable without)
- **Effort:** L (<=2 weeks)
- **Depends on:** TW-CALL-008, TW-CALL-010, TW-CALL-013
- **Summary:** A client class that owns the operator's RTCPeerConnection: captures the microphone, generates/accepts SDP, plays the remote audio and drives the dial/answer/hangup endpoints. Signalling is plain HTTPS with non-trickle ICE.
- **Actors & access:** Operator browser (manager+).
- **UX & screens:** Headless class used by the incoming-call bridge; surfaces states `idle | connecting | ringing | active | ended` via callbacks. Mic-blocked error: "Microphone access blocked - the caller will not hear you. Grant mic permission in your browser and retry." (the call aborts rather than joining one-way).
- **Endpoints:** Uses `POST wa-calling/calls/dial`, `POST .../{id}/accept`, `GET .../{id}/answer`, `POST .../{id}/terminate`, `POST .../{id}/recording`.
- **Data:** None server-side.
- **Rules & edge cases:**
  1. ICE servers default to four public STUN servers; admins can inject a full list (TURN) at runtime via `window.WA_CALL_ICE_SERVERS` without rebuilding (no admin UI found that emits it).
  2. SDP normalisation: Meta's SDP uses bare LF; Chrome requires CRLF and a trailing CRLF, so every SDP is folded to CRLF. For the remote ANSWER on outbound calls, `a=setup:actpass` is rewritten to `a=setup:active` (an answer must commit to a DTLS role or the call shows connected with zero audio).
  3. Codec: Meta's validator rejects the browser's default multi-codec offer ("SDP Validation error"); the peer restricts the audio transceiver to Opus and telephone-event via codec preferences (best effort).
  4. Mic must be attached BEFORE creating the answer so the answer has a send m-line (otherwise recvonly and the caller hears silence).
  5. Non-trickle ICE: waits for gathering complete with a 3 s safety timeout, then sends the full local SDP (minimum length 50 chars enforced client and server).
  6. Answering (inbound): setRemoteDescription(offer) -> attach mic -> prefer Opus -> createAnswer -> wait ICE -> POST accept with `sdp_answer`. Dialling (outbound): mic -> Opus -> createOffer(offerToReceiveAudio) -> wait ICE -> POST dial -> state `ringing` -> poll answer endpoint (TW-CALL-010).
  7. Outbound wait window 60 s polling every 1.2 s; on timeout it terminates and throws "No answer - the customer did not pick up." When the poll reports `ended`, the error text maps the end reason: REJECTED "The customer declined the call.", BUSY "The customer is on another call.", NO_ANSWER, MISSED "The customer missed the call.", CANCELLED "The call was cancelled." else "Call ended before it connected."
  8. After the answer is applied, a 3 s poll (`_watchForRemoteEnd`) detects a remote hang-up whose ICE lingers.
  9. Remote audio is played in a hidden autoplay element with an explicit `play()` (autoplay policy failures are logged).
  10. Connection state `failed | disconnected | closed` tears the call down locally (no server terminate).
  11. Hangup posts terminate only when state is connecting/ringing/active; terminate failure never blocks teardown (Meta's terminate webhook reconciles).
- **Async & events:** Browser timers; recording upload on teardown (TW-CALL-019).
- **External systems:** STUN (Google, Twilio); optional TURN.
- **Settings:** `window.WA_CALL_ICE_SERVERS` injection hook.
- **Acceptance criteria:**
  - Given mic permission granted, when dialling, then the SDP offer contains only Opus/telephone-event and a call id is returned.
  - Given mic blocked, when starting a call, then no server request is made and the mic error shows.
  - Given Meta's LF-only SDP, when applied, then setRemoteDescription succeeds and audio flows both ways.
  - Given the customer declines, then the UI shows the declined message and the panel closes.
- **Source refs:** `resources/js/calling/webrtc-peer.js`.
- **Port notes:** Port as a typed TS class in `apps/web/src/lib/calling/`. TURN: expose configuration through tenant/platform settings rather than a window global. Keep SDP quirks (CRLF, setup role, Opus-only) - they are Meta-specific.

### TW-CALL-010 — Outbound call progress poll (SDP answer relay)

- **Status:** implemented
- **Priority:** P0 (product unusable without)
- **Effort:** S (<=2 dev-days)
- **Depends on:** TW-CALL-008, TW-CALL-011
- **Summary:** Lets the dialling browser learn when the customer picked up and obtain Meta's SDP answer (delivered by the connect webhook) so it can complete the WebRTC handshake; also reports terminal state so the panel closes on remote hang-up.
- **Actors & access:** Role `manager`+, plan `access_waba_calling`; call must belong to the caller's workspace (404 otherwise). Any manager can poll any call in the workspace.
- **UX & screens:** Poll loop in the peer (every 1.2 s while ringing, every 3 s while active).
- **Endpoints:**

| Endpoint                         | Route name             | Controller@action                | Middleware                                                                        | Request fields    | Response                                           |
| -------------------------------- | ---------------------- | -------------------------------- | --------------------------------------------------------------------------------- | ----------------- | -------------------------------------------------- |
| GET wa-calling/calls/{id}/answer | user.wa-calling.answer | WaCallingController@dialProgress | Authenticate, EnsureWorkspaceRole:manager, EnforcePlanFeature:access_waba_calling | path id (numeric) | `{ok:true, status, sdp_answer, ended, end_reason}` |

- **Data:** Reads `wa_calls.status`, `meta_payload.session.sdp/sdp_type`, `end_reason`.
- **Rules & edge cases:**
  1. `sdp_answer` is returned only when status is `active` AND stored SDP is non-empty AND its `sdp_type` is not `offer` (defensive: never hand the peer an offer while it is in have-local-offer state).
  2. `ended` = status in `ended`/`failed`; `end_reason` only included when ended.
  3. Route name is `answer` although the action is `dialProgress` (misleading; it is not the operator "answer" action).
- **Async & events:** None.
- **External systems:** None.
- **Settings:** None.
- **Acceptance criteria:**
  - Given an outbound call still ringing, then `sdp_answer` is null and `ended` false.
  - Given the connect webhook stamped active with an answer SDP, then the poll returns it.
  - Given the customer declined (row ended REJECTED), then `ended` true with `end_reason`.
- **Source refs:** `app/Http/Controllers/WaCallingController.php` (dialProgress).
- **Port notes:** Replace polling with SSE/websocket in the new stack if a realtime channel exists; keep the endpoint as fallback. Same-tenant read via RLS.

### TW-CALL-011 — Connect event: inbound ring and outbound answer

- **Status:** implemented
- **Priority:** P0 (product unusable without)
- **Effort:** L (<=2 weeks)
- **Depends on:** TW-CALL-002, TW-CALL-022, TW-CALL-023, TW-CALL-024, TW-CALL-032
- **Summary:** Handles Meta's `connect` event: for a customer-initiated call it creates a ringing call row, matches the contact/conversation, mirrors to call logs and either starts the AI bridge or arms the voicemail timer; for an operator- or AI-placed outbound call it stamps the row active and stores Meta's SDP answer.
- **Actors & access:** Webhook (machine).
- **UX & screens:** Effects appear as the incoming-call toast (TW-CALL-012) and the call in Call Logs.
- **Endpoints:** Part of TW-CALL-002 (POST webhooks/wa-calling).
- **Data:** Creates or updates `wa_calls`: `workspace_id`, `wa_provider_config_id`, `meta_call_id`, `direction`, `from_phone`/`to_phone` (digits), `contact_id`, `conversation_id`, `status` (`active` for outbound answers, else `ringing`), `started_at` (Meta timestamp in app timezone, else now), `meta_payload` (entire call payload including SDP). Creates `wa_call_events` `connect`.
- **Rules & edge cases:**
  1. Row reuse: look up an existing row by `meta_call_id` OR `correlation_id` equal to Meta's echoed `biz_opaque_callback_data` (outbound dial); otherwise create. QUIRK: the OR query has no grouping guard, so a payload without the echo compares against a literal sentinel string.
  2. Outbound detection: `session.sdp_type == answer` OR the existing row's/direction is `BUSINESS_INITIATED`. Outbound rows become `active`; inbound `ringing`. The overwrite of `meta_payload` with the connect payload keeps Meta's answer SDP for the dialer poll (TW-CALL-010).
  3. AI-outbound marker (`meta_payload.source == flow_ai_call`) is captured BEFORE the overwrite; see TW-CALL-034.
  4. Contact matching: `contacts.mobile` is encrypted at rest, so all contacts of every workspace member (`workspace_user`) are hydrated and compared in PHP on digits of `country_code + mobile` or `mobile` against the caller's digits. Cost grows with contact count; acceptable for hundreds. First match wins; may be null.
  5. Conversation matching: same workspace, `raw_jid` equal to `<digits>@s.whatsapp.net` or bare digits; first match; may be null.
  6. Always mirrors to `ai_call_logs` (best-effort, exceptions swallowed) so the call appears in Call Logs from the first ring with status `in-progress` (TW-CALL-022).
  7. Inbound with a resolved assistant and a configured Node bridge: POST `/api/waba-call/answer` to Node (TW-CALL-024). Outbound BUSINESS_INITIATED calls never trigger the AI answer or the voicemail timer (a past bug where the AI "answered" the operator's own outbound call is fixed).
  8. Inbound: the post-response voicemail timer of `workspaces.auto_pickup_delay_sec` (default 15 s, minimum 1) is registered (TW-CALL-032), skipped for outbound.
  9. A missing `id` in the payload aborts silently.
- **Async & events:** Node HTTP (8 s timeout), post-response timer, `wa_call_events` `connect`.
- **External systems:** Node bridge (X-Node-Token).
- **Settings:** `workspaces.auto_pickup_delay_sec`, system settings `baileys_server_url` (Node URL) / `node_webhook_token` (token) with env fallbacks `SERVER_URL` / `NODE_WEBHOOK_TOKEN`, `waba_graph_api_version`.
- **Acceptance criteria:**
  - Given a customer calls a calling-enabled number, when the connect webhook arrives, then a `wa_calls` row (USER_INITIATED, ringing) and an `ai_call_logs` row (in-progress) exist and the caller is matched to a contact when a number matches.
  - Given the operator dialled out and the customer picks up, when connect (answer) arrives, then the row is `active` and the dial poll returns the SDP.
  - Given a duplicate connect for the same `meta_call_id`, then the row is updated, not duplicated, and the log row is not duplicated.
  - Given an outbound call is answered and an assistant exists, then the AI does not answer it.
- **Source refs:** `app/Http/Controllers/WaCallingWebhookController.php` (handleConnect, workspaceUserIds).
- **Port notes:** Use a normalised `contacts.phone_e164` indexed column instead of scanning. Run the Node hand-off and timer as BullMQ jobs (delayed job for the voicemail timer, cancelled by accept). Make the row upsert idempotent on `meta_call_id`.

### TW-CALL-012 — Incoming-call poll and toast

- **Status:** implemented
- **Priority:** P0 (product unusable without)
- **Effort:** M (<=1 week)
- **Depends on:** TW-CALL-011, TW-CALL-013, TW-CALL-015
- **Summary:** While an operator has Team Inbox open, the browser polls for currently-ringing inbound calls and shows an incoming-call popup with Accept and Decline (or an "AI is handling this call" note when an assistant will answer).
- **Actors & access:** Role `manager`+, plan `access_waba_calling`. The poll runs ONLY on the Team Inbox page (initialised from the inbox script), so nobody is alerted elsewhere in the app. QUIRK.
- **UX & screens:** Toast `#wa-incoming-toast` (top-right, hidden until ringing) in `resources/views/user/team-inbox/index.blade.php`: header "Incoming WhatsApp call", caller name (contact name, else "Caller +<digits>"), phone "+<digits>", buttons Accept / Decline; when `ai_handled` the buttons are hidden and "AI is handling this call..." is shown. Poll runs every 4 s only while the tab is visible, is skipped while the operator is already in a call (peer or active id), runs immediately on load and on tab re-focus, and stops on page hide. If the poll returns no ringing inbound calls the toast is hidden. The freshest ringing call is shown; a stale toast is swapped.
- **Endpoints:**

| Endpoint               | Route name              | Controller@action           | Middleware                                                                        | Request fields | Response                                                                                                                              |
| ---------------------- | ----------------------- | --------------------------- | --------------------------------------------------------------------------------- | -------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| GET wa-calling/pending | user.wa-calling.pending | WaCallingController@pending | Authenticate, EnsureWorkspaceRole:manager, EnforcePlanFeature:access_waba_calling | none           | `{ok:true, calls:[{id, direction, from_phone, to_phone, contact_id, contact_name, started_at, meta_call_id, sdp_offer, ai_handled}]}` |

- **Data:** Reads `wa_calls` for the workspace with `status = ringing`, `started_at >= now - 2 minutes`, engine-scoped (`provider` in the workspace's enabled engines), newest first, limit 5, eager-loading contact (`id,name,first_name,mobile`). `contact_name` = `name` else `first_name` else null. `sdp_offer` = `meta_payload.session.sdp`. `ai_handled` = row has an `assistant_id` AND direction is not `BUSINESS_INITIATED`.
- **Rules & edge cases:**
  1. The browser keeps only `USER_INITIATED` rows (outbound rows are ignored).
  2. Every operator sees the same ringing call; the accept race is resolved server-side (TW-CALL-013).
  3. `ai_handled` is true whenever an assistant was assigned at connect, even if the Node bridge later failed and the fallback rejects the call; the toast then disappears.
  4. The 2-minute window hides calls that rang longer (Meta's ringing window is 30-60 s).
  5. No realtime/websocket by design ("no queue, no Reverb").
- **Async & events:** 4 s polling loop.
- **External systems:** None.
- **Settings:** Poll interval constant 4000 ms (not configurable).
- **Acceptance criteria:**
  - Given a customer call rings, when an operator has Team Inbox open, then within about 4 s the toast shows the caller.
  - Given an assistant is assigned to the call, then the toast shows "AI is handling this call..." without buttons.
  - Given the call ended, then the next poll hides the toast.
  - Given a call rang more than 2 minutes ago, then it is not returned.
- **Source refs:** `app/Http/Controllers/WaCallingController.php` (pending), `resources/js/calling/incoming-call-bridge.js`, `resources/views/user/team-inbox/index.blade.php` (toast markup), `resources/js/charts/user-team-inbox-index.js` (init).
- **Port notes:** Prefer a websocket/SSE push (calls are latency-sensitive) with the poll as fallback; broadcast on the tenant channel when a `connect` webhook creates a ringing row. Keep the "AI handled" state so operators do not race the AI.

### TW-CALL-013 — Operator accepts an incoming call

- **Status:** implemented
- **Priority:** P0 (product unusable without)
- **Effort:** M (<=1 week)
- **Depends on:** TW-CALL-009, TW-CALL-012, TW-CALL-024
- **Summary:** The operator's browser answers the call: the server atomically claims the ringing slot, stops any AI bridge session, then runs Meta's two-step accept (pre_accept followed by accept, same SDP answer).
- **Actors & access:** Role `manager`+, plan `access_waba_calling`; call must be in the caller's workspace.
- **UX & screens:** Accept button in the toast; after accept the on-call panel appears (TW-CALL-018). Errors: invalid/short SDP offer client-side toast "Could not accept call: invalid call payload from WhatsApp. Try again." plus an automatic reject with reason INVALID_SDP; HTTP 409 -> info toast "Call already accepted by another teammate."; other errors -> toast "Could not accept call: <msg>" plus an automatic reject with reason OPERATOR_ERROR.
- **Endpoints:**

| Endpoint                          | Route name             | Controller@action          | Middleware                                                                        | Request fields                      | Response                                                                                                                                |
| --------------------------------- | ---------------------- | -------------------------- | --------------------------------------------------------------------------------- | ----------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| POST wa-calling/calls/{id}/accept | user.wa-calling.accept | WaCallingController@accept | Authenticate, EnsureWorkspaceRole:manager, EnforcePlanFeature:access_waba_calling | `sdp_answer` required string min 50 | 200 `{ok:true, meta}`; 404 `{ok:false,error:"call not found"}`; 409 `{ok:false,error:"already accepted",state}`; 422 `{ok:false,error}` |

- **Data:** `wa_calls.status` ringing -> connecting (claim), `handler_type = operator`, `handler_user_id = user`; after Meta accept: `status = active`, `answered_at = now`. Events `pre_accept_sent`, `accept_sent`.
- **Rules & edge cases:**
  1. Phase 1 (DB transaction with row lock): find the call by id AND workspace, lock for update; if `status != ringing` return 409 with the current state; else set connecting/operator/user. This makes concurrent operator accepts and the AI fallback timer safe.
  2. Phase 1.5: best-effort POST to Node `/api/waba-call/terminate` (3 s timeout, `X-Node-Token`) so an AI bridge already answering yields; failures swallowed.
  3. Phase 2 (outside the transaction): Meta `pre_accept` with the SDP answer, then sleep ~0.9 s, then `accept` with the SAME SDP answer (byte-identical, required by Meta; accept without pre_accept clips opening audio or is rejected).
  4. If either Meta step fails: roll the row back to `ringing`, clear handler type and user, return 422 with the Meta message. The row can then be accepted by someone else or picked up by the voicemail fallback.
  5. There is no validation that the call is inbound.
  6. Status vocabulary: `ringing -> connecting -> active -> ended | failed`.
- **Async & events:** Node terminate call; events `pre_accept_sent`, `accept_sent`. The subsequent `terminate` webhook closes the row.
- **External systems:** Meta Graph `/{phone_number_id}/calls` (actions `pre_accept`, `accept`, with `session {sdp_type:answer, sdp}`); Node bridge.
- **Settings:** `baileys_server_url`/`node_webhook_token` (Node URL/token).
- **Acceptance criteria:**
  - Given a ringing call and two operators, when both click Accept, then exactly one receives 200 and the other 409.
  - Given Meta rejects pre_accept, then the row returns to ringing and the response is 422.
  - Given an AI bridge session was already answering, then Node receives a terminate before the operator's Meta accept.
  - Given an SDP answer under 50 chars, then 422 validation.
- **Source refs:** `app/Http/Controllers/WaCallingController.php` (accept, closeNodeBridge), `app/Services/WaCalling/WaCallingService.php` (preAccept, acceptIncoming), `resources/js/calling/incoming-call-bridge.js`.
- **Port notes:** Use `SELECT ... FOR UPDATE` (or an atomic conditional UPDATE ... WHERE status='ringing') inside a Nest transaction under RLS. The 0.9 s wait is a Meta requirement, not a bug.

### TW-CALL-014 — Standalone pre-accept endpoint

- **Status:** dead-code
- **Priority:** P2 (nice to have)
- **Effort:** S (<=2 dev-days)
- **Depends on:** TW-CALL-013
- **Summary:** Sends only Meta's `pre_accept` (soft commit that stops the customer's ringer without bridging audio). Intended for an AI hand-off that needs to buy time; nothing in the app calls it because accept now does both steps.
- **Actors & access:** Role `manager`+, plan `access_waba_calling`.
- **UX & screens:** None.
- **Endpoints:**

| Endpoint                              | Route name                 | Controller@action             | Middleware                                                                        | Request fields         | Response                                    |
| ------------------------------------- | -------------------------- | ----------------------------- | --------------------------------------------------------------------------------- | ---------------------- | ------------------------------------------- |
| POST wa-calling/calls/{id}/pre-accept | user.wa-calling.pre-accept | WaCallingController@preAccept | Authenticate, EnsureWorkspaceRole:manager, EnforcePlanFeature:access_waba_calling | none (no SDP accepted) | `{ok:true, meta}` or 422 `{ok:false,error}` |

- **Data:** Sets `wa_calls.status = connecting`; event `pre_accept_sent`.
- **Rules & edge cases:**
  1. No SDP is forwarded, so Meta would reject it for a browser call; effectively unusable except for non-media use.
  2. No claim lock, no handler assignment.
- **Async & events:** Event row only.
- **External systems:** Meta calls API.
- **Settings:** None.
- **Acceptance criteria:**
  - Given a ringing call, when posted, then the request reaches Meta with action pre_accept and the row becomes connecting (documented behavior only; not exercised by UI).
- **Source refs:** `app/Http/Controllers/WaCallingController.php` (preAccept), `app/Services/WaCalling/WaCallingService.php` (preAccept).
- **Port notes:** Do not port the endpoint; keep pre_accept as an internal step of accept (TW-CALL-013) and of the Node bridge.

### TW-CALL-015 — Decline an incoming call

- **Status:** implemented
- **Priority:** P0 (product unusable without)
- **Effort:** S (<=2 dev-days)
- **Depends on:** TW-CALL-012
- **Summary:** Rejects a ringing call so the customer's phone stops ringing; the row is marked ended/REJECTED.
- **Actors & access:** Role `manager`+, plan `access_waba_calling`; same-workspace call.
- **UX & screens:** Decline button in the toast; the toast hides immediately; failures are silently swallowed (Meta's webhook reconciles).
- **Endpoints:**

| Endpoint                          | Route name             | Controller@action          | Middleware                                                                        | Request fields                  | Response                                    |
| --------------------------------- | ---------------------- | -------------------------- | --------------------------------------------------------------------------------- | ------------------------------- | ------------------------------------------- |
| POST wa-calling/calls/{id}/reject | user.wa-calling.reject | WaCallingController@reject | Authenticate, EnsureWorkspaceRole:manager, EnforcePlanFeature:access_waba_calling | `reason` nullable string max 64 | `{ok:true, meta}` or 422 `{ok:false,error}` |

- **Data:** `wa_calls.status = ended`, `end_reason = REJECTED`, `ended_at = now`; event `reject_sent`.
- **Rules & edge cases:**
  1. Reason values used by clients: `REJECTED` (Decline button), `INVALID_SDP`, `OPERATOR_ERROR`; the AI fallback passes `NO_OPERATOR`. The reason is forwarded to Meta as a `reason` field; the local `end_reason` is always `REJECTED` regardless.
  2. No status precondition or lock: an operator can reject a call already active/handled (race-prone).
  3. Meta's later `terminate` webhook overwrites `end_reason` and duration with Meta's authoritative values.
- **Async & events:** Event `reject_sent`.
- **External systems:** Meta calls API action `reject`.
- **Settings:** None.
- **Acceptance criteria:**
  - Given a ringing call, when declined, then Meta receives reject, the row is ended/REJECTED and the toast disappears for other operators on the next poll.
  - Given Meta returns an error, then 422 with message and the row is unchanged.
- **Source refs:** `app/Http/Controllers/WaCallingController.php` (reject), `app/Services/WaCalling/WaCallingService.php` (reject), `resources/js/calling/incoming-call-bridge.js`.
- **Port notes:** Add a status guard (only ringing) to avoid rejecting live calls.

### TW-CALL-016 — Hang up an active or ringing call

- **Status:** implemented
- **Priority:** P0 (product unusable without)
- **Effort:** S (<=2 dev-days)
- **Depends on:** TW-CALL-009, TW-CALL-018, TW-CALL-017
- **Summary:** Ends a live call (or cancels an outbound one still ringing) by telling Meta to terminate; the local row is finalised when Meta's terminate webhook arrives.
- **Actors & access:** Role `manager`+, plan `access_waba_calling`; same-workspace call.
- **UX & screens:** Red End button in the on-call panel.
- **Endpoints:**

| Endpoint                             | Route name                | Controller@action             | Middleware                                                                        | Request fields | Response                                    |
| ------------------------------------ | ------------------------- | ----------------------------- | --------------------------------------------------------------------------------- | -------------- | ------------------------------------------- |
| POST wa-calling/calls/{id}/terminate | user.wa-calling.terminate | WaCallingController@terminate | Authenticate, EnsureWorkspaceRole:manager, EnforcePlanFeature:access_waba_calling | none           | `{ok:true, meta}` or 422 `{ok:false,error}` |

- **Data:** Event `terminate_sent`. The row is NOT marked ended here.
- **Rules & edge cases:**
  1. Any manager can hang up any call in the workspace (not limited to the handler).
  2. If the call has no `meta_call_id` yet (dial in flight) Meta will reject; the UI ignores terminate errors and tears down locally.
  3. Local browser teardown happens regardless of the server result (and also uploads the recording).
- **Async & events:** Awaits `terminate` webhook (TW-CALL-017).
- **External systems:** Meta calls API action `terminate`.
- **Settings:** None.
- **Acceptance criteria:**
  - Given an active call, when End is pressed, then Meta gets terminate, the panel closes, and shortly after the row becomes ended with Meta's duration.
  - Given Meta errors, then the panel still closes.
- **Source refs:** `app/Http/Controllers/WaCallingController.php` (terminate), `app/Services/WaCalling/WaCallingService.php` (terminate), `resources/js/calling/webrtc-peer.js`.
- **Port notes:** Same as accept; idempotent terminate.

### TW-CALL-017 — Terminate event: finalize call, notify Node, drop call bubble into the inbox

- **Status:** implemented
- **Priority:** P0 (product unusable without)
- **Effort:** M (<=1 week)
- **Depends on:** TW-CALL-002, TW-CALL-022, TW-CALL-029
- **Summary:** On Meta's `terminate` event, the call row is closed with Meta's official status/duration, the Node bridge session is closed (stopping recordings), a "Voice call" bubble is added to the customer's Team Inbox thread and the call-log mirror is finalised.
- **Actors & access:** Webhook (machine). Effects visible to inbox users and Call Logs viewers.
- **UX & screens:** Team Inbox thread shows a call bubble (media_type `call`) labelled by outcome: answered "Voice call - <duration>", declined "Voice call declined", outbound unanswered "Voice call - no answer", inbound unanswered "Missed voice call". Duration text: `N s`, `M min`, or `M min S s`.
- **Endpoints:** Part of POST webhooks/wa-calling (TW-CALL-002).
- **Data:** `wa_calls`: `status = ended`, `end_reason = payload.status` (default `COMPLETED`), `ended_at` (Meta `end_time` in app timezone, else now), `duration_sec = payload.duration`, `error_payload = payload.errors`; event `terminate`. `inbox_messages` row: `conversation_id`, `user_id` = conversation's user, `direction` in/out (out for `BUSINESS_INITIATED`), `body` = label, `media_type = call`, `meta {event:'call', call_id, call_status (answered|missed|no_answer|declined), call_direction (in|out), duration_sec}`, `status = received`, `sent_at`, `delivered_at`. `conversations.preview` (first 191 chars of label) and `last_message_at` updated.
- **Rules & edge cases:**
  1. Unknown `meta_call_id` -> ignored. Duplicate terminate webhooks re-run the row update but the bubble is idempotent (skipped if any message in that conversation already carries `meta.call_id`).
  2. `answered` = `duration_sec > 0`. Otherwise declined when end reason (uppercased) is DECLINED/REJECTED, else `no_answer` for outbound, `missed` for inbound.
  3. Conversation resolution: the row's `conversation_id`, else the newest conversation in the workspace whose `raw_jid` equals the caller digits (or `<digits>@s.whatsapp.net`); if none, no bubble.
  4. QUIRK: for outbound calls the bubble's `to_number` is set from `wa_calls.from_phone`, which for outbound is the BUSINESS number, not the customer.
  5. Forward to Node `/api/waba-call/terminate` (5 s) so the bridge closes now; without it caller hang-ups left AI bridge sessions running and produced 15-25 GB raw PCM recordings. Failure swallowed.
  6. Mirror bubble and log-finalise are each in try/catch; a failure never fails the webhook.
  7. Meta failures are still stored as `status = ended` (never `failed`), so the log maps them to `no-answer` (TW-CALL-022).
  8. Order of operations: update row, write event, Node terminate, inbox bubble, log finalise.
- **Async & events:** Node HTTP, `wa_call_events` `terminate`. No notification/badge is raised for missed calls beyond the thread bubble and preview.
- **External systems:** Node bridge.
- **Settings:** None.
- **Acceptance criteria:**
  - Given an answered call of 130 s, when terminate arrives, then the row has duration 130, an inbox bubble "Voice call - 2 min 10 s" exists once, and the call log shows completed.
  - Given a missed inbound call (no duration), then bubble "Missed voice call" and log status no-answer.
  - Given the terminate is delivered twice, then only one bubble exists.
  - Given the caller hung up on an AI call, then Node's session is closed immediately.
- **Source refs:** `app/Http/Controllers/WaCallingWebhookController.php` (handleTerminate, mirrorCallToInbox, humanCallDuration).
- **Port notes:** Emit a domain event `call.ended` consumed by inbox (bubble), logs and Node bridge jobs. Fix the outbound `to_number` bug (use customer number).

### TW-CALL-018 — On-call panel (timer, mute, end, record)

- **Status:** implemented
- **Priority:** P1 (expected by customers)
- **Effort:** S (<=2 dev-days)
- **Depends on:** TW-CALL-009, TW-CALL-016, TW-CALL-019
- **Summary:** A small floating panel that shows the connected/ringing state and controls for the operator's active call.
- **Actors & access:** Operator with an active call in the tab.
- **UX & screens:** `#wa-call-panel` (bottom-right, hidden by default) in `user/team-inbox/index.blade.php`: title "On call", contact name (or "+phone"), timer `M:SS`, status text ("ringing..." while an outbound call rings, then "connected"), three round buttons: Mute (toggles the mic track; label switches Mute/Muted; each new call starts unmuted), End (red, hang up), Record (label Record/Recording; turns red and pulses when armed; disabled after arming because recording cannot be stopped mid-call to avoid truncated files). The timer starts only when audio is connected (not while an outbound call rings). Only one call per tab.
- **Endpoints:** Uses TW-CALL-016/019.
- **Data:** None.
- **Rules & edge cases:**
  1. Mute only disables the local audio track; nothing is sent to the server.
  2. Inbound calls are auto-armed for recording immediately after answer (no operator action, no notice to the customer); outbound calls require pressing Record. QUIRK/compliance risk.
  3. Record button tooltip: "Record this call" / "Recording this call".
- **Async & events:** 1 s timer.
- **External systems:** None.
- **Settings:** None.
- **Acceptance criteria:**
  - Given an outbound call ringing, then the panel shows "ringing..." with no timer.
  - Given the customer answers, then the status switches to connected and the timer starts at 0:00.
  - Given Mute is pressed, then the remote party cannot hear the operator and the label shows Muted.
- **Source refs:** `resources/js/calling/incoming-call-bridge.js`, `resources/views/user/team-inbox/index.blade.php`.
- **Port notes:** Belongs to `apps/web` inbox layout; make recording consent explicit (announce or toggle) in the rebuild.

### TW-CALL-019 — Operator call recording (browser-side) and upload

- **Status:** implemented
- **Priority:** P1 (expected by customers)
- **Effort:** M (<=1 week)
- **Depends on:** TW-CALL-009, TW-CALL-022, TW-CALL-035
- **Summary:** Operator calls run browser-to-Meta, so the server never sees audio. The browser mixes the operator's microphone and the customer's audio, records it with MediaRecorder and uploads a single mixed file on hang-up; it appears as the "Full call" player in Call Logs.
- **Actors & access:** Role `manager`+, plan `access_waba_calling`. Not gated by `access_call_recording`.
- **UX & screens:** Start: automatically after answering an inbound call, or by the Record button on outbound. Success toast "Call recording saved to Call logs." Playback under Call Logs detail (TW-CALL-036).
- **Endpoints:**

| Endpoint                             | Route name                | Controller@action                   | Middleware                                                                        | Request fields                                           | Response                                                                                                           |
| ------------------------------------ | ------------------------- | ----------------------------------- | --------------------------------------------------------------------------------- | -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| POST wa-calling/calls/{id}/recording | user.wa-calling.recording | WaCallingController@uploadRecording | Authenticate, EnsureWorkspaceRole:manager, EnforcePlanFeature:access_waba_calling | multipart `recording` required file max 51200 KB (50 MB) | `{ok:true,url}`; 422 `{ok:false,error:"call log unavailable"}`; 500 `{ok:false,error:"could not store recording"}` |

- **Data:** File saved on the `public` disk as `call-recordings/call-{ai_call_log_id}.webm`; `ai_call_logs.recording_url_mixed` = public disk URL; `wa_calls.recording_path` = disk path. If the call has no log row yet one is created via the mirror's `onConnect`.
- **Rules & edge cases:**
  1. Client: audio graph mixes local mic + remote stream into one destination; preferred MIME `audio/webm;codecs=opus`, else `audio/webm`, else `audio/ogg;codecs=opus`; chunks flushed every 1 s; the AudioContext is resumed explicitly (a suspended context records silence); uploaded on teardown only if the blob is at least 256 bytes; chunk buffer is preserved until the final flush so the tail is not lost.
  2. A second upload for the same call overwrites the same filename.
  3. QUIRK: the file lives on the `public` disk (predictable URL `/storage/call-recordings/call-<logId>.webm`, no auth), unlike AI recordings, which are relocated to private storage. Privacy gap.
  4. The terminate webhook never clobbers an existing URL (`?:` merge), except when Meta supplies its own `recording_url`.
  5. Unsupported browsers (no MediaRecorder): `startRecording` returns false and the operator sees "Recording is not supported in this browser." for manual recording.
- **Async & events:** Upload after teardown, independent of the terminate webhook ordering.
- **External systems:** None.
- **Settings:** Server upload cap 50 MB; php/nginx limits apply.
- **Acceptance criteria:**
  - Given an operator recorded a 5 min call, when they hang up, then the file uploads and the call log detail shows a "Full call" player.
  - Given a file over 50 MB, then 422 validation.
  - Given the recording was never armed, then nothing is uploaded and the detail says "Recording disabled for this call."
- **Source refs:** `resources/js/calling/webrtc-peer.js` (startRecording, _startRecording, _stopRecordingAndUpload), `resources/js/calling/incoming-call-bridge.js`, `app/Http/Controllers/WaCallingController.php` (uploadRecording).
- **Port notes:** Store in tenant-scoped object storage with signed, expiring URLs; add a consent/announcement option and retention policy. Multipart upload up to 50 MB through the API (or presigned upload).

### TW-CALL-020 — Server-side "start recording" for bridge calls

- **Status:** dead-code
- **Priority:** P2 (nice to have)
- **Effort:** S (<=2 dev-days)
- **Depends on:** TW-CALL-030
- **Summary:** An endpoint that asks the Node bridge to arm recording for a live AI-bridge call. The operator UI no longer calls it (browser-side recording replaced it), so it only serves AI-bridge sessions if some client calls it.
- **Actors & access:** Role `manager`+, plan `access_waba_calling`.
- **UX & screens:** None.
- **Endpoints:**

| Endpoint                          | Route name             | Controller@action                  | Middleware                                                                        | Request fields | Response                                                                                                                                                                             |
| --------------------------------- | ---------------------- | ---------------------------------- | --------------------------------------------------------------------------------- | -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| POST wa-calling/calls/{id}/record | user.wa-calling.record | WaCallingController@startRecording | Authenticate, EnsureWorkspaceRole:manager, EnforcePlanFeature:access_waba_calling | none           | `{ok:true,recording:true}`; 422 with "Call has no Meta id yet.", "Call bridge is not configured.", "Could not start recording - the call may have ended." or "Recorder unreachable." |

- **Data:** `wa_calls.recording_started_at = now` (quiet save).
- **Rules & edge cases:**
  1. Forwards `meta_call_id` to Node `POST /api/waba-call/record` (8 s timeout, `X-Node-Token`); Node returns 404 if no live session (browser-answered calls have none).
  2. Node arms recording (idempotent) and only audio from that moment on is captured; whether each side is written still depends on the assistant's `record_agent` / `record_user`.
  3. Node route is defined inline in `node/routes/index.js` (422 if `meta_call_id` missing).
- **Async & events:** None.
- **External systems:** Node bridge.
- **Settings:** Node URL/token.
- **Acceptance criteria:**
  - Given a live AI-bridge call, when posted, then Node arms recording and `recording_started_at` is set.
  - Given a browser-answered call, then Node answers 404 and the API returns 422.
- **Source refs:** `app/Http/Controllers/WaCallingController.php` (startRecording), `node/routes/index.js`, `node/services/wabaCallBridge.js` (startRecording), route comment in `routes/web.php`.
- **Port notes:** Not needed if AI calls auto-arm from assistant settings (they do); skip or keep as an admin "start recording now" API.

### TW-CALL-021 — Call event ledger (wa_call_events)

- **Status:** implemented
- **Priority:** P1 (expected by customers)
- **Effort:** S (<=2 dev-days)
- **Depends on:** TW-CALL-011, TW-CALL-017
- **Summary:** An append-only forensic ledger of everything that happens to a call: Meta webhooks, actions we send, bridge callbacks and fallback decisions; also the source for building transcripts and tool-call timelines.
- **Actors & access:** System only; no UI or API to browse it (support/dev use, DB only).
- **UX & screens:** None. Docs claim "each call action is logged so full history can be reviewed" - true at DB level only.
- **Endpoints:** None.
- **Data:** `wa_call_events`: `id`, `wa_call_id` (FK cascade delete), `event_type` varchar 48, `payload` JSON, `received_at` timestamp default current; index `(wa_call_id, received_at)`; no created/updated timestamps. Event types written: `connect`, `terminate`, `dial_sent`, `pre_accept_sent`, `accept_sent`, `reject_sent`, `terminate_sent`, `bridge_accepted`, `bridge_error`, `transcript_turn` (payload role agent|user, text, t_ms), `ai_voicemail_triggered`, `ai_callback_requested`. Type `tool_call` is READ by the log mirror but never written by any code (dead reader).
- **Rules & edge cases:**
  1. Action-event writes are wrapped in try/catch (a ledger failure never breaks a call); connect/terminate/bridge events are written directly.
  2. `WaCall::events()` orders by `received_at`.
  3. Volume: several rows per call plus one per transcript turn.
- **Async & events:** N/A.
- **External systems:** None.
- **Settings:** None.
- **Acceptance criteria:**
  - Given a full inbound AI call, then the ledger contains connect, bridge_accepted, N transcript_turn rows and a terminate row in received_at order.
  - Given the call row is deleted, then its events are deleted.
- **Source refs:** `app/Models/WaCallEvent.php`, `app/Services/WaCalling/WaCallingService.php` (logEvent), `app/Http/Controllers/FlowNodeActionsController.php`, migration `2026_05_23_050000_create_wa_calls_tables.php`.
- **Port notes:** Table `call_events` with tenant_id for RLS (Reference keys only through the call). Partition or TTL-prune transcript events if volume grows.

## Port extensions (not in Reference)

Recorded here so the inventory and the wiring map agree. None of these exists in Reference 1.7.0, so none carries Reference source refs; each is
specified in [the wiring map](../wiring/calling-voice.md) and [the parity file](../parity/calling-voice.md).

- **EXT-CALL-001** call analytics; **EXT-CALL-002 to 006** call recording rules, consent, gated upload, retention and the personal-data registry entry.
- **EXT-CALL-007** calling readiness checklist per WhatsApp number: what stands between a connected number and a working call (plan, connection,
  coexistence, registration, messaging limit, token permissions, webhook subscription, `calls` field, Meta's calling status, TURN, people who may
  call, recording rules), stored with the time and the reason it was checked. Extends TW-CALL-003 and TW-CALL-004 (Reference's card only had the switch).
- **EXT-CALL-008** the `calls` webhook field of the platform's Meta app: read, and added when missing (Reference documented it as a manual
  prerequisite in the toggle's refusal text, TW-CALL-004 rule 5).
- **EXT-CALL-009** Meta's refusals as stable reasons (TW-CALL-004 rules 4 to 6, 005, 008 told them as English sentences).
- **EXT-CALL-010** a test call to the admin's own phone through the dial path of TW-CALL-008.
- **EXT-CALL-011** an optional switch-on after a number is connected, and a scheduled re-check, instead of "someone must remember to press the button".
